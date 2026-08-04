import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { Fragment, useState } from 'react'
import { ck, type CreatedWebhookEndpoint, type WebhookEndpoint, type WebhookInput } from '@/api/ck'
import { Confirm } from '@/components/confirm'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  WEBHOOK_DELIVERY_STATUS,
  WEBHOOK_EVENT_TYPES,
  type WebhookDeliveryStatus,
} from '@/forms/contracts/enums.generated'
import { EnumMultiSelect, RevealOnce, TextField, TriToggle, UrlField } from '@/forms/fields'
import { StatusBadge } from '@/forms/status-badge'
import { TableState } from '@/forms/table-state'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { formatDate } from '@/lib/utils'

/**
 * "No filter" as a value a Select can hold. Radix spells *deselected* as the
 * empty string and refuses it as an item's value, so the "all of them" row needs
 * a name of its own; it is translated back at both edges and never reaches a
 * request.
 */
const ANY = '__ck_any__'


const EVENT_OPTIONS = WEBHOOK_EVENT_TYPES.map((value) => ({
  value,
  label: value.replace('contentkit.', ''),
}))

/** `disabled_at` is the stored truth; "active" is the reading of it. */
function isEnabled(endpoint: WebhookEndpoint) {
  return !endpoint.disabled_at
}

