import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvState } from '../../../src/core/index.ts'
import { ENDPOINT_HASH_KEY, endpointHash, writeEndpointHash } from '../../../src/pwa/push/renewal.ts'
import { MemoryStore, writePending, writeSettings } from '../../../src/pwa/state/local-cache.ts'
import { strings } from '../../../src/pwa/strings.ts'
import { INSTALL_HINT_SEEN_KEY, INSTALL_SHEET_CLOSE_MS, INSTALL_SHEET_DELAY_MS } from '../../../src/pwa/ui/install-sheet.ts'
import { SUBSCRIPTION_CHANGED_MESSAGE } from '../../../src/pwa/ui/settings-screen.ts'
import { SUBSCRIPTION_CHANGED_MESSAGE as SW_MESSAGE } from '../../../src/pwa/sw-handlers.ts'
import { FakePushPlatform } from '../../fakes/fake-push.ts'
import { FakeApi, TZ, mount } from '../screen-harness.ts'

const enabledServer = (tz = TZ) => ({ localTime: '09:00', timezone: tz, enabled: true, nextSendAt: '2026-11-17T07:00:00.000Z' })

/** Calm space: the controls card never holds anything but the two rows and the off hint. */
function expectNoInlineText(m: ReturnType<typeof mount>) {
  const card = m.doc.querySelector('.controls')!
  expect(card.children).toHaveLength(2)
  expect(Array.from(card.querySelectorAll('p')).map((p) => p.id)).toEqual(['notify-hint'])
}

