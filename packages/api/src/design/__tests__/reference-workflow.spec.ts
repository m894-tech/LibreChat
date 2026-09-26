/**
 * Scoped reference-workflow tests: injected store + provider, actual Mongo lock metadata.
 */
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  createReferenceWorkflow,
  REFERENCE_MAX_RESULTS,
  REFERENCE_MAX_TRAITS,
  REFERENCE_QUERY_MAX,
  type ReferenceProvider,
  type ReferenceRecord,
} from '../reference-workflow';
import { DesignError } from '../assets';

jest.setTimeout(120000);

type DocState = {
  id: string;
  projectId: string;
  revision: number;
  members: Record<string, 'owner' | 'editor' | 'viewer'>;
};

type FakeStore = {
  models: {
    DesignDocument: {
      findById(documentId: string): {
        session(): { exec(): Promise<{ _id: string; projectId: string; revision: number } | null> };
        exec(): Promise<{ _id: string; projectId: string; revision: number } | null>;
      };
    };
  };
  getDocument(
    userId: string,
    documentId: string,
  ): Promise<{ id: string; projectId: string; revision: number }>;
  withProjectWrite<T>(
    userId: string,
    projectId: string,
    work: (session: mongoose.ClientSession) => Promise<T>,
  ): Promise<T>;
};

function createFakeStore(docs: Map<string, DocState>, db: mongoose.Connection): FakeStore {
  const getDoc = (actor: string, documentId: string, write: boolean) => {
    const doc = docs.get(documentId);
    if (!doc) {
      throw new DesignError(404, 'not_found', 'Not found');
    }
    const role = doc.members[actor];
    if (!role) {
      throw new DesignError(404, 'not_found', 'Not found');
    }
    if (write && role === 'viewer') {
      throw new DesignError(403, 'forbidden', 'Forbidden');
    }
    return doc;
  };

  return {
    models: {
      DesignDocument: {
        findById(documentId: string) {
          const run = async (session?: unknown) => {
            void session;
            const doc = docs.get(documentId);
            if (!doc) {
              return null;
            }
            return {
              _id: doc.id,
              projectId: doc.projectId,
              revision: doc.revision,
            };
          };
          return {
            session() {
              return { exec: () => run(true) };
            },
            exec: () => run(),
          };
        },
      },
    },
    async getDocument(userId: string, documentId: string) {
      const doc = getDoc(userId, documentId, false);
      return {
        id: doc.id,
        projectId: doc.projectId,
        revision: doc.revision,
      };
    },
    async withProjectWrite<T>(
      userId: string,
      projectId: string,
      work: (session: mongoose.ClientSession) => Promise<T>,
    ): Promise<T> {
      const owned = [...docs.values()].find((doc) => doc.projectId === projectId);
      if (!owned) {
        throw new DesignError(404, 'not_found', 'Not found');
      }
      getDoc(userId, owned.id, true);
      const session = await db.startSession();
      try {
        let result!: T;
        await session.withTransaction(async () => {
          result = await work(session);
        });
        return result;
      } finally {
        await session.endSession();
      }
    },
  };
}

