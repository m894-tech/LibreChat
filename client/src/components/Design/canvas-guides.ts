export type GuideAxis = 'x' | 'y';

export interface GuideLine {
  axis: GuideAxis;
  position: number;
  label?: string;
}

export interface SnapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArtboardSize {
  width: number;
  height: number;
}

export interface SnapOptions {
  enabled: boolean;
  tolerance: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: GuideLine[];
}

export interface FormatPreset {
  id: string;
  width: number;
  height: number;
  label: string;
}

export type FormatPresetId =
  | 'portrait1080x1350'
  | 'square1080x1080'
  | 'story1080x1920'
  | 'landscape1920x1080';

/** Instagram / social format presets in original pixels. */
export const FORMAT_PRESETS = {
  portrait1080x1350: {
    id: 'portrait1080x1350',
    width: 1080,
    height: 1350,
    label: 'Портрет 1080×1350',
  },
  square1080x1080: {
    id: 'square1080x1080',
    width: 1080,
    height: 1080,
    label: 'Квадрат 1080×1080',
  },
  story1080x1920: {
    id: 'story1080x1920',
    width: 1080,
    height: 1920,
    label: 'Сторис 1080×1920',
  },
  landscape1920x1080: {
    id: 'landscape1920x1080',
    width: 1920,
    height: 1080,
    label: 'Альбом 1920×1080',
  },
} as const satisfies Record<FormatPresetId, FormatPreset>;

export const MIN_SNAP_TOLERANCE = 0;
export const MAX_SNAP_TOLERANCE = 50;

const X_LABELS = ['лево', 'центр', 'право'] as const;
const Y_LABELS = ['верх', 'середина', 'низ'] as const;

function isPositiveFinite(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

function isFiniteNumber(n: number): boolean {
  return Number.isFinite(n);
}

/** Validates rect + artboard geometry and snap tolerance (original pixels). */
export function validateSnapInput(
  rect: SnapRect,
  artboard: ArtboardSize,
  options: SnapOptions,
): boolean {
  if (!isFiniteNumber(rect.x) || !isFiniteNumber(rect.y)) {
    return false;
  }
  if (!isPositiveFinite(rect.width) || !isPositiveFinite(rect.height)) {
    return false;
  }
  if (!isPositiveFinite(artboard.width) || !isPositiveFinite(artboard.height)) {
    return false;
  }
  if (!isFiniteNumber(options.tolerance)) {
    return false;
  }
  if (options.tolerance < MIN_SNAP_TOLERANCE || options.tolerance > MAX_SNAP_TOLERANCE) {
    return false;
  }
  return true;
}

interface AxisCandidate {
  delta: number;
  absDelta: number;
  resulting: number;
  guidePosition: number;
  nodeIndex: number;
  boardIndex: number;
  label: string;
}

/**
 * Axis-aligned snap only (rotation must be 0 — no rotated AABB math).
 * Snaps object left/center/right to artboard left/center/right (X),
 * and top/middle/bottom to artboard top/middle/bottom (Y).
 * Ties break by closest distance, then node edge index, then board line index.
 */
function pickAxisSnap(
  origin: number,
  size: number,
  boardSize: number,
  tolerance: number,
  axis: GuideAxis,
): { value: number; guide: GuideLine } | null {
  const nodePoints = [origin, origin + size / 2, origin + size];
  const boardLines = [0, boardSize / 2, boardSize];
  const labels = axis === 'x' ? X_LABELS : Y_LABELS;

  let best: AxisCandidate | null = null;

  for (let nodeIndex = 0; nodeIndex < 3; nodeIndex += 1) {
    const nodePoint = nodePoints[nodeIndex];
    for (let boardIndex = 0; boardIndex < 3; boardIndex += 1) {
      const guidePosition = boardLines[boardIndex];
      const delta = guidePosition - nodePoint;
      const absDelta = Math.abs(delta);
      if (absDelta > tolerance) {
        continue;
      }
      const resulting = origin + delta;
      const candidate: AxisCandidate = {
        delta,
        absDelta,
        resulting,
        guidePosition,
        nodeIndex,
        boardIndex,
        label: labels[boardIndex],
      };
      if (
        !best ||
        candidate.absDelta < best.absDelta ||
        (candidate.absDelta === best.absDelta && candidate.nodeIndex < best.nodeIndex) ||
        (candidate.absDelta === best.absDelta &&
          candidate.nodeIndex === best.nodeIndex &&
          candidate.boardIndex < best.boardIndex)
      ) {
        best = candidate;
      }
    }
  }

  if (!best) {
    return null;
  }

  return {
    value: best.resulting,
    guide: {
      axis,
      position: best.guidePosition,
      label: best.label,
    },
  };
}

/**
 * Snap a top-left axis-aligned rect to artboard edges and center.
 * Tolerance is in original artboard pixels. Does not support rotation.
 */
export function snapPosition(
  rect: SnapRect,
  artboard: ArtboardSize,
  options: SnapOptions,
): SnapResult {
  const unchanged: SnapResult = { x: rect.x, y: rect.y, guides: [] };

  if (!options.enabled) {
    return unchanged;
  }

  if (!validateSnapInput(rect, artboard, options)) {
    return unchanged;
  }

  const guides: GuideLine[] = [];
  let nextX = rect.x;
  let nextY = rect.y;

  const xSnap = pickAxisSnap(rect.x, rect.width, artboard.width, options.tolerance, 'x');
  if (xSnap) {
    nextX = xSnap.value;
    guides.push(xSnap.guide);
  }

  const ySnap = pickAxisSnap(rect.y, rect.height, artboard.height, options.tolerance, 'y');
  if (ySnap) {
    nextY = ySnap.value;
    guides.push(ySnap.guide);
  }

  return { x: nextX, y: nextY, guides };
}

export default snapPosition;
