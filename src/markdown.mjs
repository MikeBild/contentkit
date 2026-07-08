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

const normalizeTitle = (value) =>
  String(value || '')
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

function validateFrontmatter(data) {
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
  return {
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
    featured: Boolean(data.featured),
    technologies: Array.isArray(data.technologies) ? data.technologies.map(String) : [],
    external_url: data.externalUrl ? String(data.externalUrl) : null,
    nav_order: Number.isFinite(Number(data.navOrder)) ? Number(data.navOrder) : null,
  }
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

export async function renderMarkdown(markdown) {
  const parsed = parseFrontmatter(markdown)
  const meta = validateFrontmatter(parsed.data)
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
  return { meta, html, source: parsed.content, hasMermaid: /class="mermaid"/.test(html) }
}
