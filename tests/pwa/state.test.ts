import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicSettings, SettingsApiResult, SettingsPatchInput } from '../../src/pwa/api/settings-api.ts'
import {
  DEFAULT_TIME,
  MemoryStore,
  PENDING_KEY,
  SETTINGS_KEY,
  pickStore,
  readPending,
  readSettings,
  writePending,
  writeSettings,
  type KeyValueStore,
} from '../../src/pwa/state/local-cache.ts'
import { createSaveQueue, isRetryable, type SaveOutcome } from '../../src/pwa/state/save-queue.ts'

const TZ = 'Asia/Jerusalem'

describe('local cache', () => {
  it('returns defaults when nothing is cached (09:00, off, device timezone)', () => {
    expect(readSettings(new MemoryStore(), TZ)).toEqual({ localTime: DEFAULT_TIME, timezone: TZ, enabled: false })
  })

  it('round-trips settings', () => {
    const s = new MemoryStore()
    writeSettings(s, { localTime: '21:30', timezone: 'Europe/Paris', enabled: true })
    expect(readSettings(s, TZ)).toEqual({ localTime: '21:30', timezone: 'Europe/Paris', enabled: true })
  })

  it.each([
    ['invalid JSON', '{not json'],
    ['an array', '[1,2]'],
    ['null', 'null'],
    ['wrong types', JSON.stringify({ localTime: 9, timezone: [], enabled: 'yes' })],
    ['an invalid slot', JSON.stringify({ localTime: '09:15', timezone: TZ, enabled: true })],
  ])('tolerates %s: invalid fields fall back to defaults', (_n, raw) => {
    const s = new MemoryStore()
    s.setItem(SETTINGS_KEY, raw)
    const r = readSettings(s, TZ)
    expect(r.localTime).toBe(DEFAULT_TIME)
    expect(r.timezone).toBe(TZ)
  })

  it('a store that throws on every call degrades to defaults and never throws', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    expect(readSettings(broken, TZ).localTime).toBe(DEFAULT_TIME)
    expect(() => writeSettings(broken, { localTime: '10:00', timezone: TZ, enabled: false })).not.toThrow()
    expect(() => writePending(broken, { localTime: '10:00' })).not.toThrow()
    expect(() => writePending(broken, null)).not.toThrow()
    expect(readPending(broken)).toBeNull()
  })

  it('pickStore falls back to memory when localStorage is missing or throws', () => {
    expect(pickStore(() => undefined)).toBeInstanceOf(MemoryStore)
    expect(
      pickStore(() => {
        throw new Error('SecurityError')
      }),
    ).toBeInstanceOf(MemoryStore)
    const quota: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded')
      },
      removeItem: () => {},
    }
    expect(pickStore(() => quota)).toBeInstanceOf(MemoryStore)
    const working = new MemoryStore()
    expect(pickStore(() => working)).toBe(working)
  })

  it('pending: keeps only known valid fields and never persists a push subscription', () => {
    const s = new MemoryStore()
    writePending(s, {
      localTime: '07:00',
      enabled: false,
      pushSubscription: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } },
    })
    expect(s.getItem(PENDING_KEY)).not.toContain('fcm.googleapis.com')
    expect(readPending(s)).toEqual({ localTime: '07:00', enabled: false })
    s.setItem(PENDING_KEY, JSON.stringify({ localTime: '07:10', evil: 1 }))
    expect(readPending(s)).toBeNull()
    writePending(s, null)
    expect(s.getItem(PENDING_KEY)).toBeNull()
  })
})

// ---- save queue ----

type Save = (patch: SettingsPatchInput) => Promise<SettingsApiResult<PublicSettings>>
const okResult = (patch: SettingsPatchInput): SettingsApiResult<PublicSettings> => ({
  ok: true,
  value: { localTime: patch.localTime ?? '09:00', timezone: patch.timezone ?? TZ, enabled: patch.enabled ?? false, nextSendAt: null },
})

function queueWith(save: Save, store: KeyValueStore = new MemoryStore()) {
  const calls: SettingsPatchInput[] = []
  const outcomes: SaveOutcome[] = []
  let base = { localTime: '09:00', timezone: TZ }
  const queue = createSaveQueue({
    save: (p) => {
      calls.push(p)
      return save(p)
    },
    store,
    baseFields: () => base,
    onOutcome: (o) => outcomes.push(o),
  })
  return { queue, calls, outcomes, store, setBase: (b: typeof base) => (base = b) }
}

