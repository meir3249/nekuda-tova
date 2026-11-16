/**
 * Public build-time configuration, injected by the Vite config as `__NTK_CONFIG__`.
 * Only public values: the project URL, the anon/publishable key (RLS protects the data) and the VAPID public key.
 */
export interface PwaConfig {
  supabaseUrl: string
  anonKey: string
  vapidPublicKey: string
}

declare const __NTK_CONFIG__: PwaConfig | undefined

export function pwaConfig(): PwaConfig {
  const c = typeof __NTK_CONFIG__ === 'undefined' ? undefined : __NTK_CONFIG__
  return { supabaseUrl: c?.supabaseUrl ?? '', anonKey: c?.anonKey ?? '', vapidPublicKey: c?.vapidPublicKey ?? '' }
}
