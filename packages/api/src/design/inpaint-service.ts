import sharp from 'sharp';
import { randomUUID, createHash } from 'node:crypto';
import type { DesignStore, SerializedProposal } from './store';
import type { ImageEditAdapter } from './image-edit-adapter';
import type { GenerationBudget } from './generation-budget';
import type { AssetStore } from './assets';
import { recoverEditJob } from './edit-job-recovery';
import { DesignError } from './errors';
export interface InpaintResult {
  id: string;
  status: 'running' | 'succeeded' | 'failed' | 'submission_unknown';
  proposalId?: string;
}
/** Per-user persistent intent, one paid attempt, strict provider composite; result is proposal. */
export async function createInpaintService(options: {
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
      mask: Buffer;
    },
  ): Promise<InpaintResult>;
}> {
  const { store, assets, budget, provider } = options;
  const rows = store.connection.collection('design_inpaint_jobs');
  await rows.createIndex({ actor: 1, documentId: 1, clientId: 1 }, { unique: true });
  await rows.createIndex({ id: 1 }, { unique: true });
  const view = (r: any): InpaintResult => ({
    id: r.id,
    status: r.status,
    ...(r.proposalId ? { proposalId: r.proposalId } : {}),
  });
  return {
    async submit(actor, documentId, input) {
      const doc = await store.getDocument(actor, documentId);
      await store.withProjectWrite(actor, doc.projectId, async () => true);
      if (
        !input ||
        !/^[\w.-]{1,100}$/.test(input.clientId) ||
        typeof input.prompt !== 'string' ||
        !input.prompt.trim() ||
        input.prompt.length > 8000 ||
        !Buffer.isBuffer(input.mask) ||
        input.mask.length > 10 * 1024 * 1024
      )
        throw new DesignError(422, 'inpaint_input', 'Invalid inpaint request');
      const digest = createHash('sha256')
        .update(
          JSON.stringify({
            nodeId: input.nodeId,
            revision: input.expectedRevision,
            prompt: input.prompt,
          }),
        )
        .update(input.mask)
        .digest('hex');
      const previous = await rows.findOne({ actor, documentId, clientId: input.clientId });
      if (previous) {
        if (previous.digest !== digest)
          throw new DesignError(409, 'id_reuse', 'Request identity reused');
        return view(
          await recoverEditJob(
            rows,
            store.connection.collection('design_proposals'),
            previous,
            'inpaint',
          ),
        );
      }
      if (doc.revision !== input.expectedRevision)
        throw new DesignError(409, 'revision_mismatch', 'Document changed');
      const node = doc.payload.nodes.find((n) => n.id === input.nodeId);
      if (!node || node.type !== 'image')
        throw new DesignError(422, 'inpaint_node', 'Select image');
      let n: typeof node | undefined = node;
      while (n) {
        if (n.locked) throw new DesignError(422, 'lock', 'Image or ancestor locked');
        n = doc.payload.nodes.find((x) => x.id === n!.parentId);
      }
      const source = await assets.getBytes(actor, node.props.assetId!, node.props.assetVersion!);
      const raw = await sharp(input.mask, { limitInputPixels: 4096 * 4096 })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (raw.info.channels !== 4)
        throw new DesignError(422, 'inpaint_mask', 'Opaque grayscale mask required');
      const gray = Buffer.alloc(raw.info.width * raw.info.height);
      let selected = false;
      for (let i = 0; i < gray.length; i++) {
        const j = i * 4;
        if (
          raw.data[j] !== raw.data[j + 1] ||
          raw.data[j] !== raw.data[j + 2] ||
          raw.data[j + 3] !== 255
        )
          throw new DesignError(422, 'inpaint_mask', 'Opaque grayscale mask required');
        gray[i] = raw.data[j];
        selected ||= gray[i] > 0;
      }
      if (!selected) throw new DesignError(422, 'inpaint_mask', 'Empty mask');
      const mask = await sharp(gray, {
        raw: { width: raw.info.width, height: raw.info.height, channels: 1 },
      })
        .toColourspace('b-w')
        .png()
        .toBuffer();
      const meta = await sharp(source.bytes).metadata();
      if (meta.width !== raw.info.width || meta.height !== raw.info.height)
        throw new DesignError(422, 'inpaint_size', 'Mask dimensions differ');
      await budget.preflight(actor);
      const id = randomUUID();
      const record = {
        id,
        actor,
        documentId,
        clientId: input.clientId,
        digest,
        status: 'running',
        createdAt: new Date(),
      };
      try {
        await rows.insertOne(record);
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
        const existing = await rows.findOne({ actor, documentId, clientId: input.clientId });
        if (!existing || existing.digest !== digest)
          throw new DesignError(409, 'id_reuse', 'Request identity reused');
        return view(
          await recoverEditJob(
            rows,
            store.connection.collection('design_proposals'),
            existing,
            'inpaint',
          ),
        );
      }
      let reserved = false,
        attempted = false,
        consumed = false;
      try {
        await budget.reserve(id, actor);
        reserved = true;
        await budget.claimDispatch(id, actor);
        attempted = true;
        const bytes = await provider.inpaint({
          principalId: actor,
          jobId: id,
          prompt: input.prompt,
          original: source.bytes,
          mask,
        });
        await store.withProjectWrite(actor, doc.projectId, async () => true);
        const fresh = await assets.upload(actor, doc.projectId, {
          bytes,
          mime: 'image/png',
          filename: 'inpaint-variant.png',
        });
        await budget.settle(id, 'consumed');
        consumed = true;
        const proposal = await store.createProposal(actor, doc.id, {
          sourceJobId: 'inpaint-' + id,
          summary: 'Редактирование выбранной области',
          baseRevision: doc.revision,
          declaredScope: [node.id],
          operations: [
            {
              type: 'replaceAsset',
              nodeId: node.id,
              assetId: fresh.id,
              assetVersion: fresh.version,
            },
          ],
        });
        await rows.updateOne(
          { id, status: { $in: ['running', 'submission_unknown'] } },
          { $set: { status: 'succeeded', proposalId: proposal.id, assetId: fresh.id } },
        );
        const saved = await rows.findOne({ id, actor });
        return saved ? view(saved) : { id, status: 'succeeded', proposalId: proposal.id };
      } catch {
        const status = attempted ? 'submission_unknown' : 'failed';
        await rows.updateOne({ id, status: 'running' }, { $set: { status } });
        if (reserved && !consumed)
          await budget.settle(id, attempted ? 'uncertain' : 'released').catch(() => {});
        const saved = await rows.findOne({ id, actor });
        return saved ? view(saved) : { id, status };
      }
    },
  };
}
