import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findViolations, importSpecifiers } from './check-boundaries.ts'

const REAL_SRC = path.resolve(import.meta.dirname, '../../src')

describe('architecture boundaries (real tree)', () => {
  it('has no violations in src/', () => {
    expect(findViolations(REAL_SRC)).toEqual([])
  })
})

describe('boundary checker detects violations (fixtures)', () => {
  const dirs: string[] = []

  function fixture(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ntk-boundary-'))
    dirs.push(root)
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel)
      mkdirSync(path.dirname(full), { recursive: true })
      writeFileSync(full, content)
    }
    return root
  }

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('accepts a clean core', () => {
    const root = fixture({
      'core/a.ts': "import { b } from './sub/b.ts'\nexport const a = b\n",
      'core/sub/b.ts': "import type { X } from '../a.ts'\nexport const b = 1\nexport type Y = X\n",
    })
    expect(findViolations(root)).toEqual([])
  })

  it('flags node: built-ins and packages in core', () => {
    const root = fixture({
      'core/a.ts': "import fs from 'node:fs'\nexport const a = fs\n",
      'core/b.ts': "import { createClient } from '@supabase/supabase-js'\nexport const b = createClient\n",
    })
    const rules = findViolations(root).map((v) => `${path.basename(v.file)}:${v.rule}`)
    expect(rules.sort()).toEqual(['a.ts:core-no-external-imports', 'b.ts:core-no-external-imports'])
  })

  it('flags relative paths that escape core', () => {
    const root = fixture({
      'core/a.ts': "import { x } from '../adapters/system/x.ts'\nexport const a = x\n",
      'adapters/system/x.ts': 'export const x = 1\n',
    })
    expect(findViolations(root).map((v) => v.rule)).toEqual(['core-no-escaping-imports'])
  })

  it('flags type-only, dynamic, export-from and require forms', () => {
    const root = fixture({
      'core/a.ts': "import type { T } from 'some-pkg'\nexport type U = T\n",
      'core/b.ts': "export const f = () => import('node:fs')\n",
      'core/c.ts': "export { z } from 'other-pkg'\n",
      'core/d.cjs': "const w = require('web-push')\nmodule.exports = w\n",
    })
    expect(findViolations(root)).toHaveLength(4)
  })

  it('flags adapters importing each other', () => {
    const root = fixture({
      'adapters/one/a.ts': "import { b } from '../two/b.ts'\nexport const a = b\n",
      'adapters/two/b.ts': 'export const b = 1\n',
    })
    expect(findViolations(root).map((v) => v.rule)).toEqual(['adapters-no-cross-imports'])
  })

  it('allows adapters to import core', () => {
    const root = fixture({
      'core/c.ts': 'export const c = 1\n',
      'adapters/one/a.ts': "import { c } from '../../core/c.ts'\nexport const a = c\n",
    })
    expect(findViolations(root)).toEqual([])
  })

  it('flags pwa importing sender or the web-push adapter', () => {
    const root = fixture({
      'sender/main.ts': 'export const m = 1\n',
      'adapters/web-push/w.ts': 'export const w = 1\n',
      'pwa/a.ts': "import { m } from '../sender/main.ts'\nexport const a = m\n",
      'pwa/b.ts': "import { w } from '../adapters/web-push/w.ts'\nexport const b = w\n",
    })
    expect(findViolations(root).map((v) => v.rule)).toEqual([
      'pwa-no-sender-or-web-push',
      'pwa-no-sender-or-web-push',
    ])
  })
})

describe('importSpecifiers', () => {
  it('finds static, type, dynamic, re-export and require specifiers', () => {
    const src = [
      "import a from 'a'",
      "import type { B } from 'b'",
      "export * from 'c'",
      "const d = import('d')",
      "const e = require('e')",
    ].join('\n')
    expect(importSpecifiers(src).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})
