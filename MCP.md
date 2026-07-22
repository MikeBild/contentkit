# ContentKit MCP API

ContentKit exposes a remote, stateful Streamable HTTP MCP server at `POST|GET|DELETE /mcp`. It targets MCP protocol revision `2025-11-25` and the TypeScript SDK 1.29.x. The MCP surface is a domain API over the same repository, release manager, authorization rules and PostgreSQL data as REST; it is not an independent persistence path and it does not duplicate every REST endpoint as a tool.

## Connect and authorize

Configure an MCP client with one URL:

```text
https://contentkit-api.example.com/mcp
```

An unauthenticated request returns `401` with `WWW-Authenticate` pointing to RFC 9728 protected-resource metadata. Discovery is available at:

- `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-authorization-server`

The built-in OAuth 2.1 authorization server supports authorization code + PKCE-S256, RFC 8707 `resource`, short-lived opaque access tokens, rotating refresh tokens with family replay revocation, public clients and bounded dynamic registration. Authorize and token requests must use the exact resource `https://<api-host>/mcp`. The consent decision follows POST/Redirect/GET with `303`; repeated decision submissions receive the same short-lived encrypted authorization response and never mint a second code.

The sign-in and consent screens use the compact, server-rendered common MCP auth card, branded `ck`. One API-key plus multiple named token-bridge and OIDC adapters may be enabled concurrently. In API-key mode, an existing scoped ContentKit key proves the operator identity; derived OAuth codes and tokens stop working as soon as that source key is revoked, expires or rotates. OAuth access tokens are never accepted as operator keys. External adapters require an exact pre-provisioned identity grant; email alone never grants access. Operator sessions have an eight-hour idle and 24-hour absolute limit, are revalidated, can be explicitly logged out, and the consent page can switch accounts. Requested scopes are pre-selected, while the operator may reduce the grant within the identity's live role, product-scope and site ceiling; consent never displays or grants a scope the client did not request.

OAuth scopes map to product scopes:

| OAuth scope | Product capability |
|---|---|
| `mcp:read` | Published reads and privacy-bounded statistics |
| `mcp:authoring` | Read plus drafts, semantic compositions, deck rendering and isolated previews |
| `mcp:admin` | All ContentKit product scopes, still bounded by the identity grant and sites |

Existing `ck_...` API keys also authenticate directly at `/mcp`. MCP sessions never authenticate a request: each request must repeat a credential, and a session ID is bound to the principal and its current scope/site ceiling. A live authorization downgrade invalidates the old session context.

## Domain tools

`tools/list` is scope-filtered. An unavailable tool is indistinguishable from a nonexistent tool.

| Tool | Domain responsibility |
|---|---|
| `contentkit_context` | Select relevant visible sites and establish the safe workflow |
| `contentkit_sites` | Read site metadata and locales |
| `contentkit_search` | Search only the active published snapshot |
| `contentkit_read` | Read one published document with semantic, narrative, visual and deck models |
| `contentkit_content` | Inspect authoring items/revisions or delete a never-published draft |
| `contentkit_ingest` | Validate Markdown and create an immutable draft revision |
| `contentkit_composition` | Recommend, validate or compile semantic visual information architecture |
| `contentkit_deck` | Plan, validate or compile source-traceable narrative decks |
| `contentkit_releases` | Inspect release and preview history |
| `contentkit_publish` | Preview immutable releases; publish/activate/unpublish require `release:write` |
| `contentkit_stats` | Read product, HTTP, composition and MCP aggregates |
| `contentkit_manage_sites` | Site configuration CRUD |
| `contentkit_manage_access` | Reader user/group/rule CRUD |
| `contentkit_manage_webhooks` | Webhook CRUD, delivery inspection and retry |
| `contentkit_manage_api_keys` | API-key list/create/revoke; creation uses URL elicitation |
| `contentkit_manage_identities` | Exact OIDC identity-grant CRUD |
| `contentkit_moderation` | Comment queue and decisions |
| `contentkit_audit` | Redacted append-only audit events |

Prefer these domain verbs over sequences of generic row mutations. CRUD remains explicit for bounded administrative aggregates where CRUD is the actual domain language.

## Human-control boundaries

The server uses native MCP form elicitation for live publication, activation, unpublication, draft deletion, revocation, moderation decisions and administrative mutations. The form names the exact target and effect. The agent must not infer or supply the human decision. Decline, cancel, timeout, malformed input or a client without form elicitation leaves state unchanged.

