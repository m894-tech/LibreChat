import { randomUUID } from 'node:crypto';
import type { ClientSession, Connection } from 'mongoose';
import type { DesignStore } from './store';
import { getMemberRole, sanitizeUserId } from './store';
import { DesignError } from './errors';

const MAX_COMMENT_TEXT = 2000;
const MAX_COMMENTS = 200;
const COMMENTS_COLLECTION = 'design_review_comments';
const APPROVALS_COLLECTION = 'design_approvals';

export type DesignReviewComment = {
  id: string;
  documentId: string;
  projectId: string;
  revision: number;
  nodeId: string | null;
  text: string;
  actorId: string;
  createdAt: Date;
};

export type DesignApproval = {
  id: string;
  documentId: string;
  projectId: string;
  revision: number;
  actorId: string;
  createdAt: Date;
};

export type DesignApprovalStatus = {
  documentId: string;
  headRevision: number;
  isCurrentApproved: boolean;
  approvals: DesignApproval[];
};

export type CommentInput = {
  revision: number;
  nodeId?: string;
  text: string;
};

export type ApproveInput = {
  revision: number;
};

export type ApprovalService = {
  comment(actor: string, docId: string, input: CommentInput): Promise<DesignReviewComment>;
  comments(actor: string, docId: string): Promise<DesignReviewComment[]>;
  approve(actor: string, docId: string, input: ApproveInput): Promise<DesignApproval>;
  status(actor: string, docId: string): Promise<DesignApprovalStatus>;
};

export type ApprovalStore = DesignStore & {
  withProjectWrite<T>(
    userId: string,
    projectId: string,
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T>;
};

export type CreateApprovalServiceOptions = {
  store: DesignStore;
  connection: Connection;
};

type CommentDoc = DesignReviewComment & { _id?: unknown };
type ApprovalDoc = DesignApproval & { _id?: unknown };

function unicodeLength(text: string): number {
  return Array.from(text).length;
}

function normalizeText(text: unknown): string {
  if (typeof text !== 'string') {
    throw new DesignError(422, 'schema', 'text is required');
  }
  if (unicodeLength(text) === 0 || text.trim().length === 0) {
    throw new DesignError(422, 'schema', 'text is required');
  }
  if (unicodeLength(text) > MAX_COMMENT_TEXT) {
    throw new DesignError(422, 'schema', `text exceeds ${MAX_COMMENT_TEXT} Unicode code points`);
  }
  return text;
}

function normalizeRevision(revision: unknown): number {
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
    throw new DesignError(422, 'schema', 'revision is required');
  }
  return revision;
}

function publicComment(record: CommentDoc): DesignReviewComment {
  return {
    id: record.id,
    documentId: record.documentId,
    projectId: record.projectId,
    revision: record.revision,
    nodeId: record.nodeId ?? null,
    text: record.text,
    actorId: record.actorId,
    createdAt: record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt),
  };
}

function publicApproval(record: ApprovalDoc): DesignApproval {
  return {
    id: record.id,
    documentId: record.documentId,
    projectId: record.projectId,
    revision: record.revision,
    actorId: record.actorId,
    createdAt: record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt),
  };
}

function resolveWithProjectWrite(store: DesignStore): ApprovalStore['withProjectWrite'] {
  if (typeof store.withProjectWrite !== 'function')
    throw new DesignError(503, 'approval_store', 'Transactional ACL store required');
  return store.withProjectWrite.bind(store);
}

