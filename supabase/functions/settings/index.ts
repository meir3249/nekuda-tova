// Deno entrypoint for the `settings` Edge Function. Excluded from `tsc` (Deno globals);
// all logic lives in handler.ts, which is unit-tested under Vitest.
//
// Required secrets (set with `supabase secrets set`; never committed):
//   SUPABASE_URL and a server key (SUPABASE_SECRET_KEYS, or legacy SUPABASE_SERVICE_ROLE_KEY):
//                          injected automatically by the platform; never set or committed by us
//   ALLOWED_ORIGINS        comma-separated browser origins, e.g. https://<user>.github.io
//   ALLOW_LOCALHOST        "true" only for development
//   MAX_SUBSCRIPTIONS      optional, default 5000 (P-09)
import { createClient } from '@supabase/supabase-js'
import { SupabaseSettingsStore } from '../../../src/adapters/supabase/supabase-settings-store.ts'
import { DEFAULT_MAX_SUBSCRIPTIONS, handleSettings } from './handler.ts'

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

const url = Deno.env.get('SUPABASE_URL') ?? ''
// New projects expose `SUPABASE_SECRET_KEYS` (JSON dict); older ones the legacy service-role variable.
function serverKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  try {
    const dict = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>
    return dict['default'] ?? Object.values(dict)[0] ?? ''
  } catch {
    return ''
  }
}
const serviceKey = serverKey()

const client = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
const store = new SupabaseSettingsStore(client)

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const parsedMax = Number(Deno.env.get('MAX_SUBSCRIPTIONS'))
const maxSubscriptions = Number.isInteger(parsedMax) && parsedMax > 0 ? parsedMax : DEFAULT_MAX_SUBSCRIPTIONS

Deno.serve((req) =>
  handleSettings(req, {
    // The platform already verified the JWT signature (verify_jwt = true); resolve the user id from it.
    async authenticate(r) {
      const header = r.headers.get('authorization') ?? ''
      const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
      if (!token) return null
      const { data, error } = await client.auth.getUser(token)
      return error || !data.user ? null : data.user.id
    },
    store,
    now: () => new Date(),
    rng: Math.random,
    maxSubscriptions,
    allowedOrigins,
    allowLocalhost: Deno.env.get('ALLOW_LOCALHOST') === 'true',
  }),
)
