import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { ContentKind } from '@/api/ck'

/**
 * Frontmatter as a form, and back again.
 *
 * The server hashes the source it receives (`source_sha256`), so this module is
 * held to a stricter promise than a normal serializer: a document whose fields
 * nobody touched has to come back meaning exactly what it meant. `detect`
 * therefore records absence as absence — a `composition` block that only says
 * `format: report` must not gain the four defaults the server would apply — and
 * `emit` writes a fixed key order so two saves of the same state produce the
 * same bytes.
 *
 * YAML is produced by the same library the server parses with rather than by
 * hand. `deck.firstSlide`, `extra`, `faq[]` and `composition.limitations[]` are
 * nested, quoted and multi-line in ways a string-building emitter gets wrong
 * once and then silently keeps getting wrong.
 */

export const LAYOUTS = [
  'standard',
  'docs',
  'wiki',
  'knowledge',
  'landing',
  'changelog',
  'composition',
  'deck',
  'report',
] as const
export type Layout = (typeof LAYOUTS)[number]

export const COMPOSITION_FORMATS = ['infographic', 'report'] as const
export const COMPOSITION_CANVASES = ['portrait', 'landscape', 'square', 'flow'] as const
export const COMPOSITION_INTENTS = ['explain', 'compare', 'sequence', 'status', 'explore'] as const
export const COMPOSITION_DENSITIES = ['compact', 'balanced', 'spacious'] as const
export const COMPOSITION_DISCLOSURES = ['overview', 'progressive', 'complete'] as const
export const CHANGE_TYPES = ['added', 'changed', 'deprecated', 'removed', 'fixed', 'security'] as const
export const DECK_TEMPLATES = [
  'freeform',
  'editorial-story',
  'decision-brief',
  'technical-explainer',
  'status-report',
] as const
export const DECK_THEMES = ['neutral', 'editorial'] as const
export const DECK_VISUAL_SCHEMES = ['auto', 'light', 'dark'] as const

export interface CompositionUI {
  format: string
  canvas: string
  intent: string
  density: string
  disclosure: string
  preferredPattern: string
  audience: string
  question: string
  goal: string
  thesis: string
  conclusion: string
  action: string
  limitations: string[]
}

export interface DeckUI {
  template: string
  theme: string
  visualScheme: string
  maxSlides: number | undefined
  firstSlide: Record<string, unknown>
}

export interface FaqEntry {
  q: string
  a: string
}

export interface FrontmatterUI {
  title: string
  slug: string
  translationKey: string
  /** `''` is "not authored", which the server reads as `page`. */
  kind: ContentKind | ''
  locale: string
  summary: string
  tags: string[]

  date: string
  scheduledAt: string
  updatedAt: string
  noindex: boolean | undefined
  featured: boolean | undefined
  audio: boolean | undefined

  layout: Layout | ''
  docKey: string
  docsVersion: string
  parent: string
  navTitle: string
  navOrder: number | undefined
  category: string
  releaseVersion: string
  changeTypes: string[]
  reportCadence: string
  reportSeries: string
  /**
   * Kept whether or not the layout uses it. Switching composition → deck →
   * composition must not cost the operator the eight narrative fields they
   * typed, so the state survives the mode and only the emitter is conditional.
   */
  composition: CompositionUI
  /** Present exactly when the document authored one, so absence stays absence. */
  hasComposition: boolean
  deck: DeckUI
  hasDeck: boolean

  cover: string
  coverAlt: string
  externalUrl: string
  technologies: string[]

  tldr: string[]
  faq: FaqEntry[]
  related: string[]
  access: string[]

  extra: Record<string, unknown>
  /** Frontmatter keys no field below claims, written back untouched. */
  carried: Record<string, unknown>
  /**
   * Which of two accepted spellings the document used — `date` or `publishedAt`,
   * `cover` or `image`. Emitting the other one would rewrite an author's file
   * for no reason, and the roundtrip guard would rightly refuse the save.
   */
  aliases: Record<string, string>
}

export interface ParsedDocument {
  frontmatter: Record<string, unknown>
  body: string
  /** The source exactly as it arrived, for a diff against what is emitted. */
  raw: string
}

