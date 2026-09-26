/**
 * Domain errors for design documents and operations.
 * Storage/routes map `status` + `code` onto HTTP `{code,message}`.
 */

export const DesignErrorCodes = {
  NOT_FOUND: 'not_found',
  FORBIDDEN: 'forbidden',
  REVISION_MISMATCH: 'revision_mismatch',
  ID_REUSE: 'id_reuse',
  SCHEMA: 'schema',
  SCOPE: 'scope',
  LOCK: 'lock',
  ATOMIC_BATCH: 'atomic_batch',
  CAPABILITY: 'capability',
  QUOTA: 'quota',
} as const;

export type DesignErrorCode = (typeof DesignErrorCodes)[keyof typeof DesignErrorCodes];

/**
 * Typed domain error. `status` is the HTTP status the API layer should emit.
 * Actor identity is never taken from the operation body; callers pass trusted context.
 */
export class DesignError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    statusOrCode: number | string,
    codeOrMessage: string,
    messageOrStatus?: string | number,
  ) {
    const status =
      typeof statusOrCode === 'number'
        ? statusOrCode
        : typeof messageOrStatus === 'number'
          ? messageOrStatus
          : statusForCode(statusOrCode);
    const code =
      typeof statusOrCode === 'string'
        ? statusOrCode === 'validation'
          ? 'schema'
          : statusOrCode
        : codeOrMessage;
    const message =
      typeof statusOrCode === 'number' ? String(messageOrStatus ?? codeOrMessage) : codeOrMessage;
    super(message);
    this.name = 'DesignError';
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, DesignError.prototype);
  }
}

export function isDesignError(error: unknown): error is DesignError {
  return error instanceof DesignError;
}

export function designError(status: number, code: string, message: string): never {
  throw new DesignError(status, code, message);
}

export function statusForCode(code: string): number {
  return (
    (
      {
        not_found: 404,
        unauthorized: 401,
        forbidden: 403,
        revision_mismatch: 409,
        idempotency_key_reuse: 409,
        stale_proposal: 409,
        undo_conflict: 409,
        quota: 429,
        transactions_unavailable: 503,
      } as Record<string, number>
    )[code] ?? 422
  );
}
