// Push-related service worker logic (spec 07), kept free of WebWorker types so it is unit-testable with fakes.
// sw.ts wires these to the real ServiceWorkerGlobalScope events.
import { PRODUCT_NAME } from './strings.ts'

/** Must match `SUBSCRIPTION_CHANGED_MESSAGE` in ui/settings-screen.ts (sw.js stays free of UI code). */
export const SUBSCRIPTION_CHANGED_MESSAGE = 'ntk:pushsubscriptionchange'

/** PushPayload v1 (Task 05 contract). */
export interface PushPayloadV1 {
  v: 1
  title: string
  body: string
  tag: string
}

export interface NotificationOptionsLike {
  body?: string
  tag?: string
  icon?: string
  badge?: string
  lang?: string
  dir?: 'rtl' | 'ltr' | 'auto'
}

export interface RegistrationLike {
  showNotification(title: string, options: NotificationOptionsLike): Promise<void>
}

/** `event.data` of a push event; null when the push carried no data. */
export interface PushDataLike {
  json(): unknown
}

/** Parses a v1 payload; anything else (empty, not JSON, wrong shape or version) is null. Never throws. */
export function parsePayload(data: PushDataLike | null | undefined): PushPayloadV1 | null {
  if (!data) return null
  let p: unknown
  try {
    p = data.json()
  } catch {
    return null
  }
  if (typeof p !== 'object' || p === null) return null
  const r = p as Record<string, unknown>
  if (r['v'] !== 1 || typeof r['title'] !== 'string' || typeof r['body'] !== 'string' || typeof r['tag'] !== 'string') return null
  return { v: 1, title: r['title'], body: r['body'], tag: r['tag'] }
}

/**
 * What to display for a push. Never silent (R-06): a malformed payload still shows a title-only notification,
 * and message text is never invented. The title is always the product name; the body is the message as sent
 * (D-003; asserted over data/messages.json in tests/pwa/sw-handlers.test.ts), never decorated here.
 * No requireInteraction, actions, vibration or `silent`: the OS decides how it sounds.
 */
export function notificationFor(data: PushDataLike | null | undefined, iconUrl: string): { title: string; options: NotificationOptionsLike } {
  const base: NotificationOptionsLike = { icon: iconUrl, badge: iconUrl, lang: 'he', dir: 'rtl' }
  const p = parsePayload(data)
  if (!p) return { title: PRODUCT_NAME, options: base }
  const body = p.body.trim()
  return {
    title: PRODUCT_NAME,
    options: {
      ...base,
      // Same-tag notifications replace each other (duplicate protection, P-05).
      ...(p.tag !== '' ? { tag: p.tag } : {}),
      ...(body !== '' ? { body } : {}),
    },
  }
}

export function handlePush(registration: RegistrationLike, data: PushDataLike | null | undefined, iconUrl: string): Promise<void> {
  const n = notificationFor(data, iconUrl)
  return registration.showNotification(n.title, n.options)
}

/** Notification tap: close only. No openWindow / focus / navigate (D-017). */
export function handleNotificationClick(notification: { close(): void }): void {
  notification.close()
}

export interface SubscriptionChangeDeps {
  /** The key the old subscription used (`event.oldSubscription.options.applicationServerKey`), if known. */
  applicationServerKey: ArrayBuffer | null
  subscribe(options: { userVisibleOnly: true; applicationServerKey: ArrayBuffer }): Promise<unknown>
  /** Open pages of this app. */
  clients(): Promise<readonly { postMessage(message: unknown): void }[]>
}

/**
 * `pushsubscriptionchange`: best effort, not guaranteed. Re-subscribe with the same key and ask any open page
 * to send the new subscription; the page holds the session. If no page is open, the next open repairs it
 * (the endpoint hash no longer matches). Never throws.
 */
export async function handleSubscriptionChange(deps: SubscriptionChangeDeps): Promise<void> {
  try {
    if (deps.applicationServerKey) await deps.subscribe({ userVisibleOnly: true, applicationServerKey: deps.applicationServerKey })
  } catch {
    /* the page re-subscribes on next open */
  }
  try {
    for (const c of await deps.clients()) c.postMessage({ type: SUBSCRIPTION_CHANGED_MESSAGE })
  } catch {
    /* no clients */
  }
}
