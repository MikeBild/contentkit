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
 * Vite prepends the configured base, so `href="/favicon.svg"` is served as
 * `/cockpit/favicon.svg`. Commit 8502ec4 wrote thirty lines explaining why the
 * prefix must not be typed by hand and nothing enforced it. Both failures stay
 * green under a check that only reads the built file: a sibling doubled the
 * prefix (/cockpit/cockpit/favicon.svg), and here Vite leaves an unresolvable
 * path alone, so the prefixed source builds to the identical string — measured,
 * with the convention check staying green. That line agrees with `base` without
 * being derived from it, and a changed base leaves it pointing at the old prefix.
 *
 * Forbidding `/cockpit/cockpit/` would catch the first and wave the second
 * through; reading `base` and demanding the SOURCE href not begin with it
 * catches both. The built half is rule 11 in scripts/konvention-check.mjs, which
 * runs after a build — a contract test may not read gitignored build output.
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
 * The run-time assertion is in scripts/konvention-check.mjs, against the
 * delivered document. It is worth something only while the marker survives the
 * build — Vite rewrites `<link>` and `<script>` hrefs, and "it does not touch
 * meta content" is a claim about a tool, worth measuring rather than believing.
 * The value is held against `package.json`: a marker free to drift away from the
 * product's own name is worse than none.
 *
 * The built half only runs where a build has happened, which is most working
 * copies but no CI job (the `test` job does not build, `cockpit-e2e` does not
 * carry this suite). Its absence is reported rather than passed over.
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
