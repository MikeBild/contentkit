/* global document, innerWidth, getComputedStyle */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { patternRegistry } from '../src/composition-registry.mjs'
import { compileCompositionMarkdown } from '../src/composition-output.mjs'
import { contentkitFontFaceCss, contentkitFontFile } from '../src/typography.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const gallery = join(root, 'examples/pattern-gallery')
const siteCss = await readFile(join(root, 'assets/site.css'), 'utf8')
const compositionJs = await readFile(join(root, 'assets/composition.js'), 'utf8')
const font = (await readFile(contentkitFontFile)).toString('base64')
const fontCss = contentkitFontFaceCss(`data:font/woff2;base64,${font}`)
const viewports = [
  { width: 320, height: 900 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 1024 },
  { width: 1440, height: 1024 },
  { width: 1600, height: 900 },
]
const schemes = ['light', 'dark']
const informationCategories = new Set([
  'faq',
  'code',
  'pricing',
  'gallery',
  'stats',
  'table',
  'dashboard',
  'application',
])
const informationPatterns = patternRegistry.filter((pattern) => informationCategories.has(pattern.category))
const sources = new Map()
const rendered = new Map()

for (const pattern of patternRegistry) {
  const source = await readFile(join(root, 'examples/compositions', `${pattern.id}.en.md`), 'utf8')
  sources.set(pattern.id, source)
}

async function visualHtml(pattern, viewport, scheme) {
  const key = `${pattern.id}:${viewport.width}:${viewport.height}:${scheme}`
  if (!rendered.has(key)) {
    const result = await compileCompositionMarkdown(sources.get(pattern.id), {
      scheme,
      viewport,
      container: viewport,
      outputs: ['html'],
      html_presentation: 'visual',
    })
    rendered.set(key, result.renders.html)
  }
  return rendered.get(key)
}

function pageSource(html, { scheme, zoom = false } = {}) {
  return `<!doctype html><html lang="de" class="${scheme === 'dark' ? 'dark' : ''}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${fontCss}${siteCss}:root{color-scheme:${scheme};--container:76rem}${scheme === 'dark' ? ':root{--background:240 10% 3.9%;--foreground:0 0% 98%;--muted:240 3.7% 15.9%;--muted-foreground:240 5% 64.9%;--border:240 3.7% 28%;--primary:0 0% 98%;--primary-foreground:240 5.9% 10%}' : ''}${zoom ? 'html{font-size:200%}' : ''}</style></head><body><main class="container prose composition-prose">${html}</main></body></html>`
}

async function inspect(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    }
    const offenders = [...document.querySelectorAll('body *')]
      .filter((element) => visible(element) && !element.closest('pre, .composition-data-table, .report-chart-data'))
      .map((element) => {
        const box = element.getBoundingClientRect()
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className : '',
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
          left: box.left,
          right: box.right,
          width: box.width,
          fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        }
      })
      .filter((entry) => entry.left < -2 || entry.right > innerWidth + 2)
    const textSizes = [...document.querySelectorAll('p,li,summary,figcaption,td,th,button,input,code')]
      .filter(visible)
      .map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
      .filter(Number.isFinite)
    const targets = [...document.querySelectorAll('button,summary,input')].filter(visible).map((element) => {
      const box = element.getBoundingClientRect()
      return {
        tag: element.tagName.toLowerCase(),
        text: element.textContent.trim(),
        width: box.width,
        height: box.height,
      }
    })
    return {
      horizontal_overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      offenders,
      minimum_text_size: textSizes.length ? Math.min(...textSizes) : null,
      undersized_targets: targets.filter((target) => target.height < 43 || target.width < 43),
      table_headers: [...document.querySelectorAll('.composition-data-table table')].map((table) => ({
        headers: table.querySelectorAll('thead th').length,
        rows: table.querySelectorAll('tbody tr').length,
      })),
      faq: {
        questions: document.querySelectorAll('.composition-question').length,
        summaries: document.querySelectorAll('.composition-question > summary').length,
        open: document.querySelectorAll('.composition-question[open]').length,
      },
      code: {
        variants: document.querySelectorAll('.composition-code-variant').length,
        hidden: document.querySelectorAll('.composition-code-variant[hidden]').length,
        tabs: document.querySelectorAll('[role="tab"]').length,
      },
      shells: {
        navigation: document.querySelectorAll('.composition-shell-navigation').length,
        main: document.querySelectorAll('.composition-shell-main').length,
      },
    }
  })
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const cases = []

