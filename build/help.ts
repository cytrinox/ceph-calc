// Help documents: Markdown files in help/docs/ rendered to static pages at build time (/help/<name>/), with SVG
// figures inlined so they follow the page's theme. help/index.html is a Vite entry: the overview page (/help/) and
// the template every document is filled into.

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import MarkdownIt from 'markdown-it'
import type { Plugin } from 'vite'

export interface HelpDoc {
  /** File name without .md; the page is /help/<name>/. */
  name: string
  title: string
  description: string
  /** Position in lists; lower first, then by title. */
  order: number
  author: string
  /** Optional link for the author's name (http or https). */
  authorLink?: string
  /** YYYY-MM-DD. */
  published: string
  /** YYYY-MM-DD, not before `published`; optional. */
  revised?: string
  url: string
  /** Markdown without the frontmatter. */
  body: string
}

/** What fills the template's placeholders. */
export interface HelpPage {
  title: string
  description: string
  content: string
}

const PLACEHOLDERS = {
  title: '<!--help:title-->',
  description: '<!--help:description-->',
  content: '<!--help:content-->',
} as const

const DOC_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** `---` delimited `key: value` lines at the start (quotes around values are dropped). */
export function parseFrontmatter(source: string): { data: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (!match) return { data: {}, body: source }
  const data: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim())
    if (kv) data[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return { data, body: source.slice(match[0].length) }
}

/** All documents in `dir`, ordered by `order`, then title. Each needs a title and a description. */
export function helpDocs(dir: string): HelpDoc[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => {
      const name = file.slice(0, -3)
      if (!DOC_NAME.test(name)) throw new Error(`help: ${file}: use lowercase letters, digits and dashes`)
      const { data, body } = parseFrontmatter(readFileSync(join(dir, file), 'utf8'))
      if (!data.title || !data.description) throw new Error(`help: ${file}: frontmatter needs a title and a description`)
      if (!data.author) throw new Error(`help: ${file}: frontmatter needs an author`)
      if (!isDate(data.published)) throw new Error(`help: ${file}: published must be a date (YYYY-MM-DD)`)
      if (data.revised !== undefined && !(isDate(data.revised) && data.revised >= data.published)) {
        throw new Error(`help: ${file}: revised must be a date (YYYY-MM-DD) not before published`)
      }
      const authorLink = data['author-link']
      if (authorLink !== undefined && !/^https?:\/\/\S+$/.test(authorLink)) {
        throw new Error(`help: ${file}: author-link must be an http(s) URL`)
      }
      const order = data.order === undefined ? 100 : Number(data.order)
      return {
        name,
        title: data.title,
        description: data.description,
        order,
        author: data.author,
        authorLink,
        published: data.published,
        revised: data.revised,
        url: `/help/${name}/`,
        body,
      }
    })
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December']

function isDate(value: string | undefined): value is string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '')
  if (!match) return false
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]))
  return date.getUTCMonth() === +match[2] - 1 && date.getUTCDate() === +match[3]
}

/** "2026-10-13" → "13 October 2026": unambiguous wherever the reader lives. */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return `${day} ${MONTHS[month - 1]} ${year}`
}

/**
 * "by X, published 13 October 2026 · revised 2 November 2026", the name linked when the document gives a link; no
 * revised date when it is the publication date.
 */
