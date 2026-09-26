import path from 'node:path';
import { Router, raw } from 'express';
import type { NextFunction, Request, Response, Router as ExpressRouter } from 'express';
import type { DesignProvider, DesignService } from './service';
import type { ReferenceProvider } from './reference-workflow';
import { UnavailableProvider, type DesignGenerationProvider } from './providers';
import { getMemberRole, sanitizeUserId, type DesignConnection } from './store';
import { createAssetStore, DesignError as AssetError } from './assets';
import { DesignError, isDesignError, statusForCode } from './errors';
import { preparePresentationHandoff } from './presentation-handoff';
import { createRegionEditProposal } from './region-edit-service';
import { createResizeProposal } from './asset-transform-service';
import { importSourcePackage } from './package-import-service';
import { loadProjectSystemResolver } from './project-systems';
import { createPageProposalService } from './page-proposal';
import { extendedSystemPackages } from './extended-systems';
import { createImportAdmission } from './import-admission';
import { createPageAIService } from './page-ai-service';
import { normalizeSourceImport } from './source-import';
import { buildSourcePackage } from './source-package';
import { buildBrandApplication } from './brand-apply';
import { convertRasterExport } from './raster-export';
import { exportCanvasSVG } from './canvas-svg-export';
import { getSystemPassport } from './system-passport';
import { buildPageSystemPatch } from './page-system';
import { loadPackageFonts } from './package-fonts';
import { buildPageBrandPatch } from './page-brand';
import { parseDesignProposal } from './providers';
import { createBrandStore } from './brand-store';
import { createDesignService } from './service';
import { createPageStore } from './page-store';
import { exportPageHTML } from './page-export';
import { createJobService } from './jobs';

export type DesignRouterOptions = {
  connection: DesignConnection;
  enabled: boolean;
  assetDir?: string;
  fontDir?: string;
  presentationTransport?: import('./presenton-adapter').PresentonTransport;
  inpaintProvider?: import('./image-edit-adapter').ImageEditAdapter;
  inpaintBudget?: import('./generation-budget').GenerationBudget;
  referenceProvider?: ReferenceProvider;
  draftService?: import('./generation-draft-service').DraftGenerationService;
  provider?: DesignProvider;
  service?: DesignService;
  generationProvider?: DesignGenerationProvider;
  initializeJobs?: boolean;
  generationReady?: boolean;
  onJobServiceReady?: (service: import('./jobs').JobService) => void;
  checkGenerationBudget?: (input: import('./jobs').BudgetCheckInput) => Promise<void>;
};

type AuthedRequest = Request & {
  user?: { id?: string; _id?: { toString(): string } };
};

