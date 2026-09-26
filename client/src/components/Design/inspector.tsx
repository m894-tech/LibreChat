import { useEffect, useState } from 'react';
import type {
  CropRect,
  DesignDocument,
  DesignOperation,
  DesignSystemPackage,
  FontStyle,
} from './types';
import { findNode, isEffectivelyLocked, resolvedProps } from './document';
import { FONT_FAMILIES, FONT_STYLES, LABELS } from './constants';

interface InspectorProps {
  document: DesignDocument;
  selectedId: string | null;
  readOnly: boolean;
  preserveOverrides: boolean;
  systems: DesignSystemPackage[];
  onPreserveOverrides: (value: boolean) => void;
  onOperations: (ops: DesignOperation[], options?: { immediate?: boolean }) => void;
  onFlush: () => void;
}

const CROP_KEYS = ['x', 'y', 'width', 'height'] as const;

const CROP_FIELD_LABELS: Record<(typeof CROP_KEYS)[number], string> = {
  x: 'Кадр X',
  y: 'Кадр Y',
  width: 'Кадр ширина',
  height: 'Кадр высота',
};

const ACTION_LABELS = {
  crop: 'Кадрирование',
  backward: 'Назад',
  forward: 'Вперёд',
  remove: 'Удалить',
} as const;

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <label htmlFor={id} className="design-field">
      {label}
      {children}
    </label>
  );
}

function isValidCrop(value: CropRect): boolean {
  return (
    Number.isFinite(value.x) &&
    value.x >= 0 &&
    Number.isFinite(value.y) &&
    value.y >= 0 &&
    Number.isFinite(value.width) &&
    value.width > 0 &&
    Number.isFinite(value.height) &&
    value.height > 0
  );
}

function readCropFields(root: ParentNode): CropRect {
  const read = (key: (typeof CROP_KEYS)[number]) =>
    Number((root.querySelector(`#design-crop-${key}`) as HTMLInputElement | null)?.value);
  return {
    x: read('x'),
    y: read('y'),
    width: read('width'),
    height: read('height'),
  };
}

