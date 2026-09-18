import type { NativeKnobFamily } from '../nativeKnobs';
import {
  createNativeKnobsPayload,
  filterNativeKnobFamilyForModel,
  isNativeKnobChipActive,
  matchNativeKnobFamily,
  mergeNativeKnobValues,
} from '../nativeKnobs';

const video: NativeKnobFamily = {
  id: 'grok-imagine-video',
  label: 'Imagine Video',
  kind: 'video',
  match: ['grok-imagine-video', 'Imagine Video'],
  excludePrefixes: ['CP. ', 'PPLX. ', 'CUR. '],
  defaults: { duration: 10, aspect_ratio: '16:9', resolution: '720p' },
  groups: [
    { id: 'duration', chips: [{ id: '10', label: '10s', apply: { duration: 10 } }] },
    {
      id: 'resolution',
      chips: [
        { id: '720', label: '720p', apply: { resolution: '720p' } },
        {
          id: '1080',
          label: '1080p',
          apply: { resolution: '1080p' },
          modelIncludes: ['grok-imagine-video-1.5'],
        },
      ],
    },
    { id: 'aspect_ratio', chips: [{ id: 'wide', label: '16:9', apply: { aspect_ratio: '16:9' } }] },
  ],
};

const sonar: NativeKnobFamily = {
  id: 'sonar-recency',
  label: 'Sonar',
  kind: 'search',
  match: ['sonar-pro'],
  defaults: { search_recency_filter: 'week' },
  groups: [
    {
      id: 'search_recency_filter',
      chips: [{ id: 'day', label: 'day', apply: { search_recency_filter: 'day' } }],
    },
  ],
};

describe('native model controls', () => {
  it('matches by real model id without depending on DOM labels', () => {
    expect(matchNativeKnobFamily([video, sonar], { model: 'grok-imagine-video-1.5-preview' })).toBe(
      video,
    );
  });

  it('honors excluded spec prefixes', () => {
    expect(
      matchNativeKnobFamily([video], {
        model: 'grok-imagine-video',
        spec: 'PPLX. Imagine Video',
      }),
    ).toBeNull();
  });

  it('drops unknown persisted fields', () => {
    expect(mergeNativeKnobValues(video, { resolution: '1080p', endpoint: 'evil' })).toEqual({
      duration: 10,
      aspect_ratio: '16:9',
      resolution: '1080p',
    });
  });

  it('drops persisted values that are not valid enum choices', () => {
    expect(mergeNativeKnobValues(video, { resolution: '2k' })).toEqual({
      duration: 10,
      aspect_ratio: '16:9',
      resolution: '720p',
    });
  });

  it('shows 1080p only for Imagine Video 1.5', () => {
    const legacy = filterNativeKnobFamilyForModel(video, 'grok-imagine-video');
    const preview = filterNativeKnobFamilyForModel(video, 'grok-imagine-video-1.5-preview');
    expect(legacy?.groups.find((group) => group.id === 'resolution')?.chips).toHaveLength(1);
    expect(preview?.groups.find((group) => group.id === 'resolution')?.chips).toHaveLength(2);
  });

  it('builds the existing backend-compatible top-level payload', () => {
    expect(createNativeKnobsPayload(video, { resolution: '1080p' })).toEqual({
      family: 'grok-imagine-video',
      duration: 10,
      aspect_ratio: '16:9',
      resolution: '1080p',
    });
  });

  it('keeps nested Kimi thinking/swarm objects and marks the matching chip active', () => {
    const kimi: NativeKnobFamily = {
      id: 'kimi-k26',
      label: 'Kimi K2.6',
      kind: 'text',
      match: ['kimi-k2.6'],
      defaults: { thinking: { type: 'enabled' }, agent: { type: 'off' } },
      groups: [
        {
          id: 'thinking',
          chips: [
            { id: 'on', label: 'Think', apply: { thinking: { type: 'enabled' } } },
            { id: 'off', label: 'Off', apply: { thinking: { type: 'disabled' } } },
          ],
        },
        {
          id: 'swarm',
          chips: [
            { id: 'off', label: 'No swarm', apply: { agent: { type: 'off' } } },
            { id: '8', label: 'Swarm×8', apply: { agent: { type: 'swarm', max_agents: 8 } } },
          ],
        },
      ],
    };
    const merged = mergeNativeKnobValues(kimi, {
      thinking: { type: 'disabled' },
      agent: { type: 'swarm', max_agents: 8 },
    });
    expect(merged.thinking).toEqual({ type: 'disabled' });
    expect(merged.agent).toEqual({ type: 'swarm', max_agents: 8 });
    expect(isNativeKnobChipActive(merged, kimi.groups[1].chips[1])).toBe(true);
    expect(createNativeKnobsPayload(kimi, merged)?.family).toBe('kimi-k26');
  });

  it('matches K3 and K2.7 before the broader K2.6 family and skips CUR Claude', () => {
    const k27: NativeKnobFamily = {
      id: 'kimi-k27-code',
      label: 'Kimi K2.7 Code',
      kind: 'text',
      match: ['kimi-k2.7-code', 'kimi-k2.7'],
      defaults: {},
      groups: [],
    };
    const k26: NativeKnobFamily = {
      id: 'kimi-k26',
      label: 'Kimi K2.6',
      kind: 'text',
      match: ['kimi-k2.6', 'kimi-k2'],
      defaults: {},
      groups: [],
    };
    const claude: NativeKnobFamily = {
      id: 'claude-adaptive',
      label: 'Claude effort',
      kind: 'text',
      match: ['claude-opus-5', 'Opus 5'],
      excludeIncludes: ['cur-claude'],
      defaults: {},
      groups: [],
    };
    expect(matchNativeKnobFamily([k27, k26], { model: 'kimi-k2.7-code' })?.id).toBe(
      'kimi-k27-code',
    );
    expect(matchNativeKnobFamily([k27, k26], { model: 'kimi-k2' })?.id).toBe('kimi-k26');
    expect(
      matchNativeKnobFamily([claude], {
        model: 'cur-claude-opus-5-high',
        spec: 'cur-claude-opus-5-high',
      }),
    ).toBeNull();
    expect(
      matchNativeKnobFamily([claude], { model: 'claude-opus-5', spec: 'cc-claude-opus-5' })?.id,
    ).toBe('claude-adaptive');
  });
});
