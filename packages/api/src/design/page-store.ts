import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import type { DesignStore } from './store';
import {
  validatePageDocument,
  applyPageOperations,
  type PageDocument,
  type PageOperation,
} from './page-document';
import { canonicalHash } from './operations';
import { DesignError } from './errors';
export interface PageRecord {
  id: string;
  projectId: string;
  revision: number;
  document: PageDocument;
}
export interface PageStore {
  history(actor: string, id: string): Promise<Array<{ revision: number; actor: string }>>;
  restore(
    actor: string,
    id: string,
    input: { operationId: string; expectedRevision: number; revision: number },
  ): Promise<PageRecord>;
  create(actor: string, projectId: string, document: unknown): Promise<PageRecord>;
  list(actor: string, projectId: string): Promise<PageRecord[]>;
  get(actor: string, id: string): Promise<PageRecord>;
  apply(
    actor: string,
    id: string,
    input: {
      operationId: string;
      expectedRevision: number;
      scopeIds: string[];
      operations: PageOperation[];
    },
    session?: ClientSession,
  ): Promise<PageRecord>;
}
/** Separate native page payload; never pretends a canvas is an editable responsive page. */
export async function createPageStore(store: DesignStore): Promise<PageStore> {
  const rows = store.connection.collection<PageRecord>('design_web_pages'),
    history = store.connection.collection('design_web_history'),
    ops = store.connection.collection('design_web_operations');
  await rows.createIndex({ id: 1 }, { unique: true });
  await history.createIndex({ pageId: 1, revision: 1 }, { unique: true });
  await ops.createIndex({ actor: 1, pageId: 1, operationId: 1 }, { unique: true });
  const canRead = async (actor: string, projectId: string) => {
    const projects = await store.listProjects(actor);
    if (!projects.some((p) => p.id === projectId))
      throw new DesignError(404, 'not_found', 'Page not found');
  };
  const view = (raw: any): PageRecord => ({
    id: raw.id,
    projectId: raw.projectId,
    revision: raw.revision,
    document: JSON.parse(JSON.stringify(raw.document)),
  });
  const refs = async (doc: PageDocument, projectId: string, session: any) => {
    for (const ref of doc.assetRefs) {
      if (
        !(await store.connection
          .collection('designassets')
          .findOne({ id: ref.assetId, version: ref.version, projectId }, { session }))
      )
        throw new DesignError(404, 'not_found', 'Page asset not found');
    }
  };
  return {
    async history(actor, id) {
      const row = await rows.findOne({ id });
      if (!row) throw new DesignError(404, 'not_found', 'Page not found');
      await canRead(actor, row.projectId);
      return (await history.find({ pageId: id }).sort({ revision: -1 }).limit(100).toArray()).map(
        (x) => ({ revision: x.revision as number, actor: x.actor as string }),
      );
    },
    async restore(actor, id, input) {
      if (!input || !/^[\w.-]{1,128}$/.test(input.operationId) || !Number.isInteger(input.revision))
        throw new DesignError(422, 'schema', 'Invalid restore request');
      const pre = await rows.findOne({ id });
      if (!pre) throw new DesignError(404, 'not_found', 'Page not found');
      const hash = canonicalHash({ ...input, type: 'restore' });
      return store.withProjectWrite(actor, pre.projectId, async (session) => {
        const row = await rows.findOne({ id }, { session });
        if (!row) throw new DesignError(404, 'not_found', 'Page not found');
        const previous = await ops.findOne(
          { actor, pageId: id, operationId: input.operationId },
          { session },
        );
        if (previous) {
          if (previous.hash !== hash)
            throw new DesignError(409, 'id_reuse', 'Operation identity reused');
          const saved = await history.findOne(
            { pageId: id, revision: previous.revision },
            { session },
          );
          if (!saved) throw new DesignError(503, 'history_missing', 'History missing');
          return {
            id,
            projectId: row.projectId,
            revision: previous.revision as number,
            document: saved.document as PageDocument,
          };
        }
        if (row.revision !== input.expectedRevision)
          throw new DesignError(409, 'revision_mismatch', 'Page changed');
        const saved = await history.findOne({ pageId: id, revision: input.revision }, { session });
        if (!saved) throw new DesignError(404, 'history_missing', 'Revision not found');
        const target = saved.document as PageDocument;
        validatePageDocument(target);
        validatePageDocument(row.document);
        const locked = new Set<string>();
        for (const n of row.document.nodes) {
          let x: typeof n | undefined = n;
          while (x) {
            if (x.locked) {
              locked.add(n.id);
              break;
            }
            x = row.document.nodes.find((t) => t.id === x!.parentId);
          }
        }
        for (const id of locked) {
          if (
            canonicalHash(row.document.nodes.find((n) => n.id === id)) !==
            canonicalHash(target.nodes.find((n) => n.id === id) ?? null)
          )
            throw new DesignError(422, 'lock', 'Locked content would change');
        }
        for (const n of target.nodes) {
          if (row.document.nodes.some((t) => t.id === n.id)) continue;
          let x: typeof n | undefined = n;
          while (x?.parentId) {
            if (locked.has(x.parentId))
              throw new DesignError(422, 'lock', 'Cannot add into locked subtree');
            x = target.nodes.find((t) => t.id === x!.parentId);
          }
        }
        await refs(target, row.projectId, session);
        const revision = row.revision + 1;
        const changed = await rows.updateOne(
          { id, revision: input.expectedRevision },
          { $set: { document: target, revision } },
          { session },
        );
        if (changed.modifiedCount !== 1)
          throw new DesignError(409, 'revision_mismatch', 'Page changed');
        await history.insertOne({ pageId: id, revision, document: target, actor }, { session });
        await ops.insertOne(
          { actor, pageId: id, operationId: input.operationId, hash, revision },
          { session },
        );
        return { id, projectId: row.projectId, revision, document: target };
      });
    },
    async create(actor, projectId, document) {
      validatePageDocument(document);
      const doc = document as PageDocument;
      return store.withProjectWrite(actor, projectId, async (session) => {
        await refs(doc, projectId, session);
        const row: PageRecord = {
          id: randomUUID(),
          projectId,
          revision: 1,
          document: JSON.parse(JSON.stringify(doc)),
        };
        await rows.insertOne(row, { session });
        await history.insertOne(
          { pageId: row.id, revision: 1, document: row.document, actor },
          { session },
        );
        return view(row);
      });
    },
    async list(actor, projectId) {
      await canRead(actor, projectId);
      return (await rows.find({ projectId }).limit(100).toArray()).map(view);
    },
    async get(actor, id) {
      const row = await rows.findOne({ id });
      if (!row) throw new DesignError(404, 'not_found', 'Page not found');
      await canRead(actor, row.projectId);
      return view(row);
    },
    async apply(actor, id, input, externalSession) {
      if (
        !input ||
        typeof input.operationId !== 'string' ||
        !/^[\w.-]{1,128}$/.test(input.operationId)
      )
        throw new DesignError(422, 'schema', 'Operation ID required');
      const pre = await rows.findOne({ id });
      if (!pre) throw new DesignError(404, 'not_found', 'Page not found');
      const hash = canonicalHash(input);
      const work = async (session: ClientSession) => {
        const row = await rows.findOne({ id }, { session });
        if (!row) throw new DesignError(404, 'not_found', 'Page not found');
        const previous = await ops.findOne(
          { actor, pageId: id, operationId: input.operationId },
          { session },
        );
        if (previous) {
          if (previous.hash !== hash)
            throw new DesignError(409, 'id_reuse', 'Operation identity reused');
          const snapshot = await history.findOne(
            { pageId: id, revision: previous.revision },
            { session },
          );
          if (!snapshot) throw new DesignError(503, 'history_missing', 'History missing');
          return {
            id,
            projectId: row.projectId,
            revision: previous.revision as number,
            document: snapshot.document as PageDocument,
          };
        }
        if (row.revision !== input.expectedRevision)
          throw new DesignError(409, 'revision_mismatch', 'Page changed');
        const document = applyPageOperations(row.document, input.operations, {
          actorId: actor,
          role: 'editor',
          agent: false,
          scopeIds: input.scopeIds,
        });
        await refs(document, row.projectId, session);
        const result = await rows.updateOne(
          { id, revision: input.expectedRevision },
          { $set: { document }, $inc: { revision: 1 } },
          { session },
        );
        if (result.modifiedCount !== 1)
          throw new DesignError(409, 'revision_mismatch', 'Page changed');
        const revision = row.revision + 1;
        await history.insertOne({ pageId: id, revision, document, actor }, { session });
        await ops.insertOne(
          { actor, pageId: id, operationId: input.operationId, hash, revision },
          { session },
        );
        return { id, projectId: row.projectId, revision, document };
      };
      return externalSession
        ? work(externalSession)
        : store.withProjectWrite(actor, pre.projectId, work);
    },
  };
}
