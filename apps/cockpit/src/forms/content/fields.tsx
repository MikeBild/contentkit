import { ChevronRight, LayoutTemplate, Plus, Presentation } from 'lucide-react'
import type { ReactNode } from 'react'
import { AppLink } from '@/components/app-link'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { RelativeTime } from '@/components/ui/relative-time'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { StatusBadge } from '@/forms/status-badge'
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
              <TooltipContent>Fields in this section that carry a value.</TooltipContent>
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
  return (
    <ObjectListField
      label={label}
      help={help}
      about={about}
      data-testid={testId}
      disabled={disabled}
      error={error}
      max={max}
      addLabel="Add line"
      emptyMessage="None yet."
      value={value.map((entry) => ({ text: entry }))}
      onChange={(rows) => onChange(rows.map((row) => String(row.text ?? '')))}
      create={() => ({ text: '' })}
      renderItem={(row, api) => (
        <TextField
          label={`Line ${api.index + 1}`}
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
      <Group id="core" title="Core" defaultOpen>
        <TextField
          label="Title"
          required
          disabled={disabled}
          data-testid="ck-fm-title"
          help="The only field with no fallback anywhere: a document without one is rejected."
          value={fm.title}
          error={error('title')}
          onChange={(value) => set('title', value)}
        />
        <SlugField
          label="Slug"
          disabled={disabled}
          data-testid="ck-fm-slug"
          about="The last segment of the URL. It follows the title until you edit it, and then stops."
          fallback="Unset is derived from the title on save."
          derivedFrom={fm.title}
          siblings={siblings}
          value={fm.slug}
          error={error('slug')}
          onChange={(value) => set('slug', value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <EnumSelect
            label="Kind"
            disabled={disabled}
            data-testid="ck-fm-kind"
            definition="Decides the URL prefix and which listings the document appears in."
            fallback="Unset means page."
            allowEmpty
            placeholder="page (default)"
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
            label="Locale"
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
          label="Summary"
          rows={3}
          disabled={disabled}
          data-testid="ck-fm-summary"
          definition="Used in listings, the feed and the share cards."
          fallback="Unset is excerpted from the first paragraph."
          value={fm.summary}
          error={error('summary')}
          onChange={(value) => set('summary', value)}
        />
        <TagListField
          label="Tags"
          disabled={disabled}
          data-testid="ck-fm-tags"
          help="Each tag gets its own listing page."
          value={fm.tags}
          error={error('tags')}
          onChange={(value) => set('tags', [...value])}
        />
        <TextField
          label="Translation key"
          disabled={disabled}
          data-testid="ck-fm-translation-key"
          definition="What ties the locales of one document together, so a reader can switch language and stay on the page."
          fallback="Unset falls back to the slug."
          value={fm.translationKey}
          error={error('translationKey')}
          onChange={(value) => set('translationKey', value)}
        />
      </Group>

      <Group id="publication" title="Publication" defaultOpen>
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
          label="Publication date"
          presets
          disabled={disabled}
          data-testid="ck-fm-date"
          about="What the document is sorted and dated by. A date in the past is ordinary."
          fallback="Unset uses the moment the release is built."
          value={fm.date || undefined}
          error={error('date')}
          onChange={(value) => set('date', value ?? '')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <DateTimeField
            label="Scheduled for"
            disabled={disabled}
            data-testid="ck-fm-scheduled-at"
            about="A revision with a future date is published by the scheduler, not by this save. The time of day is part of it."
            fallback="Unset means it publishes with the next release."
            // The way back to empty, in this field's own words. The shared control
            // calls it "Never" because it was built for a credential that never
            // expires; here empty means the next release publishes the revision,
            // and "Never" next to that sentence reads as "never publish".
            unsetLabel="No schedule"
            // The state in words, next to the label: a datetime control that has
            // been cleared looks exactly like one nobody has reached yet.
            hint={
              fm.scheduledAt ? (
                <RelativeTime value={fm.scheduledAt} data-testid="ck-fm-scheduled-at-when" />
              ) : (
                <span data-testid="ck-fm-scheduled-at-when">Not set</span>
              )
            }
            value={fm.scheduledAt || undefined}
            error={error('scheduledAt')}
            onChange={(value) => set('scheduledAt', value ?? '')}
          />
          <DateField
            label="Last updated"
            presets
            disabled={disabled}
            data-testid="ck-fm-updated-at"
            fallback="Unset shows no update line."
            value={fm.updatedAt || undefined}
            error={error('updatedAt')}
            onChange={(value) => set('updatedAt', value ?? '')}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <TriToggle
            label="Hide from search engines"
            data-testid="ck-fm-noindex"
            disabled={disabled}
            defaultLabel="indexed"
            value={fm.noindex}
            error={error('noindex')}
            onChange={(value) => set('noindex', value)}
          />
          <TriToggle
            label="Featured"
            data-testid="ck-fm-featured"
            disabled={disabled}
            defaultLabel="not featured"
            value={fm.featured}
            error={error('featured')}
            onChange={(value) => set('featured', value)}
          />
          <TriToggle
            label="Read-aloud"
            data-testid="ck-fm-audio"
            disabled={disabled}
            defaultLabel="eligible"
            help="Off opts this document out of narration even when the site has it on."
            value={fm.audio}
            error={error('audio')}
            onChange={(value) => set('audio', value)}
          />
        </div>
      </Group>

      <Group id="layout" title="Layout" description={effectiveLayout(fm, preset)} defaultOpen>
        <EnumSelect
          label="Layout"
          disabled={disabled || fm.kind === 'deck'}
          data-testid="ck-fm-layout"
          about={
            fm.kind === 'deck'
              ? 'A deck has one layout and the server rejects any other, so this follows the kind.'
              : 'Decides the page template and, for docs and wiki, the URL shape.'
          }
          fallback={
            fm.layout
              ? undefined
              : `Unset resolves to ${effectiveLayout(fm, preset)} for this kind under the ${preset || 'portfolio'} preset.`
          }
          allowEmpty
          placeholder={`${effectiveLayout(fm, preset)} (from the preset)`}
          options={LAYOUTS.map((value) => ({
            value,
            label: value === 'report' ? 'report (compatibility alias for composition)' : value,
            disabled: fm.kind === 'deck' && value !== 'deck',
            disabledReason: 'kind: deck requires layout: deck',
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
              label="Doc key"
              required
              disabled={disabled}
              data-testid="ck-fm-doc-key"
              help="Identifies the same page across documentation versions."
              value={fm.docKey}
              error={error('docKey')}
              onChange={(value) => set('docKey', value)}
            />
            {docsVersions.length ? (
              <EnumSelect
                label="Documentation version"
                required
                disabled={disabled}
                data-testid="ck-fm-docs-version"
                help="One of the versions this site configures."
                about="A version the site does not know fails the release."
                allowEmpty
                options={docsVersions.map((entry) => ({ value: entry.id, label: `${entry.label} (${entry.id})` }))}
                value={fm.docsVersion}
                error={error('docsVersion')}
                onChange={(value) => set('docsVersion', value)}
              />
            ) : (
              <EmptyPicker
                label="Documentation version"
                testId="ck-fm-docs-version-empty"
                message="No documentation versions are configured for this site."
                to="/sites"
              />
            )}
          </div>
        ) : null}

        {['docs', 'wiki', 'knowledge'].includes(effectiveLayout(fm, preset)) ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Parent"
              disabled={disabled}
              data-testid="ck-fm-parent"
              help="The slug of the page above this one."
              about="It nests the URL as well as the navigation."
              value={fm.parent}
              error={error('parent')}
              onChange={(value) => set('parent', value)}
            />
            <TextField
              label="Navigation title"
              disabled={disabled}
              data-testid="ck-fm-nav-title"
              fallback="Unset uses the title."
              value={fm.navTitle}
              error={error('navTitle')}
              onChange={(value) => set('navTitle', value)}
            />
            <NumberField
              label="Navigation order"
              integer
              allowUnset
              unsetLabel="Alphabetical"
              disabled={disabled}
              data-testid="ck-fm-nav-order"
              value={fm.navOrder}
              error={error('navOrder')}
              onChange={(value) => set('navOrder', value)}
            />
            <TextField
              label="Category"
              disabled={disabled}
              data-testid="ck-fm-category"
              help="Groups pages within one navigation level."
              value={fm.category}
              error={error('category')}
              onChange={(value) => set('category', value)}
            />
          </div>
        ) : null}

        {effectiveLayout(fm, preset) === 'changelog' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Release version"
              disabled={disabled}
              data-testid="ck-fm-release-version"
              value={fm.releaseVersion}
              error={error('releaseVersion')}
              onChange={(value) => set('releaseVersion', value)}
            />
            <EnumMultiSelect
              label="Change types"
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

      <Group id="media" title="Media" configured={mediaConfigured ? 'configured' : undefined}>
        <UrlField
          label="Cover image"
          mode="asset"
          disabled={disabled}
          data-testid="ck-fm-cover"
          help="Used as the share card image and at the head of the article."
          value={fm.cover}
          error={error('cover')}
          onChange={(value) => set('cover', value)}
        />
        <TextField
          label="Cover alt text"
          disabled={disabled}
          data-testid="ck-fm-cover-alt"
          warning={fm.cover && !fm.coverAlt ? 'The cover has no alternative text' : undefined}
          value={fm.coverAlt}
          error={error('coverAlt')}
          onChange={(value) => set('coverAlt', value)}
        />
        <UrlField
          label="External URL"
          disabled={disabled}
          data-testid="ck-fm-external-url"
          help="For a project that lives somewhere else; the card links there instead of to a page here."
          value={fm.externalUrl}
          error={error('externalUrl')}
          onChange={(value) => set('externalUrl', value)}
        />
        <TagListField
          label="Technologies"
          disabled={disabled}
          data-testid="ck-fm-technologies"
          help="Shown on a project card."
          value={fm.technologies}
          error={error('technologies')}
          onChange={(value) => set('technologies', [...value])}
        />
      </Group>

      <Group id="aids" title="Reader aids" configured={aidsConfigured ? `${aidsConfigured}` : undefined}>
        <TextListField
          label="TL;DR"
          help="Three or four sentences above the article."
          about="Authored, never generated — they are also what machines read as the abstract."
          testId="ck-fm-tldr"
          disabled={disabled}
          value={fm.tldr}
          error={error('tldr')}
          onChange={(value) => set('tldr', value)}
          placeholder="One thing the reader should take away"
        />
        <ObjectListField
          label="FAQ"
          help="Closes the article as collapsed questions and is published as FAQPage structured data."
          data-testid="ck-fm-faq"
          disabled={disabled}
          addLabel="Add question"
          emptyMessage="No questions yet."
          value={fm.faq}
          error={error('faq')}
          onChange={(value) => set('faq', value)}
          create={() => ({ q: '', a: '' })}
          itemLabel={(entry) => entry.q || 'New question'}
          renderItem={(entry, api) => (
            <div className="flex flex-col gap-4">
              <TextField
                label="Question"
                required
                disabled={disabled}
                data-testid={`ck-fm-faq-q-${api.index}`}
                value={entry.q}
                error={error(`faq.${api.index}.q`)}
                onChange={(value) => api.update({ q: value })}
              />
              <TextAreaField
                label="Answer"
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
          label="Related documents"
          disabled={disabled}
          data-testid="ck-fm-related"
          help="Up to eight slugs in the same locale."
          about="Whether one resolves is decided at build time, where a broken reference is dropped with a warning."
          max={8}
          value={fm.related}
          error={error('related')}
          onChange={(value) => set('related', [...value])}
        />
        {accessGroups.length ? (
          <EnumMultiSelect
            label="Reader groups"
            disabled={disabled}
            data-testid="ck-fm-access"
            help="Empty means the document is public."
            about="Naming a group puts it behind reader sign-in."
            allEmptyMeans={{ allLabel: 'Public — anyone may read it', someLabel: 'Restricted to the groups below' }}
            options={accessGroups.map((value) => ({ value, label: value }))}
            value={fm.access}
            error={error('access')}
            onChange={(value) => set('access', [...value])}
          />
        ) : (
          <TagListField
            label="Reader groups"
            disabled={disabled}
            data-testid="ck-fm-access"
            help="This site has no access groups yet; a group named here has to exist before a release will serve the document."
            max={32}
            value={fm.access}
            error={error('access')}
            onChange={(value) => set('access', [...value])}
          />
        )}
      </Group>

      <Group id="extra" title="Custom fields" configured={Object.keys(fm.extra).length ? `${Object.keys(fm.extra).length}` : undefined}>
        <ExtraFieldsField
          label="extra"
          disabled={disabled}
          data-testid="ck-fm-extra"
          help="Author-owned fields, passed through to the revision's metadata with their types intact."
          about="Consumers interpret them; ContentKit only bounds them."
          maxBytes={16384}
          value={fm.extra}
          error={error('extra')}
          onChange={(value) => set('extra', value)}
        />
      </Group>

      {Object.keys(fm.carried).length ? (
        <Group id="carried" title="Passed through" configured={`${Object.keys(fm.carried).length}`} defaultOpen>
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
  return (
    <div data-testid={testId} className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
        {message}{' '}
        <AppLink to={to} data-testid={`${testId}-link`} className="text-accent underline">
          Configure it on the site
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
          <EmptyTitle>This document has no composition block</EmptyTitle>
          <EmptyDescription>
            Adding one lets it declare its format, canvas and the narrative the renderer builds around.
          </EmptyDescription>
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
            Add a composition block
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
            label={key}
            disabled={disabled}
            data-testid={`ck-fm-composition-${key}`}
            allowEmpty
            placeholder={`${fallbackValue} (default)`}
            fallback={value ? undefined : `Unset behaves as ${fallbackValue}.`}
            options={allowed.map((entry) => ({ value: entry, label: entry }))}
            value={value}
            error={error(key)}
            onChange={(next) => set(key, next)}
          />
        ))}
        <TextField
          label="Preferred pattern"
          disabled={disabled}
          data-testid="ck-fm-composition-preferred-pattern"
          help="A request, not an instruction: the renderer falls back and reports a diagnostic when the pattern does not fit."
          value={composition.preferredPattern}
          error={error('preferredPattern')}
          onChange={(value) => set('preferredPattern', value)}
        />
      </div>

      {isReport ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <EnumSelect
            label="Report cadence"
            disabled={disabled}
            data-testid="ck-fm-report-cadence"
            help="Only a report may carry one; on anything else the write is rejected."
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
              label="Report series"
              disabled={disabled}
              data-testid="ck-fm-report-series"
              help="One of the series this site configures."
              about="A preview or release rejects an id the site does not know."
              allowEmpty
              options={reportSeries.map((entry) => ({ value: entry.id, label: `${entry.label} (${entry.id})` }))}
              value={fm.reportSeries}
              error={form.fieldError('fm.reportSeries')}
              onChange={(value) => form.set('fm.reportSeries', value)}
            />
          ) : (
            <EmptyPicker
              label="Report series"
              testId="ck-fm-report-series-empty"
              message="No report series are configured for this site."
              to="/sites"
            />
          )}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Audience"
          maxLength={120}
          disabled={disabled}
          data-testid="ck-fm-composition-audience"
          value={composition.audience}
          error={error('audience')}
          onChange={(value) => set('audience', value)}
        />
        <TextField
          label="Question"
          maxLength={240}
          disabled={disabled}
          data-testid="ck-fm-composition-question"
          help="The one question this document answers."
          value={composition.question}
          error={error('question')}
          onChange={(value) => set('question', value)}
        />
        <TextField
          label="Goal"
          maxLength={240}
          disabled={disabled}
          data-testid="ck-fm-composition-goal"
          value={composition.goal}
          error={error('goal')}
          onChange={(value) => set('goal', value)}
        />
      </div>
      <TextAreaField
        label="Thesis"
        rows={2}
        maxChars={500}
        disabled={disabled}
        data-testid="ck-fm-composition-thesis"
        value={composition.thesis}
        error={error('thesis')}
        onChange={(value) => set('thesis', value)}
      />
      <TextAreaField
        label="Conclusion"
        rows={2}
        maxChars={500}
        disabled={disabled}
        data-testid="ck-fm-composition-conclusion"
        value={composition.conclusion}
        error={error('conclusion')}
        onChange={(value) => set('conclusion', value)}
      />
      <TextAreaField
        label="Action"
        rows={2}
        maxChars={500}
        disabled={disabled}
        data-testid="ck-fm-composition-action"
        help="What the reader should do next."
        value={composition.action}
        error={error('action')}
        onChange={(value) => set('action', value)}
      />
      <TextListField
        label="Limitations"
        help="What this document does not claim."
        about="Up to twelve, 300 characters each — and the one section a truthful composition is not allowed to omit silently."
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
          <EmptyTitle>This deck uses the renderer's defaults</EmptyTitle>
          {/* True of `hasDeck` by construction: the block is only emitted while
              this is on, so an unconfigured deck writes no deck key at all. */}
          <EmptyDescription>Nothing is written to the frontmatter until it is configured.</EmptyDescription>
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
            Configure the deck
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <EnumSelect
          label="Template"
          disabled={disabled}
          data-testid="ck-fm-deck-template"
          help="A template with narrative slots validates every slide's deckRole before rendering."
          allowEmpty
          placeholder="freeform (default)"
          options={DECK_TEMPLATES.map((value) => ({ value, label: value }))}
          value={fm.deck.template}
          error={error('template')}
          onChange={(value) => set('template', value)}
        />
        <EnumSelect
          label="Theme"
          disabled={disabled}
          data-testid="ck-fm-deck-theme"
          allowEmpty
          placeholder="neutral (default)"
          options={DECK_THEMES.map((value) => ({ value, label: value }))}
          value={fm.deck.theme}
          error={error('theme')}
          onChange={(value) => set('theme', value)}
        />
        <EnumSelect
          label="Visual scheme"
          disabled={disabled}
          data-testid="ck-fm-deck-visual-scheme"
          help="Semantic directives are rasterised at build time, so this decides what the images look like."
          allowEmpty
          placeholder="auto (default)"
          options={DECK_VISUAL_SCHEMES.map((value) => ({ value, label: value }))}
          value={fm.deck.visualScheme}
          error={error('visualScheme')}
          onChange={(value) => set('visualScheme', value)}
        />
        <NumberField
          label="Maximum slides"
          integer
          min={1}
          max={120}
          allowUnset
          unsetLabel="Renderer default"
          disabled={disabled}
          data-testid="ck-fm-deck-max-slides"
          value={fm.deck.maxSlides}
          error={error('maxSlides')}
          onChange={(value) => set('maxSlides', value)}
        />
      </div>
      <ExtraFieldsField
        label="First slide"
        disabled={disabled}
        data-testid="ck-fm-deck-first-slide"
        help="Slidev front-slide options, up to 32 fields."
        about="theme, routerMode and colorSchema are reserved and rejected."
        maxBytes={16384}
        value={fm.deck.firstSlide}
        error={error('firstSlide')}
        onChange={(value) => set('firstSlide', value)}
      />
    </div>
  )
}
