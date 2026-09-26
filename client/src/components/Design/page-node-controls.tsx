import React from 'react';
interface Node {
  id: string;
  parentId: string | null;
  type: string;
  locked: boolean;
  props: Record<string, any>;
}
interface Operation {
  type: string;
  nodeId?: string;
  property?: string;
  value?: unknown;
  node?: Node;
}
export function defaultPageChild(
  type: 'text' | 'section' | 'stack' | 'button',
  id: string,
  parentId: string | null,
): Node {
  const props =
    type === 'text'
      ? { text: 'Новый текст', size: 20, color: '#111111', weight: 400 }
      : type === 'button'
        ? { label: 'Открыть ссылку', href: 'https://example.org' }
        : {
            direction: 'column',
            mobileDirection: 'column',
            padding: 16,
            gap: 12,
            background: '#FFFFFF',
          };
  return { id, parentId, type, locked: false, props };
}
export default function PageNodeControls({
  nodes,
  selected,
  disabled,
  onSelect,
  onOperations,
}: {
  nodes: Node[];
  selected: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onOperations: (ops: Operation[]) => Promise<void>;
}) {
  const node = nodes.find((n) => n.id === selected);
  const parent =
    node && ['section', 'stack'].includes(node.type)
      ? node.id
      : (node?.parentId ??
        nodes.find((n) => n.parentId === null && ['section', 'stack'].includes(n.type))?.id ??
        null);
  const locked = (id: string | null) => {
    let n = nodes.find((n) => n.id === id);
    const seen = new Set<string>();
    while (n && !seen.has(n.id)) {
      seen.add(n.id);
      if (n.locked) return true;
      n = nodes.find((x) => x.id === n!.parentId);
    }
    return false;
  };
  const controlsDisabled = disabled || (!!node && locked(node.id));
  const change = (property: string, value: unknown) => {
    if (node && !controlsDisabled)
      void onOperations([{ type: 'setProperty', nodeId: node.id, property, value }]);
  };
  return (
    <section aria-label="Компоненты страницы">
      <h3>Дерево компонентов</h3>
      <ul>
        {nodes.map((n) => (
          <li key={n.id}>
            <button aria-pressed={selected === n.id} onClick={() => onSelect(n.id)}>
              {n.parentId ? '↳ ' : ''}
              {n.type} · {n.id.slice(0, 8)}
              {locked(n.id) ? ' 🔒' : ''}
            </button>
          </li>
        ))}
      </ul>
      <div>
        {(['section', 'stack', 'button'] as const).map((type) => (
          <button
            key={type}
            disabled={disabled || locked(parent) || (type === 'button' && !parent)}
            onClick={() =>
              void onOperations([
                { type: 'insertNode', node: defaultPageChild(type, crypto.randomUUID(), parent) },
              ])
            }
          >
            {type === 'section'
              ? 'Добавить раздел'
              : type === 'stack'
                ? 'Добавить контейнер'
                : 'Добавить ссылку'}
          </button>
        ))}
      </div>
      {node ? (
        <div key={node.id + '-' + JSON.stringify(node.props)}>
          {['section', 'stack'].includes(node.type) ? (
            <>
              <label>
                Направление
                <select
                  aria-label="Направление контейнера"
                  defaultValue={node.props.direction}
                  disabled={controlsDisabled}
                  onChange={(e) => change('direction', e.target.value)}
                >
                  <option value="column">Колонка</option>
                  <option value="row">Строка</option>
                </select>
              </label>
              {['gap', 'padding'].map((p) => (
                <label key={p}>
                  {p === 'gap' ? 'Интервал' : 'Внутренний отступ'}
                  <input
                    type="number"
                    aria-label={p}
                    defaultValue={node.props[p]}
                    min={0}
                    max={128}
                    disabled={controlsDisabled}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isInteger(v) && v >= 0 && v <= 128 && v !== node.props[p])
                        change(p, v);
                    }}
                  />
                </label>
              ))}
              <label>
                Фон
                <input
                  type="color"
                  aria-label="Фон контейнера"
                  defaultValue={node.props.background?.slice(0, 7)}
                  disabled={controlsDisabled}
                  onBlur={(e) => change('background', e.target.value)}
                />
              </label>
            </>
          ) : null}
          {node.type === 'text' ? (
            <>
              <label>
                Размер текста
                <input
                  type="number"
                  aria-label="Размер текста страницы"
                  defaultValue={node.props.size}
                  min={8}
                  max={120}
                  disabled={controlsDisabled}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isInteger(v) && v >= 8 && v <= 120 && v !== node.props.size)
                      change('size', v);
                  }}
                />
              </label>
              <label>
                Цвет текста
                <input
                  type="color"
                  aria-label="Цвет текста страницы"
                  defaultValue={node.props.color?.slice(0, 7)}
                  disabled={controlsDisabled}
                  onBlur={(e) => change('color', e.target.value)}
                />
              </label>
            </>
          ) : null}
          {node.type === 'button' ? (
            <label>
              Адрес ссылки
              <input
                aria-label="Адрес ссылки страницы"
                defaultValue={node.props.href}
                disabled={controlsDisabled}
                onBlur={(e) => {
                  if (e.target.value !== node.props.href) change('href', e.target.value);
                }}
              />
            </label>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
