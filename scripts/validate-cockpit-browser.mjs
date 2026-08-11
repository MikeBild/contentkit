/* global document, getComputedStyle, window, requestAnimationFrame, HTMLElement */
/**
 * The Cockpit, driven in a real browser at three viewports.
 *
 * WHY THIS EXISTS
 *
 * `jsdom` performs no layout. `clientHeight` is `0` there, so every assertion
 * the 79 rendering tests make about the console is an assertion about its DOM
 * tree and none of them is about its geometry. That is not a theoretical gap: in
 * 4.8.0 `SidebarProvider` kept shadcn's `min-h-svh`, the wrapper grew to nine
 * thousand pixels inside an eight-hundred-pixel `body`, the scrolling pane never
 * had a bounded parent so it never overflowed, and `body { overflow: hidden }`
 * silently cut off nine tenths of the releases page. 1078 source tests, 79 DOM
 * tests and six adversarial reviews passed. A user found it.
 *
 * Every case below is one a browser is required for. Nothing here re-checks
 * something a source test can read.
 *
 * WHAT IT RUNS AGAINST
 *
 * `scripts/cockpit-fixture.mjs` — the built `assets/cockpit` on a local origin
 * with an API synthesized from `docs/openapi.json`. The reasoning for that shape
 * (rather than `page.route()`, and rather than the local stack) is in that file's
 * header. It is hermetic and needs no database, so this runs on every push.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * There is no retry anywhere in this file and there is no `waitForTimeout`
 * standing in for a condition that could be waited on. A flaky browser case gets
 * muted, and a muted gate looks like coverage. If a case here turns flaky,
 * delete it.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { startFixture } from './cockpit-fixture.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * The sidebar's own width, from `SIDEBAR_WIDTH` in
 * apps/cockpit/src/components/ui/sidebar.tsx. It is the exact size of the
 * horizontal overflow the console still has (see KNOWN_HORIZONTAL_OVERFLOW), so
 * naming it here is what makes that list a measurement rather than a number.
 */
const SIDEBAR_WIDTH = 256

/**
 * The viewports, and why each one.
 *
 * 1280×420 is deliberately short: it is the only way to be sure every route's
 * content exceeds its pane, which is the precondition case 1 is about. 768 is
 * the breakpoint's desktop side — `useIsMobile` is `innerWidth < 768`, so at
 * exactly 768 the sidebar is still a 256px rail and the content area is 512px,
 * which is the narrowest the *desktop* shell ever gets. 390 is UI-UX.md §7's
 * floor and the mobile side of the same breakpoint.
 */
const VIEWPORTS = [
  { name: '1280×420', width: 1280, height: 420, requireOverflow: true, narrow: false },
  { name: '768×800', width: 768, height: 800, requireOverflow: false, narrow: false },
  { name: '390×800', width: 390, height: 800, requireOverflow: false, narrow: true },
]

/** Both supported catalogs must survive the complete geometry matrix. */
const UI_LOCALES = ['en', 'de']

/**
 * The horizontal overflow the console has today, measured rather than assumed.
 *
 * `SidebarInset` is a flex child with `min-width: auto`, which resolves to its
 * min-content width and therefore refuses to shrink below it. On every page
 * holding a table the inset stays a full viewport wide *beside* a 256px sidebar,
 * so the document is 256px wider than the window — and because `body` is
 * `overflow: hidden`, that 256px is not scrolled to, it is cut off. It is the
 * horizontal twin of the 4.8.0 defect, and the fix is the same one token:
 * `min-w-0` beside the `min-h-0` already on that element in
 * apps/cockpit/src/app/shell.tsx. Setting `min-width: 0` on the inset in the
 * browser takes every entry below to zero.
 *
 * This list is a ratchet, not an exemption. It fails three ways:
 *
 * - a route/viewport that overflows and is not listed — a new defect;
 * - a listed one that overflows by more than the sidebar's width — a worse one;
 * - a listed one that no longer overflows — the fix landed, so the line goes.
 *
 * docs/OPEN-WORK.md §3 asks this suite for "the real list of what breaks". This
 * is it, for the horizontal axis, dated 2026-08-04 and reproducible.
 */
// Empty, and that is the point: `min-w-0` on SidebarInset took all fourteen
// entries to zero at once. The list stays as a mechanism rather than being
// deleted, because the next horizontal overflow should have to be written down
// deliberately rather than absorbed.
const KNOWN_HORIZONTAL_OVERFLOW = new Set([])

// ─────────────────────────────────────────────────────────────────────────────
// The routes, read from the router rather than written down.
//
// A route this suite does not know about is a route with no browser coverage,
// and a hand-kept list is how that happens quietly. apps/cockpit/src/router.tsx
// holds the one table the application itself uses.
// ─────────────────────────────────────────────────────────────────────────────

