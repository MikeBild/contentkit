/**
 * The fixture the Cockpit browser suite runs against: the built console on a
 * real origin, and an API synthesized from docs/openapi.json.
 *
 * WHY A SERVER RATHER THAN page.route()
 *
 * docs/OPEN-WORK.md §2 proposes serving assets/cockpit and intercepting `/v1/*`
 * with `page.route()`. The interception half is the part that changed, and only
 * because the static half already forces a server: the bundle is built with
 * `base: '/cockpit/'` and talks to a same-origin `/v1`, so `file://` cannot host
 * it and something has to answer on an origin either way. Once that server
 * exists, answering `/v1` from it costs one more branch and buys three things
 * `page.route()` does not:
 *
 * - Same-origin for real. The session cookie, the CSRF header and
 *   `credentials: 'same-origin'` in src/api/client.ts behave exactly as they do
 *   in production rather than as Playwright's fulfilment makes them behave.
 * - Every transport, not just `fetch`. The assistant's chat stream is driven by
 *   the AI SDK's own transport (see apps/cockpit/src/pages/assistant.tsx), and a
 *   route handler written against `fetch` semantics is a thing to keep in sync.
 * - One installation for the whole run. `page.route()` is per-page, so every
 *   viewport in the matrix would re-register it, and a case that forgot would
 *   fail for the wrong reason.
 *
 * `page.route()` is still available and is the right tool for a per-case
 * override — "this one endpoint 500s" — which no case here needs yet.
 *
 * WHY THE RESPONSES ARE SYNTHESIZED
 *
 * Hand-written fixtures for sixteen pages are sixteen guesses about response
 * shapes, and a guess that drifts makes a green suite that renders empty pages —
 * which is precisely the failure mode this suite exists to end. docs/openapi.json
 * is generated from the server (`npm run docs:gen-openapi`) and apps/cockpit's
 * own types are generated from it, so synthesizing every response from the same
 * document means the fixture cannot describe a shape the console does not expect.
 * A path the document does not describe answers 501 and the suite says so, rather
 * than answering `{}` and letting a page render nothing.
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const bundle = join(root, 'assets', 'cockpit')

/** How many rows a list answers with. Enough that every list overflows 800px. */
export const LIST_SIZE = 30
/** Arrays below the top level are incidental — ids, tags, scopes — and stay small. */
const NESTED_ARRAY_SIZE = 2

/**
 * The sites the switcher offers. Fixed rather than synthesized: the slug is a
 * path parameter, a search param and a localStorage key, so it has to be the
 * same string everywhere, and the names are chosen to exercise truncation.
 */
export const SITES = [
  { id: '11111111-1111-4111-8111-111111111111', slug: 'canary', name: 'Canary' },
  { id: '22222222-2222-4222-8222-222222222222', slug: 'atlas', name: 'Atlas Documentation' },
  { id: '33333333-3333-4333-8333-333333333333', slug: 'harbour', name: 'Harbour Publishing Group Incorporated' },
  { id: '44444444-4444-4444-8444-444444444444', slug: 'ledger', name: 'Ledger' },
  { id: '55555555-5555-4555-8555-555555555555', slug: 'meridian', name: 'Meridian Handbook' },
  { id: '66666666-6666-4666-8666-666666666666', slug: 'northwind', name: 'Northwind Field Notes' },
  { id: '77777777-7777-4777-8777-777777777777', slug: 'orbit', name: 'Orbit' },
  { id: '88888888-8888-4888-8888-888888888888', slug: 'pinnacle', name: 'Pinnacle Knowledge Base' },
  { id: '99999999-9999-4999-8999-999999999999', slug: 'quarry', name: 'Quarry' },
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug: 'sextant', name: 'Sextant Operations Manual' },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', slug: 'trellis', name: 'Trellis' },
  { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', slug: 'vantage', name: 'Vantage Product Docs' },
]

/** The scopes every NAV entry in apps/cockpit/src/app/shell.tsx names. */
export const OPERATOR_SCOPES = [
  'stats:read',
  'content:read',
  'content:write',
  'access:admin',
  'webhook:admin',
  'site:admin',
  'api-key:admin',
  'moderation:write',
  'audit:read',
]

