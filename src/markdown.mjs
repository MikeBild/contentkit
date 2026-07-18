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
export const layouts = new Set(['standard', 'docs', 'wiki', 'knowledge', 'landing', 'changelog', 'report'])
const accessSlug = /^[a-z0-9][a-z0-9-]{0,63}$/

const REPORT_DIRECTIVES = new Set(['report-grid', 'report-card', 'metric', 'badge', 'progress', 'chart'])
const REPORT_TONES = new Set(['neutral', 'positive', 'warning', 'negative'])
const REPORT_CHART_TYPES = new Set(['bar', 'line', 'area', 'donut'])
const REPORT_CADENCES = new Set(['hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'])
const REPORT_MAX_CHARTS = 24
const REPORT_MAX_ROWS = 200
const REPORT_MAX_SERIES = 8

const directiveError = (message) => Object.assign(new Error(message), { statusCode: 422 })

function directiveAttributes(node, allowed, required = []) {
  const attributes = node.attributes || {}
  const unknown = Object.keys(attributes).find((key) => !allowed.includes(key))
  if (unknown) throw directiveError(`${node.name} directive has unknown attribute "${unknown}"`)
  for (const key of required) {
    if (!String(attributes[key] || '').trim()) throw directiveError(`${node.name} directive requires ${key}`)
  }
  return attributes
}

function boundedText(value, field, max) {
  const text = String(value || '').trim()
  if (text.length > max) throw directiveError(`${field} must be at most ${max} characters`)
  return text
}

function integerAttribute(value, field, { min, max, fallback = null } = {}) {
  if (value == null || value === '') return fallback
  if (!/^\d+$/.test(String(value)) || Number(value) < min || Number(value) > max) {
    throw directiveError(`${field} must be an integer from ${min} to ${max}`)
  }
  return Number(value)
}

function booleanAttribute(value, field, fallback = false) {
  if (value == null || value === '') return fallback
  if (!['true', 'false'].includes(String(value))) throw directiveError(`${field} must be true or false`)
  return String(value) === 'true'
}

function toneAttribute(value, field = 'tone') {
  const tone = String(value || 'neutral')
  if (!REPORT_TONES.has(tone)) {
    throw directiveError(`${field} must be one of ${[...REPORT_TONES].join(', ')}`)
  }
  return tone
}

function reportNode(tagName, className, children = [], properties = {}) {
  return {
    type: 'reportElement',
    children,
    data: { hName: tagName, hProperties: { className, ...properties } },
  }
}

function textNode(tagName, className, value) {
  return reportNode(tagName, className, [{ type: 'text', value: String(value) }])
}

function spanClass(attributes) {
  const span = integerAttribute(attributes.span, 'span', { min: 1, max: 4, fallback: 1 })
  return `report-span-${span}`
}

function tableCellText(cell) {
  return headingText(cell).replace(/\s+/g, ' ').trim()
}

function chartDescriptor(node, charts) {
  if (charts.length >= REPORT_MAX_CHARTS) {
    throw directiveError(`report allows at most ${REPORT_MAX_CHARTS} charts`)
  }
  const attributes = directiveAttributes(
    node,
    ['type', 'title', 'description', 'orientation', 'stacked', 'unit', 'span'],
    ['type', 'title', 'description'],
  )
  const type = String(attributes.type)
  if (!REPORT_CHART_TYPES.has(type)) {
    throw directiveError(`chart type must be one of ${[...REPORT_CHART_TYPES].join(', ')}`)
  }
  const orientation = String(attributes.orientation || 'vertical')
  if (!['vertical', 'horizontal'].includes(orientation)) {
    throw directiveError('chart orientation must be vertical or horizontal')
  }
  if (type !== 'bar' && attributes.orientation != null) {
    throw directiveError('chart orientation is only supported for bar charts')
  }
  const stacked = booleanAttribute(attributes.stacked, 'chart stacked')
  if (stacked && !['bar', 'area'].includes(type)) {
    throw directiveError('chart stacked is only supported for bar and area charts')
  }
  if (node.children?.length !== 1 || node.children[0].type !== 'table') {
    throw directiveError('chart directive must contain exactly one Markdown table')
  }
  const table = node.children[0]
  const [head, ...body] = table.children || []
  if (!head || !body.length) throw directiveError('chart table needs a header and at least one data row')
  if (body.length > REPORT_MAX_ROWS) throw directiveError(`chart table allows at most ${REPORT_MAX_ROWS} data rows`)
  const headers = head.children.map(tableCellText)
  if (headers.length < 2 || headers.some((entry) => !entry)) {
    throw directiveError('chart table needs a category column and at least one named value column')
  }
  if (headers.length - 1 > REPORT_MAX_SERIES) {
    throw directiveError(`chart table allows at most ${REPORT_MAX_SERIES} data series`)
  }
  if (type === 'donut' && headers.length !== 2) {
    throw directiveError('donut chart table needs exactly one category and one value column')
  }
  const rows = body.map((row, rowIndex) => {
    if (row.children.length !== headers.length) {
      throw directiveError(`chart table row ${rowIndex + 1} must have ${headers.length} cells`)
    }
    const cells = row.children.map(tableCellText)
    if (!cells[0]) throw directiveError(`chart table row ${rowIndex + 1} needs a category`)
    return [
      cells[0],
      ...cells.slice(1).map((value, valueIndex) => {
        if (value === '—') return null
        if (!value)
          throw directiveError(`chart table row ${rowIndex + 1}, column ${valueIndex + 2} needs a number or —`)
        const number = Number(value)
        if (!Number.isFinite(number)) {
          throw directiveError(`chart table row ${rowIndex + 1}, column ${valueIndex + 2} must be a finite number or —`)
        }
        return number
      }),
    ]
  })
  const chart = {
    id: charts.length,
    type,
    title: boundedText(attributes.title, 'chart title', 160),
    description: boundedText(attributes.description, 'chart description', 500),
    orientation,
    stacked,
    unit: boundedText(attributes.unit, 'chart unit', 16),
    headers,
    rows,
  }
  charts.push(chart)
  return chart
}

