# Architecture

## Content lifecycle

1. The content API parses and validates YAML frontmatter.
2. Multipart assets are content-addressed and uploaded once.
3. Every Markdown write creates an immutable revision.
4. A preview overlays selected revisions on the currently published snapshot.
5. A release overlays `revision_ids` on the published set and removes
   `retire_item_ids` from it, renders every public route and uploads a new
   immutable prefix.
6. `ck_activate_release()` switches the site pointer and published revisions in
   one database transaction; retired items get their published pointer cleared
   and their live revision archived.
7. The gateway resolves the request host and streams from the active prefix.

Unpublishing never destroys data: revisions are immutable, so a retired item
returns as soon as one of its revisions is published again.

Content webhook events ride the activation transaction: `ck_activate_release()`
and the outbox rows for `contentkit.content.published`,
`contentkit.content.unpublished` and `contentkit.release.published` commit
together, so a delivery can only exist for a pointer switch that actually
happened. Events fire per real transition — a no-op republish stays silent, and
a rollback (which moves the site pointer, not item pointers) emits only
`release.published`.

An upload or render failure cannot change the public site. Rollback activates a
known release without rendering or copying files.

The read API (`GET /v1/sites/{site}/published` and
`.../published/{kind}/{locale}/{slug}`) exposes the same published state as
JSON. It lives on the management API behind `content:read` scoped keys —
headless consumers are servers and build pipelines, exactly what scoped keys
exist for — so no second, anonymous delivery path appears and site delivery
stays static. The single document's HTML is rendered on demand and never
stored: revisions remain immutable Markdown, and caching rides existing
versions (a weak ETag over the site's publish epoch for the list, a strong
ETag over the revision source hash for the document).

Server-side search (`GET /v1/sites/{site}/search`) is an API-host feature on
the same read API: PostgreSQL full-text vectors are filled by an insert
trigger on the immutable revisions and queried only through the whitelisted
`ck_search_published` function, which joins exclusively over
`published_revision_id` — drafts are invisible by construction. Published
sites keep their static client-side search (`search-index.json`); nothing
about site delivery changes, and no anonymous search path appears.

A theme is a token assignment, never a different DOM: `settings.theme.tokens`
fills the custom properties the shared stylesheet already consumes (validated
against an allowlist on write, light/dark aware), `settings.accent` stays the
shorthand for the primary token, and the size-capped
`settings.theme.custom_css` escape hatch is appended as the last `<style>`
element. The generated inline block rides each page while `site.css` itself
stays shared and content-hashed — deliberately no template or layout overrides,
which would be a plugin system through the back door.

Visual compositions follow the same static-release boundary. With explicit
`layout: composition`, Markdown directives become a versioned Semantic AST.
Contentkit derives a Narrative, scores the repository-owned Pattern Registry,
resolves constraints and responsive fallbacks into a Composition AST, and only
then computes concrete layout and render trees. Release builds emit responsive
semantic HTML plus content-hashed standalone light/dark SVG assets. Report pages
do not repeat the complete composition inside the semantic HTML; they embed only
the responsive chart SVGs that add visual evidence. The complete SVG and PNG
remain explicit headless representations and PNG is not rerasterized with every release.
Charts are bounded table-driven evidence nodes and retain their source table;
they are not the composition architecture and no browser chart runtime is
exposed to authors. Dashboard renderers never synthesize live state, periods or
trends: only authored period labels and measured values may appear.

Pattern Packages are strict Markdown plus YAML under `patterns/`. The loader
accepts only known layout primitives and validates IDs, versions, semantic
compatibility, fallback references and cycles. Pattern prose is available to
humans and agents, while all executable layout and rendering code remains owned
by Contentkit. Uploaded executable code is outside the normal page/composition
trust boundary.

Slide decks form an explicit trusted-code boundary. A `kind: deck` revision is
first transformed into a deterministic, source-addressed DeckPlan. Semantic
slide nodes reuse the Pattern Registry and become light/dark SVG with PNG
fallback before the bounded Slidev/Vite child build produces one self-contained
HTML file. Upload, planning and validation require only `content:write`; the
executable compile/release boundary additionally requires `deck:render` for a
newly selected revision. The runner strips ContentKit secrets from the child
environment, bounds concurrency/queue/time, kills the child process group and
cleans temporary files. This is not an OS sandbox, so operators grant the scope
only to trusted automation. Published deck HTML remains inside the immutable
release and receives a path-specific offline CSP without weakening normal
pages.

