/** Canonical orch IDs. Auto never uses relay-auto as runtime. */
export const M894_TEAM_PARENT_ID = 'agent_m894OrchTeamParent001';
export const M894_TEAM_RESEARCH_ID = 'agent_m894OrchResearch00001';
export const M894_TEAM_CODING_ID = 'agent_m894OrchCoding0000001';
export const M894_TEAM_REVIEW_ID = 'agent_m894OrchReview0000001';
export const M894_TEAM_ACCEPT_ID = 'agent_m894OrchAccept000001';
export const M894_ORCH_AGENT_IDS = [
  M894_TEAM_PARENT_ID,
  M894_TEAM_RESEARCH_ID,
  M894_TEAM_CODING_ID,
  M894_TEAM_REVIEW_ID,
  M894_TEAM_ACCEPT_ID,
] as const;
export function isM894OrchAgentId(id?: string | null): boolean {
  return Boolean(id && (M894_ORCH_AGENT_IDS as readonly string[]).includes(id));
}
/** Leftover picker id — do not select for Auto. */
export const M894_AUTO_SPEC_NAME = 'relay-auto';
/** Escape if chat is already trapped on sidecar until LC hook is live. */
export const M894_AUTO_ESCAPE_SPEC = 'xai-grok-4.6';
const PREV_KEY = 'm894_orch_prev_model';
export function rememberNonTeamConversation(
  conversation?: {
    spec?: string | null;
    endpoint?: string | null;
    model?: string | null;
    agent_id?: string | null;
  } | null,
) {
  if (typeof window === 'undefined' || !conversation) return;
  if (isM894OrchAgentId(conversation.agent_id)) return;
  if (conversation.spec === M894_AUTO_SPEC_NAME || conversation.endpoint === 'Relay-Orchestrator') {
    return;
  }
  try {
    window.sessionStorage.setItem(
      PREV_KEY,
      JSON.stringify({
        spec: conversation.spec || null,
        endpoint: conversation.endpoint || null,
        model: conversation.model || null,
      }),
    );
  } catch {
    /* ignore */
  }
}
export function readNonTeamConversation(): {
  spec: string | null;
  endpoint: string | null;
  model: string | null;
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PREV_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as {
      spec: string | null;
      endpoint: string | null;
      model: string | null;
    };
  } catch {
    return null;
  }
}

/** Keep Team parent on the conversation so stop/continue/reopen still hit orch. */
export function applyTeamLockToConversation<T extends Record<string, unknown>>(convo: T): T {
  return {
    ...convo,
    endpoint: 'agents',
    endpointType: undefined,
    spec: undefined,
    model: undefined,
    agent_id: M894_TEAM_PARENT_ID,
  };
}
