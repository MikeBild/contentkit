# SlideKit migration and retirement

This runbook moves the standalone SlideKit capability into ContentKit without
running two independent rendering contracts indefinitely.

## Compatibility matrix

| SlideKit capability | ContentKit replacement |
|---|---|
| `POST /render` | `POST /v1/sites/{site}/decks/compile` |
| `async=1` and job polling | `async: true` plus site-scoped deck job status/result routes |
| `/themes` | `/v1/deck-themes` |
| self-contained Slidev HTML | headless compile result or immutable released deck URL |
| neutral/editorial overlays | controlled `neutral` and `editorial` deck themes |
| presenter/offline hash routing | compiled into every deck artifact |
| render cache and ETag | compiler-versioned memory cache and strong result ETag |
| bounded queue/timeout/cleanup | ContentKit deck renderer limits and startup sweep |
| Prometheus build/cache/jobs | `contentkit_deck_*` metrics |
| hourly build statistics | site-scoped `/v1/sites/{site}/stats/decks` |
| service API-key protection | ContentKit site grants plus `content:write` and `deck:render` |
| standalone callback allowlist | managed, signed site webhooks on durable publication |
| query-string social metadata | canonical ContentKit content frontmatter and release metadata |
| raw standalone source | immutable `kind: deck` revision with Markdown twin and read API |

The old callback behavior intentionally becomes a durable publication event:
callbacks for ephemeral headless builds are not authoritative and are not
carried forward. Consumers subscribe to signed `contentkit.deck.published` or
query job status.

## Cutover order

Convert existing SlideKit Markdown without losing per-slide frontmatter:

```bash
npm run migrate:slidekit -- ../slidekit/examples/demo.md \
  --out examples/decks/demo.en.md --locale en --theme neutral
```

The converter adds the ContentKit identity/narrative envelope, moves a legacy
opening `layout` into `deck.firstSlide`, preserves later Slidev frontmatter and
removes only base-theme/color-scheme fields now controlled by ContentKit. It
writes to stdout unless `--out` is explicit and never overwrites the input
implicitly.

1. Deploy the ContentKit release containing migration
   `0010_contentkit_decks`; startup applies it transactionally.
2. Create a site-scoped automation key with `content:read`, `content:write`,
   `release:write` and `deck:render`. Keep `site:admin` separate.
3. Run local unit, contract, renderer, PostgreSQL, smoke and binary E2E suites.
4. Run production health/spec/docs checks, then the real example plan,
   validation, sync compile and async compile.
5. Publish the example as a named preview and execute browser/offline/presenter
   checks. Inspect Prometheus, statistics and logs.
6. Publish a canary deck revision, verify the public URL and signed webhook,
   then exercise rollback and reactivation.
7. Redirect every caller from SlideKit `/render` to the ContentKit deck API.
   Compare hashes or browser screenshots for representative neutral/editorial
   sources where exact legacy parity matters.
8. Remove the SlideKit service block, binary, environment variables, health
   checks, log files and reverse-proxy route from the deployment repository.
9. Tag and release the final SlideKit archival notice, update its README to the
   ContentKit successor, disable deployment workflows, then archive the GitHub
   repository. Archiving is last because it is difficult to reverse cleanly.

## Deployment cleanup proof

The deployment repository must contain no active references to the legacy
service name, port, domain, binary, systemd unit, API key, analytics state file
or health check. Historical changelogs may retain names. Verify with:

```bash
rg -n -i 'slidekit|slidekit-deck|4030|SLIDEKIT_' /path/to/subkit-deploy
```

Record the empty result, production ContentKit version, released deck URL,
release ID, rollback release ID, telemetry delta and GitHub archive timestamp
in the deployment change log. Never commit credentials or raw API responses
containing keys.
