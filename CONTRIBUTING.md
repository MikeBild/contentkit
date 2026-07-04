# Contributing to Contentkit

Thanks for taking the time to contribute! Contentkit is a small, focused
project — contributions of every size are welcome, from typo fixes to new
features.

## Development setup

Requirements: Node 20.12+ and Docker Desktop (for local PostgreSQL).

```bash
npm install
npm start
```

`npm start` boots a zero-config local stack: PostgreSQL 16 in Docker, a local
storage/webhook boundary and the API on `http://127.0.0.1:4050`. No `.env`
file is needed — development defaults come from the committed `.env.defaults`.
Reset all local data with `npm run local:reset`.

## Running checks

```bash
npm run lint            # ESLint + Prettier
npm test                # unit tests (no external services)
npm run test:integration  # needs CONTENTKIT_TEST_DATABASE_URL (PostgreSQL 16)
npm run test:e2e:local  # needs Docker and Bun; builds and runs the binary
npm run check:embedded-drift
npm run check:docs-drift
```

Unit tests are fully self-contained; integration and e2e tests skip themselves
when their environment variables are unset. CI runs all tiers on every pull
request, so a green local `npm run lint && npm test` is enough to get started.

Format your changes with `npm run format` before committing.

## Making changes

- Open an issue first for anything larger than a small fix, so we can agree on
  the approach before you invest time.
- Follow [Conventional Commits](https://www.conventionalcommits.org/) for
  commit messages (`feat: …`, `fix: …`, `docs: …`, `chore: …`).
- Add or update tests for behavior changes. New route or rendering behavior
  should be covered by a unit test; database behavior belongs in
  `test/integration/`.
- If you change the HTTP API, run `npm run docs:gen-openapi` and commit the
  regenerated `docs/openapi.json`; the drift check enforces this.
- If you add a migration, add ordered `.sql` files plus journal entries under
  `src/db/migrations/` and run `npm run db:gen-embedded`.

## Pull requests

Keep pull requests focused on one change. Describe what changed and why; link
the related issue. CI must pass before review.

## Reporting bugs and requesting features

Use the issue templates. For security vulnerabilities, do **not** open a
public issue — see [SECURITY.md](SECURITY.md).