for (const pattern of patternRegistry) {
  for (const scheme of schemes) {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await page.setContent(pageSource(await visualHtml(pattern, viewport, scheme), { scheme }), {
        waitUntil: 'domcontentloaded',
      })
      await page.evaluate(() => document.fonts.ready)
      const result = await inspect(page)
      const issues = []
      if (result.horizontal_overflow > 2)
        issues.push({ code: 'html.horizontal-overflow', value: result.horizontal_overflow })
      if (result.offenders.length)
        issues.push({ code: 'html.element-outside-viewport', elements: result.offenders.slice(0, 8) })
      if (result.minimum_text_size != null && result.minimum_text_size < 14) {
        issues.push({ code: 'html.text-too-small', value: result.minimum_text_size })
      }
      if (result.undersized_targets.length) {
        issues.push({ code: 'html.target-too-small', targets: result.undersized_targets.slice(0, 8) })
      }
      if (pattern.category === 'faq' && result.faq.questions !== result.faq.summaries) {
        issues.push({ code: 'faq.summary-missing', value: result.faq })
      }
      if (pattern.category === 'faq' && result.faq.open !== result.faq.questions) {
        issues.push({ code: 'faq.no-js-answer-hidden', value: result.faq })
      }
      if (pattern.category === 'code' && result.code.hidden) {
        issues.push({ code: 'code.no-js-variant-hidden', value: result.code })
      }
      if (pattern.category === 'table' && result.table_headers.some((table) => !table.headers || !table.rows)) {
        issues.push({ code: 'table.structure-incomplete', value: result.table_headers })
      }
      cases.push({
        pattern: pattern.id,
        scheme,
        width: viewport.width,
        mode: 'no-js',
        status: issues.length ? 'failed' : 'passed',
        issues,
      })
    }
  }
}

