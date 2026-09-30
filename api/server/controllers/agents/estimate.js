const { estimateNextRequest, getSafeErrorMetadata } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { disposeClient } = require('~/server/cleanup');
const { cleanupMCPRequestContextForReq } = require('~/server/services/MCPRequestContext');

/**
 * POST /api/agents/context/estimate — wiring only. Builds the same AgentClient
 * `initializeClient` builds for a chat turn (agent, tools, MCP definitions,
 * model config), then hands it to `estimateNextRequest`, which drives the
 * client's Send plan as a dry run and returns the §7 `nextRequestEstimate`.
 *
 * @param {ServerRequest} req
 * @param {ServerResponse} res
 * @param {import('express').NextFunction} next
 * @param {(params: object) => Promise<{ client: object }>} initializeClient
 */
const ContextEstimateController = async (req, res, next, initializeClient) => {
  const abortController = new AbortController();
  const onClose = () => abortController.abort();
  let client;
  res.once('close', onClose);
  try {
    const { endpointOption, ...body } = req.body ?? {};
    ({ client } = await initializeClient({
      req,
      res,
      signal: abortController.signal,
      endpointOption,
    }));
    const estimate = await estimateNextRequest({
      req,
      body,
      client,
      signal: abortController.signal,
    });
    if (res.headersSent || res.writableEnded) {
      return;
    }
    res.status(200).json(estimate);
  } catch (error) {
    logger.error('[ContextEstimateController] Failed to initialize', getSafeErrorMetadata(error));
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to estimate context' });
    }
  } finally {
    try {
      await cleanupMCPRequestContextForReq(req);
    } finally {
      if (client) {
        disposeClient(client);
      }
      res.off('close', onClose);
    }
  }
};

module.exports = ContextEstimateController;