function reportDirectives(meta, charts) {
  return (tree) => {
    visit(tree, ['containerDirective', 'leafDirective', 'textDirective'], (node) => {
      const data = node.data || (node.data = {})
      if (['note', 'tip', 'warning'].includes(node.name)) {
        data.hName = 'aside'
        data.hProperties = { className: ['callout', `callout-${node.name}`], role: 'note' }
      } else if (['hero', 'features', 'steps', 'cta'].includes(node.name)) {
        data.hName = 'section'
        data.hProperties = { className: ['content-block', `content-block-${node.name}`] }
      } else if (REPORT_DIRECTIVES.has(node.name)) {
        if (meta.layout !== 'report') throw directiveError(`${node.name} directive requires frontmatter layout: report`)
        if (node.name === 'report-grid') {
          const attributes = directiveAttributes(node, ['columns'])
          const columns = integerAttribute(attributes.columns, 'report-grid columns', { min: 1, max: 4, fallback: 4 })
          data.hName = 'div'
          data.hProperties = { className: ['report-grid', `report-columns-${columns}`] }
        } else if (node.name === 'report-card') {
          const attributes = directiveAttributes(node, ['title', 'span'], ['title'])
          const title = boundedText(attributes.title, 'report-card title', 160)
          data.hName = 'section'
          data.hProperties = { className: ['report-card', spanClass(attributes)] }
          node.children.unshift({ type: 'heading', depth: 3, children: [{ type: 'text', value: title }] })
        } else if (node.name === 'metric') {
          const attributes = directiveAttributes(node, ['label', 'value', 'trend', 'tone', 'span'], ['label', 'value'])
          const tone = toneAttribute(attributes.tone, 'metric tone')
          data.hName = 'article'
          data.hProperties = { className: ['report-metric', `report-tone-${tone}`, spanClass(attributes)] }
          node.type = 'containerDirective'
          node.children = [
            textNode('span', ['report-metric-label'], boundedText(attributes.label, 'metric label', 120)),
            textNode('strong', ['report-metric-value'], boundedText(attributes.value, 'metric value', 120)),
            ...(attributes.trend
              ? [textNode('span', ['report-metric-trend'], boundedText(attributes.trend, 'metric trend', 80))]
              : []),
          ]
        } else if (node.name === 'badge') {
          const attributes = directiveAttributes(node, ['tone'])
          const tone = toneAttribute(attributes.tone, 'badge tone')
          if (!headingText(node).trim()) throw directiveError('badge directive needs visible text')
          data.hName = 'span'
          data.hProperties = { className: ['report-badge', `report-tone-${tone}`] }
        } else if (node.name === 'progress') {
          const attributes = directiveAttributes(node, ['label', 'value', 'max', 'span'], ['label', 'value'])
          const max = Number(attributes.max ?? 100)
          const value = Number(attributes.value)
          if (!Number.isFinite(max) || max <= 0) throw directiveError('progress max must be a positive number')
          if (!Number.isFinite(value) || value < 0 || value > max) {
            throw directiveError('progress value must be a number from 0 to max')
          }
          const percentage = Number(((value / max) * 100).toFixed(4))
          data.hName = 'div'
          data.hProperties = {
            className: ['report-progress', spanClass(attributes)],
            role: 'progressbar',
            ariaValueMin: 0,
            ariaValueMax: max,
            ariaValueNow: value,
            ariaLabel: boundedText(attributes.label, 'progress label', 120),
          }
          node.type = 'containerDirective'
          node.children = [
            reportNode(
              'div',
              ['report-progress-head'],
              [
                textNode('span', ['report-progress-label'], attributes.label),
                textNode('span', ['report-progress-value'], `${value}/${max}`),
              ],
            ),
            reportNode(
              'div',
              ['report-progress-track'],
              [reportNode('span', ['report-progress-fill'], [], { style: `width:${percentage}%` })],
            ),
          ]
        } else if (node.name === 'chart') {
          const chart = chartDescriptor(node, charts)
          const table = node.children[0]
          data.hName = 'figure'
          data.hProperties = { className: ['report-chart', spanClass(node.attributes || {})] }
          node.children = [
            reportNode('div', ['report-chart-visual'], [], { dataReportChart: chart.id }),
            textNode('figcaption', ['report-chart-caption'], chart.title),
            reportNode(
              'details',
              ['report-chart-data'],
              [textNode('summary', ['report-chart-summary'], 'Data'), table],
            ),
          ]
        }
      } else if (meta.layout === 'report') {
        throw directiveError(`unknown report directive "${node.name}"`)
      }
    })
  }
}

