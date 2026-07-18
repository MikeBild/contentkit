# Reader access control

Contentkit can protect a page, a path subtree, or uploaded media with personal
reader accounts and groups. Management API keys and reader sessions are separate
security domains: an API key administers a site; a reader cookie can only open
the published paths granted to that reader.

## Mental model

1. Create a group such as `customers` or `team`.
2. Create personal readers and assign their groups.
3. Protect an individual document with `access: [customers]`, or create an exact
   or prefix path rule through the management API.
4. Build a preview or release. Content and its access projection become active
   together.
5. Give each reader their own username and password.

Anonymous readers see none of a protected document's title, summary, search
text, navigation entry, sitemap entry, feed entry, `llms.txt` content, JSON-LD,
or protected-only media. Opening the URL redirects to the site-branded login
form.

Static HTML cannot vary per reader. When a home or content page is itself
protected, ContentKit therefore pre-renders public pages plus only those
protected pages whose group and user grants exactly match that page's grant.
This gives a fully private site useful home cards and navigation after login
without exposing titles across reader groups. A product site containing report
pages links its newest visible report as “Aktueller Report”/“Latest report” and
orders report cards newest-first. The private JSON endpoints remain available
for clients that need the reader-specific union of multiple grants.

## Manage groups and readers

All management endpoints require a `site:admin` API key scoped to the site.

```bash
curl -X POST "$CONTENTKIT_URL/v1/sites/$SITE/access/groups" \
  -H "Authorization: Bearer $CONTENTKIT_SITE_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slug":"customers","name":"Customers"}'

curl -X POST "$CONTENTKIT_URL/v1/sites/$SITE/access/users" \
  -H "Authorization: Bearer $CONTENTKIT_SITE_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "username":"anna",
    "display_name":"Anna Customer",
    "password":"a-long-unique-reader-password",
    "groups":["customers"]
  }'
```

Passwords must contain 12–256 characters. They are stored as salted scrypt
hashes (`N=32768`, `r=8`, `p=1`, 64-byte output) and are never returned by the
API. Changing a password, disabling a reader, or calling the session-revocation
endpoint invalidates existing sessions.

## Path rules

An exact rule protects one canonical route; a prefix rule protects a subtree:

```bash
curl -X POST "$CONTENTKIT_URL/v1/sites/$SITE/access/rules" \
  -H "Authorization: Bearer $CONTENTKIT_SITE_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "match":"prefix",
    "path":"/en/docs/v2/internal/",
    "groups":["team"]
  }'
```

The most specific matching rule wins; an exact rule wins over a prefix rule.
Rule writes return `rebuild_required: true`: they are policy drafts until the
next preview/release snapshots them. Rollback automatically restores the target
release's policy.

## Reader session endpoints

These routes live on each published site host, not only on the management API
host:

- `GET|POST /_contentkit/login`
- `POST /_contentkit/logout`
- `GET /_contentkit/session`
- `GET /_contentkit/navigation.json`
- `GET /_contentkit/search-index.json`

The login form uses a signed CSRF token and accepts only a same-origin
`return_to` path. A successful login sets an HttpOnly, SameSite=Lax cookie. It is
Secure on HTTPS sites. Sessions expire after 12 idle hours and after seven days
absolutely. The database stores only an HMAC of the random session token.

Protected responses use `Cache-Control: private,no-store`. An anonymous HTML
request redirects to login; protected media returns `401`; an authenticated
reader without a required grant receives `403`.

## Operations and troubleshooting

- `401 reader authentication required`: sign in again; the session may have
  expired or been revoked.
- `403 reader access denied`: the account is valid but is not in an allowed
  group and has no individual grant.
- `409 access group is referenced`: remove or update draft rules before deleting
  the group.
- A protected page appears in public search: rebuild and activate a release
  after changing the policy. Never treat `noindex` as access control.
- A protected asset is public: the same asset is referenced by public content;
  Contentkit logs this condition because a resource needed by a public page
  cannot simultaneously be secret.

Production requires an independent `CONTENTKIT_SESSION_SECRET`. Do not reuse an
API key, database password, storage service key, or webhook secret.
