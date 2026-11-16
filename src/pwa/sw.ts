/// <reference lib="webworker" />
// Service worker (specs 06, 07). Built separately as a classic script `sw.js` at the base path root.
// - App-shell precache only (same-origin static files from the build). Supabase and every other
//   origin are never intercepted or cached.
// - Push: payload v1, never silent, title is the product name (sw-handlers.ts).
// - Notification tap: close only. No openWindow / focus / navigate (D-017).
// - pushsubscriptionchange: best-effort re-subscribe and tell open pages; the next open repairs otherwise.
import { handleNotificationClick, handlePush, handleSubscriptionChange } from './sw-handlers.ts'

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

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(self.registration, event.data, scopeUrl('icons/icon-192.png')))
})

self.addEventListener('notificationclick', (event) => {
  handleNotificationClick(event.notification)
})

// Not in the standard WebWorker typings everywhere; `oldSubscription` may be missing (Safari, older Chrome).
interface PushSubscriptionChangeEventLike extends ExtendableEvent {
  readonly oldSubscription?: PushSubscription | null
}

self.addEventListener('pushsubscriptionchange', (event: Event) => {
  const e = event as PushSubscriptionChangeEventLike
  const key = e.oldSubscription?.options.applicationServerKey ?? null
  e.waitUntil(
    handleSubscriptionChange({
      applicationServerKey: key,
      subscribe: (options) => self.registration.pushManager.subscribe(options),
      clients: () => self.clients.matchAll({ type: 'window', includeUncontrolled: true }),
    }),
  )
})
