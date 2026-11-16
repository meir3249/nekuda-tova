import { describe, expect, it } from 'vitest'
import { readEnvInputs, readEnvironment, type EnvWindow } from '../../../src/pwa/env/read-environment.ts'
import { createBrowserPushPlatform, type BrowserPushGlobals, type PushManagerLike, type PushSubscriptionLike } from '../../../src/pwa/push/push-platform.ts'
import { endpointHash, planRenewal, type RenewalInputs } from '../../../src/pwa/push/renewal.ts'
import { serializeSubscription, subscribePush } from '../../../src/pwa/push/subscribe.ts'
import { base64UrlToUint8Array, isValidVapidPublicKey } from '../../../src/pwa/push/vapid.ts'
import { MemoryStore } from '../../../src/pwa/state/local-cache.ts'
import { createSaveQueue } from '../../../src/pwa/state/save-queue.ts'
import { FakePushPlatform, TEST_VAPID_KEY } from '../../fakes/fake-push.ts'

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
const INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0'

function win(opts: { ua: string; platform?: string; touch?: number; standalone?: boolean; displayStandalone?: boolean; push?: boolean; permission?: string }): EnvWindow {
  const nav: Record<string, unknown> = { userAgent: opts.ua, platform: opts.platform ?? '', maxTouchPoints: opts.touch ?? 0 }
  if (opts.standalone !== undefined) nav['standalone'] = opts.standalone
  if (opts.push) nav['serviceWorker'] = {}
  const w: Record<string, unknown> = {
    navigator: nav,
    matchMedia: (q: string) => ({ matches: q === '(display-mode: standalone)' && opts.displayStandalone === true }),
  }
  if (opts.push) {
    w['PushManager'] = function PushManager() {}
    w['Notification'] = { permission: opts.permission ?? 'default' }
  }
  return w as unknown as EnvWindow
}

describe('readEnvironment (fake globals → core detectEnvironment)', () => {
  it.each([
    ['iPhone Safari tab (no push globals)', win({ ua: IPHONE_SAFARI }), 'ios_needs_install'],
    ['iPhone installed (16.4+ exposes push)', win({ ua: IPHONE_SAFARI, standalone: true, push: true }), 'push_ready'],
    ['iPadOS with a desktop UA', win({ ua: IPAD_DESKTOP_UA, platform: 'MacIntel', touch: 5 }), 'ios_needs_install'],
    ['Android Chrome tab', win({ ua: ANDROID_CHROME, push: true }), 'push_ready'],
    ['desktop Safari without push', win({ ua: IPAD_DESKTOP_UA, platform: 'MacIntel', touch: 0 }), 'unsupported'],
    ['Instagram in-app browser on iPhone', win({ ua: INSTAGRAM }), 'unsupported'],
  ])('%s → %s', (_name, w, expected) => {
    expect(readEnvironment(w).state).toBe(expected)
  })

  it('standalone is detected from display-mode or navigator.standalone', () => {
    expect(readEnvInputs(win({ ua: ANDROID_CHROME, displayStandalone: true })).standalone).toBe(true)
    expect(readEnvInputs(win({ ua: IPHONE_SAFARI, standalone: true })).standalone).toBe(true)
    expect(readEnvInputs(win({ ua: IPHONE_SAFARI })).standalone).toBe(false)
  })

  it('reads the permission and treats unknown values as unavailable', () => {
    expect(readEnvironment(win({ ua: ANDROID_CHROME, push: true, permission: 'denied' })).permission).toBe('denied')
    expect(readEnvironment(win({ ua: ANDROID_CHROME, push: true, permission: 'weird' })).permission).toBe('unavailable')
    expect(readEnvironment(win({ ua: IPHONE_SAFARI })).permission).toBe('unavailable')
  })

  it('never throws on hostile globals', () => {
    const w = win({ ua: ANDROID_CHROME, push: true })
    ;(w as unknown as { matchMedia: () => never }).matchMedia = () => {
      throw new Error('nope')
    }
    Object.defineProperty(w, 'Notification', { get: () => ({ get permission(): string { throw new Error('denied access') } }) })
    expect(() => readEnvironment(w)).not.toThrow()
  })
})

describe('VAPID key decoding', () => {
  it('decodes a 65-byte uncompressed key', () => {
    expect(isValidVapidPublicKey(TEST_VAPID_KEY)).toBe(true)
    expect(base64UrlToUint8Array(TEST_VAPID_KEY)[0]).toBe(4)
  })
  it.each(['', 'not base64!', 'AAAA', Buffer.from([3, ...new Array(64).fill(0)]).toString('base64url')])('rejects %j', (k) => {
    expect(isValidVapidPublicKey(k)).toBe(false)
  })
})

describe('subscription serialization', () => {
  it('produces {endpoint, keys:{p256dh, auth}}', () => {
    const p = new FakePushPlatform()
    return p.subscribe(new Uint8Array(new ArrayBuffer(65))).then((s) => {
      const out = serializeSubscription(s)!
      expect(Object.keys(out).sort()).toEqual(['endpoint', 'keys'])
      expect(Object.keys(out.keys).sort()).toEqual(['auth', 'p256dh'])
    })
  })

  it('an incomplete subscription is rejected and unsubscribed', async () => {
    let unsubscribed = false
    const bad: PushSubscriptionLike = { endpoint: 'https://x', toJSON: () => ({ endpoint: 'https://x', keys: {} }), unsubscribe: () => Promise.resolve((unsubscribed = true)) }
    const platform = new FakePushPlatform()
    platform.subscribe = () => Promise.resolve(bad)
    expect(await subscribePush(platform, TEST_VAPID_KEY)).toEqual({ ok: false, reason: 'BAD_SUBSCRIPTION' })
    expect(unsubscribed).toBe(true)
  })
})

