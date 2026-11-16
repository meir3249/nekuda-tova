import { describe, expect, it } from 'vitest'
import { validateContent } from '../../../src/core/content/index.ts'
import type { ContentIssueCode } from '../../../src/core/content/index.ts'

const msg = (id: string, content: string, extra: Record<string, unknown> = {}) => ({ id, content, ...extra })

function doc(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    messages: [msg('msg_0001', 'one'), msg('msg_0002', 'two')],
    ...over,
  })
}

function errorsOf(raw: string): { code: ContentIssueCode; path: string }[] {
  const r = validateContent(raw)
  if (r.ok) return []
  return r.errors.map((e) => ({ code: e.code, path: e.path }))
}

describe('validateContent: valid input', () => {
  it('accepts a minimal valid file and returns normalized content', () => {
    const r = validateContent(doc())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.content.version).toBe(1)
    expect(r.content.messages).toEqual([
      { id: 'msg_0001', content: 'one', tags: [] },
      { id: 'msg_0002', content: 'two', tags: [] },
    ])
    expect(r.content.retiredIds).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('treats absent tags and empty tags the same', () => {
    const r = validateContent(doc({ messages: [msg('msg_0001', 'a', { tags: [] }), msg('msg_0002', 'b')] }))
    expect(r.ok && r.content.messages.map((m) => m.tags)).toEqual([[], []])
  })

  it('accepts ids with more than 4 digits', () => {
    expect(validateContent(doc({ messages: [msg('msg_9999', 'a'), msg('msg_10000', 'b')] })).ok).toBe(true)
  })

  it('accepts Hebrew, emoji and combining characters', () => {
    const r = validateContent(doc({ messages: [msg('msg_0001', 'שלום עולם 🌅'), msg('msg_0002', 'e\u0301')] }))
    expect(r.ok).toBe(true)
  })

  it('strips a leading BOM', () => {
    expect(validateContent('\uFEFF' + doc()).ok).toBe(true)
  })

  it('accepts newlines inside content', () => {
    expect(validateContent(doc({ messages: [msg('msg_0001', 'a\nb')] })).ok).toBe(true)
  })

  it('accepts the shipped sample data', async () => {
    const { readFileSync } = await import('node:fs')
    const raw = readFileSync(new URL('../../../data/messages.json', import.meta.url), 'utf8')
    const r = validateContent(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.content.messages).toHaveLength(12)
      expect(r.warnings).toEqual([])
    }
  })
})

