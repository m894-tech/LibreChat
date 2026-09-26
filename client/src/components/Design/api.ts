import axios from 'axios';
import { request } from 'librechat-data-provider';
import type {
  DesignCapabilities,
  DesignDocument,
  DesignError,
  DesignProject,
  DesignProposal,
  DesignSystemPackage,
  HttpErrorBody,
  OperationEnvelope,
} from './types';
import { DESIGN_API_BASE, MAX_IMAGE_BYTES } from './constants';
import { R1_SYSTEMS, adaptSystems } from './systems';

interface RequestLike {
  get: <T>(url: string, options?: Record<string, unknown>) => Promise<T>;
  post: <T>(url: string, data?: unknown, options?: Record<string, unknown>) => Promise<T>;
  patch: <T>(url: string, data?: unknown, options?: Record<string, unknown>) => Promise<T>;
  getResponse?: <T>(url: string, options?: Record<string, unknown>) => Promise<T>;
}

const http = request as unknown as RequestLike;

function encode(id: string): string {
  return encodeURIComponent(id);
}

export function parseDesignError(error: unknown): DesignError {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { status?: number; data?: HttpErrorBody } }).response;
    const status = response?.status ?? 0;
    const data = response?.data;
    return {
      status,
      code: data?.code ?? (status === 409 ? 'revision_mismatch' : 'http_error'),
      message: data?.message ?? 'Ошибка запроса',
      revision: data?.revision,
    };
  }
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const item = error as { status?: number; code?: string; message?: string; revision?: number };
    return {
      status: item.status ?? 0,
      code: item.code ?? 'http_error',
      message: item.message ?? 'Ошибка запроса',
      revision: item.revision,
    };
  }
  if (error instanceof Error) {
    return { status: 0, code: 'network', message: error.message };
  }
  return { status: 0, code: 'network', message: 'Неизвестная ошибка сети' };
}

