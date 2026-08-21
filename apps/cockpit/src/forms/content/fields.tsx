import { ChevronRight, LayoutTemplate, Plus, Presentation } from 'lucide-react'
import type { ReactNode } from 'react'
import { AppLink } from '@/components/app-link'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { RelativeTime } from '@/components/ui/relative-time'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { StatusBadge } from '@/forms/status-badge'
import { useI18n } from '@/lib/i18n-context'
import { CONTENT_KIND } from '../contracts/enums.generated'
import {
  DateField,
  DateTimeField,
  EnumMultiSelect,
  EnumSelect,
  ExtraFieldsField,
  LocaleField,
  NumberField,
  ObjectListField,
  SlugField,
  TagListField,
  TextAreaField,
  TextField,
  TriToggle,
  UrlField,
  CarriedKeys,
} from '../fields'
import type { useForm } from '../use-form'
import type { ContentUI } from './contract'
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
  LAYOUTS,
  emptyComposition,
  emptyDeck,
  resolvedLayout,
  type FrontmatterUI,
} from './frontmatter'

export type ContentForm = ReturnType<typeof useForm<ContentUI>>

/** src/site-builder.mjs `PRESET_LAYOUT` — what a page gets when it names no layout. */
const PRESET_LAYOUT: Record<string, string> = {
  portfolio: 'standard',
  'product-docs': 'docs',
  wiki: 'wiki',
  'knowledge-base': 'knowledge',
  product: 'landing',
  changelog: 'changelog',
}

export function effectiveLayout(fm: FrontmatterUI, preset: string): string {
  const authored = resolvedLayout(fm)
  if (authored) return authored
  if (fm.kind === 'deck') return 'deck'
  if (fm.kind === 'page') return PRESET_LAYOUT[preset || 'portfolio'] ?? 'standard'
  return 'standard'
}

/**
 * The URL this document will be served at, from src/site-builder.mjs `route()`.
 *
 * Nested docs and wiki pages join their ancestors' slugs, which needs the whole
 * item set — so a parented page shows the path it would have without one, and
 * says so rather than inventing ancestors.
 */
export function contentRoute(fm: FrontmatterUI, preset: string): string {
  const locale = fm.locale.trim().toLowerCase() || '…'
  const slug = fm.slug.trim() || '…'
  if (fm.kind === 'post') return `/${locale}/blog/${slug}/`
  if (fm.kind === 'project') return `/${locale}/projects/${slug}/`
  if (fm.kind === 'deck') return `/${locale}/slides/${slug}/`
  const layout = effectiveLayout(fm, preset)
  if (layout === 'docs') return `/${locale}/docs/${fm.docsVersion.trim() || '…'}/${slug}/`
  if (layout === 'wiki') return `/${locale}/wiki/${slug}/`
  if (layout === 'knowledge') return `/${locale}/help/${slug}/`
  if (layout === 'changelog') return `/${locale}/changelog/${slug}/`
  return `/${locale}/${slug}/`
}

/**
 * A frontmatter group.
 *
 * Progressive disclosure is the whole trick here: forty fields shown at once is
 * a form nobody reads, and forty fields hidden behind one toggle is a form
 * nobody finds. Each group therefore says whether it holds anything before it is
 * opened, so a collapsed group is never a place where something might be hiding.
 */
