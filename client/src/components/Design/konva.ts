import { KONVA_SCRIPT_SRC, KONVA_VERSION } from './constants';

export interface KonvaNode {
  id: (value?: string) => string;
  x: (value?: number) => number;
  y: (value?: number) => number;
  width: (value?: number) => number;
  height: (value?: number) => number;
  rotation: (value?: number) => number;
  draggable: (value?: boolean) => boolean;
  listening: (value?: boolean) => boolean;
  destroy: () => void;
  on: (
    event: string,
    handler: (evt: { target: KonvaNode; cancelBubble?: boolean }) => void,
  ) => void;
  off: (event: string) => void;
  getParent: () => KonvaNode | null;
  getAttr: (name: string) => string | number | boolean | undefined;
  setAttrs: (attrs: Record<string, string | number | boolean | undefined>) => void;
  add: (node: KonvaNode) => void;
}

export interface KonvaStage extends KonvaNode {
  add: (node: KonvaNode) => void;
  container: () => HTMLDivElement;
  draw: () => void;
  findOne: (selector: string) => KonvaNode | undefined;
  toDataURL: (config: {
    mimeType: string;
    pixelRatio: number;
    width?: number;
    height?: number;
  }) => string;
  scale: (value?: { x: number; y: number }) => { x: number; y: number };
  position: (value?: { x: number; y: number }) => { x: number; y: number };
}

export interface KonvaLayer extends KonvaNode {
  add: (node: KonvaNode) => void;
  draw: () => void;
  destroyChildren: () => void;
  find: (selector: string) => KonvaNode[];
}

export interface KonvaNS {
  version: string;
  Stage: new (config: { container: HTMLDivElement; width: number; height: number }) => KonvaStage;
  Layer: new () => KonvaLayer;
  Rect: new (config: Record<string, string | number | boolean | undefined>) => KonvaNode;
  Ellipse: new (config: Record<string, string | number | boolean | undefined>) => KonvaNode;
  Text: new (config: Record<string, string | number | boolean | undefined>) => KonvaNode;
  Image: new (
    config: Record<
      string,
      string | number | boolean | HTMLImageElement | import('./types').CropRect | undefined
    >,
  ) => KonvaNode;
  Group: new (config: Record<string, string | number | boolean | undefined>) => KonvaNode;
  Transformer: new (config: Record<string, string | number | boolean | undefined>) => KonvaNode & {
    nodes: (nodes?: KonvaNode[]) => KonvaNode[];
  };
}

declare global {
  interface Window {
    Konva?: KonvaNS;
  }
}

let pending: Promise<KonvaNS> | null = null;
let fontsPending: Promise<void> | null = null;
export function loadDesignFonts(): Promise<void> {
  return (fontsPending ??= Promise.all(
    ['Inter', 'IBM Plex Mono', 'Montserrat'].map(async (family) => {
      const filename = family.replaceAll(' ', '-') + '.ttf';
      const font = new FontFace(family, `url(/design-fonts/${filename})`, {
        weight: family === 'IBM Plex Mono' ? '400' : '100 900',
      });
      await font.load();
      (document.fonts as FontFaceSet & { add: (face: FontFace) => void }).add(font);
    }),
  ).then(() => undefined));
}

export function loadKonva(): Promise<KonvaNS> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Konva только в браузере'));
  }
  if (window.Konva) {
    return Promise.resolve(window.Konva);
  }
  if (pending) {
    return pending;
  }
  pending = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-design-konva]');
    const onReady = () => {
      if (!window.Konva) {
        pending = null;
        reject(new Error('Konva global missing after script load'));
        return;
      }
      if (window.Konva.version !== KONVA_VERSION) {
        console.warn('Konva version', window.Konva.version, 'pinned', KONVA_VERSION);
      }
      resolve(window.Konva);
    };
    if (existing) {
      existing.addEventListener('load', onReady);
      existing.addEventListener('error', () => {
        pending = null;
        reject(new Error('Не удалось загрузить Konva'));
      });
      return;
    }
    const script = document.createElement('script');
    script.src = KONVA_SCRIPT_SRC;
    script.async = true;
    script.dataset.designKonva = 'true';
    script.onload = onReady;
    script.onerror = () => {
      pending = null;
      reject(new Error('Не удалось загрузить /design/vendor/konva.min.js'));
    };
    document.head.appendChild(script);
  });
  return pending;
}

export function resetKonvaLoader(): void {
  pending = null;
}
