# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.14.0

### Added

- **Generic site-scoped product analytics.** Six bounded read-only endpoints
  expose dense UTC aggregates for releases, content, reader authentication,
  webhooks, audio and engagement using the existing `content:read` scope. The
  data remains in ContentKit's PostgreSQL database and the API has no reporting
  consumer or workflow dependency. Reader-auth facts are identity-free and
  retention-bounded. OpenAPI, LLM docs, indexes, unit/contract/real-PostgreSQL
  tests and W3C trace propagation cover the surface.

## 1.13.1

### Fixed

- **The footer navigation column now follows the preset.** Non-portfolio sites
  (wiki, product-docs, knowledge-base, changelog) previously showed the
  portfolio links (Blog, Projects, Archive, Tags) in the footer even though the
  header already led with the preset's own hub. The footer now leads with the
  preset's section — Wiki, Docs, Help or Changelog — and appends the blog,
  projects, archive and tag links only when the site actually has that content.
  Portfolio sites with posts are unchanged. Header and footer now share one
  preset-to-section definition so they cannot drift apart.

## 1.13.0

### Added

- **Visual reports and dashboards from Markdown.** Pages can select the
  controlled `report` layout and compose responsive metric cards, badges,
  progress, cards and grids. `bar`, `line`, `area` and `donut` charts use an
  ordinary GFM table as their complete data contract; Apache ECharts renders
  deterministic, accessible light/dark SVG release assets server-side, so no
  chart runtime or executable specification reaches the browser. The existing
  shadcn-style token contract now includes `chart_1` through `chart_5`, and
  report pages retain their source tables, print cleanly and receive Markdown
  twins. Unit, contract, real-document smoke, integration, compiled-binary E2E
  and a 200-chart benchmark cover the feature.

## 1.12.0

### Added

- **Controlled site presets and page layouts.** Sites can select `portfolio`,
  `product-docs`, `wiki`, `knowledge-base`, `product` or `changelog` through
  `settings.presentation.preset`; existing sites remain `portfolio`. Pages can
  override the preset with `standard`, `docs`, `wiki`, `knowledge`, `landing`
  or `changelog`. Documentation, wiki and knowledge layouts add validated
  hierarchies, sidebars, breadcrumbs and heading tables of contents; product
  documentation supports one current and multiple archived versions. Landing
  pages gain controlled `hero`, `features`, `steps` and `cta` directives.
- **Reader access control.** Site administrators can create personal readers,
  salted-scrypt passwords, groups, memberships and exact/prefix path rules.
  A Markdown document can grant groups with `access`. Successful site-host
  login creates a hashed, revocable session with idle and absolute expiry;
  anonymous page requests redirect to login and wrong-group readers receive
  403. Access policy and protected navigation/search are snapshotted per
  immutable release, so rollback restores content and authorization together.
- **Private discovery projection.** Protected documents and protected-only
  media are removed from public navigation, search indexes, sitemaps, feeds,
  Markdown twins, LLM files and structured discovery. Authenticated readers get
  a same-origin private navigation and search projection with
  `Cache-Control: private,no-store`.
- **Real-document verification and benchmarks.** English product docs, wiki,
  knowledge-base, product landing and changelog examples are exercised by a
  smoke build and the compiled-binary E2E flow. A deterministic 1,000-document
  benchmark measures build throughput, memory, access-rule resolution and
  password verification; CI enforces broad regression budgets and uploads the
  JSON report.

### Security

- Production requires an independent `CONTENTKIT_SESSION_SECRET`. Reader
  cookies are HttpOnly and SameSite=Lax (Secure on HTTPS); login uses a signed
  CSRF token, validates same-origin return paths and limits attempts to five per
  15 minutes per IP and normalized username.
- Reader passwords are 12–256 characters and stored with salted scrypt
  (`N=32768`, `r=8`, `p=1`, 64-byte output). Session tokens are random and only
  their HMAC is stored. Password resets, account disabling and explicit session
  revocation invalidate active sessions.

## 1.11.0

### Added

