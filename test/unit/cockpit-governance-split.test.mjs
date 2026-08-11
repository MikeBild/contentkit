import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The five pages `governance.tsx` was, and the shape each of them got.
 *
 * `authoring.tsx` held five routed pages in one module and was split for a
 * reason this file exists to keep true of the second bucket: five good pages in
 * one module measure as one bad page, which is how the defect survived being
 * looked at. `governance.tsx` was the same thing — /access, /webhooks,
 * /moderation, /credentials and /audit, five `<Page>`s and five routes in one
 * file.
 *
 * What was unguarded after that pass, and is guarded here: the tab strips. A
 * review measured that a tab strip could be made inert, a panel could lose its
 * role, and a five-view detail could be cut to one view, with the whole suite
 * green. The strips below are therefore checked as a *mechanism* — every tab has
 * a panel, every panel is addressable, and the strip is wired to the state the
 * panels read — rather than as a count of `<Tabs` tags.
 *
 * Read as text, like every other Cockpit assertion in test/unit: the console has
 * no runner Node can import JSX with. The behavioural floor
 * (test/unit/cockpit-behavioural-floor.test.mjs) says so out loud rather than
 * letting this be mistaken for a rendering test.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const cockpit = join(root, 'apps', 'cockpit', 'src')

const read = (...parts) => readFileSync(join(cockpit, ...parts), 'utf8')
/** Comments out: every one of these pages documents the choice it made. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** The five routes, the module each is now in, and the component it mounts. */
const PAGES = [
  { to: '/access', module: 'access.tsx', component: 'AccessPage' },
  { to: '/webhooks', module: 'webhooks.tsx', component: 'WebhooksPage' },
  { to: '/moderation', module: 'moderation.tsx', component: 'ModerationPage' },
  { to: '/credentials', module: 'credentials.tsx', component: 'CredentialsPage' },
  { to: '/audit', module: 'audit.tsx', component: 'AuditPage' },
]

/**
 * The pages that got a tab strip, and the panels each strip promises.
 *
 * /access is deliberately not here — see the suite below, which asserts that it
 * is not a tab strip and says why.
 */
const TABBED = [
  { module: 'webhooks.tsx', strip: 'ck-webhook-tabs', panels: ['endpoints', 'deliveries'] },
  { module: 'moderation.tsx', strip: 'ck-moderation-tabs', panels: ['comments', 'contact', 'feedback'] },
  { module: 'credentials.tsx', strip: 'ck-credentials-tabs', panels: ['keys', 'grants'] },
]

/**
 * Every `data-testid` a page in this group is driven by, per module.
 *
 * scripts/verify-cockpit-prod.md walks the console by these names, so the split
 * had to move them and not one of them may be dropped on the way. Each is
 * written where it is *rendered*: a page's own controls here, a card's controls
 * in the form module the page mounts.
 */
const OWNED_TESTIDS = {
  'audit.tsx': [
    'ck-audit-site-filter',
    'ck-audit-action-filter',
    'ck-audit-limit-filter',
    'ck-audit-follow-site',
    'ck-audit-row',
    'ck-audit-expand',
    'ck-audit-detail',
  ],
}

describe('the five pages governance.tsx was', () => {
  test('one module exports one page, and governance.tsx is gone', () => {
    assert.ok(
      !existsSync(join(cockpit, 'pages', 'governance.tsx')),
      'governance.tsx must not survive the split as a re-export shed: a module that still holds the five ' +
        'names is the same bucket with a smaller body',
    )
    for (const page of PAGES) {
      const source = read('pages', page.module)
      const exported = [...source.matchAll(/^export function ([A-Za-z_$][\w$]*)/gm)].map((match) => match[1])
      assert.deepEqual(
        exported,
        [page.component],
        `pages/${page.module} must export exactly one page component — ${page.component}`,
      )
      // One page answers one question, and a page has exactly one heading.
      assert.equal(
        (code(source).match(/<Page\b/g) ?? []).length,
        source.includes('<NoSite') ? 2 : 1,
        `pages/${page.module} renders more than its own <Page> heading (the second is the no-site branch)`,
      )
      assert.match(
        code(source),
        /<Page\s+title=/,
        `pages/${page.module} must carry a titled <Page>, or it is a fragment mounted at a route`,
      )
    }
  })

  test('the router mounts each of them from its own module', () => {
    const router = readFileSync(join(cockpit, 'router.tsx'), 'utf8')
    for (const page of PAGES) {
      const specifier = `@/pages/${page.module.replace(/\.tsx$/, '')}`
      assert.match(
        router,
        new RegExp(`import \\{ ${page.component} \\} from '${specifier.replace('/', '\\/')}'`),
        `router.tsx must import ${page.component} from ${specifier}`,
      )
      assert.match(
        router,
        new RegExp(`\\['${page.to}', ${page.component}\\]`),
        `${page.to} must still mount ${page.component}`,
      )
    }
  })
})

