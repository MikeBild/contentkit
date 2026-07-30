import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ck } from '@/api/ck'
import { Dialog, DialogActions } from '@/components/ui/dialog'
import { Button } from '@/components/ui/primitives'
import { Steps, type StepDescriptor } from '@/components/ui/steps'
import { useToast } from '@/components/ui/toast'
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
import { keys } from '@/lib/query'
import { useSite } from '@/lib/site'
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

const STEP_LABELS: Record<StepId, string> = {
  purpose: 'What should this site be?',
  home: 'Where does it live?',
  languages: 'In which languages?',
  ready: 'Ready',
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
const PRESET_EFFECT: Record<PresentationPreset, string> = {
  portfolio: 'Pages stay at /{locale}/{slug}/. The home page lists posts and projects; the nav offers blog and projects.',
  'product-docs':
    'Pages become documentation at /{locale}/docs/{version}/…, each one needs docKey and docsVersion, and the nav gains a Docs hub.',
  wiki: 'Pages become a wiki tree at /{locale}/wiki/…, ordered by their own nesting, behind one Wiki hub.',
  'knowledge-base': 'Pages become help articles at /{locale}/help/…, behind one Help hub in the nav.',
  product: 'Pages use the landing layout and the home page is the hero rather than a list. No content hub in the nav.',
  changelog: 'Pages become dated entries at /{locale}/changelog/{slug}/, behind one Changelog hub in the nav.',
}

const PRESET_CARDS: readonly Choice<PresentationPreset>[] = PRESENTATION_PRESET.map((value) => ({
  value,
  label: value === 'portfolio' ? 'portfolio — the default' : value,
  description: PRESET_EFFECT[value],
}))

export function CreateSiteWizard({ onCreated }: { onCreated: (slug: string) => void }) {
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
        title: `${site.name} was created`,
        detail: 'Nothing is public yet: add content, build a release, then activate it.',
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
    label: STEP_LABELS[id],
    summary:
      id === 'purpose'
        ? draft.preset
        : id === 'home'
          ? slug || 'no slug yet'
          : id === 'languages'
            ? locales.join(', ')
            : `${locales.length === 1 ? '1 locale' : `${locales.length} locales`} · 1 request`,
    problem: problems[id],
  }))

  const at = STEP_ORDER.indexOf(step)

  return (
    <>
      <Button data-testid="site-new" variant="outline" onClick={() => setOpen(true)}>
        New site
      </Button>
      {isOpen ? (
        <Dialog
          open
          size="lg"
          data-testid="ck-site-wizard"
          title="New site"
          description="Four decisions, one request. The first two are the ones that are expensive to change afterwards."
          busy={create.isPending}
          onClose={close}
          footer={
            <DialogActions className="w-full justify-between">
              <Button
                variant="ghost"
                size="sm"
                data-testid="ck-site-wizard-back"
                disabled={at === 0 || create.isPending}
                onClick={() => setStep(STEP_ORDER[at - 1] ?? 'purpose')}
              >
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" data-testid="site-create-cancel" onClick={close}>
                  Cancel
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
                    {create.isPending
                      ? 'Creating…'
                      : writesPreset
                        ? 'Create site with this preset'
                        : 'Create site'}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    data-testid="ck-site-wizard-next"
                    disabled={Boolean(problems[step])}
                    onClick={() => setStep(STEP_ORDER[at + 1] ?? 'ready')}
                  >
                    Next
                  </Button>
                )}
              </div>
            </DialogActions>
          }
        >
          <div className="flex flex-col gap-5">
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
              <p data-testid="ck-site-wizard-error" className="text-sm text-chart-5">
                {create.error instanceof Error ? create.error.message : 'Could not create the site'} — nothing was
                created. Correct the value it names and send it again.
              </p>
            ) : null}
          </div>
        </Dialog>
      ) : null}
    </>
  )
}

interface StepProps {
  draft: SiteDraft
  onChange: (draft: SiteDraft) => void
}

