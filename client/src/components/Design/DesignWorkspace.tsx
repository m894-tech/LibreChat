import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DesignCapabilities,
  DesignDocument,
  DesignError,
  DesignOperation,
  DesignProject,
  DesignProposal,
  DesignSystemPackage,
  NodeType,
  SaveState,
} from './types';
import {
  applyOperations,
  blankPayload,
  cloneDocument,
  createEnvelope,
  createId,
  systemFor,
} from './document';
import { createNode, dragOps, envelopeFor, insertNodeOps, replaceAssetOps } from './operations';
import { FORMAT_PRESETS, snapPosition, type FormatPresetId } from './canvas-guides';
import { LABELS, NODE_TYPES, NODE_TYPE_LABELS } from './constants';
import { designApi, downloadBlob, parseDesignError } from './api';
import GenerationJobs from './generation-jobs';
import PageWorkspace from './page-workspace';
import HistoryPanel from './history-panel';
import DraftPreview from './draft-preview';
import RegionPanel from './region-panel';
import BrandPanel from './brand-panel';
import { R1_SYSTEMS } from './systems';
import DesignCanvas from './canvas';
import Inspector from './inspector';
import LayersPanel from './layers';
import ChatPanel from './chat';
import './workspace.css';
import { TEMPLATES, templatePayload, type TemplateId } from './templates';
import { manualScope, wrapInGroup, ungroup } from './group-operations';

const EMPTY_CAPS: DesignCapabilities = {
  textPrompt: false,
  textProposal: false,
  imageUpload: false,
  imageGenerate: false,
  imageGeneration: false,
  exports: [],
  proposals: true,
  restore: true,
  source: 'unavailable',
};

