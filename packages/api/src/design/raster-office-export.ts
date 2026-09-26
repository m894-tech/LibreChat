import sharp from 'sharp';
import JSZip from 'jszip';
import { deflateSync } from 'node:zlib';
import { validateDesignRaster } from './assets';
import { DesignError } from './errors';
export interface RasterOfficeExport {
  bytes: Buffer;
  mime: string;
  extension: 'pdf' | 'pptx';
  editable: false;
}
const xml = (text: string): string =>
  text.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
/** Flat image page/slide only. This is NOT editable PPTX text/vector export. */
export async function exportRasterOffice(input: {
  png: Buffer;
  width: number;
  height: number;
  format: 'pdf' | 'pptx';
  title: string;
}): Promise<RasterOfficeExport> {
  const meta = await validateDesignRaster({ bytes: input.png, mime: 'image/png' });
  if (meta.width !== input.width || meta.height !== input.height)
    throw new DesignError(422, 'export_size', 'Raster and artboard differ');
  if (input.format === 'pdf') {
    const rgb = await sharp(input.png, { limitInputPixels: 4096 * 4096 })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer();
    const pixels = deflateSync(rgb);
    const w = input.width * 0.75,
      h = input.height * 0.75;
    const paint = Buffer.from(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`, 'ascii');
    const objects = [
      Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
      Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
      ),
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${input.width} /Height ${input.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${pixels.length} >>\nstream\n`,
        ),
        pixels,
        Buffer.from('\nendstream'),
      ]),
      Buffer.concat([
        Buffer.from(`<< /Length ${paint.length} >>\nstream\n`),
        paint,
        Buffer.from('endstream'),
      ]),
    ];
    const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')],
      offsets = [0];
    let offset = chunks[0].length;
    objects.forEach((object, i) => {
      offsets.push(offset);
      const chunk = Buffer.concat([
        Buffer.from(`${i + 1} 0 obj\n`),
        object,
        Buffer.from('\nendobj\n'),
      ]);
      chunks.push(chunk);
      offset += chunk.length;
    });
    chunks.push(
      Buffer.from(
        `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
          offsets
            .slice(1)
            .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
            .join('') +
          `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`,
      ),
    );
    return {
      bytes: Buffer.concat(chunks),
      mime: 'application/pdf',
      extension: 'pdf',
      editable: false,
    };
  }
  if (input.format !== 'pptx')
    throw new DesignError(422, 'export_format', 'Unsupported office raster format');
  const zip = new JSZip(),
    w = Math.round(input.width * 9525),
    h = Math.round(input.height * 9525),
    ns = 'http://schemas.openxmlformats.org';
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  );
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0"?><p:presentation xmlns:a="${ns}/drawingml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships" xmlns:p="${ns}/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="${w}" cy="${h}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`,
  );
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0"?><p:sld xmlns:a="${ns}/drawingml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships" xmlns:p="${ns}/presentationml/2006/main"><p:cSld name="${xml(input.title.slice(0, 200))}"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="2" name="Raster design — not editable layers"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  );
  zip.file('ppt/media/image1.png', input.png);
  return {
    bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extension: 'pptx',
    editable: false,
  };
}
