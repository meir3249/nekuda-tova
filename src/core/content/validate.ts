import {
  codePointLength,
  hasForbiddenControlChar,
  normalizeForDuplicate,
  utf8ByteLength,
} from './normalize.ts'
import {
  ID_PATTERN,
  MAX_CONTENT_LENGTH,
  MAX_FILE_BYTES,
  MAX_REPORTED_ERRORS,
  MAX_TAGS_PER_MESSAGE,
  SUPPORTED_VERSIONS,
  TAG_PATTERN,
} from './schema.ts'
import type {
  ContentIssueCode,
  Message,
  MessageCollection,
  ValidationIssue,
  ValidationResult,
} from './schema.ts'

const KNOWN_TOP_LEVEL = new Set(['version', 'messages', 'retiredIds'])
const KNOWN_MESSAGE = new Set(['id', 'content', 'tags'])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Validates the raw text of data/messages.json. Pure: no I/O.
 * Collects all problems (up to MAX_REPORTED_ERRORS) instead of stopping at the first.
 */
export function validateContent(rawText: string): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  let overflow = false

  const error = (code: ContentIssueCode, path: string, message: string): void => {
    if (errors.length < MAX_REPORTED_ERRORS) errors.push({ code, path, message })
    else overflow = true
  }
  const warn = (code: ContentIssueCode, path: string, message: string): void => {
    warnings.push({ code, path, message })
  }
  const fail = (): ValidationResult => {
    if (overflow) {
      errors.push({
        code: 'TOO_MANY_ERRORS',
        path: '',
        message: `More than ${MAX_REPORTED_ERRORS} errors; the rest are not shown.`,
      })
    }
    return { ok: false, errors, warnings }
  }

  if (utf8ByteLength(rawText) > MAX_FILE_BYTES) {
    error('FILE_TOO_LARGE', '', `File is larger than ${MAX_FILE_BYTES} bytes.`)
    return fail()
  }

  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    error('INVALID_JSON', '', `Not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
    return fail()
  }

  if (!isPlainObject(parsed)) {
    error('NOT_AN_OBJECT', '', 'The top level must be a JSON object.')
    return fail()
  }

  for (const key of Object.keys(parsed)) {
    if (!KNOWN_TOP_LEVEL.has(key)) warn('UNKNOWN_FIELD', key, `Unknown top-level field "${key}" is ignored.`)
  }

  // version
  const version = parsed['version']
  if (version === undefined) {
    error('MISSING_VERSION', 'version', 'Required field "version" is missing.')
  } else if (typeof version !== 'number' || !SUPPORTED_VERSIONS.includes(version)) {
    error(
      'UNSUPPORTED_VERSION',
      'version',
      `Unsupported version ${JSON.stringify(version)}. Supported: ${SUPPORTED_VERSIONS.join(', ')}.`,
    )
  }

  // retiredIds
  const retired: string[] = []
  const retiredSet = new Set<string>()
  const rawRetired = parsed['retiredIds']
  if (rawRetired !== undefined) {
    if (!Array.isArray(rawRetired)) {
      error('INVALID_RETIRED_IDS', 'retiredIds', '"retiredIds" must be an array of message ids.')
    } else {
      rawRetired.forEach((value: unknown, i) => {
        const path = `retiredIds[${i}]`
        if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
          error('INVALID_RETIRED_IDS', path, 'Retired id must be a string like "msg_0007".')
        } else if (retiredSet.has(value)) {
          error('INVALID_RETIRED_IDS', path, `Retired id "${value}" is listed more than once.`)
        } else {
          retiredSet.add(value)
          retired.push(value)
        }
      })
    }
  }

  // messages
  const rawMessages = parsed['messages']
  const messages: Message[] = []
  if (rawMessages === undefined || !Array.isArray(rawMessages)) {
    error('MISSING_MESSAGES', 'messages', '"messages" must be an array.')
  } else if (rawMessages.length === 0) {
    error('EMPTY_MESSAGES', 'messages', '"messages" must contain at least one message.')
  } else {
    const seenIds = new Map<string, number>()
    const seenContent = new Map<string, number>()

    rawMessages.forEach((raw: unknown, i) => {
      const base = `messages[${i}]`
      if (!isPlainObject(raw)) {
        error('INVALID_MESSAGE', base, 'Each message must be a JSON object.')
        return
      }
      for (const key of Object.keys(raw)) {
        if (!KNOWN_MESSAGE.has(key)) warn('UNKNOWN_FIELD', `${base}.${key}`, `Unknown field "${key}" is ignored.`)
      }

      // id
      const id = raw['id']
      let idOk = false
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
        error('INVALID_ID', `${base}.id`, 'Id must be a string like "msg_0001" (msg_ plus at least 4 digits).')
      } else if (seenIds.has(id)) {
        error('DUPLICATE_ID', `${base}.id`, `Id "${id}" is already used by messages[${seenIds.get(id)}].`)
      } else {
        seenIds.set(id, i)
        idOk = true
        if (retiredSet.has(id)) {
          error('RETIRED_ID_REUSED', `${base}.id`, `Id "${id}" is retired and must never be reused.`)
          idOk = false
        }
      }

      // content
      const content = raw['content']
      let contentOk = false
      if (typeof content !== 'string' || content.trim() === '') {
        error('INVALID_CONTENT', `${base}.content`, 'Content must be a non-empty string.')
      } else if (hasForbiddenControlChar(content)) {
        error('INVALID_CONTENT', `${base}.content`, 'Content contains a control character (only newline is allowed).')
      } else if (codePointLength(content) > MAX_CONTENT_LENGTH) {
        error(
          'CONTENT_TOO_LONG',
          `${base}.content`,
          `Content is ${codePointLength(content)} characters; the maximum is ${MAX_CONTENT_LENGTH}.`,
        )
      } else {
        contentOk = true
        const key = normalizeForDuplicate(content)
        const first = seenContent.get(key)
        if (first !== undefined) {
          error('DUPLICATE_CONTENT', `${base}.content`, `Same text as messages[${first}] (ignoring case and spacing).`)
          contentOk = false
        } else {
          seenContent.set(key, i)
        }
      }

      // tags
      const rawTags = raw['tags']
      const tags: string[] = []
      let tagsOk = true
      if (rawTags !== undefined) {
        if (!Array.isArray(rawTags)) {
          error('INVALID_TAGS', `${base}.tags`, '"tags" must be an array of strings.')
          tagsOk = false
        } else {
          if (rawTags.length > MAX_TAGS_PER_MESSAGE) {
            error('INVALID_TAGS', `${base}.tags`, `At most ${MAX_TAGS_PER_MESSAGE} tags per message.`)
            tagsOk = false
          }
          const seenTags = new Set<string>()
          rawTags.forEach((tag: unknown, j) => {
            const tagPath = `${base}.tags[${j}]`
            if (typeof tag !== 'string' || !TAG_PATTERN.test(tag)) {
              error('INVALID_TAGS', tagPath, 'Tag must match [a-z0-9_-], 1 to 32 characters (lower-case).')
              tagsOk = false
            } else if (seenTags.has(tag)) {
              error('INVALID_TAGS', tagPath, `Tag "${tag}" is listed more than once.`)
              tagsOk = false
            } else {
              seenTags.add(tag)
              tags.push(tag)
            }
          })
        }
      }

      if (idOk && contentOk && tagsOk && typeof id === 'string' && typeof content === 'string') {
        messages.push({ id, content, tags })
      }
    })
  }

  if (errors.length > 0 || overflow) return fail()

  const collection: MessageCollection = { version: 1, messages, retiredIds: retired }
  return { ok: true, content: collection, warnings }
}
