import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderIndexHtml } from '../../scripts/pwa-html.ts'
import type { PublicSettings, SettingsApiResult } from '../../src/pwa/api/settings-api.ts'
import { MemoryStore, PENDING_KEY, SETTINGS_KEY, readPending, writePending, writeSettings } from '../../src/pwa/state/local-cache.ts'
import { strings } from '../../src/pwa/strings.ts'
import { FakeApi, TZ, html, mount } from './screen-harness.ts'
describe('static HTML (first paint without JavaScript)', () => {
  it('is Hebrew RTL with the text from strings and 48 pre-rendered options defaulting to 09:00', () => {
    expect(html).toContain('<html lang="he" dir="rtl">')
    expect(html).toContain(`<h1>${strings.appName}</h1>`)
    const m = mount({ api: null })
    expect(m.select.options).toHaveLength(48)
    expect(m.select.value).toBe('09:00')
    expect(m.doc.querySelector('label[for="time"]')!.textContent).toBe(strings.timeLabel)
    expect(m.doc.querySelector('label[for="notify"]')!.textContent).toBe(strings.notificationsLabel)
    expect(m.doc.querySelector('details.how')!.hasAttribute('open')).toBe(false)
    expect(m.doc.querySelector('details.how .privacy a')!.getAttribute('href')).toBe('https://example.org/privacy')
    expect(m.doc.querySelector('footer')).toBeNull()
  })

  it('calm space: the controls card holds only two label/control rows; the only text besides labels is the off hint', () => {
    const m = mount({ api: null })
    const card = m.doc.querySelector('.controls')!
    const rows = card.querySelectorAll(':scope > .row-field')
    expect(rows).toHaveLength(2)
    expect(card.children).toHaveLength(2)
    expect(card.querySelector('.hint, [role="status"]')).toBeNull()
    expect(Array.from(card.querySelectorAll('p')).map((p) => p.id)).toEqual(['notify-hint'])
    expect(m.doc.querySelectorAll('[role="status"]')).toHaveLength(1)
  })

  it('the gentle off hint is shown while notifications are off and is part of the switch description', () => {
    const m = mount({ api: null })
    const hint = m.doc.getElementById('notify-hint')!
    expect(hint.hidden).toBe(false)
    expect(hint.textContent).toBe(strings.notificationsOffHint)
    expect(m.toggle.getAttribute('aria-describedby')).toContain('notify-hint')
  })

  it('has no feed, history, streak, loader or refresh UI', () => {
    expect(html).not.toMatch(/spinner|loader|progress|refresh|streak|history/i)
    expect(html).not.toMatch(/<(dialog|progress)\b/i)
  })

  it('omits the privacy link when no privacy URL is configured', () => {
    const plain = renderIndexHtml(readFileSync('src/pwa/index.html', 'utf8'), { connectOrigins: null, privacyUrl: '' })
    expect(plain).not.toContain('class="privacy"')
  })

  it('throws on an unknown string key (no silent blanks)', () => {
    expect(() => renderIndexHtml('{{nope}}<!--NTK:SLOT_OPTIONS--><!--NTK:HOW_IT_WORKS--><!--NTK:PRIVACY--><!--NTK:CSP-->', { connectOrigins: null, privacyUrl: '' })).toThrow(/nope/)
  })

  it('controls have labels and the status is a polite live region', () => {
    const m = mount({ api: null })
    expect(m.toggle.getAttribute('role')).toBe('switch')
    expect(m.toggle.getAttribute('aria-describedby')).toBe('notify-state notify-hint')
    expect(m.status.getAttribute('role')).toBe('status')
    expect(m.status.getAttribute('aria-live')).toBe('polite')
  })
})