/** At most one notice: the toast and the sheet are never visible together. */
function expectAtMostOneNotice(m: ReturnType<typeof mount>) {
  const toast = m.status.classList.contains('visible')
  const sheet = !m.sheet.hidden && m.sheet.classList.contains('open')
  expect(toast && sheet).toBe(false)
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('permission is never requested on load (D-013)', () => {
  it.each<[EnvState, 'default' | 'granted' | 'denied']>([
    ['push_ready', 'default'],
    ['push_ready', 'granted'],
    ['push_ready', 'denied'],
    ['ios_needs_install', 'default'],
    ['unsupported', 'default'],
  ])('%s / %s: no prompt, no notice on load', async (env, perm) => {
    const push = new FakePushPlatform()
    push.perm = perm
    const m = mount({ env, push })
    await m.screen.ready
    await vi.advanceTimersByTimeAsync(100)
    expect(push.requestCalls).toBe(0)
    expect(m.status.textContent).toBe('')
    expectNoInlineText(m)
    expect(m.hint.hidden).toBe(false)
  })
})

describe('iOS Safari tab (ios_needs_install)', () => {
  it('the install sheet rises once after first paint, sets the local flag, and is not shown again on reopen', async () => {
    const store = new MemoryStore()
    const m = mount({ env: 'ios_needs_install', store })
    expect(m.sheet.hidden).toBe(true)
    await vi.advanceTimersByTimeAsync(INSTALL_SHEET_DELAY_MS)
    expect(m.sheet.hidden).toBe(false)
    expect(m.screen.installSheet.isOpen()).toBe(true)
    expect(store.getItem(INSTALL_HINT_SEEN_KEY)).toBe('1')

    const again = mount({ env: 'ios_needs_install', store })
    await vi.advanceTimersByTimeAsync(INSTALL_SHEET_DELAY_MS * 3)
    expect(again.sheet.hidden).toBe(true)
  })

  it('the sheet is a labelled, non-modal dialog with the steps, the share glyph and the version line', async () => {
    const m = mount({ env: 'ios_needs_install' })
    expect(m.sheet.getAttribute('role')).toBe('dialog')
    expect(m.sheet.hasAttribute('aria-modal')).toBe(false)
    const heading = m.doc.getElementById(m.sheet.getAttribute('aria-labelledby')!)!
    expect(heading.textContent).toBe(strings.installHeading)
    expect(m.sheet.textContent).toContain(strings.installShare)
    expect(m.sheet.textContent).toContain(strings.installVersion)
    expect(m.sheet.querySelector('.bulb svg')).not.toBeNull()
    expect(m.sheet.querySelector('.bulb')!.getAttribute('aria-hidden')).toBe('true')
    expect(m.sheet.querySelector('.share-glyph')!.getAttribute('aria-hidden')).toBe('true')
    // No backdrop or cover: nothing else is layered over the screen.
    expect(m.doc.querySelector('.backdrop, .overlay, [aria-modal]')).toBeNull()
    expect(m.sheet.closest('main')).toBeNull()
  })

  it('"Not now" and Esc dismiss it; focus moves in on open and back to the switch on close', async () => {
    const m = mount({ env: 'ios_needs_install' })
    await vi.advanceTimersByTimeAsync(INSTALL_SHEET_DELAY_MS)
    expect(m.doc.activeElement).toBe(m.sheet)
    ;(m.doc.getElementById('install-dismiss') as HTMLButtonElement).click()
    expect(m.screen.installSheet.isOpen()).toBe(false)
    expect(m.doc.activeElement).toBe(m.toggle)
    await vi.advanceTimersByTimeAsync(INSTALL_SHEET_CLOSE_MS)
    expect(m.sheet.hidden).toBe(true)

    m.tap()
    expect(m.screen.installSheet.isOpen()).toBe(true)
    m.doc.dispatchEvent(new m.win.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as Event)
    expect(m.screen.installSheet.isOpen()).toBe(false)
  })

  it('the quiet switch stays off, focusable and tappable; a tap opens the sheet again', async () => {
    const store = new MemoryStore()
    store.setItem(INSTALL_HINT_SEEN_KEY, '1')
    const m = mount({ env: 'ios_needs_install', store })
    await vi.advanceTimersByTimeAsync(INSTALL_SHEET_DELAY_MS)
    expect(m.sheet.hidden).toBe(true)
    expect(m.toggle.getAttribute('aria-disabled')).toBe('true')
    expect(m.toggle.disabled).toBe(false)
    m.tap()
    expect(m.toggle.checked).toBe(false)
    expect(m.stateText.textContent).toBe(strings.notificationsOff)
    expect(m.screen.installSheet.isOpen()).toBe(true)
    expect(m.push.requestCalls).toBe(0)
    expectAtMostOneNotice(m)
  })

  it('is never re-shown on visibilitychange', async () => {
    const store = new MemoryStore()
    store.setItem(INSTALL_HINT_SEEN_KEY, '1')
    const m = mount({ env: 'ios_needs_install', store })
    m.becomeVisible()
    await vi.advanceTimersByTimeAsync(INSTALL_SHEET_DELAY_MS * 2)
    expect(m.sheet.hidden).toBe(true)
  })

  it('no session or row: time changes stay local and show no "Saved"', async () => {
    const m = mount({ env: 'ios_needs_install' })
    await m.screen.ready
    m.choose('07:30')
    await vi.advanceTimersByTimeAsync(1000)
    expect(m.select.value).toBe('07:30')
    expect(m.api.saves).toHaveLength(0)
    expect(m.api.sessions).toBe(0)
    expect(m.api.getCalls).toBe(0)
    expect(m.status.textContent).not.toBe(strings.saved)
  })

  it('the toast is hidden while the sheet is open (one notice at a time)', async () => {
    const m = mount({ env: 'ios_needs_install' })
    m.status.textContent = 'x'
    m.screen.status.flash('something')
    m.tap()
    expect(m.status.classList.contains('visible')).toBe(false)
    expectAtMostOneNotice(m)
  })
})

describe('unsupported browser', () => {
  it('nothing on load; tapping the quiet switch shows one calm toast', async () => {
    const m = mount({ env: 'unsupported' })
    await m.screen.ready
    expect(m.toggle.getAttribute('aria-disabled')).toBe('true')
    expect(m.status.textContent).toBe('')
    m.tap()
    expect(m.toggle.checked).toBe(false)
    expect(m.status.textContent).toBe(strings.unsupported)
    expect(m.sheet.hidden).toBe(true)
  })

  it('changing the time explains once and saves nothing', async () => {
    const m = mount({ env: 'unsupported' })
    m.choose('10:00')
    await vi.advanceTimersByTimeAsync(1000)
    expect(m.status.textContent).toBe(strings.unsupported)
    expect(m.api.saves).toHaveLength(0)
    expect(m.select.value).toBe('10:00')
  })
})

describe('permission denied', () => {
  it('nothing on load; a tap shows the denied toast without prompting again; time changes still save', async () => {
    const push = new FakePushPlatform()
    push.perm = 'denied'
    const m = mount({ push })
    await m.screen.ready
    expect(m.toggle.getAttribute('aria-disabled')).toBe('true')
    m.tap()
    m.tap()
    expect(push.requestCalls).toBe(0)
    expect(m.toggle.checked).toBe(false)
    expect(m.status.textContent).toBe(strings.permissionDenied)
    m.choose('20:00')
    await vi.advanceTimersByTimeAsync(400)
    expect(m.api.saves).toEqual([{ localTime: '20:00', timezone: TZ }])
  })
})

describe('turning notifications on (push_ready)', () => {
  it('requests permission synchronously inside the tap handler, then subscribes and saves', async () => {
    const m = mount()
    await m.screen.ready
    m.tap()
    expect(m.push.requestCalls).toBe(1) // no await between the tap and the request
    await m.screen.settled()
    expect(m.push.subscribeCalls).toBe(1)
    expect(m.push.keysUsed[0]).toHaveLength(65)
    expect(m.api.saves).toHaveLength(1)
    expect(m.api.saves[0]).toMatchObject({ enabled: true, localTime: '09:00', timezone: TZ })
    expect(m.toggle.checked).toBe(true)
    expect(m.hint.hidden).toBe(true)
    expect(m.screen.state().enabled).toBe(true)
    expect(m.store.getItem(ENDPOINT_HASH_KEY)).toBe(endpointHash(m.push.current!.endpoint))
  })

  it('shows "on" while the prompt is open; a second tap meanwhile changes nothing', async () => {
    const m = mount()
    m.push.holdPrompt = true
    m.tap()
    expect(m.toggle.checked).toBe(true)
    m.tap()
    expect(m.toggle.checked).toBe(true)
    expect(m.push.requestCalls).toBe(1)
    m.push.answerPrompt('granted')
    await m.screen.settled()
    expect(m.api.saves).toHaveLength(1)
  })

  it('a dismissed prompt slides the switch back, with no message and nothing saved', async () => {
    const m = mount()
    m.push.promptResult = 'default'
    m.tap()
    await m.screen.settled()
    expect(m.toggle.checked).toBe(false)
    expect(m.status.textContent).toBe('')
    expect(m.api.saves).toHaveLength(0)
    expect(m.toggle.hasAttribute('aria-disabled')).toBe(false)
  })

  it('denying in the prompt leaves the switch off and quiet, with no message', async () => {
    const m = mount()
    m.push.promptResult = 'denied'
    m.tap()
    await m.screen.settled()
    expect(m.toggle.checked).toBe(false)
    expect(m.toggle.getAttribute('aria-disabled')).toBe('true')
    expect(m.status.textContent).toBe('')
    expect(m.push.subscribeCalls).toBe(0)
  })

  it('save failure rolls back: the new subscription is removed, the switch slides back, one toast', async () => {
    const m = mount()
    m.api.saveResult = () => ({ ok: false, code: 'INVALID_SUBSCRIPTION', message: 'unknown push host' })
    m.tap()
    await m.screen.settled()
    expect(m.push.current).toBeNull()
    expect(m.toggle.checked).toBe(false)
    expect(m.screen.state().enabled).toBe(false)
    expect(m.status.textContent).toBe(strings.enableFailed)
    expect(m.store.getItem(ENDPOINT_HASH_KEY)).toBeNull()
  })

  it('capacity reached has its own calm message', async () => {
    const m = mount()
    m.api.saveResult = () => ({ ok: false, code: 'CAPACITY_REACHED', message: 'full' })
    m.tap()
    await m.screen.settled()
    expect(m.status.textContent).toBe(strings.capacityReached)
    expect(m.toggle.checked).toBe(false)
  })

  it('offline: nothing is subscribed or queued; the switch slides back with the offline toast', async () => {
    const m = mount({ online: () => false })
    m.push.perm = 'granted'
    m.tap()
    await m.screen.settled()
    expect(m.push.subscribeCalls).toBe(0)
    expect(m.api.saves).toHaveLength(0)
    expect(m.screen.queue.hasPending()).toBe(false)
    expect(m.toggle.checked).toBe(false)
    expect(m.status.textContent).toBe(strings.enableOffline)
  })

  it('subscribe throwing (push service unreachable) shows the generic message and saves nothing', async () => {
    const m = mount()
    m.push.subscribeFails = true
    m.tap()
    await m.screen.settled()
    expect(m.api.saves).toHaveLength(0)
    expect(m.status.textContent).toBe(strings.enableFailed)
    expect(m.toggle.checked).toBe(false)
  })

  it('a missing or invalid VAPID key never reaches subscribe', async () => {
    const m = mount({ vapidPublicKey: '' })
    m.tap()
    await m.screen.settled()
    expect(m.push.subscribeCalls).toBe(0)
    expect(m.status.textContent).toBe(strings.enableFailed)
  })

  it('a queued "off" from an offline moment is folded into the "on" save, so it can never land after it', async () => {
    const store = new MemoryStore()
    writeSettings(store, { localTime: '07:00', timezone: TZ, enabled: false })
    writePending(store, { enabled: false, localTime: '07:00' })
    const api = new FakeApi()
    api.saveResult = () => ({ ok: false, code: 'NETWORK', message: 'x' })
    const m = mount({ store, api })
    await m.screen.ready // the retry fails: still pending
    expect(m.screen.queue.hasPending()).toBe(true)
    api.saves.length = 0
    api.saveResult = new FakeApi().saveResult
    m.push.perm = 'granted'
    m.tap()
    await m.screen.settled()
    expect(api.saves).toHaveLength(1)
    expect(api.saves[0]).toMatchObject({ enabled: true, localTime: '07:00' })
    expect(m.screen.queue.hasPending()).toBe(false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(api.saves).toHaveLength(1)
  })
})

describe('turning notifications off', () => {
  it('saves enabled=false, removes the local subscription and the endpoint hash', async () => {
    const m = mount()
    m.tap()
    await m.screen.settled()
    const sub = m.push.current!
    m.tap()
    expect(m.toggle.checked).toBe(false)
    expect(m.hint.hidden).toBe(false)
    await vi.advanceTimersByTimeAsync(400)
    expect(m.api.saves.at(-1)).toEqual({ localTime: '09:00', timezone: TZ, enabled: false })
    expect(sub.unsubscribed).toBe(true)
    expect(m.store.getItem(ENDPOINT_HASH_KEY)).toBeNull()
  })

  it('offline: the switch is off immediately and the change stays pending', async () => {
    const m = mount()
    m.tap()
    await m.screen.settled()
    m.api.saveResult = () => ({ ok: false, code: 'NETWORK', message: 'x' })
    m.tap()
    await vi.advanceTimersByTimeAsync(400)
    expect(m.toggle.checked).toBe(false)
    expect(m.screen.queue.hasPending()).toBe(true)
  })

  it('turning on again subscribes afresh', async () => {
    const m = mount()
    m.tap()
    await m.screen.settled()
    const first = m.push.current!.endpoint
    m.tap()
    await vi.advanceTimersByTimeAsync(400)
    m.tap()
    await m.screen.settled()
    expect(m.push.current!.endpoint).not.toBe(first)
    expect(m.api.saves.at(-1)).toMatchObject({ enabled: true })
  })
})

describe('renewal and revocation on open (silent)', () => {
  function enabledEverywhere(opts: { perm?: 'granted' | 'denied' | 'default'; serverTz?: string; sameHash?: boolean } = {}) {
    const store = new MemoryStore()
    writeSettings(store, { localTime: '09:00', timezone: TZ, enabled: true })
    const api = new FakeApi()
    api.server = enabledServer(opts.serverTz)
    const push = new FakePushPlatform()
    push.perm = opts.perm ?? 'granted'
    return { store, api, push }
  }

  it('enabled on the server but permission revoked: shown off, the server is told quietly, no message', async () => {
    const s = enabledEverywhere({ perm: 'denied' })
    const m = mount(s)
    expect(m.toggle.checked).toBe(false)
    await m.screen.ready
    expect(s.api.saves).toEqual([{ localTime: '09:00', timezone: TZ, enabled: false }])
    expect(m.status.textContent).toBe('')
    expect(m.toggle.getAttribute('aria-disabled')).toBe('true')
  })

  it('permitted but the browser lost its subscription: re-subscribes without a prompt and sends it', async () => {
    const s = enabledEverywhere()
    const m = mount(s)
    await m.screen.ready
    expect(s.push.requestCalls).toBe(0)
    expect(s.push.subscribeCalls).toBe(1)
    expect(s.api.saves).toHaveLength(1)
    expect(s.api.saves[0]).toMatchObject({ enabled: true, pushSubscription: { endpoint: s.push.current!.endpoint } })
    expect(m.status.textContent).toBe('')
    expect(m.toggle.checked).toBe(true)
  })

  it('the browser renewed the subscription (endpoint changed): sends the new one', async () => {
    const s = enabledEverywhere()
    writeEndpointHash(s.store, 'https://fcm.googleapis.com/fcm/send/old')
    const sub = s.push.rotate()
    const m = mount(s)
    await m.screen.ready
    expect(s.api.saves).toHaveLength(1)
    expect(s.api.saves[0]!.pushSubscription?.endpoint).toBe(sub.endpoint)
    expect(s.store.getItem(ENDPOINT_HASH_KEY)).toBe(endpointHash(sub.endpoint))
    expect(m.status.textContent).toBe('')
  })

  it('everything in order: nothing is sent', async () => {
    const s = enabledEverywhere()
    const sub = s.push.rotate()
    writeEndpointHash(s.store, sub.endpoint)
    const m = mount(s)
    await m.screen.ready
    expect(s.api.saves).toHaveLength(0)
    expect(m.toggle.checked).toBe(true)
  })

  it('timezone follow: a new device timezone is saved silently (same local time applies there)', async () => {
    const s = enabledEverywhere({ serverTz: 'Europe/Paris' })
    const sub = s.push.rotate()
    writeEndpointHash(s.store, sub.endpoint)
    const m = mount(s)
    await m.screen.ready
    expect(s.api.saves).toEqual([{ localTime: '09:00', timezone: TZ }])
    expect(m.status.textContent).toBe('')
  })

  it('disabled on the server but a local subscription remains: it is removed', async () => {
    const api = new FakeApi()
    api.server = { localTime: '09:00', timezone: TZ, enabled: false, nextSendAt: null }
    const push = new FakePushPlatform()
    push.perm = 'granted'
    const sub = push.rotate()
    const m = mount({ api, push })
    await m.screen.ready
    expect(sub.unsubscribed).toBe(true)
    expect(api.saves).toHaveLength(0)
  })

  it('the service worker message after pushsubscriptionchange re-sends the new subscription', async () => {
    expect(SUBSCRIPTION_CHANGED_MESSAGE).toBe(SW_MESSAGE)
    const s = enabledEverywhere()
    const sub = s.push.rotate()
    writeEndpointHash(s.store, sub.endpoint)
    const m = mount(s)
    await m.screen.ready
    const next = s.push.rotate()
    m.swMessages.dispatchEvent(new MessageEvent('message', { data: { type: SUBSCRIPTION_CHANGED_MESSAGE } }))
    await vi.advanceTimersByTimeAsync(0)
    expect(s.api.saves.at(-1)!.pushSubscription?.endpoint).toBe(next.endpoint)
  })

  it('permission revoked in OS settings while the app was in the background: off on return, server told', async () => {
    const s = enabledEverywhere()
    const sub = s.push.rotate()
    writeEndpointHash(s.store, sub.endpoint)
    const m = mount(s)
    await m.screen.ready
    expect(m.toggle.checked).toBe(true)
    s.push.perm = 'denied'
    m.becomeVisible()
    await vi.advanceTimersByTimeAsync(0)
    expect(m.toggle.checked).toBe(false)
    expect(s.api.saves.at(-1)).toMatchObject({ enabled: false })
    expect(m.status.textContent).toBe('')
  })

  it('service worker not ready: the repair is skipped quietly', async () => {
    const s = enabledEverywhere()
    s.push.getSubscriptionFails = true
    const m = mount(s)
    await m.screen.ready
    expect(s.api.saves).toHaveLength(0)
    expect(m.status.textContent).toBe('')
  })
})
