import {
  endpointSupportsNativeJsonMode,
  getResponseFormatInstruction,
  normalizeResponseFormat,
} from '../responseFormat';

describe('responseFormat', () => {
  it('returns instructions for non-default formats', () => {
    expect(getResponseFormatInstruction('default')).toBeNull();
    expect(getResponseFormatInstruction('concise')).toMatch(/concise/i);
    expect(getResponseFormatInstruction('detailed')).toMatch(/detailed/i);
    expect(getResponseFormatInstruction('json')).toMatch(/JSON only/i);
  });

  it('gates native JSON mode conservatively', () => {
    expect(endpointSupportsNativeJsonMode({ endpoint: 'openAI', model: 'gpt-4.1' })).toBe(true);
    expect(endpointSupportsNativeJsonMode({ endpoint: 'agents', model: 'gpt-4o' })).toBe(true);
    expect(
      endpointSupportsNativeJsonMode({ endpoint: 'agents', model: 'grok-imagine-video' }),
    ).toBe(false);
  });

  it('normalizes unknown values to default', () => {
    expect(normalizeResponseFormat('nope')).toBe('default');
    expect(normalizeResponseFormat('json')).toBe('json');
  });
});
