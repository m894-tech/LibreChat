import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import type mongoose from 'mongoose';
import type { DesignMongoHarness } from './helpers/mongoHarness';
import { resetDesignMongo, startDesignMongo, stopDesignMongo } from './helpers/mongoHarness';
import { createPresentationSendService } from '../presentation-send-service';
import { createPageStore } from '../page-store';
import { createDesignStore } from '../store';

jest.setTimeout(120000);

const PAGE_DOC = {
  schemaVersion: 1 as const,
  kind: 'web' as const,
  title: 'Страница R3',
  viewport: { desktop: 1024, mobile: 375 },
  assetRefs: [],
  nodes: [
    {
      id: 'root',
      parentId: null,
      type: 'section' as const,
      locked: false,
      props: {
        direction: 'column',
        mobileDirection: 'column',
        gap: 16,
        padding: 32,
        background: '#FFFFFF',
      },
    },
    {
      id: 't1',
      parentId: 'root',
      type: 'text' as const,
      locked: false,
      props: { text: 'Привет мир', size: 24, color: '#111111', weight: 400 as const },
    },
  ],
};

describe('page-store + presentation-send-service integration (R3)', () => {
  let harness: DesignMongoHarness;
  let connection: mongoose.Connection;
  let store: ReturnType<typeof createDesignStore>;
  let pages: Awaited<ReturnType<typeof createPageStore>>;
  let sends: Awaited<ReturnType<typeof createPresentationSendService>>;

  const owner = 'user-owner';
  const outsider = 'user-outsider';

  beforeAll(async () => {
    harness = await startDesignMongo();
    connection = harness.connection;
    store = createDesignStore(connection);
    pages = await createPageStore(store);
    sends = await createPresentationSendService(store, { request: jest.fn() });
    await resetDesignMongo(connection);
  });

  afterAll(async () => {
    await stopDesignMongo(harness);
  });

  it('creates project + page, applies ops, restore + idempotent replay', async () => {
    const project = await store.createProject(owner, 'R3 проект');
    const page = await pages.create(owner, project.id, PAGE_DOC);
    expect(page.revision).toBe(1);
    expect(page.document.nodes).toHaveLength(2);

    const opId = randomUUID();
    const updated = await pages.apply(owner, page.id, {
      operationId: opId,
      expectedRevision: 1,
      scopeIds: ['root', 't1'],
      operations: [{ type: 'setText', nodeId: 't1', value: 'Обновлённый текст' }],
    });
    expect(updated.revision).toBe(2);
    expect(updated.document.nodes.find((n: any) => n.id === 't1')!.props.text).toBe(
      'Обновлённый текст',
    );

    // idempotent replay
    const replay = await pages.apply(owner, page.id, {
      operationId: opId,
      expectedRevision: 1,
      scopeIds: ['root', 't1'],
      operations: [{ type: 'setText', nodeId: 't1', value: 'Обновлённый текст' }],
    });
    expect(replay.revision).toBe(2);

    // revision mismatch
    await expect(
      pages.apply(owner, page.id, {
        operationId: randomUUID(),
        expectedRevision: 1,
        scopeIds: ['root', 't1'],
        operations: [{ type: 'setText', nodeId: 't1', value: 'X' }],
      }),
    ).rejects.toMatchObject({ status: 409, code: 'revision_mismatch' });

    // history + restore
    const history = await pages.history(owner, page.id);
    expect(history.length).toBe(2);
    const restored = await pages.restore(owner, page.id, {
      operationId: randomUUID(),
      expectedRevision: 2,
      revision: 1,
    });
    expect(restored.revision).toBe(3);
    expect(restored.document.nodes.find((n: any) => n.id === 't1')!.props.text).toBe('Привет мир');
  });

  it('outsider gets 404 on page get/apply (ACL)', async () => {
    const project = await store.createProject(owner, 'R3 ACL');
    const page = await pages.create(owner, project.id, PAGE_DOC);
    await expect(pages.get(outsider, page.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      pages.apply(outsider, page.id, {
        operationId: randomUUID(),
        expectedRevision: 1,
        scopeIds: ['root', 't1'],
        operations: [{ type: 'setText', nodeId: 't1', value: 'hack' }],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('presentation send: idempotent replay, then reconcile confirms receipt without resend', async () => {
    const project = await store.createProject(owner, 'R3 sends');
    // canvas doc required for send (sourceRevision snapshot)
    const doc = await store.createDocument(owner, project.id, {
      title: 'Макет',
      assetRefs: [],
    });
    await store.applyDocumentOperations(owner, doc.id, {
      operationId: randomUUID(),
      expectedRevision: 1,
      declaredScope: [],
      operations: [
        {
          type: 'insertNode',
          node: {
            id: 'n1',
            type: 'text',
            parentId: null,
            locked: false,
            bindings: {},
            props: { text: 'A', x: 0, y: 0, width: 100, height: 30, rotation: 0, opacity: 1 },
          },
        },
      ],
    });

    const calls: Array<{ path: string; method: string }> = [];
    const sendOpId = randomUUID();
    const transport = {
      request: jest.fn(async (_a: string, path: string, init: { method: string; body?: any }) => {
        calls.push({ path, method: init.method });
        if (path.endsWith('/snapshot')) return { revision: 7, slides: [{ id: 'slide-1' }] };
        if (path === '/api/v1/ppt/images/upload') return { file_url: '/app_data/images/t.png' };
        if (path.includes('/operations/')) {
          return {
            status: 'applied',
            operationId: sendOpId,
            documentId: 'dest-1',
            changedSlideIds: ['slide-1'],
          };
        }
        return {
          status: 'applied',
          operationId: init.body?.operationId,
          documentId: 'dest-1',
          changedSlideIds: [init.body?.operations?.[0]?.payload?.id ?? 'slide-1'],
        };
      }),
    };
    const svc = await createPresentationSendService(store, transport);

    const png = await sharp({
      create: { width: 1080, height: 1080, channels: 4, background: '#ffffff' },
    })
      .png()
      .toBuffer();

    const sendInput = {
      operationId: sendOpId,
      sourceRevision: 2,
      destinationId: 'dest-1',
      expectedDestinationRevision: 7,
      png,
      targetSlideId: 'slide-1',
    };
    const first = await svc.send(owner, doc.id, sendInput);
    expect(first.status).toBe('succeeded');
    expect(first.slideId).toBe('slide-1');

    // idempotent replay with same operationId + same payload → same record, no extra transport calls
    const before = calls.length;
    const again = await svc.send(owner, doc.id, sendInput);
    expect(again.id).toBe(first.id);
    expect(calls.length).toBe(before);

    // reconcile on succeeded record is a no-op without transport calls
    const rec = await svc.reconcile(owner, first.id);
    expect(rec.status).toBe('succeeded');

    // list scoped to owner + doc
    const list = await svc.list(owner, doc.id);
    expect(list.length).toBe(1);
    await expect(svc.get(outsider, first.id)).rejects.toMatchObject({ status: 404 });
  });

  it('reconcile moves submission_unknown to succeeded on exact receipt', async () => {
    const project = await store.createProject(owner, 'R3 reconcile');
    const doc = await store.createDocument(owner, project.id, { title: 'D', assetRefs: [] });
    await store.applyDocumentOperations(owner, doc.id, {
      operationId: randomUUID(),
      expectedRevision: 1,
      declaredScope: [],
      operations: [
        {
          type: 'insertNode',
          node: {
            id: 'n1',
            type: 'text',
            parentId: null,
            locked: false,
            bindings: {},
            props: { text: 'A', x: 0, y: 0, width: 100, height: 30, rotation: 0, opacity: 1 },
          },
        },
      ],
    });

    const png = await sharp({
      create: { width: 1080, height: 1080, channels: 4, background: '#ffffff' },
    })
      .png()
      .toBuffer();

    let failOnce = true;
    const sendOpId = randomUUID();
    const plannedId = 'planned-x';
    const transport = {
      request: jest.fn(async (_a: string, path: string, init: { method: string }) => {
        if (failOnce && path.endsWith('/snapshot')) {
          failOnce = false;
          throw new Error('boom');
        }
        if (path.endsWith('/snapshot')) return { revision: 3 };
        if (path === '/api/v1/ppt/images/upload') return { file_url: '/app_data/images/t.png' };
        if (path.includes('/operations/')) {
          return {
            status: 'applied',
            operationId: sendOpId,
            documentId: 'dest-2',
            changedSlideIds: [],
            inverseOperations: [{ operationType: 'DeleteSlide', targetIds: [plannedId] }],
          };
        }
        return {
          status: 'applied',
          operationId: init.body?.operationId,
          documentId: 'dest-2',
          changedSlideIds: [],
          inverseOperations: [{ operationType: 'DeleteSlide', targetIds: [plannedId] }],
        };
      }),
    };
    const svc = await createPresentationSendService(store, transport);
    const record = await svc.send(owner, doc.id, {
      operationId: sendOpId,
      sourceRevision: 2,
      destinationId: 'dest-2',
      expectedDestinationRevision: 3,
      png,
      targetSlideId: 'planned-x',
    });
    expect(record.status).toBe('submission_unknown');

    const reconciled = await svc.reconcile(owner, record.id);
    expect(reconciled.status).toBe('succeeded');
    expect(reconciled.slideId).toBe('planned-x');
  });
});
