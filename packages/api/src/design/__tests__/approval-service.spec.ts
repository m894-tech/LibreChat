import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import type { DesignMongoHarness } from './helpers/mongoHarness';
import type { ApprovalService } from '../approval-service';
import type { DesignStore } from '../store';
import { resetDesignMongo, startDesignMongo, stopDesignMongo } from './helpers/mongoHarness';
import { createDesignStore, getMemberRole, sanitizeUserId } from '../store';
import { createApprovalService } from '../approval-service';
import { DesignError, isDesignError } from '../errors';
import { createDesignModels } from '../models';

jest.setTimeout(120000);

const TITLE_NODE = {
  id: 'title',
  type: 'text' as const,
  parentId: null,
  locked: false,
  props: { text: 'Hello', x: 10, y: 10, width: 200, height: 40, rotation: 0, opacity: 1 },
  bindings: {},
};

const BADGE_NODE = {
  id: 'badge',
  type: 'rect' as const,
  parentId: null,
  locked: false,
  props: { x: 0, y: 0, width: 40, height: 40, rotation: 0, opacity: 1, fill: '#111111' },
  bindings: {},
};

function payload(nodes = [TITLE_NODE, BADGE_NODE]) {
  return {
    width: 1080,
    height: 1080,
    nodes: nodes.map((node) => ({ ...node, props: { ...node.props } })),
  };
}

function errStatus(error: unknown): number {
  if (isDesignError(error)) {
    return error.status;
  }
  throw error;
}

function errCode(error: unknown): string {
  if (isDesignError(error)) {
    return error.code;
  }
  throw error;
}