Secrets must never be requested through form elicitation. Creating an API key or rotating/creating a webhook secret uses MCP URL elicitation and a one-time, ten-minute ContentKit handoff page. Opening the page does not consume the capability; the human must press the reveal button, which protects against link prefetchers. The page then reveals the secret once with `no-store`, strict CSP and no referrer; the MCP client receives only metadata. New API keys and webhook changes remain disabled until reveal and fail closed on cancellation, expiry or process failure.

Draft ingest and read-only calls do not require confirmation. Preview is isolated, expiring and non-live, so it can be built directly. Publish/activate/unpublish accept bounded idempotency keys to prevent duplicate live operations.

## Resources and prompts

The server exposes code-versioned resources:

- `contentkit://system/agent-guide`
- `contentkit://docs/llms.txt`
- `contentkit://docs/llms-full.txt`
- `contentkit://docs/openapi.json`

Prompts cover safe authoring, semantic visualization, narrative decks and publication review. Resources are application-controlled context; prompts are user-selected workflows; tools remain model-controlled operations.

## Transport and operations

- Streamable HTTP uses one SDK server per session so handlers close over one principal.
- Invalid browser `Origin` values return `403`; unsupported protocol versions return `400`.
- Unknown, expired or foreign session IDs return the same JSON-RPC `-32001`/HTTP `404` response.
- Idle sessions expire, total sessions are capped with oldest-idle eviction, and active SSE streams are retained until close/cancel.
- Request bodies use the same configured byte cap as REST. The service streams SSE responses and cancels them when the socket closes.
- Shutdown stops OAuth cleanup, URL handoffs and all MCP sessions before closing the database.

When usage telemetry is enabled, MCP records bounded operation/tool/resource categories, outcome, duration, response mode, result count and active-session count. It never records prompts, tool arguments, tool results, Markdown, content, URLs, client IPs, credentials or raw actor/session IDs. Actor and session dimensions use the deployment-local usage HMAC. Site-scoped aggregates are available at `/v1/sites/{site}/stats/mcp` and through `contentkit_stats`.

Administrative and publication events also write an append-only redacted audit record. Metadata keys associated with secrets, tokens, authorization, cookies, Markdown, content, bodies and email are removed before storage.

## Configuration

```dotenv
CONTENTKIT_MCP_ENABLED=true
CONTENTKIT_MCP_SESSION_TTL_MS=1800000
CONTENTKIT_MCP_MAX_SESSIONS=1000
CONTENTKIT_MCP_ELICITATION_TIMEOUT_MS=300000
CONTENTKIT_OAUTH_SECRET=<independent-high-entropy-secret>
CONTENTKIT_OAUTH_ALLOWED_SCOPES=mcp:read,mcp:authoring,mcp:admin
CONTENTKIT_OAUTH_DCR_ENABLED=true
CONTENTKIT_OAUTH_PROVIDERS=[{"protocol":"api_key","id":"api-key","label":"ContentKit API key"},{"protocol":"token_bridge","id":"external-identity","label":"External identity","login_url":"https://login.example.com/contentkit/","issuer_url":"https://identity.example.com","audience":"contentkit","jwks_url":"https://identity.example.com/.well-known/jwks.json","allowed_emails":["operator@example.com"]},{"protocol":"oidc","id":"workforce-oidc","label":"Workforce OIDC","issuer_url":"https://identity.example.com","client_id":"...","client_secret":"...","scopes":"openid email profile"}]
```

`CONTENTKIT_OAUTH_SECRET` is mandatory in production and must be independent from the API-key pepper, preview/session secrets and usage HMAC. `CONTENTKIT_OAUTH_PROVIDERS` is the only browser-provider configuration: `api_key` may occur once, named `token_bridge` and `oidc` records may occur several times, and every id is unique. External URLs must use HTTPS. Bridge claim paths default to `sub`, `email`, and `email_verified`; safe dotted overrides support nested standards-based claims while verification must still resolve to boolean `true`. Identity grants are managed with `/v1/identity-grants` or the corresponding MCP admin tool. Product storage credentials remain unrelated to identity. All adapters use only `/v1/identity/login/start`, `/v1/identity/login/callback`, and `/v1/identity/logout`.

Protocol references: [MCP 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25), [authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation), and [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
