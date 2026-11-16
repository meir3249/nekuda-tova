// Usage: node scripts/build-pwa.ts      (env: PWA_BASE, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
//                                        VITE_VAPID_PUBLIC_KEY, PWA_PRIVACY_URL, PWA_OUT_DIR, PWA_REQUIRE_CONFIG)
// 1. Builds the app with Vite.  2. Lists the output as the app-shell precache.  3. Builds src/pwa/sw.ts as a
// self-contained classic script `sw.js` at the output root, with the precache list and a content hash injected
// (a new deploy always changes sw.js, so browsers pick up the new version).
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build, type LogLevel } from 'vite'
import { appConfig, PWA_ROOT, pwaEnvFrom, type PwaBuildEnv } from './pwa-vite-config.ts'

export const SW_FILE = 'sw.js'

export interface BuildResult {
  outDir: string
  /** Paths relative to the scope; "./" is the app shell (index.html). */
  precache: string[]
  version: string
}

function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')]
  })
}

export async function buildPwa(overrides: Partial<PwaBuildEnv> = {}, logLevel: LogLevel = 'warn'): Promise<BuildResult> {
  const env: PwaBuildEnv = { ...pwaEnvFrom(process.env), ...overrides }

  await build({ configFile: false, logLevel, ...appConfig(env, 'build') })

  const files = listFiles(env.outDir).filter((f) => f !== SW_FILE && !f.endsWith('.map')).sort()
  const hash = createHash('sha256')
  for (const f of files) hash.update(f).update(readFileSync(path.join(env.outDir, f)))
  const version = hash.digest('hex').slice(0, 16)
  const precache = files.map((f) => (f === 'index.html' ? './' : f))

  await build({
    configFile: false,
    logLevel,
    root: PWA_ROOT,
    publicDir: false,
    envDir: false,
    define: {
      __PRECACHE__: JSON.stringify(precache),
      __CACHE_VERSION__: JSON.stringify(version),
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    build: {
      outDir: env.outDir,
      emptyOutDir: false,
      copyPublicDir: false,
      sourcemap: false,
      target: 'es2022',
      lib: { entry: path.join(PWA_ROOT, 'sw.ts'), formats: ['iife'], name: 'ntkServiceWorker', fileName: () => SW_FILE },
    },
  })

  return { outDir: env.outDir, precache, version }
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const env = pwaEnvFrom(process.env)
  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter((k) => !process.env[k]?.trim())
  if (missing.length > 0) {
    const msg = `missing public build variable(s): ${missing.join(', ')}`
    if (process.env['PWA_REQUIRE_CONFIG'] === '1') {
      console.error(`error: ${msg}`)
      process.exit(2)
    }
    console.warn(`warning: ${msg}. The app builds, but saving settings will not work.`)
  }
  const result = await buildPwa({}, 'info')
  console.log(`PWA built to ${path.relative(process.cwd(), result.outDir)} (base ${env.base}, ${result.precache.length} precached files, cache ${result.version})`)
}
