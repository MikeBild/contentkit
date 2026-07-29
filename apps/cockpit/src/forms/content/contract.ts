import type { FieldErrors } from '../contracts/contract'
import {
  CHANGE_TYPES,
  COMPOSITION_CANVASES,
  COMPOSITION_DENSITIES,
  COMPOSITION_DISCLOSURES,
  COMPOSITION_FORMATS,
  COMPOSITION_INTENTS,
  DECK_TEMPLATES,
  DECK_THEMES,
  DECK_VISUAL_SCHEMES,
  emit,
  LAYOUTS,
  resolvedLayout,
  type FrontmatterUI,
} from './frontmatter'

export interface ContentUI {
  fm: FrontmatterUI
  body: string
}

// The server's own expressions, restated. Every one has a counterpart in
// src/markdown.mjs or src/utils.mjs; the console is allowed to reach the same
// verdict earlier, never a different one.
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/
const LOCALE = /^[a-z]{2}(?:-[a-z]{2})?$/i
const ACCESS_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
const EXTRA_KEY = /^[a-z][a-z0-9_]{0,63}$/
const FIRST_SLIDE_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const FIRST_SLIDE_RESERVED = ['theme', 'routerMode', 'colorSchema']
const EXTRA_MAX_BYTES = 16384
const FIRST_SLIDE_MAX_BYTES = 16 * 1024

const encoder = new TextEncoder()
const scalar = (value: unknown) => value != null && typeof value !== 'object'

/**
 * The 422 the write would answer with, reached before the revision exists.
 *
 * `POST /v1/sites/{site}/content` validates the frontmatter as a whole and
 * rejects the document outright, so a form that lets the operator find out
 * afterwards costs them the round trip and tells them one problem at a time.
 * Everything here is a rule from `validateFrontmatter`; nothing here is a
 * preference.
 */
