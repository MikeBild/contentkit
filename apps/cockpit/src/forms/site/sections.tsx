import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, InfoIcon, Languages as LanguagesIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ck } from '@/api/ck'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { StatusBadge } from '@/forms/status-badge'
import { keys } from '@/lib/query'
import { visibleLabel } from '@/lib/opaque'
import { useSite } from '@/lib/site'
import { useI18n, type TranslationKey } from '@/lib/i18n-context'
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
  const { t } = useI18n()
  const messages = paths.map((path) => form.fieldError(path)).filter(Boolean)
  if (messages.length === 0) return null
  return (
    <Alert variant="destructive" data-testid="ck-site-section-alert">
      {/* Direct child of Alert and before the title: the CVA switches to a
          two-column grid on `has-[>svg]`, and a wrapped icon breaks it. */}
      <AlertTriangle />
      <AlertTitle>{t('siteForm.sectionRefused')}</AlertTitle>
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
  const { t } = useI18n()
  const { identity } = form.values
  return (
    <div className="flex flex-col gap-4">
      <SectionAlert form={form} paths={['identity']} />
      <div className={grid}>
        <TextField
          label={t('siteForm.name')}
          required
          disabled={disabled}
          data-testid="ck-site-name"
          help={t('siteForm.nameHelp')}
          value={identity.name}
          error={form.fieldError('identity.name')}
          onChange={(value) => form.set('identity.name', value)}
        />
        <LocaleField
          label={t('siteForm.defaultLocale')}
          required
          disabled={disabled}
          data-testid="ck-site-default-locale"
          help={t('siteForm.defaultLocaleHelp')}
          about={t('siteForm.defaultLocaleAbout')}
          locales={locales}
          value={identity.default_locale}
          error={form.fieldError('identity.default_locale')}
          onChange={(value) => form.set('identity.default_locale', value)}
        />
      </div>
      <UrlField
        label={t('siteForm.baseUrl')}
        required
        disabled={disabled}
        data-testid="ck-site-base-url"
        help={t('siteForm.baseUrlHelp')}
        value={identity.base_url}
        error={form.fieldError('identity.base_url')}
        onChange={(value) => form.set('identity.base_url', value)}
      />
      <TextAreaField
        label={t('siteForm.description')}
        rows={3}
        disabled={disabled}
        data-testid="ck-site-description"
        help={t('siteForm.descriptionHelp')}
        value={identity.description}
        error={form.fieldError('identity.description')}
        onChange={(value) => form.set('identity.description', value)}
      />
      <Alert data-testid="ck-site-domains-note">
        <InfoIcon />
        <AlertTitle>{t('siteForm.domainsTitle')}</AlertTitle>
        <AlertDescription>{t('siteForm.domainsDescription')}</AlertDescription>
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
  const { t } = useI18n()
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
              aria-label={t('siteForm.localesAboutLabel')}
            >
              <InfoIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" data-testid="ck-site-locales-about-content">
            <PopoverTitle>{t('siteForm.localesAboutTitle')}</PopoverTitle>
            <PopoverDescription>{t('siteForm.localesAboutDescription')}</PopoverDescription>
          </PopoverContent>
        </Popover>
      </div>
      {rows.isPending ? (
        // The rows are a list, and the wait is the shape of that list. A one-line
        // sentence here settled the section at one line and then jolted it to
        // five, which is the defect UI-UX.md's "four states" section names.
        <SkeletonGroup label={t('siteForm.localesLoading')} data-testid="ck-site-locales-skeleton">
          {Array.from({ length: 3 }, (_unused, row) => (
            <Skeleton key={row} className="h-9 w-full" />
          ))}
        </SkeletonGroup>
      ) : rows.error ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{t('siteForm.localesLoadErrorTitle')}</AlertTitle>
          <AlertDescription data-testid="ck-site-locales-load-error">
            {rows.error instanceof Error ? rows.error.message : t('siteForm.localesLoadError')}
          </AlertDescription>
          <AlertAction>
            <Button variant="ghost" size="sm" data-testid="ck-site-locales-retry" onClick={() => void rows.refetch()}>
              {t('common.retry')}
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
                            <StatusBadge tone="info">{t('siteForm.defaultLocaleBadge')}</StatusBadge>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t('siteForm.defaultLocaleTooltip')}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : null}
                </span>
                {isDefault ? null : removing === row.locale ? (
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {t('siteForm.localeRemoveQuestion', { locale: row.locale })}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      data-testid={`ck-site-locale-remove-confirm-${row.locale}`}
                      onClick={() => remove.mutate(row.locale)}
                    >
                      {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
                      {t('common.remove')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`ck-site-locale-remove-cancel-${row.locale}`}
                      onClick={() => setRemoving(null)}
                    >
                      {t('siteForm.localeKeep')}
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
                    {t('common.remove')}
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
                  <EmptyTitle>{t('siteForm.noLocaleRows')}</EmptyTitle>
                  <EmptyDescription>
                    {t('siteForm.noLocaleRowsDescription', { locales: builds.join(', ') || defaultLocale })}
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
            label={t('siteForm.addLanguage')}
            disabled={busy || full}
            data-testid="ck-site-locales-add"
            help={t('siteForm.addLanguageHelp')}
            about={t('siteForm.addLanguageAbout')}
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
          {t('siteForm.addLocale')}
        </Button>
      </div>

      {add.error ? (
        <Alert variant="destructive" data-testid="ck-site-locales-add-error">
          <AlertTriangle />
          <AlertTitle>{t('siteForm.localeAddErrorTitle')}</AlertTitle>
          <AlertDescription>
            {add.error instanceof Error ? add.error.message : t('siteForm.localeAddError')}
          </AlertDescription>
        </Alert>
      ) : null}
      {remove.error ? (
        // Verbatim: “locale en still has 2 published and 1 scheduled content
        // item(s)…” names what to do, and a rewritten version would drop the
        // counts that make it actionable.
        <Alert variant="destructive" data-testid="ck-site-locales-remove-error">
          <AlertTriangle />
          <AlertTitle>{t('siteForm.localeRemoveErrorTitle')}</AlertTitle>
          <AlertDescription>
            {remove.error instanceof Error ? remove.error.message : t('siteForm.localeRemoveError')}
          </AlertDescription>
        </Alert>
      ) : null}
      {removed ? (
        <Alert data-testid="ck-site-locales-removed">
          <AlertTriangle />
          <AlertTitle>{t('siteForm.localeRemovedTitle', { locale: removed.locale })}</AlertTitle>
          <AlertDescription>
            {t(removed.draft_items === 1 ? 'siteForm.localeRemovedOne' : 'siteForm.localeRemovedMany', {
              count: removed.draft_items,
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      {full ? (
        <Alert data-testid="ck-site-locales-full">
          <AlertTriangle />
          <AlertDescription>{t('siteForm.localeCap', { count: max })}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

function Presentation({ form, disabled }: SectionProps) {
  const { t } = useI18n()
  const presentation = form.values.settings.presentation
  return (
    <div className="flex flex-col gap-4">
      <SectionAlert
        form={form}
        paths={['settings.presentation', 'settings.presentation.docs.versions', 'settings.presentation.report_series']}
      />
      <EnumSelect
        label={t('siteForm.preset')}
        disabled={disabled}
        data-testid="ck-site-preset"
        definition={t('siteForm.presetDefinition')}
        fallback={t('siteForm.presetFallback')}
        options={PRESENTATION_PRESET.map((value) => ({ value, label: value }))}
        allowEmpty
        placeholder={t('siteForm.presetPlaceholder')}
        value={presentation.preset}
        error={form.fieldError('settings.presentation.preset')}
        onChange={(value) => form.set('settings.presentation.preset', value)}
      />

      <ObjectListField
        label={t('siteForm.docsVersions')}
        disabled={disabled}
        data-testid="ck-site-docs-versions"
        help={t('siteForm.docsVersionsHelp')}
        max={32}
        emptyMessage={t('siteForm.docsVersionsEmpty')}
        addLabel={t('siteForm.addVersion')}
        uniqueBy={(entry) => entry.id}
        exclusiveFlag={{ key: 'current', label: t('siteForm.current') }}
        itemLabel={(entry) => visibleLabel(entry.label, entry.id) ?? t('siteForm.newVersion')}
        create={() => ({ id: '', label: '', current: false })}
        value={presentation.docs.versions}
        error={form.fieldError('settings.presentation.docs.versions')}
        onChange={(value) => form.set('settings.presentation.docs.versions', value)}
        renderItem={(entry, api) => (
          <div className={grid}>
            <TextField
              label={t('siteForm.id')}
              required
              disabled={disabled}
              data-testid={`ck-site-docs-version-id-${api.index}`}
              help={t('siteForm.versionIdHelp')}
              value={entry.id}
              error={form.fieldError(`settings.presentation.docs.versions.${api.index}.id`)}
              onChange={(value) => api.update({ id: value })}
            />
            <TextField
              label={t('siteForm.label')}
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
        label={t('siteForm.reportSeries')}
        disabled={disabled}
        data-testid="ck-site-report-series"
        help={t('siteForm.reportSeriesHelp')}
        about={t('siteForm.reportSeriesAbout')}
        max={32}
        emptyMessage={t('siteForm.reportSeriesEmpty')}
        addLabel={t('siteForm.addSeries')}
        uniqueBy={(entry) => entry.id}
        itemLabel={(entry) => visibleLabel(entry.label, entry.id) ?? t('siteForm.newSeries')}
        create={() => ({ id: '', label: '', nav_order: 0, lead_cadence: 'monthly' as const })}
        value={presentation.report_series}
        error={form.fieldError('settings.presentation.report_series')}
        onChange={(value) => form.set('settings.presentation.report_series', value)}
        renderItem={(entry, api) => (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TextField
              label={t('siteForm.id')}
              required
              disabled={disabled}
              data-testid={`ck-site-series-id-${api.index}`}
              value={entry.id}
              error={form.fieldError(`settings.presentation.report_series.${api.index}.id`)}
              onChange={(value) => api.update({ id: value })}
            />
            <TextField
              label={t('siteForm.label')}
              required
              maxLength={120}
              disabled={disabled}
              data-testid={`ck-site-series-label-${api.index}`}
              value={entry.label}
              error={form.fieldError(`settings.presentation.report_series.${api.index}.label`)}
              onChange={(value) => api.update({ label: value })}
            />
            <NumberField
              label={t('siteForm.navigationOrder')}
              integer
              disabled={disabled}
              data-testid={`ck-site-series-order-${api.index}`}
              value={entry.nav_order}
              error={form.fieldError(`settings.presentation.report_series.${api.index}.nav_order`)}
              onChange={(value) => api.update({ nav_order: value ?? 0 })}
            />
            <EnumSelect
              label={t('siteForm.leadCadence')}
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
const TOKEN_LABEL_KEYS: Record<string, TranslationKey> = {
  background: 'siteForm.token.background',
  foreground: 'siteForm.token.foreground',
  muted: 'siteForm.token.muted',
  muted_foreground: 'siteForm.token.mutedForeground',
  border: 'siteForm.token.border',
  primary: 'siteForm.token.primary',
  primary_foreground: 'siteForm.token.primaryForeground',
  chart_1: 'siteForm.token.chart1',
  chart_2: 'siteForm.token.chart2',
  chart_3: 'siteForm.token.chart3',
  chart_4: 'siteForm.token.chart4',
  chart_5: 'siteForm.token.chart5',
  radius: 'siteForm.token.radius',
  font_family: 'siteForm.token.fontFamily',
}

function Theme({ form, disabled }: SectionProps) {
  const { t } = useI18n()
  const theme = form.values.settings.theme
  const tokens: TokenDefinition[] = THEME_TOKENS.map((key) => ({ key, label: t(TOKEN_LABEL_KEYS[key]!) }))
  return (
    <div className="flex flex-col gap-4">
      <SectionAlert form={form} paths={['settings.theme', 'settings.theme.tokens', 'settings.theme.custom_css']} />
      <TokenMapField
        label={t('siteForm.themeTokens')}
        disabled={disabled}
        data-testid="ck-site-theme-tokens"
        help={t('siteForm.themeTokensHelp')}
        about={t('siteForm.themeTokensAbout')}
        tokens={tokens}
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
          label={t('siteForm.accent')}
          disabled={disabled}
          data-testid="ck-site-accent"
          help={t('siteForm.accentHelp')}
          value={form.values.settings.accent}
          error={form.fieldError('settings.accent')}
          onChange={(value) => form.set('settings.accent', value)}
        />
        <ColorField
          label={t('siteForm.browserThemeColor')}
          disabled={disabled}
          data-testid="ck-site-theme-color"
          help={t('siteForm.browserThemeColorHelp')}
          value={form.values.settings.theme_color}
          error={form.fieldError('settings.theme_color')}
          onChange={(value) => form.set('settings.theme_color', value)}
        />
      </div>

      <TextAreaField
        label={t('siteForm.customCss')}
        rows={10}
        monospace
        maxBytes={8192}
        forbid={/<\/style/i}
        forbidMessage={t('siteForm.customCssForbidden')}
        disabled={disabled}
        data-testid="ck-site-custom-css"
        help={t('siteForm.customCssHelp')}
        about={t('siteForm.customCssAbout')}
        value={theme.custom_css}
        error={form.fieldError('settings.theme.custom_css')}
        onChange={(value) => form.set('settings.theme.custom_css', value)}
      />
    </div>
  )
}

function Branding({ form, base, disabled }: SectionProps) {
  const { t } = useI18n()
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
          label={t('siteForm.eyebrow')}
          disabled={disabled}
          data-testid="ck-site-eyebrow"
          definition={t('siteForm.eyebrowDefinition')}
          fallback={t('siteForm.eyebrowFallback')}
          value={settings.eyebrow}
          error={form.fieldError('settings.eyebrow')}
          onChange={(value) => form.set('settings.eyebrow', value)}
        />
        <TextField
          label={t('siteForm.heroTitle')}
          disabled={disabled}
          data-testid="ck-site-hero-title"
          fallback={t('siteForm.siteNameFallback')}
          value={settings.hero_title}
          error={form.fieldError('settings.hero_title')}
          onChange={(value) => form.set('settings.hero_title', value)}
        />
      </div>
      <TextAreaField
        label={t('siteForm.heroText')}
        rows={3}
        disabled={disabled}
        data-testid="ck-site-hero-text"
        fallback={t('siteForm.siteDescriptionFallback')}
        value={settings.hero_text}
        error={form.fieldError('settings.hero_text')}
        onChange={(value) => form.set('settings.hero_text', value)}
      />
      <div className={grid}>
        {asset(t('siteForm.profileImage'), 'profile_image', t('siteForm.profileImageHelp'))}
        <TextField
          label={t('siteForm.profileImageAlt')}
          disabled={disabled}
          data-testid="ck-site-profile-image-alt"
          help={t('siteForm.imageAltHelp')}
          warning={
            settings.profile_image && !settings.profile_image_alt ? t('siteForm.imageAltWarning') : undefined
          }
          value={settings.profile_image_alt}
          error={form.fieldError('settings.profile_image_alt')}
          onChange={(value) => form.set('settings.profile_image_alt', value)}
        />
        {asset(t('siteForm.favicon'), 'favicon', t('siteForm.faviconHelp'))}
        {asset(t('siteForm.appleTouchIcon'), 'apple_touch_icon', t('siteForm.appleTouchIconHelp'))}
        {asset(t('siteForm.maskIcon'), 'mask_icon', t('siteForm.maskIconHelp'))}
      </div>
    </div>
  )
}

function Seo({ form, base, disabled }: SectionProps) {
  const { t } = useI18n()
  const settings = form.values.settings
  return (
    <div className="flex flex-col gap-4">
      <SectionAlert form={form} paths={['settings.socials']} />
      <div className={grid}>
        <UrlField
          label={t('siteForm.shareImage')}
          mode="asset"
          base={base}
          disabled={disabled}
          data-testid="ck-site-og-image"
          help={t('siteForm.shareImageHelp')}
          value={settings.og_image}
          error={form.fieldError('settings.og_image')}
          onChange={(value) => form.set('settings.og_image', value)}
        />
        <TextField
          label={t('siteForm.shareImageAlt')}
          disabled={disabled}
          data-testid="ck-site-og-image-alt"
          warning={settings.og_image && !settings.og_image_alt ? t('siteForm.imageAltWarning') : undefined}
          value={settings.og_image_alt}
          error={form.fieldError('settings.og_image_alt')}
          onChange={(value) => form.set('settings.og_image_alt', value)}
        />
      </div>
      <TextField
        label={t('siteForm.twitterHandle')}
        disabled={disabled}
        data-testid="ck-site-twitter-handle"
        help={t('siteForm.twitterHandleHelp')}
        value={settings.twitter_handle}
        error={form.fieldError('settings.twitter_handle')}
        onChange={(value) => form.set('settings.twitter_handle', value)}
      />
      <KeyValueField
        label={t('siteForm.socialLinks')}
        disabled={disabled}
        data-testid="ck-site-socials"
        help={t('siteForm.socialLinksHelp')}
        about={t('siteForm.socialLinksAbout')}
        keyLabel={t('siteForm.network')}
        valueLabel={t('siteForm.url')}
        value={settings.socials}
        error={form.fieldError('settings.socials')}
        onChange={(value) => form.set('settings.socials', value)}
      />
    </div>
  )
}

function Analytics({ form, disabled }: SectionProps) {
  const { t } = useI18n()
  const analytics = form.values.settings.analytics
  return (
    <div className="flex flex-col gap-4">
      <SectionAlert form={form} paths={['settings.analytics']} />
      <EnumSelect
        label={t('siteForm.provider')}
        disabled={disabled}
        data-testid="ck-site-analytics-provider"
        about={t('siteForm.analyticsAbout')}
        fallback={t('siteForm.analyticsFallback')}
        allowEmpty
        placeholder={t('siteForm.noAnalytics')}
        options={ANALYTICS_PROVIDERS.map((value) => ({
          value,
          label: value === 'ga4' ? 'Google Analytics 4' : 'Plausible',
          description:
            value === 'ga4'
              ? t('siteForm.ga4Description')
              : t('siteForm.plausibleDescription'),
        }))}
        value={analytics.provider}
        error={form.fieldError('settings.analytics.provider')}
        onChange={(value) => form.set('settings.analytics.provider', value)}
      />
      {analytics.provider === 'plausible' ? (
        <div className={grid}>
          <TextField
            label={t('siteForm.measuredDomain')}
            required
            disabled={disabled}
            data-testid="ck-site-analytics-domain"
            help={t('siteForm.measuredDomainHelp')}
            about={t('siteForm.measuredDomainAbout')}
            value={analytics.domain}
            error={form.fieldError('settings.analytics.domain')}
            onChange={(value) => form.set('settings.analytics.domain', value)}
          />
          <UrlField
            label={t('siteForm.scriptUrl')}
            disabled={disabled}
            data-testid="ck-site-analytics-src"
            fallback={t('siteForm.scriptUrlFallback')}
            value={analytics.src}
            error={form.fieldError('settings.analytics.src')}
            onChange={(value) => form.set('settings.analytics.src', value)}
          />
        </div>
      ) : null}
      {analytics.provider === 'ga4' ? (
        <TextField
          label={t('siteForm.measurementId')}
          required
          disabled={disabled}
          data-testid="ck-site-analytics-id"
          help={t('siteForm.measurementIdHelp')}
          about={t('siteForm.measurementIdAbout')}
          value={analytics.id}
          error={form.fieldError('settings.analytics.id')}
          onChange={(value) => form.set('settings.analytics.id', value)}
        />
      ) : null}
    </div>
  )
}

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
  const { t } = useI18n()
  return (
    <ObjectListField
      label={label}
      help={help}
      disabled={disabled}
      data-testid={testId}
      emptyMessage={emptyMessage}
      addLabel={t('siteForm.addTarget')}
      uniqueBy={(entry) => entry.label}
      itemLabel={(entry) => entry.label || t('siteForm.newTarget')}
      create={() => ({ label: '', url_template: '' })}
      value={value}
      error={form.fieldError(path)}
      onChange={(next) => form.set(path, next)}
      renderItem={(entry, api) => (
        <div className="flex flex-col gap-4">
          <TextField
            label={t('siteForm.label')}
            required
            disabled={disabled}
            data-testid={`${testId}-label-${api.index}`}
            value={entry.label}
            onChange={(next) => api.update({ label: next })}
          />
          <UrlTemplateField
            label={t('siteForm.urlTemplate')}
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
  const { t } = useI18n()
  const audio = form.values.settings.audio
  const on = audio.enabled === true
  const feedPlaceholders = [
    { token: 'feed', description: t('siteForm.feedPlaceholder') },
    { token: 'feed_encoded', description: t('siteForm.feedEncodedPlaceholder') },
    { token: 'feed_no_scheme', description: t('siteForm.feedNoSchemePlaceholder') },
  ]
  return (
    <div className="flex flex-col gap-4">
      <SectionAlert form={form} paths={['settings.audio']} />
      <TriToggle
        label={t('siteForm.readAloud')}
        data-testid="ck-site-audio-enabled"
        disabled={disabled}
        defaultLabel={t('common.off')}
        help={t('siteForm.readAloudHelp')}
        value={audio.enabled}
        error={form.fieldError('settings.audio.enabled')}
        onChange={(value) => form.set('settings.audio.enabled', value)}
      />
      {!on ? (
        <Alert data-testid="ck-site-audio-off-note">
          <InfoIcon />
          <AlertDescription>
            {t('siteForm.readAloudOff')}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className={grid}>
        <EnumSelect
          label={t('siteForm.voiceProvider')}
          disabled={disabled}
          data-testid="ck-site-audio-provider"
          fallback={t('siteForm.googleFallback')}
          allowEmpty
          placeholder={t('siteForm.googleDefault')}
          options={AUDIO_PROVIDERS.map((value) => ({
            value,
            label: value === 'google' ? 'Google Chirp 3 HD' : t('siteForm.fakeProvider'),
            description: value === 'fake' ? t('siteForm.fakeProviderDescription') : undefined,
          }))}
          value={audio.provider}
          error={form.fieldError('settings.audio.provider')}
          onChange={(value) => form.set('settings.audio.provider', value)}
        />
        <TextField
          label={t('siteForm.voice')}
          disabled={disabled}
          data-testid="ck-site-audio-voice"
          about={t('siteForm.voiceAbout')}
          fallback={t('siteForm.voiceFallback')}
          value={audio.voice}
          error={form.fieldError('settings.audio.voice')}
          onChange={(value) => form.set('settings.audio.voice', value)}
        />
      </div>

      <div className={grid}>
        <TextField
          label={t('siteForm.channelTitle')}
          disabled={disabled}
          data-testid="ck-site-audio-title"
          fallback={t('siteForm.siteNameFallback')}
          value={audio.title}
          error={form.fieldError('settings.audio.title')}
          onChange={(value) => form.set('settings.audio.title', value)}
        />
        <TextField
          label={t('siteForm.channelAuthor')}
          disabled={disabled}
          data-testid="ck-site-audio-author"
          fallback={t('siteForm.siteNameFallback')}
          value={audio.author}
          error={form.fieldError('settings.audio.author')}
          onChange={(value) => form.set('settings.audio.author', value)}
        />
      </div>
      <TextAreaField
        label={t('siteForm.channelDescription')}
        rows={3}
        disabled={disabled}
        data-testid="ck-site-audio-description"
        fallback={t('siteForm.siteDescriptionFallback')}
        value={audio.description}
        error={form.fieldError('settings.audio.description')}
        onChange={(value) => form.set('settings.audio.description', value)}
      />

      <div className={grid}>
        <NumberField
          label={t('siteForm.monthlyBudget')}
          integer
          min={0}
          unit={t('siteForm.characters')}
          allowUnset
          unsetLabel={t('siteForm.noBudget')}
          disabled={disabled}
          data-testid="ck-site-audio-budget"
          help={t('siteForm.monthlyBudgetHelp')}
          about={t('siteForm.monthlyBudgetAbout')}
          value={audio.monthly_char_budget}
          error={form.fieldError('settings.audio.monthly_char_budget')}
          onChange={(value) => form.set('settings.audio.monthly_char_budget', value)}
        />
        <TriToggle
          label={t('siteForm.renarrate')}
          data-testid="ck-site-audio-auto-rebuild"
          disabled={disabled}
          defaultLabel={t('common.on')}
          help={t('siteForm.renarrateHelp')}
          value={audio.auto_rebuild}
          error={form.fieldError('settings.audio.auto_rebuild')}
          onChange={(value) => form.set('settings.audio.auto_rebuild', value)}
        />
      </div>

      <TriToggle
        label={t('siteForm.blogcastFooter')}
        data-testid="ck-site-audio-blogcast-link"
        disabled={disabled}
        defaultLabel={t('common.off')}
        help={t('siteForm.blogcastFooterHelp')}
        value={audio.blogcast_link}
        error={form.fieldError('settings.audio.blogcast_link')}
        onChange={(value) => form.set('settings.audio.blogcast_link', value)}
      />

      <div className={grid}>
        <UrlField
          label={t('siteForm.coverArt')}
          mode="asset"
          base={base}
          disabled={disabled}
          data-testid="ck-site-audio-blogcast-image"
          help={t('siteForm.coverArtHelp')}
          value={audio.blogcast_image}
          error={form.fieldError('settings.audio.blogcast_image')}
          onChange={(value) => form.set('settings.audio.blogcast_image', value)}
        />
        <TextField
          label={t('siteForm.itunesCategory')}
          disabled={disabled}
          data-testid="ck-site-audio-blogcast-category"
          help={t('siteForm.itunesCategoryHelp')}
          value={audio.blogcast_category}
          error={form.fieldError('settings.audio.blogcast_category')}
          onChange={(value) => form.set('settings.audio.blogcast_category', value)}
        />
      </div>

      <TargetList
        label={t('siteForm.subscribeTargets')}
        help={t('siteForm.blogcastTargetsHelp')}
        path="settings.audio.subscribe_targets"
        testId="ck-site-audio-targets"
        emptyMessage={t('siteForm.podcastTargetsEmpty')}
        placeholders={feedPlaceholders}
        sample={FEED_SAMPLE}
        protocols={FEED_PROTOCOLS}
        value={audio.subscribe_targets}
        form={form}
        disabled={disabled}
      />
    </div>
  )
}

const SHARE_SAMPLE = { q: 'Read%20https%3A%2F%2Fexample.com%2Fen%2Fposts%2Fhello%2F' }

function Reader({ form, disabled }: SectionProps) {
  const { t } = useI18n()
  const settings = form.values.settings
  const feedPlaceholders = [
    { token: 'feed', description: t('siteForm.feedPlaceholder') },
    { token: 'feed_encoded', description: t('siteForm.feedEncodedPlaceholder') },
    { token: 'feed_no_scheme', description: t('siteForm.feedNoSchemePlaceholder') },
  ]
  const sharePlaceholders = [{ token: 'q', description: t('siteForm.sharePlaceholder') }]
  return (
    <div className="flex flex-col gap-4">
      <SectionAlert form={form} paths={['settings.comments', 'settings.feedback', 'settings.search', 'settings.content']} />
      <div className={grid}>
        <TriToggle
          label={t('siteForm.comments')}
          data-testid="ck-site-comments-enabled"
          disabled={disabled}
          defaultLabel={t('common.on')}
          help={t('siteForm.commentsHelp')}
          value={settings.comments.enabled}
          error={form.fieldError('settings.comments.enabled')}
          onChange={(value) => form.set('settings.comments.enabled', value)}
        />
        <TriToggle
          label={t('siteForm.feedback')}
          data-testid="ck-site-feedback-enabled"
          disabled={disabled}
          defaultLabel={t('common.off')}
          help={t('siteForm.feedbackHelp')}
          about={t('siteForm.feedbackAbout')}
          value={settings.feedback.enabled}
          error={form.fieldError('settings.feedback.enabled')}
          onChange={(value) => form.set('settings.feedback.enabled', value)}
        />
      </div>
      <TextField
        label={t('siteForm.turnstileKey')}
        disabled={disabled}
        data-testid="ck-site-turnstile"
        help={t('siteForm.turnstileKeyHelp')}
        about={t('siteForm.turnstileKeyAbout')}
        warning={
          settings.comments.enabled !== false && !settings.turnstile_site_key
            ? t('siteForm.turnstileWarning')
            : undefined
        }
        value={settings.turnstile_site_key}
        error={form.fieldError('settings.turnstile_site_key')}
        onChange={(value) => form.set('settings.turnstile_site_key', value)}
      />
      <div className={grid}>
        <TriToggle
          label={t('siteForm.indexBody')}
          data-testid="ck-site-search-index-body"
          disabled={disabled}
          defaultLabel={t('common.off')}
          help={t('siteForm.indexBodyHelp')}
          about={t('siteForm.indexBodyAbout')}
          value={settings.search.index_body}
          error={form.fieldError('settings.search.index_body')}
          onChange={(value) => form.set('settings.search.index_body', value)}
        />
        <TriToggle
          label={t('siteForm.showExtra')}
          data-testid="ck-site-content-show-extra"
          disabled={disabled}
          defaultLabel={t('common.off')}
          help={t('siteForm.showExtraHelp')}
          value={settings.content.show_extra}
          error={form.fieldError('settings.content.show_extra')}
          onChange={(value) => form.set('settings.content.show_extra', value)}
        />
      </div>

      <TriToggle
        label={t('siteForm.blogSubscribeRow')}
        data-testid="ck-site-blog-subscribe-row"
        disabled={disabled}
        defaultLabel={t('common.on')}
        value={settings.blog.subscribe_row}
        error={form.fieldError('settings.blog.subscribe_row')}
        onChange={(value) => form.set('settings.blog.subscribe_row', value)}
      />
      <TargetList
        label={t('siteForm.feedReaderTargets')}
        help={t('siteForm.feedReaderTargetsHelp')}
        path="settings.blog.subscribe_targets"
        testId="ck-site-blog-targets"
        emptyMessage={t('siteForm.feedReaderTargetsEmpty')}
        placeholders={feedPlaceholders}
        sample={{ ...FEED_SAMPLE, feed: 'https://example.com/en/feed.xml' }}
        protocols={FEED_PROTOCOLS}
        value={settings.blog.subscribe_targets}
        form={form}
        disabled={disabled}
      />

      <TriToggle
        label={t('siteForm.aiShareRow')}
        data-testid="ck-site-ai-share-buttons"
        disabled={disabled}
        defaultLabel={t('common.on')}
        help={t('siteForm.aiShareRowHelp')}
        about={t('siteForm.aiShareRowAbout')}
        value={settings.ai.share_buttons}
        error={form.fieldError('settings.ai.share_buttons')}
        onChange={(value) => form.set('settings.ai.share_buttons', value)}
      />
      <TargetList
        label={t('siteForm.assistantTargets')}
        help={t('siteForm.assistantTargetsHelp')}
        path="settings.ai.share_targets"
        testId="ck-site-ai-targets"
        emptyMessage={t('siteForm.assistantTargetsEmpty')}
        placeholders={sharePlaceholders}
        sample={SHARE_SAMPLE}
        value={settings.ai.share_targets}
        form={form}
        disabled={disabled}
      />
    </div>
  )
}

function Unmanaged({ form, disabled }: SectionProps) {
  const { t } = useI18n()
  const leaves = carriedLeaves(form.values.carried)
  const display = Object.fromEntries(leaves.map((leaf) => [leaf.path, leaf.value]))

  if (leaves.length === 0) {
    return (
      <Empty className="border" data-testid="ck-site-carried-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InfoIcon />
          </EmptyMedia>
          <EmptyTitle>{t('siteForm.unmanagedEmpty')}</EmptyTitle>
          <EmptyDescription>{t('siteForm.unmanagedEmptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert data-testid="ck-site-carried-note">
        <InfoIcon />
        <AlertTitle>{t('siteForm.unmanagedTitle')}</AlertTitle>
        <AlertDescription>{t('siteForm.unmanagedDescription')}</AlertDescription>
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
