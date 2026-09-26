import {
  FORMAT_PRESETS,
  MAX_SNAP_TOLERANCE,
  MIN_SNAP_TOLERANCE,
  snapPosition,
  validateSnapInput,
} from '../canvas-guides';

const artboard = { width: 1080, height: 1350 };
const tolerance = 8;

describe('FORMAT_PRESETS', () => {
  test('exports required social formats', () => {
    expect(FORMAT_PRESETS.portrait1080x1350).toEqual(
      expect.objectContaining({ width: 1080, height: 1350 }),
    );
    expect(FORMAT_PRESETS.square1080x1080).toEqual(
      expect.objectContaining({ width: 1080, height: 1080 }),
    );
    expect(FORMAT_PRESETS.story1080x1920).toEqual(
      expect.objectContaining({ width: 1080, height: 1920 }),
    );
    expect(FORMAT_PRESETS.landscape1920x1080).toEqual(
      expect.objectContaining({ width: 1920, height: 1080 }),
    );
  });
});

describe('validateSnapInput', () => {
  const rect = { x: 10, y: 20, width: 100, height: 80 };

  test('accepts finite positive sizes and tolerance 0..50', () => {
    expect(validateSnapInput(rect, artboard, { enabled: true, tolerance: 0 })).toBe(true);
    expect(validateSnapInput(rect, artboard, { enabled: true, tolerance: 50 })).toBe(true);
  });

  test('rejects non-positive or non-finite dimensions', () => {
    expect(validateSnapInput({ ...rect, width: 0 }, artboard, { enabled: true, tolerance })).toBe(
      false,
    );
    expect(validateSnapInput({ ...rect, height: -1 }, artboard, { enabled: true, tolerance })).toBe(
      false,
    );
    expect(
      validateSnapInput(rect, { width: Number.NaN, height: 100 }, { enabled: true, tolerance }),
    ).toBe(false);
    expect(
      validateSnapInput(
        rect,
        { width: 100, height: Number.POSITIVE_INFINITY },
        {
          enabled: true,
          tolerance,
        },
      ),
    ).toBe(false);
  });

  test('rejects tolerance outside 0..50', () => {
    expect(validateSnapInput(rect, artboard, { enabled: true, tolerance: -1 })).toBe(false);
    expect(validateSnapInput(rect, artboard, { enabled: true, tolerance: 51 })).toBe(false);
    expect(MIN_SNAP_TOLERANCE).toBe(0);
    expect(MAX_SNAP_TOLERANCE).toBe(50);
  });
});

describe('snapPosition', () => {
  test('disabled leaves position unchanged and emits no guides', () => {
    const rect = { x: 2, y: 3, width: 100, height: 100 };
    const result = snapPosition(rect, artboard, { enabled: false, tolerance });
    expect(result).toEqual({ x: 2, y: 3, guides: [] });
  });

  test('invalid dimensions leave position unchanged', () => {
    const bad = { x: 1, y: 1, width: 0, height: 50 };
    expect(snapPosition(bad, artboard, { enabled: true, tolerance })).toEqual({
      x: 1,
      y: 1,
      guides: [],
    });
  });

  test('snaps left/top edges to artboard origin', () => {
    const rect = { x: 5, y: 6, width: 200, height: 100 };
    const result = snapPosition(rect, artboard, { enabled: true, tolerance });
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.guides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ axis: 'x', position: 0 }),
        expect.objectContaining({ axis: 'y', position: 0 }),
      ]),
    );
  });

  test('snaps centers to artboard center', () => {
    const width = 200;
    const height = 100;
    const cx = artboard.width / 2;
    const cy = artboard.height / 2;
    const rect = {
      x: cx - width / 2 + 4,
      y: cy - height / 2 - 3,
      width,
      height,
    };
    const result = snapPosition(rect, artboard, { enabled: true, tolerance });
    expect(result.x).toBe(cx - width / 2);
    expect(result.y).toBe(cy - height / 2);
    expect(result.guides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ axis: 'x', position: cx }),
        expect.objectContaining({ axis: 'y', position: cy }),
      ]),
    );
  });

  test('snaps right/bottom edges to artboard edges', () => {
    const width = 180;
    const height = 90;
    const rect = {
      x: artboard.width - width - 5,
      y: artboard.height - height + 4,
      width,
      height,
    };
    const result = snapPosition(rect, artboard, { enabled: true, tolerance });
    expect(result.x).toBe(artboard.width - width);
    expect(result.y).toBe(artboard.height - height);
    expect(result.guides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ axis: 'x', position: artboard.width }),
        expect.objectContaining({ axis: 'y', position: artboard.height }),
      ]),
    );
  });

  test('outside threshold does not snap', () => {
    const rect = { x: 20, y: 25, width: 100, height: 80 };
    const result = snapPosition(rect, artboard, { enabled: true, tolerance: 8 });
    expect(result.x).toBe(20);
    expect(result.y).toBe(25);
    expect(result.guides).toEqual([]);
  });

  test('deterministic tie prefers closest then stable edge order', () => {
    // Place so left→left and right→right are equally near when width === artboard.
    const full = { x: 3, y: 0, width: artboard.width, height: 50 };
    const result = snapPosition(full, artboard, { enabled: true, tolerance: 8 });
    // left edge distance 3, right edge also distance 3 → prefer nodeIndex 0 (left)
    expect(result.x).toBe(0);
    expect(result.guides.find((g) => g.axis === 'x')?.position).toBe(0);
  });

  test('optional Russian labels on guides', () => {
    const result = snapPosition(
      { x: 2, y: artboard.height / 2 - 50 + 1, width: 100, height: 100 },
      artboard,
      { enabled: true, tolerance },
    );
    const xGuide = result.guides.find((g) => g.axis === 'x');
    const yGuide = result.guides.find((g) => g.axis === 'y');
    expect(xGuide?.label).toBe('лево');
    expect(yGuide?.label).toBe('середина');
  });

  test('returns snapped top-left only (no rotation fields)', () => {
    const result = snapPosition({ x: 4, y: 4, width: 50, height: 50 }, artboard, {
      enabled: true,
      tolerance,
    });
    expect(result).toEqual({
      x: 0,
      y: 0,
      guides: expect.any(Array),
    });
    expect(result).not.toHaveProperty('rotation');
  });
});
