import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { renderMarkdown } from './markdown.mjs'
import { materializeReportCharts } from './report-charts.mjs'
import {
  archiveBody,
  blogBody,
  commentsEnabled,
  feedbackEnabled,
  contactBody,
  dictionary,
  extraFieldText,
  presetHomeBody,
  layout,
  listingBody,
  blogcastPage,
  searchBody,
  tagCounts,
  tagsBody,
  structuredContentBody,
} from './templates.mjs'
import { compareDateDesc, escapeXml, excerpt, json, readingTime, slugify } from './utils.mjs'

const text = (body, contentType = 'text/html; charset=utf-8', cacheControl = 'public,max-age=60,must-revalidate') => ({
  body: Buffer.from(body),
  contentType,
  cacheControl,
})

const PRESET_LAYOUT = {
  portfolio: 'standard',
  'product-docs': 'docs',
  wiki: 'wiki',
  'knowledge-base': 'knowledge',
  product: 'landing',
  changelog: 'changelog',
}

function route(item) {
  if (item.kind === 'post') return `/${item.locale}/blog/${item.slug}/`
  if (item.kind === 'project') return `/${item.locale}/projects/${item.slug}/`
  const nested = (item.route_segments || [item.slug]).join('/')
  if (item.layout === 'docs') return `/${item.locale}/docs/${item.docs_version}/${nested}/`
  if (item.layout === 'wiki') return `/${item.locale}/wiki/${nested}/`
  if (item.layout === 'knowledge') return `/${item.locale}/help/${nested}/`
  if (item.layout === 'changelog') return `/${item.locale}/changelog/${item.slug}/`
  return `/${item.locale}/${item.slug}/`
}

