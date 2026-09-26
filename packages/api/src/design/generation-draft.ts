/**
 * Pure R1 progressive generation draft validator.
 *
 * Transport: NDJSON. Each complete line is exactly one
 * `{ type: 'insertNode', node: DesignNode }` (optional `parentId` override not used —
 * parent comes from `node.parentId`). Incomplete lines are never parsed or rendered.
 *
 * Validates accepted lines via canonical `applyOperations` against an internal clone.
 * The base document is never mutated. Unknown image assets must already appear in
 * `base.assetRefs` (no fetch). Revision increments apply only to the temporary draft;
 * final persistence must CAS against the original base revision elsewhere.
 *
 * No LLM, network, storage, UI, or code execution.
 */

import type {
  AssetRef,
  DesignDocument,
  DesignNode,
  DesignOperation,
  OperationBatch,
  OperationContext,
} from './types';
import type { SystemResolver } from './system-resolver';
import { applyOperations, validateDocument } from './operations';
import { DesignError, DesignErrorCodes } from './errors';

/** @public Max nodes allowed in the temporary generation draft document. */
export const GENERATION_DRAFT_MAX_NODES: number = 200;
/** @public Max UTF-8 bytes across all appended chunks. */
export const GENERATION_DRAFT_MAX_TOTAL_BYTES: number = 2 * 1024 * 1024;
/** @public Max UTF-8 bytes for one complete NDJSON line. */
export const GENERATION_DRAFT_MAX_LINE_BYTES: number = 64 * 1024;
/** @public Max rejected complete lines before the draft stops accepting input. */
export const GENERATION_DRAFT_MAX_FAILURES: number = 8;

export interface GenerationDraftResult {
  document: DesignDocument;
  accepted: number;
  rejected: number;
}

export interface GenerationDraft {
  append(chunk: string): GenerationDraftResult;
  finish(): GenerationDraftResult;
  snapshot(): GenerationDraftResult;
}

interface InsertNodeLine {
  type: 'insertNode';
  node: DesignNode;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function assetKey(ref: AssetRef): string {
  return `${ref.assetId}@${ref.version}`;
}

function buildBaseAssetKeys(refs: readonly AssetRef[]): Set<string> {
  const keys = new Set<string>();
  for (const ref of refs) {
    keys.add(assetKey(ref));
  }
  return keys;
}

function assertAssetKnownInBase(node: DesignNode, baseAssetKeys: ReadonlySet<string>): void {
  const assetId = node.props.assetId;
  const assetVersion = node.props.assetVersion;
  if (assetId === undefined && assetVersion === undefined) {
    return;
  }
  if (typeof assetId !== 'string' || typeof assetVersion !== 'number') {
    throw new DesignError(
      422,
      DesignErrorCodes.SCHEMA,
      'image assetId/assetVersion must both be present',
    );
  }
  if (!baseAssetKeys.has(`${assetId}@${assetVersion}`)) {
    throw new DesignError(
      422,
      DesignErrorCodes.SCHEMA,
      `unknown asset ref ${assetId}@${assetVersion}; must already exist in base.assetRefs`,
    );
  }
}

function parseInsertNodeLine(line: string): InsertNodeLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    throw new DesignError(422, DesignErrorCodes.SCHEMA, 'NDJSON line is not valid JSON');
  }
  if (!isPlainObject(parsed)) {
    throw new DesignError(422, DesignErrorCodes.SCHEMA, 'NDJSON line must be a JSON object');
  }
  const keys = Object.keys(parsed);
  for (const key of keys) {
    if (key !== 'type' && key !== 'node') {
      throw new DesignError(
        422,
        DesignErrorCodes.SCHEMA,
        `generation line has unknown field "${key}"; only insertNode is allowed`,
      );
    }
  }
  if (parsed.type !== 'insertNode') {
    throw new DesignError(
      422,
      DesignErrorCodes.SCHEMA,
      'generation transport allows only type "insertNode"',
    );
  }
  if (!isPlainObject(parsed.node)) {
    throw new DesignError(422, DesignErrorCodes.SCHEMA, 'insertNode requires node object');
  }
  // Trust structural validation to applyOperations/parseNode; keep a typed view.
  return { type: 'insertNode', node: parsed.node as unknown as DesignNode };
}

function buildServerContext(
  trusted: OperationContext,
  created: ReadonlySet<string>,
): OperationContext {
  return {
    actorId: trusted.actorId,
    role: trusted.role,
    agent: true,
    authorizedNodeIds: [...(trusted.authorizedNodeIds ?? []), ...created],
  };
}

function buildDeclaredScope(draft: DesignDocument, node: DesignNode, agent: boolean): string[] {
  if (node.parentId !== null && node.parentId !== undefined) {
    return [node.parentId];
  }
  if (agent) {
    return draft.payload.nodes.map((item: DesignNode) => item.id);
  }
  return [];
}

function excessiveFailures(rejected: number): never {
  throw new DesignError(
    422,
    DesignErrorCodes.SCHEMA,
    `generation draft exceeded ${GENERATION_DRAFT_MAX_FAILURES} rejected lines`,
  );
}

