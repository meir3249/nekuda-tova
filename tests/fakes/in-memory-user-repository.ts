import type { Clock } from '../../src/core/ports/clock.ts'
import type { Subscription, UserRepository } from '../../src/core/ports/user-repository.ts'

const copy = (s: Subscription): Subscription => ({
  ...s,
  pushSubscription: s.pushSubscription ? { ...s.pushSubscription, keys: { ...s.pushSubscription.keys } } : null,
  nextSendAt: s.nextSendAt ? new Date(s.nextSendAt) : null,
  claimedUntil: s.claimedUntil ? new Date(s.claimedUntil) : null,
  updatedAt: new Date(s.updatedAt),
})

/** In-memory UserRepository with the same semantics as the Supabase adapter will have. */
export class InMemoryUserRepository implements UserRepository {
  private readonly rows = new Map<string, Subscription>()

  constructor(private readonly clock: Clock) {}

  put(row: Subscription): void {
    this.rows.set(row.id, copy(row))
  }

  get(id: string): Subscription | undefined {
    const r = this.rows.get(id)
    return r ? copy(r) : undefined
  }

  size(): number {
    return this.rows.size
  }

  private due(now: Date): Subscription[] {
    return [...this.rows.values()]
      .filter(
        (r) =>
          r.enabled &&
          r.nextSendAt !== null &&
          r.nextSendAt.getTime() <= now.getTime() &&
          (r.claimedUntil === null || r.claimedUntil.getTime() <= now.getTime()),
      )
      .sort((a, b) => a.nextSendAt!.getTime() - b.nextSendAt!.getTime())
  }

  peekDue(now: Date, limit: number): Promise<Subscription[]> {
    return Promise.resolve(this.due(now).slice(0, limit).map(copy))
  }

  claimDue(now: Date, limit: number, leaseSeconds: number): Promise<Subscription[]> {
    const picked = this.due(now).slice(0, limit)
    for (const r of picked) r.claimedUntil = new Date(now.getTime() + leaseSeconds * 1000)
    return Promise.resolve(picked.map(copy))
  }

  private finalize(id: string, expected: Date, next: Date, increment: number): boolean {
    const r = this.rows.get(id)
    if (!r || r.nextSendAt === null || r.nextSendAt.getTime() !== expected.getTime()) return false
    r.messageIndex += increment
    r.nextSendAt = new Date(next)
    r.claimedUntil = null
    r.updatedAt = this.clock.now()
    return true
  }

  finalizeSent(id: string, expectedNextSendAt: Date, newNextSendAt: Date): Promise<boolean> {
    return Promise.resolve(this.finalize(id, expectedNextSendAt, newNextSendAt, 1))
  }

  finalizeSkipped(id: string, expectedNextSendAt: Date, newNextSendAt: Date): Promise<boolean> {
    return Promise.resolve(this.finalize(id, expectedNextSendAt, newNextSendAt, 0))
  }

  releaseClaim(id: string): Promise<void> {
    const r = this.rows.get(id)
    if (r) r.claimedUntil = null
    return Promise.resolve()
  }

  markExpired(id: string): Promise<void> {
    const r = this.rows.get(id)
    if (r) {
      r.pushSubscription = null
      r.enabled = false
      r.nextSendAt = null
      r.claimedUntil = null
      r.updatedAt = this.clock.now()
    }
    return Promise.resolve()
  }

  pruneInactive(olderThan: Date): Promise<number> {
    let n = 0
    for (const [id, r] of this.rows) {
      if (!r.enabled && r.updatedAt.getTime() < olderThan.getTime()) {
        this.rows.delete(id)
        n++
      }
    }
    return Promise.resolve(n)
  }
}
