import { escapeHtml, json, slugify } from './utils.mjs'

const words = {
  de: {
    blog: 'Blog',
    projects: 'Projekte',
    archive: 'Archiv',
    search: 'Suche',
    contact: 'Kontakt',
    latest: 'Neueste Beiträge',
    selected: 'Ausgewählte Projekte',
    allPosts: 'Alle Beiträge',
    allProjects: 'Alle Projekte',
    published: 'Veröffentlicht',
    updated: 'Aktualisiert',
    searchPlaceholder: 'Website durchsuchen …',
    searchResults: 'Suchergebnisse',
    searchHint: 'Tippe in das Suchfeld oben in der Kopfzeile.',
    noResults: 'Keine Ergebnisse.',
    oneResult: '1 Ergebnis',
    manyResults: '{n} Ergebnisse',
    comments: 'Kommentare',
    comment: 'Kommentar schreiben',
    name: 'Name',
    email: 'E-Mail (optional)',
    message: 'Nachricht',
    send: 'Absenden',
    commentPending: 'Kommentar wurde zur Moderation eingereicht.',
    contactSent: 'Nachricht wurde übermittelt.',
    contactThanksTitle: 'Vielen Dank!',
    contactThanksBody: 'Deine Nachricht ist angekommen — ich melde mich so bald wie möglich bei dir.',
    contactError: 'Senden fehlgeschlagen. Bitte versuche es später erneut.',
    navigation: 'Navigation',
    social: 'Social',
    rss: 'RSS',
    cookieSettings: 'Cookie-Einstellungen',
    readingTime: '≈ {n} Min. Lesezeit',
    postAge: 'Dieser Beitrag ist über {n} Jahre alt. Manches davon ist womöglich nicht mehr aktuell.',
    related: 'Verwandte Beiträge',
    olderPost: 'Älterer Beitrag',
    newerPost: 'Neuerer Beitrag',
    allTags: 'Alle Themen',
    tags: 'Themen',
    allPostsCount: 'Alle {n} Beiträge',
    filterPosts: 'Beiträge filtern',
    resetFilters: 'Filter zurücksetzen',
    postCountOne: '1 Beitrag',
    postCountMany: '{n} Beiträge',
    years: 'Jahre',
    noMatches: 'Keine Beiträge für diese Auswahl.',
    pages: 'Seiten',
    llmsFullContent: 'Vollständiger Inhalt als Markdown',
    listen: 'Diesen Beitrag anhören ({n} Min.)',
    playbackSpeed: 'Wiedergabetempo',
    downloadMp3: 'MP3 herunterladen',
  },
  en: {
    blog: 'Blog',
    projects: 'Projects',
    archive: 'Archive',
    search: 'Search',
    contact: 'Contact',
    latest: 'Latest posts',
    selected: 'Selected projects',
    allPosts: 'All posts',
    allProjects: 'All projects',
    published: 'Published',
    updated: 'Updated',
    searchPlaceholder: 'Search this site …',
    searchResults: 'Search results',
    searchHint: 'Type in the search field in the header above.',
    noResults: 'No results.',
    oneResult: '1 result',
    manyResults: '{n} results',
    comments: 'Comments',
    comment: 'Write a comment',
    name: 'Name',
    email: 'Email (optional)',
    message: 'Message',
    send: 'Send',
    commentPending: 'Your comment was submitted for moderation.',
    contactSent: 'Your message was submitted.',
    contactThanksTitle: 'Thank you!',
    contactThanksBody: "Your message has arrived — I'll get back to you as soon as I can.",
    contactError: 'Sending failed. Please try again later.',
    navigation: 'Navigation',
    social: 'Social',
    rss: 'RSS',
    cookieSettings: 'Cookie settings',
    readingTime: '≈ {n} min read',
    postAge: 'This post is over {n} years old. Some of it may no longer be accurate.',
    related: 'Related posts',
    olderPost: 'Older post',
    newerPost: 'Newer post',
    allTags: 'All topics',
    tags: 'Topics',
    allPostsCount: 'All {n} posts',
    filterPosts: 'Filter posts',
    resetFilters: 'Reset filters',
    postCountOne: '1 post',
    postCountMany: '{n} posts',
    years: 'Years',
    noMatches: 'No posts match this selection.',
    pages: 'Pages',
    llmsFullContent: 'Full content as Markdown',
    listen: 'Listen to this post ({n} min)',
    playbackSpeed: 'Playback speed',
    downloadMp3: 'Download MP3',
  },
}

// The `words` table stays the single source of translation truth: strings that
// client scripts need ride out on data-* attributes, never a second copy in JS.
const fill = (template, values) =>
  String(template).replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match))

const plural = (t, count) => fill(count === 1 ? t.postCountOne : t.postCountMany, { n: count })

// A total comparator that, unlike localeCompare, does not depend on the ICU data
// compiled into the Node build. Releases are content-hashed: ordering must be
// reproducible.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

