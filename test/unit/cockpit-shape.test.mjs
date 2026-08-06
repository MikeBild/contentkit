import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * What shape a new page in this console has, asserted rather than described.
 *
 * UI-UX.md §1 names a container ladder, §2 names one primary action per surface
 * and §5 names four states. A review measured what those cost when nothing holds
 * them: eleven mutations were applied to the console and seven survived a green
 * suite. Every one of the seven was in a rule the last pass had *restructured*
 * and not written a test for — the tab strips, the loading branches, the
 * per-surface primaries. The two rules that killed their mutations were the two
 * with test files behind them, which is this file's whole argument: an author
 * starting a page today has to choose between DataTable and Card+Table, between
 * Tabs and a stack of cards, with nothing to hold them to either answer.
 *
 * So these are §1's five mechanical questions, one suite each, and each suite
 * names the mutation it was written to kill:
 *
 *   1. One module, one page.                              (authoring.tsx, governance.tsx)
 *   2. The container ladder is countable.                 (forty-one cards on one page)
 *   3. A tab strip is reachable.                          (M9, M11)
 *   4. One primary per surface, in both directions.       (M1)
 *   5. Loading is a Skeleton.                             (M10)
 *
 * Read as text, like every other Cockpit assertion in test/unit: the console has
 * no runner Node can import JSX with, and test/unit/cockpit-behavioural-floor.test.mjs
 * says out loud which contracts are graded by reading source rather than by
 * rendering, so a runner in the repository is never mistaken for coverage.
 *
 * Nothing here reads a build artefact; only committed source.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const cockpit = join(root, 'apps', 'cockpit', 'src')
const pagesDir = join(cockpit, 'pages')

/**
 * Comments out, line numbers kept.
 *
 * Every page in this console argues for its own shape in a comment beside it —
 * access.tsx spends eighteen lines saying why it is not a tab strip — so an
 * assertion that read the prose would pass on the explanation of the defect
 * rather than on its absence. Blanking rather than deleting keeps every reported
 * line number the one the author will open. `[^:]` before `//` keeps `https://`.
 */
const blank = (text) =>
  text
    .replaceAll(/\/\*[\s\S]*?\*\//g, (match) => match.replaceAll(/[^\n]/g, ' '))
    .replaceAll(/(^|[^:])\/\/.*$/gm, (match, keep) => keep + ' '.repeat(match.length - keep.length))

/**
 * The source as elements rather than as lines.
 *
 * Prettier breaks one opening tag across as many lines as it has attributes and
 * closes it with a lone `>` at the tag's own indent, so `<Tabs`, its six props
 * and its `tabs={[…]}` array are one element written over thirty lines. Every
 * question below — what is this element, what are its props, what is its parent
 * — is a question about the element, so the lines are rejoined into one logical
 * line first and each keeps the number of the line it starts on.
 */
function elements(source) {
  const raw = blank(source).split('\n')
  const out = []
  for (let index = 0; index < raw.length; index++) {
    if (!raw[index].trim()) continue
    const indent = raw[index].match(/^\s*/)[0].length
    const start = index
    let text = raw[index].trim()
    // An opening tag is spread over several lines exactly when its own line
    // holds no `>` at all: `<Card className="py-0">` is complete, `<Tabs` is not.
    if (/^<[A-Za-z]/.test(text) && !text.includes('>')) {
      const parts = [text]
      let scan = index + 1
      for (; scan < raw.length && scan < index + 400; scan++) {
        parts.push(raw[scan].trim())
        if (raw[scan].match(/^\s*/)[0].length === indent && /^\/?>/.test(raw[scan].trim())) break
      }
      text = parts.join(' ').replaceAll(/\s+/g, ' ')
      index = scan
    }
    out.push({ no: start + 1, indent, text })
  }
  return out
}

const read = (module) => readFileSync(join(pagesDir, module), 'utf8')

/** Every routed page module, which is every `.tsx` in pages/ that is not a test. */
const MODULES = readdirSync(pagesDir)
  .filter((name) => /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name))
  .sort()

