import { randomUUID } from 'node:crypto';
import { ProviderUncertainError } from './providers';
import { validateDesignRaster } from './assets';
import { DesignError } from './errors';
export interface PresentonTransport {
  request(
    actor: string,
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown; signal: AbortSignal },
  ): Promise<any>;
}
export interface PresentonSendInput {
  actor: string;
  destinationId: string;
  expectedRevision: number;
  operationId: string;
  png: Buffer;
  sourceDocumentId: string;
  sourceRevision: number;
  title: string;
  targetSlideId?: string;
  plannedSlideId?: string;
}
/** Existing branch endpoints: editor snapshot+operations InsertSlide, image upload.
 * Transport must enforce user's Presenton identity. This adapter never selects a service key.
 */
export function createPresentonAdapter(transport: PresentonTransport): {
  send(
    input: PresentonSendInput,
  ): Promise<{ presentationId: string; slideId: string; editable: false; sourceRevision: number }>;
} {
  return {
    async send(input) {
      for (const id of [input.destinationId, input.operationId, input.sourceDocumentId])
        if (!/^[a-zA-Z0-9-]{1,128}$/.test(id))
          throw new DesignError(422, 'presentation_id', 'Invalid ID');
      if (!input.actor || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0)
        throw new DesignError(422, 'presentation_input', 'Invalid destination revision');
      const raster = await validateDesignRaster({ bytes: input.png, mime: 'image/png' });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      let uploaded = false;
      const call = (path: string, init: { method: 'GET' | 'POST'; body?: unknown }) =>
        Promise.race([
          transport.request(input.actor, path, { ...init, signal: controller.signal }),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener(
              'abort',
              () => reject(new ProviderUncertainError('Presentation request timed out')),
              { once: true },
            );
          }),
        ]);
      try {
        const snapshot = await call(
          `/api/v1/ppt/editor/v1/documents/${input.destinationId}/snapshot`,
          { method: 'GET' },
        );
        if (snapshot.revision !== input.expectedRevision)
          throw new DesignError(409, 'presentation_revision', 'Destination changed');
        if (
          input.targetSlideId &&
          (!/^[a-zA-Z0-9-]{1,128}$/.test(input.targetSlideId) ||
            !snapshot.slides?.some((slide: any) => slide.id === input.targetSlideId))
        )
          throw new DesignError(404, 'presentation_slide', 'Target slide not found');
        const form = new FormData();
        form.append(
          'file',
          new Blob([Uint8Array.from(input.png)], { type: 'image/png' }),
          'design.png',
        );
        uploaded = true;
        const image = await call('/api/v1/ppt/images/upload', { method: 'POST', body: form });
        const url = image?.file_url;
        if (
          typeof url !== 'string' ||
          !url.startsWith('/app_data/') ||
          url.includes('..') ||
          url.includes('\\')
        )
          throw new DesignError(502, 'presentation_asset', 'Unexpected uploaded image path');
        const slideId = input.targetSlideId ?? input.plannedSlideId ?? randomUUID(),
          scale = Math.min(1280 / raster.width, 720 / raster.height),
          w = raster.width * scale,
          h = raster.height * scale;
        const applied = await call(
          `/api/v1/ppt/editor/v1/documents/${input.destinationId}/operations`,
          {
            method: 'POST',
            body: {
              operationId: input.operationId,
              baseRevision: input.expectedRevision,
              operations: [
                {
                  scope: input.targetSlideId ? 'slide' : 'document',
                  targetIds: input.targetSlideId ? [input.targetSlideId] : [],
                  operationType: input.targetSlideId ? 'UpdateSlide' : 'InsertSlide',
                  payload: {
                    id: slideId,
                    layout_group: 'blank',
                    layout: '__blank_slide__',
                    content: { title: input.title.slice(0, 200) },
                    speaker_note: `Design source ${input.sourceDocumentId} revision ${input.sourceRevision}; raster, not editable layers.`,
                    ui: {
                      id: '__blank_slide__',
                      description: 'Pinned Design raster',
                      background: '#FFFFFF',
                      elements: [
                        {
                          type: 'image',
                          name: input.title.slice(0, 200),
                          position: { x: (1280 - w) / 2, y: (720 - h) / 2 },
                          size: { width: w, height: h },
                          data: url,
                          fit: 'contain',
                          decorative: false,
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        );
        const confirmed = applied?.receipt ?? applied;
        const statusOk = ['applied', 'duplicate'].includes(applied?.status);
        const idOk =
          confirmed?.operationId === input.operationId &&
          (confirmed.documentId === undefined || confirmed.documentId === input.destinationId);
        const changed = Array.isArray(confirmed?.changedSlideIds) ? confirmed.changedSlideIds : [];
        const inverse = Array.isArray(confirmed?.inverseOperations)
          ? confirmed.inverseOperations
          : [];
        const viaChanged = changed.length === 1 && changed[0] === slideId;
        const viaInverse = inverse.some(
          (op: any) =>
            op?.operationType === 'DeleteSlide' &&
            Array.isArray(op?.targetIds) &&
            op.targetIds.length === 1 &&
            op.targetIds[0] === slideId,
        );
        // A revision bump is not proof that our planned slide was applied.
        if (!statusOk || !idOk || !(viaChanged || viaInverse))
          throw new ProviderUncertainError('Destination did not confirm expected slide operation');
        return {
          presentationId: input.destinationId,
          slideId,
          editable: false,
          sourceRevision: input.sourceRevision,
        };
      } catch (error) {
        if (error instanceof DesignError) throw error;
        if (uploaded)
          throw new ProviderUncertainError(
            'Presentation send uncertain; do not automatically repeat',
          );
        throw new DesignError(502, 'presentation_unavailable', 'Presentation unavailable');
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
  };
}
