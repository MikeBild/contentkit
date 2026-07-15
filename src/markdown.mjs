import { parse as parseYaml } from 'yaml'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkDirective from 'remark-directive'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import rehypeShiki from '@shikijs/rehype'
import rehypeStringify from 'rehype-stringify'
import { visit } from 'unist-util-visit'
import { assertSlug, excerpt, parseIsoDate, slugify } from './utils.mjs'

const kinds = new Set(['page', 'post', 'project'])

function directives() {
  return (tree) => {
    visit(tree, ['containerDirective', 'leafDirective'], (node) => {
      if (!['note', 'tip', 'warning'].includes(node.name)) return
      const data = node.data || (node.data = {})
      data.hName = 'aside'
      data.hProperties = { className: ['callout', `callout-${node.name}`], role: 'note' }
    })
  }
}

// Collapse a heading's inline content to plain text. `# A *b* c` -> `A b c`.
function headingText(node) {
  if (typeof node.value === 'string') return node.value
  return (node.children || []).map(headingText).join('')
}

// Compared against `headingText`, which yields the heading's *rendered* text: mdast has
// already turned `` `async/await` `` into an inlineCode node whose value carries no
// backticks, and `*x*` into emphasis around plain text. A frontmatter title, being a raw
// string, still holds that syntax. Strip the inline markers from both sides so the two
// spellings of the same title compare equal. Applied symmetrically, so a literal
// underscore inside a word survives on both sides or on neither.
export const normalizeTitle = (value) =>
  String(value || '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

// The layout already renders the frontmatter `title` as the page's <h1>. Authors
// conventionally repeat it as the document's opening heading, which yields two <h1>
// on the page and a document outline that starts twice. Drop that heading — but only
// when it is the first block *and* its text is the title, so a body that deliberately
// opens with a different top-level heading keeps it.
//
// This edits the rendered HTML only. `source` (and therefore llms-full.txt) keeps the
// document exactly as authored.
function dropRedundantTitle(title) {
  return (tree) => {
    const index = tree.children.findIndex((node) => node.type !== 'yaml')
    const first = tree.children[index]
    if (!first || first.type !== 'heading' || first.depth !== 1) return
    if (normalizeTitle(headingText(first)) !== normalizeTitle(title)) return
    tree.children.splice(index, 1)
  }
}

function mermaidBlocks() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'pre' || node.children?.[0]?.tagName !== 'code') return
      const code = node.children[0]
      if (!(code.properties?.className || []).includes('language-mermaid')) return
      node.properties = { className: ['mermaid'] }
      node.children = [{ type: 'text', value: code.children?.map((child) => child.value || '').join('') || '' }]
    })
  }
}

const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), 'aside', 'input', 'span', 'div', 'pre'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'ariaHidden', 'ariaLabel', 'role'],
    a: [...(defaultSchema.attributes?.a || []), 'dataFootnoteRef', 'dataFootnoteBackref'],
    input: ['type', 'checked', 'disabled'],
    code: ['className', 'style'],
    pre: ['className', 'style'],
    span: ['className', 'style'],
    div: ['className', 'style'],
    aside: ['className', 'role'],
  },
}

// Frontmatter-authored reader aids. Validation is strict on shape (a wrong type
// fails the upload with a 422 the author sees immediately) but tolerant on
// scalars: YAML happily parses `- 42` as a number, so scalar entries are
// stringified rather than rejected.
const scalar = (value) => value != null && typeof value !== 'object'

function validateTldr(value) {
  if (value == null) return []
  if (!Array.isArray(value) || !value.every(scalar)) {
    throw Object.assign(new Error('frontmatter tldr must be a list of strings'), { statusCode: 422 })
  }
  const lines = value.map((entry) => String(entry).trim()).filter(Boolean)
  if (lines.length !== value.length) {
    throw Object.assign(new Error('frontmatter tldr must not contain empty entries'), { statusCode: 422 })
  }
  return lines
}

function validateFaq(value) {
  if (value == null) return []
  const wellFormed =
    Array.isArray(value) &&
    value.every((entry) => entry && typeof entry === 'object' && scalar(entry.q) && scalar(entry.a))
  if (!wellFormed) {
    throw Object.assign(new Error('frontmatter faq must be a list of { q, a } entries'), { statusCode: 422 })
  }
  return value.map((entry) => {
    const q = String(entry.q).trim()
    const a = String(entry.a).trim()
    if (!q || !a) {
      throw Object.assign(new Error('frontmatter faq entries need a non-empty q and a'), { statusCode: 422 })
    }
    return { q, a }
  })
}

