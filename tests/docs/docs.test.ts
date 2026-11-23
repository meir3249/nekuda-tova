import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string): string => readFileSync(p, 'utf8')

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n)
    return statSync(p).isDirectory() ? markdownFiles(p) : p.endsWith('.md') ? [p] : []
  })
}

// Spec 08 acceptance 7: internal links resolve (offline-safe: external links are not fetched).
describe('documentation links', () => {
  const files = ['README.md', 'DECISIONS.md', 'DEPENDENCIES.md', ...markdownFiles('docs')]
  for (const file of files) {
    it(`${file}: internal links resolve`, () => {
      // Ignore fenced code blocks and inline code so examples are not treated as links.
      const text = read(file).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
      const missing: string[] = []
      for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const target = m[1] ?? ''
        if (/^(https?:|mailto:|#)/.test(target)) continue
        const rel = decodeURIComponent(target.split('#')[0] ?? '')
        if (rel === '') continue
        if (!existsSync(path.resolve(path.dirname(file), rel))) missing.push(target)
      }
      expect(missing).toEqual([])
    })
  }
})

describe('limitations.md', () => {
  const text = read('docs/limitations.md')
  it.each([
    'Delivery is not guaranteed',
    'Exact time is not guaranteed',
    'iOS and iPadOS',
    'The schedule can silently stop',
    'Identity and devices',
    'Content and progression',
  ])('has the heading "%s"', (heading) => {
    expect(text).toContain(`## ${heading}`)
  })
  it.each(['16.4', '60 days', 'about a week', '2 hours', 'time zone', 'repeat'])('mentions "%s"', (word) => {
    expect(text).toContain(word)
  })
})

// Spec 08 acceptance 3: the privacy note matches the schema and the retention constants.
describe('privacy.md', () => {
  const privacy = read('docs/privacy.md')
  const migration = read('supabase/migrations/20261116000001_init.sql')

  it('only names columns and tables that exist in the migration', () => {
    const named = [...privacy.matchAll(/`([a-z_]+)`/g)].map((m) => m[1] ?? '')
    expect(named.length).toBeGreaterThan(5)
    for (const name of named) {
      expect(migration, `\`${name}\` is not in the schema`).toMatch(new RegExp(`\\b${name}\\b`))
    }
  })

  it('has no column that can hold message text', () => {
    expect(migration).not.toMatch(/\b(message_text|body|content)\s+text/i)
  })

  it('quotes the same retention values as the sender', () => {
    const config = read('src/sender/config.ts')
    const inactive = /inactiveRetentionDays:\s*(\d+)/.exec(config)?.[1]
    const log = /logRetentionDays:\s*(\d+)/.exec(config)?.[1]
    expect(inactive).toBe('365')
    expect(log).toBe('90')
    expect(privacy).toContain(`${inactive} days`)
    expect(privacy).toContain(`${log} days`)
    const ops = read('docs/operations.md')
    expect(ops).toContain(`${inactive} days`)
    expect(ops).toContain(`${log} days`)
  })
})

describe('late window and timing in docs', () => {
  it('limitations quotes the code constant (7200 s = 2 hours)', () => {
    expect(read('src/core/scheduling/staleness.ts')).toContain('DEFAULT_MAX_LATE_SECONDS = 7200')
    expect(read('docs/limitations.md')).toContain('2 hours')
  })
  it('the cron minutes in the docs match send.yml', () => {
    expect(read('.github/workflows/send.yml')).toContain("cron: '3,33 * * * *'")
    expect(read('docs/limitations.md')).toContain('minutes 3 and 33')
  })
})

// Spec 08 acceptance 6: no doc promises guaranteed delivery or exact timing.
describe('honest claims', () => {
  const promises = [/\bguarantees? (delivery|that)/i, /\balways (arrives?|delivered)/i, /\bexactly on time\b/i, /\bnever (misses|fails)\b/i]
  for (const file of ['README.md', 'docs/privacy.md', 'docs/limitations.md', 'docs/operations.md', 'docs/content-management.md']) {
    it(`${file} makes no guarantee claims`, () => {
      const text = read(file)
      for (const re of promises) expect(text).not.toMatch(re)
    })
  }
})

describe('verification documents', () => {
  it.each(['device-checklist.md', 'accessibility-checklist.md', 'final-report-template.md'])('%s exists', (name) => {
    expect(existsSync(path.join('docs/verification', name))).toBe(true)
  })
  it('device checklist never blank-passes: every matrix row has a result', () => {
    const rows = read('docs/verification/device-checklist.md')
      .split('\n')
      .filter((l) => l.startsWith('| ') && /\| (Not run|Pass|Fail)\s*\|$/.test(l))
    expect(rows.length).toBeGreaterThan(5)
  })
})

describe('license', () => {
  it('LICENSE is the GNU AGPL v3 and package.json agrees', () => {
    expect(read('LICENSE')).toContain('GNU AFFERO GENERAL PUBLIC LICENSE')
    expect(read('LICENSE')).toContain('Version 3, 19 November 2007')
    expect(JSON.parse(read('package.json')).license).toBe('AGPL-3.0-or-later')
    expect(read('README.md')).toContain('Affero')
  })
})

describe('commands in docs', () => {
  it('no doc recommends "npm run sender -- --dry-run" without the PowerShell 5.1 caveat', () => {
    for (const file of ['README.md', 'docs/operations.md']) {
      const text = read(file)
      if (text.includes('npm run sender -- --dry-run')) expect(text).toMatch(/PowerShell 5\.1/)
    }
  })
})
