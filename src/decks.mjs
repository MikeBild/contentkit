import { createHash } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import { parseSync as parseSlidev } from '@slidev/parser'
import { hasCompositionSemantics, renderMarkdown } from './markdown.mjs'
import { compileCompositionMarkdown } from './composition-output.mjs'
import { patternRegistryHash } from './composition-registry.mjs'
import { deckDesignStyle } from './design-system.mjs'
import { DECK_TEMPLATES, deckTemplateRegistryHash, getDeckTemplate, validateDeckTemplate } from './deck-templates.mjs'
import { VERSION } from './version.mjs'

export const DECK_PLAN_SCHEMA_VERSION = '2'
export const DECK_THEMES = Object.freeze(['editorial', 'neutral'])
export const DECK_SCHEMES = Object.freeze(['auto', 'dark', 'light'])

const invalid = (message) => Object.assign(new Error(message), { statusCode: 422 })
const hash = (value) => createHash('sha256').update(value).digest('hex')

function sourceParts(source) {
  const value = String(source || '').replace(/^\uFEFF/, '')
  const match = value.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!match) throw invalid('deck source requires YAML frontmatter')
  let frontmatter
  try {
    frontmatter = parseYaml(match[1]) || {}
  } catch (error) {
    throw invalid(`invalid deck frontmatter: ${error.message}`)
  }
  return { frontmatter, body: value.slice(match[0].length), raw: value }
}

export function splitDeckSlides(source) {
  sourceParts(source)
  let slides
  try {
    slides = parseSlidev(String(source), 'contentkit-deck.md')
      .slides.map((slide) => String(slide.content || '').trim())
      .filter(Boolean)
  } catch (error) {
    throw invalid(`invalid Slidev deck source: ${error.message}`)
  }
  if (!slides.length) throw invalid('deck requires at least one non-empty slide')
  return slides
}

function parsedDeckSlides(source) {
  let parsed
  try {
    parsed = parseSlidev(String(source), 'contentkit-deck.md')
  } catch (error) {
    throw invalid(`invalid Slidev deck source: ${error.message}`)
  }
  const slides = parsed.slides
    .map((slide, index) => ({
      index,
      markdown: String(slide.content || '').trim(),
      raw: String(slide.raw || ''),
      // The first Slidev frontmatter is document headmatter and is rebuilt
      // below. Later frontmatter belongs to one slide and survives compile.
      slide_frontmatter: index > 0 ? slide.frontmatter || {} : {},
      slide_frontmatter_raw: index > 0 ? String(slide.frontmatterRaw || '').trim() : '',
    }))
    .filter((slide) => slide.markdown)
  if (!slides.length) throw invalid('deck requires at least one non-empty slide')
  return slides
}

