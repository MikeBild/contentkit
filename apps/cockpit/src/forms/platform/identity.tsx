import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { InfoIcon, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { ck, type GrantInput, type IdentityGrant, type IdentityGrantConflict } from '@/api/ck'
import { ApiError } from '@/api/client'
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
import { OPERATOR_ROLE, type OperatorRole } from '@/forms/contracts/enums.generated'
import { ChoiceCards, EntityMultiSelect, EnumSelect, ScopePicker, TextField } from '@/forms/fields'
import { StatusBadge } from '@/forms/status-badge'
import { TableState } from '@/forms/table-state'
import { keys } from '@/lib/query'
import { useCan, useSession } from '@/lib/session'
import { useSite } from '@/lib/site'
import { visibleLabel } from '@/lib/opaque'
import { useI18n, type TranslationKey } from '@/lib/i18n-context'

const grantLabel = (grant: IdentityGrant | undefined, fallback: string) =>
  visibleLabel(grant?.display_name, grant?.email) ?? fallback

// Providers are configuration, not data: they change when the deployment does.
const PROVIDERS_KEY = ['identity-providers'] as const

const ROLE_CONSEQUENCE_KEYS: Record<OperatorRole, TranslationKey> = {
  reader: 'identity.role.reader',
  author: 'identity.role.author',
  admin: 'identity.role.admin',
}

/**
 * The 409 that means "this identity already has a grant". It carries the id of
 * the existing row, which is the difference between a dead end and one click:
 * the operator wanted access for this person, and the answer is to edit or
 * restore what is already there.
 */
function conflictOf(error: unknown): IdentityGrantConflict | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null
  const body = error.body as Partial<IdentityGrantConflict> | undefined
  return body?.error === 'identity_grant_exists' ? (body as IdentityGrantConflict) : null
}

interface Draft {
  provider_id: string
  subject: string
  email: string
  display_name: string
  /** role and product_scopes are mutually exclusive; this picks which one is sent. */
  authority: 'role' | 'scopes'
  role: OperatorRole
  product_scopes: string[]
  site_ids: string[]
}

