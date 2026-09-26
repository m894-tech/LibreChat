import sharp from 'sharp';
import type { CanvasSVGLoadAsset } from '../canvas-svg-export';
import { exportCanvasSVG, SVG_EXPORT_MAX_ASSET_BYTES } from '../canvas-svg-export';
import { makeDoc, makeNode, snapshot } from './domain.fixtures';
import { DesignError, DesignErrorCodes } from '../errors';

async function pngRgba(
  width: number,
  height: number,
  rgba: [number, number, number, number] = [0, 128, 255, 128],
): Promise<Buffer> {
  const channels = 4;
  const buf = Buffer.alloc(width * height * channels);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * channels;
    buf[o] = rgba[0];
    buf[o + 1] = rgba[1];
    buf[o + 2] = rgba[2];
    buf[o + 3] = rgba[3];
  }
  return sharp(buf, { raw: { width, height, channels } }).png().toBuffer();
}

function loaderFor(map: Record<string, { bytes: Buffer; mime: string }>): CanvasSVGLoadAsset {
  return async (assetId, version) => {
    const hit = map[`${assetId}@${version}`];
    if (!hit) {
      throw new Error(`not found ${assetId}@${version}`);
    }
    return { bytes: hit.bytes, mime: hit.mime };
  };
}

describe('exportCanvasSVG', () => {
  it('escapes malicious text and keeps native text/rect editable', async () => {
    const doc = makeDoc({
      payload: {
        width: 200,
        height: 200,
        nodes: [
          makeNode({
            id: 'r1',
            type: 'rect',
            props: {
              x: 10,
              y: 20,
              width: 40,
              height: 30,
              fill: '#FF0000',
              stroke: '#00FF00',
              strokeWidth: 2,
            },
          }),
          makeNode({
            id: 't1',
            type: 'text',
            props: {
              x: 5,
              y: 8,
              width: 100,
              height: 50,
              text: '<script>alert(1)</script>&"\'\nline2',
              fontFamily: 'Inter',
              fontSize: 16,
              fontStyle: 'bold-italic',
              fill: '#1A1A1A',
              align: 'left',
            },
          }),
        ],
      },
    });

    const result = await exportCanvasSVG(doc, loaderFor({}));
    expect(result.editable).toBe(true);
    expect(result.warnings).toEqual([
      'Text layout/wrapping may differ from Konva canvas rendering; tspans are line-split only, not wrapped.',
    ]);
    expect(result.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(result.svg).toContain('width="200"');
    expect(result.svg).toContain('height="200"');
    expect(result.svg).toContain('viewBox="0 0 200 200"');
    expect(result.svg).toContain('<rect ');
    expect(result.svg).toContain('<text ');
    expect(result.svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;&apos;');
    expect(result.svg).not.toContain('<script>');
    expect(result.svg).not.toContain('foreignObject');
    expect(result.svg).toContain('font-style="italic"');
    expect(result.svg).toContain('font-weight="bold"');
    expect(result.svg).toContain('<tspan ');
    expect(result.svg).toContain('>line2</tspan>');
  });

  it('nests group transforms as translate then rotate with opacity', async () => {
    const doc = makeDoc({
      payload: {
        width: 300,
        height: 300,
        nodes: [
          makeNode({
            id: 'g1',
            type: 'group',
            props: { x: 15, y: 25, width: 100, height: 100, rotation: 45, opacity: 0.5 },
          }),
          makeNode({
            id: 'child',
            type: 'ellipse',
            parentId: 'g1',
            props: { x: 2, y: 3, width: 20, height: 10, fill: '#ABCDEF', opacity: 1 },
          }),
        ],
      },
    });

    const { svg } = await exportCanvasSVG(doc, loaderFor({}));
    expect(svg).toContain('transform="translate(15 25) rotate(45)"');
    expect(svg).toContain('opacity="0.5"');
    expect(svg).toContain('<ellipse ');
    expect(svg).toContain('transform="translate(2 3)"');
    expect(svg.indexOf('translate(15 25)')).toBeLessThan(svg.indexOf('<ellipse'));
  });

  it('embeds alpha PNG crop via nested svg viewBox and original dims', async () => {
    const png = await pngRgba(8, 6, [10, 20, 30, 40]);
    const doc = makeDoc({
      payload: {
        width: 120,
        height: 90,
        nodes: [
          makeNode({
            id: 'img1',
            type: 'image',
            props: {
              x: 4,
              y: 6,
              width: 50,
              height: 40,
              rotation: 12,
              opacity: 0.8,
              assetId: 'photo',
              assetVersion: 2,
              crop: { x: 1, y: 2, width: 3, height: 4 },
            },
          }),
        ],
      },
      assetRefs: [{ assetId: 'photo', version: 2 }],
    });

    const before = snapshot(doc);
    const { svg, editable } = await exportCanvasSVG(
      doc,
      loaderFor({ 'photo@2': { bytes: png, mime: 'image/png' } }),
    );
    expect(editable).toBe(true);
    expect(doc).toEqual(before);
    expect(svg).toContain('transform="translate(4 6) rotate(12)"');
    expect(svg).toContain('opacity="0.8"');
    expect(svg).toContain('viewBox="1 2 3 4"');
    expect(svg).toContain('width="8" height="6"');
    expect(svg).toContain('data:image/png;base64,');
    expect(svg).not.toMatch(/href="https?:/);
    expect(svg).not.toMatch(/xlink:href="https?:/);
  });

  it('rejects missing asset refs from the loader', async () => {
    const doc = makeDoc({
      payload: {
        width: 100,
        height: 100,
        nodes: [
          makeNode({
            id: 'img1',
            type: 'image',
            props: {
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              assetId: 'missing',
              assetVersion: 1,
            },
          }),
        ],
      },
      assetRefs: [{ assetId: 'missing', version: 1 }],
    });

    await expect(exportCanvasSVG(doc, loaderFor({}))).rejects.toMatchObject({
      status: 404,
      code: DesignErrorCodes.NOT_FOUND,
    });
    await expect(exportCanvasSVG(doc, loaderFor({}))).rejects.toBeInstanceOf(DesignError);
  });

  it('rejects oversize embedded rasters', async () => {
    const png = await pngRgba(2, 2);
    const doc = makeDoc({
      payload: {
        width: 64,
        height: 64,
        nodes: [
          makeNode({
            id: 'img1',
            type: 'image',
            props: { x: 0, y: 0, width: 10, height: 10, assetId: 'big', assetVersion: 1 },
          }),
        ],
      },
      assetRefs: [{ assetId: 'big', version: 1 }],
    });
    const huge = Buffer.alloc(SVG_EXPORT_MAX_ASSET_BYTES + 1, 1);
    huge.set(png.subarray(0, 8), 0);

    await expect(
      exportCanvasSVG(doc, async () => ({ bytes: huge, mime: 'image/png' })),
    ).rejects.toMatchObject({ status: 429, code: DesignErrorCodes.QUOTA });
  });
});
