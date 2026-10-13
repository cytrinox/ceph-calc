import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { estimateIops, iopsBasis } from '../src/lib/iops'
import { defaultPoolOptions } from '../src/lib/pool'
import { byline, docPage, fillTemplate, formatDate, helpDocs, overviewPage, parseFrontmatter, renderDoc, svgReader } from './help'

const helpDir = fileURLToPath(new URL('../help', import.meta.url))
const docsDir = join(helpDir, 'docs')
const noSvg = () => {
  throw new Error('no figures expected')
}

describe('help documents', () => {
  it('reads the frontmatter', () => {
    const { data, body } = parseFrontmatter('---\ntitle: "EC: stripes"\ndescription: How it works\norder: 5\n---\n\n## One\n')
    expect(data).toEqual({ title: 'EC: stripes', description: 'How it works', order: '5' })
    expect(body).toBe('\n## One\n')
    expect(parseFrontmatter('# No frontmatter').data).toEqual({})
  })

  it('needs a title and a description, and orders by order, then title', () => {
    const dir = mkdtempSync(join(tmpdir(), 'help-'))
    writeFileSync(join(dir, 'b-doc.md'), '---\ntitle: Beta\ndescription: B\nauthor: A\npublished: 2026-01-01\n---\n')
    writeFileSync(join(dir, 'a-doc.md'), '---\ntitle: Alpha\ndescription: A\norder: 200\nauthor: A\npublished: 2026-01-01\n---\n')
    writeFileSync(join(dir, 'c-doc.md'), '---\ntitle: Gamma\ndescription: C\norder: 1\nauthor: A\npublished: 2026-01-01\n---\n')
    expect(helpDocs(dir).map((d) => [d.name, d.url])).toEqual([
      ['c-doc', '/help/c-doc/'],
      ['b-doc', '/help/b-doc/'],
      ['a-doc', '/help/a-doc/'],
    ])
    writeFileSync(join(dir, 'broken.md'), '---\ntitle: No description\n---\n')
    expect(() => helpDocs(dir)).toThrow('frontmatter needs a title and a description')
  })

  it('needs an author and valid dates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'help-'))
    const write = (front: string) => writeFileSync(join(dir, 'doc.md'), `---\ntitle: T\ndescription: D\n${front}---\n`)
    write('published: 2026-01-01\n')
    expect(() => helpDocs(dir)).toThrow('needs an author')
    write('author: A\npublished: 2026-02-30\n')
    expect(() => helpDocs(dir)).toThrow('published must be a date')
    write('author: A\npublished: 2026-03-01\nrevised: 2026-02-01\n')
    expect(() => helpDocs(dir)).toThrow('not before published')
    write('author: A\nauthor-link: javascript:alert(1)\npublished: 2026-03-01\n')
    expect(() => helpDocs(dir)).toThrow('author-link must be an http(s) URL')
    write('author: A\nauthor-link: https://example.org/a\npublished: 2026-03-01\nrevised: 2026-04-02\n')
    expect(helpDocs(dir)[0]).toMatchObject({ authorLink: 'https://example.org/a', published: '2026-03-01', revised: '2026-04-02' })
  })

  it('writes the byline with linked author and readable dates', () => {
    expect(formatDate('2026-10-03')).toBe('3 October 2026')
    expect(byline({ author: 'Jane Doe', published: '2026-10-13' })).toBe(
      '<p class="byline">by Jane Doe, published <time datetime="2026-10-13">13 October 2026</time></p>',
    )
    expect(byline({ author: 'Jane Doe', published: '2026-10-13', revised: '2026-10-13' })).not.toContain('revised')
    expect(byline({ author: 'Jane Doe', authorLink: 'https://example.org', published: '2026-10-13', revised: '2026-11-02' })).toBe(
      '<p class="byline">by <a href="https://example.org">Jane Doe</a>, published <time datetime="2026-10-13">13 October 2026</time>' +
        ' · revised <time datetime="2026-11-02">2 November 2026</time></p>',
    )
  })

  it('renders headings with ids, formula blocks and tables', () => {
    const { html, sections } = renderDoc(
      '## From data to OSDs\n\n### Detail\n\n## From data to OSDs\n\n```formula\nIOPS = N ÷ x\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n',
      noSvg,
    )
    expect(html).toContain('<h2 id="from-data-to-osds">From data to OSDs</h2>')
    expect(html).toContain('<h3 id="detail">')
    expect(html).toContain('<h2 id="from-data-to-osds-2">')
    expect(sections.map((s) => s.id)).toEqual(['from-data-to-osds', 'from-data-to-osds-2'])
    expect(html).toContain('<pre class="formula">IOPS = N ÷ x</pre>')
    expect(html).toContain('<table>')
  })

  it('inlines an SVG image as a figure with its caption, outside a paragraph', () => {
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10" role="img" aria-label="old"><rect class="data"/></svg>'
    const { html } = renderDoc('Text.\n\n![Objects & PGs](img/x.svg)\n\nMore.\n', (src) => {
      expect(src).toBe('img/x.svg')
      return svg
    })
    expect(html).toContain(
      '<figure class="figure"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="img" aria-label="Objects &amp; PGs"><rect class="data"/></svg><figcaption>Objects &amp; PGs</figcaption></figure>',
    )
    expect(html).not.toMatch(/<p>\s*<figure/)
    // other images stay images
    expect(renderDoc('![Photo](photo.png)', noSvg).html).toContain('<img src="photo.png" alt="Photo">')
  })

  it('fails on missing figures and figures outside the documents', () => {
    const read = svgReader(docsDir, 'test')
    expect(() => read('img/missing.svg')).toThrow('missing figure img/missing.svg')
    expect(() => read('../index.html.svg')).toThrow('outside')
  })

  it('fills the template for the overview and the documents', () => {
    const template = readFileSync(join(helpDir, 'index.html'), 'utf8')
    const docs = helpDocs(docsDir)
    const overview = fillTemplate(template, overviewPage(docs))
    expect(overview).toContain('<title>Help · ceph-calc</title>')
    expect(overview).toContain(`<a href="/help/ec-sharding-and-iops/">`)
    expect(overview).not.toContain('<!--help:')
    const doc = docs.find((d) => d.name === 'ec-sharding-and-iops')!
    const page = fillTemplate(template, docPage(doc, svgReader(docsDir, doc.name)))
    expect(page).toContain('<title>How EC pools store data, and how the IOPS are estimated · ceph-calc help</title>')
    expect(page).toContain('<nav class="toc"')
    expect(page).not.toContain('<!--help:')
  })

  it('renders every document with all its figures', () => {
    const docs = helpDocs(docsDir)
    expect(docs.length).toBeGreaterThan(0)
    for (const doc of docs) {
      const { content } = docPage(doc, svgReader(docsDir, doc.name))
      expect(content, doc.name).toContain('<h1>')
      // every SVG reference was inlined
      expect(content, doc.name).not.toMatch(/<img[^>]+\.svg/)
    }
  })

  it('states the numbers the IOPS model computes (ec-sharding-and-iops)', () => {
    const text = readFileSync(join(docsDir, 'ec-sharding-and-iops.md'), 'utf8')
    const rep3 = { kind: 'replicated' as const, size: 3, minSize: 2 }
    const ec42 = { kind: 'ec' as const, k: 4, m: 2 }
    const pool = (o: object = {}) => ({ ...defaultPoolOptions(), ...o })
    const basis = (r: number, placedTB: number, sizeKiB = 4) =>
      iopsBasis([{ cls: 'ssd', osd: { read: r, write: r }, largestOsdTB: 8 }], placedTB, sizeKiB)!
    const fmt = (n: number | null) => Math.round(n!).toLocaleString('en-US')
    const e = (b: ReturnType<typeof basis>, s: typeof rep3 | typeof ec42, o?: object) => estimateIops(b, s, pool(o))
    // 12 OSDs at 200 IOPS
    expect(text).toContain(`= ${fmt(e(basis(200, 96), rep3).read)} | 12 ÷ (3 ÷ 200) = ${fmt(e(basis(200, 96), rep3).write)}`)
    expect(text).toContain(`= ${fmt(e(basis(200, 96), ec42).read)} | 12 ÷ (4 ÷ 200 + 6 ÷ 200) = ${fmt(e(basis(200, 96), ec42).write)}`)
    const opt = e(basis(200, 96), ec42, { ecOptimizations: true })
    expect(text).toContain(`12 × 200 ÷ 1 = ${fmt(opt.read)} | 12 ÷ (3 ÷ 200 + 3 ÷ 200) = ${fmt(opt.write)}`)
    // 40 OSDs at 1,000 IOPS: 16K reads by stripe_unit, and 4M vs 8M reads on 4M objects
    const su = (stripeUnitKiB: number) => e(basis(1000, 320, 16), ec42, { ecOptimizations: true, stripeUnitKiB }).read
    expect(text).toContain(`| 4K | 4 | ${fmt(su(4))} |`)
    expect(text).toContain(`| 16K | 1 | ${fmt(su(16))} |`)
    const big = (sizeKiB: number) => e(basis(1000, 320, sizeKiB), ec42, { stripeUnitKiB: 4 }).read
    expect(text).toContain(`| 4M | 1 | 4 | ${fmt(big(4096))} |`)
    expect(text).toContain(`| 8M | 2 | 8 | ${fmt(big(8192))} |`)
    // mixed classes: the hdd OSDs limit the pool
    const mixed = iopsBasis(
      [
        { cls: 'hdd', osd: { read: 200, write: 150 }, largestOsdTB: 16 },
        { cls: 'ssd', osd: { read: 50_000, write: 20_000 }, largestOsdTB: 8 },
      ],
      448,
    )!
    expect(text).toContain(`448 TB ÷ 16 TB × 200 = ${fmt(estimateIops(mixed, rep3, pool()).read)} read IOPS`)
  })
})
