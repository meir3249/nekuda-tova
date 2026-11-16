import { isValidSlot } from '../../core/index.ts'
import type { SettingsPatchInput } from '../api/settings-api.ts'

export const SETTINGS_KEY = 'ntk.settings.v1'
export const PENDING_KEY = 'ntk.pending.v1'

/** P-13: default slot until the user chooses one. P-15: off until the user turns it on. */
export const DEFAULT_TIME = '09:00'

export interface CachedSettings {
  localTime: string
  timezone: string
  enabled: boolean
}

/** The subset of `Storage` we use. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** In-memory store: the fallback when `localStorage` is unavailable (private mode, blocked storage). */
export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
}

/** Returns `localStorage` if it actually works (probe write), otherwise an in-memory store. */
export function pickStore(getLocalStorage: () => KeyValueStore | undefined): KeyValueStore {
  try {
    const ls = getLocalStorage()
    if (ls) {
      const probe = '__ntk_probe__'
      ls.setItem(probe, '1')
      ls.removeItem(probe)
      return ls
    }
  } catch {
    /* access denied or quota: fall through */
  }
  return new MemoryStore()
}

/** Never throws: a broken store degrades to "nothing cached". */
function safeGet(store: KeyValueStore, key: string): unknown {
  try {
    const raw = store.getItem(key)
    return raw === null ? null : (JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

function safeSet(store: KeyValueStore, key: string, value: unknown): void {
  try {
    store.setItem(key, JSON.stringify(value))
  } catch {
    /* quota or access error: the in-page state still works */
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Cached settings, each field validated separately; anything invalid falls back to defaults. */
export function readSettings(store: KeyValueStore, deviceTimezone: string): CachedSettings {
  const v = safeGet(store, SETTINGS_KEY)
  const rec = isRecord(v) ? v : {}
  return {
    localTime: typeof rec['localTime'] === 'string' && isValidSlot(rec['localTime']) ? rec['localTime'] : DEFAULT_TIME,
    timezone: typeof rec['timezone'] === 'string' && rec['timezone'] !== '' ? rec['timezone'] : deviceTimezone,
    enabled: rec['enabled'] === true,
  }
}

export function writeSettings(store: KeyValueStore, s: CachedSettings): void {
  safeSet(store, SETTINGS_KEY, { localTime: s.localTime, timezone: s.timezone, enabled: s.enabled })
}

/** A patch that has not reached the server yet. Only known, valid fields survive a read. */
export function readPending(store: KeyValueStore): SettingsPatchInput | null {
  const v = safeGet(store, PENDING_KEY)
  if (!isRecord(v)) return null
  const out: SettingsPatchInput = {}
  if (typeof v['localTime'] === 'string' && isValidSlot(v['localTime'])) out.localTime = v['localTime']
  if (typeof v['timezone'] === 'string' && v['timezone'] !== '') out.timezone = v['timezone']
  if (typeof v['enabled'] === 'boolean') out.enabled = v['enabled']
  return Object.keys(out).length === 0 ? null : out
}

export function writePending(store: KeyValueStore, patch: SettingsPatchInput | null): void {
  if (patch === null) {
    try {
      store.removeItem(PENDING_KEY)
    } catch {
      /* ignore */
    }
    return
  }
  // Push subscriptions are never persisted in the pending queue: they are re-read from the browser (Task 07).
  const { localTime, timezone, enabled } = patch
  safeSet(store, PENDING_KEY, { localTime, timezone, enabled })
}