for (const pattern of informationPatterns) {
  for (const viewport of [viewports[0], viewports[2], viewports[5]]) {
    await page.setViewportSize(viewport)
    await page.setContent(pageSource(await visualHtml(pattern, viewport, 'light'), { scheme: 'light', zoom: true }), {
      waitUntil: 'domcontentloaded',
    })
    await page.evaluate(() => document.fonts.ready)
    const result = await inspect(page)
    const issues = []
    if (result.horizontal_overflow > 2)
      issues.push({ code: 'zoom.horizontal-overflow', value: result.horizontal_overflow })
    if (result.offenders.length)
      issues.push({ code: 'zoom.element-outside-viewport', elements: result.offenders.slice(0, 8) })
    cases.push({
      pattern: pattern.id,
      scheme: 'light',
      width: viewport.width,
      mode: 'text-zoom-200',
      status: issues.length ? 'failed' : 'passed',
      issues,
    })
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.setContent(
    pageSource(await visualHtml(pattern, { width: 390, height: 844 }, 'light'), { scheme: 'light' }),
    {
      waitUntil: 'domcontentloaded',
    },
  )
  await page.addScriptTag({ content: compositionJs })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const enhancedIssues = []
  const category = pattern.category
  if (category === 'code') {
    const tabs = page.locator('[role="tab"]')
    if ((await tabs.count()) > 1) {
      await tabs.first().focus()
      await page.keyboard.press('ArrowRight')
      if ((await page.locator('[role="tab"][aria-selected="true"]').count()) !== 1) {
        enhancedIssues.push({ code: 'code.tab-selection-invalid' })
      }
    }
  }
  if (category === 'table') {
    if (!(await page.locator('.composition-table-sort').count()))
      enhancedIssues.push({ code: 'table.sort-control-missing' })
    if (!(await page.locator('.composition-table-controls input').count())) {
      enhancedIssues.push({ code: 'table.filter-control-missing' })
    }
  }
  if (category === 'application' && (await page.locator('.composition-shell-navigation').count())) {
    const toggle = page.locator('.composition-shell-toggle')
    if (!(await toggle.count())) enhancedIssues.push({ code: 'shell.toggle-missing' })
    else {
      await toggle.click()
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
        enhancedIssues.push({ code: 'shell.toggle-state-invalid' })
      }
    }
  }
  if (category === 'faq') {
    const summary = page.locator('.composition-question > summary').first()
    if (await summary.count()) {
      await summary.focus()
      await page.keyboard.press('Space')
      if ((await summary.evaluate((element) => element === document.activeElement)) !== true) {
        enhancedIssues.push({ code: 'faq.focus-lost' })
      }
    }
  }
  const motion = await page.evaluate(() =>
    [...document.querySelectorAll('*')].some(
      (element) => Number.parseFloat(getComputedStyle(element).transitionDuration) > 0.01,
    ),
  )
  if (motion) enhancedIssues.push({ code: 'reduced-motion.not-respected' })
  cases.push({
    pattern: pattern.id,
    scheme: 'light',
    width: 390,
    mode: 'enhanced-keyboard-reduced-motion',
    status: enhancedIssues.length ? 'failed' : 'passed',
    issues: enhancedIssues,
  })

  await page.emulateMedia({ media: 'print' })
  const printIssues = await page.evaluate(() => {
    const issues = []
    if (
      [...document.querySelectorAll('.composition-code-variant')].some(
        (element) => getComputedStyle(element).display === 'none',
      )
    ) {
      issues.push({ code: 'print.code-variant-hidden' })
    }
    if (
      [...document.querySelectorAll('.composition-data-table > table')].some(
        (element) => getComputedStyle(element).display === 'none',
      )
    ) {
      issues.push({ code: 'print.table-hidden' })
    }
    return issues
  })
  cases.push({
    pattern: pattern.id,
    scheme: 'light',
    width: 390,
    mode: 'print',
    status: printIssues.length ? 'failed' : 'passed',
    issues: printIssues,
  })
  await page.emulateMedia({ media: 'screen', reducedMotion: 'no-preference' })
}

await browser.close()
const failed = cases.filter((entry) => entry.status === 'failed')
await writeFile(
  join(gallery, 'html-validation.json'),
  `${JSON.stringify(
    {
      schema_version: '1',
      renderer: 'chromium',
      status: failed.length ? 'failed' : 'passed',
      checks: [
        'six widths and light/dark visual HTML',
        'no-JavaScript content completeness',
        '200% browser root text zoom',
        'minimum text and 44px interactive targets',
        'FAQ disclosure keyboard behavior',
        'code tab keyboard behavior and complete print fallback',
        'table headers, sort/filter controls and complete print fallback',
        'application-shell navigation toggle',
        'reduced-motion behavior',
      ],
      cases,
    },
    null,
    2,
  )}\n`,
)

if (failed.length) {
  for (const entry of failed.slice(0, 80)) {
    console.error(
      `${entry.pattern}/${entry.mode}/${entry.width}: ${entry.issues.map((issue) => issue.code).join(', ')}`,
    )
  }
  console.error(`HTML browser validation found ${failed.length} failing cases of ${cases.length}.`)
  process.exitCode = 1
} else {
  console.log(`Browser-validated ${cases.length} visual HTML cases across ${patternRegistry.length} patterns.`)
}
