# ACL gap-fix checklist (agent parity)

Gold standard: `api/server/routes/agents/v1.js` — capability
(`PermissionTypes` × `Permissions` via `generateCheckAccess`) then per-id
resource ACL (`canAccessAgentResource` → `PermissionBits`).

Share API (`accessPermissions.js`) already knows AGENT, REMOTE_AGENT,
PROMPTGROUP, MCP_SERVER, SKILL, CODE_ENVIRONMENT, SHARED_LINK (SHARE bit).

## codeEnvironment holes closed

| Route | Capability | ACL middleware |
|---|---|---|
| `GET /api/code-environments` | JWT | list filtered by registry ACL (VIEW) |
| `POST /api/code-environments` | `MANAGE_CODE_ENVIRONMENTS` | owner ACE on register |
| `GET /api/code-environments/:environmentId/status` | JWT | **VIEW** `canAccessCodeEnvironmentResource` |
| `PATCH /api/code-environments/:environmentId/settings` | JWT | **EDIT** `canAccessCodeEnvironmentResource` |
| `DELETE /api/code-environments/:environmentId` | JWT | **DELETE** `canAccessCodeEnvironmentResource` |

Handlers still enforce registry ACL (defense in depth).

### Intentionally not agent-CRUD mirrors

- `POST /pairings` — pairing policy / control-plane flow
- `PATCH /conversations/:conversationId/decision` — conversation ownership + policy

## remoteAgent holes closed

Remote agents are the API-key plane (`openai.js` / `responses.js`), not a
separate CRUD router. Agent create already writes REMOTE_AGENT owner ACE;
share path is `ResourceType.REMOTE_AGENT`.

| Route | Capability | ACL |
|---|---|---|
| Router stack | `REMOTE_AGENTS` USE | — |
| `POST .../chat/completions` | ↑ | `checkAgentPermission` (VIEW) — already |
| `POST .../responses` | ↑ | `checkAgentPermission` — already |
| `POST .../events*` | ↑ | trigger ACL — already |
| `GET .../models` | ↑ | `findAccessibleResources(REMOTE_AGENT, VIEW)` — already |
| `GET .../models/:model` | ↑ | **`checkAgentPermission`** (added) |
| `GET .../responses/:id` | ↑ | **`checkResponseAgentPermission`** (REMOTE_AGENT VIEW on convo agent) |
| `GET .../events/:id` | ↑ | owner delivery status (not a resource CRUD get) |

### N/A vs agent v1 CRUD

No separate remoteAgent GET/PATCH/DELETE management router. Management stays on
agent v1; remote plane is invoke/list.

## Entra TTL

See `docs/ops/entra-group-sync-ttl.md`. Hook: `maybeSyncUserEntraGroupMemberships`
from `requireJwtAuth` when OpenID access token is present and
`entraGroupLastSyncedAt` is stale.