// Rendered dates must not depend on the build machine's timezone. Without an
// explicit zone, `2026-01-01T00:00:00Z` prints as 31.12.2025 under
// America/New_York and 1.1.2026 under Europe/Berlin — same content, different
// bytes, different asset hash. Format in UTC, and derive the archive's year
// headings from the same ISO prefix so a post can never sit under a heading that
// contradicts its own printed date.
// `toLocaleDateString(undefined)` resolves to the *build machine's* locale, which is
// the same class of nondeterminism as the timezone: a de-DE laptop renders 1.1.2026
// and an en-US CI runner 1/1/2026, from identical content. The locale is therefore
// required, never inferred. Build items always carry one (frontmatter `locale` is
// mandatory); direct callers fall back to the rendering context's locale.
const formatDate = (value, locale) => {
  if (!locale) throw new TypeError('formatDate requires an explicit locale')
  return new Date(value).toLocaleDateString(locale, { timeZone: 'UTC' })
}
const yearOf = (post) => (post.published_at ? String(post.published_at).slice(0, 4) : '')

// Tag frequency across posts, keyed by slug (the same key the tag pages use), so
// spellings that slugify alike are counted once. Sorted by count desc, then label.
export function tagCounts(posts) {
  const tags = new Map()
  for (const post of posts)
    for (const tag of post.tags || []) {
      const slug = slugify(tag)
      if (!slug) continue
      if (!tags.has(slug)) tags.set(slug, { label: tag, slug, count: 0 })
      tags.get(slug).count += 1
    }
  return [...tags.values()].sort((a, b) => b.count - a.count || cmp(a.label, b.label))
}

function safeUrl(value, { relative = false } = {}) {
  const string = String(value || '')
  if (relative && string.startsWith('/') && !string.startsWith('//')) return string
  try {
    const url = new URL(string)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? string : '#'
  } catch {
    return '#'
  }
}