function optionalSlug(value, field) {
  return value == null || value === '' ? null : String(assertSlug(value, field))
}

function validateAccess(value) {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 32) {
    throw Object.assign(new Error('frontmatter access must be a list of at most 32 group slugs'), { statusCode: 422 })
  }
  const groups = value.map((entry) => String(entry).trim().toLowerCase())
  if (groups.some((entry) => !accessSlug.test(entry)) || new Set(groups).size !== groups.length) {
    throw Object.assign(new Error('frontmatter access contains an invalid or duplicate group slug'), {
      statusCode: 422,
    })
  }
  return groups
}

function validateChangeTypes(value) {
  if (value == null) return []
  const allowed = new Set(['added', 'changed', 'deprecated', 'removed', 'fixed', 'security'])
  if (!Array.isArray(value) || value.some((entry) => !allowed.has(String(entry)))) {
    throw Object.assign(new Error(`frontmatter changeTypes must contain only ${[...allowed].join(', ')}`), {
      statusCode: 422,
    })
  }
  return [...new Set(value.map(String))]
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
  tagNames: [
    ...new Set([
      ...(defaultSchema.tagNames || []),
      'aside',
      'input',
      'span',
      'div',
      'pre',
      'article',
      'section',
      'figure',
      'figcaption',
      'details',
      'summary',
      'strong',
    ]),
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...(defaultSchema.attributes?.['*'] || []),
      'className',
      'ariaHidden',
      'ariaLabel',
      'ariaValueMin',
      'ariaValueMax',
      'ariaValueNow',
      'role',
    ],
    a: [...(defaultSchema.attributes?.a || []), 'dataFootnoteRef', 'dataFootnoteBackref'],
    input: ['type', 'checked', 'disabled'],
    code: ['className', 'style'],
    pre: ['className', 'style'],
    span: ['className', 'style'],
    div: ['className', 'style', 'dataReportChart'],
    aside: ['className', 'role'],
    section: ['className'],
    article: ['className'],
    figure: ['className'],
    figcaption: ['className'],
    details: ['className', 'open'],
    summary: ['className'],
    strong: ['className'],
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
  const pageLayout = data.layout == null ? null : String(data.layout)
  if (pageLayout && !layouts.has(pageLayout)) {
    throw Object.assign(new Error(`frontmatter layout must be one of ${[...layouts].join(', ')}`), { statusCode: 422 })
  }
  const reportCadence = data.reportCadence == null ? null : String(data.reportCadence).trim()
  if (reportCadence && !REPORT_CADENCES.has(reportCadence)) {
    throw Object.assign(new Error(`frontmatter reportCadence must be one of ${[...REPORT_CADENCES].join(', ')}`), {
      statusCode: 422,
    })
  }
  if (reportCadence && pageLayout !== 'report') {
    throw Object.assign(new Error('frontmatter reportCadence requires layout: report'), { statusCode: 422 })
  }
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
    layout: pageLayout,
    report_cadence: reportCadence,
    doc_key: optionalSlug(data.docKey, 'docKey'),
    docs_version: optionalSlug(data.docsVersion, 'docsVersion'),
    parent: optionalSlug(data.parent, 'parent'),
    nav_title: data.navTitle == null ? null : String(data.navTitle).trim().slice(0, 120),
    category: data.category == null ? null : String(data.category).trim().slice(0, 120),
    release_version: data.releaseVersion == null ? null : String(data.releaseVersion).trim().slice(0, 64),
    change_types: validateChangeTypes(data.changeTypes),
    access: validateAccess(data.access),
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
  const charts = []
  if (!meta.summary) meta.summary = excerpt(parsed.content.replace(/[`#>*_[\]()!-]/g, ' '))

  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkDirective)
    .use(reportDirectives, meta, charts)
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
  return { meta, html, source: parsed.content, hasMermaid: /class="mermaid"/.test(html), charts, warnings }
}
