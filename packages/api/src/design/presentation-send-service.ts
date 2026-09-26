import { createHash, randomUUID } from 'node:crypto';
import type { DesignStore } from './store';
import { createPresentonAdapter, type PresentonTransport } from './presenton-adapter';
import { preparePresentationHandoff } from './presentation-handoff';
import { loadProjectSystemResolver } from './project-systems';
import { DesignError } from './errors';
export interface PresentationSendRecord {
  id: string;
  actor: string;
  documentId: string;
  sourceRevision: number;
  destinationId: string;
  status: 'running' | 'succeeded' | 'submission_unknown';
  slideId?: string;
  hash: string;
  createdAt?: Date;
  plannedSlideId?: string;
}
export async function createPresentationSendService(
  store: DesignStore,
  transport: PresentonTransport,
): Promise<{
  get(actor: string, id: string): Promise<PresentationSendRecord>;
  list(actor: string, documentId: string): Promise<PresentationSendRecord[]>;
  reconcile(actor: string, id: string): Promise<PresentationSendRecord>;
  send(
    actor: string,
    documentId: string,
    input: {
      operationId: string;
      sourceRevision: number;
      destinationId: string;
      expectedDestinationRevision: number;
      png: Buffer;
      targetSlideId?: string;
    },
  ): Promise<PresentationSendRecord>;
}> {
  const rows = store.connection.collection<PresentationSendRecord>('design_presentation_sends');
  await rows.createIndex({ actor: 1, id: 1 }, { unique: true });
  const adapter = createPresentonAdapter(transport);
  const view = (r: any): PresentationSendRecord => {
    const { _id, ...value } = r;
    return value;
  };
  const read = async (actor: string, id: string): Promise<PresentationSendRecord> => {
    const row = await rows.findOne({ actor, id });
    if (!row) throw new DesignError(404, 'not_found', 'Presentation send not found');
    await store.getDocument(actor, row.documentId);
    return view(row);
  };
  return {
    get: read,
    async list(actor, documentId) {
      await store.getDocument(actor, documentId);
      return (
        await rows.find({ actor, documentId }).sort({ createdAt: -1 }).limit(100).toArray()
      ).map(view);
    },
    async reconcile(actor, id) {
      const row = await read(actor, id);
      const doc = await store.getDocument(actor, row.documentId);
      await store.withProjectWrite(actor, doc.projectId, async () => true);
      if (row.status === 'succeeded') return row;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new DesignError(
                504,
                'presentation_receipt_timeout',
                'Receipt lookup timed out; do not resend',
              ),
            );
          }, 15000);
        });
        let receipt: any;
        try {
          receipt = await Promise.race([
            transport.request(
              actor,
              `/api/v1/ppt/editor/v1/documents/${row.destinationId}/operations/${row.id}`,
              { method: 'GET', signal: controller.signal },
            ),
            timeout,
          ]);
        } catch (error) {
          if (error instanceof DesignError && error.status === 404) return row;
          throw error;
        }
        const changed = Array.isArray(receipt?.changedSlideIds) ? receipt.changedSlideIds : [];
        const inverse = Array.isArray(receipt?.inverseOperations) ? receipt.inverseOperations : [];
        const viaChanged =
          changed.length === 1 &&
          typeof changed[0] === 'string' &&
          (!row.plannedSlideId || changed[0] === row.plannedSlideId);
        const viaInverse = inverse.find(
          (op: any) =>
            op?.operationType === 'DeleteSlide' &&
            Array.isArray(op?.targetIds) &&
            op.targetIds.length === 1 &&
            typeof op.targetIds[0] === 'string' &&
            (!row.plannedSlideId || op.targetIds[0] === row.plannedSlideId),
        );
        const slideId = viaChanged ? changed[0] : viaInverse ? viaInverse.targetIds[0] : undefined;
        if (
          receipt?.documentId !== row.destinationId ||
          receipt?.operationId !== row.id ||
          receipt?.status !== 'applied' ||
          !slideId
        )
          throw new DesignError(502, 'presentation_receipt', 'Receipt does not match this send');
        return store.withProjectWrite(actor, doc.projectId, async (session) => {
          await rows.updateOne(
            { actor, id, status: { $in: ['running', 'submission_unknown'] } },
            { $set: { status: 'succeeded', slideId } },
            { session },
          );
          const latest = await rows.findOne({ actor, id }, { session });
          if (!latest) throw new DesignError(404, 'not_found', 'Send missing');
          return view(latest);
        });
      } finally {
        clearTimeout(timer!);
        controller.abort();
      }
    },
    async send(actor, documentId, input) {
      const head = await store.getDocument(actor, documentId);
      await store.withProjectWrite(actor, head.projectId, async () => true);
      if (
        !input ||
        !Number.isInteger(input.sourceRevision) ||
        !/^[a-zA-Z0-9-]{1,128}$/.test(input.operationId)
      )
        throw new DesignError(422, 'presentation_input', 'Invalid send identity');
      const source = await store.getRevisionSnapshot(actor, documentId, input.sourceRevision);
      const doc = {
        id: documentId,
        projectId: head.projectId,
        ...source,
        kind: 'canvas' as const,
        schemaVersion: 1 as const,
        revision: input.sourceRevision,
        archived: !!source.archived,
      };
      await preparePresentationHandoff(
        {
          document: doc as import('./types').DesignDocument,
          png: input.png,
          sourceLink: '/design?documentId=' + documentId,
        },
        await loadProjectSystemResolver(store.connection, head.projectId),
      );
      const hash = createHash('sha256')
        .update(
          JSON.stringify({
            documentId,
            sourceRevision: input.sourceRevision,
            destinationId: input.destinationId,
            expectedDestinationRevision: input.expectedDestinationRevision,
            targetSlideId: input.targetSlideId,
          }),
        )
        .update(input.png)
        .digest('hex');
      const existing = await rows.findOne({ id: input.operationId, actor });
      if (existing) {
        if (existing.hash !== hash) throw new DesignError(409, 'id_reuse', 'Send identity reused');
        return view(existing);
      }
      const record: PresentationSendRecord = {
        id: input.operationId,
        actor,
        documentId,
        sourceRevision: input.sourceRevision,
        destinationId: input.destinationId,
        status: 'running',
        hash,
        createdAt: new Date(),
        plannedSlideId: input.targetSlideId ?? randomUUID(),
      };
      try {
        await rows.insertOne(record);
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
        const previous = await rows.findOne({ id: input.operationId, actor });
        if (!previous || previous.hash !== hash)
          throw new DesignError(409, 'id_reuse', 'Send identity reused');
        return view(previous);
      }
      try {
        const result = await adapter.send({
          actor,
          destinationId: input.destinationId,
          expectedRevision: input.expectedDestinationRevision,
          operationId: input.operationId,
          png: input.png,
          sourceDocumentId: documentId,
          sourceRevision: input.sourceRevision,
          title: source.title,
          targetSlideId: input.targetSlideId,
          plannedSlideId: record.plannedSlideId,
        });
        await rows.updateOne(
          { id: input.operationId, actor, status: 'running' },
          { $set: { status: 'succeeded', slideId: result.slideId } },
        );
        const latest = await rows.findOne({ actor, id: record.id });
        return latest ? view(latest) : { ...record, status: 'succeeded', slideId: result.slideId };
      } catch {
        await rows.updateOne(
          { id: input.operationId, actor, status: 'running' },
          { $set: { status: 'submission_unknown' } },
        );
        const latest = await rows.findOne({ actor, id: record.id });
        return latest ? view(latest) : { ...record, status: 'submission_unknown' };
      }
    },
  };
}
