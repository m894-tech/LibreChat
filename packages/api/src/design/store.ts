import { randomUUID } from 'node:crypto';
import type { ClientSession, Connection, Mongoose, HydratedDocument } from 'mongoose';
import type {
  DesignDocumentRecord,
  DesignExportRecord,
  DesignMemberRole,
  DesignModels,
  DesignOperationRecord,
  DesignProjectRecord,
  DesignProposalRecord,
  DesignRevisionRecord,
} from './models';
import type {
  OperationContext as ApplyOperationsContext,
  DesignDocument as DesignDocumentSnapshot,
  DesignOperation as DesignOp,
} from './types';
import { applyOperations, canonicalHash, validateDocument } from './operations';
import { loadProjectSystemResolver } from './project-systems';
import { createDesignModels } from './models';
import { DesignError } from './errors';

const USER_ID_RE = /^[A-Za-z0-9_:-]{1,128}$/;
const ROLE_SET = new Set<DesignMemberRole>(['owner', 'editor', 'viewer']);
const WRITE_ROLES = new Set<DesignMemberRole>(['owner', 'editor']);

export type DesignConnection = Connection | Mongoose;

export type DesignStoreOptions = {
  assetDir?: string;
};

export type ProjectPatch = {
  name?: string;
  archived?: boolean;
  members?: Record<string, DesignMemberRole | null | undefined>;
  revoke?: string[];
};

export type CreateDocumentInput = {
  assetRefs?: DesignDocumentSnapshot['assetRefs'];
  title: string;
  kind?: string;
  payload?: DesignDocumentSnapshot['payload'];
  designSystem?: DesignDocumentSnapshot['designSystem'];
};

export type OperationEnvelope = {
  operationId: string;
  expectedRevision: number;
  declaredScope: string[];
  operations: DesignOp[];
};

export type RestoreInput = {
  revision: number;
  expectedRevision: number;
  operationId: string;
};

export type ProposalInput = {
  sourceJobId?: string;
  summary: string;
  declaredScope: string[];
  operations: DesignOp[];
  baseRevision: number;
};

export type SerializedProject = {
  id: string;
  name: string;
  ownerId: string;
  members: Record<string, DesignMemberRole>;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
  effectiveRole?: DesignMemberRole;
};

export type SerializedDocument = DesignDocumentSnapshot & {
  createdAt: Date;
  updatedAt: Date;
};

export type SerializedRevision = {
  id: string;
  documentId: string;
  revision: number;
  actorId: string;
  operationId: string | null;
  createdAt: Date;
};

export type SerializedProposal = {
  id: string;
  documentId: string;
  authorId: string;
  summary: string;
  declaredScope: string[];
  authorizedScope: string[];
  operations: DesignOp[];
  baseRevision: number;
  status: DesignProposalRecord['status'];
  createdAt: Date;
  updatedAt: Date;
};

export type ApplyResult = {
  document: SerializedDocument;
  replay: boolean;
  revision: number;
};

export function resolveConnection(connection: DesignConnection): Connection {
  if (connection == null) {
    throw new DesignError('transactions_unavailable', 'Mongo connection is required');
  }
  const candidate = connection as Connection & { connection?: Connection; connections?: unknown };
  if (candidate.connection && Array.isArray(candidate.connections)) {
    return candidate.connection;
  }
  if (typeof candidate.startSession === 'function' && typeof candidate.model === 'function') {
    return candidate as Connection;
  }
  throw new DesignError('transactions_unavailable', 'Mongo connection is required');
}

export function sanitizeUserId(userId: unknown): string {
  if (typeof userId !== 'string' || !USER_ID_RE.test(userId)) {
    throw new DesignError('unauthorized', 'Unauthorized', 401);
  }
  if (userId === '__proto__' || userId === 'prototype' || userId === 'constructor') {
    throw new DesignError('unauthorized', 'Unauthorized', 401);
  }
  if (userId.includes('..') || userId.includes('$')) {
    throw new DesignError('unauthorized', 'Unauthorized', 401);
  }
  return userId;
}

export function membersToObject(
  members: Map<string, DesignMemberRole> | Record<string, DesignMemberRole> | undefined,
): Record<string, DesignMemberRole> {
  const out = Object.create(null) as Record<string, DesignMemberRole>;
  if (members instanceof Map) {
    for (const [key, role] of members.entries()) {
      if (!isSafeMemberKey(key) || !ROLE_SET.has(role)) {
        continue;
      }
      out[key] = role;
    }
    return out;
  }
  if (members != null && typeof members === 'object') {
    for (const key of Object.keys(members)) {
      if (!Object.prototype.hasOwnProperty.call(members, key) || !isSafeMemberKey(key)) {
        continue;
      }
      const role = members[key];
      if (ROLE_SET.has(role)) {
        out[key] = role;
      }
    }
  }
  return out;
}

export function getMemberRole(
  project: {
    ownerId: string;
    members: Map<string, DesignMemberRole> | Record<string, DesignMemberRole>;
  },
  userId: string,
): DesignMemberRole | null {
  if (!isSafeMemberKey(userId)) {
    return null;
  }
  if (project.ownerId === userId) {
    return 'owner';
  }
  if (project.members instanceof Map) {
    const role = project.members.get(userId);
    return ROLE_SET.has(role as DesignMemberRole) ? (role as DesignMemberRole) : null;
  }
  if (project.members != null && typeof project.members === 'object') {
    if (!Object.prototype.hasOwnProperty.call(project.members, userId)) {
      return null;
    }
    const role = (project.members as Record<string, DesignMemberRole>)[userId];
    return ROLE_SET.has(role) ? role : null;
  }
  return null;
}

