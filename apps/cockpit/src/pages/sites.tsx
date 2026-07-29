import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { ck, type Site } from '@/api/ck'
import { ApiError } from '@/api/client'
import { NoSite, Page } from '@/app/shell'
import { Dialog, DialogActions } from '@/components/ui/dialog'
import { Button, Card, CardContent, Input, Label } from '@/components/ui/primitives'
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

export function SitesPage() {
  const { site, setSite } = useSite()
  const can = useCan()

  const detail = useQuery({
    queryKey: keys.sites.detail(site),
    queryFn: () => ck.sites.get(site),
    enabled: Boolean(site),
  })

  return (
    <Page
      title="Site"
      description="Everything the builder reads: identity, presentation, theme, branding and the reader-facing features."
      actions={
        <>
          {can('site:admin') ? <CreateSite onCreated={setSite} /> : null}
          {can('site:admin') && detail.data ? <DeleteSite site={detail.data} /> : null}
        </>
      }
    >
      {!site ? (
        <NoSite />
      ) : detail.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : detail.error ? (
        <p className="text-sm text-chart-5">
          {detail.error instanceof Error ? detail.error.message : 'Could not load the site'}
        </p>
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
  const [pendingIdentity, setPendingIdentity] = useState(false)

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
            if (identityDirty) setPendingIdentity(true)
            else void attemptSave()
          }}
        />
      </div>

      {readOnly ? (
        <p className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
          Read-only: saving settings needs the site:admin scope.
        </p>
      ) : null}

      {unassigned ? (
        <div
          data-testid="ck-site-unassigned-error"
          className="flex items-start justify-between gap-3 rounded-lg border border-chart-5/30 bg-chart-5/10 p-3 text-xs text-chart-5"
        >
          <span>
            The whole request was rejected and nothing was written: {unassigned}
          </span>
          <Button variant="ghost" size="sm" data-testid="ck-site-unassigned-dismiss" onClick={form.clearUnassigned}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <SectionNav
        data-testid="ck-site-sections"
        sections={SITE_SECTIONS.map((entry) => ({ id: entry.id as SiteSectionId, label: entry.label }))}
        value={section}
        onChange={setSection}
        status={form.sectionStatus}
      />

      <Card>
        <CardContent className="pt-5">
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

      <IdentityConfirm
        open={pendingIdentity}
        name={loaded.name}
        onCancel={() => setPendingIdentity(false)}
        onConfirm={() => {
          setPendingIdentity(false)
          void attemptSave()
        }}
      />
    </div>
  )
}

function IdentityConfirm({
  open,
  name,
  onCancel,
  onConfirm,
}: {
  open: boolean
  name: string
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!open) return null
  return (
    <Dialog
      open
      size="sm"
      data-testid="ck-site-identity-confirm"
      title="Change the site's identity?"
      description={
        <>
          The base URL and the default locale of <strong>{name}</strong> decide every canonical link, feed URL and
          redirect this site serves. Changing them moves URLs that other people have already linked to.
        </>
      }
      onClose={onCancel}
      footer={
        <>
          <Button variant="outline" size="sm" data-testid="ck-site-identity-cancel" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" data-testid="ck-site-identity-accept" onClick={onConfirm}>
            Save identity
          </Button>
        </>
      }
    />
  )
}

function CreateSite({ onCreated }: { onCreated: (slug: string) => void }) {
  const [isOpen, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', base_url: '', default_locale: 'en' })
  const client = useQueryClient()
  const create = useMutation({
    mutationFn: () => ck.sites.create(form),
    onSuccess: async (created) => {
      setOpen(false)
      // The list has to know the new site before the selection names it:
      // selecting a slug the provider cannot find makes it fall back to the
      // first known site, which lands the operator back where they started.
      await client.invalidateQueries({ queryKey: keys.sites.all })
      onCreated(created.slug)
    },
  })

  return (
    <>
      <Button data-testid="site-new" variant="outline" onClick={() => setOpen(true)}>
        New site
      </Button>
      {isOpen ? (
        <Dialog
          open
          size="default"
          data-testid="ck-site-create"
          title="New site"
          description="A site starts with one locale and no content. Everything else is edited here afterwards."
          busy={create.isPending}
          onClose={() => setOpen(false)}
          footer={
            <DialogActions>
              <Button variant="outline" size="sm" data-testid="site-create-cancel" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                data-testid="site-create-submit"
                onClick={() => create.mutate()}
                disabled={create.isPending || !form.name || !form.base_url || !form.default_locale}
              >
                {create.isPending ? 'Creating…' : 'Create'}
              </Button>
            </DialogActions>
          }
        >
          <div className="flex flex-col gap-3">
            {(['name', 'base_url', 'default_locale'] as const).map((field) => (
              <div key={field}>
                <Label htmlFor={`site-new-${field}`}>{field.replace('_', ' ')}</Label>
                <Input
                  id={`site-new-${field}`}
                  data-testid={`site-new-${field}`}
                  value={form[field]}
                  onChange={(event) => setForm({ ...form, [field]: event.target.value })}
                />
              </div>
            ))}
            {create.error ? (
              <p className="text-sm text-chart-5">
                {create.error instanceof Error ? create.error.message : 'Could not create the site'}
              </p>
            ) : null}
          </div>
        </Dialog>
      ) : null}
    </>
  )
}

/**
 * Deleting a site, in the two steps the server insists on.
 *
 * A site that still owns content, releases or readers answers 409 with the
 * counts, and that refusal *is* the confirmation step — so the first attempt
 * never passes `purge`. Sending it straight away would turn a deliberate
 * safeguard into a flag the console silently sets.
 */
function DeleteSite({ site }: { site: Site }) {
  const [isOpen, setOpen] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const client = useQueryClient()
  const { toast } = useToast()

  const remove = useMutation({
    mutationFn: (purge: boolean) => ck.sites.remove(site.slug, purge),
    onSuccess: async () => {
      setOpen(false)
      setRefusal(null)
      toast({ tone: 'success', title: `${site.name} was deleted` })
      // The provider falls back to another site once this one is gone.
      await client.invalidateQueries({ queryKey: keys.sites.all })
    },
    onError: (failure) => {
      if (failure instanceof ApiError && failure.status === 409) setRefusal(failure.message)
    },
  })

  return (
    <>
      <Button
        variant="ghost"
        data-testid="ck-site-delete"
        onClick={() => {
          setRefusal(null)
          remove.reset()
          setOpen(true)
        }}
      >
        <Trash2 className="h-4 w-4 text-chart-5" />
        Delete site
      </Button>
      {isOpen ? (
        <Dialog
          open
          size="default"
          data-testid="ck-site-delete-dialog"
          title={`Delete ${site.name}?`}
          description="The site row, its content, its releases and the stored objects behind them are removed. None of it is recoverable."
          busy={remove.isPending}
          onClose={() => setOpen(false)}
          footer={
            <DialogActions>
              <Button
                variant="outline"
                size="sm"
                data-testid="ck-site-delete-cancel"
                disabled={remove.isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                data-testid={refusal ? 'ck-site-delete-purge' : 'ck-site-delete-confirm'}
                disabled={remove.isPending}
                onClick={() => remove.mutate(Boolean(refusal))}
              >
                {remove.isPending ? 'Deleting…' : refusal ? 'Delete the site and all of it' : 'Delete site'}
              </Button>
            </DialogActions>
          }
        >
          {refusal ? (
            <p data-testid="ck-site-delete-refusal" className="text-sm text-chart-3">
              {refusal}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              A site that still owns content refuses once and names what would go, so the second answer is a decision
              about known numbers.
            </p>
          )}
          {remove.error && !(remove.error instanceof ApiError && remove.error.status === 409) ? (
            <p className="mt-3 text-sm text-chart-5">{remove.error.message}</p>
          ) : null}
        </Dialog>
      ) : null}
    </>
  )
}
