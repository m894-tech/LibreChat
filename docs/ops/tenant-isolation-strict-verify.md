# TENANT_ISOLATION_STRICT verification checklist

Environment variable name: `TENANT_ISOLATION_STRICT` (string `"true"` enables strict mode).

## Code invariants

- `AclEntry` and other tenant-scoped models call `applyTenantIsolation` when registered (`packages/data-schemas/src/models/aclEntry.ts`).
- Under `TENANT_ISOLATION_STRICT=true`, any Mongoose read or write without an active AsyncLocalStorage tenant context calls `resolveTenantScope`, which throws `TenantIsolationError` instead of returning unscoped (empty-looking) results.
- HTTP layer: `tenantContextMiddleware` (`packages/api/src/middleware/tenant.ts`) returns **403** when an authenticated user has no `tenantId` in strict mode.

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

## Live monetka verification (Fixit / netcup)

Monetka LibreChat runs on the **netcup** host (same fleet as Contour). Live confirmation is owned by **Fixit**; enablement is a **Denis** ops decision. Automated agents stop at this checklist and must not invent credentials.

### Observed state (Fixit, netcup)

| Item | Value |
|---|---|
| Env file | `/opt/librechat-mcp/LibreChat-src/.env` |
| `TENANT_ISOLATION_STRICT` | **missing** → effective **false** (only the string `"true"` enables strict mode) |
| API | `librechat-mcp.service` on `:3080` |
| Missing ALS today | pass-through (non-strict transitional behavior) |
| Fail-closed smoke | **blocked** until the flag is set to `true` and the service restarts |

Do not treat monetka as already strict. Code is fail-closed only when the flag is explicitly `"true"`.

### Enable steps (Denis / Fixit)

1. On netcup, set in `/opt/librechat-mcp/LibreChat-src/.env`:

   ```bash
   TENANT_ISOLATION_STRICT=true
   ```

2. Restart: `systemctl restart librechat-mcp.service`

3. Confirm the process sees the flag (env dump or startup log). Cached policy reads the env once per process.

### Expected fail-closed signals after enable

- **Mongoose / ACL reads without ALS:** `TenantIsolationError` whose message matches  
  `[TenantIsolation] <operation> attempted without tenant context in strict mode`  
  (for example `Query`). Thrown from `resolveTenantScope` in `packages/data-schemas/src/tenant/policy.ts`, invoked by `applyTenantIsolation` on `AclEntry` queries.
- **HTTP, authenticated user without `tenantId`:** **403** with  
  `{ "error": "Tenant context required in strict isolation mode" }`  
  (from `tenantContextMiddleware` in `packages/api/src/middleware/tenant.ts`).

### Post-enable smoke (Fixit evidence for Denis)

1. Repeat sections 4 and 5 against a real tenant-bound user.
2. Confirm missing ALS or missing `tenantId` fails closed (throw / HTTP 403).
3. Confirm ACL reads do not leak across tenants.

Do not invent or commit monetka or netcup credentials in this repo.
