import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export const MAX_MASK_DIM = 4096;
export const MAX_DISPLAY_WIDTH = 360;
export const MIN_BRUSH = 1;
export const MAX_BRUSH = 100;
export const PREVIEW_OPACITY = 0.35;

export type RegionMaskEditorProps = {
  width: number;
  height: number;
  sourceURL: string;
  onApply: (mask: Blob) => Promise<void>;
  disabled: boolean;
};

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function validateMaskDimensions(width: number, height: number): boolean {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= 1 &&
    height >= 1 &&
    width <= MAX_MASK_DIM &&
    height <= MAX_MASK_DIM &&
    Number.isInteger(width) &&
    Number.isInteger(height)
  );
}

export function displaySize(
  width: number,
  height: number,
  maxDisplayWidth = MAX_DISPLAY_WIDTH,
): { displayWidth: number; displayHeight: number; scale: number } {
  if (width <= 0 || height <= 0) {
    return { displayWidth: 0, displayHeight: 0, scale: 1 };
  }
  const scale = Math.min(1, maxDisplayWidth / width);
  return {
    displayWidth: Math.max(1, Math.round(width * scale)),
    displayHeight: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/** Map pointer client coords to original image pixel space via element bounding rect. */
export function clientToImageCoords(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number } {
  const sx = rect.width > 0 ? imageWidth / rect.width : 1;
  const sy = rect.height > 0 ? imageHeight / rect.height : 1;
  const x = clamp((clientX - rect.left) * sx, 0, Math.max(0, imageWidth - 1e-6));
  const y = clamp((clientY - rect.top) * sy, 0, Math.max(0, imageHeight - 1e-6));
  return { x, y };
}

/** Brush radius in original image pixels; UI value is display-space, scaled up. */
export function brushRadiusInImageSpace(displayBrush: number, scale: number): number {
  const safeScale = scale > 0 ? scale : 1;
  const ui = clamp(displayBrush, MIN_BRUSH, MAX_BRUSH);
  return Math.max(MIN_BRUSH, ui / safeScale);
}

function paintDisk(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function strokeBetween(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = radius * 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  paintDisk(ctx, to.x, to.y, radius, color);
}

function countSelectedPixels(ctx: CanvasRenderingContext2D, width: number, height: number): number {
  const data = ctx.getImageData(0, 0, width, height).data;
  let selected = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 127) {
      selected += 1;
    }
  }
  return selected;
}

function encodeMaskBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('mask encode failed'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

/**
 * Region mask painter. White = selected region, black = preserve.
 * Exports RGBA PNG with R=G=B and alpha=255; server converts to grayscale.
 * Source image is display-only and never composited into the mask blob.
 */
export default function RegionMaskEditor({
  width,
  height,
  sourceURL,
  onApply,
  disabled,
}: RegionMaskEditorProps) {
  const dimsOk = validateMaskDimensions(width, height);
  const { displayWidth, displayHeight, scale } = useMemo(
    () => displaySize(width, height),
    [width, height],
  );

  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const drawing = useRef(false);

  const [brush, setBrush] = useState(20);
  const [hasSelection, setHasSelection] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const syncPreview = useCallback(() => {
    const mask = maskRef.current;
    const preview = previewRef.current;
    if (!mask || !preview) {
      return;
    }
    const pctx = preview.getContext('2d');
    if (!pctx) {
      return;
    }
    pctx.clearRect(0, 0, preview.width, preview.height);
    pctx.globalAlpha = PREVIEW_OPACITY;
    pctx.drawImage(mask, 0, 0, preview.width, preview.height);
    pctx.globalAlpha = 1;
  }, []);

  const refreshSelection = useCallback(() => {
    const mask = maskRef.current;
    if (!mask) {
      setHasSelection(false);
      return;
    }
    const ctx = mask.getContext('2d');
    if (!ctx) {
      setHasSelection(false);
      return;
    }
    setHasSelection(countSelectedPixels(ctx, mask.width, mask.height) > 0);
    syncPreview();
  }, [syncPreview]);

  const clearMask = useCallback(() => {
    const mask = maskRef.current;
    if (!mask) {
      return;
    }
    const ctx = mask.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, mask.width, mask.height);
    setHasSelection(false);
    syncPreview();
  }, [syncPreview]);

  const invertMask = useCallback(() => {
    const mask = maskRef.current;
    if (!mask || disabled) {
      return;
    }
    const ctx = mask.getContext('2d');
    if (!ctx) {
      return;
    }
    const image = ctx.getImageData(0, 0, mask.width, mask.height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i] > 127 ? 0 : 255;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    refreshSelection();
  }, [disabled, refreshSelection]);

  useEffect(() => {
    const mask = maskRef.current;
    const preview = previewRef.current;
    if (!mask || !preview || !dimsOk) {
      return;
    }
    mask.width = width;
    mask.height = height;
    preview.width = displayWidth;
    preview.height = displayHeight;
    clearMask();
  }, [width, height, displayWidth, displayHeight, dimsOk, clearMask, sourceURL]);

  const paintAt = useCallback(
    (clientX: number, clientY: number) => {
      const mask = maskRef.current;
      const stage = stageRef.current;
      if (!mask || !stage || disabled) {
        return;
      }
      const ctx = mask.getContext('2d');
      if (!ctx) {
        return;
      }
      const rect = stage.getBoundingClientRect();
      const point = clientToImageCoords(clientX, clientY, rect, width, height);
      const radius = brushRadiusInImageSpace(brush, scale);
      const color = '#ffffff';
      if (lastPoint.current) {
        strokeBetween(ctx, lastPoint.current, point, radius, color);
      } else {
        paintDisk(ctx, point.x, point.y, radius, color);
      }
      lastPoint.current = point;
      setHasSelection(true);
      syncPreview();
    },
    [brush, disabled, height, scale, syncPreview, width],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || busy || !dimsOk) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    lastPoint.current = null;
    paintAt(event.clientX, event.clientY);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing.current) {
      return;
    }
    paintAt(event.clientX, event.clientY);
  };

  const endStroke = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing.current) {
      return;
    }
    drawing.current = false;
    lastPoint.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    refreshSelection();
  };

  const handleApply = async () => {
    if (disabled || busy || !hasSelection || !dimsOk) {
      return;
    }
    const mask = maskRef.current;
    if (!mask) {
      return;
    }
    const ctx = mask.getContext('2d');
    if (!ctx) {
      return;
    }
    // Enforce R=G=B, alpha=255 before export (never include source pixels).
    const image = ctx.getImageData(0, 0, mask.width, mask.height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i] > 127 ? 255 : 0;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);

    setBusy(true);
    setError(null);
    try {
      const blob = await encodeMaskBlob(mask);
      await onApply(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка применения маски');
    } finally {
      setBusy(false);
    }
  };

  if (!dimsOk) {
    return (
      <div data-testid="region-mask-editor" data-invalid="true">
        Размер маски вне 1..{MAX_MASK_DIM}
      </div>
    );
  }

  const applyDisabled = disabled || busy || !hasSelection;

  return (
    <div data-testid="region-mask-editor" style={{ maxWidth: MAX_DISPLAY_WIDTH + 24 }}>
      <div
        ref={stageRef}
        data-testid="region-mask-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        style={{
          position: 'relative',
          width: displayWidth,
          height: displayHeight,
          touchAction: 'none',
          userSelect: 'none',
          cursor: disabled ? 'not-allowed' : 'crosshair',
          overflow: 'hidden',
          border: '1px solid #333',
          background: '#111',
        }}
      >
        <img
          src={sourceURL}
          alt=""
          draggable={false}
          width={displayWidth}
          height={displayHeight}
          style={{
            display: 'block',
            width: displayWidth,
            height: displayHeight,
            objectFit: 'fill',
            pointerEvents: 'none',
          }}
        />
        <canvas
          ref={previewRef}
          data-testid="region-mask-preview"
          width={displayWidth}
          height={displayHeight}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: displayWidth,
            height: displayHeight,
            opacity: 1,
            pointerEvents: 'none',
            mixBlendMode: 'normal',
          }}
        />
        <canvas
          ref={maskRef}
          data-testid="region-mask-canvas"
          width={width}
          height={height}
          style={{ display: 'none' }}
          aria-hidden
        />
      </div>

      <div
        style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}
      >
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          Кисть
          <input
            data-testid="region-mask-brush"
            type="range"
            min={MIN_BRUSH}
            max={MAX_BRUSH}
            value={brush}
            disabled={disabled || busy}
            onChange={(e) => setBrush(clamp(Number(e.target.value), MIN_BRUSH, MAX_BRUSH))}
          />
          <span>{brush}</span>
        </label>
        <button
          type="button"
          data-testid="region-mask-clear"
          disabled={disabled || busy}
          onClick={clearMask}
        >
          Очистить
        </button>
        <button
          type="button"
          data-testid="region-mask-invert"
          disabled={disabled || busy}
          onClick={invertMask}
        >
          Инвертировать
        </button>
        <button
          type="button"
          data-testid="region-mask-apply"
          disabled={applyDisabled}
          onClick={() => {
            void handleApply();
          }}
        >
          Применить
        </button>
      </div>
      {error ? (
        <div
          data-testid="region-mask-error"
          style={{ color: '#b00020', marginTop: 6, fontSize: 12 }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
