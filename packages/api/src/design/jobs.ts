import { Schema } from 'mongoose';
import { createHash, randomUUID } from 'crypto';
import type { Connection, Model } from 'mongoose';
import {
  isUncertainProviderError,
  type DesignCapability,
  type DesignGenerationProvider,
  type DesignProposal,
  type ProviderSubmitResult,
} from './providers';
import {
  DesignError,
  principalId,
  type AssetStore,
  type AssetView,
  type DesignAuthorizer,
  type DesignPrincipal,
} from './assets';

export const DESIGN_GENERATION_JOB_MODEL = 'DesignGenerationJob';

export type JobStatus =
  | 'queued'
  | 'submitting'
  | 'submitted'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'submission_unknown'
  | 'cancelled';

export interface CanonicalJobPayload {
  capability: DesignCapability;
  payload: Record<string, unknown>;
}

export interface SubmitJobInput {
  projectId: string;
  documentId: string;
  clientJobId: string;
  capability: DesignCapability;
  payload: Record<string, unknown>;
}

export interface JobView {
  id: string;
  projectId: string;
  documentId: string;
  clientJobId: string;
  capability: DesignCapability;
  status: JobStatus;
  cancelRequested: boolean;
  applied: boolean;
  payloadHash: string;
  providerJobId?: string;
  outputAsset?: Pick<AssetView, 'id' | 'version' | 'mime' | 'width' | 'height' | 'checksum'>;
  proposal?: DesignProposal;
  error?: { code: string; message: string };
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BudgetCheckInput {
  principalId: string;
  projectId: string;
  documentId: string;
  capability: DesignCapability;
  payload: Record<string, unknown>;
}

export interface BudgetReserveInput extends BudgetCheckInput {
  jobId: string;
}

/**
 * Persistent generation jobs.
 *
 * - Dedup identity: principalId + documentId + clientJobId + canonical payload hash.
 * - Write auth and resolved `document.projectId` are checked before identity lookup.
 * - Canonical identity is loaded after that auth and before any budget callback.
 *   Identity hits return the existing view and never call `checkBudget` or
 *   a future ledger adapter.
 * - `checkBudget` is a read-only preflight. It is not a debit, reservation, or
 *   ledger. Callers must not mutate billing state from this callback.
 * - Atomic debit/reservation is not implemented; a future ledger adapter must
 *   reserve only for the unique-index insert winner. Default is no debit. This service
 *   does not ship a pretend ledger. HTTP wiring leaves provider+budget disabled
 *   until those hooks are injected.
 * - The queued identity is persisted before any provider.submit call.
 * - Project+document write auth and resolved `doc.projectId` are rechecked
 *   immediately before dispatch, poll, and output retain. Rechecks use the
 *   job principal; a revoked principal is never restored via remaining members.
 * - If write access is gone: `cancelled`, no asset insert, no retry, lease cleared.
 * - Late bytes on an authorized cancel may be retained per the original spec.
 *   There is no private-quarantine retain policy here (`putJobOutput` is a
 *   project asset insert). Revoked jobs never insert assets; late bytes are
 *   discarded without retry.
 * - `submitting` is leased; an expired submitting lease becomes
 *   `submission_unknown` and is never retried.
 * - `cancelRequested` is an honest flag. Status becomes `cancelled` when the
 *   provider was never reached, the provider confirms cancel, or write access
 *   was revoked before retain.
 * - This service never writes canvas documents.
 */
export interface ResolvedDesignDocument {
  projectId: string;
}

export interface CreateJobServiceOptions {
  connection: Connection;
  authorizeDocument: DesignAuthorizer;
  /**
   * Optional project write ACL. Rechecked with `authorizeDocument` and
   * resolved `document.projectId` before dispatch, poll, and retain.
   */
  authorizeProject?: DesignAuthorizer;
  /**
   * Loads the authorized document so submit can bind projectId.
   * Must not trust the client-supplied projectId alone.
   */
  resolveDocument: (principalId: string, documentId: string) => Promise<ResolvedDesignDocument>;
  provider: DesignGenerationProvider;
  assetStore: AssetStore;
  /**
   * Read-only preflight. Must not debit, reserve, or mutate a ledger.
   * Invoked only after current write auth and only when no canonical identity
   * exists yet. Sequential identical submits call this at most once.
   * Concurrent identical submits may race this callback; that is not a billing
   * transaction and this service does not claim atomicity for it.
   */
  checkBudget?: (input: BudgetCheckInput) => Promise<void>;
  workerId?: string;
  leaseMs?: number;
  now?: () => Date;
}

export interface JobService {
  submit(principal: DesignPrincipal, input: SubmitJobInput): Promise<JobView>;
  get(principal: DesignPrincipal, jobId: string): Promise<JobView>;
  list(principal: DesignPrincipal, documentId: string): Promise<JobView[]>;
  requestCancel(principal: DesignPrincipal, jobId: string): Promise<JobView>;
  claimAndProcessNext(): Promise<JobView | null>;
}

interface DesignGenerationJobDoc {
  id: string;
  principalId: string;
  projectId: string;
  documentId: string;
  clientJobId: string;
  capability: DesignCapability;
  payload: Record<string, unknown>;
  payloadHash: string;
  status: JobStatus;
  cancelRequested: boolean;
  applied: boolean;
  providerJobId?: string;
  leaseOwner?: string | null;
  leaseToken?: string | null;
  leaseExpiresAt?: Date | null;
  outputAssetId?: string;
  outputAssetVersion?: number;
  outputAssetMime?: string;
  outputAssetWidth?: number;
  outputAssetHeight?: number;
  outputAssetChecksum?: string;
  proposal?: DesignProposal;
  error?: { code: string; message: string };
  createdAt?: Date;
  updatedAt?: Date;
}

const STATUSES: JobStatus[] = [
  'queued',
  'submitting',
  'submitted',
  'running',
  'succeeded',
  'failed',
  'submission_unknown',
  'cancelled',
];

function requireToken(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DesignError(422, 'VALIDATION', `${label} is required`);
  }
  if (value.includes('\0') || value.includes('/') || value.includes('\\')) {
    throw new DesignError(422, 'VALIDATION', `${label} is invalid`);
  }
  return value;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      sorted[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalPayloadHash(
  capability: DesignCapability,
  payload: Record<string, unknown>,
): string {
  const canonical = JSON.stringify({ capability, payload: sortValue(payload ?? {}) });
  return createHash('sha256').update(canonical).digest('hex');
}

function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: number }).code === 11000);
}

