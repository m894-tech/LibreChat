import { Schema } from 'mongoose';
import type { Connection, Model } from 'mongoose';

export const DESIGN_ROLES = ['owner', 'editor', 'viewer'] as const;
export type DesignMemberRole = (typeof DESIGN_ROLES)[number];

export type DesignProjectRecord = {
  accessFence?: number;
  _id: string;
  name: string;
  ownerId: string;
  members: Map<string, DesignMemberRole>;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type DesignDocumentRecord = {
  _id: string;
  projectId: string;
  kind: 'canvas';
  schemaVersion: number;
  title: string;
  revision: number;
  designSystem: { id: string; version: string };
  payload: { width: number; height: number; nodes: unknown[] };
  assetRefs: { assetId: string; version: number }[];
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type DesignRevisionRecord = {
  _id: string;
  documentId: string;
  projectId: string;
  revision: number;
  actorId: string;
  operationId: string | null;
  snapshot: {
    archived?: boolean;
    title: string;
    kind: 'canvas';
    schemaVersion: number;
    designSystem: { id: string; version: string };
    payload: { width: number; height: number; nodes: unknown[] };
    assetRefs: { assetId: string; version: number }[];
  };
  createdAt: Date;
};

export type DesignOperationRecord = {
  _id: string;
  documentId: string;
  projectId: string;
  operationId: string;
  actorId: string;
  bodyHash: string;
  revisionAfter: number;
  declaredScope: string[];
  operations: unknown[];
  createdAt: Date;
};

export type DesignProposalRecord = {
  _id: string;
  documentId: string;
  projectId: string;
  authorId: string;
  summary: string;
  declaredScope: string[];
  authorizedScope: string[];
  operations: unknown[];
  baseRevision: number;
  status: 'pending' | 'applied' | 'rejected' | 'stale';
  createdAt: Date;
  updatedAt: Date;
};

export type DesignExportRecord = {
  _id: string;
  documentId: string;
  projectId: string;
  actorId: string;
  revision: number;
  format: 'source';
  path: string;
  createdAt: Date;
};

export type DesignModels = {
  DesignProject: Model<DesignProjectRecord>;
  DesignDocument: Model<DesignDocumentRecord>;
  DesignRevision: Model<DesignRevisionRecord>;
  DesignOperation: Model<DesignOperationRecord>;
  DesignProposal: Model<DesignProposalRecord>;
  DesignExport: Model<DesignExportRecord>;
};

const memberRoleSchema = { type: String, enum: DESIGN_ROLES };

const projectSchema = new Schema<DesignProjectRecord>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    ownerId: { type: String, required: true, index: true },
    accessFence: { type: Number, default: 0 },
    members: { type: Map, of: memberRoleSchema, default: () => new Map() },
    archived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, collection: 'design_projects', versionKey: false, minimize: false },
);

projectSchema.index({ ownerId: 1, archived: 1 });
projectSchema.index({ updatedAt: -1 });

const documentSchema = new Schema<DesignDocumentRecord>(
  {
    _id: { type: String, required: true },
    projectId: { type: String, required: true, index: true },
    kind: { type: String, required: true, enum: ['canvas'] },
    schemaVersion: { type: Number, required: true, min: 1 },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    revision: { type: Number, required: true, min: 1 },
    designSystem: {
      id: { type: String, required: true },
      version: { type: String, required: true },
    },
    payload: { type: Schema.Types.Mixed, required: true },
    assetRefs: {
      type: [
        {
          _id: false,
          assetId: { type: String, required: true },
          version: { type: Number, required: true, min: 1 },
        },
      ],
      default: [],
    },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'design_documents', versionKey: false, minimize: false },
);

documentSchema.index({ projectId: 1, archived: 1, updatedAt: -1 });
documentSchema.index({ projectId: 1, title: 1 });

const revisionSchema = new Schema<DesignRevisionRecord>(
  {
    _id: { type: String, required: true },
    documentId: { type: String, required: true },
    projectId: { type: String, required: true },
    revision: { type: Number, required: true, min: 1 },
    actorId: { type: String, required: true },
    operationId: { type: String, default: null },
    snapshot: { type: Schema.Types.Mixed, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'design_revisions',
    versionKey: false,
    minimize: false,
  },
);

revisionSchema.index({ documentId: 1, revision: 1 }, { unique: true });
revisionSchema.index({ projectId: 1, createdAt: -1 });

const operationSchema = new Schema<DesignOperationRecord>(
  {
    _id: { type: String, required: true },
    documentId: { type: String, required: true },
    projectId: { type: String, required: true },
    operationId: { type: String, required: true },
    actorId: { type: String, required: true },
    bodyHash: { type: String, required: true },
    revisionAfter: { type: Number, required: true, min: 1 },
    declaredScope: { type: [String], default: [] },
    operations: { type: [Schema.Types.Mixed], default: [] },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'design_operations',
    versionKey: false,
    minimize: false,
  },
);

operationSchema.index({ documentId: 1, operationId: 1, actorId: 1 }, { unique: true });
operationSchema.index({ documentId: 1, createdAt: -1 });

const proposalSchema = new Schema<DesignProposalRecord>(
  {
    _id: { type: String, required: true },
    documentId: { type: String, required: true, index: true },
    projectId: { type: String, required: true },
    authorId: { type: String, required: true },
    summary: { type: String, required: true, trim: true, maxlength: 500 },
    declaredScope: { type: [String], default: [] },
    authorizedScope: { type: [String], default: [] },
    operations: { type: [Schema.Types.Mixed], required: true },
    baseRevision: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'applied', 'rejected', 'stale'],
      default: 'pending',
    },
  },
  { timestamps: true, collection: 'design_proposals', versionKey: false, minimize: false },
);

proposalSchema.index({ documentId: 1, createdAt: -1 });
proposalSchema.index({ documentId: 1, status: 1 });

const exportSchema = new Schema<DesignExportRecord>(
  {
    _id: { type: String, required: true },
    documentId: { type: String, required: true, index: true },
    projectId: { type: String, required: true },
    actorId: { type: String, required: true },
    revision: { type: Number, required: true, min: 1 },
    format: { type: String, required: true, enum: ['source'] },
    path: { type: String, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'design_exports',
    versionKey: false,
    minimize: false,
  },
);

exportSchema.index({ documentId: 1, revision: 1, format: 1 });

const MODEL_CACHE = new WeakMap<object, DesignModels>();

export function createDesignModels(connection: Connection): DesignModels {
  const cached = MODEL_CACHE.get(connection);
  if (cached) {
    return cached;
  }
  const models: DesignModels = {
    DesignProject: connection.model<DesignProjectRecord>(
      'DesignProject',
      projectSchema,
      'design_projects',
    ),
    DesignDocument: connection.model<DesignDocumentRecord>(
      'DesignDocument',
      documentSchema,
      'design_documents',
    ),
    DesignRevision: connection.model<DesignRevisionRecord>(
      'DesignRevision',
      revisionSchema,
      'design_revisions',
    ),
    DesignOperation: connection.model<DesignOperationRecord>(
      'DesignOperation',
      operationSchema,
      'design_operations',
    ),
    DesignProposal: connection.model<DesignProposalRecord>(
      'DesignProposal',
      proposalSchema,
      'design_proposals',
    ),
    DesignExport: connection.model<DesignExportRecord>(
      'DesignExport',
      exportSchema,
      'design_exports',
    ),
  };
  MODEL_CACHE.set(connection, models);
  return models;
}
