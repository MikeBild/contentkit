import type { Site } from '@/api/ck'
import type { components } from '@/api/schema'
import type { Contract, FieldErrors, ValidationContext } from '../contracts/contract'
import { mergeDeep } from '../contracts/merge'
import { PRESENTATION_PRESET, REPORT_CADENCE, THEME_TOKENS, type PresentationPreset } from '../contracts/enums.generated'
import { checkTokenValue, type SchemeValue } from '../fields'
import { canonicalise } from '../path'
import type { SectionSpec } from '../use-form'

/**
 * Everything one `PATCH /v1/sites/{site}` may carry that this form edits.
 *
 * `domains` is deliberately absent: `GET /v1/sites/{site}` does not return the
 * hostname mappings, so the console cannot show a full list — and `domains` is a
 * whole-list write where an empty array deletes every mapping. A form that
 * cannot read a list must not send one, so the key never appears in the request
 * and the mappings are left alone.
 */
export type SiteWire = Pick<Site, 'name' | 'description' | 'base_url' | 'default_locale' | 'settings'>

export type ReportSeries = components['schemas']['ReportSeriesSetting']

/**
 * `settings.presentation.docs.versions[]` as the form holds it.
 *
 * The wire spells the flag `status: 'current' | 'archived'`; the form spells it
 * `current: boolean` so the list can render it as a radio column. "Exactly one
 * version is current" is then a shape the UI cannot express wrongly, instead of
 * a rule two different edits can each break.
 */
export interface DocsVersion {
  id: string
  label: string
  current: boolean
}

/** `{label, url_template}`, the shape `subscribeRow()` and the AI share row consume. */
export interface LinkTarget {
  label: string
  url_template: string
}

/** src/templates.mjs `analyticsTags()` reads exactly these two. */
export const ANALYTICS_PROVIDERS = ['plausible', 'ga4'] as const
export type AnalyticsProvider = (typeof ANALYTICS_PROVIDERS)[number]

/** src/tts.mjs `createTtsProvider()`. `fake` is legal and synthesises nothing. */
export const AUDIO_PROVIDERS = ['google', 'fake'] as const
export type AudioProvider = (typeof AUDIO_PROVIDERS)[number]

/**
 * The settings the form renders, normalised.
 *
 * The shape mirrors the wire on purpose. `settings.theme.custom_css` is the same
 * string in the request, in this object and in the server's 422 — so a rejection
 * lands under the control that caused it instead of in a toast nobody can act
 * on. Absent scalars become `''` and absent booleans stay `undefined`, because
 * the server treats a missing key and an explicit `false` differently and only
 * `undefined` can say "leave the default alone".
 */
export interface OwnedSettings {
  presentation: {
    preset: PresentationPreset | ''
    docs: { versions: DocsVersion[] }
    report_series: ReportSeries[]
  }
  theme: {
    tokens: Record<string, SchemeValue>
    custom_css: string
  }
  accent: string
  theme_color: string
  eyebrow: string
  hero_title: string
  hero_text: string
  profile_image: string
  profile_image_alt: string
  favicon: string
  apple_touch_icon: string
  mask_icon: string
  og_image: string
  og_image_alt: string
  twitter_handle: string
  socials: Record<string, string>
  analytics: { provider: AnalyticsProvider | ''; domain: string; src: string; id: string }
  audio: {
    enabled: boolean | undefined
    provider: AudioProvider | ''
    voice: string
    title: string
    description: string
    author: string
    monthly_char_budget: number | undefined
    auto_rebuild: boolean | undefined
    blogcast_link: boolean | undefined
    blogcast_image: string
    blogcast_category: string
    subscribe_targets: LinkTarget[]
  }
  comments: { enabled: boolean | undefined }
  feedback: { enabled: boolean | undefined }
  turnstile_site_key: string
  search: { index_body: boolean | undefined }
  content: { show_extra: boolean | undefined }
  blog: { subscribe_row: boolean | undefined; subscribe_targets: LinkTarget[] }
  ai: { share_buttons: boolean | undefined; share_targets: LinkTarget[] }
}

