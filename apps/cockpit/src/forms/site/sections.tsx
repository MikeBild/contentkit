import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, InfoIcon, Languages as LanguagesIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ck } from '@/api/ck'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { StatusBadge } from '@/forms/status-badge'
import { keys } from '@/lib/query'
import { useSite } from '@/lib/site'
import { THEME_TOKENS, PRESENTATION_PRESET, REPORT_CADENCE } from '../contracts/enums.generated'
import {
  CarriedKeys,
  ColorField,
  DimensionField,
  EnumSelect,
  FontFamilyField,
  KeyValueField,
  LocaleField,
  NumberField,
  ObjectListField,
  SchemeColorField,
  TextAreaField,
  TextField,
  TokenMapField,
  TriToggle,
  UrlField,
  UrlTemplateField,
  type SchemeValue,
  type TokenDefinition,
} from '../fields'
import type { useForm } from '../use-form'
import {
  ANALYTICS_PROVIDERS,
  AUDIO_PROVIDERS,
  carriedLeaves,
  type LinkTarget,
  type SiteSectionId,
  type SiteSettingsUI,
} from './contract'
import { SUGGESTED_LOCALES } from './rules'

export type SiteForm = ReturnType<typeof useForm<SiteSettingsUI>>

interface SectionProps {
  form: SiteForm
  /** The site's base URL, so an asset path can show what it will actually serve. */
  base: string
  locales: readonly string[]
  disabled: boolean
}

const grid = 'grid gap-4 sm:grid-cols-2'

/**
 * A 422 that names a subtree rather than a leaf.
 *
 * `settings.presentation.docs.versions needs 1-32 labeled unique ids` belongs to
 * the section, not to any one control, and `errorsFromResponse` deliberately
 * routes it to the owning prefix. Rendering it here is what keeps it visible
 * instead of counted.
 */
