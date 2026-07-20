/* global document, getComputedStyle */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { compileDeck } from '../src/decks.mjs'
import { createDeckRenderer } from '../src/deck-renderer.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const work = await mkdtemp(join(tmpdir(), 'contentkit-deck-showcase-'))
const screenshotDirectory = process.env.CONTENTKIT_DECK_SCREENSHOTS_DIR
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const normalizeHeading = (value) =>
  value.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()

const renderer = createDeckRenderer(
  {
    root,
    version: 'showcase-browser-validation',
    deckBuildConcurrency: 1,
    deckBuildQueueMax: 1,
    deckBuildTimeoutMs: 120000,
    deckQueueTimeoutMs: 120000,
    deckCacheMax: 2,
    deckWorkDir: join(work, 'builds'),
    deckSlidevCli: join(root, 'node_modules', '@slidev', 'cli', 'bin', 'slidev.mjs'),
  },
  { debug() {} },
)

const source = await readFile(join(root, 'examples', 'decks', 'contentkit-semantic-publishing.en.md'), 'utf8')
const settings = {
  accent: '221 83% 53%',
  theme: {
    tokens: {
      brand_label: 'CONTENTKIT',
      font_family: 'Inter, ui-sans-serif, system-ui, sans-serif',
    },
  },
}

function validateMetrics(metrics, { slide, expectsVisual, scheme }) {
  assert.equal(metrics.pageCount, 1, `${slide.title}: exactly one slide must be visible`)
  assert.equal(metrics.containsDeckRole, false, `${slide.title}: deckRole leaked into rendered content`)
  assert.match(metrics.fontFamily, /^Inter(?:,|$)/, `${slide.title}: site typography was not applied`)
  assert.equal(metrics.fontReady, true, `${slide.title}: embedded Inter font was not ready`)
  assert.equal(metrics.headingInside, true, `${slide.title}: heading crossed the slide canvas`)
  assert.equal(metrics.headingTextInside, true, `${slide.title}: rendered heading text crossed the slide canvas`)
  assert.equal(
    normalizeHeading(metrics.headingText),
    normalizeHeading(slide.title),
    `${slide.title}: the published heading differs from its source`,
  )
  assert.equal(metrics.contentInside, true, `${slide.title}: information-bearing content crossed the slide canvas`)
  assert.equal(metrics.visiblePictures, expectsVisual ? 1 : 0, `${slide.title}: visible visual-scheme count is wrong`)
  if (expectsVisual) {
    assert.equal(metrics.pictureOpacity, '1', `${slide.title}: inherited opacity reduced visual contrast`)
    assert.equal(metrics.pictureLoaded, true, `${slide.title}: semantic visual did not load`)
    assert.equal(metrics.visibleScheme, scheme, `${slide.title}: the wrong visual scheme is visible`)
  }
  assert.deepEqual(metrics.remoteResources, [], `${slide.title}: released deck attempted a remote runtime request`)
}

async function inspect(page, slide, expectsVisual, scheme) {
  await page.goto(`${page.url().split('#')[0]}#/${slide.index + 1}`)
  await page.waitForFunction((index) => {
    const candidate = document.querySelector(`.slidev-page-${index + 1}`)
    return candidate && getComputedStyle(candidate).display !== 'none'
  }, slide.index)
  await page.waitForTimeout(60)
  const metrics = await page.evaluate(async () => {
    const visible = (element) => {
      if (!element) return false
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0
    }
    const pages = [...document.querySelectorAll('.slidev-page')].filter(visible)
    const active = pages[0]
    const layout = active?.querySelector('.slidev-layout')
    const heading = active?.querySelector('h1')
    const pictures = [...(active?.querySelectorAll('picture.contentkit-deck-visual') || [])].filter(visible)
    const pageRect = active?.getBoundingClientRect()
    const inside = (element, tolerance = 1.5) => {
      if (!element || !pageRect) return false
      const rect = element.getBoundingClientRect()
      return (
        rect.left >= pageRect.left - tolerance &&
        rect.top >= pageRect.top - tolerance &&
        rect.right <= pageRect.right + tolerance &&
        rect.bottom <= pageRect.bottom + tolerance
      )
    }
    const rectInside = (rect, tolerance = 1.5) =>
      Boolean(
        rect &&
        pageRect &&
        rect.left >= pageRect.left - tolerance &&
        rect.top >= pageRect.top - tolerance &&
        rect.right <= pageRect.right + tolerance &&
        rect.bottom <= pageRect.bottom + tolerance,
      )
    const headingRange = document.createRange()
    if (heading) headingRange.selectNodeContents(heading)
    const information = [...(layout?.querySelectorAll('h1, p, ul, ol, picture, footer') || [])].filter(visible)
    const picture = pictures[0]
    const image = picture?.querySelector('img')
    return {
      pageCount: pages.length,
      containsDeckRole: /deckRole\s*:/.test(active?.innerText || ''),
      fontFamily: layout ? getComputedStyle(layout).fontFamily : '',
      fontReady: await document.fonts.ready.then(() => document.fonts.check('16px Inter')),
      headingInside: inside(heading),
      headingTextInside: heading ? rectInside(headingRange.getBoundingClientRect()) : false,
      headingText: heading?.textContent?.trim() || '',
      contentInside: information.every((element) => inside(element)),
      visiblePictures: pictures.length,
      pictureOpacity: picture ? getComputedStyle(picture.parentElement).opacity : null,
      pictureLoaded: image ? image.complete && image.naturalWidth > 0 && image.naturalHeight > 0 : false,
      visibleScheme: picture?.classList.contains('deck-visual-dark') ? 'dark' : picture ? 'light' : null,
      remoteResources: performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => /^https?:/i.test(name)),
    }
  })
  validateMetrics(metrics, { slide, expectsVisual, scheme })
  return metrics
}

