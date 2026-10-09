import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FAVICON_SIZES, ICONS, pngsToIco, renderIcons } from './icons'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8')

/** Width and height from a PNG's IHDR chunk. */
function pngSize(png: Uint8Array): [number, number] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return [view.getUint32(16), view.getUint32(20)]
}

describe('pngsToIco', () => {
  it('writes an ICO header and directory pointing at the PNGs', () => {
    const a = Uint8Array.from([...PNG_SIGNATURE, 1, 2, 3])
    const b = Uint8Array.from([...PNG_SIGNATURE, 4, 5])
    const ico = pngsToIco([
      { size: 16, png: a },
      { size: 256, png: b },
    ])
    const view = new DataView(ico.buffer)
    expect([view.getUint16(0, true), view.getUint16(2, true), view.getUint16(4, true)]).toEqual([0, 1, 2])
    // entry 1: 16 px; entry 2: 256 px is stored as 0
    expect([ico[6], ico[7], ico[22], ico[23]]).toEqual([16, 16, 0, 0])
    const offsets = [view.getUint32(6 + 12, true), view.getUint32(22 + 12, true)]
    expect(offsets).toEqual([38, 38 + a.length])
    expect([view.getUint32(6 + 8, true), view.getUint32(22 + 8, true)]).toEqual([a.length, b.length])
    expect([...ico.slice(offsets[1], offsets[1] + b.length)]).toEqual([...b])
  })
})

describe('renderIcons', () => {
  it('needs no fonts: the favicon has no <text>', () => {
    expect(svg).not.toMatch(/<text/)
  })

  it('renders every icon at its size, and favicon.ico with 16, 32 and 48 px', () => {
    const files = renderIcons(svg)
    for (const icon of ICONS) {
      const png = files.get(icon.file)!
      expect([...png.slice(0, 8)]).toEqual(PNG_SIGNATURE)
      expect(pngSize(png)).toEqual([icon.size, icon.size])
    }
    const ico = files.get('favicon.ico')!
    const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength)
    expect(view.getUint16(4, true)).toBe(FAVICON_SIZES.length)
    FAVICON_SIZES.forEach((size, i) => {
      const offset = view.getUint32(6 + i * 16 + 12, true)
      expect(pngSize(ico.slice(offset))).toEqual([size, size])
    })
  })
})