function assignContentRoutes(items, site) {
  const preset = site.settings?.presentation?.preset || 'portfolio'
  const versions = site.settings?.presentation?.docs?.versions || []
  const versionIds = new Set(versions.map((entry) => entry.id))
  for (const item of items) {
    item.layout = item.layout || (item.kind === 'page' ? PRESET_LAYOUT[preset] : 'standard') || 'standard'
    if (item.layout === 'docs') {
      if (!item.doc_key || !item.docs_version)
        throw Object.assign(new Error(`docs page "${item.title}" needs docKey and docsVersion`), { statusCode: 422 })
      if (!versionIds.has(item.docs_version))
        throw Object.assign(new Error(`unknown docs version "${item.docs_version}"`), { statusCode: 422 })
    }
    if (['wiki', 'knowledge'].includes(item.layout)) item.doc_key ||= item.translation_key
  }
  const treeItems = items.filter((item) => ['docs', 'wiki', 'knowledge'].includes(item.layout))
  const groups = new Map()
  for (const item of treeItems) {
    const key = `${item.locale}:${item.layout}:${item.docs_version || ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  for (const group of groups.values()) {
    const byKey = new Map()
    for (const item of group) {
      if (byKey.has(item.doc_key))
        throw Object.assign(new Error(`duplicate docKey "${item.doc_key}"`), { statusCode: 422 })
      byKey.set(item.doc_key, item)
    }
    const resolve = (item, visiting = new Set()) => {
      if (item.route_segments) return item.route_segments
      if (visiting.has(item.doc_key))
        throw Object.assign(new Error(`content hierarchy cycle at "${item.doc_key}"`), { statusCode: 422 })
      if (!item.parent) return (item.route_segments = [item.slug])
      const parent = byKey.get(item.parent)
      if (!parent)
        throw Object.assign(new Error(`parent "${item.parent}" not found for "${item.doc_key}"`), { statusCode: 422 })
      return (item.route_segments = [...resolve(parent, new Set(visiting).add(item.doc_key)), item.slug])
    }
    for (const item of group) resolve(item)
  }
  const urls = new Set()
  for (const item of items) {
    item.url = route(item)
    if (urls.has(item.url)) throw Object.assign(new Error(`duplicate generated URL ${item.url}`), { statusCode: 422 })
    urls.add(item.url)
  }
}

function matchingRule(rules, pathname) {
  return [...rules]
    .filter((rule) => (rule.match === 'exact' ? pathname === rule.path : pathname.startsWith(rule.path)))
    .sort((a, b) => Number(b.match === 'exact') - Number(a.match === 'exact') || b.path.length - a.path.length)[0]
}

function sameAccessGrant(left, right) {
  const normalized = (grant, field) => [...(grant?.[field] || [])].sort()
  return (
    JSON.stringify(normalized(left, 'group_slugs')) === JSON.stringify(normalized(right, 'group_slugs')) &&
    JSON.stringify(normalized(left, 'user_ids')) === JSON.stringify(normalized(right, 'user_ids'))
  )
}

// Static HTML cannot vary by reader. A protected page may nevertheless render
// navigation for documents carrying the exact same release-scoped grant: the
// gateway checks that grant before serving the HTML, so no title or summary can
// cross a group boundary. Public pages remain visible alongside those peers.
function pagesVisibleWithGrant(publicPages, allPages, grant) {
  if (!grant) return publicPages
  return [...publicPages, ...allPages.filter((entry) => entry.protected && sameAccessGrant(entry.access_rule, grant))]
}

function absolute(site, path) {
  return `${site.base_url.replace(/\/$/, '')}${path}`
}

// First-party assets carry `immutable` cache headers, so their URLs must be
// content-hashed — otherwise a returning visitor keeps a stale cached copy
// after a release (e.g. an old forms.js against new HTML). The build emits each
// asset at `assets/<name>-<hash>.<ext>` and returns a name->url map that the
// layout uses to reference the current build. Bytes change -> hash changes ->
// new URL -> the browser fetches it; unchanged bytes keep the same URL.
function hashedName(name, body) {
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 10)
  const dot = name.lastIndexOf('.')
  return dot === -1 ? `${name}-${hash}` : `${name.slice(0, dot)}-${hash}${name.slice(dot)}`
}

function emitHashedAsset(files, name, body, contentType) {
  const hashed = hashedName(name, body)
  files.set(`assets/${hashed}`, text(body, contentType, 'public,max-age=31536000,immutable'))
  return `/assets/${hashed}`
}

async function staticAssets(root) {
  const files = new Map()
  const assets = {}
  const emit = (name, body, type) => {
    assets[name] = emitHashedAsset(files, name, body, type)
  }
  const css = await readFile(join(root, 'assets/site.css'), 'utf8')
  const katexCss = (await readFile(join(root, 'node_modules/katex/dist/katex.min.css'), 'utf8')).replaceAll(
    'url(fonts/',
    'url(/assets/katex/',
  )
  emit('site.css', `${css}\n${katexCss}`, 'text/css; charset=utf-8')
  // The audio player's styling stays a separate sheet: layout() links it only on
  // pages that render a player, the same opt-in mechanic as the mermaid scripts.
  emit('audio.css', await readFile(join(root, 'assets/audio.css'), 'utf8'), 'text/css; charset=utf-8')
  for (const name of [
    'search.js',
    'forms.js',
    'mermaid-init.js',
    'consent.js',
    'archive.js',
    'audio.js',
    'ai-actions.js',
    'feedback.js',
  ]) {
    emit(name, await readFile(join(root, `assets/${name}`)), 'application/javascript; charset=utf-8')
  }
  emit(
    'mermaid.min.js',
    await readFile(join(root, 'node_modules/mermaid/dist/mermaid.min.js')),
    'application/javascript; charset=utf-8',
  )
  // Katex fonts keep stable URLs — they are referenced from inside site.css via
  // url(/assets/katex/...) and only change when the katex dependency changes.
  for (const font of await readdir(join(root, 'node_modules/katex/dist/fonts'))) {
    if (!font.endsWith('.woff2')) continue
    files.set(
      `assets/katex/${font}`,
      text(
        await readFile(join(root, `node_modules/katex/dist/fonts/${font}`)),
        'font/woff2',
        'public,max-age=31536000,immutable',
      ),
    )
  }
  return { files, assets }
}

// `<category>` carries the display label, not the slug: it is human-facing.
// `<atom:link rel="self">` is what feed validators want. No `<lastBuildDate>` —
// it would make the bytes, and therefore the release hash, change on every build.
function rss(site, locale, posts, { selfUrl = `/${locale}/feed.xml`, title = site.name } = {}) {
  const items = posts
    .slice(0, 50)
    .map(
      (post) =>
        `<item><title>${escapeXml(post.title)}</title><link>${escapeXml(post.canonical)}</link><guid>${escapeXml(post.canonical)}</guid><description>${escapeXml(post.summary)}</description>${(post.tags || []).map((tag) => `<category>${escapeXml(tag)}</category>`).join('')}${post.published_at ? `<pubDate>${new Date(post.published_at).toUTCString()}</pubDate>` : ''}</item>`,
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${escapeXml(title)}</title><link>${escapeXml(absolute(site, `/${locale}/`))}</link><atom:link rel="self" type="application/rss+xml" href="${escapeXml(absolute(site, selfUrl))}"/><description>${escapeXml(site.description || '')}</description><language>${escapeXml(locale)}</language>${items}</channel></rss>`
}

// The blogcast feed: RSS 2.0 plus the itunes namespace, one <enclosure> per post
// that has read-aloud audio. Same reproducibility contract as rss(): no
// <lastBuildDate>, so identical content yields identical bytes. Channel title
// and description come from settings.audio with the site's own as fallback;
// cover art (blogcast_image, an absolute URL — Apple wants ≥1400px square) and
// itunes:category (blogcast_category, verbatim text) are optional. Linked from
// the layout only when the operator opts in via settings.audio.blogcast_link.
// The podcast_* keys are the deprecated pre-1.8 spellings, still honoured as
// fallbacks. The xmlns:itunes namespace URL is protocol, not branding.
function blogcastRss(site, locale, posts) {
  const settings = site.settings?.audio || {}
  const title = settings.title || site.name
  const description = settings.description || site.description || ''
  const coverUrl = settings.blogcast_image ?? settings.podcast_image
  const categoryText = settings.blogcast_category ?? settings.podcast_category
  const image = coverUrl ? `<itunes:image href="${escapeXml(coverUrl)}"/>` : ''
  const category = categoryText ? `<itunes:category text="${escapeXml(categoryText)}"/>` : ''
  const items = posts
    .slice(0, 50)
    .map(
      (post) =>
        `<item><title>${escapeXml(post.title)}</title><link>${escapeXml(post.canonical)}</link><guid>${escapeXml(post.canonical)}</guid><description>${escapeXml(post.summary)}</description>${post.published_at ? `<pubDate>${new Date(post.published_at).toUTCString()}</pubDate>` : ''}<enclosure url="${escapeXml(absolute(site, post.audio.url))}" type="${escapeXml(post.audio.content_type || 'audio/mpeg')}" length="${Number(post.audio.byte_size) || 0}"/><itunes:duration>${Number(post.audio.duration_secs) || 0}</itunes:duration></item>`,
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>${escapeXml(title)}</title><link>${escapeXml(absolute(site, `/${locale}/`))}</link><atom:link rel="self" type="application/rss+xml" href="${escapeXml(absolute(site, `/${locale}/blogcast.xml`))}"/><description>${escapeXml(description)}</description><language>${escapeXml(locale)}</language><itunes:author>${escapeXml(settings.author || site.name)}</itunes:author>${image}${category}${items}</channel></rss>`
}

// A total, locale-independent comparator. Array.prototype.sort is stable in V8,
// but a total comparator means we never have to rely on that — and unlike
// localeCompare it does not vary with the ICU data compiled into the Node build.
// Releases are immutable and content-hashed, so ordering must be reproducible.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

const tagKeys = (post) => [...new Set((post.tags || []).map(slugify).filter(Boolean))]

// Inverse document frequency per tag slug. A tag carried by every post scores 0:
// `Software` on 60 of 77 posts says almost nothing about what a post is about,
// while `Effect-TS` on 2 posts says almost everything.
export function tagIdf(posts) {
  const df = new Map()
  for (const post of posts) for (const key of tagKeys(post)) df.set(key, (df.get(key) || 0) + 1)
  const idf = new Map()
  for (const [key, count] of df) idf.set(key, Math.log(posts.length / count))
  return idf
}

// Cosine similarity over IDF-weighted binary tag vectors.
//
// Not Jaccard: |A∩B|/|A∪B| scores a shared `Software` exactly like a shared
// `Effect-TS`. Not a raw summed IDF either: that makes the post with eleven tags
// everyone's neighbour, because more tags means more chances to overlap. Cosine
// normalises the vector length away and stays bounded in [0,1].
//
// Math.log is not required by IEEE 754 to be correctly rounded and is not
// bit-identical across V8 versions. That can only perturb the ordering of
// near-equal scores, and the slug tie-break below makes the sort total — so the
// emitted HTML is stable even when the last ULP of a score is not.
export function relatedPosts(post, posts, idf, limit = 3) {
  const own = tagKeys(post)
  const norm = (keys) => Math.sqrt(keys.reduce((sum, key) => sum + (idf.get(key) ?? 0) ** 2, 0))
  const ownNorm = norm(own)
  // A post whose tags are all universal (idf 0) has a zero vector: there is
  // nothing to be related *on*. Guard before dividing.
  if (!ownNorm) return []
  const ownSet = new Set(own)
  const scored = []
  for (const other of posts) {
    if (other.item_id === post.item_id) continue
    const keys = tagKeys(other)
    const otherNorm = norm(keys)
    if (!otherNorm) continue
    let dot = 0
    for (const key of keys) if (ownSet.has(key)) dot += (idf.get(key) ?? 0) ** 2
    if (dot <= 0) continue
    scored.push({ post: other, score: dot / (ownNorm * otherNorm) })
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      cmp(String(b.post.published_at), String(a.post.published_at)) || // newer first
      cmp(a.post.slug, b.post.slug), // unique per locale+kind
  )
  return scored.slice(0, limit).map((entry) => entry.post)
}

// https://llmstxt.org/ — an H1 with the site name, a blockquote summary, then H2
// "file list" sections of markdown links, each optionally followed by `: notes`.
//
// This describes *the site*, not the CMS that built it. contentkit's own
// /llms.txt is a different file on a different host (see isApiHost in routes.mjs).
//
// The `## Optional` heading is specified, not decorative: consumers may skip the
// URLs beneath it when they need a shorter context. So the archive, the tag index,
// the full-content dump and the other locales live there. Its name must stay
// literally "Optional" even on a German site — it is a keyword, not a label.
const LLMS_OPTIONAL_SECTION = 'Optional'

// Square brackets in a title would terminate the link text early.
const llmsLink = (title, url, note) =>
  `- [${String(title).replaceAll('[', '').replaceAll(']', '')}](${url})${note ? `: ${excerpt(note, 200)}` : ''}`

function llmsTxt(site, locale, { t, posts, projects, pages }, locales) {
  const blocks = [`# ${site.name}`, `> ${excerpt(site.description || site.name, 300)}`]
  const linksFor = (items) => items.map((item) => llmsLink(item.title, item.canonical, item.summary))
  const section = (heading, links) => {
    if (links.length) blocks.push(`## ${heading}\n\n${links.join('\n')}`)
  }
  section(t.blog, linksFor(posts))
  section(t.projects, linksFor(projects))
  section(t.pages, linksFor(pages))
  section(LLMS_OPTIONAL_SECTION, [
    llmsLink(t.archive, absolute(site, `/${locale}/archive/`)),
    llmsLink(t.allTags, absolute(site, `/${locale}/tags/`)),
    llmsLink(t.llmsFullContent, absolute(site, `/${locale}/llms-full.txt`)),
    ...locales
      .filter((other) => other !== locale)
      .map((other) => llmsLink(other, absolute(site, `/${other}/llms.txt`))),
  ])
  return `${blocks.join('\n\n')}\n`
}

// The whole corpus as Markdown, in one file, for agents that would otherwise fetch
// every page. contentkit already stores the authored source, so this costs nothing
// to produce — `item.source` is the document with its frontmatter stripped.
//
// Documents are H2 so the file keeps a single H1. Authors conventionally repeat the
// title as a leading `# Heading` in the body; that duplicate is dropped, because the
// heading emitted here already carries it.
//
// A body's own `## Section` sits at the same level as a document title, so documents
// are separated by a horizontal rule: without it the boundary between two posts is
// indistinguishable from a section break inside one.
const stripLeadingH1 = (source) => String(source || '').replace(/^\s*#[^\S\n]+[^\n]*\n+/, '')
const hasMarkdownTwin = (item) => !item.noindex && (item.kind === 'post' || item.layout === 'report')

// One document as Markdown: title heading, canonical URL, the authored TL;DR
// bullets (frontmatter, so they are absent from `source`), then the body. The
// single builder feeds both llms-full.txt (heading '##', documents joined under
// one H1) and the standalone per-post index.md (heading '#') — two renderings
// of the same block, never two implementations.
function itemMarkdown(item, heading = '#', showExtra = false) {
  const tldr = item.tldr?.length ? `${item.tldr.map((line) => `- ${line}`).join('\n')}\n\n` : ''
  // Authored custom fields, one bullet per field — same per-site opt-in
  // (settings.content.show_extra) as the HTML rendering, so the Markdown twin
  // and llms-full.txt never say more than the page does.
  const extraEntries = showExtra ? Object.entries(item.extra || {}) : []
  const extra = extraEntries.length
    ? `${extraEntries.map(([key, value]) => `- ${key}: ${extraFieldText(value)}`).join('\n')}\n\n`
    : ''
  return `${heading} ${item.title}\n\nURL: ${item.canonical}\n\n${tldr}${extra}${stripLeadingH1(item.source).trim()}`
}

function llmsFullTxt(site, items) {
  const showExtra = site.settings?.content?.show_extra === true
  const documents = items.map((item) => `---\n\n${itemMarkdown(item, '##', showExtra)}`)
  return `${[`# ${site.name}`, `> ${excerpt(site.description || site.name, 300)}`, ...documents].join('\n\n')}\n`
}

// JSON-LD for a post page: BlogPosting (with language, keywords, image, reading
// time and — when narrated — the audio enclosure), a BreadcrumbList, and, when
// the author supplied frontmatter `faq`, an FAQPage. Emitted as one JSON array
// in a single script tag, which is valid JSON-LD and keeps layout() unchanged.
// The authored `tldr` doubles as the machine-readable abstract.
function postStructured(site, item, t) {
  const image = item.cover ? (String(item.cover).startsWith('/') ? absolute(site, item.cover) : item.cover) : null
  const posting = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: item.title,
    description: item.summary,
    ...(item.tldr?.length ? { abstract: item.tldr.join(' ') } : {}),
    datePublished: item.published_at,
    dateModified: item.updated_at || item.published_at,
    url: item.canonical,
    mainEntityOfPage: item.canonical,
    inLanguage: item.locale,
    ...(item.tags?.length ? { keywords: item.tags.join(', ') } : {}),
    ...(image ? { image } : {}),
    ...(item.reading_minutes ? { timeRequired: `PT${item.reading_minutes}M` } : {}),
    author: { '@type': 'Person', name: site.name },
    ...(item.audio
      ? {
          audio: {
            '@type': 'AudioObject',
            contentUrl: absolute(site, item.audio.url),
            encodingFormat: item.audio.content_type || 'audio/mpeg',
            ...(Number(item.audio.duration_secs) ? { duration: `PT${Number(item.audio.duration_secs)}S` } : {}),
          },
        }
      : {}),
  }
  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: site.name, item: absolute(site, `/${item.locale}/`) },
      { '@type': 'ListItem', position: 2, name: t.blog, item: absolute(site, `/${item.locale}/blog/`) },
      { '@type': 'ListItem', position: 3, name: item.title, item: item.canonical },
    ],
  }
  const structured = [posting, breadcrumbs]
  if (item.faq?.length) {
    structured.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: item.faq.map((entry) => ({
        '@type': 'Question',
        name: entry.q,
        acceptedAnswer: { '@type': 'Answer', text: entry.a },
      })),
    })
  }
  return structured
}

