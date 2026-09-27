import type { TContextFingerprintInput, TContextStaleReason } from 'librechat-data-provider';

/** FNV-1a 32-bit over UTF-16 code units; a cache key, not a security primitive. */
export function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function sortedUnique(ids: readonly string[] | undefined): string[] {
  if (ids == null || ids.length === 0) {
    return [];
  }
  return Array.from(new Set(ids)).sort();
}

/** Canonical form: sorted id lists, absent optionals collapsed to `null`. */
export function normalizeFingerprintInput(
  input: TContextFingerprintInput,
): TContextFingerprintInput {
  return {
    configuration: {
      endpoint: input.configuration.endpoint ?? undefined,
      provider: input.configuration.provider ?? undefined,
      model: input.configuration.model ?? undefined,
      agentId: input.configuration.agentId ?? null,
      countingMethod: input.configuration.countingMethod ?? undefined,
    },
    window: input.window,
    reserve: input.reserve,
    inputLimit: input.inputLimit,
    instructionsHash: input.instructionsHash,
    toolIds: sortedUnique(input.toolIds),
    skillIds: sortedUnique(input.skillIds),
    assemblySettingsHash: input.assemblySettingsHash,
    branchLeafId: input.branchLeafId,
    historyRevision: input.historyRevision,
    draftHash: input.draftHash,
    attachmentIds: sortedUnique(input.attachmentIds),
    summaryRevision: input.summaryRevision,
  };
}

/** Stable hash of every §7 fingerprint term; equal hashes mean a cached estimate is reusable. */
export function hashFingerprint(input: TContextFingerprintInput): string {
  const normalized = normalizeFingerprintInput(input);
  return hashString(
    JSON.stringify([
      normalized.configuration.endpoint ?? null,
      normalized.configuration.provider ?? null,
      normalized.configuration.model ?? null,
      normalized.configuration.agentId ?? null,
      normalized.configuration.countingMethod ?? null,
      normalized.window,
      normalized.reserve,
      normalized.inputLimit,
      normalized.instructionsHash ?? null,
      normalized.toolIds,
      normalized.skillIds ?? [],
      normalized.assemblySettingsHash ?? null,
      normalized.branchLeafId,
      normalized.historyRevision,
      normalized.draftHash ?? null,
      normalized.attachmentIds,
      normalized.summaryRevision ?? null,
    ]),
  );
}

function sameList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = sortedUnique(a);
  const right = sortedUnique(b);
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

/**
 * The most specific §7 reason the next-request estimate no longer describes
 * the current state, ordered so a model swap wins over the draft that came
 * with it. `null` when the two inputs are equivalent.
 */
export function diffFingerprint(
  previous: TContextFingerprintInput,
  next: TContextFingerprintInput,
): TContextStaleReason | null {
  if (previous.branchLeafId !== next.branchLeafId) {
    return 'branch_changed';
  }
  const prevConfig = previous.configuration;
  const nextConfig = next.configuration;
  if (
    (prevConfig.endpoint ?? null) !== (nextConfig.endpoint ?? null) ||
    (prevConfig.provider ?? null) !== (nextConfig.provider ?? null) ||
    (prevConfig.model ?? null) !== (nextConfig.model ?? null) ||
    (prevConfig.agentId ?? null) !== (nextConfig.agentId ?? null)
  ) {
    return 'model_changed';
  }
  if (
    previous.window !== next.window ||
    previous.reserve !== next.reserve ||
    previous.inputLimit !== next.inputLimit
  ) {
    return 'limits_changed';
  }
  if ((prevConfig.countingMethod ?? null) !== (nextConfig.countingMethod ?? null)) {
    return 'tokenizer_changed';
  }
  if (!sameList(previous.toolIds, next.toolIds) || !sameList(previous.skillIds, next.skillIds)) {
    return 'tools_changed';
  }
  if (
    (previous.instructionsHash ?? null) !== (next.instructionsHash ?? null) ||
    (previous.assemblySettingsHash ?? null) !== (next.assemblySettingsHash ?? null)
  ) {
    return 'instructions_changed';
  }
  if ((previous.summaryRevision ?? null) !== (next.summaryRevision ?? null)) {
    return 'compressed';
  }
  if (previous.historyRevision !== next.historyRevision) {
    return 'history_changed';
  }
  if (!sameList(previous.attachmentIds, next.attachmentIds)) {
    return 'attachments_changed';
  }
  if ((previous.draftHash ?? null) !== (next.draftHash ?? null)) {
    return 'draft_changed';
  }
  return null;
}
