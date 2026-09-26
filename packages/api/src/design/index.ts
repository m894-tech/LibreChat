/**
 * Design workspace domain. Storage should import concrete modules:
 *   ./operations  — validateDocument, applyOperations, canonicalHash
 *   ./errors      — DesignError, DesignErrorCodes, isDesignError
 *   ./types       — document/node/batch/context contracts
 *   ./systems     — systemsCatalog, getSystem, isAllowedSystem
 *
 * Do not read actor from operation bodies; pass OperationContext from the server.
 */

export { DesignError, DesignErrorCodes, designError, isDesignError } from './errors';
export type { DesignErrorCode } from './errors';

export {
  DESIGN_LIMITS,
  DOCUMENT_KEYS,
  FONT_STYLES,
  FORBIDDEN_BODY_FIELDS,
  FORBIDDEN_KEYS,
  GEOMETRY_PROP_KEYS,
  NODE_KEYS,
  NODE_PROP_ALLOWLIST,
  NODE_PROP_KEYS,
  NODE_TYPES,
  OPERATION_KEYS,
  OPERATION_TYPES,
  TEXT_ALIGNS,
  BATCH_KEYS,
} from './types';
export type {
  AssetRef,
  CropRect,
  DesignDocument,
  DesignNode,
  DesignOperation,
  DesignPayload,
  DesignRole,
  DesignSystemRef,
  FontStyle,
  NodePropKey,
  NodeProps,
  NodeType,
  OperationBatch,
  OperationContext,
  OperationType,
  TextAlign,
} from './types';

export { applyOperations, canonicalHash, validateDocument } from './operations';

export {
  ALLOWED_FONT_FAMILIES,
  ALLOWED_SYSTEM_IDS,
  DEFAULT_SYSTEM_VERSION,
  DEFAULT_TOKEN_ROLES,
  getSystem,
  isAllowedSystem,
  systemKey,
  systemsCatalog,
  tokenCompatible,
} from './systems';
export type {
  AllowedSystemId,
  BindableProperty,
  DesignSystemPackage,
  DesignToken,
  TokenValueType,
} from './systems';

// R3 native page schema (WP13)
export { applyPageOperations, assertSafePageHref, validatePageDocument } from './page-document';
export type {
  PageDocument,
  PageNode,
  PageNodeProps,
  PageNodeType,
  PageOperation,
  PageOperationContext,
  PageOperationType,
  PageRole,
} from './page-document';
export { convertCanvasToPage, convertPageToCanvas, isHonestRoundTrip } from './page-compat';
export type { CompatibilityAction, CompatibilityLoss, CompatibilityReport } from './page-compat';
