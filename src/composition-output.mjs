import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import { accessibleCompositionText, compositionFont, renderCompositionArtifact } from './composition-svg.mjs'
import { renderVisualCompositionHtml } from './composition-html.mjs'
import { renderMarkdown } from './markdown.mjs'
import { materializeReportCharts } from './report-charts.mjs'
import { patternRegistryHash, resolvePattern } from './composition-registry.mjs'
import { contentkitFontFace } from './typography.mjs'
import { sha256 } from './utils.mjs'

const wasm = readFileSync(fileURLToPath(import.meta.resolve('@resvg/resvg-wasm/index_bg.wasm')))
let wasmReady

async function readyWasm() {
  wasmReady ||= initWasm(wasm)
  await wasmReady
}

export async function renderCompositionPng(svg) {
  await readyWasm()
  const renderer = new Resvg(svg, {
    font: { fontBuffers: [compositionFont], defaultFontFamily: contentkitFontFace },
    textRendering: 2,
    shapeRendering: 2,
  })
  try {
    return Buffer.from(renderer.render().asPng())
  } finally {
    renderer.free()
  }
}

export async function materializeComposition(
  rendered,
  { settings = {}, viewport, container, emit, formats = ['svg', 'png'] } = {},
) {
  if (!rendered.composition) return rendered
  const requestedFormats = new Set(formats)
  const unknownFormat = [...requestedFormats].find((format) => !['svg', 'png'].includes(format))
  if (unknownFormat)
    throw Object.assign(new Error(`unknown composition format "${unknownFormat}"`), { statusCode: 422 })
  const assets = {}
  for (const scheme of ['light', 'dark']) {
    const artifact = renderCompositionArtifact(rendered, { settings, scheme, viewport, container })
    const svg = artifact.svg
    assets[scheme] = {
      svg,
      svg_sha256: sha256(svg),
      svg_url: emit && requestedFormats.has('svg') ? emit(svg, { scheme, format: 'svg' }) : null,
      layout_tree: artifact.layout_tree,
      render_tree: artifact.render_tree,
      diagnostics: artifact.diagnostics,
    }
    if (requestedFormats.has('png')) {
      const png = await renderCompositionPng(svg)
      assets[scheme].png = png
      assets[scheme].png_sha256 = sha256(png)
      assets[scheme].png_url = emit ? emit(png, { scheme, format: 'png' }) : null
    }
  }
  const html = rendered.html
  const layoutDiagnostics = assets.light.diagnostics || []
  return {
    ...rendered,
    html,
    accessible_text: accessibleCompositionText(rendered),
    layout_tree: assets.light.layout_tree,
    render_tree: assets.light.render_tree,
    diagnostics: [...(rendered.diagnostics || []), ...layoutDiagnostics],
    composition_assets: assets,
  }
}

