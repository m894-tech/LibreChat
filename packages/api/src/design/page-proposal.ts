import { randomUUID } from 'node:crypto';
import type { PageStore } from './page-store';
import type { DesignStore } from './store';
import { applyPageOperations, type PageOperation } from './page-document';
import { DesignError } from './errors';
export interface PageProposal {
  id: string;
  pageId: string;
  projectId: string;
  baseRevision: number;
  scopeIds: string[];
  operations: PageOperation[];
  status: 'pending' | 'applied' | 'rejected';
  author: string;
  summary: string;
}
export interface PageProposalService {
  create(
    actor: string,
    pageId: string,
    input: {
      baseRevision: number;
      scopeIds: string[];
      operations: PageOperation[];
      summary: string;
      sourceJobId?: string;
    },
  ): Promise<PageProposal>;
  list(actor: string, pageId: string): Promise<PageProposal[]>;
  accept(actor: string, id: string): Promise<void>;
  reject(actor: string, id: string): Promise<void>;
}
export async function createPageProposalService(
  store: DesignStore,
  pages: PageStore,
): Promise<PageProposalService> {
  const collection = store.connection.collection<PageProposal>('design_web_proposals');
  await collection.createIndex({ id: 1 }, { unique: true });
  const view = (r: any): PageProposal => {
    const { _id, ...p } = r;
    return p;
  };
  return {
    async create(actor, pageId, input) {
      if (
        !input ||
        typeof input !== 'object' ||
        !Array.isArray(input.scopeIds) ||
        !Array.isArray(input.operations) ||
        !input.scopeIds.length ||
        input.scopeIds.length > 300
      )
        throw new DesignError(422, 'schema', 'Explicit scope and operations required');
      const page = await pages.get(actor, pageId);
      if (page.revision !== input.baseRevision)
        throw new DesignError(409, 'revision_mismatch', 'Page changed');
      if (typeof input.summary !== 'string' || !input.summary.trim() || input.summary.length > 200)
        throw new DesignError(422, 'schema', 'Summary required');
      applyPageOperations(page.document, input.operations, {
        actorId: actor,
        role: 'editor',
        agent: true,
        scopeIds: input.scopeIds,
        authorizedNodeIds: input.scopeIds,
      });
      return store.withProjectWrite(actor, page.projectId, async (session) => {
        const current = await store.connection
          .collection('design_web_pages')
          .findOne({ id: pageId }, { session });
        if (current?.revision !== input.baseRevision)
          throw new DesignError(409, 'revision_mismatch', 'Page changed');
        const proposalId = input.sourceJobId ? 'ai-' + input.sourceJobId : randomUUID();
        if (input.sourceJobId) {
          const existing = await collection.findOne({ id: proposalId }, { session });
          if (existing) {
            if (existing.author !== actor || existing.pageId !== pageId)
              throw new DesignError(404, 'not_found', 'Proposal missing');
            return view(existing);
          }
        }
        const record: PageProposal = {
          id: proposalId,
          pageId,
          projectId: page.projectId,
          baseRevision: page.revision,
          scopeIds: input.scopeIds,
          operations: input.operations,
          status: 'pending',
          author: actor,
          summary: input.summary,
        };
        await collection.insertOne(record, { session });
        return view(record);
      });
    },
    async list(actor, pageId) {
      await pages.get(actor, pageId);
      return (await collection.find({ pageId }).limit(100).toArray()).map(view);
    },
    async accept(actor, id) {
      const p = await collection.findOne({ id });
      if (!p) throw new DesignError(404, 'not_found', 'Proposal missing');
      await pages.get(actor, p.pageId);
      await store.withProjectWrite(actor, p.projectId, async (session) => {
        const current = await collection.findOne({ id }, { session });
        if (!current) throw new DesignError(404, 'not_found', 'Proposal missing');
        if (current.status === 'rejected')
          throw new DesignError(409, 'proposal_rejected', 'Proposal rejected');
        if (current.status === 'applied') return true;
        const page = await store.connection
          .collection('design_web_pages')
          .findOne({ id: p.pageId }, { session });
        if (!page) throw new DesignError(404, 'not_found', 'Page missing');
        if (page.revision !== p.baseRevision)
          throw new DesignError(409, 'revision_mismatch', 'Page changed');
        applyPageOperations(page.document, p.operations, {
          actorId: actor,
          role: 'editor',
          agent: true,
          scopeIds: p.scopeIds,
          authorizedNodeIds: p.scopeIds,
        });
        await pages.apply(
          actor,
          p.pageId,
          {
            operationId: 'proposal-' + p.id,
            expectedRevision: p.baseRevision,
            scopeIds: p.scopeIds,
            operations: p.operations,
          },
          session,
        );
        await collection.updateOne(
          { id, status: 'pending' },
          { $set: { status: 'applied' } },
          { session },
        );
        return true;
      });
    },
    async reject(actor, id) {
      const p = await collection.findOne({ id });
      if (!p) throw new DesignError(404, 'not_found', 'Proposal missing');
      await pages.get(actor, p.pageId);
      await store.withProjectWrite(actor, p.projectId, async (session) => {
        const result = await collection.updateOne(
          { id, status: 'pending' },
          { $set: { status: 'rejected' } },
          { session },
        );
        if (!result.matchedCount)
          throw new DesignError(409, 'proposal_state', 'Proposal no longer pending');
        return true;
      });
    },
  };
}
