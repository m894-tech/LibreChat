import { createHash } from 'node:crypto';
import type { TContextFingerprintInput } from 'librechat-data-provider';

/** Length of the hex digest kept for fingerprints and sub-hashes. */
const FINGERPRINT_HEX_LENGTH = 32;

/**
 * Deterministic JSON: object keys sorted recursively, `undefined` members
 * dropped, so two structurally equal inputs always hash the same.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const body = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${body.join(',')}}`;
}

/** SHA-256 of the text, truncated; `undefined` for an absent value so the field disappears from the fingerprint. */
export function hashText(text: string | null | undefined): string | undefined {
  if (text == null) {
    return undefined;
  }
  return createHash('sha256').update(text).digest('hex').slice(0, FINGERPRINT_HEX_LENGTH);
}

/** Hash of any JSON-serialisable value through {@link stableStringify}. */
export function hashValue(value: unknown): string {
  return createHash('sha256')
    .update(stableStringify(value))
    .digest('hex')
    .slice(0, FINGERPRINT_HEX_LENGTH);
}

/**
 * §7 next-request fingerprint: every input listed in `TContextFingerprintInput`
 * participates (model, provider, W/R/L, instructions, tools, skills, assembly
 * settings, branch, history, draft, attachments, summary, counting method).
 * Tool and attachment ids are sorted so order of discovery does not matter.
 * The result carries no secrets — only hashes of instruction/draft text.
 */
export function buildContextFingerprint(input: TContextFingerprintInput): string {
  const normalized: TContextFingerprintInput = {
    ...input,
    toolIds: [...input.toolIds].sort(),
    skillIds: input.skillIds == null ? undefined : [...input.skillIds].sort(),
    attachmentIds: [...input.attachmentIds].sort(),
  };
  return hashValue(normalized);
}