const MIME = new Map(
  Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
  }),
)

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic values.
//
// Nothing here is random. A suite whose fixture changes between runs turns a
// layout regression into "it failed once", which is how a browser gate gets
// muted. Every value below is a pure function of the property's name and its
// index in the list it belongs to.
// ─────────────────────────────────────────────────────────────────────────────

const WORDS = [
  'release',
  'snapshot',
  'locale',
  'revision',
  'composition',
  'deck',
  'webhook',
  'moderation',
  'audience',
  'narration',
]

function hash(text) {
  let value = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

function uuid(seed) {
  const digits = `${hash(seed).toString(16).padStart(8, '0')}${hash(`${seed}:2`).toString(16).padStart(8, '0')}${hash(`${seed}:3`).toString(16).padStart(8, '0')}${hash(`${seed}:4`).toString(16).padStart(8, '0')}`
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-4${digits.slice(13, 16)}-8${digits.slice(17, 20)}-${digits.slice(20, 32)}`
}

/** A fixed instant, so a relative-time label is the same string on every run. */
const EPOCH = Date.UTC(2026, 0, 15, 9, 30, 0)

function timestamp(seed) {
  return new Date(EPOCH - (hash(seed) % 720) * 3600_000).toISOString()
}

function words(seed, count) {
  return Array.from({ length: count }, (_, index) => WORDS[hash(`${seed}:${index}`) % WORDS.length]).join(' ')
}

/**
 * A string that reads like the thing it is named after.
 *
 * The names matter for layout: a `body` rendered as `text-1` never wraps, and a
 * suite that never wraps cannot tell a page that overflows from one that does
 * not. These are the shapes the console actually lays out.
 */
function stringFor(name, seed, format) {
  if (format === 'uuid') return uuid(seed)
  if (format === 'date-time') return timestamp(seed)
  if (format === 'uri' || /(^|_)url$/.test(name)) return `https://example.test/${name || 'path'}/${hash(seed) % 900}`
  if (/email/.test(name)) return `${words(seed, 1)}.${hash(seed) % 90}@example.test`
  if (/(^|_)slug$/.test(name)) return `${words(seed, 1)}-${hash(seed) % 900}`
  if (/locale/.test(name)) return ['en', 'de', 'fr'][hash(seed) % 3]
  if (/(^|_)(name|title|label|display_name)$/.test(name)) return titleCase(words(seed, 2 + (hash(seed) % 2)))
  if (/(body|message|summary|description|reason|error|text)/.test(name)) return `${titleCase(words(seed, 12))}.`
  if (/(^|_)id$/.test(name)) return uuid(seed)
  if (/(path|prefix)/.test(name)) return `/${words(seed, 1)}/${hash(seed) % 90}`
  if (/(version)/.test(name)) return `4.9.${hash(seed) % 20}`
  if (/(status|state|kind|type|action|event)/.test(name)) return words(seed, 1)
  return words(seed, 3)
}

function titleCase(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// ─────────────────────────────────────────────────────────────────────────────
// The OpenAPI document, and one instance of any schema in it.
// ─────────────────────────────────────────────────────────────────────────────

const document = JSON.parse(await readFile(join(root, 'docs', 'openapi.json'), 'utf8'))

function deref(schema) {
  if (!schema || typeof schema !== 'object') return schema
  if (!schema.$ref) return schema
  const name = schema.$ref.replace('#/components/schemas/', '')
  const target = document.components?.schemas?.[name]
  if (!target) throw new Error(`openapi.json refers to a schema it does not define: ${schema.$ref}`)
  return deref(target)
}

/**
 * One instance of `schema`.
 *
 * `depth` decides how long an array is: the response's own list is what a page
 * lays out, and everything below it is a detail of a row.
 */
function instance(schema, { name = '', seed = 'seed', depth = 0 } = {}) {
  const resolved = deref(schema)
  if (!resolved || typeof resolved !== 'object') return null
  if (resolved.const !== undefined) return resolved.const
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    const choices = resolved.enum.filter((value) => value !== null)
    return choices[hash(seed) % choices.length] ?? null
  }
  if (Array.isArray(resolved.allOf)) {
    return resolved.allOf.reduce(
      (merged, part) => Object.assign(merged, instance(part, { name, seed, depth })),
      /** @type {Record<string, unknown>} */ ({}),
    )
  }
  const union = resolved.oneOf || resolved.anyOf
  if (Array.isArray(union) && union.length > 0) return instance(union[0], { name, seed, depth })

  const type = Array.isArray(resolved.type) ? resolved.type.find((entry) => entry !== 'null') : resolved.type

  if (type === 'array') {
    // Depth 0 is the response itself (`[Site, …]`) and depth 1 is the one list
    // inside an envelope (`{api_keys: […]}`, `{items: […]}`) — both are what a
    // page lays out. Anything below that is a field of a row.
    const size = depth <= 1 ? LIST_SIZE : NESTED_ARRAY_SIZE
    const bounded = Math.min(resolved.maxItems ?? size, Math.max(resolved.minItems ?? 0, size))
    return Array.from({ length: bounded }, (_, index) =>
      instance(resolved.items ?? {}, { name, seed: `${seed}:${index}`, depth: depth + 1 }),
    )
  }

  if (type === 'object' || resolved.properties || resolved.additionalProperties) {
    const value = /** @type {Record<string, unknown>} */ ({})
    for (const [key, property] of Object.entries(resolved.properties ?? {})) {
      value[key] = instance(property, { name: key, seed: `${seed}:${key}`, depth: depth + 1 })
    }
    // `additionalProperties` with a schema is how this document spells "a map of
    // metric names to numbers" — ProductStats.totals, UsageStats.metrics. A page
    // that renders a stat tile per key gets nothing to render without them.
    const extra = resolved.additionalProperties
    if (extra && typeof extra === 'object' && Object.keys(resolved.properties ?? {}).length < 3) {
      for (const key of ['built', 'activated', 'failed']) {
        value[key] = instance(extra, { name: key, seed: `${seed}:${key}`, depth: depth + 1 })
      }
    }
    return value
  }

  if (type === 'integer') return hash(seed) % 400
  if (type === 'number') return Number(((hash(seed) % 40000) / 100).toFixed(2))
  if (type === 'boolean') return hash(seed) % 3 !== 0
  if (type === 'null') return null
  return stringFor(name, seed, resolved.format)
}

// ─────────────────────────────────────────────────────────────────────────────
// Path matching.
// ─────────────────────────────────────────────────────────────────────────────

const OPERATIONS = Object.entries(document.paths ?? {})
  .flatMap(([template, item]) =>
    Object.entries(item)
      .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
      .map(([method, operation]) => ({
        template,
        method: method.toUpperCase(),
        operation,
        // A literal segment beats a parameter, so the more literal template wins
        // where two match: /v1/sites/{site} must never answer for /v1/sites.
        literals: template.split('/').filter((segment) => segment && !segment.startsWith('{')).length,
        pattern: new RegExp(`^${template.replace(/\{[^}]+\}/g, '([^/]+)').replace(/\//g, '\\/')}$`),
        parameters: [...template.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]),
      })),
  )
  .sort((first, second) => second.literals - first.literals || second.template.length - first.template.length)

