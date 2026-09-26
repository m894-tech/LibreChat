import { pluralEn, pluralRu, pluralCategoryRu } from './plural';

const forms = { one: 'сообщение', few: 'сообщения', many: 'сообщений' };

describe('pluralCategoryRu / pluralRu (§9, §10.32)', () => {
  it.each([
    [1, 'сообщение'],
    [2, 'сообщения'],
    [5, 'сообщений'],
    [11, 'сообщений'],
    [21, 'сообщение'],
  ])('§10.32: %d → %s', (count, expected) => {
    expect(pluralRu(count, forms)).toBe(expected);
  });

  it.each([
    [0, 'many'],
    [3, 'few'],
    [4, 'few'],
    [12, 'many'],
    [13, 'many'],
    [14, 'many'],
    [22, 'few'],
    [25, 'many'],
    [101, 'one'],
    [111, 'many'],
    [112, 'many'],
    [114, 'many'],
    [122, 'few'],
  ])('category of %d is %s', (count, category) => {
    expect(pluralCategoryRu(count)).toBe(category);
  });

  it('uses the other form for fractions and falls back to few', () => {
    expect(pluralCategoryRu(1.5)).toBe('other');
    expect(pluralRu(1.5, forms)).toBe('сообщения');
    expect(pluralRu(1.5, { ...forms, other: 'сообщения (дробь)' })).toBe('сообщения (дробь)');
  });

  it('treats negatives by absolute value and non-finite as many', () => {
    expect(pluralRu(-1, forms)).toBe('сообщение');
    expect(pluralRu(Number.NaN, forms)).toBe('сообщений');
  });

  it('pluralEn: one vs other', () => {
    expect(pluralEn(1, { one: 'message', other: 'messages' })).toBe('message');
    expect(pluralEn(14, { one: 'message', other: 'messages' })).toBe('messages');
  });
});
