import type { ReferenceRecord } from '../reference-workflow';
import {
  REFERENCE_NORMALIZE_MAX_TEXT_BYTES,
  normalizeReferenceSearch,
} from '../reference-normalize';
import { DesignError } from '../assets';

describe('normalizeReferenceSearch', (): void => {
  it('normalizes real-shaped styles array with style_id aliases', (): void => {
    const response: unknown[] = [
      {
        style_id: 'sty_100',
        title: 'Retail Card',
        url: 'https://refero.design/styles/sty_100',
      },
      {
        id: 'sty_101',
        title: 'Checkout Soft',
        source_url: 'https://refero.design/styles/sty_101',
      },
    ];

    const records: ReferenceRecord[] = normalizeReferenceSearch(response, 'styles');
    expect(records).toEqual([
      {
        id: 'sty_100',
        kind: 'styles',
        title: 'Retail Card',
        url: 'https://refero.design/styles/sty_100',
      },
      {
        id: 'sty_101',
        kind: 'styles',
        title: 'Checkout Soft',
        url: 'https://refero.design/styles/sty_101',
      },
    ]);
  });

  it('normalizes screens envelope using screen_id/page_url and ignores site.name', (): void => {
    const response = {
      screens: [
        {
          screen_id: 'scr_9',
          page_url: 'https://refero.design/screens/scr_9',
          site: { name: 'Should Not Become Title' },
        },
        {
          screen_id: 'scr_10',
          name: 'Pricing Table',
          page_url: 'https://refero.design/screens/scr_10',
          site: { name: 'Acme' },
        },
      ],
    };

    expect(normalizeReferenceSearch(response, 'screens')[0].title).toBe('Экран scr_9');
    const records: ReferenceRecord[] = normalizeReferenceSearch(
      { screens: response.screens.slice(1) },
      'screens',
    );
    expect(records).toEqual([
      {
        id: 'scr_10',
        kind: 'screens',
        title: 'Pricing Table',
        url: 'https://refero.design/screens/scr_10',
      },
    ]);
  });

  it('normalizes flows envelope with flow_id/title', (): void => {
    const response = {
      flows: [
        {
          flow_id: 'flow_7',
          title: 'Onboarding',
          url: 'https://refero.design/flows/flow_7',
        },
      ],
    };

    const records: ReferenceRecord[] = normalizeReferenceSearch(response, 'flows');
    expect(records).toEqual([
      {
        id: 'flow_7',
        kind: 'flows',
        title: 'Onboarding',
        url: 'https://refero.design/flows/flow_7',
      },
    ]);
  });

  it('parses MCP text JSON strictly and skips image content', (): void => {
    const payload = {
      results: [
        {
          uuid: 'uuid-1',
          title: 'From MCP',
          url: 'https://refero.design/styles/uuid-1',
        },
      ],
    };
    const response = {
      content: [
        {
          type: 'image',
          data: 'iVBORw0KGgoAAAA...',
          mimeType: 'image/png',
        },
        {
          type: 'text',
          text: JSON.stringify(payload),
        },
      ],
    };

    const records: ReferenceRecord[] = normalizeReferenceSearch(response, 'styles');
    expect(records).toEqual([
      {
        id: 'uuid-1',
        kind: 'styles',
        title: 'From MCP',
        url: 'https://refero.design/styles/uuid-1',
      },
    ]);
  });

  it('distinguishes invalid provider response from an actual empty result', () => {
    for (const value of [null, undefined, false, {}])
      expect(() => normalizeReferenceSearch(value, 'styles')).toThrow();
    expect(normalizeReferenceSearch({ styles: [] }, 'styles')).toEqual([]);
    expect(() => normalizeReferenceSearch({ screens: [] }, 'styles')).toThrow();
  });
  it('rejects oversized MCP UTF-8 text payloads', (): void => {
    const huge = 'x'.repeat(REFERENCE_NORMALIZE_MAX_TEXT_BYTES + 1);
    const response = {
      content: [{ type: 'text', text: huge }],
    };
    expect(() => normalizeReferenceSearch(response, 'styles')).toThrow(DesignError);
    try {
      normalizeReferenceSearch(response, 'styles');
    } catch (error) {
      expect(error).toBeInstanceOf(DesignError);
      expect((error as DesignError).status).toBe(422);
      expect((error as DesignError).code).toBe('REFERENCE_SIZE');
    }
  });

  it('rejects corrupt JSON and markdown-fenced text without stripping', (): void => {
    const corrupt = {
      content: [{ type: 'text', text: '{not-json' }],
    };
    expect(() => normalizeReferenceSearch(corrupt, 'styles')).toThrow(DesignError);

    const fenced = {
      content: [
        {
          type: 'text',
          text: '```json\n[{"id":"a","title":"A","url":"https://refero.design/a"}]\n```',
        },
      ],
    };
    expect(() => normalizeReferenceSearch(fenced, 'styles')).toThrow(DesignError);
  });

  it('rejects MCP isError responses', (): void => {
    const response = {
      isError: true,
      content: [{ type: 'text', text: '[]' }],
    };
    expect(() => normalizeReferenceSearch(response, 'flows')).toThrow(DesignError);
    try {
      normalizeReferenceSearch(response, 'flows');
    } catch (error) {
      expect(error).toBeInstanceOf(DesignError);
      expect((error as DesignError).status).toBe(502);
      expect((error as DesignError).code).toBe('PROVIDER_ERROR');
    }
  });

  it('rejects unsafe rows and caps valid results at 10', (): void => {
    const items: unknown[] = [];
    items.push({
      id: 'bad-http',
      title: 'HTTP',
      url: 'http://refero.design/x',
    });
    items.push({
      id: 'bad-creds',
      title: 'Creds',
      url: 'https://user:pass@refero.design/x',
    });
    items.push({
      id: 'bad-control',
      title: 'Control',
      url: 'https://refero.design/x\u0007',
    });
    for (let i = 0; i < 12; i += 1) {
      items.push({
        id: `ok_${i}`,
        title: `Title ${i}`,
        url: `https://refero.design/styles/ok_${i}`,
      });
    }

    expect(() => normalizeReferenceSearch({ results: items }, 'styles')).toThrow();
    const records: ReferenceRecord[] = normalizeReferenceSearch(
      { results: items.slice(3) },
      'styles',
    );
    expect(records).toHaveLength(10);
    expect(records[0]).toEqual({
      id: 'ok_0',
      kind: 'styles',
      title: 'Title 0',
      url: 'https://refero.design/styles/ok_0',
    });
    expect(records[9].id).toBe('ok_9');
  });

  it('rejects invalid kind values', (): void => {
    expect(() => normalizeReferenceSearch([], 'widgets' as unknown as 'styles')).toThrow(
      DesignError,
    );
  });
});

