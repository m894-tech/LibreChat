/* Runs inside the generated service worker via workbox `importScripts`.
 * CACHE_BUST=2026-09-18-automations-routes-v2
 *
 * When a new build activates, ALWAYS reload every top-level window client.
 * The previous strategy only reloaded clients that failed LC_SW_PING/PONG.
 * Responsive tabs still ran the *old* in-memory router (e.g. missing
 * /automations/new) after Session chrome started navigating there — React
 * Router then threw "No route matches URL". Force navigate so hard-refresh
 * picks up the new hashed index + route table.
 */
async function reloadAllWindowClients() {
  await self.clients.claim();
  const windowClients = await self.clients.matchAll({
    type: window,
    includeUncontrolled: true,
  });
  const topLevelClients = windowClients.filter((client) => client.frameType !== nested);
  await Promise.all(
    topLevelClients.map(async (client) => {
      try {
        await client.navigate(client.url);
      } catch {
        /* client closed or no longer controllable */
      }
    }),
  );
}

self.addEventListener(activate, (event) => {
  event.waitUntil(reloadAllWindowClients());
});
