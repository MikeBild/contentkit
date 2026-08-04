import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, TriangleAlert } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { ck, type Site } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { Confirm } from '@/components/confirm'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { SkeletonFields } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import { ConflictDialog, type SettingsConflict } from '@/forms/site/conflict'
import {
  SITE_SECTIONS,
  siteSettingsContract,
  type SiteSectionId,
  type SiteSettingsUI,
  type SiteWire,
} from '@/forms/site/contract'
import { SITE_SECTION_BODIES } from '@/forms/site/sections'
import { sameValue } from '@/forms/path'
import { SaveBar, UnsavedPill } from '@/forms/save-bar'
import { StatusBadge } from '@/forms/status-badge'
import { useForm, type SectionStatus } from '@/forms/use-form'
import { useUnsavedGuard } from '@/forms/use-unsaved-guard'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { useSite } from '@/lib/site'

/**
 * The settings of the *selected* site — the half of the old /sites page the site
 * switcher actually governs.
 *
 * It used to share a route with the site registry, and that route was declared
 * installation context: the breadcrumb read "Installation · Site" and the
 * switcher was dimmed with "Filters this page only" directly above the delete
 * button. Both statements were false. Everything below reads and PATCHes
 * `/v1/sites/{site}` for the one slug the switcher names, so the switcher is a
 * path parameter here — nothing on this page is installation-wide, and the
 * registry acts (list, create, delete) moved to /sites where they belong.
 */
export function SiteSettingsPage() {
  const { site } = useSite()
  const can = useCan()

  const detail = useQuery({
    queryKey: keys.sites.detail(site),
    queryFn: () => ck.sites.get(site),
    enabled: Boolean(site),
  })

  return (
    <Page
      title="Site settings"
      description="Everything the builder reads: identity, presentation, theme, branding and the reader-facing features."
    >
      {!site ? (
        <NoSite />
      ) : detail.isPending ? (
        // A form of forty fields is about to appear here, so the wait keeps its
        // shape rather than collapsing to one line and shoving every control the
        // operator was already reaching for out from under the pointer.
        <SkeletonFields fields={6} label="Loading the site settings…" data-testid="ck-site-settings-skeleton" />
      ) : detail.error ? (
        <Alert variant="destructive" data-testid="ck-site-settings-error">
          <TriangleAlert />
          <AlertTitle>This site could not be read</AlertTitle>
          <AlertDescription>
            {detail.error instanceof Error ? detail.error.message : 'Could not load the site'}
          </AlertDescription>
        </Alert>
      ) : (
        // Keyed by the site: switching sites is a different record, and reusing
        // the form state across them would carry one site's edits into another.
        <SettingsEditor key={detail.data.id} slug={site} loaded={detail.data} readOnly={!can('site:admin')} />
      )}
    </Page>
  )
}

const pickWire = (site: Site): SiteWire => ({
  name: site.name,
  description: site.description ?? '',
  base_url: site.base_url,
  default_locale: site.default_locale,
  settings: site.settings,
})

/**
 * The settings editor, and the whole reason the raw JSON box could go.
 *
 * The write is read-modify-write and the read happens twice: once to seed the
 * form, and once immediately before the request. `PATCH` replaces `settings`
 * wholesale, so the second read is what turns "someone else saved in the
 * meantime" from silent data loss into a question.
 */
