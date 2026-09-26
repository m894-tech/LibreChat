import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import type { DesignStore, SerializedProposal } from './store';
import type { AssetStore } from './assets';
import { compositeStrictRegion } from './image-region';
import { DesignError } from './errors';
export interface RegionEditInput {
  actor: string;
  documentId: string;
  nodeId: string;
  expectedRevision: number;
  candidateAssetId: string;
  candidateVersion: number;
  mask: Buffer;
}
/** Deterministic regional replacement from a user-selected existing candidate.
 * Not an AI model invocation. Mask expressed in source pixels, no image pointer auto-update.
 */
export async function createRegionEditProposal(
  input: RegionEditInput,
  store: DesignStore,
  assets: AssetStore,
): Promise<SerializedProposal> {
  const doc = await store.getDocument(input.actor, input.documentId);
  await store.withProjectWrite(input.actor, doc.projectId, async () => true);
  if (doc.revision !== input.expectedRevision)
    throw new DesignError(409, 'revision_mismatch', 'Document changed');
  const node = doc.payload.nodes.find((n: any) => n.id === input.nodeId);
  if (!node || node.type !== 'image') throw new DesignError(422, 'region_node', 'Select an image');
  const visited = new Set<string>();
  let current: any = node;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.locked) throw new DesignError(422, 'lock', 'Image or ancestor locked');
    current = doc.payload.nodes.find((n: any) => n.id === current.parentId);
  }
  if (
    !Buffer.isBuffer(input.mask) ||
    input.mask.length === 0 ||
    input.mask.length > 10 * 1024 * 1024
  )
    throw new DesignError(422, 'region_mask', 'Invalid mask bytes');
  const source = await assets.getBytes(input.actor, node.props.assetId!, node.props.assetVersion!);
  const candidateMeta = await assets.getVersion(
    input.actor,
    input.candidateAssetId,
    input.candidateVersion,
  );
  if (candidateMeta.projectId !== doc.projectId)
    throw new DesignError(404, 'not_found', 'Candidate not found');
  const candidate = await assets.getBytes(
    input.actor,
    input.candidateAssetId,
    input.candidateVersion,
  );
  // Browser mask must be opaque grayscale, not an arbitrary alpha/color interpretation.
  const decoded = await sharp(input.mask, { limitInputPixels: 4096 * 4096 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (decoded.info.channels !== 4)
    throw new DesignError(422, 'region_mask', 'Mask must be opaque grayscale RGBA PNG');
  const mask = Buffer.alloc(decoded.info.width * decoded.info.height);
  let hasSelection = false;
  for (let i = 0; i < mask.length; i++) {
    const j = i * 4;
    if (
      decoded.data[j] !== decoded.data[j + 1] ||
      decoded.data[j] !== decoded.data[j + 2] ||
      decoded.data[j + 3] !== 255
    )
      throw new DesignError(422, 'region_mask', 'Mask pixels must be opaque grayscale');
    mask[i] = decoded.data[j];
    hasSelection ||= mask[i] !== 0;
  }
  if (!hasSelection) throw new DesignError(422, 'region_mask', 'Empty selection');
  const grayscale = await sharp(mask, {
    raw: { width: decoded.info.width, height: decoded.info.height, channels: 1 },
  })
    .toColourspace('b-w')
    .png()
    .toBuffer();
  const result = await compositeStrictRegion({
    original: source.bytes,
    generated: candidate.bytes,
    mask: grayscale,
  });
  const fresh = await assets.upload(input.actor, doc.projectId, {
    bytes: result,
    mime: 'image/png',
    filename: 'regional-variant.png',
  });
  // Fresh private variant may remain if CAS proposal fails; never overwrite current source.
  return store.createProposal(input.actor, doc.id, {
    summary: 'Замена только выбранной области',
    sourceJobId: 'region-' + randomUUID(),
    baseRevision: input.expectedRevision,
    declaredScope: [node.id],
    operations: [
      { type: 'replaceAsset', nodeId: node.id, assetId: fresh.id, assetVersion: fresh.version },
    ],
  });
}