export function byline(doc: Pick<HelpDoc, 'author' | 'authorLink' | 'published' | 'revised'>): string {
  const author = doc.authorLink ? `<a href="${escape(doc.authorLink)}">${escape(doc.author)}</a>` : escape(doc.author)
  const date = (iso: string) => `<time datetime="${iso}">${formatDate(iso)}</time>`
  // A revision on the day of publication adds nothing.
  const revised = doc.revised && doc.revised !== doc.published ? ` · revised ${date(doc.revised)}` : ''
  return `<p class="byline">by ${author}, published ${date(doc.published)}${revised}</p>`
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** "From data to OSDs" → "from-data-to-osds". */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface RenderedDoc {
  html: string
  /** h2 headings, for the table of contents. */
  sections: { id: string; text: string }[]
}

const isLocalSvg = (src: string) => /\.svg$/i.test(src) && !/^(?:[a-z]+:|\/)/i.test(src)

/**
 * An inline SVG figure: the root element gets role/aria-label and loses its fixed size (CSS scales it), so classes
 * inside can use the theme's colours.
 */
export function svgFigure(svg: string, caption: string): string {
  const inline = svg
    .replace(/<\?xml[\s\S]*?\?>/, '')
    .replace(/<!DOCTYPE[\s\S]*?>/i, '')
    .trim()
    .replace(/<svg\b([^>]*)>/, (_, attrs: string) => {
      const kept = attrs.replace(/\s(?:width|height|role|aria-label)="[^"]*"/g, '')
      return `<svg${kept} role="img" aria-label="${escape(caption)}">`
    })
  return `<figure class="figure">${inline}<figcaption>${escape(caption)}</figcaption></figure>\n`
}

/**
 * Markdown to HTML. Headings get ids (deep links), ```formula fences become formula blocks, and an image of a local
 * SVG on its own line becomes an inline figure with its alt text as caption (`readSvg` gets the path as written).
 */
export function renderDoc(markdown: string, readSvg: (src: string) => string): RenderedDoc {
  const md = new MarkdownIt({ html: true, linkify: false, typographer: false })
  const used = new Map<string, number>()
  const sections: RenderedDoc['sections'] = []

  // A paragraph holding just an SVG image becomes a figure, which a <p> must not contain.
  md.core.ruler.push('svg_figures', (state) => {
    const tokens = state.tokens
    for (let i = 1; i < tokens.length - 1; i++) {
      const children = tokens[i].children
      if (tokens[i].type !== 'inline' || children?.length !== 1 || children[0].type !== 'image') continue
      if (!isLocalSvg(String(children[0].attrGet('src') ?? ''))) continue
      tokens[i - 1].hidden = true
      tokens[i + 1].hidden = true
    }
  })

  md.renderer.rules.heading_open = (tokens, idx, options, _env, self) => {
    const text = tokens[idx + 1].content
    const base = slug(text) || 'section'
    const n = (used.get(base) ?? 0) + 1
    used.set(base, n)
    const id = n === 1 ? base : `${base}-${n}`
    tokens[idx].attrSet('id', id)
    if (tokens[idx].tag === 'h2') sections.push({ id, text })
    return self.renderToken(tokens, idx, options)
  }

  const fence = md.renderer.rules.fence!
  md.renderer.rules.fence = (tokens, idx, options, env, self) =>
    tokens[idx].info.trim() === 'formula'
      ? `<pre class="formula">${escape(tokens[idx].content.replace(/\n$/, ''))}</pre>\n`
      : fence(tokens, idx, options, env, self)

  const image = md.renderer.rules.image!
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const src = String(tokens[idx].attrGet('src') ?? '')
    if (!isLocalSvg(src)) return image(tokens, idx, options, env, self)
    return svgFigure(readSvg(src), tokens[idx].content)
  }

  return { html: md.render(markdown), sections }
}

/** Reads a figure relative to the documents' folder; it must stay inside it, and a missing one fails the build. */
export function svgReader(docsDir: string, docName: string): (src: string) => string {
  return (src) => {
    const path = resolve(docsDir, src)
    if (!path.startsWith(resolve(docsDir) + sep)) {
      throw new Error(`help: ${docName}: figure ${src} is outside ${docsDir}`)
    }
    try {
      return readFileSync(path, 'utf8')
    } catch {
      throw new Error(`help: ${docName}: missing figure ${src}`)
    }
  }
}

// Icons of the navigation buttons, drawn like AppIcon (24×24, stroke 2, round caps).
const ICONS = {
  back: 'M19 12H5m6-6-6 6 6 6',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
} as const

/** A button-styled link with an icon and a caption. */
export function navButton(href: string, label: string, icon: keyof typeof ICONS): string {
  return (
    `<a class="nav-button" href="${href}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="${ICONS[icon]}"/></svg><span>${escape(label)}</span></a>`
  )
}

const calculatorButton = navButton('/', 'Back to the calculator', 'back')

