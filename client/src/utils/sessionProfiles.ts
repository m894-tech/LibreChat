export type SessionProfileId =
  | 'fast'
  | 'think'
  | 'research'
  | 'create'
  | 'execute'
  | 'plan'
  | 'review'
  | 'teach'
  | 'debug';
export type CreateContractId =
  | 'none'
  | 'site'
  | 'slides'
  | 'pdf'
  | 'table'
  | 'email'
  | 'memo'
  | 'diagram';
export type ExecutePolicy = 'ask' | 'autorun';
export type SessionOrchMode = 'off' | 'auto' | 'team' | 'm2' | 'm3' | 'compare';

export type SessionProfileState = {
  profile: SessionProfileId;
  createContract: CreateContractId;
  executePolicy: ExecutePolicy;
  orchMode: SessionOrchMode;
  orchParallel?: boolean;
  orchCompare?: {
    brief?: string;
    candidates?: Array<{ id: string; providerId: string; model?: string }>;
    judge?: { id: string; providerId: string };
  };
  orchParentModel?: string;
  orchParentSpec?: string;
  orchParentEndpoint?: string;
};

/** Legacy single-key (pre per-conversation). Migrated only into NEW_CONVO. */
export const SESSION_PROFILE_LEGACY_STORAGE_KEY = 'm894_session_profile_v1';
/** @deprecated use sessionProfileStorageKey(conversationId) */
export const SESSION_PROFILE_STORAGE_KEY = SESSION_PROFILE_LEGACY_STORAGE_KEY;
export const SESSION_PROFILE_STORAGE_PREFIX = 'm894_session_profile_v1__';
export const SESSION_PROFILE_CHANGED_EVENT = 'session-profile-changed';

/** Matches librechat-data-provider Constants.NEW_CONVO without a package cycle. */
export const SESSION_PROFILE_NEW_CONVO = 'new';

export const DEFAULT_SESSION_PROFILE: SessionProfileState = {
  profile: 'fast',
  createContract: 'none',
  executePolicy: 'ask',
  orchMode: 'off',
  orchParallel: false,
};

export type SessionProfileChangedDetail = {
  conversationId: string;
  state: SessionProfileState;
};

export function normalizeSessionProfileConversationId(conversationId?: string | null): string {
  if (conversationId == null || conversationId === '' || conversationId === 'search') {
    return SESSION_PROFILE_NEW_CONVO;
  }
  return conversationId;
}

export function sessionProfileStorageKey(conversationId?: string | null): string {
  return `${SESSION_PROFILE_STORAGE_PREFIX}${normalizeSessionProfileConversationId(conversationId)}`;
}

const PROFILES: SessionProfileId[] = [
  'fast',
  'think',
  'research',
  'create',
  'execute',
  'plan',
  'review',
  'teach',
  'debug',
];
const CONTRACTS: CreateContractId[] = [
  'none',
  'site',
  'slides',
  'pdf',
  'table',
  'email',
  'memo',
  'diagram',
];

export function isSessionProfileId(value: unknown): value is SessionProfileId {
  return typeof value === 'string' && (PROFILES as string[]).includes(value);
}

export function isCreateContractId(value: unknown): value is CreateContractId {
  return typeof value === 'string' && (CONTRACTS as string[]).includes(value);
}

const ORCH_MODES: SessionOrchMode[] = ['off', 'auto', 'team', 'm2', 'm3', 'compare'];

export function isSessionOrchMode(value: unknown): value is SessionOrchMode {
  return typeof value === 'string' && (ORCH_MODES as string[]).includes(value);
}

