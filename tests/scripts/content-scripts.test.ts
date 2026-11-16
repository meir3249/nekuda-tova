import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '../..')
const FIXTURES = path.join(ROOT, 'tests/fixtures/content')
const dirs: string[] = []

function run(script: string, args: string[]) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
  })
  return { code: r.status, out: r.stdout + r.stderr }
}

function tmp(content: unknown): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ntk-script-'))
  dirs.push(dir)
  const p = path.join(dir, 'f.json')
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  return p
}

const file = (ids: string[], retired: string[] = []) => ({
  version: 1,
  retiredIds: retired,
  messages: ids.map((id) => ({ id, content: `text ${id}` })),
})

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('validate-content.ts', () => {
  it('exit 0 on the shipped data/messages.json (default path)', () => {
    const r = run('validate-content.ts', [])
    expect(r.code).toBe(0)
    expect(r.out).toContain('OK (12 messages')
  })

  it('exit 0 on a valid fixture', () => {
    expect(run('validate-content.ts', [path.join(FIXTURES, 'valid.json')]).code).toBe(0)
  })

  it('exit 1 on truncated JSON, empty messages, and unsupported version', () => {
    const cases: [string, string][] = [
      ['truncated.json', 'INVALID_JSON'],
      ['empty-messages.json', 'EMPTY_MESSAGES'],
      ['version-2.json', 'UNSUPPORTED_VERSION'],
    ]
    for (const [name, code] of cases) {
      const r = run('validate-content.ts', [path.join(FIXTURES, name)])
      expect(r.code).toBe(1)
      expect(r.out).toContain(code)
    }
  })

  it('exit 2 for a missing file and for bad usage', () => {
    expect(run('validate-content.ts', [path.join(FIXTURES, 'missing.json')]).code).toBe(2)
    expect(run('validate-content.ts', ['a', 'b']).code).toBe(2)
  })

  it('exit 1 for invalid UTF-8', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ntk-script-'))
    dirs.push(dir)
    const p = path.join(dir, 'bad.json')
    writeFileSync(p, Uint8Array.from([0x7b, 0xff, 0x7d]))
    expect(run('validate-content.ts', [p]).code).toBe(1)
  })
})

describe('check-content-diff.ts', () => {
  const A = 'msg_0001'
  const B = 'msg_0002'
  const C = 'msg_0003'

  it('add (append): exit 0 with a warning', () => {
    const r = run('check-content-diff.ts', [tmp(file([A, B])), tmp(file([A, B, C]))])
    expect(r.code).toBe(0)
    expect(r.out).toContain('COUNT_CHANGED')
  })

  it('edit only: exit 0, no warnings', () => {
    const base = file([A, B])
    const head = { ...base, messages: [{ id: A, content: 'edited' }, base.messages[1]] }
    const r = run('check-content-diff.ts', [tmp(base), tmp(head)])
    expect(r.code).toBe(0)
    expect(r.out).not.toContain('WARN')
  })

  it('remove with retire: exit 0', () => {
    expect(run('check-content-diff.ts', [tmp(file([A, B, C])), tmp(file([A, C], [B]))]).code).toBe(0)
  })

  it('remove without retire: exit 1', () => {
    const r = run('check-content-diff.ts', [tmp(file([A, B, C])), tmp(file([A, C]))])
    expect(r.code).toBe(1)
    expect(r.out).toContain('ID_REMOVED_WITHOUT_RETIRE')
  })

  it('reorder: exit 0 with ORDER_CHANGED warning', () => {
    const r = run('check-content-diff.ts', [tmp(file([A, B, C])), tmp(file([B, A, C]))])
    expect(r.code).toBe(0)
    expect(r.out).toContain('ORDER_CHANGED')
  })

  it('missing base file: skipped, exit 0', () => {
    const r = run('check-content-diff.ts', [path.join(FIXTURES, 'no-base.json'), path.join(FIXTURES, 'valid.json')])
    expect(r.code).toBe(0)
    expect(r.out).toContain('skipped')
  })

  it('invalid head: exit 1; usage error: exit 2', () => {
    expect(run('check-content-diff.ts', [tmp(file([A])), path.join(FIXTURES, 'truncated.json')]).code).toBe(1)
    expect(run('check-content-diff.ts', ['only-one']).code).toBe(2)
  })
})