const SOURCES = new Map(MODULES.map((module) => [module, read(module)]))
const ELEMENTS = new Map(MODULES.map((module) => [module, elements(SOURCES.get(module))]))
const ROUTER = readFileSync(join(cockpit, 'router.tsx'), 'utf8')

/** `<Card>` and every component whose name says it is one. Not `<CardHeader>`. */
const IS_CARD = /^<(?:Card|[A-Z]\w*Card)\b/
/** An element that can hold children — so not a closing tag, not self-closing. */
const IS_CONTAINER = (text) => /^<[A-Za-z]/.test(text) && !/^<\//.test(text) && !/\/>$/.test(text)

// ---------------------------------------------------------------------------
// 1. One module, one page.
// ---------------------------------------------------------------------------

describe('one module, one page', () => {
  /*
   * The rule that would have caught both buckets before anyone measured them.
   *
   * `authoring.tsx` held five compliant pages already mounted at five routes,
   * and `governance.tsx` held five more. Every measurement anyone took read the
   * module, so ten good pages measured as two bad ones — which is precisely how
   * the defect survived being looked at twice. Both are now five files each, and
   * this is the assertion that keeps it that way for the fourteen that were
   * never in a bucket as much as for the ten that were.
   */
  for (const module of MODULES) {
    test(`pages/${module} exports exactly one page, and the router mounts it`, () => {
      const source = blank(SOURCES.get(module))
      const exported = [...source.matchAll(/^export\s+(?:function|const)\s+([A-Za-z_$][\w$]*)/gm)].map(
        (match) => match[1],
      )
      assert.equal(
        exported.length,
        1,
        `pages/${module} exports ${exported.length} symbols (${exported.join(', ')}) — a page module exports its ` +
          'page and nothing else, or five good pages measure as one bad page again',
      )
      const [component] = exported

      // The one export is a page: it renders the heading.
      assert.match(
        source,
        /<Page[\s\n]/,
        `pages/${module} exports ${component}, which renders no <Page> — a fragment mounted at a route is not a page`,
      )

      // And the router agrees, from this module, once.
      const specifier = module.replace(/\.tsx$/, '')
      const imports = [...ROUTER.matchAll(new RegExp(`import \\{ ([\\w$]+) \\} from '@/pages/${specifier}'`, 'g'))]
      assert.deepEqual(
        imports.map((match) => match[1]),
        [component],
        `router.tsx must import exactly ${component} from @/pages/${specifier}`,
      )
      const mounts = [...ROUTER.matchAll(new RegExp(`\\['[^']*', ${component}\\]`, 'g'))]
      assert.equal(mounts.length, 1, `${component} must be mounted at exactly one route`)
    })
  }

  test('a second page in one module is the bucket coming back', () => {
    // Stated as a whole-directory count so the failure names the arithmetic:
    // sixteen modules, sixteen routed components, sixteen routes.
    const routes = [...ROUTER.matchAll(/\['\/[^']*', ([\w$]+)\]/g)].map((match) => match[1])
    assert.equal(
      routes.length,
      MODULES.length,
      `router.tsx mounts ${routes.length} pages from ${MODULES.length} modules in pages/ — the two numbers are the ` +
        'same number, or a module is holding more than one page again',
    )
    assert.deepEqual([...new Set(routes)].sort(), routes.slice().sort(), 'no page component is mounted at two routes')
  })
})

// ---------------------------------------------------------------------------
// 2. The container ladder is countable.
// ---------------------------------------------------------------------------

/**
 * The most sibling cards one parent may hold before the page is a stack of boxes.
 *
 * Three, and the number is read off the console rather than chosen for it. The
 * deepest stack anywhere in pages/ is three, and exactly three pages reach it:
 *
 *   access.tsx  — Readers, Rules, Groups, and eighteen lines saying why they are
 *                 not tabs (one panel's control opens the other panel's record).
 *   releases.tsx — the in-flight banner, Previews, the release table.
 *   system.tsx  — Process, Maintenance, the dev-only field gallery.
 *
 * So three is the tight bound, not a comfortable one: the next card added to any
 * of those three fails this test, which is the point. Four would have slack
 * nothing in the console could ever take up — the "does not pick a number that
 * passes trivially" failure — and two would condemn three pages that argue their
 * shape in source, and would contradict access.tsx's deliberate three.
 *
 * Three is also where the ladder's own words start to bite: Tabs are for "2–6
 * parallel concerns", so a fourth sibling card is a page sitting squarely inside
 * the band the ladder names Tabs for and declining it.
 *
 * §1's phrasing is "more than N sibling cards **and no Tabs and no Accordion**".
 * That clause is structural here rather than a flag: cards are counted per
 * parent, and adopting Tabs or an Accordion is exactly what moves them under
 * different parents. A decorative strip somewhere else on the page therefore
 * buys nothing, which is the reading that means something.
 */
const CARD_STACK_LIMIT = 3

/** Every group of sibling cards in a module, deepest first. */
function cardStacks(module) {
  const open = []
  const stacks = new Map()
  let component = '(module)'
  for (const element of ELEMENTS.get(module)) {
    if (element.indent === 0) {
      open.length = 0
      const declared = element.text.match(/^(?:export )?function ([A-Za-z_$][\w$]*)/)
      if (declared) component = declared[1]
    }
    while (open.length && open.at(-1).indent >= element.indent) open.pop()
    if (IS_CARD.test(element.text)) {
      const parent = [...open].reverse().find((entry) => entry.container)
      const key = `${component} › ${parent ? `line ${parent.no} ${parent.text.slice(0, 48)}` : 'the page body'}`
      stacks.set(key, [...(stacks.get(key) ?? []), element])
    }
    open.push({ indent: element.indent, container: IS_CONTAINER(element.text), no: element.no, text: element.text })
  }
  return [...stacks.entries()]
    .map(([parent, cards]) => ({ parent, cards }))
    .sort((a, b) => b.cards.length - a.cards.length)
}

describe('the container ladder is countable', () => {
  for (const module of MODULES) {
    test(`pages/${module} stacks at most ${CARD_STACK_LIMIT} cards under one parent`, () => {
      for (const stack of cardStacks(module)) {
        assert.ok(
          stack.cards.length <= CARD_STACK_LIMIT,
          `pages/${module} stacks ${stack.cards.length} sibling cards under ${stack.parent} — ` +
            `${stack.cards.map((card) => `${card.text.match(/^<([A-Z]\w*)/)[1]} (line ${card.no})`).join(', ')}. ` +
            `More than ${CARD_STACK_LIMIT} boxes in a column is the shape UI-UX.md §1 exists to correct: take the ` +
            "ladder's second step (Tabs, for 2–6 parallel concerns the reader looks at one at a time) or its " +
            "fourth (Accordion, for many sections most of which stay shut) — unless one panel's controls act on " +
            "another panel's content, in which case say so where access.tsx says it.",
        )
      }
    })
  }

  test('and three is the tight bound, not a comfortable one', () => {
    // If this ever reads 2, the limit has gone slack and should come down with
    // the console rather than be left as a number nothing can reach.
    const deepest = MODULES.map((module) => ({ module, depth: cardStacks(module)[0]?.cards.length ?? 0 })).sort(
      (a, b) => b.depth - a.depth,
    )
    assert.equal(
      deepest[0].depth,
      CARD_STACK_LIMIT,
      `the deepest card stack in pages/ is ${deepest[0].depth} (${deepest[0].module}) but the limit is ` +
        `${CARD_STACK_LIMIT} — a limit no page can reach is a limit that passes trivially`,
    )
  })
})

// ---------------------------------------------------------------------------
// 3. A tab strip is reachable.
// ---------------------------------------------------------------------------

/**
 * Every tab strip in pages/, and the panels it promises.
 *
 * A review made one strip inert and cut a five-view detail to one view, and 982
 * tests passed both times. The ids are pinned here rather than merely
 * cross-checked, because a strip and its panels can be cut together and stay
 * internally consistent — a five-view reader reduced to one view is a coherent
 * component and a lost feature.
 */
const STRIPS = {
  'compositions.tsx': { testId: 'composition-tabs', ids: ['compile', 'patterns', 'guides'] },
  'content.tsx': { testId: 'content-tabs', ids: ['editor', 'revisions', 'audio', 'live'] },
  'credentials.tsx': { testId: 'ck-credentials-tabs', ids: ['keys', 'grants'] },
  'moderation.tsx': { testId: 'ck-moderation-tabs', ids: ['comments', 'contact', 'feedback'] },
  'published.tsx': { testId: 'published-tab', ids: ['rendered', 'markdown', 'semantic', 'diagnostics', 'composition'] },
  'webhooks.tsx': { testId: 'ck-webhook-tabs', ids: ['endpoints', 'deliveries'] },
}

/** The tabs a strip offers: written inline, or in a module-level `as const` array. */
function declaredTabs(module, strip) {
  const inline = strip.text.match(/tabs=\{\[([\s\S]*)\]\}/)
  if (inline) return [...inline[1].matchAll(/\bid: '([^']+)'/g)].map((match) => match[1])
  const named = strip.text.match(/tabs=\{([A-Za-z_$][\w$]*)\}/)
  assert.ok(named, `the ${module} strip must declare its tabs`)
  const array = blank(SOURCES.get(module)).match(new RegExp(`const ${named[1]} = \\[([\\s\\S]*?)\\] as const`))
  assert.ok(array, `pages/${module} names its tabs ${named[1]}, which is not a module-level array in this file`)
  return [...array[1].matchAll(/\bid: '([^']+)'/g)].map((match) => match[1])
}

/** The tabs a page actually answers to, whether written out or mapped over. */
function answeredTabs(module, state) {
  const list = ELEMENTS.get(module)
  const answered = []
  list.forEach((element, index) => {
    if (!/^<TabPanel\b/.test(element.text)) return
    assert.match(
      element.text,
      /data-testid=/,
      `pages/${module} line ${element.no}: every panel is addressable — §8 is a standing project requirement`,
    )
    const literal = element.text.match(new RegExp(`active=\\{${state} === '([^']+)'\\}`))
    if (literal) {
      answered.push({ id: literal[1], at: element.no })
      return
    }
    // `{(['markdown', 'semantic', 'diagnostics'] as const).map((view) => (` —
    // three panels written once. The ids are in the array being mapped.
    const variable = element.text.match(new RegExp(`active=\\{${state} === ([A-Za-z_$][\\w$]*)\\}`))
    assert.ok(variable, `pages/${module} line ${element.no}: a panel must say which tab shows it`)
    const loop = list
      .slice(0, index)
      .reverse()
      .find((line) => line.text.includes(`.map((${variable[1]})`))
    assert.ok(
      loop,
      `pages/${module} line ${element.no}: the panel is shown for '${variable[1]}', which nothing in this file maps over`,
    )
    for (const [, id] of loop.text.matchAll(/'([^']+)'/g)) answered.push({ id, at: element.no })
  })
  return answered
}

describe('a tab strip is reachable', () => {
  test('every page that uses tabs uses the console’s strip, never its own', () => {
    for (const module of MODULES) {
      const source = blank(SOURCES.get(module))
      if (!/<Tabs\b/.test(source)) {
        assert.doesNotMatch(
          source,
          /role="tablist"/,
          `pages/${module} rolls its own tab strip — ←/→, aria-selected and the roles are re-invented per page`,
        )
        continue
      }
      assert.match(
        source,
        /import \{[^}]*\bTabs\b[^}]*\} from '@\/components\/ui\/tabs'/,
        `pages/${module} must take Tabs from @/components/ui/tabs`,
      )
    }
  })

  test('a panel announces itself and stays mounted', () => {
    // M2 removed this and 982 tests passed. It is asserted here rather than only
    // where the five split pages assert it, because every strip in pages/ leans
    // on it: a hidden panel keeps a half-typed filter and a scroll position.
    const tabs = readFileSync(join(cockpit, 'components', 'ui', 'tabs.tsx'), 'utf8')
    assert.match(tabs, /role="tabpanel"/, 'a panel with no role is a div: nothing pairs it with the tab that shows it')
    assert.match(tabs, /hidden=\{!active\}/, 'and it is hidden rather than unmounted')
    assert.match(tabs, /role="tablist"/)
    assert.match(tabs, /role="tab"/)
    assert.match(tabs, /aria-selected=\{active\}/)
  })

  test('pages/ has exactly the strips this file knows about', () => {
    const found = MODULES.filter((module) => /<Tabs\b/.test(blank(SOURCES.get(module))))
    assert.deepEqual(
      found,
      Object.keys(STRIPS).sort(),
      'a new tab strip is pinned here with its tabs, or the next review can cut it to one tab unnoticed',
    )
  })

  for (const [module, pinned] of Object.entries(STRIPS)) {
    test(`pages/${module}: the ${pinned.testId} strip drives every panel it promises`, () => {
      const strip = ELEMENTS.get(module).find(
        (element) => /^<Tabs\b/.test(element.text) && element.text.includes(`data-testid="${pinned.testId}"`),
      )
      assert.ok(strip, `pages/${module} must carry a strip addressable as ${pinned.testId}`)

      // The strip offers exactly these tabs, in this order. M11 cut a five-view
      // reader to one view; this is the assertion that notices.
      const declared = declaredTabs(module, strip)
      assert.deepEqual(
        declared,
        pinned.ids,
        `${pinned.testId} offers ${declared.length} tabs (${declared.join(', ')}), and this page's reader is ` +
          `promised ${pinned.ids.length} (${pinned.ids.join(', ')})`,
      )

      // The strip writes the state the panels read. M9 made one inert — a strip
      // whose value never changes is a navigation that goes nowhere, and every
      // tab but the first becomes unreachable with nothing on screen to say so.
      const state = strip.text.match(/value=\{([A-Za-z_$][\w$]*)\}/)
      assert.ok(state, `${pinned.testId} must read the state its panels branch on`)
      const pair = blank(SOURCES.get(module)).match(
        new RegExp(`const \\[${state[1]}, ([A-Za-z_$][\\w$]*)\\] = useState`),
      )
      assert.ok(pair, `pages/${module}: ${state[1]} must be state, or the strip has nothing to write`)
      assert.match(
        strip.text,
        new RegExp(`onValueChange=\\{${pair[1]}\\}`),
        `${pinned.testId} must write ${state[1]} through ${pair[1]}: a strip whose handler does not set the state ` +
          `its panels read is inert, and ${pinned.ids.length - 1} of its ${pinned.ids.length} panels are unreachable`,
      )

      // Every tab has a panel, and every panel has a tab.
      const answered = answeredTabs(module, state[1])
      const answeredIds = answered.map((panel) => panel.id)
      const dead = declared.filter((id) => !answeredIds.includes(id))
      assert.deepEqual(
        dead,
        [],
        `${pinned.testId} offers ${dead.join(', ')}, which no panel in pages/${module} answers to — a tab that ` +
          'shows nothing is a dead end the reader can only find by pressing it',
      )
      const orphans = answered.filter((panel) => !declared.includes(panel.id))
      assert.deepEqual(
        orphans.map((panel) => `${panel.id} (line ${panel.at})`),
        [],
        `pages/${module} renders panels no tab selects — content that is in the DOM and cannot be reached`,
      )

      // And the page opens on one of its own tabs.
      const initial = blank(SOURCES.get(module)).match(
        new RegExp(`const \\[${state[1]}, ${pair[1]}\\] = useState<[^>]*>\\('([^']+)'\\)`),
      )
      assert.ok(
        initial && declared.includes(initial[1]),
        `pages/${module} opens on '${initial?.[1] ?? 'nothing'}', which is not one of its tabs`,
      )
    })
  }
})