describe('a tab strip in this group is a mechanism, not a decoration', () => {
  for (const page of TABBED) {
    test(`pages/${page.module}: every tab has a panel, and the strip drives them`, () => {
      const source = code(read('pages', page.module))

      // The shared strip, which is what carries role=tablist, role=tab,
      // aria-selected and ←/→. A local <div> of buttons has none of them.
      assert.match(
        source,
        /import \{ TabPanel, Tabs \} from '@\/components\/ui\/tabs'/,
        'the strip and its panels must be the console’s own, or the WAI-ARIA behaviour is re-invented per page',
      )

      // The tabs the strip offers, in the order it offers them.
      const strip = source.slice(source.indexOf(`data-testid="${page.strip}"`))
      assert.ok(strip, `the strip must be addressable as ${page.strip}`)
      const declared = [...strip.slice(0, strip.indexOf('/>')).matchAll(/\{ id: '([^']+)'/g)].map((match) => match[1])
      assert.deepEqual(declared, page.panels, `${page.strip} must offer exactly these tabs, in this order`)

      // And a panel for each, addressable, keyed to the same state the strip
      // writes. A strip whose value never changes is an inert control that
      // still looks like a navigation.
      assert.match(
        source,
        /value=\{tab\}\s*\n?\s*onValueChange=\{setTab\}/,
        'the strip must read and write the state its panels branch on',
      )
      const panels = [...source.matchAll(/<TabPanel\s+active=\{tab === '([^']+)'\}\s+data-testid="([^"]+)"/g)]
      assert.deepEqual(
        panels.map((match) => match[1]),
        page.panels,
        'every tab needs a panel that is shown for exactly its own id — a panel nothing selects is unreachable',
      )
      for (const [, id, testId] of panels) {
        assert.equal(
          testId,
          `${page.strip.replace(/s$/, '')}-${id}`,
          `the ${id} panel must be addressable as ${page.strip.replace(/s$/, '')}-${id}`,
        )
      }

      // The tab the page opens on is one of them.
      const initial = source.match(/useState<[A-Za-z]+Tab>\('([^']+)'\)/)?.[1]
      assert.ok(
        initial && page.panels.includes(initial),
        `pages/${page.module} opens on '${initial ?? 'nothing'}', which is not one of its tabs`,
      )
    })
  }

  test('a panel is hidden rather than unmounted, so nothing typed into one is lost by leaving it', () => {
    // The pairing this depends on, asserted where the pages rely on it: the
    // console's TabPanel keeps its children mounted and hides them. A component
    // rendering `{active && children}` would silently discard a filter, a
    // half-typed reply and every list's scroll position on each tab change.
    const tabs = read('components', 'ui', 'tabs.tsx')
    assert.match(tabs, /role="tabpanel"/, 'a panel must announce itself as one')
    assert.match(tabs, /hidden=\{!active\}/, 'and be hidden rather than dropped')
    assert.match(tabs, /role="tablist"/)
    assert.match(tabs, /role="tab"/)
    assert.match(tabs, /aria-selected=\{active\}/, 'a strip that never says which tab is current is a row of buttons')
  })
})

describe('the two pages that did not get tabs say why', () => {
  test('reader access stays three stacked cards, because its panels write into each other', () => {
    const source = read('pages', 'access.tsx')
    assert.doesNotMatch(
      code(source),
      /<Tabs\b/,
      'the groups card opens the very rule that blocks a deletion — behind a tab that is a button whose whole ' +
        'effect is off screen, which UI-UX.md §1 names as the case Tabs must not be used for',
    )
    // The coupling itself, so the page cannot quietly lose the reason and keep
    // the shape — or lose the reason and then be "fixed" into tabs.
    assert.match(source, /onEditRule=\{\(rule\) => setEditingRule\(\{ rule \}\)\}/, 'the coupling must still exist')
    assert.match(source, /editing=\{editingRule\}/, 'and the rules card must be the panel it writes into')
    // Unwrapped first: the reason is a block comment, so it is line-wrapped and
    // a `*` sits at the head of every line of it.
    const prose = source.replace(/^\s*\*/gm, ' ').replace(/\s+/g, ' ')
    assert.match(
      prose,
      /one panel's control acting on another panel's content/,
      'a page that declines the default container has to say why, where the next author will read it',
    )
  })

  test('the audit trail is one responsive DataTable with inline evidence', () => {
    const source = read('pages', 'audit.tsx')
    assert.doesNotMatch(code(source), /<Tabs\b/, 'one list is one list: the ladder’s first step is nothing')
    assert.match(code(source), /<DataTable\b/, 'the audit trail uses the shared list primitive')
    assert.match(
      code(source),
      /renderMobileRow=/,
      'the same evidence is readable without horizontally scrolling a phone-sized viewport',
    )
    assert.match(
      code(source),
      /expandedRowTestId="ck-audit-detail"/,
      'the expanded evidence row remains addressable without embedding an opaque id in its test name',
    )
  })
})

describe('every testid the split moved still exists where it is driven', () => {
  for (const [module, ids] of Object.entries(OWNED_TESTIDS)) {
    test(`pages/${module} keeps the ids scripts/verify-cockpit-prod.md drives`, () => {
      const source = read('pages', module)
      const missing = ids.filter((id) => !source.includes(id))
      assert.deepEqual(missing, [], `these ids were lost in the split: ${missing.join(', ')}`)
    })
  }

  test('every interactive element these pages add carries one', () => {
    // §8 is a standing project requirement, and the strips are new interactive
    // elements. `Tabs` mints one id per tab from the strip's own — see
    // components/ui/tabs.tsx — so the strip's id is the whole requirement here,
    // and it is asserted above per page. What is checked here is the pages'
    // own controls: nothing may render a bare <button> or a <Button> without an
    // id.
    for (const page of PAGES) {
      const source = code(read('pages', page.module))
      for (const [tag] of source.matchAll(/<(?:button|Button)(?![\w-])[\s\S]{0,400}?>/g)) {
        assert.match(
          tag,
          /data-testid=/,
          `pages/${page.module} renders a control with no data-testid:\n${tag.slice(0, 200)}`,
        )
      }
    }
  })
})
