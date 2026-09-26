import type { Connection, ClientSession } from 'mongoose';
import { createSystemResolver, type SystemResolver } from './system-resolver';
import { validateBrandPackage, type BrandPackage } from './brand-package';
import { DesignError } from './errors';
/** Invoke only after same-transaction project ACL. Scope never persisted globally. */
export async function loadProjectSystemResolver(
  connection: Connection,
  projectId: string,
  session?: ClientSession,
): Promise<SystemResolver> {
  const rows = await connection
    .collection('design_brand_packages')
    .find({ projectId }, session ? { session } : {})
    .limit(100)
    .toArray();
  const brands: BrandPackage[] = rows.map((row) => {
    const pkg = validateBrandPackage(row.package);
    if (pkg.fonts.some((f) => f.assetId))
      throw new DesignError(422, 'brand_fonts', 'Custom font assets unsupported');
    return pkg;
  });
  return createSystemResolver(brands);
}