function GrantDialog({
  grant,
  onConflict,
  onClose,
}: {
  grant?: IdentityGrant
  /** Hands the existing grant back to the card so it can open it instead. */
  onConflict: (conflict: IdentityGrantConflict) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const client = useQueryClient()
  const session = useSession()
  const { sites } = useSite()
  const editing = Boolean(grant)
  const restoring = Boolean(grant?.revoked_at)

  const providers = useQuery({ queryKey: PROVIDERS_KEY, queryFn: () => ck.credentials.providers(), staleTime: 300_000 })
  // Only a real identity provider can back a grant. The built-in `api_key`
  // provider is how a key authenticates, not an identity anyone can be granted.
  const options = (providers.data ?? []).filter((provider) => provider.protocol === 'oidc')

  const [draft, setDraft] = useState<Draft>(() => ({
    provider_id: grant?.provider_id ?? '',
    subject: grant?.subject ?? '',
    email: grant?.email ?? '',
    display_name: grant?.display_name ?? '',
    authority: 'scopes',
    role: (grant?.role as OperatorRole) ?? 'author',
    product_scopes: [...(grant?.product_scopes ?? [])],
    site_ids: [...(grant?.site_ids ?? [])],
  }))

  const issuer = options.find((provider) => provider.id === draft.provider_id)?.issuer ?? ''

  const save = useMutation({
    mutationFn: () => {
      const authority: GrantInput =
        draft.authority === 'role' ? { role: draft.role } : { product_scopes: draft.product_scopes }
      const input: GrantInput = {
        email: draft.email || undefined,
        display_name: draft.display_name || undefined,
        site_ids: draft.site_ids,
        ...authority,
      }
      return grant
        ? ck.credentials.updateGrant(grant.id, { ...input, ...(restoring ? { restore: true } : {}) })
        : ck.credentials.createGrant({
            ...input,
            provider_id: draft.provider_id,
            // The server compares this against the configured provider and
            // answers 422 on a mismatch, so it is never typed by hand.
            issuer,
            subject: draft.subject,
          })
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.credentials.grants })
      onClose()
    },
    onError: (error) => {
      const conflict = conflictOf(error)
      if (conflict?.id) onConflict(conflict)
    },
  })

  const conflict = conflictOf(save.error)
  const canSave =
    !save.isPending &&
    (editing || (Boolean(draft.provider_id) && Boolean(draft.subject))) &&
    (draft.authority === 'role' || draft.product_scopes.length > 0)

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // A scope ceiling takes effect on the next request, so a save that is
        // in the air is already changing what the holder can do. Nothing
        // dismisses this until the server has said what it stored.
        if (save.isPending) return
        if (!next) onClose()
      }}
    >
      <DialogContent
        data-testid="ck-grant-dialog"
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
          <DialogTitle>
            {editing
              ? t('identity.editGrant', { identity: grantLabel(grant, t('identity.grant')) })
              : t('identity.newGrant')}
          </DialogTitle>
          <DialogDescription>{t('identity.grantDescription')}</DialogDescription>
        </DialogHeader>
        <div className="scrollbar-thin flex flex-col gap-4 overflow-y-auto">
          {restoring ? (
            <Alert data-testid="ck-grant-restore-note">
              <TriangleAlert />
              <AlertTitle>{t('identity.revokedTitle')}</AlertTitle>
              <AlertDescription>{t('identity.revokedDescription')}</AlertDescription>
            </Alert>
          ) : null}

          {editing ? (
            <TextField
              data-testid="ck-grant-subject"
              label={t('identity.identity')}
              value={grantLabel(grant, t('identity.grant'))}
              disabled
              help={t('identity.identityHelp')}
              about={t('identity.identityAbout')}
              onChange={() => {}}
            />
          ) : (
            <>
              <EnumSelect
                data-testid="ck-grant-provider"
                label={t('identity.provider')}
                required
                help={t('identity.providerHelp')}
                value={draft.provider_id}
                placeholder={providers.isPending ? t('common.loading') : t('identity.chooseProvider')}
                options={options.map((provider) => ({
                  value: provider.id,
                  label: visibleLabel(provider.label) ?? t('common.unknown'),
                }))}
                error={
                  providers.error
                    ? t('identity.providerLoadError')
                    : !providers.isPending && options.length === 0
                      ? t('identity.noProvider')
                      : undefined
                }
                onChange={(provider_id) => setDraft({ ...draft, provider_id })}
              />

              <TextField
                data-testid="ck-grant-issuer"
                label={t('identity.issuer')}
                value={issuer}
                disabled
                help={t('identity.issuerHelp')}
                about={t('identity.issuerAbout')}
                onChange={() => {}}
              />

              <TextField
                data-testid="ck-grant-subject"
                label={t('identity.subject')}
                required
                help={t('identity.subjectHelp')}
                value={draft.subject}
                onChange={(subject) => setDraft({ ...draft, subject })}
              />
            </>
          )}

          <TextField
            data-testid="ck-grant-email"
            label={t('identity.email')}
            value={draft.email}
            fallback={t('identity.emailFallback')}
            about={t('identity.emailAbout')}
            onChange={(email) => setDraft({ ...draft, email })}
          />

          <TextField
            data-testid="ck-grant-display-name"
            label={t('identity.displayName')}
            value={draft.display_name}
            onChange={(display_name) => setDraft({ ...draft, display_name })}
          />

          <ChoiceCards
            data-testid="ck-grant-authority"
            label={t('identity.authority')}
            help={t('identity.authorityHelp')}
            value={draft.authority}
            options={[
              {
                value: 'scopes',
                label: t('identity.explicitScopes'),
                description: t('identity.explicitScopesDescription'),
              },
              {
                value: 'role',
                label: t('identity.namedRole'),
                description: t('identity.namedRoleDescription'),
              },
            ]}
            onChange={(authority) => setDraft({ ...draft, authority })}
          />

          {draft.authority === 'role' ? (
            <ChoiceCards
              data-testid="ck-grant-role"
              label={t('identity.role')}
              value={draft.role}
              options={OPERATOR_ROLE.map((role) => ({
                value: role,
                label: role,
                description: t(ROLE_CONSEQUENCE_KEYS[role]),
              }))}
              onChange={(role) => setDraft({ ...draft, role })}
            />
          ) : (
            <ScopePicker
              data-testid="ck-grant-scopes"
              label={t('identity.productScopes')}
              required
              help={t('identity.ceilingHelp')}
              about={t('identity.ceilingAbout')}
              value={draft.product_scopes}
              ceiling={session.product_scopes}
              onChange={(product_scopes) => setDraft({ ...draft, product_scopes })}
            />
          )}

          <EntityMultiSelect
            data-testid="ck-grant-sites"
            label={t('identity.sites')}
            definition={t('identity.sitesDefinition')}
            fallback={t('identity.sitesFallback')}
            value={draft.site_ids}
            options={sites.map((site) => ({ value: site.id, label: site.name, hint: site.slug }))}
            emptyMessage={t('identity.noSites')}
            onChange={(site_ids) => setDraft({ ...draft, site_ids: [...site_ids] })}
          />

          {conflict ? (
            <Alert data-testid="ck-grant-conflict">
              <TriangleAlert />
              <AlertTitle>{t('identity.conflictTitle')}</AlertTitle>
              <AlertDescription>
                {/* The server's own sentence: it already says whether the existing
                    grant needs editing or restoring, and paraphrasing it would only
                    add a second version to keep in step. */}
                {conflict.hint ?? t('identity.conflictFallback')}
              </AlertDescription>
            </Alert>
          ) : save.error ? (
            <Alert variant="destructive" data-testid="ck-grant-error">
              <TriangleAlert />
              <AlertTitle>{t('identity.saveErrorTitle')}</AlertTitle>
              <AlertDescription>
                {save.error instanceof Error ? save.error.message : t('identity.saveError')}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" data-testid="ck-grant-cancel" disabled={save.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button data-testid="ck-grant-submit" disabled={!canSave} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t(restoring ? 'identity.restoreGrant' : editing ? 'identity.saveGrant' : 'identity.createGrant')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function IdentityGrantsCard() {
  const { t, dateTime } = useI18n()
  const can = useCan()
  const client = useQueryClient()
  const { sites } = useSite()
  const [editing, setEditing] = useState<{ grant?: IdentityGrant } | null>(null)

  const grants = useQuery({
    queryKey: keys.credentials.grants,
    queryFn: () => ck.credentials.grants(),
    enabled: can('identity:admin'),
  })

  const rows = grants.data ?? []
  if (!can('identity:admin')) return null

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <CardTitle>{t('identity.grants')}</CardTitle>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  data-testid="ck-grants-about"
                  aria-label={t('identity.ceilingTimingLabel')}
                >
                  <InfoIcon />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" data-testid="ck-grants-about-content">
                <PopoverTitle>{t('identity.ceilingTimingTitle')}</PopoverTitle>
                <PopoverDescription>{t('identity.ceilingTimingDescription')}</PopoverDescription>
              </PopoverContent>
            </Popover>
          </div>
          <CardDescription>{t('identity.ceilingTruth')}</CardDescription>
        </div>
        <Button size="sm" variant="outline" data-testid="ck-grant-new" onClick={() => setEditing({})}>
          {t('identity.newGrantShort')}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table
          mobileLabels={[
            t('identity.subject'),
            t('identity.provider'),
            t('identity.role'),
            t('identity.ceiling'),
            t('identity.sites'),
            t('webhook.created'),
            '',
          ]}
        >
          <TableHeader>
            <TableRow>
              <TableHead>{t('identity.subject')}</TableHead>
              <TableHead>{t('identity.provider')}</TableHead>
              <TableHead>{t('identity.role')}</TableHead>
              <TableHead>{t('identity.ceiling')}</TableHead>
              <TableHead>{t('identity.sites')}</TableHead>
              <TableHead>{t('webhook.created')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState
              columns={7}
              isLoading={grants.isPending}
              error={grants.error}
              isEmpty={rows.length === 0}
              onRetry={() => grants.refetch()}
              emptyMessage={t('identity.empty')}
            >
              {rows.map((grant) => (
                <TableRow key={grant.id} data-testid="ck-grant-row" data-grant={grant.id}>
                  <TableCell>
                    <span className="font-medium">{grantLabel(grant, t('identity.grant'))}</span>
                    {grant.display_name && grant.email ? (
                      <span className="block text-xs text-muted-foreground">{grant.email}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {visibleLabel(grant.provider_id) ?? t('common.unknown')}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={grant.role === 'admin' ? 'warning' : 'info'}>{grant.role ?? '—'}</StatusBadge>
                  </TableCell>
                  <TableCell className="max-w-[18rem] text-xs text-muted-foreground">{grant.product_scopes?.join(', ')}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {grant.site_ids?.length
                      ? grant.site_ids.map((id) => sites.find((site) => site.id === id)?.slug ?? t('common.unknownSite')).join(', ')
                      : t('identity.everySite')}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {grant.created_at ? dateTime(grant.created_at) : '—'}
                  </TableCell>
                  <TableCell className="flex gap-2">
                    {grant.revoked_at ? (
                      <>
                        <StatusBadge tone="danger">{t('identity.revoked')}</StatusBadge>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`ck-grant-restore-${grant.id}`}
                          onClick={() => setEditing({ grant })}
                        >
                          {t('identity.restore')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`ck-grant-edit-${grant.id}`}
                          onClick={() => setEditing({ grant })}
                        >
                          {t('webhook.edit')}
                        </Button>
                        <Confirm
                          title={t('identity.revokeTitle')}
                          description={t('identity.revokeDescription', {
                            identity: grantLabel(grant, t('identity.grant')),
                          })}
                          confirmLabel={t('identity.revokeGrant')}
                          destructive
                          onConfirm={async () => {
                            await ck.credentials.revokeGrant(grant.id)
                            await client.invalidateQueries({ queryKey: keys.credentials.grants })
                          }}
                        >
                          {(open) => (
                            <Button size="sm" variant="destructive" data-testid={`ck-grant-revoke-${grant.id}`} onClick={open}>
                              {t('identity.revoke')}
                            </Button>
                          )}
                        </Confirm>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableState>
          </TableBody>
        </Table>
      </CardContent>

      {editing ? (
        <GrantDialog
          grant={editing.grant}
          onConflict={(conflict) => {
            const existing = rows.find((row) => row.id === conflict.id)
            if (existing) setEditing({ grant: existing })
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  )
}
