/**
 * Pure page AI proposal adapter.
 *
 * Normalizes a provider `design_proposal` (object or JSON string) into scoped
 * page operations. Does not call any model API, network, or storage.
 *
 * Uses canonical `parseDesignProposal` from ../dw-librechat-r1 providers.
 * Caller supplies trusted `scopeIds`; provider envelopes cannot grant scope.
 */

import {
  applyPageOperations,
  PAGE_FORBIDDEN_BODY_FIELDS,
  type PageDocument,
  type PageOperation,
} from './page-document';
import { DesignErrorCodes, designError } from './errors';
import { parseDesignProposal } from './providers';

export const PAGE_AI_PROPOSAL_LIMITS = {
  MAX_JSON_BYTES: 64 * 1024,
  MAX_OPS: 50,
  MAX_SUMMARY: 200,
} as const;

export const PAGE_AI_ALLOWED_OPERATION_TYPES = ['setText', 'setProperty'] as const;

export type PageAIAllowedOperationType = (typeof PAGE_AI_ALLOWED_OPERATION_TYPES)[number];

export interface NormalizedPageAIProposal {
  summary: string;
  operations: PageOperation[];
}

const ALLOWED_OP_TYPE_SET = new Set<string>(PAGE_AI_ALLOWED_OPERATION_TYPES);
const FORBIDDEN_BODY_SET = new Set<string>(PAGE_FORBIDDEN_BODY_FIELDS);
const ESCAPE_PROPERTIES = new Set<string>([
  'locked',
  'id',
  'type',
  'parentId',
  'style',
  'html',
  'css',
  'className',
  'innerHTML',
  'dangerouslySetInnerHTML',
  '__proto__',
  'prototype',
  'constructor',
]);

const FALLBACK_SUMMARY = 'Page AI proposal';

function schema(message: string): never {
  designError(422, DesignErrorCodes.SCHEMA, message);
}

function capability(message: string): never {
  designError(422, DesignErrorCodes.CAPABILITY, message);
}

function scope(message: string): never {
  designError(422, DesignErrorCodes.SCOPE, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertJsonSize(value: unknown): void {
  let encoded: string;
  try {
    if (value === undefined) schema('proposal missing');
    encoded = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    schema('proposal is not JSON-serializable');
  }
  if (Buffer.byteLength(encoded, 'utf8') > PAGE_AI_PROPOSAL_LIMITS.MAX_JSON_BYTES) {
    schema(`proposal JSON exceeds ${PAGE_AI_PROPOSAL_LIMITS.MAX_JSON_BYTES} bytes`);
  }
}

function rejectPrivilegedEnvelopeFields(value: unknown, label: string): void {
  if (!isPlainObject(value)) {
    return;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_BODY_SET.has(key)) {
      schema(`${label} cannot include privileged field "${key}"`);
    }
  }
}

function buildSummary(title: string | undefined, notes: string | undefined): string {
  const fromTitle = typeof title === 'string' ? title.trim() : '';
  if (fromTitle.length > 0) {
    return fromTitle.slice(0, PAGE_AI_PROPOSAL_LIMITS.MAX_SUMMARY);
  }
  const fromNotes = typeof notes === 'string' ? notes.trim() : '';
  if (fromNotes.length > 0) {
    return fromNotes.slice(0, PAGE_AI_PROPOSAL_LIMITS.MAX_SUMMARY);
  }
  return FALLBACK_SUMMARY;
}

function cloneOperation(op: PageOperation): PageOperation {
  const next: PageOperation = { type: op.type };
  if (op.nodeId !== undefined) {
    next.nodeId = op.nodeId;
  }
  if (op.property !== undefined) {
    next.property = op.property;
  }
  if (op.value !== undefined) {
    next.value = op.value;
  }
  return next;
}

function toPageOperations(
  page: PageDocument,
  scopeIds: readonly string[],
  rawOps: ReadonlyArray<{
    type: string;
    nodeId?: string;
    property?: string;
    value?: unknown;
    parentId?: string | null;
    node?: Record<string, unknown>;
  }>,
): PageOperation[] {
  if (rawOps.length === 0) {
    schema('operations must not be empty');
  }
  if (rawOps.length > PAGE_AI_PROPOSAL_LIMITS.MAX_OPS) {
    schema(`operations exceed limit of ${PAGE_AI_PROPOSAL_LIMITS.MAX_OPS}`);
  }

  const scopeSet = new Set(scopeIds);
  const nodeIds = new Set(page.nodes.map((node) => node.id));
  const operations: PageOperation[] = [];

  for (let index = 0; index < rawOps.length; index += 1) {
    const op = rawOps[index];
    if (!ALLOWED_OP_TYPE_SET.has(op.type)) {
      capability(`page AI proposals forbid "${op.type}"; only setText/setProperty are allowed`);
    }
    if (typeof op.nodeId !== 'string' || op.nodeId.length === 0) {
      schema(`operations[${index}] requires nodeId`);
    }
    if (op.parentId !== undefined || op.node !== undefined) {
      capability('page AI proposals cannot insert, remove, or regroup nodes');
    }
    if (!nodeIds.has(op.nodeId)) {
      schema(`operations[${index}] node "${op.nodeId}" does not exist`);
    }
    if (!scopeSet.has(op.nodeId)) {
      scope(`node "${op.nodeId}" is outside the trusted scope`);
    }

    if (op.type === 'setText') {
      if (op.property !== undefined) {
        schema(`operations[${index}] setText must not include property`);
      }
      operations.push({
        type: 'setText',
        nodeId: op.nodeId,
        value: op.value as PageOperation['value'],
      });
      continue;
    }

    if (typeof op.property !== 'string' || op.property.length === 0) {
      schema(`operations[${index}] setProperty requires property`);
    }
    if (ESCAPE_PROPERTIES.has(op.property)) {
      schema(`property "${op.property}" cannot be set through setProperty`);
    }
    operations.push({
      type: 'setProperty',
      nodeId: op.nodeId,
      property: op.property,
      value: op.value as PageOperation['value'],
    });
  }

  return operations;
}

/**
 * Normalize a provider design_proposal into page operations under a trusted scope.
 *
 * Validates the entire proposal atomically via `applyPageOperations` with
 * `agent: true` and `authorizedNodeIds = scopeIds`. Returns cloned operations;
 * never mutates `page` or `value`. On any failure, throws without side effects.
 */
export function normalizePageAIProposal(
  page: PageDocument,
  scopeIds: readonly string[],
  value: unknown,
): NormalizedPageAIProposal {
  assertJsonSize(value);

  if (typeof value !== 'string') {
    rejectPrivilegedEnvelopeFields(value, 'proposal');
  }

  const proposal = parseDesignProposal(value);
  rejectPrivilegedEnvelopeFields(proposal, 'proposal');

  const operations = toPageOperations(page, scopeIds, proposal.operations);
  const summary = buildSummary(proposal.title, proposal.notes);

  // Atomic dry-run: grant ceiling is the caller-provided scope only.
  applyPageOperations(page, operations, {
    actorId: 'page-ai-adapter',
    role: 'editor',
    agent: true,
    scopeIds: [...scopeIds],
    authorizedNodeIds: [...scopeIds],
  });

  return {
    summary,
    operations: operations.map(cloneOperation),
  };
}
