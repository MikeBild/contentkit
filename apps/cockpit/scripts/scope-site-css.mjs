// Derives a scoped copy of ContentKit's published stylesheet for the console.
//
// The console renders authored Markdown through ContentKit's own pipeline, so it
// needs ContentKit's own CSS — but unscoped that CSS carries `:root` tokens, a
// `*` reset and `html`/`body` rules that would repaint the whole console.
//
// Splitting assets/site.css by hand would mean editing the file that every
// published page depends on. Deriving it instead leaves that file untouched:
// one source of truth, and a site can never regress because the console needed
// a stylesheet. Regenerate with `npm run gen:css`.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(here, '..', '..', '..', 'assets', 'site.css')
const TARGET = join(here, '..', 'src', 'content', 'site.scoped.css')
const SCOPE = '.ck-content'

// `html` and `body` describe the page itself. Inside a container they mean
// nothing, and their margin/background would fight the console's own shell.
const DROPPED = new Set(['html', 'body'])

function scopeSelector(selector) {
  const trimmed = selector.trim()
  if (!trimmed) return null
  // `:root` is where the design tokens live. Moving them onto the container is
  // what makes `hsl(var(--foreground))` resolve inside the console without
  // leaking a single variable outside it.
  if (trimmed === ':root') return SCOPE
  if (DROPPED.has(trimmed)) return null
  if (trimmed === '*') return `${SCOPE} *`
  if (trimmed.startsWith('@')) return trimmed
  // Keyframe stops (`from`, `to`, `50%`) are not selectors.
  if (/^(from|to|\d+%)$/.test(trimmed)) return trimmed
  return `${SCOPE} ${trimmed}`
}

function scope(source) {
  // Comments come out before anything is split. They explain the source sheet
  // and style nothing, but a `{`, `}` or `,` inside one reads to the scanner
  // below as structure and corrupts the rule that follows it.
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  let index = 0
  let inKeyframes = 0
  let depth = 0

  while (index < css.length) {
    const brace = css.indexOf('{', index)
    if (brace < 0) {
      out.push(css.slice(index))
      break
    }
    const prelude = css.slice(index, brace)
    const close = css.indexOf('}', brace)

    if (prelude.trimStart().startsWith('@')) {
      // At-rules keep their prelude; their contents are scoped by the next
      // iterations, except inside @keyframes where the "selectors" are stops.
      if (/@keyframes/.test(prelude)) inKeyframes = depth + 1
      out.push(prelude, '{')
      depth += 1
      index = brace + 1
      continue
    }

    const selectors = prelude
      .split(',')
      .map((selector) => (inKeyframes ? selector.trim() : scopeSelector(selector)))
      .filter(Boolean)

    const body = css.slice(brace, close + 1)
    if (selectors.length) out.push(selectors.join(',\n'), body)
    index = close + 1

    // Track closing braces of at-rules so @keyframes scoping ends correctly.
    let tail = index
    while (tail < css.length && /\s/.test(css[tail])) tail += 1
    while (css[tail] === '}') {
      depth -= 1
      if (inKeyframes && depth < inKeyframes) inKeyframes = 0
      out.push('\n}')
      tail += 1
      while (tail < css.length && /\s/.test(css[tail])) tail += 1
      index = tail
    }
  }
  return out.join('')
}

const source = readFileSync(SOURCE, 'utf8')
const scoped = scope(source)
const banner = `/* GENERATED from assets/site.css by scripts/scope-site-css.mjs — do not edit.
   Every selector is scoped to ${SCOPE}, :root tokens move onto that container,
   and the page-level html/body rules are dropped. Run \`npm run gen:css\`. */\n`
writeFileSync(TARGET, banner + scoped)

const rules = (scoped.match(/\{/g) || []).length
console.log(`wrote src/content/site.scoped.css (${rules} rules, ${Math.round(scoped.length / 1024)} kB)`)
if (/(^|\n)\s*:root\s*\{/.test(scoped)) throw new Error(':root survived scoping — tokens would leak')
if (/(^|\n)\s*(html|body)\s*\{/.test(scoped)) throw new Error('a page-level rule survived scoping')
