"use strict";
/** Minimal host/MCP helpers for AutomationsCron (pre-meili packPolicy not on fork main). */
const CITYVOLGA_UID = "6a7ac399c1ed664a83dcf2a3";

function hostUserIds() {
  const from = process.env.MCP_HOST_USER_IDS;
  if (from && from.trim()) {
    return from
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [CITYVOLGA_UID];
}

function isMcpHostUser(userId) {
  if (!userId) return false;
  return hostUserIds().includes(String(userId));
}

function filterMcpServersForUser(_userId, servers) {
  return Array.isArray(servers) ? [...servers] : [];
}

function isWriteExecTool(name) {
  return /write|shell|exec|run_terminal|bash/i.test(String(name || ""));
}

module.exports = { isMcpHostUser, filterMcpServersForUser, isWriteExecTool, hostUserIds };
