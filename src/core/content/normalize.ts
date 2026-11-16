/**
 * Normalization used only to detect exact duplicate messages:
 * trim, collapse whitespace runs to one space, Unicode NFKC, lower-case.
 * Semantic duplicates cannot be detected by machine (see docs/content-management.md).
 */
export function normalizeForDuplicate(text: string): string {
  return text.trim().replace(/\s+/gu, ' ').normalize('NFKC').toLowerCase()
}

/** Length in Unicode code points (not UTF-16 units). */
export function codePointLength(text: string): number {
  let n = 0
  for (const _ of text) {
    void _
    n++
  }
  return n
}

/** UTF-8 byte length without Buffer/TextEncoder (core stays free of environment globals). */
export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) bytes += 1
    else if (c < 0x800) bytes += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i++
      } else bytes += 3
    } else bytes += 3
  }
  return bytes
}

/** True if the text contains a control character other than newline (U+000A). */
export function hasForbiddenControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if ((c < 0x20 && c !== 0x0a) || (c >= 0x7f && c <= 0x9f)) return true
  }
  return false
}
