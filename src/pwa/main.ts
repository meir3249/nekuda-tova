// PWA entry point: wires the real browser and Supabase into the settings screen.
import { createSettingsApi } from './api/settings-api.ts'
import { PUSH_FLOW_ENABLED, pwaConfig } from './config.ts'
import { pickStore } from './state/local-cache.ts'
import { startSettingsScreen } from './ui/settings-screen.ts'

const config = pwaConfig()

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// Without a configured backend (e.g. a local build with no env) the screen still works; saves stay pending.
const api = config.supabaseUrl && config.anonKey ? createSettingsApi({ supabaseUrl: config.supabaseUrl, anonKey: config.anonKey }) : null

startSettingsScreen({
  doc: document,
  store: pickStore(() => window.localStorage),
  api,
  deviceTimezone,
  events: window,
  pushFlowEnabled: PUSH_FLOW_ENABLED,
})

// Registration failing (unsupported, blocked, http) never affects the screen.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {})
}
