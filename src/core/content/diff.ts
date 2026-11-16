import type { MessageCollection, ValidationIssue } from './schema.ts'

export interface DiffResult {
  readonly errors: readonly ValidationIssue[]
  readonly warnings: readonly ValidationIssue[]
}

/**
 * Compares the base (target branch) content with the head (proposed) content.
 * Errors: an id was dropped without being retired, or a retired id was un-retired.
 * Warnings: removals, reordering, insertions before existing messages, count change.
 * Both inputs must already be validated.
 */
export function diffContent(base: MessageCollection, head: MessageCollection): DiffResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  const headIndex = new Map<string, number>()
  head.messages.forEach((m, i) => headIndex.set(m.id, i))
  const baseIds = new Set(base.messages.map((m) => m.id))
  const headRetired = new Set(head.retiredIds)

  // Removed messages
  base.messages.forEach((m, i) => {
    if (headIndex.has(m.id)) return
    if (headRetired.has(m.id)) {
      warnings.push({
        code: 'MESSAGE_REMOVED',
        path: `messages[${i}]`,
        message: `"${m.id}" was removed (and retired). Positions after it shift by one.`,
      })
    } else {
      errors.push({
        code: 'ID_REMOVED_WITHOUT_RETIRE',
        path: `messages[${i}]`,
        message: `"${m.id}" was removed but is not listed in "retiredIds". Add it so the id is never reused.`,
      })
    }
  })

  // Retired ids must stay retired
  for (const id of base.retiredIds) {
    if (!headRetired.has(id)) {
      errors.push({
        code: 'RETIRED_ID_DROPPED',
        path: 'retiredIds',
        message: `"${id}" was retired in the base file but is missing from "retiredIds". Retired ids must stay retired.`,
      })
    }
  }

  // Reordering: relative order of ids present in both
  const baseCommon = base.messages.map((m) => m.id).filter((id) => headIndex.has(id))
  const headCommon = head.messages.map((m) => m.id).filter((id) => baseIds.has(id))
  if (baseCommon.some((id, i) => id !== headCommon[i])) {
    warnings.push({
      code: 'ORDER_CHANGED',
      path: 'messages',
      message: 'The order of existing messages changed. Users will see repeats or skip messages around the changed positions.',
    })
  }

  // Insertions before existing messages
  const lastSurvivingHeadIndex = baseCommon.reduce((max, id) => Math.max(max, headIndex.get(id) ?? -1), -1)
  head.messages.forEach((m, j) => {
    if (!baseIds.has(m.id) && j < lastSurvivingHeadIndex) {
      warnings.push({
        code: 'INSERTED_NOT_AT_END',
        path: `messages[${j}]`,
        message: `"${m.id}" was inserted before existing messages. Positions after it shift by one. Prefer appending at the end.`,
      })
    }
  })

  // Count change shifts everyone who has completed at least one cycle
  if (base.messages.length !== head.messages.length) {
    warnings.push({
      code: 'COUNT_CHANGED',
      path: 'messages',
      message:
        `The number of messages changed from ${base.messages.length} to ${head.messages.length}. ` +
        'Because progression is (start + counter) mod N, readers who have already finished a cycle will land on different messages (repeats or skips). This is an accepted consequence.',
    })
  }

  return { errors, warnings }
}