// The newline before the closing fence is optional so that an *empty* block —
// `---\n---\n`, which the server accepts and which this parser used to report as
// "never closed" — matches with an empty capture. Everything else is unchanged:
// the capture is still lazy, so a `---` inside a value is only treated as the
// terminator when what follows it is a line end.
const FENCE = /^---\r?\n([\s\S]*?)(?:\r?\n)?---(?:\r?\n|$)/

export class FrontmatterError extends Error {}

/**
 * The server's own two rules: the block opens the file, and it is terminated.
 * A document with no block at all is legal and has an empty frontmatter.
 */
export function parseDocument(source: string): ParsedDocument {
  const text = source ?? ''
  if (!/^---\r?\n/.test(text)) return { frontmatter: {}, body: stripLeadingBlank(text), raw: text }
  const match = FENCE.exec(text)
  if (!match) throw new FrontmatterError('The frontmatter block is never closed with ---')
  let data: unknown
  try {
    data = parseYaml(match[1]!, { maxAliasCount: 20 }) ?? {}
  } catch (failure) {
    throw new FrontmatterError(`Invalid YAML frontmatter: ${failure instanceof Error ? failure.message : failure}`)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new FrontmatterError('Frontmatter must be a YAML mapping')
  }
  return { frontmatter: data as Record<string, unknown>, body: stripLeadingBlank(text.slice(match[0].length)), raw: text }
}

