import React from 'react';
import type { TConversation } from 'librechat-data-provider';
import useTokenUsage from '~/hooks/Chat/useTokenUsage';
import { formatTokens } from '~/utils';
import { useLocalize } from '~/hooks';

export default function ContextUsageRow({
  index = 0,
  conversation,
  isSubmitting = false,
}: {
  index?: number;
  conversation?: TConversation | null;
  isSubmitting?: boolean;
}) {
  const localize = useLocalize();
  const view = useTokenUsage({ index, conversation: conversation ?? null, isSubmitting });

  if (view.usedTokens <= 0) {
    return null;
  }

  const hasMax = view.maxTokens != null && view.maxTokens > 0;
  const label = hasMax
    ? localize('com_ui_context_usage_snapshot', {
        0: formatTokens(view.usedTokens),
        1: formatTokens(view.maxTokens ?? 0),
        2: String(Math.round(view.percent)),
      })
    : localize('com_ui_context_usage_snapshot_unknown', { 0: formatTokens(view.usedTokens) });

  return (
    <div
      className="px-2 py-1 text-[11px] text-text-secondary"
      data-testid="session-menu-context-usage"
    >
      <span className="mr-1 text-[10px] uppercase tracking-wide">
        {localize('com_ui_session_context')}
      </span>
      {label}
    </div>
  );
}
