/** Content schema constants and types (spec 02). */

export const SUPPORTED_VERSIONS: readonly number[] = [1]
export const MAX_FILE_BYTES = 1024 * 1024
export const MAX_CONTENT_LENGTH = 280
export const MAX_TAGS_PER_MESSAGE = 10
export const MAX_REPORTED_ERRORS = 50

export const ID_PATTERN = /^msg_[0-9]{4,}$/
export const TAG_PATTERN = /^[a-z0-9_-]{1,32}$/

export interface Message {
  readonly id: string
  readonly content: string
  readonly tags: readonly string[]
}

export interface MessageCollection {
  readonly version: 1
  readonly messages: readonly Message[]
  readonly retiredIds: readonly string[]
}

export type ContentIssueCode =
  // validation errors
  | 'INVALID_JSON'
  | 'FILE_TOO_LARGE'
  | 'NOT_AN_OBJECT'
  | 'MISSING_VERSION'
  | 'UNSUPPORTED_VERSION'
  | 'MISSING_MESSAGES'
  | 'EMPTY_MESSAGES'
  | 'INVALID_MESSAGE'
  | 'INVALID_ID'
  | 'DUPLICATE_ID'
  | 'INVALID_CONTENT'
  | 'CONTENT_TOO_LONG'
  | 'DUPLICATE_CONTENT'
  | 'INVALID_TAGS'
  | 'INVALID_RETIRED_IDS'
  | 'RETIRED_ID_REUSED'
  | 'TOO_MANY_ERRORS'
  // validation warnings
  | 'UNKNOWN_FIELD'
  // diff errors
  | 'ID_REMOVED_WITHOUT_RETIRE'
  | 'RETIRED_ID_DROPPED'
  // diff warnings
  | 'MESSAGE_REMOVED'
  | 'ORDER_CHANGED'
  | 'INSERTED_NOT_AT_END'
  | 'COUNT_CHANGED'

export interface ValidationIssue {
  readonly code: ContentIssueCode
  /** Location in the file, e.g. `messages[3].id`. Empty string for whole-file issues. */
  readonly path: string
  readonly message: string
}

export type ValidationResult =
  | { readonly ok: true; readonly content: MessageCollection; readonly warnings: readonly ValidationIssue[] }
  | { readonly ok: false; readonly errors: readonly ValidationIssue[]; readonly warnings: readonly ValidationIssue[] }
