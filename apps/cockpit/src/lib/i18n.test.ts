import { describe, expect, it } from 'vitest'
import { globSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { CATALOGS, translate } from './i18n'
import { createLocaleStore, LOCALE_STORAGE_KEY, resolveLocale, type LocalePreference } from './locale-store'

/**
 * What the console draws, not what happens to be JSX text.
 *
 * This probe used to read exactly two things: `ts.isJsxText` and four attribute
 * names. That is one of the three ways a word gets onto the screen, and the
 * narrowest of them. `{releaseName(release)}` put an English label on the German
 * console and this file could not have seen it whatever the word had been — a
 * JSX *expression* was simply not a thing it looked at
 * (LOCAL-CK-I18N-SONDE-SIEHT-NUR-JSXTEXT). "Release happens to be the same word
 * in both catalogs" explains why nobody noticed; it does not explain why the
 * check did not.
 *
 * So it now reads all three surfaces:
 *
 *   1. JSX text, as before.
 *   2. JSX child EXPRESSIONS, followed backwards through file-local values to
 *      the literals they can carry. `{note.reason}` is nine English sentences
 *      five hops from where it is drawn: `const note = switcherNote(open)` → the
 *      function's returns → `mixture?.reason` → `MIXED.find(…)` → the array's
 *      `reason` properties. Nothing shorter than following the value would have
 *      found it.
 *   3. JSX ATTRIBUTES, by exclusion instead of by list. A four-name allowlist can
 *      only ever catch the four attributes somebody already thought of, and
 *      `label="extra"` on the Custom-fields group was not one of them.
 *
 * Following VALUES, never callees: `X.find(…)` and `X[i]` carry an element of
 * `X`, `X.map(fn)` carries what `fn` returns, a call to a file-local `function`
 * DECLARATION carries that function's returns, and `t(…)` carries the catalog
 * and therefore has nothing to report. The word `declaration` is load-bearing:
 * `const f = () => '…'` is an initializer the resolver reaches and then cannot
 * read, so `{f()}` is blind (limit 13). What it cannot follow is listed below,
 * measured.
 *
 * Two strictnesses, because attributes carry two different kinds of value. An
 * attribute whose only job is to be read — `label`, `title`, `alt`, `noun`,
 * `help` — is held to any word at all. Every other attribute carries machine
 * values here (`active="compile"`, `protocols={['https:']}`, `paths={[…]}`) and
 * is held to PROSE: two words with a space between them, which no identifier
 * has.
 *
 * WHAT THIS PROBE DOES NOT SEE. Every line below was RUN against an inline
 * fixture with a control alongside it — a file-local `const`, which the probe
 * reads — so each one is a measurement, not a suspicion.
 *
 * THIS LIST IS MEASURED, NOT COMPLETE, and the difference is the whole lesson
 * here. Its first version named ONE limit and called that the list. Its second
 * named seven and said "the probe's named limits are seven": nine more were
 * found the same day, by rerunning the same fixtures against the SHIPPED probe.
 * A count of blind spots is a claim about what nobody has looked for yet, and
 * that claim cannot be measured — so it is not made. What is claimed is that
 * each entry below has a measurement, and that the reach is wider than any of
 * them costs today, which IS measurable and is measured.
 *
 * DRAWN, THEN DISCARDED
 *   1. A single English word in an attribute nobody listed as copy. The probe
 *      draws it; PROSE then drops it, because every unlisted attribute in this
 *      console carries machine values. `COPY_ATTRIBUTES` closes this one name
 *      at a time.
 *
 * A NAME IT CANNOT RESOLVE TO A DECLARATION IT READS. `declarationsIn` reads
 * `const`/`let`/`var` with an initializer and a plain identifier for a name, and
 * `function` declarations. Everything else is a name with nothing behind it:
 *   2. An object SPREAD: `{ ...BASE }` carries none of `BASE`'s properties.
 *   3. ARRAY destructuring: `const [first] = ROWS` resolves to nothing.
 *   4. OBJECT destructuring: `const { reason } = NOTE` likewise — the binding
 *      name is not an identifier declaration the resolver can see.
 *   5. A SHORTHAND property: `const reason = '…'; const N = { reason }` — the
 *      object reader handles `PropertyAssignment` only.
 *   6. A COMPUTED key: `{ [K]: '…' }` has no name to match a property against.
 *   7. A `let` REASSIGNED after its declaration — only the initializer is read,
 *      so `let msg = 'x'; msg = '<sentence>'` reports `x`, which is to say
 *      precisely not the value that reaches the screen.
 *   8. A CALLBACK PARAMETER: `ROWS.map((row) => <li>{row.note}</li>)` follows
 *      what `fn` returns but not `row`.
 *   9. A function PARAMETER, its default value, and an API response — none of
 *      the three is provable from this file.
 *  10. A MODULE BOUNDARY: an imported binding is another file's value.
 *  11. A CLASS member, a static member, or a namespace member.
 *  12. An object METHOD in shorthand (`{ note() { … } }`) or a getter.
 *  13. A call to an ARROW-FUNCTION const: `const f = () => '…'; {f()}`. The
 *      resolver reaches the arrow function and has no branch for it.
 *
 * A CALL OR EXPRESSION FORM IT DOES NOT FOLLOW
 *  14. `Array#join`, and `filter`/`slice`/`sort`/`concat`/`flat` chains —
 *      `ELEMENT_OF` knows `find`, `at`, `pop` and `shift`.
 *  15. TEMPLATE INTERPOLATION: only the literal parts are read, never the
 *      values interpolated between them.
 *  16. `for (const row of ROWS)`.
 *  17. `Object.values`/`Object.entries`, and `Map#get`.
 *  18. A hard DEPTH limit (`depth > 12`). Eleven links of `const` to `const`
 *      still resolve; the twelfth returns nothing — silently, with no report
 *      that a chain was abandoned rather than exhausted.
 *
 * WHAT THE LIMITS COST TODAY — measured against the real tree, which is the only
 * number here that can be measured, and the reason these are named rather than
 * closed:
 *   • Closing 4, 14 and 15 together turns up exactly 4 further strings, and all
 *     4 are FALSE: shell.tsx:921 and :922, `Reader access` and `Site settings`,
 *     reached through the `items` and `open` props of NavBlock. What is drawn
 *     there is `t(NAV_KEYS[to])`; the `label` field is an internal identifier
 *     that never reaches the screen.
 *   • Closing 8 turns up 28, and all 28 are machine identifiers from
 *     compositions.tsx:351 and body.tsx:133 — `portrait`, `hero`,
 *     `code-example`, `data-table`.
 *   • Closing 13 turns up nothing at all.
 * So the console hides no copy behind these limits today. That is a statement
 * about this tree on this day, and it is re-measurable; it is not a statement
 * that the list below has an end.
 *
 * The probe reports what it can prove from this file, never what it suspects.
 */
const LETTERS = /[A-Za-zÄÖÜäöüß]/

/** Two words with a space between them — copy, as opposed to an identifier. */
const PROSE = /[A-Za-zÄÖÜäöüß]{2,}[^\S\n]+\S*[A-Za-zÄÖÜäöüß]/

/** Attributes whose only job is to be read, so any word in one is copy. */
const COPY_ATTRIBUTES = new Set([
  'label',
  'unsetLabel',
  'emptyLabel',
  'title',
  'alt',
  'placeholder',
  'help',
  'about',
  'hint',
  'noun',
  'tooltip',
  'summary',
  'caption',
  'legend',
  'heading',
  'forbidMessage',
  'confirmLabel',
  'cancelLabel',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
])

/** `aria-*` attributes a screen reader speaks, as opposed to state it reports. */
const ANNOUNCED_ARIA = new Set([
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
])

/**
 * Values that are not copy: protocol names, product names, unit symbols and
 * machine identifiers a reader is meant to see verbatim. They are the same
 * string in both languages by nature, so a catalog key for them would be a key
 * to keep in step for nothing.
 */
const TECHNICAL = new Set([
  'SHA-256',
  'POST /v1/sites —',
  'KiB / 256 KiB',
  '#0f172a',
  'Inter, system-ui, sans-serif',
  'field_name',
  'HTTP',
  'MCP',
  'CK',
  'portfolio',
  'ms',
  'kB',
  'noreferrer noopener',
  'Google Analytics 4',
  'Google Chirp 3 HD',
  // The unit suffixes a remaining session is counted down in — `4h 12m`.
  'd',
  'h',
  'm',
  's',
])

/**
 * Copy this probe SEES and this repository has not fixed, by file and attribute.
 *
 * Every line is a finding with an id, which is the whole difference from the
 * blind spot this test used to have: a blind spot cannot be listed. Nothing goes
 * in here to make the suite green — it goes in here when the fix is somebody
 * else's decision to make.
 */
const RECORDED = new Map([
  [
    'src/pages/content.tsx:source',
    'LOCAL-CK-STARTVORLAGE-ENGLISCH — the starter markdown for a new document is English prose, including ' +
      '`locale: en`. Which language a new document starts in is the site default, not the console language, so ' +
      'this is a product decision rather than a missing catalog key.',
  ],
])

/** Instance methods that format against the runtime's locale unless told one. */
const TO_LOCALE = new Set(['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString'])

/** `Intl` constructors that do the same. */
const INTL_FORMATTERS = new Set([
  'NumberFormat',
  'DateTimeFormat',
  'RelativeTimeFormat',
  'ListFormat',
  'PluralRules',
  'Collator',
])

/** Array methods whose result is an element of the receiver. */
const ELEMENT_OF = new Set(['find', 'at', 'pop', 'shift'])

function parse(file: string, source = readFileSync(file, 'utf8')): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function lineOf(parsed: ts.SourceFile, node: ts.Node): number {
  return parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1
}

interface DrawnValue {
  /** The literal the expression can carry to the screen. */
  text: string
  line: number
  /** The attribute it is drawn through, or `undefined` for a JSX child. */
  attribute?: string
}

/**
 * Every literal this file can draw, with how it gets drawn.
 *
 * Scope-aware on purpose: two components in one file both calling their result
 * `error` are two values, and resolving the name file-wide reported one of them
 * for the other's line.
 */
function drawnValues(parsed: ts.SourceFile): DrawnValue[] {
  const declarationsIn = (scope: ts.SourceFile | ts.Block | ts.ModuleBlock | ts.CaseClause, name: string): ts.Node[] => {
    const found: ts.Node[] = []
    for (const statement of scope.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) {
            found.push(declaration.initializer)
          }
        }
      }
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name && statement.body) {
        found.push(statement.body)
      }
    }
    return found
  }

  const resolve = (identifier: ts.Identifier): ts.Node[] => {
    for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
      if (ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope) || ts.isCaseClause(scope)) {
        const found = declarationsIn(scope, identifier.text)
        if (found.length > 0) return found
      }
    }
    return []
  }

  const returnsOf = (body: ts.Node): ts.Node[] => {
    if (!ts.isBlock(body)) return [body]
    const found: ts.Node[] = []
    const walk = (node: ts.Node): void => {
      if (ts.isReturnStatement(node) && node.expression) found.push(node.expression)
      // Not into a nested function: its returns are its own value, not this one's.
      if (!ts.isFunctionDeclaration(node) && !ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) {
        ts.forEachChild(node, walk)
      }
    }
    ts.forEachChild(body, walk)
    return found
  }

  const literals = (node: ts.Node | undefined, property: string | undefined, depth: number, seen: Set<string>): string[] => {
    if (!node || depth > 12) return []
    const mark = `${node.pos}:${node.end}:${property ?? ''}`
    if (seen.has(mark)) return []
    seen.add(mark)
    const into = (next: ts.Node | undefined, key?: string) => literals(next, key, depth + 1, seen)
    const through = (nodes: ts.Node[], key: string | undefined) =>
      nodes.flatMap((node) => (ts.isBlock(node) ? returnsOf(node).flatMap((value) => into(value, key)) : into(node, key)))

    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
      return into(node.expression, property)
    }
    // A string reached while looking for a property is the object, not the property.
    if (ts.isStringLiteralLike(node)) return property ? [] : [node.text]
    if (ts.isTemplateExpression(node)) {
      return property ? [] : [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
    }
    if (ts.isIdentifier(node)) return through(resolve(node), property)
    if (ts.isPropertyAccessExpression(node)) return into(node.expression, node.name.text)
    if (ts.isElementAccessExpression(node)) return into(node.expression, property)
    if (ts.isConditionalExpression(node)) return [...into(node.whenTrue, property), ...into(node.whenFalse, property)]
    if (ts.isBinaryExpression(node)) return [...into(node.left, property), ...into(node.right, property)]
    if (ts.isObjectLiteralExpression(node)) {
      return node.properties.flatMap((assignment) => {
        if (!ts.isPropertyAssignment(assignment)) return []
        const name =
          ts.isIdentifier(assignment.name) || ts.isStringLiteralLike(assignment.name) ? assignment.name.text : undefined
        return property && name !== property ? [] : into(assignment.initializer)
      })
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((element) => into(element, property))
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee)) {
        // The catalog answers for itself; its keys are checked by the test above.
        if (callee.text === 't' || callee.text === 'translate') return []
        return through(resolve(callee), property)
      }
      if (ts.isPropertyAccessExpression(callee)) {
        if (ELEMENT_OF.has(callee.name.text)) return into(callee.expression, property)
        if (callee.name.text === 'map' || callee.name.text === 'flatMap') {
          const mapper = node.arguments[0]
          if (mapper && (ts.isArrowFunction(mapper) || ts.isFunctionExpression(mapper))) {
            return returnsOf(mapper.body).flatMap((value) => into(value, property))
          }
        }
      }
      return []
    }
    return []
  }

  const drawn: DrawnValue[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      drawn.push({ text: node.text, line: lineOf(parsed, node) })
    }
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      for (const text of literals(node.expression, undefined, 0, new Set())) {
        drawn.push({ text, line: lineOf(parsed, node) })
      }
    }
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(parsed)
      const presentational =
        name === 'className' || name.startsWith('data-') || (name.startsWith('aria-') && !ANNOUNCED_ARIA.has(name))
      if (!presentational) {
        const carried = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer
        for (const text of literals(carried, undefined, 0, new Set())) {
          drawn.push({ text, line: lineOf(parsed, node), attribute: name })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return drawn
}


describe('cockpit i18n', () => {
  it('keeps the English and German catalogs structurally identical', () => {
    expect(Object.keys(CATALOGS.de).sort()).toEqual(Object.keys(CATALOGS.en).sort())
    const placeholders = (value: string) => [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort()
    for (const key of Object.keys(CATALOGS.en) as (keyof typeof CATALOGS.en)[]) {
      expect(placeholders(CATALOGS.de[key]), key).toEqual(placeholders(CATALOGS.en[key]))
      expect(translate('en', key), key).not.toBe(key)
      expect(translate('de', key), key).not.toBe(key)
    }
  })

  it('reads JSX text, JSX expressions and attributes alike', () => {
    // The reach itself, asserted rather than assumed. Narrowing the probe back
    // to `ts.isJsxText` — which is what it read while nine English sentences and
    // an English release label stood on the German console — turns this red
    // before any real file is looked at (LOCAL-CK-I18N-SONDE-SIEHT-NUR-JSXTEXT).
    const source = `
      const MIXED = [{ label: 'Overview', reason: 'the dashboard is site-governed' }]
      function note() {
        return { reason: MIXED.find((entry) => entry.label === 'Overview')?.reason }
      }
      export function View() {
        return (
          <div title="A raw title" data-testid="not-copy" className="flex gap-2">
            Raw text
            {note().reason}
          </div>
        )
      }
    `
    const drawn = drawnValues(parse('probe.tsx', source))
    const carried = drawn.map((hit) => hit.text.trim())
    expect(carried, 'JSX text').toContain('Raw text')
    expect(carried, 'a JSX expression, five hops from its literal').toContain('the dashboard is site-governed')
    expect(carried, 'an attribute outside any four-name list').toContain('A raw title')
    // Chrome is not copy, and reporting it would drown the copy that is.
    expect(carried, 'a testid is not drawn').not.toContain('not-copy')
    expect(carried, 'a class list is not drawn').not.toContain('flex gap-2')
  })

  it('keeps every value that reaches the screen in the catalogs', () => {
    const offenders: string[] = []

    for (const file of globSync('src/**/*.tsx').filter((entry) => !entry.endsWith('.test.tsx'))) {
      const parsed = parse(file)
      const drawn = drawnValues(parsed)
      for (const hit of drawn) {
        const copy = hit.text.replace(/\s+/g, ' ').trim()
        if (!copy || !LETTERS.test(copy)) continue
        if (TECHNICAL.has(copy)) continue
        if (RECORDED.has(`${file}:${hit.attribute ?? ''}`)) continue
        const strict = hit.attribute === undefined || COPY_ATTRIBUTES.has(hit.attribute)
        if (!strict && !PROSE.test(hit.text)) continue
        offenders.push(`${file}:${hit.line} ${hit.attribute ? `raw ${hit.attribute}` : 'raw JSX'}: ${copy}`)
      }
    }

    expect([...new Set(offenders)]).toEqual([])
  })

  it('formats every date, time and number against a locale it was told', () => {
    const offenders: string[] = []

    for (const file of globSync('src/**/*.{ts,tsx}').filter((entry) => !/\.test\.tsx?$/.test(entry))) {
      const parsed = parse(file)
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.arguments.length === 0) {
          const callee = node.expression
          if (ts.isPropertyAccessExpression(callee) && TO_LOCALE.has(callee.name.text)) {
            offenders.push(`${file}:${lineOf(parsed, node)} ${callee.name.text}() with no locale`)
          }
        }
        if (ts.isNewExpression(node) && (node.arguments === undefined || node.arguments.length === 0)) {
          const callee = node.expression
          if (
            ts.isPropertyAccessExpression(callee) &&
            callee.expression.getText(parsed) === 'Intl' &&
            INTL_FORMATTERS.has(callee.name.text)
          ) {
            offenders.push(`${file}:${lineOf(parsed, node)} new Intl.${callee.name.text}() with no locale`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(parsed)
    }

    expect(offenders).toEqual([])
  })

  it('interpolates translated values without changing unknown placeholders', () => {
    expect(translate('de', 'page.overview.description', { site: 'Beispiel' })).toContain('Beispiel')
  })

  it('degrades a key the catalog does not carry instead of throwing', () => {
    // The catalogs are complete and TranslationKey is derived from EN, so this
    // can only be reached through a cast — which is precisely how the console
    // lost the whole Entscheidungen page once (LOCAL-CK-ART-UNBEKANNT). §2 lets
    // the console admit what it does not know; it does not let it leave.
    const missing = 'decisions.kind.spam_review' as keyof typeof CATALOGS.en
    expect(() => translate('de', missing)).not.toThrow()
    expect(translate('de', missing)).toBe(missing)
  })

  it('resolves supported browser languages and falls back to English', () => {
    expect(resolveLocale(['fr-FR', 'de-DE'])).toBe('de')
    expect(resolveLocale(['fr-FR'])).toBe('en')
  })

  it('supports auto detection, manual choice and external storage changes', () => {
    let stored: string | null = null
    let languages = ['de-DE']
    let applied = ''
    let systemChange: () => void = () => undefined
    let storageChange: () => void = () => undefined
    const store = createLocaleStore({
      read: () => stored,
      write: (_key, value) => { stored = value },
      remove: () => { stored = null },
      languages: () => languages,
      apply: (locale) => { applied = locale },
      watchSystem: (listener) => { systemChange = listener; return () => undefined },
      watchStorage: (listener) => { storageChange = listener; return () => undefined },
    })

    expect(store.snapshot()).toEqual({ preference: 'auto', locale: 'de' })
    store.set('en')
    expect(stored).toBe('en')
    expect(store.snapshot()).toEqual({ preference: 'en', locale: 'en' })
    languages = ['de-DE']
    systemChange()
    expect(applied).toBe('en')
    stored = 'de'
    storageChange()
    expect(store.snapshot()).toEqual({ preference: 'de', locale: 'de' })
    store.set('auto' as LocalePreference)
    expect(stored).toBeNull()
    expect(applied).toBe('de')
    expect(LOCALE_STORAGE_KEY).toBe('ck-cockpit-locale')
  })
})