function SettingsEditor({ slug, loaded, readOnly }: { slug: string; loaded: Site; readOnly: boolean }) {
  const client = useQueryClient()
  const { toast } = useToast()
  // A list, not a single id: the save is one all-or-nothing PATCH, so a 422 can
  // name three sections at once and the operator has to be able to hold all
  // three open while fixing them. `type="multiple"` is what makes that possible.
  const [open, setOpen] = useState<SiteSectionId[]>(['identity'])
  const [conflict, setConflict] = useState<SettingsConflict | null>(null)
  // The warning strip opens the section that owns a warning; opening it without
  // moving focus would leave the operator's caret in a strip that no longer says
  // anything, so the trigger it opened is what receives focus.
  const triggers = useRef<Partial<Record<SiteSectionId, HTMLButtonElement | null>>>({})

  const wire = useMemo(() => pickWire(loaded), [loaded])
  const initial = useMemo(() => siteSettingsContract.detect(wire), [wire])

  // The object the form was seeded from, compared against a fresh read at save
  // time. Held in a ref because the comparison happens inside a callback that
  // must not close over the render that started the save.
  const baseline = useRef<Record<string, unknown>>((wire.settings ?? {}) as Record<string, unknown>)
  // What the request merges into. Set by the save attempt, so `onSave` always
  // merges into the newest server object rather than the one the page loaded.
  const carrier = useRef<SiteWire>(wire)

  const context = useMemo(() => ({ baseUrl: wire.base_url }), [wire.base_url])

  const onSave = useCallback(
    async (values: SiteSettingsUI) => {
      const patch = siteSettingsContract.serialize(values, carrier.current)
      const saved = await ck.sites.update(slug, patch)
      const savedWire = pickWire(saved)
      baseline.current = (savedWire.settings ?? {}) as Record<string, unknown>
      carrier.current = savedWire
      await client.invalidateQueries({ queryKey: keys.sites.all })
      await client.invalidateQueries({ queryKey: keys.sites.detail(slug) })
      // The stored object becomes the new baseline, not what was typed: the
      // server normalises, and a form that keeps its own version reports the
      // difference as unsaved work forever.
      return siteSettingsContract.detect(savedWire)
    },
    [client, slug],
  )

  const form = useForm<SiteSettingsUI>({
    initial,
    validate: siteSettingsContract.validate,
    canonical: siteSettingsContract.canonical,
    context,
    sections: SITE_SECTIONS,
    onSave,
  })

  const attemptSave = useCallback(
    async (force = false) => {
      if (!form.canSave && !force) return false
      let fresh: Site
      try {
        fresh = await ck.sites.get(slug)
      } catch (failure) {
        toast({
          tone: 'danger',
          title: 'The site could not be re-read before saving',
          detail: failure instanceof Error ? failure.message : undefined,
        })
        return false
      }
      const current = (fresh.settings ?? {}) as Record<string, unknown>
      if (!force && !sameValue(baseline.current, current)) {
        setConflict({ baseline: baseline.current, current })
        return false
      }
      carrier.current = pickWire(fresh)
      setConflict(null)
      const saved = await form.save()
      if (saved) toast({ tone: 'success', title: 'Site settings saved' })
      return saved
    },
    [form, slug, toast],
  )

  // A 422 that no section claimed still has to be read: it is the only evidence
  // the operator gets that the whole PATCH was rejected.
  const unassigned = form.unassignedError
  const guard = useUnsavedGuard({
    when: form.dirty,
    onSave: () => attemptSave(),
    isSaving: form.isSaving,
  })

  const identityDirty = !sameValue(form.values.identity, initial.identity)
  const errorCount = Object.keys(form.errors).length

  const openSection = useCallback((id: SiteSectionId) => {
    setOpen((current) => (current.includes(id) ? current : [...current, id]))
    // After the state has been applied, so the trigger is the one that now
    // reads "expanded" rather than the one that was collapsed a moment ago.
    queueMicrotask(() => triggers.current[id]?.focus())
  }, [])

  return (
    <div className="flex flex-col gap-4">
      {guard.prompt}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span data-testid="ck-site-slug" className="rounded-md border border-border px-2 py-0.5 font-mono text-xs">
            {loaded.slug}
          </span>
          <UnsavedPill dirty={form.dirty} />
        </div>
        {/*
          The identity question, asked by the console's own confirmation rather
          than by a dialog this page keeps.

          Its trigger is the Save control — there is no second button — which is
          exactly what the render prop is for: `ask` opens the dialog, and
          `Confirm` remembers the control it was opened from.

          What that buys, precisely, because an earlier version of this comment
          claimed more than the code does: on cancel, focus returns to Save. On
          confirm it does not, and cannot — the PATCH is already in flight and Save
          is disabled by it, so `Confirm` parks on the nearest ancestor a screen
          reader announces (here `<main>`) and hands focus back to Save the moment
          it re-enables, unless the operator has moved first. What is guaranteed in
          both paths is the thing worth guaranteeing: focus never lands on `<body>`.

          The PATCH now runs *inside* the dialog instead of after it closes: the
          box stays up and refuses to be dismissed until the request answers, so
          nothing here reports a save it has not had. Where a rejection is *shown*
          is unchanged — `useForm` routes it onto the fields it names, or into the
          unassigned Alert below when nothing claims it.
        */}
        <Confirm
          title="Change the site's identity?"
          description={
            <>
              The base URL and the default locale of <strong>{loaded.name}</strong> decide every canonical link, feed
              URL and redirect this site serves. Changing them moves URLs that other people have already linked to.
            </>
          }
          confirmLabel="Save identity"
          // The names scripts/verify-cockpit-prod.md drives this by; see `ConfirmIds`.
          ids={{
            dialog: 'ck-site-identity-confirm',
            cancel: 'ck-site-identity-cancel',
            accept: 'ck-site-identity-accept',
          }}
          onConfirm={() => attemptSave()}
        >
          {(ask) => (
            <SaveBar
              data-testid="ck-site-save-bar"
              dirty={form.dirty}
              canSave={form.canSave && !readOnly}
              isSaving={form.isSaving}
              errorCount={errorCount}
              onReset={form.reset}
              onSave={() => {
                // base_url and default_locale move every URL this site serves, so
                // the identity section is the one save that asks first.
                if (identityDirty) ask()
                else void attemptSave()
              }}
            />
          )}
        </Confirm>
      </div>

      {readOnly ? (
        <Alert data-testid="ck-site-read-only">
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>Saving settings needs the site:admin scope.</AlertDescription>
        </Alert>
      ) : null}

      {unassigned ? (
        // The dismiss control is an AlertAction — the slot the component reserves
        // room for — rather than a button competing with the sentence for width.
        <Alert variant="destructive" data-testid="ck-site-unassigned-error">
          <TriangleAlert />
          <AlertTitle>The whole request was rejected and nothing was written</AlertTitle>
          <AlertDescription>{unassigned}</AlertDescription>
          <AlertAction>
            <Button variant="ghost" size="sm" data-testid="ck-site-unassigned-dismiss" onClick={form.clearUnassigned}>
              Dismiss
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      <SectionWarnings values={form.values} onOpen={openSection} />

      {/*
        Nine sections, and the container ladder in UI-UX.md answers that number
        rather than leaving it to taste. Tabs are for two to six parallel
        concerns; nine is past that ceiling, and a strip of nine tabs is the
        horizontally scrolling row of cards this replaces — a control whose ninth
        item is off-screen is a control that hides a third of the form. An
        Accordion is the next rung down and it is the one this page needed: many
        sections, most of them rarely opened, and a reader who is looking for a
        title. Every title is now on screen at once, in one column, at any width.

        What it must not cost, because it was a deliberate earlier fix: a warning
        is still rendered above, outside every section, so nothing accepted-but-
        questionable needs a section opened to be seen. Each row repeats its own
        status beside its title for the same reason — "3 problems" on a closed
        row is how an operator decides whether to open it.
      */}
      <Accordion
        type="multiple"
        value={open}
        onValueChange={(next) => setOpen(next as SiteSectionId[])}
        data-testid="ck-site-sections"
        className="rounded-xl border border-border bg-surface px-4"
      >
        {SITE_SECTIONS.map((entry) => {
          const id = entry.id as SiteSectionId
          const status = form.sectionStatus(id)
          const Body = SITE_SECTION_BODIES[id]
          return (
            <AccordionItem key={id} value={id}>
              <AccordionTrigger
                ref={(node) => {
                  triggers.current[id] = node
                }}
                data-testid={`ck-site-sections-${id}`}
                data-tone={status.tone}
                // The component's own `hover:underline` is for a row of prose. A
                // row here is a title, a badge and a status line, and underlining
                // all three on hover reads as three links to three places.
                className="items-center gap-3 py-3 hover:no-underline"
              >
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{entry.label}</span>
                  <SectionNote status={status} />
                </span>
              </AccordionTrigger>
              {/*
                `h-auto` undoes the fixed height shadcn sets for the open/close
                animation. These bodies grow while they are open — a version row
                added, a token revealed — and a height measured at open time would
                clip whatever arrived after it.
              */}
              <AccordionContent className="h-auto pb-5">
                <Body form={form} base={wire.base_url} locales={[wire.default_locale]} disabled={readOnly} />
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>

      <p className="text-xs text-muted-foreground">
        Presentation, theme and branding changes reach the live site with the next release; reader features that gate an
        endpoint take effect immediately.
      </p>

      {conflict ? (
        <ConflictDialog
          conflict={conflict}
          isSaving={form.isSaving}
          onCancel={() => setConflict(null)}
          onReload={async () => {
            setConflict(null)
            form.reset()
            await client.invalidateQueries({ queryKey: keys.sites.detail(slug) })
          }}
          onOverwrite={() => void attemptSave(true)}
        />
      ) : null}

    </div>
  )
}

/**
 * What a closed section says about itself.
 *
 * The old strip drew a coloured dot and then truncated the words next to it to
 * the width of a card. A dot is a colour doing a sentence's job — it says
 * something is wrong and not what, which is the entire question — so the reading
 * is carried by a word here, and the row is as wide as the page.
 *
 * `error` and `warning` are two different promises and get two different
 * components: an error blocks nothing but *was refused*, so it is destructive
 * and counted; a warning is accepted-but-questionable, so it is the tone
 * `StatusBadge` already draws an icon for. Neither is a chart colour.
 */
function SectionNote({ status }: { status: SectionStatus }) {
  if (status.tone === 'error') {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <StatusBadge tone="danger">{status.errors === 1 ? '1 problem' : `${status.errors} problems`}</StatusBadge>
        <span className="min-w-0 text-xs font-normal text-destructive">{status.text}</span>
      </span>
    )
  }
  if (status.tone === 'warning') {
    return <StatusBadge tone="warning">{status.text}</StatusBadge>
  }
  if (!status.text) return null
  return <span className="min-w-0 text-xs font-normal text-muted-foreground">{status.text}</span>
}

/**
 * Every active section warning, above the sections rather than inside them.
 *
 * `SITE_SECTIONS` already computes these — "No base URL — every canonical link
 * breaks", "Comments are open without a Turnstile key" — but until now the only
 * place one appeared was its own section's status line: truncated to the width of
 * a nav card, in a strip that scrolls sideways, and replaced entirely whenever
 * that section also has a validation error. So the reader of a nine-section form
 * could have three accepted-but-wrong values and see none of them.
 *
 * Read straight from the specs rather than from `form.sectionStatus`, for that
 * last reason: a warning must not be hidden by an error that happens to live in
 * the same section. None of them blocks the save; each one is a sentence about a
 * value the server will happily store.
 */
function SectionWarnings({
  values,
  onOpen,
}: {
  values: SiteSettingsUI
  onOpen: (id: SiteSectionId) => void
}) {
  const active = SITE_SECTIONS.map((section) => ({
    id: section.id as SiteSectionId,
    label: section.label,
    warning: section.warning?.(values),
  })).filter((entry): entry is { id: SiteSectionId; label: string; warning: string } => Boolean(entry.warning))

  if (active.length === 0) return null

  return (
    // `Alert` has two variants and neither of them is amber, which is the right
    // answer here rather than a defect: none of these blocks the save, so the
    // destructive treatment would overstate them. The icon is what carries the
    // severity, and it is a direct child of Alert — the CVA switches to a
    // two-column grid on `has-[>svg]` and an icon in a wrapper breaks it.
    <Alert data-testid="ck-site-warnings">
      <AlertTriangle />
      <AlertTitle>
        {active.length === 1
          ? 'One thing is accepted but questionable'
          : `${active.length} things are accepted but questionable`}
      </AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-1">
        {/*
          Each of these opens the section that holds the offending value. It is
          not navigation — the URL is the same afterwards and the page has not
          moved to another route — so it stopped being link-styled: an underline
          here promised a destination and delivered an accordion. Ghost keeps it
          a sentence with a hover and a focus ring, which is what it is.
        */}
        {active.map((entry) => (
          <Button
            key={entry.id}
            variant="ghost"
            size="xs"
            className="-mx-1.5 h-auto px-1.5 py-0.5 text-left whitespace-normal"
            data-testid={`ck-site-warnings-${entry.id}`}
            onClick={() => onOpen(entry.id)}
          >
            {entry.label}: {entry.warning}
          </Button>
        ))}
      </AlertDescription>
    </Alert>
  )
}

