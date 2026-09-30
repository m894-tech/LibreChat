import { Constants } from 'librechat-data-provider';
import type { NextFunction, Response } from 'express';
import type { TokenBucketLimiter } from './limiter';
import type { ServerRequest } from '~/types/http';
import { resolveContextEstimateConfig } from './config';
import { createTokenBucketLimiter } from './limiter';

/**
 * §11 rollback flag: `endpoints.agents.contextEstimate.enabled: false` turns
 * the dry-run endpoint off without touching the rest of the counter. Requires
 * the app config to already be resolved onto the request.
 */
export function requireContextEstimateEnabled(
  req: ServerRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!resolveContextEstimateConfig(req.config).enabled) {
    res.status(403).json({ error: 'Context estimate is disabled' });
    return;
  }
  next();
}

type EstimateBodyFiles = { files?: Array<string | { file_id?: string }> };

/**
 * The client may send prepared attachments as bare ids; the agent initializer
 * hydrates `req.body.files[].file_id` exactly as it does for a chat turn, so
 * ids are lifted into that shape before the shared middleware runs.
 */
export function normalizeContextEstimateBody(
  req: ServerRequest,
  _res: Response,
  next: NextFunction,
): void {
  const body = req.body as (typeof req.body & EstimateBodyFiles) | undefined;
  if (body != null && Array.isArray(body.files)) {
    body.files = body.files.map((file) => (typeof file === 'string' ? { file_id: file } : file));
  }
  next();
}

export type ContextEstimateLimiterOptions = {
  /** Limiter to use; a fresh one is built from the request config when omitted. */
  limiter?: TokenBucketLimiter;
  now?: () => number;
};

/**
 * §6.6 per user + conversation limiter (burst 5, ≤30/min by default). The
 * bucket is keyed on the conversation the estimate is for, with all
 * not-yet-created chats of one user sharing a single `new` bucket. Built lazily
 * on first use so the limits come from the resolved app config.
 */
export function createContextEstimateLimiter(options: ContextEstimateLimiterOptions = {}) {
  let limiter = options.limiter;
  return function contextEstimateLimiter(
    req: ServerRequest,
    res: Response,
    next: NextFunction,
  ): void {
    if (limiter == null) {
      const { burst, perMinute } = resolveContextEstimateConfig(req.config);
      limiter = createTokenBucketLimiter({ burst, perMinute, now: options.now });
    }
    const userId = req.user?.id ?? 'anonymous';
    const conversationId = req.body?.conversationId ?? Constants.NEW_CONVO;
    const decision = limiter.take(`${userId}:${conversationId}`);
    if (decision.allowed) {
      next();
      return;
    }
    const retryAfterSeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      error: 'Too many context estimate requests',
      retryAfterMs: decision.retryAfterMs,
    });
  };
}
