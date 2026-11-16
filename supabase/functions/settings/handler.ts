/**
 * Pure request handler for the `settings` Edge Function (spec 04).
 * No Deno or Supabase imports here, so it is testable under Vitest with fakes.
 * The Deno entrypoint (index.ts) wires real auth and storage into `SettingsDeps`.
 */
import {
  applySettingsChange,
  type PushEndpointAllowlist,
  type SettingsPatch,
  type SettingsRequest,
  type SettingsRow,
  type SettingsStore,
} from '../../../src/core/index.ts'

export const MAX_BODY_BYTES = 8 * 1024
export const DEFAULT_MAX_SUBSCRIPTIONS = 5000

export interface SettingsDeps {
  /** Returns the verified user id for the request, or null if unauthenticated. */
  authenticate(req: Request): Promise<string | null>
  store: SettingsStore
  now(): Date
  rng(): number
  maxSubscriptions: number
  /** Exact allowed browser origins (the Pages origin). */
  allowedOrigins: readonly string[]
  /** Also allow http://localhost[:port] (development only). */
  allowLocalhost: boolean
  allowlist?: PushEndpointAllowlist
}

/** Keys accepted in a POST body. `userId` is tolerated but always ignored: identity comes from the JWT. */
const KNOWN_KEYS = new Set(['localTime', 'timezone', 'enabled', 'pushSubscription', 'userId'])

type ErrorCode = 'BAD_REQUEST' | 'UNAUTHORIZED' | 'METHOD_NOT_ALLOWED' | 'CAPACITY_REACHED' | 'INTERNAL'

function corsHeaders(req: Request, deps: SettingsDeps): Record<string, string> {
  const origin = req.headers.get('origin')
  const headers: Record<string, string> = { Vary: 'Origin' }
  if (origin && isOriginAllowed(origin, deps)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info'
    headers['Access-Control-Max-Age'] = '600'
  }
  return headers
}

export function isOriginAllowed(origin: string, deps: Pick<SettingsDeps, 'allowedOrigins' | 'allowLocalhost'>): boolean {
  if (deps.allowedOrigins.includes(origin)) return true
  return deps.allowLocalhost && /^http:\/\/localhost(:\d{1,5})?$/.test(origin)
}

function json(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors },
  })
}

function failure(status: number, code: string, message: string, cors: Record<string, string>): Response {
  return json(status, { code, message }, cors)
}

/** Public view of a row: never the push subscription, counter, or start index. */
function publicSettings(row: SettingsRow) {
  return {
    localTime: row.localTime,
    timezone: row.timezone,
    enabled: row.enabled,
    nextSendAt: row.nextSendAt ? row.nextSendAt.toISOString() : null,
  }
}

type ParsedBody = { ok: true; value: SettingsRequest } | { ok: false; message: string }

function parseBody(text: string, contentType: string | null): ParsedBody {
  if (!contentType || !contentType.toLowerCase().includes('application/json')) {
    return { ok: false, message: 'Content-Type must be application/json' }
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return { ok: false, message: 'Request body too large' }
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, message: 'Malformed JSON' }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, message: 'Body must be a JSON object' }
  }
  const rec = data as Record<string, unknown>
  for (const key of Object.keys(rec)) {
    if (!KNOWN_KEYS.has(key)) return { ok: false, message: `Unknown field: ${key}` }
  }
  const out: SettingsRequest = {}
  if ('localTime' in rec) {
    if (typeof rec['localTime'] !== 'string') return { ok: false, message: 'localTime must be a string' }
    out.localTime = rec['localTime']
  }
  if ('timezone' in rec) {
    if (typeof rec['timezone'] !== 'string') return { ok: false, message: 'timezone must be a string' }
    out.timezone = rec['timezone']
  }
  if ('enabled' in rec) {
    if (typeof rec['enabled'] !== 'boolean') return { ok: false, message: 'enabled must be a boolean' }
    out.enabled = rec['enabled']
  }
  if ('pushSubscription' in rec) {
    const p = rec['pushSubscription']
    if (p !== null && (typeof p !== 'object' || Array.isArray(p))) {
      return { ok: false, message: 'pushSubscription must be an object or null' }
    }
    // Shape (https, allowlisted host, base64url keys, size) is validated by core.
    out.pushSubscription = p as SettingsRequest['pushSubscription'] & object
  }
  return { ok: true, value: out }
}

const sameSub = (a: SettingsRow['pushSubscription'], b: SettingsRow['pushSubscription']) =>
  JSON.stringify(a) === JSON.stringify(b)

/** Only fields that actually changed, so the sender's concurrent progress is never overwritten. */
function diff(current: SettingsRow, next: SettingsRow): SettingsPatch {
  const patch: SettingsPatch = {}
  if (!sameSub(current.pushSubscription, next.pushSubscription)) patch.pushSubscription = next.pushSubscription
  if (current.localTime !== next.localTime) patch.localTime = next.localTime
  if (current.timezone !== next.timezone) patch.timezone = next.timezone
  if (current.enabled !== next.enabled) patch.enabled = next.enabled
  if ((current.nextSendAt?.getTime() ?? null) !== (next.nextSendAt?.getTime() ?? null)) {
    patch.nextSendAt = next.nextSendAt
  }
  return patch
}

export async function handleSettings(req: Request, deps: SettingsDeps): Promise<Response> {
  const cors = corsHeaders(req, deps)
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    if (req.method !== 'GET' && req.method !== 'POST') {
      return failure(405, 'METHOD_NOT_ALLOWED' satisfies ErrorCode, 'Method not allowed', cors)
    }

    const uid = await deps.authenticate(req)
    if (!uid) return failure(401, 'UNAUTHORIZED' satisfies ErrorCode, 'Authentication required', cors)

    if (req.method === 'GET') {
      const row = await deps.store.get(uid)
      return json(200, { settings: row ? publicSettings(row) : null }, cors)
    }

    // POST
    const declared = Number(req.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return failure(400, 'BAD_REQUEST' satisfies ErrorCode, 'Request body too large', cors)
    }
    const parsed = parseBody(await req.text(), req.headers.get('content-type'))
    if (!parsed.ok) return failure(400, 'BAD_REQUEST' satisfies ErrorCode, parsed.message, cors)

    const now = deps.now() // once per request (clock-skew rule)

    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await deps.store.get(uid)

      if (current === null && (await deps.store.count()) >= deps.maxSubscriptions) {
        return failure(
          429,
          'CAPACITY_REACHED' satisfies ErrorCode,
          'We are at capacity right now. Please try again later.',
          cors,
        )
      }

      const result = applySettingsChange(current, parsed.value, now, deps.rng, deps.allowlist)
      if (!result.ok) return failure(400, result.code, result.message, cors)

      if (current === null) {
        const created = await deps.store.create(uid, result.row)
        if (created === 'exists') continue // concurrent first request won; re-apply on top of it
        return json(200, { settings: publicSettings(result.row) }, cors)
      }

      await deps.store.update(uid, diff(current, result.row))
      return json(200, { settings: publicSettings(result.row) }, cors)
    }

    return failure(500, 'INTERNAL' satisfies ErrorCode, 'Something went wrong', cors)
  } catch {
    // Generic on purpose: no stack traces, keys, or row data leave the function.
    return failure(500, 'INTERNAL' satisfies ErrorCode, 'Something went wrong', cors)
  }
}