export function normalizeSessionProfile(
  raw?: Partial<SessionProfileState> | null,
): SessionProfileState {
  const profile = isSessionProfileId(raw?.profile) ? raw.profile : DEFAULT_SESSION_PROFILE.profile;
  const createContract = (() => {
    if (profile !== 'create') {
      return 'none' as const;
    }
    if (isCreateContractId(raw?.createContract)) {
      return raw.createContract;
    }
    return 'site' as const;
  })();
  const executePolicy: ExecutePolicy =
    profile === 'execute' && raw?.executePolicy === 'autorun' ? 'autorun' : 'ask';
  const orchRaw = raw?.orchMode;
  let orchMode: SessionOrchMode = 'off';
  if ((orchRaw as string | undefined) === 'm2-interim') {
    orchMode = 'team';
  } else if (isSessionOrchMode(orchRaw)) {
    orchMode = orchRaw;
  }
  const orchParentModel =
    typeof raw?.orchParentModel === 'string' && raw.orchParentModel.trim()
      ? raw.orchParentModel.trim()
      : undefined;
  const orchParentSpec =
    typeof raw?.orchParentSpec === 'string' && raw.orchParentSpec.trim()
      ? raw.orchParentSpec.trim()
      : undefined;
  const orchParentEndpoint =
    typeof raw?.orchParentEndpoint === 'string' && raw.orchParentEndpoint.trim()
      ? raw.orchParentEndpoint.trim()
      : undefined;
  const orchParallel = raw?.orchParallel === true;
  const rawCmp = raw?.orchCompare;
  const orchCompare =
    rawCmp && typeof rawCmp === 'object'
      ? {
          brief: typeof rawCmp.brief === 'string' ? rawCmp.brief : '',
          candidates: Array.isArray(rawCmp.candidates) ? rawCmp.candidates : undefined,
          judge: rawCmp.judge && typeof rawCmp.judge === 'object' ? rawCmp.judge : undefined,
        }
      : undefined;
  return {
    profile,
    createContract,
    executePolicy,
    orchMode,
    orchParallel,
    ...(orchCompare ? { orchCompare } : {}),
    ...(orchParentModel ? { orchParentModel } : {}),
    ...(orchParentSpec ? { orchParentSpec } : {}),
    ...(orchParentEndpoint ? { orchParentEndpoint } : {}),
  };
}

function readRawSessionProfile(storageKey: string): SessionProfileState | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    return normalizeSessionProfile(JSON.parse(raw) as Partial<SessionProfileState>);
  } catch {
    return null;
  }
}

/**
 * Load session profile for one conversation.
 * - Keyed by conversationId (`new` for draft chats).
 * - Legacy global key is migrated only into the draft (`new`) slot — never into other chats.
 * - Missing keys return DEFAULT (think); they do not inherit another chat's profile.
 */
export function loadSessionProfile(conversationId?: string | null): SessionProfileState {
  if (typeof window === 'undefined') {
    return DEFAULT_SESSION_PROFILE;
  }
  const id = normalizeSessionProfileConversationId(conversationId);
  const key = sessionProfileStorageKey(id);
  const owned = readRawSessionProfile(key);
  if (owned) {
    return owned;
  }
  // One-time migrate legacy global → draft only
  if (id === SESSION_PROFILE_NEW_CONVO) {
    const legacy = readRawSessionProfile(SESSION_PROFILE_LEGACY_STORAGE_KEY);
    if (legacy) {
      try {
        window.localStorage.setItem(key, JSON.stringify(legacy));
      } catch {
        /* ignore quota */
      }
      return legacy;
    }
  }
  return DEFAULT_SESSION_PROFILE;
}

export function saveSessionProfile(
  next: Partial<SessionProfileState>,
  conversationId?: string | null,
): SessionProfileState {
  const id = normalizeSessionProfileConversationId(conversationId);
  const current = loadSessionProfile(id);
  const merged = normalizeSessionProfile({ ...current, ...next });
  if (typeof window !== 'undefined') {
    const key = sessionProfileStorageKey(id);
    window.localStorage.setItem(key, JSON.stringify(merged));
    // Keep legacy key in sync only for draft so older code paths stay coherent
    if (id === SESSION_PROFILE_NEW_CONVO) {
      try {
        window.localStorage.setItem(SESSION_PROFILE_LEGACY_STORAGE_KEY, JSON.stringify(merged));
      } catch {
        /* ignore */
      }
    }
    window.dispatchEvent(
      new CustomEvent(SESSION_PROFILE_CHANGED_EVENT, {
        detail: { conversationId: id, state: merged } satisfies SessionProfileChangedDetail,
      }),
    );
  }
  return merged;
}

