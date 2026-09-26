import { AsyncLocalStorage } from 'node:async_hooks';
/** Request/transaction local registry only. Never mutates builtin catalog.
 * Caller must load registry after current project ACL. Untrusted input cannot set it.
 */
export interface ScopedSystem {
  id: string;
  version: string;
  name: string;
  tokens: Record<string, import('./systems').DesignToken>;
  fonts: readonly string[];
}
const contexts = new AsyncLocalStorage<ReadonlyMap<string, ScopedSystem>>();
export function withSystemRegistry<T>(systems: readonly ScopedSystem[], work: () => T): T {
  const map = new Map<string, ScopedSystem>();
  for (const system of systems) {
    const key = system.id + '@' + system.version;
    if (map.has(key)) throw Error('Duplicate system identity');
    map.set(key, JSON.parse(JSON.stringify(system)));
  }
  return contexts.run(map, work);
}
export function resolveScopedSystem(id: string, version: string): ScopedSystem | undefined {
  return contexts.getStore()?.get(id + '@' + version);
}
