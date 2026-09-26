import type { DesignDocument } from '../types';
import { convertCanvasToPage, convertPageToCanvas, isHonestRoundTrip } from '../page-compat';

const canvasDoc = (): DesignDocument =>
  ({
    id: 'doc-1',
    projectId: 'proj-1',
    kind: 'canvas',
    schemaVersion: 1,
    title: 'Canvas',
    revision: 1,
    designSystem: { id: 'neutral-business', version: '1.0.0' },
    payload: {
      width: 1024,
      height: 768,
      nodes: [
        {
          id: 'g1',
          type: 'group',
          parentId: null,
          locked: false,
          props: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
          bindings: {},
        },
        {
          id: 't1',
          type: 'text',
          parentId: 'g1',
          locked: false,
          props: {
            x: 10,
            y: 10,
            width: 80,
            height: 20,
            rotation: 0,
            opacity: 1,
            text: 'Кириллица',
            fontSize: 24,
            fill: '#111111',
            fontStyle: 'normal',
          },
          bindings: {},
        },
        {
          id: 'img1',
          type: 'image',
          parentId: 'g1',
          locked: false,
          props: {
            x: 0,
            y: 0,
            width: 50,
            height: 50,
            rotation: 0,
            opacity: 1,
            assetId: 'a1',
            assetVersion: 2,
          },
          bindings: {},
        },
      ],
    },
    assetRefs: [{ assetId: 'a1', version: 2 }],
    archived: false,
  }) as unknown as DesignDocument;

it('canvas→page preserves text/image and drops geometry with report', () => {
  const { page, report } = convertCanvasToPage(canvasDoc());
  expect(page.kind).toBe('web');
  expect(page.title).toBe('Canvas');
  expect(page.nodes.find((n) => n.id === 't1')?.type).toBe('text');
  expect((page.nodes.find((n) => n.id === 't1')?.props as any).text).toBe('Кириллица');
  expect(page.nodes.find((n) => n.id === 'img1')?.type).toBe('image');
  expect(page.nodes.find((n) => n.id === 'g1')?.type).toBe('stack');
  expect(report.direction).toBe('canvas-to-page');
  expect(report.dropped).toBeGreaterThan(0);
  const geo = report.losses.filter(
    (l) => l.property === 'x' || l.property === 'y' || l.property === 'width',
  );
  expect(geo.length).toBeGreaterThan(0);
});

it('page→canvas drops flow props and unmapped types with report', () => {
  const { page } = convertCanvasToPage(canvasDoc());
  const { canvas, report } = convertPageToCanvas(page);
  expect(canvas.kind).toBe('canvas');
  expect(canvas.payload.nodes.find((n) => n.id === 't1')?.type).toBe('text');
  expect(canvas.payload.nodes.find((n) => n.id === 'g1')?.type).toBe('group');
  expect(report.direction).toBe('page-to-canvas');
  const dir = report.losses.find((l) => l.property === 'direction');
  expect(dir).toBeDefined();
});

it('round-trip is honest: ids and text preserved, geometry lost', () => {
  const doc = canvasDoc();
  expect(isHonestRoundTrip(doc)).toBe(true);
  const { page } = convertCanvasToPage(doc);
  const { canvas: back } = convertPageToCanvas(page);
  const t1 = back.payload.nodes.find((n) => n.id === 't1');
  expect(t1).toBeDefined();
  expect((t1?.props as any).text).toBe('Кириллица');
  // geometry was dropped, not restored
  expect((t1?.props as any).x).toBe(0);
});

it('drops rect/ellipse and native-only types without throwing', () => {
  const doc = canvasDoc();
  doc.payload.nodes.push({
    id: 'r1',
    type: 'rect',
    parentId: null,
    locked: false,
    props: { x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1 },
    bindings: {},
  } as any);
  const { page, report } = convertCanvasToPage(doc);
  expect(page.nodes.find((n) => n.id === 'r1')).toBeUndefined();
  expect(report.losses.some((l) => l.nodeId === 'r1' && l.action === 'dropped')).toBe(true);
});