describe('settings screen', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders synchronously from the cache, before any network call returns', () => {
    const store = new MemoryStore()
    writeSettings(store, { localTime: '21:30', timezone: 'Europe/Paris', enabled: false })
    const api = new FakeApi()
    let resolved = false
    api.getSettings = () => new Promise(() => void (resolved = true)) // never resolves
    const m = mount({ store, api })
    expect(m.select.value).toBe('21:30')
    expect(m.toggle.checked).toBe(false)
    expect(m.stateText.textContent).toBe(strings.notificationsOff)
    expect(resolved).toBe(true) // reconcile started, but rendering did not wait for it
  })

  it('without a cache, defaults apply: 09:00, off; and no session or row is created on open (P-15)', async () => {
    const m = mount()
    await m.screen.ready
    expect(m.select.value).toBe('09:00')
    expect(m.toggle.checked).toBe(false)
    expect(m.api.saves).toHaveLength(0)
    expect(m.api.sessions).toBe(0)
  })

  it('reads the device timezone on every open and caches it', () => {
    const store = new MemoryStore()
    writeSettings(store, { localTime: '10:00', timezone: 'America/New_York', enabled: false })
    const m = mount({ store })
    expect(m.screen.state().timezone).toBe(TZ)
    expect(JSON.parse(store.getItem(SETTINGS_KEY)!)).toMatchObject({ timezone: TZ })
  })

  it('a corrupted cache renders defaults instead of failing', () => {
    const store = new MemoryStore()
    store.setItem(SETTINGS_KEY, '{oops')
    const m = mount({ store })
    expect(m.select.value).toBe('09:00')
  })

  it('changing the time saves (debounced) with time and timezone, then shows "Saved" for 2 s', async () => {
    const m = mount()
    await m.screen.ready
    m.choose('07:30')
    expect(m.select.disabled).toBe(false) // stays interactive
    expect(JSON.parse(m.store.getItem(SETTINGS_KEY)!)).toMatchObject({ localTime: '07:30' })
    await vi.advanceTimersByTimeAsync(400)
    expect(m.api.saves).toEqual([{ localTime: '07:30', timezone: TZ }])
    expect(m.status.textContent).toBe(strings.saved)
    expect(m.status.classList.contains('visible')).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(m.status.textContent).toBe('')
  })

  it('rapid changes are coalesced into one save of the last value', async () => {
    const m = mount()
    m.choose('07:00')
    m.choose('07:30')
    m.choose('08:00')
    await vi.advanceTimersByTimeAsync(400)
    expect(m.api.saves).toEqual([{ localTime: '08:00', timezone: TZ }])
  })

  it('the failure toast dismisses itself while the change stays pending', async () => {
    const m = mount()
    m.api.saveResult = () => ({ ok: false, code: 'NETWORK', message: 'x' })
    m.choose('06:00')
    await vi.advanceTimersByTimeAsync(400)
    expect(m.status.classList.contains('visible')).toBe(true)
    await vi.advanceTimersByTimeAsync(6000)
    expect(m.status.textContent).toBe('')
    expect(m.status.classList.contains('visible')).toBe(false)
    expect(readPending(m.store)).toEqual({ localTime: '06:00' })
  })

  it('a failed save shows the friendly message, keeps a pending patch, and retries when back online', async () => {
    const m = mount()
    m.api.saveResult = () => ({ ok: false, code: 'NETWORK', message: 'Could not reach the server' })
    m.choose('06:00')
    await vi.advanceTimersByTimeAsync(400)
    expect(m.status.textContent).toBe(strings.saveFailed)
    expect(m.status.textContent).not.toMatch(/network|server|error/i)
    expect(readPending(m.store)).toEqual({ localTime: '06:00' })
    expect(m.select.value).toBe('06:00') // the user's choice stays on screen

    m.api.saveResult = new FakeApi().saveResult
    m.events.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(m.api.saves).toHaveLength(2)
    expect(m.status.textContent).toBe(strings.saved)
    expect(m.store.getItem(PENDING_KEY)).toBeNull()
  })

  it('a pending patch from the previous visit is sent on the next open (and wins over the server state)', async () => {
    const store = new MemoryStore()
    writeSettings(store, { localTime: '05:30', timezone: TZ, enabled: false })
    writePending(store, { localTime: '05:30' })
    const api = new FakeApi()
    api.server = { localTime: '09:00', timezone: TZ, enabled: false, nextSendAt: null }
    const m = mount({ store, api })
    await m.screen.ready
    expect(api.saves).toEqual([{ localTime: '05:30', timezone: TZ }])
    expect(api.getCalls).toBe(0)
    expect(m.select.value).toBe('05:30')
  })

  it('adopts the server state silently in the background when there is no pending change', async () => {
    const api = new FakeApi()
    api.server = { localTime: '18:00', timezone: TZ, enabled: false, nextSendAt: null }
    const m = mount({ api })
    expect(m.select.value).toBe('09:00')
    await m.screen.ready
    expect(m.select.value).toBe('18:00')
    expect(JSON.parse(m.store.getItem(SETTINGS_KEY)!)).toMatchObject({ localTime: '18:00' })
    expect(api.saves).toHaveLength(0)
  })

  it('does not overwrite a change the user made while the server state was loading', async () => {
    const api = new FakeApi()
    let resolveGet: (v: SettingsApiResult<PublicSettings | null>) => void = () => {}
    api.getSettings = () => new Promise((r) => (resolveGet = r))
    const m = mount({ api })
    m.choose('12:30')
    resolveGet({ ok: true, value: { localTime: '18:00', timezone: TZ, enabled: false, nextSendAt: null } })
    await m.screen.ready
    expect(m.select.value).toBe('12:30')
  })

  it('a failing background read changes nothing and shows nothing', async () => {
    const api = new FakeApi()
    api.getSettings = () => Promise.reject(new Error('offline'))
    const m = mount({ api })
    await m.screen.ready
    expect(m.select.value).toBe('09:00')
    expect(m.status.textContent).toBe('')
  })

  it('without a backend configuration the screen still works; the change stays pending', async () => {
    const m = mount({ api: null })
    m.choose('22:00')
    await vi.advanceTimersByTimeAsync(400)
    expect(m.select.value).toBe('22:00')
    expect(readPending(m.store)).toEqual({ localTime: '22:00' })
    expect(m.status.textContent).toBe(strings.saveFailed)
  })

  it('capacity reached shows its own calm message and is not retried', async () => {
    const m = mount()
    m.api.saveResult = () => ({ ok: false, code: 'CAPACITY_REACHED', message: 'full' })
    m.choose('06:00')
    await vi.advanceTimersByTimeAsync(400)
    expect(m.status.textContent).toBe(strings.capacityReached)
    expect(m.store.getItem(PENDING_KEY)).toBeNull()
  })

  describe('notifications switch', () => {
    it('turning it on (permission already granted) subscribes and saves enabled with the subscription', async () => {
      const m = mount()
      await m.screen.ready
      m.push.perm = 'granted'
      m.flip(true)
      expect(m.stateText.textContent).toBe(strings.notificationsOn)
      expect(m.toggle.getAttribute('aria-checked')).toBe('true')
      await m.screen.settled()
      expect(m.api.saves).toHaveLength(1)
      expect(m.api.saves[0]).toMatchObject({ localTime: '09:00', timezone: TZ, enabled: true })
      expect(m.api.saves[0]!.pushSubscription?.endpoint).toMatch(/^https:\/\/fcm\.googleapis\.com\//)
      expect(m.status.textContent).toBe(strings.notificationsEnabled)
    })
  })

  it('time labels are always 24-hour HH:MM, never AM/PM', () => {
    const m = mount({ api: null })
    const labels = Array.from(m.select.options).map((o) => o.textContent)
    expect(labels).toEqual(Array.from(m.select.options).map((o) => o.value))
    expect(labels).toContain('15:00')
    expect(labels).toContain('00:30')
    expect(labels.join(' ')).not.toMatch(/AM|PM/i)
  })

  it('the status live region is a floating toast outside the main content', () => {
    const m = mount({ api: null })
    expect(m.status.classList.contains('toast')).toBe(true)
    expect(m.status.closest('main')).toBeNull()
  })
})
