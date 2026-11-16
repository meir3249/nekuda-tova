import { describe, expect, it } from 'vitest'
import {
  codePointLength,
  hasForbiddenControlChar,
  normalizeForDuplicate,
  utf8ByteLength,
} from '../../../src/core/content/normalize.ts'

describe('normalize helpers', () => {
  it('normalizeForDuplicate trims, collapses, folds case, applies NFKC', () => {
    expect(normalizeForDuplicate('  A \n\t B  ')).toBe('a b')
    expect(normalizeForDuplicate('ﬁne')).toBe('fine')
  })

  it('codePointLength counts code points', () => {
    expect(codePointLength('a😀𝄞')).toBe(3)
    expect(codePointLength('')).toBe(0)
  })

  it('utf8ByteLength matches Buffer for assorted text', () => {
    for (const s of ['', 'abc', 'שלום', '😀', '𝄞x', 'a\u0000b']) {
      expect(utf8ByteLength(s)).toBe(Buffer.byteLength(s, 'utf8'))
    }
  })

  it('hasForbiddenControlChar allows newline only', () => {
    expect(hasForbiddenControlChar('a\nb')).toBe(false)
    for (const bad of ['\t', '\r', '\u0000', '\u001f', '\u007f', '\u009f']) {
      expect(hasForbiddenControlChar(`a${bad}b`)).toBe(true)
    }
    expect(hasForbiddenControlChar('\u00a0')).toBe(false)
  })
})
