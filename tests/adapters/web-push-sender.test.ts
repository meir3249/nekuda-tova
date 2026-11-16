import { describe, expect, it } from 'vitest'
import { isAllowedEndpoint, WebPushSender, type SendNotification } from '../../src/adapters/web-push/web-push-sender.ts'
import { DEFAULT_PUSH_ENDPOINT_ALLOWLIST } from '../../src/core/settings/push-endpoint-allowlist.ts'

const VAPID = { subject: 'mailto:owner@example.com', publicKey: 'pub', privateKey: 'priv' }
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'P', auth: 'A' } }
const PAYLOAD = { v: 1 as const, title: 'T', body: 'SECRET-BODY', tag: 'ntk-2027-01-11' }
const OPTIONS = { ttlSeconds: 3600, urgency: 'normal' as const, topic: 'tabc' }

function sender(impl: SendNotification) {
  const calls: { sub: unknown; payload: string; options: unknown }[] = []
  const s = new WebPushSender(VAPID, {
    sendNotification: (sub, payload, options) => {
      calls.push({ sub, payload, options })
      return impl(sub, payload, options)
    },
  })
  return { s, calls }
}

const rejectWith = (props: Record<string, unknown>, message = 'boom') =>
  Object.assign(new Error(message), props)

describe('WebPushSender result mapping', () => {
  it.each([200, 201, 202])('%i is accepted', async (statusCode) => {
    const { s } = sender(() => Promise.resolve({ statusCode }))
    expect(await s.send(SUB, PAYLOAD, OPTIONS)).toEqual({ kind: 'accepted', status: statusCode })
  })

  it.each([404, 410])('%i is gone', async (statusCode) => {
    const { s } = sender(() => Promise.reject(rejectWith({ statusCode })))
    expect(await s.send(SUB, PAYLOAD, OPTIONS)).toEqual({ kind: 'gone', status: statusCode })
  })

  it.each([429, 500, 502, 503])('%i is a retryable failure', async (statusCode) => {
    const { s } = sender(() => Promise.reject(rejectWith({ statusCode })))
    expect(await s.send(SUB, PAYLOAD, OPTIONS)).toEqual({
      kind: 'failed',
      status: statusCode,
      retryable: true,
      error: `http_${statusCode}`,
    })
  })

  it.each([400, 401, 403, 413])('%i is a non-retryable failure', async (statusCode) => {
    const { s } = sender(() => Promise.reject(rejectWith({ statusCode })))
    expect(await s.send(SUB, PAYLOAD, OPTIONS)).toEqual({
      kind: 'failed',
      status: statusCode,
      retryable: false,
      error: `http_${statusCode}`,
    })
  })

  it('maps network errors and timeouts to retryable failures with a fixed code', async () => {
    const timeout = sender(() => Promise.reject(new Error('Socket timeout')))
    expect(await timeout.s.send(SUB, PAYLOAD, OPTIONS)).toEqual({ kind: 'failed', status: null, retryable: true, error: 'timeout' })

    const reset = sender(() => Promise.reject(rejectWith({ code: 'ECONNRESET' }, 'read ECONNRESET fcm.googleapis.com')))
    expect(await reset.s.send(SUB, PAYLOAD, OPTIONS)).toEqual({ kind: 'failed', status: null, retryable: true, error: 'econnreset' })

    const other = sender(() => Promise.reject(new Error('anything at https://fcm.googleapis.com/fcm/send/abc')))
    expect(await other.s.send(SUB, PAYLOAD, OPTIONS)).toEqual({ kind: 'failed', status: null, retryable: true, error: 'network_error' })
  })

  it('never leaks the endpoint, keys or message text into a result', async () => {
    const { s } = sender(() => Promise.reject(rejectWith({ statusCode: 500, body: 'echo SECRET-BODY', endpoint: SUB.endpoint })))
    const result = await s.send(SUB, PAYLOAD, OPTIONS)
    expect(JSON.stringify(result)).not.toMatch(/SECRET-BODY|fcm\.googleapis|"P"|"A"/)
  })
})

describe('WebPushSender request', () => {
  it('passes the JSON payload, TTL, urgency, topic, VAPID details and a 10 s timeout', async () => {
    const { s, calls } = sender(() => Promise.resolve({ statusCode: 201 }))
    await s.send(SUB, PAYLOAD, OPTIONS)
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0]!.payload)).toEqual(PAYLOAD)
    expect(calls[0]!.options).toEqual({
      vapidDetails: VAPID,
      TTL: 3600,
      urgency: 'normal',
      timeout: 10_000,
      topic: 'tabc',
    })
  })

  it('omits the topic when none is given', async () => {
    const { s, calls } = sender(() => Promise.resolve({ statusCode: 201 }))
    await s.send(SUB, PAYLOAD, { ttlSeconds: 60, urgency: 'low' })
    expect(calls[0]!.options).not.toHaveProperty('topic')
  })
})

describe('endpoint allowlist re-check (P-08)', () => {
  it.each([
    'https://evil.example.com/push/abc',
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com.evil.com/x',
    'https://user:pw@fcm.googleapis.com/x',
    'https://127.0.0.1/x',
    'not a url',
  ])('refuses %s without making a request', async (endpoint) => {
    const { s, calls } = sender(() => Promise.resolve({ statusCode: 201 }))
    const result = await s.send({ ...SUB, endpoint }, PAYLOAD, OPTIONS)
    expect(result).toEqual({ kind: 'failed', status: null, retryable: false, error: 'endpoint_not_allowed' })
    expect(calls).toHaveLength(0)
  })

  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
  ])('allows %s', (endpoint) => {
    expect(isAllowedEndpoint(endpoint, DEFAULT_PUSH_ENDPOINT_ALLOWLIST)).toBe(true)
  })
})