## Migration ownership

The binary contains the migration journal and SQL bodies as generated string
literals. On every normal boot and on `--migrate`, one dedicated PostgreSQL
connection holds a stable session advisory lock while pending migrations run.
Each migration and its journal row commit in the same transaction. Stable tags
are authoritative, legacy hash-only rows are adopted, and edited historical SQL
is recorded as hash drift without executing it again. Deployment scripts only
provision the database and login; they do not copy or execute migration files.

## Security boundaries

- CMS metadata lives in the dedicated `contentkit` PostgreSQL database and is
  accessed directly through its dedicated owner login.
- The Storage bucket is private. Only Contentkit has the service-role key.
- Management keys (`ck_...`) are stored only as `HMAC-SHA256(pepper, raw key)`
  and scoped to sites and actions; the raw key is shown once. An unrecognized or
  expired key gets `401 unauthorized`; a valid key missing the required scope
  gets `403 insufficient_scope` — two distinct failure modes.
- Markdown raw HTML is discarded; Mermaid uses strict mode.
- Composition directives have closed names and attributes. Authors cannot
  supply geometry, CSS, executable code or renderer specifications. Markdown,
  viewport and chart limits bound compile work; SVG markup comes only from the
  Contentkit renderer and PNG uses a bundled font rather than host fonts.
- Deck compilation is executable trusted source gated by `deck:render`; its
  child process never receives database, storage, webhook or API secrets.
- Preview invitation and session tokens are random, stored only as separate
  hashes, expiring and revocable. A one-time invitation exchanges into a
  path-scoped HttpOnly cookie before the browser reaches the named preview URL.
- Public writes pass Turnstile, honeypot, length and in-memory IP rate limits.
- Contentkit signs exact webhook bytes using Standard Webhooks HMAC-SHA256; the
  HMAC key is the full `whsec_...` secret string verbatim (not base64-decoded).

## Static output

### Controlled presets and content graphs

`settings.presentation.preset` selects one of the server-owned portfolio,
product-docs, wiki, knowledge-base, product, or changelog information
architectures. Frontmatter can select a controlled page layout; it never names a
file or executable module. Docs/wiki/help hierarchies are resolved as a content
graph before any release object is uploaded. Missing parents, cycles, unknown
versions/groups, and duplicate generated URLs fail the build without moving the
active release pointer.

### Deterministic visual composition

Semantics, composition and theme are separate inputs. Patterns select visual
structure; the existing token contract selects appearance. The neutral theme is
the reference rendering, and every pattern owns a distinct visual grammar. A
deterministic score orders pattern candidates by semantic fit, narrative
question and goal, evidence roles, intent, item count, canvas, density and
container bounds with lexical tie-breaking. Responsive rules can select
a declared structural fallback without changing source meaning. Fixed viewports,
Contentkit's standard font stack with its bundled Inter primary face, stable
source ordering and registry hashing make identical inputs byte-reproducible.
Accessible text and source-order HTML remain available even when a visual
representation cannot be consumed. The resolved Layout Tree contains regions,
semantic node references, boxes, styles and renderer-neutral primitives. SVG
and visual HTML consume that shared contract; semantic HTML remains the
backward-compatible default.

The headless planning API exposes registry discovery, recommendation, validation
and compilation independently from release publishing. Published reads expose
the Semantic AST, Narrative, resolved Composition, diagnostics and authorized
SVG/PNG representation links. See [VISUAL_COMPOSITIONS.md](VISUAL_COMPOSITIONS.md).

### Consumer boundary

Contentkit exposes domain-neutral semantic nodes, narratives, patterns, layout
primitives and renderers. A consuming site owns its data sources, vocabulary,
navigation, routes, workflow cadence and editorial copy. Consumer names,
metrics, connectors and route conventions never enter the renderer or pattern
selection code. A real site may therefore assemble an operational cockpit, an
editorial publication, a knowledge base or another information product from
the same public contracts without creating a privileged product template.

### Release-scoped reader access

