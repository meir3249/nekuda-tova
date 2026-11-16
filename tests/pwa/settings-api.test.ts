import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { createSettingsApi } from '../../src/pwa/api/settings-api.ts'
import { FakeFetch } from '../fakes/fake-fetch.ts'

interface FakeAuthState {
  session: { access_token: string; user: { id: string } } | null
  signIns: number
  signInFails: boolean
}

function fakeClient(state: FakeAuthState): SupabaseClient {
  return {
    auth: {
      getSession: () => Promise.resolve({ data: { session: state.session }, error: null }),
      signInAnonymously: () => {
        state.signIns++
        if (state.signInFails) return Promise.resolve({ data: { session: null }, error: { message: 'rate limited' } })
        state.session = { access_token: 'tok-1', user: { id: 'anon-1' } }
        return Promise.resolve({ data: { session: state.session }, error: null })
      },
    },
  } as unknown as SupabaseClient
}

const make = (state: FakeAuthState, fake: FakeFetch) =>
  createSettingsApi({ supabaseUrl: 'https://proj.supabase.co/', anonKey: 'anon-key', fetch: fake.fetch, client: fakeClient(state) })

describe('settings-api', () => {
  it('getSettings without a session returns null and creates no anonymous user (P-15)', async () => {
    const state: FakeAuthState = { session: null, signIns: 0, signInFails: false }
    const fake = new FakeFetch()
    expect(await make(state, fake).getSettings()).toEqual({ ok: true, value: null })
    expect(state.signIns).toBe(0)
    expect(fake.requests).toHaveLength(0)
  })

  it('saveSettings signs in lazily once, then posts with the bearer token and anon key', async () => {
    const state: FakeAuthState = { session: null, signIns: 0, signInFails: false }
    const fake = new FakeFetch().reply({ body: { settings: { localTime: '09:00', timezone: 'UTC', enabled: false, nextSendAt: null } } }, {
      body: { settings: { localTime: '10:00', timezone: 'UTC', enabled: false, nextSendAt: null } },
    })
    const api = make(state, fake)
    const r1 = await api.saveSettings({ localTime: '09:00', timezone: 'UTC' })
    const r2 = await api.saveSettings({ localTime: '10:00' })
    expect(r1.ok && r1.value.localTime).toBe('09:00')
    expect(r2.ok && r2.value.localTime).toBe('10:00')
    expect(state.signIns).toBe(1)
    const req = fake.requests[0]!
    expect(req.url.toString()).toBe('https://proj.supabase.co/functions/v1/settings')
    expect(req.method).toBe('POST')
    expect(req.headers.get('authorization')).toBe('Bearer tok-1')
    expect(req.headers.get('apikey')).toBe('anon-key')
    expect(req.body).toEqual({ localTime: '09:00', timezone: 'UTC' })
  })

  it('surfaces server error codes and messages', async () => {
    const state: FakeAuthState = { session: { access_token: 't', user: { id: 'u' } }, signIns: 0, signInFails: false }
    const fake = new FakeFetch().reply({ status: 400, body: { code: 'INVALID_SLOT', message: 'localTime must be HH:00 or HH:30' } })
    expect(await make(state, fake).saveSettings({ localTime: '09:15' })).toEqual({
      ok: false,
      code: 'INVALID_SLOT',
      message: 'localTime must be HH:00 or HH:30',
    })
  })

  it('network failure → NETWORK; failed anonymous sign-in → NETWORK; no throw', async () => {
    const state: FakeAuthState = { session: { access_token: 't', user: { id: 'u' } }, signIns: 0, signInFails: false }
    const fake = new FakeFetch().reply(new TypeError('fetch failed'))
    const r = await make(state, fake).saveSettings({ enabled: false })
    expect(r).toMatchObject({ ok: false, code: 'NETWORK' })

    const bad: FakeAuthState = { session: null, signIns: 0, signInFails: true }
    expect(await make(bad, new FakeFetch()).saveSettings({ enabled: false })).toMatchObject({ ok: false, code: 'NETWORK' })
  })

  it('getSettings with a session performs a GET', async () => {
    const state: FakeAuthState = { session: { access_token: 'abc', user: { id: 'u' } }, signIns: 0, signInFails: false }
    const fake = new FakeFetch().reply({ body: { settings: null } })
    expect(await make(state, fake).getSettings()).toEqual({ ok: true, value: null })
    expect(fake.requests[0]!.method).toBe('GET')
    expect(fake.requests[0]!.headers.get('authorization')).toBe('Bearer abc')
  })
})
