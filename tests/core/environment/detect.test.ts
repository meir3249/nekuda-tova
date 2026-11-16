import { describe, expect, it } from 'vitest'
import { detectEnvironment, type EnvInputs } from '../../../src/core/environment/detect.ts'

const base: EnvInputs = {
  userAgent: '',
  platform: '',
  maxTouchPoints: 0,
  standalone: false,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  permission: 'default',
}

describe('detectEnvironment', () => {
  it('iPhone Safari tab → ios_needs_install', () => {
    const r = detectEnvironment({
      ...base,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile Safari',
      platform: 'iPhone',
      maxTouchPoints: 5,
      hasPushManager: false,
      hasNotification: false,
      permission: 'unavailable',
    })
    expect(r).toEqual({ state: 'ios_needs_install', isIOSLike: true, permission: 'unavailable' })
  })

  it('iPhone standalone (installed, iOS ≥ 16.4) → push_ready', () => {
    const r = detectEnvironment({ ...base, userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5, standalone: true })
    expect(r.state).toBe('push_ready')
    expect(r.isIOSLike).toBe(true)
  })

  it('iPad desktop-UA tab → ios_needs_install', () => {
    const r = detectEnvironment({
      ...base,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
      hasPushManager: false,
    })
    expect(r.state).toBe('ios_needs_install')
    expect(r.isIOSLike).toBe(true)
  })

  it('Android Chrome → push_ready', () => {
    const r = detectEnvironment({ ...base, userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120', platform: 'Linux armv81', maxTouchPoints: 5 })
    expect(r).toEqual({ state: 'push_ready', isIOSLike: false, permission: 'default' })
  })

  it('desktop Firefox → push_ready; real Mac (no touch) is not iOS-like', () => {
    const r = detectEnvironment({ ...base, userAgent: 'Mozilla/5.0 Firefox/130', platform: 'MacIntel', maxTouchPoints: 0 })
    expect(r.state).toBe('push_ready')
    expect(r.isIOSLike).toBe(false)
  })

  it('unsupported WebView → unsupported', () => {
    const r = detectEnvironment({ ...base, userAgent: 'Mozilla/5.0 (Linux; Android 9; wv)', platform: 'Linux', hasPushManager: false, hasNotification: false, permission: 'unavailable' })
    expect(r.state).toBe('unsupported')
  })

  it('iOS standalone without PushManager (< 16.4) → unsupported', () => {
    const r = detectEnvironment({ ...base, userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5, standalone: true, hasPushManager: false })
    expect(r.state).toBe('unsupported')
  })

  it('iOS in-app browsers (Instagram, Facebook) → unsupported, not "install"', () => {
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]',
    ]) {
      const r = detectEnvironment({ ...base, userAgent: ua, platform: 'iPhone', maxTouchPoints: 5, hasPushManager: false, hasNotification: false })
      expect(r.state, ua).toBe('unsupported')
    }
  })

  it('passes permission through', () => {
    expect(detectEnvironment({ ...base, permission: 'denied' }).permission).toBe('denied')
    expect(detectEnvironment({ ...base, permission: 'granted' }).permission).toBe('granted')
  })
})
