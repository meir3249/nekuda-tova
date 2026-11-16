import type { PermissionState } from '../../core/index.ts'
import type { PublicSettings, SettingsApi, SettingsApiResult, SettingsPatchInput } from '../api/settings-api.ts'
import type { DetectedEnvironment } from '../env/read-environment.ts'
import type { PushPlatform, PushSubscriptionLike } from '../push/push-platform.ts'
import { planRenewal, readEndpointHash, writeEndpointHash } from '../push/renewal.ts'
import { serializeSubscription, subscribePush, unsubscribeQuietly } from '../push/subscribe.ts'
import { unsubscribeLocal } from '../push/unsubscribe.ts'
import { readSettings, writeSettings, type CachedSettings, type KeyValueStore } from '../state/local-cache.ts'
import { createSaveQueue, type SaveOutcome, type SaveQueue } from '../state/save-queue.ts'
import { strings } from '../strings.ts'
import { createInstallSheet, type InstallSheet } from './install-sheet.ts'
import { NOTICE_VISIBLE_MS, SAVED_VISIBLE_MS, createStatusLine, type StatusLine } from './status.ts'
import { renderTimeSelect } from './time-select.ts'

export const ELEMENT_IDS = {
  time: 'time',
  notify: 'notify',
  notifyState: 'notify-state',
  notifyHint: 'notify-hint',
  status: 'status',
} as const

/** Message the service worker posts after `pushsubscriptionchange`, so an open page re-sends the subscription. */
export const SUBSCRIPTION_CHANGED_MESSAGE = 'ntk:pushsubscriptionchange'

export interface SettingsScreenDeps {
  doc: Document
  store: KeyValueStore
  /** Null when the build has no Supabase configuration: everything still works locally and saves stay pending. */
  api: SettingsApi | null
  deviceTimezone(): string
  /** `window`: listens for `online` to retry pending saves. */
  events: Pick<EventTarget, 'addEventListener'>
  /** Re-read on every open and whenever the page becomes visible again (permission may change in OS settings). */
  readEnvironment(): DetectedEnvironment
  /** Null when the browser has no push support at all. */
  push: PushPlatform | null
  vapidPublicKey: string
  isOnline(): boolean
  /** `navigator.serviceWorker`: receives the service worker's subscription-changed message. */
  serviceWorkerMessages?: Pick<EventTarget, 'addEventListener'> | null
  delayMs?: number
}

export interface SettingsScreen {
  state(): CachedSettings
  queue: SaveQueue
  status: StatusLine
  installSheet: InstallSheet
  /** Resolves when the background reconcile and silent repairs have finished (tests). */
  ready: Promise<void>
  /** Resolves when the latest enable attempt has finished (tests). */
  settled(): Promise<void>
}

type QuietReason = 'install' | 'unsupported' | 'denied'

function required<T extends HTMLElement>(doc: Document, id: string, tag: string): T {
  const el = doc.getElementById(id)
  if (el === null || el.tagName.toLowerCase() !== tag) throw new Error(`Missing <${tag} id="${id}">`)
  return el as T
}

/**
 * Renders synchronously from the local cache (never waits for the network), then reconciles in the
 * background. No loaders, no blocking dialogs, no technical error text. Every message goes through the one
 * toast and only after a tap; the only thing that may appear by itself is the one-time iOS install sheet.
 */
