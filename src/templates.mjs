import { escapeHtml, json } from './utils.mjs'

const words = {
  de: {
    blog: 'Blog', projects: 'Projekte', archive: 'Archiv', search: 'Suche', contact: 'Kontakt',
    latest: 'Neueste Beiträge', selected: 'Ausgewählte Projekte', allPosts: 'Alle Beiträge',
    allProjects: 'Alle Projekte', published: 'Veröffentlicht', updated: 'Aktualisiert',
    searchPlaceholder: 'Website durchsuchen …', comments: 'Kommentare', comment: 'Kommentar schreiben',
    name: 'Name', email: 'E-Mail (optional)', message: 'Nachricht', send: 'Absenden',
    commentPending: 'Kommentar wurde zur Moderation eingereicht.', contactSent: 'Nachricht wurde übermittelt.',
  },
  en: {
    blog: 'Blog', projects: 'Projects', archive: 'Archive', search: 'Search', contact: 'Contact',
    latest: 'Latest posts', selected: 'Selected projects', allPosts: 'All posts',
    allProjects: 'All projects', published: 'Published', updated: 'Updated',
    searchPlaceholder: 'Search this site …', comments: 'Comments', comment: 'Write a comment',
    name: 'Name', email: 'Email (optional)', message: 'Message', send: 'Send',
    commentPending: 'Your comment was submitted for moderation.', contactSent: 'Your message was submitted.',
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

export function dictionary(locale) {
  return words[locale.split('-')[0]] || words.en
}

function navLinks(ctx) {
  const { locale, t, pages, currentPath } = ctx
  const links = [
    ...pages.filter((p) => p.nav_order != null).sort((a, b) => a.nav_order - b.nav_order).map((p) => [p.title, p.url]),
    [t.blog, `/${locale}/blog/`],
    [t.archive, `/${locale}/archive/`],
    [t.projects, `/${locale}/projects/`],
    [t.search, `/${locale}/search/`],
    [t.contact, `/${locale}/contact/`],
  ]
  return links.map(([label, href]) =>
    `<a href="${escapeHtml(href)}"${currentPath === href ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`).join('')
}

function alternateLinks(translations = []) {
  return translations.map((item) =>
    `<link rel="alternate" hreflang="${escapeHtml(item.locale)}" href="${escapeHtml(item.canonical)}">`).join('')
}

export function layout(ctx, body, options = {}) {
  const { site, locale, title, description, canonical, image, type = 'website', translations = [], currentPath = '' } = ctx
  const settings = site.settings || {}
  const fullTitle = title === site.name ? title : `${title} · ${site.name}`
  const scripts = []
  if (options.search) scripts.push('<script src="/assets/search.js" defer></script>')
  if (options.forms) {
    scripts.push('<script src="/assets/forms.js" defer></script>')
    if (site.settings?.turnstile_site_key) scripts.push('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>')
  }
  if (options.mermaid) {
    scripts.push('<script src="/assets/mermaid.min.js" defer></script>')
    scripts.push('<script src="/assets/mermaid-init.js" defer></script>')
  }
  const structured = options.structured ? `<script type="application/ld+json">${json(options.structured)}</script>` : ''
  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description || '')}">
<meta name="theme-color" content="${escapeHtml(settings.theme_color || '#ffffff')}">
<link rel="canonical" href="${escapeHtml(canonical)}">
${alternateLinks(translations)}
<meta property="og:type" content="${escapeHtml(type)}">
<meta property="og:title" content="${escapeHtml(fullTitle)}">
<meta property="og:description" content="${escapeHtml(description || '')}">
<meta property="og:url" content="${escapeHtml(canonical)}">
${image ? `<meta property="og:image" content="${escapeHtml(safeUrl(image, { relative: true }))}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<link rel="stylesheet" href="/assets/site.css">
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.name)}" href="/${escapeHtml(locale)}/feed.xml">
${settings.accent ? `<style>:root{--primary:${escapeHtml(settings.accent)}}</style>` : ''}
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
<footer class="site-footer"><div class="container footer-inner">
<span>© ${new Date().getUTCFullYear()} ${escapeHtml(site.name)}</span>
<div class="socials">${Object.entries(settings.socials || {}).map(([name, url]) => `<a href="${escapeHtml(safeUrl(url))}" rel="me">${escapeHtml(name)}</a>`).join('')}</div>
</div></footer>
</body></html>`
}

export function card(item) {
  return `<article class="card"><a href="${escapeHtml(item.url)}">
<div class="meta">${item.published_at ? `<time datetime="${escapeHtml(item.published_at)}">${escapeHtml(new Date(item.published_at).toLocaleDateString(item.locale))}</time>` : ''}</div>
<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p>
</a>${item.tags?.length ? `<div class="tags">${item.tags.map((tag) => `<a class="tag" href="/${escapeHtml(item.locale)}/tags/${encodeURIComponent(tag.toLowerCase())}/">${escapeHtml(tag)}</a>`).join('')}</div>` : ''}</article>`
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

function commentsBody(item, ctx, comments) {
  return `<section class="comments"><h2>${escapeHtml(ctx.t.comments)}</h2>${comments.map((comment) => `<article class="comment"><strong>${escapeHtml(comment.author_name)}</strong><p>${escapeHtml(comment.body)}</p></article>`).join('')}
<h3>${escapeHtml(ctx.t.comment)}</h3><form action="/public/v1/posts/${escapeHtml(item.item_id)}/comments" method="post" data-contentkit-form data-success="${escapeHtml(ctx.t.commentPending)}">
<div class="form-group"><label>${escapeHtml(ctx.t.name)}<input class="form-control" name="name" required maxlength="80"></label></div>
<div class="form-group"><label>${escapeHtml(ctx.t.email)}<input class="form-control" name="email" type="email" maxlength="254"></label></div>
<div class="form-group"><label>${escapeHtml(ctx.t.message)}<textarea class="form-control" name="message" required maxlength="5000" rows="6"></textarea></label></div>
<input class="sr-only" name="website" tabindex="-1" autocomplete="off"><input type="hidden" name="site_id" value="${escapeHtml(ctx.site.id)}">
<div class="cf-turnstile" data-sitekey="${escapeHtml(ctx.site.settings?.turnstile_site_key || '')}"></div><button class="button" type="submit">${escapeHtml(ctx.t.send)}</button><p data-form-status role="status"></p></form></section>`
}

export function searchBody(ctx) {
  return `<section class="container article-header"><h1>${escapeHtml(ctx.t.search)}</h1><label class="sr-only" for="search">${escapeHtml(ctx.t.search)}</label><input id="search" class="search-box" type="search" placeholder="${escapeHtml(ctx.t.searchPlaceholder)}" data-search-input data-index="/${ctx.locale}/search-index.json"></section><section class="container grid" data-search-results aria-live="polite"></section>`
}

export function contactBody(ctx) {
  return `<section class="container article-header"><h1>${escapeHtml(ctx.t.contact)}</h1></section><section class="container prose"><form action="/public/v1/contact" method="post" data-contentkit-form data-success="${escapeHtml(ctx.t.contactSent)}">
<div class="form-group"><label>${escapeHtml(ctx.t.name)}<input class="form-control" name="name" required maxlength="80"></label></div>
<div class="form-group"><label>${escapeHtml(ctx.t.email)}<input class="form-control" name="email" type="email" required maxlength="254"></label></div>
<div class="form-group"><label>${escapeHtml(ctx.t.message)}<textarea class="form-control" name="message" required maxlength="10000" rows="8"></textarea></label></div>
<input class="sr-only" name="website" tabindex="-1" autocomplete="off"><input type="hidden" name="site_id" value="${escapeHtml(ctx.site.id)}">
<div class="cf-turnstile" data-sitekey="${escapeHtml(ctx.site.settings?.turnstile_site_key || '')}"></div><button class="button" type="submit">${escapeHtml(ctx.t.send)}</button><p data-form-status role="status"></p></form></section>`
}