export function validateContent(ui: ContentUI): FieldErrors {
  const { fm } = ui
  const errors: FieldErrors = {}
  const fail = (path: string, message: string) => {
    if (!errors[path]) errors[path] = message
  }

  if (!fm.title.trim()) fail('fm.title', 'Required')
  if (!fm.locale.trim()) fail('fm.locale', 'Required')
  else if (!LOCALE.test(fm.locale.trim())) fail('fm.locale', 'A language tag like “de” or “en-us”')
  if (fm.slug.trim() && !SLUG.test(fm.slug.trim())) fail('fm.slug', 'Lower-case letters, digits and hyphens')
  if (fm.translationKey.trim() && !SLUG.test(fm.translationKey.trim())) {
    fail('fm.translationKey', 'Lower-case letters, digits and hyphens')
  }
  if (fm.layout && !(LAYOUTS as readonly string[]).includes(fm.layout)) fail('fm.layout', 'Not a layout this site knows')

  const layout = resolvedLayout(fm)
  if (fm.kind === 'deck' && layout !== 'deck') fail('fm.layout', 'A deck must use the deck layout')
  if (fm.hasComposition && layout !== 'composition') {
    fail('fm.layout', 'A composition block needs layout: composition')
  }

  for (const [key, value] of [
    ['date', fm.date],
    ['scheduledAt', fm.scheduledAt],
    ['updatedAt', fm.updatedAt],
  ] as const) {
    if (value.trim() && Number.isNaN(new Date(value.trim()).valueOf())) fail(`fm.${key}`, 'Not an ISO-8601 date')
  }

  for (const [key, value] of [
    ['docKey', fm.docKey],
    ['docsVersion', fm.docsVersion],
    ['parent', fm.parent],
  ] as const) {
    if (value.trim() && !SLUG.test(value.trim())) fail(`fm.${key}`, 'Lower-case letters, digits and hyphens')
  }
  if (fm.changeTypes.some((entry) => !(CHANGE_TYPES as readonly string[]).includes(entry))) {
    fail('fm.changeTypes', `Only ${CHANGE_TYPES.join(', ')}`)
  }

  if (layout === 'composition' && fm.hasComposition) {
    const composition = fm.composition
    const closed: [string, string, readonly string[]][] = [
      ['format', composition.format, COMPOSITION_FORMATS],
      ['canvas', composition.canvas, COMPOSITION_CANVASES],
      ['intent', composition.intent, COMPOSITION_INTENTS],
      ['density', composition.density, COMPOSITION_DENSITIES],
      ['disclosure', composition.disclosure, COMPOSITION_DISCLOSURES],
    ]
    for (const [key, value, allowed] of closed) {
      if (value && !allowed.includes(value)) fail(`fm.composition.${key}`, `Must be one of ${allowed.join(', ')}`)
    }
    if (composition.preferredPattern && !/^[a-z][a-z0-9-]{1,63}$/.test(composition.preferredPattern)) {
      fail('fm.composition.preferredPattern', 'A pattern id: lower-case letters, digits and hyphens')
    }
    const bounds: [string, string, number][] = [
      ['audience', composition.audience, 120],
      ['question', composition.question, 240],
      ['goal', composition.goal, 240],
      ['thesis', composition.thesis, 500],
      ['conclusion', composition.conclusion, 500],
      ['action', composition.action, 500],
    ]
    for (const [key, value, max] of bounds) {
      if (value.trim().length > max) fail(`fm.composition.${key}`, `At most ${max} characters`)
    }
    if (composition.limitations.length > 12) fail('fm.composition.limitations', 'At most 12 limitations')
    composition.limitations.forEach((entry, index) => {
      if (!entry.trim()) fail(`fm.composition.limitations.${index}`, 'Must not be empty')
      else if (entry.trim().length > 300) fail(`fm.composition.limitations.${index}`, 'At most 300 characters')
    })
  }

  const format = fm.hasComposition && layout === 'composition' ? fm.composition.format || 'infographic' : ''
  if (fm.reportCadence.trim() && format !== 'report') {
    fail('fm.reportCadence', 'Only a report composition may set a cadence')
  }
  if (fm.reportSeries.trim() && format !== 'report') {
    fail('fm.reportSeries', 'Only a report composition may select a series')
  }
  if (fm.reportSeries.trim() && !SLUG.test(fm.reportSeries.trim())) {
    fail('fm.reportSeries', 'Lower-case letters, digits and hyphens')
  }

  if (fm.kind === 'deck' && fm.hasDeck) {
    const { deck } = fm
    if (deck.template && !(DECK_TEMPLATES as readonly string[]).includes(deck.template)) {
      fail('fm.deck.template', `Must be one of ${DECK_TEMPLATES.join(', ')}`)
    }
    if (deck.theme && !(DECK_THEMES as readonly string[]).includes(deck.theme)) {
      fail('fm.deck.theme', `Must be one of ${DECK_THEMES.join(', ')}`)
    }
    if (deck.visualScheme && !(DECK_VISUAL_SCHEMES as readonly string[]).includes(deck.visualScheme)) {
      fail('fm.deck.visualScheme', `Must be one of ${DECK_VISUAL_SCHEMES.join(', ')}`)
    }
    if (deck.maxSlides !== undefined && (!Number.isInteger(deck.maxSlides) || deck.maxSlides < 1 || deck.maxSlides > 120)) {
      fail('fm.deck.maxSlides', 'A whole number from 1 to 120')
    }
    const slideKeys = Object.keys(deck.firstSlide)
    if (slideKeys.length > 32) fail('fm.deck.firstSlide', 'At most 32 fields')
    const badKey = slideKeys.find((key) => !FIRST_SLIDE_KEY.test(key) || FIRST_SLIDE_RESERVED.includes(key))
    if (badKey) fail('fm.deck.firstSlide', `“${badKey}” is invalid or reserved`)
    if (encoder.encode(JSON.stringify(deck.firstSlide)).length > FIRST_SLIDE_MAX_BYTES) {
      fail('fm.deck.firstSlide', 'Over the 16 KiB budget')
    }
  }

  fm.tldr.forEach((entry, index) => {
    if (!entry.trim()) fail(`fm.tldr.${index}`, 'Must not be empty')
  })
  fm.faq.forEach((entry, index) => {
    if (!entry.q.trim()) fail(`fm.faq.${index}.q`, 'Required')
    if (!entry.a.trim()) fail(`fm.faq.${index}.a`, 'Required')
  })

  const slug = fm.slug.trim()
  if (fm.related.length > 8) fail('fm.related', 'At most 8 references')
  if (new Set(fm.related).size !== fm.related.length) fail('fm.related', 'The same slug twice')
  if (slug && fm.related.includes(slug)) fail('fm.related', 'A document cannot reference itself')
  if (fm.related.some((entry) => !SLUG.test(entry))) fail('fm.related', 'Every entry must be a slug')

  if (fm.access.length > 32) fail('fm.access', 'At most 32 groups')
  if (new Set(fm.access).size !== fm.access.length) fail('fm.access', 'The same group twice')
  if (fm.access.some((entry) => !ACCESS_SLUG.test(entry))) fail('fm.access', 'Every entry must be a group slug')

  const extraEntries = Object.entries(fm.extra)
  if (extraEntries.length > 32) fail('fm.extra', 'At most 32 custom fields')
  for (const [key, value] of extraEntries) {
    if (!EXTRA_KEY.test(key)) fail('fm.extra', `“${key}” must match [a-z][a-z0-9_]{0,63}`)
    else if (Array.isArray(value)) {
      if (value.length > 64) fail('fm.extra', `“${key}” allows at most 64 entries`)
      else if (!value.every(scalar)) fail('fm.extra', `“${key}” may only contain scalars`)
    } else if (value !== null && typeof value === 'object') {
      const nested = Object.entries(value as Record<string, unknown>)
      if (nested.length > 32) fail('fm.extra', `“${key}” allows at most 32 entries`)
      else if (nested.some(([nestedKey, nestedValue]) => !EXTRA_KEY.test(nestedKey) || !scalar(nestedValue))) {
        fail('fm.extra', `“${key}” must be a flat map of scalars under valid keys`)
      }
    } else if (value === null) {
      fail('fm.extra', `“${key}” has no value — remove the field instead`)
    }
  }
  if (extraEntries.length && encoder.encode(JSON.stringify(fm.extra)).length > EXTRA_MAX_BYTES) {
    fail('fm.extra', 'Over the 16 KiB budget')
  }

  return errors
}

/**
 * The dirty projection is the document itself.
 *
 * Anything else would compare form state the wire never sees — a field reordered
 * in the UI, an empty string that is not emitted — and announce unsaved changes
 * for a document whose bytes are identical.
 */
export function canonicalContent(ui: ContentUI) {
  return emit(ui.fm, ui.body)
}
