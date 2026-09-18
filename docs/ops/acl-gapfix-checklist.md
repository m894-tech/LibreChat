# ACL Architect matrix (SoT: current `main`)

Layers must not mix. CRUD order: **capability → resource ACL**.

1. **capability** — `PermissionTypes` × `Permissions` (USE / CREATE / SHARE / SHARE_PUBLIC …) via `generateCheckAccess`
2. **resource ACL** — `ResourceType` × `PermissionBits` (VIEW=1, EDIT=2, DELETE=4, SHARE=8, VIEW_INSIGHTS=16) via `canAccess*Resource` → `PermissionService` → `AclEntry`

Share API `accessPermissions.js` already knows AGENT, REMOTE_AGENT, PROMPTGROUP, MCP_SERVER, SKILL, CODE_ENVIRONMENT, SHARED_LINK; gate = SHARE bit.

---

## Gold standard: agent (`api/server/routes/agents/v1.js`)

| route intent | capability | ACL middleware | bit |
|---|---|---|---|
| list/use | AGENTS USE | list filtered by ACL | VIEW |
| create | AGENTS CREATE | — | — |
| get basic | USE | `canAccessAgentResource` | VIEW |
| get full / versions | USE | `canAccessAgentResource` | EDIT |
| patch/update | USE | `canAccessAgentResource` | EDIT |
| delete | USE | `canAccessAgentResource` | DELETE |
| share mutate | AGENTS SHARE (+ SHARE_PUBLIC if public) | `accessPermissions` | SHARE |

---

## remoteAgent — 1:1 vs agent

Remote agents are the **API-key invoke plane** (`openai.js` / `responses.js`), not a separate management CRUD router. Management stays on agent v1; create already writes REMOTE_AGENT owner ACE.

| Checklist | Status | Evidence |
|---|---|---|
| `generateCheckAccess(REMOTE_AGENTS, USE/…)` on all entrypoints | **Done** | `checkRemoteAgentsFeature` on openai + responses routers |
| `canAccessResource(REMOTE_AGENT, VIEW\|EDIT\|DELETE)` on get/patch/delete — not only share | **Done for invoke GETs** | `checkAgentPermission` on `GET /models/:model`; `checkResponseAgentPermission` on `GET /responses/:id`; POST chat/completions + POST responses already gated. **N/A:** no remoteAgent PATCH/DELETE management routes on this plane |
| list via `findAccessibleResources(REMOTE_AGENT, VIEW)` | **Done** | `ListModelsController` / responses list path |
| create writes owner `AclEntry` | **Done** | agent v1 create grants `REMOTE_AGENT_OWNER` |
| share path = `ResourceType.REMOTE_AGENT` | **Done** | `accessPermissions.js` |

**Hole closed on main (prior PR):** capability without per-id ACL on `GET /models/:model` and `GET /responses/:id`.

**This PR:** move the response-agent VIEW gate into `createCheckResponseAgentAccess` (`@librechat/api`) and wire `checkResponseAgentPermission` through it so the route file stays thin.

**Explicit N/A (not a hole):** separate remoteAgent management CRUD mirroring agent v1 GET-full / PATCH / DELETE — product model is invoke-plane + agent v1 ownership, not a second CRUD surface.

---

## codeEnvironment — same

| Checklist | Status | Evidence |
|---|---|---|
| CRUD + `canAccessResource(CODE_ENVIRONMENT, VIEW/EDIT/DELETE)` | **Done** | status=VIEW, settings=EDIT, delete=DELETE via `canAccessCodeEnvironmentResource` |
| list ACL-filtered; create → owner ACE | **Done** | list via registry accessible configs; register grants owner ACE under `MANAGE_CODE_ENVIRONMENTS` |
| mutating routes do not bypass SHARE | **Done** | mutate paths use EDIT/DELETE bits; share stays on `accessPermissions` SHARE |
| generic `canAccessResource` ok; hole if route lacks ACL | **Done** | thin `canAccessCodeEnvironmentResource` wrapper |

**Intentionally not agent-CRUD mirrors (listed, not holes):**

- `POST /pairings` — pairing / control-plane policy
- `PATCH /conversations/:conversationId/decision` — conversation ownership + policy

---

## Cross-cutting (also required)

| Item | Status | Where |
|---|---|---|
| ADR: capability ≠ resource ACL + gate order | **Done** | PR #4 `docs/adr/0001-acl-capability-vs-resource.md` |
| `inheritedFrom`: kill / won't-do (no production cascade) | **Done** | PR #4 — removed schema/DTO/tests; ADR won't-do |
| Entra TTL / revalidate outside login | **Done** | this PR — `entraGroupLastSyncedAt` + `maybeSyncUserEntraGroupMemberships` from `requireJwtAuth`; ops `docs/ops/entra-group-sync-ttl.md` |
| `TENANT_ISOLATION_STRICT`: missing ALS+strict → throw; monetka ops | **Done** | code invariant + PR #4 `docs/ops/tenant-isolation-strict-verify.md`; **live Fixit/netcup:** flag `true`, missing ALS → `TENANT_CONTEXT_REQUIRED` |

---

## Out of scope

- `feat/granular-permissions` rebase
- Project inheritance vertical slice
- Relay / mobile session chrome
