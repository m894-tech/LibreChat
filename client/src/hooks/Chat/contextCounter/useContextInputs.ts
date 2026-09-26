import { useEffect, useMemo, useRef } from 'react';
import { useRecoilValue } from 'recoil';
import { useWatch } from 'react-hook-form';
import { Constants, isAgentsEndpoint } from 'librechat-data-provider';
import type {
  TMessage,
  TConversation,
  TEphemeralAgent,
  TContextStaleReason,
  TContextConfiguration,
  TContextFingerprintInput,
} from 'librechat-data-provider';
import type { TContextEstimateRequest } from '~/data-provider/ContextCounter';
import type { CurrentConfiguration } from '~/store/contextCounter';
import { diffFingerprint, hashFingerprint, hashString } from '~/store/contextCounter';
import { useLatestMessage } from '~/hooks/Messages/useLatestMessage';
import { useChatFormContext } from '~/Providers/ChatFormContext';
import store, { ephemeralAgentByConvoId } from '~/store';
import { useGetAgentByIdQuery } from '~/data-provider';
import useTokenLimits from '../useTokenLimits';

/** Composer state the estimate depends on (§7 draft / вложения). */
export type ComposerDraft = {
  text: string;
  attachmentIds: string[];
};

/**
 * Host adapter for the composer: react-hook-form text plus the attachment
 * ids of the pane. Must render inside `ChatFormProvider` (the composer).
 */
export function useComposerDraft(index: number): ComposerDraft {
  const { control } = useChatFormContext();
  const text = useWatch({ control, name: 'text' });
  const files = useRecoilValue(store.filesByIndex(index));
  const attachmentIds = useMemo(() => {
    const ids: string[] = [];
    for (const file of files.values()) {
      const id = file.file_id || file.temp_file_id;
      if (id) {
        ids.push(id);
      }
    }
    return ids.sort();
  }, [files]);
  return useMemo(() => ({ text: text ?? '', attachmentIds }), [text, attachmentIds]);
}

function toNumber(value: unknown): number | null {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return typeof num === 'number' && Number.isFinite(num) && num > 0 ? num : null;
}

function toolIdOf(tool: unknown): string | null {
  if (typeof tool === 'string') {
    return tool;
  }
  if (tool != null && typeof tool === 'object') {
    const key = (tool as { pluginKey?: unknown }).pluginKey;
    return typeof key === 'string' ? key : null;
  }
  return null;
}

function ephemeralToolIds(agent: TEphemeralAgent | null): string[] {
  if (agent == null) {
    return [];
  }
  const ids: string[] = [];
  for (const server of agent.mcp ?? []) {
    ids.push(`mcp:${server}`);
  }
  const flags: Array<keyof TEphemeralAgent> = [
    'web_search',
    'file_search',
    'execute_code',
    'skills',
    'memory',
    'ask_user_question',
    'run_in_background',
    'describe_intent',
  ];
  for (const flag of flags) {
    if (agent[flag] === true) {
      ids.push(`ephemeral:${flag}`);
    }
  }
  if (agent.artifacts != null && agent.artifacts !== '' && agent.artifacts !== 'default') {
    ids.push(`ephemeral:artifacts:${agent.artifacts}`);
  }
  return ids;
}

export type ContextCounterInputs = {
  /** Leaf of the viewed branch; `Constants.NO_PARENT` for an empty chat (§4 «Пустой чат»). */
  leafId: string;
  leaf: TMessage | null;
  fingerprintInput: TContextFingerprintInput;
  fingerprint: string;
  /** Why the fingerprint moved since the previous render, `null` when it did not. */
  changeReason: TContextStaleReason | null;
  current: CurrentConfiguration;
  /** §6 body minus revision / fingerprint, which the controller adds at fire time. */
  request: Omit<TContextEstimateRequest, 'revision' | 'fingerprint'>;
};

export type UseContextInputsParams = {
  index: number;
  conversation: TConversation | null;
  draft: ComposerDraft;
};

/**
 * Gathers every §7 fingerprint term from the conversation, the resolved
 * agent, the ephemeral agent (MCP / built-in tools), the branch leaf and the
 * composer, and derives the fingerprint plus the reason it last moved.
 */
