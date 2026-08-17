import type { SiteCreateInput } from '@/api/ck'
import type { PresentationPreset } from '../contracts/enums.generated'

/**
 * Everything the create wizard decides before it sends anything — as functions a
 * test can call with real values.
 *
 * This module exists because of how the previous guarantee was written. The suite
 * matched the wizard's source text: it asserted that `if (!BCP47.test(locale))`
 * and `firstProblem = STEP_ORDER.map(…)` were *present*, and never what `BCP47`
 * or `STEP_ORDER` contained. Widening the tag to `/^.+$/` and dropping
 * `'languages'` from the step order therefore left all ten assertions green while
 * the form happily submitted `default_locale: 'german'` — a locale row no
 * document can ever carry (`^[a-z]{2}(-[a-z]{2})?$`, src/markdown.mjs) and which
 * `DELETE .../locales/{locale}` refuses forever because it is the default.
 *
 * So the rules live here, with no runtime import at all: `node --test` can import
 * this file directly and drive it with `'german'`, `'DE'`, `''`, `'de'`,
 * `'en-us'`, `'x'` and duplicates. The two type imports are erased before Node
 * ever sees them.
 */

export type StepId = 'purpose' | 'home' | 'languages' | 'ready'

/**
 * The four questions, in order. `blockingProblem` walks exactly this list, so a
 * step removed from it is a step whose rule stops gating the submit button —
 * which is why the test asserts the contents, not the shape of the expression.
 */
export const STEP_ORDER: readonly StepId[] = ['purpose', 'home', 'languages', 'ready']

export interface SiteDraft {
  preset: PresentationPreset
  environment: 'production' | 'canary' | 'test'
  /** Only read for `product-docs`, which the server refuses without one version. */
  docsVersion: { id: string; label: string }
  name: string
  base_url: string
  slug: string
  default_locale: string
  /** Everything beyond the default locale; `POST /v1/sites` carries the whole set. */
  locales: string[]
}

export const EMPTY_DRAFT: SiteDraft = {
  preset: 'portfolio',
  environment: 'production',
  docsVersion: { id: 'v1', label: 'Version 1' },
  name: '',
  base_url: '',
  slug: '',
  default_locale: 'en',
  locales: [],
}

/**
 * Common tags offered in a locale menu. Typing another one is still allowed —
 * `BCP47` is the rule, this list is only the shortcut. Shared by the create
 * wizard and the Languages section of the site settings.
 */
export const SUGGESTED_LOCALES = [
  'de',
  'en',
  'en-gb',
  'en-us',
  'es',
  'fr',
  'it',
  'nl',
  'pl',
  'pt',
  'pt-br',
  'sv',
] as const

/** The frontmatter locale rule from src/markdown.mjs, which `siteLocale()` in src/repository.mjs applies to every locale row. */
export const BCP47 = /^[a-z]{2}(?:-[a-z]{2})?$/
/** `PRESENTATION_ID` in src/repository.mjs — the docs version id. */
export const PRESENTATION_ID = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/
/** `assertSlug()` in src/utils.mjs, the shape the stored site slug must have. */
export const SITE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/
/**
 * `SITE_LOCALE_MAX` in src/repository.mjs — the real ceiling, which the server
 * also reports as `max_locales` on GET /v1/sites/{site}/locales. Every row
 * multiplies the build matrix. This number is a copy of that one and nothing in
 * the type system connects them, so test/unit/cockpit-site-wizard.test.mjs reads
 * the server's declaration and compares it: past the cap the wizard admits rows
 * that POST /v1/sites answers 422 to, and that one request carries the name, the
 * base URL, the settings and every locale with it.
 */
export const SITE_LOCALE_MAX = 32
/** The cut `slugify()` in src/utils.mjs applies before the row is written. */
export const SLUG_MAX = 96

/**
 * The default locale as it will be stored.
 *
 * `createSite` no longer stores whatever arrives: it runs `default_locale` and
 * every entry of `locales` through `siteLocale()`, which trims, case-folds and
 * *refuses* anything outside `BCP47` with 422. So this is the same trimming and
 * folding the server does, and `stepProblem` below is the same refusal — reached
 * before the request instead of after it.
 */
export function storedDefaultLocale(draft: SiteDraft) {
  return draft.default_locale.trim().toLowerCase()
}

/**
 * The additional locale rows, normalised and with the default removed.
 *
 * `createSite` case-folds and de-duplicates the whole set itself and always
 * includes `default_locale`, so a repeated default would be harmless — but it
 * would appear in the summary as a row that is about to be written and then not
 * be one.
 */
export function additionalLocales(draft: SiteDraft) {
  const fold = storedDefaultLocale(draft)
  return [...new Set(draft.locales.map((entry) => entry.trim().toLowerCase()))].filter(
    (entry) => entry && entry !== fold,
  )
}

/** Every locale row the site will have, in the order the summary lists them. */
export function plannedLocales(draft: SiteDraft) {
  return [storedDefaultLocale(draft), ...additionalLocales(draft)]
}

/**
 * The slug exactly as the server derives it — `slugify()` in src/utils.mjs.
 *
 * Including `.slice(0, 96)`, which the console's own `slugify()` (forms/fields)
 * does not apply: for a name longer than 96 characters the Ready step used to
 * print, and the collision check used to compare, a slug the server would never
 * store. The test drives this against the server's own function, so the two
 * cannot drift apart silently.
 */
export function siteSlug(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
}