const routerSource = await readFile(join(root, 'apps/cockpit/src/router.tsx'), 'utf8')
const ROUTES = [...routerSource.matchAll(/^\s*\['(\/[^']*)',\s*(\w+)\],?\s*$/gm)].map((entry) => entry[1])
if (ROUTES.length < 16) {
  throw new Error(
    `Read ${ROUTES.length} routes out of apps/cockpit/src/router.tsx; the console has sixteen. The table's shape changed and this parser has to change with it.`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporting.
// ─────────────────────────────────────────────────────────────────────────────

const failures = []
const observations = []

function expect(condition, message) {
  if (!condition) failures.push(message)
  return Boolean(condition)
}

function note(entry) {
  observations.push(entry)
}

// ─────────────────────────────────────────────────────────────────────────────
// In-page measurement.
//
// Passed to page.evaluate as source, so it has to be self-contained: nothing
// from this module's scope is visible inside the browser.
// ─────────────────────────────────────────────────────────────────────────────

const measure = () => {
  const documentElement = document.documentElement
  const page = document.querySelector('[data-testid="page"]')
  const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
  const inset = document.querySelector('[data-slot="sidebar-inset"]')
  const visibleUuid = uuid.exec(inset?.innerText ?? '')?.[0] ?? null
  const opaqueTestIds = [...document.querySelectorAll('[data-testid]')]
    .map((element) => element.getAttribute('data-testid'))
    .filter((value) => value && uuid.test(value))

  /** The nearest scrolling ancestor of the page, found by computed style. */
  let pane = page?.parentElement ?? null
  while (pane) {
    const overflow = getComputedStyle(pane).overflowY
    if (overflow === 'auto' || overflow === 'scroll') break
    pane = pane.parentElement
  }

  /** Elements sticking out to the right that are NOT inside a scroller. */
  const limit = documentElement.clientWidth
  const spilling = []
  for (const element of document.querySelectorAll('[data-slot="sidebar-inset"] *')) {
    const box = element.getBoundingClientRect()
    if (box.width === 0 || box.right <= limit + 1) continue
    let scrolls = false
    for (let node = element.parentElement; node; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowX
      if (overflow === 'auto' || overflow === 'scroll') {
        scrolls = true
        break
      }
    }
    if (scrolls) continue
    if ([...element.children].some((child) => child.getBoundingClientRect().right > limit + 1)) continue
    spilling.push({
      tag: element.tagName.toLowerCase(),
      testId: element.getAttribute('data-testid'),
      text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48),
    })
  }

  return {
    hasPage: Boolean(page),
    title: document.querySelector('[data-testid="page-title"]')?.textContent ?? null,
    paneFound: Boolean(pane),
    paneClientHeight: pane?.clientHeight ?? 0,
    paneScrollHeight: pane?.scrollHeight ?? 0,
    paneClass: pane ? pane.className.toString().slice(0, 80) : null,
    documentScrollHeight: documentElement.scrollHeight,
    documentClientHeight: documentElement.clientHeight,
    bodyScrollHeight: document.body.scrollHeight,
    bodyClientHeight: document.body.clientHeight,
    documentScrollWidth: documentElement.scrollWidth,
    documentClientWidth: documentElement.clientWidth,
    spilling: spilling.slice(0, 4),
    visibleUuid,
    opaqueTestIds: opaqueTestIds.slice(0, 4),
  }
}

/**
 * What a phone width actually costs, which the three measurements above cannot
 * see.
 *
 * `documentElement.scrollWidth` is a document-level number, and at 390 the
 * sidebar is off-canvas, so the inset is the whole window and the document does
 * not grow. Everything that goes wrong at 390 goes wrong *inside* a container
 * that scrolls it sideways instead — which is invisible from the outside and is
 * exactly what a phone shows you first.
 *
 * Two questions, both of them §7's:
 *
 *  - **What scrolls sideways?** Nothing. Tables stack into labelled records at
 *    this width, so they no longer receive the old exemption.
 *  - **Where are row controls?** Every control remains inside the viewport; this
 *    catches a malformed row even when its container itself does not scroll.
 */
const measureNarrow = (viewportWidth) => {
  const sideways = []
  const inset = document.querySelector('[data-slot="sidebar-inset"]')
  for (const element of inset?.querySelectorAll('*') ?? []) {
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    if (!['auto', 'scroll'].includes(style.overflowX)) continue
    if (element.scrollWidth <= element.clientWidth + 1) continue
    sideways.push({
      tag: element.tagName.toLowerCase(),
      testId: element.getAttribute('data-testid'),
      by: element.scrollWidth - element.clientWidth,
      text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48),
    })
  }

  /**
   * How much of the row the page's title block actually gets.
   *
   * `Page`'s header is a row of "title, description" against "actions", and the
   * actions are `shrink-0` — right at 1280, wrong at 390, where a 100px button
   * and its gap took 116px of a 342px column and left the description wrapping
   * in 226px with a third of the row empty beside it.
   */
  const heading = document.querySelector('[data-testid="page-title"]')?.parentElement ?? null
  const page = document.querySelector('[data-testid="page"]')
  const titleBlock =
    heading && page
      ? {
          width: Math.round(heading.getBoundingClientRect().width),
          available: Math.round(
            page.getBoundingClientRect().width - Number.parseFloat(getComputedStyle(page).paddingLeft) * 2,
          ),
        }
      : null

  const stranded = []
  for (const row of inset?.querySelectorAll('tbody tr') ?? []) {
    for (const control of row.querySelectorAll('button, a[href], [role="button"]')) {
      const box = control.getBoundingClientRect()
      if (box.width === 0) continue
      if (box.left < viewportWidth && box.right > 0) continue
      stranded.push({
        testId: control.getAttribute('data-testid'),
        at: Math.round(box.left),
        text: (control.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24),
      })
    }
  }

  return {
    sideways: sideways.slice(0, 4),
    sidewaysCount: sideways.length,
    stranded: stranded.slice(0, 4),
    strandedCount: stranded.length,
    titleBlock,
  }
}

/** Scrolls the pane to the bottom and reports whether it moved and what became reachable. */
const scrollPaneToEnd = () => {
  const page = document.querySelector('[data-testid="page"]')
  let pane = page?.parentElement ?? null
  while (pane) {
    const overflow = getComputedStyle(pane).overflowY
    if (overflow === 'auto' || overflow === 'scroll') break
    pane = pane.parentElement
  }
  if (!pane || !page) return { scrolled: 0, lastReachable: false }
  pane.scrollTop = pane.scrollHeight
  return {
    scrolled: pane.scrollTop,
    // The bottom of the page's content, once scrolled, has to be inside the
    // pane. A pane that scrolls by a hundred pixels while its content is a
    // thousand past the fold is still a page with an unreachable bottom.
    lastReachable: page.getBoundingClientRect().bottom <= pane.getBoundingClientRect().bottom + 2,
  }
}

/** Whether the document itself moved when asked to. `body` is `overflow: hidden`. */
const tryScrollDocument = () => {
  window.scrollTo(0, 10_000)
  document.body.scrollTop = 10_000
  document.documentElement.scrollTop = 10_000
  return { windowY: window.scrollY, bodyTop: document.body.scrollTop, docTop: document.documentElement.scrollTop }
}

// ─────────────────────────────────────────────────────────────────────────────

const started = Date.now()
const fixture = await startFixture()
const browser = await chromium.launch({ headless: true })
const browserErrors = []

/** Opens a route and waits for it to have rendered — never on a fixed delay. */
async function open(page, route, origin) {
  const path = route === '/' ? '/cockpit/' : `/cockpit${route}`
  // Not `networkidle`: the assistant page holds a stream open, so "idle" never
  // arrives there and the suite would hang on one route out of sixteen.
  await page.goto(`${origin}${path}?site=canary`)
  await page.waitForSelector('[data-testid="page"]', { timeout: 15_000 })
  // A skeleton on screen means a query is still in flight and the page's real
  // height is not known yet. Absence of one is the condition, not a duration.
  await page
    .waitForFunction(() => !document.querySelector('[data-slot="skeleton"]'), null, { timeout: 15_000 })
    .catch(() => {})
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))))
}

