import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { InfoIcon, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { ck, type ApiKey } from '@/api/ck'
import { Confirm } from '@/components/confirm'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DateTimeField, EntityMultiSelect, RevealOnce, ScopePicker, TextField } from '@/forms/fields'
import { StatusBadge } from '@/forms/status-badge'
import { TableState } from '@/forms/table-state'
import { keys } from '@/lib/query'
import { useCan, useSession } from '@/lib/session'
import { useSite } from '@/lib/site'
import { formatDate } from '@/lib/utils'

function CreateKeyDialog({ onIssued, onClose }: { onIssued: (raw: string) => void; onClose: () => void }) {
  const client = useQueryClient()
  const session = useSession()
  const { sites } = useSite()
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(['content:read'])
  const [siteIds, setSiteIds] = useState<string[]>([])
  const [expiresAt, setExpiresAt] = useState<string | undefined>(undefined)

  const create = useMutation({
    mutationFn: () =>
      ck.credentials.createApiKey({
        name,
        scopes,
        // Both are omitted rather than sent empty: `site_ids: []` is what the
        // server stores for "every site", and an explicit empty array reads as
        // a restriction that is not one.
        ...(siteIds.length ? { site_ids: siteIds } : {}),
        ...(expiresAt ? { expires_at: expiresAt } : {}),
      }),
    onSuccess: async (created) => {
      await client.invalidateQueries({ queryKey: keys.credentials.apiKeys })
      onIssued(created.key)
      onClose()
    },
  })

  // The server refuses a key scoped wider than its own principal, so a
  // restricted operator must pick sites; offering "all sites" would be a 403.
  const mustScopeToSites = session.site_ids.length > 0
  const canCreate =
    !create.isPending && Boolean(name) && scopes.length > 0 && (!mustScopeToSites || siteIds.length > 0)

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // The key is being minted. Until the server answers there is nothing to
        // cancel and nothing to report, so no dismissal path is open.
        if (create.isPending) return
        if (!next) onClose()
      }}
    >
      <DialogContent
        data-testid="ck-api-key-dialog"
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
          <DialogTitle>New API key</DialogTitle>
          <DialogDescription>
            A key cannot be edited afterwards. Its scopes, sites and expiry are fixed at this moment.
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-thin flex flex-col gap-4 overflow-y-auto">
          <TextField
            data-testid="ck-api-key-name"
            label="Name"
            required
            maxLength={120}
            help="Who or what holds this key."
            about="It is the only label the audit trail can show."
            value={name}
            onChange={setName}
          />

          <ScopePicker
            data-testid="ck-api-key-scopes"
            label="Scopes"
            required
            help="What this key may do."
            about="`authorize()` has no hierarchy — every scope has to be granted explicitly."
            value={scopes}
            ceiling={session.product_scopes}
            onChange={setScopes}
          />

          <EntityMultiSelect
            data-testid="ck-api-key-sites"
            label="Sites"
            required={mustScopeToSites}
            definition="Which sites the key may reach."
            fallback={
              mustScopeToSites
                ? 'Your own access is restricted, so the key has to name at least one of your sites.'
                : 'Empty means every site — including sites created after this key.'
            }
            value={siteIds}
            options={sites.map((site) => ({ value: site.id, label: site.name, hint: site.slug }))}
            emptyMessage="No sites"
            onChange={(next) => setSiteIds([...next])}
          />

          <DateTimeField
            data-testid="ck-api-key-expires"
            label="Expires"
            help="After this instant the key stops working, with no further action."
            value={expiresAt}
            onChange={setExpiresAt}
          />

          {create.error ? (
            <Alert variant="destructive" data-testid="ck-api-key-error">
              <TriangleAlert />
              <AlertTitle>The key was not created</AlertTitle>
              <AlertDescription>
                {create.error instanceof Error ? create.error.message : 'Could not create the key'}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" data-testid="ck-api-key-cancel" disabled={create.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button data-testid="ck-api-key-submit" disabled={!canCreate} onClick={() => create.mutate()}>
            {create.isPending ? <Spinner data-icon="inline-start" /> : null}
            {create.isPending ? 'Creating…' : 'Create key'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function keyState(key: ApiKey): { tone: 'success' | 'danger' | 'warning'; label: string } {
  if (key.revoked_at) return { tone: 'danger', label: 'revoked' }
  if (key.expires_at && new Date(key.expires_at).valueOf() < Date.now()) return { tone: 'warning', label: 'expired' }
  return { tone: 'success', label: 'active' }
}

export function ApiKeysCard() {
  const can = useCan()
  const client = useQueryClient()
  const { sites } = useSite()
  const [creating, setCreating] = useState(false)
  const [issued, setIssued] = useState<string | null>(null)

  const apiKeys = useQuery({ queryKey: keys.credentials.apiKeys, queryFn: () => ck.credentials.apiKeys() })
  const rows = apiKeys.data ?? []
  const writable = can('api-key:admin') || can('site:admin')

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <CardTitle>API keys</CardTitle>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  data-testid="ck-api-keys-about"
                  aria-label="How a key's authority is changed"
                >
                  <InfoIcon />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" data-testid="ck-api-keys-about-content">
                <PopoverTitle>Keys are issued, never edited</PopoverTitle>
                <PopoverDescription>To change one, revoke it and issue a replacement.</PopoverDescription>
              </PopoverContent>
            </Popover>
          </div>
          <CardDescription>
            There is no update endpoint by design — a key's authority is fixed at issue.
          </CardDescription>
        </div>
        {writable ? (
          <Button size="sm" variant="outline" data-testid="ck-api-key-new" onClick={() => setCreating(true)}>
            New key
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-0">
        {issued ? (
          <div className="px-5 pt-3">
            <RevealOnce
              data-testid="ck-api-key-issued"
              title="Copy this key now"
              description="It is shown once and never again — ContentKit stores only a hash."
              value={issued}
              onDismiss={() => setIssued(null)}
            />
          </div>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Scopes</TableHead>
              <TableHead>Sites</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState
              columns={8}
              isLoading={apiKeys.isPending}
              error={apiKeys.error}
              isEmpty={rows.length === 0}
              onRetry={() => apiKeys.refetch()}
              emptyMessage="No API keys."
            >
              {rows.map((key) => {
                const state = keyState(key)
                return (
                  <TableRow key={key.id} data-testid="ck-api-key-row" data-key={key.id}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{key.key_prefix}</TableCell>
                    <TableCell className="max-w-[18rem] text-xs text-muted-foreground">{key.scopes?.join(', ')}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {key.site_ids?.length
                        ? key.site_ids
                            .map((id) => sites.find((site) => site.id === id)?.slug ?? id.slice(0, 8))
                            .join(', ')
                        : 'every site'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {key.expires_at ? formatDate(key.expires_at) : 'never'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(key.created_at)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(key.last_used_at)}</TableCell>
                    <TableCell>
                      {key.revoked_at || !writable ? (
                        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                      ) : (
                        <Confirm
                          title="Revoke this key?"
                          description={
                            <>
                              The key <strong>{key.name}</strong> ({key.key_prefix}…) stops working immediately, and
                              every OAuth token derived from it is invalidated with it. Anything using it starts
                              answering 401 at once. This cannot be undone.
                            </>
                          }
                          confirmLabel="Revoke key"
                          destructive
                          onConfirm={async () => {
                            await ck.credentials.revokeApiKey(key.id)
                            await client.invalidateQueries({ queryKey: keys.credentials.apiKeys })
                          }}
                        >
                          {(open) => (
                            <Button size="sm" variant="ghost" data-testid={`ck-api-key-revoke-${key.id}`} onClick={open}>
                              Revoke
                            </Button>
                          )}
                        </Confirm>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableState>
          </TableBody>
        </Table>
      </CardContent>

      {creating ? <CreateKeyDialog onIssued={setIssued} onClose={() => setCreating(false)} /> : null}
    </Card>
  )
}