function Group({
  id,
  title,
  description,
  configured,
  defaultOpen,
  children,
}: {
  id: string
  title: string
  description?: string
  configured?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const { t } = useI18n()
  // A disclosure, drawn by the disclosure component: `Collapsible` owns the open
  // state, `aria-expanded` and the trigger/content pairing that this section used
  // to hand-roll around a `useState`.
  return (
    <Collapsible
      defaultOpen={Boolean(defaultOpen)}
      className="group/fm-group rounded-xl border border-border"
      data-testid={`ck-fm-group-${id}`}
    >
      <CollapsibleTrigger
        data-testid={`ck-fm-group-${id}-toggle`}
        className="flex w-full items-center gap-2 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ChevronRight className="size-4 shrink-0 transition-transform group-data-open/fm-group:rotate-90" />
        <span className="text-sm font-medium">{title}</span>
        {/* The marker used to be a bare count with nothing saying what was
            counted. The sentence is one hover or one focus away rather than a
            seventh line in a header that already carries five. */}
        {configured ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} data-testid={`ck-fm-group-${id}-configured`}>
                  <StatusBadge tone="info">{configured}</StatusBadge>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('content.group.configuredTooltip')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
        {description ? <span className="ml-auto truncate text-xs text-muted-foreground">{description}</span> : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 border-t border-border p-4">{children}</CollapsibleContent>
    </Collapsible>
  )
}

/** A list of sentences. `TagListField` is for terms; a TL;DR bullet is not one. */
function TextListField({
  label,
  help,
  about,
  testId,
  value,
  onChange,
  max,
  disabled,
  error,
  placeholder,
}: {
  label: string
  help?: string
  /** The paragraph behind the label's “more” affordance — see `FieldShellProps`. */
  about?: string
  testId: string
  value: readonly string[]
  onChange: (value: string[]) => void
  max?: number
  disabled?: boolean
  error?: string
  placeholder?: string
}) {
  const { t } = useI18n()
  return (
    <ObjectListField
      label={label}
      help={help}
      about={about}
      data-testid={testId}
      disabled={disabled}
      error={error}
      max={max}
      addLabel={t('content.addLine')}
      emptyMessage={t('list.empty')}
      value={value.map((entry) => ({ text: entry }))}
      onChange={(rows) => onChange(rows.map((row) => String(row.text ?? '')))}
      create={() => ({ text: '' })}
      renderItem={(row, api) => (
        <TextField
          label={t('content.line', { count: api.index + 1 })}
          data-testid={`${testId}-line-${api.index}`}
          disabled={disabled}
          placeholder={placeholder}
          value={String(row.text ?? '')}
          onChange={(next) => api.update({ text: next })}
        />
      )}
    />
  )
}

export interface FrontmatterFormProps {
  form: ContentForm
  /** `settings.presentation.preset`, for the layout a page falls back to. */
  preset: string
  docsVersions: readonly { id: string; label: string }[]
  reportSeries: readonly { id: string; label: string }[]
  /** Slugs already used by this site's other documents in the same locale. */
  siblings: readonly string[]
  locales: readonly string[]
  /** Group slugs a document may grant, from the site's access groups. */
  accessGroups: readonly string[]
  disabled: boolean
}

export function FrontmatterForm({
  form,
  preset,
  docsVersions,
  reportSeries,
  siblings,
  locales,
  accessGroups,
  disabled,
}: FrontmatterFormProps) {
  const { t } = useI18n()
  const fm = form.values.fm
  const layout = resolvedLayout(fm)
  const set = (path: string, value: unknown) => form.set(`fm.${path}`, value)
  const error = (path: string) => form.fieldError(`fm.${path}`)
  const isComposition = layout === 'composition'
  const isReport = isComposition && fm.hasComposition && (fm.composition.format || 'infographic') === 'report'
  const mediaConfigured = [fm.cover, fm.coverAlt, fm.externalUrl].some(Boolean) || fm.technologies.length > 0
  const aidsConfigured = fm.tldr.length + fm.faq.length + fm.related.length + fm.access.length

  return (
    <div className="flex flex-col gap-3">
      <Group id="core" title={t('content.group.core')} defaultOpen>
        <TextField
          label={t('content.title')}
          required
          disabled={disabled}
          data-testid="ck-fm-title"
          help={t('content.titleHelp')}
          value={fm.title}
          error={error('title')}
          onChange={(value) => set('title', value)}
        />
        <SlugField
          label={t('wizard.slug')}
          disabled={disabled}
          data-testid="ck-fm-slug"
          about={t('content.slugAbout')}
          fallback={t('content.slugFallback')}
          derivedFrom={fm.title}
          siblings={siblings}
          value={fm.slug}
          error={error('slug')}
          onChange={(value) => set('slug', value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <EnumSelect
            label={t('content.kind')}
            disabled={disabled}
            data-testid="ck-fm-kind"
            definition={t('content.kindDefinition')}
            fallback={t('content.kindFallback')}
            allowEmpty
            placeholder={t('content.pageDefault')}
            options={CONTENT_KIND.map((value) => ({ value, label: value }))}
            value={fm.kind}
            error={error('kind')}
            onChange={(value) => {
              set('kind', value)
              // A deck has exactly one legal layout, so choosing the kind sets
              // it rather than leaving a combination the server will refuse.
              if (value === 'deck') set('layout', 'deck')
            }}
          />
          <LocaleField
            label={t('content.locale')}
            required
            disabled={disabled}
            data-testid="ck-fm-locale"
            locales={locales}
            value={fm.locale}
            error={error('locale')}
            onChange={(value) => set('locale', value)}
          />
        </div>
        <TextAreaField
          label={t('content.summary')}
          rows={3}
          disabled={disabled}
          data-testid="ck-fm-summary"
          definition={t('content.summaryDefinition')}
          fallback={t('content.summaryFallback')}
          value={fm.summary}
          error={error('summary')}
          onChange={(value) => set('summary', value)}
        />
        <TagListField
          label={t('content.tags')}
          disabled={disabled}
          data-testid="ck-fm-tags"
          help={t('content.tagsHelp')}
          value={fm.tags}
          error={error('tags')}
          onChange={(value) => set('tags', [...value])}
        />
        <TextField
          label={t('content.translationKey')}
          disabled={disabled}
          data-testid="ck-fm-translation-key"
          definition={t('content.translationKeyDefinition')}
          fallback={t('content.translationKeyFallback')}
          value={fm.translationKey}
          error={error('translationKey')}
          onChange={(value) => set('translationKey', value)}
        />
      </Group>

      <Group id="publication" title={t('content.group.publication')} defaultOpen>
        {/*
          Three dates, two controls, and the difference between them is what the
          value means rather than how it looks.

          `date` and `updatedAt` are calendar days: a document is dated the 3rd of
          August and the update line reads a day. They take `DateField`, which
          shows the empty state in words and keeps a way back to it, because empty
          here is a documented decision — the release's build moment, and no update
          line at all — and a control that quietly filled in today would change what
          gets published without anybody choosing it.

          Their one quick set is "Today", and that is the whole list on purpose. A
          date counted forward — the 30/90/365 an expiry offers — would date a post
          a month or a year ahead of everything that was actually published, and
          this is the field the document is sorted by. There is no upper bound
          either: a document dated for a launch day is a real thing, so a future
          day stays something the operator can type and not something a button
          hands them by accident.

          `scheduledAt` is not a day. `/v1/publish-due` publishes every scheduled
          revision whose `scheduled_at` has already passed, so the time of day is
          the operator's choice and the difference between "tomorrow morning" and
          "tomorrow, the moment the clock ticks over". A day-only control would
          quietly move every scheduled document to local midnight, so it keeps the
          instant control — and counting forward is an answer there ("publish in a
          month"), which is why that one keeps the offsets.
        */}
        <DateField
          label={t('content.publicationDate')}
          presets
          disabled={disabled}
          data-testid="ck-fm-date"
          about={t('content.publicationDateAbout')}
          fallback={t('content.publicationDateFallback')}
          value={fm.date || undefined}
          error={error('date')}
          onChange={(value) => set('date', value ?? '')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <DateTimeField
            label={t('content.scheduledFor')}
            disabled={disabled}
            data-testid="ck-fm-scheduled-at"
            about={t('content.scheduledForAbout')}
            fallback={t('content.scheduledForFallback')}
            // The way back to empty, in this field's own words. The shared control
            // calls it "Never" because it was built for a credential that never
            // expires; here empty means the next release publishes the revision,
            // and "Never" next to that sentence reads as "never publish".
            unsetLabel={t('content.noSchedule')}
            // The state in words, next to the label: a datetime control that has
            // been cleared looks exactly like one nobody has reached yet.
            hint={
              fm.scheduledAt ? (
                <RelativeTime value={fm.scheduledAt} data-testid="ck-fm-scheduled-at-when" />
              ) : (
                <span data-testid="ck-fm-scheduled-at-when">{t('content.notSet')}</span>
              )
            }
            value={fm.scheduledAt || undefined}
            error={error('scheduledAt')}
            onChange={(value) => set('scheduledAt', value ?? '')}
          />
          <DateField
            label={t('content.lastUpdated')}
            presets
            disabled={disabled}
            data-testid="ck-fm-updated-at"
            fallback={t('content.lastUpdatedFallback')}
            value={fm.updatedAt || undefined}
            error={error('updatedAt')}
            onChange={(value) => set('updatedAt', value ?? '')}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <TriToggle
            label={t('content.noindex')}
            data-testid="ck-fm-noindex"
            disabled={disabled}
            defaultLabel={t('content.indexed')}
            value={fm.noindex}
            error={error('noindex')}
            onChange={(value) => set('noindex', value)}
          />
          <TriToggle
            label={t('content.featured')}
            data-testid="ck-fm-featured"
            disabled={disabled}
            defaultLabel={t('content.notFeatured')}
            value={fm.featured}
            error={error('featured')}
            onChange={(value) => set('featured', value)}
          />
          <TriToggle
            label={t('content.readAloud')}
            data-testid="ck-fm-audio"
            disabled={disabled}
            defaultLabel={t('content.eligible')}
            help={t('content.readAloudHelp')}
            value={fm.audio}
            error={error('audio')}
            onChange={(value) => set('audio', value)}
          />
        </div>
      </Group>

      <Group id="layout" title={t('content.group.layout')} description={effectiveLayout(fm, preset)} defaultOpen>
        <EnumSelect
          label={t('content.layout')}
          disabled={disabled || fm.kind === 'deck'}
          data-testid="ck-fm-layout"
          about={
            fm.kind === 'deck'
              ? t('content.deckLayoutAbout')
              : t('content.layoutAbout')
          }
          fallback={
            fm.layout
              ? undefined
              : t('content.layoutFallback', { layout: effectiveLayout(fm, preset), preset: preset || 'portfolio' })
          }
          allowEmpty
          placeholder={t('content.layoutPlaceholder', { layout: effectiveLayout(fm, preset) })}
          options={LAYOUTS.map((value) => ({
            value,
            label: value === 'report' ? t('content.reportAlias') : value,
            disabled: fm.kind === 'deck' && value !== 'deck',
            disabledReason: t('content.deckLayoutRequired'),
          }))}
          value={fm.layout}
          error={error('layout')}
          onChange={(value) => {
            set('layout', value)
            // Turning a document into a composition creates the block the
            // server expects; turning it back leaves the state alive but
            // unemitted, so switching modes twice loses nothing.
            if (value === 'composition' || value === 'report') set('hasComposition', true)
          }}
        />

        {effectiveLayout(fm, preset) === 'docs' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('content.docKey')}
              required
              disabled={disabled}
              data-testid="ck-fm-doc-key"
              help={t('content.docKeyHelp')}
              value={fm.docKey}
              error={error('docKey')}
              onChange={(value) => set('docKey', value)}
            />
            {docsVersions.length ? (
              <EnumSelect
                label={t('content.docsVersion')}
                required
                disabled={disabled}
                data-testid="ck-fm-docs-version"
                help={t('content.docsVersionHelp')}
                about={t('content.docsVersionAbout')}
                allowEmpty
                options={docsVersions.map((entry) => ({ value: entry.id, label: `${entry.label} (${entry.id})` }))}
                value={fm.docsVersion}
                error={error('docsVersion')}
                onChange={(value) => set('docsVersion', value)}
              />
            ) : (
              <EmptyPicker
                label={t('content.docsVersion')}
                testId="ck-fm-docs-version-empty"
                message={t('content.docsVersionEmpty')}
                to="/sites"
              />
            )}
          </div>
        ) : null}

        {['docs', 'wiki', 'knowledge'].includes(effectiveLayout(fm, preset)) ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('content.parent')}
              disabled={disabled}
              data-testid="ck-fm-parent"
              help={t('content.parentHelp')}
              about={t('content.parentAbout')}
              value={fm.parent}
              error={error('parent')}
              onChange={(value) => set('parent', value)}
            />
            <TextField
              label={t('content.navTitle')}
              disabled={disabled}
              data-testid="ck-fm-nav-title"
              fallback={t('content.navTitleFallback')}
              value={fm.navTitle}
              error={error('navTitle')}
              onChange={(value) => set('navTitle', value)}
            />
            <NumberField
              label={t('content.navOrder')}
              integer
              allowUnset
              unsetLabel={t('content.alphabetical')}
              disabled={disabled}
              data-testid="ck-fm-nav-order"
              value={fm.navOrder}
              error={error('navOrder')}
              onChange={(value) => set('navOrder', value)}
            />
            <TextField
              label={t('content.category')}
              disabled={disabled}
              data-testid="ck-fm-category"
              help={t('content.categoryHelp')}
              value={fm.category}
              error={error('category')}
              onChange={(value) => set('category', value)}
            />
          </div>
        ) : null}

        {effectiveLayout(fm, preset) === 'changelog' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('content.releaseVersion')}
              disabled={disabled}
              data-testid="ck-fm-release-version"
              value={fm.releaseVersion}
              error={error('releaseVersion')}
              onChange={(value) => set('releaseVersion', value)}
            />
            <EnumMultiSelect
              label={t('content.changeTypes')}
              disabled={disabled}
              data-testid="ck-fm-change-types"
              options={CHANGE_TYPES.map((value) => ({ value, label: value }))}
              value={fm.changeTypes as readonly (typeof CHANGE_TYPES)[number][]}
              error={error('changeTypes')}
              onChange={(value) => set('changeTypes', [...value])}
            />
          </div>
        ) : null}

        {isComposition ? (
          <CompositionFields
            form={form}
            disabled={disabled}
            isReport={isReport}
            reportSeries={reportSeries}
          />
        ) : null}

        {fm.kind === 'deck' ? <DeckFields form={form} disabled={disabled} /> : null}
      </Group>

      <Group id="media" title={t('content.group.media')} configured={mediaConfigured ? t('content.configured') : undefined}>
        <UrlField
          label={t('content.coverImage')}
          mode="asset"
          disabled={disabled}
          data-testid="ck-fm-cover"
          help={t('content.coverImageHelp')}
          value={fm.cover}
          error={error('cover')}
          onChange={(value) => set('cover', value)}
        />
        <TextField
          label={t('content.coverAlt')}
          disabled={disabled}
          data-testid="ck-fm-cover-alt"
          warning={fm.cover && !fm.coverAlt ? t('content.coverAltWarning') : undefined}
          value={fm.coverAlt}
          error={error('coverAlt')}
          onChange={(value) => set('coverAlt', value)}
        />
        <UrlField
          label={t('content.externalUrl')}
          disabled={disabled}
          data-testid="ck-fm-external-url"
          help={t('content.externalUrlHelp')}
          value={fm.externalUrl}
          error={error('externalUrl')}
          onChange={(value) => set('externalUrl', value)}
        />
        <TagListField
          label={t('content.technologies')}
          disabled={disabled}
          data-testid="ck-fm-technologies"
          help={t('content.technologiesHelp')}
          value={fm.technologies}
          error={error('technologies')}
          onChange={(value) => set('technologies', [...value])}
        />
      </Group>

      <Group id="aids" title={t('content.group.aids')} configured={aidsConfigured ? `${aidsConfigured}` : undefined}>
        <TextListField
          label={t('content.tldrLabel')}
          help={t('content.tldrHelp')}
          about={t('content.tldrAbout')}
          testId="ck-fm-tldr"
          disabled={disabled}
          value={fm.tldr}
          error={error('tldr')}
          onChange={(value) => set('tldr', value)}
          placeholder={t('content.tldrPlaceholder')}
        />
        <ObjectListField
          label={t('content.faqLabel')}
          help={t('content.faqHelp')}
          data-testid="ck-fm-faq"
          disabled={disabled}
          addLabel={t('content.addQuestion')}
          emptyMessage={t('content.noQuestions')}
          value={fm.faq}
          error={error('faq')}
          onChange={(value) => set('faq', value)}
          create={() => ({ q: '', a: '' })}
          itemLabel={(entry) => entry.q || t('content.newQuestion')}
          renderItem={(entry, api) => (
            <div className="flex flex-col gap-4">
              <TextField
                label={t('content.question')}
                required
                disabled={disabled}
                data-testid={`ck-fm-faq-q-${api.index}`}
                value={entry.q}
                error={error(`faq.${api.index}.q`)}
                onChange={(value) => api.update({ q: value })}
              />
              <TextAreaField
                label={t('content.answer')}
                required
                rows={3}
                disabled={disabled}
                data-testid={`ck-fm-faq-a-${api.index}`}
                value={entry.a}
                error={error(`faq.${api.index}.a`)}
                onChange={(value) => api.update({ a: value })}
              />
            </div>
          )}
        />
        <TagListField
          label={t('content.related')}
          disabled={disabled}
          data-testid="ck-fm-related"
          help={t('content.relatedHelp')}
          about={t('content.relatedAbout')}
          max={8}
          value={fm.related}
          error={error('related')}
          onChange={(value) => set('related', [...value])}
        />
        {accessGroups.length ? (
          <EnumMultiSelect
            label={t('content.readerGroups')}
            disabled={disabled}
            data-testid="ck-fm-access"
            help={t('content.readerGroupsHelp')}
            about={t('content.readerGroupsAbout')}
            allEmptyMeans={{ allLabel: t('content.public'), someLabel: t('content.restricted') }}
            options={accessGroups.map((value) => ({ value, label: value }))}
            value={fm.access}
            error={error('access')}
            onChange={(value) => set('access', [...value])}
          />
        ) : (
          <TagListField
            label={t('content.readerGroups')}
            disabled={disabled}
            data-testid="ck-fm-access"
            help={t('content.noAccessGroups')}
            max={32}
            value={fm.access}
            error={error('access')}
            onChange={(value) => set('access', [...value])}
          />
        )}
      </Group>

      <Group id="extra" title={t('content.group.custom')} configured={Object.keys(fm.extra).length ? `${Object.keys(fm.extra).length}` : undefined}>
        <ExtraFieldsField
          label={t('content.extra')}
          disabled={disabled}
          data-testid="ck-fm-extra"
          help={t('content.extraHelp')}
          about={t('content.extraAbout')}
          maxBytes={16384}
          value={fm.extra}
          error={error('extra')}
          onChange={(value) => set('extra', value)}
        />
      </Group>

      {Object.keys(fm.carried).length ? (
        <Group id="carried" title={t('content.group.carried')} configured={`${Object.keys(fm.carried).length}`} defaultOpen>
          <CarriedKeys
            data-testid="ck-fm-carried"
            value={fm.carried}
            onRemove={(key) => {
              if (disabled) return
              const { [key]: _removed, ...rest } = fm.carried
              set('carried', rest)
            }}
          />
        </Group>
      ) : null}
    </div>
  )
}

