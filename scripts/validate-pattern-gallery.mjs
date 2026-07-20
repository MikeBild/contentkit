import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { patternRegistry } from '../src/composition-registry.mjs'
import { compileCompositionMarkdown } from '../src/composition-output.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const gallery = join(root, 'examples/pattern-gallery')
const themes = {
  background: { light: '#ffffff', dark: '#09090b' },
  card: { light: '#ffffff', dark: '#111113' },
  foreground: { light: '240 10% 3.9%', dark: '0 0% 98%' },
  muted: { light: '240 4.8% 95.9%', dark: '240 3.7% 15.9%' },
  muted_foreground: { light: '240 3.8% 32%', dark: '240 5% 64.9%' },
  border: { light: '#d4d4d8', dark: '#3f3f46' },
  primary: { light: '240 5.9% 10%', dark: '0 0% 98%' },
  primary_foreground: { light: '0 0% 98%', dark: '240 5.9% 10%' },
}
const viewports = {
  320: { width: 320, height: 900 },
  390: { width: 390, height: 844 },
  768: { width: 768, height: 1024 },
  1024: { width: 1024, height: 1024 },
  1440: { width: 1440, height: 1024 },
  1600: { width: 1600, height: 900 },
}

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function attribute(source, name) {
  const value = source.match(new RegExp(`\\b${name}="(-?[\\d.]+)"`))?.[1]
  return value == null ? null : Number(value)
}

function textContent(value) {
  return String(value)
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos);|&#\d+;/g, 'x')
}

function validateSvgGeometry(svg, width, height, label) {
  const tolerance = 1
  const inside = (value, maximum) => Number.isFinite(value) && value >= -tolerance && value <= maximum + tolerance
  for (const match of svg.matchAll(/<rect\b([^>]*)\/>/g)) {
    const x = attribute(match[1], 'x') ?? 0
    const y = attribute(match[1], 'y') ?? 0
    const rectWidth = attribute(match[1], 'width')
    const rectHeight = attribute(match[1], 'height')
    invariant(inside(x, width) && inside(y, height), `${label}: rectangle origin outside viewport`)
    invariant(rectWidth >= 0 && rectHeight >= 0, `${label}: negative rectangle size`)
    invariant(x + rectWidth <= width + tolerance && y + rectHeight <= height + tolerance, `${label}: clipped rectangle`)
  }
  for (const match of svg.matchAll(/<circle\b([^>]*)\/>/g)) {
    const cx = attribute(match[1], 'cx')
    const cy = attribute(match[1], 'cy')
    const radius = attribute(match[1], 'r')
    invariant(
      cx - radius >= -tolerance &&
        cy - radius >= -tolerance &&
        cx + radius <= width + tolerance &&
        cy + radius <= height + tolerance,
      `${label}: clipped circle`,
    )
  }
  for (const match of svg.matchAll(/<line\b([^>]*)\/>/g)) {
    for (const [name, maximum] of [
      ['x1', width],
      ['x2', width],
      ['y1', height],
      ['y2', height],
    ]) {
      invariant(inside(attribute(match[1], name), maximum), `${label}: line endpoint outside viewport`)
    }
  }
  for (const match of svg.matchAll(/<polygon\b[^>]*points="([^"]+)"/g)) {
    for (const point of match[1].trim().split(/\s+/)) {
      const [x, y] = point.split(',').map(Number)
      invariant(inside(x, width) && inside(y, height), `${label}: polygon point outside viewport`)
    }
  }

  const textBoxes = []
  for (const match of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const attrs = match[1]
    const x = attribute(attrs, 'x')
    const y = attribute(attrs, 'y')
    const size = attribute(attrs, 'font-size')
    const anchor = attrs.match(/text-anchor="([^"]+)"/)?.[1] || 'start'
    invariant(inside(x, width) && inside(y, height), `${label}: text anchor outside viewport`)
    const rows = [...match[2].matchAll(/<tspan\b[^>]*>([\s\S]*?)<\/tspan>/g)].map((row) => textContent(row[1]))
    const contentRows = rows.length ? rows : [textContent(match[2])]
    const maxTextWidth = Math.max(...contentRows.map((row) => [...row].length * size * 0.48), 0)
    const left = anchor === 'middle' ? x - maxTextWidth / 2 : anchor === 'end' ? x - maxTextWidth : x
    const right = anchor === 'middle' ? x + maxTextWidth / 2 : anchor === 'end' ? x : x + maxTextWidth
    const boxHeight = size * (0.95 + Math.max(0, contentRows.length - 1) * 1.2)
    invariant(left >= -3 && right <= width + 3, `${label}: likely clipped text "${contentRows[0]}"`)
    invariant(y - size >= -3 && y - size + boxHeight <= height + 3, `${label}: text block outside viewport`)
    if (contentRows.join('').trim()) {
      textBoxes.push({ left, right, top: y - size, bottom: y - size + boxHeight, content: contentRows.join(' ') })
    }
  }
  for (let first = 0; first < textBoxes.length; first += 1) {
    for (let second = first + 1; second < textBoxes.length; second += 1) {
      const a = textBoxes[first]
      const b = textBoxes[second]
      const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (overlapWidth <= 2 || overlapHeight <= 2) continue
      const overlap = overlapWidth * overlapHeight
      const smaller = Math.min((a.right - a.left) * (a.bottom - a.top), (b.right - b.left) * (b.bottom - b.top))
      invariant(overlap / Math.max(1, smaller) < 0.75, `${label}: likely text overlap "${a.content}" / "${b.content}"`)
    }
  }
}

