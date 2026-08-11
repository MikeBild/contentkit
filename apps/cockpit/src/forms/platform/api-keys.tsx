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
import { useI18n, type I18nValue } from '@/lib/i18n-context'

function CreateKeyDialog({ onIssued, onClose }: { onIssued: (raw: string) => void; onClose: () => void }) {
  const { t } = useI18n()
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
          <DialogTitle>{t('apiKey.new')}</DialogTitle>
          <DialogDescription>{t('apiKey.newDescription')}</DialogDescription>
        </DialogHeader>
        <div className="scrollbar-thin flex flex-col gap-4 overflow-y-auto">
          <TextField
            data-testid="ck-api-key-name"
            label={t('apiKey.name')}
            required
            maxLength={120}
            help={t('apiKey.nameHelp')}
            about={t('apiKey.nameAbout')}
            value={name}
            onChange={setName}
          />

          <ScopePicker
            data-testid="ck-api-key-scopes"
            label={t('apiKey.scopes')}
            required
            help={t('apiKey.scopesHelp')}
            about={t('apiKey.scopesAbout')}
            value={scopes}
            ceiling={session.product_scopes}
            onChange={setScopes}
          />

          <EntityMultiSelect
            data-testid="ck-api-key-sites"
            label={t('identity.sites')}
            required={mustScopeToSites}
            definition={t('identity.sitesDefinition')}
            fallback={
              mustScopeToSites
                ? t('apiKey.sitesRestricted')
                : t('apiKey.sitesAll')
            }
            value={siteIds}
            options={sites.map((site) => ({ value: site.id, label: site.name, hint: site.slug }))}
            emptyMessage={t('identity.noSites')}
            onChange={(next) => setSiteIds([...next])}
          />

          <DateTimeField
            data-testid="ck-api-key-expires"
            label={t('apiKey.expires')}
            help={t('apiKey.expiresHelp')}
            value={expiresAt}
            onChange={setExpiresAt}
          />

          {create.error ? (
            <Alert variant="destructive" data-testid="ck-api-key-error">
              <TriangleAlert />
              <AlertTitle>{t('apiKey.createErrorTitle')}</AlertTitle>
              <AlertDescription>
                {create.error instanceof Error ? create.error.message : t('apiKey.createError')}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" data-testid="ck-api-key-cancel" disabled={create.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button data-testid="ck-api-key-submit" disabled={!canCreate} onClick={() => create.mutate()}>
            {create.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t('apiKey.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function keyState(key: ApiKey, t: I18nValue['t']): { tone: 'success' | 'danger' | 'warning'; label: string } {
  if (key.revoked_at) return { tone: 'danger', label: t('apiKey.revoked') }
  if (key.expires_at && new Date(key.expires_at).valueOf() < Date.now()) return { tone: 'warning', label: t('apiKey.expired') }
  return { tone: 'success', label: t('apiKey.active') }
}

export function ApiKeysCard() {
  const { t, dateTime } = useI18n()
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
            <CardTitle>{t('apiKey.keys')}</CardTitle>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  data-testid="ck-api-keys-about"
                  aria-label={t('apiKey.authorityLabel')}
                >
                  <InfoIcon />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" data-testid="ck-api-keys-about-content">
                <PopoverTitle>{t('apiKey.authorityTitle')}</PopoverTitle>
                <PopoverDescription>{t('apiKey.authorityDescription')}</PopoverDescription>
              </PopoverContent>
            </Popover>
          </div>
          <CardDescription>{t('apiKey.noUpdate')}</CardDescription>
        </div>
        {writable ? (
          <Button size="sm" variant="outline" data-testid="ck-api-key-new" onClick={() => setCreating(true)}>
            {t('apiKey.newShort')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-0">
        {issued ? (
          <div className="px-5 pt-3">
            <RevealOnce
              data-testid="ck-api-key-issued"
              title={t('apiKey.copyNow')}
              description={t('apiKey.copyDescription')}
              value={issued}
              onDismiss={() => setIssued(null)}
            />
          </div>
        ) : null}
        <Table
          mobileLabels={[
            t('apiKey.name'),
            t('apiKey.prefix'),
            t('apiKey.scopes'),
            t('identity.sites'),
            t('apiKey.expires'),
            t('webhook.created'),
            t('apiKey.lastUsed'),
            '',
          ]}
        >
          <TableHeader>
            <TableRow>
              <TableHead>{t('apiKey.name')}</TableHead>
              <TableHead>{t('apiKey.prefix')}</TableHead>
              <TableHead>{t('apiKey.scopes')}</TableHead>
              <TableHead>{t('identity.sites')}</TableHead>
              <TableHead>{t('apiKey.expires')}</TableHead>
              <TableHead>{t('webhook.created')}</TableHead>
              <TableHead>{t('apiKey.lastUsed')}</TableHead>
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
              emptyMessage={t('apiKey.empty')}
            >
              {rows.map((key) => {
                const state = keyState(key, t)
                return (
                  <TableRow key={key.id} data-testid="ck-api-key-row" data-key={key.id}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{key.key_prefix}</TableCell>
                    <TableCell className="max-w-[18rem] text-xs text-muted-foreground">{key.scopes?.join(', ')}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {key.site_ids?.length
                        ? key.site_ids
                            .map((id) => sites.find((site) => site.id === id)?.slug ?? t('common.unknownSite'))
                            .join(', ')
                        : t('identity.everySite')}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {key.expires_at ? dateTime(key.expires_at) : t('apiKey.never')}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{dateTime(key.created_at)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {key.last_used_at ? dateTime(key.last_used_at) : '—'}
                    </TableCell>
                    <TableCell>
                      {key.revoked_at || !writable ? (
                        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                      ) : (
                        <Confirm
                          title={t('apiKey.revokeTitle')}
                          description={t('apiKey.revokeDescription', { name: key.name, prefix: key.key_prefix })}
                          confirmLabel={t('apiKey.revokeKey')}
                          destructive
                          onConfirm={async () => {
                            await ck.credentials.revokeApiKey(key.id)
                            await client.invalidateQueries({ queryKey: keys.credentials.apiKeys })
                          }}
                        >
                          {(open) => (
                            <Button size="sm" variant="destructive" data-testid={`ck-api-key-revoke-${key.id}`} onClick={open}>
                              {t('identity.revoke')}
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
