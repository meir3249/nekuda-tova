import path from 'node:path'
import type { Plugin, UserConfig } from 'vite'
import { originOf, renderIndexHtml } from './pwa-html.ts'

export const PWA_ROOT = path.resolve('src/pwa')

/** Public build inputs. Never secrets: the anon key is public by design (RLS protects the data). */
export interface PwaBuildEnv {
  /** Pages base path, e.g. "/nekuda-tova/" (Q-02). */
  base: string
  supabaseUrl: string
  anonKey: string
  vapidPublicKey: string
  privacyUrl: string
  outDir: string
}

export function normalizeBase(base: string | undefined): string {
  const b = (base ?? '/').trim() || '/'
  return `/${b.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/')
}

export function pwaEnvFrom(env: Readonly<Record<string, string | undefined>>): PwaBuildEnv {
  return {
    base: normalizeBase(env['PWA_BASE']),
    supabaseUrl: env['VITE_SUPABASE_URL']?.trim() ?? '',
    anonKey: env['VITE_SUPABASE_ANON_KEY']?.trim() ?? '',
    vapidPublicKey: env['VITE_VAPID_PUBLIC_KEY']?.trim() ?? '',
    privacyUrl: env['PWA_PRIVACY_URL']?.trim() ?? '',
    outDir: path.resolve(env['PWA_OUT_DIR'] ?? 'dist'),
  }
}

function htmlPlugin(env: PwaBuildEnv, isBuild: boolean): Plugin {
  const supabaseOrigin = originOf(env.supabaseUrl)
  return {
    name: 'ntk-index-html',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return renderIndexHtml(html, {
          // The dev server injects inline HMR code, so the CSP is applied to builds only.
          connectOrigins: isBuild ? (supabaseOrigin ? [supabaseOrigin] : []) : null,
          privacyUrl: env.privacyUrl,
        })
      },
    },
  }
}

/** Vite config for the app (index.html + main.ts). The service worker is a second build (scripts/build-pwa.ts). */
export function appConfig(env: PwaBuildEnv, command: 'build' | 'serve'): UserConfig {
  return {
    root: PWA_ROOT,
    base: env.base,
    publicDir: 'public',
    envDir: false,
    plugins: [htmlPlugin(env, command === 'build')],
    define: {
      __NTK_CONFIG__: JSON.stringify({ supabaseUrl: env.supabaseUrl, anonKey: env.anonKey, vapidPublicKey: env.vapidPublicKey }),
    },
    build: {
      outDir: env.outDir,
      emptyOutDir: true,
      sourcemap: false,
      target: 'es2022',
      assetsInlineLimit: 0,
    },
  }
}
