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
  },
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
  // pages anywhere: below 20 leads the nav, above 60 trails it (e.g. Impressum).
  const links = [
    ...pages.filter((p) => p.nav_order != null).map((p) => [p.title, p.url, p.nav_order]),
    [t.blog, `/${locale}/blog/`, 20],
    [t.archive, `/${locale}/archive/`, 30],
    [t.projects, `/${locale}/projects/`, 40],
    [t.search, `/${locale}/search/`, 50],
    [t.contact, `/${locale}/contact/`, 60],
  ].sort((a, b) => a[2] - b[2])
  return links
    .map(
      ([label, href]) =>
        `<a href="${escapeHtml(href)}"${currentPath === href ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`,
    )
    .join('')
}

function siteFooter(ctx) {
  const { site, locale, t, pages = [] } = ctx
  const settings = site.settings || {}
  const item = ([label, href], attrs = '') => `<li><a href="${escapeHtml(href)}"${attrs}>${escapeHtml(label)}</a></li>`
  // Pages weighted past the built-in nav links (navOrder > 60, e.g. Impressum)
  // double as the footer's legal links next to the contact page.
  const legalPages = pages
    .filter((p) => p.nav_order != null && p.nav_order > 60)
    .sort((a, b) => a.nav_order - b.nav_order)
  const navigation = [
    [t.blog, `/${locale}/blog/`],
    [t.projects, `/${locale}/projects/`],
    [t.archive, `/${locale}/archive/`],
  ]
    .map((link) => item(link))
    .join('')
  const contact = [[t.contact, `/${locale}/contact/`], ...legalPages.map((p) => [p.title, p.url])]
    .map((link) => item(link))
    .join('')
  const social = [
    ...Object.entries(settings.socials || {}).map(([name, url]) => item([name, safeUrl(url)], ' rel="me"')),
    item([t.rss, `/${locale}/feed.xml`]),
  ].join('')
  return `<footer class="site-footer"><div class="container">
<div class="footer-grid">
<div class="footer-brand"><span class="brand">${escapeHtml(site.name)}</span>${site.description ? `<p>${escapeHtml(site.description)}</p>` : ''}</div>
<nav class="footer-col" aria-label="${escapeHtml(t.navigation)}"><h2>${escapeHtml(t.navigation)}</h2><ul>${navigation}</ul></nav>
<nav class="footer-col" aria-label="${escapeHtml(t.contact)}"><h2>${escapeHtml(t.contact)}</h2><ul>${contact}</ul></nav>
<div class="footer-col"><h2>${escapeHtml(t.social)}</h2><ul>${social}</ul></div>
</div>
<div class="footer-bottom">© ${new Date().getUTCFullYear()} ${escapeHtml(site.name)}</div>
</div></footer>`
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
// stays strict). GA4's loader runs alongside a self-hosted init at /assets/analytics.js.
function analyticsTags(settings) {
  const analytics = settings.analytics
  if (!analytics || !analytics.provider) return ''
  if (analytics.provider === 'plausible' && analytics.domain) {
    const src = analytics.src || 'https://plausible.io/js/script.js'
    return `<script defer data-domain="${escapeHtml(analytics.domain)}" src="${escapeHtml(safeUrl(src))}"></script>`
  }
  if (analytics.provider === 'ga4' && analytics.id) {
    const id = String(analytics.id).replace(/[^A-Za-z0-9-]/g, '')
    return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script><script src="/assets/analytics.js" defer></script>`
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
  } = ctx
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
  const scripts = []
  if (options.search) scripts.push(`<script src="${asset('search.js')}" defer></script>`)
  if (options.forms) {
    scripts.push(`<script src="${asset('forms.js')}" defer></script>`)
    if (site.settings?.turnstile_site_key)
      scripts.push('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>')
  }
  if (options.mermaid) {
    scripts.push(`<script src="${asset('mermaid.min.js')}" defer></script>`)
    scripts.push(`<script src="${asset('mermaid-init.js')}" defer></script>`)
  }
  const analytics = analyticsTags(settings)
  if (analytics) scripts.push(analytics)
  const structured = options.structured ? `<script type="application/ld+json">${json(options.structured)}</script>` : ''
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
${noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
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
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.name)}" href="/${escapeHtml(locale)}/feed.xml">
${settings.accent ? `<style>:root{--primary:${escapeHtml(accentToHslTriple(settings.accent))}}</style>` : ''}
${structured}
${scripts.join('\n')}
</head>
<body>
<a class="skip-link" href="#content">Skip to content</a>
<header class="site-header"><nav class="container nav" aria-label="Main navigation">
<a class="brand" href="/${escapeHtml(locale)}/">${escapeHtml(site.name)}</a>
<div class="nav-links">${navLinks({ ...ctx, currentPath })}</div>
</nav></header>
<main id="content">${body}</main>
${siteFooter(ctx)}
</body></html>`
}

export function card(item) {
  return `<article class="card"><a href="${escapeHtml(item.url)}">
<div class="meta">${item.published_at ? `<time datetime="${escapeHtml(item.published_at)}">${escapeHtml(new Date(item.published_at).toLocaleDateString(item.locale))}</time>` : ''}</div>
<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p>
</a>${item.tags?.length ? `<div class="tags">${item.tags.map((tag) => `<a class="tag" href="/${escapeHtml(item.locale)}/tags/${slugify(tag)}/">${escapeHtml(tag)}</a>`).join('')}</div>` : ''}</article>`
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

export function archiveBody(ctx) {
  return `<section class="container article-header"><h1>${escapeHtml(ctx.t.archive)}</h1></section><section class="container section"><ol class="archive-list">${ctx.posts.map((post) => `<li><time datetime="${escapeHtml(post.published_at || '')}">${post.published_at ? escapeHtml(new Date(post.published_at).toLocaleDateString(post.locale)) : ''}</time><a href="${escapeHtml(post.url)}">${escapeHtml(post.title)}</a></li>`).join('')}</ol></section>`
}

export function contentBody(item, ctx, comments = []) {
  return `<article><header class="container article-header"><div class="eyebrow">${escapeHtml(item.kind)}</div><h1>${escapeHtml(item.title)}</h1><p class="article-summary">${escapeHtml(item.summary)}</p><div class="meta">${item.published_at ? `<time datetime="${escapeHtml(item.published_at)}">${escapeHtml(ctx.t.published)}: ${escapeHtml(new Date(item.published_at).toLocaleDateString(item.locale))}</time>` : ''}</div></header><div class="container prose">${item.html}${item.kind === 'post' ? commentsBody(item, ctx, comments) : ''}</div></article>`
}

function turnstileWidget(ctx) {
  const siteKey = ctx.site.settings?.turnstile_site_key
  return siteKey
    ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" data-appearance="interaction-only"></div>`
    : ''
}

function commentsBody(item, ctx, comments) {
  return `<section class="comments"><h2>${escapeHtml(ctx.t.comments)}</h2>${comments.map((comment) => `<article class="comment"><strong>${escapeHtml(comment.author_name)}</strong><p>${escapeHtml(comment.body)}</p></article>`).join('')}
<h3>${escapeHtml(ctx.t.comment)}</h3><form action="/public/v1/posts/${escapeHtml(item.item_id)}/comments" method="post" data-contentkit-form data-success="${escapeHtml(ctx.t.commentPending)}">
<div class="form-group"><label>${escapeHtml(ctx.t.name)}<input class="form-control" name="name" required maxlength="80"></label></div>
<div class="form-group"><label>${escapeHtml(ctx.t.email)}<input class="form-control" name="email" type="email" maxlength="254"></label></div>
<div class="form-group"><label>${escapeHtml(ctx.t.message)}<textarea class="form-control" name="message" required maxlength="5000" rows="6"></textarea></label></div>
<input class="sr-only" name="website" tabindex="-1" autocomplete="off"><input type="hidden" name="site_id" value="${escapeHtml(ctx.site.id)}">
${turnstileWidget(ctx)}<div class="form-actions"><button class="button" type="submit">${escapeHtml(ctx.t.send)}</button></div><div class="form-alert" data-form-status role="alert" hidden></div></form></section>`
}

export function searchBody(ctx) {
  return `<section class="container article-header"><h1>${escapeHtml(ctx.t.search)}</h1><label class="sr-only" for="search">${escapeHtml(ctx.t.search)}</label><input id="search" class="search-box" type="search" placeholder="${escapeHtml(ctx.t.searchPlaceholder)}" data-search-input data-index="/${ctx.locale}/search-index.json"></section><section class="container grid" data-search-results aria-live="polite"></section>`
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
