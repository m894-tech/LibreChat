import { createHash } from 'node:crypto';
import type { DesignStore, SerializedDocument } from './store';
import type { AssetStore } from './assets';
import { remapPackageSource, type ImportedAssetMapping } from './package-remap';
import { parseSourcePackage } from './source-package-import';
import { materializeBrandSystem } from './brand-package';
import { sourceSystemResolver } from './source-systems';
import { loadPackageFonts } from './package-fonts';
import { canonicalHash } from './operations';
import { getMemberRole } from './store';
import { DesignError } from './errors';
/** One Mongo transaction for fresh asset metadata + document/history; files are private
 * until commit. Only known bundled font bytes accepted, never install uploaded fonts.
 */
export async function importSourcePackage(options: {
  actor: string;
  projectId: string;
  bytes: Buffer;
  store: DesignStore;
  assets: AssetStore;
  fontDir: string;
  allowBrandPublish?: boolean;
}): Promise<SerializedDocument> {
  const { actor, projectId, store, assets } = options;
  await store.withProjectWrite(actor, projectId, async () => true);
  const parsed = await parseSourcePackage(options.bytes);
  const families = parsed.imported.document.payload.nodes
    .filter((n) => n.type === 'text')
    .map((n) => n.props.fontFamily!);
  const expected = await loadPackageFonts(options.fontDir, families);
  const supplied = Object.values(parsed.fonts);
  if (supplied.length !== expected.length)
    throw new DesignError(422, 'package_fonts', 'Missing or unsupported package fonts');
  const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
  for (const known of expected) {
    const given = supplied.find((f) => f.filename === known.filename);
    if (
      !given ||
      hash(given.bytes) !== hash(known.bytes) ||
      given.licenseText !== known.licenseText
    )
      throw new DesignError(422, 'package_fonts', 'Font does not match pinned installed package');
  }
  const created: string[] = [];
  try {
    return await store.withProjectWrite(actor, projectId, async (session) => {
      const custom = sourceSystemResolver(parsed.source).brands;
      for (const pkg of custom) {
        const rows = store.connection.collection('design_brand_packages'),
          hash = canonicalHash(pkg);
        const existing = await rows.findOne(
          { projectId, id: pkg.id, version: pkg.version },
          { session },
        );
        if (existing) {
          if (existing.hash !== hash)
            throw new DesignError(
              409,
              'brand_version',
              'Target has different pinned brand version',
            );
        } else {
          if (!options.allowBrandPublish)
            throw new DesignError(
              422,
              'brand_import_confirmation',
              'Explicit consent required to publish bundled brand versions',
            );
          const project = await store.models.DesignProject.findById(projectId).session(session);
          if (!project || getMemberRole(project, actor) !== 'owner')
            throw new DesignError(
              403,
              'brand_publish',
              'Only owner can import a new brand version',
            );
          await rows.insertOne(
            {
              projectId,
              id: pkg.id,
              version: pkg.version,
              package: pkg,
              system: materializeBrandSystem(pkg),
              hash,
              publishedBy: actor,
            },
            { session },
          );
        }
      }
      const mapping: ImportedAssetMapping[] = [];
      for (const asset of Object.values(parsed.assets)) {
        const fresh = await assets.uploadInSession(
          actor,
          projectId,
          { bytes: asset.bytes, mime: asset.mime, filename: 'imported-image' },
          session,
        );
        created.push(fresh.id);
        mapping.push({
          originalId: asset.originalId,
          originalVersion: asset.version,
          assetId: fresh.id,
          version: fresh.version,
        });
      }
      const remapped = remapPackageSource(parsed.source, projectId, mapping);
      return store.createDocument(actor, projectId, remapped.document, session);
    });
  } finally {
    // Successful transaction retries can leave earlier private files; only uncommitted
    // IDs are removed. On DB uncertainty retain private files for reconciliation.
    await assets.cleanupUncommitted(created).catch(() => {});
  }
}