// The theme exposes `--primary` as a shadcn-style "H S% L%" triple and consumes
// it via `hsl(var(--primary))` throughout site.css (e.g. the submit button
// background). settings.accent is authored as a hex color, so it must be
// converted to an HSL triple before it is injected into `--primary` — feeding a
// raw hex produces the invalid `hsl(#2563eb)`, which silently drops the color
// and renders e.g. an invisible (white-on-white) submit button. Values that are
// not `#rgb`/`#rrggbb` (already-triples, named colors) pass through unchanged.
function accentToHslTriple(value) {
  const raw = String(value || '').trim()
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(raw)
  if (!m) return raw
  let hex = m[1]
  if (hex.length === 3)
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

export function dictionary(locale) {
  return words[locale.split('-')[0]] || words.en
}

function navLinks(ctx) {
  const { locale, t, pages, currentPath } = ctx
  // Built-in links carry fixed weights so page frontmatter (navOrder) can slot
  // pages anywhere in the header: below 20 leads the nav, 41…60 trails it.
  // navOrder above 60 is reserved for footer-only legal pages (Impressum,
  // Datenschutzerklärung) — see siteFooter(). Contact is footer-only for the
  // same reason, and search is the header's combobox, not a navigation link.
  const links = [
    ...pages.filter((p) => p.nav_order != null && p.nav_order <= 60).map((p) => [p.title, p.url, p.nav_order]),
    [t.blog, `/${locale}/blog/`, 20],
    [t.archive, `/${locale}/archive/`, 30],
    [t.projects, `/${locale}/projects/`, 40],
  ].sort((a, b) => a[2] - b[2])
  return links
    .map(
      ([label, href]) =>
        `<a href="${escapeHtml(href)}"${currentPath === href ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`,
    )
    .join('')
}

function siteFooter(ctx) {
  const { site, locale, t, pages = [], now = new Date() } = ctx
  const settings = site.settings || {}
  const item = ([label, href], attrs = '') => `<li><a href="${escapeHtml(href)}"${attrs}>${escapeHtml(label)}</a></li>`
  // Pages weighted past the header nav (navOrder > 60, e.g. Impressum,
  // Datenschutzerklärung) are footer-only legal links. Together with the contact
  // page they form this column — and the footer is the only place either is
  // linked from, so this column must never become conditional.
  const legalPages = pages
    .filter((p) => p.nav_order != null && p.nav_order > 60)
    .sort((a, b) => a.nav_order - b.nav_order)
  // The tag index has no header-nav slot (the nav is already four items wide on
  // mobile), so the footer is the only place it is linked from besides the blog's
  // chip row. Without it, /{locale}/tags/ is reachable only by typing the URL.
  const navigation = [
    [t.blog, `/${locale}/blog/`],
    [t.projects, `/${locale}/projects/`],
    [t.archive, `/${locale}/archive/`],
    [t.tags, `/${locale}/tags/`],
  ]
    .map((link) => item(link))
    .join('')
  // GA4 requires an always-available way to revoke consent; consent.js binds the
  // click and reopens the banner (Art. 7 Abs. 3 DSGVO). Plausible/no analytics
  // set nothing, so the control is omitted there.
  const consentControl =
    settings.analytics?.provider === 'ga4' && settings.analytics.id
      ? `<li><button type="button" class="link-button" data-consent-settings>${escapeHtml(t.cookieSettings)}</button></li>`
      : ''
  const contact =
    [[t.contact, `/${locale}/contact/`], ...legalPages.map((p) => [p.title, p.url])]
      .map((link) => item(link))
      .join('') + consentControl
  const social = [
    ...Object.entries(settings.socials || {}).map(([name, url]) => item([name, safeUrl(url)], ' rel="me"')),
    item([t.rss, `/${locale}/feed.xml`]),
    // The podcast feed only exists when audio is enabled, and stays unlisted
    // until the operator opts in — same gate as the <link rel="alternate">.
    ...(settings.audio?.enabled === true && settings.audio?.podcast_link === true
      ? [item(['Podcast', `/${locale}/podcast.xml`])]
      : []),
  ].join('')
  return `<footer class="site-footer"><div class="container">
<div class="footer-grid">
<div class="footer-brand"><span class="brand">${escapeHtml(site.name)}</span>${site.description ? `<p>${escapeHtml(site.description)}</p>` : ''}</div>
<nav class="footer-col" aria-label="${escapeHtml(t.navigation)}"><h2>${escapeHtml(t.navigation)}</h2><ul>${navigation}</ul></nav>
<nav class="footer-col" aria-label="${escapeHtml(t.contact)}"><h2>${escapeHtml(t.contact)}</h2><ul>${contact}</ul></nav>
<div class="footer-col"><h2>${escapeHtml(t.social)}</h2><ul>${social}</ul></div>
</div>
<div class="footer-bottom">© ${now.getUTCFullYear()} ${escapeHtml(site.name)}</div>
</div></footer>`
}

// The header search is a combobox, not navigation, so it sits beside <nav>
// rather than inside it (role="search" contributes its own landmark).
//
// Enter performs a real GET to /{locale}/search/?q=… whenever the lazily fetched
// index is not in memory yet. That page is a static file: this buys deep links
// and Enter-before-index-ready, it is NOT a server-side search without JS.
//
// Localized strings ride on data-* (the same contract forms.js uses for
// data-success), so the `words` table stays the single source of translation
// truth instead of a second copy inside search.js.
//
// role="listbox" may only contain options, so the empty-state paragraph is a
// sibling of the listbox rather than a child, and aria-expanded stays "false"
// when there is nothing to show. The visually hidden role="status" carries the
// result count either way.
function siteSearch(ctx) {
  const { locale, t } = ctx
  return `<form class="site-search" role="search" method="get" action="/${escapeHtml(locale)}/search/" data-site-search>
<label class="sr-only" for="site-search-input">${escapeHtml(t.search)}</label>
<input id="site-search-input" class="search-box" type="search" name="q" maxlength="100" autocomplete="off" spellcheck="false" enterkeyhint="search" placeholder="${escapeHtml(t.searchPlaceholder)}" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="site-search-listbox" data-search-input data-index="/${escapeHtml(locale)}/search-index.json" data-empty-text="${escapeHtml(t.noResults)}" data-count-one="${escapeHtml(t.oneResult)}" data-count-many="${escapeHtml(t.manyResults)}">
<div class="search-panel" data-search-panel hidden><div class="search-results" id="site-search-listbox" role="listbox" aria-label="${escapeHtml(t.searchResults)}" data-search-listbox hidden></div><p class="search-empty" data-search-empty hidden>${escapeHtml(t.noResults)}</p></div>
<div class="sr-only" role="status" aria-live="polite" data-search-status></div>
</form>`
}

function alternateLinks(translations = [], defaultLocale) {
  const links = translations.map(
    (item) => `<link rel="alternate" hreflang="${escapeHtml(item.locale)}" href="${escapeHtml(item.canonical)}">`,
  )
  const fallback = translations.find((item) => item.locale === defaultLocale)
  if (fallback) links.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(fallback.canonical)}">`)
  return links.join('')
}

function absoluteImage(site, image) {
  if (!image) return ''
  const safe = safeUrl(image, { relative: true })
  if (safe === '#') return ''
  return safe.startsWith('/') ? `${String(site.base_url || '').replace(/\/$/, '')}${safe}` : safe
}

function iconLinks(settings) {
  const links = []
  if (settings.favicon) {
    const type = String(settings.favicon).endsWith('.svg') ? ' type="image/svg+xml"' : ''
    links.push(`<link rel="icon" href="${escapeHtml(settings.favicon)}"${type}>`)
  }
  if (settings.apple_touch_icon)
    links.push(`<link rel="apple-touch-icon" href="${escapeHtml(settings.apple_touch_icon)}">`)
  if (settings.mask_icon)
    links.push(
      `<link rel="mask-icon" href="${escapeHtml(settings.mask_icon)}"${settings.accent ? ` color="${escapeHtml(settings.accent)}"` : ''}>`,
    )
  return links.join('')
}

