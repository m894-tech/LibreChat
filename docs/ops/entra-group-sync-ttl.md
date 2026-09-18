# Entra group membership sync TTL

## Problem

Entra (Microsoft Graph) group membership was synced only on OpenID login.
Long-lived sessions kept stale group principals, so ACL grants to Entra groups
could lag when users joined or left groups.

## Behavior

- Login (OAuth callback) still calls `syncUserEntraGroupMemberships` immediately.
- After a successful sync, the user document stores `entraGroupLastSyncedAt`.
- `requireJwtAuth` calls `maybeSyncUserEntraGroupMemberships` when an OpenID
  access token is present (session `openidTokens.accessToken` or cookie
  `openid_access_token`).
- If `entraGroupLastSyncedAt` is newer than `ENTRA_GROUP_SYNC_TTL_MINUTES`
  (default **60**), the Graph call is skipped.
- Sync is best-effort: Graph or DB failures are logged and the request continues
  with the last known memberships.

## Operator knobs

```bash
# .env
ENTRA_GROUP_SYNC_TTL_MINUTES=60
USE_ENTRA_ID_FOR_PEOPLE_SEARCH=true   # existing people-search flag; group sync still needs Graph token
ENTRA_ID_INCLUDE_OWNERS_AS_MEMBERS=false
OPENID_GRAPH_SCOPES=User.Read,People.Read,GroupMember.Read.All
```

Requires OpenID token reuse so an access token is available outside the login
callback (`OPENID_REUSE_TOKENS` / session openid tokens as already configured).

## Ops expectation

Membership should revalidate within one TTL window while the user is active.
After a Graph outage, principals stay at the last successful sync until the next
successful refresh. Lower the TTL only if stale ACL from group churn is a real
incident cost; each refresh hits Microsoft Graph.