export function createDesignStore(
  connection: DesignConnection,
  _options: DesignStoreOptions = {},
): {
  models: DesignModels;
  connection: Connection;
  withProjectWrite<T>(
    userId: string,
    projectId: string,
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T>;
  listProjects(userId: string): Promise<SerializedProject[]>;
  createProject(userId: string, name: string): Promise<SerializedProject>;
  updateProject(userId: string, projectId: string, patch: ProjectPatch): Promise<SerializedProject>;
  listDocuments(userId: string, projectId: string): Promise<SerializedDocument[]>;
  createDocument(
    userId: string,
    projectId: string,
    input: CreateDocumentInput,
    session?: ClientSession,
  ): Promise<SerializedDocument>;
  getDocument(userId: string, documentId: string): Promise<SerializedDocument>;
  updateDocument(
    userId: string,
    documentId: string,
    patch: {
      title?: string;
      archived?: boolean;
      expectedRevision?: number;
    },
  ): Promise<SerializedDocument>;
  applyDocumentOperations(
    userId: string,
    documentId: string,
    envelope: OperationEnvelope,
    extras?: {
      agent?: boolean;
      authorizedScope?: string[];
    },
  ): Promise<ApplyResult>;
  listRevisions(userId: string, documentId: string): Promise<SerializedRevision[]>;
  restoreDocument(userId: string, documentId: string, input: RestoreInput): Promise<ApplyResult>;
  listProposals(userId: string, documentId: string): Promise<SerializedProposal[]>;
  createProposal(
    userId: string,
    documentId: string,
    input: ProposalInput,
  ): Promise<SerializedProposal>;
  acceptProposal(
    userId: string,
    proposalId: string,
  ): Promise<
    ApplyResult & {
      proposal: SerializedProposal;
    }
  >;
  rejectProposal(userId: string, proposalId: string): Promise<SerializedProposal>;
  getProposalDocumentId(proposalId: string): Promise<string | null>;
  createSourceExport(
    userId: string,
    documentId: string,
    revision: number,
    filePath: string,
  ): Promise<DesignExportRecord>;
  getRevisionSnapshot(
    userId: string,
    documentId: string,
    revision: number,
  ): Promise<DesignRevisionRecord['snapshot']>;
  getExport(userId: string, exportId: string): Promise<DesignExportRecord>;
} {
  const conn = resolveConnection(connection);
  const models = createDesignModels(conn);
  let transactionSupport: boolean | null = null;

  const ensureTransactions = async (): Promise<void> => {
    if (transactionSupport === true) {
      return;
    }
    transactionSupport = await probeTransactions(conn);
    if (!transactionSupport) {
      throw new DesignError(
        'transactions_unavailable',
        'Mongo replica set transactions are required; refusing unsafe writes',
      );
    }
  };

  const withTransaction = async <T>(work: (session: ClientSession) => Promise<T>): Promise<T> => {
    await ensureTransactions();
    const session = await conn.startSession();
    try {
      let result: T | undefined;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      if (result === undefined) {
        throw new DesignError('validation', 'Transaction produced no result');
      }
      return result;
    } finally {
      await session.endSession();
    }
  };

  const requireProject = async (
    session: ClientSession,
    projectId: string,
    userId: string,
    write: boolean,
  ): Promise<{ project: HydratedDocument<DesignProjectRecord>; role: DesignMemberRole }> => {
    const project = await models.DesignProject.findById(projectId).session(session).exec();
    if (!project) {
      throw new DesignError('not_found', 'Not found');
    }
    const role = getMemberRole(project, userId);
    if (role == null) {
      throw new DesignError('not_found', 'Not found');
    }
    if (write && !WRITE_ROLES.has(role)) {
      throw new DesignError('forbidden', 'Forbidden');
    }
    if (write) {
      await models.DesignProject.updateOne(
        { _id: project._id },
        { $inc: { accessFence: 1 } },
        { session },
      ).exec();
    }
    return { project, role };
  };

  const requireDocument = async (
    session: ClientSession,
    documentId: string,
    userId: string,
    write: boolean,
  ): Promise<{
    project: HydratedDocument<DesignProjectRecord>;
    document: HydratedDocument<DesignDocumentRecord>;
    role: DesignMemberRole;
  }> => {
    const document = await models.DesignDocument.findById(documentId).session(session).exec();
    if (!document) {
      throw new DesignError('not_found', 'Not found');
    }
    const { project, role } = await requireProject(session, document.projectId, userId, write);
    return { project, document, role };
  };

  return {
    models,
    connection: conn,
    async withProjectWrite<T>(
      userId: string,
      projectId: string,
      work: (session: ClientSession) => Promise<T>,
    ): Promise<T> {
      const uid = sanitizeUserId(userId);
      return withTransaction(async (session) => {
        await requireProject(session, projectId, uid, true);
        return work(session);
      });
    },

    async listProjects(userId: string): Promise<SerializedProject[]> {
      const uid = sanitizeUserId(userId);
      const memberPath = `members.${uid}`;
      const projects = await models.DesignProject.find({
        $or: [{ ownerId: uid }, { [memberPath]: { $in: ['owner', 'editor', 'viewer'] } }],
      })
        .sort({ updatedAt: -1 })
        .exec();
      return projects
        .filter((project) => getMemberRole(project, uid) != null)
        .map((p) => ({ ...serializeProject(p), effectiveRole: getMemberRole(p, uid)! }));
    },

    async createProject(userId: string, name: string): Promise<SerializedProject> {
      const uid = sanitizeUserId(userId);
      const trimmed = normalizeName(name);
      return withTransaction(async (session) => {
        const id = randomUUID();
        const members = new Map<string, DesignMemberRole>([[uid, 'owner']]);
        const [created] = await models.DesignProject.create(
          [{ _id: id, name: trimmed, ownerId: uid, members, archived: false }],
          { session },
        );
        return { ...serializeProject(created), effectiveRole: getMemberRole(created, uid)! };
      });
    },

    async updateProject(
      userId: string,
      projectId: string,
      patch: ProjectPatch,
    ): Promise<SerializedProject> {
      const uid = sanitizeUserId(userId);
      return withTransaction(async (session) => {
        const { project, role } = await requireProject(session, projectId, uid, true);
        if (role !== 'owner') {
          throw new DesignError('forbidden', 'Forbidden');
        }
        if (patch.name != null) {
          project.name = normalizeName(patch.name);
        }
        if (patch.archived != null) {
          if (typeof patch.archived !== 'boolean') {
            throw new DesignError('validation', 'archived must be boolean');
          }
          project.archived = patch.archived;
        }
        applyMemberPatch(project, patch, uid);
        const updated = await models.DesignProject.findOneAndUpdate(
          { _id: project._id },
          { $set: { name: project.name, archived: project.archived, members: project.members } },
          { session, new: true },
        ).exec();
        if (!updated) throw new DesignError(404, 'not_found', 'Not found');
        return { ...serializeProject(updated), effectiveRole: getMemberRole(updated, uid)! };
      });
    },

    async listDocuments(userId: string, projectId: string): Promise<SerializedDocument[]> {
      const uid = sanitizeUserId(userId);
      return withTransaction(async (session) => {
        await requireProject(session, projectId, uid, false);
        const documents = await models.DesignDocument.find({ projectId })
          .session(session)
          .sort({ updatedAt: -1 })
          .exec();
        return documents.map(serializeDocument);
      });
    },

    async createDocument(
      userId: string,
      projectId: string,
      input: CreateDocumentInput,
      externalSession?: ClientSession,
    ): Promise<SerializedDocument> {
      const uid = sanitizeUserId(userId);
      const work = async (session: ClientSession) => {
        await requireProject(session, projectId, uid, true);
        const snapshot = buildNewDocument(projectId, input);
        const resolver = await loadProjectSystemResolver(conn, projectId, session);
        validateDocument(snapshot, resolver);
        await validateAssetBindings(models, session, snapshot);
        const [created] = await models.DesignDocument.create(
          [
            {
              _id: snapshot.id,
              projectId: snapshot.projectId,
              kind: snapshot.kind,
              schemaVersion: snapshot.schemaVersion,
              title: snapshot.title,
              revision: snapshot.revision,
              designSystem: snapshot.designSystem,
              payload: snapshot.payload,
              assetRefs: snapshot.assetRefs,
              archived: snapshot.archived,
            },
          ],
          { session },
        );
        await insertRevision(models, session, {
          documentId: created._id,
          projectId,
          revision: created.revision,
          actorId: uid,
          operationId: null,
          snapshot: toRevisionSnapshot(created),
        });
        return serializeDocument(created);
      };
      return externalSession ? work(externalSession) : withTransaction(work);
    },

    async getDocument(userId: string, documentId: string): Promise<SerializedDocument> {
      const uid = sanitizeUserId(userId);
      return withTransaction(async (session) => {
        const { document } = await requireDocument(session, documentId, uid, false);
        return serializeDocument(document);
      });
    },

    async updateDocument(
      userId: string,
      documentId: string,
      patch: { title?: string; archived?: boolean; expectedRevision?: number },
    ): Promise<SerializedDocument> {
      const uid = sanitizeUserId(userId);
      return withTransaction(async (session) => {
        const { document, role } = await requireDocument(session, documentId, uid, true);
        if (patch.expectedRevision !== document.revision)
          throw new DesignError(409, 'revision_mismatch', 'expectedRevision required');
        if (patch.title != null) {
          document.title = normalizeName(patch.title);
        }
        if (patch.archived != null) {
          if (typeof patch.archived !== 'boolean') {
            throw new DesignError('validation', 'archived must be boolean');
          }
          document.archived = patch.archived;
        }
        const updated = await models.DesignDocument.findOneAndUpdate(
          { _id: documentId, revision: patch.expectedRevision },
          { $set: { title: document.title, archived: document.archived }, $inc: { revision: 1 } },
          { session, new: true },
        ).exec();
        if (!updated) throw new DesignError(409, 'revision_mismatch', 'Revision mismatch');
        await insertRevision(models, session, {
          documentId,
          projectId: updated.projectId,
          revision: updated.revision,
          actorId: uid,
          operationId: null,
          snapshot: toRevisionSnapshot(updated),
        });
        return serializeDocument(updated);
      });
    },

    async applyDocumentOperations(
      userId: string,
      documentId: string,
      envelope: OperationEnvelope,
      extras?: { agent?: boolean; authorizedScope?: string[] },
    ): Promise<ApplyResult> {
      const uid = sanitizeUserId(userId);
      const body = normalizeEnvelope(envelope);
      const bodyHash = canonicalHash({
        actorId: uid,
        operationId: body.operationId,
        expectedRevision: body.expectedRevision,
        declaredScope: body.declaredScope,
        operations: body.operations,
      });
      return withTransaction(async (session) => {
        const { document, role } = await requireDocument(session, documentId, uid, true);
        const existing = await models.DesignOperation.findOne({
          documentId,
          operationId: body.operationId,
          actorId: uid,
        })
          .session(session)
          .exec();
        if (existing) {
          if (existing.bodyHash !== bodyHash) {
            throw new DesignError(
              'idempotency_key_reuse',
              'Idempotency key reused with a different body',
            );
          }
          return {
            document: await replaySnapshot(models, session, document, existing.revisionAfter),
            replay: true,
            revision: existing.revisionAfter,
          };
        }
        if (document.revision !== body.expectedRevision) {
          throw new DesignError('revision_mismatch', 'Revision mismatch', 409);
        }
        const snapshot = toSnapshot(document);
        const authorizedScope =
          extras?.authorizedScope ?? snapshot.payload.nodes.map((node) => node.id);
        const context: ApplyOperationsContext = {
          actorId: uid,
          agent: Boolean(extras?.agent),
          role,
          authorizedNodeIds: authorizedScope,
        };
        const resolver = await loadProjectSystemResolver(conn, document.projectId, session);
        const next = applyOperations(snapshot, body, context, resolver);
        next.revision = document.revision + 1;
        validateDocument(next, resolver);
        await validateAssetBindings(models, session, next);
        const cas = await models.DesignDocument.findOneAndUpdate(
          { _id: documentId, revision: body.expectedRevision },
          {
            $set: {
              title: next.title,
              payload: next.payload,
              designSystem: next.designSystem,
              assetRefs: next.assetRefs,
              revision: next.revision,
              schemaVersion: next.schemaVersion,
              kind: next.kind,
            },
          },
          { session, new: true },
        ).exec();
        if (!cas) {
          throw new DesignError('revision_mismatch', 'Revision mismatch');
        }
        await insertRevision(models, session, {
          documentId,
          projectId: document.projectId,
          revision: next.revision,
          actorId: uid,
          operationId: body.operationId,
          snapshot: toRevisionSnapshot(cas),
        });
        try {
          await models.DesignOperation.create(
            [
              {
                _id: randomUUID(),
                documentId,
                projectId: document.projectId,
                operationId: body.operationId,
                actorId: uid,
                bodyHash,
                revisionAfter: next.revision,
                declaredScope: body.declaredScope,
                operations: body.operations,
              },
            ],
            { session },
          );
        } catch (error) {
          if (isDuplicateKey(error)) {
            const raced = await models.DesignOperation.findOne({
              documentId,
              operationId: body.operationId,
              actorId: uid,
            })
              .session(session)
              .exec();
            if (raced && raced.bodyHash === bodyHash) {
              const current = await models.DesignDocument.findById(documentId)
                .session(session)
                .exec();
              if (!current) {
                throw new DesignError('not_found', 'Not found');
              }
              return {
                document: await replaySnapshot(models, session, current, raced.revisionAfter),
                replay: true,
                revision: raced.revisionAfter,
              };
            }
            throw new DesignError(
              'idempotency_key_reuse',
              'Idempotency key reused with a different body',
            );
          }
          throw error;
        }
        return { document: serializeDocument(cas), replay: false, revision: cas.revision };
      });
    },

    async listRevisions(userId: string, documentId: string): Promise<SerializedRevision[]> {
      const uid = sanitizeUserId(userId);
      return withTransaction(async (session) => {
        await requireDocument(session, documentId, uid, false);
        const revisions = await models.DesignRevision.find({ documentId })
          .session(session)
          .sort({ revision: -1 })
          .exec();
        return revisions.map(serializeRevision);
      });
    },

    async restoreDocument(
      userId: string,
      documentId: string,
      input: RestoreInput,
    ): Promise<ApplyResult> {
      const uid = sanitizeUserId(userId);
      if (!input || typeof input.operationId !== 'string' || input.operationId.length === 0) {
        throw new DesignError('validation', 'operationId is required');
      }
      if (!Number.isInteger(input.revision) || input.revision < 1) {
        throw new DesignError('validation', 'revision is required');
      }
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
        throw new DesignError('validation', 'expectedRevision is required');
      }
      const bodyHash = canonicalHash({
        actorId: uid,
        operationId: input.operationId,
        revision: input.revision,
        expectedRevision: input.expectedRevision,
        type: 'restore',
      });
      return withTransaction(async (session) => {
        const { document, role } = await requireDocument(session, documentId, uid, true);
        const existing = await models.DesignOperation.findOne({
          documentId,
          operationId: input.operationId,
          actorId: uid,
        })
          .session(session)
          .exec();
        if (existing) {
          if (existing.bodyHash !== bodyHash) {
            throw new DesignError(
              'idempotency_key_reuse',
              'Idempotency key reused with a different body',
            );
          }
          return {
            document: await replaySnapshot(models, session, document, existing.revisionAfter),
            replay: true,
            revision: existing.revisionAfter,
          };
        }
        if (document.revision !== input.expectedRevision) {
          throw new DesignError('revision_mismatch', 'Revision mismatch');
        }
        const source = await models.DesignRevision.findOne({ documentId, revision: input.revision })
          .session(session)
          .exec();
        if (!source) {
          throw new DesignError('validation', 'Revision not found');
        }
        const head = toSnapshot(document);
        const previousNodes = JSON.parse(JSON.stringify(source.snapshot.payload.nodes));
        for (const node of head.payload.nodes) {
          let current: typeof node | undefined = node;
          let locked = false;
          const seen = new Set<string>();
          while (current && !seen.has(current.id)) {
            seen.add(current.id);
            locked ||= current.locked;
            current = current.parentId
              ? head.payload.nodes.find((n) => n.id === current!.parentId)
              : undefined;
          }
          if (
            locked &&
            canonicalHash(node) !==
              canonicalHash(previousNodes.find((n: any) => n.id === node.id) ?? null)
          )
            throw new DesignError(
              422,
              'lock',
              'Unlock protected elements before restoring this revision',
            );
        }
        const headIds = new Set(head.payload.nodes.map((n) => n.id));
        const headMap = new Map(head.payload.nodes.map((n) => [n.id, n]));
        const restoredMap = new Map(
          previousNodes.map((n: DesignDocumentSnapshot['payload']['nodes'][number]) => [n.id, n]),
        );
        for (const node of previousNodes) {
          if (headIds.has(node.id)) continue;
          let parent = node.parentId;
          const visited = new Set<string>();
          while (parent && !visited.has(parent)) {
            visited.add(parent);
            if (headMap.get(parent)?.locked)
              throw new DesignError(
                422,
                'lock',
                'Cannot restore new children under a locked group',
              );
            parent = (restoredMap.get(parent) as typeof node | undefined)?.parentId;
          }
        }
        const nextRevision = document.revision + 1;
        const cas = await models.DesignDocument.findOneAndUpdate(
          { _id: documentId, revision: input.expectedRevision },
          {
            $set: {
              title: source.snapshot.title,
              payload: source.snapshot.payload,
              designSystem: source.snapshot.designSystem,
              assetRefs: source.snapshot.assetRefs,
              schemaVersion: source.snapshot.schemaVersion,
              kind: source.snapshot.kind,
              revision: nextRevision,
            },
          },
          { session, new: true },
        ).exec();
        if (!cas) {
          throw new DesignError('revision_mismatch', 'Revision mismatch');
        }
        const resolver = await loadProjectSystemResolver(conn, document.projectId, session);
        validateDocument(toSnapshot(cas), resolver);
        await validateAssetBindings(models, session, toSnapshot(cas));
        await insertRevision(models, session, {
          documentId,
          projectId: document.projectId,
          revision: nextRevision,
          actorId: uid,
          operationId: input.operationId,
          snapshot: toRevisionSnapshot(cas),
        });
        await models.DesignOperation.create(
          [
            {
              _id: randomUUID(),
              documentId,
              projectId: document.projectId,
              operationId: input.operationId,
              actorId: uid,
              bodyHash,
              revisionAfter: nextRevision,
              declaredScope: [],
              operations: [{ type: 'restore', value: input.revision }],
            },
          ],
          { session },
        );
        return { document: serializeDocument(cas), replay: false, revision: cas.revision };
      });
    },

    async listProposals(userId: string, documentId: string): Promise<SerializedProposal[]> {
      const uid = sanitizeUserId(userId);
      return withTransaction(async (session) => {
        await requireDocument(session, documentId, uid, false);
        const proposals = await models.DesignProposal.find({ documentId })
          .session(session)
          .sort({ createdAt: -1 })
          .exec();
        return proposals.map(serializeProposal);
      });
    },

    async createProposal(
      userId: string,
      documentId: string,
      input: ProposalInput,
    ): Promise<SerializedProposal> {
      const uid = sanitizeUserId(userId);
      if (!input || typeof input.summary !== 'string' || input.summary.trim().length === 0) {
        throw new DesignError('validation', 'summary is required');
      }
      if (!Array.isArray(input.declaredScope) || !Array.isArray(input.operations)) {
        throw new DesignError('validation', 'declaredScope and operations are required');
      }
      if (!Number.isInteger(input.baseRevision) || input.baseRevision < 1) {
        throw new DesignError('validation', 'baseRevision is required');
      }
      return withTransaction(async (session) => {
        const { document, role } = await requireDocument(session, documentId, uid, true);
        const proposalId = input.sourceJobId ? `job-${input.sourceJobId}` : randomUUID();
        if (input.sourceJobId) {
          const existing = await models.DesignProposal.findById(proposalId).session(session).exec();
          if (existing) {
            if (existing.documentId !== documentId || existing.authorId !== uid)
              throw new DesignError(404, 'not_found', 'Proposal not found');
            return serializeProposal(existing);
          }
        }
        const nodeIds = new Set(toSnapshot(document).payload.nodes.map((node) => node.id));
        for (const op of input.operations) {
          if (op?.type === 'insertNode' && op.node?.id) {
            nodeIds.add(op.node.id);
          }
        }
        const declaredScope = uniqueSafeIds(input.declaredScope);
        for (const id of declaredScope) {
          if (!nodeIds.has(id)) {
            throw new DesignError('scope', 'declaredScope includes unknown nodes');
          }
        }
        if (document.revision !== input.baseRevision)
          throw new DesignError(409, 'revision_mismatch', 'Proposal base revision mismatch');
        const resolver = await loadProjectSystemResolver(conn, document.projectId, session);
        const candidate = applyOperations(
          toSnapshot(document),
          {
            operationId: 'validate-proposal',
            expectedRevision: input.baseRevision,
            declaredScope,
            operations: input.operations,
          },
          { actorId: uid, role, agent: true, authorizedNodeIds: declaredScope },
          resolver,
        );
        await validateAssetBindings(models, session, candidate);
        const [created] = await models.DesignProposal.create(
          [
            {
              _id: proposalId,
              documentId,
              projectId: document.projectId,
              authorId: uid,
              summary: input.summary.trim(),
              declaredScope,
              authorizedScope: [...declaredScope],
              operations: input.operations,
              baseRevision: input.baseRevision,
              status: 'pending',
            },
          ],
          { session },
        );
        return serializeProposal(created);
      });
    },

    async acceptProposal(
      userId: string,
      proposalId: string,
    ): Promise<ApplyResult & { proposal: SerializedProposal }> {
      const uid = sanitizeUserId(userId);
      const result = await withTransaction(async (session) => {
        const proposal = await models.DesignProposal.findById(proposalId).session(session).exec();
        if (!proposal) {
          throw new DesignError('not_found', 'Not found');
        }
        const { document } = await requireDocument(session, proposal.documentId, uid, true);
        if (proposal.status === 'rejected') {
          throw new DesignError('validation', 'Proposal is rejected');
        }
        if (proposal.status === 'stale') {
          throw new DesignError('stale_proposal', 'Proposal is stale');
        }
        if (proposal.status !== 'applied' && document.revision !== proposal.baseRevision) {
          proposal.status = 'stale';
          await proposal.save({ session });
          return { stale: true as const };
        }
        if (proposal.status === 'applied') {
          const appliedOp = await models.DesignOperation.findOne({
            documentId: document._id,
            operationId: `accept-${proposal._id}`,
          })
            .session(session)
            .lean();
          if (!appliedOp)
            throw new DesignError(503, 'history_missing', 'Accepted proposal result unavailable');
          return {
            document: await replaySnapshot(models, session, document, appliedOp.revisionAfter),
            revision: appliedOp.revisionAfter,
            replay: true,
            proposal: serializeProposal(proposal),
          };
        }
        const envelope: OperationEnvelope = {
          operationId: `accept-${proposal._id}`,
          expectedRevision: proposal.baseRevision,
          declaredScope: proposal.declaredScope,
          operations: proposal.operations as DesignOp[],
        };
        const applied = await applyInsideSession(models, session, {
          userId: uid,
          document,
          envelope,
          extras: { agent: true, authorizedScope: proposal.authorizedScope },
        });
        proposal.status = 'applied';
        await proposal.save({ session });
        return { ...applied, proposal: serializeProposal(proposal) };
      });
      if ('stale' in result) throw new DesignError(409, 'stale_proposal', 'Proposal is stale');
      return result;
    },

    async rejectProposal(userId: string, proposalId: string): Promise<SerializedProposal> {
      const uid = sanitizeUserId(userId);
      return withTransaction(async (session) => {
        const proposal = await models.DesignProposal.findById(proposalId).session(session).exec();
        if (!proposal) {
          throw new DesignError('not_found', 'Not found');
        }
        await requireDocument(session, proposal.documentId, uid, true);
        if (proposal.status === 'applied') {
          throw new DesignError('validation', 'Proposal already applied');
        }
        proposal.status = 'rejected';
        await proposal.save({ session });
        return serializeProposal(proposal);
      });
    },

    async getProposalDocumentId(proposalId: string): Promise<string | null> {
      const proposal = await models.DesignProposal.findById(proposalId).exec();
      return proposal?.documentId ?? null;
    },

    async createSourceExport(
      userId: string,
      documentId: string,
      revision: number,
      filePath: string,
    ): Promise<DesignExportRecord> {
      const uid = sanitizeUserId(userId);
      return withTransaction(async (session) => {
        const { document } = await requireDocument(session, documentId, uid, false);
        const source = await models.DesignRevision.findOne({ documentId, revision })
          .session(session)
          .exec();
        if (!source) {
          throw new DesignError('validation', 'Revision not found');
        }
        void document;
        const [created] = await models.DesignExport.create(
          [
            {
              _id: randomUUID(),
              documentId,
              projectId: source.projectId,
              actorId: uid,
              revision,
              format: 'source',
              path: filePath,
            },
          ],
          { session },
        );
        return created;
      });
    },

    async getRevisionSnapshot(
      userId: string,
      documentId: string,
      revision: number,
    ): Promise<DesignRevisionRecord['snapshot']> {
      const uid = sanitizeUserId(userId);
      return withTransaction(async (session) => {
        await requireDocument(session, documentId, uid, false);
        const source = await models.DesignRevision.findOne({ documentId, revision })
          .session(session)
          .exec();
        if (!source) {
          throw new DesignError('validation', 'Revision not found');
        }
        return source.snapshot;
      });
    },

    async getExport(userId: string, exportId: string): Promise<DesignExportRecord> {
      const uid = sanitizeUserId(userId);
      return withTransaction(async (session) => {
        const record = await models.DesignExport.findById(exportId).session(session).exec();
        if (!record) {
          throw new DesignError('not_found', 'Not found');
        }
        await requireDocument(session, record.documentId, uid, false);
        return record;
      });
    },
  };
}

