import { Schema } from 'mongoose';
import { randomUUID } from 'crypto';
import type { Connection, Model } from 'mongoose';
import type { DesignConnection, DesignStore } from './store';
import { DesignError } from './assets';

export const REFERENCE_QUERY_MAX = 300;
export const REFERENCE_MAX_RESULTS = 10;
export const REFERENCE_MAX_TRAITS = 12;
export const REFERENCE_ID_MAX = 128;
export const REFERENCE_TITLE_MAX = 200;
export const REFERENCE_URL_MAX = 2048;
export const REFERENCE_TRAIT_MAX = 64;
export const REFERENCE_DECISION_MAX = 64;
export const REFERENCE_KINDS = ['styles', 'screens', 'flows'] as const;
export const DESIGN_REFERENCE_LOCK_MODEL = 'DesignReferenceLock';

export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

export type ReferenceRecord = {
  id: string;
  kind: ReferenceKind;
  url: string;
  title: string;
};

export type ReferenceProvider = {
  search(actor: string, kind: ReferenceKind, query: string): Promise<ReferenceRecord[]>;
};

export type ReferenceDecision = string;

export type SaveReferenceLockInput = {
  expectedRevision: number;
  decision: ReferenceDecision;
  references: ReferenceRecord[];
  traits: string[];
};

export type ResearchInput = {
  kind: ReferenceKind;
  query: string;
};

export type ReferenceLockStatus = 'current' | 'stale' | 'missing';

export type ReferenceLockView = {
  documentId: string;
  projectId: string;
  lockedRevision: number;
  currentRevision: number;
  status: ReferenceLockStatus;
  decision: ReferenceDecision | null;
  references: ReferenceRecord[];
  traits: string[];
  actorId: string | null;
  updatedAt: string | null;
};

export type ReferenceWorkflow = {
  research(
    actor: string,
    documentId: string,
    input: ResearchInput,
  ): Promise<{ references: ReferenceRecord[]; documentRevision: number }>;
  saveLock(
    actor: string,
    documentId: string,
    input: SaveReferenceLockInput,
  ): Promise<ReferenceLockView>;
  getLock(actor: string, documentId: string): Promise<ReferenceLockView>;
};

export type CreateReferenceWorkflowOptions = {
  store: DesignStore;
  connection: DesignConnection;
  provider?: ReferenceProvider;
};

type ReferenceLockDoc = {
  _id: string;
  documentId: string;
  projectId: string;
  lockedRevision: number;
  decision: string;
  references: ReferenceRecord[];
  traits: string[];
  actorId: string;
  updatedAt: Date;
  createdAt: Date;
};

type StoreDocument = {
  id: string;
  projectId: string;
  revision: number;
};

function resolveConnection(connection: DesignConnection): Connection {
  const candidate = connection as Connection & { connection?: Connection };
  if (candidate != null && typeof (candidate as Connection).model === 'function') {
    return candidate as Connection;
  }
  if (candidate?.connection && typeof candidate.connection.model === 'function') {
    return candidate.connection;
  }
  throw new DesignError(422, 'VALIDATION', 'Mongo connection is required');
}

function lockSchema(): Schema<ReferenceLockDoc> {
  return new Schema<ReferenceLockDoc>(
    {
      _id: { type: String, required: true },
      documentId: { type: String, required: true, index: true, unique: true },
      projectId: { type: String, required: true, index: true },
      lockedRevision: { type: Number, required: true, min: 1 },
      decision: { type: String, required: true, maxlength: REFERENCE_DECISION_MAX },
      references: {
        type: [
          {
            id: { type: String, required: true },
            kind: { type: String, required: true, enum: REFERENCE_KINDS },
            url: { type: String, required: true },
            title: { type: String, required: true },
            _id: false,
          },
        ],
        validate: [
          (value: unknown[]) => Array.isArray(value) && value.length <= REFERENCE_MAX_RESULTS,
          `references max ${REFERENCE_MAX_RESULTS}`,
        ],
      },
      traits: {
        type: [String],
        validate: [
          (value: unknown[]) => Array.isArray(value) && value.length <= REFERENCE_MAX_TRAITS,
          `traits max ${REFERENCE_MAX_TRAITS}`,
        ],
      },
      actorId: { type: String, required: true },
      updatedAt: { type: Date, required: true },
      createdAt: { type: Date, required: true },
    },
    { collection: 'designreferencelocks', versionKey: false },
  );
}

function getLockModel(connection: Connection): Model<ReferenceLockDoc> {
  if (connection.models[DESIGN_REFERENCE_LOCK_MODEL]) {
    return connection.models[DESIGN_REFERENCE_LOCK_MODEL] as Model<ReferenceLockDoc>;
  }
  return connection.model<ReferenceLockDoc>(DESIGN_REFERENCE_LOCK_MODEL, lockSchema());
}

function requireActor(actor: unknown): string {
  if (typeof actor !== 'string' || actor.trim().length < 1) {
    throw new DesignError(422, 'VALIDATION', 'actor is required');
  }
  return actor.trim();
}

