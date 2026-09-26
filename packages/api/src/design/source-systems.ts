import { createSystemResolver, type SystemResolver } from './system-resolver';
import { validateBrandPackage, type BrandPackage } from './brand-package';
import { DesignError } from './errors';
/** Untrusted package admission: only validated known-base brand tokens/fonts; no global install. */
export function sourceSystemResolver(source: unknown): {
  resolver: SystemResolver;
  brands: BrandPackage[];
} {
  const raw = typeof source === 'string' ? JSON.parse(source) : source;
  const entries = (
    raw && typeof raw === 'object' ? ('customSystems' in raw ? raw.customSystems : []) : []
  ) as unknown;
  if (!Array.isArray(entries) || entries.length > 16)
    throw new DesignError(422, 'source_systems', 'Invalid custom system list');
  const brands = entries.map((value) => {
    const b = validateBrandPackage(value);
    if (b.fonts.some((f) => f.assetId))
      throw new DesignError(422, 'source_fonts', 'Custom fonts unsupported');
    return b;
  });
  return { resolver: createSystemResolver(brands), brands };
}