/** Copy profile when a draft chat gets a real conversationId (mirrors ephemeral agent template). */
export function copySessionProfile(
  sourceConversationId: string | null | undefined,
  targetConversationId: string | null | undefined,
): SessionProfileState {
  const sourceId = normalizeSessionProfileConversationId(sourceConversationId);
  const targetId = normalizeSessionProfileConversationId(targetConversationId);
  const state = loadSessionProfile(sourceId);
  if (sourceId === targetId) {
    return state;
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(sessionProfileStorageKey(targetId), JSON.stringify(state));
    window.dispatchEvent(
      new CustomEvent(SESSION_PROFILE_CHANGED_EVENT, {
        detail: { conversationId: targetId, state } satisfies SessionProfileChangedDetail,
      }),
    );
  }
  return state;
}

function isDefaultSessionProfile(state: SessionProfileState): boolean {
  return (
    state.profile === DEFAULT_SESSION_PROFILE.profile &&
    state.orchMode === DEFAULT_SESSION_PROFILE.orchMode &&
    state.createContract === DEFAULT_SESSION_PROFILE.createContract &&
    state.executePolicy === DEFAULT_SESSION_PROFILE.executePolicy &&
    !state.orchParallel
  );
}

/** Copy NEW_CONVO draft onto a real id only if that id has no stored profile. */
export function ensureSessionProfile(conversationId?: string | null): SessionProfileState {
  const id = normalizeSessionProfileConversationId(conversationId);
  if (id === SESSION_PROFILE_NEW_CONVO || hasStoredSessionProfile(id)) {
    return loadSessionProfile(id);
  }
  const draft = loadSessionProfile(SESSION_PROFILE_NEW_CONVO);
  if (isDefaultSessionProfile(draft)) {
    return loadSessionProfile(id);
  }
  return copySessionProfile(SESSION_PROFILE_NEW_CONVO, id);
}

/** True if this conversation already has its own stored profile (not default/fallback). */
export function hasStoredSessionProfile(conversationId?: string | null): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.localStorage.getItem(sessionProfileStorageKey(conversationId)) != null;
}

