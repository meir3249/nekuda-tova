import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// WCAG 2.x contrast for the colour tokens in src/pwa/styles.css (single "cosmic ocean" dark palette).
const css = readFileSync('src/pwa/styles.css', 'utf8')

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]))
}

const t = tokens(/:root\s*{([\s\S]*?)}/.exec(css)![1]!)

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

function mix(a: string, b: string, weightA: number): string {
  const ch = (h: string, i: number): number => parseInt(h.slice(i, i + 2), 16)
  return `#${[1, 3, 5].map((i) => Math.round(ch(a, i) * weightA + ch(b, i) * (1 - weightA)).toString(16).padStart(2, '0')).join('')}`
}

// Every background the text can sit on: the gradient's darkest and lightest points, cards, controls, toast.
const BACKGROUNDS = ['bg', 'bg-mid', 'bg-2', 'bg-peak', 'surface', 'surface-raised']

// [foreground, background, minimum]: 4.5 for text, 3 for UI components and focus indicators (WCAG 1.4.11).
const PAIRS: [string, string, number][] = [
  ...BACKGROUNDS.flatMap((bg): [string, string, number][] => [
    ['text', bg, 4.5],
    ['muted', bg, 4.5],
    ['focus', bg, 3],
  ]),
  ['text', 'toast', 4.5],
  ['rose', 'surface', 4.5], // off-state hint text (on its 9% rose tint the background is only lighter by a hair)
  ['rose', 'surface-raised', 4.5],
  ['accent-contrast', 'accent', 4.5], // selected option text in the styled picker; knob on the "on" track
  ['accent', 'surface', 3], // "on" track
  ['muted', 'track-off', 3], // knob on the "off" track
  ['border', 'surface', 3], // switch and select edges on a card
  ['border', 'surface-raised', 3],
  ['accent', 'surface-raised', 3], // select hover edge
]

describe('cosmic ocean palette contrast', () => {
  it('defines every token', () => {
    for (const k of [...BACKGROUNDS, 'glow', 'toast', 'text', 'muted', 'border', 'accent', 'accent-contrast', 'track-off', 'focus']) {
      expect(t[k], k).toMatch(/^#/)
    }
  })

  it('bg-peak really is at least as light as the lightest painted point (bg-2 under the 35% glow)', () => {
    expect(luminance(t['bg-peak']!)).toBeGreaterThanOrEqual(luminance(mix(t['glow']!, t['bg-2']!, 0.35)) - 1e-3)
  })

  it.each(PAIRS)('%s on %s >= %s:1', (fg, bg, min) => {
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(min)
  })
})
