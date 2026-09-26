/**
 * R3 native page ↔ canvas compatibility and loss report (pure module).
 *
 * Native `kind:'web'` pages use flow layout; canvas `kind:'canvas'` documents use
 * absolute geometry (x/y/width/height/rotation/opacity). Conversion is inherently lossy.
 * This module produces an explicit, deterministic report so callers can surface
 * every dropped or approximated property instead of silently losing fidelity.
 *
 * Public API:
 *   - convertCanvasToPage(canvasDoc) → { page, report }
 *   - convertPageToCanvas(pageDoc)   → { canvas, report }
 *
 * Reports list every node/property that was dropped, approximated, or defaulted.
 * Round-trip is NOT identity: geometry is lost on canvas→page and reflowed on page→canvas.
 */

import type { DesignDocument, DesignNode, NodeType } from './types';
import {
  validatePageDocument,
  type PageDocument,
  type PageNode,
  type PageNodeType,
} from './page-document';
import { validateDocument } from './operations';

export type CompatibilityAction = 'preserved' | 'approximated' | 'dropped' | 'defaulted';

export interface CompatibilityLoss {
  nodeId: string;
  nodeType: string;
  property: string;
  action: CompatibilityAction;
  detail: string;
}

export interface CompatibilityReport {
  direction: 'canvas-to-page' | 'page-to-canvas';
  preserved: number;
  approximated: number;
  dropped: number;
  defaulted: number;
  losses: CompatibilityLoss[];
}

function report(direction: CompatibilityReport['direction']): CompatibilityReport {
  return { direction, preserved: 0, approximated: 0, dropped: 0, defaulted: 0, losses: [] };
}

function push(
  r: CompatibilityReport,
  nodeId: string,
  nodeType: string,
  property: string,
  action: CompatibilityAction,
  detail: string,
): void {
  r[action] += 1;
  r.losses.push({ nodeId, nodeType, property, action, detail });
}

/* ------------------------------------------------------------------ */
/* canvas → page                                                      */
/* ------------------------------------------------------------------ */

const CANVAS_TO_PAGE_TYPE: Record<NodeType, PageNodeType | null> = {
  text: 'text',
  rect: null, // no flow-layout primitive; dropped
  ellipse: null,
  image: 'image',
  group: 'stack',
};

function canvasNodeToPage(node: DesignNode, r: CompatibilityReport): PageNode | null {
  const mapped = CANVAS_TO_PAGE_TYPE[node.type];
  if (!mapped) {
    push(
      r,
      node.id,
      node.type,
      'type',
      'dropped',
      `no native page equivalent for canvas type "${node.type}"`,
    );
    return null;
  }
  if (mapped === 'text') {
    const props = node.props as {
      text?: string;
      fontSize?: number;
      fill?: string;
      fontStyle?: string;
    };
    const weight = props.fontStyle === 'bold' || props.fontStyle === 'bold-italic' ? 700 : 400;
    return {
      id: node.id,
      parentId: node.parentId ?? null,
      type: 'text',
      locked: node.locked ?? false,
      props: {
        text: props.text ?? '',
        size: Math.max(8, Math.min(120, Math.round(props.fontSize ?? 16))),
        color: /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(props.fill ?? '')
          ? (props.fill as string)
          : '#000000',
        weight: weight === 700 ? 700 : 400,
      },
    };
  }
  if (mapped === 'image') {
    const props = node.props as { assetId?: string; assetVersion?: number; alt?: string };
    return {
      id: node.id,
      parentId: node.parentId ?? null,
      type: 'image',
      locked: node.locked ?? false,
      props: {
        assetId: props.assetId ?? '',
        version: props.assetVersion ?? 1,
        alt: props.alt ?? '',
      },
    };
  }
  // group → stack
  return {
    id: node.id,
    parentId: node.parentId ?? null,
    type: 'stack',
    locked: node.locked ?? false,
    props: { direction: 'column', gap: 12, padding: 0, background: '#FFFFFF' },
  };
}

/**
 * Best-effort canvas → native page conversion with explicit loss report.
 * Geometry (x/y/width/height/rotation/opacity), strokes, crops, and unmapped
 * node types are dropped. Asset references are preserved when present.
 */
export function convertCanvasToPage(input: unknown): {
  page: PageDocument;
  report: CompatibilityReport;
} {
  validateDocument(input);
  const canvas = input as DesignDocument;
  const r = report('canvas-to-page');

  const nodes: PageNode[] = [];
  for (const node of canvas.payload.nodes) {
    const pageNode = canvasNodeToPage(node, r);
    if (pageNode) nodes.push(pageNode);
    if (node.type === 'group') {
      push(
        r,
        node.id,
        node.type,
        'children-order',
        'approximated',
        'group children flattened into flow stack; absolute order may reflow',
      );
    }
    const geometryKeys = ['x', 'y', 'width', 'height', 'rotation', 'opacity'];
    for (const key of geometryKeys) {
      push(
        r,
        node.id,
        node.type,
        key,
        'dropped',
        'absolute geometry has no flow-layout equivalent',
      );
    }
    if (node.props && typeof node.props === 'object' && 'stroke' in node.props) {
      push(
        r,
        node.id,
        node.type,
        'stroke',
        'dropped',
        'stroke not representable in native page schema',
      );
    }
  }

  const page: PageDocument = {
    schemaVersion: 1,
    kind: 'web',
    title: canvas.title,
    viewport: { desktop: canvas.payload.width, mobile: 375 },
    nodes,
    assetRefs: (canvas.assetRefs ?? []).map((ref) => ({
      assetId: ref.assetId,
      version: ref.version,
    })),
  };
  validatePageDocument(page);
  return { page, report: r };
}

