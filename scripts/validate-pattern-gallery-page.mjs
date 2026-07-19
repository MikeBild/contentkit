/* global document, getComputedStyle */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const gallery = join(root, 'examples/pattern-gallery')
const screenshots = join(gallery, 'validation-screenshots')
const widths = [320, 390, 768, 1024, 1440, 1600]
const schemes = ['light', 'dark']
const browser = await chromium.launch({ headless: true })
const cases = []

await mkdir(screenshots, { recursive: true })

for (const width of widths) {
  for (const scheme of schemes) {
    const height = width <= 390 ? 844 : width <= 768 ? 900 : 1000
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    const consoleErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await page.goto(`${pathToFileURL(join(gallery, 'index.html')).href}#semantic-publishing`)
    await page.selectOption('#scheme', scheme)
    await page.selectOption('#viewport', String(width))
    await page.waitForFunction(() => document.querySelector('.mermaid-live svg'))
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(100)

    const state = await page.evaluate(
      ({ width, scheme }) => {
        const box = (selector) => document.querySelector(selector)?.getBoundingClientRect()
        const visible = (selector) => {
          const element = document.querySelector(selector)
          return Boolean(element && getComputedStyle(element).display !== 'none')
        }
        const capabilityCards = [...document.querySelectorAll('.capability-card')]
        const guideCards = [...document.querySelectorAll('.guide-card')]
        const patternQuestions = [...document.querySelectorAll('.pattern-question strong')]
        const viewport = document.documentElement.getBoundingClientRect()
        const outside = [...document.querySelectorAll('main *, .review-bar *, .mobile-bar *')]
          .filter((element) => {
            const bounds = element.getBoundingClientRect()
            return (
              !element.closest('.code-stage, .composition-code-variant, details:not([open])') &&
              bounds.width > 1 &&
              (bounds.left < -1 || bounds.right > viewport.width + 1)
            )
          })
          .slice(0, 10)
          .map((element) => ({ tag: element.tagName.toLowerCase(), className: String(element.className) }))
        return {
          theme: document.documentElement.dataset.theme,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          sidebarVisible: visible('.sidebar'),
          mobileBarVisible: visible('.mobile-bar'),
          capabilityCards: capabilityCards.length,
          code: Boolean(document.querySelector('.code-stage pre code')),
          mermaid: Boolean(document.querySelector('.mermaid-live svg')),
          chart: Boolean(document.querySelector(`.chart-${scheme}`)) && visible(`.chart-${scheme}`),
          report: Boolean(document.querySelector('.report-demo .composition-group')),
          guideCards: guideCards.length,
          completeGuides: guideCards.every(
            (card) => card.querySelector('.guide-question') && card.querySelectorAll('dt').length === 3,
          ),
          completePatternQuestions:
            patternQuestions.length === 81 && patternQuestions.every((node) => node.textContent.trim().length >= 12),
          capabilityTop: Math.round(box('#semantic-publishing')?.top || 0),
          controlsBottom: Math.round(box('.review-bar')?.bottom || 0),
          outside,
          expectedDesktopNavigation: width > 1050,
        }
      },
      { width, scheme },
    )

    let outputSelection = null
    if (width === 1440 && scheme === 'light') {
      const previewState = () =>
        page.evaluate(() => {
          const roadmap = document.querySelector('#pattern-roadmap')
          return {
            roadmapSource: roadmap.querySelector('.preview-export > img').getAttribute('src'),
          }
        })
      await page.selectOption('#output', 'svg')
      const svg = await previewState()
      await page.selectOption('#output', 'png')
      const png = await previewState()
      await page.selectOption('#category', 'timeline')
      await page.locator('#pattern-roadmap').scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(screenshots, '1440-roadmap-png.png'), fullPage: false })
      await page.selectOption('#output', 'svg')
      await page.screenshot({ path: join(screenshots, '1440-roadmap-svg.png'), fullPage: false })
      await page.selectOption('#category', '')
      await page.locator('#semantic-publishing').scrollIntoViewIfNeeded()
      outputSelection = { svg, png }
    }

    const issues = []
    if (state.theme !== scheme) issues.push('appearance switch did not update the complete document')
    if (state.overflow > 1 || state.outside.length) issues.push('page contains horizontal overflow')
    if (state.sidebarVisible !== state.expectedDesktopNavigation)
      issues.push('desktop navigation visibility is incorrect')
    if (state.mobileBarVisible === state.expectedDesktopNavigation)
      issues.push('compact navigation visibility is incorrect')
    if (state.capabilityCards !== 4 || !state.code || !state.mermaid || !state.chart || !state.report) {
      issues.push('semantic publishing examples are not rendered')
    }
    if (state.guideCards !== 9 || !state.completeGuides || !state.completePatternQuestions) {
      issues.push('human and machine narrative guidance is incomplete')
    }
    if (state.capabilityTop < state.controlsBottom - 2) issues.push('anchor target is obscured by sticky navigation')
    if (consoleErrors.length) issues.push('browser emitted console errors')
    if (
      outputSelection &&
      (!outputSelection.svg.roadmapSource.endsWith('.svg') || !outputSelection.png.roadmapSource.endsWith('.png'))
    ) {
      issues.push('SVG and PNG output selection is inconsistent')
    }

    if ((width === 390 || width === 1440) && (scheme === 'light' || scheme === 'dark')) {
      await page.screenshot({
        path: join(screenshots, `${width}-${scheme}.png`),
        fullPage: false,
      })
    }
    if (width === 390 && scheme === 'light') {
      await page.selectOption('#category', 'faq')
      await page.selectOption('#output', 'svg')
      await page.locator('#pattern-faq-list').scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(screenshots, '390-faq-svg.png'), fullPage: false })
    }
    cases.push({
      width,
      height,
      scheme,
      status: issues.length ? 'failed' : 'passed',
      issues,
      state,
      outputSelection,
      consoleErrors,
    })
    await page.close()
  }
}

await browser.close()
const failed = cases.filter((entry) => entry.status === 'failed')
await writeFile(
  join(gallery, 'page-validation.json'),
  `${JSON.stringify(
    {
      schema_version: '1',
      renderer: 'chromium',
      status: failed.length ? 'failed' : 'passed',
      checks: [
        'complete light and dark appearance',
        'desktop and compact navigation',
        'horizontal overflow and viewport containment',
        'sticky-anchor visibility',
        'semantic and narrative guidance for humans and machine agents',
        'code, diagram, chart, and report story examples',
        'explicit SVG and PNG preview selection from one validated composition baseline',
        'browser console errors',
        'review screenshots at 390 px and 1440 px',
      ],
      cases,
    },
    null,
    2,
  )}\n`,
)

if (failed.length) {
  for (const entry of failed) console.error(`${entry.width}/${entry.scheme}: ${entry.issues.join('; ')}`)
  process.exitCode = 1
} else {
  console.log(`Browser-validated the complete pattern gallery in ${cases.length} responsive appearance cases.`)
}
