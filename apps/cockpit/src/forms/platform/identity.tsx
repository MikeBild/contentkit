import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { InfoIcon, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { ck, type GrantInput, type IdentityGrant, type IdentityGrantConflict } from '@/api/ck'
import { ApiError } from '@/api/client'
import { Confirm } from '@/components/confirm'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogActions } from '@/components/ui/dialog'
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
import { formatDate } from '@/lib/utils'

// Providers are configuration, not data: they change when the deployment does.
const PROVIDERS_KEY = ['identity-providers'] as const

const ROLE_CONSEQUENCE: Record<OperatorRole, string> = {
  reader: 'Published reads and bounded statistics.',
  author: 'Drafts, revisions, compositions, decks and previews.',
  admin: 'Every product scope, including issuing credentials and granting access.',
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
      size="lg"
      onClose={onClose}
      busy={save.isPending}
      data-testid="ck-grant-dialog"
      title={editing ? `Edit grant for ${grant?.email || grant?.subject}` : 'New identity grant'}
      description="A grant binds one provider subject to a product-scope ceiling. The ceiling is the only stored truth; shrinking it takes effect on the very next request."
      footer={
        <DialogActions>
          <Button variant="outline" data-testid="ck-grant-cancel" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button data-testid="ck-grant-submit" disabled={!canSave} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner data-icon="inline-start" /> : null}
            {save.isPending ? 'Saving…' : restoring ? 'Restore grant' : editing ? 'Save grant' : 'Create grant'}
          </Button>
        </DialogActions>
      }
    >
      <div className="flex flex-col gap-4">
        {restoring ? (
          <Alert data-testid="ck-grant-restore-note">
            <TriangleAlert />
            <AlertTitle>This grant is revoked</AlertTitle>
            <AlertDescription>
              Saving restores it — the only way to bring a revoked grant back. The holder can sign in again from the
              next request; the sessions and tokens revoked with it are not restored.
            </AlertDescription>
          </Alert>
        ) : null}

        {editing ? (
          <TextField
            data-testid="ck-grant-subject"
            label="Subject"
            value={`${grant?.provider_id ?? ''} · ${grant?.subject ?? ''}`}
            disabled
            help="The provider's immutable identifier for this person."
            about="It is what the grant is keyed on and cannot be changed."
            onChange={() => {}}
          />
        ) : (
          <>
            <EnumSelect
              data-testid="ck-grant-provider"
              label="Provider"
              required
              help="Only configured OIDC providers can back a grant."
              value={draft.provider_id}
              placeholder={providers.isPending ? 'Loading…' : 'Choose a provider'}
              options={options.map((provider) => ({ value: provider.id, label: `${provider.label} · ${provider.id}` }))}
              error={
                providers.error
                  ? 'Could not load the providers'
                  : !providers.isPending && options.length === 0
                    ? 'This deployment has no OIDC provider configured, so no grant can be created'
                    : undefined
              }
              onChange={(provider_id) => setDraft({ ...draft, provider_id })}
            />

            <TextField
              data-testid="ck-grant-issuer"
              label="Issuer"
              value={issuer}
              disabled
              help="Filled from the provider."
              about="The server rejects a grant whose issuer does not match it exactly."
              onChange={() => {}}
            />

            <TextField
              data-testid="ck-grant-subject"
              label="Subject"
              required
              help="The provider's stable identifier for this person — the `sub` claim, not their email."
              value={draft.subject}
              onChange={(subject) => setDraft({ ...draft, subject })}
            />
          </>
        )}

        <TextField
          data-testid="ck-grant-email"
          label="Email"
          value={draft.email}
          fallback="Only a label."
          about="Access is decided by the subject."
          onChange={(email) => setDraft({ ...draft, email })}
        />

        <TextField
          data-testid="ck-grant-display-name"
          label="Display name"
          value={draft.display_name}
          onChange={(display_name) => setDraft({ ...draft, display_name })}
        />

        <ChoiceCards
          data-testid="ck-grant-authority"
          label="Authority"
          help="The server accepts exactly one of the two."
          value={draft.authority}
          options={[
            {
              value: 'scopes',
              label: 'Explicit scopes',
              description: 'Pick each scope. What is stored is what you chose, unchanged by later role definitions.',
            },
            {
              value: 'role',
              label: 'Named role',
              description: 'A shorthand the server expands into a scope set once, at save time.',
            },
          ]}
          onChange={(authority) => setDraft({ ...draft, authority })}
        />

        {draft.authority === 'role' ? (
          <ChoiceCards
            data-testid="ck-grant-role"
            label="Role"
            value={draft.role}
            options={OPERATOR_ROLE.map((role) => ({ value: role, label: role, description: ROLE_CONSEQUENCE[role] }))}
            onChange={(role) => setDraft({ ...draft, role })}
          />
        ) : (
          <ScopePicker
            data-testid="ck-grant-scopes"
            label="Product scopes"
            required
            help="The ceiling."
            about="Nothing this identity does can exceed it, whatever token it holds."
            value={draft.product_scopes}
            ceiling={session.product_scopes}
            onChange={(product_scopes) => setDraft({ ...draft, product_scopes })}
          />
        )}

        <EntityMultiSelect
          data-testid="ck-grant-sites"
          label="Sites"
          definition="Which sites this identity may reach."
          fallback="Empty means every site."
          value={draft.site_ids}
          options={sites.map((site) => ({ value: site.id, label: site.name, hint: site.slug }))}
          emptyMessage="No sites"
          onChange={(site_ids) => setDraft({ ...draft, site_ids: [...site_ids] })}
        />

        {conflict ? (
          <Alert data-testid="ck-grant-conflict">
            <TriangleAlert />
            <AlertTitle>A grant for this subject already exists</AlertTitle>
            <AlertDescription>
              {/* The server's own sentence: it already says whether the existing
                  grant needs editing or restoring, and paraphrasing it would only
                  add a second version to keep in step. */}
              {conflict.hint ?? 'A grant for this subject already exists.'}
            </AlertDescription>
          </Alert>
        ) : save.error ? (
          <Alert variant="destructive" data-testid="ck-grant-error">
            <TriangleAlert />
            <AlertTitle>The grant was not saved</AlertTitle>
            <AlertDescription>
              {save.error instanceof Error ? save.error.message : 'Could not save the grant'}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </Dialog>
  )
}

