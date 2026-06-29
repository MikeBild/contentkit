import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { renderMarkdown } from './markdown.mjs'
import { archiveBody, contactBody, contentBody, dictionary, homeBody, layout, listingBody, searchBody } from './templates.mjs'
import { escapeXml, json, slugify } from './utils.mjs'

const text = (body, contentType = 'text/html; charset=utf-8', cacheControl = 'public,max-age=60,must-revalidate') => ({
  body: Buffer.from(body), contentType, cacheControl,
})

function route(item) {
  if (item.kind === 'post') return `/${item.locale}/blog/${item.slug}/`
  if (item.kind === 'project') return `/${item.locale}/projects/${item.slug}/`
  return `/${item.locale}/${item.slug}/`
}

function absolute(site, path) {
  return `${site.base_url.replace(/\/$/, '')}${path}`
}

async function staticAssets(root) {
  const files = new Map()
  const css = await readFile(join(root, 'assets/site.css'), 'utf8')
  const katexCss = (await readFile(join(root, 'node_modules/katex/dist/katex.min.css'), 'utf8'))
    .replaceAll('url(fonts/', 'url(/assets/katex/')
  files.set('assets/site.css', text(`${css}\n${katexCss}`, 'text/css; charset=utf-8', 'public,max-age=31536000,immutable'))
  for (const name of ['search.js', 'forms.js', 'mermaid-init.js']) {
    files.set(`assets/${name}`, text(await readFile(join(root, `assets/${name}`)), 'application/javascript; charset=utf-8', 'public,max-age=31536000,immutable'))
  }
  files.set('assets/mermaid.min.js', text(await readFile(join(root, 'node_modules/mermaid/dist/mermaid.min.js')), 'application/javascript; charset=utf-8', 'public,max-age=31536000,immutable'))
  for (const font of await readdir(join(root, 'node_modules/katex/dist/fonts'))) {
    if (!font.endsWith('.woff2')) continue
    files.set(`assets/katex/${font}`, text(await readFile(join(root, `node_modules/katex/dist/fonts/${font}`)), 'font/woff2', 'public,max-age=31536000,immutable'))
  }
  return files
}

