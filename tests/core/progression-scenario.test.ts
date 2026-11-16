import { describe, expect, it } from 'vitest'
import { messageIndexFor } from '../../src/core/progression/index.ts'
import { nextOccurrenceAfter } from '../../src/core/scheduling/next-send.ts'
import { evaluateDelay } from '../../src/core/scheduling/staleness.ts'
import { applySettingsChange } from '../../src/core/settings/apply-settings-change.ts'
import { FakeClock } from '../fakes/fake-clock.ts'
import { InMemoryUserRepository } from '../fakes/in-memory-user-repository.ts'

const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
}

describe('600 daily cycles with pause and content-size change', () => {
  it('keeps every index in range and the counter monotonic', async () => {
    const clock = new FakeClock(new Date('2027-01-01T00:00:00.000Z'))
    const repo = new InMemoryUserRepository(clock)
    const id = 'user-1'
    const tz = 'Asia/Jerusalem'
    const rng = () => 0.123

    const created = applySettingsChange(null, { localTime: '09:00', timezone: tz, enabled: true, pushSubscription: SUB }, clock.now(), rng)
    if (!created.ok) throw new Error(created.code)
    repo.put({ ...created.row, id, claimedUntil: null, updatedAt: clock.now() })

    let n = 41
    let lastCounter = 0
    let sends = 0
    const seen: number[] = []

    for (let cycle = 0; cycle < 600; cycle++) {
      if (cycle === 200) n = 38 // content shrinks mid-way (D-008)

      if (cycle === 300) {
        // Pause: disable, 40 days pass, re-enable.
        const cur = repo.get(id)!
        const off = applySettingsChange(cur, { enabled: false }, clock.now(), rng)
        if (!off.ok) throw new Error(off.code)
        repo.put({ ...cur, ...off.row })
        const counterBefore = cur.messageIndex
        clock.advance(40 * 86_400_000)
        const cur2 = repo.get(id)!
        const on = applySettingsChange(cur2, { enabled: true, pushSubscription: SUB }, clock.now(), rng)
        if (!on.ok) throw new Error(on.code)
        repo.put({ ...cur2, ...on.row })
        expect(repo.get(id)!.messageIndex).toBe(counterBefore)
      }

      // Jump to just after the scheduled time (cron lateness of 5 minutes).
      const row = repo.get(id)!
      clock.set(new Date(row.nextSendAt!.getTime() + 5 * 60_000))
      const claimed = await repo.claimDue(clock.now(), 10, 600)
      expect(claimed).toHaveLength(1)
      const c = claimed[0]!
      const { stale } = evaluateDelay(c.nextSendAt!, clock.now())
      expect(stale).toBe(false)

      const idx = messageIndexFor(c.startIndex, c.messageIndex, n)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(n)
      seen.push(idx)

      const next = nextOccurrenceAfter(c.localTime, c.timezone, clock.now())
      expect(await repo.finalizeSent(id, c.nextSendAt!, next)).toBe(true)
      sends++

      const after = repo.get(id)!
      expect(after.messageIndex).toBe(lastCounter + 1)
      expect(after.messageIndex).toBeGreaterThan(lastCounter)
      lastCounter = after.messageIndex
    }

    expect(sends).toBe(600)
    expect(lastCounter).toBe(600)
    expect(seen).toHaveLength(600)
  })

  it('stale CAS finalize returns false and changes nothing', async () => {
    const clock = new FakeClock(new Date('2027-01-01T00:00:00.000Z'))
    const repo = new InMemoryUserRepository(clock)
    const created = applySettingsChange(null, { localTime: '09:00', timezone: 'UTC', enabled: true, pushSubscription: SUB }, clock.now(), () => 0)
    if (!created.ok) throw new Error(created.code)
    repo.put({ ...created.row, id: 'u', claimedUntil: null, updatedAt: clock.now() })
    const wrong = new Date('2030-01-01T00:00:00.000Z')
    expect(await repo.finalizeSent('u', wrong, wrong)).toBe(false)
    expect(repo.get('u')!.messageIndex).toBe(0)
  })
})
