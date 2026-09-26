import { randomUUID } from 'node:crypto';
import type { DesignStore, SerializedProposal } from './store';
import type { AssetStore } from './assets';
import { resizeRaster, prepareOutpaint } from './image-transforms';
import { DesignError } from './errors';
export async function createResizeProposal(
  actor: string,
  documentId: string,
  input: { nodeId: string; expectedRevision: number; scale: 2 | 4 },
  store: DesignStore,
  assets: AssetStore,
): Promise<SerializedProposal> {
  const doc = await store.getDocument(actor, documentId);
  await store.withProjectWrite(actor, doc.projectId, async () => true);
  if (doc.revision !== input.expectedRevision)
    throw new DesignError(409, 'revision_mismatch', 'Document changed');
  const node = doc.payload.nodes.find((n) => n.id === input.nodeId);
  if (!node || node.type !== 'image') throw new DesignError(422, 'image_node', 'Select image');
  let n: typeof node | undefined = node;
  while (n) {
    if (n.locked) throw new DesignError(422, 'lock', 'Image locked');
    n = doc.payload.nodes.find((t) => t.id === n!.parentId);
  }
  const original = await assets.getBytes(actor, node.props.assetId!, node.props.assetVersion!);
  const bytes = await resizeRaster({
    bytes: original.bytes,
    mime: original.mime,
    scale: input.scale,
  });
  const result = await assets.upload(actor, doc.projectId, {
    bytes,
    mime: 'image/png',
    filename: 'resized-lanczos.png',
  });
  const operations: import('./types').DesignOperation[] = [
    { type: 'replaceAsset', nodeId: node.id, assetId: result.id, assetVersion: result.version },
  ];
  if (node.props.crop) {
    const c = node.props.crop;
    operations.push({
      type: 'setProperty',
      nodeId: node.id,
      property: 'crop',
      value: {
        x: c.x * input.scale,
        y: c.y * input.scale,
        width: c.width * input.scale,
        height: c.height * input.scale,
      },
    });
  }
  return store.createProposal(actor, doc.id, {
    summary: 'Масштабирование Lanczos ×' + input.scale + ' (не AI)',
    sourceJobId: 'resize-' + randomUUID(),
    baseRevision: doc.revision,
    declaredScope: [node.id],
    operations,
  });
}