function titleFor(markdown, index) {
  const heading = markdown.match(/^#{1,3}[ \t]+(.+)$/m)?.[1]
  return String(heading || `Slide ${index + 1}`)
    .replace(/[*_`]/g, '')
    .trim()
    .slice(0, 160)
}

function roleFor(index, total, markdown, explicitRole) {
  if (index === 0) return 'opening'
  if (explicitRole) return String(explicitRole).trim()
  if (index === total - 1) return /source|quelle/i.test(markdown) ? 'sources' : 'conclusion'
  if (/source|quelle/i.test(titleFor(markdown, index))) return 'sources'
  if (/limit|grenze|risiko|caveat|einschränk/i.test(markdown)) return 'limitations'
  if (/next|action|nächste|fazit|conclusion/i.test(markdown)) return 'decision'
  return 'evidence'
}

function sourceReferences(markdown, index) {
  const references = new Set([`slide:${index + 1}`])
  for (const match of String(markdown).matchAll(/\[[^\]]+\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
    if (/^(?:https?:\/\/|\/)/i.test(match[1])) references.add(`url:${match[1]}`)
    if (references.size >= 32) break
  }
  for (const match of String(markdown).matchAll(/\[\^([^\]]+)\]/g)) {
    references.add(`footnote:${match[1]}`)
    if (references.size >= 32) break
  }
  return [...references]
}

function narrativeFrom(meta, rendered, titles) {
  const authored = rendered.narrative || {}
  const question = authored.question || meta.question || `${meta.title}: Was ist die zentrale Aussage?`
  const goal = authored.communication_goal || meta.goal || meta.summary || `Die Evidenz zu ${meta.title} erklären.`
  return {
    target_audience: authored.target_audience || meta.audience || '',
    question,
    communication_goal: goal,
    thesis: authored.thesis || meta.thesis || meta.summary || titles[0],
    story_arc: titles,
    conclusion: authored.conclusion || meta.conclusion || titles.at(-1),
    action: authored.action || meta.action || '',
    limitations: authored.limitations || meta.limitations || [],
    disclosure: authored.disclosure || meta.disclosure || 'progressive',
  }
}

function normalizedSettings(frontmatter, preferences = {}) {
  const authored = frontmatter.deck && typeof frontmatter.deck === 'object' ? frontmatter.deck : {}
  const template = String(preferences.template || authored.template || 'freeform')
  if (!DECK_TEMPLATES.includes(template)) {
    throw invalid(`deck template must be one of ${DECK_TEMPLATES.join(', ')}`)
  }
  const templateDefinition = getDeckTemplate(template)
  const theme = String(preferences.theme || authored.theme || templateDefinition.defaults.theme)
  if (!DECK_THEMES.includes(theme)) throw invalid(`deck theme must be one of ${DECK_THEMES.join(', ')}`)
  const visualScheme = String(preferences.visual_scheme || preferences.visualScheme || authored.visualScheme || 'auto')
  if (!DECK_SCHEMES.includes(visualScheme)) {
    throw invalid(`deck visualScheme must be one of ${DECK_SCHEMES.join(', ')}`)
  }
  const maxSlides = Number(
    preferences.max_slides ?? preferences.maxSlides ?? authored.maxSlides ?? templateDefinition.defaults.max_slides,
  )
  if (!Number.isInteger(maxSlides) || maxSlides < 1 || maxSlides > 120) {
    throw invalid('deck maxSlides must be an integer from 1 to 120')
  }
  const firstSlide = authored.firstSlide && typeof authored.firstSlide === 'object' ? authored.firstSlide : {}
  return { template, theme, visual_scheme: visualScheme, max_slides: maxSlides, first_slide: firstSlide }
}

export async function planDeck(source, preferences = {}) {
  const { frontmatter } = sourceParts(source)
  const rendered = await renderMarkdown(source)
  if (rendered.meta.kind !== 'deck') throw invalid('deck planning requires frontmatter kind: deck')
  const settings = normalizedSettings(frontmatter, preferences)
  const sources = parsedDeckSlides(source)
  if (sources.length > settings.max_slides) {
    throw invalid(`deck has ${sources.length} slides, exceeding maxSlides ${settings.max_slides}`)
  }
  const titles = sources.map((slide, index) => titleFor(slide.markdown, index))
  const slides = sources.map((sourceSlide, index) => {
    const explicitRole = sourceSlide.slide_frontmatter.deckRole || sourceSlide.slide_frontmatter.deck_role || null
    const role = roleFor(index, sources.length, sourceSlide.markdown, explicitRole)
    return {
      id: `slide-${String(index + 1).padStart(3, '0')}-${hash(sourceSlide.raw).slice(0, 8)}`,
      index,
      title: titles[index],
      role,
      role_source: index === 0 || explicitRole ? 'authored' : 'inferred',
      goal: index === 0 ? 'Introduce the central question.' : `Explain ${titles[index]}.`,
      source_sha256: hash(sourceSlide.raw),
      source_refs: sourceReferences(sourceSlide.markdown, index),
      markdown: sourceSlide.markdown,
      slide_frontmatter: sourceSlide.slide_frontmatter,
      slide_frontmatter_raw: sourceSlide.slide_frontmatter_raw,
    }
  })
  const narrative = narrativeFrom(frontmatter, rendered, titles)
  const templateDefinition = getDeckTemplate(settings.template)
  const diagnostics = validateDeckTemplate(templateDefinition, slides)
  const informationArchitecture = {
    opening: slides[0].id,
    sections: slides.map(({ id, title, role }) => ({ id, title, role })),
    conclusion:
      slides.findLast((slide) => slide.role === 'conclusion' || slide.role === 'decision')?.id || slides.at(-1).id,
    sources: slides.filter((slide) => slide.role === 'sources').map((slide) => slide.id),
  }
  const plan = {
    schema_version: DECK_PLAN_SCHEMA_VERSION,
    source_sha256: hash(source),
    compiler: {
      name: 'contentkit',
      version: VERSION,
      pattern_registry_sha256: patternRegistryHash,
      deck_template_registry_sha256: deckTemplateRegistryHash,
    },
    title: rendered.meta.title,
    locale: rendered.meta.locale,
    settings: { ...settings, template_contract: templateDefinition },
    information_architecture: informationArchitecture,
    narrative,
    sources: [
      ...new Set(
        slides.flatMap((slide) => slide.source_refs.filter((reference) => reference !== `slide:${slide.index + 1}`)),
      ),
    ],
    slides,
    diagnostics,
  }
  return { ...plan, plan_sha256: hash(JSON.stringify(plan)) }
}

function compositionSource(plan, slide) {
  return `---\nkind: page\nlayout: composition\ntitle: ${JSON.stringify(slide.title)}\nsummary: ${JSON.stringify(slide.goal)}\nlocale: ${plan.locale}\nslug: ${slide.id}\ncomposition:\n  format: infographic\n  canvas: landscape\n  intent: explain\n  density: balanced\n---\n\n${slide.markdown}\n`
}

const picture = (title, light, dark) => {
  const lightSvg = Buffer.from(light.renders.svg).toString('base64')
  const lightPng = light.renders.png_base64
  if (!dark) {
    return `<picture class="contentkit-deck-visual"><source type="image/svg+xml" srcset="data:image/svg+xml;base64,${lightSvg}"><img alt="${title.replaceAll('"', '&quot;')}" src="data:image/png;base64,${lightPng}"></picture>`
  }
  const darkSvg = Buffer.from(dark.renders.svg).toString('base64')
  const darkPng = dark.renders.png_base64
  return `<picture class="contentkit-deck-visual deck-visual-light"><source type="image/svg+xml" srcset="data:image/svg+xml;base64,${lightSvg}"><img alt="${title.replaceAll('"', '&quot;')}" src="data:image/png;base64,${lightPng}"></picture>\n<picture class="contentkit-deck-visual deck-visual-dark"><source type="image/svg+xml" srcset="data:image/svg+xml;base64,${darkSvg}"><img alt="${title.replaceAll('"', '&quot;')}" src="data:image/png;base64,${darkPng}"></picture>`
}

function sourceFooter(markdown) {
  const links = [...String(markdown).matchAll(/\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)]
    .filter((match) => /^(?:https?:\/\/|\/)/i.test(match[2]))
    .slice(0, 6)
    .map(
      (match) =>
        `<a href="${match[2].replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}" rel="noreferrer">${match[1].replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</a>`,
    )
  return links.length ? `<footer class="contentkit-deck-sources">Sources: ${links.join(' · ')}</footer>` : ''
}

async function compileSlideVisual(plan, slide, settings) {
  if (!hasCompositionSemantics(slide.markdown)) return null
  const input = compositionSource(plan, slide)
  const rendered = await renderMarkdown(input)
  if (!rendered.semantic?.nodes?.length) return null
  const schemes = plan.settings.visual_scheme === 'auto' ? ['light', 'dark'] : [plan.settings.visual_scheme]
  const outputs = {}
  for (const scheme of schemes) {
    outputs[scheme] = await compileCompositionMarkdown(input, {
      settings,
      scheme,
      viewport: { width: 1200, height: 675 },
      container: { width: 1080, height: 560 },
      outputs: ['model', 'svg', 'png'],
    })
  }
  const primary = outputs.light || outputs.dark
  const alternate = outputs.light && outputs.dark ? outputs.dark : null
  return {
    pattern: primary.composition.resolved_pattern,
    diagnostics: primary.diagnostics,
    hashes: Object.fromEntries(
      Object.entries(outputs).map(([scheme, output]) => [
        scheme,
        { svg: output.hashes.svg_sha256, png: output.hashes.png_sha256 },
      ]),
    ),
    outputs,
    markdown: `# ${slide.title}\n\n${picture(slide.title, primary, alternate)}\n\n${sourceFooter(slide.markdown)}\n\n<!--\nContentKit source slide:\n\n${slide.markdown.replaceAll('-->', '--&gt;')}\n-->`,
  }
}

export async function compileDeck(
  source,
  { settings = {}, preferences = {}, renderHtml, includeArtifactData = false } = {},
) {
  const plan = await planDeck(source, preferences)
  const templateErrors = plan.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  if (templateErrors.length) {
    throw invalid(`deck template validation failed: ${templateErrors.map((diagnostic) => diagnostic.code).join(', ')}`)
  }
  const artifacts = []
  const slides = []
  for (const slide of plan.slides) {
    let visual = null
    try {
      visual = await compileSlideVisual(plan, slide, settings)
    } catch (error) {
      plan.diagnostics.push({ code: 'deck.visual-fallback', slide_id: slide.id, message: error.message })
      if (preferences.allow_visual_fallback !== true && preferences.allowVisualFallback !== true) {
        throw invalid(`semantic visual compilation failed for ${slide.id}: ${error.message}`)
      }
    }
    const compiledSlide = visual?.markdown || slide.markdown
    slides.push(slide.slide_frontmatter_raw ? `${slide.slide_frontmatter_raw}\n---\n${compiledSlide}` : compiledSlide)
    if (visual) {
      artifacts.push({
        slide_id: slide.id,
        pattern: visual.pattern,
        hashes: visual.hashes,
        diagnostics: visual.diagnostics,
        ...(includeArtifactData
          ? {
              representations: Object.fromEntries(
                Object.entries(visual.outputs).map(([scheme, output]) => [
                  scheme,
                  { svg: output.renders.svg, png_base64: output.renders.png_base64 },
                ]),
              ),
            }
          : {}),
      })
      slide.composition = { pattern: visual.pattern, hashes: visual.hashes }
    }
  }
  const { frontmatter } = sourceParts(source)
  const contentHeadmatter = Object.fromEntries(
    Object.entries(frontmatter).filter(
      ([key]) =>
        ![
          'deck',
          'kind',
          'layout',
          'locale',
          'slug',
          'translationKey',
          'translation_key',
          'question',
          'goal',
          'thesis',
          'conclusion',
          'action',
          'limitations',
          'disclosure',
        ].includes(key),
    ),
  )
  const headmatter = {
    ...contentHeadmatter,
    ...(frontmatter.deck?.firstSlide || {}),
    theme: 'seriph',
    routerMode: 'hash',
    colorSchema: plan.settings.visual_scheme === 'auto' ? 'all' : plan.settings.visual_scheme,
  }
  const designStyle = deckDesignStyle(settings)
  const compiledSlides = slides
    .map((slide, index) => {
      if (index === 0) return slide
      return `${plan.slides[index].slide_frontmatter_raw ? '\n\n---\n' : '\n\n---\n\n'}${slide}`
    })
    .join('')
  const compiledMarkdown = `---\n${Object.entries(headmatter)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value)}`)
    .join('\n')}\n---\n\n${designStyle}\n\n${compiledSlides}`
  const html = renderHtml ? await renderHtml(compiledMarkdown, plan.settings.theme) : null
  return {
    schema_version: '1',
    plan,
    markdown: compiledMarkdown,
    artifacts,
    ...(html ? { html, html_sha256: hash(html) } : {}),
  }
}