describe('save queue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces 400 ms and coalesces several changes into one request with time and timezone', async () => {
    const h = queueWith((p) => Promise.resolve(okResult(p)))
    h.setBase({ localTime: '10:30', timezone: TZ })
    h.queue.enqueue({ localTime: '10:00' })
    await vi.advanceTimersByTimeAsync(200)
    h.queue.enqueue({ localTime: '10:30' })
    await vi.advanceTimersByTimeAsync(399)
    expect(h.calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.calls).toEqual([{ localTime: '10:30', timezone: TZ }])
    expect(h.outcomes).toEqual([expect.objectContaining({ kind: 'saved' })])
    expect(h.queue.hasPending()).toBe(false)
    expect(h.store.getItem(PENDING_KEY)).toBeNull()
  })

  it('persists the pending change immediately, before the debounce fires', () => {
    const h = queueWith((p) => Promise.resolve(okResult(p)))
    h.queue.enqueue({ localTime: '06:30' })
    expect(readPending(h.store)).toEqual({ localTime: '06:30' })
  })

  it('a transient failure keeps the patch (in memory and storage) and retry() sends it', async () => {
    let online = false
    const h = queueWith((p) => Promise.resolve(online ? okResult(p) : { ok: false, code: 'NETWORK', message: 'x' }))
    h.queue.enqueue({ localTime: '08:00' })
    await vi.advanceTimersByTimeAsync(400)
    expect(h.outcomes).toEqual([{ kind: 'failed', code: 'NETWORK' }])
    expect(h.queue.hasPending()).toBe(true)
    expect(readPending(h.store)).toEqual({ localTime: '08:00' })

    online = true
    await h.queue.retry()
    expect(h.calls).toHaveLength(2)
    expect(h.outcomes.at(-1)).toMatchObject({ kind: 'saved' })
    expect(readPending(h.store)).toBeNull()
  })

  it('a save that throws is treated as a transient failure', async () => {
    const h = queueWith(() => Promise.reject(new Error('boom')))
    h.queue.enqueue({ localTime: '08:00' })
    await vi.advanceTimersByTimeAsync(400)
    expect(h.outcomes).toEqual([{ kind: 'failed', code: 'NETWORK' }])
    expect(h.queue.hasPending()).toBe(true)
  })

  it('a rejected change (bad request, capacity) is dropped, not retried forever', async () => {
    const h = queueWith(() => Promise.resolve({ ok: false, code: 'CAPACITY_REACHED', message: 'full' }))
    h.queue.enqueue({ localTime: '08:00' })
    await vi.advanceTimersByTimeAsync(400)
    expect(h.outcomes).toEqual([{ kind: 'rejected', code: 'CAPACITY_REACHED' }])
    expect(h.queue.hasPending()).toBe(false)
    expect(readPending(h.store)).toBeNull()
  })

  it('a change made while a request is in flight is sent afterwards, and not lost', async () => {
    let release: (() => void) | null = null
    const h = queueWith(
      (p) =>
        new Promise((resolve) => {
          release = () => resolve(okResult(p))
        }),
    )
    h.queue.enqueue({ localTime: '08:00' })
    await vi.advanceTimersByTimeAsync(400)
    expect(h.calls).toHaveLength(1)

    h.queue.enqueue({ localTime: '08:30' })
    await vi.advanceTimersByTimeAsync(400) // debounce fires while the first request is still open
    expect(h.calls).toHaveLength(1)
    expect(readPending(h.store)).toEqual({ localTime: '08:30' })

    release!()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.calls).toHaveLength(2)
    expect(h.calls[1]).toMatchObject({ localTime: '08:30' })
    release!()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.queue.hasPending()).toBe(false)
  })

  it('a newer change made during a failing request wins over the failed snapshot', async () => {
    let fail: (() => void) | null = null
    const h = queueWith(
      () =>
        new Promise((resolve) => {
          fail = () => resolve({ ok: false, code: 'HTTP_503', message: 'x' })
        }),
    )
    h.queue.enqueue({ localTime: '08:00', enabled: false })
    await vi.advanceTimersByTimeAsync(400)
    h.queue.enqueue({ localTime: '11:00' })
    fail!()
    await vi.advanceTimersByTimeAsync(0)
    expect(readPending(h.store)).toEqual({ localTime: '11:00', enabled: false })
  })

  it('picks up a pending change left by a previous visit', async () => {
    const store = new MemoryStore()
    writePending(store, { localTime: '05:30' })
    const h = queueWith((p) => Promise.resolve(okResult(p)), store)
    expect(h.queue.hasPending()).toBe(true)
    await h.queue.retry()
    expect(h.calls[0]).toMatchObject({ localTime: '05:30' })
  })

  it('retry() with nothing pending sends nothing', async () => {
    const h = queueWith((p) => Promise.resolve(okResult(p)))
    await h.queue.retry()
    expect(h.calls).toHaveLength(0)
  })

  it('classifies retryable codes', () => {
    for (const c of ['NETWORK', 'INTERNAL', 'UNAUTHORIZED', 'HTTP_429', 'HTTP_500', 'HTTP_503']) expect(isRetryable(c), c).toBe(true)
    for (const c of ['BAD_REQUEST', 'CAPACITY_REACHED', 'METHOD_NOT_ALLOWED', 'HTTP_400', 'HTTP_404']) expect(isRetryable(c), c).toBe(false)
  })
})
