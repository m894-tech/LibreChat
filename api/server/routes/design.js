/**
 * Design workspace host router.
 * Lazy: nothing runs at import time. Routes exist only when mounted by index.js
 * under M894_DESIGN_WORKSPACE=1. When the env flag is not exactly '1', every
 * request returns 404 (defense in depth if mounted incorrectly).
 */
const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

/** @type {Promise<{ router: import('express').Router; stop(): Promise<void> }> | undefined} */
let runtimePromise;

const isDesignEnabled = () => process.env.M894_DESIGN_WORKSPACE === '1';

const notImplemented = (feature) => (_req, res) => {
  res.status(501).json({ error: 'not_implemented', feature });
};

/**
 * Build runtime config only when a request is handled with the flag on.
 * No Refero / Presenton / inpaint wiring; no per-user auth for those features.
 */
function buildRuntimeConfig() {
  const config = {
    enabled: true,
    assetDir: process.env.M894_DESIGN_ASSET_DIR,
  };

  if (process.env.M894_DESIGN_GENERATION === '1') {
    config.generation = {
      baseURL: process.env.M894_DESIGN_PROVIDER_URL,
      allowedOrigins: (process.env.M894_DESIGN_PROVIDER_ORIGINS || '').split(',').filter(Boolean),
      model: process.env.M894_DESIGN_PROVIDER_MODEL,
      imageModel: process.env.M894_DESIGN_IMAGE_MODEL,
      monthlyAllowance: Number(process.env.M894_DESIGN_MONTHLY_UNITS || 0),
      requestUnits: Number(process.env.M894_DESIGN_REQUEST_UNITS || 1),
    };
  }

  return config;
}

/**
 * Optional generation credential from env (not per-user key vault).
 * R2+ per-user auth paths are intentionally not ported.
 */
async function resolveCredential(_userId) {
  const key = process.env.M894_DESIGN_PROVIDER_API_KEY;
  if (typeof key !== 'string') {
    return null;
  }
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : null;
}

router.use((req, res, next) => {
  if (!isDesignEnabled()) {
    return res.status(404).json({ code: 'not_found' });
  }
  return next();
});

/** R2+ surfaces are not ported; stable 501 stubs (only reached when flag is on). */
router.post('/documents/:id/inpaint', notImplemented('inpaint'));
router.post('/documents/:id/outpaint', notImplemented('outpaint'));
router.get('/documents/:id/image-edit-jobs', notImplemented('inpaint'));
router.post('/documents/:id/raster-office-export', notImplemented('pptx_export'));
router.get('/documents/:id/comments', notImplemented('approvals'));
router.post('/documents/:id/comments', notImplemented('approvals'));
router.get('/documents/:id/approval', notImplemented('approvals'));
router.post('/documents/:id/approval', notImplemented('approvals'));
router.get('/documents/:id/reference-lock', notImplemented('refero'));
router.post('/documents/:id/reference-lock', notImplemented('refero'));
router.post('/documents/:id/research', notImplemented('refero'));
router.get('/documents/:id/presentation-sends', notImplemented('presenton'));
router.get('/presentation-sends/:id', notImplemented('presenton'));
router.post('/presentation-sends/:id/reconcile', notImplemented('presenton'));
router.post('/documents/:id/send-presentation', notImplemented('presenton'));

router.use((req, res, next) => {
  const { getTenantId } = require('@librechat/data-schemas');
  if (getTenantId()) {
    return res.status(503).json({
      code: 'design_tenant_not_supported',
      message: 'Design tenant integration is not enabled',
    });
  }

  const { createDesignRuntime } = require('@librechat/api');
  runtimePromise ??= createDesignRuntime(
    mongoose.connection,
    buildRuntimeConfig(),
    resolveCredential,
  );

  runtimePromise
    .then((runtime) => runtime.router(req, res, next))
    .catch(() =>
      res.status(503).json({
        code: 'design_configuration',
        message: 'Design runtime configuration is unavailable',
      }),
    );
});

router.close = async () => {
  if (!runtimePromise) {
    return;
  }
  const runtime = await runtimePromise;
  await runtime.stop();
  runtimePromise = undefined;
};

module.exports = router;
