import { useMutation, useQueryClient } from '@tanstack/react-query'
import { InfoIcon, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ck } from '@/api/ck'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { Steps, type StepDescriptor } from '@/components/ui/steps'
import { useToast } from '@/components/ui/toast'
import { keys } from '@/lib/query'
import { useSite } from '@/lib/site'
import { useI18n, type I18nValue, type TranslationKey } from '@/lib/i18n-context'
import { PRESENTATION_PRESET, type PresentationPreset } from '../contracts/enums.generated'
import {
  ChoiceCards,
  LocaleField,
  SlugField,
  TagListField,
  TextField,
  UrlField,
  checkUrl,
  type Choice,
} from '../fields'
import {
  BCP47,
  EMPTY_DRAFT,
  SITE_LOCALE_MAX,
  STEP_ORDER,
  SUGGESTED_LOCALES,
  additionalLocales,
  blockingProblem,
  createInput,
  derivedSlug,
  plannedLocales,
  stepProblems,
  storedDefaultLocale,
  type SiteDraft,
  type StepId,
} from './rules'

/**
 * Creating a site, as the four decisions it actually is.
 *
 * The dialog this replaces asked for three strings and said nothing about what
 * they do. Two of them are not reversible in any cheap way — `settings.
 * presentation.preset` decides the URL every page gets, so changing it later
 * moves links other people have already followed, and the locale rows are the
 * build matrix. The preset was not asked for at all and arrived as section two
 * of the settings form, after the site existed; the locale was free text and
 * `EN` or `german` failed only once the server answered.
 *
 * One request stands behind all four steps: `POST /v1/sites` writes the row, its
 * locale rows and its settings together, validating `locales` exactly as
 * `POST /v1/sites/{site}/locales` does and `settings` exactly as `PATCH` does.
 *
 * This used to be three sequential writes, justified here as the only sequence
 * the API allowed. It never was: the endpoint already accepted all of it, and
 * only the hand-written signature in src/api/ck stopped at four fields — a
 * client limit described as a server one. The cost of the invented limit was a
 * state the API cannot even
 * produce — a site that exists without its preset, or with two of its three
 * locales — plus a progress ref, a resume button and a banner to describe it.
 * All of that is gone: the wizard either created the site or did not.
 *
 * The steps stay, because each one is still a question whose answer the request
 * needs, and step 4 shows the whole body before it is sent.
 */

const STEP_LABEL_KEYS: Record<StepId, TranslationKey> = {
  purpose: 'wizard.step.purpose',
  home: 'wizard.step.home',
  languages: 'wizard.step.languages',
  ready: 'wizard.step.ready',
}

export type { SiteDraft }

/**
 * What each preset changes, from `PRESET_LAYOUT` and `route()` in
 * src/site-builder.mjs and `presetSectionLink()` in src/templates.mjs.
 *
 * Typed as a total record over the generated enum: a preset added on the server
 * and regenerated into `enums.generated.ts` stops this file compiling until
 * someone writes down what it does, which is the only way this list cannot
 * drift into names the server does not accept.
 */
const PRESET_EFFECT_KEYS: Record<PresentationPreset, TranslationKey> = {
  portfolio: 'wizard.preset.portfolio',
  'product-docs': 'wizard.preset.docs',
  wiki: 'wizard.preset.wiki',
  'knowledge-base': 'wizard.preset.knowledge',
  product: 'wizard.preset.product',
  changelog: 'wizard.preset.changelog',
}