function PurposeStep({ draft, onChange }: StepProps) {
  return (
    <div className="flex flex-col gap-4">
      <ChoiceCards
        label="Presentation preset"
        required
        data-testid="ck-site-wizard-preset"
        help="It decides the layout a page gets when it names none, and the URL that page is published under. Changing it later moves every one of those URLs, so it is asked first."
        options={PRESET_CARDS}
        value={draft.preset}
        onChange={(preset) => onChange({ ...draft, preset })}
      />
      {draft.preset === 'product-docs' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="First documentation version"
            required
            data-testid="ck-site-wizard-docs-version-id"
            help="Appears in the URL and in each page's docsVersion. The server refuses the product-docs preset without one."
            value={draft.docsVersion.id}
            onChange={(id) => onChange({ ...draft, docsVersion: { ...draft.docsVersion, id } })}
          />
          <TextField
            label="Version label"
            required
            maxLength={120}
            data-testid="ck-site-wizard-docs-version-label"
            help="What readers see in the version switcher."
            value={draft.docsVersion.label}
            onChange={(label) => onChange({ ...draft, docsVersion: { ...draft.docsVersion, label } })}
          />
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {draft.preset === 'portfolio'
          ? 'portfolio is what an unset preset behaves as, so nothing is written for it — the site is created and settings.presentation stays absent.'
          : 'Carried by the same POST /v1/sites as settings.presentation, which the server validates exactly as it validates a PATCH.'}
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
  const base = draft.base_url.trim()
  return (
    <div className="flex flex-col gap-4">
      <TextField
        label="Name"
        required
        data-testid="ck-site-wizard-name"
        help="Used wherever a branding field is unset — the header, the feed titles, the blogcast channel."
        value={draft.name}
        onChange={(name) => onChange({ ...draft, name })}
      />
      <UrlField
        label="Base URL"
        required
        data-testid="ck-site-wizard-base-url"
        help="Every canonical link, feed URL, sitemap entry and share target this site serves is built from it. Two sites pointing at the same base URL would claim the same canonical links, and a hostname can only be mapped to one site — so keep it to this site alone."
        value={draft.base_url}
        onChange={(base_url) => onChange({ ...draft, base_url })}
      />
      <SlugField
        label="Slug"
        required
        data-testid="ck-site-wizard-slug"
        help="The site's identifier in every API path and in ?site= in this console. It is unique across the installation, cut to 96 characters by the server, and cannot be changed afterwards."
        derivedFrom={draft.name}
        siblings={takenSlugs}
        value={draft.slug}
        onChange={(next) => onChange({ ...draft, slug: next })}
      />
      <p className="text-xs text-muted-foreground">
        Stored as <span className="font-mono">{slug || '—'}</span> — the slug the server derives, cut to 96 characters
        {base ? (
          <>
            {' '}
            — and base URL <span className="font-mono">{base.replace(/\/$/, '')}</span>, which is how the server
            stores it: a trailing slash is removed.
          </>
        ) : null}
        .
      </p>
    </div>
  )
}

function LanguagesStep({ draft, onChange }: StepProps) {
  const extra = additionalLocales(draft)
  return (
    <div className="flex flex-col gap-4">
      <LocaleField
        label="Default locale"
        required
        data-testid="ck-site-wizard-default-locale"
        help="Where “/” redirects to, the locale the 404 page is served in, and the one locale row that always exists. A tag content cannot carry — “EN”, “german” — is refused here rather than by the server."
        locales={SUGGESTED_LOCALES}
        value={draft.default_locale}
        onChange={(default_locale) => onChange({ ...draft, default_locale })}
      />
      <TagListField
        label="Additional languages"
        data-testid="ck-site-wizard-extra-locales"
        help={`One page tree is built per locale, and all of them are part of the same POST /v1/sites. At most ${SITE_LOCALE_MAX} in total, the default included.`}
        fallback="Empty means one locale — the default."
        placeholder="de, fr — Enter to add"
        validate={(entry) =>
          !BCP47.test(entry.trim().toLowerCase())
            ? 'A language tag like “de” or “de-at”'
            : entry.trim().toLowerCase() === storedDefaultLocale(draft)
              ? 'Already the default locale'
              : undefined
        }
        value={draft.locales}
        onChange={(locales) => onChange({ ...draft, locales: [...locales] })}
      />
      <p className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
        Languages can be added later, in the Languages section of this site's settings: it lists the locale rows, adds
        one and removes one. Removing is refused while the locale is the default locale or while it still carries
        published or scheduled content, and no content is ever deleted by it. Nothing is served under a new locale until
        the next release is built.
        {extra.length ? (
          <>
            {' '}
            These {extra.length === 1 ? 'one' : extra.length} are created with the site.
          </>
        ) : null}
      </p>
    </div>
  )
}

function ReadyStep({ draft, slug, extra }: { draft: SiteDraft; slug: string; extra: readonly string[] }) {
  const locales = plannedLocales(draft)
  const rows: { key: string; label: string; value: string }[] = [
    { key: 'name', label: 'Name', value: draft.name.trim() },
    { key: 'slug', label: 'Slug', value: slug },
    { key: 'base-url', label: 'Base URL', value: draft.base_url.trim().replace(/\/$/, '') },
    { key: 'default-locale', label: 'Default locale', value: storedDefaultLocale(draft) },
    {
      key: 'locales',
      label: 'Locale rows',
      value: locales.join(', '),
    },
    {
      key: 'preset',
      label: 'Preset',
      value:
        draft.preset === 'portfolio'
          ? 'left unset — the builder reads that as portfolio'
          : draft.preset === 'product-docs'
            ? `${draft.preset}, version ${draft.docsVersion.id} (${draft.docsVersion.label.trim()}) as the current one`
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

      <div data-testid="ck-site-wizard-requests" className="rounded-lg border border-border p-3">
        <p className="text-xs font-medium">One request</p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">POST /v1/sites — {slug || '—'}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          It carries the row, {locales.length === 1 ? 'its locale row' : `all ${locales.length} locale rows`}
          {extra.length ? ` (${extra.join(', ')} beside the default)` : ''}
          {draft.preset === 'portfolio' ? ' and no settings' : ` and settings.presentation.preset = ${draft.preset}`}.
          Either everything is written or nothing is.
        </p>
      </div>

      {/*
        The one thing the old dialog never said. A site is not a live site: it is
        a row with a build matrix, and content changes nothing that a reader can
        see until a release is built from it and that release is activated.
      */}
      <ol
        data-testid="ck-site-wizard-next-steps"
        className="flex list-inside list-decimal flex-col gap-1 rounded-lg border border-accent/30 bg-accent/10 p-3 text-xs"
      >
        <li>
          Add content — pages, posts and decks. Nothing about them reaches a reader yet, whatever their revision says.
        </li>
        <li>Build a release. It renders every locale tree from what is published at that moment.</li>
        <li>Activate that release. This is the step that changes what the site serves.</li>
      </ol>
    </div>
  )
}
