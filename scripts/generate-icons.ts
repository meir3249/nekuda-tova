// Usage: node scripts/generate-icons.ts
// Generates the placeholder icons (Q-04) into src/pwa/public/icons: the glowing "point" (nekuda) from the screen, a
// warm orb with a soft halo on the app's night-blue gradient. Pure Node (zlib), no image dependency. The output is
// committed; rerun only to change it.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

const OUT = path.resolve('src/pwa/public/icons')
// Same colours as styles.css: --bg-2 → --bg-mid gradient, --star orb with a #fff7e3 highlight and #e9a25f rim.
const BG_TOP: RGB = [0x1a, 0x28, 0x58]
const BG_BOTTOM: RGB = [0x0d, 0x16, 0x36]
const HIGHLIGHT: RGB = [0xff, 0xf7, 0xe3]
const DOT: RGB = [0xff, 0xd5, 0x8a]
const RIM: RGB = [0xe9, 0xa2, 0x5f]
type RGB = [number, number, number]

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/**
 * Square RGB PNG: the app's night-blue gradient with the glowing "point" from the screen — a warm orb (highlight
 * up and to the side, as in `.orb` in styles.css) of radius `dotRatio * size`, surrounded by a soft fading halo.
 */
function png(size: number, dotRatio: number): Buffer {
  const SS = 4 // 4x4 supersampling per pixel
  const r = dotRatio * size
  const c = size / 2
  const lerp = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => (a[i] as number) + ((b[i] as number) - (a[i] as number)) * t) as RGB
  /** Orb fill at a point inside it: radial gradient centred at (38%, 34%) of the orb's box, like the CSS. */
  const orb = (x: number, y: number): RGB => {
    const hx = c - r + 0.76 * r
    const hy = c - r + 0.68 * r
    const t = Math.min(1, Math.hypot(x - hx, y - hy) / (1.25 * r))
    return t < 0.38 ? lerp(HIGHLIGHT, DOT, t / 0.38) : lerp(DOT, RIM, Math.min(1, (t - 0.38) / 0.4))
  }
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1)
    raw[row] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const acc: RGB = [0, 0, 0]
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS
          let col = lerp(BG_TOP, BG_BOTTOM, py / size)
          const d = Math.hypot(px - c, py - c)
          if (d <= r) col = orb(px, py)
          else {
            // Halo: a soft Gaussian falloff of the star colour outside the orb.
            const g = 0.5 * Math.exp(-(((d - r) / (0.45 * r)) ** 2))
            col = lerp(col, DOT, g)
          }
          for (let ch = 0; ch < 3; ch++) acc[ch] = (acc[ch] as number) + (col[ch] as number)
        }
      }
      for (let ch = 0; ch < 3; ch++) raw[row + 1 + x * 3 + ch] = Math.round((acc[ch] as number) / (SS * SS))
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const hex = (c: RGB): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`

mkdirSync(OUT, { recursive: true })
// "any" icons: orb at 24% radius, halo fading out by ~45%. Maskable: 19% so orb and most of the halo stay inside
// the 80% safe zone after cropping.
writeFileSync(path.join(OUT, 'icon-192.png'), png(192, 0.24))
writeFileSync(path.join(OUT, 'icon-512.png'), png(512, 0.24))
writeFileSync(path.join(OUT, 'icon-maskable-512.png'), png(512, 0.19))
writeFileSync(path.join(OUT, 'apple-touch-icon.png'), png(180, 0.22))
writeFileSync(
  path.join(OUT, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<defs>` +
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex(BG_TOP)}"/><stop offset="1" stop-color="${hex(BG_BOTTOM)}"/></linearGradient>` +
    `<radialGradient id="halo"><stop offset="0.5" stop-color="${hex(DOT)}" stop-opacity="0.5"/><stop offset="1" stop-color="${hex(DOT)}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="orb" cx="0.38" cy="0.34" r="0.62"><stop offset="0" stop-color="${hex(HIGHLIGHT)}"/><stop offset="0.38" stop-color="${hex(DOT)}"/><stop offset="1" stop-color="${hex(RIM)}"/></radialGradient>` +
    `</defs>` +
    `<rect width="64" height="64" rx="14" fill="url(#bg)"/><circle cx="32" cy="32" r="28" fill="url(#halo)"/><circle cx="32" cy="32" r="15" fill="url(#orb)"/></svg>\n`,
)
console.log(`Icons written to ${OUT}`)
