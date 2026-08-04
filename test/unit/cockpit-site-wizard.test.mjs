import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { slugify as serverSlugify } from '../../src/utils.mjs'

/**
 * The site-creation wizard: its rules by running them, its markup by reading it.
 *
 * The rules used to be asserted as source text — `if (!BCP47.test(locale))` is
 * present, `firstProblem = STEP_ORDER.map(…)` is present — and never as values.
 * That guarantee was empty: widening `BCP47` to `/^.+$/` and dropping
 * `'languages'` from `STEP_ORDER` left ten of ten assertions green while the form
 * submitted `default_locale: 'german'`. So the rules now live in an import-free
 * module (apps/cockpit/src/forms/site/rules.ts) and are driven here with the
 * values an operator actually types.
 *
 * Anything that is genuinely markup — which testids exist, that the preset cards
 * are the generated set — is still read as text, from committed sources only:
 * never apps/cockpit/src/content/site.scoped.css or assets/cockpit/*, which are
 * build output and absent from a clean checkout.
 */

/**
 * The rules module, imported once and only where Node can read TypeScript.
 *
 * Type stripping landed in 22.6 and CI runs this suite on Node 20 as well. A
 * static `import … from '….ts'` there is not a skipped test: it is a file that
 * never loads, which takes every structural assertion below down with it and
 * reports it as one failure with no name on it. So the import is attempted, its
 * failure is kept, and the tests that drive real values carry the skip with the
 * reason in the TAP output — the same shape test/unit/cockpit-primitives.test.mjs
 * uses.
 */
let rules = null
let failure = null
try {
  rules = await import('../../apps/cockpit/src/forms/site/rules.ts')
} catch (error) {
  failure = error
}
const behavioural = {
  skip: rules ? false : `this Node cannot import TypeScript (type stripping landed in 22.6): ${failure?.message}`,
}
const {
  BCP47,
  EMPTY_DRAFT,
  SITE_LOCALE_MAX,
  SLUG_MAX,
  STEP_ORDER,
  additionalLocales,
  blockingProblem,
  createInput,
  derivedSlug,
  plannedLocales,
  siteSlug,
  stepProblem,
  storedDefaultLocale,
} = rules ?? {}

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const cockpit = join(root, 'apps', 'cockpit', 'src')

const read = (...parts) => readFile(join(cockpit, ...parts), 'utf8')

/** A draft that is valid everywhere except where a test makes it invalid. */
const draftWith = (overrides) => ({
  ...EMPTY_DRAFT,
  name: 'Mike Bild',
  base_url: 'https://example.com',
  default_locale: 'de',
  ...overrides,
})

/** The wizard's own context, with the URL check the wizard injects (checkUrl) stubbed to "fine". */
const context = (takenSlugs = []) => ({ takenSlugs, baseUrlProblem: () => undefined })

/**
 * The opening tag starting at `at`, brace-aware.
 *
 * A naive scan to the next `>` stops inside `onClick={() => …}`, which is how a
 * check like this quietly passes for every element that has a handler.
 */
function openingTag(source, at) {
  let depth = 0
  for (let index = at; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') depth -= 1
    else if (char === '>' && depth === 0) return source.slice(at, index + 1)
  }
  return source.slice(at)
}

function interactiveTags(source) {
  const tags = []
  for (const match of source.matchAll(
    /<(?:button|Button|ChoiceCards|LocaleField|SlugField|TagListField|TextField|UrlField)\b/g,
  )) {
    tags.push({ name: match[0].slice(1), tag: openingTag(source, match.index) })
  }
  return tags
}

