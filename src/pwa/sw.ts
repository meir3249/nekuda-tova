/// <reference lib="webworker" />
// Service worker (spec 06). Built separately as a classic script `sw.js` at the base path root.
// - App-shell precache only (same-origin static files from the build). Supabase and every other
//   origin are never intercepted or cached.
// - Notification tap: close only. No openWindow / focus / navigate (D-017).
// - Push display: minimal here; Task 07 owns the full contract (payload v1, malformed payloads).
import { PRODUCT_NAME } from './strings.ts'

declare const self: ServiceWorkerGlobalScope
/** Injected at build time: precache paths relative to the scope, and a version hash of the build. */
declare const __PRECACHE__: string[]
declare const __CACHE_VERSION__: string

const CACHE_PREFIX = 'ntk-shell-'
const CACHE_NAME = `${CACHE_PREFIX}${__CACHE_VERSION__}`
const scopeUrl = (path: string): string => new URL(path, self.registration.scope).href
const PRECACHE_URLS = new Set(__PRECACHE__.map(scopeUrl))

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll([...PRECACHE_URLS]))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // Supabase and anything else: straight to the network.

  if (req.mode === 'navigate' && url.href.startsWith(self.registration.scope)) {
    // App shell, cache first: the screen renders instantly and offline. A new deploy changes sw.js,
    // which installs a fresh cache; the next open shows the new version.
    event.respondWith(caches.match(scopeUrl('./'), { cacheName: CACHE_NAME }).then((hit) => hit ?? fetch(req)))
    return
  }

  url.search = ''
  url.hash = ''
  if (!PRECACHE_URLS.has(url.href)) return
  event.respondWith(caches.match(url.href, { cacheName: CACHE_NAME }).then((hit) => hit ?? fetch(req)))
})

interface PushPayloadV1 {
  v: 1
  title: string
  body: string
  tag: string
}

function parsePayload(data: PushMessageData | null): PushPayloadV1 | null {
  if (!data) return null
  try {
    const p = data.json() as Partial<PushPayloadV1>
    if (p.v !== 1 || typeof p.title !== 'string' || typeof p.body !== 'string' || typeof p.tag !== 'string') return null
    return p as PushPayloadV1
  } catch {
    return null
  }
}

self.addEventListener('push', (event) => {
  const p = parsePayload(event.data)
  const icon = scopeUrl('icons/icon-192.png')
  // Never silent: a malformed payload still shows a title-only notification. Never invent text.
  event.waitUntil(
    p
      ? self.registration.showNotification(p.title || PRODUCT_NAME, { body: p.body, tag: p.tag, icon, badge: icon, lang: 'he', dir: 'rtl' })
      : self.registration.showNotification(PRODUCT_NAME, { icon, badge: icon, lang: 'he', dir: 'rtl' }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
})