// Author-owned custom fields (`extra:`), passed through to the revision's
// metadata verbatim with their YAML types preserved. There is no schema
// builder: the shape rules below are the whole contract, and consumers (the
// Read API, per-site tooling) interpret the fields themselves. Bounded so a
// single document cannot turn the metadata column into a blob store.
const EXTRA_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const EXTRA_MAX_FIELDS = 32
const EXTRA_MAX_LIST_ENTRIES = 64
const EXTRA_MAX_MAP_ENTRIES = 32
const EXTRA_MAX_BYTES = 16384

function validateExtra(value) {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('frontmatter extra must be a map of custom fields'), { statusCode: 422 })
  }
  const entries = Object.entries(value)
  if (!entries.length) return null
  if (entries.length > EXTRA_MAX_FIELDS) {
    throw Object.assign(new Error(`frontmatter extra allows at most ${EXTRA_MAX_FIELDS} fields`), { statusCode: 422 })
  }
  const assertKey = (key) => {
    if (!EXTRA_KEY_PATTERN.test(key)) {
      throw Object.assign(new Error('frontmatter extra keys must match [a-z][a-z0-9_]{0,63}'), { statusCode: 422 })
    }
  }
  const badValue = () =>
    Object.assign(new Error('frontmatter extra values must be scalars, lists of scalars or flat maps of scalars'), {
      statusCode: 422,
    })
  for (const [key, entry] of entries) {
    assertKey(key)
    if (scalar(entry)) continue
    if (Array.isArray(entry)) {
      if (entry.length > EXTRA_MAX_LIST_ENTRIES) {
        throw Object.assign(new Error(`frontmatter extra lists allow at most ${EXTRA_MAX_LIST_ENTRIES} entries`), {
          statusCode: 422,
        })
      }
      if (!entry.every(scalar)) throw badValue()
      continue
    }
    if (entry && typeof entry === 'object') {
      const nested = Object.entries(entry)
      if (nested.length > EXTRA_MAX_MAP_ENTRIES) {
        throw Object.assign(new Error(`frontmatter extra maps allow at most ${EXTRA_MAX_MAP_ENTRIES} entries`), {
          statusCode: 422,
        })
      }
      for (const [nestedKey, nestedValue] of nested) {
        assertKey(nestedKey)
        if (!scalar(nestedValue)) throw badValue()
      }
      continue
    }
    throw badValue() // null entries: an absent value is expressed by omitting the key
  }
  if (Buffer.byteLength(JSON.stringify(value)) > EXTRA_MAX_BYTES) {
    throw Object.assign(new Error('frontmatter extra must not exceed 16 KiB'), { statusCode: 422 })
  }
  return value
}

// Authored references (`related:`), a list of same-locale post slugs. Stored
// as `related_slugs` so it cannot collide with the derived `related` link
// projection the site builder attaches at build time. Validation is
// write-time only — whether a slug resolves is decided at build time, where
// a broken reference is dropped with a warning instead of failing a release.
const RELATED_MAX_REFERENCES = 8

function validateRelated(value, slug) {
  if (value == null) return null
  if (!Array.isArray(value)) {
    throw Object.assign(new Error('frontmatter related must be a list of slugs'), { statusCode: 422 })
  }
  // YAML parses `- 42` as a number; assertSlug accepts it (its regex coerces),
  // so normalize to strings for stable comparisons against post slugs.
  const slugs = value.map((entry) => String(assertSlug(entry, 'related')))
  if (!slugs.length) return null
  if (slugs.length > RELATED_MAX_REFERENCES) {
    throw Object.assign(new Error(`frontmatter related allows at most ${RELATED_MAX_REFERENCES} references`), {
      statusCode: 422,
    })
  }
  if (new Set(slugs).size !== slugs.length) {
    throw Object.assign(new Error('frontmatter related must not contain duplicates'), { statusCode: 422 })
  }
  if (slugs.includes(slug)) {
    throw Object.assign(new Error('frontmatter related must not reference the document itself'), { statusCode: 422 })
  }
  return slugs
}

