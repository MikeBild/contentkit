import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ck, type ContentItem, type Preview } from '@/api/ck'
import { Dialog, DialogActions } from '@/components/ui/dialog'
import { CopyButton } from '@/components/ui/copy-button'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives'
import { EntityMultiSelect, NumberField, SlugField, TextField } from '@/forms/fields'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'

const HOUR_SECONDS = 3600
/** The server's own bounds on `expires_in`, in the unit this form speaks. */
const MIN_HOURS = 1
const MAX_HOURS = 168

function PreviewDialog({ site, onCreated, onClose }: { site: string; onCreated: (preview: Preview) => void; onClose: () => void }) {
  const client = useQueryClient()
  const [slug, setSlug] = useState('')
  const [itemIds, setItemIds] = useState<string[]>([])
  const [hours, setHours] = useState<number | undefined>(24)
  const [reason, setReason] = useState('')

  const content = useQuery({
    queryKey: keys.content.list(site),
    queryFn: () => ck.content.list(site),
    enabled: Boolean(site),
  })
  const items = (content.data ?? []) as ContentItem[]

  const create = useMutation({
    mutationFn: async () => {
      // The endpoint overlays revisions, but the operator is choosing documents.
      // The content list does not carry a revision id, so the newest one per
      // chosen item is resolved here — for the handful that were picked, not for
      // the whole workspace.
      const revisionIds = await Promise.all(
        itemIds.map(async (item) => (await ck.content.revisions(item))[0]?.id),
      )
      return ck.releases.preview(site, {
        slug,
        // An empty overlay previews exactly what is published today, which is a
        // legitimate thing to ask for — a rehearsal of the current site.
        revision_ids: revisionIds.filter((id): id is string => Boolean(id)),
        expires_in: (hours ?? 24) * HOUR_SECONDS,
        ...(reason ? { reason } : {}),
      })
    },
    onSuccess: async (preview) => {
      await client.invalidateQueries({ queryKey: keys.releases(site) })
      onCreated(preview)
      onClose()
    },
  })

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      busy={create.isPending}
      data-testid="ck-preview-dialog"
      title="New preview"
      description="A preview is a full build behind a one-time invitation. It is never activated and never becomes the live site."
      footer={
        <DialogActions>
          <Button variant="outline" data-testid="ck-preview-cancel" disabled={create.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            data-testid="ck-preview-submit"
            disabled={create.isPending || slug.length < 3 || hours === undefined}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Building…' : 'Build preview'}
          </Button>
        </DialogActions>
      }
    >
      <div className="space-y-4">
        <SlugField
          data-testid="ck-preview-slug"
          label="Name"
          required
          derivedFrom={reason}
          help="Appears in the preview URL. Reusing a name atomically replaces the previous preview under it."
          value={slug}
          onChange={setSlug}
        />

        <EntityMultiSelect
          data-testid="ck-preview-items"
          label="Documents to overlay"
          help="Their newest revision is built on top of what is published. One revision per document."
          fallback="Empty previews the published set exactly as it stands."
          value={itemIds}
          isLoading={content.isPending}
          optionsError={content.error}
          emptyMessage="No content on this site yet"
          options={items.map((item) => ({
            value: item.id,
            label: item.title || item.slug || item.id.slice(0, 8),
            hint: `${item.kind} · ${item.latest_revision_status ?? 'draft'}`,
          }))}
          onChange={(next) => setItemIds([...next])}
        />

        <NumberField
          data-testid="ck-preview-expires"
          label="Expires in"
          required
          integer
          unit="hours"
          min={MIN_HOURS}
          max={MAX_HOURS}
          help="After this the invitation and the preview URL both stop working."
          value={hours}
          onChange={setHours}
        />

        <TextField
          data-testid="ck-preview-reason"
          label="Reason"
          value={reason}
          fallback="Recorded on the release row; empty is fine."
          onChange={setReason}
        />

        {create.error ? (
          <p data-testid="ck-preview-error" className="text-sm text-chart-5">
            {create.error instanceof Error ? create.error.message : 'Could not build the preview'}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}

/**
 * The two URLs a preview answers with, side by side and clearly not the same
 * thing: one opens it for whoever already has access, the other *grants* that
 * access to the first person who follows it.
 */
function PreviewLinks({ preview, onDismiss }: { preview: Preview; onDismiss: () => void }) {
  return (
    <div
      data-testid="ck-preview-links"
      role="alert"
      className="mb-4 rounded-xl border border-chart-3/30 bg-chart-3/10 p-4"
    >
      <h3 className="text-sm font-semibold">Preview built</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        It expires in {Math.round(preview.expires_in / HOUR_SECONDS)} hours. The invitation is a secret: the first
        person who opens it is signed in to the preview.
      </p>
      <dl className="mt-3 space-y-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Preview URL</dt>
          <dd className="mt-1 flex items-center gap-2">
            <code data-testid="ck-preview-url" className="min-w-0 flex-1 break-all rounded-lg border border-border bg-background p-2 font-mono">
              {preview.preview_url}
            </code>
            <CopyButton value={preview.preview_url} data-testid="ck-preview-url-copy" />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Invitation URL — hand out once</dt>
          <dd className="mt-1 flex items-center gap-2">
            <code data-testid="ck-preview-invitation" className="min-w-0 flex-1 break-all rounded-lg border border-border bg-background p-2 font-mono">
              {preview.invitation_url}
            </code>
            <CopyButton value={preview.invitation_url} data-testid="ck-preview-invitation-copy" />
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex justify-end">
        <Button variant="outline" size="sm" data-testid="ck-preview-dismiss" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}

export function PreviewsCard({ site }: { site: string }) {
  const can = useCan()
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<Preview | null>(null)

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Previews</CardTitle>
          <p className="text-sm text-muted-foreground">
            A real build of unpublished work, reachable only through an invitation and only until it expires. Delete one
            from the release list below.
          </p>
        </div>
        {can('release:preview') || can('release:write') ? (
          <Button size="sm" variant="outline" data-testid="ck-preview-new" onClick={() => setCreating(true)}>
            New preview
          </Button>
        ) : null}
      </CardHeader>
      {created ? (
        <CardContent>
          <PreviewLinks preview={created} onDismiss={() => setCreated(null)} />
        </CardContent>
      ) : null}

      {creating ? <PreviewDialog site={site} onCreated={setCreated} onClose={() => setCreating(false)} /> : null}
    </Card>
  )
}
