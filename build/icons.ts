// Raster icons (favicon.ico, apple-touch-icon, web-manifest icons) rendered from public/favicon.svg
// at build time, so they always match the SVG. The SVG must not use <text> (no fonts in the build).

import { readFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import type { Plugin } from 'vite'

/** Background of the touch and maskable icons: the dark theme's page colour. */
const BACKGROUND = '#0b1120'

export interface IconSpec {
  file: string
  size: number
  /** Share of the canvas the icon fills; the rest is padding. */
  scale: number
  /** Solid background behind the icon; transparent when not set. */
  background?: string
}

export const ICONS: IconSpec[] = [
  // iOS shows transparency as black, so the touch icon gets a background.
  { file: 'apple-touch-icon.png', size: 180, scale: 0.8, background: BACKGROUND },
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1 },
  // Maskable icons may be cropped to a circle: keep the icon inside the 80 % safe zone.
  { file: 'icon-maskable-512.png', size: 512, scale: 0.7, background: BACKGROUND },
]

/** Images inside favicon.ico. */
export const FAVICON_SIZES = [16, 32, 48]

/** PNG of the SVG on a square canvas of `size` px, with padding and an optional background. */
export function renderPng(svg: string, size: number, scale = 1, background?: string): Uint8Array {
  const inner = size * scale
  const offset = (size - inner) / 2
  // Nest the icon in a canvas SVG, so padding and background need no image library.
  const icon = svg.replace('<svg ', `<svg x="${offset}" y="${offset}" width="${inner}" height="${inner}" `)
  const fill = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : ''
  const canvas = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${fill}${icon}</svg>`
  return new Resvg(canvas, { fitTo: { mode: 'original' }, font: { loadSystemFonts: false } }).render().asPng()
}

/** ICO container holding PNG images (read by every current browser); sizes up to 256 px. */
export function pngsToIco(images: { size: number; png: Uint8Array }[]): Uint8Array {
  const headerSize = 6
  const entrySize = 16
  let offset = headerSize + entrySize * images.length
  const out = new Uint8Array(offset + images.reduce((n, i) => n + i.png.length, 0))
  const view = new DataView(out.buffer)
  view.setUint16(2, 1, true) // type: icon
  view.setUint16(4, images.length, true)
  images.forEach((image, i) => {
    const entry = headerSize + i * entrySize
    view.setUint8(entry, image.size >= 256 ? 0 : image.size) // width (0 = 256)
    view.setUint8(entry + 1, image.size >= 256 ? 0 : image.size) // height
    view.setUint16(entry + 4, 1, true) // colour planes
    view.setUint16(entry + 6, 32, true) // bits per pixel
    view.setUint32(entry + 8, image.png.length, true)
    view.setUint32(entry + 12, offset, true)
    out.set(image.png, offset)
    offset += image.png.length
  })
  return out
}

/** All generated files by name. */
export function renderIcons(svg: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  files.set('favicon.ico', pngsToIco(FAVICON_SIZES.map((size) => ({ size, png: renderPng(svg, size) }))))
  for (const icon of ICONS) files.set(icon.file, renderPng(svg, icon.size, icon.scale, icon.background))
  return files
}

/** Emits the icons into the build output and serves them in the dev server. */
export function iconsPlugin(svgPath: string): Plugin {
  const render = () => renderIcons(readFileSync(svgPath, 'utf8'))
  return {
    name: 'ceph-calc-icons',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\//, '')
        if (name !== 'favicon.ico' && !ICONS.some((i) => i.file === name)) return next()
        res.setHeader('Content-Type', name.endsWith('.ico') ? 'image/x-icon' : 'image/png')
        res.end(render().get(name))
      })
    },
    generateBundle() {
      for (const [fileName, source] of render()) this.emitFile({ type: 'asset', fileName, source })
    },
  }
}