function requireDocumentId(documentId: unknown): string {
  if (typeof documentId !== 'string' || documentId.trim().length < 1) {
    throw new DesignError(422, 'VALIDATION', 'documentId is required');
  }
  return documentId.trim();
}

function isReferenceKind(value: unknown): value is ReferenceKind {
  return typeof value === 'string' && (REFERENCE_KINDS as readonly string[]).includes(value);
}

function assertHttpsUrl(raw: string, label: string): string {
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > REFERENCE_URL_MAX) {
    throw new DesignError(422, 'VALIDATION', `${label} url is invalid`);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new DesignError(422, 'VALIDATION', `${label} url is invalid`);
  }
  if (parsed.protocol !== 'https:') {
    throw new DesignError(422, 'VALIDATION', `${label} url must be https`);
  }
  if (parsed.username || parsed.password) {
    throw new DesignError(422, 'VALIDATION', `${label} url must not embed credentials`);
  }
  return parsed.toString();
}

function normalizeQuery(query: unknown): string {
  if (typeof query !== 'string') {
    throw new DesignError(422, 'VALIDATION', 'query is required');
  }
  const trimmed = query.trim();
  if (trimmed.length < 1) {
    throw new DesignError(422, 'VALIDATION', 'query is required');
  }
  if (trimmed.length > REFERENCE_QUERY_MAX) {
    throw new DesignError(422, 'VALIDATION', `query max length is ${REFERENCE_QUERY_MAX}`);
  }
  return trimmed;
}

function normalizeDecision(decision: unknown): string {
  if (typeof decision !== 'string') {
    throw new DesignError(422, 'VALIDATION', 'decision is required');
  }
  const trimmed = decision.trim();
  if (trimmed.length < 1 || trimmed.length > REFERENCE_DECISION_MAX) {
    throw new DesignError(422, 'VALIDATION', 'decision is invalid');
  }
  return trimmed;
}

function normalizeTrait(trait: unknown, index: number): string {
  if (typeof trait !== 'string') {
    throw new DesignError(422, 'VALIDATION', `traits[${index}] is invalid`);
  }
  const trimmed = trait.trim();
  if (trimmed.length < 1 || trimmed.length > REFERENCE_TRAIT_MAX) {
    throw new DesignError(422, 'VALIDATION', `traits[${index}] is invalid`);
  }
  return trimmed;
}

function normalizeReference(raw: unknown, index: number): ReferenceRecord {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new DesignError(422, 'VALIDATION', `references[${index}] is invalid`);
  }
  const record = raw as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    record.id.trim().length < 1 ||
    record.id.length > REFERENCE_ID_MAX
  ) {
    throw new DesignError(422, 'VALIDATION', `references[${index}].id is invalid`);
  }
  if (!isReferenceKind(record.kind)) {
    throw new DesignError(422, 'VALIDATION', `references[${index}].kind is invalid`);
  }
  if (typeof record.title !== 'string') {
    throw new DesignError(422, 'VALIDATION', `references[${index}].title is invalid`);
  }
  const title = record.title.trim();
  if (title.length < 1 || title.length > REFERENCE_TITLE_MAX) {
    throw new DesignError(422, 'VALIDATION', `references[${index}].title is invalid`);
  }
  return {
    id: record.id.trim(),
    kind: record.kind,
    url: assertHttpsUrl(String(record.url ?? ''), `references[${index}]`),
    title,
  };
}

function normalizeReferences(raw: unknown): ReferenceRecord[] {
  if (!Array.isArray(raw)) {
    throw new DesignError(422, 'VALIDATION', 'references must be an array');
  }
  if (raw.length > REFERENCE_MAX_RESULTS) {
    throw new DesignError(422, 'VALIDATION', `references max is ${REFERENCE_MAX_RESULTS}`);
  }
  return raw.map((item, index) => normalizeReference(item, index));
}

function normalizeTraits(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new DesignError(422, 'VALIDATION', 'traits must be an array');
  }
  if (raw.length > REFERENCE_MAX_TRAITS) {
    throw new DesignError(422, 'VALIDATION', `traits max is ${REFERENCE_MAX_TRAITS}`);
  }
  return raw.map((trait, index) => normalizeTrait(trait, index));
}

function asStoreDocument(document: unknown): StoreDocument {
  if (document == null || typeof document !== 'object') {
    throw new DesignError(422, 'VALIDATION', 'document is invalid');
  }
  const record = document as Record<string, unknown>;
  const id =
    typeof record.id === 'string' ? record.id : typeof record._id === 'string' ? record._id : null;
  const projectId = typeof record.projectId === 'string' ? record.projectId : null;
  const revision = typeof record.revision === 'number' ? record.revision : null;
  if (!id || !projectId || !Number.isInteger(revision) || (revision as number) < 1) {
    throw new DesignError(422, 'VALIDATION', 'document is invalid');
  }
  return { id, projectId, revision: revision as number };
}