function SectionAlert({ form, paths }: { form: SiteForm; paths: readonly string[] }) {
  const messages = paths.map((path) => form.fieldError(path)).filter(Boolean)
  if (messages.length === 0) return null
  return (
    <Alert variant="destructive" data-testid="ck-site-section-alert">
      {/* Direct child of Alert and before the title: the CVA switches to a
          two-column grid on `has-[>svg]`, and a wrapped icon breaks it. */}
      <AlertTriangle />
      <AlertTitle>This section was refused</AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-1">
          {messages.map((message) => (
            <span key={message}>{message}</span>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  )
}

/**
 * `Note` used to live here: a `<p>` with two tones, which is how a form grows
 * its own private "explanatory text" slot and then fills it with paragraphs.
 * Every one of its six call sites is now the component the sentence actually
 * asked for — an `Alert` for a consequence, an `Empty` for "there is nothing
 * here", a `Popover` for the paragraph the Languages section opens with.
 */

function Identity({ form, locales, disabled }: SectionProps) {
  const { identity } = form.values
  return (
    <div className="flex flex-col gap-4">
      <SectionAlert form={form} paths={['identity']} />
      <div className={grid}>
        <TextField
          label="Name"
          required
          disabled={disabled}
          data-testid="ck-site-name"
          help="Used wherever a branding field is unset — the header, the feed titles, the blogcast channel."
          value={identity.name}
          error={form.fieldError('identity.name')}
          onChange={(value) => form.set('identity.name', value)}
        />
        <LocaleField
          label="Default locale"
          required
          disabled={disabled}
          data-testid="ck-site-default-locale"
          help="Where “/” redirects to, and the locale the 404 page is served in."
          about="It must be one of the locales this site builds."
          locales={locales}
          value={identity.default_locale}
          error={form.fieldError('identity.default_locale')}
          onChange={(value) => form.set('identity.default_locale', value)}
        />
      </div>
      <UrlField
        label="Base URL"
        required
        disabled={disabled}
        data-testid="ck-site-base-url"
        help="Every canonical link, feed URL and share target is built from this."
        value={identity.base_url}
        error={form.fieldError('identity.base_url')}
        onChange={(value) => form.set('identity.base_url', value)}
      />
      <TextAreaField
        label="Description"
        rows={3}
        disabled={disabled}
        data-testid="ck-site-description"
        help="The site's own description, used in the footer and as the feed description."
        value={identity.description}
        error={form.fieldError('identity.description')}
        onChange={(value) => form.set('identity.description', value)}
      />
      <Alert data-testid="ck-site-domains-note">
        <InfoIcon />
        <AlertTitle>Hostname mappings are not part of this form</AlertTitle>
        <AlertDescription>
          The site read does not return them, and `domains` is a whole-list write where an empty list removes every
          mapping — so the console never sends the key and the mappings stay as they are.
        </AlertDescription>
      </Alert>
    </div>
  )
}

/**
 * The locale rows: the site's build matrix, and the one part of this page that is
 * not a settings field.
 *
 * The create wizard has always said "languages can be added later". That was true
 * of the API — `POST` and `DELETE /v1/sites/{site}/locales/…` have both existed —
 * and false of the console: the client's remove-locale and read-locales methods
 * had no caller at all, and there was no locale editor on any page. The sentence
 * is now true here.
 *
 * Three properties this section has and the settings form deliberately does not:
 *
 *  - every write is its own request and takes effect at once, so there is no
 *    Save button and nothing here is part of the PATCH (`locales` is not in that
 *    body at all — `SitePatch` validates `default_locale` against these rows and
 *    never writes them);
 *  - the server's refusals are shown as they arrive, not translated. The default
 *    locale cannot be removed, and a locale that still carries published or
 *    scheduled content is refused with its counts. Those two 409s are the
 *    safeguard for every URL the site already serves;
 *  - nothing changes for a reader until the next release is built, which is what
 *    `rebuild_required` in each answer means.
 */
function Languages({ disabled }: SectionProps) {
  const { site } = useSite()
  const client = useQueryClient()
  const [adding, setAdding] = useState('')
  // Removal is confirmed in the row itself: a locale row is one page tree per
  // release, and the operator should see which one they are about to stop
  // building before it stops being built.
  const [removing, setRemoving] = useState<string | null>(null)

  const localeKey = [...keys.sites.detail(site), 'locales'] as const
  const rows = useQuery({
    queryKey: localeKey,
    queryFn: () => ck.sites.locales(site),
    enabled: Boolean(site),
  })

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: localeKey })
    // The site row's own `default_locale` is validated against these, and the
    // registry lists the site — both read stale sets otherwise.
    await client.invalidateQueries({ queryKey: keys.sites.all })
  }

  const add = useMutation({
    mutationFn: (locale: string) => ck.sites.addLocale(site, locale.trim().toLowerCase()),
    onSuccess: async () => {
      setAdding('')
      await refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (locale: string) => ck.sites.removeLocale(site, locale),
    onSuccess: async () => {
      setRemoving(null)
      await refresh()
    },
  })

  const data = rows.data
  const stored = data?.locales ?? []
  const builds = data?.builds ?? []
  const max = data?.max_locales
  const defaultLocale = data?.default_locale ?? ''
  const busy = disabled || add.isPending || remove.isPending
  const full = typeof max === 'number' && stored.length >= max
  const removed = remove.data

  return (
    <div data-testid="ck-site-locales" className="flex flex-col gap-4">
      {/* The section's standing explanation — three claims that are true of every
          locale row and of none in particular. On screen it was a paragraph
          nobody reads twice; behind the affordance it is a paragraph anyone can
          read once. */}
      <div className="flex items-center gap-1">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              data-testid="ck-site-locales-about"
              aria-label="What adding or removing a locale row does"
            >
              <InfoIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" data-testid="ck-site-locales-about-content">
            <PopoverTitle>Rows change nothing until the next release</PopoverTitle>
            <PopoverDescription>
              Adding or removing a row changes nothing a reader sees until the next release is built. Removing one is
              refused while it is the default locale, and while it still carries published or scheduled content; the
              refusal names the counts. Content is never deleted by it.
            </PopoverDescription>
          </PopoverContent>
        </Popover>
      </div>
      {rows.isPending ? (
        <p className="text-xs text-muted-foreground">Loading the locale rows…</p>
      ) : rows.error ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>The locale rows could not be read</AlertTitle>
          <AlertDescription data-testid="ck-site-locales-load-error">
            {rows.error instanceof Error ? rows.error.message : 'Could not read the locale rows'}
          </AlertDescription>
          <AlertAction>
            <Button variant="ghost" size="sm" data-testid="ck-site-locales-retry" onClick={() => void rows.refetch()}>
              Try again
            </Button>
          </AlertAction>
        </Alert>
      ) : (
        <ul data-testid="ck-site-locales-list" className="flex flex-col gap-2">
          {stored.map((row) => {
            const isDefault = row.locale === defaultLocale
            return (
              <li
                key={row.locale}
                data-testid={`ck-site-locale-${row.locale}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 text-xs"
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono">{row.locale}</span>
                  {isDefault ? (
                    // A row's status, said as a badge, with the reason one hover
                    // or one focus away — the sentence used to run the width of
                    // the row on every locale list in the console.
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} data-testid={`ck-site-locale-default-${row.locale}`}>
                            <StatusBadge tone="info">default locale</StatusBadge>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          “/” redirects here and the 404 page is built from it, so it cannot be removed.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : null}
                </span>
                {isDefault ? null : removing === row.locale ? (
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      Stop building /{row.locale}/? Its content is kept and nothing is deleted.
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      data-testid={`ck-site-locale-remove-confirm-${row.locale}`}
                      onClick={() => remove.mutate(row.locale)}
                    >
                      {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
                      {remove.isPending ? 'Removing…' : 'Remove'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`ck-site-locale-remove-cancel-${row.locale}`}
                      onClick={() => setRemoving(null)}
                    >
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    data-testid={`ck-site-locale-remove-${row.locale}`}
                    onClick={() => {
                      remove.reset()
                      setRemoving(row.locale)
                    }}
                  >
                    Remove
                  </Button>
                )}
              </li>
            )
          })}
          {stored.length === 0 ? (
            <li>
              <Empty className="border" data-testid="ck-site-locales-empty">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <LanguagesIcon />
                  </EmptyMedia>
                  <EmptyTitle>No locale rows are stored</EmptyTitle>
                  <EmptyDescription>
                    The next release still builds <span className="font-mono">{builds.join(', ') || defaultLocale}</span>{' '}
                    — the documented fallback to default_locale — so the build matrix is untracked rather than empty.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </li>
          ) : null}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <LocaleField
            label="Add a language"
            disabled={busy || full}
            data-testid="ck-site-locales-add"
            help="One page tree is built per row."
            about="The tag is case-folded server-side; a locale the site already has is refused with 409, and content can only be ingested into a locale this list contains."
            // Filtered against the stored ROWS, not against what the site builds.
            // The two differ on exactly the site this editor exists to repair: a
            // site with no rows still builds its default locale through the
            // documented fallback, so filtering on `builds` withheld the one row
            // such a site is missing — the console offered every locale except
            // the only one worth adding. A 409 is about a row that exists, and
            // `stored` is the list of rows.
            locales={SUGGESTED_LOCALES.filter((locale) => !stored.some((row) => row.locale === locale))}
            value={adding}
            onChange={(value) => {
              add.reset()
              setAdding(value)
            }}
          />
        </div>
        <Button
          size="sm"
          disabled={busy || full || !adding.trim()}
          data-testid="ck-site-locales-add-submit"
          onClick={() => add.mutate(adding)}
        >
          {add.isPending ? <Spinner data-icon="inline-start" /> : null}
          {add.isPending ? 'Adding…' : 'Add locale'}
        </Button>
      </div>

      {add.error ? (
        <Alert variant="destructive" data-testid="ck-site-locales-add-error">
          <AlertTriangle />
          <AlertTitle>The locale was not added</AlertTitle>
          <AlertDescription>
            {add.error instanceof Error ? add.error.message : 'The locale could not be added'}
          </AlertDescription>
        </Alert>
      ) : null}
      {remove.error ? (
        // Verbatim: “locale en still has 2 published and 1 scheduled content
        // item(s)…” names what to do, and a rewritten version would drop the
        // counts that make it actionable.
        <Alert variant="destructive" data-testid="ck-site-locales-remove-error">
          <AlertTriangle />
          <AlertTitle>The locale was not removed</AlertTitle>
          <AlertDescription>
            {remove.error instanceof Error ? remove.error.message : 'The locale could not be removed'}
          </AlertDescription>
        </Alert>
      ) : null}
      {removed ? (
        <Alert data-testid="ck-site-locales-removed">
          <AlertTriangle />
          <AlertTitle>
            <span className="font-mono">{removed.locale}</span> is no longer built
          </AlertTitle>
          <AlertDescription>
            {removed.draft_items} content {removed.draft_items === 1 ? 'item stays' : 'items stay'} in it, unpublished
            and undeleted — nothing is served from that locale until it is added back and a release is built.
          </AlertDescription>
        </Alert>
      ) : null}

      {full ? (
        <Alert data-testid="ck-site-locales-full">
          <AlertTriangle />
          <AlertDescription>
            {max} locale rows is the cap: every row adds a full page tree — home, listings, tags, feeds and a 404 — to
            every release.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

function Presentation({ form, disabled }: SectionProps) {
  const presentation = form.values.settings.presentation
  return (
    <div className="flex flex-col gap-4">
      <SectionAlert
        form={form}
        paths={['settings.presentation', 'settings.presentation.docs.versions', 'settings.presentation.report_series']}
      />
      <EnumSelect
        label="Preset"
        disabled={disabled}
        data-testid="ck-site-preset"
        definition="Decides the navigation model and the default layout a document without an explicit one gets."
        fallback="Unset behaves as portfolio."
        options={PRESENTATION_PRESET.map((value) => ({ value, label: value }))}
        allowEmpty
        placeholder="portfolio (default)"
        value={presentation.preset}
        error={form.fieldError('settings.presentation.preset')}
        onChange={(value) => form.set('settings.presentation.preset', value)}
      />

      <ObjectListField
        label="Documentation versions"
        disabled={disabled}
        data-testid="ck-site-docs-versions"
        help="Exactly one version is the current one; the rest are archived and stay reachable under their own id."
        max={32}
        emptyMessage="No versions — the product-docs preset needs at least one."
        addLabel="Add version"
        uniqueBy={(entry) => entry.id}
        exclusiveFlag={{ key: 'current', label: 'Current' }}
        itemLabel={(entry) => entry.label || entry.id || 'New version'}
        create={() => ({ id: '', label: '', current: false })}
        value={presentation.docs.versions}
        error={form.fieldError('settings.presentation.docs.versions')}
        onChange={(value) => form.set('settings.presentation.docs.versions', value)}
        renderItem={(entry, api) => (
          <div className={grid}>
            <TextField
              label="ID"
              required
              disabled={disabled}
              data-testid={`ck-site-docs-version-id-${api.index}`}
              help="Appears in the URL and in a document's docsVersion."
              value={entry.id}
              error={form.fieldError(`settings.presentation.docs.versions.${api.index}.id`)}
              onChange={(value) => api.update({ id: value })}
            />
            <TextField
              label="Label"
              required
              maxLength={120}
              disabled={disabled}
              data-testid={`ck-site-docs-version-label-${api.index}`}
              value={entry.label}
              error={form.fieldError(`settings.presentation.docs.versions.${api.index}.label`)}
              onChange={(value) => api.update({ label: value })}
            />
          </div>
        )}
      />

      <ObjectListField
        label="Report series"
        disabled={disabled}
        data-testid="ck-site-report-series"
        help="A document selects one with reportSeries."
        about="Removing a series that documents still reference does not fail this save — it fails the next release."
        max={32}
        emptyMessage="No series configured."
        addLabel="Add series"
        uniqueBy={(entry) => entry.id}
        itemLabel={(entry) => entry.label || entry.id || 'New series'}
        create={() => ({ id: '', label: '', nav_order: 0, lead_cadence: 'monthly' as const })}
        value={presentation.report_series}
        error={form.fieldError('settings.presentation.report_series')}
        onChange={(value) => form.set('settings.presentation.report_series', value)}
        renderItem={(entry, api) => (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TextField
              label="ID"
              required
              disabled={disabled}
              data-testid={`ck-site-series-id-${api.index}`}
              value={entry.id}
              error={form.fieldError(`settings.presentation.report_series.${api.index}.id`)}
              onChange={(value) => api.update({ id: value })}
            />
            <TextField
              label="Label"
              required
              maxLength={120}
              disabled={disabled}
              data-testid={`ck-site-series-label-${api.index}`}
              value={entry.label}
              error={form.fieldError(`settings.presentation.report_series.${api.index}.label`)}
              onChange={(value) => api.update({ label: value })}
            />
            <NumberField
              label="Navigation order"
              integer
              disabled={disabled}
              data-testid={`ck-site-series-order-${api.index}`}
              value={entry.nav_order}
              error={form.fieldError(`settings.presentation.report_series.${api.index}.nav_order`)}
              onChange={(value) => api.update({ nav_order: value ?? 0 })}
            />
            <EnumSelect
              label="Lead cadence"
              disabled={disabled}
              data-testid={`ck-site-series-cadence-${api.index}`}
              options={REPORT_CADENCE.map((value) => ({ value, label: value }))}
              value={entry.lead_cadence}
              onChange={(value) => value && api.update({ lead_cadence: value })}
            />
          </div>
        )}
      />
    </div>
  )
}

// The allowlist, with what each token actually paints. An unknown key fails the
// whole PATCH, so the menu is the allowlist and there is no text box for a key.
const TOKEN_LABELS: Record<string, string> = {
  background: 'Page background',
  foreground: 'Body text',
  muted: 'Muted surface',
  muted_foreground: 'Muted text',
  border: 'Borders',
  primary: 'Primary',
  primary_foreground: 'Text on primary',
  chart_1: 'Chart series 1',
  chart_2: 'Chart series 2',
  chart_3: 'Chart series 3',
  chart_4: 'Chart series 4',
  chart_5: 'Chart series 5',
  radius: 'Corner radius',
  font_family: 'Font stack',
}

const TOKENS: TokenDefinition[] = THEME_TOKENS.map((key) => ({ key, label: TOKEN_LABELS[key] ?? key }))

function Theme({ form, disabled }: SectionProps) {
  const theme = form.values.settings.theme
  return (
    <div className="flex flex-col gap-4">
      <SectionAlert form={form} paths={['settings.theme', 'settings.theme.tokens', 'settings.theme.custom_css']} />
      <TokenMapField
        label="Theme tokens"
        disabled={disabled}
        data-testid="ck-site-theme-tokens"
        help="Each token applies to the page and to server-rendered report charts alike."
        about="A token left unset keeps the stock value."
        tokens={TOKENS}
        value={theme.tokens}
        error={form.fieldError('settings.theme.tokens')}
        onChange={(value) => form.set('settings.theme.tokens', value)}
        renderValue={(token, entry, set) => {
          const value = (entry ?? '') as SchemeValue
          if (token.key === 'radius') {
            return (
              <DimensionField
                label={token.label}
                disabled={disabled}
                data-testid={`ck-site-token-${token.key}`}
                value={typeof value === 'string' ? value : value.light}
                error={form.fieldError(`settings.theme.tokens.${token.key}`)}
                onChange={set}
              />
            )
          }
          if (token.key === 'font_family') {
            return (
              <FontFamilyField
                label={token.label}
                disabled={disabled}
                data-testid={`ck-site-token-${token.key}`}
                value={typeof value === 'string' ? value : value.light}
                error={form.fieldError(`settings.theme.tokens.${token.key}`)}
                onChange={set}
              />
            )
          }
          return (
            <SchemeColorField
              label={token.label}
              disabled={disabled}
              data-testid={`ck-site-token-${token.key}`}
              value={value}
              error={form.fieldError(`settings.theme.tokens.${token.key}`)}
              onChange={set}
            />
          )
        }}
      />

      <div className={grid}>
        <ColorField
          label="Accent"
          disabled={disabled}
          data-testid="ck-site-accent"
          help="Colours the mask icon; unrelated to the primary token."
          value={form.values.settings.accent}
          error={form.fieldError('settings.accent')}
          onChange={(value) => form.set('settings.accent', value)}
        />
        <ColorField
          label="Browser theme colour"
          disabled={disabled}
          data-testid="ck-site-theme-color"
          help="The colour a mobile browser paints its chrome with."
          value={form.values.settings.theme_color}
          error={form.fieldError('settings.theme_color')}
          onChange={(value) => form.set('settings.theme_color', value)}
        />
      </div>

      <TextAreaField
        label="Custom CSS"
        rows={10}
        monospace
        maxBytes={8192}
        forbid={/<\/style/i}
        forbidMessage="“</style” would break out of the style element"
        disabled={disabled}
        data-testid="ck-site-custom-css"
        help="Inlined verbatim into every page, after the tokens."
        about="The escape hatch for whatever the tokens do not cover."
        value={theme.custom_css}
        error={form.fieldError('settings.theme.custom_css')}
        onChange={(value) => form.set('settings.theme.custom_css', value)}
      />
    </div>
  )
}

function Branding({ form, base, disabled }: SectionProps) {
  const settings = form.values.settings
  const asset = (
    label: string,
    path: 'profile_image' | 'favicon' | 'apple_touch_icon' | 'mask_icon' | 'og_image',
    help: string,
  ) => (
    <UrlField
      label={label}
      mode="asset"
      base={base}
      disabled={disabled}
      data-testid={`ck-site-${path.replace(/_/g, '-')}`}
      help={help}
      value={settings[path]}
      error={form.fieldError(`settings.${path}`)}
      onChange={(value) => form.set(`settings.${path}`, value)}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      <SectionAlert form={form} paths={['settings.hero_title', 'settings.hero_text']} />
      <div className={grid}>
        <TextField
          label="Eyebrow"
          disabled={disabled}
          data-testid="ck-site-eyebrow"
          definition="The small line above the hero title."
          fallback="Unset means no eyebrow."
          value={settings.eyebrow}
          error={form.fieldError('settings.eyebrow')}
          onChange={(value) => form.set('settings.eyebrow', value)}
        />
        <TextField
          label="Hero title"
          disabled={disabled}
          data-testid="ck-site-hero-title"
          fallback="Unset falls back to the site name."
          value={settings.hero_title}
          error={form.fieldError('settings.hero_title')}
          onChange={(value) => form.set('settings.hero_title', value)}
        />
      </div>
      <TextAreaField
        label="Hero text"
        rows={3}
        disabled={disabled}
        data-testid="ck-site-hero-text"
        fallback="Unset falls back to the site description."
        value={settings.hero_text}
        error={form.fieldError('settings.hero_text')}
        onChange={(value) => form.set('settings.hero_text', value)}
      />
      <div className={grid}>
        {asset('Profile image', 'profile_image', 'Shown on the landing page. A path is resolved against the base URL.')}
        <TextField
          label="Profile image alt text"
          disabled={disabled}
          data-testid="ck-site-profile-image-alt"
          help="Describes the image for anyone who cannot see it."
          warning={
            settings.profile_image && !settings.profile_image_alt ? 'The image has no alternative text' : undefined
          }
          value={settings.profile_image_alt}
          error={form.fieldError('settings.profile_image_alt')}
          onChange={(value) => form.set('settings.profile_image_alt', value)}
        />
        {asset('Favicon', 'favicon', 'A .svg or .png; the type is derived from the extension.')}
        {asset('Apple touch icon', 'apple_touch_icon', 'The icon iOS uses for a page saved to the home screen.')}
        {asset('Mask icon', 'mask_icon', 'A monochrome SVG; it is tinted with the accent colour.')}
      </div>
    </div>
  )
}

function Seo({ form, base, disabled }: SectionProps) {
  const settings = form.values.settings
  return (
    <div className="flex flex-col gap-4">
      <SectionAlert form={form} paths={['settings.socials']} />
      <div className={grid}>
        <UrlField
          label="Share image"
          mode="asset"
          base={base}
          disabled={disabled}
          data-testid="ck-site-og-image"
          help="The Open Graph image used when a page carries none of its own."
          value={settings.og_image}
          error={form.fieldError('settings.og_image')}
          onChange={(value) => form.set('settings.og_image', value)}
        />
        <TextField
          label="Share image alt text"
          disabled={disabled}
          data-testid="ck-site-og-image-alt"
          warning={settings.og_image && !settings.og_image_alt ? 'The image has no alternative text' : undefined}
          value={settings.og_image_alt}
          error={form.fieldError('settings.og_image_alt')}
          onChange={(value) => form.set('settings.og_image_alt', value)}
        />
      </div>
      <TextField
        label="Twitter handle"
        disabled={disabled}
        data-testid="ck-site-twitter-handle"
        help="With or without the leading @; it is emitted as the twitter:site card attribution."
        value={settings.twitter_handle}
        error={form.fieldError('settings.twitter_handle')}
        onChange={(value) => form.set('settings.twitter_handle', value)}
      />
      <KeyValueField
        label="Social links"
        disabled={disabled}
        data-testid="ck-site-socials"
        help="Rendered in the footer with rel=me and published as schema.org sameAs."
        about="The key is the visible name."
        keyLabel="Network"
        valueLabel="URL"
        value={settings.socials}
        error={form.fieldError('settings.socials')}
        onChange={(value) => form.set('settings.socials', value)}
      />
    </div>
  )
}

function Analytics({ form, disabled }: SectionProps) {
  const analytics = form.values.settings.analytics
  return (
    <div className="flex flex-col gap-4">
      <SectionAlert form={form} paths={['settings.analytics']} />
      <EnumSelect
        label="Provider"
        disabled={disabled}
        data-testid="ck-site-analytics-provider"
        about="Plausible is cookieless and loads one script. GA4 is withheld until the visitor consents and adds a consent control to the footer."
        fallback="Unset means no analytics at all."
        allowEmpty
        placeholder="No analytics"
        options={ANALYTICS_PROVIDERS.map((value) => ({
          value,
          label: value === 'ga4' ? 'Google Analytics 4' : 'Plausible',
          description:
            value === 'ga4'
              ? 'Needs a measurement id and ships the consent gate.'
              : 'Needs the measured domain. No consent banner.',
        }))}
        value={analytics.provider}
        error={form.fieldError('settings.analytics.provider')}
        onChange={(value) => form.set('settings.analytics.provider', value)}
      />
      {analytics.provider === 'plausible' ? (
        <div className={grid}>
          <TextField
            label="Measured domain"
            required
            disabled={disabled}
            data-testid="ck-site-analytics-domain"
            help="The data-domain the script is loaded with."
            about="Without it nothing is emitted at all."
            value={analytics.domain}
            error={form.fieldError('settings.analytics.domain')}
            onChange={(value) => form.set('settings.analytics.domain', value)}
          />
          <UrlField
            label="Script URL"
            disabled={disabled}
            data-testid="ck-site-analytics-src"
            fallback="Unset uses plausible.io's own script."
            value={analytics.src}
            error={form.fieldError('settings.analytics.src')}
            onChange={(value) => form.set('settings.analytics.src', value)}
          />
        </div>
      ) : null}
      {analytics.provider === 'ga4' ? (
        <TextField
          label="Measurement id"
          required
          disabled={disabled}
          data-testid="ck-site-analytics-id"
          help="The G- id."
          about="Everything but letters, digits and hyphens is stripped before it reaches the page."
          value={analytics.id}
          error={form.fieldError('settings.analytics.id')}
          onChange={(value) => form.set('settings.analytics.id', value)}
        />
      ) : null}
    </div>
  )
}

const FEED_PLACEHOLDERS = [
  { token: 'feed', description: 'The absolute feed URL.' },
  { token: 'feed_encoded', description: 'The absolute feed URL, URL-encoded.' },
  { token: 'feed_no_scheme', description: 'The feed URL without https://, the form podcast:// expects.' },
]

const FEED_SAMPLE = {
  feed: 'https://example.com/en/blogcast.xml',
  feed_encoded: 'https%3A%2F%2Fexample.com%2Fen%2Fblogcast.xml',
  feed_no_scheme: 'example.com/en/blogcast.xml',
}

// App-protocol deep links are how a podcast client subscribes; refusing them
// here would leave the field able to express only the http targets.
const FEED_PROTOCOLS = ['https:', 'http:', 'podcast:', 'overcast:', 'pktc:']

function TargetList({
  label,
  help,
  path,
  value,
  form,
  disabled,
  testId,
  placeholders,
  sample,
  protocols,
  emptyMessage,
}: {
  label: string
  help: string
  path: string
  value: readonly LinkTarget[]
  form: SiteForm
  disabled: boolean
  testId: string
  placeholders: readonly { token: string; description: string }[]
  sample: Record<string, string>
  protocols?: string[]
  emptyMessage: string
}) {
  return (
    <ObjectListField
      label={label}
      help={help}
      disabled={disabled}
      data-testid={testId}
      emptyMessage={emptyMessage}
      addLabel="Add target"
      uniqueBy={(entry) => entry.label}
      itemLabel={(entry) => entry.label || 'New target'}
      create={() => ({ label: '', url_template: '' })}
      value={value}
      error={form.fieldError(path)}
      onChange={(next) => form.set(path, next)}
      renderItem={(entry, api) => (
        <div className="flex flex-col gap-4">
          <TextField
            label="Label"
            required
            disabled={disabled}
            data-testid={`${testId}-label-${api.index}`}
            value={entry.label}
            onChange={(next) => api.update({ label: next })}
          />
          <UrlTemplateField
            label="URL template"
            required
            disabled={disabled}
            data-testid={`${testId}-url-${api.index}`}
            placeholders={placeholders}
            sample={sample}
            protocols={protocols}
            value={entry.url_template}
            onChange={(next) => api.update({ url_template: next })}
          />
        </div>
      )}
    />
  )
}

function Audio({ form, base, disabled }: SectionProps) {
  const audio = form.values.settings.audio
  const on = audio.enabled === true
  return (
    <div className="flex flex-col gap-4">
      <SectionAlert form={form} paths={['settings.audio']} />
      <TriToggle
        label="Read-aloud"
        data-testid="ck-site-audio-enabled"
        disabled={disabled}
        defaultLabel="off"
        help="Narration is only produced for published posts, and only when this is explicitly on."
        value={audio.enabled}
        error={form.fieldError('settings.audio.enabled')}
        onChange={(value) => form.set('settings.audio.enabled', value)}
      />
      {!on ? (
        <Alert data-testid="ck-site-audio-off-note">
          <InfoIcon />
          <AlertDescription>
            The rest of this section is stored but has no effect until read-aloud is on.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className={grid}>
        <EnumSelect
          label="Voice provider"
          disabled={disabled}
          data-testid="ck-site-audio-provider"
          fallback="Unset uses google."
          allowEmpty
          placeholder="google (default)"
          options={AUDIO_PROVIDERS.map((value) => ({
            value,
            label: value === 'google' ? 'Google Chirp 3 HD' : 'Fake (synthesises nothing)',
            description: value === 'fake' ? 'Deterministic placeholder audio. Meant for testing, not for a live site.' : undefined,
          }))}
          value={audio.provider}
          error={form.fieldError('settings.audio.provider')}
          onChange={(value) => form.set('settings.audio.provider', value)}
        />
        <TextField
          label="Voice"
          disabled={disabled}
          data-testid="ck-site-audio-voice"
          about="The provider's voice name, for example de-DE-Chirp3-HD-Charon. Its language prefix decides the spoken language."
          fallback="Unset uses the provider's default voice."
          value={audio.voice}
          error={form.fieldError('settings.audio.voice')}
          onChange={(value) => form.set('settings.audio.voice', value)}
        />
      </div>

      <div className={grid}>
        <TextField
          label="Channel title"
          disabled={disabled}
          data-testid="ck-site-audio-title"
          fallback="Unset falls back to the site name."
          value={audio.title}
          error={form.fieldError('settings.audio.title')}
          onChange={(value) => form.set('settings.audio.title', value)}
        />
        <TextField
          label="Channel author"
          disabled={disabled}
          data-testid="ck-site-audio-author"
          fallback="Unset falls back to the site name."
          value={audio.author}
          error={form.fieldError('settings.audio.author')}
          onChange={(value) => form.set('settings.audio.author', value)}
        />
      </div>
      <TextAreaField
        label="Channel description"
        rows={3}
        disabled={disabled}
        data-testid="ck-site-audio-description"
        fallback="Unset falls back to the site description."
        value={audio.description}
        error={form.fieldError('settings.audio.description')}
        onChange={(value) => form.set('settings.audio.description', value)}
      />

      <div className={grid}>
        <NumberField
          label="Monthly character budget"
          integer
          min={0}
          unit="characters"
          allowUnset
          unsetLabel="No budget"
          disabled={disabled}
          data-testid="ck-site-audio-budget"
          help="Narration stops for the month once the budget is spent."
          about="Unset is not zero — it means no ceiling at all."
          value={audio.monthly_char_budget}
          error={form.fieldError('settings.audio.monthly_char_budget')}
          onChange={(value) => form.set('settings.audio.monthly_char_budget', value)}
        />
        <TriToggle
          label="Re-narrate on republish"
          data-testid="ck-site-audio-auto-rebuild"
          disabled={disabled}
          defaultLabel="on"
          help="Off keeps the existing audio when a post is edited, which also keeps the budget."
          value={audio.auto_rebuild}
          error={form.fieldError('settings.audio.auto_rebuild')}
          onChange={(value) => form.set('settings.audio.auto_rebuild', value)}
        />
      </div>

      <TriToggle
        label="Link the blogcast in the footer"
        data-testid="ck-site-audio-blogcast-link"
        disabled={disabled}
        defaultLabel="off"
        help="The blogcast page exists as soon as a narrated post does; this decides whether it is listed."
        value={audio.blogcast_link}
        error={form.fieldError('settings.audio.blogcast_link')}
        onChange={(value) => form.set('settings.audio.blogcast_link', value)}
      />

      <div className={grid}>
        <UrlField
          label="Cover art"
          mode="asset"
          base={base}
          disabled={disabled}
          data-testid="ck-site-audio-blogcast-image"
          help="Podcast directories want a square image of at least 1400 px."
          value={audio.blogcast_image}
          error={form.fieldError('settings.audio.blogcast_image')}
          onChange={(value) => form.set('settings.audio.blogcast_image', value)}
        />
        <TextField
          label="iTunes category"
          disabled={disabled}
          data-testid="ck-site-audio-blogcast-category"
          help="Emitted verbatim as the itunes:category text."
          value={audio.blogcast_category}
          error={form.fieldError('settings.audio.blogcast_category')}
          onChange={(value) => form.set('settings.audio.blogcast_category', value)}
        />
      </div>

      <TargetList
        label="Subscribe targets"
        help="The “open in …” buttons beside the blogcast feed."
        path="settings.audio.subscribe_targets"
        testId="ck-site-audio-targets"
        emptyMessage="None — the built-in podcast clients are offered instead."
        placeholders={FEED_PLACEHOLDERS}
        sample={FEED_SAMPLE}
        protocols={FEED_PROTOCOLS}
        value={audio.subscribe_targets}
        form={form}
        disabled={disabled}
      />
    </div>
  )
}

const SHARE_PLACEHOLDERS = [{ token: 'q', description: 'The URL-encoded, localised prompt naming the page.' }]
const SHARE_SAMPLE = { q: 'Read%20https%3A%2F%2Fexample.com%2Fen%2Fposts%2Fhello%2F' }

function Reader({ form, disabled }: SectionProps) {
  const settings = form.values.settings
  return (
    <div className="flex flex-col gap-4">
      <SectionAlert form={form} paths={['settings.comments', 'settings.feedback', 'settings.search', 'settings.content']} />
      <div className={grid}>
        <TriToggle
          label="Comments"
          data-testid="ck-site-comments-enabled"
          disabled={disabled}
          defaultLabel="on"
          help="Off makes the public comment endpoint answer 404 as well, not just the form."
          value={settings.comments.enabled}
          error={form.fieldError('settings.comments.enabled')}
          onChange={(value) => form.set('settings.comments.enabled', value)}
        />
        <TriToggle
          label="Feedback"
          data-testid="ck-site-feedback-enabled"
          disabled={disabled}
          defaultLabel="off"
          help="The thumbs-up/down widget under a post."
          about="It has to be switched on explicitly."
          value={settings.feedback.enabled}
          error={form.fieldError('settings.feedback.enabled')}
          onChange={(value) => form.set('settings.feedback.enabled', value)}
        />
      </div>
      <TextField
        label="Turnstile site key"
        disabled={disabled}
        data-testid="ck-site-turnstile"
        help="The public half of the Cloudflare Turnstile pair, used by the comment and contact forms."
        about="The secret half is server configuration, not a setting."
        warning={
          settings.comments.enabled !== false && !settings.turnstile_site_key
            ? 'Comments accept submissions with no challenge in front of them'
            : undefined
        }
        value={settings.turnstile_site_key}
        error={form.fieldError('settings.turnstile_site_key')}
        onChange={(value) => form.set('settings.turnstile_site_key', value)}
      />
      <div className={grid}>
        <TriToggle
          label="Index the body text"
          data-testid="ck-site-search-index-body"
          disabled={disabled}
          defaultLabel="off"
          help="On makes the search index carry the whole article rather than title, summary and tags."
          about="It grows every release."
          value={settings.search.index_body}
          error={form.fieldError('settings.search.index_body')}
          onChange={(value) => form.set('settings.search.index_body', value)}
        />
        <TriToggle
          label="Show authored extra fields"
          data-testid="ck-site-content-show-extra"
          disabled={disabled}
          defaultLabel="off"
          help="Renders a document's own extra: map on the page and in its Markdown twin."
          value={settings.content.show_extra}
          error={form.fieldError('settings.content.show_extra')}
          onChange={(value) => form.set('settings.content.show_extra', value)}
        />
      </div>

      <TriToggle
        label="Subscribe row under the blog feed"
        data-testid="ck-site-blog-subscribe-row"
        disabled={disabled}
        defaultLabel="on"
        value={settings.blog.subscribe_row}
        error={form.fieldError('settings.blog.subscribe_row')}
        onChange={(value) => form.set('settings.blog.subscribe_row', value)}
      />
      <TargetList
        label="Feed reader targets"
        help="The “open in …” buttons beside the blog feed."
        path="settings.blog.subscribe_targets"
        testId="ck-site-blog-targets"
        emptyMessage="None — the built-in feed readers are offered instead."
        placeholders={FEED_PLACEHOLDERS}
        sample={{ ...FEED_SAMPLE, feed: 'https://example.com/en/feed.xml' }}
        protocols={FEED_PROTOCOLS}
        value={settings.blog.subscribe_targets}
        form={form}
        disabled={disabled}
      />

      <TriToggle
        label="AI share row"
        data-testid="ck-site-ai-share-buttons"
        disabled={disabled}
        defaultLabel="on"
        help="A link to the page's Markdown twin, a copy button and “open in …” deep links."
        about="Nothing here talks to any provider; the reader does, from their own account."
        value={settings.ai.share_buttons}
        error={form.fieldError('settings.ai.share_buttons')}
        onChange={(value) => form.set('settings.ai.share_buttons', value)}
      />
      <TargetList
        label="Assistant targets"
        help="Replaces the built-in list entirely."
        path="settings.ai.share_targets"
        testId="ck-site-ai-targets"
        emptyMessage="None — the built-in assistants are offered instead."
        placeholders={SHARE_PLACEHOLDERS}
        sample={SHARE_SAMPLE}
        value={settings.ai.share_targets}
        form={form}
        disabled={disabled}
      />
    </div>
  )
}

function Unmanaged({ form, disabled }: SectionProps) {
  const leaves = carriedLeaves(form.values.carried)
  const display = Object.fromEntries(leaves.map((leaf) => [leaf.path, leaf.value]))

  if (leaves.length === 0) {
    return (
      <Empty className="border" data-testid="ck-site-carried-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InfoIcon />
          </EmptyMedia>
          <EmptyTitle>Nothing here</EmptyTitle>
          <EmptyDescription>
            Every key this site stores is rendered by one of the other sections — and anything a future version or a
            script writes will appear here instead of being dropped by a save.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert data-testid="ck-site-carried-note">
        <InfoIcon />
        <AlertTitle>These keys are not editable here</AlertTitle>
        <AlertDescription>
          A form that could edit an unknown shape would be a JSON box again. They are preserved on every save, and
          removing one is the one change this section can make.
        </AlertDescription>
      </Alert>
      <CarriedKeys
        data-testid="ck-site-carried"
        value={display}
        onRemove={(path) => {
          if (disabled) return
          // Recorded as well as hidden: the object that is actually saved is the
          // one re-read from the server, and it has to be told what to drop.
          form.set('carried', dropLeaf(form.values.carried, path))
          form.set('removed', [...form.values.removed, path])
        }}
      />
    </div>
  )
}

function dropLeaf(carried: Record<string, unknown>, path: string): Record<string, unknown> {
  const [head, ...rest] = path.split('.')
  if (!head) return carried
  if (rest.length === 0) {
    const { [head]: _removed, ...remaining } = carried
    return remaining
  }
  const child = carried[head]
  if (!child || typeof child !== 'object' || Array.isArray(child)) return carried
  const next = dropLeaf(child as Record<string, unknown>, rest.join('.'))
  if (Object.keys(next).length === 0) {
    const { [head]: _emptied, ...remaining } = carried
    return remaining
  }
  return { ...carried, [head]: next }
}

export const SITE_SECTION_BODIES: Record<SiteSectionId, (props: SectionProps) => ReactNode> = {
  identity: Identity,
  languages: Languages,
  presentation: Presentation,
  theme: Theme,
  branding: Branding,
  seo: Seo,
  analytics: Analytics,
  audio: Audio,
  reader: Reader,
  unmanaged: Unmanaged,
}

export type { SectionProps }
