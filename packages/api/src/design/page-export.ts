import { validatePageDocument, type PageDocument } from './page-document';
import { validateDesignRaster } from './assets';
import { DesignError } from './errors';
export interface PageExportOptions {
  loadAsset: (id: string, version: number) => Promise<{ bytes: Buffer; mime: string }>;
}
function escape(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
/** Trusted registered elements only, no scripts; resources embedded with explicit byte cap. */
export async function exportPageHTML(
  document: unknown,
  options: PageExportOptions,
): Promise<string> {
  validatePageDocument(document);
  const doc = document as PageDocument;
  const data = new Map<string, string>();
  let total = 0;
  for (const ref of doc.assetRefs) {
    const asset = await options.loadAsset(ref.assetId, ref.version);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(asset.mime))
      throw new DesignError(422, 'export_asset', 'Unsupported asset');
    await validateDesignRaster({ bytes: asset.bytes, mime: asset.mime });
    total += asset.bytes.length;
    if (total > 20 * 1024 * 1024)
      throw new DesignError(422, 'export_size', 'Page assets exceed limit');
    data.set(
      ref.assetId + '@' + ref.version,
      `data:${asset.mime};base64,${asset.bytes.toString('base64')}`,
    );
  }
  const render = (parent: string | null, depth = 0): string => {
    if (depth > 12) throw new DesignError(422, 'export_depth', 'Page depth exceeded');
    return doc.nodes
      .filter((n) => n.parentId === parent)
      .map((n) => {
        const p: any = n.props;
        if (n.type === 'section' || n.type === 'stack')
          return `<section class="block" style="--dir:${p.direction};--mobile-dir:${p.mobileDirection ?? p.direction};gap:${p.gap}px;padding:${p.padding}px;background:${p.background}">${render(n.id, depth + 1)}</section>`;
        if (n.type === 'text')
          return `<p style="font-size:${p.size}px;font-weight:${p.weight};color:${p.color};white-space:pre-wrap">${escape(p.text)}</p>`;
        if (n.type === 'table')
          return `<figure><figcaption>${escape(p.caption)} — ${p.source === 'example' ? 'Пример данных' : 'Данные пользователя, не проверены онлайн'}</figcaption><table><thead><tr>${p.columns.map((c: string) => `<th>${escape(c)}</th>`).join('')}</tr></thead><tbody>${p.rows.map((row: unknown[]) => `<tr>${row.map((v) => `<td>${escape(v ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></figure>`;
        if (n.type === 'bar-chart') {
          const max = Math.max(1, ...p.values.map((v: number) => Math.abs(v)));
          return `<figure><figcaption>${escape(p.caption)} — ${p.source === 'example' ? 'Пример данных' : 'Данные пользователя, не проверены онлайн'}</figcaption>${p.values.map((v: number, j: number) => `<div>${escape(p.labels[j])}: ${v}<div style="height:12px;background:#2563eb;width:${(Math.abs(v) / max) * 100}%"></div></div>`).join('')}</figure>`;
        }
        if (n.type === 'button')
          return `<a href="${escape(p.href)}" rel="noopener noreferrer">${escape(p.label)}</a>`;
        const src = data.get(p.assetId + '@' + p.version);
        if (!src) throw new DesignError(422, 'export_asset', 'Missing page asset');
        return `<img src="${src}" alt="${escape(p.alt)}" style="max-width:100%;height:auto">`;
      })
      .join('\n');
  };
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(doc.title)}</title><style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif}.page{max-width:${doc.viewport.desktop}px;margin:auto}.block{display:flex;flex-direction:var(--dir);min-width:0}p{margin:0;overflow-wrap:anywhere}@media(max-width:${doc.viewport.mobile}px){.block{flex-direction:var(--mobile-dir)}}</style><main class="page">${render(null)}</main></html>`;
}