describe('the wizard refuses exactly what the server would refuse', behavioural, () => {
  test('the default locale is the language tag the server stores, or it is a problem', () => {
    // Left: what an operator types. Right: undefined when it is accepted, or the
    // locale it will be stored as; a string starting with '!' is the refusal.
    const cases = [
      ['de', 'de'],
      ['en-us', 'en-us'],
      ['DE', 'de'],
      ['EN-US', 'en-us'],
      ['  de  ', 'de'],
      ['german', '!'],
      ['', '!'],
      ['x', '!'],
      ['en_US', '!'],
      ['deu', '!'],
      ['de-AT-1996', '!'],
    ]
    for (const [typed, expected] of cases) {
      const draft = draftWith({ default_locale: typed })
      const problem = stepProblem('languages', draft, context())
      if (expected === '!') {
        assert.ok(problem, `“${typed}” must be refused before the request — the server stores no such locale row`)
        continue
      }
      assert.equal(problem, undefined, `“${typed}” is a locale content can carry: ${problem}`)
      assert.equal(storedDefaultLocale(draft), expected, `“${typed}” is stored as ${expected}`)
    }
  })

  test('an unusable default locale blocks the submit button from every step', () => {
    // The submit button is gated on this one value, so it is the value that
    // decides whether `default_locale: 'german'` can be sent at all.
    for (const typed of ['german', '', 'EN US', 'x']) {
      const problem = blockingProblem(draftWith({ default_locale: typed }), context())
      assert.ok(
        problem,
        `blockingProblem must report “${typed}” — it is what disables site-create-submit, and the summary step ` +
          `is reachable by walking Back`,
      )
    }
    // And it stays quiet when nothing is wrong, or the button would never enable.
    assert.equal(blockingProblem(draftWith({}), context()), undefined)
  })

  test('every step is in STEP_ORDER, so no step’s rule can be skipped', () => {
    assert.deepEqual(
      [...STEP_ORDER],
      ['purpose', 'home', 'languages', 'ready'],
      'blockingProblem walks STEP_ORDER; a step missing from it is a rule that stops gating the request',
    )
    // Proven rather than assumed: each of the first three steps can block on its
    // own, so each one being in the list is load-bearing.
    const blocked = {
      purpose: draftWith({ preset: 'product-docs', docsVersion: { id: 'Version 1', label: '' } }),
      home: draftWith({ name: '' }),
      languages: draftWith({ default_locale: 'german' }),
    }
    for (const [step, draft] of Object.entries(blocked)) {
      assert.ok(stepProblem(step, draft, context()), `${step} must be able to block`)
      assert.ok(blockingProblem(draft, context()), `${step}'s problem must reach the submit button`)
    }
  })

  test('the additional languages are refused the same way, and de-duplicated before they are sent', () => {
    assert.match(
      stepProblem('languages', draftWith({ locales: ['fr', 'german'] }), context()),
      /german/,
      'a tag the server would refuse must be named',
    )
    assert.match(
      stepProblem('languages', draftWith({ default_locale: 'de', locales: ['de'] }), context()),
      /already the default locale/,
    )
    assert.match(stepProblem('languages', draftWith({ locales: ['fr', 'fr'] }), context()), /listed twice/)
    // Case and spacing are the same locale to the server, so the summary must
    // not promise two rows for them.
    const folded = draftWith({ default_locale: 'de', locales: [' FR ', 'fr', 'DE'] })
    assert.deepEqual(additionalLocales(folded), ['fr'])
    assert.deepEqual(plannedLocales(folded), ['de', 'fr'])
  })

  test('the client’s locale cap is the server’s own number, not a copy that drifts', async () => {
    // Everything in the test below builds its fixture from SITE_LOCALE_MAX,
    // sanity-checks it against SITE_LOCALE_MAX and matches a message containing
    // SITE_LOCALE_MAX — so 32 -> 320 rescaled all of it and stayed green while
    // the wizard admitted a 33rd locale row that POST /v1/sites answers 422 to,
    // taking the name, the base URL, the settings and every locale with it. The
    // only way that cannot happen is to read the server's declaration.
    const repository = await readFile(join(root, 'src', 'repository.mjs'), 'utf8')
    const declared = repository.match(/^const SITE_LOCALE_MAX = (\d+)$/m)
    assert.ok(declared, 'src/repository.mjs must still declare SITE_LOCALE_MAX — it is the ceiling the API enforces')
    assert.equal(
      SITE_LOCALE_MAX,
      Number(declared[1]),
      `the wizard caps locale rows at ${SITE_LOCALE_MAX}; src/repository.mjs enforces ${declared[1]}. The lower ` +
        `number is what the operator hits: either the form refuses rows the server accepts, or it accepts a row ` +
        `the server refuses with a 422 that discards the whole creation`,
    )
    // And that constant is the one the server refuses by and reports, so a
    // rename cannot leave this comparison reading a number nothing enforces.
    assert.match(repository, /locales\.length > SITE_LOCALE_MAX/, 'POST /v1/sites must refuse past that constant')
    assert.match(repository, /stored\.length >= SITE_LOCALE_MAX/, 'so must POST /v1/sites/{site}/locales')
    assert.match(repository, /max_locales: SITE_LOCALE_MAX/, 'and GET /v1/sites/{site}/locales must report it')
  })

  test('the locale cap the server enforces is enforced here', () => {
    // SITE_LOCALE_MAX distinct two-letter tags, none of them the default — the
    // cap pinned against src/repository.mjs above, where the next row is a 422.
    const tags = []
    for (let first = 0; tags.length < SITE_LOCALE_MAX && first < 26; first += 1) {
      for (let second = 0; tags.length < SITE_LOCALE_MAX && second < 26; second += 1) {
        const tag = `${String.fromCharCode(97 + first)}${String.fromCharCode(97 + second)}`
        if (tag !== 'de') tags.push(tag)
      }
    }
    assert.equal(new Set(tags).size, SITE_LOCALE_MAX, `the fixture must be ${SITE_LOCALE_MAX} distinct tags`)

    const overFull = draftWith({ locales: tags })
    assert.equal(plannedLocales(overFull).length, SITE_LOCALE_MAX + 1)
    assert.match(
      stepProblem('languages', overFull, context()),
      new RegExp(`at most ${SITE_LOCALE_MAX} locales`),
      'the 33rd locale row is a 422 that takes the whole creation with it',
    )
    // Exactly at the cap is accepted.
    assert.equal(
      stepProblem('languages', draftWith({ locales: tags.slice(0, SITE_LOCALE_MAX - 1) }), context()),
      undefined,
    )
  })

  test('a site with zero locale rows cannot be described by this form', () => {
    // Both doors: the rule refuses an empty default, and the request always
    // names one — the row `createSite` writes unconditionally.
    assert.match(stepProblem('languages', draftWith({ default_locale: '  ' }), context()), /default locale is required/)
    assert.equal(createInput(draftWith({ default_locale: 'DE' })).default_locale, 'de')
  })

  test('the slug is the one the server will store, cut to 96 characters', () => {
    // The console's own slugify (forms/fields) has no length limit, so a long
    // name used to print a slug in the summary that no site would ever have.
    for (const value of ['Mike Bild', 'Über Ästhetik', 'a'.repeat(200), 'Ünïcodé — dashes/and slashes', '   ']) {
      assert.equal(siteSlug(value), serverSlugify(value), `${value.slice(0, 24)}… must slugify like src/utils.mjs`)
    }
    assert.equal(siteSlug('a'.repeat(200)).length, SLUG_MAX)
    assert.equal(derivedSlug(draftWith({ name: 'a'.repeat(200) })).length, SLUG_MAX)
    // The cut can land on a hyphen, which `assertSlug` refuses — a 422 on a slug
    // the operator never saw unless the form shows the cut one.
    const awkward = draftWith({ name: `${'a'.repeat(95)} b` })
    assert.equal(derivedSlug(awkward), `${'a'.repeat(95)}-`)
    assert.match(stepProblem('home', awkward, context()), /not a usable slug/)
    // And the collision check compares the cut slug, not the untruncated one.
    const long = draftWith({ name: `${'x'.repeat(96)}yz` })
    assert.match(stepProblem('home', long, context([derivedSlug(long)])), /already taken/)
  })

  test('the home step still reports what checkUrl reports', () => {
    const draft = draftWith({ base_url: 'example.com' })
    assert.equal(
      stepProblem('home', draft, { takenSlugs: [], baseUrlProblem: () => 'Not a URL — include the scheme' }),
      'Not a URL — include the scheme',
    )
    assert.match(stepProblem('home', draftWith({ base_url: '' }), context()), /base URL is required/)
  })

  test('the product-docs preset needs its first version before the request exists', () => {
    assert.match(
      stepProblem(
        'purpose',
        draftWith({ preset: 'product-docs', docsVersion: { id: 'V 1', label: 'One' } }),
        context(),
      ),
      /version id/,
    )
    assert.match(
      stepProblem('purpose', draftWith({ preset: 'product-docs', docsVersion: { id: 'v1', label: '  ' } }), context()),
      /label/,
    )
    assert.equal(
      stepProblem('purpose', draftWith({ preset: 'product-docs', docsVersion: { id: 'v1', label: 'One' } }), context()),
      undefined,
    )
  })
})

