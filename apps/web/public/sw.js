// Minimal PWA service worker for ZenNotes Web.
//
// HTML is network-first so an upgrade never boots yesterday's chunk graph.
// Cached shell/assets still allow offline reads; API responses stay uncached.
// Paths are relative to the registration scope for reverse-proxy deployments.

const CACHE_NAME = 'zennotes-shell-v4'
const SCOPE_PATH = new URL(self.registration.scope).pathname
const APP_SHELL = [
  SCOPE_PATH,
  SCOPE_PATH + 'index.html',
  SCOPE_PATH + 'manifest.webmanifest',
  SCOPE_PATH + 'favicon-32.png',
  SCOPE_PATH + 'icon-192.png',
  SCOPE_PATH + 'icon-512.png'
]
const API_PREFIX = SCOPE_PATH + 'api/'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // Keep the old worker/cache if the replacement shell cannot be fetched.
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    const legacy = keys.includes('zennotes-shell-v3')
    await Promise.all(keys.filter((k) => k.startsWith('zennotes-shell-') && k !== CACHE_NAME)
      .map((k) => caches.delete(k)))
    await self.clients.claim()
    // A legacy client may already be blank: its cached JS URL can contain the
    // server's HTML fallback, so no application update listener can run there.
    // Recover it once during migration; ordinary build upgrades need no reload
    // from the worker because each navigation now gets fresh HTML.
    if (legacy) {
      const clients = await self.clients.matchAll({ type: 'window' })
      await Promise.all(clients.map((client) => client.navigate(client.url).catch(() => {})))
    }
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith(API_PREFIX)) return

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME)
      try {
        const res = await fetch(req, { cache: 'no-cache' })
        if (!res.ok) throw new Error('Shell unavailable')
        // One canonical shell also supports offline navigation to SPA routes.
        try { await cache.put(SCOPE_PATH + 'index.html', res.clone()) } catch {}
        return res
      } catch {
        return (await cache.match(SCOPE_PATH + 'index.html')) || Response.error()
      }
    })())
    return
  }

  // Assets remain cache-first with a lifetime-bound background refresh. Never
  // poison a missing chunk's URL with the server's 200 text/html SPA fallback.
  const network = (async () => {
    const res = await fetch(req)
    if (res.status === 200 && res.type === 'basic' &&
        !res.headers.get('Content-Type')?.toLowerCase().includes('text/html')) {
      try {
        const cache = await caches.open(CACHE_NAME)
        await cache.put(req, res.clone())
      } catch {}
    }
    return res
  })()
  event.waitUntil(network.catch(() => {}))
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    return (await cache.match(req)) || network.catch(() => Response.error())
  })())
})
