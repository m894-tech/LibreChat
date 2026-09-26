import {
  DATA_BLOCK_LIMITS,
  validateDataBlock,
  type BarChartData,
  type TableData,
} from '../page-data-blocks';
import { DesignError, DesignErrorCodes } from '../errors';

function expectSchema(fn: () => unknown, messageIncludes?: string): void {
  try {
    fn();
    throw new Error('expected DesignError');
  } catch (error) {
    expect(error).toBeInstanceOf(DesignError);
    const err = error as DesignError;
    expect(err.status).toBe(422);
    expect(err.code).toBe(DesignErrorCodes.SCHEMA);
    if (messageIncludes !== undefined) {
      expect(err.message).toContain(messageIncludes);
    }
  }
}

const validTable = (): TableData => ({
  kind: 'table',
  source: 'example',
  caption: 'Sales',
  columns: ['Region', 'Amount'],
  rows: [
    ['North', 10],
    ['South', null],
  ],
});

const validBar = (): BarChartData => ({
  kind: 'bar-chart',
  source: 'provided',
  caption: 'Revenue',
  labels: ['Q1', 'Q2'],
  values: [100, 200],
});

describe('validateDataBlock', () => {
  it('accepts and clones a canonical table block', () => {
    const input = validTable();
    const result = validateDataBlock(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    if (result.kind !== 'table') {
      throw new Error('expected table');
    }
    expect(result.columns).not.toBe(input.columns);
    expect(result.rows).not.toBe(input.rows);
    expect(result.rows[0]).not.toBe(input.rows[0]);
  });

  it('accepts and clones a canonical bar-chart block', () => {
    const input = validBar();
    const result = validateDataBlock(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    if (result.kind !== 'bar-chart') {
      throw new Error('expected bar-chart');
    }
    expect(result.labels).not.toBe(input.labels);
    expect(result.values).not.toBe(input.values);
  });

  it('rejects missing source', () => {
    const { source: _omit, ...rest } = validTable();
    expectSchema(() => validateDataBlock(rest), 'source');
  });

  it('rejects invalid source values', () => {
    expectSchema(() => validateDataBlock({ ...validTable(), source: 'live' }), 'source');
  });

  it('rejects row / column dimension mismatch', () => {
    expectSchema(
      () =>
        validateDataBlock({
          ...validTable(),
          rows: [['only-one']],
        }),
      'does not match columns',
    );
  });

  it('rejects labels / values dimension mismatch', () => {
    expectSchema(
      () =>
        validateDataBlock({
          ...validBar(),
          values: [1],
        }),
      'does not match labels',
    );
  });

  it('rejects NaN and non-finite values', () => {
    expectSchema(
      () =>
        validateDataBlock({
          ...validBar(),
          values: [1, Number.NaN],
        }),
      'finite',
    );
    expectSchema(
      () =>
        validateDataBlock({
          ...validTable(),
          rows: [['North', Number.POSITIVE_INFINITY]],
        }),
      'finite',
    );
  });

  it('rejects absolute values above 1e12', () => {
    expectSchema(
      () =>
        validateDataBlock({
          ...validBar(),
          values: [1e12 + 1, 2],
        }),
      'absolute value',
    );
  });

  it('rejects unknown fields', () => {
    expectSchema(
      () =>
        validateDataBlock({
          ...validTable(),
          extra: true,
        } as unknown),
      'unknown field',
    );
  });

  it('rejects prototype pollution keys', () => {
    const polluted = JSON.parse(
      '{"kind":"table","source":"example","caption":"x","columns":["a"],"rows":[["1"]],"__proto__":{"polluted":true}}',
    );
    expectSchema(() => validateDataBlock(polluted), 'forbidden key');

    const withConstructor = {
      ...validBar(),
      constructor: 'nope',
    };
    expectSchema(() => validateDataBlock(withConstructor), 'forbidden key');
  });

  it('does not mutate the input object', () => {
    const input = validTable();
    const snapshot = JSON.stringify(input);
    validateDataBlock(input);
    expect(JSON.stringify(input)).toBe(snapshot);

    const mutated = validateDataBlock(input) as TableData;
    mutated.caption = 'CHANGED';
    mutated.columns.push('X');
    mutated.rows[0][0] = 'CHANGED';
    expect(input.caption).toBe('Sales');
    expect(input.columns).toEqual(['Region', 'Amount']);
    expect(input.rows[0][0]).toBe('North');
  });

  it('rejects nested objects in cells and oversize caps', () => {
    expectSchema(
      () =>
        validateDataBlock({
          ...validTable(),
          rows: [[{ nested: true } as unknown as string, 1]],
        }),
      'string, number, or null',
    );

    const tooManyCols = {
      kind: 'table',
      source: 'example',
      caption: 'c',
      columns: Array.from({ length: DATA_BLOCK_LIMITS.MAX_COLUMNS + 1 }, (_, i) => `c${i}`),
      rows: [],
    };
    expectSchema(() => validateDataBlock(tooManyCols), 'columns exceed');

    const tooManyLabels = {
      kind: 'bar-chart',
      source: 'example',
      caption: 'c',
      labels: Array.from({ length: DATA_BLOCK_LIMITS.MAX_LABELS + 1 }, (_, i) => `l${i}`),
      values: Array.from({ length: DATA_BLOCK_LIMITS.MAX_LABELS + 1 }, () => 1),
    };
    expectSchema(() => validateDataBlock(tooManyLabels), 'labels exceed');
  });

  it('rejects oversize JSON payloads', () => {
    const hugeCaption = 'x'.repeat(DATA_BLOCK_LIMITS.MAX_TEXT);
    const columns = Array.from({ length: DATA_BLOCK_LIMITS.MAX_COLUMNS }, (_, i) => `c${i}`);
    const rows = Array.from({ length: DATA_BLOCK_LIMITS.MAX_ROWS }, () =>
      columns.map(() => hugeCaption),
    );
    const oversized = {
      kind: 'table',
      source: 'provided',
      caption: hugeCaption,
      columns,
      rows,
    };
    expectSchema(() => validateDataBlock(oversized), 'JSON exceeds');
  });

  it('documents that provided means user-provided not live-verified', () => {
    const result = validateDataBlock({
      ...validBar(),
      source: 'provided',
    });
    expect(result.source).toBe('provided');
  });
});
