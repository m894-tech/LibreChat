import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { getPrimaryE2EUser } from '../../setup/users.mock';

/**
 * Proves the #13809 fix end to end: an admin-panel `mcpSettings.allowedDomains`
 * override is honored by MCP inspection/connection without a restart.
 *
 * The YAML allowlist includes `e2e-http`'s origin so Session MCP selection works
 * for the rest of the suite. This spec first installs a restrictive override that
 * drops that origin (server fails reinit), then replaces it with an allow override
 * and asserts reinitialize succeeds — proving the admin override is what the
 * inspection path reads, not a frozen YAML snapshot.
 *
 * Pure-API e2e against the real backend + DB: the JWT comes from the Authorization
 * header (`ExtractJwt.fromAuthHeaderAsBearerToken`), so we log in for a token rather
 * than relying on the browser storage state.
 */

const SERVER_NAME = 'e2e-http';
/** Must match the `e2e-http` URL origin in e2e/config/librechat.e2e.yaml. */
const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.E2E_MCP_HTTP_PORT || '8765'}`;
/** Present in the YAML allowlist but not the fixture origin — used to block 8765. */
const RESTRICTIVE_ORIGIN = 'https://allowed.example.com';

async function reinitialize(
  request: APIRequestContext,
  headers: Record<string, string>,
): Promise<{ status: number; success: boolean }> {
  const res = await request.post(`/api/mcp/${SERVER_NAME}/reinitialize`, { headers });
  if (!res.ok()) {
    return { status: res.status(), success: false };
  }
  const body = (await res.json()) as { success?: boolean };
  return { status: res.status(), success: body.success === true };
}

async function putAllowedDomains(
  request: APIRequestContext,
  headers: Record<string, string>,
  userId: string,
  allowedDomains: string[],
) {
  return request.put(`/api/admin/config/user/${userId}`, {
    headers,
    data: { overrides: { mcpSettings: { allowedDomains } } },
  });
}

test.describe('MCP admin-panel allowlist override', () => {
  test('honors an admin mcpSettings.allowedDomains override so a blocked server reinitializes', async ({
    request,
  }) => {
    test.setTimeout(120000);

    // The seeded primary user is the first-registered user → ADMIN, so it can write
    // config overrides. Log in for a Bearer token + the user id.
    const { email, password } = getPrimaryE2EUser();
    const loginRes = await request.post('/api/auth/login', { data: { email, password } });
    expect(loginRes.ok()).toBeTruthy();
    const { token, user } = (await loginRes.json()) as {
      token: string;
      user: { id?: string; _id?: string };
    };
    const userId = user.id ?? user._id;
    expect(token).toBeTruthy();
    expect(userId).toBeTruthy();

    const headers = { Authorization: `Bearer ${token}` };
    let installed = false;

    /**
     * The override is per-USER and this is the shared primary user, so it must
     * not outlive the test: a restrictive list that omits other fixture origins
     * would poison the shard (`e2e-oauth` fails inspection and agents expecting
     * its tools 503). Cleanup always runs in `finally`.
     */
    try {
      // Restrictive override: drop the fixture origin so reinit fails.
      const block = await putAllowedDomains(request, headers, userId, [RESTRICTIVE_ORIGIN]);
      expect(block.ok()).toBeTruthy();
      installed = true;

      await expect
        .poll(async () => (await reinitialize(request, headers)).success, {
          timeout: 30000,
          intervals: [1000, 2000, 3000],
        })
        .toBe(false);

      // Allowing override: restore the fixture origin; reinit must succeed.
      const allow = await putAllowedDomains(request, headers, userId, [FIXTURE_ORIGIN]);
      expect(allow.ok()).toBeTruthy();

      await expect
        .poll(async () => (await reinitialize(request, headers)).success, {
          timeout: 30000,
          intervals: [1000, 2000, 3000],
        })
        .toBe(true);
    } finally {
      /**
       * Always run, whether or not this attempt installed anything: a leaked
       * override from an earlier interrupted attempt is exactly the state the
       * cleanup exists to remove. A 404 means there was nothing to delete, which
       * is only a failure if this attempt had installed the override — and an
       * assertion here must never mask the error that prevented installing it.
       */
      const del = await request.delete(`/api/admin/config/user/${userId}`, { headers });
      if (installed || del.status() !== 404) {
        expect(del.ok()).toBeTruthy();
      }
      /**
       * Confirm the override document is gone, retrying anything that is not a
       * definitive answer (only 200-without-the-override and 404 are). The cache
       * that gates the next spec — the merged app config that agent tool loading
       * consults per request — is in-memory in these shards and is cleared by the
       * mutation's (asynchronous) invalidation; the downstream victim,
       * `mcp-oauth-resume`, passes with this cleanup in place. `reinitialize` is
       * deliberately NOT used as the "reverted" signal: a server that has already
       * connected keeps re-initializing successfully long after the override is
       * removed (observed for more than 90 seconds in CI, past the 60-second
       * merged-config TTL), because its allow decision is not on the path that
       * poisoned the shard.
       */
      await expect
        .poll(
          async () => {
            const res = await request.get(`/api/admin/config/user/${userId}`, { headers });
            if (res.status() === 404) {
              return 'cleared';
            }
            if (res.status() !== 200) {
              return `retry:${res.status()}`;
            }
            const body = (await res.json()) as {
              config?: { overrides?: { mcpSettings?: { allowedDomains?: string[] } } };
            };
            return body.config?.overrides?.mcpSettings?.allowedDomains == null
              ? 'cleared'
              : 'override still present';
          },
          { timeout: 30000, intervals: [500, 1000, 2000] },
        )
        .toBe('cleared');
    }
  });
});