export function IdentityGrantsCard() {
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
            <CardTitle>Identity grants</CardTitle>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  data-testid="ck-grants-about"
                  aria-label="When a change to the ceiling takes effect"
                >
                  <InfoIcon />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" data-testid="ck-grants-about-content">
                <PopoverTitle>Shrinking a ceiling is immediate</PopoverTitle>
                <PopoverDescription>
                  It takes effect on the very next request, without reissuing anything.
                </PopoverDescription>
              </PopoverContent>
            </Popover>
          </div>
          <CardDescription>The stored product-scope ceiling is the only truth.</CardDescription>
        </div>
        <Button size="sm" variant="outline" data-testid="ck-grant-new" onClick={() => setEditing({})}>
          New grant
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Ceiling</TableHead>
              <TableHead>Sites</TableHead>
              <TableHead>Created</TableHead>
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
              emptyMessage="No identity grants."
            >
              {rows.map((grant) => (
                <TableRow key={grant.id} data-testid="ck-grant-row" data-grant={grant.id}>
                  <TableCell>
                    <span className="font-medium">{grant.email || grant.subject}</span>
                    {grant.display_name ? (
                      <span className="block text-xs text-muted-foreground">{grant.display_name}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{grant.provider_id}</TableCell>
                  <TableCell>
                    <StatusBadge tone={grant.role === 'admin' ? 'warning' : 'info'}>{grant.role ?? '—'}</StatusBadge>
                  </TableCell>
                  <TableCell className="max-w-[18rem] text-xs text-muted-foreground">{grant.product_scopes?.join(', ')}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {grant.site_ids?.length
                      ? grant.site_ids.map((id) => sites.find((site) => site.id === id)?.slug ?? id.slice(0, 8)).join(', ')
                      : 'every site'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(grant.created_at)}</TableCell>
                  <TableCell className="flex gap-2">
                    {grant.revoked_at ? (
                      <>
                        <StatusBadge tone="danger">revoked</StatusBadge>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`ck-grant-restore-${grant.id}`}
                          onClick={() => setEditing({ grant })}
                        >
                          Restore
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
                          Edit
                        </Button>
                        <Confirm
                          title="Revoke this grant?"
                          description={
                            <>
                              <strong>{grant.email || grant.subject}</strong> loses access at once. Revoking cascades:
                              every operator session, every OAuth access token and every refresh token issued from this
                              grant is revoked with it. The grant row is kept and can be restored later.
                            </>
                          }
                          confirmLabel="Revoke grant"
                          destructive
                          onConfirm={async () => {
                            await ck.credentials.revokeGrant(grant.id)
                            await client.invalidateQueries({ queryKey: keys.credentials.grants })
                          }}
                        >
                          {(open) => (
                            <Button size="sm" variant="ghost" data-testid={`ck-grant-revoke-${grant.id}`} onClick={open}>
                              Revoke
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
