import pg from 'pg'
import { loadConfig } from '../src/config.mjs'

const config = loadConfig()
const origin = config.publicUrl
const auth = { authorization: `Bearer ${config.bootstrapApiKey}` }
const profile = {
  name: process.env.CONTENTKIT_DEMO_NAME || 'Mike Bild',
  email: process.env.CONTENTKIT_DEMO_EMAIL || 'mike@mikebild.com',
  location: process.env.CONTENTKIT_DEMO_LOCATION || 'Berlin, Deutschland',
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
  throw new Error(`Contentkit läuft nicht unter ${origin}. Starte zuerst: npm start`)
}

const pool = new pg.Pool({ connectionString: config.databaseUrl })
let site
try {
  const existing = await pool.query("SELECT * FROM public.ck_sites WHERE slug = 'mike-profile' LIMIT 1")
  if (existing.rows[0]) {
    site = await jsonRequest(`/v1/sites/${existing.rows[0].id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: profile.name,
        description: 'Persönliches Profil über Software, AI und digitale Produkte.',
        base_url: origin,
        default_locale: 'de',
        settings: {
          eyebrow: 'Software · AI · Produkte',
          hero_title: `Hallo, ich bin ${profile.name}.`,
          hero_text: 'Ich entwickle pragmatische Software, AI-Systeme und Werkzeuge, die im Alltag zuverlässig funktionieren.',
          accent: '#2563eb',
          theme_color: '#f8fafc',
          socials: {
            GitHub: 'https://github.com/MikeBild',
          },
        },
      }),
    })
  } else {
    site = await jsonRequest('/v1/sites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'mike-profile',
        name: profile.name,
        description: 'Persönliches Profil über Software, AI und digitale Produkte.',
        base_url: origin,
        default_locale: 'de',
        locales: ['de'],
        domains: ['127.0.0.1'],
        settings: {
          eyebrow: 'Software · AI · Produkte',
          hero_title: `Hallo, ich bin ${profile.name}.`,
          hero_text: 'Ich entwickle pragmatische Software, AI-Systeme und Werkzeuge, die im Alltag zuverlässig funktionieren.',
          accent: '#2563eb',
          theme_color: '#f8fafc',
          socials: {
            GitHub: 'https://github.com/MikeBild',
          },
        },
      }),
    })
  }

  await pool.query(
    `INSERT INTO public.ck_site_locales (site_id, locale) VALUES ($1, 'de')
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
title: Profil
locale: de
slug: profil
translationKey: profile
summary: Über ${profile.name}, Arbeitsweise und Schwerpunkte.
navOrder: 1
---

# ${profile.name}

Ich bin Software Engineer und arbeite an **AI-Systemen**, APIs und digitalen
Produkten. Mich interessieren kleine, verständliche Systeme, die zuverlässig
betrieben und schrittweise verbessert werden können.

## Schwerpunkte

- Architektur und Entwicklung von Web- und Backend-Systemen
- Automatisierung mit AI und nachvollziehbaren Workflows
- Self-hosted Infrastruktur und pragmatischer Betrieb
- Markdown-basierte Publishing-Werkzeuge

## Arbeitsweise

Ich bevorzuge kurze Feedbackschleifen, automatisierte Tests und Lösungen, deren
Komplexität zum tatsächlichen Problem passt.

:::tip
Diese Seite wurde als Markdown an Contentkit übergeben und als statisches HTML
veröffentlicht.
:::

**Standort:** ${profile.location}

**Kontakt:** [${profile.email}](mailto:${profile.email})
`,
  `---
kind: post
title: Warum ich kleine Werkzeuge mag
locale: de
slug: kleine-werkzeuge
translationKey: small-tools
summary: Über fokussierte Software, Markdown und kurze Wege bis zur Veröffentlichung.
date: 2026-06-29T12:00:00+02:00
tags: [Software, Markdown, Contentkit]
---

# Warum ich kleine Werkzeuge mag

Ein gutes Werkzeug löst einen klaren Teil eines Problems und bleibt dabei
verständlich. Für persönliche Websites bedeutet das:

1. Inhalte liegen als lesbares Markdown vor.
2. Eine Vorschau zeigt exakt das spätere Ergebnis.
3. Ein Release ist atomar und jederzeit reproduzierbar.

| Eigenschaft | Ziel |
| --- | --- |
| Inhalt | portables Markdown |
| Ausgabe | statisches HTML |
| Betrieb | eine Binary |

\`\`\`js
const website = await contentkit.publish(markdown)
\`\`\`

So bleibt mehr Zeit für Inhalte und weniger Arbeit am CMS.
`,
  `---
kind: page
title: Impressum
locale: de
slug: impressum
translationKey: legal-notice
summary: Anbieterkennzeichnung für diese lokale Demonstrationsseite.
navOrder: 99
---

# Impressum

## Angaben gemäß § 5 DDG

${profile.name}

${profile.location}

## Kontakt

E-Mail: [${profile.email}](mailto:${profile.email})

## Hinweis

Dies ist eine **lokale Demonstrationsseite**. Vor einer öffentlichen
Veröffentlichung müssen Anschrift, Verantwortlichkeit und weitere gesetzlich
erforderliche Angaben vollständig und rechtlich geprüft ergänzt werden.
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
    reason: 'local personal profile demo',
  }),
})

console.log('')
console.log(`Profil-Demo veröffentlicht (${release.file_count} Dateien):`)
console.log(`  Startseite: ${origin}/de/`)
console.log(`  Profil:     ${origin}/de/profil/`)
console.log(`  Blog:       ${origin}/de/blog/kleine-werkzeuge/`)
console.log(`  Impressum:  ${origin}/de/impressum/`)
console.log('')
