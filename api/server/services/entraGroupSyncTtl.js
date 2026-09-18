/**
 * @param {Date|string|number|null|undefined} lastSyncedAt
 * @param {number} ttlMinutes
 * @param {number} [nowMs]
 * @returns {boolean} true when a Graph re-sync should run
 */
const isEntraGroupSyncDue = (lastSyncedAt, ttlMinutes, nowMs = Date.now()) => {
  if (!(ttlMinutes > 0)) {
    return true;
  }
  if (lastSyncedAt == null || lastSyncedAt === '') {
    return true;
  }
  const lastMs = new Date(lastSyncedAt).getTime();
  if (!Number.isFinite(lastMs)) {
    return true;
  }
  return nowMs - lastMs >= ttlMinutes * 60 * 1000;
};

module.exports = {
  isEntraGroupSyncDue,
};