// ---------------------------------------------------------------------------
// 4. One primary per surface, in both directions.
// ---------------------------------------------------------------------------

/**
 * The pages that legitimately have no primary of their own, and why each one is
 * not simply a page that lost it.
 *
 * §2 says `variant="default"` is "the thing this page exists for". A review
 * downgraded a page's only primary to `outline` and 982 tests passed, so the
 * upper bound alone — never two — was never the whole rule: a page with actions
 * and no primary is as wrong as one with two, and the only way to say that
 * mechanically is to name the pages where none is right.
 *
 * The list is an exact partition, asserted as one: a page that gains a primary
 * must leave it, and a page that loses one must join it in a visible edit to
 * this file. It is not a floor that a downgrade can quietly slide under.
 */
const PRIMARY_LESS = {
  // No control of its own at all. Every action on these pages belongs to a card
  // they mount, and a card is its own surface with its own primary — which is
  // why the page-level rule has nothing to say about them. Pinned to that fact:
  // the first <Button> written directly into one of these pages is a page-level
  // action row, and it needs a primary.
  'access.tsx': { because: 'no-controls' },
  'credentials.tsx': { because: 'no-controls' },
  'moderation.tsx': { because: 'no-controls' },
  'overview.tsx': { because: 'no-controls' },
  'webhooks.tsx': { because: 'no-controls' },

  // The page's one act is rendered by a component it mounts, so the primary
  // belongs to that component's surface and asserting it here would assert it
  // twice. Pinned to the mount, so the exemption dies with the delegation.
  'sites.tsx': { because: 'delegated', to: 'CreateSiteWizard' },
  'site-settings.tsx': { because: 'delegated', to: 'SaveBar' },

  // A reader. Nothing on the page is "the thing it exists for" because the page
  // exists to show, not to change: audit is a log with a filter and a row
  // expander, published is a viewer with an inspector. Pinned to that: every
  // control on these two is a disclosure or a dismissal, so the moment one of
  // them gains a mutation it is no longer a reader and the exemption fails.
  'audit.tsx': { because: 'read-only' },
  'published.tsx': { because: 'read-only' },
  // Profile shows the session it is looking at and changes nothing about it.
  // Every account setting ContentKit has is decided at sign-in by the identity
  // provider, so there is deliberately no control here to be primary — and the
  // moment one appears, this page has started changing something and the
  // exemption should fail.
  'profile.tsx': { because: 'read-only' },

  // Two scheduled jobs, run by hand only when you know why — the page says so
  // in its own words. One of them is irreversible and is `destructive`; the
  // other is deliberately not promoted beside it, because "the thing this page
  // exists for" is the liveness reading above them, which is not a button.
  'system.tsx': { because: 'maintenance' },
}

