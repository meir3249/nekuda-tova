import type { PermissionState } from '../../core/index.ts'

/** The part of a browser `PushSubscription` we use. */
export interface PushSubscriptionLike {
  readonly endpoint: string
  toJSON(): { endpoint?: string; keys?: Record<string, string> }
  unsubscribe(): Promise<boolean>
}

/**
 * Browser push capabilities behind a small interface, so the flows are testable with fakes.
 * `requestPermission` must be called synchronously inside a user-gesture handler (iOS requires it).
 */
export interface PushPlatform {
  permission(): PermissionState
  requestPermission(): Promise<PermissionState>
  getSubscription(): Promise<PushSubscriptionLike | null>
  subscribe(applicationServerKey: Uint8Array<ArrayBuffer>): Promise<PushSubscriptionLike>
}

/** Waiting for the service worker longer than this means it is not coming (e.g. the dev server has none). */
export const SERVICE_WORKER_READY_TIMEOUT_MS = 10_000

export interface BrowserPushGlobals {
  navigator: { serviceWorker?: { ready: Promise<{ pushManager: PushManagerLike }> } }
  Notification?: {
    permission: string
    requestPermission(callback?: (p: string) => void): Promise<string> | undefined
  }
  setTimeout(fn: () => void, ms: number): unknown
}

export interface PushManagerLike {
  getSubscription(): Promise<PushSubscriptionLike | null>
  subscribe(options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<PushSubscriptionLike>
}

const asPermission = (p: string | undefined): PermissionState =>
  p === 'granted' || p === 'denied' || p === 'default' ? p : 'unavailable'

export function createBrowserPushPlatform(g: BrowserPushGlobals): PushPlatform {
  const ready = (): Promise<PushManagerLike> => {
    const sw = g.navigator.serviceWorker
    if (!sw) return Promise.reject(new Error('No service worker support'))
    return new Promise((resolve, reject) => {
      g.setTimeout(() => reject(new Error('Service worker not ready')), SERVICE_WORKER_READY_TIMEOUT_MS)
      sw.ready.then((r) => resolve(r.pushManager), reject)
    })
  }

  return {
    permission: () => asPermission(g.Notification?.permission),

    requestPermission() {
      const N = g.Notification
      if (!N) return Promise.resolve('unavailable')
      // Runs synchronously (Promise executor), so the call stays inside the gesture. Older Safari uses the callback form.
      return new Promise<PermissionState>((resolve) => {
        try {
          const maybe = N.requestPermission((p) => resolve(asPermission(p)))
          if (maybe && typeof maybe.then === 'function') maybe.then((p) => resolve(asPermission(p)), () => resolve(asPermission(N.permission)))
        } catch {
          resolve(asPermission(N.permission))
        }
      })
    },

    async getSubscription() {
      return (await ready()).getSubscription()
    },

    async subscribe(applicationServerKey) {
      const pm = await ready()
      try {
        return await pm.subscribe({ userVisibleOnly: true, applicationServerKey })
      } catch (e) {
        // A subscription made with a different (rotated) VAPID key blocks a new one: replace it once.
        const existing = await pm.getSubscription()
        if (!existing) throw e
        await existing.unsubscribe()
        return pm.subscribe({ userVisibleOnly: true, applicationServerKey })
      }
    },
  }
}
