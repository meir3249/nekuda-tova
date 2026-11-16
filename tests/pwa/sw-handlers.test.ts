import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PRODUCT_NAME } from '../../src/pwa/strings.ts'
import {
  SUBSCRIPTION_CHANGED_MESSAGE,
  handleNotificationClick,
  handlePush,
  handleSubscriptionChange,
  notificationFor,
  parsePayload,
  type NotificationOptionsLike,
  type PushDataLike,
} from '../../src/pwa/sw-handlers.ts'

const ICON = 'https://example.org/app/icons/icon-192.png'
const data = (value: unknown): PushDataLike => ({ json: () => value })
const raw = (text: string): PushDataLike => ({ json: () => JSON.parse(text) as unknown })

class FakeRegistration {
  shown: { title: string; options: NotificationOptionsLike }[] = []
  showNotification(title: string, options: NotificationOptionsLike): Promise<void> {
    this.shown.push({ title, options })
    return Promise.resolve()
  }
}

describe('push handler (fake ServiceWorkerGlobalScope registration)', () => {
  it('shows a v1 payload: product name as title, the message as body, the tag set', async () => {
    const reg = new FakeRegistration()
    await handlePush(reg, data({ v: 1, title: PRODUCT_NAME, body: 'לעצור לרגע ולנשום.', tag: 'ntk-2026-11-17' }), ICON)
    expect(reg.shown).toEqual([
      { title: PRODUCT_NAME, options: { body: 'לעצור לרגע ולנשום.', tag: 'ntk-2026-11-17', icon: ICON, badge: ICON, lang: 'he', dir: 'rtl' } },
    ])
  })

  it('never decorates the body with the product name (D-003)', () => {
    const n = notificationFor(data({ v: 1, title: 'x', body: 'מחשבה', tag: 't' }), ICON)
    expect(n.options.body).toBe('מחשבה')
    expect(n.options.body).not.toContain(PRODUCT_NAME)
    expect(n.title).toBe(PRODUCT_NAME)
  })

  it.each<[string, PushDataLike | null]>([
    ['no data', null],
    ['not JSON', raw('{oops')],
    ['wrong version', data({ v: 2, title: 't', body: 'b', tag: 'x' })],
    ['missing body', data({ v: 1, title: 't', tag: 'x' })],
    ['an array', data([1, 2])],
    ['a string', data('hello')],
  ])('malformed payload (%s) still shows a title-only notification, never silent, never invented text', async (_n, d) => {
    const reg = new FakeRegistration()
    await handlePush(reg, d, ICON)
    expect(reg.shown).toHaveLength(1)
    expect(reg.shown[0]!.title).toBe(PRODUCT_NAME)
    expect(reg.shown[0]!.options.body).toBeUndefined()
  })

  it('no requireInteraction, actions, vibration or silent flag', () => {
    const n = notificationFor(data({ v: 1, title: 't', body: 'b', tag: 'x' }), ICON)
    for (const k of ['requireInteraction', 'actions', 'vibrate', 'silent', 'renotify', 'data']) expect(n.options).not.toHaveProperty(k)
  })

  it('parsePayload accepts only v1 with string fields', () => {
    expect(parsePayload(data({ v: 1, title: 'a', body: 'b', tag: 'c', extra: 1 }))).toEqual({ v: 1, title: 'a', body: 'b', tag: 'c' })
    expect(parsePayload(undefined)).toBeNull()
  })
})

describe('notification click', () => {
  it('only closes the notification (D-017)', () => {
    let closed = 0
    handleNotificationClick({ close: () => void closed++ })
    expect(closed).toBe(1)
  })

  it('scan: the handler module has no navigation or window APIs', () => {
    const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    const src = code('src/pwa/sw-handlers.ts') + code('src/pwa/sw.ts')
    expect(src).toContain('notificationclick')
    expect(src).not.toMatch(/openWindow|\.focus\(|navigate\(/)
  })
})

describe('pushsubscriptionchange', () => {
  it('re-subscribes with the old key and tells every open page', async () => {
    const key = new ArrayBuffer(65)
    const subscribed: unknown[] = []
    const posted: unknown[] = []
    const client = { postMessage: (m: unknown) => void posted.push(m) }
    await handleSubscriptionChange({
      applicationServerKey: key,
      subscribe: (o) => Promise.resolve(void subscribed.push(o)),
      clients: () => Promise.resolve([client, client]),
    })
    expect(subscribed).toEqual([{ userVisibleOnly: true, applicationServerKey: key }])
    expect(posted).toEqual([{ type: SUBSCRIPTION_CHANGED_MESSAGE }, { type: SUBSCRIPTION_CHANGED_MESSAGE }])
  })

  it('is best effort: failures never throw, and without a key it only notifies', async () => {
    let subscribeCalls = 0
    await expect(
      handleSubscriptionChange({
        applicationServerKey: null,
        subscribe: () => Promise.resolve(void subscribeCalls++),
        clients: () => Promise.reject(new Error('no clients')),
      }),
    ).resolves.toBeUndefined()
    expect(subscribeCalls).toBe(0)
    await expect(
      handleSubscriptionChange({ applicationServerKey: new ArrayBuffer(1), subscribe: () => Promise.reject(new Error('x')), clients: () => Promise.resolve([]) }),
    ).resolves.toBeUndefined()
  })
})

describe('content never carries the product name (D-003)', () => {
  it('no message body in data/messages.json contains it', () => {
    const file = JSON.parse(readFileSync('data/messages.json', 'utf8')) as { messages: { content: string }[] }
    expect(file.messages.length).toBeGreaterThan(0)
    for (const m of file.messages) {
      expect(m.content).not.toContain(PRODUCT_NAME)
      expect(m.content.toLowerCase()).not.toContain('nekuda')
    }
  })
})