describe('creating a site is one request', () => {
  test('the body carries the row, every locale row and the settings', behavioural, () => {
    const body = createInput(
      draftWith({
        name: '  Mike Bild  ',
        base_url: 'https://example.com  ',
        default_locale: 'DE',
        locales: ['EN', ' fr ', 'de'],
        preset: 'product-docs',
        docsVersion: { id: 'v1', label: ' Version 1 ' },
      }),
    )
    assert.deepEqual(body, {
      name: 'Mike Bild',
      slug: 'mike-bild',
      base_url: 'https://example.com',
      default_locale: 'de',
      locales: ['en', 'fr'],
      settings: {
        presentation: {
          preset: 'product-docs',
          docs: { versions: [{ id: 'v1', label: 'Version 1', status: 'current' }] },
        },
      },
    })
  })

  test('portfolio writes no settings at all, because unset behaves as portfolio', behavioural, () => {
    const body = createInput(draftWith({ preset: 'portfolio' }))
    assert.ok(!('settings' in body), 'settings must stay absent rather than be sent as portfolio')
    assert.ok(!('locales' in body), 'a single-locale site sends no locales array')
  })

  test('the wizard sends that one request and nothing else', async () => {
    const wizard = await read('forms', 'site', 'wizard.tsx')
    assert.match(wizard, /mutationFn: \(\) => ck\.sites\.create\(createInput\(draft\)\)/, 'one call, one body')
    // The three-request dance is gone, and with it every state it invented.
    for (const [pattern, why] of [
      [/ck\.sites\.addLocale/, 'locales are part of POST /v1/sites now'],
      [/ck\.sites\.update/, 'the preset is part of POST /v1/sites now'],
      [/progress\.current/, 'there is no partial creation to remember'],
      [/useRef/, 'the progress ref is gone with the sequence it tracked'],
      [/Finish the remaining requests/, 'nothing can be half-created'],
      [/Written so far/, 'the banner printed a draft as if it were stored state'],
      [/unfinished/, 'a site is either created or not'],
    ]) {
      assert.doesNotMatch(wizard, pattern, `${pattern} must be gone: ${why}`)
    }
    assert.doesNotMatch(wizard, /removeLocale/, 'the wizard must never delete a locale row')
    // And the reason written down is the real one: the limit was in the client.
    assert.doesNotMatch(
      wizard,
      /the order the API supports/,
      'POST /v1/sites always accepted locales and settings, so no sequence was ever "the order the API supports"',
    )
    assert.match(
      wizard,
      /only the hand-written signature in src\/api\/ck/,
      'the comment must name the client limit that caused the sequence, not invent an API one',
    )
  })

  test('the typed client accepts that body — otherwise the sequence would have to come back', async () => {
    const ck = await read('api', 'ck.ts')
    const create = ck.slice(ck.indexOf('create: (input:'), ck.indexOf('update: (site:'))
    assert.match(create, /SiteCreateInput/, 'create must take the generated input type, not a hand-written subset')
    const schema = await read('api', 'schema.d.ts')
    const input = schema.match(/SiteCreateInput: \{([\s\S]*?)\n {8}\};/)
    assert.ok(input, 'SiteCreateInput must exist in the generated schema')
    for (const field of ['locales?:', 'settings?:', 'default_locale:', 'slug?:']) {
      assert.ok(input[1].includes(field), `POST /v1/sites must accept ${field} for the single request to be possible`)
    }
  })
})

