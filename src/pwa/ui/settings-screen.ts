import type { PublicSettings, SettingsApi, SettingsPatchInput } from '../api/settings-api.ts'
import { readSettings, writeSettings, type CachedSettings, type KeyValueStore } from '../state/local-cache.ts'
import { createSaveQueue, type SaveOutcome, type SaveQueue } from '../state/save-queue.ts'
import { strings } from '../strings.ts'
import { NOTICE_VISIBLE_MS, createStatusLine, type StatusLine } from './status.ts'
import { renderTimeSelect } from './time-select.ts'

export const ELEMENT_IDS = {
  time: 'time',
  notify: 'notify',
  notifyState: 'notify-state',
  notifyHint: 'notify-hint',
  status: 'status',
} as const

export interface SettingsScreenDeps {
  doc: Document
  store: KeyValueStore
  /** Null when the build has no Supabase configuration: everything still works locally and saves stay pending. */
  api: SettingsApi | null
  deviceTimezone(): string
  /** `window`: listens for `online` to retry pending saves. */
  events: Pick<EventTarget, 'addEventListener'>
  /** Task 06 feature flag: until Task 07 adds permission + subscription, turning notifications on is not possible. */
  pushFlowEnabled: boolean
  delayMs?: number
}

export interface SettingsScreen {
  state(): CachedSettings
  queue: SaveQueue
  status: StatusLine
  /** Resolves when the background reconcile has finished (tests). */
  ready: Promise<void>
}

function required<T extends HTMLElement>(doc: Document, id: string, tag: string): T {
  const el = doc.getElementById(id)
  if (el === null || el.tagName.toLowerCase() !== tag) throw new Error(`Missing <${tag} id="${id}">`)
  return el as T
}

/**
 * Renders synchronously from the local cache (never waits for the network), then reconciles in the
 * background. No loaders, no blocking dialogs, no technical error text.
 */
export function startSettingsScreen(deps: SettingsScreenDeps): SettingsScreen {
  const { doc, store } = deps
  const select = required<HTMLSelectElement>(doc, ELEMENT_IDS.time, 'select')
  const toggle = required<HTMLInputElement>(doc, ELEMENT_IDS.notify, 'input')
  const stateText = required<HTMLElement>(doc, ELEMENT_IDS.notifyState, 'span')
  const offHint = required<HTMLElement>(doc, ELEMENT_IDS.notifyHint, 'p')
  const status = createStatusLine(required<HTMLElement>(doc, ELEMENT_IDS.status, 'p'))

  // 1. Local state first. The timezone is re-read on every open (the user may have travelled).
  const cached = readSettings(store, deps.deviceTimezone())
  let state: CachedSettings = { ...cached, timezone: deps.deviceTimezone() }
  if (!deps.pushFlowEnabled) state.enabled = false
  writeSettings(store, state)
  let userChanged = false

  const render = (): void => {
    renderTimeSelect(select, state.localTime)
    toggle.checked = state.enabled
    toggle.setAttribute('aria-checked', String(state.enabled))
    stateText.textContent = state.enabled ? strings.notificationsOn : strings.notificationsOff
    offHint.hidden = state.enabled
  }
  render()

  const onOutcome = (o: SaveOutcome): void => {
    if (o.kind === 'saved') status.flash(strings.saved)
    else if (o.kind === 'failed') status.flash(strings.saveFailed, NOTICE_VISIBLE_MS)
    else status.flash(o.code === 'CAPACITY_REACHED' ? strings.capacityReached : strings.saveRejected, NOTICE_VISIBLE_MS)
  }

  const queue = createSaveQueue({
    save: (patch) =>
      deps.api ? deps.api.saveSettings(patch) : Promise.resolve({ ok: false as const, code: 'NETWORK', message: 'not configured' }),
    store,
    baseFields: () => ({ localTime: state.localTime, timezone: state.timezone }),
    onOutcome,
    ...(deps.delayMs === undefined ? {} : { delayMs: deps.delayMs }),
  })

  const change = (patch: SettingsPatchInput, next: Partial<CachedSettings>): void => {
    userChanged = true
    state = { ...state, ...next }
    writeSettings(store, state)
    render()
    queue.enqueue(patch)
  }

  // 2. Controls stay interactive at all times; saving happens behind them.
  select.addEventListener('change', () => {
    if (select.value === state.localTime) return
    change({ localTime: select.value }, { localTime: select.value })
  })

  toggle.addEventListener('change', () => {
    const wanted = toggle.checked
    if (wanted && !deps.pushFlowEnabled) {
      toggle.checked = false
      toggle.setAttribute('aria-checked', 'false')
      status.flash(strings.pushComingSoon, NOTICE_VISIBLE_MS)
      return
    }
    if (wanted === state.enabled) return
    change({ enabled: wanted }, { enabled: wanted })
  })

  deps.events.addEventListener('online', () => {
    if (queue.hasPending()) void queue.retry()
  })

  // 3. Background: first deliver anything a previous visit could not save, otherwise adopt the server state.
  const ready = (async () => {
    if (queue.hasPending()) {
      await queue.retry()
      return
    }
    if (!deps.api) return
    let res: Awaited<ReturnType<SettingsApi['getSettings']>>
    try {
      res = await deps.api.getSettings()
    } catch {
      return
    }
    if (!res.ok || res.value === null || userChanged) return
    adopt(res.value)
  })()

  function adopt(server: PublicSettings): void {
    const next: CachedSettings = {
      localTime: server.localTime,
      // Keep the device timezone locally; following a timezone change is Task 07's rule.
      timezone: state.timezone,
      enabled: deps.pushFlowEnabled ? server.enabled : false,
    }
    if (next.localTime === state.localTime && next.enabled === state.enabled) return
    state = next
    writeSettings(store, state)
    render()
  }

  return { state: () => ({ ...state }), queue, status, ready }
}
