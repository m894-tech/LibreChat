import {
  normalizeSourceImport,
  SOURCE_IMPORT_MAX_BYTES,
  type SourceImportEnvelope,
} from '../source-import';
import { DesignError, DesignErrorCodes } from '../errors';
import { makeDoc, makeNode } from './domain.fixtures';

function expectError(fn: () => unknown, status: number, code: string): DesignError {
  try {
    fn();
    throw new Error(`expected DesignError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DesignError);
    const designError = error as DesignError;
    expect(designError.status).toBe(status);
    expect(designError.code).toBe(code);
    return designError;
  }
}

function wrapSource(
  over: Parameters<typeof makeDoc>[0] = {},
  extra: { projectId?: string; snapshotProjectId?: string } = {},
): SourceImportEnvelope {
  const doc = makeDoc(over);
  const envelope: SourceImportEnvelope = {
    documentId: doc.id,
    revision: doc.revision,
    format: 'source',
    snapshot: {
      title: doc.title,
      kind: 'canvas',
      schemaVersion: 1,
      designSystem: doc.designSystem,
      payload: doc.payload,
      assetRefs: doc.assetRefs,
      archived: doc.archived,
    },
  };
  if (extra.projectId) {
    envelope.projectId = extra.projectId;
  }
  if (extra.snapshotProjectId) {
    envelope.snapshot.projectId = extra.snapshotProjectId;
  }
  return envelope;
}

describe('normalizeSourceImport', () => {
  const targetProjectId = 'proj1';

  it('normalizes getSource JSON to native payload, token bindings and Cyrillic', () => {
    const envelope = wrapSource({
      title: 'Карточка Привет',
      payload: {
        width: 1080,
        height: 1080,
        nodes: [
          makeNode({
            id: 'card',
            type: 'rect',
            bindings: { fill: 'color.accent' },
            props: {
              x: 10,
              y: 20,
              width: 320,
              height: 180,
              rotation: 0,
              opacity: 1,
              fill: '#1F4E79',
            },
          }),
          makeNode({
            id: 'label',
            type: 'text',
            bindings: { fill: 'color.text', fontFamily: 'font.family.body' },
            props: {
              x: 24,
              y: 36,
              width: 280,
              height: 48,
              rotation: 0,
              opacity: 1,
              text: 'Привет мир',
              fill: '#1A1A1A',
              fontFamily: 'Inter',
              fontSize: 14,
            },
          }),
        ],
      },
    });

    const fromObject = normalizeSourceImport(envelope, targetProjectId);
    const fromJson = normalizeSourceImport(JSON.stringify(envelope), targetProjectId);

    expect(fromObject.document).toEqual(fromJson.document);
    expect(fromObject.assetRefs).toEqual([]);
    expect(fromObject.document.kind).toBe('canvas');
    expect(fromObject.document.title).toBe('Карточка Привет');
    expect(fromObject.document.designSystem).toEqual({
      id: 'neutral-business',
      version: '1.0.0',
    });
    expect(fromObject.document.payload).toEqual(envelope.snapshot.payload);
    expect(fromObject.document.payload.nodes[0].bindings).toEqual({ fill: 'color.accent' });
    expect(fromObject.document.payload.nodes[1].props.text).toBe('Привет мир');
    expect(fromObject.document.payload.nodes[1].bindings).toEqual({
      fill: 'color.text',
      fontFamily: 'font.family.body',
    });
    expect(fromObject.document).not.toHaveProperty('id');
    expect(fromObject.document).not.toHaveProperty('projectId');
    expect(fromObject.document).not.toHaveProperty('revision');
    expect(fromObject.document).not.toHaveProperty('assetRefs');
  });

  it('returns asset refs separately for same-project ACL checks and skips copies', () => {
    const envelope = wrapSource(
      {
        payload: {
          width: 1080,
          height: 1080,
          nodes: [
            makeNode({
              id: 'img1',
              type: 'image',
              props: {
                x: 0,
                y: 0,
                width: 64,
                height: 64,
                rotation: 0,
                opacity: 1,
                assetId: 'asset-1',
                assetVersion: 2,
              },
            }),
          ],
        },
        assetRefs: [{ assetId: 'asset-1', version: 2 }],
      },
      { projectId: targetProjectId, snapshotProjectId: targetProjectId },
    );

    const result = normalizeSourceImport(envelope, targetProjectId);
    expect(result.document.payload.nodes[0].props.assetId).toBe('asset-1');
    expect(result.assetRefs).toEqual([{ assetId: 'asset-1', version: 2 }]);
    expect(result.document).not.toHaveProperty('assetRefs');
  });

  it('allows cross-project import only when there are zero asset refs', () => {
    const empty = wrapSource({}, { snapshotProjectId: 'other-proj' });
    const imported = normalizeSourceImport(empty, targetProjectId);
    expect(imported.assetRefs).toEqual([]);
    expect(imported.document.payload).toEqual(empty.snapshot.payload);

    const withRefs = wrapSource(
      {
        payload: {
          width: 1080,
          height: 1080,
          nodes: [
            makeNode({
              id: 'img1',
              type: 'image',
              props: {
                x: 0,
                y: 0,
                width: 64,
                height: 64,
                rotation: 0,
                opacity: 1,
                assetId: 'asset-9',
                assetVersion: 1,
              },
            }),
          ],
        },
        assetRefs: [{ assetId: 'asset-9', version: 1 }],
      },
      { snapshotProjectId: 'other-proj' },
    );
    expectError(
      () => normalizeSourceImport(withRefs, targetProjectId),
      403,
      DesignErrorCodes.FORBIDDEN,
    );
  });

  it('rejects bad schema, prototype keys and oversize input', () => {
    const badSchema = wrapSource();
    (badSchema.snapshot as { schemaVersion: number }).schemaVersion = 2;
    expectError(
      () => normalizeSourceImport(badSchema, targetProjectId),
      422,
      DesignErrorCodes.SCHEMA,
    );

    const polluted = JSON.parse(
      '{"documentId":"doc1","revision":1,"format":"source","snapshot":{"__proto__":{"polluted":true},"title":"x"}}',
    );
    expectError(
      () => normalizeSourceImport(polluted, targetProjectId),
      422,
      DesignErrorCodes.SCHEMA,
    );

    const nested = wrapSource();
    Object.defineProperty(nested.snapshot.payload, 'constructor', {
      value: { prototype: { hack: true } },
      enumerable: true,
      configurable: true,
    });
    expectError(() => normalizeSourceImport(nested, targetProjectId), 422, DesignErrorCodes.SCHEMA);

    const oversize = `{${'x'.repeat(SOURCE_IMPORT_MAX_BYTES)}`;
    expect(Buffer.byteLength(oversize, 'utf8')).toBeGreaterThan(SOURCE_IMPORT_MAX_BYTES);
    expectError(
      () => normalizeSourceImport(oversize, targetProjectId),
      429,
      DesignErrorCodes.QUOTA,
    );

    expectError(
      () => normalizeSourceImport('https://example.com/source.json', targetProjectId),
      422,
      DesignErrorCodes.SCHEMA,
    );
    expectError(
      () => normalizeSourceImport('PK\u0003\u0004{"format":"source"}', targetProjectId),
      422,
      DesignErrorCodes.SCHEMA,
    );
    expectError(
      () => normalizeSourceImport(Buffer.from('{"format":"source"}'), targetProjectId),
      422,
      DesignErrorCodes.SCHEMA,
    );
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