/** The slug as `createSite` would derive it: the typed one, else the name. */
export function derivedSlug(draft: SiteDraft) {
  return siteSlug(draft.slug || draft.name)
}

export interface StepContext {
  /** The slugs of the sites this credential can see — a collision is a 409 from the database. */
  takenSlugs: readonly string[]
  /**
   * `checkUrl(value).error` from forms/fields, injected rather than imported:
   * that module is a React component file, and these rules stay callable from a
   * plain `node --test` process. The wizard passes the real one.
   */
  baseUrlProblem: (value: string) => string | undefined
}

/**
 * What still blocks a step, in the server's own terms.
 *
 * Every rule here is one the API would otherwise enforce with a 422 that takes
 * the whole request with it. The languages branch is the load-bearing one: it is
 * what makes a site whose only locale row is unusable — `german`, `EN` — or a
 * site with no locale row at all unconstructible from this form.
 */
export function stepProblem(step: StepId, draft: SiteDraft, context: StepContext): string | undefined {
  if (step === 'purpose') {
    if (draft.preset !== 'product-docs') return undefined
    if (!PRESENTATION_ID.test(draft.docsVersion.id)) {
      return 'product-docs needs a first version id: lower-case letters, digits and hyphens'
    }
    if (!draft.docsVersion.label.trim()) return 'product-docs needs a label for its first version'
    return undefined
  }
  if (step === 'home') {
    if (!draft.name.trim()) return 'A name is required'
    if (!draft.base_url.trim()) return 'A base URL is required — every canonical link is built from it'
    const invalid = context.baseUrlProblem(draft.base_url)
    if (invalid) return invalid
    const slug = derivedSlug(draft)
    if (!slug) return 'No slug can be derived from this name — type one'
    // The server slugifies, then cuts to 96 characters, then asserts the shape —
    // so a cut that lands on a hyphen is a 422 on a slug the operator never saw.
    if (!SITE_SLUG.test(slug)) return `${slug} is not a usable slug — type one of at most ${SLUG_MAX} characters`
    if (context.takenSlugs.includes(slug)) return `The slug ${slug} is already taken by another site`
    return undefined
  }
  if (step === 'languages') {
    const locale = storedDefaultLocale(draft)
    // A site with no locale row builds no page tree at all: releases still
    // answer 201 and nothing exists under /<locale>/ to serve. `createSite`
    // writes the default locale's row unconditionally, so requiring a usable
    // default here is what keeps that impossible.
    if (!locale) return 'A default locale is required — a site with no locale row builds no pages'
    if (!BCP47.test(locale)) return 'The default locale must be a language tag like de or en-us'
    // The additional list is normalised and de-duplicated before it is sent, so
    // none of the three below could reach the server. They still block: the
    // field marks each one invalid, and a Next button that steps past a control
    // showing an error teaches the operator to ignore the error.
    const entries = draft.locales.map((entry) => entry.trim().toLowerCase())
    const unusable = entries.find((entry) => !BCP47.test(entry))
    if (unusable) return `“${unusable}” is not a language tag like de or en-us`
    const repeated = entries.find((entry) => entry === locale)
    if (repeated) return `${repeated} is already the default locale — remove it from the additional languages`
    const twice = entries.find((entry, index) => entries.indexOf(entry) !== index)
    if (twice) return `${twice} is listed twice`
    const planned = plannedLocales(draft)
    if (planned.length > SITE_LOCALE_MAX) {
      return `A site builds at most ${SITE_LOCALE_MAX} locales — this asks for ${planned.length}`
    }
    return undefined
  }
  return undefined
}

/** Each step's problem, keyed by step, for the step list and the Next button. */
export function stepProblems(draft: SiteDraft, context: StepContext): Record<StepId, string | undefined> {
  return Object.fromEntries(STEP_ORDER.map((id) => [id, stepProblem(id, draft, context)])) as Record<
    StepId,
    string | undefined
  >
}

/**
 * The first problem anywhere in the wizard — what the submit button is gated on.
 *
 * Every step, not the one being looked at: the summary is reachable by going
 * back, so a rule that only blocked its own Next button would not block the
 * request. It walks `STEP_ORDER`, which is why that list's contents are asserted.
 */
export function blockingProblem(draft: SiteDraft, context: StepContext): string | undefined {
  return STEP_ORDER.map((id) => stepProblem(id, draft, context)).find(Boolean)
}

/**
 * The whole site, as the one request that creates it.
 *
 * `POST /v1/sites` validates and stores the row, its locale rows and its
 * settings together — so the locales are sent here rather than added one at a
 * time afterwards, and the preset is part of the creation rather than a second
 * write that can fail on its own. `portfolio` is what an unset preset behaves
 * as, so nothing is written for it and `settings` stays absent.
 */
export function createInput(draft: SiteDraft): SiteCreateInput {
  const locales = additionalLocales(draft)
  const presentation =
    draft.preset === 'portfolio'
      ? undefined
      : {
          preset: draft.preset,
          ...(draft.preset === 'product-docs'
            ? {
                docs: {
                  versions: [
                    { id: draft.docsVersion.id, label: draft.docsVersion.label.trim(), status: 'current' as const },
                  ],
                },
              }
            : {}),
        }
  return {
    name: draft.name.trim(),
    slug: derivedSlug(draft),
    base_url: draft.base_url.trim(),
    default_locale: storedDefaultLocale(draft),
    environment: draft.environment,
    ...(locales.length ? { locales } : {}),
    ...(presentation ? { settings: { presentation } } : {}),
  }
}
