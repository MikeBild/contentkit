import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const cockpit = join(root, 'apps', 'cockpit')

/**
 * The app icon's href, held against `base` rather than against a literal.
 *
 * WHY A COMMENT WAS NOT ENOUGH
 *
 * `apps/cockpit/index.html` writes `href="/favicon.svg"` and Vite prepends the
 * configured base on the way through the build, so the served document says
 * `/cockpit/favicon.svg`. Commit 8502ec4 wrote thirty lines above that tag
 * explaining why the prefix must not be typed by hand — and nothing enforced it.
 * Both ways of getting it wrong stay green under a check that only looks at the
 * built file:
 *
 *   DOUBLING. A sibling console spelled the prefix into its source, Vite
 *   prepended the base to it anyway, and the built document pointed at
 *   /cockpit/cockpit/favicon.svg.
 *
 *   SILENT ACCEPTANCE. Here, Vite leaves a path it cannot resolve to a public
 *   file untouched, so writing `/cockpit/favicon.svg` in the SOURCE builds to
 *   exactly the same string as writing `/favicon.svg` does. The line then agrees
 *   with `base` without being derived from it, and the day `vite.config.ts`
 *   changes it points at the old prefix and nothing says so. This was measured,
 *   not supposed: the source was set to the prefixed spelling, the build was
 *   identical, and the convention check stayed green.
 *
 * WHY THIS ASSERTION AND NOT A LITERAL ONE
 *
 * A test that forbade `/cockpit/cockpit/` would catch the first failure and wave
 * the second through. Reading `base` out of the config and demanding that the
 * SOURCE href does not begin with it catches both with one line, and needs no
 * updating when the base changes — which is the property the base is here to
 * have.
 *
 * WHY THE BUILT HALF IS NOT ASSERTED HERE
 *
 * `assets/cockpit` is build output and is not in the repository, so a contract
 * test that read it would fail on a fresh clone for a reason that has nothing to
 * do with the contract. The other half — the built href is exactly `base` plus
 * the source href — is asserted by `scripts/konvention-check.mjs` rule 11, which
 * runs after `npm run cockpit:build` and reads the document the browser is served.
 * The half here is the half that needs no build, and it is also the half that
 * catches ContentKit's own failure mode.
 */
test('the app icon href is derived from the configured base, not spelled with it', () => {
  const config = readFileSync(join(cockpit, 'vite.config.ts'), 'utf8')
  const base = /^\s*base: '([^']+)',/m.exec(config)?.[1]
  assert.ok(base, 'apps/cockpit/vite.config.ts declares a `base`')
  assert.ok(base.startsWith('/') && base.endsWith('/'), `base "${base}" is an absolute directory path`)

  const html = readFileSync(join(cockpit, 'index.html'), 'utf8')
  const href = /<link[^>]+rel="icon"[^>]+href="([^"]+)"/.exec(html)?.[1]
  assert.ok(href, 'apps/cockpit/index.html declares <link rel="icon">')

  assert.ok(
    href.startsWith('/'),
    `the icon href "${href}" is relative. The console serves this document for deep paths under ${base} as well, ` +
      'so a relative reference resolves differently on every route.',
  )
  assert.ok(
    !href.startsWith(base),
    `the icon href "${href}" already carries the base "${base}". Vite prepends the base itself, so the prefix is ` +
      'either doubled or — as here — right by coincidence rather than by construction: it agrees with the config ' +
      `without being derived from it, and changing base in vite.config.ts would leave this line pointing at the old ` +
      `prefix. Write the path from the site root ("${href.slice(base.length - 1)}") and let the build prepend it.`,
  )
})
