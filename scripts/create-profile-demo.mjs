import pg from 'pg'
import { loadConfig } from '../src/config.mjs'

const config = loadConfig()
const origin = config.publicUrl
const auth = { authorization: `Bearer ${config.bootstrapApiKey}` }
const profile = {
  name: process.env.CONTENTKIT_DEMO_NAME || 'Alex Example',
  email: process.env.CONTENTKIT_DEMO_EMAIL || 'alex@example.com',
  location: process.env.CONTENTKIT_DEMO_LOCATION || 'Berlin, Germany',
}

async function jsonRequest(path, options = {}, expected = [200, 201]) {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: { ...auth, ...(options.headers || {}) },
  })
  const text = await response.text()
  if (!expected.includes(response.status)) {
    throw new Error(`${options.method || 'GET'} ${path} returned ${response.status}: ${text}`)
  }
  return text ? JSON.parse(text) : null
}

try {
  const ready = await fetch(`${origin}/ready`)
  if (!ready.ok) throw new Error(`readiness returned ${ready.status}`)
} catch {
  throw new Error(`Contentkit is not running at ${origin}. Start it first: npm start`)
}

const siteSettings = {
  eyebrow: 'Software · Writing · Projects',
  hero_title: `Hi, I'm ${profile.name}.`,
  hero_text: 'I build pragmatic software and tools that hold up in everyday use.',
  accent: '#2563eb',
  theme_color: '#f8fafc',
  socials: {
    GitHub: 'https://github.com/example',
    LinkedIn: 'https://www.linkedin.com/in/example',
  },
}

const pool = new pg.Pool({ connectionString: config.databaseUrl })
let site
try {
  const existing = await pool.query("SELECT * FROM public.ck_sites WHERE slug = 'demo-profile' LIMIT 1")
  if (existing.rows[0]) {
    site = await jsonRequest(`/v1/sites/${existing.rows[0].id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: profile.name,
        description: 'Personal profile about software and digital products.',
        base_url: origin,
        default_locale: 'en',
        settings: siteSettings,
      }),
    })
  } else {
    site = await jsonRequest('/v1/sites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'demo-profile',
        name: profile.name,
        description: 'Personal profile about software and digital products.',
        base_url: origin,
        default_locale: 'en',
        locales: ['en'],
        domains: ['127.0.0.1'],
        settings: siteSettings,
      }),
    })
  }

  await pool.query(
    `INSERT INTO public.ck_site_locales (site_id, locale) VALUES ($1, 'en')
     ON CONFLICT (site_id, locale) DO NOTHING`,
    [site.id],
  )
  await pool.query(
    `INSERT INTO public.ck_site_domains (site_id, hostname, verified_at)
     VALUES ($1, '127.0.0.1', now())
     ON CONFLICT (hostname) DO UPDATE SET site_id = EXCLUDED.site_id, verified_at = now()`,
    [site.id],
  )
} finally {
  await pool.end()
}

const documents = [
  `---
kind: page
title: Profile
locale: en
slug: profile
translationKey: profile
summary: About ${profile.name}, focus areas and ways of working.
navOrder: 1
---

# ${profile.name}

I am a software engineer working on **web systems**, APIs and digital
products. I care about small, understandable systems that can be operated
reliably and improved step by step.

## Focus areas

- Architecture and development of web and backend systems
- Automation with clear, auditable workflows
- Self-hosted infrastructure and pragmatic operations
- Markdown-based publishing tools

## How I work

I prefer short feedback loops, automated tests and solutions whose complexity
matches the actual problem.

:::tip
This page was submitted to Contentkit as Markdown and published as static HTML.
:::

**Location:** ${profile.location}

**Contact:** [${profile.email}](mailto:${profile.email})
`,
  `---
kind: post
title: Why I like small tools
locale: en
slug: small-tools
translationKey: small-tools
summary: On focused software, Markdown and short paths to publication.
date: 2026-06-29T12:00:00+02:00
tags: [Software, Markdown, Contentkit]
---

# Why I like small tools

A good tool solves a clear part of a problem while staying understandable.
For personal websites this means:

1. Content lives as readable Markdown.
2. A preview shows exactly the eventual result.
3. A release is atomic and reproducible at any time.

| Property | Goal |
| --- | --- |
| Content | portable Markdown |
| Output | static HTML |
| Operations | a single binary |

\`\`\`js
const website = await contentkit.publish(markdown)
\`\`\`

That leaves more time for content and less work on the CMS.
`,
  `---
kind: page
title: Legal notice
locale: en
slug: legal-notice
translationKey: legal-notice
summary: Provider identification for this local demonstration site.
navOrder: 99
---

# Legal notice

## Provider

${profile.name}

${profile.location}

## Contact

Email: [${profile.email}](mailto:${profile.email})

## Note

This is a **local demonstration site**. Before publishing publicly, add and
legally review the full provider, responsibility and any other legally
required information for your jurisdiction.
`,
]

const revisionIds = []
for (const markdown of documents) {
  const result = await jsonRequest(`/v1/sites/${site.id}/content`, {
    method: 'POST',
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
    body: markdown,
  })
  revisionIds.push(result.revision.id)
}

const release = await jsonRequest(`/v1/sites/${site.id}/releases`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    revision_ids: revisionIds,
    reason: 'local profile demo',
  }),
})

console.log('')
console.log(`Profile demo published (${release.file_count} files):`)
console.log(`  Home:         ${origin}/en/`)
console.log(`  Profile:      ${origin}/en/profile/`)
console.log(`  Blog:         ${origin}/en/blog/small-tools/`)
console.log(`  Legal notice: ${origin}/en/legal-notice/`)
console.log('')