/**
 * Create a progressive NDJSON generation draft over a validated base document.
 * `base` is cloned internally and never mutated.
 */
export function createGenerationDraft(
  base: DesignDocument,
  context: OperationContext,
  resolver?: SystemResolver,
): GenerationDraft {
  validateDocument(base, resolver);
  const trusted: OperationContext = cloneJson(context);
  const created = new Set<string>();
  const baseSnapshot: DesignDocument = cloneJson(base);
  const baseAssetKeys: Set<string> = buildBaseAssetKeys(baseSnapshot.assetRefs);
  let draft: DesignDocument = cloneJson(baseSnapshot);
  let accepted: number = 0;
  let rejected: number = 0;
  let totalBytes: number = 0;
  let lineBuffer: string = '';
  let finished: boolean = false;
  let stopped: boolean = false;
  let opSeq: number = 0;

  const result = (): GenerationDraftResult => ({
    document: cloneJson(draft),
    accepted,
    rejected,
  });

  const rejectCompleteLine = (): GenerationDraftResult => {
    rejected += 1;
    if (rejected >= GENERATION_DRAFT_MAX_FAILURES) {
      stopped = true;
      excessiveFailures(rejected);
    }
    return result();
  };

  const applyCompleteLine = (line: string): GenerationDraftResult => {
    if (stopped) {
      excessiveFailures(rejected);
    }
    if (utf8Bytes(line) > GENERATION_DRAFT_MAX_LINE_BYTES) {
      return rejectCompleteLine();
    }
    if (draft.payload.nodes.length >= GENERATION_DRAFT_MAX_NODES) {
      return rejectCompleteLine();
    }

    let insert: InsertNodeLine;
    try {
      insert = parseInsertNodeLine(line);
    } catch {
      return rejectCompleteLine();
    }

    try {
      assertAssetKnownInBase(insert.node, baseAssetKeys);
    } catch {
      return rejectCompleteLine();
    }

    const applyContext: OperationContext = buildServerContext(trusted, created);
    const declaredScope: string[] = buildDeclaredScope(draft, insert.node, applyContext.agent);
    opSeq += 1;
    const operation: DesignOperation = {
      type: 'insertNode',
      node: insert.node,
    };
    const batch: OperationBatch = {
      operationId: `gen-draft-${opSeq}`,
      expectedRevision: draft.revision,
      declaredScope,
      operations: [operation],
    };

    try {
      const next: DesignDocument = applyOperations(draft, batch, applyContext, resolver);
      // Defend against applyOperations adding novel asset refs.
      for (const ref of next.assetRefs) {
        if (!baseAssetKeys.has(assetKey(ref))) {
          return rejectCompleteLine();
        }
      }
      if (next.payload.nodes.length > GENERATION_DRAFT_MAX_NODES) {
        return rejectCompleteLine();
      }
      draft = next;
      created.add(insert.node.id);
      accepted += 1;
      return result();
    } catch {
      return rejectCompleteLine();
    }
  };

  const drainBuffer = (flushTerminal: boolean): GenerationDraftResult => {
    let last: GenerationDraftResult = result();
    while (true) {
      const nl: number = lineBuffer.indexOf('\n');
      if (nl < 0) {
        break;
      }
      const line: string = lineBuffer.slice(0, nl);
      lineBuffer = lineBuffer.slice(nl + 1);
      // Empty lines (including those from trailing newline) are ignored.
      if (line.length === 0) {
        continue;
      }
      last = applyCompleteLine(line);
    }
    if (flushTerminal && lineBuffer.trim().length > 0) {
      // Terminal line without trailing newline is still a complete NDJSON block.
      last = applyCompleteLine(lineBuffer.trim());
      lineBuffer = '';
    }
    return last;
  };

  return {
    append(chunk: string): GenerationDraftResult {
      if (finished) {
        throw new DesignError(422, DesignErrorCodes.SCHEMA, 'generation draft already finished');
      }
      if (stopped) {
        excessiveFailures(rejected);
      }
      if (typeof chunk !== 'string') {
        throw new DesignError(422, DesignErrorCodes.SCHEMA, 'chunk must be a string');
      }
      const chunkBytes: number = utf8Bytes(chunk);
      if (totalBytes + chunkBytes > GENERATION_DRAFT_MAX_TOTAL_BYTES) {
        stopped = true;
        throw new DesignError(
          422,
          DesignErrorCodes.SCHEMA,
          `generation draft exceeds ${GENERATION_DRAFT_MAX_TOTAL_BYTES} total bytes`,
        );
      }
      totalBytes += chunkBytes;
      lineBuffer += chunk;
      const output = drainBuffer(false);
      if (utf8Bytes(lineBuffer) > GENERATION_DRAFT_MAX_LINE_BYTES) {
        stopped = true;
        throw new DesignError(422, 'schema', 'Incomplete generation line exceeds limit');
      }
      return output;
    },

    finish(): GenerationDraftResult {
      if (finished) {
        return result();
      }
      if (stopped) {
        excessiveFailures(rejected);
      }
      const last: GenerationDraftResult = drainBuffer(true);
      finished = true;
      return last;
    },

    snapshot(): GenerationDraftResult {
      return result();
    },
  };
}