describe('validateContent: one fixture per error code', () => {
  it('INVALID_JSON', () => {
    expect(errorsOf('{ "version": 1, ')).toEqual([{ code: 'INVALID_JSON', path: '' }])
  })

  it('FILE_TOO_LARGE', () => {
    const big = doc({ pad: 'x'.repeat(1024 * 1024) })
    expect(errorsOf(big)).toEqual([{ code: 'FILE_TOO_LARGE', path: '' }])
  })

  it('NOT_AN_OBJECT for array, null, and primitives', () => {
    for (const raw of ['[]', 'null', '42', '"x"']) {
      expect(errorsOf(raw)).toEqual([{ code: 'NOT_AN_OBJECT', path: '' }])
    }
  })

  it('MISSING_VERSION', () => {
    expect(errorsOf(JSON.stringify({ messages: [msg('msg_0001', 'a')] }))).toEqual([
      { code: 'MISSING_VERSION', path: 'version' },
    ])
  })

  it('UNSUPPORTED_VERSION for 2, a string, and a fraction', () => {
    for (const v of [2, '1', 1.5, 0]) {
      expect(errorsOf(doc({ version: v }))).toEqual([{ code: 'UNSUPPORTED_VERSION', path: 'version' }])
    }
  })

  it('MISSING_MESSAGES when absent or not an array', () => {
    expect(errorsOf(JSON.stringify({ version: 1 }))).toEqual([{ code: 'MISSING_MESSAGES', path: 'messages' }])
    expect(errorsOf(doc({ messages: {} }))).toEqual([{ code: 'MISSING_MESSAGES', path: 'messages' }])
  })

  it('EMPTY_MESSAGES', () => {
    expect(errorsOf(doc({ messages: [] }))).toEqual([{ code: 'EMPTY_MESSAGES', path: 'messages' }])
  })

  it('INVALID_MESSAGE', () => {
    expect(errorsOf(doc({ messages: ['text'] }))).toEqual([{ code: 'INVALID_MESSAGE', path: 'messages[0]' }])
  })

  it('INVALID_ID for bad shapes, missing, and upper case', () => {
    for (const id of ['msg_1', 'MSG_0001', 'msg-0001', '0001', 5, null]) {
      expect(errorsOf(doc({ messages: [msg(id as string, 'a')] }))).toEqual([
        { code: 'INVALID_ID', path: 'messages[0].id' },
      ])
    }
    expect(errorsOf(doc({ messages: [{ content: 'a' }] }))).toEqual([{ code: 'INVALID_ID', path: 'messages[0].id' }])
  })

  it('DUPLICATE_ID points at the later occurrence', () => {
    expect(errorsOf(doc({ messages: [msg('msg_0001', 'a'), msg('msg_0001', 'b')] }))).toEqual([
      { code: 'DUPLICATE_ID', path: 'messages[1].id' },
    ])
  })

  it('INVALID_CONTENT for missing, non-string, empty, whitespace-only, newline-only, control chars', () => {
    const bad: unknown[] = [undefined, 5, '', '   ', '\n\n', 'a\tb', 'a\rb', 'a\u0000b', 'a\u0085b']
    for (const content of bad) {
      const m = content === undefined ? { id: 'msg_0001' } : { id: 'msg_0001', content }
      expect(errorsOf(doc({ messages: [m] }))).toEqual([{ code: 'INVALID_CONTENT', path: 'messages[0].content' }])
    }
  })

  it('CONTENT_TOO_LONG: 280 ok, 281 error, counted in code points', () => {
    expect(validateContent(doc({ messages: [msg('msg_0001', 'א'.repeat(280))] })).ok).toBe(true)
    expect(errorsOf(doc({ messages: [msg('msg_0001', 'א'.repeat(281))] }))).toEqual([
      { code: 'CONTENT_TOO_LONG', path: 'messages[0].content' },
    ])
    // 280 emoji = 560 UTF-16 units but 280 code points: allowed.
    expect(validateContent(doc({ messages: [msg('msg_0001', '😀'.repeat(280))] })).ok).toBe(true)
    expect(validateContent(doc({ messages: [msg('msg_0001', '😀'.repeat(281))] })).ok).toBe(false)
  })

  it('DUPLICATE_CONTENT ignores case, spacing, and NFKC variants', () => {
    const variants = ['Hello   World', 'hello world', '  HELLO\nWORLD ', 'ｈｅｌｌｏ ｗｏｒｌｄ']
    for (const v of variants.slice(1)) {
      expect(errorsOf(doc({ messages: [msg('msg_0001', variants[0] as string), msg('msg_0002', v)] }))).toEqual([
        { code: 'DUPLICATE_CONTENT', path: 'messages[1].content' },
      ])
    }
  })

  it('INVALID_TAGS: not array, too many, bad pattern, upper case, duplicates, non-string', () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => `t${i}`)
    expect(errorsOf(doc({ messages: [msg('msg_0001', 'a', { tags: 'x' })] }))).toEqual([
      { code: 'INVALID_TAGS', path: 'messages[0].tags' },
    ])
    expect(errorsOf(doc({ messages: [msg('msg_0001', 'a', { tags: tooMany })] }))[0]).toEqual({
      code: 'INVALID_TAGS',
      path: 'messages[0].tags',
    })
    expect(errorsOf(doc({ messages: [msg('msg_0001', 'a', { tags: ['Gratitude'] })] }))).toEqual([
      { code: 'INVALID_TAGS', path: 'messages[0].tags[0]' },
    ])
    expect(errorsOf(doc({ messages: [msg('msg_0001', 'a', { tags: ['a b'] })] }))).toEqual([
      { code: 'INVALID_TAGS', path: 'messages[0].tags[0]' },
    ])
    expect(errorsOf(doc({ messages: [msg('msg_0001', 'a', { tags: [1] })] }))).toEqual([
      { code: 'INVALID_TAGS', path: 'messages[0].tags[0]' },
    ])
    expect(errorsOf(doc({ messages: [msg('msg_0001', 'a', { tags: ['x', 'x'] })] }))).toEqual([
      { code: 'INVALID_TAGS', path: 'messages[0].tags[1]' },
    ])
    expect(validateContent(doc({ messages: [msg('msg_0001', 'a', { tags: ['a'.repeat(32)] })] })).ok).toBe(true)
    expect(validateContent(doc({ messages: [msg('msg_0001', 'a', { tags: ['a'.repeat(33)] })] })).ok).toBe(false)
  })

  it('INVALID_RETIRED_IDS: not array, bad id, duplicate', () => {
    expect(errorsOf(doc({ retiredIds: 'msg_0007' }))).toEqual([{ code: 'INVALID_RETIRED_IDS', path: 'retiredIds' }])
    expect(errorsOf(doc({ retiredIds: ['nope'] }))).toEqual([{ code: 'INVALID_RETIRED_IDS', path: 'retiredIds[0]' }])
    expect(errorsOf(doc({ retiredIds: ['msg_0007', 'msg_0007'] }))).toEqual([
      { code: 'INVALID_RETIRED_IDS', path: 'retiredIds[1]' },
    ])
  })

  it('RETIRED_ID_REUSED', () => {
    expect(errorsOf(doc({ retiredIds: ['msg_0002'] }))).toEqual([{ code: 'RETIRED_ID_REUSED', path: 'messages[1].id' }])
  })

  it('TOO_MANY_ERRORS caps real errors at 50 and appends a marker', () => {
    const messages = Array.from({ length: 80 }, (_, i) => ({ id: `bad${i}`, content: `c${i}` }))
    const r = validateContent(doc({ messages }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toHaveLength(51)
    expect(r.errors.at(-1)?.code).toBe('TOO_MANY_ERRORS')
    expect(r.errors.slice(0, 50).every((e) => e.code === 'INVALID_ID')).toBe(true)
  })
})

