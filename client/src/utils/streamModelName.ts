import type { TModelSpec } from 'librechat-data-provider';
import {
  M894_TEAM_PARENT_ID,
  M894_TEAM_RESEARCH_ID,
  M894_TEAM_CODING_ID,
  M894_TEAM_REVIEW_ID,
  M894_TEAM_ACCEPT_ID,
} from '~/utils/sessionOrch';

/** LLM ids for orch agents — list API omits `model`. */
const ORCH_AGENT_MODELS: Record<string, string> = {
  [M894_TEAM_PARENT_ID]: 'gpt-5.6-sol',
  [M894_TEAM_RESEARCH_ID]: 'grok-4.6',
  [M894_TEAM_CODING_ID]: 'claude-sonnet-5',
  [M894_TEAM_REVIEW_ID]: 'claude-sonnet-5',
  [M894_TEAM_ACCEPT_ID]: 'gpt-6-astra',
};

function isAgentId(value?: string | null): boolean {
  return Boolean(value && /^agent_/i.test(value));
}

/** Human label for the model currently answering in the stream. */
export function formatStreamModelName({
  model,
  spec,
  specs,
  agentId,
  agentModel,
}: {
  model?: string | null;
  spec?: string | null;
  specs?: TModelSpec[] | null;
  agentId?: string | null;
  agentModel?: string | null;
}): string {
  const llm = [
    model && !isAgentId(model) ? model : '',
    spec && !isAgentId(spec) ? spec : '',
    agentModel && !isAgentId(agentModel) ? agentModel : '',
    agentId && ORCH_AGENT_MODELS[agentId] ? ORCH_AGENT_MODELS[agentId] : '',
    isAgentId(model) && model && ORCH_AGENT_MODELS[model] ? ORCH_AGENT_MODELS[model] : '',
  ]
    .map((s) => String(s || '').trim())
    .find(Boolean);
  if (!llm) {
    return '';
  }
  const list = specs ?? [];
  const hit = list.find(
    (s) =>
      s.name === llm || s.preset?.model === llm || s.preset?.modelLabel === llm || s.label === llm,
  );
  return String(hit?.label || hit?.preset?.modelLabel || llm);
}