export type DesignStore = ReturnType<typeof createDesignStore>;

async function applyInsideSession(
  models: DesignModels,
  session: ClientSession,
  args: {
    userId: string;
    document: HydratedDocument<DesignDocumentRecord>;
    envelope: OperationEnvelope;
    extras: { agent?: boolean; authorizedScope?: string[] };
  },
): Promise<ApplyResult> {
  const body = normalizeEnvelope(args.envelope);
  const bodyHash = canonicalHash({
    actorId: args.userId,
    operationId: body.operationId,
    expectedRevision: body.expectedRevision,
    declaredScope: body.declaredScope,
    operations: body.operations,
  });
  const existing = await models.DesignOperation.findOne({
    documentId: args.document._id,
    operationId: body.operationId,
    actorId: args.userId,
  })
    .session(session)
    .exec();
  if (existing) {
    if (existing.bodyHash !== bodyHash) {
      throw new DesignError(
        'idempotency_key_reuse',
        'Idempotency key reused with a different body',
      );
    }
    const current = await models.DesignDocument.findById(args.document._id).session(session).exec();
    if (!current) {
      throw new DesignError('not_found', 'Not found');
    }
    return {
      document: await replaySnapshot(models, session, current, existing.revisionAfter),
      replay: true,
      revision: existing.revisionAfter,
    };
  }
  if (args.document.revision !== body.expectedRevision) {
    throw new DesignError('revision_mismatch', 'Revision mismatch');
  }
  const snapshot = toSnapshot(args.document);
  const resolver = await loadProjectSystemResolver(
    models.DesignDocument.db,
    args.document.projectId,
    session,
  );
  const next = applyOperations(
    snapshot,
    body,
    {
      actorId: args.userId,
      agent: Boolean(args.extras.agent),
      role: 'editor',
      authorizedNodeIds:
        args.extras.authorizedScope ?? snapshot.payload.nodes.map((node) => node.id),
    },
    resolver,
  );
  next.revision = args.document.revision + 1;
  validateDocument(next, resolver);
  await validateAssetBindings(models, session, next);
  const cas = await models.DesignDocument.findOneAndUpdate(
    { _id: args.document._id, revision: body.expectedRevision },
    {
      $set: {
        title: next.title,
        payload: next.payload,
        designSystem: next.designSystem,
        assetRefs: next.assetRefs,
        revision: next.revision,
        schemaVersion: next.schemaVersion,
        kind: next.kind,
      },
    },
    { session, new: true },
  ).exec();
  if (!cas) {
    throw new DesignError('revision_mismatch', 'Revision mismatch');
  }
  await insertRevision(models, session, {
    documentId: args.document._id,
    projectId: args.document.projectId,
    revision: next.revision,
    actorId: args.userId,
    operationId: body.operationId,
    snapshot: toRevisionSnapshot(cas),
  });
  await models.DesignOperation.create(
    [
      {
        _id: randomUUID(),
        documentId: args.document._id,
        projectId: args.document.projectId,
        operationId: body.operationId,
        actorId: args.userId,
        bodyHash,
        revisionAfter: next.revision,
        declaredScope: body.declaredScope,
        operations: body.operations,
      },
    ],
    { session },
  );
  return { document: serializeDocument(cas), replay: false, revision: cas.revision };
}

