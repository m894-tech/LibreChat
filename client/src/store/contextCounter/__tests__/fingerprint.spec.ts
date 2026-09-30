import { diffFingerprint, hashFingerprint, hashString } from '../fingerprint';
import { fingerprintFixture, LEAF_B } from '../fixtures';

describe('hashFingerprint', () => {
  it('is stable for equivalent inputs regardless of list order', () => {
    const a = hashFingerprint(fingerprintFixture({ toolIds: ['b', 'a', 'a'] }));
    const b = hashFingerprint(fingerprintFixture({ toolIds: ['a', 'b'] }));
    expect(a).toBe(b);
  });

  it('changes for every §7 term', () => {
    const base = hashFingerprint(fingerprintFixture());
    const variants = [
      fingerprintFixture({
        configuration: { endpoint: 'anthropic', model: 'other', agentId: null },
      }),
      fingerprintFixture({ window: 200_000 }),
      fingerprintFixture({ reserve: 1 }),
      fingerprintFixture({ inputLimit: 50_000 }),
      fingerprintFixture({ instructionsHash: 'x' }),
      fingerprintFixture({ toolIds: ['web_search'] }),
      fingerprintFixture({ skillIds: ['s'] }),
      fingerprintFixture({ branchLeafId: LEAF_B }),
      fingerprintFixture({ historyRevision: 'h2' }),
      fingerprintFixture({ draftHash: hashString('hello') }),
      fingerprintFixture({ attachmentIds: ['f1'] }),
      fingerprintFixture({ summaryRevision: 's1' }),
    ];
    for (const variant of variants) {
      expect(hashFingerprint(variant)).not.toBe(base);
    }
  });
});

describe('diffFingerprint', () => {
  const base = fingerprintFixture();

  it('returns null for equivalent inputs', () => {
    expect(
      diffFingerprint(base, fingerprintFixture({ toolIds: ['mcp:github', 'web_search'] })),
    ).toBeNull();
  });

  it.each([
    ['branch_changed', fingerprintFixture({ branchLeafId: LEAF_B, draftHash: 'd2' })],
    [
      'model_changed',
      fingerprintFixture({
        configuration: { endpoint: 'openAI', model: 'gpt-4o', agentId: null },
        window: 1,
        draftHash: 'd2',
      }),
    ],
    ['limits_changed', fingerprintFixture({ reserve: 1, toolIds: [], draftHash: 'd2' })],
    [
      'tokenizer_changed',
      fingerprintFixture({
        configuration: { ...base.configuration, countingMethod: 'v2' },
        toolIds: [],
      }),
    ],
    ['tools_changed', fingerprintFixture({ toolIds: [], instructionsHash: 'i2', draftHash: 'd2' })],
    ['instructions_changed', fingerprintFixture({ instructionsHash: 'i2', historyRevision: 'h2' })],
    ['compressed', fingerprintFixture({ summaryRevision: 's2', historyRevision: 'h2' })],
    ['history_changed', fingerprintFixture({ historyRevision: 'h2', attachmentIds: ['f'] })],
    ['attachments_changed', fingerprintFixture({ attachmentIds: ['f'], draftHash: 'd2' })],
    ['draft_changed', fingerprintFixture({ draftHash: 'd2' })],
  ] as const)('prefers %s over less specific reasons', (reason, next) => {
    expect(diffFingerprint(base, next)).toBe(reason);
  });
});
