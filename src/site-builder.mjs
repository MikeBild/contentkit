import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { renderMarkdown } from './markdown.mjs'
import {
  archiveBody,
  commentsEnabled,
  contactBody,
  contentBody,
  dictionary,
  homeBody,
  layout,
  listingBody,
  searchBody,
} from './templates.mjs'
import { escapeXml, json, slugify } from './utils.mjs'

const text = (body, contentType = 'text/html; charset=utf-8', cacheControl = 'public,max-age=60,must-revalidate') => ({
  body: Buffer.from(body),
  contentType,
  cacheControl,
})

function route(item) {
  if (item.kind === 'post') return `/${item.locale}/blog/${item.slug}/`
  if (item.kind === 'project') return `/${item.locale}/projects/${item.slug}/`
  return `/${item.locale}/${item.slug}/`
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

async function staticAssets(root) {
  const files = new Map()
  const assets = {}
  const emit = (name, body, type) => {
    const hashed = hashedName(name, body)
    files.set(`assets/${hashed}`, text(body, type, 'public,max-age=31536000,immutable'))
    assets[name] = `/assets/${hashed}`
  }
  const css = await readFile(join(root, 'assets/site.css'), 'utf8')
  const katexCss = (await readFile(join(root, 'node_modules/katex/dist/katex.min.css'), 'utf8')).replaceAll(
    'url(fonts/',
    'url(/assets/katex/',
  )
  emit('site.css', `${css}\n${katexCss}`, 'text/css; charset=utf-8')
  for (const name of ['search.js', 'forms.js', 'mermaid-init.js', 'consent.js']) {
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

function rss(site, locale, posts) {
  const items = posts
    .slice(0, 50)
    .map(
      (post) =>
        `<item><title>${escapeXml(post.title)}</title><link>${escapeXml(post.canonical)}</link><guid>${escapeXml(post.canonical)}</guid><description>${escapeXml(post.summary)}</description>${post.published_at ? `<pubDate>${new Date(post.published_at).toUTCString()}</pubDate>` : ''}</item>`,
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(site.name)}</title><link>${escapeXml(absolute(site, `/${locale}/`))}</link><description>${escapeXml(site.description || '')}</description><language>${escapeXml(locale)}</language>${items}</channel></rss>`
}

function sitemap(items) {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${items.map((item) => `<url><loc>${escapeXml(item.canonical)}</loc>${(item.translations || []).map((alt) => `<xhtml:link rel="alternate" hreflang="${escapeXml(alt.locale)}" href="${escapeXml(alt.canonical)}"/>`).join('')}${item.updated_at ? `<lastmod>${escapeXml(item.updated_at)}</lastmod>` : ''}</url>`).join('')}</urlset>`
}

export async function buildSite({ root, site, locales, revisions, comments = [] }) {
  const { files, assets } = await staticAssets(root)
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
  // Static per-locale routes (home, listings, contact …) exist for every
  // configured locale, so their hreflang alternates can be derived directly.
  const staticAlternates = (path) =>
    locales.map((l) => ({ locale: l.locale, canonical: absolute(site, path(l.locale)) }))
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
    const posts = local
      .filter((item) => item.kind === 'post')
      .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
    const projects = local
      .filter((item) => item.kind === 'project')
      .sort((a, b) => Number(b.featured) - Number(a.featured))
    const pages = local.filter((item) => item.kind === 'page')
    const base = { site, locale, t, posts, projects, pages, assets }
    const personData = {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: site.name,
      url: absolute(site, `/${locale}/`),
      sameAs: Object.values(site.settings?.socials || {}),
    }
    const homePath = `/${locale}/`
    files.set(
      `${locale}/index.html`,
      text(
        layout(
          {
            ...base,
            title: site.name,
            description: site.description,
            canonical: absolute(site, homePath),
            currentPath: homePath,
          },
          homeBody(base),
          { structured: personData },
        ),
      ),
    )
    sitemapItems.push({
      canonical: absolute(site, homePath),
      translations: staticAlternates((l) => `/${l}/`),
      updated_at: lastUpdated(local),
    })

    const listingPages = [
      [`${locale}/blog/index.html`, t.blog, posts, `/${locale}/blog/`, 'blog'],
      [`${locale}/projects/index.html`, t.projects, projects, `/${locale}/projects/`, 'projects'],
    ]
    for (const [path, title, items, url, segment] of listingPages) {
      files.set(
        path,
        text(
          layout(
            { ...base, title, description: title, canonical: absolute(site, url), currentPath: url },
            listingBody(title, items),
          ),
        ),
      )
      sitemapItems.push({
        canonical: absolute(site, url),
        translations: staticAlternates((l) => `/${l}/${segment}/`),
        updated_at: lastUpdated(items),
      })
    }
    files.set(
      `${locale}/archive/index.html`,
      text(
        layout(
          { ...base, title: t.archive, description: t.archive, canonical: absolute(site, `/${locale}/archive/`) },
          archiveBody(base),
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
          { ...base, title: t.contact, description: t.contact, canonical: absolute(site, `/${locale}/contact/`) },
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
    const searchIndexItems = local.filter((item) => !item.noindex)
    const includeSearchBody = site.settings?.search?.index_body === true
    files.set(
      `${locale}/search-index.json`,
      text(
        json(
          searchIndexItems.map((item) => ({
            title: item.title,
            summary: item.summary,
            url: item.url,
            text: `${item.title} ${item.summary} ${item.tags.join(' ')}${includeSearchBody ? ` ${item.source || item.markdown}` : ''}`.toLocaleLowerCase(
              locale,
            ),
          })),
        ),
        'application/json; charset=utf-8',
        'public,max-age=60,must-revalidate',
      ),
    )
    files.set(`${locale}/feed.xml`, text(rss(site, locale, posts), 'application/rss+xml; charset=utf-8'))

    // Tags are grouped case-insensitively but keep their first-seen spelling
    // for display; the page URL uses the same slugify() as the card links.
    const tags = new Map()
    for (const post of posts)
      for (const tag of post.tags) {
        const key = tag.toLowerCase()
        if (!tags.has(key)) tags.set(key, { label: tag, items: [] })
        tags.get(key).items.push(post)
      }
    for (const { label, items } of tags.values()) {
      const tagSlug = slugify(label)
      const url = `/${locale}/tags/${tagSlug}/`
      files.set(
        `${locale}/tags/${tagSlug}/index.html`,
        text(
          layout(
            { ...base, title: label, description: label, canonical: absolute(site, url) },
            listingBody(`#${label}`, items),
          ),
        ),
      )
      sitemapItems.push({ canonical: absolute(site, url) })
    }

    for (const item of local) {
      const itemComments = comments.filter(
        (comment) => comment.content_item_id === item.item_id && comment.status === 'approved',
      )
      const structured =
        item.kind === 'post'
          ? {
              '@context': 'https://schema.org',
              '@type': 'BlogPosting',
              headline: item.title,
              description: item.summary,
              datePublished: item.published_at,
              dateModified: item.updated_at || item.published_at,
              url: item.canonical,
              author: { '@type': 'Person', name: site.name },
            }
          : null
      files.set(
        item.url.replace(/^\//, '') + 'index.html',
        text(
          layout(
            {
              ...base,
              title: item.title,
              description: item.summary,
              canonical: item.canonical,
              type: item.kind === 'post' ? 'article' : 'website',
              translations: item.translations,
              currentPath: item.url,
              image: item.cover,
              imageAlt: item.cover_alt,
              noindex: item.noindex,
              publishedTime: item.published_at,
              modifiedTime: item.updated_at || item.published_at,
              articleTags: item.kind === 'post' ? item.tags : [],
            },
            contentBody(item, base, itemComments),
            { structured, mermaid: item.hasMermaid, forms: item.kind === 'post' && commentsEnabled(site) },
          ),
        ),
      )
      if (!item.noindex) sitemapItems.push(item)
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
  files.set('sitemap.xml', text(sitemap(sitemapItems), 'application/xml; charset=utf-8'))
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
          title: '404',
          description: 'Not found',
          canonical: absolute(site, '/404'),
        },
        '<section class="container article-header"><h1>404</h1><p>Not found.</p></section>',
      ),
    ),
  )

  return { files, content: rendered }
}