async function probeTransactions(connection: Connection): Promise<boolean> {
  try {
    const session = await connection.startSession();
    try {
      session.startTransaction();
      await connection.db?.collection('__design_tx_probe__').findOne({}, { session });
      await session.commitTransaction();
      return true;
    } catch {
      try {
        await session.abortTransaction();
      } catch {
        /* ignore */
      }
      return false;
    } finally {
      await session.endSession();
    }
  } catch {
    return false;
  }
}

async function replaySnapshot(
  models: DesignModels,
  session: ClientSession,
  current: DesignDocumentRecord,
  revision: number,
): Promise<SerializedDocument> {
  const historical = await models.DesignRevision.findOne({ documentId: current._id, revision })
    .session(session)
    .lean();
  if (!historical)
    throw new DesignError(503, 'history_missing', 'Original operation result unavailable');
  return {
    ...serializeDocument(current),
    ...JSON.parse(JSON.stringify(historical.snapshot)),
    revision,
    archived: Boolean(historical.snapshot.archived),
  };
}

async function validateAssetBindings(
  models: DesignModels,
  session: ClientSession,
  snapshot: DesignDocumentSnapshot,
): Promise<void> {
  const refs = [
    ...snapshot.assetRefs,
    ...snapshot.payload.nodes
      .filter((n) => n.type === 'image')
      .map((n) => ({ assetId: n.props.assetId, version: n.props.assetVersion })),
  ];
  for (const ref of refs) {
    if (!ref.assetId || !Number.isInteger(ref.version))
      throw new DesignError(422, 'schema', 'Invalid asset reference');
    const asset = await models.DesignDocument.db
      .collection('designassets')
      .findOne(
        { id: ref.assetId, version: ref.version, projectId: snapshot.projectId },
        { session },
      );
    if (!asset) throw new DesignError(404, 'not_found', 'Asset not found');
  }
}