export default function Inspector({
  document: doc,
  selectedId,
  readOnly,
  preserveOverrides,
  systems,
  onPreserveOverrides,
  onOperations,
  onFlush,
}: InspectorProps) {
  const node = findNode(doc, selectedId);
  const locked = node ? isEffectivelyLocked(doc.payload.nodes, node.id) : false;
  const disabled = readOnly || locked;
  const resolved = node ? resolvedProps(node) : null;
  const [text, setText] = useState(node?.props.text ?? '');
  const zIndex = node ? doc.payload.nodes.findIndex((item) => item.id === node.id) : -1;

  useEffect(() => {
    setText(node?.props.text ?? '');
  }, [node?.id, node?.props.text]);

  const commitNumber = (property: string) => (event: React.FocusEvent<HTMLInputElement>) => {
    if (!node) {
      return;
    }
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) {
      return;
    }
    onOperations([{ type: 'setProperty', nodeId: node.id, property, value }], { immediate: true });
  };

  const commitCrop = (event: React.FocusEvent<HTMLInputElement>) => {
    if (!node || disabled) {
      return;
    }
    const root = event.currentTarget.closest('[data-testid="design-crop"]');
    if (!root) {
      return;
    }
    const crop = readCropFields(root);
    if (!isValidCrop(crop)) {
      return;
    }
    onOperations([{ type: 'setProperty', nodeId: node.id, property: 'crop', value: crop }], {
      immediate: true,
    });
  };

  const fillRoles = Object.keys(
    systems.find((item) => item.id === doc.designSystem.id)?.tokens ?? {},
  ).filter((role) => role.startsWith('color.'));

  return (
    <aside className="design-inspector" data-testid="design-inspector">
      <h2>{LABELS.inspector}</h2>
      <p className="design-muted">
        {LABELS.revision} {doc.revision}
      </p>
      <Field id="design-system" label={LABELS.system}>
        <select
          id="design-system"
          value={`${doc.designSystem.id}@${doc.designSystem.version}`}
          disabled={readOnly}
          onChange={(event) => {
            const [id, version] = event.target.value.split('@');
            onOperations(
              [{ type: 'applySystem', systemId: id, systemVersion: version, preserveOverrides }],
              {
                immediate: true,
              },
            );
          }}
        >
          {systems.map((item) => (
            <option key={`${item.id}@${item.version}`} value={`${item.id}@${item.version}`}>
              {item.name} {item.version}
            </option>
          ))}
        </select>
      </Field>
      <label htmlFor="design-preserve" className="design-check">
        <input
          id="design-preserve"
          type="checkbox"
          checked={preserveOverrides}
          onChange={(event) => onPreserveOverrides(event.target.checked)}
        />
        {LABELS.preserveOverrides}
      </label>
      {!node || !resolved ? (
        <p className="design-muted">{LABELS.noSelection}</p>
      ) : (
        <div className="design-inspector-fields">
          {locked ? <p className="design-warn">{LABELS.lockedHint}</p> : null}
          <p className="design-muted">
            {node.type} · {node.id.slice(0, 8)}
          </p>
          {node.type === 'text' ? (
            <Field id="design-text" label={LABELS.text}>
              <textarea
                id="design-text"
                value={text}
                disabled={disabled}
                onChange={(event) => setText(event.target.value)}
                onBlur={() => {
                  if (text !== (node.props.text ?? '')) {
                    onOperations([{ type: 'setText', nodeId: node.id, value: text }], {
                      immediate: true,
                    });
                  } else {
                    onFlush();
                  }
                }}
              />
            </Field>
          ) : null}
          <div className="design-grid2">
            {(['x', 'y', 'width', 'height', 'rotation', 'opacity'] as const).map((key) => (
              <Field key={key} id={`design-${key}`} label={LABELS[key]}>
                <input
                  id={`design-${key}`}
                  type="number"
                  step={key === 'opacity' ? 0.05 : 1}
                  defaultValue={resolved[key]}
                  key={`${node.id}-${node.props[key]}-${key}`}
                  disabled={disabled}
                  onBlur={commitNumber(key)}
                />
              </Field>
            ))}
          </div>
          {node.type === 'image' ? (
            <div data-testid="design-crop">
              <p className="design-muted">{ACTION_LABELS.crop}</p>
              <div className="design-grid2">
                {CROP_KEYS.map((key) => (
                  <Field key={key} id={`design-crop-${key}`} label={CROP_FIELD_LABELS[key]}>
                    <input
                      id={`design-crop-${key}`}
                      name={key}
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={node.props.crop?.[key] ?? 0}
                      key={`${node.id}-crop-${key}-${node.props.crop?.[key] ?? 0}`}
                      disabled={disabled}
                      onBlur={commitCrop}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </Field>
                ))}
              </div>
            </div>
          ) : null}
          {node.type === 'rect' || node.type === 'ellipse' || node.type === 'text' ? (
            <Field id="design-fill" label={LABELS.fill}>
              <input
                id="design-fill"
                type="text"
                defaultValue={resolved.fill ?? ''}
                key={`${node.id}-fill-${resolved.fill}`}
                disabled={disabled}
                onBlur={(event) =>
                  onOperations(
                    [
                      {
                        type: 'setLiteral',
                        nodeId: node.id,
                        property: 'fill',
                        value: event.target.value,
                      },
                    ],
                    {
                      immediate: true,
                    },
                  )
                }
              />
            </Field>
          ) : null}
          {node.type === 'rect' || node.type === 'ellipse' ? (
            <>
              <Field id="design-stroke" label={LABELS.stroke}>
                <input
                  id="design-stroke"
                  type="text"
                  defaultValue={resolved.stroke ?? ''}
                  key={`${node.id}-stroke-${resolved.stroke}`}
                  disabled={disabled}
                  onBlur={(event) =>
                    onOperations(
                      [
                        {
                          type: 'setLiteral',
                          nodeId: node.id,
                          property: 'stroke',
                          value: event.target.value,
                        },
                      ],
                      { immediate: true },
                    )
                  }
                />
              </Field>
              <Field id="design-sw" label={LABELS.strokeWidth}>
                <input
                  id="design-sw"
                  type="number"
                  defaultValue={resolved.strokeWidth ?? 1}
                  key={`${node.id}-sw-${resolved.strokeWidth}`}
                  disabled={disabled}
                  onBlur={commitNumber('strokeWidth')}
                />
              </Field>
            </>
          ) : null}
          {node.type === 'text' ? (
            <>
              <Field id="design-font-size" label={LABELS.fontSize}>
                <input
                  id="design-font-size"
                  type="number"
                  defaultValue={resolved.fontSize ?? 14}
                  key={`${node.id}-fs-${resolved.fontSize}`}
                  disabled={disabled}
                  onBlur={commitNumber('fontSize')}
                />
              </Field>
              <Field id="design-font-family" label={LABELS.fontFamily}>
                <select
                  id="design-font-family"
                  value={resolved.fontFamily ?? 'Inter'}
                  disabled={disabled}
                  onChange={(event) =>
                    onOperations(
                      [
                        {
                          type: 'setLiteral',
                          nodeId: node.id,
                          property: 'fontFamily',
                          value: event.target.value,
                        },
                      ],
                      { immediate: true },
                    )
                  }
                >
                  {FONT_FAMILIES.map((family) => (
                    <option key={family} value={family}>
                      {family}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="design-font-style" label={LABELS.fontStyle}>
                <select
                  id="design-font-style"
                  value={resolved.fontStyle ?? 'normal'}
                  disabled={disabled}
                  onChange={(event) =>
                    onOperations(
                      [
                        {
                          type: 'setLiteral',
                          nodeId: node.id,
                          property: 'fontStyle',
                          value: event.target.value as FontStyle,
                        },
                      ],
                      { immediate: true },
                    )
                  }
                >
                  {FONT_STYLES.map((style) => (
                    <option key={style} value={style}>
                      {style}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : null}
          {fillRoles.length > 0 &&
          (node.type === 'rect' || node.type === 'ellipse' || node.type === 'text') ? (
            <Field id="design-bind-fill" label={LABELS.bindFill}>
              <select
                id="design-bind-fill"
                value={node.bindings.fill ?? ''}
                disabled={disabled}
                onChange={(event) => {
                  const role = event.target.value;
                  if (role) {
                    onOperations(
                      [{ type: 'bindToken', nodeId: node.id, property: 'fill', value: role }],
                      {
                        immediate: true,
                      },
                    );
                  }
                }}
              >
                <option value="">{LABELS.literal}</option>
                {fillRoles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <div className="design-row">
            <button
              type="button"
              data-testid="design-z-back"
              aria-label={ACTION_LABELS.backward}
              disabled={disabled || zIndex <= 0}
              onClick={() =>
                node &&
                zIndex > 0 &&
                onOperations([{ type: 'reorderNode', nodeId: node.id, value: zIndex - 1 }], {
                  immediate: true,
                })
              }
            >
              {ACTION_LABELS.backward}
            </button>
            <button
              type="button"
              data-testid="design-z-forward"
              aria-label={ACTION_LABELS.forward}
              disabled={disabled || zIndex < 0 || zIndex >= doc.payload.nodes.length - 1}
              onClick={() =>
                node &&
                zIndex >= 0 &&
                zIndex < doc.payload.nodes.length - 1 &&
                onOperations([{ type: 'reorderNode', nodeId: node.id, value: zIndex + 1 }], {
                  immediate: true,
                })
              }
            >
              {ACTION_LABELS.forward}
            </button>
            <button
              type="button"
              data-testid="design-delete"
              aria-label={ACTION_LABELS.remove}
              disabled={disabled}
              onClick={() =>
                node && onOperations([{ type: 'removeNode', nodeId: node.id }], { immediate: true })
              }
            >
              {ACTION_LABELS.remove}
            </button>
            <button
              type="button"
              disabled={readOnly}
              onClick={() =>
                onOperations([{ type: node.locked ? 'unlock' : 'lock', nodeId: node.id }], {
                  immediate: true,
                })
              }
            >
              {node.locked ? LABELS.unlock : LABELS.lock}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
