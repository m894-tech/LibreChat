/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import RegionMaskEditor, {
  brushRadiusInImageSpace,
  clamp,
  clientToImageCoords,
  displaySize,
  MAX_BRUSH,
  MAX_DISPLAY_WIDTH,
  MAX_MASK_DIM,
  MIN_BRUSH,
  PREVIEW_OPACITY,
  validateMaskDimensions,
} from '../RegionMaskEditor';

describe('region mask helpers', () => {
  test('clamp bounds and non-finite', () => {
    expect(clamp(5, 1, 10)).toBe(5);
    expect(clamp(-2, 1, 10)).toBe(1);
    expect(clamp(99, 1, 10)).toBe(10);
    expect(clamp(Number.NaN, 1, 10)).toBe(1);
    expect(clamp(Number.POSITIVE_INFINITY, 1, 10)).toBe(1);
  });

  test('validateMaskDimensions enforces 1..4096 integers', () => {
    expect(validateMaskDimensions(1, 1)).toBe(true);
    expect(validateMaskDimensions(MAX_MASK_DIM, MAX_MASK_DIM)).toBe(true);
    expect(validateMaskDimensions(0, 10)).toBe(false);
    expect(validateMaskDimensions(10, MAX_MASK_DIM + 1)).toBe(false);
    expect(validateMaskDimensions(10.5, 10)).toBe(false);
  });

  test('displaySize fits max width and preserves aspect', () => {
    const small = displaySize(100, 50);
    expect(small.displayWidth).toBe(100);
    expect(small.displayHeight).toBe(50);
    expect(small.scale).toBe(1);

    const large = displaySize(720, 360);
    expect(large.displayWidth).toBe(MAX_DISPLAY_WIDTH);
    expect(large.scale).toBeCloseTo(MAX_DISPLAY_WIDTH / 720);
    expect(large.displayHeight).toBe(Math.round(360 * large.scale));
  });

  test('clientToImageCoords maps via bounding rect and clamps', () => {
    const rect = { left: 10, top: 20, width: 100, height: 50 };
    const inside = clientToImageCoords(60, 45, rect, 200, 100);
    expect(inside.x).toBeCloseTo(100);
    expect(inside.y).toBeCloseTo(50);

    const outside = clientToImageCoords(-100, 999, rect, 200, 100);
    expect(outside.x).toBe(0);
    expect(outside.y).toBeLessThan(100);
    expect(outside.y).toBeGreaterThanOrEqual(0);
  });

  test('brushRadiusInImageSpace scales display brush into image pixels', () => {
    expect(brushRadiusInImageSpace(20, 1)).toBe(20);
    expect(brushRadiusInImageSpace(20, 0.5)).toBeGreaterThan(20);
    expect(brushRadiusInImageSpace(MIN_BRUSH, 1)).toBe(MIN_BRUSH);
    expect(brushRadiusInImageSpace(MAX_BRUSH, 1)).toBe(MAX_BRUSH);
  });

  test('preview opacity stays at or below 0.35', () => {
    expect(PREVIEW_OPACITY).toBeLessThanOrEqual(0.35);
    expect(PREVIEW_OPACITY).toBeGreaterThan(0);
  });
});

function mockCanvas2d() {
  const store = new Uint8ClampedArray(4);
  const ctx = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'round',
    lineJoin: 'round',
    globalAlpha: 1,
    fillRect: jest.fn(function fillRect(this: typeof ctx) {
      // black clear
      store[0] = 0;
      store[1] = 0;
      store[2] = 0;
      store[3] = 255;
    }),
    beginPath: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(function fill(this: typeof ctx) {
      if (String(this.fillStyle).includes('fff') || this.fillStyle === '#ffffff') {
        store[0] = 255;
        store[1] = 255;
        store[2] = 255;
        store[3] = 255;
      }
    }),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    clearRect: jest.fn(),
    drawImage: jest.fn(),
    getImageData: jest.fn(() => ({
      data: store,
      width: 1,
      height: 1,
    })),
    putImageData: jest.fn(),
  };
  return ctx;
}

describe('RegionMaskEditor props', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    const ctx = mockCanvas2d();
    HTMLCanvasElement.prototype.getContext = jest.fn(
      () => ctx as unknown as CanvasRenderingContext2D,
    );
    HTMLCanvasElement.prototype.toBlob = jest.fn((cb: BlobCallback) => {
      cb(new Blob(['png'], { type: 'image/png' }));
    });
    Element.prototype.getBoundingClientRect = jest.fn(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 50,
      width: 100,
      height: 50,
      toJSON: () => ({}),
    }));
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.toBlob = originalToBlob;
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    jest.restoreAllMocks();
  });

  test('disabled blocks apply and painting controls', () => {
    const onApply = jest.fn(async () => undefined);
    const { getByTestId } = render(
      <RegionMaskEditor
        width={100}
        height={50}
        sourceURL="blob:authorized-source"
        onApply={onApply}
        disabled
      />,
    );

    expect(getByTestId('region-mask-apply')).toBeDisabled();
    expect(getByTestId('region-mask-clear')).toBeDisabled();
    expect(getByTestId('region-mask-invert')).toBeDisabled();
    expect(getByTestId('region-mask-brush')).toBeDisabled();

    fireEvent.pointerDown(getByTestId('region-mask-stage'), {
      clientX: 10,
      clientY: 10,
      pointerId: 1,
      buttons: 1,
    });
    expect(onApply).not.toHaveBeenCalled();
  });

  test('zero selection keeps apply disabled; clear stays available when enabled', () => {
    const onApply = jest.fn(async () => undefined);
    const { getByTestId } = render(
      <RegionMaskEditor
        width={100}
        height={50}
        sourceURL="blob:authorized-source"
        onApply={onApply}
        disabled={false}
      />,
    );

    expect(getByTestId('region-mask-apply')).toBeDisabled();
    expect(getByTestId('region-mask-clear')).not.toBeDisabled();
  });

  test('invalid dimensions render error state without stage', () => {
    const onApply = jest.fn(async () => undefined);
    const { getByTestId, queryByTestId } = render(
      <RegionMaskEditor
        width={MAX_MASK_DIM + 1}
        height={64}
        sourceURL="blob:authorized-source"
        onApply={onApply}
        disabled={false}
      />,
    );
    expect(getByTestId('region-mask-editor').getAttribute('data-invalid')).toBe('true');
    expect(queryByTestId('region-mask-stage')).toBeNull();
  });

  test('img uses provided sourceURL only', () => {
    const onApply = jest.fn(async () => undefined);
    const { container } = render(
      <RegionMaskEditor
        width={80}
        height={40}
        sourceURL="blob:only-this"
        onApply={onApply}
        disabled={false}
      />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('blob:only-this');
  });

  test('apply stays inert when disabled even after forced click', async () => {
    const onApply = jest.fn(async () => undefined);
    const { getByTestId } = render(
      <RegionMaskEditor
        width={100}
        height={50}
        sourceURL="blob:authorized-source"
        onApply={onApply}
        disabled
      />,
    );
    await act(async () => {
      fireEvent.click(getByTestId('region-mask-apply'));
    });
    expect(onApply).not.toHaveBeenCalled();
  });
});
