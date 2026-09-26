import type { PresentonTransport } from './presenton-adapter';
import { ProviderUncertainError } from './providers';
import { DesignError } from './errors';
/** Explicit per-user Presenton bearer, no cookie or host identity fallback. */
export function createPresentationTransport(config: {
  baseURL: string;
  allowedOrigins: string[];
  resolveCredential: (actor: string) => Promise<string | null>;
  fetchImpl: typeof fetch;
}): PresentonTransport {
  const base = new URL(config.baseURL);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !config.allowedOrigins.includes(base.origin)
  )
    throw new DesignError(422, 'presentation_config', 'Invalid presentation endpoint');
  return {
    async request(actor, path, init) {
      if (
        !/^\/api\/v1\/ppt\/(images\/upload|editor\/v1\/documents\/[a-zA-Z0-9-]+\/(snapshot|operations(?:\/[a-zA-Z0-9-]+)?))$/.test(
          path,
        )
      )
        throw new DesignError(422, 'presentation_path', 'Endpoint not allowed');
      const url = new URL(path, base);
      if (url.origin !== base.origin)
        throw new DesignError(422, 'presentation_origin', 'Wrong origin');
      const abort = new Promise<never>((_, reject) => {
        if (init.signal.aborted) reject(new ProviderUncertainError('Presentation timeout'));
        else
          init.signal.addEventListener(
            'abort',
            () => reject(new ProviderUncertainError('Presentation timeout')),
            { once: true },
          );
      });
      const token = await Promise.race([config.resolveCredential(actor), abort]);
      if (!token)
        throw new DesignError(401, 'presentation_auth', 'Configure your presentation credential');
      const response = await Promise.race([
        config.fetchImpl(url.href, {
          method: init.method,
          signal: init.signal,
          redirect: 'error',
          headers: {
            Authorization: 'Bearer ' + token,
            ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          },
          body:
            init.body === undefined
              ? undefined
              : init.body instanceof FormData
                ? init.body
                : JSON.stringify(init.body),
        }),
        abort,
      ]);
      if (!response.ok) {
        if (response.status === 404)
          throw new DesignError(404, 'presentation_missing', 'Presentation or receipt not found');
        if (response.status === 409)
          throw new DesignError(409, 'presentation_revision', 'Destination changed');
        if (response.status === 401 || response.status === 403)
          throw new DesignError(403, 'presentation_auth', 'Presentation access denied');
        throw new ProviderUncertainError('Presentation response uncertain');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new ProviderUncertainError('Empty presentation response');
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          if (init.signal.aborted) throw new ProviderUncertainError('Presentation timeout');
          const result = await Promise.race([reader.read(), abort]);
          if (result.done) break;
          total += result.value.length;
          if (total > 1024 * 1024)
            throw new DesignError(422, 'presentation_size', 'Response too large');
          chunks.push(result.value);
        }
      } finally {
        void reader.cancel().catch(() => {});
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new ProviderUncertainError('Invalid presentation JSON');
      }
    },
  };
}
