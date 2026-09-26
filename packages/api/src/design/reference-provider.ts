import type { ReferenceProvider, ReferenceRecord, ReferenceKind } from './reference-workflow';
import { normalizeReferenceSearch } from './reference-normalize';
import { DesignError } from './errors';
export interface AuthorizedReferenceToolTransport {
  /** Must independently enforce actor's current tool/server grant; never app connection fallback. */
  call(
    actor: string,
    tool: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown>;
}
const TOOLS: Readonly<Record<ReferenceKind, string>> = {
  styles: 'refero_search_styles',
  screens: 'refero_search_screens',
  flows: 'refero_search_flows',
};
/** Reference metadata only. Actual transport is injected from authenticated MCP context. */
export function createReferenceProvider(
  transport: AuthorizedReferenceToolTransport,
): ReferenceProvider {
  return {
    async search(actor, kind, query) {
      if (!actor || !TOOLS[kind] || typeof query !== 'string' || query.length > 300)
        throw new DesignError(422, 'reference_input', 'Invalid reference query');
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new DesignError(504, 'reference_timeout', 'Reference lookup timed out'));
          }, 15000);
        });
        const response = await Promise.race([
          transport.call(
            actor,
            TOOLS[kind],
            {
              query,
              page: 1,
              response_format: 'json',
              ...(kind === 'styles' ? {} : { platform: 'web' }),
            },
            controller.signal,
          ),
          timeout,
        ]);
        return normalizeReferenceSearch(response, kind);
      } finally {
        clearTimeout(timer!);
        controller.abort();
      }
    },
  };
}
