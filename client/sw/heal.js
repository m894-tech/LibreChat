/* Runs inside the generated service worker via workbox `importScripts`.
 * CACHE_BUST=sidebar-icons-contrast-20260918
 *
 * When a new build activates, ALWAYS reload every top-level window client.
 * The ping/pong strategy left responsive tabs on an old in-memory router
 * (e.g. missing /automations/new → "No route matches URL"). Force navigate
 * so the next paint loads the new hashed index + route table.
 *
 * Strings MUST stay quoted — bare `window` / `activate` identifiers crash
 * the worker on activate and leave clients stuck on stale bundles.
 */
async function reloadAllWindowClients() {
  await self.clients.claim();
  const windowClients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  const topLevelClients = windowClients.filter((client) => client.frameType !== 'nested');
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

self.addEventListener('activate', (event) => {
  event.waitUntil(reloadAllWindowClients());
});