function validateFrontmatter(data, { lenient = false, warnings = [] } = {}) {
  const kind = data.kind || 'page'
  if (!kinds.has(kind))
    throw Object.assign(new Error('frontmatter kind must be page, post or project'), { statusCode: 422 })
  const title = String(data.title || '').trim()
  if (!title) throw Object.assign(new Error('frontmatter title is required'), { statusCode: 422 })
  const locale = String(data.locale || '').toLowerCase()
  if (!/^[a-z]{2}(?:-[a-z]{2})?$/.test(locale)) {
    throw Object.assign(new Error('frontmatter locale must be an IETF language tag such as de or en-us'), {
      statusCode: 422,
    })
  }
  const slug = assertSlug(data.slug || slugify(title))
  const translationKey = assertSlug(data.translationKey || data.translation_key || slug, 'translationKey')
  const tags = Array.isArray(data.tags) ? data.tags.map((tag) => String(tag).trim()).filter(Boolean) : []
  const meta = {
    kind,
    title,
    locale,
    slug,
    translation_key: translationKey,
    summary: String(data.summary || '').trim(),
    tags,
    published_at: parseIsoDate(data.date || data.publishedAt, 'date'),
    scheduled_at: parseIsoDate(data.scheduledAt, 'scheduledAt'),
    updated_at: parseIsoDate(data.updatedAt, 'updatedAt'),
    cover: data.cover || data.image ? String(data.cover || data.image) : null,
    cover_alt: data.coverAlt || data.imageAlt ? String(data.coverAlt || data.imageAlt) : '',
    noindex: Boolean(data.noindex),
    // Authored reader aids: TL;DR bullets and an FAQ, rendered on the page and
    // exposed to machines (JSON-LD abstract/FAQPage, Markdown export, search
    // index). Authored content like `summary` — contentkit never generates them.
    tldr: validateTldr(data.tldr),
    faq: validateFaq(data.faq),
    // Authored opt-out for the read-aloud feature; absence means eligible.
    audio: data.audio !== false,
    featured: Boolean(data.featured),
    technologies: Array.isArray(data.technologies) ? data.technologies.map(String) : [],
    external_url: data.externalUrl ? String(data.externalUrl) : null,
    nav_order: Number.isFinite(Number(data.navOrder)) ? Number(data.navOrder) : null,
  }
  // Content modeling light: both keys are additive and omitted entirely when
  // absent or empty, so revisions written before they existed keep
  // byte-identical metadata. The write path validates strictly (422 the author
  // sees immediately); the lenient render paths that replay stored revisions
  // (site builds, the Read API) instead drop a malformed value with a warning —
  // a document that was valid when written must never fail a future release.
  const dropWhenLenient = (key, validate) => {
    try {
      return validate()
    } catch (error) {
      if (!lenient || error.statusCode !== 422) throw error
      warnings.push(`frontmatter ${key} dropped: ${error.message}`)
      return null
    }
  }
  const extra = dropWhenLenient('extra', () => validateExtra(data.extra))
  if (extra) meta.extra = extra
  const relatedSlugs = dropWhenLenient('related', () => validateRelated(data.related, slug))
  if (relatedSlugs) meta.related_slugs = relatedSlugs
  return meta
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith('---\n') && !markdown.startsWith('---\r\n')) {
    return { data: {}, content: markdown }
  }
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) throw Object.assign(new Error('frontmatter is not terminated with ---'), { statusCode: 422 })
  let data
  try {
    data = parseYaml(match[1], { maxAliasCount: 20 }) || {}
  } catch (error) {
    throw Object.assign(new Error(`invalid YAML frontmatter: ${error.message}`), { statusCode: 422 })
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw Object.assign(new Error('frontmatter must be a YAML object'), { statusCode: 422 })
  }
  return { data, content: markdown.slice(match[0].length) }
}

export async function renderMarkdown(markdown, { lenient = false } = {}) {
  const parsed = parseFrontmatter(markdown)
  const warnings = []
  const meta = validateFrontmatter(parsed.data, { lenient, warnings })
  if (!meta.summary) meta.summary = excerpt(parsed.content.replace(/[`#>*_[\]()!-]/g, ' '))

  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkDirective)
    .use(directives)
    .use(dropRedundantTitle, meta.title)
    .use(remarkRehype)
    .use(mermaidBlocks)
    .use(rehypeSanitize, schema)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, { behavior: 'wrap', properties: { className: ['heading-anchor'] } })
    .use(rehypeKatex)
    .use(rehypeShiki, { themes: { light: 'github-light', dark: 'github-dark' } })
    .use(rehypeStringify)

  const html = String(await processor.process(parsed.content))
  return { meta, html, source: parsed.content, hasMermaid: /class="mermaid"/.test(html), warnings }
}
