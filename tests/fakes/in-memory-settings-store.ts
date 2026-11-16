import type { SettingsPatch, SettingsStore } from '../../src/core/ports/settings-store.ts'
import type { SettingsRow } from '../../src/core/settings/apply-settings-change.ts'

const copy = (r: SettingsRow): SettingsRow => ({
  ...r,
  pushSubscription: r.pushSubscription ? { ...r.pushSubscription, keys: { ...r.pushSubscription.keys } } : null,
  nextSendAt: r.nextSendAt ? new Date(r.nextSendAt) : null,
})

export class InMemorySettingsStore implements SettingsStore {
  readonly rows = new Map<string, SettingsRow>()
  readonly updates: { id: string; patch: SettingsPatch }[] = []
  writes = 0
  failWith: Error | null = null
  /** Simulates a concurrent first request: the next `create` reports `exists` after inserting `racedRow`. */
  racedRow: SettingsRow | null = null

  get(id: string): Promise<SettingsRow | null> {
    if (this.failWith) return Promise.reject(this.failWith)
    const r = this.rows.get(id)
    return Promise.resolve(r ? copy(r) : null)
  }

  count(): Promise<number> {
    return Promise.resolve(this.rows.size)
  }

  create(id: string, row: SettingsRow): Promise<'created' | 'exists'> {
    if (this.racedRow) {
      this.rows.set(id, copy(this.racedRow))
      this.racedRow = null
      return Promise.resolve('exists')
    }
    if (this.rows.has(id)) return Promise.resolve('exists')
    this.writes++
    this.rows.set(id, copy(row))
    return Promise.resolve('created')
  }

  update(id: string, patch: SettingsPatch): Promise<void> {
    const r = this.rows.get(id)
    if (!r) return Promise.reject(new Error('no row'))
    this.writes++
    this.updates.push({ id, patch })
    if (patch.pushSubscription !== undefined) r.pushSubscription = patch.pushSubscription
    if (patch.localTime !== undefined) r.localTime = patch.localTime
    if (patch.timezone !== undefined) r.timezone = patch.timezone
    if (patch.enabled !== undefined) r.enabled = patch.enabled
    if (patch.nextSendAt !== undefined) r.nextSendAt = patch.nextSendAt
    return Promise.resolve()
  }
}
