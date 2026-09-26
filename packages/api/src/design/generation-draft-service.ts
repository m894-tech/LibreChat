import { randomUUID } from 'node:crypto';
import type { Connection } from 'mongoose';
import type { DesignStore, SerializedProposal } from './store';
import type { GenerationBudget } from './generation-budget';
import type { DesignDocument } from './types';
import { loadProjectSystemResolver } from './project-systems';
import { createGenerationDraft } from './generation-draft';
import { canonicalHash } from './operations';
import { DesignError } from './errors';
export interface DraftStreamTransport {
  stream(
    input: import('./providers').ProviderSubmitInput,
    onDelta: (chunk: string) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void>;
}
export interface DraftGenerationRecord {
  id: string;
  actor: string;
  documentId: string;
  projectId: string;
  clientId: string;
  hash: string;
  baseRevision: number;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'submission_unknown';
  snapshot: DesignDocument;
  createdAt: Date;
  updatedAt: Date;
  error?: string;
}
export interface DraftGenerationService {
  generate(
    actor: string,
    documentId: string,
    input: {
      clientId: string;
      prompt: string;
      expectedRevision: number;
      documentScopeConfirmed: boolean;
    },
    onSnapshot: (record: DraftGenerationRecord) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<DraftGenerationRecord>;
  list(actor: string, documentId: string): Promise<DraftGenerationRecord[]>;
  get(actor: string, id: string): Promise<DraftGenerationRecord>;
  proposal(actor: string, id: string): Promise<SerializedProposal>;
}
/** Explicit whole-document APPEND draft. Head is never changed by streamed content.
 * Unique persistent intent before send; aborted/uncertain send never automatically retried.
 */
export async function createDraftGenerationService(options: {
  connection: Connection;
  store: DesignStore;
  budget: GenerationBudget;
  provider: DraftStreamTransport;
}): Promise<DraftGenerationService> {
  const { store, budget, provider } = options;
  const collection = options.connection.collection('design_stream_drafts');
  await collection.createIndex({ actor: 1, documentId: 1, clientId: 1 }, { unique: true });
  await collection.createIndex({ id: 1 }, { unique: true });
  const publicRecord = (r: any): DraftGenerationRecord => {
    const { _id, ...value } = r;
    return value;
  };
  const load = async (actor: string, id: string): Promise<DraftGenerationRecord> => {
    let r = await collection.findOne({ id, actor });
    if (!r) throw new DesignError(404, 'not_found', 'Draft not found');
    await store.getDocument(actor, r.documentId);
    if (r.status === 'running' && Date.now() - new Date(r.updatedAt).getTime() > 120000) {
      await collection.updateOne(
        { id, status: 'running', updatedAt: r.updatedAt },
        {
          $set: {
            status: 'submission_unknown',
            error: 'Worker heartbeat expired; no automatic retry',
          },
        },
      );
      r = await collection.findOne({ id, actor });
    }
    return publicRecord(r);
  };
  return {
    get: load,
    async list(actor, documentId) {
      await store.getDocument(actor, documentId);
      const records = await collection
        .find({ actor, documentId })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();
      return Promise.all(records.map((r) => load(actor, r.id)));
    },
    async generate(actor, documentId, input, onSnapshot, signal) {
      if (
        !input?.documentScopeConfirmed ||
        typeof input.prompt !== 'string' ||
        !input.prompt.trim() ||
        input.prompt.length > 8000 ||
        !/^[\w.-]{1,100}$/.test(input.clientId)
      )
        throw new DesignError(
          422,
          'generation_input',
          'Brief and explicit whole-document scope required',
        );
      const current = await store.getDocument(actor, documentId);
      await store.withProjectWrite(actor, current.projectId, async () => true);
      const hash = canonicalHash(input);
      const previous = await collection.findOne({ actor, documentId, clientId: input.clientId });
      if (previous) {
        if (previous.hash !== hash)
          throw new DesignError(409, 'id_reuse', 'Draft request identity reused');
        return publicRecord(previous);
      }
      if (current.revision !== input.expectedRevision)
        throw new DesignError(409, 'revision_mismatch', 'Document changed');
      if (current.payload.nodes.length > 200)
        throw new DesignError(422, 'generation_limit', 'Draft limit200nodes');
      await budget.preflight(actor);
      const base: DesignDocument = {
        id: current.id,
        projectId: current.projectId,
        kind: current.kind,
        schemaVersion: 1,
        title: current.title,
        revision: current.revision,
        designSystem: current.designSystem,
        payload: current.payload,
        assetRefs: current.assetRefs,
        archived: current.archived,
      };
      const resolver = await loadProjectSystemResolver(options.connection, base.projectId);
      const draft = createGenerationDraft(
        base,
        {
          actorId: actor,
          role: 'editor',
          agent: true,
          authorizedNodeIds: base.payload.nodes.map((n) => n.id),
        },
        resolver,
      );
      const id = randomUUID();
      let record: DraftGenerationRecord = {
        id,
        actor,
        documentId,
        projectId: current.projectId,
        clientId: input.clientId,
        hash,
        baseRevision: base.revision,
        status: 'running',
        snapshot: base,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      try {
        await collection.insertOne(record);
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
        const existing = await collection.findOne({ actor, documentId, clientId: input.clientId });
        if (!existing || existing.hash !== hash)
          throw new DesignError(409, 'id_reuse', 'Draft request identity reused');
        return publicRecord(existing);
      }
      let reserved = false,
        attempted = false,
        consumed = false;
      const notify = async (value: DraftGenerationRecord) => {
        try {
          await onSnapshot(value);
        } catch {
          /* transport output cannot undo persisted result */
        }
      };
      try {
        if (signal?.aborted) throw new DesignError(422, 'cancelled', 'Cancelled before send');
        await budget.reserve(id, actor);
        reserved = true;
        await budget.claimDispatch(id, actor);
        attempted = true;
        await provider.stream(
          {
            jobId: id,
            principalId: actor,
            projectId: base.projectId,
            documentId,
            capability: 'textProposal',
            payload: {
              prompt: input.prompt,
              scope: base.payload.nodes.map((n) => n.id),
              baseRevision: base.revision,
              nodes: base.payload.nodes,
              width: base.payload.width,
              height: base.payload.height,
              designSystem: {
                ...base.designSystem,
                definition: resolver(base.designSystem.id, base.designSystem.version),
              },
            },
          },
          async (chunk) => {
            if (signal?.aborted) throw new DesignError(422, 'cancelled', 'Draft cancelled');
            const next = draft.append(chunk);
            if (next.accepted === record.snapshot.payload.nodes.length - base.payload.nodes.length)
              return;
            await store.withProjectWrite(actor, base.projectId, async (session) => {
              record = { ...record, snapshot: next.document, updatedAt: new Date() };
              const changed = await collection.updateOne(
                { id, status: 'running' },
                { $set: { snapshot: next.document, updatedAt: record.updatedAt } },
                { session },
              );
              if (changed.matchedCount !== 1)
                throw new DesignError(409, 'draft_terminal', 'Draft is no longer running');
              return true;
            });
            await notify(record);
          },
          signal,
        );
        const final = draft.finish();
        if (final.accepted === 0)
          throw new DesignError(422, 'generation_empty', 'No valid completed blocks');
        record = {
          ...record,
          status: 'succeeded',
          snapshot: final.document,
          updatedAt: new Date(),
        };
        await budget.settle(id, 'consumed');
        consumed = true;
        await store.withProjectWrite(actor, base.projectId, async (session) => {
          const changed = await collection.updateOne(
            { id, status: 'running' },
            {
              $set: {
                status: record.status,
                snapshot: record.snapshot,
                updatedAt: record.updatedAt,
              },
            },
            { session },
          );
          if (changed.matchedCount !== 1)
            throw new DesignError(409, 'draft_terminal', 'Draft is no longer running');
          return true;
        });
        await notify(record);
        return record;
      } catch (error) {
        const state = signal?.aborted ? 'cancelled' : attempted ? 'submission_unknown' : 'failed';
        record = {
          ...record,
          status: state,
          error:
            state === 'cancelled'
              ? 'Cancellation requested; provider charges may apply'
              : 'Generation incomplete; no automatic resubmission',
          updatedAt: new Date(),
        };
        await collection.updateOne(
          { id, status: 'running' },
          { $set: { status: record.status, error: record.error, updatedAt: record.updatedAt } },
        );
        if (reserved && !consumed)
          await budget.settle(id, attempted ? 'uncertain' : 'released').catch(() => {});
        const persisted = await collection.findOne({ id, actor });
        return persisted ? publicRecord(persisted) : record;
      }
    },
    async proposal(actor, id) {
      const r = await load(actor, id);
      if (r.status !== 'succeeded')
        throw new DesignError(422, 'draft_incomplete', 'Draft is not complete');
      const source = await store.getRevisionSnapshot(actor, r.documentId, r.baseRevision);
      const baseIds = new Set(source.payload.nodes.map((n: any) => n.id));
      const nodes = r.snapshot.payload.nodes.filter((n) => !baseIds.has(n.id));
      return store.createProposal(actor, r.documentId, {
        summary: 'Макет по брифу — новые элементы',
        sourceJobId: 'draft-' + id,
        baseRevision: r.baseRevision,
        declaredScope: r.snapshot.payload.nodes.map((n) => n.id),
        operations: nodes.map((node) => ({ type: 'insertNode' as const, node })),
      });
    },
  };
}