export function CreateSiteWizard({ onCreated }: { onCreated: (slug: string) => void }) {
  const { t } = useI18n()
  const [isOpen, setOpen] = useState(false)
  const [step, setStep] = useState<StepId>('purpose')
  const [draft, setDraft] = useState<SiteDraft>(EMPTY_DRAFT)
  const client = useQueryClient()
  const { toast } = useToast()
  const { sites } = useSite()

  const takenSlugs = useMemo(() => sites.map((entry) => entry.slug), [sites])
  // The one rule set, shared with the tests: `checkUrl` is injected because the
  // rules module is import-free on purpose (see rules.ts).
  const context = useMemo(
    () => ({ takenSlugs, baseUrlProblem: (value: string) => checkUrl(value).error }),
    [takenSlugs],
  )
  const problems = useMemo(() => stepProblems(draft, context), [draft, context])
  const firstProblem = useMemo(() => blockingProblem(draft, context), [draft, context])

  const locales = plannedLocales(draft)
  const extra = additionalLocales(draft)
  const slug = derivedSlug(draft)
  const writesPreset = draft.preset !== 'portfolio'

  const create = useMutation({
    // One request. There is no partially created site to remember, so there is
    // nothing here to resume.
    mutationFn: () => ck.sites.create(createInput(draft)),
    onSuccess: async (site) => {
      // The list has to know the new site before the selection names it:
      // selecting a slug the provider cannot find makes it fall back to the
      // first known site, which lands the operator back where they started.
      await client.invalidateQueries({ queryKey: keys.sites.all })
      onCreated(site.slug)
      toast({
        tone: 'success',
        title: t('wizard.created', { site: site.name }),
        detail: t('wizard.createdDetail'),
      })
      close()
    },
  })

  // A function declaration, so `onSuccess` above can close the dialog it is
  // declared below: closing is the whole of the cleanup now that there is no
  // partial creation to remember.
  function close() {
    setOpen(false)
    setStep('purpose')
    setDraft(EMPTY_DRAFT)
    create.reset()
  }

  const stepList: StepDescriptor<StepId>[] = STEP_ORDER.map((id) => ({
    id,
    label: t(STEP_LABEL_KEYS[id]),
    summary:
      id === 'purpose'
        ? draft.preset
        : id === 'home'
          ? slug || t('wizard.noSlug')
          : id === 'languages'
            ? locales.join(', ')
            : `${t(locales.length === 1 ? 'wizard.localeOne' : 'wizard.localeMany', { count: locales.length })} · ${t('wizard.requestOne')}`,
    problem: localizeWizardProblem(problems[id], t),
  }))

  const at = STEP_ORDER.indexOf(step)

  return (
    <>
      <Button data-testid="site-new" variant="outline" onClick={() => setOpen(true)}>
        {t('wizard.newSite')}
      </Button>
      {isOpen ? (
        <Dialog
          open
          onOpenChange={(next) => {
            // Four decisions go out as one request. Until it answers there is
            // no site to look at and no rejection to correct, so the wizard is
            // not dismissable — and Cancel below stands down with it.
            if (create.isPending) return
            if (!next) close()
          }}
        >
          <DialogContent
            data-testid="ck-site-wizard"
            className="sm:max-w-2xl"
            closeDisabled={create.isPending}
            onEscapeKeyDown={(event) => {
              if (create.isPending) event.preventDefault()
            }}
            onPointerDownOutside={(event) => {
              if (create.isPending) event.preventDefault()
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('wizard.newSite')}</DialogTitle>
              <DialogDescription>{t('wizard.description')}</DialogDescription>
            </DialogHeader>
            <div className="scrollbar-thin flex flex-col gap-5 overflow-y-auto">
              <Steps data-testid="ck-site-wizard-steps" steps={stepList} value={step} onChange={setStep} />

              {step === 'purpose' ? <PurposeStep draft={draft} onChange={setDraft} /> : null}
              {step === 'home' ? <HomeStep draft={draft} onChange={setDraft} slug={slug} takenSlugs={takenSlugs} /> : null}
              {step === 'languages' ? <LanguagesStep draft={draft} onChange={setDraft} /> : null}
              {step === 'ready' ? <ReadyStep draft={draft} slug={slug} extra={extra} /> : null}

              {/*
                One request, so a rejection is a rejection: nothing exists to
                reconcile, and the same dialog can be corrected and sent again.
              */}
              {create.error ? (
                <Alert variant="destructive" data-testid="ck-site-wizard-error">
                  <TriangleAlert />
                  <AlertTitle>{t('wizard.createErrorTitle')}</AlertTitle>
                  <AlertDescription>
                    {create.error instanceof Error ? create.error.message : t('wizard.createError')} — {t('wizard.createErrorSuffix')}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
            {/* `sm:justify-between` rather than the footer's own `sm:justify-end`:
                Back is a navigation and belongs at the far edge, away from the
                two controls that answer the dialog. Layout only. */}
            <DialogFooter className="sm:justify-between">
              <Button
                variant="ghost"
                size="sm"
                data-testid="ck-site-wizard-back"
                disabled={at === 0 || create.isPending}
                onClick={() => setStep(STEP_ORDER[at - 1] ?? 'purpose')}
              >
                {t('wizard.back')}
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="site-create-cancel"
                  disabled={create.isPending}
                  onClick={close}
                >
                  {t('common.cancel')}
                </Button>
                {step === 'ready' ? (
                  <Button
                    size="sm"
                    data-testid="site-create-submit"
                    // Every step's rule, not just this one's: the summary is
                    // reachable by going back, and the languages gate is what
                    // keeps a locale-less site unconstructible.
                    disabled={create.isPending || Boolean(firstProblem)}
                    onClick={() => create.mutate()}
                  >
                    {create.isPending ? <Spinner data-icon="inline-start" /> : null}
                    {t(writesPreset ? 'wizard.createPreset' : 'wizard.create')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    data-testid="ck-site-wizard-next"
                    disabled={Boolean(problems[step])}
                    onClick={() => setStep(STEP_ORDER[at + 1] ?? 'ready')}
                  >
                    {t('wizard.next')}
                  </Button>
                )}
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}

function localizeWizardProblem(problem: string | undefined, t: I18nValue['t']): string | undefined {
  if (!problem) return undefined
  const exact: Partial<Record<string, TranslationKey>> = {
    'product-docs needs a first version id: lower-case letters, digits and hyphens': 'wizard.problem.docsId',
    'product-docs needs a label for its first version': 'wizard.problem.docsLabel',
    'A name is required': 'wizard.problem.name',
    'A base URL is required — every canonical link is built from it': 'wizard.problem.baseUrl',
    'No slug can be derived from this name — type one': 'wizard.problem.slugMissing',
    'A default locale is required — a site with no locale row builds no pages': 'wizard.problem.defaultLocaleMissing',
    'The default locale must be a language tag like de or en-us': 'wizard.problem.defaultLocaleInvalid',
    'Not a URL — include the scheme, for example https://': 'validation.url',
    'Remove the username and password from the URL': 'validation.urlCredentials',
    'Plain http — the value travels unencrypted': 'validation.urlHttp',
  }
  const key = exact[problem]
  if (key) return t(key)
  let match = /^(.*?) is not a usable slug — type one of at most (\d+) characters$/.exec(problem)
  if (match) return t('wizard.problem.slugInvalid', { slug: match[1]!, count: match[2]! })
  match = /^The slug (.*?) is already taken by another site$/.exec(problem)
  if (match) return t('wizard.problem.slugTaken', { slug: match[1]! })
  match = /^“(.*?)” is not a language tag like de or en-us$/.exec(problem)
  if (match) return t('wizard.problem.localeInvalid', { locale: match[1]! })
  match = /^(.*?) is already the default locale — remove it from the additional languages$/.exec(problem)
  if (match) return t('wizard.problem.localeDefault', { locale: match[1]! })
  match = /^(.*?) is listed twice$/.exec(problem)
  if (match) return t('wizard.problem.localeTwice', { locale: match[1]! })
  match = /^A site builds at most (\d+) locales — this asks for (\d+)$/.exec(problem)
  if (match) return t('wizard.problem.localeMax', { max: match[1]!, count: match[2]! })
  match = /^Only (.+) are allowed here$/.exec(problem)
  if (match) return t('validation.urlProtocols', { protocols: match[1]! })
  return problem
}

interface StepProps {
  draft: SiteDraft
  onChange: (draft: SiteDraft) => void
}

function PurposeStep({ draft, onChange }: StepProps) {
  const { t } = useI18n()
  const presetCards: readonly Choice<PresentationPreset>[] = PRESENTATION_PRESET.map((value) => ({
    value,
    label: value === 'portfolio' ? t('wizard.portfolioDefault') : value,
    description: t(PRESET_EFFECT_KEYS[value]),
  }))
  return (
    <div className="flex flex-col gap-4">
      <ChoiceCards
        label={t('wizard.presentationPreset')}
        required
        data-testid="ck-site-wizard-preset"
        help={t('wizard.presentationHelp')}
        about={t('wizard.presentationAbout')}
        options={presetCards}
        value={draft.preset}
        onChange={(preset) => onChange({ ...draft, preset })}
      />
      {draft.preset === 'product-docs' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('wizard.docsVersion')}
            required
            data-testid="ck-site-wizard-docs-version-id"
            help={t('wizard.docsVersionHelp')}
            about={t('wizard.docsVersionAbout')}
            value={draft.docsVersion.id}
            onChange={(id) => onChange({ ...draft, docsVersion: { ...draft.docsVersion, id } })}
          />
          <TextField
            label={t('wizard.versionLabel')}
            required
            maxLength={120}
            data-testid="ck-site-wizard-docs-version-label"
            help={t('wizard.versionLabelHelp')}
            value={draft.docsVersion.label}
            onChange={(label) => onChange({ ...draft, docsVersion: { ...draft.docsVersion, label } })}
          />
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {draft.preset === 'portfolio'
          ? t('wizard.portfolioStorage')
          : t('wizard.presetStorage')}
      </p>
    </div>
  )
}

function HomeStep({
  draft,
  onChange,
  slug,
  takenSlugs,
}: StepProps & { slug: string; takenSlugs: readonly string[] }) {
  const { t } = useI18n()
  const base = draft.base_url.trim()
  return (
    <div className="flex flex-col gap-4">
      <TextField
        label={t('siteForm.name')}
        required
        data-testid="ck-site-wizard-name"
        help={t('siteForm.nameHelp')}
        value={draft.name}
        onChange={(name) => onChange({ ...draft, name })}
      />
      <UrlField
        label={t('siteForm.baseUrl')}
        required
        data-testid="ck-site-wizard-base-url"
        help={t('wizard.baseUrlHelp')}
        about={t('wizard.baseUrlAbout')}
        value={draft.base_url}
        onChange={(base_url) => onChange({ ...draft, base_url })}
      />
      <SlugField
        label={t('wizard.slug')}
        required
        data-testid="ck-site-wizard-slug"
        help={t('wizard.slugHelp')}
        about={t('wizard.slugAbout')}
        derivedFrom={draft.name}
        siblings={takenSlugs}
        value={draft.slug}
        onChange={(next) => onChange({ ...draft, slug: next })}
      />
      <p className="text-xs text-muted-foreground">
        {t('wizard.storedAs', { slug: slug || '—' })}
        {base ? ` ${t('wizard.storedWithBase', { base: base.replace(/\/$/, '') })}` : ''}
      </p>
    </div>
  )
}

function LanguagesStep({ draft, onChange }: StepProps) {
  const { t } = useI18n()
  const extra = additionalLocales(draft)
  return (
    <div className="flex flex-col gap-4">
      <LocaleField
        label={t('siteForm.defaultLocale')}
        required
        data-testid="ck-site-wizard-default-locale"
        help={t('wizard.defaultLocaleHelp')}
        about={t('wizard.defaultLocaleAbout')}
        locales={SUGGESTED_LOCALES}
        value={draft.default_locale}
        onChange={(default_locale) => onChange({ ...draft, default_locale })}
      />
      <TagListField
        label={t('wizard.additionalLanguages')}
        data-testid="ck-site-wizard-extra-locales"
        about={t('wizard.additionalLanguagesAbout', { count: SITE_LOCALE_MAX })}
        fallback={t('wizard.additionalLanguagesFallback')}
        placeholder={t('wizard.additionalLanguagesPlaceholder')}
        validate={(entry) =>
          !BCP47.test(entry.trim().toLowerCase())
            ? t('validation.locale')
            : entry.trim().toLowerCase() === storedDefaultLocale(draft)
              ? t('wizard.alreadyDefault')
              : undefined
        }
        value={draft.locales}
        onChange={(locales) => onChange({ ...draft, locales: [...locales] })}
      />
      {/* This step's explanation, which is the same three sentences whatever is
          typed above it — so it waits behind the affordance rather than filling
          the step. What *this* draft does is the one line that stays on screen. */}
      <div className="flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              data-testid="ck-site-wizard-languages-about"
              aria-label={t('wizard.languagesAboutLabel')}
            >
              <InfoIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" data-testid="ck-site-wizard-languages-about-content">
            <PopoverTitle>{t('wizard.languagesAboutTitle')}</PopoverTitle>
            <PopoverDescription>{t('wizard.languagesAboutDescription')}</PopoverDescription>
          </PopoverContent>
        </Popover>
        {extra.length ? (
          <span className="text-xs text-muted-foreground" data-testid="ck-site-wizard-extra-locale-count">
            {t(extra.length === 1 ? 'wizard.extraLocaleOne' : 'wizard.extraLocaleMany', { count: extra.length })}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function ReadyStep({ draft, slug, extra }: { draft: SiteDraft; slug: string; extra: readonly string[] }) {
  const { t } = useI18n()
  const locales = plannedLocales(draft)
  const rows: { key: string; label: string; value: string }[] = [
    { key: 'name', label: t('siteForm.name'), value: draft.name.trim() },
    { key: 'slug', label: t('wizard.slug'), value: slug },
    { key: 'base-url', label: t('siteForm.baseUrl'), value: draft.base_url.trim().replace(/\/$/, '') },
    { key: 'default-locale', label: t('siteForm.defaultLocale'), value: storedDefaultLocale(draft) },
    {
      key: 'locales',
      label: t('wizard.localeRows'),
      value: locales.join(', '),
    },
    {
      key: 'preset',
      label: t('wizard.preset'),
      value:
        draft.preset === 'portfolio'
          ? t('wizard.presetUnset')
          : draft.preset === 'product-docs'
            ? t('wizard.docsPresetSummary', {
                preset: draft.preset,
                version: draft.docsVersion.id,
                label: draft.docsVersion.label.trim(),
              })
            : draft.preset,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <dl data-testid="ck-site-wizard-summary" className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        {rows.map((row) => (
          <div key={row.key} className="grid gap-0.5 sm:col-span-2 sm:grid-cols-subgrid">
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd data-testid={`ck-site-wizard-summary-${row.key}`} className="font-mono text-sm">
              {row.value || '—'}
            </dd>
          </div>
        ))}
      </dl>

      <Alert data-testid="ck-site-wizard-requests">
        <InfoIcon />
        <AlertTitle>{t('wizard.oneRequest')}</AlertTitle>
        <AlertDescription>
          <span className="block font-mono">POST /v1/sites — {slug || '—'}</span>
          {t(locales.length === 1 ? 'wizard.requestLocaleOne' : 'wizard.requestLocaleMany', {
            count: locales.length,
            extra: extra.length ? t('wizard.extraBesideDefault', { locales: extra.join(', ') }) : '',
            settings: draft.preset === 'portfolio'
              ? t('wizard.noSettings')
              : t('wizard.withPreset', { preset: draft.preset }),
          })}
        </AlertDescription>
      </Alert>

      {/*
        The one thing the old dialog never said. A site is not a live site: it is
        a row with a build matrix, and content changes nothing that a reader can
        see until a release is built from it and that release is activated. Three
        numbered steps inside an Alert, because the consequence is the point and a
        list is what a reader scans.
      */}
      <Alert data-testid="ck-site-wizard-after">
        <InfoIcon />
        <AlertTitle>{t('wizard.notLiveTitle')}</AlertTitle>
        <AlertDescription>
          <ol data-testid="ck-site-wizard-next-steps" className="flex list-inside list-decimal flex-col gap-1">
            <li>{t('wizard.after.content')}</li>
            <li>{t('wizard.after.release')}</li>
            <li>{t('wizard.after.activate')}</li>
          </ol>
        </AlertDescription>
      </Alert>
    </div>
  )
}