function EndpointDialog({
  site,
  endpoint,
  onIssued,
  onClose,
}: {
  site: string
  endpoint?: WebhookEndpoint
  onIssued: (secret: string, url: string) => void
  onClose: () => void
}) {
  const client = useQueryClient()
  const editing = Boolean(endpoint)
  const [url, setUrl] = useState(endpoint?.url ?? '')
  const [events, setEvents] = useState<string[]>([...(endpoint?.events ?? [])])
  const [description, setDescription] = useState(endpoint?.description ?? '')
  const [enabled, setEnabled] = useState<boolean | undefined>(endpoint ? isEnabled(endpoint) : true)

  const save = useMutation({
    // Tagged rather than returned bare: a created endpoint is assignable to an
    // updated one, so a union of the two collapses and takes `secret` with it.
    mutationFn: async (): Promise<{ created: CreatedWebhookEndpoint } | { updated: WebhookEndpoint }> => {
      const input: WebhookInput = { url, events, description, ...(enabled === undefined ? {} : { enabled }) }
      return endpoint
        ? { updated: await ck.webhooks.update(site, endpoint.id, input) }
        : { created: await ck.webhooks.create(site, input) }
    },
    onSuccess: async (saved) => {
      await client.invalidateQueries({ queryKey: keys.webhooks.list(site) })
      // Creation is the only moment the signing secret exists outside the
      // database. Closing without surfacing it leaves an endpoint nobody can
      // verify the signatures of.
      if ('created' in saved) onIssued(saved.created.secret, saved.created.url)
      onClose()
    },
  })

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Creating an endpoint is the only moment its signing secret exists
        // outside the database, and `onIssued` is what surfaces it. A dismissal
        // mid-flight would leave an endpoint nobody can verify deliveries from.
        if (save.isPending) return
        if (!next) onClose()
      }}
    >
      <DialogContent
        data-testid="ck-webhook-dialog"
        className="sm:max-w-2xl"
        closeDisabled={save.isPending}
        onEscapeKeyDown={(event) => {
          if (save.isPending) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (save.isPending) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit endpoint' : 'New webhook endpoint'}</DialogTitle>
          <DialogDescription>
            ContentKit signs every delivery with Standard Webhooks headers. The receiver must be reachable over https.
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-thin flex flex-col gap-4 overflow-y-auto">
          <UrlField
            data-testid="ck-webhook-url"
            label="URL"
            required
            protocols={['https:']}
            help="Where deliveries are POSTed."
            about="Private and loopback addresses are refused."
            value={url}
            onChange={setUrl}
          />

          <EnumMultiSelect
            data-testid="ck-webhook-events"
            label="Events"
            help="Which events reach this endpoint."
            value={events}
            options={EVENT_OPTIONS}
            allEmptyMeans={{ allLabel: 'All events', someLabel: 'Only these events' }}
            onChange={(next) => setEvents([...next])}
          />

          <TextField
            data-testid="ck-webhook-description"
            label="Description"
            value={description}
            fallback="Only a label for this list."
            onChange={setDescription}
          />

          <TriToggle
            data-testid="ck-webhook-enabled"
            label="Enabled"
            help="Re-enabling also clears the consecutive-failure counter that auto-paused it."
            defaultLabel="its stored state"
            value={enabled}
            onChange={setEnabled}
          />

          {save.error ? (
            <Alert variant="destructive" data-testid="ck-webhook-error">
              <TriangleAlert />
              <AlertTitle>The endpoint was not saved</AlertTitle>
              <AlertDescription>
                {save.error instanceof Error ? save.error.message : 'Could not save the endpoint'}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" data-testid="ck-webhook-cancel" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button data-testid="ck-webhook-submit" disabled={save.isPending || !url} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner data-icon="inline-start" /> : null}
            {editing ? 'Save endpoint' : 'Create endpoint'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function WebhookEndpointsCard({ site }: { site: string }) {
  const can = useCan()
  const client = useQueryClient()
  const [editing, setEditing] = useState<{ endpoint?: WebhookEndpoint } | null>(null)
  const [issued, setIssued] = useState<{ secret: string; url: string } | null>(null)

  const endpoints = useQuery({
    queryKey: keys.webhooks.list(site),
    queryFn: () => ck.webhooks.list(site),
    enabled: Boolean(site),
  })

  const rows = endpoints.data ?? []
  const writable = can('site:admin')

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Endpoints</CardTitle>
        {writable ? (
          <Button size="sm" variant="outline" data-testid="ck-webhook-new" onClick={() => setEditing({})}>
            New endpoint
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-0">
        {issued ? (
          <div className="px-5 pt-3">
            <RevealOnce
              data-testid="ck-webhook-secret-issued"
              title="Store this signing secret now"
              description={`It verifies every delivery to ${issued.url}. ContentKit keeps it encrypted and will not show it again — rotating produces a different one.`}
              value={issued.secret}
              onDismiss={() => setIssued(null)}
            />
          </div>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>URL</TableHead>
              <TableHead>Events</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>State</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState
              columns={5}
              isLoading={endpoints.isPending}
              error={endpoints.error}
              isEmpty={rows.length === 0}
              onRetry={() => endpoints.refetch()}
              emptyTitle="No endpoints yet"
              emptyMessage="Content events are recorded either way, they just go nowhere."
            >
              {rows.map((endpoint) => (
                <TableRow key={endpoint.id} data-testid="ck-webhook-row" data-endpoint={endpoint.id}>
                  <TableCell className="max-w-[22rem] truncate font-mono text-xs">{endpoint.url}</TableCell>
                  <TableCell className="max-w-[16rem] text-xs text-muted-foreground">
                    {endpoint.events?.length ? endpoint.events.join(', ') : 'all events'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{endpoint.description || '—'}</TableCell>
                  <TableCell>
                    {isEnabled(endpoint) ? (
                      <StatusBadge tone="success">active</StatusBadge>
                    ) : (
                      <StatusBadge tone="warning">paused {formatDate(endpoint.disabled_at)}</StatusBadge>
                    )}
                    {endpoint.consecutive_failures ? (
                      <span className="ml-2 text-xs text-destructive">{endpoint.consecutive_failures} failures in a row</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="flex gap-2">
                    {writable ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`ck-webhook-edit-${endpoint.id}`}
                          onClick={() => setEditing({ endpoint })}
                        >
                          Edit
                        </Button>
                        <Confirm
                          title="Rotate the signing secret?"
                          description={
                            <>
                              The current secret for <strong>{endpoint.url}</strong> stops being valid at once, and
                              every receiver still verifying with it starts rejecting deliveries. The replacement is
                              shown here once — copy it before dismissing.
                            </>
                          }
                          confirmLabel="Rotate secret"
                          destructive
                          onConfirm={async () => {
                            const rotated = await ck.webhooks.rotate(site, endpoint.id)
                            setIssued({ secret: rotated.secret, url: endpoint.url })
                          }}
                        >
                          {(open) => (
                            <Button
                              size="sm"
                              variant="destructive"
                              data-testid={`ck-webhook-rotate-${endpoint.id}`}
                              onClick={open}
                            >
                              Rotate secret
                            </Button>
                          )}
                        </Confirm>
                        <Confirm
                          title="Delete this endpoint?"
                          description={
                            <>
                              No further events are delivered to <strong>{endpoint.url}</strong>, and its signing secret
                              is destroyed with it. Its delivery history stays readable. This cannot be undone.
                            </>
                          }
                          confirmLabel="Delete endpoint"
                          destructive
                          onConfirm={async () => {
                            await ck.webhooks.remove(site, endpoint.id)
                            await client.invalidateQueries({ queryKey: keys.webhooks.list(site) })
                          }}
                        >
                          {(open) => (
                            <Button
                              size="sm"
                              variant="destructive"
                              data-testid={`ck-webhook-delete-${endpoint.id}`}
                              onClick={open}
                            >
                              Delete
                            </Button>
                          )}
                        </Confirm>
                      </>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableState>
          </TableBody>
        </Table>
      </CardContent>

      {editing ? (
        <EndpointDialog
          site={site}
          endpoint={editing.endpoint}
          onIssued={(secret, url) => setIssued({ secret, url })}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  )
}

// ── Deliveries ───────────────────────────────────────────────────────────────

const DELIVERY_TONE: Record<WebhookDeliveryStatus, 'success' | 'danger' | 'warning'> = {
  delivered: 'success',
  failed: 'danger',
  pending: 'warning',
}

const LIMITS = [25, 50, 100, 200]

export function WebhookDeliveriesCard({ site, siteId }: { site: string; siteId: string }) {
  const [endpoint, setEndpoint] = useState('')
  const [status, setStatus] = useState<WebhookDeliveryStatus | ''>('')
  const [limit, setLimit] = useState(50)
  const [expanded, setExpanded] = useState<string | null>(null)

  const endpoints = useQuery({
    queryKey: keys.webhooks.list(site),
    queryFn: () => ck.webhooks.list(site),
    enabled: Boolean(site),
  })

  const query = { ...(endpoint ? { endpoint } : {}), ...(status ? { status } : {}), limit }
  const deliveries = useQuery({
    queryKey: keys.webhooks.deliveries(siteId, query),
    queryFn: () => ck.webhooks.deliveries(siteId, query),
    enabled: Boolean(siteId),
  })

  const rows = deliveries.data ?? []
  const endpointRows = endpoints.data ?? []

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Deliveries</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Select value={endpoint || ANY} onValueChange={(next) => setEndpoint(next === ANY ? '' : next)}>
            <SelectTrigger
              data-testid="ck-delivery-endpoint-filter"
              aria-label="Filter deliveries by endpoint"
              className="w-56"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ANY} data-testid="ck-delivery-endpoint-filter-any">
                  All endpoints
                </SelectItem>
                {endpointRows.map((row) => (
                  <SelectItem key={row.id} value={row.id} data-testid={`ck-delivery-endpoint-filter-${row.id}`}>
                    {row.description || row.url}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={status || ANY}
            onValueChange={(next) => setStatus(next === ANY ? '' : (next as WebhookDeliveryStatus))}
          >
            <SelectTrigger
              data-testid="ck-delivery-status-filter"
              aria-label="Filter deliveries by status"
              className="w-40"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ANY} data-testid="ck-delivery-status-filter-any">
                  All statuses
                </SelectItem>
                {WEBHOOK_DELIVERY_STATUS.map((value) => (
                  <SelectItem key={value} value={value} data-testid={`ck-delivery-status-filter-${value}`}>
                    {value}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={String(limit)} onValueChange={(next) => setLimit(Number(next))}>
            <SelectTrigger
              data-testid="ck-delivery-limit-filter"
              aria-label="Number of deliveries to load"
              className="w-32"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {LIMITS.map((value) => (
                  <SelectItem key={value} value={String(value)} data-testid={`ck-delivery-limit-filter-${value}`}>
                    Last {value}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Response</TableHead>
              <TableHead>Created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState
              columns={7}
              isLoading={deliveries.isPending}
              error={deliveries.error}
              isEmpty={rows.length === 0}
              onRetry={() => deliveries.refetch()}
              emptyTitle={endpoint || status ? 'Nothing matches these filters' : 'No deliveries yet'}
              emptyMessage={
                endpoint || status
                  ? 'Widen the endpoint or the status to see more.'
                  : 'Nothing has been sent to an endpoint yet.'
              }
            >
              {rows.map((delivery) => {
                const open = expanded === delivery.id
                const target = endpointRows.find((row) => row.id === delivery.endpoint_id)
                return (
                  <Fragment key={delivery.id}>
                    <TableRow data-testid="ck-delivery-row" data-delivery={delivery.id}>
                      <TableCell className="font-mono text-xs">{delivery.type}</TableCell>
                      <TableCell className="max-w-[16rem] truncate text-xs text-muted-foreground">
                        {/* A null endpoint_id is the legacy env-configured target. */}
                        {target?.url ?? (delivery.endpoint_id ? delivery.endpoint_id.slice(0, 8) : 'configured default')}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={DELIVERY_TONE[delivery.status]}>{delivery.status}</StatusBadge>
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{delivery.attempts}</TableCell>
                      <TableCell className="text-muted-foreground">{delivery.response_status ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(delivery.created_at)}</TableCell>
                      <TableCell className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={open}
                          data-testid={`ck-delivery-expand-${delivery.id}`}
                          onClick={() => setExpanded(open ? null : delivery.id)}
                        >
                          {open ? 'Hide' : 'Details'}
                        </Button>
                        {/* Re-queueing a delivered event would send it twice; only
                            a failure is safe to retry by hand. */}
                        {delivery.status === 'failed' ? (
                          <Confirm
                            title="Redeliver this event?"
                            description={
                              <>
                                <strong>{delivery.type}</strong> is queued for another attempt at{' '}
                                {target?.url ?? 'its endpoint'}. The receiver sees it as a repeat of the same event id.
                              </>
                            }
                            confirmLabel="Retry"
                            onConfirm={async () => {
                              await ck.webhooks.retry(delivery.id)
                              await deliveries.refetch()
                            }}
                          >
                            {(openDialog) => (
                              <Button
                                size="sm"
                                variant="outline"
                                data-testid={`ck-delivery-retry-${delivery.id}`}
                                onClick={openDialog}
                              >
                                Retry
                              </Button>
                            )}
                          </Confirm>
                        ) : null}
                      </TableCell>
                    </TableRow>
                    {open ? (
                      <TableRow data-testid={`ck-delivery-detail-${delivery.id}`}>
                        <TableCell colSpan={7} className="bg-muted/40">
                          <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[10rem_1fr]">
                            <dt className="text-muted-foreground">Event id</dt>
                            <dd className="font-mono">{delivery.event_id}</dd>
                            <dt className="text-muted-foreground">Next attempt</dt>
                            <dd>{delivery.next_attempt_at ? formatDate(delivery.next_attempt_at) : '—'}</dd>
                            <dt className="text-muted-foreground">Delivered</dt>
                            <dd>{delivery.delivered_at ? formatDate(delivery.delivered_at) : '—'}</dd>
                            <dt className="text-muted-foreground">Response status</dt>
                            <dd>{delivery.response_status ?? '—'}</dd>
                            <dt className="text-muted-foreground">Last error</dt>
                            <dd className="whitespace-pre-wrap break-words text-destructive">
                              {delivery.last_error ?? '—'}
                            </dd>
                            <dt className="text-muted-foreground">Payload</dt>
                            <dd>
                              <PayloadFields payload={delivery.payload} />
                            </dd>
                          </dl>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                )
              })}
            </TableState>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

/**
 * The payload is an open map — the event decides what is in it — so it is shown
 * as a definition list rather than a JSON dump. Nested values are stringified
 * one level down, which is where every emitted event stops.
 */
function PayloadFields({ payload }: { payload: Record<string, unknown> | undefined }) {
  const entries = Object.entries(payload ?? {})
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <dl className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[8rem_1fr]">
      {entries.map(([key, value]) => (
        <Fragment key={key}>
          <dt className="font-mono text-muted-foreground">{key}</dt>
          <dd className="break-words font-mono">
            {value === null || value === undefined
              ? '—'
              : typeof value === 'object'
                ? Object.entries(value as Record<string, unknown>)
                    .map(([inner, nested]) => `${inner}=${String(nested)}`)
                    .join(' · ')
                : String(value)}
          </dd>
        </Fragment>
      ))}
    </dl>
  )
}
