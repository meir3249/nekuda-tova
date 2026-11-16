import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { StoredPushSubscription } from '../../core/index.ts'

/** Public settings as returned by the `settings` function (never the subscription or counter). */
export interface PublicSettings {
  localTime: string
  timezone: string
  enabled: boolean
  nextSendAt: string | null
}

export interface SettingsPatchInput {
  localTime?: string
  timezone?: string
  enabled?: boolean
  pushSubscription?: StoredPushSubscription | null
}

export type SettingsApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string }

export interface SettingsApiConfig {
  /** Public project URL (build-time public env). */
  supabaseUrl: string
  /** Public anon key (build-time public env). Never a server-side secret key. */
  anonKey: string
  fetch?: typeof fetch
  /** Injectable for tests. */
  client?: SupabaseClient
}

export interface SettingsApi {
  /** Signs in anonymously on first call (lazy, P-15) and returns the user id. */
  ensureSession(): Promise<string>
  /** Reads settings; returns `null` settings if there is no session yet (no anonymous user is created). */
  getSettings(): Promise<SettingsApiResult<PublicSettings | null>>
  saveSettings(patch: SettingsPatchInput): Promise<SettingsApiResult<PublicSettings>>
}

export function createSettingsApi(config: SettingsApiConfig): SettingsApi {
  const client = config.client ?? createClient(config.supabaseUrl, config.anonKey)
  const doFetch = config.fetch ?? fetch
  const endpoint = `${config.supabaseUrl.replace(/\/+$/, '')}/functions/v1/settings`

  async function accessToken(create: boolean): Promise<{ token: string; userId: string } | null> {
    const existing = await client.auth.getSession()
    const session = existing.data.session
    if (session) return { token: session.access_token, userId: session.user.id }
    if (!create) return null
    const { data, error } = await client.auth.signInAnonymously()
    if (error || !data.session) throw new Error('Could not start an anonymous session')
    return { token: data.session.access_token, userId: data.session.user.id }
  }

  async function call(method: 'GET' | 'POST', token: string, body?: unknown): Promise<SettingsApiResult<unknown>> {
    let res: Response
    try {
      res = await doFetch(endpoint, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: config.anonKey,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      return { ok: false, code: 'NETWORK', message: 'Could not reach the server' }
    }
    let data: unknown = null
    try {
      data = await res.json()
    } catch {
      /* non-JSON error body */
    }
    const rec = (data ?? {}) as { code?: unknown; message?: unknown; settings?: unknown }
    if (!res.ok) {
      return {
        ok: false,
        code: typeof rec.code === 'string' ? rec.code : `HTTP_${res.status}`,
        message: typeof rec.message === 'string' ? rec.message : 'Request failed',
      }
    }
    return { ok: true, value: rec.settings ?? null }
  }

  return {
    async ensureSession() {
      const s = await accessToken(true)
      if (!s) throw new Error('No session')
      return s.userId
    },

    async getSettings() {
      const s = await accessToken(false)
      if (!s) return { ok: true, value: null }
      const r = await call('GET', s.token)
      return r.ok ? { ok: true, value: r.value as PublicSettings | null } : r
    },

    async saveSettings(patch) {
      let s: { token: string; userId: string } | null
      try {
        s = await accessToken(true)
      } catch {
        return { ok: false, code: 'NETWORK', message: 'Could not start a session' }
      }
      if (!s) return { ok: false, code: 'NETWORK', message: 'Could not start a session' }
      const r = await call('POST', s.token, patch)
      if (!r.ok) return r
      return { ok: true, value: r.value as PublicSettings }
    },
  }
}
