import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ContentReadError, RepoFileContentSource } from '../../src/adapters/repo-file/repo-file-content-source.ts'
import { validateContent } from '../../src/core/content/index.ts'
import { FakeContentSource } from '../fakes/fake-content-source.ts'

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures/content')
const dirs: string[] = []

function tmpFile(name: string, bytes: Uint8Array | string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ntk-src-'))
  dirs.push(dir)
  const p = path.join(dir, name)
  writeFileSync(p, bytes)
  return p
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('RepoFileContentSource', () => {
  it('reads a fixture and the validator accepts it', async () => {
    const raw = await new RepoFileContentSource(path.join(FIXTURES, 'valid.json')).loadRaw()
    const r = validateContent(raw)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content.retiredIds).toEqual(['msg_0003'])
  })

  it('reports a missing file as not_found', async () => {
    const err = await new RepoFileContentSource(path.join(FIXTURES, 'nope.json')).loadRaw().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ContentReadError)
    expect((err as ContentReadError).reason).toBe('not_found')
  })

  it('rejects invalid UTF-8 instead of silently replacing bytes', async () => {
    const p = tmpFile('bad.json', Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d]))
    const err = await new RepoFileContentSource(p).loadRaw().catch((e: unknown) => e)
    expect((err as ContentReadError).reason).toBe('invalid_utf8')
  })

  it('keeps a BOM so the validator can strip it', async () => {
    const p = tmpFile('bom.json', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"version":1,"messages":[{"id":"msg_0001","content":"a"}]}')]))
    const raw = await new RepoFileContentSource(p).loadRaw()
    expect(raw.charCodeAt(0)).toBe(0xfeff)
    expect(validateContent(raw).ok).toBe(true)
  })
})

describe('FakeContentSource', () => {
  it('returns text, can change, and can fail', async () => {
    const s = new FakeContentSource('a')
    expect(await s.loadRaw()).toBe('a')
    s.set('b')
    expect(await s.loadRaw()).toBe('b')
    s.failWith(new Error('boom'))
    await expect(s.loadRaw()).rejects.toThrow('boom')
  })
})