- **Content lifecycle webhook events.** Release activation now emits
  `contentkit.content.published` (per item whose published revision actually
  changed — no-op republishes stay silent), `contentkit.content.unpublished`
  (per retired item that was published) and one `contentkit.release.published`
  per activation, enqueued in the same database transaction as the pointer
  switch. Rollbacks and empty releases move no item pointers and emit only
  `release.published`. No new settings or scopes — the per-endpoint `events`
  filter is the opt-in.
- **Content modeling light.** Frontmatter gains an author-owned `extra:` map
  of custom fields (max 32 keys `[a-z][a-z0-9_]{0,63}`, scalar/list/flat-map
  values, 16 KiB, validated with a 422 on write) stored verbatim in the
  revision metadata, and `related: [slug, …]` references to same-locale posts
  (max 8, no duplicates or self-reference, stored as `related_slugs`).
  Authored references lead the related-posts block in the author's order, tag
  similarity fills up to three, and a broken reference is dropped with a
  warning instead of failing the release. The new
  `settings.content.show_extra` setting (default off, validated on
  create/PATCH) renders the extra fields as a definition list on the page and
  as a bullet block in the Markdown twin and per-site `llms-full.txt`;
  JSON-LD and the search index never carry them. Deliberately no custom
  content kinds: a dedicated collection is `kind: post` + a dedicated tag +
  `extra` fields.
