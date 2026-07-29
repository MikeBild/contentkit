import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ck, type AccessGroup, type AccessUser, type ReaderInput } from '@/api/ck'
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
import { EntityMultiSelect, RevealOnce, SecretField, SwitchField, TextField, UsernameField } from '@/forms/fields'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'

/**
 * Readers are the only credential the console can mint for someone else, so the
 * password is generated rather than invented: an operator asked for one under
 * time pressure types the site name, and that reader is then the weakest point
 * of every access rule pointing at them.
 */
function generatePassword() {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint32Array(24))
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join('')
}

interface Draft {
  username: string
  password: string
  display_name: string
  active: boolean
  groups: string[]
}

function draftFrom(reader: AccessUser | undefined): Draft {
  return {
    username: reader?.username ?? '',
    // Never pre-filled, on purpose: the stored value is a hash and there is
    // nothing to show. An empty box on an edit form means "leave it alone".
    password: '',
    display_name: reader?.display_name ?? '',
    active: reader?.active ?? true,
    groups: [...(reader?.groups ?? [])],
  }
}

function ReaderDialog({
  site,
  reader,
  groups,
  groupsQuery,
  onClose,
}: {
  site: string
  /** Absent for a new reader; present makes username immutable. */
  reader?: AccessUser
  groups: AccessGroup[]
  groupsQuery: { isPending: boolean; error: unknown }
  onClose: () => void
}) {
  const client = useQueryClient()
  const [draft, setDraft] = useState(() => draftFrom(reader))
  // What "Generate" produced, if anything. A password the operator typed they
  // already have; one the console invented exists nowhere else until it is read.
  const [generated, setGenerated] = useState<string | null>(null)
  const [issued, setIssued] = useState<string | null>(null)
  const editing = Boolean(reader)

  const save = useMutation({
    mutationFn: async () => {
      const input: ReaderInput = {
        display_name: draft.display_name,
        active: draft.active,
        groups: draft.groups,
        ...(draft.password ? { password: draft.password } : {}),
      }
      return reader
        ? ck.access.updateUser(site, reader.id, input)
        : ck.access.createUser(site, { ...input, username: draft.username, password: draft.password })
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.access.users(site) })
      // A generated password is the one thing the server will not hand back, so
      // the dialog stays open until it has been read. Anything the operator
      // typed themselves they already hold.
      if (generated && generated === draft.password) {
        setIssued(generated)
        return
      }
      onClose()
    },
  })

  const canSave =
    !save.isPending &&
    !issued &&
    Boolean(draft.username) &&
    (editing || draft.password.length > 0) &&
    (draft.password.length === 0 || draft.password.length >= 16)

  // Both of these end every session this reader holds — the server revokes on a
  // password change and on a deactivation, and an operator who does not know
  // that reads the sudden sign-out as a bug.
  const revokes = editing && (draft.password.length > 0 || (reader?.active === true && !draft.active))

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      busy={save.isPending}
      data-testid="ck-reader-dialog"
      title={editing ? `Edit ${reader?.username}` : 'New reader'}
      description={
        editing
          ? 'A reader signs in to the published site. The username cannot be changed after creation.'
          : 'A reader signs in to the published site with this username and password.'
      }
      footer={
        <DialogActions>
          <Button variant="outline" data-testid="ck-reader-cancel" disabled={save.isPending} onClick={onClose}>
            {issued ? 'Done' : 'Cancel'}
          </Button>
          <Button data-testid="ck-reader-submit" disabled={!canSave} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : editing ? 'Save reader' : 'Create reader'}
          </Button>
        </DialogActions>
      }
    >
      <div className="space-y-4">
        {issued ? (
          <RevealOnce
            data-testid="ck-reader-password-issued"
            title="Hand this password over now"
            description="ContentKit stores only a hash of it. Nothing here or anywhere else can show it again."
            value={issued}
            onDismiss={() => {
              setIssued(null)
              onClose()
            }}
          />
        ) : null}

        {editing ? (
          <TextField
            data-testid="ck-reader-username"
            label="Username"
            value={draft.username}
            disabled
            help="Fixed at creation. Delete and recreate the reader to change it."
            onChange={() => {}}
          />
        ) : (
          <UsernameField
            data-testid="ck-reader-username"
            label="Username"
            required
            help="What the reader types on the site's sign-in form."
            value={draft.username}
            onChange={(username) => setDraft({ ...draft, username })}
          />
        )}

        <TextField
          data-testid="ck-reader-display-name"
          label="Display name"
          value={draft.display_name}
          fallback="Empty falls back to the username."
          onChange={(display_name) => setDraft({ ...draft, display_name })}
        />

        <SecretField
          data-testid="ck-reader-password"
          label="Password"
          required={!editing}
          help={editing ? 'Leave empty to keep the current password.' : undefined}
          value={draft.password}
          generate={() => {
            const password = generatePassword()
            setGenerated(password)
            return password
          }}
          onChange={(password) => setDraft({ ...draft, password })}
        />

        <SwitchField
          data-testid="ck-reader-active"
          label="Active"
          value={draft.active}
          onLabel="Can sign in"
          offLabel="Blocked from signing in"
          onChange={(active) => setDraft({ ...draft, active })}
        />

        <EntityMultiSelect
          data-testid="ck-reader-groups"
          label="Groups"
          help="Rules grant access to groups. A reader in no group is only reachable by a rule naming them directly."
          value={draft.groups}
          isLoading={groupsQuery.isPending}
          optionsError={groupsQuery.error}
          emptyMessage="No groups on this site yet"
          options={groups.map((group) => ({ value: group.slug, label: group.name, hint: group.slug }))}
          onChange={(groups) => setDraft({ ...draft, groups: [...groups] })}
        />

        {revokes ? (
          <p data-testid="ck-reader-revoke-warning" className="rounded-lg border border-chart-3/30 bg-chart-3/10 p-3 text-xs text-chart-3">
            Saving this revokes every session <strong>{reader?.username}</strong> currently holds. They are signed out
            of the published site immediately and must sign in again.
          </p>
        ) : null}

        {save.error ? (
          <p data-testid="ck-reader-error" className="text-sm text-chart-5">
            {save.error instanceof Error ? save.error.message : 'Could not save the reader'}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}

export function ReadersCard({ site }: { site: string }) {
  const can = useCan()
  const client = useQueryClient()
  const [editing, setEditing] = useState<{ reader?: AccessUser } | null>(null)

  const readers = useQuery({
    queryKey: keys.access.users(site),
    queryFn: () => ck.access.users(site),
    enabled: Boolean(site),
  })
  const groups = useQuery({
    queryKey: keys.access.groups(site),
    queryFn: () => ck.access.groups(site),
    enabled: Boolean(site),
  })

  const rows = readers.data ?? []
  const writable = can('site:admin')
  const invalidate = () => client.invalidateQueries({ queryKey: keys.access.users(site) })

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Readers</CardTitle>
        {writable ? (
          <Button size="sm" variant="outline" data-testid="ck-reader-new" onClick={() => setEditing({})}>
            New reader
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <THead>
            <TR>
              <TH>Username</TH>
              <TH>Display name</TH>
              <TH>Active</TH>
              <TH>Groups</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            <TableState
              columns={5}
              isLoading={readers.isPending}
              error={readers.error}
              isEmpty={rows.length === 0}
              onRetry={() => readers.refetch()}
              emptyMessage="No readers. The site is public unless a rule says otherwise."
            >
              {rows.map((reader) => (
                <TR key={reader.id} data-testid="ck-reader-row" data-user={reader.id}>
                  <TD className="font-medium">{reader.username}</TD>
                  <TD className="text-muted-foreground">{reader.display_name}</TD>
                  <TD>{reader.active ? <Badge tone="success">active</Badge> : <Badge>disabled</Badge>}</TD>
                  <TD className="text-muted-foreground">{reader.groups?.join(', ') || '—'}</TD>
                  <TD className="flex gap-2">
                    {writable ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`ck-reader-edit-${reader.id}`}
                          onClick={() => setEditing({ reader })}
                        >
                          Edit
                        </Button>
                        <Confirm
                          title="Sign this reader out everywhere?"
                          description={
                            <>
                              Every active session of <strong>{reader.username}</strong> is revoked immediately. The
                              account, its password and its groups are untouched.
                            </>
                          }
                          confirmLabel="Revoke sessions"
                          onConfirm={() => ck.access.revokeSessions(site, reader.id)}
                        >
                          {(open) => (
                            <Button
                              size="sm"
                              variant="ghost"
                              data-testid={`ck-reader-revoke-${reader.id}`}
                              onClick={open}
                            >
                              Revoke sessions
                            </Button>
                          )}
                        </Confirm>
                        <Confirm
                          title="Delete this reader?"
                          description={
                            <>
                              The reader <strong>{reader.username}</strong> ({reader.display_name}) is deleted together
                              with every session they hold, and removed from{' '}
                              {reader.groups?.length ? `the groups ${reader.groups.join(', ')}` : 'every group'}. Any
                              rule naming them directly loses that grant on the next release. This cannot be undone.
                            </>
                          }
                          confirmLabel="Delete reader"
                          destructive
                          onConfirm={async () => {
                            await ck.access.deleteUser(site, reader.id)
                            await invalidate()
                          }}
                        >
                          {(open) => (
                            <Button
                              size="sm"
                              variant="ghost"
                              data-testid={`ck-reader-delete-${reader.id}`}
                              onClick={open}
                            >
                              Delete
                            </Button>
                          )}
                        </Confirm>
                      </>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TableState>
          </TBody>
        </Table>
      </CardContent>

      {editing ? (
        <ReaderDialog
          // A different target is a different dialog. Without the key React
          // reuses the instance when the operator opens "edit" while the create
          // dialog is still showing its one-time password: the draft, the
          // generated password and the issued-password panel all carry over, and
          // the edit form opens pre-filled with the wrong reader and a disabled
          // Save. The state is seeded from `reader` once, so remounting is the
          // only thing that re-seeds it.
          key={editing.reader?.id ?? 'new'}
          site={site}
          reader={editing.reader}
          groups={groups.data ?? []}
          groupsQuery={{ isPending: groups.isPending, error: groups.error }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  )
}