async function insertRevision(
  models: DesignModels,
  session: ClientSession,
  record: Omit<DesignRevisionRecord, 'createdAt' | '_id'> & { createdAt?: Date },
): Promise<void> {
  await models.DesignRevision.create(
    [
      {
        _id: randomUUID(),
        documentId: record.documentId,
        projectId: record.projectId,
        revision: record.revision,
        actorId: record.actorId,
        operationId: record.operationId,
        snapshot: record.snapshot,
      },
    ],
    { session },
  );
}

function applyMemberPatch(
  project: DesignProjectRecord,
  patch: ProjectPatch,
  ownerId: string,
): void {
  const members =
    project.members instanceof Map
      ? project.members
      : new Map(Object.entries(membersToObject(project.members)));
  if (patch.members) {
    if (typeof patch.members !== 'object' || Array.isArray(patch.members)) {
      throw new DesignError('validation', 'members must be an object');
    }
    for (const rawKey of Object.keys(patch.members)) {
      if (!Object.prototype.hasOwnProperty.call(patch.members, rawKey)) {
        continue;
      }
      if (!isSafeMemberKey(rawKey) || !USER_ID_RE.test(rawKey)) {
        throw new DesignError('validation', 'Invalid member id');
      }
      const value = patch.members[rawKey];
      if (value == null) {
        if (rawKey === ownerId) {
          throw new DesignError('validation', 'Owner cannot be removed');
        }
        members.delete(rawKey);
        continue;
      }
      if (!ROLE_SET.has(value)) {
        throw new DesignError('validation', 'Invalid member role');
      }
      if (rawKey === ownerId && value !== 'owner') {
        throw new DesignError('validation', 'Owner role cannot be changed');
      }
      members.set(rawKey, value);
    }
  }
  if (patch.revoke) {
    if (!Array.isArray(patch.revoke)) {
      throw new DesignError('validation', 'revoke must be an array');
    }
    for (const rawKey of patch.revoke) {
      if (rawKey === ownerId) {
        throw new DesignError('validation', 'Owner cannot be removed');
      }
      if (typeof rawKey === 'string' && isSafeMemberKey(rawKey)) {
        members.delete(rawKey);
      }
    }
  }
  members.set(ownerId, 'owner');
  project.members = members;
  project.ownerId = ownerId;
}

