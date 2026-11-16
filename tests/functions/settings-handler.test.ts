import { beforeEach, describe, expect, it } from 'vitest'
import { nextOccurrenceAfter } from '../../src/core/scheduling/next-send.ts'
import { handleSettings, type SettingsDeps } from '../../supabase/functions/settings/handler.ts'
import { InMemorySettingsStore } from '../fakes/in-memory-settings-store.ts'

const NOW = new Date('2027-01-10T08:00:00.000Z')
const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
}
const PAGES = 'https://user.github.io'

let store: InMemorySettingsStore
let deps: SettingsDeps
let users: Record<string, string>

beforeEach(() => {
  store = new InMemorySettingsStore()
  users = { 'token-a': 'user-a', 'token-b': 'user-b' }
  deps = {
    authenticate: (req) => {
      const h = req.headers.get('authorization') ?? ''
      return Promise.resolve(users[h.replace(/^Bearer /, '')] ?? null)
    },
    store,
    now: () => NOW,
    rng: () => 0.5,
    maxSubscriptions: 5000,
    allowedOrigins: [PAGES],
    allowLocalhost: true,
  }
})

function post(body: unknown, token: string | null = 'token-a', extra: Record<string, string> = {}): Request {
  return new Request('https://x.test/functions/v1/settings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}
const get = (token: string | null = 'token-a') =>
  new Request('https://x.test/functions/v1/settings', {
    method: 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })

// Test-only convenience: response bodies are asserted structurally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

async function run(req: Request): Promise<{ status: number; body: Json; res: Response }> {
  const res = await handleSettings(req, deps)
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null, res }
}

const enable = { localTime: '09:00', timezone: 'Asia/Jerusalem', enabled: true, pushSubscription: SUB }

describe('auth and routing', () => {
  it('unauthenticated GET and POST → 401', async () => {
    expect((await run(get(null))).status).toBe(401)
    expect((await run(post(enable, null))).status).toBe(401)
    expect((await run(post(enable, 'bogus'))).status).toBe(401)
    expect(store.rows.size).toBe(0)
  })

  it('other methods → 405', async () => {
    const r = await run(new Request('https://x.test/', { method: 'DELETE', headers: { authorization: 'Bearer token-a' } }))
    expect(r.status).toBe(405)
  })

  it('body userId is ignored: identity comes from the token', async () => {
    const r = await run(post({ ...enable, userId: 'user-b' }))
    expect(r.status).toBe(200)
    expect(store.rows.has('user-a')).toBe(true)
    expect(store.rows.has('user-b')).toBe(false)
  })
})

describe('CORS', () => {
  it('OPTIONS from an allowed origin → 204 with CORS headers', async () => {
    const r = await run(new Request('https://x.test/', { method: 'OPTIONS', headers: { origin: PAGES } }))
    expect(r.status).toBe(204)
    expect(r.res.headers.get('access-control-allow-origin')).toBe(PAGES)
    expect(r.res.headers.get('access-control-allow-headers')).toContain('authorization')
  })

  it('allows http://localhost:<port> only when enabled; rejects others', async () => {
    const ask = async (origin: string) =>
      (await run(new Request('https://x.test/', { method: 'OPTIONS', headers: { origin } }))).res.headers.get(
        'access-control-allow-origin',
      )
    expect(await ask('http://localhost:5173')).toBe('http://localhost:5173')
    expect(await ask('https://evil.example')).toBeNull()
    expect(await ask('http://localhost.evil.example')).toBeNull()
    deps.allowLocalhost = false
    expect(await ask('http://localhost:5173')).toBeNull()
  })

  it('adds CORS headers to normal responses for an allowed origin', async () => {
    const r = await run(post(enable, 'token-a', { origin: PAGES }))
    expect(r.res.headers.get('access-control-allow-origin')).toBe(PAGES)
  })
})

describe('input hardening', () => {
  it.each([
    ['malformed JSON', '{nope'],
    ['array body', '[]'],
    ['unknown key', JSON.stringify({ localTime: '09:00', timezone: 'UTC', admin: true })],
    ['wrong type enabled', JSON.stringify({ enabled: 'yes' })],
    ['wrong type localTime', JSON.stringify({ localTime: 900 })],
    ['wrong type pushSubscription', JSON.stringify({ pushSubscription: 'x' })],
  ])('%s → 400 BAD_REQUEST, no write', async (_n, body) => {
    const r = await run(post(body))
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('BAD_REQUEST')
    expect(store.writes).toBe(0)
  })

  it('non-JSON content type → 400', async () => {
    const req = new Request('https://x.test/', {
      method: 'POST',
      headers: { authorization: 'Bearer token-a', 'content-type': 'text/plain' },
      body: JSON.stringify(enable),
    })
    expect((await run(req)).status).toBe(400)
  })

  it('body over 8 KiB → 400', async () => {
    const r = await run(post({ localTime: '09:00', timezone: 'UTC', pushSubscription: { ...SUB, pad: 'x'.repeat(9000) } }))
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('BAD_REQUEST')
  })
})

describe('core error codes → 400, no row change', () => {
  it('invalid slot, timezone, missing fields, missing/invalid/non-allowlisted subscription', async () => {
    const cases: [unknown, string][] = [
      [{ localTime: '09:15', timezone: 'UTC' }, 'INVALID_SLOT'],
      [{ localTime: '09:00', timezone: 'Asia/Nowhere' }, 'INVALID_TIMEZONE'],
      [{ localTime: '09:00' }, 'MISSING_FIELDS'],
      [{ localTime: '09:00', timezone: 'UTC', enabled: true }, 'SUBSCRIPTION_REQUIRED'],
      [{ ...enable, pushSubscription: { ...SUB, endpoint: 'https://evil.example.com/x' } }, 'INVALID_SUBSCRIPTION'],
      [{ ...enable, pushSubscription: { ...SUB, endpoint: 'http://fcm.googleapis.com/x' } }, 'INVALID_SUBSCRIPTION'],
    ]
    for (const [body, code] of cases) {
      const r = await run(post(body))
      expect(r.status, code).toBe(400)
      expect(r.body.code).toBe(code)
    }
    expect(store.rows.size).toBe(0)
    expect(store.writes).toBe(0)
  })

  it('an invalid change to an existing row leaves it untouched', async () => {
    await run(post(enable))
    const before = JSON.stringify([...store.rows.entries()])
    const writes = store.writes
    expect((await run(post({ localTime: '10:10' }))).body.code).toBe('INVALID_SLOT')
    expect(JSON.stringify([...store.rows.entries()])).toBe(before)
    expect(store.writes).toBe(writes)
  })
})

describe('behavior', () => {
  it('enable computes nextSendAt equal to core nextOccurrenceAfter', async () => {
    const r = await run(post(enable))
    expect(r.status).toBe(200)
    expect(r.body.settings).toEqual({
      localTime: '09:00',
      timezone: 'Asia/Jerusalem',
      enabled: true,
      nextSendAt: nextOccurrenceAfter('09:00', 'Asia/Jerusalem', NOW).toISOString(),
    })
  })

  it('responses never contain the push subscription, counter, or start index', async () => {
    const posted = await run(post(enable))
    const got = await run(get())
    for (const r of [posted, got]) {
      const text = JSON.stringify(r.body)
      expect(text).not.toContain('endpoint')
      expect(text).not.toContain('p256dh')
      expect(text).not.toMatch(/startIndex|messageIndex|start_index|message_index/)
    }
    expect(Object.keys(got.body.settings).sort()).toEqual(['enabled', 'localTime', 'nextSendAt', 'timezone'])
  })

  it('GET returns null settings for a user without a row, and only the caller’s own row', async () => {
    expect((await run(get())).body).toEqual({ settings: null })
    await run(post(enable))
    expect((await run(get('token-a'))).body.settings.enabled).toBe(true)
    expect((await run(get('token-b'))).body).toEqual({ settings: null })
  })

  it('disable nulls subscription and nextSendAt but keeps the counter; re-enable resumes it', async () => {
    await run(post(enable))
    store.rows.get('user-a')!.messageIndex = 41 // sender progress
    const off = await run(post({ enabled: false }))
    expect(off.body.settings).toMatchObject({ enabled: false, nextSendAt: null })
    const row = store.rows.get('user-a')!
    expect(row.pushSubscription).toBeNull()
    expect(row.nextSendAt).toBeNull()
    expect(row.messageIndex).toBe(41)
    const on = await run(post({ enabled: true, pushSubscription: SUB }))
    expect(on.body.settings.enabled).toBe(true)
    expect(store.rows.get('user-a')!.messageIndex).toBe(41)
  })

  it('updates write only changed fields: never the counter, start index, or an unchanged schedule', async () => {
    await run(post(enable))
    store.updates.length = 0
    // Subscription renewal only.
    await run(post({ pushSubscription: { ...SUB, endpoint: 'https://fcm.googleapis.com/fcm/send/renewed' } }))
    expect(store.updates).toHaveLength(1)
    const patch = store.updates[0]!.patch
    expect(Object.keys(patch)).toEqual(['pushSubscription'])
    // Time change replaces the schedule.
    await run(post({ localTime: '21:30' }))
    expect(Object.keys(store.updates[1]!.patch).sort()).toEqual(['localTime', 'nextSendAt'])
  })

  it('two rapid POSTs: last write wins and both succeed', async () => {
    const [a, b] = await Promise.all([run(post({ ...enable, localTime: '09:00' })), run(post({ ...enable, localTime: '10:30' }))])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(store.rows.get('user-a')!.localTime).toBe('10:30')
  })

  it('concurrent first request: re-applies on top of the winner without a second start index', async () => {
    store.racedRow = {
      pushSubscription: SUB,
      localTime: '08:00',
      timezone: 'UTC',
      enabled: true,
      startIndex: 1234,
      messageIndex: 0,
      nextSendAt: new Date('2027-01-11T08:00:00Z'),
    }
    const r = await run(post({ localTime: '09:00', timezone: 'UTC' }))
    expect(r.status).toBe(200)
    const row = store.rows.get('user-a')!
    expect(row.startIndex).toBe(1234)
    expect(row.localTime).toBe('09:00')
  })
})

describe('capacity cap (P-09)', () => {
  it('blocks new users only', async () => {
    deps.maxSubscriptions = 1
    expect((await run(post(enable, 'token-a'))).status).toBe(200)
    const blocked = await run(post(enable, 'token-b'))
    expect(blocked.status).toBe(429)
    expect(blocked.body.code).toBe('CAPACITY_REACHED')
    expect(store.rows.has('user-b')).toBe(false)
    // Existing user can still change settings.
    expect((await run(post({ localTime: '10:00' }, 'token-a'))).status).toBe(200)
  })
})

describe('error handling', () => {
  it('store failure → generic 500 INTERNAL with no details', async () => {
    store.failWith = new Error('connection string postgres://secret@host leaked?')
    const r = await run(post(enable))
    expect(r.status).toBe(500)
    expect(r.body).toEqual({ code: 'INTERNAL', message: 'Something went wrong' })
    expect(JSON.stringify(r.body)).not.toContain('secret')
  })
})