let browser
try {
  const compiled = await renderer.run((render) =>
    compileDeck(source, {
      settings,
      includeArtifactData: true,
      renderHtml: async (markdown, theme) => (await render(markdown, theme)).html,
    }),
  )
  assert.equal(compiled.plan.settings.template, 'technical-explainer')
  assert.deepEqual(compiled.plan.diagnostics, [])
  assert.equal(compiled.plan.slides.length, 12)
  assert.deepEqual(
    compiled.plan.slides.map((slide) => slide.role),
    compiled.plan.settings.template_contract.narrative_slots,
  )
  const visualSlideIds = new Set(compiled.artifacts.map((artifact) => artifact.slide_id))
  assert.deepEqual(
    compiled.artifacts.map((artifact) => artifact.pattern),
    [
      'before-after',
      'chevron-process',
      'architecture-map',
      'split-comparison',
      'horizontal-timeline',
      'architecture-map',
      'connected-process',
      'connected-process',
      'before-after',
    ],
  )

  const htmlPath = join(work, 'index.html')
  await writeFile(htmlPath, compiled.html)
  const publishedUrl = process.env.CONTENTKIT_DECK_PUBLIC_URL?.trim()
  const url = publishedUrl || pathToFileURL(htmlPath).href
  browser = await chromium.launch({ headless: true })
  const matrix = [
    { name: 'desktop-light', viewport: { width: 1920, height: 1080 }, scheme: 'light' },
    { name: 'laptop-light', viewport: { width: 1440, height: 900 }, scheme: 'light' },
    { name: 'mobile-light', viewport: { width: 390, height: 844 }, scheme: 'light' },
    { name: 'desktop-dark', viewport: { width: 1920, height: 1080 }, scheme: 'dark' },
  ]
  const screenshots = {}

  for (const entry of matrix) {
    const errors = []
    const context = await browser.newContext({ viewport: entry.viewport, colorScheme: entry.scheme })
    const page = await context.newPage()
    page.on('pageerror', (error) => {
      if (error.message !== 'Wake Lock permission request denied') errors.push(error.message)
    })
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text() !== 'Wake Lock permission request denied') {
        errors.push(message.text())
      }
    })
    await page.goto(`${url}#/1`)
    for (const slide of compiled.plan.slides) {
      await inspect(page, slide, visualSlideIds.has(slide.id), entry.scheme)
    }
    assert.deepEqual(errors, [], `${entry.name}: browser errors were emitted`)

    if (entry.name === 'desktop-light') {
      for (const number of [1, 2, 4, 5, 7, 8, 10, 11, 12]) {
        await page.goto(`${url}#/${number}`)
        await page.waitForFunction(
          (index) => getComputedStyle(document.querySelector(`.slidev-page-${index}`)).display !== 'none',
          number,
        )
        await page.waitForTimeout(60)
        const first = await page.screenshot({ animations: 'disabled' })
        const second = await page.screenshot({ animations: 'disabled' })
        assert.deepEqual(second, first, `slide ${number}: repeated screenshots differ at the pixel level`)
        screenshots[number] = sha256(first)
        if (screenshotDirectory) {
          await mkdir(screenshotDirectory, { recursive: true })
          await writeFile(join(screenshotDirectory, `contentkit-semantic-publishing-${number}.png`), first)
        }
      }
    }
    await context.close()
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        valid: true,
        target: publishedUrl ? 'published' : 'local',
        public_url: publishedUrl || undefined,
        template: compiled.plan.settings.template,
        slides: compiled.plan.slides.length,
        semantic_visuals: compiled.artifacts.length,
        html_sha256: compiled.html_sha256,
        pixel_sha256: screenshots,
        viewports: matrix.map((entry) => entry.name),
      },
      null,
      2,
    )}\n`,
  )
} finally {
  await browser?.close().catch(() => {})
  if (process.env.CONTENTKIT_KEEP_DECK_REVIEW !== '1') await rm(work, { recursive: true, force: true })
  else process.stderr.write(`Deck review artifacts kept at ${work}\n`)
}