function buildNewDocument(projectId: string, input: CreateDocumentInput): DesignDocumentSnapshot {
  const title = normalizeName(input.title);
  const kind = input.kind ?? 'canvas';
  if (kind !== 'canvas') {
    throw new DesignError('validation', 'Only canvas documents are supported');
  }
  const payload = input.payload ?? { width: 1080, height: 1080, nodes: [] };
  const designSystem = input.designSystem ?? { id: 'neutral-business', version: '1.0.0' };
  return {
    id: randomUUID(),
    projectId,
    kind: 'canvas',
    schemaVersion: 1,
    title,
    revision: 1,
    designSystem,
    payload,
    assetRefs:
      input.assetRefs ??
      payload.nodes
        .filter((n) => n.type === 'image')
        .map((n) => ({ assetId: n.props.assetId!, version: n.props.assetVersion! })),
    archived: false,
  };
}

function normalizeEnvelope(envelope: OperationEnvelope): OperationEnvelope {
  if (envelope == null || typeof envelope !== 'object') {
    throw new DesignError('validation', 'Operation envelope is required');
  }
  if (typeof envelope.operationId !== 'string' || envelope.operationId.length === 0) {
    throw new DesignError('validation', 'operationId is required');
  }
  if (!Number.isInteger(envelope.expectedRevision) || envelope.expectedRevision < 1) {
    throw new DesignError('validation', 'expectedRevision is required');
  }
  if (!Array.isArray(envelope.declaredScope) || !Array.isArray(envelope.operations)) {
    throw new DesignError('validation', 'declaredScope and operations are required');
  }
  return {
    operationId: envelope.operationId,
    expectedRevision: envelope.expectedRevision,
    declaredScope: uniqueSafeIds(envelope.declaredScope),
    operations: envelope.operations,
  };
}