function toErrorBody(error: unknown): { code: string; message: string } {
  if (error instanceof DesignError) {
    return error.body;
  }
  if (error instanceof Error && error.message) {
    return { code: 'PROVIDER_ERROR', message: error.message };
  }
  return { code: 'PROVIDER_ERROR', message: 'Provider failed' };
}

class JobAccessRevokedError extends Error {
  readonly status = 403;
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN';
  readonly body = { code: 'FORBIDDEN', message: 'Write access was revoked' };

  constructor(cause?: unknown) {
    super('Write access was revoked');
    this.name = 'JobAccessRevokedError';
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

function isAuthDenial(error: unknown): boolean {
  if (error instanceof JobAccessRevokedError) {
    return true;
  }
  if (!error || typeof error !== 'object') {
    return false;
  }
  const status =
    (error as { statusCode?: number; status?: number }).statusCode ??
    (error as { status?: number }).status;
  if (status === 401 || status === 403 || status === 404) {
    return true;
  }
  const code = String((error as { code?: string }).code || '').toLowerCase();
  return code === 'forbidden' || code === 'not_found' || code === 'unauthorized';
}

function jobSchema() {
  const schema = new Schema<DesignGenerationJobDoc>(
    {
      id: { type: String, required: true, unique: true },
      principalId: { type: String, required: true, index: true },
      projectId: { type: String, required: true, index: true },
      documentId: { type: String, required: true, index: true },
      clientJobId: { type: String, required: true },
      capability: { type: String, required: true, enum: ['imageGeneration', 'textProposal'] },
      payload: { type: Schema.Types.Mixed, required: true },
      payloadHash: { type: String, required: true },
      status: { type: String, required: true, enum: STATUSES, index: true },
      cancelRequested: { type: Boolean, required: true, default: false },
      applied: { type: Boolean, required: true, default: false },
      providerJobId: { type: String, required: false },
      leaseOwner: { type: String, required: false, default: null },
      leaseToken: { type: String, required: false, default: null },
      leaseExpiresAt: { type: Date, required: false, default: null },
      outputAssetId: { type: String, required: false },
      outputAssetVersion: { type: Number, required: false },
      outputAssetMime: { type: String, required: false },
      outputAssetWidth: { type: Number, required: false },
      outputAssetHeight: { type: Number, required: false },
      outputAssetChecksum: { type: String, required: false },
      proposal: { type: Schema.Types.Mixed, required: false },
      error: {
        code: { type: String, required: false },
        message: { type: String, required: false },
      },
    },
    {
      collection: 'designgenerationjobs',
      timestamps: true,
      id: false,
    },
  );
  schema.index(
    { principalId: 1, documentId: 1, clientJobId: 1 },
    { unique: true, name: 'designjob_dedup_identity' },
  );
  schema.index({ status: 1, leaseExpiresAt: 1, createdAt: 1 }, { name: 'designjob_worker_claim' });
  return schema;
}

function getJobModel(connection: Connection): Model<DesignGenerationJobDoc> {
  return (
    (connection.models[DESIGN_GENERATION_JOB_MODEL] as Model<DesignGenerationJobDoc> | undefined) ??
    connection.model<DesignGenerationJobDoc>(DESIGN_GENERATION_JOB_MODEL, jobSchema())
  );
}

function toView(doc: DesignGenerationJobDoc): JobView {
  const view: JobView = {
    id: doc.id,
    projectId: doc.projectId,
    documentId: doc.documentId,
    clientJobId: doc.clientJobId,
    capability: doc.capability,
    status: doc.status,
    cancelRequested: Boolean(doc.cancelRequested),
    applied: false,
    payloadHash: doc.payloadHash,
    providerJobId: doc.providerJobId,
    proposal: doc.proposal,
    error: doc.error,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  if (doc.outputAssetId) {
    view.outputAsset = {
      id: doc.outputAssetId,
      version: doc.outputAssetVersion ?? 1,
      mime: doc.outputAssetMime ?? 'application/octet-stream',
      width: doc.outputAssetWidth ?? 0,
      height: doc.outputAssetHeight ?? 0,
      checksum: doc.outputAssetChecksum ?? '',
    };
  }
  return view;
}

export async function createJobService(options: CreateJobServiceOptions): Promise<JobService> {
  if (!options?.connection) {
    throw new DesignError(422, 'VALIDATION', 'Mongo connection is required');
  }
  if (typeof options.authorizeDocument !== 'function') {
    throw new DesignError(422, 'VALIDATION', 'authorizeDocument is required');
  }
  if (typeof options.resolveDocument !== 'function') {
    throw new DesignError(422, 'VALIDATION', 'resolveDocument is required');
  }
  if (!options.provider || typeof options.provider.submit !== 'function') {
    throw new DesignError(422, 'VALIDATION', 'provider is required');
  }
  if (!options.assetStore) {
    throw new DesignError(422, 'VALIDATION', 'assetStore is required');
  }

  const Job = getJobModel(options.connection);
  const workerId = options.workerId || randomUUID();
  const leaseMs = options.leaseMs && options.leaseMs > 0 ? options.leaseMs : 30_000;
  const now = () => (options.now ? options.now() : new Date());
  const provider = options.provider;

  const loadById = async (jobId: string): Promise<DesignGenerationJobDoc> => {
    const doc = await Job.findOne({ id: jobId }).lean<DesignGenerationJobDoc>();
    if (!doc) {
      throw new DesignError(404, 'NOT_FOUND', 'Not found');
    }
    return doc;
  };

  const findExistingIdentity = async (query: {
    principalId: string;
    documentId: string;
    clientJobId: string;
    payloadHash?: string;
  }) => {
    return Job.findOne(query).lean<DesignGenerationJobDoc>();
  };

  const clearLease = {
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
  };

  const ensureWriteAuthorization = async (doc: DesignGenerationJobDoc): Promise<void> => {
    try {
      await options.authorizeDocument(doc.principalId, doc.documentId, true);
      if (typeof options.authorizeProject === 'function') {
        await options.authorizeProject(doc.principalId, doc.projectId, true);
      }
      const resolved = await options.resolveDocument(doc.principalId, doc.documentId);
      if (!resolved?.projectId || resolved.projectId !== doc.projectId) {
        throw new JobAccessRevokedError();
      }
    } catch (error) {
      if (error instanceof JobAccessRevokedError) {
        throw error;
      }
      if (isAuthDenial(error)) {
        throw new JobAccessRevokedError(error);
      }
      throw error;
    }
  };

  const markRevoked = async (doc: DesignGenerationJobDoc, leaseToken: string, error?: unknown) => {
    const updated = await Job.findOneAndUpdate(
      { id: doc.id, leaseToken },
      {
        $set: {
          status: 'cancelled',
          applied: false,
          error: error
            ? {
                code: 'FORBIDDEN',
                message: 'Write access was revoked before output could be retained',
              }
            : { code: 'FORBIDDEN', message: 'Write access was revoked' },
          ...clearLease,
        },
      },
      { new: true },
    ).lean<DesignGenerationJobDoc>();
    return updated ?? loadById(doc.id);
  };

  const retainOutput = async (
    doc: DesignGenerationJobDoc,
    result: {
      proposal?: unknown;
      imageBytes?: Buffer;
      mime?: string;
      filename?: string;
    },
  ): Promise<Partial<DesignGenerationJobDoc>> => {
    // Recheck immediately before any asset insert. putJobOutput is a project
    // insert, not a private-quarantine policy. Revoked principals never retain.
    await ensureWriteAuthorization(doc);
    const update: Partial<DesignGenerationJobDoc> = { applied: false };
    if (result.proposal != null) {
      update.proposal = result.proposal as DesignProposal;
    }
    if (result.imageBytes && result.imageBytes.length > 0) {
      const asset = await options.assetStore.putJobOutput({
        projectId: doc.projectId,
        bytes: result.imageBytes,
        mime: result.mime || 'image/png',
        filename: result.filename || 'job-output',
        createdBy: doc.principalId,
        jobId: doc.id,
      });
      update.outputAssetId = asset.id;
      update.outputAssetVersion = asset.version;
      update.outputAssetMime = asset.mime;
      update.outputAssetWidth = asset.width;
      update.outputAssetHeight = asset.height;
      update.outputAssetChecksum = asset.checksum;
    }
    return update;
  };

  const applyProviderResult = async (
    doc: DesignGenerationJobDoc,
    leaseToken: string,
    result: ProviderSubmitResult,
  ): Promise<DesignGenerationJobDoc> => {
    const latest = await Job.findOne({ id: doc.id, leaseToken }).lean<DesignGenerationJobDoc>();
    if (!latest) {
      return loadById(doc.id);
    }

    try {
      await ensureWriteAuthorization(latest);
    } catch (error) {
      if (error instanceof JobAccessRevokedError || isAuthDenial(error)) {
        return markRevoked(latest, leaseToken, error);
      }
      throw error;
    }

    if (result.kind === 'accepted') {
      const status: JobStatus = latest.cancelRequested ? 'submitted' : 'submitted';
      const updated = await Job.findOneAndUpdate(
        { id: doc.id, leaseToken },
        {
          $set: {
            status,
            providerJobId: result.providerJobId,
            ...clearLease,
          },
        },
        { new: true },
      ).lean<DesignGenerationJobDoc>();
      return updated ?? loadById(doc.id);
    }

    let retained: Partial<DesignGenerationJobDoc>;
    try {
      retained = await retainOutput(latest, result);
    } catch (error) {
      if (error instanceof JobAccessRevokedError || isAuthDenial(error)) {
        return markRevoked(latest, leaseToken, error);
      }
      throw error;
    }
    const status: JobStatus = latest.cancelRequested ? 'cancelled' : 'succeeded';
    const updated = await Job.findOneAndUpdate(
      { id: doc.id, leaseToken },
      {
        $set: {
          status,
          applied: false,
          providerJobId: result.providerJobId,
          ...retained,
          ...clearLease,
        },
      },
      { new: true },
    ).lean<DesignGenerationJobDoc>();
    return updated ?? loadById(doc.id);
  };

  const markFailed = async (doc: DesignGenerationJobDoc, leaseToken: string, error: unknown) => {
    const updated = await Job.findOneAndUpdate(
      { id: doc.id, leaseToken },
      {
        $set: {
          status: 'failed',
          error: toErrorBody(error),
          applied: false,
          ...clearLease,
        },
      },
      { new: true },
    ).lean<DesignGenerationJobDoc>();
    return updated ?? loadById(doc.id);
  };

  const markUnknown = async (doc: DesignGenerationJobDoc, leaseToken: string, error?: unknown) => {
    const updated = await Job.findOneAndUpdate(
      { id: doc.id, leaseToken },
      {
        $set: {
          status: 'submission_unknown',
          error: error
            ? toErrorBody(error)
            : { code: 'SUBMISSION_UNKNOWN', message: 'Provider submission state is unknown' },
          applied: false,
          ...clearLease,
        },
      },
      { new: true },
    ).lean<DesignGenerationJobDoc>();
    return updated ?? loadById(doc.id);
  };

  const dispatchQueued = async (doc: DesignGenerationJobDoc, leaseToken: string) => {
    const current = await Job.findOne({ id: doc.id, leaseToken }).lean<DesignGenerationJobDoc>();
    if (!current) {
      return loadById(doc.id);
    }

    try {
      await ensureWriteAuthorization(current);
    } catch (error) {
      if (error instanceof JobAccessRevokedError || isAuthDenial(error)) {
        return markRevoked(current, leaseToken, error);
      }
      return markFailed(current, leaseToken, error);
    }

    if (current.cancelRequested) {
      const cancelled = await Job.findOneAndUpdate(
        { id: doc.id, leaseToken, providerJobId: { $exists: false } },
        { $set: { status: 'cancelled', applied: false, ...clearLease } },
        { new: true },
      ).lean<DesignGenerationJobDoc>();
      return cancelled ?? loadById(doc.id);
    }

    try {
      const result = await provider.submit({
        jobId: current.id,
        principalId: current.principalId,
        projectId: current.projectId,
        documentId: current.documentId,
        capability: current.capability,
        payload: current.payload,
      });
      return await applyProviderResult(current, leaseToken, result);
    } catch (error) {
      if (error instanceof JobAccessRevokedError || isAuthDenial(error)) {
        return markRevoked(current, leaseToken, error);
      }
      if (error instanceof DesignError && error.code === 'CAPABILITY_UNAVAILABLE') {
        return markFailed(current, leaseToken, error);
      }
      if (isUncertainProviderError(error)) {
        return markUnknown(current, leaseToken, error);
      }
      return markFailed(current, leaseToken, error);
    }
  };

  const retainOrRevoke = async (
    doc: DesignGenerationJobDoc,
    leaseToken: string,
    result: { proposal?: unknown; imageBytes?: Buffer; mime?: string; filename?: string },
  ): Promise<
    | { kind: 'retained'; update: Partial<DesignGenerationJobDoc> }
    | { kind: 'revoked'; doc: DesignGenerationJobDoc }
  > => {
    try {
      const update = await retainOutput(doc, result);
      return { kind: 'retained', update };
    } catch (error) {
      if (error instanceof JobAccessRevokedError || isAuthDenial(error)) {
        return { kind: 'revoked', doc: await markRevoked(doc, leaseToken, error) };
      }
      throw error;
    }
  };

  const pollSubmitted = async (doc: DesignGenerationJobDoc, leaseToken: string) => {
    try {
      await ensureWriteAuthorization(doc);
    } catch (error) {
      if (error instanceof JobAccessRevokedError || isAuthDenial(error)) {
        return markRevoked(doc, leaseToken, error);
      }
      return markFailed(doc, leaseToken, error);
    }

    if (typeof provider.status !== 'function') {
      const released = await Job.findOneAndUpdate(
        { id: doc.id, leaseToken },
        { $set: { ...clearLease } },
        { new: true },
      ).lean<DesignGenerationJobDoc>();
      return released ?? loadById(doc.id);
    }
    if (!doc.providerJobId) {
      return markUnknown(doc, leaseToken);
    }
    try {
      const status = await provider.status(doc.providerJobId);
      try {
        await ensureWriteAuthorization(doc);
      } catch (error) {
        if (error instanceof JobAccessRevokedError || isAuthDenial(error)) {
          return markRevoked(doc, leaseToken, error);
        }
        throw error;
      }
      if (status.state === 'unknown') {
        return markUnknown(doc, leaseToken);
      }
      if (status.state === 'queued' || status.state === 'running') {
        const running = await Job.findOneAndUpdate(
          { id: doc.id, leaseToken },
          {
            $set: {
              status: 'running',
              leaseExpiresAt: new Date(now().getTime() + leaseMs),
            },
          },
          { new: true },
        ).lean<DesignGenerationJobDoc>();
        return running ?? loadById(doc.id);
      }
      if (status.state === 'failed') {
        return markFailed(doc, leaseToken, {
          message: status.error?.message || 'Provider failed',
        });
      }
      if (status.state === 'cancelled') {
        const retained = await retainOrRevoke(doc, leaseToken, status);
        if (retained.kind === 'revoked') {
          return retained.doc;
        }
        const updated = await Job.findOneAndUpdate(
          { id: doc.id, leaseToken },
          { $set: { status: 'cancelled', applied: false, ...retained.update, ...clearLease } },
          { new: true },
        ).lean<DesignGenerationJobDoc>();
        return updated ?? loadById(doc.id);
      }
      const retained = await retainOrRevoke(doc, leaseToken, status);
      if (retained.kind === 'revoked') {
        return retained.doc;
      }
      const latest = await Job.findOne({ id: doc.id }).lean<DesignGenerationJobDoc>();
      const nextStatus: JobStatus = latest?.cancelRequested ? 'cancelled' : 'succeeded';
      const updated = await Job.findOneAndUpdate(
        { id: doc.id, leaseToken },
        { $set: { status: nextStatus, applied: false, ...retained.update, ...clearLease } },
        { new: true },
      ).lean<DesignGenerationJobDoc>();
      return updated ?? loadById(doc.id);
    } catch (error) {
      if (error instanceof JobAccessRevokedError || isAuthDenial(error)) {
        return markRevoked(doc, leaseToken, error);
      }
      if (isUncertainProviderError(error)) {
        const released = await Job.findOneAndUpdate(
          { id: doc.id, leaseToken },
          { $set: { ...clearLease } },
          { new: true },
        ).lean<DesignGenerationJobDoc>();
        return released ?? loadById(doc.id);
      }
      return markFailed(doc, leaseToken, error);
    }
  };

  const expireSubmittingLeases = async () => {
    await Job.updateMany(
      {
        status: 'submitting',
        leaseExpiresAt: { $lte: now() },
      },
      {
        $set: {
          status: 'submission_unknown',
          error: {
            code: 'SUBMISSION_UNKNOWN',
            message: 'Submitting lease expired before provider confirmation',
          },
          applied: false,
          ...clearLease,
        },
      },
    );
  };

  const claimNext = async (): Promise<{
    doc: DesignGenerationJobDoc;
    leaseToken: string;
    action: 'dispatch' | 'poll';
  } | null> => {
    await expireSubmittingLeases();
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now().getTime() + leaseMs);
    const leaseFilter = {
      $or: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { $exists: false } },
        { leaseExpiresAt: { $lte: now() } },
      ],
    };

    const queued = await Job.findOneAndUpdate(
      { status: 'queued', ...leaseFilter },
      {
        $set: {
          status: 'submitting',
          leaseOwner: workerId,
          leaseToken,
          leaseExpiresAt,
        },
      },
      { sort: { createdAt: 1 }, new: true },
    ).lean<DesignGenerationJobDoc>();
    if (queued) {
      return { doc: queued, leaseToken, action: 'dispatch' };
    }

    const inflight = await Job.findOneAndUpdate(
      { status: { $in: ['submitted', 'running'] }, ...leaseFilter },
      {
        $set: {
          leaseOwner: workerId,
          leaseToken,
          leaseExpiresAt,
        },
      },
      { sort: { createdAt: 1 }, new: true },
    ).lean<DesignGenerationJobDoc>();
    if (inflight) {
      return { doc: inflight, leaseToken, action: 'poll' };
    }
    return null;
  };

