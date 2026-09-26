import { createHash, randomUUID } from 'node:crypto';
import type { ImageEditAdapter } from './image-edit-adapter';
import type { GenerationBudget } from './generation-budget';
import type { DesignStore } from './store';
import type { AssetStore } from './assets';
import { recoverEditJob } from './edit-job-recovery';
import { prepareOutpaint } from './image-transforms';
import { DesignError } from './errors';
export async function createOutpaintService(options: {
  store: DesignStore;
  assets: AssetStore;
  budget: GenerationBudget;
  provider: ImageEditAdapter;
}): Promise<{
  submit(
    actor: string,
    documentId: string,
    input: {
      clientId: string;
      nodeId: string;
      expectedRevision: number;
      prompt: string;
      left: number;
      right: number;
      top: number;
      bottom: number;
    },
  ): Promise<{ id: string; status: string; proposalId?: string }>;
}> {
  const { store, assets, budget, provider } = options,
    rows = store.connection.collection('design_outpaint_jobs');
  await rows.createIndex({ actor: 1, documentId: 1, clientId: 1 }, { unique: true });
  return {
    async submit(actor, documentId, input) {
      const doc = await store.getDocument(actor, documentId);
      await store.withProjectWrite(actor, doc.projectId, async () => true);
      if (
        !input ||
        !/^[\w.-]{1,100}$/.test(input.clientId) ||
        typeof input.prompt !== 'string' ||
        !input.prompt.trim() ||
        input.prompt.length > 2000
      )
        throw new DesignError(422, 'outpaint_input', 'Invalid expansion input');
      const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const old = await rows.findOne({ actor, documentId, clientId: input.clientId });
      if (old) {
        if (old.hash !== hash) throw new DesignError(409, 'id_reuse', 'Expansion identity reused');
        const saved = await recoverEditJob(
          rows,
          store.connection.collection('design_proposals'),
          old,
          'outpaint',
        );
        return { id: saved.id, status: saved.status, proposalId: saved.proposalId };
      }
      if (doc.revision !== input.expectedRevision)
        throw new DesignError(409, 'revision_mismatch', 'Document changed');
      const node = doc.payload.nodes.find((n) => n.id === input.nodeId);
      if (!node || node.type !== 'image' || node.props.crop || node.props.rotation !== 0)
        throw new DesignError(
          422,
          'outpaint_geometry',
          'Use uncropped unrotated image for expansion',
        );
      let n: typeof node | undefined = node;
      while (n) {
        if (n.locked) throw new DesignError(422, 'lock', 'Image locked');
        n = doc.payload.nodes.find((x) => x.id === n!.parentId);
      }
      const source = await assets.getBytes(actor, node.props.assetId!, node.props.assetVersion!);
      const meta = await assets.getVersion(actor, node.props.assetId!, node.props.assetVersion!);
      const expanded = await prepareOutpaint({
        bytes: source.bytes,
        mime: source.mime,
        left: input.left,
        right: input.right,
        top: input.top,
        bottom: input.bottom,
      });
      await budget.preflight(actor);
      const id = randomUUID();
      try {
        await rows.insertOne({
          id,
          actor,
          documentId,
          clientId: input.clientId,
          hash,
          status: 'running',
          createdAt: new Date(),
        });
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
        const record = await rows.findOne({ actor, documentId, clientId: input.clientId });
        if (!record || record.hash !== hash)
          throw new DesignError(409, 'id_reuse', 'Expansion identity reused');
        const saved = await recoverEditJob(
          rows,
          store.connection.collection('design_proposals'),
          record,
          'outpaint',
        );
        return { id: saved.id, status: saved.status, proposalId: saved.proposalId };
      }
      let reserved = false,
        attempted = false,
        consumed = false;
      try {
        await budget.reserve(id, actor);
        reserved = true;
        await budget.claimDispatch(id, actor);
        attempted = true;
        const output = await provider.inpaint({
          principalId: actor,
          jobId: id,
          prompt: input.prompt,
          original: expanded.original,
          mask: expanded.mask,
        });
        const fresh = await assets.upload(actor, doc.projectId, {
          bytes: output,
          mime: 'image/png',
          filename: 'outpaint-variant.png',
        });
        await budget.settle(id, 'consumed');
        consumed = true;
        const sx = node.props.width / meta.width,
          sy = node.props.height / meta.height;
        const proposal = await store.createProposal(actor, documentId, {
          summary: 'Расширение изображения с сохранением исходной области',
          sourceJobId: 'outpaint-' + id,
          baseRevision: doc.revision,
          declaredScope: [node.id],
          operations: [
            {
              type: 'replaceAsset',
              nodeId: node.id,
              assetId: fresh.id,
              assetVersion: fresh.version,
            },
            {
              type: 'setProperty',
              nodeId: node.id,
              property: 'x',
              value: node.props.x - input.left * sx,
            },
            {
              type: 'setProperty',
              nodeId: node.id,
              property: 'y',
              value: node.props.y - input.top * sy,
            },
            { type: 'setProperty', nodeId: node.id, property: 'width', value: expanded.width * sx },
            {
              type: 'setProperty',
              nodeId: node.id,
              property: 'height',
              value: expanded.height * sy,
            },
          ],
        });
        await rows.updateOne(
          { id, status: { $in: ['running', 'submission_unknown'] } },
          { $set: { status: 'succeeded', proposalId: proposal.id } },
        );
        const saved = await rows.findOne({ id, actor });
        return {
          id,
          status: saved?.status ?? 'succeeded',
          proposalId: saved?.proposalId ?? proposal.id,
        };
      } catch {
        const status = attempted ? 'submission_unknown' : 'failed';
        await rows.updateOne({ id, status: 'running' }, { $set: { status } });
        if (reserved && !consumed)
          await budget.settle(id, attempted ? 'uncertain' : 'released').catch(() => {});
        const saved = await rows.findOne({ id, actor });
        return { id, status: saved?.status ?? status, proposalId: saved?.proposalId };
      }
    },
  };
}