export function createDesignRouter(options: DesignRouterOptions): ExpressRouter {
  const router = Router();

  if (!options?.enabled) {
    router.use((_req, res) => {
      res.status(404).json({ code: 'not_found', message: 'Not found' });
    });
    return router;
  }

  const service =
    options.service ??
    createDesignService(options.connection, {
      assetDir: options.assetDir,
      provider: options.provider,
    });

  const notImplemented = (feature: string) => (_req: Request, res: Response) => {
    res.status(501).json({ error: 'not_implemented', feature });
  };
  router.get('/documents/:id/reference-lock', notImplemented('refero'));
  router.post('/documents/:id/reference-lock', notImplemented('refero'));
  router.post('/documents/:id/research', notImplemented('refero'));
  router.get('/documents/:id/comments', notImplemented('approvals'));
  router.post('/documents/:id/comments', notImplemented('approvals'));
  router.get('/documents/:id/approval', notImplemented('approvals'));
  router.post('/documents/:id/approval', notImplemented('approvals'));

  let pagePromise: ReturnType<typeof createPageStore> | undefined;
  const pages = () => (pagePromise ??= createPageStore(service.store));
  router.get(
    '/projects/:id/pages',
    wrap(async (req, res) => {
      res.json({ pages: await (await pages()).list(userId(req), param(req, 'id')) });
    }),
  );
  router.post(
    '/projects/:id/pages',
    wrap(async (req, res) => {
      res.status(201).json({
        page: await (await pages()).create(userId(req), param(req, 'id'), req.body?.document),
      });
    }),
  );
  router.get(
    '/pages/:id',
    wrap(async (req, res) => {
      res.json({ page: await (await pages()).get(userId(req), param(req, 'id')) });
    }),
  );
  router.get(
    '/pages/:id/export-html',
    wrap(async (req, res) => {
      const actor = userId(req),
        id = param(req, 'id');
      const page = await (await pages()).get(actor, id);
      const html = await exportPageHTML(page.document, {
        loadAsset: async (a, v) => {
          const s = await assets();
          return s.getBytes(actor, a, v);
        },
      });
      await (await pages()).get(actor, id);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="page-${id}-r${page.revision}.html"`,
      );
      res.setHeader('Cache-Control', 'private,no-store');
      res.send(html);
    }),
  );
  router.get(
    '/pages/:id/revisions',
    wrap(async (req, res) => {
      res.json({ revisions: await (await pages()).history(userId(req), param(req, 'id')) });
    }),
  );
  router.post(
    '/pages/:id/restore',
    wrap(async (req, res) => {
      res.json({ page: await (await pages()).restore(userId(req), param(req, 'id'), req.body) });
    }),
  );
  router.post(
    '/pages/:id/system',
    wrap(async (req, res) => {
      const actor = userId(req),
        id = param(req, 'id');
      const current = await (await pages()).get(actor, id);
      if (current.revision !== req.body?.expectedRevision)
        throw new DesignError(409, 'revision_mismatch', 'Page changed');
      const patch = buildPageSystemPatch(
        current.document,
        req.body.systemId,
        req.body.systemVersion,
      );
      if (!patch.operations.length) {
        res.json({ page: current, mode: patch.mode });
        return;
      }
      const page = await (
        await pages()
      ).apply(actor, id, {
        operationId: req.body.operationId,
        expectedRevision: current.revision,
        scopeIds: current.document.nodes.map((n) => n.id),
        operations: patch.operations,
      });
      res.json({ page, mode: patch.mode });
    }),
  );
  router.post(
    '/pages/:id/operations',
    wrap(async (req, res) => {
      res.json({ page: await (await pages()).apply(userId(req), param(req, 'id'), req.body) });
    }),
  );
  let brandPromise: ReturnType<typeof createBrandStore> | undefined;
  const brands = () => (brandPromise ??= createBrandStore(service.store));
  router.get(
    '/projects/:id/brands',
    wrap(async (req, res) => {
      res.json({ brands: await (await brands()).list(userId(req), param(req, 'id')) });
    }),
  );
  router.post(
    '/projects/:id/brands',
    wrap(async (req, res) => {
      res
        .status(201)
        .json({ brand: await (await brands()).publish(userId(req), param(req, 'id'), req.body) });
    }),
  );
  router.get(
    '/projects/:id/systems',
    wrap(async (req, res) => {
      const actor = userId(req),
        projectId = param(req, 'id');
      const packages = await (await brands()).list(actor, projectId);
      res.json({ systems: [...service.listSystems(), ...packages.map((p) => p.system)] });
    }),
  );
  router.post(
    '/documents/:id/bind-brand',
    wrap(async (req, res) => {
      const actor = userId(req),
        id = param(req, 'id');
      const doc = await service.getDocument(actor, id);
      const selected = (await (await brands()).list(actor, doc.projectId)).find(
        (b) => b.id === req.body.brandId && b.version === req.body.brandVersion,
      );
      if (!selected) throw new DesignError(404, 'brand_missing', 'Brand missing');
      const result = await service.applyOperations(actor, id, {
        operationId: req.body.operationId,
        expectedRevision: req.body.expectedRevision,
        declaredScope: doc.payload.nodes.map((n) => n.id),
        operations: [
          {
            type: 'applySystem',
            systemId: selected.id,
            systemVersion: selected.version,
            preserveOverrides: req.body.preserveOverrides !== false,
          },
        ],
      });
      res.json({ document: result.document, mode: 'pinned-token-bindings' });
    }),
  );
  router.post(
    '/documents/:id/brand-proposal',
    wrap(async (req, res) => {
      const actor = userId(req),
        id = param(req, 'id');
      const doc = await service.getDocument(actor, id);
      if (doc.revision !== req.body?.expectedRevision)
        throw new DesignError(409, 'revision_mismatch', 'Document changed');
      const published = (await (await brands()).list(actor, doc.projectId)).find(
        (b) => b.id === req.body?.brandId && b.version === req.body?.brandVersion,
      );
      if (!published) throw new DesignError(404, 'not_found', 'Brand package not found');
      const native = {
        id: doc.id,
        projectId: doc.projectId,
        kind: 'canvas' as const,
        schemaVersion: 1 as const,
        title: doc.title,
        revision: doc.revision,
        payload: doc.payload,
        assetRefs: doc.assetRefs,
        designSystem: doc.designSystem,
        archived: doc.archived,
      };
      const result = buildBrandApplication(
        native,
        published.package,
        { preserveOverrides: req.body?.preserveOverrides !== false },
        await loadProjectSystemResolver(service.store.connection, doc.projectId),
      );
      if (!result.operations.length) {
        res.json({ proposal: null, message: 'No bound unlocked properties to change' });
        return;
      }
      const proposal = await service.createProposal(actor, id, {
        baseRevision: doc.revision,
        summary: `Бренд ${result.brandId}@${result.brandVersion} — значения без живой привязки`,
        declaredScope: doc.payload.nodes.map((n) => n.id),
        operations: result.operations,
      });
      res.status(201).json({ proposal, mode: result.mode });
    }),
  );
  router.post(
    '/pages/:id/brand',
    wrap(async (req, res) => {
      const actor = userId(req),
        id = param(req, 'id');
      const current = await (await pages()).get(actor, id);
      if (current.revision !== req.body?.expectedRevision)
        throw new DesignError(409, 'revision_mismatch', 'Page changed');
      const brand = (await (await brands()).list(actor, current.projectId)).find(
        (b) => b.id === req.body.brandId && b.version === req.body.brandVersion,
      );
      if (!brand) throw new DesignError(404, 'not_found', 'Brand not found');
      const patch = buildPageBrandPatch(current.document, brand.package);
      if (!patch.operations.length) {
        res.json({ page: current, mode: patch.mode });
        return;
      }
      const page = await (
        await pages()
      ).apply(actor, id, {
        operationId: req.body.operationId,
        expectedRevision: current.revision,
        scopeIds: current.document.nodes.map((n) => n.id),
        operations: patch.operations,
      });
      res.json({ page, mode: patch.mode });
    }),
  );
  let pageProposalPromise: ReturnType<typeof createPageProposalService> | undefined;
  const pageProposals = () =>
    (pageProposalPromise ??= pages().then((p) => createPageProposalService(service.store, p)));
  router.get(
    '/pages/:id/proposals',
    wrap(async (req, res) => {
      res.json({ proposals: await (await pageProposals()).list(userId(req), param(req, 'id')) });
    }),
  );
  router.post(
    '/pages/:id/proposals',
    wrap(async (req, res) => {
      res.status(201).json({
        proposal: await (await pageProposals()).create(userId(req), param(req, 'id'), req.body),
      });
    }),
  );
  router.post(
    '/page-proposals/:id/accept',
    wrap(async (req, res) => {
      await (await pageProposals()).accept(userId(req), param(req, 'id'));
      res.json({ ok: true });
    }),
  );
  router.post(
    '/page-proposals/:id/reject',
    wrap(async (req, res) => {
      await (await pageProposals()).reject(userId(req), param(req, 'id'));
      res.json({ ok: true });
    }),
  );
  let pageAIPromise: ReturnType<typeof createPageAIService> | undefined;
  const pageAI = () => {
    if (!options.generationReady || !options.generationProvider?.capabilities.textProposal)
      throw new DesignError(422, 'page_ai_unavailable', 'Page AI provider not configured');
    return (pageAIPromise ??= Promise.all([pages(), pageProposals()]).then(([p, proposals]) =>
      createPageAIService(service.store, p, proposals, options.generationProvider!),
    ));
  };
  router.post(
    '/pages/:id/ai-proposals',
    wrap(async (req, res) => {
      res
        .status(202)
        .json({ job: await (await pageAI()).generate(userId(req), param(req, 'id'), req.body) });
    }),
  );
  router.get(
    '/pages/:id/ai-jobs',
    wrap(async (req, res) => {
      await (await pages()).get(userId(req), param(req, 'id'));
      if (!options.generationReady) {
        res.json({ jobs: [], available: false });
        return;
      }
      res.json({
        jobs: await (await pageAI()).list(userId(req), param(req, 'id')),
        available: true,
      });
    }),
  );
  // Lazy initialization does not touch disk when feature flag is off.
  let assetPromise: ReturnType<typeof createAssetStore> | undefined;
  const assets = () =>
    (assetPromise ??= createAssetStore({
      connection: service.store.connection,
      withProjectWrite: service.store.withProjectWrite,
      assetDir: options.assetDir ?? path.join(process.cwd(), '.design-assets'),
      authorizeProject: async (uid, pid, write) => {
        const project = await service.store.models.DesignProject.findById(pid).lean();
        if (!project) throw new DesignError(404, 'not_found', 'Not found');
        const role = getMemberRole(project, sanitizeUserId(uid));
        if (!role) throw new DesignError(404, 'not_found', 'Not found');
        if (write && role === 'viewer') throw new DesignError(403, 'forbidden', 'Forbidden');
      },
      authorizeDocument: async (uid, did, write) => {
        const doc = await service.getDocument(uid, did);
        if (write) {
          const project = await service.store.models.DesignProject.findById(doc.projectId).lean();
          const role = project ? getMemberRole(project, sanitizeUserId(uid)) : null;
          if (role !== 'owner' && role !== 'editor')
            throw new DesignError(403, 'forbidden', 'Forbidden');
        }
      },
    }));
  let jobsPromise: ReturnType<typeof createJobService> | undefined;
  const jobs = () =>
    (jobsPromise ??= assets()
      .then((assetStore) =>
        createJobService({
          connection: service.store.connection,
          assetStore,
          provider: options.generationReady
            ? (options.generationProvider ?? UnavailableProvider)
            : UnavailableProvider,
          resolveDocument: async (uid, did) => service.getDocument(uid, did),
          authorizeDocument: async (uid, did, write) => {
            const doc = await service.getDocument(uid, did);
            const project = await service.store.models.DesignProject.findById(doc.projectId).lean();
            const role = project ? getMemberRole(project, sanitizeUserId(uid)) : null;
            if (write && role !== 'owner' && role !== 'editor')
              throw new DesignError(403, 'forbidden', 'Forbidden');
          },
          // Cost authorization mandatory: absent budget integration disables new submissions.
          checkBudget:
            options.checkGenerationBudget ??
            (async () => {
              throw new DesignError(
                422,
                'budget_not_configured',
                'Generation budget is not configured',
              );
            }),
        }),
      )
      .then((service) => {
        options.onJobServiceReady?.(service);
        return service;
      }));
  if (options.initializeJobs && options.generationReady) void jobs().catch(() => {});
  router.post(
    '/documents/:id/generation-draft',
    wrap(async (req, res) => {
      if (!options.draftService)
        throw new DesignError(422, 'generation_unavailable', 'Draft generation not configured');
      const actor = userId(req),
        id = param(req, 'id');
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });
      const send = (event: string, value: unknown) => {
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Accel-Buffering', 'no');
        }
        if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
      };
      const final = await options.draftService.generate(
        actor,
        id,
        req.body,
        async (record) => {
          send('snapshot', record);
        },
        controller.signal,
      );
      send('complete', final);
      res.end();
    }),
  );
  router.get(
    '/documents/:id/generation-drafts',
    wrap(async (req, res) => {
      if (!options.draftService) {
        await service.getDocument(userId(req), param(req, 'id'));
        res.json({ drafts: [] });
        return;
      }
      res.json({ drafts: await options.draftService.list(userId(req), param(req, 'id')) });
    }),
  );
  router.get(
    '/generation-drafts/:id',
    wrap(async (req, res) => {
      if (!options.draftService)
        throw new DesignError(422, 'generation_unavailable', 'Unavailable');
      res.json({ draft: await options.draftService.get(userId(req), param(req, 'id')) });
    }),
  );
  router.post(
    '/generation-drafts/:id/proposal',
    wrap(async (req, res) => {
      if (!options.draftService)
        throw new DesignError(422, 'generation_unavailable', 'Unavailable');
      res
        .status(201)
        .json({ proposal: await options.draftService.proposal(userId(req), param(req, 'id')) });
    }),
  );
  router.post(
    '/documents/:id/jobs',
    wrap(async (req, res) => {
      const doc = await service.getDocument(userId(req), param(req, 'id'));
      const raw = req.body?.payload;
      if (
        !raw ||
        typeof raw.prompt !== 'string' ||
        raw.prompt.length < 1 ||
        raw.prompt.length > 8000 ||
        !Array.isArray(raw.scope)
      )
        throw new DesignError(422, 'schema', 'Prompt and explicit scope required');
      const scope: string[] = [...new Set<string>(raw.scope)];
      if (
        scope.length === 0 ||
        scope.some((id) => typeof id !== 'string' || !doc.payload.nodes.some((n) => n.id === id))
      )
        throw new DesignError(422, 'scope', 'Select valid document elements');
      if (!Number.isInteger(raw.baseRevision) || raw.baseRevision < 1)
        throw new DesignError(422, 'schema', 'baseRevision required');
      const source = await service.getSource(userId(req), doc.id, raw.baseRevision);
      const payload = {
        prompt: raw.prompt,
        scope,
        baseRevision: raw.baseRevision,
        nodes: source.snapshot.payload.nodes.filter((n: { id: string }) => scope.includes(n.id)),
        designSystem: source.snapshot.designSystem,
      };
      const job = await (
        await jobs()
      ).submit(userId(req), {
        projectId: doc.projectId,
        documentId: doc.id,
        clientJobId: req.body?.clientJobId,
        capability: req.body?.capability,
        payload,
      });
      res.status(202).json({ job });
    }),
  );
  router.post(
    '/jobs/:id/image-proposal',
    wrap(async (req, res) => {
      const job = await (await jobs()).get(userId(req), param(req, 'id'));
      if (job.status !== 'succeeded' || !job.outputAsset)
        throw new DesignError(422, 'job_not_ready', 'No completed image');
      const record = await service.store.connection
        .collection('designgenerationjobs')
        .findOne({ id: job.id });
      if (!record) throw new DesignError(404, 'not_found', 'Job not found');
      const nodeId = req.body?.nodeId;
      if (typeof nodeId !== 'string' || !record.payload.scope.includes(nodeId))
        throw new DesignError(422, 'scope', 'Select original scoped image');
      const proposal = await service.store.createProposal(userId(req), job.documentId, {
        sourceJobId: job.id,
        summary: 'Замена изображения',
        declaredScope: record.payload.scope,
        baseRevision: record.payload.baseRevision,
        operations: [
          {
            type: 'replaceAsset',
            nodeId,
            assetId: job.outputAsset.id,
            assetVersion: job.outputAsset.version,
          },
        ],
      });
      res.status(201).json({ proposal });
    }),
  );
  router.post(
    '/jobs/:id/proposal',
    wrap(async (req, res) => {
      const job = await (await jobs()).get(userId(req), param(req, 'id'));
      if (job.status !== 'succeeded' || !job.proposal)
        throw new DesignError(422, 'job_not_ready', 'No completed proposal');
      const record = await service.store.connection
        .collection('designgenerationjobs')
        .findOne({ id: job.id });
      if (!record) throw new DesignError(404, 'not_found', 'Job not found');
      const parsed = parseDesignProposal(job.proposal);
      const summary = parsed.title?.slice(0, 200) || 'Предложение генерации';
      const proposal = await service.store.createProposal(userId(req), job.documentId, {
        summary,
        sourceJobId: job.id,
        declaredScope: record.payload.scope,
        baseRevision: record.payload.baseRevision,
        operations: parsed.operations as never,
      });
      res.status(201).json({ proposal });
    }),
  );
  router.get(
    '/documents/:id/jobs',
    wrap(async (req, res) => {
      res.json({ jobs: await (await jobs()).list(userId(req), param(req, 'id')) });
    }),
  );
  router.get(
    '/jobs/:id',
    wrap(async (req, res) => {
      res.json({ job: await (await jobs()).get(userId(req), param(req, 'id')) });
    }),
  );
  router.post(
    '/jobs/:id/cancel',
    wrap(async (req, res) => {
      res.json({ job: await (await jobs()).requestCancel(userId(req), param(req, 'id')) });
    }),
  );
  router.get(
    '/capabilities',
    wrap(async (req, res) => {
      userId(req);
      const ready =
        options.generationReady === true &&
        !!options.generationProvider &&
        !!options.checkGenerationBudget;
      res.json({
        presentationSend: false,
        inpaint: false,
        documentDraft: !!options.draftService,
        imageGeneration: ready && options.generationProvider!.capabilities.imageGeneration,
        textProposal: ready && options.generationProvider!.capabilities.textProposal,
        textPrompt: ready && options.generationProvider!.capabilities.textProposal,
        imageGenerate: ready && options.generationProvider!.capabilities.imageGeneration,
        imageUpload: true,
        proposals: true,
        restore: true,
        exports: ['source', 'png-client', 'source-package'],
        reason: ready
          ? 'Generation configured; credential and allowance checked on submission'
          : 'Provider not configured; manual editing and structured proposals available',
      });
    }),
  );
  router.post(
    '/projects/:id/assets',
    raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '10mb' }),
    wrap(async (req, res) => {
      if (!Buffer.isBuffer(req.body))
        throw new DesignError(422, 'schema', 'Send raster image bytes');
      const asset = await (
        await assets()
      ).upload(userId(req), param(req, 'id'), {
        bytes: req.body,
        mime: req.get('Content-Type') ?? '',
        filename: 'upload',
      });
      res.status(201).json({ asset });
    }),
  );
  router.get(
    '/projects/:id/assets',
    wrap(async (req, res) => {
      res.json({ assets: await (await assets()).list(userId(req), param(req, 'id')) });
    }),
  );
  router.get(
    '/assets/:id/bytes',
    wrap(async (req, res) => {
      if (typeof req.query.version !== 'string' || !/^[1-9][0-9]{0,8}$/.test(req.query.version))
        throw new DesignError(422, 'schema', 'Asset version is required');
      const version = Number(req.query.version);
      const result = await (await assets()).getBytes(userId(req), param(req, 'id'), version);
      res.setHeader('Content-Type', result.mime);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(result.bytes);
    }),
  );
  router.get(
    '/projects',
    wrap(async (req, res) => {
      const projects = await service.listProjects(userId(req));
      res.json({ projects });
    }),
  );

  router.post(
    '/projects',
    wrap(async (req, res) => {
      const project = await service.createProject(userId(req), req.body ?? {});
      res.status(201).json({ project });
    }),
  );

  router.patch(
    '/projects/:id',
    wrap(async (req, res) => {
      const project = await service.updateProject(userId(req), param(req, 'id'), req.body ?? {});
      res.json({ project });
    }),
  );

  router.get(
    '/projects/:id/documents',
    wrap(async (req, res) => {
      const documents = await service.listDocuments(userId(req), param(req, 'id'));
      res.json({ documents });
    }),
  );

  router.post(
    '/projects/:id/documents',
    wrap(async (req, res) => {
      const document = await service.createDocument(userId(req), param(req, 'id'), req.body ?? {});
      res.status(201).json({ document });
    }),
  );

  router.get('/documents/:id/image-edit-jobs', notImplemented('inpaint'));
  router.post('/documents/:id/outpaint', notImplemented('outpaint'));
  router.post('/documents/:id/inpaint', notImplemented('inpaint'));
  router.post(
    '/documents/:id/resize-proposal',
    createImportAdmission(1),
    wrap(async (req, res) => {
      res.locals.packageProcessing = true;
      try {
        const proposal = await createResizeProposal(
          userId(req),
          param(req, 'id'),
          req.body,
          service.store,
          await assets(),
        );
        res.status(201).json({ proposal, algorithm: 'Lanczos3', ai: false });
      } finally {
        res.locals.packageProcessing = false;
        res.locals.releasePackageSlot?.();
      }
    }),
  );
  router.post(
    '/documents/:id/region-proposal',
    createImportAdmission(1),
    raw({ type: 'image/png', limit: '10mb' }),
    wrap(async (req, res) => {
      res.locals.packageProcessing = true;
      try {
        const input = {
          actor: userId(req),
          documentId: param(req, 'id'),
          nodeId: String(req.query.nodeId ?? ''),
          expectedRevision: Number(req.query.revision),
          candidateAssetId: String(req.query.candidateAssetId ?? ''),
          candidateVersion: Number(req.query.candidateVersion),
          mask: req.body,
        };
        const proposal = await createRegionEditProposal(input, service.store, await assets());
        res.status(201).json({ proposal });
      } finally {
        res.locals.packageProcessing = false;
        res.locals.releasePackageSlot?.();
      }
    }),
  );
  router.post(
    '/projects/:id/import-package',
    (req, res, next) => {
      service.store
        .withProjectWrite(userId(req as AuthedRequest), param(req, 'id'), async () => true)
        .then(() => next())
        .catch(next);
    },
    createImportAdmission(2),
    raw({ type: 'application/zip', limit: '50mb' }),
    wrap(async (req, res) => {
      res.locals.packageProcessing = true;
      try {
        if (!Buffer.isBuffer(req.body))
          throw new DesignError(422, 'package_body', 'Send ZIP bytes');
        const document = await importSourcePackage({
          actor: userId(req),
          projectId: param(req, 'id'),
          bytes: req.body,
          allowBrandPublish: req.query.allowBrandPublish === 'true',
          store: service.store,
          assets: await assets(),
          fontDir: options.fontDir ?? path.join(process.cwd(), 'client/public/design-fonts'),
        });
        res.status(201).json({ document });
      } finally {
        res.locals.packageProcessing = false;
        res.locals.releasePackageSlot?.();
      }
    }),
  );
  router.post(
    '/projects/:id/import',
    wrap(async (req, res) => {
      const parsed = normalizeSourceImport(req.body, param(req, 'id'));
      const document = await service.store.createDocument(userId(req), param(req, 'id'), {
        ...parsed.document,
        assetRefs: parsed.assetRefs,
      });
      res.status(201).json({ document });
    }),
  );
  router.post(
    '/documents/:id/duplicate',
    wrap(async (req, res) => {
      const source = await service.getDocument(userId(req), param(req, 'id'));
      const title = source.title.slice(0, 180) + ' — копия';
      const document = await service.store.createDocument(userId(req), source.projectId, {
        title,
        kind: 'canvas',
        payload: source.payload,
        designSystem: source.designSystem,
        assetRefs: source.assetRefs,
      });
      res.status(201).json({ document });
    }),
  );
  router.get(
    '/documents/:id',
    wrap(async (req, res) => {
      const document = await service.getDocument(userId(req), param(req, 'id'));
      res.json({ document });
    }),
  );

  router.patch(
    '/documents/:id',
    wrap(async (req, res) => {
      const document = await service.updateDocument(userId(req), param(req, 'id'), req.body ?? {});
      res.json({ document });
    }),
  );

  router.post(
    '/documents/:id/operations',
    wrap(async (req, res) => {
      const result = await service.applyOperations(userId(req), param(req, 'id'), req.body ?? {});
      res.status(result.replay ? 200 : 200).json({
        document: result.document,
        revision: result.revision,
        replay: result.replay,
        code: result.replay ? 'idempotent_replay' : 'ok',
      });
    }),
  );

  router.get(
    '/documents/:id/revisions',
    wrap(async (req, res) => {
      const revisions = await service.listRevisions(userId(req), param(req, 'id'));
      res.json({ revisions });
    }),
  );

  router.post(
    '/documents/:id/restore',
    wrap(async (req, res) => {
      const result = await service.restoreDocument(userId(req), param(req, 'id'), req.body ?? {});
      res.json({
        document: result.document,
        revision: result.revision,
        replay: result.replay,
        code: result.replay ? 'idempotent_replay' : 'ok',
      });
    }),
  );

  router.get(
    '/documents/:id/proposals',
    wrap(async (req, res) => {
      const proposals = await service.listProposals(userId(req), param(req, 'id'));
      res.json({ proposals });
    }),
  );

  router.post(
    '/documents/:id/proposals',
    wrap(async (req, res) => {
      const proposal = await service.createProposal(userId(req), param(req, 'id'), req.body ?? {});
      res.status(201).json({ proposal });
    }),
  );

  router.post(
    '/proposals/:id/accept',
    wrap(async (req, res) => {
      const result = await service.acceptProposal(userId(req), param(req, 'id'));
      res.json({
        document: result.document,
        revision: result.revision,
        replay: result.replay,
        proposal: result.proposal,
        code: result.replay ? 'idempotent_replay' : 'ok',
      });
    }),
  );

  router.post(
    '/proposals/:id/reject',
    wrap(async (req, res) => {
      const proposal = await service.rejectProposal(userId(req), param(req, 'id'));
      res.json({ proposal });
    }),
  );

  router.get(
    '/systems/:id/:version/passport',
    wrap(async (req, res) => {
      userId(req);
      res.json(getSystemPassport(param(req, 'id'), param(req, 'version')));
    }),
  );
  router.get(
    '/system-candidates',
    wrap(async (req, res) => {
      userId(req);
      res.json({ packages: extendedSystemPackages() });
    }),
  );
  router.post(
    '/projects/:id/install-system-candidate',
    wrap(async (req, res) => {
      const candidate = extendedSystemPackages().find((p) => p.brand.id === req.body?.id);
      if (!candidate) throw new DesignError(404, 'system_missing', 'Candidate not found');
      res.status(201).json({
        brand: await (await brands()).publish(userId(req), param(req, 'id'), candidate.brand),
        reviewStatus: 'candidate',
      });
    }),
  );
  router.get(
    '/systems',
    wrap(async (_req, res) => {
      res.json({ systems: service.listSystems() });
    }),
  );

  router.post(
    '/documents/:id/exports',
    wrap(async (req, res) => {
      const exported = await service.exportDocument(userId(req), param(req, 'id'), req.body ?? {});
      res.status(201).json({ export: exported });
    }),
  );

  router.get(
    '/documents/:id/exports/:exportId',
    wrap(async (req, res) => {
      const record = await service.getExport(userId(req), param(req, 'exportId'));
      if (record.documentId !== param(req, 'id')) {
        throw new DesignError('not_found', 'Not found');
      }
      res.json({
        export: {
          id: record._id,
          documentId: record.documentId,
          revision: record.revision,
          format: record.format,
          downloadPath: `/api/design/documents/${record.documentId}/exports/${record._id}/download`,
        },
      });
    }),
  );

  router.get(
    '/documents/:id/exports/:exportId/download',
    wrap(async (req, res) => {
      const record = await service.getExport(userId(req), param(req, 'exportId'));
      if (record.documentId !== param(req, 'id'))
        throw new DesignError(404, 'not_found', 'Not found');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="design-${record.revision}.json"`);
      res.json(await service.getSource(userId(req), record.documentId, record.revision));
    }),
  );

  router.get(
    '/documents/:id/package',
    wrap(async (req, res) => {
      const actor = userId(req),
        docId = param(req, 'id'),
        revision = Number(req.query.revision);
      if (typeof req.query.revision !== 'string' || !Number.isSafeInteger(revision) || revision < 1)
        throw new DesignError(422, 'schema', 'A positive revision is required');
      const source = await service.getSource(actor, docId, revision);
      const validated = normalizeSourceImport(source, 'sourcepackage');
      const families = validated.document.payload.nodes
        .filter((n: { type: string; props?: { fontFamily?: string } }) => n.type === 'text')
        .map(
          (n: { type: string; props?: { fontFamily?: string } }) => n.props?.fontFamily as string,
        );
      const fonts = await loadPackageFonts(
        options.fontDir ?? path.join(process.cwd(), 'client/public/design-fonts'),
        families,
      );
      const store = await assets();
      const bytes = await buildSourcePackage({
        source,
        fonts,
        loadAsset: (id, version) => store.getBytes(actor, id, version),
      });
      await service.getDocument(actor, docId);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="design-${docId}-r${revision}.zip"`,
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(bytes);
    }),
  );
  router.get(
    '/documents/:id/svg-export',
    wrap(async (req, res) => {
      const actor = userId(req),
        id = param(req, 'id'),
        revision = Number(req.query.revision);
      const head = await service.getDocument(actor, id),
        source = await service.getSource(actor, id, revision);
      const document = {
        id,
        projectId: head.projectId,
        ...source.snapshot,
        kind: 'canvas' as const,
        schemaVersion: 1 as const,
        revision,
        archived: !!source.snapshot.archived,
      };
      const result = await exportCanvasSVG(
        document as import('./types').DesignDocument,
        async (a, v) => (await assets()).getBytes(actor, a, v),
        await loadProjectSystemResolver(service.store.connection, head.projectId),
      );
      await service.getDocument(actor, id);
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Content-Disposition', `attachment; filename="design-${id}-r${revision}.svg"`);
      res.setHeader('Cache-Control', 'private,no-store');
      res.setHeader('X-Design-Export-Warning', 'Text layout may differ; raster assets stay raster');
      res.send(result.svg);
    }),
  );
  router.post('/documents/:id/raster-office-export', notImplemented('pptx_export'));
  router.post(
    '/documents/:id/raster-export',
    raw({ type: 'image/png', limit: '10mb' }),
    wrap(async (req, res) => {
      const actor = userId(req),
        id = param(req, 'id');
      const head = await service.getDocument(actor, id);
      const revision = Number(req.query.revision);
      const source = await service.getSource(actor, id, revision);
      const format = String(req.query.format);
      if (format !== 'jpeg' && format !== 'webp')
        throw new DesignError(422, 'export_format', 'Unsupported raster format');
      const output = await convertRasterExport({
        png: req.body,
        width: source.snapshot.payload.width,
        height: source.snapshot.payload.height,
        format,
        quality: 85,
      });
      await service.getDocument(actor, id);
      res.setHeader('Content-Type', output.mime);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="design-${head.id}-r${revision}.${output.extension}"`,
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(output.bytes);
    }),
  );
  router.get('/documents/:id/presentation-sends', notImplemented('presenton'));
  router.get('/presentation-sends/:id', notImplemented('presenton'));
  router.post('/presentation-sends/:id/reconcile', notImplemented('presenton'));
  router.post('/documents/:id/send-presentation', notImplemented('presenton'));
  router.post(
    '/documents/:id/presentation-handoff',
    raw({ type: 'image/png', limit: '10mb' }),
    wrap(async (req, res) => {
      const actor = userId(req),
        id = param(req, 'id');
      const head = await service.getDocument(actor, id),
        revision = Number(req.query.revision);
      const source = await service.getSource(actor, id, revision);
      const doc = {
        id: head.id,
        projectId: head.projectId,
        ...source.snapshot,
        kind: 'canvas' as const,
        schemaVersion: 1 as const,
        revision,
        archived: !!source.snapshot.archived,
      };
      const handoff = await preparePresentationHandoff(
        {
          document: doc as import('./types').DesignDocument,
          png: req.body,
          sourceLink: '/design?documentId=' + id,
        },
        await loadProjectSystemResolver(service.store.connection, head.projectId),
      );
      await service.getDocument(actor, id);
      res.json({ handoff, note: 'Raster handoff metadata only; no presentation created' });
    }),
  );
  router.get(
    '/documents/:id/source',
    wrap(async (req, res) => {
      const revision = Number(req.query.revision);
      const source = await service.getSource(userId(req), param(req, 'id'), revision);
      res.json(source);
    }),
  );

  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      return next(error);
    }
    sendError(res, error);
  });

  return router;
}

function wrap(
  handler: (req: AuthedRequest, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req as AuthedRequest, res).catch(next);
  };
}

function userId(req: AuthedRequest): string {
  const id = req.user?.id ?? req.user?._id?.toString?.();
  if (typeof id !== 'string' || id.length === 0) {
    throw new DesignError('unauthorized', 'Unauthorized', 401);
  }
  return id;
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new DesignError('validation', `Missing ${name}`);
  }
  return value;
}

function sendError(res: Response, error: unknown): void {
  if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
    res
      .status(413)
      .json({ code: 'request_too_large', message: 'Uploaded package exceeds size limit' });
    return;
  }

  if (isDesignError(error) || error instanceof AssetError) {
    const status = error.status || statusForCode(error.code);
    res.status(status).json({ code: error.code, message: error.message });
    return;
  }
  res.status(500).json({ code: 'internal_error', message: 'Internal error' });
}