export default function DesignWorkspace() {
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const update = () => {
      const el = workspaceRef.current;
      if (el)
        el.style.setProperty(
          '--dw-height',
          `${Math.max(240, window.innerHeight - el.getBoundingClientRect().top)}px`,
        );
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [documents, setDocuments] = useState<DesignDocument[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [doc, setDoc] = useState<DesignDocument | null>(null);
  const [draft, setDraft] = useState<DesignDocument | null>(null);
  const [systems, setSystems] = useState<DesignSystemPackage[]>(R1_SYSTEMS);
  const [capabilities, setCapabilities] = useState<DesignCapabilities>(EMPTY_CAPS);
  const [proposals, setProposals] = useState<DesignProposal[]>([]);
  const [formatPreset, setFormatPreset] = useState<FormatPresetId>('portrait1080x1350');
  const [snap, setSnap] = useState(false);
  const [allowBrandImport, setAllowBrandImport] = useState(false);
  const [pageMode, setPageMode] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'tools' | 'properties'>('properties');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preserveOverrides, setPreserveOverrides] = useState(true);
  const [projectName, setProjectName] = useState('Новый проект');
  const [docTitle, setDocTitle] = useState('Холст');
  const [newSystem, setNewSystem] = useState('neutral-business');
  const [templateId, setTemplateId] = useState<TemplateId>('blank');
  const [memberId, setMemberId] = useState('');
  const [memberRole, setMemberRole] = useState<'viewer' | 'editor'>('viewer');
  const [busy, setBusy] = useState(false);
  const [save, setSave] = useState<SaveState>({
    status: 'idle',
    message: '',
    remoteRevision: null,
  });
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const pendingRef = useRef<DesignOperation[]>([]);
  const savingRef = useRef(false);
  const undoStack = useRef<number[]>([]);
  const redoStack = useRef<number[]>([]);
  const exportRef = useRef<(() => string | null) | null>(null);
  const conflictDraft = useRef<DesignDocument | null>(null);
  const documentLoadEpoch = useRef(0);

  const currentProject = projects.find((item) => item.id === projectId);
  const readOnly = currentProject
    ? Object.values(currentProject.members).every((role) => role === 'viewer') &&
      currentProject.ownerId === undefined
    : false;
  const viewer = Boolean(
    currentProject &&
      currentProject.members &&
      !['owner', 'editor'].includes(roleOf(currentProject)),
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pendingRef.current.length || savingRef.current || conflictDraft.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const catalog = systems;

  const refreshProjects = useCallback(async () => {
    const list = await designApi.listProjects();
    setProjects(list);
    return list;
  }, []);

  useEffect(() => {
    let active = true;
    if (projectId)
      void designApi
        .projectSystems(projectId)
        .then((list) => {
          if (active) setSystems(list);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId, doc?.designSystem.id]);
  const refreshDocuments = useCallback(async (id: string) => {
    const list = await designApi.listDocuments(id);
    setDocuments(list);
    return list;
  }, []);

  const refreshProposals = useCallback(async (id: string) => {
    try {
      setProposals(await designApi.listProposals(id));
    } catch {
      setProposals([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ systems: nextSystems }, caps, list] = await Promise.all([
          designApi.listSystems(),
          designApi.probeCapabilities(),
          designApi.listProjects(),
        ]);
        if (cancelled) {
          return;
        }
        setSystems(nextSystems);
        setCapabilities(caps);
        setProjects(list);
        if (list[0]) {
          setProjectId(list[0].id);
          const deep = new URLSearchParams(window.location.search).get('documentId');
          if (deep)
            void loadDocument(deep).catch(() =>
              setSave({ status: 'error', message: 'Документ недоступен', remoteRevision: null }),
            );
        }
      } catch (error) {
        if (!cancelled) {
          setSave({
            status: 'error',
            message: parseDesignError(error).message,
            remoteRevision: null,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!projectId) {
      setDocuments([]);
      return;
    }
    void refreshDocuments(projectId).catch((error) => {
      setSave({ status: 'error', message: parseDesignError(error).message, remoteRevision: null });
    });
  }, [projectId, refreshDocuments]);

  useEffect(() => {
    const urls = { ...assetUrls };
    return () => {
      for (const url of Object.values(urls)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  const mayLeaveDraft = () => {
    if (pendingRef.current.length || savingRef.current || conflictDraft.current) {
      setSave((prev) => ({
        ...prev,
        message: 'Сначала сохраните или разрешите конфликт текущего документа',
      }));
      return false;
    }
    return true;
  };
  const changeProject = (id: string) => {
    if (!mayLeaveDraft()) return;
    documentLoadEpoch.current += 1;
    setProjectId(id || null);
    setDoc(null);
    setDraft(null);
    setSelectedId(null);
    setProposals([]);
    const url = new URL(location.href);
    url.searchParams.delete('documentId');
    window.history.replaceState(null, '', url);
  };
  const loadDocument = async (id: string) => {
    if (!mayLeaveDraft()) return;
    const epoch = ++documentLoadEpoch.current;
    const loaded = await designApi.getDocument(id);
    if (epoch !== documentLoadEpoch.current) return;
    setProjectId(loaded.projectId);
    setDocTitle(loaded.title);
    setDoc(loaded);
    setDraft(cloneDocument(loaded));
    pendingRef.current = [];
    undoStack.current = [];
    redoStack.current = [];
    setSelectedId(null);
    setSave({ status: 'saved', message: LABELS.saved, remoteRevision: loaded.revision });
    await refreshProposals(id);
    if (epoch !== documentLoadEpoch.current) return;
    await hydrateAssets(loaded);
    const url = new URL(window.location.href);
    url.searchParams.set('documentId', id);
    window.history.replaceState(null, '', url);
  };

  const hydrateAssets = async (document: DesignDocument) => {
    const next: Record<string, string> = {};
    for (const ref of document.assetRefs) {
      try {
        const blob = await designApi.getAssetBytes(ref.assetId, ref.version);
        next[`${ref.assetId}@${ref.version}`] = URL.createObjectURL(blob);
      } catch {
        /* bytes endpoint is the only image source */
      }
    }
    setAssetUrls((prev) => {
      for (const url of Object.values(prev)) {
        URL.revokeObjectURL(url);
      }
      return next;
    });
  };

  const queueOps = (operations: DesignOperation[], options?: { immediate?: boolean }) => {
    if (!draft || viewer || savingRef.current) {
      return;
    }
    const envelope = createEnvelope(draft.revision, operations);
    let next: DesignDocument;
    try {
      next = applyOperations(draft, envelope, catalog);
    } catch (error) {
      setSave((prev) => ({ ...prev, status: 'error', message: parseDesignError(error).message }));
      return;
    }
    setDraft(next);
    pendingRef.current = [...pendingRef.current, ...operations];
    setSave((prev) => ({ ...prev, status: 'dirty', message: LABELS.dirty }));
    if (options?.immediate !== false) {
      void flush(next, [...pendingRef.current]);
    }
  };

  const flush = async (from = draft, ops = pendingRef.current, base = doc) => {
    if (savingRef.current) return;
    if (!doc || !from || ops.length === 0 || viewer) {
      if (from && ops.length === 0) {
        setSave({ status: 'saved', message: LABELS.saved, remoteRevision: from.revision });
      }
      return;
    }
    savingRef.current = true;
    setBusy(true);
    setSave({ status: 'saving', message: LABELS.saving, remoteRevision: doc.revision });
    const envelope = envelopeFor(base ?? doc, ops);
    envelope.declaredScope = manualScope(base ?? doc, ops);
    try {
      const saved = await designApi.applyOperations(doc.id, envelope);
      undoStack.current.push(doc.revision);
      redoStack.current = [];
      pendingRef.current = [];
      conflictDraft.current = null;
      setDoc(saved);
      setDraft(cloneDocument(saved));
      setSave({ status: 'saved', message: LABELS.saved, remoteRevision: saved.revision });
      await refreshProposals(saved.id);
    } catch (error) {
      const parsed = parseDesignError(error);
      if (parsed.status === 409 || parsed.code === 'revision_mismatch') {
        conflictDraft.current = from;
        setSave({
          status: 'conflict',
          message: LABELS.conflict,
          remoteRevision: parsed.revision ?? null,
        });
      } else {
        setSave({ status: 'error', message: parsed.message, remoteRevision: doc.revision });
      }
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  const retryConflict = async () => {
    if (!doc || !conflictDraft.current) {
      return;
    }
    try {
      const remote = await designApi.getDocument(doc.id);
      setDoc(remote);
      setSave({ status: 'dirty', message: LABELS.dirty, remoteRevision: remote.revision });
      await flush(conflictDraft.current, pendingRef.current, remote);
    } catch (error) {
      setSave({ status: 'error', message: parseDesignError(error).message, remoteRevision: null });
    }
  };

  const restoreTo = async (revision: number) => {
    if (!doc || !mayLeaveDraft()) {
      return false;
    }
    setBusy(true);
    try {
      const restored = await designApi.restore(doc.id, doc.revision, revision, createId());
      setDoc(restored);
      setDraft(cloneDocument(restored));
      pendingRef.current = [];
      setSave({ status: 'saved', message: LABELS.saved, remoteRevision: restored.revision });
      await hydrateAssets(restored);
      return true;
    } catch (error) {
      const parsed = parseDesignError(error);
      setSave({
        status: 'error',
        message: parsed.message,
        remoteRevision: parsed.revision ?? doc.revision,
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onUndo = async () => {
    const target = undoStack.current.at(-1);
    if (target == null || !doc) {
      return;
    }
    const previous = doc.revision;
    if (await restoreTo(target)) {
      undoStack.current.pop();
      redoStack.current.push(previous);
    }
  };

  const onRedo = async () => {
    const target = redoStack.current.at(-1);
    if (target == null || !doc) {
      return;
    }
    const previous = doc.revision;
    if (await restoreTo(target)) {
      redoStack.current.pop();
      undoStack.current.push(previous);
    }
  };

  const onCreateProject = async () => {
    if (!mayLeaveDraft()) return;
    const created = await designApi.createProject(projectName.trim() || 'Проект');
    await refreshProjects();
    changeProject(created.id);
  };

  const onCreateDocument = async () => {
    if (!mayLeaveDraft()) return;
    if (!projectId) {
      return;
    }
    const system = systems.find((s) => s.id === newSystem) ?? R1_SYSTEMS[0];
    const payload = templatePayload(system, templateId),
      size = FORMAT_PRESETS[formatPreset];
    payload.width = size.width;
    payload.height = size.height;
    const bg = payload.nodes[0];
    if (bg?.type === 'rect') {
      bg.props.width = size.width;
      bg.props.height = size.height;
    }
    const created = await designApi.createDocument(projectId, {
      title: docTitle.trim() || 'Холст',
      kind: 'canvas',
      designSystem: { id: system.id, version: system.version },
      payload,
    });
    await refreshDocuments(projectId);
    await loadDocument(created.id);
  };

  const onExportSource = async () => {
    if (!doc || !mayLeaveDraft()) {
      return;
    }
    const source = await designApi.getSource(doc.id, doc.revision);
    downloadBlob(
      new Blob([JSON.stringify(source, null, 2)], { type: 'application/json' }),
      `design-${doc.id}-${doc.revision}.json`,
    );
  };

  const onExportPng = () => {
    if (pendingRef.current.length || savingRef.current) {
      setSave({
        status: 'error',
        message: 'Сначала сохраните изменения',
        remoteRevision: doc?.revision ?? null,
      });
      return;
    }
    const dataUrl = exportRef.current?.();
    if (!dataUrl || !doc) {
      setSave({
        status: 'error',
        message: 'PNG: Konva canvas недоступна',
        remoteRevision: doc?.revision ?? null,
      });
      return;
    }
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `design-${doc.id}-${doc.revision}.png`;
    link.click();
  };

  const onUpload = async (file: File) => {
    if (!projectId || !draft || busy || viewer) {
      return;
    }
    const epoch = documentLoadEpoch.current;
    const asset = await designApi.uploadAsset(file, projectId);
    if (epoch !== documentLoadEpoch.current) return;
    const selected = draft.payload.nodes.find((node) => node.id === selectedId);
    if (selected?.type === 'image') {
      queueOps(replaceAssetOps(selected.id, asset.assetId, asset.version), { immediate: true });
    } else {
      const system = systemFor(draft, catalog);
      const node = createNode('image', system);
      node.props.assetId = asset.assetId;
      node.props.assetVersion = asset.version;
      queueOps(
        [...insertNodeOps(node), ...replaceAssetOps(node.id, asset.assetId, asset.version)],
        { immediate: true },
      );
    }
    try {
      const blob = await designApi.getAssetBytes(asset.assetId, asset.version);
      setAssetUrls((prev) => ({
        ...prev,
        [`${asset.assetId}@${asset.version}`]: URL.createObjectURL(blob),
      }));
    } catch {
      /* no fake image endpoint */
    }
  };

  const working = draft;
  const system = working ? systemFor(working, catalog) : systems[0];

  if (pageMode && projectId)
    return (
      <PageWorkspace projectId={projectId} readOnly={viewer} onBack={() => setPageMode(false)} />
    );

  return (
    <div ref={workspaceRef} className="design-workspace" data-testid="design-workspace">
      <header className="design-topbar">
        <strong>{LABELS.app}</strong>
        <label>
          {LABELS.projects}
          <select
            disabled={busy}
            data-testid="design-project-list"
            value={projectId ?? ''}
            onChange={(event) => changeProject(event.target.value)}
          >
            <option value="">—</option>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.archived ? ' (архив)' : ''}
              </option>
            ))}
          </select>
        </label>
        <input
          aria-label={LABELS.projectName}
          value={projectName}
          onChange={(event) => setProjectName(event.target.value)}
        />
        <button
          type="button"
          className="design-primary"
          data-testid="design-create-project"
          disabled={busy}
          onClick={() =>
            void onCreateProject().catch((e) =>
              setSave((prev) => ({
                ...prev,
                status: 'error',
                message: parseDesignError(e).message,
              })),
            )
          }
        >
          {LABELS.createProject}
        </button>
        <label>
          {LABELS.documents}
          <select
            disabled={busy}
            data-testid="design-document-list"
            value={working?.id ?? ''}
            onChange={(event) => {
              const id = event.target.value;
              if (id) {
                void loadDocument(id);
              }
            }}
          >
            <option value="">—</option>
            {documents.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} r{item.revision}
                {item.archived ? ' (архив)' : ''}
              </option>
            ))}
          </select>
        </label>
        <input
          aria-label={LABELS.documentTitle}
          value={docTitle}
          onChange={(event) => setDocTitle(event.target.value)}
        />
        <button
          type="button"
          className="design-primary"
          data-testid="design-create-document"
          disabled={!projectId || busy}
          onClick={() =>
            void onCreateDocument().catch((e) =>
              setSave((prev) => ({
                ...prev,
                status: 'error',
                message: parseDesignError(e).message,
              })),
            )
          }
        >
          {LABELS.createDocument}
        </button>
        <button
          type="button"
          disabled={!projectId || busy}
          onClick={() => {
            if (mayLeaveDraft()) setPageMode(true);
          }}
        >
          Страницы
        </button>
        <button
          type="button"
          aria-pressed={showAdvanced}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? 'Скрыть доп.' : 'Ещё'}
        </button>
      </header>
      <div className="design-guide" data-testid="design-guide">
        <strong>Сценарий:</strong>
        <span>1. Проект</span>
        <span>→ 2. Документ</span>
        <span>→ 3. Текст</span>
        <span>→ 4. AI справа</span>
        <span>→ 5. Принять</span>
        <span>→ 6. PNG</span>
      </div>
      {save.status === 'conflict' ? (
        <div className="design-conflict" data-testid="design-conflict" role="alert">
          <span>{save.message}</span>
          <button type="button" onClick={() => void retryConflict()}>
            {LABELS.retrySave}
          </button>
        </div>
      ) : (
        <div className="design-status" data-testid="design-save-state">
          {save.message || LABELS.noDocument}
          {viewer ? ` · ${LABELS.viewerReadonly}` : ''}
        </div>
      )}
      <nav className="design-mobile-tabs" aria-label="Панели редактора">
        <button aria-pressed={mobilePanel === 'tools'} onClick={() => setMobilePanel('tools')}>
          Инструменты и слои
        </button>
        <button
          aria-pressed={mobilePanel === 'properties'}
          onClick={() => setMobilePanel('properties')}
        >
          Свойства и чат
        </button>
      </nav>
      <div className="design-body" data-mobile-panel={mobilePanel}>
        <div className="design-left">
          <div className="design-sidebar-list">
            <div className="design-tools">
              <label>
                <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
                Привязка
              </label>
              {NODE_TYPES.filter((type) => type !== 'image' && type !== 'group').map((type) => (
                <button
                  key={NODE_TYPE_LABELS[type]}
                  type="button"
                  className={type === 'text' ? 'design-primary' : undefined}
                  disabled={!working || viewer || busy}
                  onClick={() => {
                    if (!working || !system) {
                      return;
                    }
                    queueOps(insertNodeOps(createNode(type as NodeType, system)), {
                      immediate: true,
                    });
                  }}
                >
                  {NODE_TYPE_LABELS[type]}
                </button>
              ))}
              <button
                type="button"
                data-testid="design-save"
                disabled={!working || viewer || busy}
                onClick={() => {
                  const active = document.activeElement;
                  if (active instanceof HTMLElement) active.blur();
                  queueMicrotask(() => void flush());
                }}
              >
                {LABELS.save}
              </button>
              <button
                type="button"
                data-testid="design-undo"
                disabled={busy || viewer}
                onClick={() => void onUndo()}
              >
                {LABELS.undo}
              </button>
              <button
                type="button"
                data-testid="design-redo"
                disabled={busy || viewer}
                onClick={() => void onRedo()}
              >
                {LABELS.redo}
              </button>
              <button
                type="button"
                data-testid="design-export-png"
                disabled={!doc}
                onClick={onExportPng}
              >
                {LABELS.exportPng}
              </button>
              {capabilities.imageUpload ? (
                <label>
                  {LABELS.uploadImage}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void onUpload(file).catch((e) =>
                          setSave({
                            status: 'error',
                            message: parseDesignError(e).message,
                            remoteRevision: doc?.revision ?? null,
                          }),
                        );
                      }
                      event.target.value = '';
                    }}
                  />
                </label>
              ) : null}
            </div>
            {showAdvanced ? (
              <details className="design-advanced" open>
                <summary>Дополнительно</summary>
                <div className="design-tools">
                  <label>
                    <input
                      type="checkbox"
                      checked={snap}
                      onChange={(e) => setSnap(e.target.checked)}
                    />
                    Привязка к краям и центру (без поворота)
                  </label>
                  {NODE_TYPES.filter((type) => type !== 'image').map((type) => (
                    <button
                      key={NODE_TYPE_LABELS[type]}
                      type="button"
                      disabled={!working || viewer || busy}
                      onClick={() => {
                        if (!working || !system) {
                          return;
                        }
                        queueOps(insertNodeOps(createNode(type as NodeType, system)), {
                          immediate: true,
                        });
                      }}
                    >
                      {NODE_TYPE_LABELS[type]}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={!working || !selectedId || viewer || busy}
                    onClick={() => {
                      try {
                        if (working && selectedId && system)
                          queueOps(wrapInGroup(working, selectedId, system));
                      } catch (e) {
                        setSave((prev) => ({
                          ...prev,
                          status: 'error',
                          message: parseDesignError(e).message,
                        }));
                      }
                    }}
                  >
                    В группу
                  </button>
                  <button
                    type="button"
                    disabled={!working || !selectedId || viewer || busy}
                    onClick={() => {
                      try {
                        if (working && selectedId) queueOps(ungroup(working, selectedId));
                      } catch (e) {
                        setSave((prev) => ({
                          ...prev,
                          status: 'error',
                          message: parseDesignError(e).message,
                        }));
                      }
                    }}
                  >
                    Разгруппировать
                  </button>
                  <button
                    type="button"
                    data-testid="design-save"
                    disabled={!working || viewer || busy}
                    onClick={() => {
                      const active = document.activeElement;
                      if (active instanceof HTMLElement) active.blur();
                      queueMicrotask(() => void flush());
                    }}
                  >
                    {LABELS.save}
                  </button>
                  <button
                    type="button"
                    data-testid="design-undo"
                    disabled={busy || viewer}
                    onClick={() => void onUndo()}
                  >
                    {LABELS.undo}
                  </button>
                  <button
                    type="button"
                    data-testid="design-redo"
                    disabled={busy || viewer}
                    onClick={() => void onRedo()}
                  >
                    {LABELS.redo}
                  </button>
                  <button
                    type="button"
                    disabled={!doc || viewer || busy}
                    onClick={() => {
                      if (!doc || !mayLeaveDraft()) return;
                      void designApi
                        .updateDocument(doc.id, { title: docTitle, expectedRevision: doc.revision })
                        .then(async (d) => {
                          setDoc(d);
                          setDraft(cloneDocument(d));
                          await refreshDocuments(d.projectId);
                        })
                        .catch((e) =>
                          setSave((prev) => ({
                            ...prev,
                            status: 'error',
                            message: parseDesignError(e).message,
                          })),
                        );
                    }}
                  >
                    Переименовать документ
                  </button>
                  <button
                    type="button"
                    disabled={!doc || viewer || busy}
                    onClick={() => {
                      if (!doc || !mayLeaveDraft()) return;
                      void designApi
                        .updateDocument(doc.id, {
                          archived: !doc.archived,
                          expectedRevision: doc.revision,
                        })
                        .then(async (d) => {
                          setDoc(d);
                          setDraft(cloneDocument(d));
                          await refreshDocuments(d.projectId);
                        })
                        .catch((e) =>
                          setSave((prev) => ({
                            ...prev,
                            status: 'error',
                            message: parseDesignError(e).message,
                          })),
                        );
                    }}
                  >
                    {doc?.archived ? 'Восстановить из архива' : 'В архив'}
                  </button>
                  <button
                    type="button"
                    disabled={!doc || viewer || busy}
                    onClick={() => {
                      if (!doc || !mayLeaveDraft()) return;
                      void designApi
                        .duplicateDocument(doc.id)
                        .then(async (d) => {
                          await refreshDocuments(d.projectId);
                          await loadDocument(d.id);
                        })
                        .catch((e) =>
                          setSave((prev) => ({
                            ...prev,
                            status: 'error',
                            message: parseDesignError(e).message,
                          })),
                        );
                    }}
                  >
                    Дублировать документ
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={allowBrandImport}
                      onChange={(e) => setAllowBrandImport(e.target.checked)}
                    />
                    При импорте разрешаю публиковать новые версии бренда в этом проекте (только
                    владелец)
                  </label>
                  <label>
                    Импорт ZIP с ресурсами
                    <input
                      aria-label="Импорт ZIP с ресурсами"
                      type="file"
                      accept="application/zip,.zip"
                      disabled={!projectId || viewer || busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file || !projectId || !mayLeaveDraft()) return;
                        const target = projectId;
                        setBusy(true);
                        void designApi
                          .importPackage(target, file, allowBrandImport)
                          .then(async (d) => {
                            await refreshDocuments(d.projectId);
                            await loadDocument(d.id);
                          })
                          .catch((e) =>
                            setSave((prev) => ({
                              ...prev,
                              status: 'error',
                              message: parseDesignError(e).message,
                            })),
                          )
                          .finally(() => setBusy(false));
                      }}
                    />
                  </label>
                  <label>
                    Импорт исходника JSON
                    <input
                      aria-label="Импорт исходника JSON"
                      type="file"
                      accept="application/json,.json"
                      disabled={!projectId || viewer || busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file || !projectId || !mayLeaveDraft()) return;
                        const target = projectId;
                        if (file.size > 2 * 1024 * 1024) {
                          setSave((prev) => ({
                            ...prev,
                            status: 'error',
                            message: 'Исходник больше 2 МиБ',
                          }));
                          return;
                        }
                        void file
                          .text()
                          .then((text) => designApi.importSource(target, JSON.parse(text)))
                          .then(async (d) => {
                            await refreshDocuments(d.projectId);
                            await loadDocument(d.id);
                          })
                          .catch((e) =>
                            setSave((prev) => ({
                              ...prev,
                              status: 'error',
                              message: parseDesignError(e).message,
                            })),
                          );
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    data-testid="design-export-package"
                    disabled={!doc || busy}
                    onClick={() => {
                      if (!doc || !mayLeaveDraft()) return;
                      const d = doc;
                      setBusy(true);
                      void designApi
                        .getSourcePackage(d.id, d.revision)
                        .then((bytes) => downloadBlob(bytes, `design-${d.id}-r${d.revision}.zip`))
                        .catch((e) =>
                          setSave((prev) => ({
                            ...prev,
                            status: 'error',
                            message: parseDesignError(e).message,
                          })),
                        )
                        .finally(() => setBusy(false));
                    }}
                  >
                    Исходник с ресурсами ZIP
                  </button>
                  <button
                    type="button"
                    data-testid="design-export-source"
                    disabled={!doc}
                    onClick={() => void onExportSource()}
                  >
                    {LABELS.exportSource}
                  </button>
                  <button
                    type="button"
                    data-testid="design-export-png"
                    disabled={!doc}
                    onClick={onExportPng}
                  >
                    {LABELS.exportPng}
                  </button>
                  <button
                    disabled={!doc || busy}
                    title="Текст и векторы редактируются; переносы текста могут отличаться. Изображения остаются растровыми."
                    onClick={() => {
                      if (!doc || !mayLeaveDraft()) return;
                      const d = doc;
                      void designApi
                        .svgExport(d.id, d.revision)
                        .then((svg) =>
                          downloadBlob(
                            new Blob([svg], { type: 'image/svg+xml' }),
                            `design-${d.id}-r${d.revision}.svg`,
                          ),
                        )
                        .catch((e) =>
                          setSave((prev) => ({
                            ...prev,
                            status: 'error',
                            message: parseDesignError(e).message,
                          })),
                        );
                    }}
                  >
                    SVG (переносы текста могут отличаться)
                  </button>

                  {(['jpeg', 'webp'] as const).map((format) => (
                    <button
                      key={format}
                      disabled={!doc || busy}
                      onClick={() => {
                        if (!doc || !mayLeaveDraft()) return;
                        const url = exportRef.current?.();
                        if (!url) return;
                        const d = doc;
                        setBusy(true);
                        void fetch(url)
                          .then((r) => r.blob())
                          .then((png) => designApi.rasterExport(d.id, d.revision, format, png))
                          .then((bytes) =>
                            downloadBlob(
                              bytes,
                              `design-${d.id}-r${d.revision}.${format === 'jpeg' ? 'jpg' : 'webp'}`,
                            ),
                          )
                          .catch((e) =>
                            setSave((prev) => ({
                              ...prev,
                              status: 'error',
                              message: parseDesignError(e).message,
                            })),
                          )
                          .finally(() => setBusy(false));
                      }}
                    >
                      Экспорт {format.toUpperCase()} (растр)
                    </button>
                  ))}
                  {capabilities.imageUpload ? (
                    <label>
                      {LABELS.uploadImage}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            void onUpload(file).catch((e) =>
                              setSave({
                                status: 'error',
                                message: parseDesignError(e).message,
                                remoteRevision: doc?.revision ?? null,
                              }),
                            );
                          }
                          event.target.value = '';
                        }}
                      />
                    </label>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
          {working ? (
            <LayersPanel document={working} selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <p className="design-muted">{LABELS.noDocument}</p>
          )}
        </div>
        <div className="design-center">
          {working ? (
            <DesignCanvas
              document={working}
              selectedId={selectedId}
              readOnly={viewer || busy}
              assetUrls={assetUrls}
              onSelect={setSelectedId}
              onDragEnd={(nodeId, x, y) => {
                const n = working.payload.nodes.find((n) => n.id === nodeId);
                const p =
                  n && n.props.rotation === 0 && n.parentId === null
                    ? snapPosition(
                        { x, y, width: n.props.width, height: n.props.height },
                        { width: working.payload.width, height: working.payload.height },
                        { enabled: snap, tolerance: 8 },
                      )
                    : { x, y };
                queueOps(dragOps(nodeId, p.x, p.y), { immediate: true });
              }}
              exportRef={exportRef}
            />
          ) : (
            <div className="design-empty" data-testid="design-empty">
              <h3>Сначала создайте проект и документ</h3>
              <p className="design-muted">
                Дальше: добавьте текст слева, выделите его, справа запросите AI-предложение и
                нажмите «Принять».
              </p>
              <ol>
                <li>Создать проект</li>
                <li>Создать документ</li>
                <li>Нажать «Текст»</li>
                <li>AI справа → Принять</li>
                <li>Экспорт PNG</li>
              </ol>
            </div>
          )}
        </div>
        <div className="design-right">
          {working ? (
            <>
              <Inspector
                document={working}
                selectedId={selectedId}
                readOnly={viewer || busy}
                preserveOverrides={preserveOverrides}
                systems={catalog}
                onPreserveOverrides={setPreserveOverrides}
                onOperations={(ops, options) => queueOps(ops, options)}
                onFlush={() => void flush()}
              />
              <ChatPanel
                document={working}
                selectedId={selectedId}
                capabilities={capabilities}
                proposals={proposals}
                busy={
                  busy || viewer || pendingRef.current.length > 0 || Boolean(conflictDraft.current)
                }
                onGenerateImage={async (prompt) => {
                  if (!doc || !selectedId || viewer || !mayLeaveDraft()) return;
                  const documentId = doc.id;
                  setBusy(true);
                  try {
                    const result = await designApi.generateImage(documentId, doc.revision, prompt, [
                      selectedId,
                    ]);
                    if (result.job.status !== 'succeeded')
                      throw new Error(
                        result.job.error?.message ?? 'Состояние задания: ' + result.job.status,
                      );
                    await designApi.imageProposal(result.job.id, selectedId);
                    await refreshProposals(documentId);
                  } catch (e) {
                    setSave((prev) => ({
                      ...prev,
                      status: 'error',
                      message: parseDesignError(e).message,
                    }));
                  } finally {
                    setBusy(false);
                  }
                }}
                onGenerate={async (prompt, scopeIds) => {
                  if (!doc || !scopeIds.length || viewer || !mayLeaveDraft()) return;
                  setBusy(true);
                  try {
                    const result = await designApi.generateProposal(
                      doc.id,
                      doc.revision,
                      prompt,
                      scopeIds,
                    );
                    if (result.job.status !== 'succeeded')
                      throw new Error(
                        result.job.error?.message ?? 'Состояние задания: ' + result.job.status,
                      );
                    await designApi.materializeProposal(result.job.id);
                    await refreshProposals(doc.id);
                  } catch (e) {
                    setSave((prev) => ({
                      ...prev,
                      status: 'error',
                      message: parseDesignError(e).message,
                    }));
                  } finally {
                    setBusy(false);
                  }
                }}
                onPropose={async (summary, operations) => {
                  if (!working) {
                    return;
                  }
                  await designApi.createProposal(working.id, {
                    summary,
                    declaredScope: operations
                      .map((op) => op.nodeId)
                      .filter((id): id is string => Boolean(id)),
                    operations,
                    baseRevision: working.revision,
                  });
                  await refreshProposals(working.id);
                }}
                onAccept={async (proposalId) => {
                  if (!mayLeaveDraft() || viewer) return;
                  const next = await designApi.acceptProposal(proposalId);
                  if (doc) undoStack.current.push(doc.revision);
                  redoStack.current = [];
                  setDoc(next);
                  setDraft(cloneDocument(next));
                  await hydrateAssets(next);
                  await refreshProposals(next.id);
                }}
                onReject={async (proposalId) => {
                  await designApi.rejectProposal(proposalId);
                  if (working) {
                    await refreshProposals(working.id);
                  }
                }}
              />
              {showAdvanced ? (
                <details className="design-advanced" open>
                  <summary>Доп. панели</summary>
                  <BrandPanel
                    key={'brand-' + working.projectId}
                    projectId={working.projectId}
                    documentId={working.id}
                    revision={working.revision}
                    readOnly={viewer || busy || pendingRef.current.length > 0}
                    onBind={async (id, version) => {
                      if (!mayLeaveDraft()) return;
                      const next = await designApi.bindBrand(
                        working.id,
                        working.revision,
                        id,
                        version,
                      );
                      setSystems(await designApi.projectSystems(working.projectId));
                      setDoc(next);
                      setDraft(cloneDocument(next));
                    }}
                    onProposal={() => refreshProposals(working.id)}
                    owner={!!currentProject && roleOf(currentProject) === 'owner'}
                  />
                  <HistoryPanel
                    documentId={working.id}
                    revision={working.revision}
                    disabled={viewer || busy || pendingRef.current.length > 0}
                    onRestore={restoreTo}
                  />
                  <Inspector
                    document={working}
                    selectedId={selectedId}
                    readOnly={viewer || busy}
                    preserveOverrides={preserveOverrides}
                    systems={catalog}
                    onPreserveOverrides={setPreserveOverrides}
                    onOperations={(ops, options) => queueOps(ops, options)}
                    onFlush={() => void flush()}
                  />
                  <RegionPanel
                    inpaintEnabled={false}
                    key={selectedId ?? 'none'}
                    document={working}
                    selectedId={selectedId}
                    readOnly={viewer || busy || pendingRef.current.length > 0}
                    sourceURL={(() => {
                      const n = working.payload.nodes.find((n) => n.id === selectedId);
                      return n?.type === 'image'
                        ? assetUrls[`${n.props.assetId}@${n.props.assetVersion}`]
                        : undefined;
                    })()}
                    onProposal={() => refreshProposals(working.id)}
                  />
                  <DraftPreview
                    key={working.id}
                    document={working}
                    enabled={capabilities.documentDraft === true}
                    readOnly={
                      viewer ||
                      busy ||
                      pendingRef.current.length > 0 ||
                      Boolean(conflictDraft.current)
                    }
                    assetUrls={assetUrls}
                    onProposal={() => refreshProposals(working.id)}
                  />

                  <GenerationJobs
                    documentId={working.id}
                    readOnly={viewer || busy || pendingRef.current.length > 0}
                    onResult={async (job) => {
                      if (!mayLeaveDraft()) return;
                      if (job.capability === 'imageGeneration') {
                        if (!selectedId) throw new Error('Выберите исходное изображение');
                        await designApi.imageProposal(job.id, selectedId);
                      } else await designApi.materializeProposal(job.id);
                      await refreshProposals(working.id);
                    }}
                  />
                </details>
              ) : null}
            </>
          ) : (
            <p className="design-muted">{LABELS.noDocument}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function roleOf(project: DesignProject): string {
  return (project as DesignProject & { effectiveRole?: string }).effectiveRole ?? 'viewer';
}
