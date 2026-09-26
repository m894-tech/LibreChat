/**
 * Explicit brand application adapter (snapshot / materialized-literals mode).
 *
 * Validates a brand package via `./brand-package`, then emits `setLiteral`
 * operations that bake role-resolved brand values into unlocked nodes and
 * clear bindings. Does not mutate the global systems catalog and never emits
 * `applySystem` for a brand id (brands are not live catalog entries).
 */

import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
  OperationBatch,
  OperationContext,
} from './types';
import type { SystemResolver } from './system-resolver';
import {
  DEFAULT_TOKEN_ROLES,
  tokenCompatible,
  type BindableProperty,
  type DesignToken,
} from './systems';
import { materializeBrandSystem, validateBrandPackage } from './brand-package';
import { applyOperations, validateDocument } from './operations';
import { DesignError } from './assets';

export const BRAND_APPLY_MODE = 'materialized-literals' as const;

export interface BrandApplyOptions {
  preserveOverrides: boolean;
}

export interface BrandApplyResult {
  brandId: string;
  brandVersion: string;
  baseSystem: { id: string; version: string };
  mode: typeof BRAND_APPLY_MODE;
  operations: DesignOperation[];
}

const TEXT_PROPERTIES: readonly BindableProperty[] = ['fill', 'fontFamily', 'fontSize'];
const SHAPE_PROPERTIES: readonly BindableProperty[] = ['fill', 'stroke'];

function propertiesForNode(node: DesignNode): readonly BindableProperty[] {
  if (node.type === 'text') {
    return TEXT_PROPERTIES;
  }
  if (node.type === 'rect' || node.type === 'ellipse') {
    return SHAPE_PROPERTIES;
  }
  return [];
}

function isAncestorLocked(doc: DesignDocument, nodeId: string): boolean {
  const byId = new Map(doc.payload.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  let cursor = byId.get(nodeId);
  while (cursor) {
    if (seen.has(cursor.id)) {
      throw new DesignError(422, 'VALIDATION', 'node parent cycle detected');
    }
    seen.add(cursor.id);
    if (cursor.locked) {
      return true;
    }
    if (!cursor.parentId) {
      return false;
    }
    cursor = byId.get(cursor.parentId);
  }
  return false;
}

function requireToken(
  tokens: Record<string, DesignToken>,
  role: string,
  property: string,
): DesignToken {
  const token = tokens[role];
  if (!token) {
    throw new DesignError(422, 'VALIDATION', `token role "${role}" is not in materialized brand`);
  }
  if (!tokenCompatible(token, property)) {
    throw new DesignError(422, 'VALIDATION', `token "${role}" cannot bind to "${property}"`);
  }
  return token;
}

function buildSetLiteral(
  nodeId: string,
  property: BindableProperty,
  value: string | number,
): DesignOperation {
  return {
    type: 'setLiteral',
    nodeId,
    property,
    value,
  };
}

/**
 * Build a full brand-application result: metadata + setLiteral operations only.
 * Dry-runs the batch through canonical `applyOperations` with a trusted manual
 * editor context and declaredScope covering every document node.
 */
export function buildBrandApplication(
  doc: DesignDocument,
  brand: unknown,
  options: BrandApplyOptions,
  resolver?: SystemResolver,
): BrandApplyResult {
  if (!options || typeof options.preserveOverrides !== 'boolean') {
    throw new DesignError(422, 'VALIDATION', 'preserveOverrides boolean is required');
  }

  validateDocument(doc, resolver);
  const pkg = validateBrandPackage(brand);
  const materialized = materializeBrandSystem(pkg);
  const preserve = options.preserveOverrides;
  const operations: DesignOperation[] = [];

  for (const node of doc.payload.nodes) {
    if (isAncestorLocked(doc, node.id)) {
      continue;
    }

    const properties = propertiesForNode(node);
    if (properties.length === 0) {
      continue;
    }

    const defaults = DEFAULT_TOKEN_ROLES[node.type] ?? {};

    for (const property of properties) {
      const boundRole = node.bindings[property];
      let role: string | undefined;

      if (typeof boundRole === 'string' && boundRole.length > 0) {
        role = boundRole;
      } else if (!preserve) {
        role = defaults[property];
      } else {
        // preserveOverrides: leave unbound literal properties untouched.
        continue;
      }

      if (!role) {
        continue;
      }

      const token = requireToken(materialized.tokens, role, property);
      operations.push(buildSetLiteral(node.id, property, token.value));
    }
  }

  if (operations.length > 0) {
    const batch: OperationBatch = {
      operationId: `brand-apply:${pkg.id}@${pkg.version}`,
      expectedRevision: doc.revision,
      declaredScope: doc.payload.nodes.map((node) => node.id),
      operations,
    };
    const context: OperationContext = {
      actorId: 'brand-apply-validator',
      role: 'editor',
      agent: false,
    };
    // Validate only — applyOperations never mutates the input document.
    applyOperations(doc, batch, context, resolver);
  }

  return {
    brandId: pkg.id,
    brandVersion: pkg.version,
    baseSystem: {
      id: String(pkg.baseSystemId),
      version: pkg.baseSystemVersion,
    },
    mode: BRAND_APPLY_MODE,
    operations,
  };
}

/**
 * Emit setLiteral operations that materialize brand token values onto unlocked
 * nodes. Caller supplies declaredScope covering all impacted node IDs.
 */
export function buildBrandOperations(
  doc: DesignDocument,
  brand: unknown,
  options: BrandApplyOptions,
): DesignOperation[] {
  return buildBrandApplication(doc, brand, options).operations;
}
