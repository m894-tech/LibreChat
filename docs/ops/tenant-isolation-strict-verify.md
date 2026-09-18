# TENANT_ISOLATION_STRICT verification checklist

Environment variable name: `TENANT_ISOLATION_STRICT` (string `"true"` enables strict mode; any other value, including **missing**, is non-strict).

## Code invariants

- `AclEntry` and other tenant-scoped models call `applyTenantIsolation` when registered (`packages/data-schemas/src/models/aclEntry.ts`).
- Under `TENANT_ISOLATION_STRICT=true`, any Mongoose read or write without an active AsyncLocalStorage tenant context calls `resolveTenantScope` (`packages/data-schemas/src/tenant/policy.ts`), which throws `TenantIsolationError` instead of returning unscoped results.
- Exact throw shape from `resolveTenantScope(operation)`:

  ```text
  [TenantIsolation] ${operation} attempted without tenant context in strict mode
  ```

  Example: `[TenantIsolation] Query attempted without tenant context in strict mode`.
- HTTP layer: `tenantContextMiddleware` (`packages/api/src/middleware/tenant.ts`) returns **403** when an authenticated user has no `tenantId` in strict mode, body:

  ```json
  { "error": "Tenant context required in strict isolation mode" }
  ```

## Operator checklist (no production secrets required)

### 1. Enable strict mode locally or in a staging pod

```bash
export TENANT_ISOLATION_STRICT=true
```

Restart the API process so middleware and policy caches pick up the value.

### 2. Confirm policy fail-closed behavior (unit test)

From the repo root:

```bash
cd packages/data-schemas && npx jest src/tenant/policy.spec.ts --testNamePattern="resolveTenantScope"
```

Expect `resolveTenantScope('Query')` to throw `TenantIsolationError` when strict mode is on and no tenant is in ALS.

Alternative Mongoose integration coverage:

```bash
cd packages/data-schemas && npx jest src/models/plugins/tenantIsolation.spec.ts
```

### 3. Confirm HTTP 403 without tenant context (middleware test)

```bash
cd packages/api && npx jest src/middleware/__tests__/tenant.spec.ts --testNamePattern="strict mode"
```

Expect 403 responses when an authenticated user lacks `tenantId` while `TENANT_ISOLATION_STRICT=true`.

### 4. Manual smoke (optional, local dev)

1. Set `TENANT_ISOLATION_STRICT=true`.
2. Authenticate as a user document that has no `tenantId` (or strip `tenantId` in a test fixture).
3. Call any JWT-protected route that runs `tenantContextMiddleware`.
4. Expect HTTP 403 with body `{ "error": "Tenant context required in strict isolation mode" }`.

### 5. Confirm tenant-scoped queries still work

1. Keep strict mode on.
2. Authenticate as a user with a valid `tenantId`.
3. Hit a route that reads ACL or other tenant-isolated data.
4. Expect success and results limited to that tenant (no cross-tenant rows).

## Live monetka (Fixit / netcup) — live=strict

Monetka LibreChat runs on the **netcup** host (same fleet as Contour). Env file: `/opt/librechat-mcp/LibreChat-src/.env`. Service: `librechat-mcp.service` on `:3080`.

### Prior observation (pre-enable) — non-strict

| Item | Value |
|---|---|
| Env file | `/opt/librechat-mcp/LibreChat-src/.env` |
| `TENANT_ISOLATION_STRICT` | was **missing** → effective **false** (only `=== 'true'` enables) |
| Service | `librechat-mcp.service` up on `:3080` |
| Missing ALS | **pass-through** (non-strict) |
| Fail-closed smoke | blocked until Denis approved enable |

That observation alone must not be read as live-strict.

### Enable steps (operator)

Denis approved: set `TENANT_ISOLATION_STRICT=true` and restart on monetka/netcup.

1. Set `TENANT_ISOLATION_STRICT=true` in `/opt/librechat-mcp/LibreChat-src/.env`.
2. `systemctl restart librechat-mcp.service`.
3. Confirm health on `:3080`.
4. Re-check missing-ALS path: expect fail-closed (policy throw / HTTP 403), not pass-through.

Expected policy message after enable (from `resolveTenantScope` in `packages/data-schemas/src/tenant/policy.ts`):

```text
[TenantIsolation] <operation> attempted without tenant context in strict mode
```

Expected HTTP without `tenantId` on an authenticated user:

```json
{ "error": "Tenant context required in strict isolation mode" }
```

### Fixit confirm — live=strict

Fixit applied Denis's approval and verified:

| Item | Value |
|---|---|
| `TENANT_ISOLATION_STRICT` | `true` in `/opt/librechat-mcp/LibreChat-src/.env` |
| Backup | `.env.bak-tenant-strict-20260918T063632Z` |
| Restart | `librechat-mcp.service` — health **200** |
| Missing ALS | **DENIED** (fail-closed; Fixit label `TENANT_CONTEXT_REQUIRED`) |

**live=strict** on monetka/netcup after this Fixit confirm only.

Do not invent or commit monetka or netcup credentials in this repo.
