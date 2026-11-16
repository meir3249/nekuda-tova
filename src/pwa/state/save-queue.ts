import type { PublicSettings, SettingsApiResult, SettingsPatchInput } from '../api/settings-api.ts'
import { readPending, writePending, type KeyValueStore } from './local-cache.ts'

export const SAVE_DEBOUNCE_MS = 400

export type SaveOutcome =
  | { kind: 'saved'; settings: PublicSettings }
  /** Transient (offline, server down, rate limit): the patch is kept and retried. */
  | { kind: 'failed'; code: string }
  /** The server refused this change: retrying would not help, so it is dropped. */
  | { kind: 'rejected'; code: string }

export interface SaveQueueDeps {
  save(patch: SettingsPatchInput): Promise<SettingsApiResult<PublicSettings>>
  store: KeyValueStore
  /** Fields sent with every save, so a first save can create the row (time and timezone are required then). */
  baseFields(): { localTime: string; timezone: string }
  onOutcome(outcome: SaveOutcome): void
  delayMs?: number
}

export interface SaveQueue {
  /** Coalesces `patch` into the pending change, persists it, and (re)starts the debounce. */
  enqueue(patch: SettingsPatchInput): void
  /** Sends the pending change now if there is one (used on `online` and at startup). */
  retry(): Promise<void>
  hasPending(): boolean
  /** Resolves when no save is scheduled or in flight. For tests and orderly shutdown. */
  idle(): Promise<void>
}

/** Codes worth retrying later. Everything else (bad request, capacity reached) is final for this change. */
export function isRetryable(code: string): boolean {
  return code === 'NETWORK' || code === 'INTERNAL' || code === 'UNAUTHORIZED' || code === 'HTTP_429' || /^HTTP_5\d\d$/.test(code)
}

export function createSaveQueue(deps: SaveQueueDeps): SaveQueue {
  const delay = deps.delayMs ?? SAVE_DEBOUNCE_MS
  // Start from whatever a previous visit could not save.
  let pending: SettingsPatchInput | null = readPending(deps.store)
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null
  let changedDuringFlight = false

  const persist = (): void => writePending(deps.store, pending)

  async function send(): Promise<void> {
    if (pending === null) return
    const snapshot = pending
    pending = null
    changedDuringFlight = false

    let result: SettingsApiResult<PublicSettings>
    try {
      result = await deps.save({ ...deps.baseFields(), ...snapshot })
    } catch {
      result = { ok: false, code: 'NETWORK', message: 'request failed' }
    }

    if (result.ok) {
      persist()
      deps.onOutcome({ kind: 'saved', settings: result.value })
    } else if (isRetryable(result.code)) {
      // Newer changes made while the request was in flight win over the snapshot.
      pending = { ...snapshot, ...(pending ?? {}) }
      persist()
      deps.onOutcome({ kind: 'failed', code: result.code })
      return
    } else {
      persist()
      deps.onOutcome({ kind: 'rejected', code: result.code })
    }
    // A change arrived during the request: send it too (after its own debounce, if one is still scheduled).
    if (changedDuringFlight && pending !== null && timer === null) await send()
  }

  function run(): Promise<void> {
    if (inFlight) return inFlight
    inFlight = send().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return {
    enqueue(patch) {
      pending = { ...(pending ?? {}), ...patch }
      if (inFlight) changedDuringFlight = true
      persist()
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (inFlight) {
          // The running request will pick this change up when it finishes.
          changedDuringFlight = true
          return
        }
        void run()
      }, delay)
    },

    retry() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      return run()
    },

    hasPending() {
      return pending !== null
    },

    async idle() {
      while (timer !== null || inFlight !== null) {
        if (inFlight) await inFlight
        else await new Promise((r) => setTimeout(r, delay))
      }
    },
  }
}