// Privacy-first Plausible loads a single external script (no inline, so the CSP
// stays strict) and is cookieless, so it needs no consent banner. GA4 instead
// ships /assets/consent.js, which withholds the gtag loader until the visitor
// opts in (§ 25 TDDDG / Art. 6 Abs. 1 lit. a DSGVO); the measurement id rides
// along as data-ga-id so consent.js stays generic and content-hashable.
function analyticsTags(settings, asset) {
  const analytics = settings.analytics
  if (!analytics || !analytics.provider) return ''
  if (analytics.provider === 'plausible' && analytics.domain) {
    const src = analytics.src || 'https://plausible.io/js/script.js'
    return `<script defer data-domain="${escapeHtml(analytics.domain)}" src="${escapeHtml(safeUrl(src))}"></script>`
  }
  if (analytics.provider === 'ga4' && analytics.id) {
    const id = String(analytics.id).replace(/[^A-Za-z0-9-]/g, '')
    const src = asset ? asset('consent.js') : '/assets/consent.js'
    return `<script src="${escapeHtml(src)}" data-ga-id="${id}" defer></script>`
  }
  return ''
}

export function layout(ctx, body, options = {}) {
  const {
    site,
    locale,
    title,
    description,
    canonical,
    image,
    imageAlt,
    type = 'website',
    translations = [],
    currentPath = '',
    noindex = false,
    publishedTime,
    modifiedTime,
    articleTags = [],
    feedUrl,
    feedTitle,
  } = ctx
  // `noindex: true` means "hide this page entirely" (the search page). A thin tag
  // page instead wants `noindex,follow`: keep it out of the index, but never
  // strangle the link equity flowing to the posts it lists. Hence an explicit
  // override rather than a second boolean.
  const robots = ctx.robots || (noindex ? 'noindex,nofollow' : '')
  const settings = site.settings || {}
  // Resolve a first-party asset to its content-hashed URL for this build; falls
  // back to the stable path if the map is absent (e.g. a direct layout() caller).
  const asset = (name) => (ctx.assets && ctx.assets[name]) || `/assets/${name}`
  const fullTitle = title === site.name ? title : `${title} · ${site.name}`
  // Every page gets an OG image: the page's own cover, else the site default.
  const ogImage = absoluteImage(site, image || settings.og_image)
  const ogImageAlt = imageAlt || settings.og_image_alt || ''
  const ogLocale = String(locale).replace('-', '_')
  const twitterHandle = settings.twitter_handle
    ? String(settings.twitter_handle).startsWith('@')
      ? String(settings.twitter_handle)
      : `@${settings.twitter_handle}`
    : ''
  // The header search field is on every page, so its script is too. It fetches
  // the index lazily on first interaction, so a plain page view stays request-free.
  const scripts = [`<script src="${asset('search.js')}" defer></script>`]
  if (options.forms) {
    scripts.push(`<script src="${asset('forms.js')}" defer></script>`)
    if (site.settings?.turnstile_site_key)
      scripts.push('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>')
  }
  if (options.mermaid) {
    scripts.push(`<script src="${asset('mermaid.min.js')}" defer></script>`)
    scripts.push(`<script src="${asset('mermaid-init.js')}" defer></script>`)
  }
  // Archive-only: the filter enhances one page, so it must not tax every page view.
  if (options.archive) scripts.push(`<script src="${asset('archive.js')}" defer></script>`)
  // Read-aloud pages only: the tempo switch and position memory enhance the
  // player, so neither script nor stylesheet taxes a page without one.
  if (options.audio) scripts.push(`<script src="${asset('audio.js')}" defer></script>`)
  const analytics = analyticsTags(settings, asset)
  if (analytics) scripts.push(analytics)
  const structured = options.structured ? `<script type="application/ld+json">${json(options.structured)}</script>` : ''
  // Advertising the podcast feed is the operator's explicit call
  // (settings.audio.podcast_link) and only meaningful on a site whose audio is
  // enabled at all — without the opt-in the feed file does not even exist.
  const podcastLink =
    settings.audio?.enabled === true && settings.audio?.podcast_link === true
      ? `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(settings.audio.title || `${site.name} · Podcast`)}" href="/${escapeHtml(locale)}/podcast.xml">`
      : ''
  const articleMeta =
    type === 'article'
      ? [
          publishedTime ? `<meta property="article:published_time" content="${escapeHtml(publishedTime)}">` : '',
          modifiedTime ? `<meta property="article:modified_time" content="${escapeHtml(modifiedTime)}">` : '',
          ...articleTags.map((tag) => `<meta property="article:tag" content="${escapeHtml(tag)}">`),
        ]
          .filter(Boolean)
          .join('')
      : ''
  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description || '')}">
<meta name="theme-color" content="${escapeHtml(settings.theme_color || '#ffffff')}">
${robots ? `<meta name="robots" content="${escapeHtml(robots)}">` : ''}
<link rel="canonical" href="${escapeHtml(canonical)}">
${alternateLinks(translations, site.default_locale)}
<meta property="og:type" content="${escapeHtml(type)}">
<meta property="og:site_name" content="${escapeHtml(site.name)}">
<meta property="og:locale" content="${escapeHtml(ogLocale)}">
${translations
  .filter((t) => t.locale !== locale)
  .map((t) => `<meta property="og:locale:alternate" content="${escapeHtml(String(t.locale).replace('-', '_'))}">`)
  .join('')}