export function sessionProfileInstruction(state: SessionProfileState): string | null {
  const parts: string[] = [];
  switch (state.profile) {
    case 'fast':
      parts.push(
        'Session profile: Fast. Prefer a short, direct answer. Skip long plans unless the user asks.',
      );
      break;
    case 'think':
      parts.push(
        'Session profile: Think. Reason carefully. State assumptions. Do not invent facts.',
      );
      break;
    case 'research':
      parts.push(
        'Session profile: Research. Use available search/file tools. Cite sources. Say when evidence is missing.',
      );
      break;
    case 'create':
      parts.push('Session profile: Create. Optimize for a deliverable, not chat filler.');
      break;
    case 'execute':
      parts.push(
        'Session profile: Execute. Prefer concrete next actions. Do not claim a tool ran if the runtime blocked it.',
      );
      break;
    case 'plan':
      parts.push(
        'Session profile: Plan. Produce a numbered plan only. Prefer read-only tools (search, office, github, dropbox list/read, fs read). Do not run destructive shell or claim a write succeeded unless a tool returned ok. Prefer plan text over side effects.',
      );
      break;
    case 'review':
      parts.push(
        'Session profile: Review. Critique the given work. Group findings by severity. Do not rewrite everything unless asked. Do not invent files that are not in context.',
      );
      break;
    case 'teach':
      parts.push(
        'Session profile: Teach. Explain in short steps with one example. Check understanding. Do not dump a textbook.',
      );
      break;
    case 'debug':
      parts.push(
        'Session profile: Debug. Isolate the failure, list missing repro/logs, propose the smallest fix. Do not claim a command ran if the runtime blocked it.',
      );
      break;
  }

  parts.push(
    'ClickHouse: tools clickhouse-hop (ch_smoke, then ch_query / ch_query_parquet). Do not invent SSH/bash hop. Do not curl :8123 from DE. Do not use memory to reconstruct the hop.',
  );

  if (state.orchMode === 'auto') {
    parts.push(
      'Orch mode: Auto. M0/M1 = one even-burn model. M2 = packages (not Team). If pick says M3, run real M2 packages — Auto does not spawn M3. Compare only with 2–3 candidates + independent judge. Not Team. MCP tools come from that model spec (clickhouse-hop included). Sidecar has no tools; the picked model does.',
    );
  } else if (state.orchMode === 'team') {
    parts.push(
      'Orch mode: Team = M2-interim (fixed research/coding/review/accept, no packages). Parent orchestrates only. After Team · accept JSON: ZERO further tool calls. accept=true then ## Ответ and stop. Parent has no filesystem/shell/dropbox/CH. Coding leaf does file work. Do not paste full leaf transcripts.',
    );
  } else if (state.orchMode === 'm2') {
    parts.push(
      'Orch mode: honest M2. Not Team roster. Snapshot has pkg-a@xai and pkg-b@anthropic; nested Off runs them. YOU still answer the user with tools (clickhouse-hop included). Do not refuse. Do not invent a transfer protocol.',
    );
  } else if (state.orchMode === 'compare') {
    parts.push(
      'Orch mode: Compare. 2–3 isolated candidates then an independent judge who sees their texts. Default readonly. Missing candidate is not scored. Need orchCompare spec. Not Auto. Not Team.',
    );
  } else if (state.orchMode === 'm3') {
    parts.push(
      'Orch mode: M3. Default sequential nested Off nodes (n1→n4). Not Team roster. If orchParallel, independent nodes may run in parallel. YOU still answer the user. Do not dump leaf transcripts.',
    );
  }

  if (state.profile === 'create') {
    switch (state.createContract) {
      case 'site':
        parts.push(
          'Create contract: Site. Emit one :::artifact{identifier="landing" type="text/html" title="Landing"} fence with a complete standalone HTML document (inline CSS). Native Artifacts (Sandpack) will preview it. This is not App Builder: no preview-*.sandbox.m894.tech, no public app URL, no chat cookies. Do not pretend it is hosted at chat.m894.tech.',
        );
        break;
      case 'slides':
        parts.push(
          'Create contract: Slides. Emit one :::artifact{identifier="slides" type="text/markdown" title="Slides"} fence: titled slides (title + bullets). generate_office_export kind=pptx writes a disk draft only. Do not invent a Dropbox URL; publish later via dropbox_publish if ok=true and verify.match.',
        );
        break;
      case 'pdf':
        parts.push(
          'Create contract: Document. Emit one :::artifact{identifier="document" type="text/markdown" title="Document"} fence (title, sections). generate_office_export kind=pdf writes a disk draft only. Do not invent a file URL.',
        );
        break;
      case 'table':
        parts.push(
          'Create contract: Table. Emit one :::artifact{identifier="table" type="text/markdown" title="Table"} fence with a markdown table and a CSV block. generate_office_export kind=xlsx writes a disk draft only. Do not invent a Dropbox URL.',
        );
        break;
      case 'email':
        parts.push(
          'Create contract: Email. Emit one :::artifact{identifier="email" type="text/markdown" title="Email"} fence with Subject + body. Short, no fake attachments.',
        );
        break;
      case 'memo':
        parts.push(
          'Create contract: Memo. Emit one :::artifact{identifier="memo" type="text/markdown" title="Memo"} fence: context, decision, next steps. No filler.',
        );
        break;
      case 'diagram':
        parts.push(
          'Create contract: Diagram. Emit one :::artifact{identifier="diagram" type="application/vnd.mermaid" title="Diagram"} fence with mermaid (flowchart or sequence). Native Artifacts will preview it. Do not invent a rendered image URL.',
        );
        break;
    }
  }

  if (state.profile === 'execute' && state.executePolicy === 'autorun') {
    parts.push(
      'Autorun requested: do not pause the reply for permission questions. Server write/exec tools remain gated until persist-gate ships; never invent a successful write.',
    );
  }

  return parts.length ? parts.join(' ') : null;
}