describe('reference workflow (actual mongo locks + simple provider)', () => {
  let replSet: MongoMemoryReplSet;
  let connection: mongoose.Connection;
  let docs: Map<string, DocState>;
  let store: FakeStore;

  const owner = 'owner-1';
  const editor = 'editor-1';
  const viewer = 'viewer-1';
  const stranger = 'stranger-1';
  const documentId = 'doc-ref-1';
  const projectId = 'proj-ref-1';

  const sampleRefs: ReferenceRecord[] = [
    {
      id: 'ref-a',
      kind: 'styles',
      url: 'https://example.com/styles/a',
      title: 'Style A',
    },
    {
      id: 'ref-b',
      kind: 'styles',
      url: 'https://example.com/styles/b',
      title: 'Style B',
    },
  ];

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    connection = await mongoose.createConnection(replSet.getUri()).asPromise();
  });

  afterAll(async () => {
    if (connection) {
      await connection.close();
    }
    if (replSet) {
      await replSet.stop();
    }
  });

  beforeEach(async () => {
    docs = new Map([
      [
        documentId,
        {
          id: documentId,
          projectId,
          revision: 3,
          members: {
            [owner]: 'owner',
            [editor]: 'editor',
            [viewer]: 'viewer',
          },
        },
      ],
    ]);
    store = createFakeStore(docs, connection);
    const collections = await connection.db.collections();
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
  });

  it('returns typed 422 when provider is absent and never fabricates results', async () => {
    const workflow = createReferenceWorkflow({ store: store as never, connection });
    expect.assertions(3);
    try {
      await workflow.research(owner, documentId, { kind: 'styles', query: 'retail card' });
    } catch (error) {
      expect(error).toBeInstanceOf(DesignError);
      expect((error as DesignError).status).toBe(422);
      expect((error as DesignError).code).toBe('CAPABILITY_UNAVAILABLE');
    }
  });

  it('researches through the injected provider after reader ACL and enforces caps', async () => {
    const provider: ReferenceProvider = {
      async search(actor, kind, query) {
        expect(actor).toBe(editor);
        expect(kind).toBe('screens');
        expect(query).toBe('checkout');
        return sampleRefs.map((item) => ({ ...item, kind: 'screens' as const }));
      },
    };
    const workflow = createReferenceWorkflow({ store: store as never, connection, provider });
    const result = await workflow.research(editor, documentId, {
      kind: 'screens',
      query: 'checkout',
    });
    expect(result.documentRevision).toBe(3);
    expect(result.references).toHaveLength(2);
    expect(result.references[0].url).toMatch(/^https:/);

    await expect(
      workflow.research(editor, documentId, {
        kind: 'screens',
        query: 'x'.repeat(REFERENCE_QUERY_MAX + 1),
      }),
    ).rejects.toMatchObject({ status: 422, code: 'VALIDATION' });

    await expect(
      workflow.research(stranger, documentId, { kind: 'screens', query: 'checkout' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('surfaces provider failures as typed errors instead of empty success', async () => {
    const provider: ReferenceProvider = {
      async search() {
        throw new Error('lookup offline');
      },
    };
    const workflow = createReferenceWorkflow({ store: store as never, connection, provider });
    await expect(
      workflow.research(owner, documentId, { kind: 'flows', query: 'onboarding' }),
    ).rejects.toMatchObject({ status: 502, code: 'PROVIDER_ERROR' });
  });

  it('rejects non-https and credentialed reference URLs', async () => {
    const provider: ReferenceProvider = {
      async search() {
        return [
          {
            id: 'bad',
            kind: 'styles',
            url: 'http://example.com/x',
            title: 'Nope',
          },
        ];
      },
    };
    const workflow = createReferenceWorkflow({ store: store as never, connection, provider });
    await expect(
      workflow.research(owner, documentId, { kind: 'styles', query: 'bad' }),
    ).rejects.toMatchObject({ status: 422, code: 'VALIDATION' });

    const credentialed: ReferenceProvider = {
      async search() {
        return [
          {
            id: 'bad2',
            kind: 'styles',
            url: 'https://user:pass@example.com/x',
            title: 'Nope',
          },
        ];
      },
    };
    const workflow2 = createReferenceWorkflow({
      store: store as never,
      connection,
      provider: credentialed,
    });
    await expect(
      workflow2.research(owner, documentId, { kind: 'styles', query: 'bad' }),
    ).rejects.toMatchObject({ status: 422, code: 'VALIDATION' });
  });

  it('persists metadata-only locks on exact revision for owner/editor writers', async () => {
    const workflow = createReferenceWorkflow({
      store: store as never,
      connection,
      provider: {
        async search() {
          return sampleRefs;
        },
      },
    });

    const locked = await workflow.saveLock(editor, documentId, {
      expectedRevision: 3,
      decision: 'adopt',
      references: sampleRefs,
      traits: ['minimal', 'retail'],
    });
    expect(locked.status).toBe('current');
    expect(locked.lockedRevision).toBe(3);
    expect(locked.references).toEqual(sampleRefs);
    expect(locked.traits).toEqual(['minimal', 'retail']);

    await expect(
      workflow.saveLock(viewer, documentId, {
        expectedRevision: 3,
        decision: 'adopt',
        references: sampleRefs,
        traits: [],
      }),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      workflow.saveLock(editor, documentId, {
        expectedRevision: 2,
        decision: 'adopt',
        references: sampleRefs,
        traits: [],
      }),
    ).rejects.toMatchObject({ status: 409, code: 'revision_mismatch' });

    await expect(
      workflow.saveLock(editor, documentId, {
        expectedRevision: 3,
        decision: 'adopt',
        references: Array.from({ length: REFERENCE_MAX_RESULTS + 1 }, (_, index) => ({
          id: `r${index}`,
          kind: 'styles' as const,
          url: `https://example.com/${index}`,
          title: `T${index}`,
        })),
        traits: [],
      }),
    ).rejects.toMatchObject({ status: 422 });

    await expect(
      workflow.saveLock(editor, documentId, {
        expectedRevision: 3,
        decision: 'adopt',
        references: sampleRefs,
        traits: Array.from({ length: REFERENCE_MAX_TRAITS + 1 }, (_, index) => `t${index}`),
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('keeps preserved locks readable after provider loss and marks stale without mutating theme', async () => {
    const provider: ReferenceProvider = {
      async search() {
        return sampleRefs;
      },
    };
    const workflow = createReferenceWorkflow({ store: store as never, connection, provider });
    await workflow.saveLock(owner, documentId, {
      expectedRevision: 3,
      decision: 'adopt',
      references: sampleRefs,
      traits: ['compact'],
    });

    const readable = createReferenceWorkflow({ store: store as never, connection });
    const current = await readable.getLock(viewer, documentId);
    expect(current.status).toBe('current');
    expect(current.currentRevision).toBe(3);
    expect(current.decision).toBe('adopt');

    const doc = docs.get(documentId)!;
    doc.revision = 4;

    const stale = await readable.getLock(viewer, documentId);
    expect(stale.status).toBe('stale');
    expect(stale.lockedRevision).toBe(3);
    expect(stale.currentRevision).toBe(4);
    expect(stale.references).toEqual(sampleRefs);
    expect(doc.revision).toBe(4);

    await expect(
      readable.research(owner, documentId, { kind: 'styles', query: 'x' }),
    ).rejects.toMatchObject({ status: 422, code: 'CAPABILITY_UNAVAILABLE' });

    await expect(readable.getLock(stranger, documentId)).rejects.toMatchObject({
      status: 404,
    });
  });
});
