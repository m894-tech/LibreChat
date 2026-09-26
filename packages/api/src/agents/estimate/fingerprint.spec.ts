import type { TContextFingerprintInput } from 'librechat-data-provider';
import { buildContextFingerprint, hashText, hashValue, stableStringify } from './fingerprint';

const base: TContextFingerprintInput = {
  configuration: {
    endpoint: 'agents',
    provider: 'openAI',
    model: 'gpt-4o',
    agentId: 'agent_1',
    countingMethod: 'ai-tokenizer:o200k_base:v1',
  },
  window: 128_000,
  reserve: 16_000,
  inputLimit: null,
  instructionsHash: hashText('You are helpful.'),
  toolIds: ['web_search', 'read_mcp_files'],
  skillIds: ['pdf'],
  assemblySettingsHash: hashValue({ summarizationEnabled: true, reserveRatio: 0.05 }),
  branchLeafId: 'leaf-1',
  historyRevision: hashValue([['m1', 10, null]]),
  draftHash: hashText('hello'),
  attachmentIds: ['file-a'],
  summaryRevision: undefined,
};

describe('stableStringify', () => {
  it('sorts object keys recursively and drops undefined members', () => {
    expect(stableStringify({ b: 1, a: { d: undefined, c: [2, { z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[2,{"y":2,"z":1}]},"b":1}',
    );
  });
});

describe('buildContextFingerprint (§7)', () => {
  it('is deterministic and independent of tool/attachment order', () => {
    const a = buildContextFingerprint(base);
    const b = buildContextFingerprint({
      ...base,
      toolIds: [...base.toolIds].reverse(),
      attachmentIds: [...base.attachmentIds],
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it.each<[string, Partial<TContextFingerprintInput>]>([
    ['model', { configuration: { ...base.configuration, model: 'gpt-4.1' } }],
    ['provider', { configuration: { ...base.configuration, provider: 'anthropic' } }],
    ['window', { window: 200_000 }],
    ['reserve', { reserve: 8_000 }],
    ['input limit', { inputLimit: 100_000 }],
    ['instructions', { instructionsHash: hashText('Be terse.') }],
    ['tools', { toolIds: ['web_search'] }],
    ['skills', { skillIds: [] }],
    ['assembly settings', { assemblySettingsHash: hashValue({ summarizationEnabled: false }) }],
    ['branch', { branchLeafId: 'leaf-2' }],
    ['history', { historyRevision: hashValue([['m1', 12, null]]) }],
    ['draft', { draftHash: hashText('hello!') }],
    ['attachments', { attachmentIds: ['file-a', 'file-b'] }],
    ['summary', { summaryRevision: hashText('summary') }],
    [
      'tokenizer version',
      { configuration: { ...base.configuration, countingMethod: 'ai-tokenizer:claude:v1' } },
    ],
  ])('changes when %s changes', (_label, patch) => {
    expect(buildContextFingerprint({ ...base, ...patch })).not.toBe(buildContextFingerprint(base));
  });

  it('never embeds instruction or draft text, only hashes', () => {
    const fingerprint = buildContextFingerprint(base);
    expect(fingerprint).not.toContain('helpful');
    expect(hashText('You are helpful.')).not.toContain('helpful');
    expect(hashText(undefined)).toBeUndefined();
  });
});