export function startSettingsScreen(deps: SettingsScreenDeps): SettingsScreen {
  const { doc, store } = deps
  const select = required<HTMLSelectElement>(doc, ELEMENT_IDS.time, 'select')
  const toggle = required<HTMLInputElement>(doc, ELEMENT_IDS.notify, 'input')
  const stateText = required<HTMLElement>(doc, ELEMENT_IDS.notifyState, 'span')
  const offHint = required<HTMLElement>(doc, ELEMENT_IDS.notifyHint, 'p')
  const status = createStatusLine(required<HTMLElement>(doc, ELEMENT_IDS.status, 'p'))
  const sheet = createInstallSheet({ doc, store, returnFocusTo: toggle, onOpen: () => status.clear() })

  let env = deps.readEnvironment()
  /** Only a browser that can actually notify creates a session or row (no row without a way to notify). */
  const canSave = (): boolean => env.state === 'push_ready'
  const quietReason = (): QuietReason | null =>
    env.state === 'ios_needs_install' ? 'install' : env.state === 'unsupported' ? 'unsupported' : env.permission === 'denied' ? 'denied' : null

  // 1. Local state first. The timezone is re-read on every open (the user may have travelled).
  const cached = readSettings(store, deps.deviceTimezone())
  let state: CachedSettings = { ...cached, timezone: deps.deviceTimezone() }
  if (quietReason() !== null) state.enabled = false
  writeSettings(store, state)
  let userChanged = false
  /** An enable attempt is running: the switch shows "on" until it succeeds or slides back. */
  let enabling: Promise<void> | null = null
  /** Last settings the server confirmed (read or save); the basis for silent repairs. */
  let server: PublicSettings | null = null

  const render = (): void => {
    renderTimeSelect(select, state.localTime)
    const shownOn = enabling !== null || state.enabled
    toggle.checked = shownOn
    toggle.setAttribute('aria-checked', String(shownOn))
    if (quietReason() === null) toggle.removeAttribute('aria-disabled')
    else toggle.setAttribute('aria-disabled', 'true')
    stateText.textContent = shownOn ? strings.notificationsOn : strings.notificationsOff
    offHint.hidden = shownOn
  }
  render()

  /** The single notice channel. Nothing else is shown while the install sheet is open. */
  const notify = (text: string, ms = NOTICE_VISIBLE_MS): void => {
    if (!sheet.isOpen()) status.flash(text, ms)
  }

  const onOutcome = (o: SaveOutcome): void => {
    if (o.kind === 'saved') {
      server = o.settings
      notify(strings.saved, SAVED_VISIBLE_MS)
    } else if (o.kind === 'failed') notify(strings.saveFailed)
    else notify(o.code === 'CAPACITY_REACHED' ? strings.capacityReached : strings.saveRejected)
  }

  const queue = createSaveQueue({
    save: (patch) =>
      deps.api ? deps.api.saveSettings(patch) : Promise.resolve({ ok: false as const, code: 'NETWORK', message: 'not configured' }),
    store,
    baseFields: () => ({ localTime: state.localTime, timezone: state.timezone }),
    onOutcome,
    ...(deps.delayMs === undefined ? {} : { delayMs: deps.delayMs }),
  })

  const setState = (next: Partial<CachedSettings>): void => {
    state = { ...state, ...next }
    writeSettings(store, state)
    render()
  }

  const change = (patch: SettingsPatchInput, next: Partial<CachedSettings>): void => {
    userChanged = true
    setState(next)
    queue.enqueue(patch)
  }

  /** A direct save that never shows anything (repairs on open). */
  async function silentSave(patch: SettingsPatchInput): Promise<PublicSettings | null> {
    if (!deps.api) return null
    let res: SettingsApiResult<PublicSettings>
    try {
      res = await deps.api.saveSettings({ localTime: state.localTime, timezone: state.timezone, ...patch })
    } catch {
      return null
    }
    if (!res.ok) return null
    server = res.value
    return res.value
  }

  // 2. Controls stay interactive at all times; saving happens behind them.
  select.addEventListener('change', () => {
    if (select.value === state.localTime) return
    if (!canSave()) {
      // Safari tab / unsupported browser: the choice stays on this device; nothing is saved, so no "Saved".
      setState({ localTime: select.value })
      if (env.state === 'unsupported') notify(strings.unsupported)
      return
    }
    change({ localTime: select.value }, { localTime: select.value })
  })

  toggle.addEventListener('change', () => {
    const wanted = toggle.checked
    if (enabling) {
      render() // a second tap while turning on changes nothing
      return
    }
    const quiet = quietReason()
    if (quiet !== null) {
      render() // the quiet switch stays off
      if (quiet === 'install') sheet.open()
      else notify(quiet === 'denied' ? strings.permissionDenied : strings.unsupported)
      return
    }
    if (!wanted) {
      if (!state.enabled) return render()
      disable()
      return
    }
    if (state.enabled) return render()
    // D-013: the permission request happens synchronously inside the tap handler (iOS requires the gesture).
    const permission: Promise<PermissionState> =
      env.permission === 'granted' ? Promise.resolve('granted') : deps.push ? deps.push.requestPermission() : Promise.resolve('unavailable')
    const attempt = enable(permission).finally(() => {
      enabling = null
      render()
    })
    enabling = attempt
    render()
  })

  function disable(): void {
    change({ enabled: false }, { enabled: false })
    writeEndpointHash(store, null)
    // Immediate effect on this device, even if the server only hears about it once back online.
    if (deps.push) void unsubscribeLocal(deps.push)
  }

  async function enable(permission: Promise<PermissionState>): Promise<void> {
    const p = await permission
    env = deps.readEnvironment()
    // Dismissed or denied: the switch slides back, no message (a later tap on the quiet switch explains).
    if (p !== 'granted') return
    if (!deps.push || !deps.api) return notify(strings.enableFailed)
    if (!deps.isOnline()) return notify(strings.enableOffline)

    const sub = await subscribePush(deps.push, deps.vapidPublicKey)
    if (!sub.ok) return notify(deps.isOnline() ? strings.enableFailed : strings.enableOffline)

    // Fold any pending change into this save, so a queued "off" can never land after this "on".
    const queued = await queue.take()
    const queuedRest: SettingsPatchInput = { ...(queued ?? {}) }
    delete queuedRest.enabled
    let res: SettingsApiResult<PublicSettings>
    try {
      res = await deps.api.saveSettings({
        ...queuedRest,
        localTime: state.localTime,
        timezone: state.timezone,
        enabled: true,
        pushSubscription: sub.stored,
      })
    } catch {
      res = { ok: false, code: 'NETWORK', message: 'request failed' }
    }

    if (!res.ok) {
      // Nothing half-saved: drop the new subscription and put back what was pending.
      await unsubscribeQuietly(sub.subscription)
      if (Object.keys(queuedRest).length > 0) queue.enqueue(queuedRest)
      if (!deps.isOnline()) notify(strings.enableOffline)
      else notify(res.code === 'CAPACITY_REACHED' ? strings.capacityReached : strings.enableFailed)
      return
    }
    server = res.value
    userChanged = true
    writeEndpointHash(store, sub.stored.endpoint)
    setState({ enabled: true })
    notify(strings.saved, SAVED_VISIBLE_MS)
  }

  // 3. Silent repairs (spec 07, Renewal and revocation, Timezone follow). Never shows anything.
  let repairing: Promise<void> | null = null
  function repair(): Promise<void> {
    if (repairing) return repairing
    repairing = runRepair().finally(() => {
      repairing = null
    })
    return repairing
  }

  async function runRepair(): Promise<void> {
    const push = deps.push
    if (!push || !deps.api || server === null || !canSave() || enabling) return
    let local: PushSubscriptionLike | null
    try {
      local = await push.getSubscription()
    } catch {
      return // service worker not ready: the next open repairs
    }
    if (enabling || server === null) return
    const action = planRenewal({
      serverEnabled: server.enabled,
      serverTimezone: server.timezone,
      deviceTimezone: state.timezone,
      permission: env.permission,
      localEndpoint: local?.endpoint ?? null,
      lastSentHash: readEndpointHash(store),
    })

    switch (action.kind) {
      case 'none':
        return
      case 'drop-local':
        await unsubscribeQuietly(local)
        writeEndpointHash(store, null)
        return
      case 'disable':
        if (state.enabled) setState({ enabled: false })
        await silentSave({ enabled: false })
        await unsubscribeQuietly(local)
        writeEndpointHash(store, null)
        return
      case 'resubscribe': {
        const sub = await subscribePush(push, deps.vapidPublicKey)
        if (!sub.ok) return
        if (await silentSave({ enabled: true, pushSubscription: sub.stored })) writeEndpointHash(store, sub.stored.endpoint)
        return
      }
      case 'send-subscription': {
        const stored = local ? serializeSubscription(local) : null
        if (!stored) return
        if (await silentSave({ enabled: true, pushSubscription: stored })) writeEndpointHash(store, stored.endpoint)
        return
      }
      case 'timezone':
        await silentSave({})
        return
    }
  }

  deps.events.addEventListener('online', () => {
    if (canSave() && queue.hasPending()) void queue.retry()
  })

  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState !== 'visible') return
    env = deps.readEnvironment()
    if (quietReason() !== null && state.enabled) setState({ enabled: false })
    else render()
    void repair()
  })

  deps.serviceWorkerMessages?.addEventListener('message', (e: Event) => {
    const data = (e as MessageEvent).data as { type?: unknown } | null
    if (data && data.type === SUBSCRIPTION_CHANGED_MESSAGE) void repair()
  })

  // The install hint rises softly once, after first paint, the first time the app is opened in a Safari tab.
  if (env.state === 'ios_needs_install') sheet.showFirstTimeOnly()

  // 4. Background: first deliver anything a previous visit could not save, otherwise adopt the server state;
  // then repair silently. A Safari tab or an unsupported browser never talks to the server.
  const ready = (async () => {
    if (!canSave()) return
    if (queue.hasPending()) {
      await queue.retry()
    } else if (deps.api) {
      let res: Awaited<ReturnType<SettingsApi['getSettings']>>
      try {
        res = await deps.api.getSettings()
      } catch {
        return
      }
      if (!res.ok || res.value === null) return
      server = res.value
      if (!userChanged) adopt(res.value)
    }
    if (!userChanged) await repair()
  })()

  function adopt(s: PublicSettings): void {
    const next: CachedSettings = {
      localTime: s.localTime,
      // Keep the device timezone locally; the repair step sends it to the server if it changed.
      timezone: state.timezone,
      // Permission revoked: shown off right away; the repair tells the server.
      enabled: s.enabled && env.permission === 'granted',
    }
    if (next.localTime === state.localTime && next.enabled === state.enabled) return
    state = next
    writeSettings(store, state)
    render()
  }

  return {
    state: () => ({ ...state }),
    queue,
    status,
    installSheet: sheet,
    ready,
    settled: () => enabling ?? Promise.resolve(),
  }
}