const records = []
const desktopHashes = new Set()
for (const pattern of patternRegistry) {
  const source = await readFile(join(root, 'examples/compositions', `${pattern.id}.en.md`), 'utf8')
  for (const scheme of ['light', 'dark']) {
    for (const [viewportName, viewport] of Object.entries(viewports)) {
      const compiled = await compileCompositionMarkdown(source, {
        settings: { theme: { tokens: themes } },
        scheme,
        viewport,
        outputs: ['model', 'html', 'svg', 'png'],
        html_presentation: 'visual',
      })
      const svg = compiled.renders.svg
      const png = Buffer.from(compiled.renders.png_base64, 'base64')
      const expectedWidth = viewport?.width || Number(svg.match(/<svg[^>]+width="(\d+)"/)?.[1])
      const expectedHeight = viewport?.height || Number(svg.match(/<svg[^>]+height="(\d+)"/)?.[1])
      invariant(svg.includes(`viewBox="0 0 ${expectedWidth} ${expectedHeight}"`), `${pattern.id}: invalid viewBox`)
      invariant(!/NaN|undefined|Infinity/.test(svg), `${pattern.id}: non-finite SVG value`)
      invariant(/aria-labelledby="composition-title composition-description"/.test(svg), `${pattern.id}: no SVG label`)
      invariant(/<title id="composition-title">[^<]+<\/title>/.test(svg), `${pattern.id}: no SVG title`)
      invariant(/<desc id="composition-description">[^<]+<\/desc>/.test(svg), `${pattern.id}: no SVG description`)
      invariant(compiled.accessible_text.length >= 20, `${pattern.id}: accessible text is too short`)
      invariant(
        /class="ck-visual-composition/.test(compiled.renders.html),
        `${pattern.id}: responsive visual HTML is missing`,
      )
      invariant(compiled.rendering.fidelity === 'layout-equivalent', `${pattern.id}: HTML fidelity is not declared`)
      invariant(
        !/<script\b|\bon\w+=/i.test(compiled.renders.html),
        `${pattern.id}: unsafe author-controlled HTML escaped the renderer`,
      )
      invariant(png.subarray(1, 4).toString() === 'PNG', `${pattern.id}: invalid PNG`)
      invariant(png.readUInt32BE(16) === expectedWidth, `${pattern.id}: PNG width differs from viewport`)
      invariant(png.readUInt32BE(20) === expectedHeight, `${pattern.id}: PNG height differs from viewport`)
      validateSvgGeometry(svg, expectedWidth, expectedHeight, `${pattern.id}/${scheme}/${viewportName}`)
      const minimumFontSize = expectedWidth <= 800 ? 14 : expectedWidth <= 1100 ? 15 : 16
      for (const match of svg.matchAll(/font-size="([\d.]+)"/g)) {
        invariant(
          Number(match[1]) >= minimumFontSize,
          `${pattern.id}: text below responsive ${minimumFontSize}px minimum`,
        )
      }
      const responsive = pattern.responsive.find((rule) => viewport.width <= rule.max_width)
      invariant(
        compiled.composition.resolved_pattern === (responsive?.use || pattern.id),
        `${pattern.id}: ${viewportName}px fallback was not resolved exactly`,
      )
      if (pattern.category === 'data') {
        invariant(/<table>/.test(compiled.renders.html), `${pattern.id}: chart source table is missing`)
        const embeddedChart = compiled.renders.html.match(
          /<img src="data:image\/svg\+xml;base64,([^"]+)"[^>]+width="(\d+)"[^>]+height="(\d+)"/,
        )
        invariant(embeddedChart, `${pattern.id}: report HTML chart SVG is missing`)
        const reportSvg = Buffer.from(embeddedChart[1], 'base64').toString('utf8')
        const reportWidth = Number(embeddedChart[2])
        const reportHeight = Number(embeddedChart[3])
        invariant(
          /aria-labelledby="chart-title chart-description"/.test(reportSvg),
          `${pattern.id}: report chart label is missing`,
        )
        if (chartNodeShape(pattern) !== 'series') {
          validateSvgGeometry(
            reportSvg,
            reportWidth,
            reportHeight,
            `${pattern.id}/${scheme}/${viewportName}/report-html`,
          )
          const mobileChart = compiled.renders.html.match(
            /media="\(max-width: 760px\)" srcset="data:image\/svg\+xml;base64,([^"]+)"/,
          )
          invariant(mobileChart, `${pattern.id}: responsive report chart source is missing`)
          validateSvgGeometry(
            Buffer.from(mobileChart[1], 'base64').toString('utf8'),
            390,
            620,
            `${pattern.id}/${scheme}/${viewportName}/report-html-mobile`,
          )
        }
      }
      const stem = `${pattern.id}--neutral-editorial--${scheme}--${viewportName}`
      const generatedSvg = await readFile(join(gallery, 'assets', `${stem}.svg`), 'utf8')
      const generatedPng = await readFile(join(gallery, 'assets', `${stem}.png`))
      const generatedHtml = await readFile(join(gallery, 'assets', `${stem}.html`), 'utf8')
      invariant(generatedSvg === svg, `${pattern.id}: generated SVG drift`)
      invariant(generatedPng.equals(png), `${pattern.id}: generated PNG drift`)
      invariant(generatedHtml.includes(compiled.renders.html), `${pattern.id}: generated visual HTML drift`)
      if (scheme === 'light' && viewportName === '1600') desktopHashes.add(compiled.hashes.svg_sha256)
      records.push({
        pattern: pattern.id,
        requested_pattern: compiled.composition.requested_pattern,
        resolved_pattern: compiled.composition.resolved_pattern,
        scheme,
        viewport: viewportName,
        width: expectedWidth,
        height: expectedHeight,
        svg_sha256: compiled.hashes.svg_sha256,
        png_sha256: compiled.hashes.png_sha256,
        html_fidelity: compiled.rendering.fidelity,
        status: 'passed',
      })
    }
  }
}

function chartNodeShape(pattern) {
  return pattern.accepts.data_shapes[0] || 'series'
}

invariant(desktopHashes.size === patternRegistry.length, 'desktop patterns must produce distinct SVGs')
await writeFile(
  join(gallery, 'validation.json'),
  `${JSON.stringify(
    {
      schema_version: '1',
      status: 'passed',
      checks: [
        'fresh headless compile equals generated visual HTML, SVG and PNG',
        'finite geometry and valid viewport',
        'shape, line, text and PNG bounds match the viewport',
        'likely text clipping and overlap detection',
        'exact pattern and declared fallback resolution at six widths',
        'SVG title and description',
        'responsive SVG type floor: 14px compact and tablet, 15px desktop and 16px wide',
        'accessible text representation',
        'responsive visual HTML structure without author-controlled script or event handlers',
        'embedded desktop and mobile report-chart SVG geometry',
        'distinct pattern geometry',
      ],
      cases: records,
    },
    null,
    2,
  )}\n`,
)

console.log(`Validated ${records.length} real renders across ${patternRegistry.length} patterns.`)
