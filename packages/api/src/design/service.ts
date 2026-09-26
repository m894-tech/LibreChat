import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type {
  DesignConnection,
  DesignStore,
  OperationEnvelope,
  ProjectPatch,
  RestoreInput,
} from './store';
import type { DesignOperation as DesignOp } from './types';
import { systemsCatalog, getSystem } from './systems';
import { createDesignStore } from './store';
import { DesignError } from './errors';

export const DESIGN_SYSTEMS: typeof systemsCatalog = systemsCatalog;

export type DesignProvider = {
  isAvailable?: () => boolean;
  generate?: (input: unknown) => Promise<unknown>;
};

export type DesignServiceOptions = {
  assetDir?: string;
  provider?: DesignProvider;
};

export function createDesignService(
  connection: DesignConnection,
  options: DesignServiceOptions = {},
): {
  store: {
    models: import('./models').DesignModels;
    connection: import('mongoose').Connection;
    withProjectWrite<T>(
      userId: string,
      projectId: string,
      work: (session: import('mongoose').ClientSession) => Promise<T>,
    ): Promise<T>;
    listProjects(userId: string): Promise<import('./store').SerializedProject[]>;
    createProject(userId: string, name: string): Promise<import('./store').SerializedProject>;
    updateProject(
      userId: string,
      projectId: string,
      patch: ProjectPatch,
    ): Promise<import('./store').SerializedProject>;
    listDocuments(
      userId: string,
      projectId: string,
    ): Promise<import('./store').SerializedDocument[]>;
    createDocument(
      userId: string,
      projectId: string,
      input: import('./store').CreateDocumentInput,
      session?: import('mongoose').ClientSession,
    ): Promise<import('./store').SerializedDocument>;
    getDocument(userId: string, documentId: string): Promise<import('./store').SerializedDocument>;
    updateDocument(
      userId: string,
      documentId: string,
      patch: {
        title?: string;
        archived?: boolean;
        expectedRevision?: number;
      },
    ): Promise<import('./store').SerializedDocument>;
    applyDocumentOperations(
      userId: string,
      documentId: string,
      envelope: OperationEnvelope,
      extras?: {
        agent?: boolean;
        authorizedScope?: string[];
      },
    ): Promise<import('./store').ApplyResult>;
    listRevisions(
      userId: string,
      documentId: string,
    ): Promise<import('./store').SerializedRevision[]>;
    restoreDocument(
      userId: string,
      documentId: string,
      input: RestoreInput,
    ): Promise<import('./store').ApplyResult>;
    listProposals(
      userId: string,
      documentId: string,
    ): Promise<import('./store').SerializedProposal[]>;
    createProposal(
      userId: string,
      documentId: string,
      input: import('./store').ProposalInput,
    ): Promise<import('./store').SerializedProposal>;
    acceptProposal(
      userId: string,
      proposalId: string,
    ): Promise<
      import('./store').ApplyResult & {
        proposal: import('./store').SerializedProposal;
      }
    >;
    rejectProposal(
      userId: string,
      proposalId: string,
    ): Promise<import('./store').SerializedProposal>;
    getProposalDocumentId(proposalId: string): Promise<string | null>;
    createSourceExport(
      userId: string,
      documentId: string,
      revision: number,
      filePath: string,
    ): Promise<import('./models').DesignExportRecord>;
    getRevisionSnapshot(
      userId: string,
      documentId: string,
      revision: number,
    ): Promise<import('./models').DesignRevisionRecord['snapshot']>;
    getExport(userId: string, exportId: string): Promise<import('./models').DesignExportRecord>;
  };
  listProjects(userId: string): Promise<import('./store').SerializedProject[]>;
  createProject(
    userId: string,
    body: {
      name?: string;
    },
  ): Promise<import('./store').SerializedProject>;
  updateProject(
    userId: string,
    projectId: string,
    patch: ProjectPatch,
  ): Promise<import('./store').SerializedProject>;
  listDocuments(userId: string, projectId: string): Promise<import('./store').SerializedDocument[]>;
  createDocument(
    userId: string,
    projectId: string,
    body: {
      title?: string;
      kind?: string;
      payload?: unknown;
      designSystem?: unknown;
    },
  ): Promise<import('./store').SerializedDocument>;
  getDocument(userId: string, documentId: string): Promise<import('./store').SerializedDocument>;
  updateDocument(
    userId: string,
    documentId: string,
    patch: {
      title?: string;
      archived?: boolean;
      expectedRevision?: number;
    },
  ): Promise<import('./store').SerializedDocument>;
  applyOperations(
    userId: string,
    documentId: string,
    envelope: OperationEnvelope,
  ): Promise<import('./store').ApplyResult>;
  listRevisions(
    userId: string,
    documentId: string,
  ): Promise<import('./store').SerializedRevision[]>;
  restoreDocument(
    userId: string,
    documentId: string,
    input: RestoreInput,
  ): Promise<import('./store').ApplyResult>;
  listProposals(
    userId: string,
    documentId: string,
  ): Promise<import('./store').SerializedProposal[]>;
  createProposal(
    userId: string,
    documentId: string,
    body: {
      summary?: string;
      declaredScope?: string[];
      operations?: DesignOp[];
      baseRevision?: number;
    },
  ): Promise<import('./store').SerializedProposal>;
  acceptProposal(
    userId: string,
    proposalId: string,
  ): Promise<
    import('./store').ApplyResult & {
      proposal: import('./store').SerializedProposal;
    }
  >;
  rejectProposal(userId: string, proposalId: string): Promise<import('./store').SerializedProposal>;
  listSystems(): {
    id: import('./systems').AllowedSystemId;
    version: string;
    name: string;
    tokens: Record<string, import('./systems').DesignToken>;
    fonts: readonly string[];
  }[];
  exportDocument(
    userId: string,
    documentId: string,
    body: {
      revision?: number;
      format?: string;
    },
  ): Promise<{
    id: string;
    documentId: string;
    revision: number;
    format: 'source';
    path: string;
    downloadPath: string;
  }>;
  getExport(userId: string, exportId: string): Promise<import('./models').DesignExportRecord>;
  getSource(
    userId: string,
    documentId: string,
    revision: number,
  ): Promise<{
    documentId: string;
    revision: number;
    format: 'source';
    snapshot: {
      archived?: boolean;
      title: string;
      kind: 'canvas';
      schemaVersion: number;
      designSystem: {
        id: string;
        version: string;
      };
      payload: {
        width: number;
        height: number;
        nodes: unknown[];
      };
      assetRefs: {
        assetId: string;
        version: number;
      }[];
    };
  }>;
  providerCapability(): DesignProvider;
} {
  const store: DesignStore = createDesignStore(connection, { assetDir: options.assetDir });
  const assetDir = options.assetDir ?? path.join(process.cwd(), '.design-assets');
  const provider = options.provider;

  return {
    store,

    listProjects(userId: string) {
      return store.listProjects(userId);
    },

    createProject(userId: string, body: { name?: string }) {
      return store.createProject(userId, body?.name ?? '');
    },

    updateProject(userId: string, projectId: string, patch: ProjectPatch) {
      return store.updateProject(userId, projectId, patch);
    },

    listDocuments(userId: string, projectId: string) {
      return store.listDocuments(userId, projectId);
    },

    createDocument(
      userId: string,
      projectId: string,
      body: { title?: string; kind?: string; payload?: unknown; designSystem?: unknown },
    ) {
      if (body == null || typeof body !== 'object') {
        throw new DesignError('validation', 'Document body is required');
      }
      return store.createDocument(userId, projectId, {
        title: body.title as string,
        kind: body.kind,
        payload: body.payload as never,
        designSystem: body.designSystem as never,
      });
    },

    getDocument(userId: string, documentId: string) {
      return store.getDocument(userId, documentId);
    },

    updateDocument(
      userId: string,
      documentId: string,
      patch: { title?: string; archived?: boolean; expectedRevision?: number },
    ) {
      return store.updateDocument(userId, documentId, patch);
    },

    applyOperations(userId: string, documentId: string, envelope: OperationEnvelope) {
      return store.applyDocumentOperations(userId, documentId, envelope);
    },

    listRevisions(userId: string, documentId: string) {
      return store.listRevisions(userId, documentId);
    },

    restoreDocument(userId: string, documentId: string, input: RestoreInput) {
      return store.restoreDocument(userId, documentId, input);
    },

    listProposals(userId: string, documentId: string) {
      return store.listProposals(userId, documentId);
    },

    createProposal(
      userId: string,
      documentId: string,
      body: {
        summary?: string;
        declaredScope?: string[];
        operations?: DesignOp[];
        baseRevision?: number;
      },
    ) {
      return store.createProposal(userId, documentId, {
        summary: body?.summary as string,
        declaredScope: body?.declaredScope as string[],
        operations: body?.operations as DesignOp[],
        baseRevision: body?.baseRevision as number,
      });
    },

    acceptProposal(userId: string, proposalId: string) {
      return store.acceptProposal(userId, proposalId);
    },

    rejectProposal(userId: string, proposalId: string) {
      return store.rejectProposal(userId, proposalId);
    },

    listSystems() {
      return DESIGN_SYSTEMS.map((system) => ({ ...system }));
    },

    async exportDocument(
      userId: string,
      documentId: string,
      body: { revision?: number; format?: string },
    ) {
      if (body?.format != null && body.format !== 'source') {
        throw new DesignError('validation', 'Only source export is available');
      }
      if (body?.format !== 'source') {
        throw new DesignError('validation', "format must be 'source'");
      }
      if (!Number.isInteger(body.revision) || (body.revision as number) < 1) {
        throw new DesignError('validation', 'revision is required');
      }
      const snapshot = await store.getRevisionSnapshot(userId, documentId, body.revision as number);
      const exportDir = path.join(assetDir, 'design-exports');
      await mkdir(exportDir, { recursive: true });
      const tempName = `${randomUUID()}-source.json`;
      const filePath = path.join(exportDir, tempName);
      const payload = {
        documentId,
        revision: body.revision,
        format: 'source',
        snapshot,
      };
      await writeFile(filePath, JSON.stringify(payload), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      const record = await store.createSourceExport(
        userId,
        documentId,
        body.revision as number,
        filePath,
      );
      return {
        id: record._id,
        documentId: record.documentId,
        revision: record.revision,
        format: record.format,
        path: `/documents/${documentId}/exports/${record._id}`,
        downloadPath: `/api/design/documents/${documentId}/exports/${record._id}/download`,
      };
    },

    async getExport(userId: string, exportId: string) {
      const record = await store.getExport(userId, exportId);
      return record;
    },

    async getSource(userId: string, documentId: string, revision: number) {
      const snapshot = await store.getRevisionSnapshot(userId, documentId, revision);
      if (!getSystem(snapshot.designSystem.id, snapshot.designSystem.version)) {
        const head = await store.getDocument(userId, documentId);
        const row = await store.connection.collection('design_brand_packages').findOne({
          projectId: head.projectId,
          id: snapshot.designSystem.id,
          version: snapshot.designSystem.version,
        });
        if (!row) throw new DesignError(422, 'system_missing', 'Pinned brand missing');
        return {
          documentId,
          revision,
          format: 'source' as const,
          snapshot,
          customSystems: [row.package],
        };
      }
      return { documentId, revision, format: 'source' as const, snapshot };
    },

    providerCapability() {
      if (
        !provider ||
        typeof provider.generate !== 'function' ||
        provider.isAvailable?.() === false
      ) {
        throw new DesignError('capability_disabled', 'Image provider is disabled');
      }
      return provider;
    },
  };
}

export type DesignService = ReturnType<typeof createDesignService>;