function toLockView(document: StoreDocument, lock: ReferenceLockDoc | null): ReferenceLockView {
  if (!lock) {
    return {
      documentId: document.id,
      projectId: document.projectId,
      lockedRevision: 0,
      currentRevision: document.revision,
      status: 'missing',
      decision: null,
      references: [],
      traits: [],
      actorId: null,
      updatedAt: null,
    };
  }
  return {
    documentId: lock.documentId,
    projectId: lock.projectId,
    lockedRevision: lock.lockedRevision,
    currentRevision: document.revision,
    status: lock.lockedRevision === document.revision ? 'current' : 'stale',
    decision: lock.decision,
    references: lock.references.map((item) => ({
      id: item.id,
      kind: item.kind,
      url: item.url,
      title: item.title,
    })),
    traits: [...lock.traits],
    actorId: lock.actorId,
    updatedAt: lock.updatedAt.toISOString(),
  };
}

function mapProviderError(error: unknown): never {
  const status =
    error && typeof error === 'object' && 'status' in error ? Number(error.status) : 502;
  if (status === 401 || status === 403)
    throw new DesignError(422, 'REFERENCE_AUTH', 'Reference provider authentication required');
  if (status === 429)
    throw new DesignError(429, 'REFERENCE_LIMIT', 'Reference provider rate limit reached');
  throw new DesignError(502, 'PROVIDER_ERROR', 'Reference provider failed');
}

export function createReferenceWorkflow(
  options: CreateReferenceWorkflowOptions,
): ReferenceWorkflow {
  if (!options?.store) {
    throw new DesignError(422, 'VALIDATION', 'store is required');
  }
  if (!options?.connection) {
    throw new DesignError(422, 'VALIDATION', 'connection is required');
  }

  const store = options.store;
  const connection = resolveConnection(options.connection);
  const locks = getLockModel(connection);
  const provider = options.provider;

  return {
    async research(actor, documentId, input) {
      const uid = requireActor(actor);
      const docId = requireDocumentId(documentId);
      if (!provider) {
        throw new DesignError(
          422,
          'CAPABILITY_UNAVAILABLE',
          'Reference lookup provider is not configured',
        );
      }
      if (!input || !isReferenceKind(input.kind)) {
        throw new DesignError(422, 'VALIDATION', 'kind must be styles, screens, or flows');
      }
      const query = normalizeQuery(input.query);
      const document = asStoreDocument(await store.getDocument(uid, docId));

      let raw: ReferenceRecord[];
      try {
        raw = await provider.search(uid, input.kind, query);
      } catch (error) {
        mapProviderError(error);
      }
      if (!Array.isArray(raw)) {
        throw new DesignError(
          502,
          'PROVIDER_ERROR',
          'Reference provider returned an invalid payload',
        );
      }
      const references = normalizeReferences(raw.slice(0, REFERENCE_MAX_RESULTS));
      await store.getDocument(uid, docId);
      return { references, documentRevision: document.revision };
    },

    async saveLock(actor, documentId, input) {
      const uid = requireActor(actor);
      const docId = requireDocumentId(documentId);
      if (!input || typeof input !== 'object') {
        throw new DesignError(422, 'VALIDATION', 'lock payload is required');
      }
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
        throw new DesignError(422, 'VALIDATION', 'expectedRevision is required');
      }
      const decision = normalizeDecision(input.decision);
      const references = normalizeReferences(input.references);
      const traits = normalizeTraits(input.traits);

      const head = asStoreDocument(await store.getDocument(uid, docId));
      if (head.revision !== input.expectedRevision) {
        throw new DesignError(409, 'revision_mismatch', 'Revision mismatch');
      }

      return store.withProjectWrite(uid, head.projectId, async (session) => {
        const rawDocument = await store.models.DesignDocument.findById(docId)
          .session(session)
          .exec();
        if (!rawDocument) {
          throw new DesignError(404, 'not_found', 'Not found');
        }
        const document = asStoreDocument({
          id: String(rawDocument._id),
          projectId: rawDocument.projectId,
          revision: rawDocument.revision,
        });
        if (document.revision !== input.expectedRevision) {
          throw new DesignError(409, 'revision_mismatch', 'Revision mismatch');
        }

        const now = new Date();
        const existing = await locks.findOne({ documentId: docId }).session(session).exec();

        const payload: ReferenceLockDoc = {
          _id: existing?._id ?? randomUUID(),
          documentId: docId,
          projectId: document.projectId,
          lockedRevision: document.revision,
          decision,
          references,
          traits,
          actorId: uid,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };

        await locks
          .findOneAndUpdate(
            { documentId: docId },
            { $set: payload },
            { upsert: true, new: true, session },
          )
          .exec();

        return toLockView(document, payload);
      });
    },

    async getLock(actor, documentId) {
      const uid = requireActor(actor);
      const docId = requireDocumentId(documentId);
      const document = asStoreDocument(await store.getDocument(uid, docId));
      const lock = await locks.findOne({ documentId: docId }).lean().exec();
      return toLockView(document, lock as ReferenceLockDoc | null);
    },
  };
}