  return {
    async submit(principal, input) {
      const actor = principalId(principal);
      const projectId = requireToken(input.projectId, 'projectId');
      const documentId = requireToken(input.documentId, 'documentId');
      const clientJobId = requireToken(input.clientJobId, 'clientJobId');
      const capability = input.capability;
      if (capability !== 'imageGeneration' && capability !== 'textProposal') {
        throw new DesignError(422, 'VALIDATION', 'capability is invalid');
      }
      const payload =
        input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
          ? (input.payload as Record<string, unknown>)
          : null;
      if (!payload) {
        throw new DesignError(422, 'VALIDATION', 'payload is required');
      }

      await options.authorizeDocument(actor, documentId, true);
      const resolved = await options.resolveDocument(actor, documentId);
      if (!resolved?.projectId || resolved.projectId !== projectId) {
        throw new DesignError(404, 'NOT_FOUND', 'Not found');
      }

      if (!provider.capabilities[capability]) {
        throw new DesignError(422, 'CAPABILITY_UNAVAILABLE', `${capability} is unavailable`);
      }
      const payloadHash = canonicalPayloadHash(capability, payload);
      const conflicting = await findExistingIdentity({
        principalId: actor,
        documentId,
        clientJobId,
      });
      if (conflicting && conflicting.payloadHash !== payloadHash) {
        throw new DesignError(409, 'CONFLICT', 'clientJobId already used with a different payload');
      }
      if (conflicting && conflicting.payloadHash === payloadHash) {
        return toView(conflicting);
      }

      if (options.checkBudget) {
        await options.checkBudget({
          principalId: actor,
          projectId,
          documentId,
          capability,
          payload,
        });
      }

      const id = randomUUID();
      let created: DesignGenerationJobDoc;
      try {
        created = (
          await Job.create({
            id,
            principalId: actor,
            projectId,
            documentId,
            clientJobId,
            capability,
            payload,
            payloadHash,
            status: 'queued',
            cancelRequested: false,
            applied: false,
          })
        ).toObject() as DesignGenerationJobDoc;
      } catch (error) {
        if (!isDuplicateKey(error)) {
          throw error;
        }
        const existing = await findExistingIdentity({
          principalId: actor,
          documentId,
          clientJobId,
          payloadHash,
        });
        if (existing) {
          return toView(existing);
        }
        const other = await findExistingIdentity({ principalId: actor, documentId, clientJobId });
        if (other) {
          throw new DesignError(
            409,
            'CONFLICT',
            'clientJobId already used with a different payload',
          );
        }
        throw error;
      }

      const leaseToken = randomUUID();
      const claimed = await Job.findOneAndUpdate(
        {
          id: created.id,
          status: 'queued',
          $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $exists: false } }],
        },
        {
          $set: {
            status: 'submitting',
            leaseOwner: workerId,
            leaseToken,
            leaseExpiresAt: new Date(now().getTime() + leaseMs),
          },
        },
        { new: true },
      ).lean<DesignGenerationJobDoc>();

      if (!claimed) {
        return toView(await loadById(created.id));
      }

      return toView(await dispatchQueued(claimed, leaseToken));
    },

    async get(principal, jobId) {
      const actor = principalId(principal);
      const doc = await loadById(requireToken(jobId, 'jobId'));
      await options.authorizeDocument(actor, doc.documentId, false);
      if (doc.principalId !== actor) {
        await options.authorizeDocument(actor, doc.documentId, false);
      }
      return toView(doc);
    },

    async list(principal, documentId) {
      const actor = principalId(principal);
      const docId = requireToken(documentId, 'documentId');
      await options.authorizeDocument(actor, docId, false);
      const docs = await Job.find({ documentId: docId })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean<DesignGenerationJobDoc[]>();
      return docs.map(toView);
    },

    async requestCancel(principal, jobId) {
      const actor = principalId(principal);
      const doc = await loadById(requireToken(jobId, 'jobId'));
      await options.authorizeDocument(actor, doc.documentId, true);
      if (doc.status === 'queued' && !doc.providerJobId) {
        const cancelled = await Job.findOneAndUpdate(
          {
            id: doc.id,
            status: 'queued',
            $or: [{ providerJobId: { $exists: false } }, { providerJobId: null }],
          },
          { $set: { cancelRequested: true, status: 'cancelled', applied: false, ...clearLease } },
          { new: true },
        ).lean<DesignGenerationJobDoc>();
        if (cancelled) {
          return toView(cancelled);
        }
      }
      const updated = await Job.findOneAndUpdate(
        { id: doc.id },
        { $set: { cancelRequested: true } },
        { new: true },
      ).lean<DesignGenerationJobDoc>();
      if (!updated) {
        throw new DesignError(404, 'NOT_FOUND', 'Not found');
      }
      return toView(updated);
    },

    async claimAndProcessNext() {
      const claimed = await claimNext();
      if (!claimed) {
        return null;
      }
      if (claimed.action === 'dispatch') {
        return toView(await dispatchQueued(claimed.doc, claimed.leaseToken));
      }
      return toView(await pollSubmitted(claimed.doc, claimed.leaseToken));
    },
  };
}