<meta property="og:title" content="${escapeHtml(fullTitle)}">
<meta property="og:description" content="${escapeHtml(description || '')}">
<meta property="og:url" content="${escapeHtml(canonical)}">
${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">${ogImageAlt ? `<meta property="og:image:alt" content="${escapeHtml(ogImageAlt)}">` : ''}` : ''}
${articleMeta}
<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
${twitterHandle ? `<meta name="twitter:site" content="${escapeHtml(twitterHandle)}"><meta name="twitter:creator" content="${escapeHtml(twitterHandle)}">` : ''}
${iconLinks(settings)}
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="${asset('site.css')}">
${options.audio ? `<link rel="stylesheet" href="${asset('audio.css')}">` : ''}
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(feedTitle || site.name)}" href="${escapeHtml(feedUrl || `/${locale}/feed.xml`)}">
${podcastLink}
${settings.accent ? `<style>:root{--primary:${escapeHtml(accentToHslTriple(settings.accent))}}</style>` : ''}
${structured}
${scripts.join('\n')}
</head>
<body>
<a class="skip-link" href="#content">Skip to content</a>
<header class="site-header"><div class="container nav">
<a class="brand" href="/${escapeHtml(locale)}/">${escapeHtml(site.name)}</a>
<nav class="nav-links" aria-label="Main navigation">${navLinks({ ...ctx, currentPath })}</nav>
${siteSearch(ctx)}
</div></header>
<main id="content">${body}</main>
${siteFooter(ctx)}
</body></html>`
}

// Tag pills render for posts only: tag pages are built from `posts`, so a
// project's tags would link into 404s. Projects carry `technologies` for the
// same job, and that is not rendered here either.
export function card(item) {
  return `<article class="card"><a href="${escapeHtml(item.url)}">
<div class="meta">${item.published_at ? `<time datetime="${escapeHtml(item.published_at)}">${escapeHtml(formatDate(item.published_at, item.locale))}</time>` : ''}</div>
<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p>
</a>${item.kind === 'post' && item.tags?.length ? `<div class="tags">${item.tags.map((tag) => `<a class="tag" href="/${escapeHtml(item.locale)}/tags/${slugify(tag)}/">${escapeHtml(tag)}</a>`).join('')}</div>` : ''}</article>`
}

export function homeBody(ctx) {
  const settings = ctx.site.settings || {}
  return `<section class="container hero"><div>
<div class="eyebrow">${escapeHtml(settings.eyebrow || '')}</div>
<h1>${escapeHtml(settings.hero_title || ctx.site.name)}</h1>
<p class="hero-copy">${escapeHtml(settings.hero_text || ctx.site.description || '')}</p>
</div>${settings.profile_image ? `<img class="avatar" src="${escapeHtml(safeUrl(settings.profile_image, { relative: true }))}" alt="${escapeHtml(settings.profile_image_alt || ctx.site.name)}">` : ''}</section>
<section class="section"><div class="container"><div class="section-head"><h2>${escapeHtml(ctx.t.selected)}</h2><a href="/${ctx.locale}/projects/">${escapeHtml(ctx.t.allProjects)}</a></div><div class="grid">${ctx.projects.slice(0, 3).map(card).join('')}</div></div></section>
<section class="section"><div class="container"><div class="section-head"><h2>${escapeHtml(ctx.t.latest)}</h2><a href="/${ctx.locale}/blog/">${escapeHtml(ctx.t.allPosts)}</a></div><div class="grid">${ctx.posts.slice(0, 6).map(card).join('')}</div></div></section>`
}

export function listingBody(title, items) {
  return `<section class="container article-header"><h1>${escapeHtml(title)}</h1></section><section class="container section"><div class="grid">${items.map(card).join('')}</div></section>`
}

// How many posts the blog feed shows before handing off to the archive. The grid
// is repeat(auto-fit, minmax(18rem, 1fr)), so 12 fills 2/3/4/6-column layouts
// evenly — and the home page already teases 6, which the blog must visibly beat.
const BLOG_FEED_SIZE = 12

function tagChip(locale, tag, { count = null, current = false } = {}) {
  return `<a class="tag" href="/${escapeHtml(locale)}/tags/${escapeHtml(tag.slug)}/" data-tag="${escapeHtml(tag.slug)}"${current ? ' aria-current="true"' : ''}>${escapeHtml(tag.label)}${count === null ? '' : `<span class="tag-count" data-facet-count>${count}</span>`}</a>`
}

// The blog is the curated feed: newest posts as cards, topic chips to pivot by,
// and a hand-off to the archive for everything else. It deliberately does not
// paginate — the archive is the crawlable full index, so pages 2..N would add
// thin near-duplicates and hreflang alternates that cannot exist in every locale.
export function blogBody(ctx) {
  const { t, locale, posts } = ctx
  const chips = tagCounts(posts)
    .map((tag) => tagChip(locale, tag, { count: tag.count }))
    .join('')
  const feed = posts.slice(0, BLOG_FEED_SIZE)
  return `<section class="container article-header"><h1>${escapeHtml(t.blog)}</h1>${chips ? `<div class="tags blog-topics" aria-label="${escapeHtml(t.tags)}">${chips}<a class="tag tag-all" href="/${escapeHtml(locale)}/tags/">${escapeHtml(t.allTags)}</a></div>` : ''}</section>
