import { randomUUID } from 'node:crypto';
import type { DesignGenerationProvider } from './providers';
import type { PageProposalService } from './page-proposal';
import type { PageStore } from './page-store';
import type { DesignStore } from './store';
import { normalizePageAIProposal } from './page-ai-proposal';
import { validatePageDocument } from './page-document';
import { canonicalHash } from './operations';
import { DesignError } from './errors';
export interface PageAIJob {
  id: string;
  actor: string;
  pageId: string;
  projectId: string;
  clientId: string;
  hash: string;
  status: 'running' | 'succeeded' | 'submission_unknown' | 'failed';
  baseRevision: number;
  scopeIds: string[];
  proposalId?: string;
  createdAt: Date;
}
export interface PageAIService {
  generate(
    actor: string,
    pageId: string,
    input: { clientId: string; expectedRevision: number; scopeIds: string[]; prompt: string },
  ): Promise<PageAIJob>;
  list(actor: string, pageId: string): Promise<PageAIJob[]>;
}
/** Persistent intent and immutable server-held scope. Does not apply model output. */
export async function createPageAIService(
  store: DesignStore,
  pages: PageStore,
  proposals: PageProposalService,
  provider: DesignGenerationProvider,
): Promise<PageAIService> {
  const rows = store.connection.collection<PageAIJob>('design_web_ai_jobs');
  await rows.createIndex({ actor: 1, pageId: 1, clientId: 1 }, { unique: true });
  await rows.createIndex({ id: 1 }, { unique: true });
  const view = (r: any): PageAIJob => {
    const { _id, ...value } = r;
    return value;
  };
  return {
    async list(actor, pageId) {
      await pages.get(actor, pageId);
      const list = await rows.find({ actor, pageId }).sort({ createdAt: -1 }).limit(50).toArray();
      return list.map((r) => ({
        ...view(r),
        status:
          r.status === 'running' && Date.now() - new Date(r.createdAt).getTime() > 120000
            ? 'submission_unknown'
            : r.status,
      }));
    },
    async generate(actor, pageId, input) {
      const current = await pages.get(actor, pageId);
      validatePageDocument(current.document);
      await store.withProjectWrite(actor, current.projectId, async () => true);
      if (
        !input ||
        !/^[-\w]{1,100}$/.test(input.clientId) ||
        !Number.isInteger(input.expectedRevision) ||
        typeof input.prompt !== 'string' ||
        !input.prompt.trim() ||
        input.prompt.length > 8000 ||
        !Array.isArray(input.scopeIds) ||
        !input.scopeIds.length ||
        input.scopeIds.length > 50
      )
        throw new DesignError(422, 'page_ai_input', 'Brief and explicit scope required');
      const scope = [...new Set(input.scopeIds)];
      if (
        scope.some(
          (id) => typeof id !== 'string' || !current.document.nodes.some((n) => n.id === id),
        )
      )
        throw new DesignError(422, 'scope', 'Unknown page element');
      for (const id of scope) {
        const visited = new Set<string>();
        let node = current.document.nodes.find((n) => n.id === id);
        while (node) {
          if (visited.has(node.id)) throw new DesignError(422, 'schema', 'Cyclic page graph');
          visited.add(node.id);
          if (node.locked)
            throw new DesignError(422, 'lock', 'Scoped page element or ancestor locked');
          node = current.document.nodes.find((n) => n.id === node!.parentId);
        }
      }
      const hash = canonicalHash(input);
      const previous = await rows.findOne({ actor, pageId, clientId: input.clientId });
      if (previous) {
        if (previous.hash !== hash)
          throw new DesignError(409, 'id_reuse', 'Request identity reused');
        const p = await store.connection
          .collection('design_web_proposals')
          .findOne({ id: 'ai-' + previous.id, pageId, author: actor });
        if (p) {
          await rows.updateOne(
            { id: previous.id, status: { $ne: 'succeeded' } },
            { $set: { status: 'succeeded', proposalId: p.id } },
          );
          return { ...view(previous), status: 'succeeded', proposalId: p.id };
        }
        return {
          ...view(previous),
          status:
            previous.status === 'running' &&
            Date.now() - new Date(previous.createdAt).getTime() > 120000
              ? 'submission_unknown'
              : previous.status,
        };
      }
      if (current.revision !== input.expectedRevision)
        throw new DesignError(409, 'revision_mismatch', 'Page changed');
      if (!provider.capabilities.textProposal)
        throw new DesignError(422, 'page_ai_unavailable', 'Text provider unavailable');
      const record: PageAIJob = {
        id: randomUUID(),
        actor,
        pageId,
        projectId: current.projectId,
        clientId: input.clientId,
        hash,
        status: 'running',
        baseRevision: current.revision,
        scopeIds: scope,
        createdAt: new Date(),
      };
      try {
        await rows.insertOne(record);
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
        const old = await rows.findOne({ actor, pageId, clientId: input.clientId });
        if (!old || old.hash !== hash)
          throw new DesignError(409, 'id_reuse', 'Request identity reused');
        return view(old);
      }
      let outputReceived = false;
      try {
        const result = await provider.submit({
          jobId: record.id,
          principalId: actor,
          documentId: pageId,
          projectId: current.projectId,
          capability: 'textProposal',
          payload: {
            prompt:
              'Registered web page. Only setText/setProperty on existing scoped nodes; no node insert/remove/unlock. ' +
              input.prompt,
            scope,
            nodes: current.document.nodes.filter((n) => scope.includes(n.id)),
            baseRevision: current.revision,
          },
        });
        if (result.kind !== 'immediate' || !result.proposal)
          throw new DesignError(422, 'page_ai_result', 'No immediate structured proposal');
        outputReceived = true;
        const normalized = normalizePageAIProposal(current.document, scope, result.proposal);
        const proposal = await proposals.create(actor, pageId, {
          baseRevision: current.revision,
          scopeIds: scope,
          summary: normalized.summary,
          operations: normalized.operations,
          sourceJobId: record.id,
        });
        await rows.updateOne(
          { id: record.id, status: 'running' },
          { $set: { status: 'succeeded', proposalId: proposal.id } },
        );
        const saved = await rows.findOne({ id: record.id });
        return saved ? view(saved) : { ...record, status: 'succeeded', proposalId: proposal.id };
      } catch {
        const status = outputReceived ? 'failed' : 'submission_unknown';
        await rows.updateOne({ id: record.id, status: 'running' }, { $set: { status } });
        const saved = await rows.findOne({ id: record.id });
        return saved ? view(saved) : { ...record, status };
      }
    },
  };
}