export const designApi = {
  async listSystems(): Promise<{ systems: DesignSystemPackage[]; source: 'server' | 'bundled' }> {
    try {
      const result = await http.get<{ systems: unknown }>(DESIGN_API_BASE + '/systems');
      const systems = adaptSystems(result?.systems);
      return { systems, source: 'server' };
    } catch (error) {
      const parsed = parseDesignError(error);
      if (parsed.status === 404 || parsed.status === 0) {
        return { systems: R1_SYSTEMS, source: 'bundled' };
      }
      throw parsed;
    }
  },

  async listProjects(): Promise<DesignProject[]> {
    const result = await http.get<{ projects: DesignProject[] }>(DESIGN_API_BASE + '/projects');
    return result.projects ?? [];
  },

  async createProject(name: string): Promise<DesignProject> {
    const result = await http.post<{ project: DesignProject }>(DESIGN_API_BASE + '/projects', {
      name,
    });
    return result.project;
  },

  async listDocuments(projectId: string): Promise<DesignDocument[]> {
    const result = await http.get<{ documents: DesignDocument[] }>(
      DESIGN_API_BASE + '/projects/' + encode(projectId) + '/documents',
    );
    return result.documents ?? [];
  },

  async getDocument(documentId: string): Promise<DesignDocument> {
    const result = await http.get<{ document: DesignDocument }>(
      DESIGN_API_BASE + '/documents/' + encode(documentId),
    );
    return result.document;
  },

  async createDocument(
    projectId: string,
    body: {
      title: string;
      kind: 'canvas';
      designSystem: { id: string; version: string };
      payload: DesignDocument['payload'];
    },
  ): Promise<DesignDocument> {
    const result = await http.post<{ document: DesignDocument }>(
      DESIGN_API_BASE + '/projects/' + encode(projectId) + '/documents',
      body,
    );
    return result.document;
  },

  async applyOperations(documentId: string, envelope: OperationEnvelope): Promise<DesignDocument> {
    const result = await http.post<{ document: DesignDocument }>(
      DESIGN_API_BASE + '/documents/' + encode(documentId) + '/operations',
      envelope,
    );
    return result.document;
  },

  async restore(
    documentId: string,
    expectedRevision: number,
    revision: number,
    operationId: string,
  ): Promise<DesignDocument> {
    const result = await http.post<{ document: DesignDocument }>(
      DESIGN_API_BASE + '/documents/' + encode(documentId) + '/restore',
      { expectedRevision, revision, operationId },
    );
    return result.document;
  },

  async generateProposal(
    documentId: string,
    baseRevision: number,
    prompt: string,
    scope: string[],
  ): Promise<{ job: { id: string; status: string; error?: { message: string } } }> {
    return http.post(DESIGN_API_BASE + '/documents/' + encode(documentId) + '/jobs', {
      clientJobId: crypto.randomUUID(),
      capability: 'textProposal',
      payload: { prompt, scope, baseRevision },
    });
  },
  async generateImage(
    documentId: string,
    baseRevision: number,
    prompt: string,
    scope: string[],
  ): Promise<{ job: { id: string; status: string; error?: { message: string } } }> {
    return http.post(DESIGN_API_BASE + '/documents/' + encode(documentId) + '/jobs', {
      clientJobId: crypto.randomUUID(),
      capability: 'imageGeneration',
      payload: { prompt, scope, baseRevision },
    });
  },
  async listDocumentDrafts(
    documentId: string,
  ): Promise<Array<{ id: string; status: string; snapshot: DesignDocument; error?: string }>> {
    return (
      await http.get<{
        drafts: Array<{ id: string; status: string; snapshot: DesignDocument; error?: string }>;
      }>(DESIGN_API_BASE + '/documents/' + encode(documentId) + '/generation-drafts')
    ).drafts;
  },
  async outpaint(
    documentId: string,
    nodeId: string,
    expectedRevision: number,
    prompt: string,
    padding: number,
  ): Promise<{ status: string }> {
    return http.post(DESIGN_API_BASE + '/documents/' + encode(documentId) + '/outpaint', {
      clientId: crypto.randomUUID(),
      nodeId,
      expectedRevision,
      prompt,
      left: padding,
      right: padding,
      top: padding,
      bottom: padding,
    });
  },
  async resizeProposal(
    documentId: string,
    nodeId: string,
    expectedRevision: number,
    scale: 2 | 4,
  ): Promise<void> {
    await http.post(DESIGN_API_BASE + '/documents/' + encode(documentId) + '/resize-proposal', {
      nodeId,
      expectedRevision,
      scale,
    });
  },
  async imageEditJobs(
    documentId: string,
  ): Promise<Array<{ id: string; kind: string; status: string; proposalId?: string }>> {
    return (
      await http.get<{
        jobs: Array<{ id: string; kind: string; status: string; proposalId?: string }>;
      }>(DESIGN_API_BASE + '/documents/' + encode(documentId) + '/image-edit-jobs')
    ).jobs;
  },
  async inpaint(
    documentId: string,
    nodeId: string,
    revision: number,
    prompt: string,
    mask: Blob,
  ): Promise<{ id: string; status: string; proposalId?: string }> {
    const query = new URLSearchParams({
      nodeId,
      revision: String(revision),
      clientId: crypto.randomUUID(),
    });
    return (
      await axios.post(
        DESIGN_API_BASE + '/documents/' + encode(documentId) + '/inpaint?' + query,
        mask,
        {
          headers: { 'Content-Type': 'image/png', 'X-Design-Prompt': encodeURIComponent(prompt) },
          timeout: 100000,
        },
      )
    ).data;
  },
  async regionProposal(
    documentId: string,
    nodeId: string,
    revision: number,
    candidateAssetId: string,
    candidateVersion: number,
    mask: Blob,
  ): Promise<void> {
    const query = new URLSearchParams({
      nodeId,
      revision: String(revision),
      candidateAssetId,
      candidateVersion: String(candidateVersion),
    });
    await axios.post(
      DESIGN_API_BASE + '/documents/' + encode(documentId) + '/region-proposal?' + query,
      mask,
      { headers: { 'Content-Type': 'image/png' } },
    );
  },
  async draftProposal(id: string): Promise<DesignProposal> {
    return (
      await http.post<{ proposal: DesignProposal }>(
        DESIGN_API_BASE + '/generation-drafts/' + encode(id) + '/proposal',
        {},
      )
    ).proposal;
  },
  async listGenerationJobs(
    documentId: string,
  ): Promise<import('./generation-jobs').GenerationJobView[]> {
    return (
      await http.get<{ jobs: import('./generation-jobs').GenerationJobView[] }>(
        DESIGN_API_BASE + '/documents/' + encode(documentId) + '/jobs',
      )
    ).jobs;
  },
  async cancelGenerationJob(jobId: string): Promise<void> {
    await http.post(DESIGN_API_BASE + '/jobs/' + encode(jobId) + '/cancel', {});
  },
  async imageProposal(jobId: string, nodeId: string): Promise<DesignProposal> {
    return (
      await http.post<{ proposal: DesignProposal }>(
        DESIGN_API_BASE + '/jobs/' + encode(jobId) + '/image-proposal',
        { nodeId },
      )
    ).proposal;
  },
  async materializeProposal(jobId: string): Promise<DesignProposal> {
    return (
      await http.post<{ proposal: DesignProposal }>(
        DESIGN_API_BASE + '/jobs/' + encode(jobId) + '/proposal',
        {},
      )
    ).proposal;
  },
  async importPackage(
    projectId: string,
    file: File,
    allowBrandPublish = false,
  ): Promise<DesignDocument> {
    if (file.size > 50 * 1024 * 1024) throw new Error('ZIP больше 50 МиБ');
    return (
      await axios.post<{ document: DesignDocument }>(
        DESIGN_API_BASE +
          '/projects/' +
          encode(projectId) +
          '/import-package?allowBrandPublish=' +
          String(allowBrandPublish),
        await file.arrayBuffer(),
        { headers: { 'Content-Type': 'application/zip' } },
      )
    ).data.document;
  },
  async importSource(projectId: string, source: unknown): Promise<DesignDocument> {
    return (
      await http.post<{ document: DesignDocument }>(
        DESIGN_API_BASE + '/projects/' + encode(projectId) + '/import',
        source,
      )
    ).document;
  },
  async updateProject(
    projectId: string,
    patch: {
      name?: string;
      archived?: boolean;
      members?: Record<string, string | null>;
      revoke?: string[];
    },
  ): Promise<DesignProject> {
    return (
      await http.patch<{ project: DesignProject }>(
        DESIGN_API_BASE + '/projects/' + encode(projectId),
        patch,
      )
    ).project;
  },
  async updateDocument(
    documentId: string,
    patch: { title?: string; archived?: boolean; expectedRevision: number },
  ): Promise<DesignDocument> {
    return (
      await http.patch<{ document: DesignDocument }>(
        DESIGN_API_BASE + '/documents/' + encode(documentId),
        patch,
      )
    ).document;
  },
  async duplicateDocument(documentId: string): Promise<DesignDocument> {
    return (
      await http.post<{ document: DesignDocument }>(
        DESIGN_API_BASE + '/documents/' + encode(documentId) + '/duplicate',
        {},
      )
    ).document;
  },
  async listProposals(documentId: string): Promise<DesignProposal[]> {
    const result = await http.get<{ proposals: DesignProposal[] }>(
      DESIGN_API_BASE + '/documents/' + encode(documentId) + '/proposals',
    );
    return result.proposals ?? [];
  },

  async createProposal(
    documentId: string,
    body: {
      baseRevision: number;
      declaredScope: string[];
      operations: OperationEnvelope['operations'];
      summary: string;
    },
  ): Promise<DesignProposal> {
    const result = await http.post<{ proposal: DesignProposal }>(
      DESIGN_API_BASE + '/documents/' + encode(documentId) + '/proposals',
      body,
    );
    return result.proposal;
  },

  async acceptProposal(proposalId: string): Promise<DesignDocument> {
    const result = await http.post<{ document: DesignDocument }>(
      DESIGN_API_BASE + '/proposals/' + encode(proposalId) + '/accept',
      {},
    );
    return result.document;
  },

  async rejectProposal(proposalId: string): Promise<DesignProposal> {
    const result = await http.post<{ proposal: DesignProposal }>(
      DESIGN_API_BASE + '/proposals/' + encode(proposalId) + '/reject',
      {},
    );
    return result.proposal;
  },

  async uploadAsset(file: File, projectId: string): Promise<{ assetId: string; version: number }> {
    if (file.size > MAX_IMAGE_BYTES) {
      throw { status: 413, code: 'too_large', message: 'Файл больше 10MB' } satisfies DesignError;
    }
    const mime = file.type || 'image/png';
    const bytes = await file.arrayBuffer();
    const url = DESIGN_API_BASE + '/projects/' + encode(projectId) + '/assets';
    // Same axios singleton as LibreChat request.ts; existing auth interceptors apply.
    // request.post JSON-serializes unconditionally, so do not send binary there or retry blindly.
    const response = await axios.post(url, bytes, { headers: { 'Content-Type': mime } });
    const result = response.data;
    return {
      assetId: result.asset?.id ?? result.asset?.assetId ?? result.assetId ?? '',
      version: result.asset?.version ?? result.version ?? 1,
    };
  },

  async getAssetBytes(assetId: string, version = 1): Promise<Blob> {
    const url =
      DESIGN_API_BASE +
      '/assets/' +
      encode(assetId) +
      '/bytes?version=' +
      encodeURIComponent(String(version));
    if (typeof http.getResponse === 'function') {
      const response = await http.getResponse<{ data?: Blob } | Blob>(url, {
        responseType: 'blob',
      });
      if (response instanceof Blob) {
        return response;
      }
      if (
        response &&
        typeof response === 'object' &&
        'data' in response &&
        response.data instanceof Blob
      ) {
        return response.data;
      }
    }
    const data = await http.get<Blob | ArrayBuffer>(url, { responseType: 'blob' });
    if (data instanceof Blob) {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return new Blob([data]);
    }
    const response = await axios.get<Blob>(url, { responseType: 'blob' });
    return response.data;
  },

  async getSourcePackage(documentId: string, revision: number): Promise<Blob> {
    return http.get<Blob>(
      DESIGN_API_BASE + '/documents/' + encode(documentId) + '/package?revision=' + revision,
      { responseType: 'blob' },
    );
  },
  async reviewComments(
    id: string,
  ): Promise<Array<{ id: string; text: string; revision: number; nodeId: string | null }>> {
    return (
      await http.get<{
        comments: Array<{ id: string; text: string; revision: number; nodeId: string | null }>;
      }>(DESIGN_API_BASE + '/documents/' + encode(id) + '/comments')
    ).comments;
  },
  async approvalStatus(id: string): Promise<{ isCurrentApproved: boolean; headRevision: number }> {
    return http.get(DESIGN_API_BASE + '/documents/' + encode(id) + '/approval');
  },
  async addReviewComment(
    id: string,
    body: { revision: number; text: string; nodeId?: string },
  ): Promise<void> {
    await http.post(DESIGN_API_BASE + '/documents/' + encode(id) + '/comments', body);
  },
  async approveRevision(id: string, revision: number): Promise<void> {
    await http.post(DESIGN_API_BASE + '/documents/' + encode(id) + '/approval', { revision });
  },
  async getReferenceLock(id: string): Promise<{ lock: any; researchAvailable: boolean }> {
    return http.get(DESIGN_API_BASE + '/documents/' + encode(id) + '/reference-lock');
  },
  async saveReferenceLock(id: string, body: unknown): Promise<{ lock: any }> {
    return http.post(DESIGN_API_BASE + '/documents/' + encode(id) + '/reference-lock', body);
  },
  async researchReferences(
    id: string,
    body: { kind: string; query: string },
  ): Promise<{ references: any[] }> {
    return http.post(DESIGN_API_BASE + '/documents/' + encode(id) + '/research', body);
  },
  async svgExport(id: string, revision: number): Promise<string> {
    return http.get(
      DESIGN_API_BASE + '/documents/' + encode(id) + '/svg-export?revision=' + revision,
    );
  },
  async listPresentationSends(
    documentId: string,
  ): Promise<import('./presentation-sends-panel').PresentationSendView[]> {
    return (
      await http.get<{ sends: import('./presentation-sends-panel').PresentationSendView[] }>(
        DESIGN_API_BASE + '/documents/' + encode(documentId) + '/presentation-sends',
      )
    ).sends;
  },
  async reconcilePresentationSend(
    id: string,
  ): Promise<import('./presentation-sends-panel').PresentationSendView> {
    return (
      await http.post<{ send: import('./presentation-sends-panel').PresentationSendView }>(
        DESIGN_API_BASE + '/presentation-sends/' + encode(id) + '/reconcile',
        {},
      )
    ).send;
  },
  async sendPresentation(
    documentId: string,
    sourceRevision: number,
    destinationId: string,
    destinationRevision: number,
    png: Blob,
    targetSlideId?: string,
  ): Promise<{ status: string; slideId?: string }> {
    const q = new URLSearchParams({
      operationId: crypto.randomUUID(),
      sourceRevision: String(sourceRevision),
      destinationId,
      destinationRevision: String(destinationRevision),
      ...(targetSlideId ? { targetSlideId } : {}),
    });
    return (
      await axios.post(
        DESIGN_API_BASE + '/documents/' + encode(documentId) + '/send-presentation?' + q,
        png,
        { headers: { 'Content-Type': 'image/png' }, timeout: 35000 },
      )
    ).data;
  },
  async rasterOfficeExport(
    documentId: string,
    revision: number,
    format: 'pdf' | 'pptx',
    png: Blob,
  ): Promise<Blob> {
    return (
      await axios.post(
        DESIGN_API_BASE +
          '/documents/' +
          encode(documentId) +
          '/raster-office-export?revision=' +
          revision +
          '&format=' +
          format,
        png,
        { headers: { 'Content-Type': 'image/png' }, responseType: 'blob' },
      )
    ).data;
  },
  async rasterExport(
    documentId: string,
    revision: number,
    format: 'jpeg' | 'webp',
    png: Blob,
  ): Promise<Blob> {
    return (
      await axios.post(
        DESIGN_API_BASE +
          '/documents/' +
          encode(documentId) +
          '/raster-export?revision=' +
          revision +
          '&format=' +
          format,
        png,
        { headers: { 'Content-Type': 'image/png' }, responseType: 'blob' },
      )
    ).data;
  },
  async exportPageHTML(id: string): Promise<string> {
    return http.get(DESIGN_API_BASE + '/pages/' + encode(id) + '/export-html');
  },
  async pageHistory(id: string): Promise<Array<{ revision: number; actor: string }>> {
    return (
      await http.get<{ revisions: Array<{ revision: number; actor: string }> }>(
        DESIGN_API_BASE + '/pages/' + encode(id) + '/revisions',
      )
    ).revisions;
  },
  async restorePage(id: string, expectedRevision: number, revision: number): Promise<any> {
    return (
      await http.post<{ page: any }>(DESIGN_API_BASE + '/pages/' + encode(id) + '/restore', {
        operationId: crypto.randomUUID(),
        expectedRevision,
        revision,
      })
    ).page;
  },
  async applyPageBrand(
    id: string,
    expectedRevision: number,
    brandId: string,
    brandVersion: string,
  ): Promise<any> {
    return (
      await http.post<{ page: any }>(DESIGN_API_BASE + '/pages/' + encode(id) + '/brand', {
        operationId: crypto.randomUUID(),
        expectedRevision,
        brandId,
        brandVersion,
      })
    ).page;
  },
  async applyPageSystem(id: string, expectedRevision: number, systemId: string): Promise<any> {
    return (
      await http.post<{ page: any }>(DESIGN_API_BASE + '/pages/' + encode(id) + '/system', {
        operationId: crypto.randomUUID(),
        expectedRevision,
        systemId,
        systemVersion: '1.0.0',
      })
    ).page;
  },
  async listPages(projectId: string): Promise<any[]> {
    return (
      await http.get<{ pages: any[] }>(
        DESIGN_API_BASE + '/projects/' + encode(projectId) + '/pages',
      )
    ).pages;
  },
  async createPage(projectId: string, document: unknown): Promise<any> {
    return (
      await http.post<{ page: any }>(
        DESIGN_API_BASE + '/projects/' + encode(projectId) + '/pages',
        { document },
      )
    ).page;
  },
  async getPage(id: string): Promise<any> {
    return (await http.get<{ page: any }>(DESIGN_API_BASE + '/pages/' + encode(id))).page;
  },
  async applyPage(id: string, body: unknown): Promise<any> {
    return (
      await http.post<{ page: any }>(DESIGN_API_BASE + '/pages/' + encode(id) + '/operations', body)
    ).page;
  },
  async brandProposal(
    documentId: string,
    revision: number,
    brandId: string,
    brandVersion: string,
  ): Promise<void> {
    await http.post(DESIGN_API_BASE + '/documents/' + encode(documentId) + '/brand-proposal', {
      expectedRevision: revision,
      brandId,
      brandVersion,
      preserveOverrides: true,
    });
  },
  async projectSystems(projectId: string): Promise<DesignSystemPackage[]> {
    return adaptSystems(
      (
        await http.get<{ systems: unknown[] }>(
          DESIGN_API_BASE + '/projects/' + encode(projectId) + '/systems',
        )
      ).systems,
    );
  },
  async bindBrand(
    id: string,
    revision: number,
    brandId: string,
    brandVersion: string,
  ): Promise<DesignDocument> {
    return (
      await http.post<{ document: DesignDocument }>(
        DESIGN_API_BASE + '/documents/' + encode(id) + '/bind-brand',
        {
          operationId: crypto.randomUUID(),
          expectedRevision: revision,
          brandId,
          brandVersion,
          preserveOverrides: true,
        },
      )
    ).document;
  },
  async systemCandidates(): Promise<any[]> {
    return (await http.get<{ packages: any[] }>(DESIGN_API_BASE + '/system-candidates')).packages;
  },
  async installSystemCandidate(projectId: string, id: string): Promise<void> {
    await http.post(
      DESIGN_API_BASE + '/projects/' + encode(projectId) + '/install-system-candidate',
      { id },
    );
  },
  async listBrands(id: string): Promise<any[]> {
    return (
      await http.get<{ brands: any[] }>(DESIGN_API_BASE + '/projects/' + encode(id) + '/brands')
    ).brands;
  },
  async publishBrand(id: string, body: unknown): Promise<void> {
    await http.post(DESIGN_API_BASE + '/projects/' + encode(id) + '/brands', body);
  },
  async listHistory(
    documentId: string,
  ): Promise<Array<{ revision: number; actorId: string; createdAt: string }>> {
    return (
      await http.get<{
        revisions: Array<{ revision: number; actorId: string; createdAt: string }>;
      }>(DESIGN_API_BASE + '/documents/' + encode(documentId) + '/revisions')
    ).revisions;
  },
  async getSource(documentId: string, revision: number): Promise<unknown> {
    return http.get(
      DESIGN_API_BASE +
        '/documents/' +
        encode(documentId) +
        '/source?revision=' +
        encodeURIComponent(String(revision)),
    );
  },

  async probeCapabilities(): Promise<DesignCapabilities> {
    try {
      const result = await http.get<Partial<DesignCapabilities> & { reason?: string }>(
        DESIGN_API_BASE + '/capabilities',
      );
      return {
        presentationSend: result.presentationSend === true,
        inpaint: result.inpaint === true,
        documentDraft: result.documentDraft === true,
        textPrompt: result.textPrompt === true,
        textProposal: result.textProposal === true,
        imageUpload: result.imageUpload !== false,
        imageGenerate: result.imageGenerate === true,
        imageGeneration: result.imageGeneration === true,
        exports: Array.isArray(result.exports) ? result.exports : ['source', 'png-client'],
        proposals: result.proposals !== false,
        restore: result.restore !== false,
        source: 'server',
        reason: result.reason,
      };
    } catch (error) {
      const parsed = parseDesignError(error);
      if (parsed.status !== 404 && parsed.status !== 0) {
        throw parsed;
      }
      return {
        textPrompt: false,
        textProposal: false,
        imageUpload: false,
        imageGenerate: false,
        imageGeneration: false,
        exports: [],
        proposals: true,
        restore: true,
        source: 'unavailable',
      };
    }
  },
};

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