<section class="container section"><div class="grid">${feed.map(card).join('')}</div>
<p class="listing-more"><a class="button" href="/${escapeHtml(locale)}/archive/">${escapeHtml(fill(t.allPostsCount, { n: posts.length }))} →</a></p></section>`
}

// The archive is the reference index: every post, server-rendered, grouped by
// year. archive.js enhances it with in-place tag + text filtering, but with
// scripting off this must remain a complete, crawlable list — so the year groups
// and the facet links are real markup, and the only element hidden up front is
// the free-text field, which has no server-side counterpart to fall back on.
export function archiveBody(ctx) {
  const { t, locale, posts } = ctx
  const groups = new Map()
  for (const post of posts) {
    const year = yearOf(post)
    if (!groups.has(year)) groups.set(year, [])
    groups.get(year).push(post)
  }
  // `posts` is published_at DESC. Undated posts (year '') sort last.
  const years = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : cmp(b, a)))
  const dated = years.filter(Boolean)
  const range = dated.length ? (dated[0] === dated.at(-1) ? dated[0] : `${dated.at(-1)}–${dated[0]}`) : ''
  const intro = range ? `${plural(t, posts.length)}, ${range}.` : `${plural(t, posts.length)}.`

  const facets = tagCounts(posts)
    .map((tag) => tagChip(locale, tag, { count: tag.count }))
    .join('')

  const jump = years
    .map(
      (year) =>
        `<li data-year-link="${escapeHtml(year)}"><a href="#y${escapeHtml(year || 'undated')}">${escapeHtml(year || '—')}<span class="year-count" data-year-count>${groups.get(year).length}</span></a></li>`,
    )
    .join('')

  // data-search is pre-folded with the build locale's toLocaleLowerCase, matching
  // the contract search-index.json uses, so the client's fold agrees (Turkish
  // dotless i). data-tags carries slugs — the same keys the facet chips emit.
  const entry = (post) => {
    const slugs = [...new Set((post.tags || []).map(slugify).filter(Boolean))].join(' ')
    const haystack = `${post.title} ${post.summary} ${(post.tags || []).join(' ')}`.toLocaleLowerCase(locale)
    return `<li data-tags="${escapeHtml(slugs)}" data-search="${escapeHtml(haystack)}"><time datetime="${escapeHtml(post.published_at || '')}">${post.published_at ? escapeHtml(formatDate(post.published_at, locale)) : ''}</time><a href="${escapeHtml(post.url)}">${escapeHtml(post.title)}</a></li>`
  }

  const sections = years
    .map(
      (year) =>
        `<section data-year-group="${escapeHtml(year)}"><h2 class="archive-year" id="y${escapeHtml(year || 'undated')}">${escapeHtml(year || '—')}<span class="year-count" data-year-count>${groups.get(year).length}</span></h2><ol class="archive-list">${groups.get(year).map(entry).join('')}</ol></section>`,
    )
    .join('')

  return `<section class="container article-header"><h1>${escapeHtml(t.archive)}</h1><p class="article-summary">${escapeHtml(intro)}</p></section>
<div class="container archive-toolbar" data-archive>
${facets ? `<div class="tags archive-facets" aria-label="${escapeHtml(t.tags)}">${facets}</div>` : ''}
<div class="archive-search" data-archive-search hidden>
<label class="sr-only" for="archive-q">${escapeHtml(t.filterPosts)}</label>
<input id="archive-q" class="search-box" type="search" maxlength="100" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t.filterPosts)}" data-archive-q data-count-one="${escapeHtml(t.postCountOne)}" data-count-many="${escapeHtml(t.postCountMany)}" data-empty-text="${escapeHtml(t.noMatches)}">
<button type="button" class="link-button" data-archive-reset hidden>${escapeHtml(t.resetFilters)}</button>
</div>
<div class="sr-only" role="status" aria-live="polite" data-archive-status></div>
</div>
${jump ? `<nav class="container archive-jump" aria-label="${escapeHtml(t.years)}"><ol>${jump}</ol></nav>` : ''}
<section class="container section archive-groups">${sections}<p class="archive-empty" data-archive-empty hidden>${escapeHtml(t.noMatches)}</p></section>`
}

// The tag index. Previously absent: every card's tag pill pointed at
// /{locale}/tags/{slug}/ while /{locale}/tags/ itself was a 404.
export function tagsBody(ctx, tags) {
  const { t, locale } = ctx
  return `<section class="container article-header"><h1>${escapeHtml(t.allTags)}</h1><p class="article-summary">${escapeHtml(`${tags.length} ${t.tags}`)}</p></section>
