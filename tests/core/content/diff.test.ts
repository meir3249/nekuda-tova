import { describe, expect, it } from 'vitest'
import { diffContent } from '../../../src/core/content/index.ts'
import type { MessageCollection } from '../../../src/core/content/index.ts'

function col(ids: string[], retired: string[] = []): MessageCollection {
  return {
    version: 1,
    messages: ids.map((id) => ({ id, content: `text ${id}`, tags: [] })),
    retiredIds: retired,
  }
}

const A = 'msg_0001'
const B = 'msg_0002'
const C = 'msg_0003'
const D = 'msg_0004'

const codes = (r: { errors: readonly { code: string }[]; warnings: readonly { code: string }[] }) => ({
  e: r.errors.map((x) => x.code),
  w: r.warnings.map((x) => x.code),
})

describe('diffContent', () => {
  it('no change: no issues', () => {
    expect(codes(diffContent(col([A, B]), col([A, B])))).toEqual({ e: [], w: [] })
  })

  it('edit only (same ids): no issues', () => {
    const head = { ...col([A, B]), messages: [{ id: A, content: 'edited', tags: [] }, ...col([B]).messages] }
    expect(codes(diffContent(col([A, B]), head))).toEqual({ e: [], w: [] })
  })

  it('append: only a count-change warning', () => {
    expect(codes(diffContent(col([A, B]), col([A, B, C])))).toEqual({ e: [], w: ['COUNT_CHANGED'] })
  })

  it('remove with retire: warnings, no error', () => {
    const r = diffContent(col([A, B, C]), col([A, C], [B]))
    expect(codes(r)).toEqual({ e: [], w: ['MESSAGE_REMOVED', 'COUNT_CHANGED'] })
  })

  it('remove without retire: error', () => {
    const r = diffContent(col([A, B, C]), col([A, C]))
    expect(r.errors.map((e) => e.code)).toEqual(['ID_REMOVED_WITHOUT_RETIRE'])
    expect(r.errors[0]?.message).toContain(B)
  })

  it('un-retiring an id is an error', () => {
    const r = diffContent(col([A], [B]), col([A], []))
    expect(r.errors.map((e) => e.code)).toEqual(['RETIRED_ID_DROPPED'])
  })

  it('reorder: warning only', () => {
    expect(codes(diffContent(col([A, B, C]), col([B, A, C])))).toEqual({ e: [], w: ['ORDER_CHANGED'] })
  })

  it('insert in the middle: INSERTED_NOT_AT_END plus count change', () => {
    expect(codes(diffContent(col([A, B]), col([A, D, B])))).toEqual({ e: [], w: ['INSERTED_NOT_AT_END', 'COUNT_CHANGED'] })
  })

  it('append plus removal with retire is not flagged as middle insertion', () => {
    const r = diffContent(col([A, B]), col([A, D], [B]))
    expect(codes(r).w).toEqual(['MESSAGE_REMOVED'])
    expect(r.errors).toEqual([])
  })

  it('warnings explain the impact in plain words', () => {
    const r = diffContent(col([A, B]), col([A, B, C]))
    expect(r.warnings[0]?.message).toMatch(/repeats or skips/)
  })
})