function EmptyPicker({ label, testId, message, to }: { label: string; testId: string; message: string; to: string }) {
  const { t } = useI18n()
  return (
    <div data-testid={testId} className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
        {message}{' '}
        <AppLink to={to} data-testid={`${testId}-link`} className="text-accent underline">
          {t('content.configureOnSite')}
        </AppLink>
      </div>
    </div>
  )
}

function CompositionFields({
  form,
  disabled,
  isReport,
  reportSeries,
}: {
  form: ContentForm
  disabled: boolean
  isReport: boolean
  reportSeries: readonly { id: string; label: string }[]
}) {
  const { t } = useI18n()
  const fm = form.values.fm
  const composition = fm.composition
  const set = (key: string, value: unknown) => form.set(`fm.composition.${key}`, value)
  const error = (key: string) => form.fieldError(`fm.composition.${key}`)

  if (!fm.hasComposition) {
    return (
      <Empty className="border" data-testid="ck-fm-composition-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutTemplate />
          </EmptyMedia>
          <EmptyTitle>{t('content.compositionEmpty')}</EmptyTitle>
          <EmptyDescription>{t('content.compositionEmptyDescription')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="ck-fm-composition-add"
            disabled={disabled}
            onClick={() => {
              form.set('fm.hasComposition', true)
              if (!composition.format) form.set('fm.composition', emptyComposition())
            }}
          >
            <Plus data-icon="inline-start" />
            {t('content.addComposition')}
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  const enums: [string, string, readonly string[], string][] = [
    ['format', composition.format, COMPOSITION_FORMATS, 'infographic'],
    ['canvas', composition.canvas, COMPOSITION_CANVASES, composition.format === 'report' ? 'flow' : 'portrait'],
    ['intent', composition.intent, COMPOSITION_INTENTS, 'explain'],
    ['density', composition.density, COMPOSITION_DENSITIES, 'balanced'],
    ['disclosure', composition.disclosure, COMPOSITION_DISCLOSURES, 'complete'],
  ]

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-3">
      <div className="grid gap-4 sm:grid-cols-2">
        {enums.map(([key, value, allowed, fallbackValue]) => (
          <EnumSelect
            key={key}
            label={t(`content.composition.${key}` as 'content.composition.format')}
            disabled={disabled}
            data-testid={`ck-fm-composition-${key}`}
            allowEmpty
            placeholder={t('content.valueDefault', { value: fallbackValue })}
            fallback={value ? undefined : t('content.unsetBehaves', { value: fallbackValue })}
            options={allowed.map((entry) => ({ value: entry, label: entry }))}
            value={value}
            error={error(key)}
            onChange={(next) => set(key, next)}
          />
        ))}
        <TextField
          label={t('content.preferredPattern')}
          disabled={disabled}
          data-testid="ck-fm-composition-preferred-pattern"
          help={t('content.preferredPatternHelp')}
          value={composition.preferredPattern}
          error={error('preferredPattern')}
          onChange={(value) => set('preferredPattern', value)}
        />
      </div>

      {isReport ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <EnumSelect
            label={t('content.reportCadence')}
            disabled={disabled}
            data-testid="ck-fm-report-cadence"
            help={t('content.reportCadenceHelp')}
            allowEmpty
            options={['hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'].map((value) => ({
              value,
              label: value,
            }))}
            value={fm.reportCadence}
            error={form.fieldError('fm.reportCadence')}
            onChange={(value) => form.set('fm.reportCadence', value)}
          />
          {reportSeries.length ? (
            <EnumSelect
              label={t('content.reportSeries')}
              disabled={disabled}
              data-testid="ck-fm-report-series"
              help={t('content.reportSeriesHelp')}
              about={t('content.reportSeriesAbout')}
              allowEmpty
              options={reportSeries.map((entry) => ({ value: entry.id, label: `${entry.label} (${entry.id})` }))}
              value={fm.reportSeries}
              error={form.fieldError('fm.reportSeries')}
              onChange={(value) => form.set('fm.reportSeries', value)}
            />
          ) : (
            <EmptyPicker
              label={t('content.reportSeries')}
              testId="ck-fm-report-series-empty"
              message={t('content.reportSeriesEmpty')}
              to="/sites"
            />
          )}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t('content.audience')}
          maxLength={120}
          disabled={disabled}
          data-testid="ck-fm-composition-audience"
          value={composition.audience}
          error={error('audience')}
          onChange={(value) => set('audience', value)}
        />
        <TextField
          label={t('content.question')}
          maxLength={240}
          disabled={disabled}
          data-testid="ck-fm-composition-question"
          help={t('content.questionHelp')}
          value={composition.question}
          error={error('question')}
          onChange={(value) => set('question', value)}
        />
        <TextField
          label={t('content.goal')}
          maxLength={240}
          disabled={disabled}
          data-testid="ck-fm-composition-goal"
          value={composition.goal}
          error={error('goal')}
          onChange={(value) => set('goal', value)}
        />
      </div>
      <TextAreaField
        label={t('content.thesis')}
        rows={2}
        maxChars={500}
        disabled={disabled}
        data-testid="ck-fm-composition-thesis"
        value={composition.thesis}
        error={error('thesis')}
        onChange={(value) => set('thesis', value)}
      />
      <TextAreaField
        label={t('content.conclusion')}
        rows={2}
        maxChars={500}
        disabled={disabled}
        data-testid="ck-fm-composition-conclusion"
        value={composition.conclusion}
        error={error('conclusion')}
        onChange={(value) => set('conclusion', value)}
      />
      <TextAreaField
        label={t('content.action')}
        rows={2}
        maxChars={500}
        disabled={disabled}
        data-testid="ck-fm-composition-action"
        help={t('content.actionHelp')}
        value={composition.action}
        error={error('action')}
        onChange={(value) => set('action', value)}
      />
      <TextListField
        label={t('content.limitations')}
        help={t('content.limitationsHelp')}
        about={t('content.limitationsAbout')}
        testId="ck-fm-composition-limitations"
        disabled={disabled}
        max={12}
        value={composition.limitations}
        error={error('limitations')}
        onChange={(value) => set('limitations', value)}
      />
    </div>
  )
}

function DeckFields({ form, disabled }: { form: ContentForm; disabled: boolean }) {
  const { t } = useI18n()
  const fm = form.values.fm
  const set = (key: string, value: unknown) => form.set(`fm.deck.${key}`, value)
  const error = (key: string) => form.fieldError(`fm.deck.${key}`)

  if (!fm.hasDeck) {
    return (
      <Empty className="border" data-testid="ck-fm-deck-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Presentation />
          </EmptyMedia>
          <EmptyTitle>{t('content.deckEmpty')}</EmptyTitle>
          {/* True of `hasDeck` by construction: the block is only emitted while
              this is on, so an unconfigured deck writes no deck key at all. */}
          <EmptyDescription>{t('content.deckEmptyDescription')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="ck-fm-deck-add"
            disabled={disabled}
            onClick={() => {
              form.set('fm.hasDeck', true)
              if (!fm.deck.template) form.set('fm.deck', emptyDeck())
            }}
          >
            <Plus data-icon="inline-start" />
            {t('content.configureDeck')}
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <EnumSelect
          label={t('content.template')}
          disabled={disabled}
          data-testid="ck-fm-deck-template"
          help={t('content.templateHelp')}
          allowEmpty
          placeholder={t('content.freeformDefault')}
          options={DECK_TEMPLATES.map((value) => ({ value, label: value }))}
          value={fm.deck.template}
          error={error('template')}
          onChange={(value) => set('template', value)}
        />
        <EnumSelect
          label={t('content.theme')}
          disabled={disabled}
          data-testid="ck-fm-deck-theme"
          allowEmpty
          placeholder={t('content.neutralDefault')}
          options={DECK_THEMES.map((value) => ({ value, label: value }))}
          value={fm.deck.theme}
          error={error('theme')}
          onChange={(value) => set('theme', value)}
        />
        <EnumSelect
          label={t('content.visualScheme')}
          disabled={disabled}
          data-testid="ck-fm-deck-visual-scheme"
          help={t('content.visualSchemeHelp')}
          allowEmpty
          placeholder={t('content.autoDefault')}
          options={DECK_VISUAL_SCHEMES.map((value) => ({ value, label: value }))}
          value={fm.deck.visualScheme}
          error={error('visualScheme')}
          onChange={(value) => set('visualScheme', value)}
        />
        <NumberField
          label={t('content.maximumSlides')}
          integer
          min={1}
          max={120}
          allowUnset
          unsetLabel={t('content.rendererDefault')}
          disabled={disabled}
          data-testid="ck-fm-deck-max-slides"
          value={fm.deck.maxSlides}
          error={error('maxSlides')}
          onChange={(value) => set('maxSlides', value)}
        />
      </div>
      <ExtraFieldsField
        label={t('content.firstSlide')}
        disabled={disabled}
        data-testid="ck-fm-deck-first-slide"
        help={t('content.firstSlideHelp')}
        about={t('content.firstSlideAbout')}
        maxBytes={16384}
        value={fm.deck.firstSlide}
        error={error('firstSlide')}
        onChange={(value) => set('firstSlide', value)}
      />
    </div>
  )
}
