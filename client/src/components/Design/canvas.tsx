import { useEffect, useRef, useState } from 'react';
import type { KonvaLayer, KonvaNS, KonvaNode, KonvaStage } from './konva';
import type { DesignDocument, DesignNode } from './types';
import { loadKonva, loadDesignFonts } from './konva';
import { resolvedProps } from './document';

interface CanvasProps {
  document: DesignDocument;
  selectedId: string | null;
  readOnly: boolean;
  assetUrls: Record<string, string>;
  onSelect: (id: string | null) => void;
  onDragEnd: (nodeId: string, x: number, y: number) => void;
  exportRef: React.MutableRefObject<(() => string | null) | null>;
}

function waitForHost(host: HTMLDivElement, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const ready = () => host.isConnected && host.clientWidth > 0 && host.clientHeight > 0;
    if (ready()) {
      resolve();
      return;
    }
    const frame = () => {
      if (ready()) {
        cleanup();
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        cleanup();
        reject(new Error('Konva host never became visible'));
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    let raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(() => {
      if (ready()) {
        cleanup();
        resolve();
      }
    });
    ro.observe(host);
    const cleanup = () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  });
}

function buildKonvaTree(
  Konva: KonvaNS,
  layer: KonvaLayer,
  doc: DesignDocument,
  selectedId: string | null,
  readOnly: boolean,
  onSelect: (id: string | null) => void,
  onDragEnd: (nodeId: string, x: number, y: number) => void,
  images: Map<string, HTMLImageElement>,
) {
  layer.destroyChildren();
  const byParent = new Map<string | null, DesignNode[]>();
  for (const node of doc.payload.nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }

  const mount = (
    parent: { add: (node: KonvaNode) => void },
    parentId: string | null,
    ancestorLocked: boolean,
  ) => {
    for (const node of byParent.get(parentId) ?? []) {
      const props = resolvedProps(node);
      const locked = ancestorLocked || node.locked;
      const common = {
        id: node.id,
        name: node.type,
        x: node.type === 'ellipse' ? props.x + props.width / 2 : props.x,
        y: node.type === 'ellipse' ? props.y + props.height / 2 : props.y,
        width: props.width,
        height: props.height,
        rotation: props.rotation,
        opacity: props.opacity,
        draggable: !locked && !readOnly && node.type !== 'group',
        listening: true,
        stroke: selectedId === node.id ? '#2563eb' : props.stroke,
        strokeWidth:
          selectedId === node.id ? Math.max(props.strokeWidth ?? 1, 2) : props.strokeWidth,
      };
      let shape: KonvaNode;
      if (node.type === 'rect') {
        shape = new Konva.Rect({ ...common, fill: props.fill, cornerRadius: 0 });
      } else if (node.type === 'ellipse') {
        shape = new Konva.Ellipse({
          ...common,
          radiusX: props.width / 2,
          radiusY: props.height / 2,
          fill: props.fill,
        });
      } else if (node.type === 'text') {
        const fontStyle = props.fontStyle ?? 'normal';
        const weight = fontStyle.includes('bold') ? 'bold' : 'normal';
        const style = fontStyle.includes('italic') ? 'italic' : 'normal';
        shape = new Konva.Text({
          ...common,
          text: props.text ?? '',
          fontSize: props.fontSize ?? 14,
          fontFamily: props.fontFamily ?? 'Inter',
          fontStyle: style === 'italic' ? 'italic' : weight,
          fill: props.fill,
          align: props.align ?? 'left',
          width: props.width,
        });
      } else if (node.type === 'image') {
        const key = `${props.assetId}@${props.assetVersion ?? 1}`;
        const image = props.assetId ? images.get(key) : undefined;
        shape = new Konva.Image({ ...common, image, crop: props.crop });
      } else {
        shape = new Konva.Group(common);
      }
      shape.on('click', (evt) => {
        evt.cancelBubble = true;
        onSelect(node.id);
      });
      shape.on('tap', (evt) => {
        evt.cancelBubble = true;
        onSelect(node.id);
      });
      shape.on('dragend', () => {
        if (node.type === 'ellipse') {
          onDragEnd(node.id, shape.x() - props.width / 2, shape.y() - props.height / 2);
        } else {
          onDragEnd(node.id, shape.x(), shape.y());
        }
      });
      parent.add(shape);
      if (node.type === 'group') {
        mount(shape, node.id, locked);
      }
    }
  };

  mount(layer, null, false);
}

