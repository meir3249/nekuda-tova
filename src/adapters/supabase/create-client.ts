import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type Fetch = typeof fetch

export interface ClientOptions {
  /** Injectable for tests. */
  fetch?: Fetch
}

function build(url: string, key: string, options: ClientOptions): SupabaseClient {
  if (!url || !key) throw new Error('Supabase URL and key are required')
  return createClient(url, key, {
    // Server-side clients keep no session and never persist anything.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
  })
}

/**
 * Service-role client. Sender and Edge Function only. NEVER import this from `src/pwa`.
 * Keys are never logged by this module.
 */
export function createServiceClient(url: string, serviceRoleKey: string, options: ClientOptions = {}): SupabaseClient {
  return build(url, serviceRoleKey, options)
}
