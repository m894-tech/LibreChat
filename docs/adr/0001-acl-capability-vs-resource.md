# ADR 0001: Capability layer vs resource ACL layer

## Status

Accepted

## Context

LibreChat authorization uses two separate layers. Role feature flags answer whether a user may use a product area at all. Resource ACL entries answer whether that user may perform a specific action on a specific resource instance. These layers must stay distinct so checks remain predictable and auditable.

## Decision

### Capability layer

The capability layer uses `PermissionTypes` and `Permissions` from `packages/data-provider`. Role documents store boolean flags per permission type. Middleware built with `generateCheckAccess` and `checkAccess` in `packages/api` reads the authenticated user's role and returns allow or deny before route handlers run.

This layer gates feature access such as creating agents, using prompts, or running code. It does not consult `AclEntry` documents.

### Resource ACL layer

The resource ACL layer uses `ResourceType` and `PermissionBits` from `packages/data-provider`. `AclEntry` documents bind principals (user, group, role, or public) to a resource id with `permBits`. `PermissionService` and the `aclEntry` methods resolve effective bits for a principal set on a given resource.

This layer gates instance-level actions such as viewing, editing, deleting, or sharing one agent or prompt group.

### Gate order

Protected routes apply gates in this order.

1. **Authentication** — establish `req.user`.
2. **Capability** — `generateCheckAccess` / `checkAccess` when the route is feature-scoped.
3. **Resource ACL** — `canAccessResource` → `PermissionService.checkPermission` when the route targets a specific resource id.

Do not merge the layers into one check. Capability answers "may this user use this feature?" Resource ACL answers "may this user touch this object?"

### Admin bypass inside resource ACL

`canAccessResource` may skip the ACL lookup when the user holds the mapped `SystemCapability` for that `ResourceType`. The mapping lives in `ResourceCapabilityMap` (`packages/data-schemas/src/admin/capabilities.ts`). For example, `MANAGE_AGENTS` bypasses per-agent ACL for users who hold that capability.

This bypass runs inside the resource ACL middleware only after authentication. It is an intentional admin shortcut, not a mix of capability flags into ACL bit resolution. Non-admin users always go through `PermissionService`.

### `inheritedFrom` and project inheritance

The `AclEntry` schema once exposed an optional `inheritedFrom` field and the public DTO carried the same property. No production path ever set it. `grantPermission` does not populate it. Chat projects are not ACL `ResourceType` values, so no cascade existed.

**We will not implement project-level permission inheritance.** The field is removed from the schema, internal types, and public DTO. Existing rows that still store `inheritedFrom` in MongoDB are inert metadata until manually cleaned up.

Future inheritance (for example, permissions flowing from a parent folder or project) requires a new ADR. That design must define grant-on-link, revoke-on-unlink, and effective-permission resolution. It must not reuse a silent optional column.

## Consequences

- Route authors choose capability middleware, resource ACL middleware, or both in gate order. They do not combine layers in one helper.
- Operators rely on `ResourceCapabilityMap` to understand which system capability bypasses instance ACL for admins.
- Frontend and API consumers no longer see `inheritedFrom` on permission entries.
- Any future inheritance work starts with a new ADR rather than reviving the removed field.

## References

- `packages/api/src/middleware/access.ts` — `checkAccess`, `generateCheckAccess`
- `api/server/middleware/accessResources/canAccessResource.js`
- `packages/data-schemas/src/admin/capabilities.ts` — `ResourceCapabilityMap`
- `packages/data-schemas/src/schema/aclEntry.ts`
- `packages/data-provider/src/accessPermissions.ts`
- `docs/ops/tenant-isolation-strict-verify.md` — `TENANT_ISOLATION_STRICT` fail-closed checklist (live monetka/netcup evidence; do not assume strict without Fixit confirm)
