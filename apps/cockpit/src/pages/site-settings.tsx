import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, TriangleAlert } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { ck, type Site } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { Confirm } from '@/components/confirm'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { SaveBar, SectionNav, UnsavedPill } from '@/forms/save-bar'
import { useForm } from '@/forms/use-form'
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
  const [section, setSection] = useState<SiteSectionId>('identity')
  const [conflict, setConflict] = useState<SettingsConflict | null>(null)

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
  const Body = SITE_SECTION_BODIES[section]
  const errorCount = Object.keys(form.errors).length

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
          `Confirm` remembers the control it was opened from, so focus comes back
          to Save whether the operator confirms or cancels, and never lands on
          `<body>` while the button is briefly disabled by the save it started.

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

      <SectionWarnings values={form.values} onOpen={setSection} />

      <SectionNav
        data-testid="ck-site-sections"
        sections={SITE_SECTIONS.map((entry) => ({ id: entry.id as SiteSectionId, label: entry.label }))}
        value={section}
        onChange={setSection}
        status={form.sectionStatus}
      />

      <Card>
        <CardHeader>
          {/* The nav above is a strip of nine; the card says which one of them is
              open, so the heading and the body are one statement. */}
          <CardTitle>{SITE_SECTIONS.find((entry) => entry.id === section)?.label ?? 'Settings'}</CardTitle>
        </CardHeader>
        <CardContent>
          <Body form={form} base={wire.base_url} locales={[wire.default_locale]} disabled={readOnly} />
        </CardContent>
      </Card>

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
        {active.map((entry) => (
          <Button
            key={entry.id}
            variant="link"
            size="xs"
            className="h-auto p-0 text-left"
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

