import { describe, expect, it } from 'vitest'
import { SLOTS } from '../../src/core/index.ts'
import { PRODUCT_NAME, strings } from '../../src/pwa/strings.ts'
import { formatSlot, slotOptions } from '../../src/pwa/ui/time-select.ts'

describe('strings', () => {
  it('every string is non-empty and has no stray whitespace', () => {
    for (const [key, value] of Object.entries(strings)) {
      const list = Array.isArray(value) ? value : [value]
      expect(list.length, key).toBeGreaterThan(0)
      for (const s of list) {
        expect(typeof s, key).toBe('string')
        expect(s.trim(), key).toBe(s)
        expect(s.length, key).toBeGreaterThan(0)
      }
    }
  })

  it('the product name appears only as the app name (D-003), in Hebrew or English', () => {
    expect(strings.appName).toBe(PRODUCT_NAME)
    for (const [key, value] of Object.entries(strings)) {
      if (key === 'appName') continue
      const text = (Array.isArray(value) ? value : [value]).join(' ')
      expect(text, key).not.toContain(PRODUCT_NAME)
      expect(text.toLowerCase(), key).not.toContain('nekuda')
    }
  })

  it('the UI copy is Hebrew (Q-01)', () => {
    for (const key of ['subtitle', 'timeLabel', 'notificationsLabel', 'saved', 'saveFailed', 'howItWorksTitle'] as const) {
      expect(strings[key], key).toMatch(/[\u0590-\u05ff]/)
    }
  })
})

describe('time select options', () => {
  it('has exactly 48 options, values HH:00 and HH:30 only, in order', () => {
    const opts = slotOptions()
    expect(opts).toHaveLength(48)
    expect(opts.map((o) => o.value)).toEqual([...SLOTS])
    for (const o of opts) expect(o.value).toMatch(/^([01]\d|2[0-3]):(00|30)$/)
  })

  it('labels are always 24-hour and zero-padded, equal to the saved value', () => {
    for (const o of slotOptions()) expect(o.label).toBe(o.value)
    expect(formatSlot('15:00')).toBe('15:00')
    expect(formatSlot('09:30')).toBe('09:30')
    expect(formatSlot('00:00')).toBe('00:00')
  })

  it('an invalid slot falls back to the default without throwing', () => {
    expect(formatSlot('3:00 PM')).toBe('09:00')
  })
})