export interface SiteSettingsUI {
  identity: { name: string; description: string; base_url: string; default_locale: string }
  settings: OwnedSettings
  /** Everything under `settings` no path below claims, exactly as it arrived. */
  carried: Record<string, unknown>
  /** Dotted carried paths the operator deleted. Applied to the re-read object at save time. */
  removed: string[]
}

/**
 * The leaves this form renders, and the only thing `serialize` is allowed to
 * overwrite. Everything else in the received object is passed back byte for
 * byte — `PATCH` replaces `settings` in full, so a key that is not carried is a
 * key that was deleted by saving an unrelated field.
 */
export const OWNED_PATHS = [
  'presentation.preset',
  'presentation.docs.versions',
  'presentation.report_series',
  'theme.tokens',
  'theme.custom_css',
  'accent',
  'theme_color',
  'eyebrow',
  'hero_title',
  'hero_text',
  'profile_image',
  'profile_image_alt',
  'favicon',
  'apple_touch_icon',
  'mask_icon',
  'og_image',
  'og_image_alt',
  'twitter_handle',
  'socials',
  'analytics.provider',
  'analytics.domain',
  'analytics.src',
  'analytics.id',
  'audio.enabled',
  'audio.provider',
  'audio.voice',
  'audio.title',
  'audio.description',
  'audio.author',
  'audio.monthly_char_budget',
  'audio.auto_rebuild',
  'audio.blogcast_link',
  'audio.blogcast_image',
  'audio.blogcast_category',
  'audio.subscribe_targets',
  'comments.enabled',
  'feedback.enabled',
  'turnstile_site_key',
  'search.index_body',
  'content.show_extra',
  'blog.subscribe_row',
  'blog.subscribe_targets',
  'ai.share_buttons',
  'ai.share_targets',
] as const

// ─────────────────────────────────────────────────────────────────────────────
// Reading the wire. Every accessor is total: settings is one jsonb blob written
// by three versions of this product and by scripts, so a value of the wrong type
// becomes the empty default rather than a crash — and, because it is not the
// form's own path any more, it is still carried back out untouched.
// ─────────────────────────────────────────────────────────────────────────────

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const flag = (value: unknown) => (typeof value === 'boolean' ? value : undefined)
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | '' =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : ''

function stringMap(value: unknown): Record<string, string> {
  if (!isObject(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry === 'string')) as Record<
    string,
    string
  >
}

function targets(value: unknown): LinkTarget[] {
  if (!Array.isArray(value)) return []
  return value.filter(isObject).map((entry) => ({ label: text(entry.label), url_template: text(entry.url_template) }))
}

function tokens(value: unknown): Record<string, SchemeValue> {
  if (!isObject(value)) return {}
  const result: Record<string, SchemeValue> = {}
  for (const key of THEME_TOKENS) {
    const entry = value[key]
    if (typeof entry === 'string') result[key] = entry
    else if (isObject(entry) && typeof entry.light === 'string' && typeof entry.dark === 'string') {
      result[key] = { light: entry.light, dark: entry.dark }
    }
  }
  return result
}

function docsVersions(value: unknown): DocsVersion[] {
  if (!Array.isArray(value)) return []
  return value.filter(isObject).map((entry) => ({
    id: text(entry.id),
    label: text(entry.label),
    current: entry.status === 'current',
  }))
}

