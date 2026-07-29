import { renderMarkdown } from './markdown.mjs'
import { materializeReportCharts } from './report-charts.mjs'
import { sha256 } from './utils.mjs'

// Rendering a Markdown fragment for a reader that is not a published page — the
// console's assistant, its editor preview, its document inspector.
//
// Deliberately no rendering logic of its own. A second renderer in the browser
// would have to reimplement directive parsing, sixteen chart shapes, ECharts,
// the pattern registry and the sanitize allowlist, and would drift from what is
// actually published the first time either side changed. This is the same
// pipeline a release build runs, stopped one step earlier.
const CACHE_LIMIT = 256
const MAX_BYTES = 256 * 1024

const cache = new Map()

function remember(key, value) {
  // Insertion-ordered Map as an LRU: re-inserting moves a key to the end, so
  // the first key is always the least recently used.
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value)
  return value
}

/**
 * Frontmatter is how an author states title and locale, and `validateFrontmatter`
 * insists on both even leniently. A chat reply has no frontmatter at all, and a
 * draft being typed usually has a partial one — a title and nothing else. Both
 * would be rejected, which is exactly the input this endpoint exists to render.
 *
 * Missing keys are filled in rather than the document being reparsed by a second,
 * more forgiving parser: one parser, one set of rules, no drift.
 */
function withFrontmatter(markdown, locale) {
  if (!/^---\r?\n/.test(markdown)) {
    return `---\ntitle: Fragment\nlocale: ${locale}\n---\n\n${markdown}`
  }
  const end = markdown.indexOf('\n---', 4)
  if (end < 0) return markdown
  const block = markdown.slice(0, end)
  const missing = []
  if (!/^title:/m.test(block)) missing.push('title: Fragment')
  if (!/^locale:/m.test(block)) missing.push(`locale: ${locale}`)
  if (!missing.length) return markdown
  const open = markdown.indexOf('\n') + 1
  return markdown.slice(0, open) + missing.join('\n') + '\n' + markdown.slice(open)
}

export function renderFragmentEtag({ markdown, scheme, themeHash, version }) {
  return `"${sha256(markdown)}:${version}:${themeHash}:${scheme}"`
}

/**
 * Returns the rendered fragment plus everything the caller needs to decide how
 * to present it: the semantic tree, the narrative plan, the composition model
 * and the diagnostics. `source` is deliberately absent — echoing the input back
 * doubles the payload and tells the caller nothing it did not already send.
 */
export async function renderFragment({ markdown, site = {}, locale, scheme = 'auto', version = '0' }) {
  const source = String(markdown ?? '')
  if (Buffer.byteLength(source) > MAX_BYTES) {
    throw Object.assign(new Error(`markdown exceeds ${MAX_BYTES} bytes`), { statusCode: 413 })
  }
  const settings = site.settings || {}
  const resolvedLocale = locale || site.default_locale || 'en'
  const themeHash = sha256(JSON.stringify(settings.theme || {})).slice(0, 12)
  const key = `${sha256(source)}:${scheme}:${themeHash}:${resolvedLocale}:${version}`
  const hit = cache.get(key)
  if (hit) return remember(key, hit)

  // lenient: a fragment is not a publishable document, so a missing summary or
  // an unknown frontmatter key is a diagnostic, never a rejection.
  const rendered = await renderMarkdown(withFrontmatter(source, resolvedLocale), { lenient: true })
  const withCharts = materializeReportCharts(rendered, { settings, locale: resolvedLocale, scheme })

  return remember(key, {
    html: withCharts.html,
    semantic: rendered.semantic ?? null,
    narrative: rendered.narrative ?? null,
    composition: rendered.composition ?? null,
    diagnostics: rendered.diagnostics ?? [],
    accessible_text: rendered.accessibleText ?? rendered.accessible_text ?? null,
    has_mermaid: /class="mermaid"|data-mermaid/.test(withCharts.html),
    chart_count: rendered.charts?.length ?? 0,
    etag: renderFragmentEtag({ markdown: source, scheme, themeHash, version }),
  })
}

/** Boot-time warm-up. Cold rendering pays for Shiki grammars and ECharts init. */
export async function warmRenderer() {
  try {
    await renderFragment({ markdown: '# Warm\n\nText with `code`.\n', version: 'warmup' })
  } catch {
    // A failed warm-up must never keep the server from starting; the first real
    // request simply pays the cold cost instead.
  }
}
