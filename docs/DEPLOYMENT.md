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

`CONTENTKIT_NODE_BINARY` may select the Node executable embedded in the
artifact. On macOS the build rejects a Homebrew thin executable that links to
an external `libnode` dylib; use the self-contained official Node binary from
setup-node or nvm. This fails during packaging instead of publishing an
artifact that crashes on another host.

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
- `CONTENTKIT_SESSION_SECRET`
- `DATABASE_URL`
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- `CONTENTKIT_TURNSTILE_SECRET`

Generate independent random values; never reuse the Supabase service-role key
as a Contentkit, database or webhook secret. If you embed the database
password in a connection URL, use at least 32 base64url characters so it needs
no escaping. See `.env.example` for the full template.

Webhook delivery does not require a global environment endpoint. Prefer
site-scoped managed endpoints registered through `POST
/v1/sites/{site}/webhooks`; their signing secrets are encrypted at rest and
their event filters prevent unrelated sites or event types from reaching a
consumer. The legacy `CONTENTKIT_WEBHOOK_URL` and
`CONTENTKIT_WEBHOOK_SECRET` fallback is optional and, when used, both values
must be configured together.

`CONTENTKIT_SESSION_SECRET` HMAC-hashes reader session tokens. Rotating it logs
out every reader immediately. Published sites must use HTTPS so the
`__Host-contentkit_session` cookie can keep its Secure attribute; the reverse
proxy must preserve the original site `Host` header.

Set `CONTENTKIT_DEPLOYMENT_ENVIRONMENT` to the stable environment name used by
your log backend (for example `production`). Structured request logs carry the
service name/version, environment and W3C trace/span IDs. Reader-auth product
facts contain no identity or IP and are pruned by the existing maintenance run
after `CONTENTKIT_PRODUCT_STATS_RETENTION_DAYS` (default 400).

## Release pipeline

`main` and pull requests run lint, unit tests, renderer integration tests and
real PostgreSQL migration tests. Pushing a SemVer tag that matches
`package.json` (for example `v1.0.0`) builds native macOS ARM64, Linux x64 and
Linux ARM64 binaries and publishes them with SHA-256 checksums as a GitHub
release.

A typical continuous deployment then downloads the binary for its platform,
ships it to the production host, restarts the systemd unit and smoke-tests
`/ready`, `/health`, `/openapi.json` and an unauthorized write. Smoke-test
`/openapi.json` against `CONTENTKIT_PUBLIC_URL`, not against a published site
domain — see below.

## API host vs. site hosts

One deployment serves the admin API and every published site. Contentkit's own
surface — `/`, `/openapi.json`, `/llms.txt`, `/llms-full.txt` and `/metrics` — is
served **only** when the request's `Host` matches the hostname of
`CONTENTKIT_PUBLIC_URL`. On a site domain those paths fall through to the
gateway, which serves that site's own `llms.txt` and `robots.txt` from the
release. Set `CONTENTKIT_PUBLIC_URL` to a hostname you do not also publish a site
on, or the API surface will shadow that site's root and its `llms.txt`.

`/health` and `/ready` stay reachable on every host: supervisors and load
balancers probe them over the loopback or a pod IP, where `Host` is an address
rather than the public hostname, and `/health` must not depend on a database
lookup.

`/metrics` is unauthenticated Prometheus output. Host-gating keeps it off site
domains, but it still answers to anyone who can reach the API host. Bind the
service to a private interface and terminate TLS in front of it, or deny
`/metrics` at the reverse proxy and scrape it over the loopback:

```
# Caddy
@metrics path /metrics
respond @metrics 404
```

```
# nginx
location = /metrics { deny all; }
```
