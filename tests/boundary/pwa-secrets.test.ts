import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Spec 04 acceptance 10 (source-level part): the PWA must never reference the service-role key,
 * the VAPID private key, or the service-client factory. When a build exists (Task 6) the
 * bundle scan below also covers `dist/`.
 */
function files(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
}

const FORBIDDEN = [/service[_-]?role/i, /SUPABASE_SERVICE/i, /VAPID_PRIVATE/i, /create-client\.ts/, /createServiceClient/]

describe('PWA secrets hygiene', () => {
  it('src/pwa contains no service-role or VAPID-private references', () => {
    for (const f of files('src/pwa')) {
      const text = readFileSync(f, 'utf8')
      for (const re of FORBIDDEN) expect(text, `${f} matches ${String(re)}`).not.toMatch(re)
    }
  })

  it('built bundle (if present) contains no service-role or VAPID-private references', () => {
    for (const f of files('dist').filter((p) => /\.(js|html|json|map)$/.test(p))) {
      const text = readFileSync(f, 'utf8')
      for (const re of FORBIDDEN.slice(0, 3)) expect(text, `${f} matches ${String(re)}`).not.toMatch(re)
    }
  })
})
