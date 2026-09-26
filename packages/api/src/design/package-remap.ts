import type { AssetRef, DesignDocument } from './types';
import { normalizeSourceImport } from './source-import';
import { DesignError } from './errors';
export interface ImportedAssetMapping {
  originalId: string;
  originalVersion: number;
  assetId: string;
  version: number;
}
/** Converts validated source refs to newly authorized assets. Never trusts original project ACL. */
export function remapPackageSource(
  source: unknown,
  targetProjectId: string,
  mapping: readonly ImportedAssetMapping[],
): {
  document: {
    title: string;
    kind: 'canvas';
    payload: DesignDocument['payload'];
    designSystem: DesignDocument['designSystem'];
    assetRefs: AssetRef[];
  };
} {
  const copy = JSON.parse(JSON.stringify(source));
  // Package bytes have been validated. The target write authorization and fresh asset creation
  // are caller obligations, not permission inherited from original document metadata.
  delete copy.projectId;
  if (copy.snapshot) delete copy.snapshot.projectId;
  const normalized = normalizeSourceImport(copy, targetProjectId);
  const refs = new Map<string, AssetRef>();
  const newIds = new Set<string>();
  for (const entry of mapping) {
    const key = `${entry.originalId}@${entry.originalVersion}`;
    if (refs.has(key) || newIds.has(`${entry.assetId}@${entry.version}`))
      throw new DesignError(422, 'package_mapping', 'Duplicate asset mapping');
    refs.set(key, { assetId: entry.assetId, version: entry.version });
    newIds.add(`${entry.assetId}@${entry.version}`);
  }
  const replace = (id: string, version: number): AssetRef => {
    const result = refs.get(`${id}@${version}`);
    if (!result)
      throw new DesignError(422, 'package_mapping', 'Package asset mapping is incomplete');
    return { ...result };
  };
  const assetRefs = normalized.assetRefs.map((ref) => replace(ref.assetId, ref.version));
  if (mapping.length !== assetRefs.length)
    throw new DesignError(422, 'package_mapping', 'Unused asset mapping');
  const payload = normalized.document.payload;
  for (const node of payload.nodes) {
    if (node.type === 'image') {
      const ref = replace(node.props.assetId!, node.props.assetVersion!);
      node.props.assetId = ref.assetId;
      node.props.assetVersion = ref.version;
    }
  }
  return { document: { ...normalized.document, payload, assetRefs } };
}
