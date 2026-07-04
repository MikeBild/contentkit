# Deployment

Contentkit deploys as a single self-contained binary behind a reverse proxy.

`.env.defaults` is development-only and is ignored whenever
`NODE_ENV=production`; systemd (or your process manager) supplies the explicit
production environment, for example from `/etc/contentkit/.env`.

## Build

```bash
npm ci
npm run build:binary
```

The resulting `dist/contentkit` embeds Node, dependencies, templates, fonts,
assets and the ordered SQL migration journal. It extracts a content-hashed
runtime below `$HOME/.cache/contentkit/<hash>` on first start. Prebuilt
binaries for Linux x64, Linux ARM64 and macOS ARM64 are published with
SHA-256 checksums on every GitHub release.

## Production checklist

- Run the binary as a dedicated, unprivileged service account.
- Bind the service to localhost and terminate TLS in a reverse proxy such as
  Caddy or nginx; route each public site domain to the service.
- Provision a dedicated PostgreSQL database and login for Contentkit. Never
  apply application SQL by hand: every deployed binary takes the Contentkit
  PostgreSQL advisory lock, applies its embedded pending migrations
  transactionally, verifies lineage drift and only then starts the HTTP
  listener. A migration failure keeps readiness down, which lets a supervisor
  roll the deployment back.
- Use systemd (or equivalent) with a readiness check against `/ready`.

Required production environment values:

- `CONTENTKIT_BOOTSTRAP_API_KEY`
- `CONTENTKIT_KEY_PEPPER`
- `CONTENTKIT_PREVIEW_SECRET`
- `DATABASE_URL`
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- `CONTENTKIT_WEBHOOK_SECRET` (with `CONTENTKIT_WEBHOOK_URL`)
- `CONTENTKIT_TURNSTILE_SECRET`

Generate independent random values; never reuse the Supabase service-role key
as a Contentkit, database or webhook secret. If you embed the database
password in a connection URL, use at least 32 base64url characters so it needs
no escaping. See `.env.example` for the full template.

## Release pipeline

`main` and pull requests run lint, unit tests, renderer integration tests and
real PostgreSQL migration tests. Pushing a SemVer tag that matches
`package.json` (for example `v1.0.0`) builds native macOS ARM64, Linux x64 and
Linux ARM64 binaries and publishes them with SHA-256 checksums as a GitHub
release.

A typical continuous deployment then downloads the binary for its platform,
ships it to the production host, restarts the systemd unit and smoke-tests
`/ready`, `/health`, `/openapi.json` and an unauthorized write.