export default function DesignCanvas({
  document: doc,
  selectedId,
  readOnly,
  assetUrls,
  onSelect,
  onDragEnd,
  exportRef,
}: CanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<KonvaStage | null>(null);
  const layerRef = useRef<KonvaLayer | null>(null);
  const konvaRef = useRef<KonvaNS | null>(null);
  const [engine, setEngine] = useState<'pending' | 'konva' | 'error'>('pending');
  const [engineError, setEngineError] = useState('');
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const mount = async () => {
      try {
        await waitForHost(host);
        if (cancelled) {
          return;
        }
        const Konva = await loadKonva();
        if (cancelled) {
          return;
        }
        stageRef.current?.destroy();
        const stage = new Konva.Stage({
          container: host,
          width: doc.payload.width,
          height: doc.payload.height,
        });
        const layer = new Konva.Layer();
        stage.add(layer);
        stageRef.current = stage;
        layerRef.current = layer;
        konvaRef.current = Konva;
        exportRef.current = () =>
          stage.toDataURL({
            mimeType: 'image/png',
            pixelRatio: 1,
            width: doc.payload.width,
            height: doc.payload.height,
          });
        setEngine('konva');
        setEngineError('');
      } catch (error) {
        if (!cancelled) {
          exportRef.current = null;
          setEngine('error');
          setEngineError(error instanceof Error ? error.message : 'Konva mount failed');
        }
      }
    };

    void mount();
    return () => {
      cancelled = true;
      stageRef.current?.destroy();
      stageRef.current = null;
      layerRef.current = null;
    };
  }, [doc.id, doc.payload.width, doc.payload.height, exportRef]);

  useEffect(() => {
    if (engine !== 'konva' || !konvaRef.current || !layerRef.current) {
      return;
    }
    let cancelled = false;
    const stage = stageRef.current;
    exportRef.current = null;
    const render = async () => {
      const images = new Map<string, HTMLImageElement>();
      await Promise.all(
        doc.assetRefs.map(async (ref) => {
          const key = `${ref.assetId}@${ref.version}`;
          const url = assetUrls[key];
          if (!url) throw new Error('Изображение недоступно: ' + ref.assetId);
          const image = new Image();
          await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error('Ошибка загрузки изображения'));
            image.src = url;
          });
          images.set(key, image);
        }),
      );
      await loadDesignFonts();
      await document.fonts.ready;
      await Promise.all(
        doc.payload.nodes
          .filter((n) => n.type === 'text')
          .map((n) =>
            document.fonts.load(
              `${n.props.fontStyle?.includes('bold') ? '700' : '400'} ${n.props.fontSize ?? 16}px "${n.props.fontFamily ?? 'Inter'}"`,
            ),
          ),
      );
      if (cancelled || !konvaRef.current || !layerRef.current || !stage) return;
      buildKonvaTree(
        konvaRef.current,
        layerRef.current,
        doc,
        selectedId,
        readOnly,
        onSelect,
        onDragEnd,
        images,
      );
      layerRef.current.draw();
      setEngineError('');
      exportRef.current = () =>
        stage.toDataURL({
          mimeType: 'image/png',
          pixelRatio: 1,
          width: doc.payload.width,
          height: doc.payload.height,
        });
    };
    void render().catch((e) => {
      if (!cancelled) setEngineError(String(e.message));
    });
    return () => {
      cancelled = true;
    };
  }, [doc, assetUrls, selectedId, readOnly, onSelect, onDragEnd, engine]);

  useEffect(() => {
    const container = hostRef.current?.parentElement?.parentElement;
    if (!container) return;
    const update = () => {
      const width = Math.max(1, container.clientWidth - 32);
      const height = Math.max(1, container.clientHeight - 32);
      setScale(Math.min(1, width / doc.payload.width, height / doc.payload.height));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [doc.payload.width, doc.payload.height]);

  return (
    <div className="design-canvas-wrap">
      <div
        className="design-artboard"
        data-testid="design-artboard"
        data-design-scale={String(scale)}
        data-canvas-engine={engine}
        style={{
          width: doc.payload.width,
          height: doc.payload.height,
          transform: `translateX(-50%) scale(${scale})`,
        }}
        onPointerDown={() => onSelect(null)}
      >
        <div
          ref={hostRef}
          data-testid="design-konva-host"
          className="design-konva-host"
          style={{ width: doc.payload.width, height: doc.payload.height }}
        />
      </div>
      <div data-testid="design-canvas-engine" data-engine={engine} hidden>
        {engine}
        {engineError ? ` ${engineError}` : ''}
      </div>
      {engine === 'error' ? (
        <p className="design-canvas-error" role="alert">
          Canvas: Konva не смонтировалась ({engineError || 'hidden host'}). DOM fallback отключён.
        </p>
      ) : null}
    </div>
  );
}