function uniqueSafeIds(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (
      typeof value !== 'string' ||
      seen.has(value) ||
      value === '__proto__' ||
      value === 'constructor'
    ) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizeName(name: unknown): string {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new DesignError('validation', 'Name is required');
  }
  return name.trim();
}

function isSafeMemberKey(key: string): boolean {
  return (
    typeof key === 'string' &&
    key.length > 0 &&
    key !== '__proto__' &&
    key !== 'prototype' &&
    key !== 'constructor' &&
    !key.includes('$') &&
    USER_ID_RE.test(key)
  );
}

function serializeProject(project: DesignProjectRecord): SerializedProject {
  const members = membersToObject(project.members);
  members[project.ownerId] = 'owner';
  return {
    id: project._id,
    name: project.name,
    ownerId: project.ownerId,
    members,
    archived: Boolean(project.archived),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function serializeDocument(document: DesignDocumentRecord): SerializedDocument {
  return {
    id: document._id,
    projectId: document.projectId,
    kind: document.kind,
    schemaVersion: 1,
    title: document.title,
    revision: document.revision,
    designSystem: JSON.parse(JSON.stringify(document.designSystem)),
    payload: document.payload as SerializedDocument['payload'],
    assetRefs: JSON.parse(JSON.stringify(document.assetRefs ?? [])),
    archived: Boolean(document.archived),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function serializeRevision(revision: DesignRevisionRecord): SerializedRevision {
  return {
    id: revision._id,
    documentId: revision.documentId,
    revision: revision.revision,
    actorId: revision.actorId,
    operationId: revision.operationId,
    createdAt: revision.createdAt,
  };
}

function serializeProposal(proposal: DesignProposalRecord): SerializedProposal {
  return {
    id: proposal._id,
    documentId: proposal.documentId,
    authorId: proposal.authorId,
    summary: proposal.summary,
    declaredScope: proposal.declaredScope,
    authorizedScope: proposal.authorizedScope,
    operations: proposal.operations as DesignOp[],
    baseRevision: proposal.baseRevision,
    status: proposal.status,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  };
}

function toSnapshot(document: DesignDocumentRecord): DesignDocumentSnapshot {
  return {
    id: document._id,
    projectId: document.projectId,
    kind: document.kind,
    schemaVersion: 1,
    title: document.title,
    revision: document.revision,
    designSystem: JSON.parse(JSON.stringify(document.designSystem)),
    payload: JSON.parse(JSON.stringify(document.payload)) as DesignDocumentSnapshot['payload'],
    assetRefs: JSON.parse(JSON.stringify(document.assetRefs ?? [])),
    archived: Boolean(document.archived),
  };
}

function toRevisionSnapshot(document: DesignDocumentRecord): DesignRevisionRecord['snapshot'] {
  return {
    archived: Boolean(document.archived),
    title: document.title,
    kind: document.kind,
    schemaVersion: 1,
    designSystem: JSON.parse(JSON.stringify(document.designSystem)),
    payload: document.payload,
    assetRefs: JSON.parse(JSON.stringify(document.assetRefs ?? [])),
  };
}

function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: number }).code === 11000);
}