<section class="container section"><div class="tags tag-index">${tags.map((tag) => tagChip(locale, tag, { count: tag.count })).join('')}</div></section>`
}

// Three years. One year is noise on a corpus that spans 2014–2026; three is the
// point where a technical post's framework version, API surface and idioms have
// all plausibly moved on. Yes, this flags most of an old blog — that is the
// point, not a bug: a 2016 post is actively misleading to a reader arriving from
// a search engine.
const POST_AGE_DAYS = 1095

// `updated_at` is the evergreen suppressor, and the only one. Touching
// `updatedAt` in the frontmatter buys another three years. A dedicated
// `evergreen` tag would surface on the tag index, the tag pages, the per-tag
// feeds, article:tag meta and the search index — a nonsense tag, publicly.
function postAgeNotice(item, ctx) {
  const stamp = item.updated_at || item.published_at
  if (!stamp) return ''
  const now = ctx.now ?? new Date()
  const days = (now.valueOf() - new Date(stamp).valueOf()) / 86_400_000
  if (!(days >= POST_AGE_DAYS)) return ''
  const years = Math.floor(days / 365)
  return `<aside class="callout callout-warning post-age" role="note">${escapeHtml(fill(ctx.t.postAge, { n: years }))}</aside>`
}

function relatedBody(item, ctx) {
  const related = item.related ?? []
  if (!related.length) return ''
  return `<nav class="related" aria-label="${escapeHtml(ctx.t.related)}"><h2>${escapeHtml(ctx.t.related)}</h2><ul>${related
    .map((post) => `<li><a href="${escapeHtml(post.url)}">${escapeHtml(post.title)}</a></li>`)
    .join('')}</ul></nav>`
}

// Labelled by chronology, never by list position: "previous" flips meaning
// depending on whether you mean earlier in the list (newer) or earlier in time
// (older). Older sits left, newer right, so the row reads left-to-right in time.
function postNav(item, ctx) {
  const { older, newer } = item
  if (!older && !newer) return ''
  const link = (post, rel, label) =>
    post
      ? `<a class="post-nav-link post-nav-${rel === 'prev' ? 'older' : 'newer'}" rel="${rel}" href="${escapeHtml(post.url)}"><span class="post-nav-label">${escapeHtml(label)}</span><span class="post-nav-title">${escapeHtml(post.title)}</span></a>`
      : '<span></span>'
  return `<nav class="post-nav" aria-label="${escapeHtml(ctx.t.archive)}">${link(older, 'prev', ctx.t.olderPost)}${link(newer, 'next', ctx.t.newerPost)}</nav>`
}

// The read-aloud player. Native <audio controls> with preload="none", so a page
// view costs no audio bytes. The tempo buttons ship in the markup but hidden —
// without audio.js they can do nothing, so showing them would be a lie; the
// script unhides and drives them (and remembers the listening position).
// Decimal separators follow the page locale: 1,25× in German, 1.25× elsewhere.
function audioPlayer(item, ctx) {
  if (!item.audio?.url) return ''
  const t = ctx.t
  const minutes = Math.max(1, Math.round(Number(item.audio.duration_secs || 0) / 60))
  const decimal = (value) => (String(ctx.locale).startsWith('de') ? String(value).replace('.', ',') : String(value))
  const rates = [1, 1.25, 1.5]
    .map(
      (rate) =>
        `<button type="button" class="audio-player-rate" data-audio-rate="${rate}" aria-pressed="${rate === 1}">${escapeHtml(decimal(rate))}×</button>`,
    )
    .join('')
  return `<div class="audio-player" data-audio="${escapeHtml(item.audio.url)}" data-duration="${Number(item.audio.duration_secs) || 0}">