describe('the wizard’s markup', () => {
  test('the ids existing automation drives are unchanged', async () => {
    const wizard = await read('forms', 'site', 'wizard.tsx')
    for (const id of ['site-new', 'site-create-submit', 'site-create-cancel']) {
      assert.ok(wizard.includes(`data-testid="${id}"`), `${id} is driven by existing automation and must not move`)
    }
  })

  test('every control the wizard renders carries a data-testid', async () => {
    for (const [file, least] of [
      [['forms', 'site', 'wizard.tsx'], 12],
      [['components', 'ui', 'steps.tsx'], 1],
    ]) {
      const source = await read(...file)
      const tags = interactiveTags(source)
      assert.ok(tags.length >= least, `expected ${least} controls in ${file.join('/')}, found ${tags.length}`)
      for (const { name, tag } of tags) {
        assert.match(tag, /data-testid=/, `<${name}> in ${file.join('/')} has no data-testid: ${tag.slice(0, 120)}`)
      }
    }
  })

  test('the preset cards are the generated closed set, not a hand-written list', async () => {
    const enums = await read('forms', 'contracts', 'enums.generated.ts')
    const block = enums.match(/export const PRESENTATION_PRESET = \[([^\]]+)\]/)
    assert.ok(block, 'PRESENTATION_PRESET must still be generated into enums.generated.ts')
    const presets = [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
    assert.ok(presets.length >= 6, `expected the generated preset set, found ${presets.join(', ')}`)

    const wizard = await read('forms', 'site', 'wizard.tsx')
    // The cards are mapped from the generated constant, so a preset the server
    // gains cannot be missing from the wizard.
    assert.match(wizard, /PRESENTATION_PRESET\.map\(/, 'the cards must be derived from the generated set')
    const effects = wizard.match(/const PRESET_EFFECT: Record<PresentationPreset, string> = \{([\s\S]*?)\n\}/)
    assert.ok(effects, 'each preset needs one line on what it changes, in a total record over the enum')
    const described = [...effects[1].matchAll(/^ {2}'?([a-z-]+)'?:/gm)].map((match) => match[1])
    assert.deepEqual(
      [...described].sort(),
      [...presets].sort(),
      'every generated preset needs a description, and no name outside the closed set may be offered',
    )
  })

  test('the default locale is the existing closed-shape field, not a free-text input', async () => {
    const wizard = await read('forms', 'site', 'wizard.tsx')
    assert.match(
      wizard,
      /<LocaleField[\s\S]{0,400}?data-testid="ck-site-wizard-default-locale"/,
      'the default locale must be rendered by forms/fields LocaleField',
    )
    const page = await read('pages', 'sites.tsx')
    assert.doesNotMatch(page, /site-new-default_locale/, 'the free-text locale input must be gone')
    assert.doesNotMatch(page, /site-new-base_url/, 'the plain create dialog must be gone')
  })

  test('the field marks invalid exactly what the step rule refuses', behavioural, async () => {
    // Two regexes, not one: forms/fields/list.tsx keeps its own case-insensitive
    // copy for the control, and `stepProblem` case-folds before it tests. What
    // has to hold is not that the literals match but that the two agree on every
    // value — a field marked valid that the Next button then blocks leaves the
    // operator with nothing to correct, and the reverse marks a locale invalid
    // that the server would have stored.
    const list = await read('forms', 'fields', 'list.tsx')
    const literal = list.match(/^const BCP47 = \/(.+?)\/(i?)$/m)
    assert.ok(literal, 'forms/fields/list.tsx must still declare the shape it marks a typed locale invalid by')
    const fieldRule = new RegExp(literal[1], literal[2])
    for (const typed of ['de', 'DE', 'en-us', 'EN-US', 'EN', 'german', 'x', 'deu', 'en_US', 'de-AT-1996', '']) {
      assert.equal(
        fieldRule.test(typed),
        // The control lower-cases what it commits (`onChange(next.toLowerCase())`),
        // which is the same folding the rule does before testing.
        BCP47.test(typed.toLowerCase()),
        `“${typed}”: the locale field and the wizard's rule must agree — one accepting what the other refuses is ` +
          `either a control the operator cannot satisfy or an error with no field to point at`,
      )
    }
  })

  test('the summary shows the one request and the release steps that follow it', async () => {
    const wizard = await read('forms', 'site', 'wizard.tsx')
    assert.match(wizard, /data-testid="ck-site-wizard-requests"/)
    assert.match(wizard, /One request/, 'the summary must name what will be sent')
    assert.match(wizard, /data-testid="ck-site-wizard-next-steps"/)
    // Release-oriented: content alone changes nothing a reader can see.
    assert.match(wizard, /Add content/)
    assert.match(wizard, /Build a release/)
    assert.match(wizard, /Activate that release/)
  })
})

describe('“languages can be added later” is true of the console, not just of the API', () => {
  test('the console has a locale editor: it lists, adds and removes', async () => {
    const sections = await read('forms', 'site', 'sections.tsx')
    // All three, in the section that promises them. `removeLocale` had no caller
    // at all before this, which is what made the wizard's sentence false.
    assert.match(sections, /ck\.sites\.locales\(site\)/, 'the rows must be read with GET /v1/sites/{site}/locales')
    assert.match(sections, /ck\.sites\.addLocale\(site, /, 'a locale must be addable')
    assert.match(sections, /ck\.sites\.removeLocale\(site, /, 'a locale must be removable')
    const contract = await read('forms', 'site', 'contract.ts')
    assert.match(contract, /id: 'languages'/, 'SITE_SECTIONS must offer the section that holds it')
    assert.match(contract, /\| 'languages'/, 'SiteSectionId must know it, or SITE_SECTION_BODIES cannot be total')
    const bodies = sections.match(/SITE_SECTION_BODIES[\s\S]*?\n\}/)
    assert.ok(bodies && /languages: Languages/.test(bodies[0]), 'the section needs a body')
  })

  test('every control in the locale editor carries a data-testid', async () => {
    const sections = await read('forms', 'site', 'sections.tsx')
    const start = sections.indexOf('function Languages(')
    const end = sections.indexOf('function Presentation(')
    assert.ok(start > 0 && end > start, 'the Languages section body must exist')
    const body = sections.slice(start, end)
    for (const id of [
      'data-testid="ck-site-locales"',
      'data-testid="ck-site-locales-list"',
      'data-testid="ck-site-locales-add"',
      'data-testid="ck-site-locales-add-submit"',
      'data-testid={`ck-site-locale-${row.locale}`}',
      'data-testid={`ck-site-locale-remove-${row.locale}`}',
      'data-testid={`ck-site-locale-remove-confirm-${row.locale}`}',
      'data-testid={`ck-site-locale-remove-cancel-${row.locale}`}',
      'data-testid="ck-site-locales-add-error"',
      'data-testid="ck-site-locales-remove-error"',
    ]) {
      assert.ok(body.includes(id), `the locale editor must expose ${id}`)
    }
    for (const { name, tag } of interactiveTags(body)) {
      assert.match(tag, /data-testid=/, `<${name}> in the locale editor has no data-testid: ${tag.slice(0, 120)}`)
    }
  })

  test('the server’s two refusals are shown as they arrive, and named before they are hit', async () => {
    const sections = await read('forms', 'site', 'sections.tsx')
    const body = sections.slice(sections.indexOf('function Languages('), sections.indexOf('function Presentation('))
    // The 409 text carries the counts ("still has 2 published and 1 scheduled
    // content item(s)"). Rendering the error verbatim is what keeps them.
    assert.match(body, /remove\.error instanceof Error \? remove\.error\.message/, 'the refusal must be shown verbatim')
    assert.match(body, /add\.error instanceof Error \? add\.error\.message/, 'so must the add refusal')
    // The default locale offers no Remove button at all: that 409 is a permanent
    // property of the row, not an outcome worth trying.
    assert.match(body, /isDefault \? null :/, 'the default locale must not offer a removal that can never succeed')
    assert.match(body, /cannot be removed/, 'and it must say why')
    assert.match(body, /published or scheduled content/, 'the other refusal must be named before it is hit')
    assert.match(body, /draft_items/, 'the removal answer’s count of items left behind must be shown')
    assert.match(body, /release is built/, 'a locale change is invisible until the next release')
  })

  /**
   * The one site this editor exists to repair is the one it used to lock out.
   *
   * `builds` and the stored rows differ on exactly a zero-row site: it builds its
   * default locale through the documented fallback while having no row for it. The
   * add menu filtered on `builds`, so that site was offered every locale except
   * the only one worth adding — verified on production, where canary carries no
   * rows and `de` was missing from the list. A 409 is about a row that exists, so
   * the filter belongs on the rows.
   */
  test('the add menu withholds a locale only when a row for it exists', async () => {
    const sections = await read('forms', 'site', 'sections.tsx')
    const body = sections.slice(sections.indexOf('function Languages('), sections.indexOf('function Presentation('))
    const filter = body.slice(body.indexOf('locales={SUGGESTED_LOCALES'))
    const line = filter.slice(0, filter.indexOf('\n'))
    assert.match(line, /stored\b/, 'the filter must read the stored rows')
    assert.doesNotMatch(
      line,
      /\bbuilds\b/,
      'filtering on what the site builds withholds the default locale from a site that has no row for it — the repair case',
    )
  })

  test('the wizard points at that editor rather than at a bare endpoint', async () => {
    const wizard = await read('forms', 'site', 'wizard.tsx')
    assert.match(
      wizard,
      /Languages can be added later, in the Languages section of this site's settings/,
      'the promise must name the place in the console that keeps it',
    )
    assert.match(
      wizard,
      /Removing is refused while the locale is the default locale or while it still carries\s*\n?\s*published or scheduled content/,
      'the refusal conditions must be named, not just the capability',
    )
  })

  test('the client method the editor needs is the documented one', async () => {
    const ck = await read('api', 'ck.ts')
    assert.match(
      ck,
      /locales: \(site: string\)/,
      'GET /v1/sites/{site}/locales must exist — nothing else reads the rows',
    )
    assert.match(ck, /addLocale: \(site: string, locale: string\)/, 'the add-locale endpoint must exist')
    assert.match(ck, /removeLocale: \(site: string, locale: string\)/, 'and the remove-locale endpoint')
  })
})

/**
 * The right-hand side of a `const <name> =`, however it is line-wrapped.
 *
 * governance.tsx is JSX, so Node cannot import it. The one-line rules below are
 * sliced out and run instead of quoted: a rule asserted as source text is a rule
 * nobody has ever executed.
 */
function expressionOf(text, name) {
  const anchor = `const ${name} = `
  const start = text.indexOf(anchor)
  if (start === -1) return ''
  let depth = 0
  for (let index = start + anchor.length; index < text.length; index += 1) {
    const char = text[index]
    if ('([{'.includes(char)) depth += 1
    else if (')]}'.includes(char)) depth -= 1
    else if (char === '\n' && depth === 0) return text.slice(start + anchor.length, index)
  }
  return ''
}

const evaluate = (expression, scope) =>
  new Function(...Object.keys(scope), `return (${expression})`)(...Object.values(scope))

describe('the audit trail says what its site filter does', () => {
  test('the filter is seeded once, and the page says so instead of implying a live filter', async () => {
    const page = await read('pages', 'governance.tsx')
    const start = page.indexOf('export function AuditPage')
    assert.ok(start > 0, 'AuditPage must exist')
    const body = page.slice(start)
    // shell.tsx declares selection: 'seeds' for /audit, and the navigation test
    // derives that word from exactly this line. The two must not drift apart.
    assert.match(body, /useState\(site\)/, 'the filter is a copy of the selection, not a read of it')
    assert.match(
      page.slice(0, start + 2000),
      /moving the switcher does not change this list/,
      'a seeded filter must not be described as one the switcher narrows',
    )
    assert.match(
      body,
      /data-testid="ck-audit-follow-site"/,
      'and the page must offer the way back to the selected site',
    )
    assert.match(body, /onClick=\{\(\) => setScope\(site\)\}/, 'that control must actually re-point the filter')
    const shell = await read('app', 'shell.tsx')
    const audit = shell.slice(shell.indexOf("to: '/audit'"), shell.indexOf("to: '/assistant'"))
    assert.match(audit, /selection: 'seeds'/, 'the declaration and this page are one statement')
  })

  test('the caption does not promise the switcher’s site, because the first render may have none', async () => {
    const page = await read('pages', 'governance.tsx')
    const header = page.slice(page.indexOf('export function AuditPage'))
    // `useState(site)` captures the FIRST render, and useSite() derives `site`
    // from `?site=` and only picks a default once GET /v1/sites has answered
    // (lib/site.tsx). A cold load of /audit therefore opens on every site, so a
    // description promising the selected site is a sentence the page disproves.
    assert.doesNotMatch(
      header,
      /(?:opens|starts|filters) on the (?:site in the switcher|selected site|switcher’s site)/i,
      'on a cold load nothing is selected when this page first renders, so it cannot open on the selected site',
    )
    assert.match(
      header,
      /nothing is selected yet/,
      'the caption has to name the case it starts on every site in, or it is promising the switcher again',
    )
  })

  test('the way back to the selected site is offered in exactly the cases the two disagree', async () => {
    const page = await read('pages', 'governance.tsx')
    const diverged = expressionOf(page.slice(page.indexOf('export function AuditPage')), 'diverged')
    assert.ok(diverged, 'AuditPage must still derive `diverged` — it is what offers the way back')
    const shown = (site, scope) => evaluate(diverged, { site, scope })
    // The cold-load case is the one that matters: the filter says "every site"
    // while the switcher has landed on one, and that is when the operator needs
    // to be told, not left to compare two controls.
    assert.equal(shown('blog', ''), true, 'seeded before a site was known: the button is the only thing that says so')
    assert.equal(shown('blog', 'docs'), true, 'the operator moved the filter, then the switcher')
    assert.equal(shown('blog', 'blog'), false, 'nothing to say while the two agree')
    assert.equal(shown('', ''), false, 'and nothing to switch to while no site is selected at all')
  })
})

// The settings editor moved to pages/site-settings.tsx when /sites was split
// into the registry (installation context) and the selected site's settings
// (site context); these three read it there.
describe('the site settings view surfaces its section warnings', () => {
  test('every section warning is rendered above the sections', async () => {
    const page = await read('pages', 'site-settings.tsx')
    assert.match(page, /data-testid="ck-site-warnings"/, 'the warning strip must exist')
    // Derived from the contract, so a warning added to SITE_SECTIONS appears
    // without touching this page.
    assert.match(
      page,
      /SITE_SECTIONS\.map\(\(section\) => \(\{[\s\S]{0,200}?warning: section\.warning\?\.\(values\)/,
      'the strip must read every section spec’s own warning',
    )
    // The strip used to sit above a `<SectionNav>` — a horizontally scrolling row
    // of nine cards, which UI-UX.md's container ladder answers with an Accordion
    // at that count. What the rule was ever about is the *position*: the warnings
    // are outside every section, so nothing accepted-but-questionable needs a
    // section opened to be seen. So this now names the container that replaced it
    // rather than the one that is gone, and both halves are asserted — the
    // sections are an Accordion, and it comes after the strip.
    //
    // Every index and every match below is taken from the comment-stripped
    // source, and both halves of that matter: this page documents the choice it
    // made and quotes the prop it made it with, so the raw text would let the
    // sentence explaining a rule satisfy the rule — and three offsets, two of
    // them into a shortened string, would compare positions in two different
    // documents.
    const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    const strip = code.indexOf('<SectionWarnings')
    // The container's own testid, not `<Accordion` — `indexOf` would find
    // `<AccordionItem` and report a hand-rolled strip as the container.
    const nav = code.indexOf('data-testid="ck-site-sections"')
    const body = code.indexOf('<Body form={form}')
    assert.match(code, /from '@\/components\/ui\/accordion'/, 'the sections are the shared Accordion, not a local one')
    assert.match(
      code,
      /<Accordion\b[^>]*?type="multiple"[\s\S]{0,400}?data-testid="ck-site-sections"/,
      'the sections are one Accordion, and a refusal can name several of them, so several must be openable at once',
    )
    assert.ok(strip > 0 && nav > strip, 'the strip belongs above the section navigation')
    assert.ok(body > strip, 'the strip must not sit inside the expanded section body')
    // Every section is still individually addressable — scripts/verify-cockpit-prod.md
    // drives the settings form by exactly these ids.
    assert.match(code, /data-testid=\{`ck-site-sections-\$\{id\}`\}/, 'each section keeps its own testid')
  })

  test('a section warning is not hidden by an error in the same section', async () => {
    const page = await read('pages', 'site-settings.tsx')
    // form.sectionStatus() reports an error *instead of* a warning for the same
    // section, so the strip must not be built from it.
    const start = page.indexOf('function SectionWarnings')
    assert.ok(start > 0, 'SectionWarnings must exist')
    const end = page.indexOf('function IdentityConfirm')
    const source = page.slice(start, end > start ? end : undefined)
    assert.doesNotMatch(source, /sectionStatus/, 'the strip must read the specs, not the error-shadowed status')
  })

  test('each warning links to the section that owns it', async () => {
    const page = await read('pages', 'site-settings.tsx')
    assert.match(page, /data-testid=\{`ck-site-warnings-\$\{entry\.id\}`\}/)
    assert.match(page, /onClick=\{\(\) => onOpen\(entry\.id\)\}/)
  })
})