function sitemap(items) {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${items.map((item) => `<url><loc>${escapeXml(item.canonical)}</loc>${(item.translations || []).map((alt) => `<xhtml:link rel="alternate" hreflang="${escapeXml(alt.locale)}" href="${escapeXml(alt.canonical)}"/>`).join('')}${item.updated_at ? `<lastmod>${escapeXml(item.updated_at)}</lastmod>` : ''}</url>`).join('')}</urlset>`
}

// `now` is injectable so builds are testable and reproducible. It drives the
// post-age notice and the footer's copyright year, which means generated HTML
// varies with build time even when content does not. That is intended: a release
// is an immutable snapshot, so a published release keeps the age notice it was
// built with until the site is published again.
export async function buildSite({
  root,
  site,
  locales,
  revisions,
  comments = [],
  audio = [],
  accessRules = [],
  accessGroups = [],
  now = new Date(),
  logger,
}) {
  const { files, assets } = await staticAssets(root)
  const audioByItem = new Map(audio.map((entry) => [entry.item_id, entry]))
  const rendered = []
  for (const revision of revisions) {
    // Lenient: a stored revision predating today's frontmatter rules (e.g. a
    // malformed `extra:`) renders without the offending field instead of
    // failing the release — write-time validation stays strict.
    const parsed = await renderMarkdown(revision.markdown, { lenient: true })
    const result = materializeReportCharts(parsed, {
      settings: site.settings || {},
      locale: parsed.meta.locale,
      emit: (svg, { scheme }) => emitHashedAsset(files, `report-chart-${scheme}.svg`, svg, 'image/svg+xml'),
    })
    for (const warning of result.warnings) {
      logger?.warn?.(warning, { siteId: site.id, itemId: revision.item_id, slug: result.meta.slug })
    }
    const item = {
      ...revision,
      ...result.meta,
      item_id: revision.item_id,
      html: result.html,
      source: result.source,
      hasMermaid: result.hasMermaid,
      // An authored reporting/content date is semantic and therefore wins over
      // the database activation time. Older documents without one must retain
      // their repository timestamps instead of having the parser's null
      // defaults erase them.
      published_at: result.meta.published_at ?? revision.published_at ?? null,
      updated_at: result.meta.updated_at ?? revision.updated_at ?? null,
      // Derived, not frontmatter: renderMarkdown's `meta` is the authored
      // contract and must not grow fields the author never wrote.
      reading_minutes: result.meta.kind === 'post' ? readingTime(result.source) : 0,
      // The read-aloud asset for this item, if one exists — the frontmatter
      // opt-out (audio: false) wins even over an already-generated asset.
      audio: result.meta.audio === false ? null : audioByItem.get(revision.item_id) || null,
    }
    rendered.push(item)
  }

  assignContentRoutes(rendered, site)
  const knownGroups = new Set(accessGroups.map((group) => group.slug))
  for (const item of rendered) {
    if ((item.access || []).some((group) => !knownGroups.has(group))) {
      throw Object.assign(new Error(`unknown access group on "${item.title}"`), { statusCode: 422 })
    }
    const authored = item.access?.length
      ? { match: 'exact', path: item.url, group_slugs: item.access, user_ids: [], content_item_id: item.item_id }
      : null
    item.access_rule = authored || matchingRule(accessRules, item.url) || null
    item.protected = Boolean(item.access_rule)
    item.canonical = absolute(site, item.url)
  }

  const groups = new Map()
  for (const item of rendered) {
    const key = `${item.kind}:${item.translation_key}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  for (const group of groups.values()) {
    for (const item of group) {
      // A public page must never advertise a protected translation through
      // hreflang or the sitemap. Private pages are already reader-gated and may
      // still link to their translated counterparts.
      item.translations = group
        .filter((alternate) => item.protected || !alternate.protected)
        .map((alternate) => ({ locale: alternate.locale, canonical: alternate.canonical }))
    }
  }

  const sitemapItems = []
  const protectedPath = (pathname) =>
    rendered.some((item) => item.url === pathname && item.protected) || Boolean(matchingRule(accessRules, pathname))
  // Static per-locale routes (home, listings, contact …) exist for every
  // configured locale, so their hreflang alternates can be derived directly.
  const staticAlternates = (path) =>
    locales
      .map((l) => ({ locale: l.locale, pathname: path(l.locale) }))
      .filter((entry) => !protectedPath(entry.pathname))
      .map((entry) => ({ locale: entry.locale, canonical: absolute(site, entry.pathname) }))
  const lastUpdated = (items) =>
    items
      .map((item) => item.updated_at || item.published_at)
      .filter(Boolean)
      .sort()
      .pop()
  for (const localeConfig of locales) {
    const locale = localeConfig.locale
    const t = dictionary(locale)
    const local = rendered.filter((item) => item.locale === locale)
    const publicLocal = local.filter((item) => !item.protected)
    // `local` still drives per-item page generation below, so a noindex item keeps
    // its own page. It must not reach any *listing*, though: blog, archive, tag
    // pages, the tag index, RSS, related posts and prev/next all read these two
    // arrays, and a draft has no business being syndicated or recommended.
    const posts = publicLocal
      .filter((item) => item.kind === 'post' && !item.noindex)
      .sort((a, b) => compareDateDesc(a.published_at, b.published_at))
    const projects = publicLocal
      .filter((item) => item.kind === 'project' && !item.noindex)
      .sort((a, b) => Number(b.featured) - Number(a.featured))
    const pages = publicLocal.filter((item) => item.kind === 'page')
    const allPages = local.filter((item) => item.kind === 'page')

    // Related posts and prev/next are read off `posts`, which excludes noindex
    // items — so a draft is never recommended, and a draft's own page gets no
    // prev/next (its item_id is absent from `order`, both lookups miss).
    //
    // Store link projections, not post references: `a.related[0].related[0]`
    // would otherwise cycle back to `a`, and buildSite returns these items to
    // its caller as `content`.
    const link = (post) => (post ? { title: post.title, url: post.url } : null)
    const idf = tagIdf(posts)
    const order = new Map(posts.map((post, index) => [post.item_id, index]))
    // Authored `related:` references lead the list in the author's order; tag
    // similarity fills up to three. `posts` excludes noindex items, so a
    // reference to a draft resolves to nothing — dropped with a warning, never
    // a build failure: the referenced post may simply not be published yet.
    const bySlug = new Map(posts.map((post) => [post.slug, post]))
    const authoredRelated = (post) => {
      const targets = []
      for (const slug of post.related_slugs || []) {
        const target = bySlug.get(slug)
        if (target) targets.push(target)
        else logger?.warn?.('related reference not found', { siteId: site.id, locale, slug: post.slug, related: slug })
      }
      return targets
    }
    const relations = posts.map((post) => {
      const index = order.get(post.item_id)
      const authored = authoredRelated(post)
      const authoredIds = new Set(authored.map((entry) => entry.item_id))
      // Over-fetch by the authored count so filtering them out cannot leave
      // the fill short of candidates.
      const fill = relatedPosts(post, posts, idf, 3 + authored.length)
        .filter((entry) => !authoredIds.has(entry.item_id))
        .slice(0, Math.max(0, 3 - authored.length))
      return {
        related: [...authored, ...fill].map(link),
        // `posts` is published_at DESC, so the *next* entry is the older one.
        newer: link(posts[index - 1]),
        older: link(posts[index + 1]),
      }
    })
    posts.forEach((post, index) => Object.assign(post, relations[index]))

    // Whether this locale's blogcast feed will exist at all (same condition as
    // the blogcast.xml emit below) — templates hide every blogcast link without it.
    const blogcast = site.settings?.audio?.enabled === true && posts.some((post) => post.audio)
    const base = { site, locale, t, posts, projects, pages, allPages, assets, now, blogcast }
    const personData = {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: site.name,
      url: absolute(site, `/${locale}/`),
      sameAs: Object.values(site.settings?.socials || {}),
    }
    const homePath = `/${locale}/`
    const homeGrant = matchingRule(accessRules, homePath)
    const homeBase = { ...base, pages: pagesVisibleWithGrant(pages, allPages, homeGrant) }
    files.set(
      `${locale}/index.html`,
      text(
        layout(
          {
            ...homeBase,
            title: site.name,
            description: site.description,
            canonical: absolute(site, homePath),
            currentPath: homePath,
          },
          presetHomeBody(homeBase),
          { structured: personData },
        ),
      ),
    )
    sitemapItems.push({
      canonical: absolute(site, homePath),
      translations: staticAlternates((l) => `/${l}/`),
      updated_at: lastUpdated(local),
    })

    // The blog is a feed (capped, with topic chips), the projects listing is a
    // plain grid — so only the latter still uses listingBody(), which also serves
    // the tag pages unchanged.
    const blogPath = `/${locale}/blog/`
    files.set(
      `${locale}/blog/index.html`,
      text(
        layout(
          { ...base, title: t.blog, description: t.blog, canonical: absolute(site, blogPath), currentPath: blogPath },
          blogBody(base),
          // The subscribe row's copy button needs the shared clipboard module.
          { aiActions: site.settings?.blog?.subscribe_row !== false },
        ),
      ),
    )
    sitemapItems.push({
      canonical: absolute(site, blogPath),
      translations: staticAlternates((l) => `/${l}/blog/`),
      updated_at: lastUpdated(posts),
    })

    const projectsPath = `/${locale}/projects/`
    files.set(
      `${locale}/projects/index.html`,
      text(
        layout(
          {
            ...base,
            title: t.projects,
            description: t.projects,
            canonical: absolute(site, projectsPath),
            currentPath: projectsPath,
          },
          listingBody(t.projects, projects),
        ),
      ),
    )
    sitemapItems.push({
      canonical: absolute(site, projectsPath),
      translations: staticAlternates((l) => `/${l}/projects/`),
      updated_at: lastUpdated(projects),
    })
    files.set(
      `${locale}/archive/index.html`,
      text(
        layout(
          {
            ...base,
            title: t.archive,
            description: t.archive,
            canonical: absolute(site, `/${locale}/archive/`),
            currentPath: `/${locale}/archive/`,
          },
          archiveBody(base),
          { archive: true },
        ),
      ),
    )
    files.set(
      `${locale}/search/index.html`,
      text(
        layout(
          {
            ...base,
            title: t.search,
            description: t.search,
            canonical: absolute(site, `/${locale}/search/`),
            currentPath: `/${locale}/search/`,
            noindex: true,
          },
          searchBody(base),
        ),
      ),
    )
    files.set(
      `${locale}/contact/index.html`,
      text(
        layout(
          {
            ...base,
            title: t.contact,
            description: t.contact,
            canonical: absolute(site, `/${locale}/contact/`),
            currentPath: `/${locale}/contact/`,
          },
          contactBody(base),
          { forms: true },
        ),
      ),
    )
    sitemapItems.push(
      {
        canonical: absolute(site, `/${locale}/archive/`),
        translations: staticAlternates((l) => `/${l}/archive/`),
        updated_at: lastUpdated(posts),
      },
      { canonical: absolute(site, `/${locale}/contact/`), translations: staticAlternates((l) => `/${l}/contact/`) },
    )
    const searchIndexItems = publicLocal.filter((item) => !item.noindex)
    const includeSearchBody = site.settings?.search?.index_body === true
    files.set(
      `${locale}/search-index.json`,
      text(
        json(
          searchIndexItems.map((item) => ({
            title: item.title,
            summary: item.summary,
            url: item.url,
            text: `${item.title} ${item.summary} ${item.tags.join(' ')}${item.tldr?.length ? ` ${item.tldr.join(' ')}` : ''}${includeSearchBody ? ` ${item.source || item.markdown}` : ''}`.toLocaleLowerCase(
              locale,
            ),
          })),
        ),
        'application/json; charset=utf-8',
        'public,max-age=60,must-revalidate',
      ),
    )
    files.set(`${locale}/feed.xml`, text(rss(site, locale, posts), 'application/rss+xml; charset=utf-8'))

    const collections = [
      ['wiki', `/${locale}/wiki/`, 'Wiki'],
      ['knowledge', `/${locale}/help/`, locale.startsWith('de') ? 'Hilfe & Wissen' : 'Help center'],
      ['changelog', `/${locale}/changelog/`, 'Changelog'],
    ]
    for (const [contentLayout, collectionPath, title] of collections) {
      const items = pages.filter((item) => item.layout === contentLayout)
      const presetForLayout = { wiki: 'wiki', knowledge: 'knowledge-base', changelog: 'changelog' }[contentLayout]
      if (!items.length && site.settings?.presentation?.preset !== presetForLayout) continue
      files.set(
        `${collectionPath.slice(1)}index.html`,
        text(
          layout(
            {
              ...base,
              title,
              description: title,
              canonical: absolute(site, collectionPath),
              currentPath: collectionPath,
            },
            listingBody(title, items),
          ),
        ),
      )
      sitemapItems.push({ canonical: absolute(site, collectionPath), updated_at: lastUpdated(items) })
    }

    const docVersions = site.settings?.presentation?.docs?.versions || []
    if (docVersions.length) {
      const docsRoot = `/${locale}/docs/`
      const currentVersion = docVersions.find((entry) => entry.status === 'current')
      const currentDocs = pages.filter((item) => item.layout === 'docs' && item.docs_version === currentVersion?.id)
      files.set(
        `${locale}/docs/index.html`,
        text(
          layout(
            {
              ...base,
              title: 'Documentation',
              description: site.description,
              canonical: absolute(site, docsRoot),
              currentPath: docsRoot,
            },
            listingBody('Documentation', currentDocs),
          ),
        ),
      )
      sitemapItems.push({ canonical: absolute(site, docsRoot), updated_at: lastUpdated(currentDocs) })
      for (const version of docVersions) {
        const versionPath = `/${locale}/docs/${version.id}/`
        const versionPages = pages.filter((item) => item.layout === 'docs' && item.docs_version === version.id)
        files.set(
          `${locale}/docs/${version.id}/index.html`,
          text(
            layout(
              {
                ...base,
                title: `Documentation ${version.label}`,
                description: site.description,
                canonical: absolute(site, versionPath),
                currentPath: versionPath,
                robots: version.status === 'archived' ? 'noindex,follow' : '',
              },
              listingBody(`Documentation ${version.label}`, versionPages),
            ),
          ),
        )
        if (version.status === 'current')
          sitemapItems.push({ canonical: absolute(site, versionPath), updated_at: lastUpdated(versionPages) })
      }
    }

    // Blogcast feed only where it has something to say: the site opted in and at
    // least one (indexable) post carries audio. The XML itself gets no sitemap
    // entry — podcast apps subscribe by URL, crawlers have the main feed; a
    // layout <link> appears only with settings.audio.blogcast_link (see layout()).
    //
    // The same gate also builds the human-facing page at /{locale}/blogcast/ —
    // header, episode list, players. Deliberately NOT gated on blogcast_link:
    // that flag only controls the *advertising* (head link, footer item), the
    // page is content. It is indexable and goes into the sitemap, but — like
    // the individual tag pages, and unlike the blog listing — without hreflang
    // alternates: the page only exists in locales that have narrated posts, so
    // alternates derived from the locale list could point at 404s.
    const audioPosts = posts.filter((post) => post.audio)
    if (site.settings?.audio?.enabled === true && audioPosts.length) {
      files.set(
        `${locale}/blogcast.xml`,
        text(blogcastRss(site, locale, audioPosts), 'application/rss+xml; charset=utf-8'),
      )
      const blogcastPath = `/${locale}/blogcast/`
      const audioSettings = site.settings.audio
      files.set(
        `${locale}/blogcast/index.html`,
        text(
          layout(
            {
              ...base,
              title: audioSettings.title || site.name,
              description: audioSettings.description || site.description,
              canonical: absolute(site, blogcastPath),
              currentPath: blogcastPath,
            },
            blogcastPage(base, audioPosts),
            // aiActions: the subscribe row's copy-feed-URL button.
            { audio: true, aiActions: true },
          ),
        ),
      )
      sitemapItems.push({ canonical: absolute(site, blogcastPath), updated_at: lastUpdated(audioPosts) })
    }

    // Per-locale llms.txt, plus a copy of the default locale's at the site root —
    // the spec puts the file at `/llms.txt` but allows subpaths, and a multilingual
    // site should not have to pick one language for its only entry point.
    // `posts`/`projects` already exclude noindex; `pages` does not, so filter here.
    const llmsPages = pages.filter((page) => !page.noindex)
    const localeCodes = locales.map((entry) => entry.locale)
    const indexable = [...posts, ...projects, ...llmsPages]
    const llmsIndex = text(
      llmsTxt(site, locale, { t, posts, projects, pages: llmsPages }, localeCodes),
      'text/plain; charset=utf-8',
    )
    const llmsFull = text(llmsFullTxt(site, indexable), 'text/plain; charset=utf-8')
    files.set(`${locale}/llms.txt`, llmsIndex)
    files.set(`${locale}/llms-full.txt`, llmsFull)
    if (locale === site.default_locale) {
      files.set('llms.txt', llmsIndex)
      files.set('llms-full.txt', llmsFull)
    }

    // Tags are grouped by their *slug*, not by tag.toLowerCase(), because the slug
    // is what names the file. Keying on the lowercased label while writing to
    // slugify(label) let `Node JS` and `Node.js` both target node-js/index.html —
    // last writer won and the first tag's posts silently vanished. Grouping on the
    // slug merges them instead. First-seen spelling is kept for display.
    // Known limit: slugify() maps `C`, `C#` and `C++` all to `c`, so those merge
    // too. Nothing short of a smarter slugify() can separate them.
    const tags = new Map()
    for (const post of posts)
      for (const tag of post.tags) {
        const key = slugify(tag)
        if (!key) continue // e.g. '###' -> '' -> would write `${locale}/tags//index.html`
        if (!tags.has(key)) tags.set(key, { label: tag, slug: key, items: [] })
        tags.get(key).items.push(post)
      }
    // The tag index. Every card's tag pill has always pointed at
    // /{locale}/tags/{slug}/ while /{locale}/tags/ itself was a 404. Unlike the
    // individual tag pages it exists in every locale unconditionally, so it can
    // carry hreflang alternates.
    const tagsPath = `/${locale}/tags/`
    files.set(
      `${locale}/tags/index.html`,
      text(
        layout(
          {
            ...base,
            title: t.allTags,
            description: t.allTags,
            canonical: absolute(site, tagsPath),
            currentPath: tagsPath,
          },
          tagsBody(base, tagCounts(posts)),
        ),
      ),
    )
    sitemapItems.push({
      canonical: absolute(site, tagsPath),
      translations: staticAlternates((l) => `/${l}/tags/`),
      updated_at: lastUpdated(posts),
    })

    for (const { label, slug: tagSlug, items } of tags.values()) {
      const url = `/${locale}/tags/${tagSlug}/`
      // A one-post tag page duplicates that post's card, and a long tail of them
      // dilutes crawl budget. Keep the page (cards link to it; it must not 404),
      // but noindex it — with `follow`, never `nofollow`, so link equity still
      // reaches the post it lists. No sitemap entry, and no feed nobody would read.
      const thin = items.length < 2
      const feedUrl = thin ? undefined : `${url}feed.xml`
      files.set(
        `${locale}/tags/${tagSlug}/index.html`,
        text(
          layout(
            {
              ...base,
              title: label,
              description: label,
              canonical: absolute(site, url),
              currentPath: url,
              robots: thin ? 'noindex,follow' : '',
              // Individual tag pages get no hreflang: tag slugs are locale-specific
              // (`softwarearchitektur` vs `software-architecture`), so alternates
              // derived from this path would point at URLs that do not exist.
              feedUrl,
              feedTitle: feedUrl ? `${site.name} · ${label}` : undefined,
            },
            listingBody(`#${label}`, items),
          ),
        ),
      )
      if (!thin) {
        files.set(
          `${locale}/tags/${tagSlug}/feed.xml`,
          text(
            rss(site, locale, items, { selfUrl: feedUrl, title: `${site.name} · ${label}` }),
            'application/rss+xml; charset=utf-8',
          ),
        )
        sitemapItems.push({ canonical: absolute(site, url), updated_at: lastUpdated(items) })
      }
    }

    for (const item of local) {
      const itemComments = comments.filter(
        (comment) => comment.content_item_id === item.item_id && comment.status === 'approved',
      )
      const structured = item.kind === 'post' ? postStructured(site, item, t) : null
      const archivedDocs =
        item.layout === 'docs' &&
        site.settings?.presentation?.docs?.versions?.find((entry) => entry.id === item.docs_version)?.status ===
          'archived'
      // The raw-Markdown twin of a post or report, for readers feeding the
      // authored artifact into their own tools and for agents that prefer
      // Markdown over HTML. noindex content gets none: its HTML page at least carries a robots meta,
      // a bare .md file could not ask crawlers for the same restraint.
      const markdownUrl = hasMarkdownTwin(item) ? `${item.url}index.md` : undefined
      const itemBase = {
        ...base,
        pages: item.protected ? pagesVisibleWithGrant(pages, allPages, item.access_rule) : pages,
      }
      if (markdownUrl) {
        files.set(
          markdownUrl.replace(/^\//, ''),
          text(
            `${itemMarkdown(item, '#', site.settings?.content?.show_extra === true)}\n`,
            'text/markdown; charset=utf-8',
          ),
        )
      }
      files.set(
        item.url.replace(/^\//, '') + 'index.html',
        text(
          layout(
            {
              ...itemBase,
              title: item.title,
              description: item.summary,
              canonical: item.canonical,
              type: item.kind === 'post' ? 'article' : 'website',
              translations: item.translations,
              currentPath: item.url,
              image: item.cover,
              imageAlt: item.cover_alt,
              noindex: item.noindex || item.protected,
              robots: archivedDocs ? 'noindex,follow' : undefined,
              publishedTime: item.published_at,
              modifiedTime: item.updated_at || item.published_at,
              articleTags: item.kind === 'post' ? item.tags : [],
              markdownUrl,
            },
            structuredContentBody(item, itemBase, itemComments),
            {
              structured,
              mermaid: item.hasMermaid,
              forms: item.kind === 'post' && commentsEnabled(site),
              feedback: item.kind === 'post' && feedbackEnabled(site),
              audio: Boolean(item.audio),
              // The copy button only enhances a page that has a Markdown twin,
              // and only when the share row is not switched off per site.
              aiActions: Boolean(markdownUrl) && site.settings?.ai?.share_buttons !== false,
            },
          ),
        ),
      )
      if (!item.noindex && !item.protected && !archivedDocs) sitemapItems.push(item)
    }
  }

  files.set(
    'index.html',
    text(
      `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/${site.default_locale}/"><link rel="canonical" href="/${site.default_locale}/">`,
    ),
  )
  files.set(
    'robots.txt',
    text(`User-agent: *\nAllow: /\nSitemap: ${absolute(site, '/sitemap.xml')}\n`, 'text/plain; charset=utf-8'),
  )

  const settings = site.settings || {}
  const icons = settings.favicon
    ? [{ src: settings.favicon, sizes: 'any', ...(settings.favicon.endsWith('.svg') ? { type: 'image/svg+xml' } : {}) }]
    : []
  files.set(
    'manifest.webmanifest',
    text(
      json({
        name: site.name,
        short_name: site.name,
        start_url: `/${site.default_locale}/`,
        display: 'standalone',
        theme_color: settings.theme_color || '#ffffff',
        background_color: settings.theme_color || '#ffffff',
        icons,
      }),
      'application/manifest+json; charset=utf-8',
      'public,max-age=3600',
    ),
  )

  // GA4's gtag loader is no longer injected here: consent.js (a hashed static
  // asset) withholds it until the visitor opts in. The measurement id reaches
  // that generic asset via the head tag's data-ga-id, so nothing per-site is
  // emitted for analytics anymore.
  const publicSitemapItems = sitemapItems
    .filter((item) => !protectedPath(new URL(item.canonical).pathname))
    .map((item) => ({
      ...item,
      ...(item.translations
        ? {
            translations: item.translations.filter(
              (alternate) => !protectedPath(new URL(alternate.canonical).pathname),
            ),
          }
        : {}),
    }))
  files.set('sitemap.xml', text(sitemap(publicSitemapItems), 'application/xml; charset=utf-8'))
  files.set(
    '404.html',
    text(
      layout(
        {
          site,
          locale: site.default_locale,
          t: dictionary(site.default_locale),
          posts: [],
          projects: [],
          pages: [],
          // Without the asset map layout() falls back to unhashed /assets/site.css,
          // which no release contains — the 404 page would render unstyled.
          assets,
          now,
          title: '404',
          description: 'Not found',
          canonical: absolute(site, '/404'),
        },
        '<section class="container article-header"><h1>404</h1><p>Not found.</p></section>',
      ),
    ),
  )

  const accessEntries = accessRules.flatMap((rule) => {
    const entry = {
      site_id: site.id,
      match: rule.match,
      path: rule.path,
      group_slugs: rule.group_slugs || [],
      user_ids: rule.user_ids || [],
      content_item_id: null,
    }
    return rule.match === 'exact' && rule.path.endsWith('/')
      ? [entry, { ...entry, path: `${rule.path}index.html` }]
      : [entry]
  })
  for (const item of rendered) {
    if (!item.protected) continue
    accessEntries.push({
      site_id: site.id,
      // Frontmatter protects this canonical document only. Authors use an
      // explicit prefix rule when an entire subtree must inherit the grant.
      match: 'exact',
      path: item.url,
      group_slugs: item.access_rule.group_slugs || [],
      user_ids: item.access_rule.user_ids || [],
      content_item_id: item.item_id,
    })
    // The gateway accepts the clean URL and the physical index.html path. Both
    // must carry the same grant so a caller cannot bypass authorization by
    // requesting the release object spelling directly.
    accessEntries.push({
      site_id: site.id,
      match: 'exact',
      path: `${item.url}index.html`,
      group_slugs: item.access_rule.group_slugs || [],
      user_ids: item.access_rule.user_ids || [],
      content_item_id: item.item_id,
    })
    if (hasMarkdownTwin(item)) {
      accessEntries.push({
        site_id: site.id,
        match: 'exact',
        path: `${item.url}index.md`,
        group_slugs: item.access_rule.group_slugs || [],
        user_ids: item.access_rule.user_ids || [],
        content_item_id: item.item_id,
      })
    }
  }
  // A protected-only media URL inherits the page grant. If the same URL is
  // referenced by public content it stays public and the builder warns.
  const media = new Map()
  for (const item of rendered) {
    const urls = [
      ...`${item.html || ''} ${item.cover || ''} ${item.audio?.url || ''}`.matchAll(
        /\/media\/[0-9a-f-]{36}\/[^"'\s<)]+/gi,
      ),
    ].map((match) => match[0])
    for (const url of urls) {
      const state = media.get(url) || { public: false, grants: [] }
      if (item.protected) state.grants.push(item.access_rule)
      else state.public = true
      media.set(url, state)
    }
  }
  for (const [path, state] of media) {
    if (state.public) {
      if (state.grants.length)
        logger?.warn?.('asset is referenced by public and protected content', { siteId: site.id, path })
      continue
    }
    const groups = [...new Set(state.grants.flatMap((grant) => grant.group_slugs || []))]
    const users = [...new Set(state.grants.flatMap((grant) => grant.user_ids || []))]
    accessEntries.push({
      site_id: site.id,
      match: 'exact',
      path,
      group_slugs: groups,
      user_ids: users,
      content_item_id: null,
    })
  }
  const accessCatalog = rendered
    .filter((item) => item.protected)
    .map((item) => ({
      site_id: site.id,
      content_item_id: item.item_id,
      locale: item.locale,
      title: item.title,
      summary: item.summary,
      url: item.url,
      layout: item.layout,
      parent_key: item.parent,
      nav_order: item.nav_order,
      search_text:
        `${item.title} ${item.summary} ${(item.tags || []).join(' ')} ${item.source || ''}`.toLocaleLowerCase(
          item.locale,
        ),
      group_slugs: item.access_rule.group_slugs || [],
      user_ids: item.access_rule.user_ids || [],
    }))
  const uniqueAccessEntries = [
    ...new Map(accessEntries.map((entry) => [`${entry.match}:${entry.path}`, entry])).values(),
  ]
  return { files, content: rendered, accessEntries: uniqueAccessEntries, accessCatalog }
}