/** A document's page: title, lead, table of contents, content, and buttons to the overview and the calculator. */
export function docPage(doc: HelpDoc, readSvg: (src: string) => string): HelpPage {
  const { html, sections } = renderDoc(doc.body, readSvg)
  const toc = sections.length
    ? `<nav class="toc" aria-label="Contents"><p>Contents</p><ol>${sections
        .map((s) => `<li><a href="#${s.id}">${escape(s.text)}</a></li>`)
        .join('')}</ol></nav>`
    : ''
  return {
    title: `${doc.title} · ceph-calc help`,
    description: doc.description,
    content:
      `<article class="doc">` +
      `<h1>${escape(doc.title)}</h1>${byline(doc)}<p class="lead">${escape(doc.description)}</p>${toc}${html}` +
      `<nav class="page-nav">${navButton('/help/', 'All help documents', 'list')}${calculatorButton}</nav></article>`,
  }
}

/** The overview page (/help/): every document with its description. */
export function overviewPage(docs: HelpDoc[]): HelpPage {
  const items = docs
    .map((d) => `<li><a href="${d.url}">${escape(d.title)}</a><p>${escape(d.description)}</p></li>`)
    .join('')
  return {
    title: 'Help · ceph-calc',
    description: 'Help documents for the ceph real net capacity calculator',
    content:
      `<article class="doc"><h1>Help</h1><ul class="doc-list">${items}</ul>` +
      `<nav class="page-nav">${calculatorButton}</nav></article>`,
  }
}

/** The template with its placeholders filled (the title also in <title>, the description in the meta tag). */
export function fillTemplate(template: string, page: HelpPage): string {
  return template
    .replaceAll(PLACEHOLDERS.title, escape(page.title))
    .replaceAll(PLACEHOLDERS.description, escape(page.description))
    .replace(PLACEHOLDERS.content, page.content)
}

const VIRTUAL_ID = 'virtual:help-docs'
const RESOLVED_ID = '\0' + VIRTUAL_ID

/**
 * - build: help/index.html (a Vite entry) becomes the overview, and every document gets help/<name>/index.html from
 *   the same template (its asset URLs are absolute, so they work one folder deeper);
 * - dev: /help/<name>/ is rendered on request, edits in help/docs/ reload the page;
 * - `virtual:help-docs` lists the documents for the app (the FAQ).
 */
export function helpPlugin(helpDir: string): Plugin {
  const docsDir = join(helpDir, 'docs')
  const templateFile = join(helpDir, 'index.html')
  const listing = () => helpDocs(docsDir).map(({ name, title, description, url }) => ({ name, title, description, url }))

  return {
    name: 'ceph-calc-help',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null
    },
    load(id) {
      return id === RESOLVED_ID ? `export default ${JSON.stringify(listing())}` : null
    },
    // Dev only: the overview is filled in generateBundle for the build, where the template is still needed.
    transformIndexHtml(html, ctx) {
      if (!ctx.server || !html.includes(PLACEHOLDERS.content)) return html
      return fillTemplate(html, overviewPage(helpDocs(docsDir)))
    },
    configureServer(server) {
      server.watcher.add(docsDir)
      const reload = (file: string) => {
        if (!file.startsWith(docsDir)) return
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (mod) server.moduleGraph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('change', reload)
      server.watcher.on('add', reload)
      server.watcher.on('unlink', reload)
      server.middlewares.use(async (req, res, next) => {
        const match = /^\/help\/([a-z0-9-]+)\/?(?:index\.html)?(?:[?#].*)?$/.exec(req.url ?? '')
        const doc = match && helpDocs(docsDir).find((d) => d.name === match[1])
        if (!doc) return next()
        try {
          const page = fillTemplate(readFileSync(templateFile, 'utf8'), docPage(doc, svgReader(docsDir, doc.name)))
          const html = await server.transformIndexHtml(doc.url, page, req.originalUrl)
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(html)
        } catch (error) {
          next(error)
        }
      })
    },
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const entry = bundle['help/index.html']
        if (!entry || entry.type !== 'asset') return
        const template = String(entry.source)
        const docs = helpDocs(docsDir)
        entry.source = fillTemplate(template, overviewPage(docs))
        for (const doc of docs) {
          this.emitFile({
            type: 'asset',
            fileName: `help/${doc.name}/index.html`,
            source: fillTemplate(template, docPage(doc, svgReader(docsDir, doc.name))),
          })
        }
      },
    },
  }
}
