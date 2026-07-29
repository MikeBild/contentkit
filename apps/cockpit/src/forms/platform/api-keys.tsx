import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ck, type ApiKey } from '@/api/ck'
import { Confirm } from '@/components/confirm'
import { Dialog, DialogActions } from '@/components/ui/dialog'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableState,
} from '@/components/ui/primitives'
import { DateTimeField, EntityMultiSelect, RevealOnce, ScopePicker, TextField } from '@/forms/fields'
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
      size="lg"
      onClose={onClose}
      busy={create.isPending}
      data-testid="ck-api-key-dialog"
      title="New API key"
      description="A key cannot be edited afterwards. Its scopes, sites and expiry are fixed at this moment."
      footer={
        <DialogActions>
          <Button variant="outline" data-testid="ck-api-key-cancel" disabled={create.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button data-testid="ck-api-key-submit" disabled={!canCreate} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create key'}
          </Button>
        </DialogActions>
      }
    >
      <div className="space-y-4">
        <TextField
          data-testid="ck-api-key-name"
          label="Name"
          required
          maxLength={120}
          help="Who or what holds this key. It is the only label the audit trail can show."
          value={name}
          onChange={setName}
        />

        <ScopePicker
          data-testid="ck-api-key-scopes"
          label="Scopes"
          required
          help="What this key may do. `authorize()` has no hierarchy — every scope has to be granted explicitly."
          value={scopes}
          ceiling={session.product_scopes}
          onChange={setScopes}
        />

        <EntityMultiSelect
          data-testid="ck-api-key-sites"
          label="Sites"
          required={mustScopeToSites}
          help="Which sites the key may reach."
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
          <p data-testid="ck-api-key-error" className="text-sm text-chart-5">
            {create.error instanceof Error ? create.error.message : 'Could not create the key'}
          </p>
        ) : null}
      </div>
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
        <div>
          <CardTitle>API keys</CardTitle>
          <p className="text-sm text-muted-foreground">
            There is no update endpoint by design — a key's authority is fixed at issue. To change one, revoke it and
            issue a replacement.
          </p>
        </div>
        {writable ? (
          <Button size="sm" variant="outline" data-testid="ck-api-key-new" onClick={() => setCreating(true)}>
            New key
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 p-0">
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
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Prefix</TH>
              <TH>Scopes</TH>
              <TH>Sites</TH>
              <TH>Expires</TH>
              <TH>Created</TH>
              <TH>Last used</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
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
                  <TR key={key.id} data-testid="ck-api-key-row" data-key={key.id}>
                    <TD className="font-medium">{key.name}</TD>
                    <TD className="font-mono text-xs text-muted-foreground">{key.key_prefix}</TD>
                    <TD className="max-w-[18rem] text-xs text-muted-foreground">{key.scopes?.join(', ')}</TD>
                    <TD className="text-xs text-muted-foreground">
                      {key.site_ids?.length
                        ? key.site_ids
                            .map((id) => sites.find((site) => site.id === id)?.slug ?? id.slice(0, 8))
                            .join(', ')
                        : 'every site'}
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {key.expires_at ? formatDate(key.expires_at) : 'never'}
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{formatDate(key.created_at)}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{formatDate(key.last_used_at)}</TD>
                    <TD>
                      {key.revoked_at || !writable ? (
                        <Badge tone={state.tone}>{state.label}</Badge>
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
                    </TD>
                  </TR>
                )
              })}
            </TableState>
          </TBody>
        </Table>
      </CardContent>

      {creating ? <CreateKeyDialog onIssued={setIssued} onClose={() => setCreating(false)} /> : null}
    </Card>
  )
}
