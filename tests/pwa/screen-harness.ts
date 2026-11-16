import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { renderIndexHtml } from '../../scripts/pwa-html.ts'
import type { EnvState } from '../../src/core/index.ts'
import type { PublicSettings, SettingsApi, SettingsApiResult, SettingsPatchInput } from '../../src/pwa/api/settings-api.ts'
import { MemoryStore } from '../../src/pwa/state/local-cache.ts'
import { startSettingsScreen } from '../../src/pwa/ui/settings-screen.ts'
import { FakePushPlatform, TEST_VAPID_KEY } from '../fakes/fake-push.ts'

export const TZ = 'Asia/Jerusalem'
export const html = renderIndexHtml(readFileSync('src/pwa/index.html', 'utf8'), { connectOrigins: null, privacyUrl: 'https://example.org/privacy' })
export const bodyHtml = /<body>([\s\S]*)<\/body>/.exec(html)![1]!

export class FakeApi implements SettingsApi {
  saves: SettingsPatchInput[] = []
  sessions = 0
  server: PublicSettings | null = null
  saveResult: (p: SettingsPatchInput) => SettingsApiResult<PublicSettings> = (p) => ({
    ok: true,
    value: {
      localTime: p.localTime ?? this.server?.localTime ?? '09:00',
      timezone: p.timezone ?? this.server?.timezone ?? TZ,
      enabled: p.enabled ?? this.server?.enabled ?? false,
      nextSendAt: null,
    },
  })
  getCalls = 0
  ensureSession(): Promise<string> {
    this.sessions++
    return Promise.resolve('uid')
  }
  getSettings(): Promise<SettingsApiResult<PublicSettings | null>> {
    this.getCalls++
    return Promise.resolve({ ok: true, value: this.server })
  }
  saveSettings(patch: SettingsPatchInput): Promise<SettingsApiResult<PublicSettings>> {
    this.saves.push(patch)
    const r = this.saveResult(patch)
    if (r.ok) this.server = r.value
    return Promise.resolve(r)
  }
}

export interface MountOptions {
  store?: MemoryStore
  api?: SettingsApi | null
  env?: EnvState
  push?: FakePushPlatform | null
  online?: () => boolean
  vapidPublicKey?: string
  deviceTimezone?: string
}

export function mount(opts: MountOptions = {}) {
  const win = new Window({ settings: { disableJavaScriptFileLoading: true, disableJavaScriptEvaluation: true, disableCSSFileLoading: true } })
  win.document.body.innerHTML = bodyHtml
  const doc = win.document as unknown as Document
  const store = opts.store ?? new MemoryStore()
  const api = opts.api === undefined ? new FakeApi() : opts.api
  const push = opts.push === undefined ? new FakePushPlatform() : opts.push
  const events = new EventTarget()
  const swMessages = new EventTarget()
  const env = { state: opts.env ?? ('push_ready' as EnvState) }
  const onlineFn = opts.online ?? (() => true)
  const screen = startSettingsScreen({
    doc,
    store,
    api,
    deviceTimezone: () => opts.deviceTimezone ?? TZ,
    events,
    readEnvironment: () => ({
      state: env.state,
      permission: env.state === 'push_ready' && push ? push.perm : 'unavailable',
      isIOSLike: env.state === 'ios_needs_install',
    }),
    push,
    vapidPublicKey: opts.vapidPublicKey ?? TEST_VAPID_KEY,
    isOnline: () => onlineFn(),
    serviceWorkerMessages: swMessages,
  })
  const select = doc.getElementById('time') as HTMLSelectElement
  const toggle = doc.getElementById('notify') as HTMLInputElement
  const status = doc.getElementById('status') as HTMLElement
  const stateText = doc.getElementById('notify-state') as HTMLElement
  const hint = doc.getElementById('notify-hint') as HTMLElement
  const sheet = doc.getElementById('install-sheet') as HTMLElement
  const choose = (value: string) => {
    select.value = value
    select.dispatchEvent(new win.Event('change') as unknown as Event)
  }
  /** A tap on the switch: the browser flips `checked`, then fires `change`. */
  const tap = () => {
    toggle.checked = !toggle.checked
    toggle.dispatchEvent(new win.Event('change') as unknown as Event)
  }
  const flip = (checked: boolean) => {
    toggle.checked = checked
    toggle.dispatchEvent(new win.Event('change') as unknown as Event)
  }
  const becomeVisible = () => doc.dispatchEvent(new win.Event('visibilitychange') as unknown as Event)
  return {
    win,
    doc,
    store,
    api: api as FakeApi,
    push: push as FakePushPlatform,
    env,
    events,
    swMessages,
    screen,
    select,
    toggle,
    status,
    stateText,
    hint,
    sheet,
    choose,
    tap,
    flip,
    becomeVisible,
  }
}