export async function compileCompositionMarkdown(
  markdown,
  {
    settings = {},
    scheme = 'light',
    viewport,
    container,
    capabilities = [],
    outputs = ['model', 'html'],
    html_presentation = 'semantic',
  } = {},
) {
  if (!['light', 'dark'].includes(scheme)) {
    throw Object.assign(new Error('scheme must be light or dark'), { statusCode: 422 })
  }
  if (!['semantic', 'visual'].includes(html_presentation)) {
    throw Object.assign(new Error('html_presentation must be semantic or visual'), { statusCode: 422 })
  }
  if (Buffer.byteLength(String(markdown)) > 256 * 1024) {
    throw Object.assign(new Error('composition markdown must be at most 256 KiB'), { statusCode: 422 })
  }
  if (viewport) {
    const width = Number(viewport.width)
    const height = Number(viewport.height)
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 320 ||
      height < 320 ||
      width > 4096 ||
      height > 4096 ||
      width * height > 16_000_000
    ) {
      throw Object.assign(new Error('viewport must be 320-4096 pixels per axis and at most 16 megapixels'), {
        statusCode: 422,
      })
    }
  }
  if (container) {
    const width = Number(container.width)
    const height = container.height == null ? null : Number(container.height)
    if (
      !Number.isInteger(width) ||
      width < 240 ||
      width > 4096 ||
      (height != null && (!Number.isInteger(height) || height < 240 || height > 4096)) ||
      (viewport && width > Number(viewport.width))
    ) {
      throw Object.assign(
        new Error('container must be 240-4096 pixels wide, have an optional bounded height and fit the viewport'),
        { statusCode: 422 },
      )
    }
  }
  if (
    !Array.isArray(capabilities) ||
    capabilities.some((entry) => typeof entry !== 'string') ||
    capabilities.length > 16
  ) {
    throw Object.assign(new Error('capabilities must be a list of at most 16 strings'), { statusCode: 422 })
  }
  if (!Array.isArray(outputs) || !outputs.length) {
    throw Object.assign(new Error('outputs must be a non-empty array'), { statusCode: 422 })
  }
  const chosen = new Set(outputs)
  const unknown = [...chosen].find((entry) => !['model', 'html', 'svg', 'png', 'print'].includes(entry))
  if (unknown) throw Object.assign(new Error(`unknown composition output "${unknown}"`), { statusCode: 422 })
  const parsed = await renderMarkdown(markdown)
  if (!parsed.composition) throw Object.assign(new Error('compile requires layout: composition'), { statusCode: 422 })
  const resolved =
    viewport || container || capabilities.length
      ? reResolveComposition(parsed, { viewport, container, capabilities })
      : parsed
  const charted = materializeReportCharts(resolved, { settings, locale: parsed.meta.locale })
  const result = await materializeComposition(charted, {
    settings,
    viewport,
    container,
    formats: chosen.has('png') ? ['svg', 'png'] : chosen.has('svg') ? ['svg'] : [],
  })
  const asset = result.composition_assets[scheme]
  const html =
    html_presentation === 'visual' ? renderVisualCompositionHtml(result, asset.layout_tree, { scheme }) : result.html
  return {
    schema_version: '1',
    semantic: result.semantic,
    narrative: result.narrative,
    composition: result.composition,
    layout: result.layout_tree,
    render_tree: result.render_tree,
    diagnostics: result.diagnostics,
    accessible_text: result.accessible_text,
    rendering: {
      html_presentation,
      fidelity: html_presentation === 'visual' ? 'layout-equivalent' : 'semantic',
      canonical_static_output: 'svg',
      png_role: 'derived-static-export',
    },
    renders: {
      ...(chosen.has('html') ? { html } : {}),
      ...(chosen.has('print') ? { print_html: `<div class="composition-print">${html}</div>` } : {}),
      ...(chosen.has('svg') ? { svg: asset.svg } : {}),
      ...(chosen.has('png') ? { png_base64: asset.png.toString('base64'), png_media_type: 'image/png' } : {}),
    },
    hashes: {
      registry_sha256: patternRegistryHash,
      ...(chosen.has('svg') ? { svg_sha256: asset.svg_sha256 } : {}),
      ...(chosen.has('png') ? { png_sha256: asset.png_sha256 } : {}),
      model_sha256: createHash('sha256').update(JSON.stringify(result.composition)).digest('hex'),
    },
  }
}

export function reResolveComposition(
  rendered,
  { preferred_pattern, viewport, container, capabilities, narrative } = {},
) {
  const preferences = {
    ...rendered.meta.composition,
    preferred_pattern: preferred_pattern || rendered.meta.composition.preferred_pattern,
    capabilities: capabilities || [],
    narrative: narrative || rendered.narrative || null,
  }
  const resolved = resolvePattern(rendered.semantic, preferences, {
    ...(viewport || {}),
    ...(container ? { container } : {}),
  })
  return {
    ...rendered,
    composition: {
      ...rendered.composition,
      requested_pattern: resolved.requested_pattern,
      resolved_pattern: resolved.resolved_pattern,
      recommendations: resolved.recommendations.slice(0, 5),
    },
    diagnostics: resolved.diagnostics,
  }
}
