import type { PageDocument, PageNode, PageTextProps } from '../page-document';
import { normalizePageAIProposal } from '../page-ai-proposal';
import { DesignError, DesignErrorCodes } from '../errors';

function expectDesignError(fn: () => unknown, code?: string, messageIncludes?: string): void {
  try {
    fn();
    throw new Error('expected DesignError');
  } catch (error) {
    expect(error).toBeInstanceOf(DesignError);
    const err = error as DesignError;
    expect(err.status).toBe(422);
    if (code !== undefined) {
      expect(err.code).toBe(code);
    }
    if (messageIncludes !== undefined) {
      expect(err.message).toContain(messageIncludes);
    }
  }
}

function textNode(over: Partial<PageNode> & { id: string; parentId: string | null }): PageNode {
  return {
    id: over.id,
    parentId: over.parentId,
    type: 'text',
    locked: over.locked ?? false,
    props: {
      text: 'Hello',
      size: 16,
      color: '#111111',
      weight: 400,
      ...(over.props as Partial<PageTextProps> | undefined),
    },
  };
}

function makePage(over: Partial<PageDocument> = {}): PageDocument {
  return {
    schemaVersion: 1,
    kind: 'web',
    title: 'Landing',
    viewport: { desktop: 1024, mobile: 375 },
    assetRefs: [],
    nodes: over.nodes ?? [
      {
        id: 'root',
        type: 'section',
        parentId: null,
        locked: false,
        props: {
          direction: 'column',
          mobileDirection: 'column',
          gap: 12,
          padding: 20,
          background: '#FFFFFF',
        },
      },
      textNode({ id: 't1', parentId: 'root' }),
      textNode({ id: 't2', parentId: 'root', props: { text: 'Other' } }),
    ],
    ...over,
  };
}

function proposal(
  operations: unknown[],
  over: { title?: string; notes?: string } = {},
): Record<string, unknown> {
  return {
    kind: 'design_proposal',
    schemaVersion: 1,
    ...(over.title !== undefined ? { title: over.title } : {}),
    ...(over.notes !== undefined ? { notes: over.notes } : {}),
    operations,
  };
}

describe('normalizePageAIProposal', () => {
  it('accepts valid setText from object and JSON string', () => {
    const page = makePage();
    const value = proposal([{ type: 'setText', nodeId: 't1', value: 'Цена 199 ₽' }], {
      title: 'Update headline',
    });
    const fromObject = normalizePageAIProposal(page, ['t1'], value);
    expect(fromObject.summary).toBe('Update headline');
    expect(fromObject.operations).toEqual([{ type: 'setText', nodeId: 't1', value: 'Цена 199 ₽' }]);

    const fromString = normalizePageAIProposal(page, ['t1'], JSON.stringify(value));
    expect(fromString).toEqual(fromObject);
    expect((page.nodes[1].props as PageTextProps).text).toBe('Hello');
  });

  it('accepts allowlisted text setProperty and uses notes/fallback summary', () => {
    const page = makePage();
    const withNotes = normalizePageAIProposal(
      page,
      ['t1'],
      proposal([{ type: 'setProperty', nodeId: 't1', property: 'weight', value: 700 }], {
        notes: 'Bold the title',
      }),
    );
    expect(withNotes.summary).toBe('Bold the title');
    expect(withNotes.operations).toEqual([
      { type: 'setProperty', nodeId: 't1', property: 'weight', value: 700 },
    ]);

    const fallback = normalizePageAIProposal(
      page,
      ['t1'],
      proposal([{ type: 'setText', nodeId: 't1', value: 'X' }]),
    );
    expect(fallback.summary).toBe('Page AI proposal');
  });

  it('rejects property escape hatches (html/css/lock)', () => {
    const page = makePage();
    for (const property of ['innerHTML', 'style', 'html', 'css', 'locked', 'parentId']) {
      expectDesignError(
        () =>
          normalizePageAIProposal(
            page,
            ['t1'],
            proposal([{ type: 'setProperty', nodeId: 't1', property, value: '<b>x</b>' }]),
          ),
        DesignErrorCodes.SCHEMA,
        property,
      );
    }
  });

  it('rejects nodes outside trusted scope', () => {
    const page = makePage();
    expectDesignError(
      () =>
        normalizePageAIProposal(
          page,
          ['t1'],
          proposal([{ type: 'setText', nodeId: 't2', value: 'nope' }]),
        ),
      DesignErrorCodes.SCOPE,
      't2',
    );
  });

  it('rejects locked ancestor writes', () => {
    const page = makePage({
      nodes: [
        {
          id: 'root',
          type: 'section',
          parentId: null,
          locked: true,
          props: {
            direction: 'column',
            mobileDirection: 'column',
            gap: 12,
            padding: 20,
            background: '#FFFFFF',
          },
        },
        textNode({ id: 't1', parentId: 'root' }),
      ],
    });
    expectDesignError(
      () =>
        normalizePageAIProposal(
          page,
          ['t1'],
          proposal([{ type: 'setText', nodeId: 't1', value: 'blocked' }]),
        ),
      DesignErrorCodes.LOCK,
    );
  });

  it('rejects insert/remove/lock/unlock and does not mutate inputs', () => {
    const page = makePage();
    const snapshot = JSON.parse(JSON.stringify(page));
    const value = proposal([{ type: 'insertNode', nodeId: 't1', node: { id: 'x' } }]);
    const valueSnapshot = JSON.parse(JSON.stringify(value));

    expectDesignError(
      () => normalizePageAIProposal(page, ['t1'], value),
      DesignErrorCodes.CAPABILITY,
    );
    expectDesignError(
      () => normalizePageAIProposal(page, ['t1'], proposal([{ type: 'removeNode', nodeId: 't1' }])),
      DesignErrorCodes.CAPABILITY,
    );
    expectDesignError(
      () => normalizePageAIProposal(page, ['t1'], proposal([{ type: 'lock', nodeId: 't1' }])),
      DesignErrorCodes.CAPABILITY,
    );
    expectDesignError(
      () => normalizePageAIProposal(page, ['t1'], proposal([{ type: 'unlock', nodeId: 't1' }])),
      DesignErrorCodes.CAPABILITY,
    );

    expect(page).toEqual(snapshot);
    expect(value).toEqual(valueSnapshot);
  });

  it('rejects body actor/grant privileged fields', () => {
    const page = makePage();
    const base = proposal([{ type: 'setText', nodeId: 't1', value: 'X' }]);

    for (const field of ['actor', 'actorId', 'agent', 'authorizedNodeIds', 'scopeIds', 'grantId']) {
      expectDesignError(
        () => normalizePageAIProposal(page, ['t1'], { ...base, [field]: 'evil' }),
        DesignErrorCodes.SCHEMA,
        field,
      );
    }
  });
});