describe('browser push platform', () => {
  function globals(opts: { permission?: string; callbackOnly?: boolean; pm?: PushManagerLike; noSw?: boolean } = {}) {
    const calls: string[] = []
    const N = {
      permission: opts.permission ?? 'default',
      requestPermission(cb?: (p: string) => void): Promise<string> | undefined {
        calls.push('requestPermission')
        if (opts.callbackOnly) {
          cb?.('granted')
          return undefined
        }
        return Promise.resolve('granted')
      },
    }
    const pm: PushManagerLike = opts.pm ?? { getSubscription: () => Promise.resolve(null), subscribe: () => Promise.reject(new Error('x')) }
    const g: BrowserPushGlobals = {
      navigator: opts.noSw ? {} : { serviceWorker: { ready: Promise.resolve({ pushManager: pm }) } },
      Notification: N,
      setTimeout: () => 0,
    }
    return { g, calls }
  }

  it('requestPermission calls the browser synchronously (inside the gesture)', () => {
    const { g, calls } = globals()
    const platform = createBrowserPushPlatform(g)
    const p = platform.requestPermission()
    expect(calls).toEqual(['requestPermission']) // before any await
    return expect(p).resolves.toBe('granted')
  })

  it('supports the old callback-only Safari API', async () => {
    const { g } = globals({ callbackOnly: true })
    await expect(createBrowserPushPlatform(g).requestPermission()).resolves.toBe('granted')
  })

  it('subscribe replaces a subscription made with a rotated key, once', async () => {
    let existing: PushSubscriptionLike | null = null
    existing = {
      endpoint: 'old',
      toJSON: () => ({}),
      unsubscribe: () => {
        existing = null
        return Promise.resolve(true)
      },
    }
    let attempts = 0
    const fresh: PushSubscriptionLike = { endpoint: 'new', toJSON: () => ({}), unsubscribe: () => Promise.resolve(true) }
    const pm: PushManagerLike = {
      getSubscription: () => Promise.resolve(existing),
      subscribe: () => (++attempts === 1 ? Promise.reject(new Error('InvalidStateError')) : Promise.resolve(fresh)),
    }
    const { g } = globals({ pm })
    const s = await createBrowserPushPlatform(g).subscribe(new Uint8Array(new ArrayBuffer(65)))
    expect(s.endpoint).toBe('new')
    expect(attempts).toBe(2)
  })

  it('without a service worker, subscribing rejects (no hang)', async () => {
    const { g } = globals({ noSw: true })
    await expect(createBrowserPushPlatform(g).getSubscription()).rejects.toThrow()
  })
})

describe('planRenewal', () => {
  const base: RenewalInputs = {
    serverEnabled: true,
    serverTimezone: 'Asia/Jerusalem',
    deviceTimezone: 'Asia/Jerusalem',
    permission: 'granted',
    localEndpoint: 'https://fcm.googleapis.com/a',
    lastSentHash: endpointHash('https://fcm.googleapis.com/a'),
  }
  it.each<[string, Partial<RenewalInputs>, string]>([
    ['all in order', {}, 'none'],
    ['denied while enabled', { permission: 'denied' }, 'disable'],
    ['permission reset to default while enabled', { permission: 'default' }, 'disable'],
    ['granted, no local subscription', { localEndpoint: null }, 'resubscribe'],
    ['endpoint changed', { localEndpoint: 'https://fcm.googleapis.com/b' }, 'send-subscription'],
    ['no stored hash', { lastSentHash: null }, 'send-subscription'],
    ['timezone changed', { deviceTimezone: 'Europe/Paris' }, 'timezone'],
    ['disabled with a leftover subscription', { serverEnabled: false }, 'drop-local'],
    ['disabled and clean', { serverEnabled: false, localEndpoint: null }, 'none'],
    ['disabled and denied', { serverEnabled: false, localEndpoint: null, permission: 'denied' }, 'none'],
  ])('%s → %s', (_n, patch, kind) => {
    expect(planRenewal({ ...base, ...patch }).kind).toBe(kind)
  })

  it('the endpoint hash is stable and short', () => {
    expect(endpointHash('abc')).toBe(endpointHash('abc'))
    expect(endpointHash('abc')).not.toBe(endpointHash('abd'))
    expect(endpointHash('https://fcm.googleapis.com/fcm/send/xyz')).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('save queue take()', () => {
  it('waits for the request in flight, then hands over and clears the pending change without sending it', async () => {
    const store = new MemoryStore()
    let release: () => void = () => {}
    const sent: unknown[] = []
    const q = createSaveQueue({
      save: (p) => {
        sent.push(p)
        return new Promise((r) => (release = () => r({ ok: true, value: { localTime: '09:00', timezone: 'UTC', enabled: false, nextSendAt: null } })))
      },
      store,
      baseFields: () => ({ localTime: '09:00', timezone: 'UTC' }),
      onOutcome: () => {},
      delayMs: 0,
    })
    q.enqueue({ localTime: '10:00' })
    const first = q.retry()
    q.enqueue({ enabled: false })
    const taken = q.take()
    release()
    await first
    expect(await taken).toEqual({ enabled: false })
    expect(q.hasPending()).toBe(false)
    expect(store.getItem('ntk.pending.v1')).toBeNull()
    expect(sent).toHaveLength(1)
  })
})
