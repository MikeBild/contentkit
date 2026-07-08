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

An upload or render failure cannot change the public site. Rollback activates a
known release without rendering or copying files.

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
- Preview tokens are random, stored only as hashes, expiring and revocable.
- Public writes pass Turnstile, honeypot, length and in-memory IP rate limits.
- Contentkit signs exact webhook bytes using Standard Webhooks HMAC-SHA256; the
  HMAC key is the full `whsec_...` secret string verbatim (not base64-decoded).

## Static output

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
curated feed: the newest twelve posts as cards, plus topic chips. `/{locale}/archive/`
is the reference index: every post, grouped by year. Neither paginates, and the blog
deliberately does not — the archive already gives crawlers one page with every post
two clicks from the root, while pages `2..N` would need `hreflang` alternates that
cannot exist in every locale (`staticAlternates()` assumes a URL exists in all of
them, and post counts differ per locale). If the corpus ever outgrows one page,
paginate the *archive*: page 1 keeps its alternates and sitemap entry, later pages
get `noindex,follow`, no sitemap entry and no `hreflang`.

`archive.js` filters the archive in place by tag and free text. It fetches nothing —
the preview HTML rewriter only patches `href|src|action|data-index`, so a fifth path
attribute would 404 under `/p/<token>/`. Every post is server-rendered before the
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

### Derived, not authored

Reading time, related posts and older/newer links are computed at build time from
fields the author already wrote. They never enter `renderMarkdown()`'s `meta`, which
is the frontmatter contract. Related posts use cosine similarity over IDF-weighted
tag vectors: a tag on every post has an IDF of zero and contributes nothing, so a
post whose only tags are universal has no related section at all. Sort comparators
avoid `localeCompare`, whose behaviour follows the ICU data compiled into the Node
build.

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