Reader credentials and memberships are site-scoped database state, while exact
and prefix access policies are snapshotted into `ck_release_access_entries`.
Activation and rollback therefore switch content and visibility through the
same active-release pointer. The builder derives every public discovery output
from the same visibility projection and stores protected search/navigation
records in `ck_release_access_catalog`; the gateway filters that catalog using
the current reader session.

The gateway checks policy before downloading HTML or protected-only media.
Passwords are salted scrypt hashes, session tokens are random and stored only as
HMAC hashes, and protected responses are never shared-cacheable. `noindex` is
SEO metadata and remains unrelated to authorization.

Because release HTML is static, it cannot be personalized safely for arbitrary
combinations of reader groups. A protected home or content page may embed
navigation and cards only for documents with the exact same canonicalized
group/user grant (plus public pages); the gateway enforces that grant before it
serves the bytes. Cross-grant unions remain reader-specific and are exposed only
through the private catalog endpoints. Product report sites without configured
series retain one newest-report navigation link and, when `reportCadence` is
present, one current report per cadence plus a bounded recent history from that
same-grant set. With `settings.presentation.report_series`, the builder instead
generates one `/{locale}/reports/{series}/` catalog per registered ID and derives
its lead from `lead_cadence`, its other current cadences and at most six
historical cards. The product home projects one compact lead state per series.
The current-state cards may project up to four `role="primary"` metric nodes from
their lead reports' Semantic AST; they do not copy or reinterpret values. Series
and cadence are explicit generic metadata and are never inferred from
tenant-specific titles or slugs. Unregistered series fail preview/release;
unassigned reports remain valid legacy content. Access and discovery projections
are unchanged.

Pages render without JavaScript except for the header search, which needs it:
`search.js` ships on every page and fetches the search index lazily on the first
interaction with the field, so a page view costs no extra request. Mermaid, forms
and Turnstile still load only on pages using them. `/{locale}/search/` is a static
page — the header form's GET fallback carries `?q=` deep links and Enter pressed
before the index has loaded; it is not a server-side search. Shared assets are
immutable. HTML is revalidated so an atomic release-pointer change becomes visible
quickly.

### Blog and archive

The two listings render the same posts to different ends. `/{locale}/blog/` is the
curated feed: the newest twelve posts as cards, plus topic chips and an RSS
subscribe row (feed link, reader deep links, copy-feed-URL button; opt-out via
`settings.blog.subscribe_row: false`). `/{locale}/archive/`
is the reference index: every post, grouped by year. Neither paginates, and the blog
deliberately does not — the archive already gives crawlers one page with every post
two clicks from the root, while pages `2..N` would need `hreflang` alternates that
cannot exist in every locale (`staticAlternates()` assumes a URL exists in all of
them, and post counts differ per locale). If the corpus ever outgrows one page,
paginate the *archive*: page 1 keeps its alternates and sitemap entry, later pages
get `noindex,follow`, no sitemap entry and no `hreflang`.

`archive.js` filters the archive in place by tag and free text. It fetches nothing —
the preview HTML rewriter only patches `href|src|action|data-index`, so a fifth path
attribute would 404 under `/previews/<slug>/`. Every post is server-rendered before the
script runs and the facet chips are real links to the tag pages, so the archive is a
complete crawlable index without scripting.

Tag pages carry no `hreflang`: tag slugs are locale-specific (`softwarearchitektur`
vs `software-architecture`), so derived alternates would point at URLs that do not
exist. The tag *index* does carry them, because it exists in every locale. A tag with
a single post gets `noindex,follow` — never `nofollow`, which would strangle the link
equity flowing to the post it lists — and neither a sitemap entry nor a feed.

Tags group by `slugify(tag)`, not by lowercased label, so `Node JS` and `Node.js`
merge into one page instead of the second silently overwriting the first. `C`, `C#`
and `C++` all slugify to `c` and therefore also merge; only a smarter `slugify()`
could separate them.

### API host vs. site hosts

One deployment serves the admin API and every published site. Anything that
describes contentkit *itself* — `/`, `/openapi.json`, `/llms.txt`, `/llms-full.txt`,
`/metrics` — is gated on the request `Host` matching `CONTENTKIT_PUBLIC_URL`. Served
unconditionally, they answered on every customer domain, where `/llms.txt` means
"describe this site", not "describe the CMS that built it", and `/metrics` handed
out request telemetry for the admin API.

