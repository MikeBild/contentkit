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