describe('approval-service', () => {
  let harness: DesignMongoHarness;
  let store: DesignStore;
  let service: ApprovalService;

  beforeAll(async () => {
    harness = await startDesignMongo();
    createDesignModels(harness.connection);
  });

  afterAll(async () => {
    await stopDesignMongo(harness);
  });

  beforeEach(async () => {
    await resetDesignMongo(harness.connection);
    const models = createDesignModels(harness.connection);
    await Promise.all(Object.values(models).map((model) => model.createIndexes()));
    store = createDesignStore(harness.connection);
    ensureWithProjectWrite(store);
    service = await createApprovalService({ store, connection: harness.connection });
  });

  async function seedMembers(): Promise<{
    projectId: string;
    documentId: string;
    revision: number;
  }> {
    const project = await store.createProject('user-owner', 'Retail');
    await store.updateProject('user-owner', project.id, {
      members: { 'user-editor': 'editor', 'user-viewer': 'viewer' },
    });
    const document = await store.createDocument('user-owner', project.id, {
      title: 'Hero',
      kind: 'canvas',
      payload: payload(),
      designSystem: { id: 'neutral-business', version: '1.0.0' },
    });
    return { projectId: project.id, documentId: document.id, revision: document.revision };
  }

  async function bumpRevision(documentId: string, fromRevision: number): Promise<number> {
    const result = await store.applyDocumentOperations('user-owner', documentId, {
      operationId: `op-${randomUUID()}`,
      expectedRevision: fromRevision,
      declaredScope: ['title'],
      operations: [{ type: 'setText', nodeId: 'title', value: `Edited ${fromRevision}` }],
    });
    return result.document.revision;
  }

  it('lets editor comment and viewer list; outsider cannot read', async () => {
    const { documentId, revision } = await seedMembers();

    const created = await service.comment('user-editor', documentId, {
      revision,
      nodeId: 'title',
      text: 'Tighten headline',
    });
    expect(created.actorId).toBe('user-editor');
    expect(created.revision).toBe(revision);
    expect(created.nodeId).toBe('title');
    expect(created.text).toBe('Tighten headline');

    const listed = await service.comments('user-viewer', documentId);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);
    expect(listed[0].actorId).toBe('user-editor');

    await expect(service.comments('user-outsider', documentId)).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('rejects viewer comment writes and owner-less approve attempts', async () => {
    const { documentId, revision } = await seedMembers();

    try {
      await service.comment('user-viewer', documentId, {
        revision,
        text: 'viewer should not write',
      });
      throw new Error('expected viewer comment to fail');
    } catch (error) {
      expect(errStatus(error)).toBe(403);
      expect(errCode(error)).toBe('forbidden');
    }

    try {
      await service.approve('user-editor', documentId, { revision });
      throw new Error('expected editor approve to fail');
    } catch (error) {
      expect(errStatus(error)).toBe(403);
      expect(errCode(error)).toBe('forbidden');
    }

    try {
      await service.approve('user-viewer', documentId, { revision });
      throw new Error('expected viewer approve to fail');
    } catch (error) {
      expect(errStatus(error)).toBe(403);
      expect(errCode(error)).toBe('forbidden');
    }

    await expect(service.approve('user-outsider', documentId, { revision })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('validates comment text, revision snapshot, and optional node binding', async () => {
    const { documentId, revision } = await seedMembers();

    await expect(
      service.comment('user-editor', documentId, { revision, text: '' }),
    ).rejects.toMatchObject({ status: 422, code: 'schema' });

    await expect(
      service.comment('user-editor', documentId, {
        revision,
        text: 'x'.repeat(2001),
      }),
    ).rejects.toMatchObject({ status: 422, code: 'schema' });

    const twoThousand = 'é'.repeat(2000);
    const ok = await service.comment('user-editor', documentId, {
      revision,
      text: twoThousand,
    });
    expect(Array.from(ok.text)).toHaveLength(2000);

    await expect(
      service.comment('user-editor', documentId, {
        revision,
        nodeId: 'missing-node',
        text: 'bad node',
      }),
    ).rejects.toMatchObject({ status: 422, code: 'schema' });

    await expect(
      service.comment('user-editor', documentId, {
        revision: revision + 50,
        text: 'missing rev',
      }),
    ).rejects.toMatchObject({ status: 422, code: 'schema' });
  });

  it('owner approve is CAS-exact and idempotent per doc/revision/actor', async () => {
    const { documentId, revision } = await seedMembers();

    const first = await service.approve('user-owner', documentId, { revision });
    expect(first.revision).toBe(revision);
    expect(first.actorId).toBe('user-owner');

    const again = await service.approve('user-owner', documentId, { revision });
    expect(again.id).toBe(first.id);

    const status = await service.status('user-viewer', documentId);
    expect(status.headRevision).toBe(revision);
    expect(status.isCurrentApproved).toBe(true);
    expect(status.approvals).toHaveLength(1);
    expect(status.approvals[0].revision).toBe(revision);

    try {
      await service.approve('user-owner', documentId, { revision: revision + 1 });
      throw new Error('expected stale approve to fail');
    } catch (error) {
      expect(errStatus(error)).toBe(409);
      expect(errCode(error)).toBe('revision_mismatch');
    }
  });

  it('keeps approval pinned; edits make current status unapproved', async () => {
    const { documentId, revision } = await seedMembers();

    const approval = await service.approve('user-owner', documentId, { revision });
    expect(approval.revision).toBe(revision);

    const nextRevision = await bumpRevision(documentId, revision);
    expect(nextRevision).toBe(revision + 1);

    const status = await service.status('user-owner', documentId);
    expect(status.headRevision).toBe(nextRevision);
    expect(status.isCurrentApproved).toBe(false);
    expect(status.approvals).toHaveLength(1);
    expect(status.approvals[0].id).toBe(approval.id);
    expect(status.approvals[0].revision).toBe(revision);

    const reapproved = await service.approve('user-owner', documentId, { revision: nextRevision });
    expect(reapproved.revision).toBe(nextRevision);
    expect(reapproved.id).not.toBe(approval.id);

    const current = await service.status('user-editor', documentId);
    expect(current.isCurrentApproved).toBe(true);
    expect(current.approvals).toHaveLength(2);
    expect(current.approvals.map((item) => item.revision).sort()).toEqual([revision, nextRevision]);
  });

  it('returns newest 200 comments and uses actor principal not body author', async () => {
    const { documentId, revision } = await seedMembers();

    for (let index = 0; index < 5; index += 1) {
      await service.comment('user-editor', documentId, {
        revision,
        text: `note-${index}`,
      });
    }

    const listed = await service.comments('user-owner', documentId);
    expect(listed).toHaveLength(5);
    expect(listed[0].text).toBe('note-4');
    expect(listed[4].text).toBe('note-0');
    for (const item of listed) {
      expect(item.actorId).toBe('user-editor');
    }

    const commentsCol = harness.connection.collection('design_review_comments');
    const now = Date.now();
    const extras = Array.from({ length: 200 }, (_, index) => ({
      id: randomUUID(),
      documentId,
      projectId: listed[0].projectId,
      revision,
      nodeId: null,
      text: `bulk-${index}`,
      actorId: 'user-editor',
      createdAt: new Date(now + index + 1),
    }));
    await commentsCol.insertMany(extras);

    const capped = await service.comments('user-viewer', documentId);
    expect(capped).toHaveLength(200);
    expect(capped[0].text).toBe('bulk-199');
    expect(capped.every((item) => item.text.startsWith('bulk-'))).toBe(true);
  });
});

function ensureWithProjectWrite(store: DesignStore): void {
  const mutable = store as DesignStore & {
    withProjectWrite?: <T>(
      userId: string,
      projectId: string,
      work: (session: ClientSession) => Promise<T>,
    ) => Promise<T>;
  };
  if (typeof mutable.withProjectWrite === 'function') {
    return;
  }

  mutable.withProjectWrite = async function withProjectWrite<T>(
    userId: string,
    projectId: string,
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const uid = sanitizeUserId(userId);
    const session = await store.connection.startSession();
    try {
      let result: T | undefined;
      await session.withTransaction(async () => {
        const project = await store.models.DesignProject.findById(projectId)
          .session(session)
          .exec();
        if (!project) {
          throw new DesignError(404, 'not_found', 'Not found');
        }
        const role = getMemberRole(project, uid);
        if (role == null) {
          throw new DesignError(404, 'not_found', 'Not found');
        }
        if (role !== 'owner' && role !== 'editor') {
          throw new DesignError(403, 'forbidden', 'Forbidden');
        }
        result = await work(session);
      });
      if (result === undefined) {
        throw new DesignError(422, 'validation', 'Transaction produced no result');
      }
      return result;
    } finally {
      await session.endSession();
    }
  };
}
