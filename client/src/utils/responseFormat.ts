export type ResponseFormat = 'default' | 'concise' | 'detailed' | 'json';

export const RESPONSE_FORMATS: ResponseFormat[] = ['default', 'concise', 'detailed', 'json'];

const CONCISE_INSTRUCTION = [
  'Response format: concise.',
  'Answer directly with the minimum needed detail.',
  'Prefer short paragraphs or a tight bullet list.',
  'Do not add filler, restatements, or unused options.',
].join(' ');

const DETAILED_INSTRUCTION = [
  'Response format: detailed.',
  'Explain the reasoning, cover important caveats, and structure the answer clearly.',
  'Use headings or bullets when they improve readability.',
  'Do not invent facts.',
].join(' ');

const JSON_INSTRUCTION = [
  'Response format: JSON only.',
  'Return a single valid JSON value and no markdown fences or prose outside JSON.',
  'If the user did not specify a schema, use a clear object with useful keys.',
].join(' ');

export function getResponseFormatInstruction(
  format: ResponseFormat | null | undefined,
): string | null {
  switch (format) {
    case 'concise':
      return CONCISE_INSTRUCTION;
    case 'detailed':
      return DETAILED_INSTRUCTION;
    case 'json':
      return JSON_INSTRUCTION;
    default:
      return null;
  }
}

/** Conservative UI gate: native JSON mode only for OpenAI-family text endpoints. */
export function endpointSupportsNativeJsonMode({
  endpoint,
  endpointType,
  model,
}: {
  endpoint?: string | null;
  endpointType?: string | null;
  model?: string | null;
}): boolean {
  const haystack = `${endpoint || ''} ${endpointType || ''} ${model || ''}`.toLowerCase();
  if (!haystack.trim()) {
    return false;
  }
  if (
    /imagine-image|imagine-video|gpt-image|flash-image|gemini-.*image|dall-e|tts|whisper|realtime/.test(
      haystack,
    )
  ) {
    return false;
  }
  return /openai|azure|agents|openrouter|chatgpt|gpt-/.test(haystack);
}

export function normalizeResponseFormat(value: unknown): ResponseFormat {
  if (value === 'concise' || value === 'detailed' || value === 'json' || value === 'default') {
    return value;
  }
  return 'default';
}
