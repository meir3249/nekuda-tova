// Dev server and app build for the PWA. `npm run build:pwa` (scripts/build-pwa.ts) is the full build,
// including the service worker; plain `vite build` would produce an app without sw.js.
import { defineConfig } from 'vite'
import { appConfig, pwaEnvFrom } from './scripts/pwa-vite-config.ts'

export default defineConfig(({ command }) => appConfig(pwaEnvFrom(process.env), command))
