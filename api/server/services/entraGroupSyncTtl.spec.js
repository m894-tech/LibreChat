const { isEntraGroupSyncDue } = require('./entraGroupSyncTtl');

describe('isEntraGroupSyncDue', () => {
  const now = Date.parse('2026-09-18T12:00:00.000Z');

  it('is due when never stamped', () => {
    expect(isEntraGroupSyncDue(undefined, 60, now)).toBe(true);
    expect(isEntraGroupSyncDue(null, 60, now)).toBe(true);
  });

  it('is not due when within TTL', () => {
    expect(isEntraGroupSyncDue(new Date(now - 10 * 60 * 1000), 60, now)).toBe(false);
  });

  it('is due when older than TTL', () => {
    expect(isEntraGroupSyncDue(new Date(now - 2 * 60 * 60 * 1000), 60, now)).toBe(true);
  });
});