/**
 * Waits until nothing is animating.
 *
 * The sheet slides, the rail's labels transition their margin, and a box read
 * mid-transition is a measurement of an intermediate frame. This is a condition,
 * not a duration: `getAnimations()` answers what is actually still running.
 */
async function settled(page) {
  await page
    .waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'), null, {
      timeout: 5000,
    })
    .catch(() => {})
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))))
}

function watch(page) {
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // The fixture answers no 4xx/5xx, so a failed request here is real; a
    // favicon the bundle does not ship is not.
    if (/favicon/i.test(text)) return
    browserErrors.push(`console: ${text}`)
  })
}

try {
  // ───────────────────────────────────────────────────────────────────────────
  // Cases 1, 2 and 3 — one pass per viewport, one measurement per route.
  // ───────────────────────────────────────────────────────────────────────────
  for (const viewport of VIEWPORTS) {
    for (const locale of UI_LOCALES) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
      await context.addInitScript((preference) => {
        localStorage.setItem('ck-cockpit-locale', preference)
      }, locale)
      const page = await context.newPage()
      watch(page)

      for (const route of ROUTES) {
        await open(page, route, fixture.origin)
        const seen = await page.evaluate(measure)
        const where = `${locale} ${viewport.name} ${route}`
        note({ locale, viewport: viewport.name, route, ...seen })

        if (!expect(seen.hasPage, `${where}: nothing with data-testid="page" rendered.`)) continue

        expect(!seen.visibleUuid, `${where}: an opaque UUID is visible to the operator: ${seen.visibleUuid}.`)
        expect(
          seen.opaqueTestIds.length === 0,
          `${where}: test selectors contain opaque UUIDs: ${seen.opaqueTestIds.join(', ')}.`,
        )

        // ── Case 1. Every route scrolls when its content exceeds the viewport.
        expect(
          seen.paneFound,
          `${where}: the page has no scrolling ancestor at all — nothing below the fold is reachable.`,
        )
        expect(
          seen.paneClientHeight <= viewport.height + 1,
          `${where} (${seen.title}): the scrolling pane is ${seen.paneClientHeight}px tall inside a ${viewport.height}px viewport, so it is unbounded and can never overflow. This is the 4.8.0 defect: the pane's overflow-y has no bounded parent, and body{overflow:hidden} cuts off everything past ${viewport.height}px with no scrollbar to say so.`,
        )
        if (viewport.requireOverflow) {
          expect(
            seen.paneScrollHeight > seen.paneClientHeight,
            `${where} (${seen.title}): content is ${seen.paneScrollHeight}px in a ${seen.paneClientHeight}px pane — it does not exceed even this deliberately short viewport, so either the page rendered nothing or the pane grew with it.`,
          )
        }
        if (seen.paneScrollHeight > seen.paneClientHeight) {
          const moved = await page.evaluate(scrollPaneToEnd)
          expect(
            moved.scrolled > 0,
            `${where} (${seen.title}): the pane reports ${seen.paneScrollHeight}px of content in ${seen.paneClientHeight}px but scrollTop stayed at 0 — the overflow is not scrollable.`,
          )
          expect(
            moved.lastReachable,
            `${where} (${seen.title}): scrolled to the end and the bottom of the page is still below the pane — part of this page cannot be reached.`,
          )
        }

        // ── Case 2. No page scrolls the document itself.
        expect(
          seen.documentScrollHeight <= seen.documentClientHeight + 1,
          `${where} (${seen.title}): the document is ${seen.documentScrollHeight}px tall in a ${seen.documentClientHeight}px window. body is overflow:hidden by design, so this height is not scrolled — it is clipped.`,
        )
        expect(
          seen.bodyScrollHeight <= seen.bodyClientHeight + 1,
          `${where} (${seen.title}): body content is ${seen.bodyScrollHeight}px in a ${seen.bodyClientHeight}px body, and body is overflow:hidden — the difference is cut off.`,
        )
        const stayed = await page.evaluate(tryScrollDocument)
        expect(
          stayed.windowY === 0 && stayed.bodyTop === 0 && stayed.docTop === 0,
          `${where} (${seen.title}): the document scrolled (window ${stayed.windowY}, body ${stayed.bodyTop}, root ${stayed.docTop}). The shell scrolls its panes; a page that moves the document takes the sidebar with it.`,
        )

        // ── Case 3. Nothing overflows horizontally, except inside a scroller.
        const overflow = seen.documentScrollWidth - seen.documentClientWidth
        const key = `${viewport.name} ${route}`
        if (KNOWN_HORIZONTAL_OVERFLOW.has(key)) {
          expect(
            overflow > 0,
            `${where}: listed in KNOWN_HORIZONTAL_OVERFLOW and no longer overflows. Delete the '${key}' line from scripts/validate-cockpit-browser.mjs — the ratchet only holds if it tightens.`,
          )
          expect(
            overflow <= SIDEBAR_WIDTH,
            `${where} (${seen.title}): horizontal overflow is ${overflow}px, worse than the ${SIDEBAR_WIDTH}px this page is recorded as having. Something new overflows on top of the SidebarInset min-width defect.`,
          )
        } else {
          expect(
            overflow <= 0,
            `${where} (${seen.title}): the document is ${overflow}px wider than the window and body is overflow:hidden, so that ${overflow}px is unreachable. Nothing may overflow horizontally. Widest offenders: ${
              seen.spilling
                .map((item) => `<${item.tag}${item.testId ? ` data-testid="${item.testId}"` : ''}> "${item.text}"`)
                .join(', ') || 'none identified'
            }`,
          )
        }

        // ── Case 8. At a phone width nothing scrolls sideways, and every row's
        //    controls remain inside the viewport.
        if (viewport.narrow) {
          const narrow = await page.evaluate(measureNarrow, viewport.width)
          note({ viewport: viewport.name, route, ...narrow })
          expect(
            narrow.sidewaysCount === 0,
            `${where} (${seen.title}): ${narrow.sidewaysCount} element(s) scroll sideways. UI-UX.md §7 requires one vertical reading axis, including for tables. Offenders: ${
              narrow.sideways
                .map(
                  (item) =>
                    `<${item.tag}${item.testId ? ` data-testid="${item.testId}"` : ''}> +${item.by}px "${item.text}"`,
                )
                .join(', ') || 'none identified'
            }`,
          )
          expect(
            narrow.strandedCount === 0,
            `${where} (${seen.title}): ${narrow.strandedCount} control(s) in table rows sit outside the ${viewport.width}px window. A stacked row keeps every value and action in the viewport. Stranded: ${
              narrow.stranded.map((item) => `"${item.text}" (${item.testId}) at x=${item.at}`).join(', ') ||
              'none identified'
            }`,
          )
          expect(
            narrow.titleBlock !== null && narrow.titleBlock.width >= narrow.titleBlock.available - 1,
            `${where} (${seen.title}): the page's title and description share their row with the page's actions, so they get ${narrow.titleBlock?.width}px of ${narrow.titleBlock?.available}px. At a phone width the actions take their own row — see the header in apps/cockpit/src/app/shell.tsx.`,
          )
        }

        // A hidden tab can conceal interface copy from the route's default-state
        // measurement. Exercise both registry views: opaque ids and sideways
        // records used to appear only after opening Patterns.
        if (route === '/compositions') {
          for (const tab of ['patterns', 'guides']) {
            await page.locator(`[data-testid="composition-tabs-${tab}"]`).click()
            const tabSeen = await page.evaluate(measure)
            expect(!tabSeen.visibleUuid, `${where} ${tab}: an opaque UUID is visible: ${tabSeen.visibleUuid}.`)
            if (viewport.narrow) {
              const tabNarrow = await page.evaluate(measureNarrow, viewport.width)
              expect(
                tabNarrow.sidewaysCount === 0 && tabNarrow.strandedCount === 0,
                `${where} ${tab}: the opened tab adds horizontal scrolling or strands row controls.`,
              )
            }
          }
        }
      }
      await context.close()
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Case 4 — below 768 the sidebar is an off-canvas sheet, and its trigger
  // opens it.
  //
  // §7 of UI-UX.md claims this and nothing has ever checked it: `useIsMobile`
  // reads `window.innerWidth`, which is 1024 in jsdom and cannot be anything
  // else without stubbing the very thing under test.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 800 } })
    const page = await context.newPage()
    watch(page)
    await open(page, '/', fixture.origin)

    const railHidden = await page.evaluate(() => {
      const desktop = document.querySelector('[data-slot="sidebar"]:not([data-mobile])')
      return !desktop || getComputedStyle(desktop).display === 'none'
    })
    expect(
      railHidden,
      '390×800: the desktop sidebar rail is still displayed below 768px; it must give way to the sheet.',
    )
    expect(
      (await page.locator('[data-slot="sidebar"][data-mobile="true"]').count()) === 0,
      '390×800: the mobile sheet is mounted before anything opened it.',
    )

    const trigger = page.locator('[data-testid="sidebar-toggle"]')
    expect(
      await trigger.isVisible(),
      '390×800: the sidebar trigger is not visible, so the navigation cannot be opened at all.',
    )
    await trigger.click()
    const sheet = page.locator('[data-slot="sidebar"][data-mobile="true"]')
    const opened = await sheet
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false)
    expect(
      opened,
      '390×800: the sidebar trigger did not open the off-canvas sheet. Below 768px it is the only way to reach the navigation.',
    )
    if (opened) {
      await settled(page)
      expect(
        await sheet.locator('[data-testid="nav-releases"]').isVisible(),
        '390×800: the sheet opened without the navigation in it — no route is reachable from a phone.',
      )
      const box = await sheet.boundingBox()
      expect(
        box !== null && box.x >= -1 && box.x + box.width <= 391,
        `390×800: the opened sheet sits at ${box ? `${Math.round(box.x)}…${Math.round(box.x + box.width)}` : 'nowhere'} in a 390px window — part of it is off screen.`,
      )
      /**
       * Escape closes it — on the second press, today, and that is a defect
       * this case pins rather than hides.
       *
       * The sheet autofocuses its first control, which is a `SidebarMenuButton`
       * with a `tooltip=`. On mobile that tooltip is rendered with `hidden`, so
       * it is invisible — but it is still mounted, and Radix's DismissableLayer
       * stack gives Escape to the topmost layer, which is the tooltip. The first
       * press therefore dismisses something the operator cannot see and the
       * navigation stays over the page. It is not specific to the first control:
       * every entry in the sheet mounts the same tooltip on focus.
       *
       * KNOWN_TOOLTIP_SWALLOWS_ESCAPE is the ratchet. When the tooltip stops
       * being mounted where it is not shown, the first press will close the
       * sheet, this assertion will fail, and the constant is what gets flipped.
       */
      const KNOWN_TOOLTIP_SWALLOWS_ESCAPE = false
      await page.keyboard.press('Escape')
      const closedOnFirst = await sheet
        .waitFor({ state: 'hidden', timeout: 1500 })
        .then(() => true)
        .catch(() => false)
      expect(
        closedOnFirst !== KNOWN_TOOLTIP_SWALLOWS_ESCAPE,
        KNOWN_TOOLTIP_SWALLOWS_ESCAPE
          ? '390×800: the first Escape now closes the sheet. Set KNOWN_TOOLTIP_SWALLOWS_ESCAPE to false in scripts/validate-cockpit-browser.mjs — the invisible tooltip no longer eats it.'
          : '390×800: the first Escape did not close the sheet. An invisible layer above it is taking the key, so the navigation covers the page with no keyboard way out.',
      )
      if (!closedOnFirst) {
        await page.keyboard.press('Escape')
        expect(
          await sheet
            .waitFor({ state: 'hidden', timeout: 5000 })
            .then(() => true)
            .catch(() => false),
          '390×800: two Escapes did not close the sheet either. There is no keyboard way out of the navigation on a phone.',
        )
      }
    }
    await context.close()
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Case 5 — the collapsed rail names every entry, the site switcher included.
  //
  // Collapsed, the rail is 3rem of icons and the tooltip is the only text on
  // screen. An entry without one is an unlabelled icon, which is what the site
  // switcher was until it was given a hand-rolled tooltip — hand-rolled meaning
  // nothing keeps it equivalent to the ten it sits above.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    watch(page)
    await open(page, '/', fixture.origin)

    await page.locator('[data-testid="sidebar-toggle"]').click()
    await page.waitForFunction(
      () =>
        document.querySelector('[data-slot="sidebar"]:not([data-mobile])')?.getAttribute('data-state') === 'collapsed',
      null,
      { timeout: 5000 },
    )
    // The rail's labels transition their margin over 200ms, and both the hit
    // test and the tooltips below are about where things end up.
    await settled(page)

    /**
     * Every entry in the rail — and the site switcher has to be named
     * separately.
     *
     * It IS a `SidebarMenuButton`, but shell.tsx nests it inside
     * `TooltipTrigger asChild > DropdownMenuTrigger asChild`, and Radix's Slot
     * merge leaves the outermost `data-slot` on the rendered element. Selecting
     * by `data-slot="sidebar-menu-button"` therefore silently misses the one
     * control whose tooltip was hand-rolled — which is the one this case was
     * written for.
     */
    const ids = await page.evaluate(() => {
      const found = new Set()
      for (const element of document.querySelectorAll(
        '[data-slot="sidebar-container"] [data-slot="sidebar-menu-button"], [data-slot="sidebar-container"] [data-testid="site-switcher"]',
      )) {
        const id = element.getAttribute('data-testid')
        if (id) found.add(id)
      }
      return [...found]
    })
    expect(
      ids.length >= 12,
      `1280×800 collapsed: only ${ids.length} entries are in the rail; the console has sixteen routes plus its chrome.`,
    )
    expect(
      ids.includes('site-switcher'),
      '1280×800 collapsed: the site switcher is not in the rail at all — the one control that says which site is about to change.',
    )

    /**
     * The tooltip has to be reachable by a pointer, and this is measured first
     * — before anything is focused, because focusing an entry scrolls the rail
     * and a hit test after that is a hit test of a different layout.
     *
     * `SidebarGroupLabel` collapses with `-mt-8 opacity-0`: invisible, still
     * 32px tall, still taking pointer events, and pulled up exactly over the
     * first entry of the block below it. Four routes in the rail cannot be
     * hovered or clicked because of it — `elementFromPoint` at the centre of the
     * icon answers the label, not the link. Adding `pointer-events-none` to that
     * collapsed state in apps/cockpit/src/components/ui/sidebar.tsx takes the
     * list to zero.
     *
     * Ratcheted the same three ways as KNOWN_HORIZONTAL_OVERFLOW: an unlisted
     * obstruction fails, and a listed one that has been fixed fails until the
     * line is deleted.
     */
    const KNOWN_RAIL_OBSTRUCTIONS = new Set()
    const blocked = await page.evaluate(
      (entries) =>
        entries
          .map((id) => {
            const element = document.querySelector(`[data-testid="${id}"]`)
            if (!element) return { id, over: 'missing' }
            const box = element.getBoundingClientRect()
            const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
            if (hit && (hit === element || element.contains(hit))) return null
            return { id, over: hit?.getAttribute('data-testid') ?? hit?.tagName.toLowerCase() ?? 'nothing' }
          })
          .filter(Boolean),
      ids,
    )
    note({ case: 'collapsed-rail-obstructions', blocked })
    for (const entry of blocked) {
      expect(
        KNOWN_RAIL_OBSTRUCTIONS.has(entry.id),
        `1280×800 collapsed: "${entry.id}" cannot be pointed at — "${entry.over}" covers its icon, so the route is unreachable with a mouse and its tooltip never opens.`,
      )
    }
    for (const id of KNOWN_RAIL_OBSTRUCTIONS) {
      expect(
        blocked.some((entry) => entry.id === id),
        `1280×800 collapsed: "${id}" is listed in KNOWN_RAIL_OBSTRUCTIONS and is now reachable. Delete it from scripts/validate-cockpit-browser.mjs — the ratchet only holds if it tightens.`,
      )
    }

    const named = []
    for (const id of ids) {
      const entry = page.locator(`[data-testid="${id}"]`)
      // Focus rather than hover, for two reasons. It is the path an operator
      // without a pointer takes, which is the half a hover test never covers;
      // and four entries are covered by the invisible label measured above, so a
      // hover would report the tooltip missing when what is actually wrong is
      // the hit target — two different defects, and this half is the first.
      await entry.focus()
      const tip = page.locator('[data-slot="tooltip-content"]:visible').first()
      const shown = await tip
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false)
      const text = shown ? ((await tip.textContent()) ?? '').trim() : ''
      expect(
        shown && text.length > 0,
        `1280×800 collapsed: the rail entry "${id}" shows no tooltip. Collapsed it is a 32px icon and nothing else, so it names nothing.`,
      )
      named.push({ entry: id, tooltip: text })
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
      await page
        .waitForFunction(() => !document.querySelector('[data-slot="tooltip-content"]'), null, { timeout: 3000 })
        .catch(() => {})
    }
    note({ case: 'collapsed-rail', entries: named })
    await context.close()
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Case 7 — a tab's count is the count of the list behind it.
  //
  // Two surfaces, one number, and no source test can put them side by side: the
  // badge is drawn from a page-level query and the rows from the card's own, and
  // the only thing that proves they are the same fact is reading one and then
  // opening the other. docs/OPEN-WORK.md §1 names this case for exactly that.
  //
  // It also pins the cost rule that item's Risks section asks for. The count for
  // the tab the reader is *on* is not fetched — its panel is already the answer —
  // so Comments carries no badge on arrival and gains one the moment it stops
  // being the open tab. Asserted in both directions, because "no badge yet" and
  // "no badge ever" look identical in a screenshot and only one of them is the
  // design.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    watch(page)
    await open(page, '/moderation', fixture.origin)

    const contactBadge = page.locator('[data-testid="ck-moderation-count-contact"]')
    const shown = await contactBadge
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
    expect(
      shown,
      '1280×800 /moderation: the Contact tab carries no count. Behind a tab a list is behind a door with no number on it — a moderator on Comments cannot see that contact submissions are waiting.',
    )

    // Two different defects arrive here, so the badge's text is read before it
    // is judged: "30 pending" on the open tab means the count was fetched for a
    // number already on screen, and "0 pending" means an unknown count was
    // rendered as a zero — which is the third state collapsing into the second.
    const openTab = page.locator('[data-testid="ck-moderation-count-comments"]')
    const openTabText = (await openTab.count()) > 0 ? ((await openTab.textContent()) ?? '').trim() : null
    expect(
      openTabText === null,
      `1280×800 /moderation: Comments is the open tab and it carries a badge reading "${openTabText}". Either its count was fetched for a number already on screen — the extra request per page load the open-tab gate exists to avoid — or a count nobody has yet is being drawn as a zero, and absent must never read as zero.`,
    )

    if (shown) {
      const badgeText = ((await contactBadge.textContent()) ?? '').trim()
      const counted = Number.parseInt(badgeText, 10)
      expect(
        Number.isInteger(counted) && counted > 0,
        `1280×800 /moderation: the Contact tab's badge reads "${badgeText}", which is not a positive whole number. A badge exists to be read as a count; a zero or an empty one is noise the strip is supposed to omit.`,
      )

      await page.locator('[data-testid="ck-moderation-tabs-contact"]').click()
      const panel = page.locator('[data-testid="ck-moderation-tab-contact"]')
      await panel.waitFor({ state: 'visible', timeout: 5000 })
      const rows = await panel.locator('[data-testid^="ck-contact-row-"]').count()
      note({ case: 'tab-count-matches-panel', badge: badgeText, counted, rows })

      expect(
        counted === rows,
        `1280×800 /moderation: the Contact tab says ${counted} and the Contact panel lists ${rows}. The badge and the list are two readings of one query; a badge that disagrees with the list under it is worse than no badge, because it is believed.`,
      )

      // The count does not vanish when its tab becomes the open one. A number
      // that disappeared under the pointer would read as "it just went to zero",
      // which is the one thing absent must never mean.
      expect(
        (await contactBadge.count()) === 1,
        '1280×800 /moderation: opening the Contact tab removed its count. Suppressing the *request* for the open tab is the rule; discarding a count already fetched makes the badge flicker out under the click that opened it.',
      )

      // And the deferral is a deferral: Comments was not counted while it was
      // open, and is counted now that it is not.
      const commentsBadge = page.locator('[data-testid="ck-moderation-count-comments"]')
      expect(
        await commentsBadge
          .waitFor({ state: 'visible', timeout: 10_000 })
          .then(() => true)
          .catch(() => false),
        '1280×800 /moderation: Comments still carries no count after the reader moved to another tab. Its count is deferred until it is not the open tab; never fetching it is not a deferral, it is the missing badge this case exists to find.',
      )
      note({ case: 'tab-count-deferred', comments: ((await commentsBadge.textContent()) ?? '').trim() })
    }
    await context.close()
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Case 9 — a dialog's own answer is on screen, at a phone's height.
  //
  // 390×667 rather than 390×800, because 800 is not a phone: it is the number
  // that made the shortest of these dialogs *just* fit and hid the defect from
  // the pass above. The console's forms are mobile-first — every grid in
  // `src/forms` is `sm:grid-cols-2` — so at 390 they collapse to one column and
  // double in height, and the panel is capped at `100dvh-2rem`. That cap was
  // doing nothing but clipping: `ck-api-key-dialog` laid out 1406px of form in
  // a 635px panel and put its own Create button 700px below the fold, on a
  // document that is `overflow: hidden` and cannot be scrolled to it.
  //
  // The list is written down rather than discovered, because a dialog that no
  // longer opens has to fail here rather than be skipped — a suite that walks
  // whatever it finds reports "nothing broken" when it finds nothing.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const DIALOGS = [
      // The three that were measurably broken, worst first.
      ['/credentials', 'ck-api-key-new', 'New key'],
      ['/access', 'ck-reader-0-edit', 'Edit reader'],
      ['/webhooks', 'ck-webhook-0-edit', 'Edit endpoint'],
      // The rest of the console's form dialogs, so a regression in any of them
      // lands here rather than on an operator.
      ['/sites', 'site-new', 'New site (the wizard)'],
      ['/access', 'ck-reader-new', 'New reader'],
      ['/access', 'ck-rule-new', 'New path rule'],
      ['/access', 'ck-group-new', 'New group'],
      ['/webhooks', 'ck-webhook-new', 'New endpoint'],
    ]
    const context = await browser.newContext({ viewport: { width: 390, height: 667 } })
    const page = await context.newPage()
    watch(page)

    for (const [route, opener, label] of DIALOGS) {
      await open(page, route, fixture.origin)
      const trigger = page.locator(`[data-testid^="${opener}"]`).first()
      const opened = await trigger
        .click({ timeout: 5000 })
        .then(() => page.locator('[role="dialog"]').first().waitFor({ state: 'visible', timeout: 5000 }))
        .then(() => true)
        .catch(() => false)
      if (
        !expect(
          opened,
          `390×667 ${route}: "${opener}" (${label}) did not open a dialog. It is listed here because it is one of the console's form dialogs; if it has been renamed or removed, this list is what changes.`,
        )
      )
        continue

      await settled(page)
      const seen = await page.evaluate(() => {
        const panel = [...document.querySelectorAll('[role="dialog"]')].at(-1)
        if (!panel) return null
        const footer = panel.querySelector('[data-slot="dialog-footer"]')
        const body = [...panel.children].find((child) => ['auto', 'scroll'].includes(getComputedStyle(child).overflowY))
        const box = panel.getBoundingClientRect()
        return {
          testId: panel.getAttribute('data-testid'),
          bottom: Math.round(box.bottom),
          panelOverflows:
            !['hidden', 'clip'].includes(getComputedStyle(panel).overflowY) &&
            panel.scrollHeight > panel.clientHeight + 1,
          footerBottom: footer ? Math.round(footer.getBoundingClientRect().bottom) : null,
          bodyFits: body ? body.scrollHeight <= body.clientHeight + 1 : null,
          // §7 inside a dialog, which is where the wizard's four-step strip
          // lives: 4 × `min-w-44` is 728px of strip, and the widest dialog here
          // is `sm:max-w-2xl`, so it scrolled sideways at every viewport and at
          // 390 held steps three and four 219px and 361px past the window.
          sideways: [...panel.querySelectorAll('*')]
            .filter((element) => {
              const style = getComputedStyle(element)
              if (style.display === 'none' || style.visibility === 'hidden') return false
              if (!['auto', 'scroll'].includes(style.overflowX)) return false
              return element.scrollWidth > element.clientWidth + 1
            })
            .map((element) => ({
              testId: element.getAttribute('data-testid'),
              by: element.scrollWidth - element.clientWidth,
            })),
          offScreen: [...panel.querySelectorAll('[data-slot="dialog-footer"] button')]
            .map((element) => ({
              testId: element.getAttribute('data-testid'),
              bottom: Math.round(element.getBoundingClientRect().bottom),
            }))
            .filter((entry) => entry.bottom > 668),
        }
      })
      note({ case: 'dialog-at-phone-height', route, opener, ...seen })

      expect(
        seen !== null && seen.offScreen.length === 0,
        `390×667 ${route} ${label}: ${seen?.offScreen.length} control(s) in the dialog's footer sit below the 667px window — ${seen?.offScreen
          .map((entry) => `${entry.testId} at y=${entry.bottom}`)
          .join(', ')}. The footer is where a dialog is answered; body is overflow:hidden, so nothing scrolls to it.`,
      )
      expect(
        seen !== null && !seen.panelOverflows,
        `390×667 ${route} ${label}: the panel holds more than it shows (${seen?.testId}) and does not scroll. Its middle row is what has to give — see grid-rows-[auto_minmax(0,1fr)_auto] in apps/cockpit/src/components/ui/dialog.tsx.`,
      )
      expect(
        seen !== null && seen.footerBottom !== null && seen.footerBottom <= seen.bottom + 1,
        `390×667 ${route} ${label}: the footer ends at ${seen?.footerBottom} and the panel at ${seen?.bottom}, so it hangs outside its own dialog.`,
      )
      expect(
        seen !== null && seen.sideways.length === 0,
        `390×667 ${route} ${label}: ${seen?.sideways.length} element(s) inside the dialog scroll sideways — ${seen?.sideways
          .map((entry) => `${entry.testId} by ${entry.by}px`)
          .join(', ')}. §7 requires one vertical reading axis, including inside dialogs.`,
      )

      await page.keyboard.press('Escape')
      await page
        .locator('[role="dialog"]')
        .first()
        .waitFor({ state: 'hidden', timeout: 5000 })
        .catch(() => {})
    }
    await context.close()
  }

  expect(
    fixture.unanswered.length === 0,
    `The console asked for endpoints the fixture could not answer, so some page rendered against nothing: ${[...new Set(fixture.unanswered)].join('; ')}`,
  )
  expect(
    browserErrors.length === 0,
    `The browser reported errors: ${[...new Set(browserErrors)].slice(0, 6).join(' | ')}`,
  )
} finally {
  await browser.close().catch(() => {})
  await fixture.close().catch(() => {})
}

const seconds = ((Date.now() - started) / 1000).toFixed(1)

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`)
  console.error(`\nCockpit browser validation failed: ${failures.length} assertion(s) in ${seconds}s.`)
  process.exitCode = 1
} else {
  process.stdout.write(
    `${JSON.stringify(
      {
        valid: true,
        seconds: Number(seconds),
        routes: ROUTES.length,
        locales: UI_LOCALES,
        viewports: VIEWPORTS.map((entry) => entry.name),
        cases: [
          'every route scrolls its pane and the pane is bounded by the viewport',
          'no page scrolls the document; body is overflow:hidden by design',
          'nothing overflows horizontally outside a scroll container',
          'below 768 the sidebar is an off-canvas sheet its trigger opens',
          'the collapsed rail names every entry, the site switcher included',
          "a tab's count equals the list behind it, and the open tab's count is deferred rather than dropped",
          'at 390 nothing scrolls sideways, and no row keeps its own controls off screen',
          "at 390×667 a dialog's footer is inside the dialog and inside the window",
        ],
        known_horizontal_overflow: [...KNOWN_HORIZONTAL_OVERFLOW],
        measurements: observations.length,
      },
      null,
      2,
    )}\n`,
  )
}
