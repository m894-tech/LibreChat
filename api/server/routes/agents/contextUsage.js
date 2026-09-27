const express = require('express');
const { createContextUsageHandler } = require('@librechat/api');
const { configMiddleware } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

/** Context counter v2: persisted last-call measurement + per-branch session usage. */
router.get(
  '/usage',
  configMiddleware,
  createContextUsageHandler({
    getConvoOwnership: db.getConvoOwnership,
    getMessages: db.getMessages,
  }),
);

module.exports = router;