export default function useContextInputs({
  index,
  conversation,
  draft,
}: UseContextInputsParams): ContextCounterInputs {
  const conversationId = conversation?.conversationId ?? Constants.NEW_CONVO;
  const endpoint = conversation?.endpoint ?? '';
  const agentId = isAgentsEndpoint(endpoint) ? (conversation?.agent_id ?? null) : null;
  const { data: agent } = useGetAgentByIdQuery(agentId);
  const ephemeralAgent = useRecoilValue(ephemeralAgentByConvoId(conversationId));
  const limits = useTokenLimits(conversation);
  const leaf = useLatestMessage(index);

  const model = conversation?.model ?? null;
  const spec = conversation?.spec ?? null;
  const promptPrefix = conversation?.promptPrefix ?? null;
  const maxOutput = toNumber(conversation?.maxOutputTokens) ?? toNumber(conversation?.max_tokens);
  const conversationTools = conversation?.tools;
  const endpointType = conversation?.endpointType ?? undefined;

  const fingerprintInput = useMemo<TContextFingerprintInput>(() => {
    const configuration: TContextConfiguration = {
      endpoint: limits.endpoint || endpoint || undefined,
      provider: agent?.provider ?? undefined,
      model: limits.model || model || undefined,
      agentId,
    };
    const toolIds: string[] = [];
    for (const tool of conversationTools ?? []) {
      const id = toolIdOf(tool);
      if (id != null) {
        toolIds.push(id);
      }
    }
    for (const tool of agent?.tools ?? []) {
      toolIds.push(tool);
    }
    toolIds.push(...ephemeralToolIds(ephemeralAgent));
    const instructions = `${promptPrefix ?? ''}\u0000${agent?.instructions ?? ''}\u0000${
      agent?.additional_instructions ?? ''
    }`;
    const reserve =
      maxOutput ?? toNumber(agent?.model_parameters?.max_output_tokens as unknown) ?? 0;
    const leafId = leaf?.messageId ?? Constants.NO_PARENT;
    return {
      configuration,
      window: limits.maxContextTokens ?? null,
      reserve,
      inputLimit: null,
      instructionsHash: hashString(instructions),
      toolIds,
      branchLeafId: leafId,
      historyRevision: `${leafId}:${leaf?.updatedAt ?? ''}`,
      draftHash: hashString(draft.text),
      attachmentIds: draft.attachmentIds,
    };
  }, [
    limits,
    endpoint,
    agent,
    model,
    agentId,
    conversationTools,
    ephemeralAgent,
    promptPrefix,
    maxOutput,
    leaf,
    draft,
  ]);

  const fingerprint = useMemo(() => hashFingerprint(fingerprintInput), [fingerprintInput]);

  /** Compared against the committed previous render, so a StrictMode double
   *  render reports the same reason twice instead of losing it. */
  const previousRef = useRef<{ fingerprint: string; input: TContextFingerprintInput } | null>(null);
  const previous = previousRef.current;
  const changeReason: TContextStaleReason | null =
    previous == null || previous.fingerprint === fingerprint
      ? null
      : diffFingerprint(previous.input, fingerprintInput);
  useEffect(() => {
    previousRef.current = { fingerprint, input: fingerprintInput };
  }, [fingerprint, fingerprintInput]);

  const request = useMemo<Omit<TContextEstimateRequest, 'revision' | 'fingerprint'>>(
    () => ({
      conversationId,
      parentMessageId: fingerprintInput.branchLeafId,
      endpoint: endpoint || undefined,
      endpointType,
      model: model ?? undefined,
      agent_id: agentId,
      spec,
      promptPrefix,
      maxContextTokens: limits.maxContextTokens ?? null,
      maxOutputTokens: maxOutput,
      text: draft.text,
      files: draft.attachmentIds,
      ephemeralAgent,
    }),
    [
      conversationId,
      fingerprintInput.branchLeafId,
      endpoint,
      endpointType,
      model,
      agentId,
      spec,
      promptPrefix,
      limits.maxContextTokens,
      maxOutput,
      draft,
      ephemeralAgent,
    ],
  );

  return useMemo(
    () => ({
      leafId: fingerprintInput.branchLeafId,
      leaf,
      fingerprintInput,
      fingerprint,
      changeReason,
      current: {
        configuration: fingerprintInput.configuration,
        window: fingerprintInput.window,
        reserve: fingerprintInput.reserve,
        inputLimit: fingerprintInput.inputLimit,
      },
      request,
    }),
    [fingerprintInput, leaf, fingerprint, changeReason, request],
  );
}
