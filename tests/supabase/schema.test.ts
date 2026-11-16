import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Static checks over the migration SQL. These do not replace the database tests in
 * supabase/tests/*.sql (which need a real Postgres), but they pin the security-relevant shape.
 */
const dir = path.resolve('supabase/migrations')
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
const sql = (name: string) => readFileSync(path.join(dir, files.find((f) => f.includes(name))!), 'utf8')
const all = files.map((f) => readFileSync(path.join(dir, f), 'utf8')).join('\n')

function tableColumns(source: string, table: string): { name: string; type: string }[] {
  const m = new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(source)
  if (!m) throw new Error(`table ${table} not found`)
  return m[1]!
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('constraint') && !l.startsWith('check') && !l.startsWith('--') && !l.startsWith('(') )
    .map((l) => l.replace(/,$/, '').split(/\s+/))
    .filter((p) => p.length >= 2 && /^[a-z_]+$/.test(p[0]!))
    .map((p) => ({ name: p[0]!, type: p[1]!.replace(/,$/, '') }))
}

describe('migrations', () => {
  it('are ordered 0001 init, 0002 rls, 0003 functions, 0004 finalize precision', () => {
    expect(files).toHaveLength(4)
    expect(files[0]).toContain('init')
    expect(files[1]).toContain('rls')
    expect(files[2]).toContain('functions')
    expect(files[3]).toContain('finalize_ms_precision')
  })

  it('are written to be re-runnable', () => {
    expect(all).not.toMatch(/create table (?!if not exists)/i)
    expect(all).not.toMatch(/create index (?!if not exists)/i)
    expect(all).not.toMatch(/create function /i) // always "create or replace"
  })

  it('delivery_log has no column capable of holding message text (acceptance 11)', () => {
    const cols = tableColumns(sql('init'), 'delivery_log')
    expect(cols.map((c) => c.name).sort()).toEqual(
      ['attempted_at', 'counter_value', 'delay_seconds', 'id', 'message_id', 'push_status', 'run_id', 'scheduled_for', 'status', 'user_id'].sort(),
    )
    // Only these columns are text; status is CHECK-constrained, ids are identifiers.
    expect(cols.filter((c) => c.type === 'text').map((c) => c.name).sort()).toEqual(['message_id', 'run_id', 'status'])
    expect(cols.some((c) => /json|bytea|varchar/.test(c.type))).toBe(false)
    expect(cols.some((c) => /body|text|content|title|message$/.test(c.name))).toBe(false)
  })

  it('delivery_log.user_id has no foreign key', () => {
    const m = /create table if not exists public\.delivery_log \(([\s\S]*?)\n\);/.exec(sql('init'))!
    expect(m[1]).not.toMatch(/references/i)
  })

  it('subscriptions constraints are present', () => {
    const s = sql('init')
    expect(s).toContain("local_time ~ '^([01][0-9]|2[0-3]):(00|30)$'")
    expect(s).toContain('references auth.users (id) on delete cascade')
    expect(s).toContain('enabled = false or (next_send_at is not null and push_subscription is not null)')
    expect(s).toMatch(/where enabled;/)
  })

  it('RLS: enabled on all three tables; one select policy; no write policies (P-01)', () => {
    const s = sql('rls')
    for (const t of ['subscriptions', 'delivery_log', 'sender_runs']) {
      expect(s).toContain(`alter table public.${t}`)
    }
    const policies = [...s.matchAll(/create policy (\w+)[\s\S]*?for (\w+)/g)].map((m) => [m[1], m[2]])
    expect(policies).toEqual([['subscriptions_select_own', 'select']])
    expect(s).toContain('using (auth.uid() = id)')
    expect(s).toMatch(/revoke all on public\.subscriptions from anon, authenticated/)
    expect(s).toMatch(/grant select \([^)]*\)\s+on public\.subscriptions to authenticated/)
  })

  it('clients cannot read the push subscription, counter, start index, or lease', () => {
    const m = /grant select \(([^)]*)\)/.exec(sql('rls'))!
    const granted = m[1]!.split(',').map((c) => c.trim())
    for (const secret of ['push_subscription', 'message_index', 'start_index', 'claimed_until']) {
      expect(granted).not.toContain(secret)
    }
  })

  it('every function is security definer with a fixed search_path and service_role-only execute', () => {
    const s = sql('functions')
    const defs = [...s.matchAll(/create or replace function (public\.\w+)\(/g)].map((m) => m[1]!)
    expect(defs.length).toBeGreaterThanOrEqual(9)
    const blocks = s.split(/create or replace function /).slice(1)
    for (const b of blocks) {
      expect(b).toContain('security definer')
      expect(b).toContain('set search_path = public')
    }
    const locked = s.slice(s.indexOf('foreach fn in array'))
    for (const name of defs.filter((d) => d !== 'public.set_updated_at')) {
      expect(locked, name).toContain(name.replace('public.', "'public.") )
    }
    expect(locked).toContain('revoke all on function %s from public, anon, authenticated')
    expect(locked).toContain('grant execute on function %s to service_role')
  })

  it('claim uses FOR UPDATE SKIP LOCKED; finalize functions are compare-and-set', () => {
    const s = sql('functions')
    expect(s).toMatch(/for update skip locked/i)
    expect(s.match(/and next_send_at = p_expected/g)).toHaveLength(2)
  })

  it('0004 redefines both finalize functions as millisecond-precision CAS, locked to service_role', () => {
    const s = sql('finalize_ms_precision')
    const defs = [...s.matchAll(/create or replace function (public\.\w+)\(/g)].map((m) => m[1])
    expect(defs).toEqual(['public.finalize_sent', 'public.finalize_skipped'])
    for (const b of s.split(/create or replace function /).slice(1)) {
      expect(b).toContain('security definer')
      expect(b).toContain('set search_path = public')
      expect(b).toContain("date_trunc('milliseconds', next_send_at) = date_trunc('milliseconds', p_expected)")
      expect(b).toContain('and enabled')
    }
    for (const fn of ['finalize_sent', 'finalize_skipped']) {
      expect(s).toContain(`revoke all on function public.${fn}(uuid, timestamptz, timestamptz) from public, anon, authenticated`)
      expect(s).toContain(`grant execute on function public.${fn}(uuid, timestamptz, timestamptz) to service_role`)
    }
  })
})