`/health` and `/ready` are deliberately exempt: supervisors probe them over the
loopback or a pod IP, so `Host` is an address, and `/health` must not depend on a
database lookup.

Each site therefore generates its own `llms.txt` and `llms-full.txt` into the
release, exactly as it already did for `robots.txt` and `sitemap.xml` — root-level
well-known files whose content differs per host belong to the release, not to a
global route. The root copies are the default locale's; each locale also gets its
own under `/{locale}/`, linked from the other locales' `## Optional` section, which
[the spec](https://llmstxt.org/) defines as URLs a consumer may skip when it needs a
shorter context.

### One h1 per page

The layout renders the frontmatter `title` as the page's `<h1>`. When a document's first
block is a level-one heading whose text is that same title — the conventional way to write
Markdown — it is dropped from the rendered HTML, so the page has one `<h1>` and one document
outline. A body that deliberately opens with a *different* top-level heading keeps it, and a
heading that is not the first block is never touched. `source` is unaffected, so
`llms-full.txt` and the reading-time estimate still see the document as authored.

### Product analytics boundary

ContentKit owns its product facts in its own PostgreSQL database and exposes
bounded site-scoped aggregates through `/v1/sites/{site}/stats/*`. Those routes
reuse `content:read`; they are not a consumer-specific reporting API and do not
query another product's database. The response boundary contains only numeric
UTC time series. A downstream collector may join them with other product or
marketing APIs and persist report snapshots elsewhere, but ContentKit has no
dependency on that topology. Dedicated event tables record privacy-safe
reader-auth outcomes (because failed logins do not otherwise create a session),
numeric deck-build facts (because headless plans/compiles do not create content
rows), and—only when explicitly enabled—HTTP/composition usage. Usage rows carry
canonical route templates, bounded operation/outcome/timing/size fields and
ContentKit-local HMAC actor or session values. Anonymous HTTP is never
fingerprinted. Raw paths, query strings, content, request bodies, IP, User-Agent,
OAuth data and credentials never enter the table. Stats/reporting traffic is
classified `internal`, canaries `synthetic`, and organic traffic remains
separately queryable. Usage rows have their own 90-day retention; reader/deck
facts follow the configured product statistics retention.
See `docs/PRODUCT_ANALYTICS.md`.

### Derived, not authored

Reading time, related posts and older/newer links are computed at build time from
fields the author already wrote. They never enter `renderMarkdown()`'s `meta`, which
is the frontmatter contract. Related posts use cosine similarity over IDF-weighted
tag vectors: a tag on every post has an IDF of zero and contributes nothing, so a
post whose only tags are universal has no related section at all. Sort comparators
avoid `localeCompare`, whose behaviour follows the ICU data compiled into the Node
build.

Two frontmatter keys extend the authored contract without becoming a schema builder:
`extra:` is an author-owned map of custom fields stored verbatim in the revision
metadata (rendered in HTML and the Markdown surfaces only behind
`settings.content.show_extra`, never in JSON-LD or the search index), and
`related: [slug, …]` names same-locale posts to recommend. Authored references lead the
related-posts block in the author's order; tag similarity fills the list up to three,
and a reference that resolves to no published post is dropped with a warning at build
time — never a release failure, because the referenced post may simply not be published
yet. There are no custom content kinds: a dedicated collection is `kind: post` plus a
dedicated tag plus `extra` fields — the tag page supplies the listing and feed for free;
one-off pages are `kind: page`.

### Build time is an input

`buildSite({ now })` drives the post-age notice and the footer's copyright year, so
generated HTML varies with build time even when content does not. A release is an
immutable snapshot: a published release keeps the age notice it was built with until
the site is published again. Rendered dates are formatted in UTC for the same
reason — without an explicit zone, `2026-01-01T00:00:00Z` prints as `31.12.2025` on a
build machine in `America/New_York`, changing the bytes and the asset hash.

A post older than three years shows a notice that its content may be out of date.
`updatedAt` in the frontmatter is the only suppressor, and buys another three years;
an `evergreen` tag convention would surface publicly on the tag index, the tag pages,
the per-tag feeds, `article:tag` and the search index.