function nodeExistsInSnapshot(
  snapshot: { payload?: { nodes?: unknown } },
  nodeId: string,
): boolean {
  const nodes = snapshot?.payload?.nodes;
  if (!Array.isArray(nodes)) {
    return false;
  }
  for (const node of nodes) {
    if (
      node != null &&
      typeof node === 'object' &&
      'id' in node &&
      (node as { id?: unknown }).id === nodeId
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Comments and approval review for design documents.
 * Actor is the trusted server principal; body author is never accepted.
 * Approvals are pinned to the approved revision; status compares against head.
 */
export async function createApprovalService(
  options: CreateApprovalServiceOptions,
): Promise<ApprovalService> {
  const { store, connection } = options;
  const withProjectWrite = resolveWithProjectWrite(store);
  const commentsCol = connection.collection<CommentDoc>(COMMENTS_COLLECTION);
  const approvalsCol = connection.collection<ApprovalDoc>(APPROVALS_COLLECTION);

  await Promise.all([
    commentsCol.createIndex({ documentId: 1, createdAt: -1 }),
    commentsCol.createIndex({ id: 1 }, { unique: true }),
    approvalsCol.createIndex({ documentId: 1, revision: 1, actorId: 1 }, { unique: true }),
    approvalsCol.createIndex({ id: 1 }, { unique: true }),
    approvalsCol.createIndex({ documentId: 1, createdAt: -1 }),
  ]);

  return {
    async comment(actor: string, docId: string, input: CommentInput): Promise<DesignReviewComment> {
      const uid = sanitizeUserId(actor);
      const text = normalizeText(input?.text);
      const revision = normalizeRevision(input?.revision);
      const nodeId =
        input?.nodeId === undefined || input.nodeId === null ? null : String(input.nodeId);

      const document = await store.getDocument(uid, docId);
      const snapshot = await store.getRevisionSnapshot(uid, docId, revision);
      if (nodeId != null && !nodeExistsInSnapshot(snapshot, nodeId)) {
        throw new DesignError(422, 'schema', 'node not found in revision snapshot');
      }

      return withProjectWrite(uid, document.projectId, async (session) => {
        const project = await store.models.DesignProject.findById(document.projectId)
          .session(session)
          .exec();
        if (!project) {
          throw new DesignError(404, 'not_found', 'Not found');
        }
        const role = getMemberRole(project, uid);
        if (role !== 'owner' && role !== 'editor') {
          throw new DesignError(403, 'forbidden', 'Forbidden');
        }

        const revisionRecord = await store.models.DesignRevision.findOne({
          documentId: docId,
          revision,
        })
          .session(session)
          .exec();
        if (!revisionRecord) {
          throw new DesignError(422, 'schema', 'Revision not found');
        }
        if (nodeId != null && !nodeExistsInSnapshot(revisionRecord.snapshot, nodeId)) {
          throw new DesignError(422, 'schema', 'node not found in revision snapshot');
        }

        const record: DesignReviewComment = {
          id: randomUUID(),
          documentId: docId,
          projectId: document.projectId,
          revision,
          nodeId,
          text,
          actorId: uid,
          createdAt: new Date(),
        };
        await commentsCol.insertOne(record, { session });
        return publicComment(record);
      });
    },

    async comments(actor: string, docId: string): Promise<DesignReviewComment[]> {
      const uid = sanitizeUserId(actor);
      await store.getDocument(uid, docId);
      const records = await commentsCol
        .find({ documentId: docId })
        .sort({ createdAt: -1 })
        .limit(MAX_COMMENTS)
        .toArray();
      return records.map(publicComment);
    },

    async approve(actor: string, docId: string, input: ApproveInput): Promise<DesignApproval> {
      const uid = sanitizeUserId(actor);
      const revision = normalizeRevision(input?.revision);
      const document = await store.getDocument(uid, docId);

      return withProjectWrite(uid, document.projectId, async (session) => {
        const project = await store.models.DesignProject.findById(document.projectId)
          .session(session)
          .exec();
        if (!project) {
          throw new DesignError(404, 'not_found', 'Not found');
        }
        const role = getMemberRole(project, uid);
        if (role !== 'owner') {
          throw new DesignError(403, 'forbidden', 'Only the project owner may approve');
        }

        const current = await store.models.DesignDocument.findById(docId).session(session).exec();
        if (!current) {
          throw new DesignError(404, 'not_found', 'Not found');
        }
        if (current.revision !== revision) {
          throw new DesignError(409, 'revision_mismatch', 'Revision mismatch');
        }

        const existing = await approvalsCol.findOne(
          { documentId: docId, revision, actorId: uid },
          { session },
        );
        if (existing) {
          return publicApproval(existing);
        }

        const record: DesignApproval = {
          id: randomUUID(),
          documentId: docId,
          projectId: document.projectId,
          revision,
          actorId: uid,
          createdAt: new Date(),
        };

        try {
          await approvalsCol.insertOne(record, { session });
        } catch (error) {
          const code = (error as { code?: number }).code;
          if (code === 11000) {
            const raced = await approvalsCol.findOne(
              { documentId: docId, revision, actorId: uid },
              { session },
            );
            if (raced) {
              return publicApproval(raced);
            }
          }
          throw error;
        }

        return publicApproval(record);
      });
    },

    async status(actor: string, docId: string): Promise<DesignApprovalStatus> {
      const uid = sanitizeUserId(actor);
      const document = await store.getDocument(uid, docId);
      const approvals = await approvalsCol
        .find({ documentId: docId })
        .sort({ createdAt: -1 })
        .limit(200)
        .toArray();
      const publicApprovals = approvals.map(publicApproval);
      const isCurrentApproved = publicApprovals.some(
        (approval) => approval.revision === document.revision,
      );
      return {
        documentId: docId,
        headRevision: document.revision,
        isCurrentApproved,
        approvals: publicApprovals,
      };
    },
  };
}
