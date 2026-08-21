import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
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

/**
 * Which product's console the BUILT bytes belong to.
 *
 * scripts/konvention-check.mjs asserts the marker against the document the
 * fixture DELIVERS, before it starts a browser. That is the assertion that
 * matters at run time, and it is only worth anything while the marker survives
 * the build — Vite rewrites `<link>` and `<script>` hrefs, and "it does not
 * touch meta content" is a claim about a tool, which is the kind of claim that
 * ought to be measured rather than believed.
 *
 * And the value is held against `package.json` rather than repeated: the marker
 * exists to say which product this is, so a marker free to drift away from the
 * product's own name would be worse than no marker at all.
 *
 * `assets/cockpit` is build output and gitignored here, so the built half runs
 * whenever a build has happened — every local run after `npm run cockpit:build`,
 * which is what most working copies have. It does NOT run in CI: the `test` job
 * carries this suite and does not build, and the `cockpit-e2e` job builds and
 * does not carry it. Its absence is reported rather than passed over in silence,
 * and the half CI needs is asserted where CI always has a bundle —
 * scripts/konvention-check.mjs holds the delivered document to one declaration
 * and to the value in the source. The source half here needs no build and always
 * runs.
 */
test('the shell declares which product it is, and the build keeps the declaration', (t) => {
  const source = readFileSync(join(cockpit, 'index.html'), 'utf8')
  const declared = /<meta[^>]+name="cockpit-product"[^>]+content="([^"]+)"/.exec(source)?.[1]
  assert.ok(declared, 'apps/cockpit/index.html declares <meta name="cockpit-product">')

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(
    declared.toLowerCase(),
    pkg.name.toLowerCase(),
    `the console calls itself "${declared}" and the package calls itself "${pkg.name}". The marker exists to say ` +
      'which product this is; one that can name a different one is worse than none.',
  )

  const builtPath = join(root, 'assets', 'cockpit', 'index.html')
  if (!existsSync(builtPath)) {
    t.diagnostic('assets/cockpit not built in this run — the source half above is checked, the built half is not')
    return
  }
  const built = readFileSync(builtPath, 'utf8')
  assert.equal(
    [...built.matchAll(/name="cockpit-product"/g)].length,
    1,
    'the built document carries the identity exactly once — a second one is a second answer to a question that ' +
      'has to have one',
  )
  assert.equal(
    /<meta[^>]+name="cockpit-product"[^>]+content="([^"]+)"/.exec(built)?.[1],
    declared,
    'the build rewrote, dropped or duplicated the identity. The convention check reads the SERVED document, so a ' +
      'marker that does not survive the build is a marker that is not there when it is needed.',
  )
})