describe('validateContent: collection and warnings', () => {
  it('collects all errors, not just the first', () => {
    const r = validateContent(
      doc({ version: 3, messages: [msg('bad', 'a'), msg('msg_0002', ''), msg('msg_0003', 'ok')] }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.map((e) => e.code).sort()).toEqual(['INVALID_CONTENT', 'INVALID_ID', 'UNSUPPORTED_VERSION'])
  })

  it('reports unknown fields as warnings only', () => {
    const r = validateContent(
      doc({ extra: 1, messages: [msg('msg_0001', 'a', { mood: 'x' }), msg('msg_0002', 'b')] }),
    )
    expect(r.ok).toBe(true)
    expect(r.warnings.map((w) => `${w.code}:${w.path}`).sort()).toEqual([
      'UNKNOWN_FIELD:extra',
      'UNKNOWN_FIELD:messages[0].mood',
    ])
  })

  it('does not auto-fix tag case', () => {
    expect(validateContent(doc({ messages: [msg('msg_0001', 'a', { tags: ['Calm'] })] })).ok).toBe(false)
  })

  it('keeps content text exactly as written', () => {
    const r = validateContent(doc({ messages: [msg('msg_0001', '  spaced  ')] }))
    expect(r.ok && r.content.messages[0]?.content).toBe('  spaced  ')
  })
})
