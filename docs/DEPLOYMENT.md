# Deployment

Contentkit mirrors Slidekit's single-binary deployment.

`.env.defaults` is development-only and is ignored whenever
`NODE_ENV=production`; systemd supplies the explicit production environment
from `/etc/contentkit/.env`.

```bash
npm ci
npm run build:binary
```

The resulting `dist/contentkit` embeds Node, dependencies, templates, fonts,
assets and the ordered SQL migration journal. It extracts a content-hashed runtime below
`$HOME/.cache/contentkit/<hash>` on first start.

The companion `subkit-deploy` repository contains:

- `scripts/deploy-contentkit/bootstrap.sh`
- `scripts/deploy-contentkit/deploy.sh`
- `deploy/contentkit/systemd/contentkit.service`
- `.github/workflows/deploy-contentkit.yml`

Bootstrap provisions the service account, a dedicated PostgreSQL database and login and
secrets, installs the unit, and writes explicit public domains to
`/etc/caddy/contentkit-sites/public.caddy`. It never applies application SQL.
Every deployed binary takes the Contentkit PostgreSQL advisory lock, applies
its embedded pending migrations transactionally, verifies lineage drift and
only then starts the HTTP listener. A migration failure keeps systemd readiness
down and triggers the deployment rollback.

Required deployment secrets:

- `CONTENTKIT_BOOTSTRAP_API_KEY`
- `CONTENTKIT_KEY_PEPPER`
- `CONTENTKIT_PREVIEW_SECRET`
- `CONTENTKIT_DB_PASSWORD`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CONTENTKIT_SUBKIT_WEBHOOK_SECRET`
- `CONTENTKIT_TURNSTILE_SECRET`

Generate independent random values; never reuse the Supabase service-role key as
a Contentkit, database or webhook key. `CONTENTKIT_DB_PASSWORD` must contain at
least 32 base64url characters so it can be safely embedded in the local
PostgreSQL connection URL.

## Release pipeline

`main` and pull requests run syntax checks, unit tests, renderer integration
tests and real PostgreSQL migration tests. A SemVer tag matching
`package.json`, for example `v0.1.0`, builds native macOS ARM64, Linux x64 and
Linux ARM64 binaries, publishes SHA-256 checksums and dispatches the Linux x64
systemd deployment.

Repository prerequisites:

- Create `MikeBild/contentkit` and push this source as its `main` branch.
- Set `DEPLOY_DISPATCH_TOKEN` in Contentkit with permission to dispatch
  workflows in `MikeBild/subkit-deploy`.
- Set `CONTENTKIT_RELEASE_TOKEN`, `DROPLET_SSH_KEY`, `DROPLET_HOST`,
  `DROPLET_USER` and `CONTENTKIT_DEPLOY_URL` in `subkit-deploy`.
- Run `scripts/deploy-contentkit/bootstrap.sh` once before the first release.
