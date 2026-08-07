// Five contract clauses the sibling console holds and this one did not.
//
// They arrived here as a group for one reason: the sibling closed its own
// contract gap and, doing so, wrote tests for rules BOTH consoles carry. The
// family document is byte-identical in both repositories; the enforcement was
// not, and this console went from being the one ahead to the one behind on
// CUI-MARK-1, CUI-MARK-2, CUI-THEME-3, CUI-THEME-5 and CUI-LOAD-4.
//
// Every check reads source or build output as text. Stated once, here: this
// cannot tell a correct pre-paint script from a plausible one — only that the
// two implementations of one rule still agree about the rule.
import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const SRC = join(root, 'apps', 'cockpit', 'src')

/** The storage key both implementations of the theme rule have to agree on. */
const THEME_STORAGE_KEY = 'ck-cockpit-theme'

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('the served console declares which contract it implements — CUI-MARK', () => {
  // The marker is DERIVED, and that is the point. The family's earlier version
  // of this was a hand-typed number, and four repositories could each keep
  // claiming version 2 while their bytes drifted apart. A digest computed from
  // the token file can only agree when the bytes agree.
  //
  // No test inside one repository can prove its bytes match an absent sibling's.
  // What this buys is that a divergence is VISIBLE — in the DOM, in a
  // screenshot, without anybody running a comparison — instead of silent.
  //
  // `assets/cockpit` is BUILD OUTPUT and is gitignored in this repository — the
  // sibling commits its equivalent, this one does not. So the served document
  // may or may not exist when this runs, and the two halves of the check are
  // separated accordingly rather than the whole thing being skipped:
  //
  //   the MECHANISM is always checkable — the plugin is in vite.config.ts and
  //   the digest it will emit can be computed here from the same file;
  //   the OUTPUT is checked whenever a build has happened, which covers the
  //   cockpit CI job and every local run after `npm run cockpit:build`.
  //
  // Skipping the second half silently would be the failure this file exists to
  // prevent, so its absence is reported rather than passed over.
  const expected = createHash('sha256')
    .update(readFileSync(join(root, 'contract', 'cockpit-ui.css'), 'utf8'))
    .digest('hex')
    .slice(0, 12)
  const builtPath = join(root, 'assets', 'cockpit', 'index.html')
  const built = existsSync(builtPath) ? readFileSync(builtPath, 'utf8') : null

  test('the build injects the marker, and derives the digest from the token file — CUI-MARK-1', () => {
    const config = readFileSync(join(root, 'apps', 'cockpit', 'vite.config.ts'), 'utf8')
    assert.match(config, /cockpit-ui-contract" content="cockpit-ui"/)
    assert.match(config, /cockpit-ui-digest" content="sha256-\$\{digest\}"/)
    assert.match(config, /contract\/cockpit-ui\.css/, 'the digest is not computed from the token file')
    assert.match(config, /createHash\('sha256'\)/)
  })

  test('the served document carries that exact digest', (t) => {
    if (!built) {
      t.diagnostic('assets/cockpit not built in this run — the mechanism is checked above')
      return
    }
    assert.match(built, /<meta name="cockpit-ui-contract" content="cockpit-ui"/)
    const declared = built.match(/content="sha256-([0-9a-f]{12})"/)?.[1]
    assert.equal(declared, expected, 'the served digest is not the digest of contract/cockpit-ui.css')
  })

  test('the shell carries the contract on its outermost element — CUI-MARK-2', () => {
    const shell = readFileSync(join(SRC, 'app', 'shell.tsx'), 'utf8')
    assert.ok(shell.includes('data-cockpit-ui="cockpit-ui"'), 'the shell declares no contract attribute')
  })
})

describe('the pre-paint script and the store answer the same question — CUI-THEME-3', () => {
  // Two implementations of one rule, in two languages, in two files. The script
  // in index.html runs BEFORE the bundle and decides the first frame; the store
  // decides every frame after it. When they disagree the console renders one
  // scheme and then swaps — which is the exact flash the script exists to
  // prevent, arriving from the other direction.
  const html = readFileSync(join(root, 'apps', 'cockpit', 'index.html'), 'utf8')

  test('the script reads the key the store writes', () => {
    assert.ok(html.includes(THEME_STORAGE_KEY))
    const store = readFileSync(join(SRC, 'lib', 'theme-store.ts'), 'utf8')
    assert.ok(store.includes(`'${THEME_STORAGE_KEY}'`), 'the store no longer names the key the script reads')
  })

  test('the script treats key-absence as `system`, exactly as the store does', () => {
    // `!stored && matchMedia(...)` is the whole rule: no key means ask the OS.
    // A script that instead compared against the string 'system' would light the
    // first frame differently from every frame after it, for the majority of
    // operators — the ones who never chose.
    assert.match(html, /!stored\s*&&\s*matchMedia\(/)
    assert.doesNotMatch(html, /===\s*['"`]system['"`]/)
  })

  test('the script carries the resolved scheme on the same class the store uses', () => {
    assert.match(html, /classList\.toggle\(['"`]dark['"`]/)
  })

  test('the script is blocking, and it cannot take the console down with it', () => {
    // No `defer`, no `async`, no `type="module"` — any of the three moves it
    // after first paint and the flash comes back. And it is wrapped in a
    // try/catch because a tab with site data blocked throws on localStorage,
    // which would otherwise take the whole document with it before React loads.
    const script = html.slice(html.indexOf('<script'), html.indexOf('</script>'))
    assert.doesNotMatch(script, /\b(defer|async)\b/)
    assert.doesNotMatch(script, /type="module"/)
    assert.ok(script.includes('try {'), 'the pre-paint script is not guarded')
    assert.ok(script.includes('catch'), 'the pre-paint script is not guarded')
  })
})

describe('signing out leaves the theme alone — CUI-THEME-5', () => {
  test('nothing on the sign-out path touches the theme key or its cookie', () => {
    // Load-bearing since the funnel started reading the cookie: the login page
    // is the NEXT PAINT after sign-out, so clearing the preference on the way
    // out makes an operator's own console flash white at them. "Clear the
    // cookies on logout" is the instinct this exists to stop.
    //
    // Comments are stripped first: shell.tsx EXPLAINS the rule near the code it
    // governs, and a grep that reads prose reports the explanation as the
    // violation.
    for (const file of ['app/shell.tsx', 'components/session-gate.tsx']) {
      const src = stripComments(readFileSync(join(SRC, file), 'utf8'))
      assert.doesNotMatch(src, /localStorage\.(clear|removeItem)/, `${file} clears storage on sign-out`)
      assert.ok(!src.includes(THEME_STORAGE_KEY), `${file} names the theme key near sign-out`)
    }
  })
})

describe('the four states stay four — CUI-LOAD-4', () => {
  // An empty result and a failed request must never look the same. `TableState`
  // is what keeps them apart; a page that reads `isError` off a query has taken
  // the branching back, and the four states start drifting the next time one of
  // them is edited.
  function walk(dir) {
    const out = []
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...walk(path))
      else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) out.push(path)
    }
    return out
  }

  test('no page hand-rolls the error branch a shared component owns', () => {
    // Two modules are exempt, each for a stated reason rather than because it
    // was awkward:
    //
    //   session-gate.tsx decides whether there IS a session. TableState renders
    //   content, and content is what the gate is deciding about.
    //
    //   system.tsx is the page whose premise is that a failed poll is a
    //   READING — /health not answering is what it exists to show.
    const EXEMPT = new Set(['session-gate.tsx', 'system.tsx'])
    const offenders = []
    for (const path of walk(join(SRC, 'pages')).concat(walk(join(SRC, 'components')))) {
      const name = path.split('/').pop()
      if (EXEMPT.has(name)) continue
      const src = stripComments(readFileSync(path, 'utf8'))
      for (const match of src.matchAll(/\.isError\b/g)) {
        offenders.push(`${name}: reads ${match[0]} instead of letting the shared component branch`)
      }
    }
    assert.deepEqual(offenders, [])
  })
})

describe('model output says which model — CUI-AI-1 and CUI-AI-2', () => {
  // This console streams a model's prose on a whole page and attributed it to
  // nobody. It could not: the model is deployment configuration and the stream
  // carries text, so the console had no way to know the name. The probe it
  // already makes to learn whether the assistant is enabled now answers with it.
  const attribution = readFileSync(join(SRC, 'components', 'ai', 'model-attribution.tsx'), 'utf8')

  test('the assistant attributes the model that answers', () => {
    const page = stripComments(readFileSync(join(SRC, 'pages', 'assistant.tsx'), 'utf8'))
    assert.ok(page.includes('ModelAttribution'), 'the assistant renders model prose and attributes it to nobody')
    assert.match(page, /x-assistant-model/, 'the page never learns which model replied')
  })

  test('the server tells the console which model replies', () => {
    const routes = readFileSync(join(root, 'src', 'routes.mjs'), 'utf8')
    assert.match(routes, /'x-assistant-model':\s*config\.assistantModel/)
  })

  test('a model identity never renders in a token that means confirmed — CUI-AI-1', () => {
    // The assistant's answers are the one thing in this console nobody
    // measured; every other number on screen came from a count of rows or a
    // duration. So the identity wears the outline variant, never a success one.
    assert.match(attribution, /variant="outline"/)
    assert.doesNotMatch(attribution, /variant="default"/)
  })

  test('no model means no attribution, rather than an empty badge', () => {
    // A chip rendered for output no model produced has invented a provenance.
    assert.match(attribution, /if \(!model\) return null/)
  })

  test('a confidence is never printed without its scale — CUI-AI-2', () => {
    // Either a denominator, or an explicit admission that there is none. A
    // share of something counted and a model's estimate of itself are different
    // kinds of number, and rendering them alike lends the second the first's
    // authority.
    assert.match(attribution, /of\?\s*:\s*number/)
    assert.match(attribution, /selfReported\?\s*:\s*boolean/)
    // Absent is `—`, never 0: a confidence nobody reported is not zero.
    assert.match(attribution, /value === null \|\| value === undefined/)
  })
})