// The blank line between the closing fence and the body is punctuation, not
// content: keeping it would grow by one line on every save, and the renderer
// treats leading blank lines as nothing at all.
function stripLeadingBlank(body: string) {
  return body.replace(/^(?:\r?\n)+/, '')
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const text = (value: unknown) => (value == null ? '' : typeof value === 'object' ? '' : String(value))
const flag = (value: unknown) => (typeof value === 'boolean' ? value : undefined)
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const list = (value: unknown) =>
  Array.isArray(value) ? value.filter((entry) => entry != null && typeof entry !== 'object').map(String) : []

/** The keys this form renders. Everything else in the block is carried through. */
const OWNED_KEYS = new Set([
  'title',
  'slug',
  'translationKey',
  'translation_key',
  'kind',
  'locale',
  'summary',
  'tags',
  'date',
  'publishedAt',
  'scheduledAt',
  'updatedAt',
  'noindex',
  'featured',
  'audio',
  'layout',
  'docKey',
  'docsVersion',
  'parent',
  'navTitle',
  'navOrder',
  'category',
  'releaseVersion',
  'changeTypes',
  'reportCadence',
  'reportSeries',
  'composition',
  'deck',
  'cover',
  'image',
  'coverAlt',
  'imageAlt',
  'externalUrl',
  'technologies',
  'tldr',
  'faq',
  'related',
  'access',
  'extra',
])

export function emptyComposition(): CompositionUI {
  return {
    format: '',
    canvas: '',
    intent: '',
    density: '',
    disclosure: '',
    preferredPattern: '',
    audience: '',
    question: '',
    goal: '',
    thesis: '',
    conclusion: '',
    action: '',
    limitations: [],
  }
}

export function emptyDeck(): DeckUI {
  return { template: '', theme: '', visualScheme: '', maxSlides: undefined, firstSlide: {} }
}

export function detect(frontmatter: Record<string, unknown>): FrontmatterUI {
  const source = frontmatter ?? {}
  const aliases: Record<string, string> = {}
  const pick = (primary: string, alternative: string) => {
    const used = primary in source ? primary : alternative in source ? alternative : primary
    if (used !== primary) aliases[primary] = used
    return source[used]
  }

  const composition = isObject(source.composition) ? source.composition : {}
  const deck = isObject(source.deck) ? source.deck : {}
  const kind: ContentKind | '' = (['page', 'post', 'project', 'deck'] as const).includes(source.kind as ContentKind)
    ? (source.kind as ContentKind)
    : ''
  // A `deck:` block on anything that is not a deck is dead weight the server
  // ignores rather than rejects, so it is carried instead of edited — the form
  // would otherwise delete a key nobody asked it to touch.
  const strayDeck = kind !== 'deck' && 'deck' in source ? { deck: source.deck } : {}
  // The same asymmetry the other way round. `toWire` refuses to emit
  // `composition`/`reportCadence`/`reportSeries` unless the layout resolves to
  // `composition`, because the combination is a 422 — but they are owned keys,
  // so without this they were neither emitted nor carried, and merely *opening*
  // a `layout: standard` document that has a `composition:` block produced
  // roundtrip drift and an unexplained refusal to save a legal file.
  const layout = text(source.layout)
  const composed = layout === 'composition' || layout === 'report'
  const strayComposition = composed
    ? {}
    : Object.fromEntries(
        (['composition', 'reportCadence', 'reportSeries'] as const)
          .filter((key) => key in source)
          .map((key) => [key, source[key]]),
      )

  return {
    title: text(source.title),
    slug: text(source.slug),
    translationKey: text(pick('translationKey', 'translation_key')),
    kind,
    locale: text(source.locale),
    summary: text(source.summary),
    tags: list(source.tags),

    date: text(pick('date', 'publishedAt')),
    scheduledAt: text(source.scheduledAt),
    updatedAt: text(source.updatedAt),
    noindex: flag(source.noindex),
    featured: flag(source.featured),
    audio: flag(source.audio),

    layout: (LAYOUTS as readonly string[]).includes(text(source.layout)) ? (text(source.layout) as Layout) : '',
    docKey: text(source.docKey),
    docsVersion: text(source.docsVersion),
    parent: text(source.parent),
    navTitle: text(source.navTitle),
    navOrder: num(source.navOrder),
    category: text(source.category),
    releaseVersion: text(source.releaseVersion),
    changeTypes: list(source.changeTypes),
    reportCadence: text(source.reportCadence),
    reportSeries: text(source.reportSeries),

    composition: {
      format: text(composition.format),
      canvas: text(composition.canvas),
      intent: text(composition.intent),
      density: text(composition.density),
      disclosure: text(composition.disclosure),
      preferredPattern: text(composition.preferredPattern),
      audience: text(composition.audience),
      question: text(composition.question),
      goal: text(composition.goal),
      thesis: text(composition.thesis),
      conclusion: text(composition.conclusion),
      action: text(composition.action),
      limitations: list(composition.limitations),
    },
    hasComposition: 'composition' in source,
    deck: {
      template: text(deck.template),
      theme: text(deck.theme),
      visualScheme: text(deck.visualScheme),
      maxSlides: num(deck.maxSlides),
      firstSlide: isObject(deck.firstSlide) ? deck.firstSlide : {},
    },
    hasDeck: kind === 'deck' && 'deck' in source,

    cover: text(pick('cover', 'image')),
    coverAlt: text(pick('coverAlt', 'imageAlt')),
    externalUrl: text(source.externalUrl),
    technologies: list(source.technologies),

    tldr: list(source.tldr),
    faq: Array.isArray(source.faq)
      ? source.faq.filter(isObject).map((entry) => ({ q: text(entry.q), a: text(entry.a) }))
      : [],
    related: list(source.related),
    access: list(source.access),

    extra: isObject(source.extra) ? source.extra : {},
    carried: {
      ...Object.fromEntries(Object.entries(source).filter(([key]) => !OWNED_KEYS.has(key))),
      ...strayDeck,
      ...strayComposition,
    },
    aliases,
  }
}

/**
 * The wire object, in one fixed order.
 *
 * Order is the difference between a diff an author can read and a diff that
 * looks like the whole file was rewritten. Carried keys keep their own relative
 * order and come last, where they cannot displace anything.
 */
export function toWire(ui: FrontmatterUI): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const put = (key: string, value: unknown) => {
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return
    out[ui.aliases[key] ?? key] = value
  }

  put('title', ui.title.trim())
  put('slug', ui.slug.trim())
  put('translationKey', ui.translationKey.trim())
  put('kind', ui.kind)
  put('locale', ui.locale.trim().toLowerCase())
  put('summary', ui.summary.trim())
  put('tags', ui.tags)

  put('date', ui.date.trim())
  put('scheduledAt', ui.scheduledAt.trim())
  put('updatedAt', ui.updatedAt.trim())
  put('noindex', ui.noindex)
  put('featured', ui.featured)
  put('audio', ui.audio)

  put('layout', ui.layout)
  put('docKey', ui.docKey.trim())
  put('docsVersion', ui.docsVersion.trim())
  put('parent', ui.parent.trim())
  put('navTitle', ui.navTitle.trim())
  put('navOrder', ui.navOrder)
  put('category', ui.category.trim())
  put('releaseVersion', ui.releaseVersion.trim())
  put('changeTypes', ui.changeTypes)

  // `composition` on anything but a composition, and `reportCadence` without
  // `composition.format: report`, are both 422s. The emitter refuses to write
  // the combination rather than the form reporting it afterwards.
  const composition = resolvedLayout(ui) === 'composition' && ui.hasComposition ? compositionWire(ui.composition) : undefined
  if (composition) out.composition = composition
  if (composition?.format === 'report') {
    put('reportCadence', ui.reportCadence.trim())
    put('reportSeries', ui.reportSeries.trim())
  }
  if (ui.kind === 'deck' && ui.hasDeck) {
    const deck = deckWire(ui.deck)
    if (deck) out.deck = deck
  }

  put('cover', ui.cover.trim())
  put('coverAlt', ui.coverAlt.trim())
  put('externalUrl', ui.externalUrl.trim())
  put('technologies', ui.technologies)

  put('tldr', ui.tldr)
  put('faq', ui.faq)
  put('related', ui.related)
  put('access', ui.access)

  if (Object.keys(ui.extra).length) out.extra = ui.extra
  for (const [key, value] of Object.entries(ui.carried)) out[key] = value
  return out
}

