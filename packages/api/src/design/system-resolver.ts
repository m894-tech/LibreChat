/**
 * Optional injected SystemResolver for pure domain validation/apply.
 *
 * Callers build project-scoped published brand maps; domain never mutates the
 * global systems catalog or AsyncLocalStorage registries. Missing systems fail closed.
 */

import { createHash } from 'crypto';
import { materializeBrandSystem, validateBrandPackage, type BrandPackage } from './brand-package';
import { getSystem, systemKey, type DesignToken } from './systems';
import { DesignError } from './errors';

/**
 * Structural design-system shape with free-form `id` (builtin enum OR custom brand id).
 * Matches DesignSystemPackage fields without constraining id to AllowedSystemId.
 */
export interface ResolvedDesignSystem {
  id: string;
  version: string;
  name: string;
  tokens: Record<string, DesignToken>;
  fonts: readonly string[];
}

/** Resolve a pinned system id@version. Undefined means missing (fail closed). */
export type SystemResolver = (id: string, version: string) => ResolvedDesignSystem | undefined;

export type { BrandPackage };

function fail(message: string): never {
  throw new DesignError(422, 'VALIDATION', message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Stable SHA-256 for duplicate same-id/version different-hash rejection. */
function brandContentHash(brand: BrandPackage): string {
  const canonical = canonicalize(brand, 0);
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function canonicalize(value: unknown, depth: number): unknown {
  if (depth > 32) {
    fail('brand nesting exceeds limit');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('non-finite number in brand hash');
    }
    return value;
  }
  if (typeof value !== 'object') {
    fail('brand contains a non-JSON type');
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, depth + 1));
  }
  if (!isPlainObject(value)) {
    fail('brand must be a plain object');
  }
  const keys = Object.keys(value).sort();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      fail(`brand contains forbidden key "${key}"`);
    }
    const next = value[key];
    if (next !== undefined) {
      out[key] = canonicalize(next, depth + 1);
    }
  }
  return out;
}

function cloneResolved(system: ResolvedDesignSystem): ResolvedDesignSystem {
  const tokens: Record<string, DesignToken> = Object.create(null) as Record<string, DesignToken>;
  for (const role of Object.keys(system.tokens)) {
    const token = system.tokens[role];
    tokens[role] = {
      role: token.role,
      type: token.type,
      value: token.value,
      properties: token.properties.slice(),
    };
  }
  return {
    id: system.id,
    version: system.version,
    name: system.name,
    tokens,
    fonts: system.fonts.slice(),
  };
}

/**
 * Build an immutable resolver over caller-provided published brands + builtin defaults.
 *
 * - Materializes each brand via `materializeBrandSystem` (validates package).
 * - Rejects builtin id collisions and duplicate id@version with different content hash.
 * - Does not mutate `systemsCatalog` / ALS.
 */
export function createSystemResolver(brands: BrandPackage[]): SystemResolver {
  if (!Array.isArray(brands)) {
    fail('brands must be an array');
  }

  const entries = new Map<string, { system: ResolvedDesignSystem; hash: string }>();

  for (let index = 0; index < brands.length; index++) {
    const brand = brands[index];
    const pkg = validateBrandPackage(brand);
    const materialized = materializeBrandSystem(pkg);
    const key = systemKey(materialized.id, materialized.version);

    if (getSystem(materialized.id, materialized.version) !== undefined) {
      fail(`brand ${materialized.id}@${materialized.version} collides with a builtin system`);
    }

    const hash = brandContentHash(pkg);

    const existing = entries.get(key);
    if (existing) {
      if (existing.hash !== hash) {
        fail(
          `duplicate brand ${materialized.id}@${materialized.version} with different content hash`,
        );
      }
      continue;
    }

    entries.set(key, { system: cloneResolved(materialized), hash });
  }

  const frozen = new Map<string, ResolvedDesignSystem>();
  for (const [key, entry] of entries) {
    frozen.set(key, entry.system);
  }

  const resolver: SystemResolver = (
    id: string,
    version: string,
  ): ResolvedDesignSystem | undefined => {
    const custom = frozen.get(systemKey(id, version));
    if (custom) {
      return cloneResolved(custom);
    }
    const builtin = getSystem(id, version);
    if (!builtin) {
      return undefined;
    }
    return cloneResolved(builtin);
  };

  return resolver;
}

/** Default resolver: pinned builtin catalog only (fail closed for unknown ids). */
export const defaultSystemResolver: SystemResolver = (
  id: string,
  version: string,
): ResolvedDesignSystem | undefined => {
  const builtin = getSystem(id, version);
  if (!builtin) {
    return undefined;
  }
  return cloneResolved(builtin);
};