function rss(site, locale, posts) {
  const items = posts.slice(0, 50).map((post) => `<item><title>${escapeXml(post.title)}</title><link>${escapeXml(post.canonical)}</link><guid>${escapeXml(post.canonical)}</guid><description>${escapeXml(post.summary)}</description>${post.published_at ? `<pubDate>${new Date(post.published_at).toUTCString()}</pubDate>` : ''}</item>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(site.name)}</title><link>${escapeXml(absolute(site, `/${locale}/`))}</link><description>${escapeXml(site.description || '')}</description><language>${escapeXml(locale)}</language>${items}</channel></rss>`
}

function sitemap(items) {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${items.map((item) => `<url><loc>${escapeXml(item.canonical)}</loc>${(item.translations || []).map((alt) => `<xhtml:link rel="alternate" hreflang="${escapeXml(alt.locale)}" href="${escapeXml(alt.canonical)}"/>`).join('')}${item.updated_at ? `<lastmod>${escapeXml(item.updated_at)}</lastmod>` : ''}</url>`).join('')}</urlset>`
}

export async function buildSite({ root, site, locales, revisions, comments = [] }) {
  const files = await staticAssets(root)
  const rendered = []
  for (const revision of revisions) {
    const result = await renderMarkdown(revision.markdown)
    const item = {
      ...revision,
      ...result.meta,
      item_id: revision.item_id,
      html: result.html,
      source: result.source,
      hasMermaid: result.hasMermaid,
    }
    item.url = route(item)
    item.canonical = absolute(site, item.url)
    rendered.push(item)
  }

  const groups = new Map()
  for (const item of rendered) {
    const key = `${item.kind}:${item.translation_key}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  for (const group of groups.values()) {
    for (const item of group) {
      item.translations = group.map((alt) => ({ locale: alt.locale, canonical: alt.canonical }))
    }
  }

  const sitemapItems = []
  for (const localeConfig of locales) {
    const locale = localeConfig.locale
    const t = dictionary(locale)
    const local = rendered.filter((item) => item.locale === locale)
    const posts = local.filter((item) => item.kind === 'post').sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
    const projects = local.filter((item) => item.kind === 'project').sort((a, b) => Number(b.featured) - Number(a.featured))
    const pages = local.filter((item) => item.kind === 'page')
    const base = { site, locale, t, posts, projects, pages }
    const personData = {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: site.name,
      url: absolute(site, `/${locale}/`),
      sameAs: Object.values(site.settings?.socials || {}),
    }
    const homePath = `/${locale}/`
    files.set(`${locale}/index.html`, text(layout({
      ...base, title: site.name, description: site.description, canonical: absolute(site, homePath), currentPath: homePath,
    }, homeBody(base), { structured: personData })))
    sitemapItems.push({ canonical: absolute(site, homePath) })

    const listingPages = [
      [`${locale}/blog/index.html`, t.blog, posts, `/${locale}/blog/`],
      [`${locale}/projects/index.html`, t.projects, projects, `/${locale}/projects/`],
    ]
    for (const [path, title, items, url] of listingPages) {
      files.set(path, text(layout({ ...base, title, description: title, canonical: absolute(site, url), currentPath: url }, listingBody(title, items))))
      sitemapItems.push({ canonical: absolute(site, url) })
    }
    files.set(`${locale}/archive/index.html`, text(layout({ ...base, title: t.archive, description: t.archive, canonical: absolute(site, `/${locale}/archive/`) }, archiveBody(base))))
    files.set(`${locale}/search/index.html`, text(layout({ ...base, title: t.search, description: t.search, canonical: absolute(site, `/${locale}/search/`) }, searchBody(base), { search: true })))
    files.set(`${locale}/contact/index.html`, text(layout({ ...base, title: t.contact, description: t.contact, canonical: absolute(site, `/${locale}/contact/`) }, contactBody(base), { forms: true })))
    sitemapItems.push(
      { canonical: absolute(site, `/${locale}/archive/`) },
      { canonical: absolute(site, `/${locale}/search/`) },
      { canonical: absolute(site, `/${locale}/contact/`) },
    )
    files.set(`${locale}/search-index.json`, text(json(local.map((item) => ({
      title: item.title, summary: item.summary, url: item.url,
      text: `${item.title} ${item.summary} ${item.tags.join(' ')} ${item.source || item.markdown}`.toLocaleLowerCase(locale),
    }))), 'application/json; charset=utf-8', 'public,max-age=60,must-revalidate'))
    files.set(`${locale}/feed.xml`, text(rss(site, locale, posts), 'application/rss+xml; charset=utf-8'))

    const tags = new Map()
    for (const post of posts) for (const tag of post.tags) {
      const key = tag.toLowerCase()
      if (!tags.has(key)) tags.set(key, [])
      tags.get(key).push(post)
    }
    for (const [tag, items] of tags) {
      const tagSlug = slugify(tag)
      const url = `/${locale}/tags/${tagSlug}/`
      files.set(`${locale}/tags/${tagSlug}/index.html`, text(layout({ ...base, title: tag, description: tag, canonical: absolute(site, url) }, listingBody(`#${tag}`, items))))
      sitemapItems.push({ canonical: absolute(site, url) })
    }

    for (const item of local) {
      const itemComments = comments.filter((comment) => comment.content_item_id === item.item_id && comment.status === 'approved')
      const structured = item.kind === 'post' ? {
        '@context': 'https://schema.org', '@type': 'BlogPosting', headline: item.title,
        description: item.summary, datePublished: item.published_at, dateModified: item.updated_at || item.published_at,
        url: item.canonical, author: { '@type': 'Person', name: site.name },
      } : null
      files.set(item.url.replace(/^\//, '') + 'index.html', text(layout({
        ...base, title: item.title, description: item.summary, canonical: item.canonical,
        type: item.kind === 'post' ? 'article' : 'website', translations: item.translations, currentPath: item.url,
      }, contentBody(item, base, itemComments), { structured, mermaid: item.hasMermaid, forms: item.kind === 'post' })))
      sitemapItems.push(item)
    }
  }

  files.set('index.html', text(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/${site.default_locale}/"><link rel="canonical" href="/${site.default_locale}/">`))
  files.set('robots.txt', text(`User-agent: *\nAllow: /\nSitemap: ${absolute(site, '/sitemap.xml')}\n`, 'text/plain; charset=utf-8'))
  files.set('sitemap.xml', text(sitemap(sitemapItems), 'application/xml; charset=utf-8'))
  files.set('404.html', text(layout({
    site, locale: site.default_locale, t: dictionary(site.default_locale), posts: [], projects: [], pages: [],
    title: '404', description: 'Not found', canonical: absolute(site, '/404'),
  }, '<section class="container article-header"><h1>404</h1><p>Not found.</p></section>')))

  return { files, content: rendered }
}