/** The layout the server will resolve, which is what the cross-field rules use. */
export function resolvedLayout(ui: FrontmatterUI): Layout | '' {
  if (ui.layout === 'report') return 'composition'
  if (ui.layout) return ui.layout
  return ui.kind === 'deck' ? 'deck' : ''
}

function compositionWire(composition: CompositionUI): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const put = (key: string, value: string) => {
    if (value.trim()) out[key] = value.trim()
  }
  put('format', composition.format)
  put('canvas', composition.canvas)
  put('intent', composition.intent)
  put('density', composition.density)
  put('preferredPattern', composition.preferredPattern)
  put('audience', composition.audience)
  put('question', composition.question)
  put('goal', composition.goal)
  put('thesis', composition.thesis)
  put('conclusion', composition.conclusion)
  put('action', composition.action)
  if (composition.limitations.length) out.limitations = composition.limitations
  put('disclosure', composition.disclosure)
  return out
}

function deckWire(deck: DeckUI): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  if (deck.template.trim()) out.template = deck.template.trim()
  if (deck.theme.trim()) out.theme = deck.theme.trim()
  if (deck.visualScheme.trim()) out.visualScheme = deck.visualScheme.trim()
  if (deck.maxSlides !== undefined) out.maxSlides = deck.maxSlides
  if (Object.keys(deck.firstSlide).length) out.firstSlide = deck.firstSlide
  return out
}

/**
 * The document as the API takes it.
 *
 * `lineWidth: 0` turns folding off: a summary wrapped at column 80 parses back
 * identically but changes every byte after it, which turns a one-word edit into
 * an unreadable revision diff.
 */
export function emit(ui: FrontmatterUI, body: string): string {
  const data = toWire(ui)
  const trimmed = body.replace(/\s+$/, '')
  if (Object.keys(data).length === 0) return `${trimmed}\n`
  return `---\n${stringifyYaml(data, { lineWidth: 0 })}---\n\n${trimmed}\n`
}

export interface RoundtripDrift {
  /** Keys whose meaning changed. Empty when the form understands the file. */
  keys: string[]
  /**
   * Set only when the re-emitted document could not be read back at all, and
   * carries the parser's own words. That case is a fault in this module rather
   * than a property of the author's file, so it must not be reported as "every
   * key drifted" — the previous behaviour discarded the one precise message the
   * console had and replaced it with a list that explained nothing.
   */
  reason?: string
}

/**
 * The roundtrip guard.
 *
 * Run against the loaded document before "Save" is offered: if reading the
 * frontmatter into the form and writing it straight back out changes what it
 * means, the form does not understand this file and must not be the thing that
 * rewrites it. The answer names the keys, because "cannot save" without them is
 * indistinguishable from a broken console.
 */
export function roundtripDrift(frontmatter: Record<string, unknown>, body: string): RoundtripDrift {
  let reparsed: Record<string, unknown>
  try {
    reparsed = parseDocument(emit(detect(frontmatter), body)).frontmatter
  } catch (failure) {
    return {
      keys: Object.keys(frontmatter),
      reason: failure instanceof Error ? failure.message : String(failure),
    }
  }
  const keys = new Set([...Object.keys(frontmatter), ...Object.keys(reparsed)])
  return { keys: [...keys].filter((key) => JSON.stringify(frontmatter[key]) !== JSON.stringify(reparsed[key])) }
}