it('supports actual Refero records envelopes observed13Sep without distributing descriptions/images', () => {
  const styles = normalizeReferenceSearch(
    {
      pagination: { count: 1 },
      records: [
        {
          uuid: '17afb047-92ac-4999-bc91-667c1ea4ccff',
          title: 'Campsite',
          url: 'https://campsite.design',
          description: 'not redistributed',
          preview_url: 'https://images.refero.design/preview.jpg',
        },
      ],
    },
    'styles',
  );
  expect(styles).toEqual([
    {
      id: '17afb047-92ac-4999-bc91-667c1ea4ccff',
      title: 'Campsite',
      url: 'https://campsite.design/',
      kind: 'styles',
    },
  ]);
  const screens = normalizeReferenceSearch(
    {
      records: [
        {
          uuid: '633aa67f-1d1e-4f28-809b-546cce840888',
          page_url: 'https://app.artboard.studio/project/example',
          site: { name: 'Artboard Studio' },
          content: { description: 'not redistributed' },
        },
      ],
    },
    'screens',
  );
  expect(screens[0].title).toBe('Экран 633aa67f-1d1e-4f28-809b-546cce840888');
  expect(screens[0]).not.toHaveProperty('content');
  const flows = normalizeReferenceSearch(
    {
      records: [
        {
          id: 8059,
          name: 'Tokyo travel vlog cover creation',
          refero_url: 'https://refero.design/flows/8059',
          steps: ['not copied'],
        },
      ],
    },
    'flows',
  );
  expect(flows[0]).toEqual({
    id: '8059',
    title: 'Tokyo travel vlog cover creation',
    url: 'https://refero.design/flows/8059',
    kind: 'flows',
  });
});