function reportSeries(value: unknown): ReportSeries[] {
  if (!Array.isArray(value)) return []
  return value.filter(isObject).map((entry) => ({
    id: text(entry.id),
    label: text(entry.label),
    nav_order: count(entry.nav_order) ?? 0,
    lead_cadence: (oneOf(entry.lead_cadence, REPORT_CADENCE) || 'monthly') as ReportSeries['lead_cadence'],
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Writing the wire.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Empty is absent, not `""`.
 *
 * `hero_title: ''` and a missing `hero_title` are different documents: the
 * second falls back to the site name, the first renders an empty heading. Every
 * field that has a fallback says so in the form, and this is where the promise
 * is kept.
 */
function dropEmpty(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? value : undefined
  if (isObject(value)) {
    const entries = Object.entries(value)
      .map(([key, entry]) => [key, dropEmpty(entry)] as const)
      .filter(([, entry]) => entry !== undefined)
    return entries.length ? Object.fromEntries(entries) : undefined
  }
  return value === '' || value === undefined ? undefined : value
}

/** Removes exactly the named leaves and any container they leave empty behind. */
export function omitPaths(source: Record<string, unknown>, paths: readonly string[]): Record<string, unknown> {
  for (const path of paths) {
    const keys = path.split('.')
    const chain: Record<string, unknown>[] = [source]
    let node: unknown = source
    for (const key of keys.slice(0, -1)) {
      if (!isObject(node)) break
      node = node[key]
      if (isObject(node)) chain.push(node)
    }
    if (chain.length !== keys.length) continue
    delete chain[chain.length - 1]![keys[keys.length - 1]!]
    // A container that only ever held owned leaves must not survive as `{}`:
    // the wire would then carry an empty object where the site had nothing.
    for (let at = chain.length - 1; at > 0; at -= 1) {
      if (Object.keys(chain[at]!).length === 0) delete chain[at - 1]![keys[at - 1]!]
    }
  }
  return source
}

/** The owned half of the request, with every empty leaf already gone. */
function ownedWire(ui: SiteSettingsUI): Record<string, unknown> {
  const { settings } = ui
  return (dropEmpty({
    presentation: {
      preset: settings.presentation.preset,
      docs: {
        versions: settings.presentation.docs.versions.map((entry) => ({
          id: entry.id,
          label: entry.label,
          status: entry.current ? 'current' : 'archived',
        })),
      },
      report_series: settings.presentation.report_series,
    },
    theme: { tokens: settings.theme.tokens, custom_css: settings.theme.custom_css },
    accent: settings.accent,
    theme_color: settings.theme_color,
    eyebrow: settings.eyebrow,
    hero_title: settings.hero_title,
    hero_text: settings.hero_text,
    profile_image: settings.profile_image,
    profile_image_alt: settings.profile_image_alt,
    favicon: settings.favicon,
    apple_touch_icon: settings.apple_touch_icon,
    mask_icon: settings.mask_icon,
    og_image: settings.og_image,
    og_image_alt: settings.og_image_alt,
    twitter_handle: settings.twitter_handle,
    socials: settings.socials,
    analytics: settings.analytics,
    audio: settings.audio,
    comments: settings.comments,
    feedback: settings.feedback,
    turnstile_site_key: settings.turnstile_site_key,
    search: settings.search,
    content: settings.content,
    blog: settings.blog,
    ai: settings.ai,
  }) ?? {}) as Record<string, unknown>
}

function detect(wire: SiteWire | undefined): SiteSettingsUI {
  const source = (wire?.settings ?? {}) as Record<string, unknown>
  const presentation = isObject(source.presentation) ? source.presentation : {}
  const docs = isObject(presentation.docs) ? presentation.docs : {}
  const theme = isObject(source.theme) ? source.theme : {}
  const analytics = isObject(source.analytics) ? source.analytics : {}
  const audio = isObject(source.audio) ? source.audio : {}
  const comments = isObject(source.comments) ? source.comments : {}
  const feedback = isObject(source.feedback) ? source.feedback : {}
  const search = isObject(source.search) ? source.search : {}
  const content = isObject(source.content) ? source.content : {}
  const blog = isObject(source.blog) ? source.blog : {}
  const ai = isObject(source.ai) ? source.ai : {}

  return {
    identity: {
      name: wire?.name ?? '',
      description: wire?.description ?? '',
      base_url: wire?.base_url ?? '',
      default_locale: wire?.default_locale ?? '',
    },
    settings: {
      presentation: {
        preset: oneOf(presentation.preset, PRESENTATION_PRESET),
        docs: { versions: docsVersions(docs.versions) },
        report_series: reportSeries(presentation.report_series),
      },
      theme: { tokens: tokens(theme.tokens), custom_css: text(theme.custom_css) },
      accent: text(source.accent),
      theme_color: text(source.theme_color),
      eyebrow: text(source.eyebrow),
      hero_title: text(source.hero_title),
      hero_text: text(source.hero_text),
      profile_image: text(source.profile_image),
      profile_image_alt: text(source.profile_image_alt),
      favicon: text(source.favicon),
      apple_touch_icon: text(source.apple_touch_icon),
      mask_icon: text(source.mask_icon),
      og_image: text(source.og_image),
      og_image_alt: text(source.og_image_alt),
      twitter_handle: text(source.twitter_handle),
      socials: stringMap(source.socials),
      analytics: {
        provider: oneOf(analytics.provider, ANALYTICS_PROVIDERS),
        domain: text(analytics.domain),
        src: text(analytics.src),
        id: text(analytics.id),
      },
      audio: {
        enabled: flag(audio.enabled),
        provider: oneOf(audio.provider, AUDIO_PROVIDERS),
        voice: text(audio.voice),
        title: text(audio.title),
        description: text(audio.description),
        author: text(audio.author),
        monthly_char_budget: count(audio.monthly_char_budget),
        auto_rebuild: flag(audio.auto_rebuild),
        blogcast_link: flag(audio.blogcast_link),
        blogcast_image: text(audio.blogcast_image),
        blogcast_category: text(audio.blogcast_category),
        subscribe_targets: targets(audio.subscribe_targets),
      },
      comments: { enabled: flag(comments.enabled) },
      feedback: { enabled: flag(feedback.enabled) },
      turnstile_site_key: text(source.turnstile_site_key),
      search: { index_body: flag(search.index_body) },
      content: { show_extra: flag(content.show_extra) },
      blog: { subscribe_row: flag(blog.subscribe_row), subscribe_targets: targets(blog.subscribe_targets) },
      ai: { share_buttons: flag(ai.share_buttons), share_targets: targets(ai.share_targets) },
    },
    carried: omitPaths(structuredClone(source), OWNED_PATHS),
    removed: [],
  }
}

/**
 * The whole object, every time.
 *
 * `carried` is the freshly re-read server object rather than the one the form
 * loaded with: a key written by someone else between load and save survives
 * unless the conflict check stopped the save first. Only the owned leaves and
 * the ones the operator explicitly deleted are taken out of it.
 */
function serialize(ui: SiteSettingsUI, carried: SiteWire): SiteWire {
  const kept = omitPaths(structuredClone((carried.settings ?? {}) as Record<string, unknown>), [
    ...OWNED_PATHS,
    ...ui.removed,
  ])
  return {
    name: ui.identity.name.trim(),
    description: ui.identity.description.trim(),
    base_url: ui.identity.base_url.trim(),
    default_locale: ui.identity.default_locale.trim().toLowerCase(),
    settings: mergeDeep(kept, ownedWire(ui)) as SiteWire['settings'],
  }
}

// The server's own rule, from `PRESENTATION_ID` in src/repository.mjs.
const PRESENTATION_ID = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/
const CUSTOM_CSS_MAX_BYTES = 8192
const encoder = new TextEncoder()

/**
 * The same verdicts the server reaches, reached first.
 *
 * A settings `PATCH` is all-or-nothing: one bad token key answers 422 and takes
 * every other edit on the page with it. Validating here is therefore not
 * politeness, it is the difference between fixing one field and retyping nine
 * sections.
 */
function validate(ui: SiteSettingsUI, context: ValidationContext): FieldErrors {
  const errors: FieldErrors = {}
  const fail = (path: string, message: string) => {
    if (!errors[path]) errors[path] = message
  }
  const { settings } = ui

  if (!ui.identity.name.trim()) fail('identity.name', 'Required')
  if (!ui.identity.base_url.trim()) fail('identity.base_url', 'Required')
  if (!ui.identity.default_locale.trim()) fail('identity.default_locale', 'Required')
  else if (!/^[a-z]{2}(?:-[a-z]{2})?$/i.test(ui.identity.default_locale.trim())) {
    fail('identity.default_locale', 'A language tag like “de” or “de-at”')
  } else if (context.locales?.length && !context.locales.includes(ui.identity.default_locale.trim().toLowerCase())) {
    fail('identity.default_locale', 'Must be one of the locales this site builds')
  }

  const versions = settings.presentation.docs.versions
  if (settings.presentation.preset === 'product-docs' && versions.length === 0) {
    fail('settings.presentation.docs.versions', 'The product-docs preset needs at least one version')
  }
  if (versions.length > 32) fail('settings.presentation.docs.versions', 'At most 32 versions')
  if (versions.length && versions.filter((entry) => entry.current).length !== 1) {
    fail('settings.presentation.docs.versions', 'Exactly one version must be current')
  }
  versions.forEach((entry, index) => {
    if (!PRESENTATION_ID.test(entry.id)) {
      fail(`settings.presentation.docs.versions.${index}.id`, 'Lower-case letters, digits and hyphens, 1–96 characters')
    }
    if (!entry.label.trim()) fail(`settings.presentation.docs.versions.${index}.label`, 'Required')
    else if (entry.label.length > 120) fail(`settings.presentation.docs.versions.${index}.label`, 'At most 120 characters')
    if (versions.findIndex((other) => other.id === entry.id) !== index) {
      fail(`settings.presentation.docs.versions.${index}.id`, 'Already used by another version')
    }
  })

  const series = settings.presentation.report_series
  if (series.length > 32) fail('settings.presentation.report_series', 'At most 32 series')
  series.forEach((entry, index) => {
    if (!PRESENTATION_ID.test(entry.id)) {
      fail(`settings.presentation.report_series.${index}.id`, 'Lower-case letters, digits and hyphens, 1–96 characters')
    }
    if (!entry.label.trim()) fail(`settings.presentation.report_series.${index}.label`, 'Required')
    else if (entry.label.trim().length > 120) {
      fail(`settings.presentation.report_series.${index}.label`, 'At most 120 characters')
    }
    if (!Number.isInteger(entry.nav_order)) fail(`settings.presentation.report_series.${index}.nav_order`, 'Whole numbers only')
    if (series.findIndex((other) => other.id === entry.id) !== index) {
      fail(`settings.presentation.report_series.${index}.id`, 'Already used by another series')
    }
  })

  for (const [key, value] of Object.entries(settings.theme.tokens)) {
    const problem =
      typeof value === 'string' ? checkTokenValue(value) : (checkTokenValue(value.light) ?? checkTokenValue(value.dark))
    if (problem) fail(`settings.theme.tokens.${key}`, problem)
  }
  const css = settings.theme.custom_css
  if (encoder.encode(css).length > CUSTOM_CSS_MAX_BYTES) {
    fail('settings.theme.custom_css', `Longer than ${CUSTOM_CSS_MAX_BYTES} bytes`)
  }
  if (css.toLowerCase().includes('</style')) {
    fail('settings.theme.custom_css', '“</style” would break out of the style element')
  }

  if (settings.analytics.provider === 'plausible' && !settings.analytics.domain.trim()) {
    fail('settings.analytics.domain', 'Plausible needs the domain it measures')
  }
  if (settings.analytics.provider === 'ga4' && !settings.analytics.id.trim()) {
    fail('settings.analytics.id', 'GA4 needs its measurement id')
  }

  return errors
}

/**
 * What the dirty check compares.
 *
 * The serialised owned half plus the operator's removals — never the raw UI
 * object. Absent versus empty, key order and a number that came back as a
 * string all differ in the UI and mean nothing on the wire; comparing them
 * would announce unsaved changes on a form nobody touched.
 */
function canonical(ui: SiteSettingsUI) {
  return canonicalise({ identity: ui.identity, settings: ownedWire(ui), removed: [...ui.removed].sort() })
}

export const siteSettingsContract: Contract<SiteSettingsUI, SiteWire> = { detect, serialize, validate, canonical }

export type SiteSectionId =
  | 'identity'
  | 'presentation'
  | 'theme'
  | 'branding'
  | 'seo'
  | 'analytics'
  | 'audio'
  | 'reader'
  | 'unmanaged'

const plural = (count_: number, one: string, many = `${one}s`) => `${count_} ${count_ === 1 ? one : many}`

/**
 * Nine sections, each saying what it holds without being opened.
 *
 * `paths` carries the wire spelling because that is what a 422 speaks
 * (`settings.theme.tokens: unknown token "radiuz"`); the UI is shaped to match,
 * so the same string routes the server's complaint onto the control that caused
 * it and onto this strip at the same time.
 */
export const SITE_SECTIONS: readonly SectionSpec<SiteSettingsUI>[] = [
  {
    id: 'identity',
    label: 'Identity',
    paths: ['identity'],
    summary: (ui) => `${ui.identity.default_locale || 'no locale'} · ${hostOf(ui.identity.base_url)}`,
    warning: (ui) => (ui.identity.base_url ? undefined : 'No base URL — every canonical link breaks'),
  },
  {
    id: 'presentation',
    label: 'Presentation',
    paths: ['settings.presentation'],
    summary: (ui) => {
      const parts = [ui.settings.presentation.preset || 'portfolio (default)']
      if (ui.settings.presentation.docs.versions.length) {
        parts.push(plural(ui.settings.presentation.docs.versions.length, 'version'))
      }
      if (ui.settings.presentation.report_series.length) {
        parts.push(plural(ui.settings.presentation.report_series.length, 'series', 'series'))
      }
      return parts.join(' · ')
    },
  },
  {
    id: 'theme',
    label: 'Theme',
    paths: ['settings.theme', 'settings.accent', 'settings.theme_color'],
    summary: (ui) => {
      const overridden = Object.keys(ui.settings.theme.tokens).length
      const css = ui.settings.theme.custom_css ? 'custom CSS' : ''
      return [overridden ? `${plural(overridden, 'token')} overridden` : 'Stock theme', css].filter(Boolean).join(' · ')
    },
  },
  {
    id: 'branding',
    label: 'Branding',
    paths: [
      'settings.eyebrow',
      'settings.hero_title',
      'settings.hero_text',
      'settings.profile_image',
      'settings.profile_image_alt',
      'settings.favicon',
      'settings.apple_touch_icon',
      'settings.mask_icon',
    ],
    summary: (ui) => (ui.settings.hero_title ? ui.settings.hero_title : 'Uses the site name'),
    warning: (ui) =>
      ui.settings.profile_image && !ui.settings.profile_image_alt
        ? 'Profile image has no alternative text'
        : undefined,
  },
  {
    id: 'seo',
    label: 'SEO & social',
    paths: ['settings.og_image', 'settings.og_image_alt', 'settings.twitter_handle', 'settings.socials'],
    summary: (ui) => {
      const links = Object.keys(ui.settings.socials).length
      return links ? plural(links, 'social link') : 'No social links'
    },
    warning: (ui) =>
      ui.settings.og_image && !ui.settings.og_image_alt ? 'Share image has no alternative text' : undefined,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    paths: ['settings.analytics'],
    summary: (ui) => (ui.settings.analytics.provider ? ui.settings.analytics.provider : 'Off'),
  },
  {
    id: 'audio',
    label: 'Read-aloud',
    paths: ['settings.audio'],
    summary: (ui) => {
      if (ui.settings.audio.enabled !== true) return 'Off'
      const targets_ = ui.settings.audio.subscribe_targets.length
      return ['On', targets_ ? plural(targets_, 'target') : ''].filter(Boolean).join(' · ')
    },
  },
  {
    id: 'reader',
    label: 'Reader features',
    paths: [
      'settings.comments',
      'settings.feedback',
      'settings.turnstile_site_key',
      'settings.search',
      'settings.content',
      'settings.blog',
      'settings.ai',
    ],
    summary: (ui) =>
      [
        `comments ${ui.settings.comments.enabled === false ? 'off' : 'on'}`,
        `feedback ${ui.settings.feedback.enabled === true ? 'on' : 'off'}`,
      ].join(' · '),
    warning: (ui) =>
      ui.settings.comments.enabled !== false && !ui.settings.turnstile_site_key
        ? 'Comments are open without a Turnstile key'
        : undefined,
  },
  {
    id: 'unmanaged',
    label: 'Carried through',
    paths: ['carried'],
    summary: (ui) => {
      const count_ = carriedLeaves(ui.carried).length
      return count_ ? `${plural(count_, 'key')} passed through` : 'Nothing unmanaged'
    },
  },
]

function hostOf(baseUrl: string) {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl || 'no base URL'
  }
}

/**
 * The carried object as dotted leaves, for a list that can name and remove one
 * key rather than a whole subtree. Keys containing a literal dot would collapse
 * into one row — the server addresses its own settings as `settings.x.y`, so
 * such a key is already unreachable there and cannot occur in practice.
 */
export function carriedLeaves(carried: Record<string, unknown>): { path: string; value: unknown }[] {
  const leaves: { path: string; value: unknown }[] = []
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (isObject(value) && Object.keys(value).length) walk(value, path)
      else leaves.push({ path, value })
    }
  }
  walk(carried, '')
  return leaves
}
