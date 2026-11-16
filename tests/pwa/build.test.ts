import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPwa, type BuildResult } from '../../scripts/build-pwa.ts'
import { normalizeBase } from '../../scripts/pwa-vite-config.ts'
import { PRODUCT_NAME } from '../../src/pwa/strings.ts'

// Builds the real PWA once into a temp directory and checks the output (spec 06 acceptance 1, 3, 5, 6).
const SUPABASE = 'https://test-ref.supabase.co'
let out: string
let result: BuildResult
const read = (f: string) => readFileSync(path.join(out, f), 'utf8')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
}

function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file)
  expect(b.subarray(1, 4).toString('ascii')).toBe('PNG')
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

beforeAll(async () => {
  out = mkdtempSync(path.join(tmpdir(), 'ntk-pwa-'))
  result = await buildPwa(
    { outDir: out, base: '/nekuda-tova/', supabaseUrl: SUPABASE, anonKey: 'sb_publishable_test', vapidPublicKey: '', privacyUrl: '' },
    'silent',
  )
}, 120_000)

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true })
})

describe('PWA build output', () => {
  it('emits index.html, sw.js at the base root, the manifest and icons', () => {
    for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png']) {
      expect(existsSync(path.join(out, f)), f).toBe(true)
    }
  })

  it('asset URLs use the Pages base path', () => {
    const html = read('index.html')
    expect(html).toMatch(/src="\/nekuda-tova\/assets\/index-[\w-]+\.js"/)
    expect(html).toMatch(/href="\/nekuda-tova\/assets\/index-[\w-]+\.css"/)
  })

  it('the Rubik font is self-hosted under the base path, precached, and shipped with its license', () => {
    const cssFile = files(out).find((f) => /assets[\\/]index-[\w-]+\.css$/.test(f))!
    const css = readFileSync(cssFile, 'utf8')
    expect(css).toMatch(/url\(\/nekuda-tova\/fonts\/rubik-hebrew\.woff2\)|url\("?\/nekuda-tova\/fonts\/rubik-hebrew\.woff2"?\)/)
    expect(css).toMatch(/font-family:\s*Rubik/)
    expect(css).not.toMatch(/fonts\.(googleapis|gstatic)\.com/)
    expect(read('index.html')).not.toMatch(/fonts\.(googleapis|gstatic)\.com/)
    for (const f of ['fonts/rubik-hebrew.woff2', 'fonts/rubik-latin.woff2', 'fonts/OFL.txt']) expect(existsSync(path.join(out, f)), f).toBe(true)
    expect(result.precache).toContain('fonts/rubik-hebrew.woff2')
    expect(result.precache).toContain('fonts/rubik-latin.woff2')
  })

  it('the precache is the app shell: "./" plus static files, never sw.js', () => {
    expect(result.precache).toContain('./')
    expect(result.precache).toContain('manifest.webmanifest')
    expect(result.precache.some((p) => /^assets\/index-.*\.js$/.test(p))).toBe(true)
    expect(result.precache).not.toContain('sw.js')
    expect(result.precache).not.toContain('index.html')
    const sw = read('sw.js')
    for (const p of result.precache) expect(sw).toContain(p)
    expect(sw).toContain(result.version)
  })

  it('sw.js is a classic self-contained script (no import/export statements)', () => {
    const sw = read('sw.js')
    expect(sw).not.toMatch(/\bimport\s*[{(*"']|\bexport\s/)
  })

  it('acceptance 5: no notification-click navigation in sw.js', () => {
    const sw = read('sw.js')
    expect(sw).not.toContain('openWindow')
    expect(sw).not.toMatch(/focus\(/)
    expect(sw).not.toMatch(/navigate\(/)
    expect(sw).toContain('notificationclick')
    expect(sw).toMatch(/\.close\(\)/)
  })

  it('sw.js handles push and pushsubscriptionchange, and stays free of page/UI code', () => {
    const sw = read('sw.js')
    expect(sw).toMatch(/addEventListener\(["`']push["`']/)
    expect(sw).toContain('pushsubscriptionchange')
    expect(sw).toContain('ntk:pushsubscriptionchange')
    expect(sw).not.toMatch(/getElementById|localStorage|supabase/i)
  })

  it('the service worker never touches other origins (Supabase is not intercepted or cached)', () => {
    const sw = read('sw.js')
    expect(sw).toContain('self.location.origin')
    expect(sw).not.toContain('supabase')
  })

  it('acceptance 6: the CSP allows only this origin plus the Supabase project, with no inline script', () => {
    const html = read('index.html')
    const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)
    expect(m).not.toBeNull()
    const csp = m![1]!.replace(/&#39;/g, "'")
    const directives = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]))
    expect(directives['default-src']).toEqual(["'self'"])
    expect(directives['script-src']).toEqual(["'self'"])
    expect(directives['style-src']).toEqual(["'self'"])
    expect(directives['connect-src']).toEqual(["'self'", SUPABASE])
    expect(directives['font-src']).toEqual(["'self'"])
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*/)
  })

  it('acceptance 6: the HTML loads nothing from another origin', () => {
    const html = read('index.html')
    const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((r) => r[1]!)
    expect(refs.length).toBeGreaterThan(3)
    for (const r of refs) expect(r, r).toMatch(/^(\.\/|\/nekuda-tova\/)/)
    expect(html).not.toMatch(/fonts\.googleapis|googletagmanager|analytics|cdn\./i)
  })

  it('the bundle contains no server secrets and no sender code', () => {
    for (const f of files(out).filter((p) => /\.(js|html|json|webmanifest)$/.test(p))) {
      const text = readFileSync(f, 'utf8')
      // supabase-js itself contains the bare prefix check startsWith('sb_secret_'); a real key has characters after it.
      expect(text, f).not.toMatch(/service[_-]?role|SUPABASE_SERVICE|VAPID_PRIVATE|sb_secret_[A-Za-z0-9_-]{8,}/i)
      expect(text, f).not.toMatch(/vapidDetails|setVapidDetails|web-push/)
    }
  })

  it('the build embeds the public config only', () => {
    const js = files(path.join(out, 'assets')).filter((p) => p.endsWith('.js')).map((p) => readFileSync(p, 'utf8')).join('\n')
    expect(js).toContain(SUPABASE)
    expect(js).toContain('sb_publishable_test')
  })
})

describe('manifest and icons (acceptance 1, static part)', () => {
  it('manifest: Hebrew RTL, standalone, relative start_url/scope, 192/512/maskable icons', () => {
    const m = JSON.parse(read('manifest.webmanifest')) as Record<string, unknown>
    expect(m).toMatchObject({ name: PRODUCT_NAME, short_name: PRODUCT_NAME, lang: 'he', dir: 'rtl', display: 'standalone', start_url: './', scope: './' })
    const icons = m['icons'] as { src: string; sizes: string; purpose: string }[]
    expect(icons.map((i) => `${i.sizes}:${i.purpose}`).sort()).toEqual(['192x192:any', '512x512:any', '512x512:maskable'])
    for (const i of icons) {
      const [w, h] = i.sizes.split('x').map(Number)
      expect(pngSize(path.join(out, i.src)), i.src).toEqual({ w, h })
    }
    expect(pngSize(path.join(out, 'icons/apple-touch-icon.png'))).toEqual({ w: 180, h: 180 })
  })
})

describe('base path normalization', () => {
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['/', '/'],
    ['nekuda-tova', '/nekuda-tova/'],
    ['/nekuda-tova', '/nekuda-tova/'],
    ['/nekuda-tova/', '/nekuda-tova/'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeBase(input)).toBe(expected)
  })
})