function match(method, pathname) {
  for (const entry of OPERATIONS) {
    if (entry.method !== method) continue
    const found = entry.pattern.exec(pathname)
    if (!found) continue
    const path = Object.fromEntries(entry.parameters.map((key, index) => [key, decodeURIComponent(found[index + 1])]))
    return { ...entry, path }
  }
  return null
}

function responseSchema(operation) {
  const responses = operation.responses ?? {}
  for (const status of ['200', '201', '202', '204']) {
    const content = responses[status]?.content
    const schema = content?.['application/json']?.schema
    if (schema) return { status: Number(status), schema }
    if (content) return { status: Number(status), schema: null }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// The handful of responses that have to be coherent rather than merely valid.
// ─────────────────────────────────────────────────────────────────────────────

const SESSION = {
  subject: 'operator@example.test',
  email: 'operator@example.test',
  display_name: 'Fixture Operator',
  provider_id: 'fixture',
  role: 'admin',
  product_scopes: OPERATOR_SCOPES,
  site_ids: [],
  csrf_token: 'fixture-csrf-token',
  expires_at: new Date(EPOCH + 3600_000).toISOString(),
  absolute_expires_at: new Date(EPOCH + 86_400_000).toISOString(),
}

/**
 * The GETs whose response docs/openapi.json still describes in prose only.
 *
 * These are the same gaps `unwrapAs` marks in apps/cockpit/src/api/ck.ts, and
 * they are listed by name rather than swallowed by a default: a page that reads
 * `.patterns` off an undefined body throws, and a fixture that answered `{}`
 * would turn a crashed page into a blank one. Each entry names the schema the
 * document *does* define for the rows, so the shapes still come from the
 * document; only the envelope is written here. When a schema is added to
 * src/openapi.mjs the entry stops being needed and `assertFixtureCoverage`
 * below is what says so.
 */
const PROSE_ONLY = {
  'GET /v1/composition-patterns': () => ({
    patterns: instance(
      { type: 'array', items: { $ref: '#/components/schemas/PatternDescriptor' } },
      {
        seed: 'composition-patterns',
      },
    ),
  }),
  'GET /v1/publishing-guides': () => ({
    guides: instance(
      { type: 'array', items: { $ref: '#/components/schemas/PublishingGuide' } },
      {
        seed: 'publishing-guides',
      },
    ),
  }),
  'GET /v1/content/{item}/revisions': ({ path }) =>
    Array.from({ length: 6 }, (_, index) => ({
      id: uuid(`revision:${path.item}:${index}`),
      item_id: path.item,
      status: ['draft', 'scheduled', 'published', 'archived'][index % 4],
      source_sha256: hash(`sha:${path.item}:${index}`).toString(16).repeat(8).slice(0, 64),
      slug: `revision-${index}`,
      title: titleCase(words(`revision:${index}`, 3)),
      summary: `${titleCase(words(`revision-summary:${index}`, 10))}.`,
      tags: [words(`tag:${index}`, 1)],
      metadata: {},
      scheduled_at: null,
      published_at: index === 2 ? timestamp(`published:${index}`) : null,
      created_at: timestamp(`revision-created:${index}`),
    })),
  'GET /v1/content/{item}/audio': () => ({ audio: null }),
}

function siteRecord(reference) {
  const found = SITES.find((entry) => entry.slug === reference || entry.id === reference) ?? SITES[0]
  return {
    ...instance(document.components.schemas.Site, { seed: `site:${found.slug}` }),
    id: found.id,
    slug: found.slug,
    name: found.name,
    description: 'A fixture site served by scripts/cockpit-fixture.mjs.',
    base_url: `https://${found.slug}.example.test`,
    default_locale: 'en',
  }
}

/**
 * Rewrites the identifiers a page joins on.
 *
 * Two surfaces showing the same row have to agree about which site it belongs
 * to, or a filtered list is empty for a reason that has nothing to do with the
 * console. Every `site_id` in a response becomes the site the request asked
 * about; everything else keeps its synthesized value.
 */
function reconcile(value, siteId) {
  if (Array.isArray(value)) return value.map((entry) => reconcile(entry, siteId))
  if (!value || typeof value !== 'object') return value
  const record = /** @type {Record<string, unknown>} */ (value)
  for (const [key, nested] of Object.entries(record)) {
    if (key === 'site_id' && typeof nested === 'string') record[key] = siteId
    else record[key] = reconcile(nested, siteId)
  }
  return record
}

function apiResponse(method, pathname, query) {
  // Same-origin, so nothing here is a CORS preflight — the AI SDK's transport
  // probes with OPTIONS before it opens the assistant's stream. Answering it is
  // HTTP, not a stub, and refusing it put a 501 in the console's error log.
  if (method === 'OPTIONS') {
    return { status: 204, headers: { allow: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' }, body: '' }
  }
  if (pathname === '/health') return { status: 200, headers: { 'content-type': 'text/plain' }, body: 'ok' }
  if (pathname === '/v1/identity/session') return { status: 200, json: SESSION }
  if (pathname === '/v1/identity/logout') return { status: 204, body: '' }
  if (pathname === '/v1/sites' && method === 'GET') {
    return { status: 200, json: SITES.map((site) => siteRecord(site.slug)) }
  }

  const found = match(method, pathname)
  if (!found) {
    return {
      status: 501,
      json: {
        error: 'not_in_openapi',
        message: `${method} ${pathname} is not described by docs/openapi.json, so the fixture cannot answer it.`,
      },
    }
  }

  const site = found.path.site ? siteRecord(found.path.site) : siteRecord(query.get('site_id') ?? SITES[0].slug)
  if (found.template === '/v1/sites/{site}' && method === 'GET') return { status: 200, json: site }

  const prose = PROSE_ONLY[`${method} ${found.template}`]
  if (prose) return { status: 200, json: reconcile(prose(found), site.id) }

  const shape = responseSchema(found.operation)
  if (!shape) return { status: 204, body: '' }
  if (!shape.schema) {
    return {
      status: 501,
      undocumented: true,
      json: {
        error: 'response_not_in_openapi',
        message: `${method} ${found.template} answers 200 in docs/openapi.json but declares no response schema, and scripts/cockpit-fixture.mjs has no PROSE_ONLY entry for it.`,
      },
    }
  }

  const seed = `${method}:${found.template}:${site.slug}`
  const json = reconcile(instance(shape.schema, { seed }), site.id)
  // The locale set the switcher's site claims and the set its settings page
  // edits are the same fact on two surfaces; a default_locale that disagrees
  // reads as a broken page rather than a fixture.
  if (found.template === '/v1/sites/{site}/locales' && json && typeof json === 'object') {
    json.default_locale = site.default_locale
    json.builds = ['en', 'de']
    json.locales = ['en', 'de'].map((locale) => ({ locale, created_at: timestamp(`locale:${locale}`) }))
  }
  return { status: shape.status, json }
}

// ─────────────────────────────────────────────────────────────────────────────
// The server.
// ─────────────────────────────────────────────────────────────────────────────

async function readBundle(pathname) {
  const relative = normalize(pathname.replace(/^\/cockpit\/?/, '')).replace(/^(\.\.[/\\])+/, '')
  const candidate = resolve(bundle, relative || 'index.html')
  if (!candidate.startsWith(bundle)) return null
  try {
    const info = await stat(candidate)
    if (info.isDirectory()) return null
    return { path: candidate, body: await readFile(candidate) }
  } catch {
    return null
  }
}

/**
 * Starts the fixture on an ephemeral port.
 *
 * Ephemeral because the suite has to be runnable while `npm start` holds 4050
 * and while another agent holds anything else: a fixed port is a reason for a
 * gate to fail on a machine rather than on a defect.
 */
export async function startFixture() {
  if (!(await stat(join(bundle, 'index.html')).catch(() => null))) {
    throw new Error(
      `assets/cockpit/index.html is missing. Build the console first: bash scripts/build-cockpit.sh (or npm run cockpit:build).`,
    )
  }

  /** Every path the console asked for that the fixture could not answer. */
  const unanswered = []

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const pathname = url.pathname

      if (pathname.startsWith('/v1/') || pathname === '/health' || pathname === '/ready') {
        const answer = apiResponse(request.method ?? 'GET', pathname, url.searchParams)
        if (answer.status === 501) unanswered.push(`${request.method} ${pathname} — ${answer.json.error}`)
        response.writeHead(answer.status, {
          'content-type': 'application/json; charset=utf-8',
          ...answer.headers,
          'cache-control': 'no-store',
        })
        response.end(answer.json !== undefined ? JSON.stringify(answer.json) : (answer.body ?? ''))
        return
      }

      if (pathname === '/' || !pathname.startsWith('/cockpit')) {
        response.writeHead(302, { location: '/cockpit/' })
        response.end()
        return
      }

      const file = (await readBundle(pathname)) ?? (await readBundle('/cockpit/index.html'))
      if (!file) {
        response.writeHead(404, { 'content-type': 'text/plain' })
        response.end('not found')
        return
      }
      const extension = file.path.slice(file.path.lastIndexOf('.'))
      response.writeHead(200, {
        'content-type': MIME.get(extension) ?? 'application/octet-stream',
        'cache-control': 'no-store',
      })
      response.end(file.body)
    })().catch((error) => {
      response.writeHead(500, { 'content-type': 'text/plain' })
      response.end(String(error))
    })
  })

  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const { port } = /** @type {{ port: number }} */ (server.address())

  return {
    origin: `http://127.0.0.1:${port}`,
    unanswered,
    async close() {
      await new Promise((done) => server.close(done))
    },
  }
}
