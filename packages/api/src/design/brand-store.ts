import type { DesignStore } from './store';
import {
  validateBrandPackage,
  materializeBrandSystem,
  type BrandPackage,
  type MaterializedBrandSystem,
} from './brand-package';
import { canonicalHash } from './operations';
import { getMemberRole } from './store';
import { DesignError } from './errors';
export interface PublishedBrand {
  projectId: string;
  id: string;
  version: string;
  package: BrandPackage;
  system: MaterializedBrandSystem;
  hash: string;
  publishedBy: string;
}
export interface BrandStore {
  publish(actor: string, projectId: string, input: unknown): Promise<PublishedBrand>;
  list(actor: string, projectId: string): Promise<PublishedBrand[]>;
}
/** Immutable project-scoped registry. Does not alter global catalog or existing documents. */
export async function createBrandStore(store: DesignStore): Promise<BrandStore> {
  const rows = store.connection.collection('design_brand_packages');
  await rows.createIndex({ projectId: 1, id: 1, version: 1 }, { unique: true });
  const view = (r: any): PublishedBrand => ({
    projectId: r.projectId,
    id: r.id,
    version: r.version,
    package: r.package,
    system: r.system,
    hash: r.hash,
    publishedBy: r.publishedBy,
  });
  return {
    async publish(actor, projectId, input) {
      const pkg = validateBrandPackage(input);
      const system = materializeBrandSystem(pkg);
      if (pkg.fonts.some((f) => f.assetId))
        throw new DesignError(
          422,
          'brand_fonts',
          'Custom font assets not supported by this adapter',
        );
      const hash = canonicalHash(pkg);
      return store.withProjectWrite(actor, projectId, async (session) => {
        const project = await store.models.DesignProject.findById(projectId).session(session);
        if (!project || getMemberRole(project, actor) !== 'owner')
          throw new DesignError(403, 'forbidden', 'Only owner can publish brand packages');
        const existing = await rows.findOne(
          { projectId, id: pkg.id, version: pkg.version },
          { session },
        );
        if (existing) {
          if (existing.hash !== hash)
            throw new DesignError(409, 'brand_version', 'Published version is immutable');
          return view(existing);
        }
        const record: PublishedBrand = {
          projectId,
          id: pkg.id,
          version: pkg.version,
          package: pkg,
          system,
          hash,
          publishedBy: actor,
        };
        await rows.insertOne({ ...record, createdAt: new Date() }, { session });
        return record;
      });
    },
    async list(actor, projectId) {
      const projects = await store.listProjects(actor);
      if (!projects.some((p) => p.id === projectId))
        throw new DesignError(404, 'not_found', 'Project not found');
      return (await rows.find({ projectId }).limit(100).toArray()).map(view);
    },
  };
}
