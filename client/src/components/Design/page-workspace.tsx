import { useEffect, useState, useRef } from 'react';
import PageProposalsPanel from './page-proposals-panel';
import PageNodeControls from './page-node-controls';
import { designApi, downloadBlob } from './api';
interface Node {
  id: string;
  parentId: string | null;
  type: 'section' | 'stack' | 'text' | 'image' | 'button' | 'table' | 'bar-chart';
  locked: boolean;
  props: Record<string, any>;
}
interface Page {
  id: string;
  projectId: string;
  revision: number;
  document: {
    kind: 'web';
    schemaVersion: 1;
    title: string;
    viewport: { desktop: number; mobile: number };
    nodes: Node[];
    assetRefs: Array<{ assetId: string; version: number }>;
  };
}
const initial = (): Page['document'] => ({
  kind: 'web',
  schemaVersion: 1,
  title: 'Новая страница',
  viewport: { desktop: 1024, mobile: 375 },
  assetRefs: [],
  nodes: [
    {
      id: 'root',
      parentId: null,
      type: 'section',
      locked: false,
      props: {
        direction: 'column',
        mobileDirection: 'column',
        padding: 32,
        gap: 16,
        background: '#FFFFFF',
      },
    },
    {
      id: 'heading',
      parentId: 'root',
      type: 'text',
      locked: false,
      props: { text: 'Заголовок страницы', size: 36, color: '#111111', weight: 600 },
    },
    {
      id: 'body',
      parentId: 'root',
      type: 'text',
      locked: false,
      props: {
        text: 'Редактируемые компоненты — без произвольного HTML',
        size: 18,
        color: '#333333',
        weight: 400,
      },
    },
  ],
});
export default function PageWorkspace({
  projectId,
  readOnly,
  onBack,
}: {
  projectId: string;
  readOnly: boolean;
  onBack: () => void;
}) {
  const loadEpoch = useRef(0),
    currentPage = useRef<string | null>(null);
  const [interact, setInteract] = useState(false);
  const [pages, setPages] = useState<Page[]>([]),
    [page, setPage] = useState<Page | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [mobile, setMobile] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [text, setText] = useState(''),
    [images, setImages] = useState<Record<string, string>>({}),
    [history, setHistory] = useState<Array<{ revision: number; actor: string }>>([]),
    [brands, setBrands] = useState<any[]>([]);
  useEffect(() => {
    let active = true;
    designApi
      .listPages(projectId)
      .then((rows) => {
        if (active) setPages(rows);
      })
      .catch(() => {
        if (active) setError('Страницы недоступны');
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    if (page)
      Promise.all(
        page.document.assetRefs.map(async (ref) => {
          const bytes = await designApi.getAssetBytes(ref.assetId, ref.version);
          const url = URL.createObjectURL(bytes);
          urls.push(url);
          return [ref.assetId + '@' + ref.version, url] as const;
        }),
      )
        .then((pairs) => {
          if (active) setImages(Object.fromEntries(pairs));
        })
        .catch(() => {
          if (active) setError('Изображения страницы недоступны');
        });
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [page?.id, page?.revision]);
  useEffect(() => {
    let active = true;
    if (page)
      designApi
        .pageHistory(page.id)
        .then((rows) => {
          if (active) setHistory(rows);
        })
        .catch(() => {
          if (active) setError('История страницы недоступна');
        });
    return () => {
      active = false;
    };
  }, [page?.id, page?.revision]);
  currentPage.current = page?.id ?? null;
  const canLeave = () => {
    const current = page?.document.nodes.find((n) => n.id === selected);
    if (
      current &&
      ['text', 'button'].includes(current.type) &&
      text !== (current.props.text ?? current.props.label ?? '')
    ) {
      setError('Сначала сохраните текст выбранного элемента');
      return false;
    }
    return true;
  };
  const choose = (id: string) => {
    if (!canLeave()) return;
    setSelected(id);
    const node = page?.document.nodes.find((n) => n.id === id);
    setText(node?.props.text ?? node?.props.label ?? '');
  };
  const saveBusy = useRef(false);
  const apply = async (operations: any[]) => {
    if (!page || saveBusy.current) return;
    const editing = page.document.nodes.find((n) => n.id === selected);
    const hasPendingText =
      editing &&
      ['text', 'button'].includes(editing.type) &&
      text !== (editing.props.text ?? editing.props.label ?? '');
    const savesText = operations.some(
      (op) =>
        op.nodeId === selected &&
        (op.type === 'setText' || (op.type === 'setProperty' && op.property === 'label')),
    );
    if (hasPendingText && !savesText) {
      setError('Сначала сохраните текст выбранного элемента');
      return;
    }
    saveBusy.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await designApi.applyPage(page.id, {
        operationId: crypto.randomUUID(),
        expectedRevision: page.revision,
        scopeIds: page.document.nodes.map((n) => n.id),
        operations,
      });
      setPage(next);
      const selectedNode = next.document.nodes.find((n: Node) => n.id === selected);
      if (selectedNode) setText(selectedNode.props.text ?? selectedNode.props.label ?? '');
      setPages(await designApi.listPages(projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка записи. Локальный текст сохранён');
    } finally {
      saveBusy.current = false;
      setBusy(false);
    }
  };
  const render = (parentId: string | null, depth = 0): React.ReactNode => {
    if (!page || depth > 12) return null;
    return page.document.nodes
      .filter((n) => n.parentId === parentId)
      .map((node) => {
        const p = node.props;
        const click = (e: React.MouseEvent) => {
          if (interact) return;
          e.stopPropagation();
          choose(node.id);
        };
        const outline =
          !interact && selected === node.id ? '2px solid #2563eb' : '1px dashed transparent';
        if (node.type === 'section' || node.type === 'stack')
          return (
            <div
              key={node.id}
              onClick={click}
              style={{
                display: 'flex',
                flexDirection: (mobile ? p.mobileDirection : p.direction) ?? p.direction,
                gap: p.gap,
                padding: p.padding,
                background: p.background,
                outline,
                minWidth: 0,
                flexWrap: 'wrap',
              }}
            >
              {render(node.id, depth + 1)}
            </div>
          );
        if (node.type === 'text')
          return (
            <p
              key={node.id}
              onClick={click}
              style={{
                fontSize: p.size,
                fontWeight: p.weight,
                color: p.color,
                outline,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                margin: 0,
              }}
            >
              {!interact && selected === node.id ? text : p.text}
            </p>
          );
        if (node.type === 'table')
          return (
            <figure key={node.id} onClick={click} style={{ outline, overflow: 'auto' }}>
              <figcaption>
                {p.caption} —{' '}
                {p.source === 'example'
                  ? 'Пример данных'
                  : 'Данные пользователя, не проверены онлайн'}
              </figcaption>
              <table>
                <thead>
                  <tr>
                    {p.columns.map((c: string, j: number) => (
                      <th key={j}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r: any[], j: number) => (
                    <tr key={j}>
                      {r.map((v: any, k: number) => (
                        <td key={k}>{v ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </figure>
          );
        if (node.type === 'bar-chart') {
          const max = Math.max(1, ...p.values.map((v: number) => Math.abs(v)));
          return (
            <figure key={node.id} onClick={click} style={{ outline, flex: 1 }}>
              <figcaption>
                {p.caption} —{' '}
                {p.source === 'example'
                  ? 'Пример данных'
                  : 'Данные пользователя, не проверены онлайн'}
              </figcaption>
              {p.values.map((v: number, j: number) => (
                <div key={j}>
                  {p.labels[j]}: {v}
                  <div
                    style={{
                      height: 12,
                      background: '#2563eb',
                      width: `${(Math.abs(v) / max) * 100}%`,
                    }}
                  />
                </div>
              ))}
            </figure>
          );
        }
        if (node.type === 'button' && interact) {
          const safe =
            typeof p.href === 'string' &&
            /^(https:\/\/|\/(?!\/))/.test(p.href) &&
            !/[\\\u0000-\u001f]/.test(p.href);
          return safe ? (
            <a key={node.id} href={p.href} target="_blank" rel="noopener noreferrer">
              {p.label}
            </a>
          ) : (
            <span key={node.id}>{p.label} (ссылка недоступна)</span>
          );
        }
        if (node.type === 'button')
          return (
            <button
              key={node.id}
              onClick={click}
              style={{ outline }}
              title="Режим редактирования — ссылка не открывается"
            >
              {p.label}
            </button>
          );
        const url = images[p.assetId + '@' + p.version];
        return url ? (
          <img
            key={node.id}
            src={url}
            alt={p.alt}
            onClick={click}
            style={{ outline, maxWidth: '100%', height: 'auto' }}
          />
        ) : (
          <div key={node.id} onClick={click} style={{ outline }}>
            Изображение недоступно: {p.alt}
          </div>
        );
      });
  };
  const node = page?.document.nodes.find((n) => n.id === selected);
  const locked = (() => {
    let n = node;
    const seen = new Set<string>();
    while (n && !seen.has(n.id)) {
      seen.add(n.id);
      if (n.locked) return true;
      n = page?.document.nodes.find((x) => x.id === n!.parentId);
    }
    return false;
  })();
  return (
    <div className="design-workspace" style={{ height: '100%' }}>
      <header className="design-topbar">
        <button
          onClick={() => {
            if (canLeave()) onBack();
          }}
        >
          Назад к холсту
        </button>
        <strong>Страницы — зарегистрированные компоненты</strong>
        <button
          disabled={readOnly || interact || busy}
          onClick={() => {
            if (!canLeave()) return;
            setBusy(true);
            void designApi
              .createPage(projectId, initial())
              .then(async (p) => {
                setPage(p);
                setPages(await designApi.listPages(projectId));
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          Создать страницу
        </button>
        <select
          aria-label="Страницы"
          value={page?.id ?? ''}
          disabled={busy}
          onChange={(e) => {
            if (!canLeave()) return;
            setSelected(null);
            const epoch = ++loadEpoch.current;
            void designApi
              .getPage(e.target.value)
              .then((p) => {
                if (loadEpoch.current === epoch) setPage(p);
              })
              .catch((e) => setError(e.message));
          }}
        >
          <option value="">Выбрать</option>
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.document.title} · r{p.revision}
            </option>
          ))}
        </select>
        <button aria-pressed={interact} onClick={() => setInteract((v) => !v)}>
          {interact ? 'Вернуться к редактированию' : 'Режим взаимодействия'}
        </button>
        <button onClick={() => setMobile((x) => !x)}>{mobile ? 'Desktop' : 'Mobile'}</button>
      </header>
      <div className="design-guide" data-testid="page-guide">
        <strong>Страница:</strong>
        <span>1. Создать/выбрать</span>
        <span>→ 2. Клик по тексту</span>
        <span>→ 3. Править справа</span>
        <span>→ 4. Сохранить текст / blur</span>
        <span>→ 5. AI при необходимости</span>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) 240px',
          minHeight: 0,
          flex: 1,
        }}
      >
        <main style={{ overflow: 'auto', padding: 16, background: '#e5e5e5' }}>
          {page ? (
            <div
              data-testid="registered-page"
              style={{
                width: mobile ? page.document.viewport.mobile : page.document.viewport.desktop,
                maxWidth: '100%',
                minHeight: 300,
                background: 'white',
                fontFamily: 'Inter,sans-serif',
              }}
            >
              {render(null)}
            </div>
          ) : (
            <div className="design-empty" data-testid="page-empty">
              <h3>Создайте или выберите страницу</h3>
              <p className="design-muted">
                Дальше: клик по тексту → правка справа → Сохранить текст / blur → AI при
                необходимости.
              </p>
              <ol>
                <li>Создать страницу</li>
                <li>Клик по тексту</li>
                <li>Править справа</li>
                <li>Сохранить текст</li>
              </ol>
              <button
                type="button"
                className="design-primary"
                disabled={readOnly || interact || busy}
                onClick={() => {
                  if (!canLeave()) return;
                  setBusy(true);
                  void designApi
                    .createPage(projectId, initial())
                    .then(async (p) => {
                      setPage(p);
                      setPages(await designApi.listPages(projectId));
                    })
                    .catch((e) => setError(e.message))
                    .finally(() => setBusy(false));
                }}
              >
                Создать страницу
              </button>
            </div>
          )}
        </main>
        <aside className="design-chat">
          <h2>Свойства</h2>
          {page ? (
            <PageNodeControls
              nodes={page.document.nodes}
              selected={selected}
              disabled={readOnly || busy || interact}
              onSelect={choose}
              onOperations={apply}
            />
          ) : null}
          {page ? (
            <PageProposalsPanel
              key={page.id}
              pageId={page.id}
              revision={page.revision}
              selectedId={node?.type === 'text' ? node.id : null}
              readOnly={
                readOnly ||
                busy ||
                locked ||
                interact ||
                !!(
                  node &&
                  ['text', 'button'].includes(node.type) &&
                  text !== (node.props.text ?? node.props.label ?? '')
                )
              }
              onApplied={async () => {
                const updated = await designApi.getPage(page.id);
                setPage(updated);
                const n = updated.document.nodes.find((n: Node) => n.id === selected);
                setText(n?.props.text ?? n?.props.label ?? '');
              }}
            />
          ) : null}
          {page ? (
            <details className="design-advanced" data-testid="page-advanced">
              <summary>Дополнительно на странице</summary>
              <div>
                {true ? (
                  <>
                    <button
                      disabled={readOnly || interact || busy}
                      onClick={() =>
                        void apply([
                          {
                            type: 'insertNode',
                            node: {
                              id: crypto.randomUUID(),
                              type: 'table',
                              parentId:
                                node && ['section', 'stack'].includes(node.type) ? node.id : 'root',
                              locked: false,
                              props: {
                                kind: 'table',
                                source: 'example',
                                caption: 'Пример таблицы',
                                columns: ['Показатель', 'Значение'],
                                rows: [
                                  ['Пример А', 10],
                                  ['Пример Б', 20],
                                ],
                              },
                            },
                          },
                        ])
                      }
                    >
                      Таблица (пример)
                    </button>
                    <button
                      disabled={readOnly || interact || busy}
                      onClick={() =>
                        void apply([
                          {
                            type: 'insertNode',
                            node: {
                              id: crypto.randomUUID(),
                              type: 'bar-chart',
                              parentId:
                                node && ['section', 'stack'].includes(node.type) ? node.id : 'root',
                              locked: false,
                              props: {
                                kind: 'bar-chart',
                                source: 'example',
                                caption: 'Пример диаграммы',
                                labels: ['А', 'Б', 'В'],
                                values: [10, 20, 15],
                              },
                            },
                          },
                        ])
                      }
                    >
                      Диаграмма (пример)
                    </button>
                    <input
                      aria-label="Таблица или график JSON"
                      type="file"
                      accept="application/json,.json"
                      disabled={readOnly || interact || busy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (!f || f.size > 65536) return;
                        void f
                          .text()
                          .then((t) => {
                            const p = JSON.parse(t);
                            if (p.source !== 'provided')
                              throw new Error('Для файла укажите source: provided');
                            return apply([
                              {
                                type: 'insertNode',
                                node: {
                                  id: crypto.randomUUID(),
                                  type: p.kind,
                                  parentId:
                                    node && ['section', 'stack'].includes(node.type)
                                      ? node.id
                                      : 'root',
                                  locked: false,
                                  props: p,
                                },
                              },
                            ]);
                          })
                          .catch((e) => setError(e.message));
                      }}
                    />
                  </>
                ) : null}
                {true && brands.length ? (
                  <label>
                    Бренд (фиксированные цвета)
                    <select
                      aria-label="Бренд страницы"
                      disabled={readOnly || interact || busy}
                      defaultValue=""
                      onChange={(e) => {
                        const b = brands.find((b) => b.id + '@' + b.version === e.target.value);
                        if (!b) return;
                        setBusy(true);
                        void designApi
                          .applyPageBrand(page.id, page.revision, b.id, b.version)
                          .then(setPage)
                          .catch((e) => setError(e.message))
                          .finally(() => setBusy(false));
                      }}
                    >
                      <option value="">Выбрать опубликованную версию</option>
                      {brands.map((b) => (
                        <option key={b.id + '@' + b.version} value={b.id + '@' + b.version}>
                          {b.package.name} {b.version}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {true ? (
                  <label>
                    Оформление (фиксированные цвета)
                    <select
                      aria-label="Оформление страницы"
                      disabled={readOnly || interact || busy}
                      defaultValue=""
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) return;
                        setBusy(true);
                        void designApi
                          .applyPageSystem(page.id, page.revision, id)
                          .then(setPage)
                          .catch((e) => setError(e.message))
                          .finally(() => setBusy(false));
                      }}
                    >
                      <option value="">Выбрать систему</option>
                      <option value="neutral-business">Neutral Business</option>
                      <option value="data-analytics">Data & Analytics</option>
                      <option value="retail-promo">Retail Promo</option>
                    </select>
                  </label>
                ) : null}
                {true ? (
                  <details>
                    <summary>Версии страницы</summary>
                    {history.map((h) => (
                      <button
                        key={h.revision}
                        disabled={readOnly || interact || busy || h.revision === page.revision}
                        onClick={() => {
                          if (!canLeave()) return;
                          setBusy(true);
                          void designApi
                            .restorePage(page.id, page.revision, h.revision)
                            .then(setPage)
                            .catch((e) => setError(e.message))
                            .finally(() => setBusy(false));
                        }}
                      >
                        Восстановить версию {h.revision}
                      </button>
                    ))}
                  </details>
                ) : null}
                {true ? (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (!canLeave()) return;
                        void designApi
                          .exportPageHTML(page.id)
                          .then((html) =>
                            downloadBlob(new Blob([html], { type: 'text/html' }), 'page.html'),
                          )
                          .catch((e) => setError(e.message));
                      }}
                    >
                      HTML с ресурсами
                    </button>
                    <input
                      aria-label="Изображение страницы"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={readOnly || interact || busy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (!f) return;
                        const currentId = page.id;
                        void designApi
                          .uploadAsset(f, projectId)
                          .then((a) => {
                            if (currentPage.current !== currentId) return;
                            const parent =
                              node && (node.type === 'section' || node.type === 'stack')
                                ? node.id
                                : 'root';
                            return apply([
                              {
                                type: 'insertNode',
                                node: {
                                  id: crypto.randomUUID(),
                                  parentId: parent,
                                  type: 'image',
                                  locked: false,
                                  props: { assetId: a.assetId, version: a.version, alt: f.name },
                                },
                              },
                            ]);
                          })
                          .catch((e) => setError(e.message));
                      }}
                    />
                  </>
                ) : null}
              </div>
            </details>
          ) : null}
          {page ? (
            <>
              <p>Версия {page.revision}</p>
              <button
                disabled={readOnly || interact || busy}
                onClick={() => {
                  const parent =
                    node && (node.type === 'section' || node.type === 'stack') ? node.id : 'root';
                  void apply([
                    {
                      type: 'insertNode',
                      node: {
                        id: crypto.randomUUID(),
                        parentId: parent,
                        type: 'text',
                        locked: false,
                        props: { text: 'Новый текст', size: 20, color: '#111111', weight: 400 },
                      },
                    },
                  ]);
                }}
              >
                Добавить текст
              </button>
              <button
                onClick={() =>
                  downloadBlob(
                    new Blob([JSON.stringify(page.document, null, 2)], {
                      type: 'application/json',
                    }),
                    'page-source.json',
                  )
                }
              >
                Исходник страницы
              </button>
            </>
          ) : null}
          {node ? (
            <>
              <label>
                Текст
                <textarea
                  aria-label="Текст страницы"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onBlur={() => {
                    if (
                      readOnly ||
                      interact ||
                      busy ||
                      locked ||
                      !['text', 'button'].includes(node.type)
                    )
                      return;
                    const current = node.props.text ?? node.props.label ?? '';
                    if (text === current) return;
                    void apply([
                      {
                        type: node.type === 'text' ? 'setText' : 'setProperty',
                        nodeId: node.id,
                        ...(node.type === 'button' ? { property: 'label' } : {}),
                        value: text,
                      },
                    ]);
                  }}
                  disabled={
                    readOnly ||
                    interact ||
                    busy ||
                    locked ||
                    !['text', 'button'].includes(node.type)
                  }
                />
              </label>
              <button
                disabled={
                  readOnly || interact || busy || locked || !['text', 'button'].includes(node.type)
                }
                onClick={() =>
                  void apply([
                    {
                      type: node.type === 'text' ? 'setText' : 'setProperty',
                      nodeId: node.id,
                      ...(node.type === 'button' ? { property: 'label' } : {}),
                      value: text,
                    },
                  ])
                }
              >
                Сохранить текст
              </button>
              <p className="design-muted">
                Текст на странице обновляется сразу в превью; запись на сервер — по кнопке или при
                уходе из поля.
              </p>
              {['section', 'stack'].includes(node.type) ? (
                <button
                  disabled={readOnly || interact || busy || locked}
                  onClick={() =>
                    void apply([
                      {
                        type: 'setProperty',
                        nodeId: node.id,
                        property: 'mobileDirection',
                        value: node.props.mobileDirection === 'row' ? 'column' : 'row',
                      },
                    ])
                  }
                >
                  Направление Mobile
                </button>
              ) : null}
              <button
                disabled={readOnly || interact || busy}
                onClick={() =>
                  void apply([{ type: node.locked ? 'unlock' : 'lock', nodeId: node.id }])
                }
              >
                {node.locked ? 'Разблокировать' : 'Заблокировать'}
              </button>
              <button
                disabled={readOnly || interact || busy || locked}
                onClick={() => void apply([{ type: 'removeNode', nodeId: node.id }])}
              >
                Удалить элемент
              </button>
            </>
          ) : (
            <p>Выберите компонент</p>
          )}
          <p>Не редактор произвольного кода. Презентации не создаются автоматически.</p>
        </aside>
      </div>
    </div>
  );
}