/**
 * Every opening `<Name …>` tag in a file, however it is laid out.
 *
 * Not the line-based reader above: a page's primary is usually written into the
 * `actions={…}` slot of its own `<Page>` tag, so `content-new`, `audio-backfill`
 * and `release-build` are all *inside* another element's attributes and no line
 * of the file begins with them. Braces are counted so that `onClick={() => …}`
 * does not end the tag at its arrow.
 */
function openingTags(source, name) {
  const out = []
  for (const match of source.matchAll(new RegExp(`<${name}\\b`, 'g'))) {
    let depth = 0
    let quote = null
    let end = -1
    for (let index = match.index + match[0].length; index < source.length; index++) {
      const char = source[index]
      if (quote) {
        if (char === quote) quote = null
        continue
      }
      if (char === '"' || char === "'" || char === '`') quote = char
      else if (char === '{') depth += 1
      else if (char === '}') depth -= 1
      else if (char === '>' && depth === 0) {
        end = index
        break
      }
    }
    if (end < 0) continue
    out.push({
      at: source.slice(0, match.index).split('\n').length,
      text: source.slice(match.index, end + 1).replaceAll(/\s+/g, ' '),
    })
  }
  return out
}

/** Every `<Button>` written directly into a page module, with its variant. */
function buttons(module) {
  return openingTags(blank(SOURCES.get(module)), 'Button').map((tag) => ({
    at: tag.at,
    variant: tag.text.match(/variant="([^"]+)"/)?.[1] ?? (/variant=\{/.test(tag.text) ? 'dynamic' : 'default'),
    testId: tag.text.match(/data-testid=[{"]`?([^"`}]+)/)?.[1] ?? '(none)',
  }))
}

describe('one primary per surface, in both directions', () => {
  test('no page carries two primaries', () => {
    for (const module of MODULES) {
      const primary = buttons(module).filter((button) => button.variant === 'default')
      assert.ok(
        primary.length <= 1,
        `pages/${module} has ${primary.length} filled buttons — ${primary
          .map((button) => `${button.testId} (line ${button.at})`)
          .join(', ')}. Two filled buttons side by side ask the reader to choose without saying which is which.`,
      )
    }
  })

  test('and no page quietly loses the one it had', () => {
    const without = MODULES.filter((module) => !buttons(module).some((button) => button.variant === 'default'))
    assert.deepEqual(
      without,
      Object.keys(PRIMARY_LESS).sort(),
      'the pages with no primary action are exactly the ones named in PRIMARY_LESS above, each with the reason it ' +
        'has none. A page that appears here without being named has had its primary downgraded to outline or ghost ' +
        '— the page still exists for something, and nothing on it says what.',
    )
  })

  for (const [module, exemption] of Object.entries(PRIMARY_LESS)) {
    test(`pages/${module} still has the reason it has no primary`, () => {
      const source = blank(SOURCES.get(module))
      const own = buttons(module)
      // Every exemption is one of four kinds, and each kind is checked below.
      // A fifth would be a page parked here with no argument, which is the one
      // way this list could become the thing it exists to prevent.
      assert.ok(
        ['no-controls', 'delegated', 'read-only', 'maintenance'].includes(exemption.because),
        `pages/${module} is exempt "because ${exemption.because}", which is not a reason this file checks`,
      )
      if (exemption.because === 'maintenance') {
        // The one page whose exemption is an argument rather than a structure,
        // so it is pinned to the two controls the argument is about.
        assert.deepEqual(
          own.map((button) => button.variant).sort(),
          ['destructive', 'outline'],
          'system.tsx is exempt because its two controls are scheduled jobs, one of them irreversible; a third ' +
            'control, or a different grammar, is a different page and needs the rule again',
        )
      }
      if (exemption.because === 'no-controls') {
        assert.deepEqual(
          own.map((button) => `${button.testId} (line ${button.at})`),
          [],
          `pages/${module} is exempt because it renders no controls of its own; it now renders some, so it has a ` +
            'page-level action row and one of them is what the page exists for',
        )
      }
      if (exemption.because === 'delegated') {
        assert.match(
          source,
          new RegExp(`<${exemption.to}\\b`),
          `pages/${module} is exempt because ${exemption.to} carries its primary; it no longer mounts it`,
        )
      }
      if (exemption.because === 'read-only') {
        // A reader's controls disclose and dismiss. `destructive` and `default`
        // are both changes, and either one means this is no longer a reader.
        const changes = own.filter((button) => ['default', 'destructive'].includes(button.variant))
        assert.deepEqual(
          changes.map((button) => `${button.testId} (line ${button.at})`),
          [],
          `pages/${module} is exempt as a reader, and now changes something — a page that acts has a primary`,
        )
      }
    })
  }

  test('the delegated primaries are real, and are one each', () => {
    // The exemption above says "the primary belongs to that component's
    // surface". This is that claim, checked across the file boundary, so
    // `delegated` cannot become a place to park a page that has none.
    const saveBar = openingTags(blank(readFileSync(join(cockpit, 'forms', 'save-bar.tsx'), 'utf8')), 'Button').filter(
      (tag) => !/variant=/.test(tag.text),
    )
    assert.equal(
      saveBar.length,
      1,
      'forms/save-bar.tsx is the primary of every settings page: Save is filled, Reset beside it is not',
    )
  })
})

// ---------------------------------------------------------------------------
// 5. Loading is a Skeleton.
// ---------------------------------------------------------------------------

/**
 * §5: loading is `Skeleton` in the shape of the result, never the word
 * "Loading…", which is one line high where the result is forty — and never
 * nothing at all, which is the empty state wearing the loading state's clothes.
 *
 * A review replaced a loading branch with `null` and 982 tests passed. What is
 * read here is every branch a page takes on a pending request *in render
 * position*, which is what a consequent beginning with `(`, `<`, `null` or
 * `undefined` means; `refetchInterval: … ? 3000 : false` and
 * `value={health.isPending ? 'checking' : …}` are not render branches and are
 * not read as ones.
 *
 * The one sanctioned consequent that is not a Skeleton is a `Spinner` inside a
 * button, which §2 requires: a button composes Spinner + disabled and leaves its
 * label alone. A whole panel may not.
 */
/** `build.isPending`, `tile.result?.isPending`, and the aliases a page gives them. */
const PENDING = '(?:[A-Za-z_$][\\w$]*[?.]+)*isPending'

function loadingBranches(module) {
  const source = blank(SOURCES.get(module))
  // `const loading = Boolean(itemId) && (item.isPending || revisions.isPending)`
  // is the same branch under another name, and content.tsx takes it.
  const aliases = [...source.matchAll(/const ([A-Za-z_$][\w$]*) = [^\n]*\.isPending[^\n]*/g)].map((match) => match[1])
  const test = `(${PENDING}${aliases.length ? `|(?:${aliases.join('|')})` : ''})`
  const found = []
  for (const match of source.matchAll(new RegExp(`(?<![\\w$])${test}\\s*\\?\\s*`, 'g'))) {
    const consequent = source.slice(match.index + match[0].length, match.index + match[0].length + 400)
    // Render position, and only render position: a consequent that is a number,
    // a string or a date is a computed value, not a state the reader sees.
    if (!/^(\(|<|null\b|undefined\b)/.test(consequent)) continue
    found.push({ test: match[1], line: source.slice(0, match.index).split('\n').length, consequent })
  }
  // `if (published.isPending) return (…)` is the same branch written as a guard.
  for (const match of source.matchAll(new RegExp(`if \\(([^)\\n]*${test}[^)\\n]*)\\)\\s*return\\s*\\(`, 'g'))) {
    found.push({
      test: match[1].trim(),
      line: source.slice(0, match.index).split('\n').length,
      consequent: source.slice(match.index + match[0].length, match.index + match[0].length + 400),
    })
  }
  return found
}

/** What the branch actually puts on screen, past the bracket prettier opened it with. */
const rendered = (consequent) =>
  consequent
    .replace(/^\(/, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?.slice(0, 70) ?? '(nothing)'

describe('loading is a Skeleton', () => {
  for (const module of MODULES) {
    test(`pages/${module} draws the shape of the result while it waits`, () => {
      for (const branch of loadingBranches(module)) {
        if (/^<Spinner\b/.test(branch.consequent)) continue
        assert.match(
          branch.consequent,
          /Skeleton/,
          `pages/${module} line ${branch.line}: \`${branch.test}\` branches on a pending request and renders no ` +
            `Skeleton — it renders \`${rendered(branch.consequent)}\`. §5: loading is a ` +
            'Skeleton in the shape of the result. `null` is the empty state, a sentence is one line where the ' +
            'result is forty, and a Spinner is a button’s busy state, not a panel’s.',
        )
      }
    })
  }

  test('a page that hands its loading state to a list hands it somewhere that owns a Skeleton', () => {
    // The other sanctioned answer: `isLoading={items.isPending}` on a DataTable
    // or a TableState, which draw skeleton rows in the table's own shape. This
    // is the assertion that the delegation is real, so a page is never graded
    // green for passing a flag to something that renders a sentence.
    for (const module of MODULES) {
      for (const element of ELEMENTS.get(module)) {
        if (!/isLoading=\{[^}]*(?:isPending|isLoading)/.test(element.text)) continue
        assert.match(
          element.text,
          /^<(?:DataTable|TableState)\b/,
          `pages/${module} line ${element.no} hands a pending flag to something that is not a DataTable or a ` +
            'TableState, so nothing promises a Skeleton at the other end',
        )
      }
    }
    for (const [file, owner] of [
      [join(cockpit, 'components', 'ui', 'data-table.tsx'), 'DataTable'],
      [join(cockpit, 'forms', 'table-state.tsx'), 'TableState'],
    ]) {
      assert.match(
        readFileSync(file, 'utf8'),
        /Skeleton/,
        `${owner} is where every list's loading state is delegated to, and it must be the one drawing the Skeleton`,
      )
    }
  })
})