/** MCP servers that persist or exec. Plan/autorun strip the whole server. */
export const WRITE_EXEC_MCP_SERVERS = [
  'shell',
  'filesystem',
  'dropbox',
  'git',
  'onepassword',
  'playwright',
  'mac',
  'windows',
  'monetka-mail',
] as const;

const READ_MCP_FALLBACK = [
  'brave-search',
  'yandex-search',
  'memory',
  'sequential-thinking',
  'session',
];

export function sessionProfileGatesWriteExec(state?: SessionProfileState | null): boolean {
  if (!state) {
    return false;
  }
  // Plan: soft prompt only. Hard-stripping shell/dropbox/fs made models say
  // «нет инструментов» while users expected MCP. Hard gate = execute+autorun only.
  return state.profile === 'execute' && state.executePolicy === 'autorun';
}

const CREATE_ARTIFACT_CONTRACTS: CreateContractId[] = [
  'site',
  'slides',
  'pdf',
  'table',
  'email',
  'memo',
  'diagram',
];

/** Create contracts that should turn on native Artifacts (Sandpack). Not App Builder. */
export function sessionProfileEnablesArtifacts(state?: SessionProfileState | null): boolean {
  if (!state || state.profile !== 'create') {
    return false;
  }
  return CREATE_ARTIFACT_CONTRACTS.includes(state.createContract);
}

/** FLUX / video / Imagine — artifacts panel must not replace the media result (S-P3-MEDIA). */
export function isMediaStudioConversation(
  conversation?: {
    spec?: string | null;
    model?: string | null;
  } | null,
): boolean {
  const blob = `${conversation?.spec || ''} ${conversation?.model || ''}`;
  return /flux|z-image|zimage|wan22|wan-2|imagine-image|imagine-video|gpt-image|flash-image|vid-wan|grok-imagine/i.test(
    blob,
  );
}

export type SessionProfileClampOpts = {
  mediaStudio?: boolean;
};

/**
 * Fail-closed clamp for the live Node (no API restart).
 * Empty mcp would refill the host default pack (includes shell) — never send [].
 * Create/Site sets artifacts:default so initialize.ts injects the :::artifact prompt.
 */
export function clampEphemeralAgentForSessionProfile<
  T extends { mcp?: string[]; execute_code?: boolean; artifacts?: string } | null | undefined,
>(
  agent: T,
  state?: SessionProfileState | null,
  opts?: SessionProfileClampOpts,
): T | { mcp?: string[]; execute_code?: boolean; artifacts?: string } {
  const gated = sessionProfileGatesWriteExec(state);
  const enableArtifacts = sessionProfileEnablesArtifacts(state) && !opts?.mediaStudio;
  if (!gated && !enableArtifacts) {
    return agent;
  }
  const base: { mcp?: string[]; execute_code?: boolean; artifacts?: string } =
    agent && typeof agent === 'object' ? { ...agent } : {};
  const next: { mcp?: string[]; execute_code?: boolean; artifacts?: string } = { ...base };
  if (gated) {
    const blocked = new Set<string>(WRITE_EXEC_MCP_SERVERS);
    const current = Array.isArray(base.mcp) ? base.mcp : [];
    const kept = current.filter((name) => name && !blocked.has(name));
    next.mcp = kept.length ? kept : [...READ_MCP_FALLBACK];
    next.execute_code = false;
  }
  if (enableArtifacts) {
    const currentArtifacts = typeof next.artifacts === 'string' ? next.artifacts : '';
    if (!currentArtifacts) {
      next.artifacts = 'default';
    }
  }
  return next;
}
