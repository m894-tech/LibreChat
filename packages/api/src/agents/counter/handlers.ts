import { logger } from '@librechat/data-schemas';
import type { AppConfig } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { BranchUsageMessage } from './branch';
import type { ServerRequest } from '~/types';
import { readBranchContextUsage, BRANCH_USAGE_MESSAGE_SELECT } from './branch';

const ID_MAX_LENGTH = 128;

export interface ContextUsageHandlerDeps {
  /** Ownership check scoped to the authenticated user (and tenant when present). */
  getConvoOwnership: (
    user: string,
    conversationId: string,
    tenantId?: string | null,
  ) => Promise<{ user?: string | null } | null>;
  /** User-scoped message read; `select` is {@link BRANCH_USAGE_MESSAGE_SELECT}. */
  getMessages: (
    filter: { conversationId: string; user: string },
    select?: string,
  ) => Promise<BranchUsageMessage[]>;
  /** Defaults to the `interface.contextCounterV2` flag on the request's app config. */
  isEnabled?: (req: ServerRequest) => boolean;
  now?: () => number;
}

/** §11 rollout flag shared with the client: `interface.contextCounterV2` in `librechat.yaml`. */
export function isContextUsageEnabled(config: AppConfig | undefined | null): boolean {
  return config?.interfaceConfig?.contextCounterV2 === true;
}

function queryString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > ID_MAX_LENGTH) {
    return undefined;
  }
  return value;
}

/**
 * `GET /api/agents/context/usage?conversationId=…&leafId=…` — the persisted
 * `lastCallMeasurement` and `sessionUsage` of the branch root → `leafId`
 * (`messageId` is accepted as an alias). Reads only the caller's own
 * conversation (404 for anything else, so a foreign id learns nothing) and
 * never touches the model or the ledger.
 */
export function createContextUsageHandler({
  getConvoOwnership,
  getMessages,
  isEnabled = (req) => isContextUsageEnabled(req.config),
  now = () => Date.now(),
}: ContextUsageHandlerDeps) {
  return async (req: ServerRequest, res: Response): Promise<void> => {
    try {
      if (!isEnabled(req)) {
        res.status(404).json({ message: 'Not found' });
        return;
      }
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }
      const conversationId = queryString(req.query.conversationId);
      const messageId = queryString(req.query.leafId) ?? queryString(req.query.messageId);
      if (conversationId == null || messageId == null) {
        res.status(400).json({ message: 'conversationId and leafId are required' });
        return;
      }
      const userId = String(req.user.id);
      const tenantId = typeof req.user.tenantId === 'string' ? req.user.tenantId : null;
      const [ownership, messages] = await Promise.all([
        getConvoOwnership(userId, conversationId, tenantId),
        getMessages({ conversationId, user: userId }, BRANCH_USAGE_MESSAGE_SELECT),
      ]);
      if (ownership == null) {
        res.status(404).json({ message: 'Conversation not found' });
        return;
      }
      const snapshot = readBranchContextUsage({
        conversationId,
        leafId: messageId,
        messages,
        now: now(),
      });
      if (snapshot == null) {
        res.status(404).json({ message: 'Message not found' });
        return;
      }
      res.json(snapshot);
    } catch (error) {
      logger.error('[ContextUsage] Failed to read branch usage', error);
      res.status(500).json({ message: 'Failed to read context usage' });
    }
  };
}