- **JSON read API ("optional headless").** `GET /v1/sites/{site}/published`
  lists currently published content as JSON — filters `kind`, `locale`, exact
  `tag` and `updated_since` (strictly greater than the item's `updated_at`),
  keyset pagination via an opaque `cursor` (default 50 entries, cap 200) —
  and `GET /v1/sites/{site}/published/{kind}/{locale}/{slug}` returns one
  document plus the immutable Markdown source verbatim and on-demand rendered
  HTML (never stored). Revision `metadata` is served verbatim, so `extra`
  fields ride along automatically. Both routes live on the management API
  behind `content:read` scoped keys — no anonymous delivery path, static site
  delivery unchanged — and honour `If-None-Match`/304: the list with a weak
  ETag over the site's publish epoch, the document with a strong ETag over
  the revision source hash and service version.
- **Server-side full-text search.** `GET /v1/sites/{site}/search?q=` runs
  PostgreSQL full-text search over currently published content (`content:read`
  scope): locale-aware stemming (de → german, en → english, otherwise simple),
  title/summary/tags weighted above body text, relevance `rank` and a
  `headline` snippet with `<mark>` highlights. Search vectors are filled by an
  insert trigger on the immutable revisions (migration
  `0006_contentkit_search`, backfill included) and queried only through the
  whitelisted `ck_search_published` function joining over
  `published_revision_id`, so drafts stay invisible. The frontmatter block is
  stripped before indexing — author-owned `extra` fields never land in the
  index. Published sites keep their static client-side search; no anonymous
  search path appears.
- **Theming as design tokens.** `settings.theme.tokens` generalizes the
  single-token accent injection: every allowlisted token (`background`,
  `foreground`, `muted`, `muted_foreground`, `border`, `primary`,
  `primary_foreground`, `radius`, `font_family`) fills the custom property of
  the same name in the shared stylesheet, as one value or a
  `{ light, dark }` pair emitted behind `prefers-color-scheme`. Hex colors
  are converted to the `H S% L%` triples the stylesheet expects, unknown
  token keys fail the write with 422, and `settings.accent` stays the
  shorthand for `primary` (the explicit token wins). The new size-capped
  `settings.theme.custom_css` (8 KiB, no `</style`) is appended as the last
  `<style>` element as the escape hatch — deliberately no template or layout
  overrides, and `site.css` stays shared and content-hashed.

## 1.10.0

### Added

- **Feed subscribe rows.** The blogcast page's bare "Subscribe via RSS" link —
  which just opened raw XML — became a subscribe row: the plain RSS link,
  podcast-app deep links (Apple Podcasts, Overcast, Pocket Casts), and a
  copy-feed-URL button with clipboard confirmation. The blog index promotes its
  RSS feed with the same shared row (RSS link, Feedly, copy button), on by
  default and removable via `settings.blog.subscribe_row: false`. Both target
  lists can be replaced per site via `settings.audio.subscribe_targets` /
  `settings.blog.subscribe_targets = [{ label, url_template }]` with `{feed}`,
  `{feed_encoded}` and `{feed_no_scheme}` placeholders.
- **Domains via PATCH.** `PATCH /v1/sites/{site}` now also accepts `domains`,
  replacing the hostname mappings in full (the same read-merge-send contract
  as `settings`); previously domains could only be set at site creation.
- **One-click post feedback.** Sites can opt in via
  `settings.feedback.enabled: true` to render a quiet "Was this post helpful?"
  thumbs-up/down widget under each post. Votes are anonymous by design (no
  name, no email, no IP — no consent surface), deduplicated per device via
  localStorage, and protected by the existing honeypot and per-IP rate limit
  instead of a captcha. New public endpoint
  `POST /public/v1/posts/{post}/feedback` stores the vote in the new
  `ck_post_feedback` table (migration `0005`); `GET /v1/feedback`
  (`moderation:write`) returns per-post up/down aggregates.

## 1.9.3

### Fixed

- Long German compounds in article titles and full URLs in source lists now
  wrap on narrow screens instead of being clipped outside the viewport.

## 1.9.2

### Fixed

- The read-aloud player is seekable again. `/media` served every asset as one
  indivisible `200`, ignoring `Range` — so a browser would not seek within it,
  and Chrome's media loader (which opens audio with `Range: bytes=0-`) stalled
  at `readyState 0` without ever reporting a duration. The result was a player
  whose scrubber, ±15 s buttons and play button all appeared dead. `/media` now
  advertises `Accept-Ranges: bytes` and answers byte ranges with a `206` and a
  `Content-Range` (`416` when unsatisfiable), forwarding the range to the object
  store and slicing locally when the store ignores it. `HEAD` reports the real
  length instead of `0`.
- The player's ±15 s buttons and seek slider no longer refuse to act before
  playback starts. Both bailed out on `readyState === 0`, which with
  `preload="none"` is every fresh page view — but assigning `currentTime` in
  that state is honoured by the browser as the default playback start position.
  Seeking before pressing play now works, and a deliberate seek takes precedence
  over the remembered listening position instead of being overridden by it.

## 1.9.1

### Fixed

- Read-aloud narration no longer speaks the title twice. The extractor
  prepends the frontmatter title as the opening sentence but kept a leading
  `# Heading` that repeats it — the same duplicate the rendered page already
  drops (`dropRedundantTitle`). The speech text now drops it too. Note: this
  changes the speech hash of affected posts, so their next enqueue counts as
  new speech text (budget-capped as always).

## 1.9.0

GEO and reader aids: every post is now first-class input for AI tools — and
authors can ship a TL;DR and FAQ without contentkit generating a word.

### Added

- A raw-Markdown twin per indexable post at `/{locale}/blog/{slug}/index.md`
  (title, canonical URL, TL;DR, body — the same block `llms-full.txt` uses),
  served as `text/markdown` and advertised via
  `<link rel="alternate" type="text/markdown">`. `noindex` posts get none.
- An AI share row on posts: a plain link to the Markdown twin (works without
  JS), a copy-Markdown button (revealed by the new hashed `ai-actions.js`)
  and "open in Claude/ChatGPT" deep links that hand the article to the
  *reader's own* assistant — the site never talks to an AI provider. Targets
  are overridable via `settings.ai.share_targets`; the row hides behind
  `settings.ai.share_buttons: false`. Default on, zero configuration.
- Authored frontmatter `tldr` (list of strings) and `faq` (list of `{q, a}`),
  validated at upload: rendered as an open "In short" block above the prose
  and a collapsed FAQ after it, exported to the Markdown twin and
  `llms-full.txt`, fed into the search index, and emitted as JSON-LD
  `abstract` and `FAQPage`.

### Changed

- Post JSON-LD grew `inLanguage`, `keywords`, `image`, `timeRequired`,
  `mainEntityOfPage`, an `AudioObject` for narrated posts and a
  `BreadcrumbList` (emitted as a JSON array in one script tag).
- Header search now ranks instead of filtering: title hits beat summary hits
  beat body hits, title prefixes beat containment; ties stay newest-first.

### Fixed

- The binary e2e test derives the expected migration count from the embedded
  migrations instead of hardcoding it (stale since the audio migration).

## 1.8.0

The read-aloud feed is now the **Blogcast** — product-wide rename from
"Podcast".

### Changed

- URLs: the feed moved from `/{locale}/podcast.xml` to `/{locale}/blogcast.xml`
  and the page from `/{locale}/podcast/` to `/{locale}/blogcast/`. The old URLs
  are gone from new releases — there is no redirect; update subscriptions and
  links.
- Visible labels: the footer item and the head `<link rel="alternate">` title
  fallback now say "Blogcast" (`{site name} · Blogcast`).
- Settings: `settings.audio.blogcast_link`, `blogcast_image` and
  `blogcast_category` replace the `podcast_*` keys. The old spellings are
  deprecated but still read as fallbacks (`blogcast_* ?? podcast_*`);
  `title`/`description` are unchanged.
- Code identifiers and CSS classes follow the rename (`blogcastRss`,
  `blogcastPage`, `ctx.blogcast`, `.blogcast-*`). The `xmlns:itunes` podcast
  RSS namespace and the `<itunes:*>` tags are protocol, not branding, and stay.

## 1.7.0

Podcast page & custom player.

### Added

- A built podcast page per locale at `/{locale}/podcast/` — channel cover,
  title/description from `settings.audio`, a subscribe-via-RSS link and one
  card per narrated post (title, date, duration, summary, player). Emitted
  under the same gate as `podcast.xml` (audio enabled + at least one narrated
  indexable post), independent of `podcast_link`; indexable and in the sitemap.
- A custom audio player (shadcn-style, theme tokens only), shared between
  article pages and the podcast page: round play/pause button, ±15 s skip,
  seek slider with time readout, the existing tempo buttons and download link.
  Progressive enhancement — the native `<audio controls preload="none">` ships
  as the no-JS fallback and audio.js swaps it for the custom bar; the
  remembered listening position stays.

### Changed

- The footer's Podcast item now targets the page (`/{locale}/podcast/`) instead
  of the raw feed; the head `<link rel="alternate">` keeps pointing at
  `podcast.xml`. Gate unchanged (`podcast_link` opt-in + narrated posts).

## 1.6.2

- Podcast links (head alternate + footer) appear only when the feed actually has narrated posts.

## 1.6.1

- Opted-in podcast feeds get a visible footer link next to RSS.

## [1.6.0] - 2026-07-09

Read-aloud: lifecycle & operations.

### Added

- Debounced auto-rebuild: after an audio job finishes, the worker schedules one
  release per site (empty `revision_ids`, reason `audio auto-rebuild`) so the
  player and podcast feed appear without a manual publish. Debounce via
  `CONTENTKIT_AUDIO_REBUILD_DEBOUNCE_MS` (default 60000, 1s–1h); opt out per
  site with `settings.audio.auto_rebuild: false`. No feedback loop: the enqueue
  hook only fires for releases that carry revisions.
- `DELETE /v1/content/{item}/audio` (`release:write`): removes all audio jobs
  for the item plus the generated MP3s (storage object and `ck_assets` row) and
  schedules an auto-rebuild. Returns
  `{item_id, deleted_jobs, deleted_assets, rebuild_scheduled}`.
- `GET /v1/sites/{site}/audio/jobs` (`content:read`): newest-first job list
  (optionally filtered by `status`, `limit` default 100/max 500) with a
  `summary` of per-status counters, `chars_this_month` (UTC calendar month,
  skipped jobs excluded), `monthly_char_budget` and `budget_remaining`.
- Monthly budget enforcement on auto-enqueue: publishing no longer creates a
  job that would push the month's characters past
  `settings.audio.monthly_char_budget` (logged as `audio budget exhausted`);
  backfill behaviour is unchanged.
- Superseded-asset cleanup: when a force re-render finishes, the previous MP3
  (storage object and asset row) is deleted best-effort at the swap point, so a
  live player never 404s but old narrations no longer accumulate.
- Podcast channel polish: optional `itunes:image` (`settings.audio.podcast_image`,
  absolute URL) and `itunes:category` (`settings.audio.podcast_category`), and
  an opt-in `<link rel="alternate" type="application/rss+xml">` to
  `/{locale}/podcast.xml` in the layout via `settings.audio.podcast_link: true`
  (only on sites with audio enabled).
- Player download link: a quiet "MP3 herunterladen" / "Download MP3" anchor
  (`download` attribute) under the player.
- New guide `docs/audio.md` covering the full read-aloud lifecycle, backfill,
  deletion, job monitoring, budgets and the podcast feed.

## 1.5.1

- Read-aloud backfill accepts an optional `slugs` array to narrow the run to specific posts.
- Read-aloud backfill accepts `force: true` to re-render audio whose speech text is unchanged (voice or provider changes).

## [1.5.0] - 2026-07-09

### Added

- Read-aloud audio ("Vorlesen"): every published post can carry a pre-rendered
  spoken MP3. Publishing a release enqueues one job per post revision in the new
  `ck_audio_jobs` table (additive migration `0004_contentkit_audio`); a
  background worker — started with `CONTENTKIT_AUDIO_ENABLED=true` — extracts
  the speech text from the Markdown (frontmatter, code/mermaid fences, the
  `## Weiterführende Quellen` section, URLs and the italic series line are
  dropped; headings and list items become sentences), synthesizes it with
  Google Chirp 3 HD (chunked ≤3800 bytes, LINEAR16 24 kHz, encoded to 64 kbps
  mono MP3 via the host's `ffmpeg`, path overridable with `CONTENTKIT_FFMPEG`)
  and files the result as a normal content-addressed asset served from `/media`.
- Idempotency by speech-text hash: `UNIQUE(item_id, speech_sha256)` covers the
  *extracted speech text*, not the Markdown source, so editing a code block or
  the sources section never triggers a paid re-synthesis. Sites opt in via
  `settings.audio = { enabled, provider, voice, monthly_char_budget }`; a post
  opts out with frontmatter `audio: false`.
- Post pages with audio render a native player above the prose
  (`preload="none"`, "Diesen Beitrag anhören (X min)"), with a tempo switch
  (1×/1,25×/1,5×) and a remembered listening position per audio URL. The
  `audio.js`/`audio.css` assets load only on pages that have a player.
- Podcast feed at `/{locale}/podcast.xml` (RSS 2.0 + `itunes:` namespace, one
  `<enclosure>` per post with audio), generated only when `settings.audio.enabled`
  and at least one post carries audio. Not linked from the layout.
- `GET /v1/content/{item}/audio` reports the newest audio job and asset URL;
  `POST /v1/sites/{site}/audio/backfill` enqueues jobs for the archive
  newest-first within a character budget (`limit_chars`, falling back to
  `settings.audio.monthly_char_budget`); `dry_run: true` returns the selection
  and a cost estimate without enqueuing.

### Fixed

- `/media` now serves audio content types inline instead of forcing a download;
  without this the read-aloud `<audio>` element could not play its own asset.

## [1.4.0] - 2026-07-09

### Added

- `GET /v1/sites/{site}` returns site metadata and settings. `PATCH` replaces
  `settings` wholesale, so a partial update needs the current object first —
  until now that read was impossible over HTTP and every partial update
  silently dropped the unlisted keys. The route accepts `content:read` or
  `site:admin`, so the key that patches can also read.

## [1.3.2] - 2026-07-08

### Fixed

- The redundant-title heading is now also dropped when the title contains inline Markdown.
  A title such as ``Control Flow vor `async/await` `` is a raw string in the frontmatter but
  renders as an inlineCode node without backticks in the body, so the two never compared
  equal and the duplicate `<h1>` survived. Inline markers are stripped from both sides.

## [1.3.1] - 2026-07-08

### Fixed

- A document whose first block repeats the frontmatter `title` as a level-one heading no
  longer renders a second `<h1>`. The layout already emits the title, so such pages carried
  two `<h1>` elements and started their document outline twice — a meaningful share of the
  posts on a production site did. A body that deliberately opens with a different top-level heading
  keeps it, and a heading that is not the first block is never touched. The authored source
  is unchanged, so `llms-full.txt` and the reading-time estimate are unaffected.

## [1.3.0] - 2026-07-08

### Added

- Tag index at `/{locale}/tags/`, listing every tag with its post count. Tag pills
  have always linked to `/{locale}/tags/{tag}/`, but the index itself was a 404.
- Per-tag RSS feeds at `/{locale}/tags/{tag}/feed.xml` for tags with two or more
  posts, advertised from the tag page. The main feed now emits `<category>` per
  tag and an `<atom:link rel="self">`.
- Post pages show reading time, tag pills, related posts (cosine similarity over
  IDF-weighted tag vectors), older/newer navigation, and `Updated:` when a post
  has been revised.
- Posts older than three years carry a notice that the content may be out of date.
  Set `updatedAt` in the frontmatter to suppress it for another three years.
- `buildSite({ now })` makes build time an explicit input, so builds are
  reproducible and the age notice is testable.
- Each site now generates its own `llms.txt` and `llms-full.txt`
  ([llmstxt.org](https://llmstxt.org/) format), at the root and per locale, listing
  its posts, projects and pages, with the archive, tag index and other locales under
  the spec's `## Optional` section. `llms-full.txt` carries every published
  document's Markdown source. `noindex` content is excluded from both.

### Changed

- `/{locale}/blog/` is now a curated feed: the newest twelve posts as cards, topic
  chips, and a link to the archive. `/{locale}/archive/` is now the full index:
  every post grouped by year, with a jump navigation and client-side tag and
  free-text filtering via a new archive-only `archive.js`. Both previously
  rendered the identical list of every post.
- Tag pages with a single post are emitted as `noindex,follow` and are excluded
  from the sitemap and from per-tag feeds.
- Rendered dates are formatted in UTC, from an explicit locale. Previously the
  build machine's timezone could shift a printed date by a day, and its locale
  decided whether a date read `1.1.2026` or `1/1/2026` — both changed the
  release's asset hashes for identical content. Formatting a date without a
  locale is now an error rather than a silent fall back to the system's.

### Fixed

- `noindex` posts and projects no longer leak into the blog, archive, tag pages,
  the tag index, the home page, the projects listing or the RSS feed. Their own
  pages still render, as before; only listings exclude them.
- Tags whose slugs collide no longer overwrite each other's page. `Node JS` and
  `Node.js` both slugify to `node-js`; previously the last one written won and the
  other tag's posts silently disappeared. They now merge into a single page.
- A tag consisting only of punctuation (slugifying to the empty string) no longer
  writes a file at `{locale}/tags//index.html`.
- Projects no longer render tag pills. Tag pages are built from posts only, so a
  project's pills pointed at URLs that 404.
- `feed.xml` is served as `application/rss+xml`, matching the type every
  `<link rel="alternate">` on the site advertises. It was served as
  `application/xml`.
- The archive, search, contact and tag pages now mark their navigation entry with
  `aria-current="page"`.
- Contentkit's own `/llms.txt`, `/llms-full.txt`, `/openapi.json` and `/metrics` are
  no longer served on published site domains. One deployment hosts the admin API and
  every site; these paths answered on all of them, so every site served the CMS's
  documentation instead of its own `llms.txt`, and handed out unauthenticated
  Prometheus telemetry for the admin API. They are now gated on the request `Host`
  matching `CONTENTKIT_PUBLIC_URL`, like the `/` service descriptor already was.
  `/health` and `/ready` stay reachable on every host for probes. Set
  `CONTENTKIT_PUBLIC_URL` to a hostname you do not also publish a site on.

## [1.2.0] - 2026-07-08

### Changed

- The header navigation no longer links Contact, Impressum or the privacy policy;
  those pages now appear in the footer only. `navOrder` above 60 now means
  "footer legal column only" (previously: footer *and* trailing header nav).
- Search moved out of the header navigation into a `role="combobox"` search field
  in the header itself, with a live results dropdown and full keyboard support. It
  is inline on wide viewports and a full-width second header row below 48rem.
  `/{locale}/search/` remains as a noindex `?q=` deep-link target and is no longer
  linked from the navigation.
- `search.js` now loads on every page and fetches the search index lazily on the
  first interaction with the search field, so a page view costs no extra request.
  Result rows are built via DOM APIs instead of `innerHTML`.

### Fixed

- The empty search result message is now localized instead of always German.
- `404.html` now references the content-hashed stylesheet and scripts; it
  previously pointed at unhashed asset paths that no release contains, so it
  rendered unstyled.
- Preview rewriting now covers `action` attributes, so the header search form no
  longer navigates out of a preview to the production search page.

## [1.1.1] - 2026-07-08

### Added

- Site-level `settings.comments.enabled=false` support to suppress public post
  comment forms while keeping approved comments visible.

### Changed

- Locale search pages are now emitted with `noindex,nofollow` and are omitted
  from the sitemap.
- Search indexes now exclude `noindex` content and only include title, summary
  and tags by default. Full body indexing is opt-in via
  `settings.search.index_body=true`.

### Fixed

- Public comment submissions now return `404` when comments are disabled for a
  site, so stale cached forms cannot continue to submit. Contact forms are
  unaffected.

## [1.1.0] - 2026-07-08

### Added

- Cookie consent for GA4 (`assets/consent.js`): when a site configures the
  `ga4` analytics provider, the Google tag loader is now withheld until the
  visitor gives explicit opt-in consent (§ 25 TDDDG / Art. 6 Abs. 1 lit. a
  DSGVO). The banner is localized (de/en), offers an equally prominent
  "reject all" alongside "accept all", wires up Google Consent Mode, and adds a
  footer "Cookie settings" control so consent can be withdrawn at any time.

### Changed

- The `ga4` provider no longer emits the `gtag/js` loader directly in the head
  or a per-site `assets/analytics.js` init file. The head instead references the
  content-hashed `consent.js`, passing the measurement id via `data-ga-id`, and
  no request reaches Google before consent. Plausible (cookieless) is unchanged
  and still needs no banner.

## [1.0.1] - 2026-07-04

### Changed

- Dependency updates: `@shikijs/rehype` 4.x, `katex` 0.17, and current major
  versions of all GitHub Actions used by CI and the release pipeline.

### Fixed

- A timing race in the build-serialization integration test that could hang
  the suite on slow CI runners.

## [1.0.0] - 2026-07-04

First public release. Contentkit is an API-first Markdown mini-CMS that turns
Markdown revisions into immutable, multilingual static-site releases with
atomic activation and pointer-based rollback.

### Added

- Community files for open source: contributing guide, code of conduct,
  security policy, issue and pull request templates.
- ESLint and Prettier configuration with CI enforcement.
- Unit tests for the site builder, release manager and OpenAPI spec
  (including router/spec consistency checks).

### Changed

- The built-in webhook endpoint is now configured through
  `CONTENTKIT_WEBHOOK_URL` / `CONTENTKIT_WEBHOOK_SECRET` (previously
  `CONTENTKIT_SUBKIT_WEBHOOK_URL` / `CONTENTKIT_SUBKIT_WEBHOOK_SECRET`).
  Deployments must rename these variables.
- The HTTP layer was split into focused modules (`routes`, `security`,
  `server`) without behavior changes.
- The webhook documentation was rewritten around the Standard Webhooks
  specification with a generic receiver example.

### Fixed

- A hex `accent` site setting is converted to an HSL triple before it reaches
  the `--primary` CSS variable; previously a raw hex value silently disabled
  the accent color (e.g. an invisible submit button).
- Tag links on content cards now use the same slug as the generated tag pages;
  multi-word tags previously linked to a non-existent URL.

[1.2.0]: https://github.com/MikeBild/contentkit/releases/tag/v1.2.0
[1.1.1]: https://github.com/MikeBild/contentkit/releases/tag/v1.1.1
[1.1.0]: https://github.com/MikeBild/contentkit/releases/tag/v1.1.0
[1.0.1]: https://github.com/MikeBild/contentkit/releases/tag/v1.0.1
[1.0.0]: https://github.com/MikeBild/contentkit/releases/tag/v1.0.0
