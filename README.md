# contentkit

Markdown in, multilingual static website out. Contentkit is an API-first mini-CMS
for personal sites, blogs and project portfolios. Its own PostgreSQL database
stores content revisions; Supabase Storage stores assets and immutable releases.
Contentkit atomically activates releases and serves them on clean custom-domain
URLs.

## Features

- Pages, posts and projects with immutable draft revisions.
- GFM, footnotes, safe directives, KaTeX, Mermaid and Shiki highlighting.
- Locale-prefixed routes, translation alternates, archive and tag pages.
- RSS, sitemap, robots, canonical metadata, OpenGraph and JSON-LD.
- Expiring preview links and pointer-based instant rollback.
- Scoped API keys, moderated guest comments and contact submissions.
- Cloudflare Turnstile, honeypot and rate limits on public writes.
- Signed Standard Webhooks into an audited Subkit notification workflow.
- One self-contained Linux binary and hardened systemd deployment.

## Local setup

Requirements for local development: Node 20.12+ and Docker Desktop.

```bash
npm install
npm start
```

No `.env` file or external Supabase project is required locally. `npm start`
uses the committed `.env.defaults`, starts/reuses PostgreSQL 16 in Docker and
serves a persistent local Storage/Webhook boundary. It prints the API URL and
development admin key before opening `127.0.0.1:4050`. Local state lives in the
Docker volume `contentkit-local-postgres` and `.contentkit-local/`.

An optional `.env` overrides development defaults; shell environment variables
override both. `.env.defaults` is never loaded when `NODE_ENV=production`.
Reset all local data with:

```bash
npm run local:reset
```

With the local server running, publish a small personal profile, blog post and
legal-notice page:

```bash
npm run demo:profile
```

The application applies the SQL bundle embedded in this exact build under a
PostgreSQL advisory lock before opening HTTP. A migration or Storage failure
aborts startup. To run only the server against explicitly configured services,
use `npm run serve`. To migrate without starting HTTP, run
`node server.mjs --migrate` (or `NODE_ENV=production dist/contentkit --migrate`).

Add migrations as ordered `.sql` files plus journal entries under
`src/db/migrations/`, then run `npm run db:gen-embedded`. The build runs the
generator again and the drift test verifies that the committed bundle matches
the SQL sources.

## Create content

Create a site:

```bash
curl -X POST http://127.0.0.1:4050/v1/sites \
  -H "Authorization: Bearer $CONTENTKIT_BOOTSTRAP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Example",
    "base_url":"https://example.com",
    "default_locale":"de",
    "locales":["de","en"],
    "domains":["example.com"],
    "settings":{"hero_title":"Hello","hero_text":"Personal website"}
  }'
```

Upload Markdown and referenced files:

```bash
curl -X POST http://127.0.0.1:4050/v1/sites/<site-id>/content \
  -H "Authorization: Bearer $CONTENTKIT_BOOTSTRAP_API_KEY" \
  -F "document=@examples/post.de.md;type=text/markdown" \
  -F "asset:images/hero.jpg=@hero.jpg;type=image/jpeg"
```

Build a preview or release using the returned revision ID:

```bash
curl -X POST http://127.0.0.1:4050/v1/sites/<site-id>/previews \
  -H "Authorization: Bearer $CONTENTKIT_BOOTSTRAP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"revision_ids":["<revision-id>"],"expires_in":3600}'

curl -X POST http://127.0.0.1:4050/v1/sites/<site-id>/releases \
  -H "Authorization: Bearer $CONTENTKIT_BOOTSTRAP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"revision_ids":["<revision-id>"],"reason":"initial release"}'
```

The full contract is available at `/openapi.json`.

## Verification

```bash
npm run lint
npm test
npm run test:integration
npm run test:e2e:local
npm audit
```

`test:e2e:local` requires Docker and Bun. It boots disposable PostgreSQL,
executes the compiled single binary against a local Storage/Webhook boundary,
and verifies draft, preview, release, custom-domain delivery and signed
notification delivery.

Deployment and Subkit integration are documented in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and [docs/SUBKIT.md](docs/SUBKIT.md).