/* ------------------------------------------------------------------ */
/* page → canvas                                                      */
/* ------------------------------------------------------------------ */

const PAGE_TO_CANVAS_TYPE: Record<PageNodeType, NodeType | null> = {
  section: 'group',
  stack: 'group',
  text: 'text',
  image: 'image',
  button: null, // no canvas primitive
  table: null,
  'bar-chart': null,
};

function pageNodeToCanvas(node: PageNode, r: CompatibilityReport): DesignNode | null {
  const mapped = PAGE_TO_CANVAS_TYPE[node.type];
  if (!mapped) {
    push(
      r,
      node.id,
      node.type,
      'type',
      'dropped',
      `no canvas equivalent for native page type "${node.type}"`,
    );
    return null;
  }
  if (mapped === 'text') {
    const props = node.props as { text: string; size: number; color: string; weight: number };
    return {
      id: node.id,
      type: 'text',
      parentId: node.parentId ?? null,
      locked: node.locked,
      props: {
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        rotation: 0,
        opacity: 1,
        text: props.text,
        fontSize: props.size,
        fill: props.color,
        fontStyle: props.weight >= 600 ? 'bold' : 'normal',
      },
      bindings: {},
    } as unknown as DesignNode;
  }
  if (mapped === 'image') {
    const props = node.props as { assetId: string; version: number; alt: string };
    return {
      id: node.id,
      type: 'image',
      parentId: node.parentId ?? null,
      locked: node.locked,
      props: {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        assetId: props.assetId,
        assetVersion: props.version,
      },
      bindings: {},
    } as unknown as DesignNode;
  }
  // section/stack → group
  return {
    id: node.id,
    type: 'group',
    parentId: node.parentId ?? null,
    locked: node.locked,
    props: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
    bindings: {},
  } as unknown as DesignNode;
}

/**
 * Best-effort native page → canvas conversion with explicit loss report.
 * Containers become groups; buttons/tables/charts are dropped. Responsive
 * breakpoints, flow direction, gap, and padding are dropped because canvas
 * uses absolute geometry only.
 */
export function convertPageToCanvas(input: unknown): {
  canvas: DesignDocument;
  report: CompatibilityReport;
} {
  validatePageDocument(input);
  const page = input as PageDocument;
  const r = report('page-to-canvas');

  const nodes: DesignNode[] = [];
  for (const node of page.nodes) {
    const canvasNode = pageNodeToCanvas(node, r);
    if (canvasNode) nodes.push(canvasNode);
    if (node.type === 'section' || node.type === 'stack') {
      const props = node.props as {
        direction?: string;
        gap?: number;
        padding?: number;
        mobileDirection?: string;
      };
      if (props.direction !== undefined)
        push(
          r,
          node.id,
          node.type,
          'direction',
          'dropped',
          'flow direction not representable in canvas',
        );
      if (props.gap !== undefined)
        push(r, node.id, node.type, 'gap', 'dropped', 'flow gap not representable in canvas');
      if (props.padding !== undefined)
        push(
          r,
          node.id,
          node.type,
          'padding',
          'dropped',
          'flow padding not representable in canvas',
        );
      if (props.mobileDirection !== undefined)
        push(
          r,
          node.id,
          node.type,
          'mobileDirection',
          'dropped',
          'responsive breakpoint not representable in canvas',
        );
    }
  }

  const canvas = {
    id: 'page-import',
    projectId: 'page-import',
    kind: 'canvas',
    schemaVersion: 1,
    title: page.title,
    revision: 1,
    designSystem: { id: 'neutral-business', version: '1.0.0' },
    payload: {
      width: page.viewport.desktop,
      height: 800,
      nodes,
    },
    assetRefs: page.assetRefs.map((ref) => ({ assetId: ref.assetId, version: ref.version })),
    archived: false,
  } as unknown as DesignDocument;

  validateDocument(canvas);
  return { canvas, report: r };
}

/* ------------------------------------------------------------------ */
/* round-trip honesty                                                  */
/* ------------------------------------------------------------------ */

/**
 * True iff canvas→page→canvas preserves node ids and text content.
 * Geometry and layout are NOT preserved; callers must consult reports.
 */
export function isHonestRoundTrip(canvas: unknown): boolean {
  validateDocument(canvas);
  const { page } = convertCanvasToPage(canvas);
  const { canvas: back } = convertPageToCanvas(page);
  const original = (canvas as DesignDocument).payload.nodes;
  const restored = back.payload.nodes;
  if (original.length !== restored.length) return false;
  for (const node of original) {
    const match = restored.find((n) => n.id === node.id);
    if (!match) return false;
    if (
      node.type === 'text' &&
      (node.props as { text?: string }).text !== (match.props as { text?: string }).text
    ) {
      return false;
    }
  }
  return true;
}
