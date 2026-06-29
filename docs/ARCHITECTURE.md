# Architecture

## Content lifecycle

1. The content API parses and validates YAML frontmatter.
2. Multipart assets are content-addressed and uploaded once.
3. Every Markdown write creates an immutable revision.
4. A preview overlays selected revisions on the currently published snapshot.
5. A release renders every public route and uploads a new immutable prefix.
6. `ck_activate_release()` switches the site pointer and published revisions in
   one database transaction.
7. The gateway resolves the request host and streams from the active prefix.

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
- Management keys are HMAC-hashed with a server-side pepper and scoped to sites
  and actions.
- Markdown raw HTML is discarded; Mermaid uses strict mode.
- Preview tokens are random, stored only as hashes, expiring and revocable.
- Public writes pass Turnstile, honeypot, length and in-memory IP rate limits.
- Contentkit signs exact webhook bytes using Standard Webhooks HMAC-SHA256.

## Static output

Normal pages need no JavaScript. Search, Mermaid, forms and Turnstile load only
on pages using them. Shared assets are immutable. HTML is revalidated so an
atomic release-pointer change becomes visible quickly.