<p class="audio-player-label">${escapeHtml(fill(t.listen, { n: minutes }))}</p>
<audio controls preload="none" src="${escapeHtml(item.audio.url)}"></audio>
<div class="audio-player-rates" data-audio-rates role="group" aria-label="${escapeHtml(t.playbackSpeed)}" hidden>${rates}</div>
<a class="audio-player-download" href="${escapeHtml(item.audio.url)}" download>${escapeHtml(t.downloadMp3)}</a>
</div>`
}

export function contentBody(item, ctx, comments = []) {
  const isPost = item.kind === 'post'
  const locale = item.locale || ctx.locale
  const updated = item.updated_at && item.updated_at > item.published_at ? item.updated_at : ''
  const meta = [
    item.published_at
      ? `<time datetime="${escapeHtml(item.published_at)}">${escapeHtml(ctx.t.published)}: ${escapeHtml(formatDate(item.published_at, locale))}</time>`
      : '',
    updated
      ? `<time datetime="${escapeHtml(updated)}">${escapeHtml(ctx.t.updated)}: ${escapeHtml(formatDate(updated, locale))}</time>`
      : '',
    isPost && item.reading_minutes
      ? `<span class="reading-time">${escapeHtml(fill(ctx.t.readingTime, { n: item.reading_minutes }))}</span>`
      : '',
  ]
    .filter(Boolean)
    .join('')
  const pills =
    isPost && item.tags?.length
      ? `<div class="tags">${item.tags.map((tag) => `<a class="tag" href="/${escapeHtml(item.locale)}/tags/${slugify(tag)}/">${escapeHtml(tag)}</a>`).join('')}</div>`
      : ''
  // The age notice opens the prose, not the header: under the summary it would
  // read as a subtitle, and above the <h1> it outranks the title and shifts layout.
  const notice = isPost ? postAgeNotice(item, ctx) : ''
  // The player leads the prose: "listen instead" is an offer made before
  // reading starts, and above the age notice — the notice qualifies the
  // content, the player is an alternative way to consume it.
  const player = audioPlayer(item, ctx)
  const footer = isPost ? `${relatedBody(item, ctx)}${postNav(item, ctx)}${commentsBody(item, ctx, comments)}` : ''
  return `<article><header class="container article-header"><div class="eyebrow">${escapeHtml(item.kind)}</div><h1>${escapeHtml(item.title)}</h1><p class="article-summary">${escapeHtml(item.summary)}</p><div class="meta">${meta}</div>${pills}</header><div class="container prose">${player}${notice}${item.html}${footer}</div></article>`
}

export function commentsEnabled(site) {
  return site?.settings?.comments?.enabled !== false
}

function turnstileWidget(ctx) {
  const siteKey = ctx.site.settings?.turnstile_site_key
  return siteKey
    ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" data-appearance="interaction-only"></div>`
    : ''
}

function commentsBody(item, ctx, comments) {
  return `<section class="comments"><h2>${escapeHtml(ctx.t.comments)}</h2>${comments.map((comment) => `<article class="comment"><strong>${escapeHtml(comment.author_name)}</strong><p>${escapeHtml(comment.body)}</p></article>`).join('')}
${commentsEnabled(ctx.site) ? commentForm(item, ctx) : ''}</section>`
}

function commentForm(item, ctx) {
  return `
<h3>${escapeHtml(ctx.t.comment)}</h3><form action="/public/v1/posts/${escapeHtml(item.item_id)}/comments" method="post" data-contentkit-form data-success="${escapeHtml(ctx.t.commentPending)}">
<div class="form-group"><label>${escapeHtml(ctx.t.name)}<input class="form-control" name="name" required maxlength="80"></label></div>
<div class="form-group"><label>${escapeHtml(ctx.t.email)}<input class="form-control" name="email" type="email" maxlength="254"></label></div>
<div class="form-group"><label>${escapeHtml(ctx.t.message)}<textarea class="form-control" name="message" required maxlength="5000" rows="6"></textarea></label></div>
<input class="sr-only" name="website" tabindex="-1" autocomplete="off"><input type="hidden" name="site_id" value="${escapeHtml(ctx.site.id)}">
${turnstileWidget(ctx)}<div class="form-actions"><button class="button" type="submit">${escapeHtml(ctx.t.send)}</button></div><div class="form-alert" data-form-status role="alert" hidden></div></form>`
}

// This page has no input of its own — the header combobox is the only search
// field on the site, including here. It is the header form's GET target: noindex,
// never linked from the nav, reachable via ?q= deep links. search.js sees
// [data-search-results], demotes the header input from a combobox (there is no
// popup here — results render inline) and runs the query from ?q=.
//
// No aria-live on the results grid: the header's role="status" already announces
// the count, and two live regions would announce every keystroke twice.
export function searchBody(ctx) {
  return `<section class="container article-header"><h1>${escapeHtml(ctx.t.search)}</h1><p class="article-summary">${escapeHtml(ctx.t.searchHint)}</p></section><section class="container grid" data-search-results></section>`
}

export function contactBody(ctx) {
  return `<section class="container article-header"><h1>${escapeHtml(ctx.t.contact)}</h1></section><section class="container prose">
<div class="form-success" data-form-success role="status" hidden><div class="form-success-icon" aria-hidden="true">✓</div><h2>${escapeHtml(ctx.t.contactThanksTitle)}</h2><p>${escapeHtml(ctx.t.contactThanksBody)}</p></div>
<form action="/public/v1/contact" method="post" data-contentkit-form data-success="${escapeHtml(ctx.t.contactSent)}" data-error="${escapeHtml(ctx.t.contactError)}">
<div class="form-group"><label>${escapeHtml(ctx.t.name)}<input class="form-control" name="name" required maxlength="80"></label></div>
<div class="form-group"><label>${escapeHtml(ctx.t.email)}<input class="form-control" name="email" type="email" required maxlength="254"></label></div>
<div class="form-group"><label>${escapeHtml(ctx.t.message)}<textarea class="form-control" name="message" required maxlength="10000" rows="8"></textarea></label></div>
<input class="sr-only" name="website" tabindex="-1" autocomplete="off"><input type="hidden" name="site_id" value="${escapeHtml(ctx.site.id)}">
${turnstileWidget(ctx)}<div class="form-actions"><button class="button" type="submit">${escapeHtml(ctx.t.send)}</button></div><div class="form-alert" data-form-status role="alert" hidden></div></form></section>`
}
