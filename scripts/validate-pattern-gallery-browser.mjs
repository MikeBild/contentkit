/* global document, getComputedStyle */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const gallery = join(root, 'examples/pattern-gallery')
const assets = join(gallery, 'assets')
const reportOnly = process.argv.includes('--report-only')
const files = (await readdir(assets)).filter((file) => file.endsWith('.svg')).sort()
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const cases = []

function overlap(a, b) {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  if (width <= 2 || height <= 2) return null
  const intersection = width * height
  const smaller = Math.min(a.width * a.height, b.width * b.height)
  return { width, height, ratio: intersection / Math.max(1, smaller) }
}

function inside(outer, inner, tolerance = 2) {
  return (
    inner.left >= outer.left - tolerance &&
    inner.top >= outer.top - tolerance &&
    inner.right <= outer.right + tolerance &&
    inner.bottom <= outer.bottom + tolerance
  )
}

for (const file of files) {
  const source = await readFile(join(assets, file), 'utf8')
  const width = Number(source.match(/<svg[^>]+width="([\d.]+)"/)?.[1])
  const height = Number(source.match(/<svg[^>]+height="([\d.]+)"/)?.[1])
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error(`${file}: missing SVG dimensions`)
  await page.setViewportSize({ width: Math.ceil(width), height: Math.ceil(height) })
  await page.goto(pathToFileURL(join(assets, file)).href)
  const rendered = await page.evaluate(async () => {
    await document.fonts.ready
    const svg = document.querySelector('svg')
    const svgBox = svg.getBoundingClientRect()
    return [...svg.querySelectorAll('text,rect,circle,line,path,polygon,polyline')].map((element, index) => {
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        index,
        tag: element.tagName.toLowerCase(),
        text: element.tagName.toLowerCase() === 'text' ? element.textContent.trim().replace(/\s+/g, ' ') : '',
        fontSize: element.tagName.toLowerCase() === 'text' ? Number.parseFloat(style.fontSize) : null,
        left: box.left - svgBox.left,
        top: box.top - svgBox.top,
        right: box.right - svgBox.left,
        bottom: box.bottom - svgBox.top,
        width: box.width,
        height: box.height,
      }
    })
  })
  const issues = []
  const viewport = { left: 0, top: 0, right: width, bottom: height, width, height }
  const texts = rendered.filter((item) => item.tag === 'text' && item.text)
  const rectangles = rendered.filter(
    (item) =>
      item.tag === 'rect' && item.width * item.height < width * height * 0.95 && item.width > 24 && item.height > 24,
  )
  const separators = rendered.filter((item) => item.tag === 'line' && item.width >= width * 0.7 && item.height <= 4)

  for (const item of rendered) {
    if (item.width === 0 && item.height === 0) continue
    if (!inside(viewport, item, item.tag === 'path' ? 4 : 2)) {
      issues.push({ code: 'element.clipped', element: item.tag, text: item.text, box: item })
    }
  }
  for (let first = 0; first < texts.length; first += 1) {
    const a = texts[first]
    if (a.text.includes('…')) {
      issues.push({ code: 'text.truncated', text: a.text, box: a })
    }
    for (const separator of separators) {
      const separatorY = separator.top + separator.height / 2
      const horizontalOverlap = Math.min(a.right, separator.right) - Math.max(a.left, separator.left)
      if (horizontalOverlap > 8 && separatorY > a.top + 2 && separatorY < a.bottom - 2) {
        issues.push({ code: 'text.crosses-separator', text: a.text, box: a, separator })
      }
    }
    const containers = rectangles
      .filter(
        (rect) =>
          a.left + a.width / 2 >= rect.left &&
          a.left + a.width / 2 <= rect.right &&
          a.top + a.height / 2 >= rect.top &&
          a.top + a.height / 2 <= rect.bottom,
      )
      .sort((one, two) => one.width * one.height - two.width * two.height)
    if (containers[0] && !inside(containers[0], a, 3)) {
      issues.push({ code: 'text.outside-container', text: a.text, box: a, container: containers[0] })
    }
    for (let second = first + 1; second < texts.length; second += 1) {
      const b = texts[second]
      const collision = overlap(a, b)
      if (collision?.ratio >= 0.12) {
        issues.push({ code: 'text.overlap', first: a.text, second: b.text, collision, firstBox: a, secondBox: b })
      }
    }
  }
  cases.push({ file, width, height, status: issues.length ? 'failed' : 'passed', issues })
}

await browser.close()
const failed = cases.filter((entry) => entry.issues.length)
await writeFile(
  join(gallery, 'browser-validation.json'),
  `${JSON.stringify(
    {
      schema_version: '1',
      renderer: 'chromium',
      status: failed.length ? 'failed' : 'passed',
      checks: [
        'actual browser element bounds remain inside the SVG viewport',
        'actual browser text boxes do not overlap',
        'text remains inside its nearest visual container',
        'authored text is not silently truncated',
        'text is not crossed by full-width separators or grid lines',
      ],
      cases,
    },
    null,
    2,
  )}\n`,
)

if (failed.length) {
  for (const entry of failed) {
    console.error(`${entry.file}: ${entry.issues.map((issue) => issue.code).join(', ')}`)
  }
  console.error(
    `Browser validation found ${failed.reduce((sum, entry) => sum + entry.issues.length, 0)} issues in ${failed.length} of ${cases.length} SVGs.`,
  )
  if (!reportOnly) process.exitCode = 1
} else {
  console.log(`Browser-validated ${cases.length} SVGs without clipping, overlap, truncation or separator crossings.`)
}
