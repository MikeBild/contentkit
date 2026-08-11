import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { InfoIcon, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { ck, type ContentItem, type Preview } from '@/api/ck'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CopyButton } from '@/components/ui/copy-button'
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
import { EntityMultiSelect, NumberField, SlugField, TextField } from '@/forms/fields'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { useI18n } from '@/lib/i18n-context'

const HOUR_SECONDS = 3600
/** The server's own bounds on `expires_in`, in the unit this form speaks. */
const MIN_HOURS = 1
const MAX_HOURS = 168

function PreviewDialog({ site, onCreated, onClose }: { site: string; onCreated: (preview: Preview) => void; onClose: () => void }) {
  const { t } = useI18n()
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
      onOpenChange={(next) => {
        // The build is running on the server. Closing the dialog would not stop
        // it, so closing the dialog is not offered until it answers.
        if (create.isPending) return
        if (!next) onClose()
      }}
    >
      <DialogContent
        data-testid="ck-preview-dialog"
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
          <DialogTitle>{t('previews.new')}</DialogTitle>
          <DialogDescription>{t('previews.newDescription')}</DialogDescription>
        </DialogHeader>
        <div className="scrollbar-thin min-h-0 flex flex-col gap-4 overflow-y-auto">
          <SlugField
            data-testid="ck-preview-slug"
            label={t('previews.name')}
            required
            derivedFrom={reason}
            help={t('previews.nameHelp')}
            about={t('previews.nameAbout')}
            value={slug}
            onChange={setSlug}
          />

          <EntityMultiSelect
            data-testid="ck-preview-items"
            label={t('previews.documents')}
            about={t('previews.documentsAbout')}
            fallback={t('previews.documentsFallback')}
            value={itemIds}
            isLoading={content.isPending}
            optionsError={content.error}
            emptyMessage={t('previews.noContent')}
            options={items.map((item) => ({
              value: item.id,
              label: item.title || item.slug || t('common.unavailableDocument'),
              hint: `${t(`content.kind.${item.kind}`)} · ${t(
                item.latest_revision_status === 'published'
                  ? 'content.revisions.publishedStatus'
                  : 'content.revisions.draftStatus',
              )}`,
            }))}
            onChange={(next) => setItemIds([...next])}
          />

          <NumberField
            data-testid="ck-preview-expires"
            label={t('previews.expiresIn')}
            required
            integer
            unit={t('previews.hours')}
            min={MIN_HOURS}
            max={MAX_HOURS}
            help={t('previews.expiresHelp')}
            value={hours}
            onChange={setHours}
          />

          <TextField
            data-testid="ck-preview-reason"
            label={t('previews.reason')}
            value={reason}
            fallback={t('previews.reasonFallback')}
            onChange={setReason}
          />

          {create.error ? (
            <Alert variant="destructive" data-testid="ck-preview-error">
              <TriangleAlert />
              <AlertTitle>{t('previews.buildError')}</AlertTitle>
              <AlertDescription>
                {create.error instanceof Error ? create.error.message : t('previews.buildErrorFallback')}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" data-testid="ck-preview-cancel" disabled={create.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            data-testid="ck-preview-submit"
            disabled={create.isPending || slug.length < 3 || hours === undefined}
            onClick={() => create.mutate()}
          >
            {create.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t('previews.build')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The two URLs a preview answers with, side by side and clearly not the same
 * thing: one opens it for whoever already has access, the other *grants* that
 * access to the first person who follows it.
 */
function PreviewLinks({ preview, onDismiss }: { preview: Preview; onDismiss: () => void }) {
  const { t } = useI18n()
  return (
    // An `Alert`, not a `div` painted amber and told to announce itself: the
    // component already carries `role="alert"`, the border and the icon grid.
    <Alert data-testid="ck-preview-links" className="mb-4">
      <TriangleAlert />
      <AlertTitle>{t('previews.built')}</AlertTitle>
      <AlertDescription>
        {t('previews.builtDescription', { hours: Math.round(preview.expires_in / HOUR_SECONDS) })}
      </AlertDescription>
      <dl className="mt-3 flex flex-col gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">{t('previews.previewUrl')}</dt>
          <dd className="mt-1 flex items-center gap-2">
            <code data-testid="ck-preview-url" className="min-w-0 flex-1 break-all rounded-lg border border-border bg-background p-2 font-mono">
              {preview.preview_url}
            </code>
            <CopyButton value={preview.preview_url} data-testid="ck-preview-url-copy" />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('previews.invitationUrl')}</dt>
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
          {t('previews.dismiss')}
        </Button>
      </div>
    </Alert>
  )
}

export function PreviewsCard({ site }: { site: string }) {
  const { t } = useI18n()
  const can = useCan()
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<Preview | null>(null)

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <CardTitle>{t('previews.title')}</CardTitle>
            {/* The second sentence is a pointer to another part of the page, not
                something to read before acting — so it waits behind the
                affordance instead of sitting under the heading. */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  data-testid="ck-previews-about"
                  aria-label={t('previews.aboutLabel')}
                >
                  <InfoIcon />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" data-testid="ck-previews-about-content">
                <PopoverTitle>{t('previews.aboutTitle')}</PopoverTitle>
                <PopoverDescription>{t('previews.aboutDescription')}</PopoverDescription>
              </PopoverContent>
            </Popover>
          </div>
          <CardDescription>{t('previews.description')}</CardDescription>
        </div>
        {can('release:preview') || can('release:write') ? (
          <Button size="sm" variant="outline" data-testid="ck-preview-new" onClick={() => setCreating(true)}>
            {t('previews.new')}
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
