import {
  clampEphemeralAgentForSessionProfile,
  copySessionProfile,
  isMediaStudioConversation,
  loadSessionProfile,
  normalizeSessionProfile,
  saveSessionProfile,
  sessionProfileEnablesArtifacts,
  sessionProfileInstruction,
  sessionProfileStorageKey,
} from '../sessionProfiles';

const off = { orchMode: 'off' as const };

describe('sessionProfiles', () => {
  it('defaults unknown values', () => {
    expect(normalizeSessionProfile({})).toEqual({
      profile: 'fast',
      createContract: 'none',
      executePolicy: 'ask',
      orchMode: 'off',
      orchParallel: false,
    });
  });

  it('keeps create contract only in create profile', () => {
    expect(normalizeSessionProfile({ profile: 'fast', createContract: 'slides' })).toEqual({
      profile: 'fast',
      createContract: 'none',
      executePolicy: 'ask',
      orchMode: 'off',
      orchParallel: false,
    });
    expect(
      normalizeSessionProfile({ profile: 'create', createContract: 'slides' }).createContract,
    ).toBe('slides');
  });

  it('autorun only on execute', () => {
    expect(
      normalizeSessionProfile({ profile: 'think', executePolicy: 'autorun' }).executePolicy,
    ).toBe('ask');
    expect(
      normalizeSessionProfile({ profile: 'execute', executePolicy: 'autorun' }).executePolicy,
    ).toBe('autorun');
  });

  it('builds honest create/autorun instructions', () => {
    const create = sessionProfileInstruction({
      profile: 'create',
      createContract: 'site',
      executePolicy: 'ask',
      ...off,
    });
    expect(create).toMatch(/standalone HTML/i);
    expect(create).toMatch(/Do not pretend it is hosted/i);
    const auto = sessionProfileInstruction({
      profile: 'execute',
      createContract: 'none',
      executePolicy: 'autorun',
      ...off,
    });
    expect(auto).toMatch(/Autorun requested/i);
    expect(auto).toMatch(/persist-gate/i);
  });

  it('accepts extra prompt-only profiles and create contracts', () => {
    expect(normalizeSessionProfile({ profile: 'plan' }).profile).toBe('plan');
    expect(normalizeSessionProfile({ profile: 'review' }).profile).toBe('review');
    expect(normalizeSessionProfile({ profile: 'teach' }).profile).toBe('teach');
    expect(normalizeSessionProfile({ profile: 'debug' }).profile).toBe('debug');
    expect(normalizeSessionProfile({}).orchMode).toBe('off');
    expect(normalizeSessionProfile({ orchMode: 'team' }).orchMode).toBe('team');
    expect(normalizeSessionProfile({ orchMode: 'nope' as 'off' }).orchMode).toBe('off');
    const team = sessionProfileInstruction({
      profile: 'think',
      createContract: 'none',
      executePolicy: 'ask',
      orchMode: 'team',
    });
    expect(team).toMatch(/Orch mode: Team/);
    expect(team).toMatch(/Parent orchestrates/);

    expect(
      normalizeSessionProfile({ profile: 'create', createContract: 'diagram' }).createContract,
    ).toBe('diagram');
    const plan = sessionProfileInstruction({
      profile: 'plan',
      createContract: 'none',
      executePolicy: 'ask',
      ...off,
    });
    expect(plan).toMatch(/Plan/);
    expect(plan).toMatch(/numbered plan/i);
    expect(plan).toMatch(/Prefer read-only tools/i);
    const diagram = sessionProfileInstruction({
      profile: 'create',
      createContract: 'diagram',
      executePolicy: 'ask',
      ...off,
    });
    expect(diagram).toMatch(/mermaid/i);
    expect(diagram).toMatch(/Do not invent a rendered image URL/i);
  });

  it('Plan keeps MCP; autorun clamp strips write MCP and never sends empty mcp', () => {
    const plan = {
      profile: 'plan' as const,
      createContract: 'none' as const,
      executePolicy: 'ask' as const,
      ...off,
    };
    const auto = {
      profile: 'execute' as const,
      createContract: 'none' as const,
      executePolicy: 'autorun' as const,
      ...off,
    };
    const think = {
      profile: 'think' as const,
      createContract: 'none' as const,
      executePolicy: 'ask' as const,
      ...off,
    };
    expect(
      clampEphemeralAgentForSessionProfile(
        { mcp: ['shell', 'brave-search', 'dropbox'], execute_code: true },
        plan,
      ),
    ).toEqual({ mcp: ['shell', 'brave-search', 'dropbox'], execute_code: true });
    const fromNull = clampEphemeralAgentForSessionProfile(null, auto);
    expect(fromNull && 'mcp' in fromNull ? fromNull.mcp : []).toEqual(
      expect.arrayContaining(['brave-search', 'session']),
    );
    expect(fromNull && 'execute_code' in fromNull ? fromNull.execute_code : true).toBe(false);
    expect(
      clampEphemeralAgentForSessionProfile({ mcp: ['shell'], execute_code: true }, think),
    ).toEqual({ mcp: ['shell'], execute_code: true });
  });

  it('Create/Site turns on native Artifacts; media studio does not', () => {
    const site = {
      profile: 'create' as const,
      createContract: 'site' as const,
      executePolicy: 'ask' as const,
      ...off,
    };
    expect(sessionProfileEnablesArtifacts(site)).toBe(true);
    expect(
      sessionProfileEnablesArtifacts({
        profile: 'think',
        createContract: 'none',
        executePolicy: 'ask',
        ...off,
      }),
    ).toBe(false);
    expect(isMediaStudioConversation({ spec: 'flux-schnell-studio' })).toBe(true);
    expect(isMediaStudioConversation({ spec: 'kimi-k2.6' })).toBe(false);
    expect(clampEphemeralAgentForSessionProfile({ mcp: ['brave-search'] }, site)).toEqual({
      mcp: ['brave-search'],
      artifacts: 'default',
    });
    expect(
      clampEphemeralAgentForSessionProfile({ mcp: ['brave-search'] }, site, { mediaStudio: true }),
    ).toEqual({ mcp: ['brave-search'] });
    const instr = sessionProfileInstruction(site);
    expect(instr).toMatch(/:::artifact/);
    expect(instr).toMatch(/not App Builder/i);
    expect(instr).toMatch(/Do not pretend it is hosted at chat\.m894\.tech/);
  });

  describe('per-conversation storage', () => {
    const store: Record<string, string> = {};
    const ls = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        Object.keys(store).forEach((k) => delete store[k]);
      },
    };
    beforeEach(() => {
      Object.keys(store).forEach((k) => delete store[k]);
      const g = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
      if (!g.window) {
        (g as { window: unknown }).window = g as unknown as Window & typeof globalThis;
      }
      Object.defineProperty(g.window, 'localStorage', {
        configurable: true,
        value: ls,
      });
      g.window.dispatchEvent = () => true;
    });

    it('isolates plan in chat A from chat B', () => {
      saveSessionProfile({ profile: 'plan' }, 'convo-A');
      expect(loadSessionProfile('convo-A').profile).toBe('plan');
      expect(loadSessionProfile('convo-B').profile).toBe('fast');
      saveSessionProfile({ profile: 'fast' }, 'convo-B');
      expect(loadSessionProfile('convo-A').profile).toBe('plan');
      expect(loadSessionProfile('convo-B').profile).toBe('fast');
    });

    it('migrates legacy global only into new draft', () => {
      store['m894_session_profile_v1'] = JSON.stringify({
        profile: 'plan',
        createContract: 'none',
        executePolicy: 'ask',
      });
      expect(loadSessionProfile('new').profile).toBe('plan');
      expect(loadSessionProfile('other-chat').profile).toBe('fast');
      expect(store[sessionProfileStorageKey('new')]).toBeTruthy();
    });

    it('copySessionProfile moves draft profile onto real id', () => {
      saveSessionProfile({ profile: 'research' }, 'new');
      copySessionProfile('new', 'real-123');
      expect(loadSessionProfile('real-123').profile).toBe('research');
      saveSessionProfile({ profile: 'debug' }, 'new');
      expect(loadSessionProfile('real-123').profile).toBe('research');
    });
  });
});
