import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { ck, type AccessGroup, type AccessUser, type ReaderInput } from '@/api/ck'
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
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EntityMultiSelect, RevealOnce, SecretField, SwitchField, TextField, UsernameField } from '@/forms/fields'
import { StatusBadge } from '@/forms/status-badge'
import { TableState } from '@/forms/table-state'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { useI18n } from '@/lib/i18n-context'

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
  const { t } = useI18n()
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
      onOpenChange={(next) => {
        // A password change or a deactivation ends every session this reader
        // holds. Neither is undone by closing the box it was asked for in, so
        // the box stays until the server has answered.
        if (save.isPending) return
        if (!next) onClose()
      }}
    >
      <DialogContent
        data-testid="ck-reader-dialog"
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
              ? t('audience.readers.editTitle', { username: reader?.username ?? '' })
              : t('audience.readers.new')}
          </DialogTitle>
          <DialogDescription>
            {editing ? t('audience.readers.editDescription') : t('audience.readers.createDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-thin min-h-0 flex flex-col gap-4 overflow-y-auto">
          {issued ? (
            <RevealOnce
              data-testid="ck-reader-password-issued"
              title={t('audience.readers.passwordTitle')}
              description={t('audience.readers.passwordDescription')}
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
              label={t('audience.readers.username')}
              value={draft.username}
              disabled
              help={t('audience.readers.usernameFixedHelp')}
              about={t('audience.readers.usernameFixedAbout')}
              onChange={() => {}}
            />
          ) : (
            <UsernameField
              data-testid="ck-reader-username"
              label={t('audience.readers.username')}
              required
              help={t('audience.readers.usernameHelp')}
              value={draft.username}
              onChange={(username) => setDraft({ ...draft, username })}
            />
          )}

          <TextField
            data-testid="ck-reader-display-name"
            label={t('audience.readers.displayName')}
            value={draft.display_name}
            fallback={t('audience.readers.displayNameFallback')}
            onChange={(display_name) => setDraft({ ...draft, display_name })}
          />

          <SecretField
            data-testid="ck-reader-password"
            label={t('audience.readers.password')}
            required={!editing}
            help={editing ? t('audience.readers.passwordKeepHelp') : undefined}
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
            label={t('audience.readers.active')}
            value={draft.active}
            onLabel={t('audience.readers.canSignIn')}
            offLabel={t('audience.readers.cannotSignIn')}
            onChange={(active) => setDraft({ ...draft, active })}
          />

          <EntityMultiSelect
            data-testid="ck-reader-groups"
            label={t('audience.readers.groups')}
            help={t('audience.readers.groupsHelp')}
            about={t('audience.readers.groupsAbout')}
            value={draft.groups}
            isLoading={groupsQuery.isPending}
            optionsError={groupsQuery.error}
            emptyMessage={t('audience.readers.noGroups')}
            options={groups.map((group) => ({ value: group.slug, label: group.name, hint: group.slug }))}
            onChange={(groups) => setDraft({ ...draft, groups: [...groups] })}
          />

          {revokes ? (
            <Alert data-testid="ck-reader-revoke-warning">
              <TriangleAlert />
              <AlertTitle>{t('audience.readers.revokeWarning')}</AlertTitle>
              <AlertDescription>
                {t('audience.readers.revokeDescription', { username: reader?.username ?? '' })}
              </AlertDescription>
            </Alert>
          ) : null}

          {save.error ? (
            <Alert variant="destructive" data-testid="ck-reader-error">
              <TriangleAlert />
              <AlertTitle>{t('audience.readers.saveError')}</AlertTitle>
              <AlertDescription>
                {save.error instanceof Error ? save.error.message : t('audience.readers.saveErrorFallback')}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" data-testid="ck-reader-cancel" disabled={save.isPending} onClick={onClose}>
            {issued ? t('audience.readers.done') : t('common.cancel')}
          </Button>
          <Button data-testid="ck-reader-submit" disabled={!canSave} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner data-icon="inline-start" /> : null}
            {editing ? t('audience.readers.save') : t('audience.readers.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ReadersCard({ site }: { site: string }) {
  const { t } = useI18n()
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
        <CardTitle>{t('audience.readers.title')}</CardTitle>
        {writable ? (
          <Button size="sm" variant="outline" data-testid="ck-reader-new" onClick={() => setEditing({})}>
            {t('audience.readers.new')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <Table
          mobileLabels={[
            t('audience.readers.username'),
            t('audience.readers.displayName'),
            t('audience.readers.active'),
            t('audience.readers.groups'),
            '',
          ]}
        >
          <TableHeader>
            <TableRow>
              <TableHead>{t('audience.readers.username')}</TableHead>
              <TableHead>{t('audience.readers.displayName')}</TableHead>
              <TableHead>{t('audience.readers.active')}</TableHead>
              <TableHead>{t('audience.readers.groups')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState
              columns={5}
              isLoading={readers.isPending}
              error={readers.error}
              isEmpty={rows.length === 0}
              onRetry={() => readers.refetch()}
              emptyTitle={t('audience.readers.empty')}
              emptyMessage={t('audience.readers.emptyDescription')}
            >
              {rows.map((reader, readerIndex) => (
                <TableRow key={reader.id} data-testid={`ck-reader-row-${readerIndex}`} data-user={reader.id}>
                  <TableCell className="font-medium">{reader.username}</TableCell>
                  <TableCell className="text-muted-foreground">{reader.display_name}</TableCell>
                  <TableCell>
                    {reader.active ? (
                      <StatusBadge tone="success">{t('audience.readers.activeStatus')}</StatusBadge>
                    ) : (
                      <StatusBadge>{t('audience.readers.disabledStatus')}</StatusBadge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{reader.groups?.join(', ') || '—'}</TableCell>
                  <TableCell className="flex gap-2">
                    {writable ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`ck-reader-${readerIndex}-edit`}
                          onClick={() => setEditing({ reader })}
                        >
                          {t('audience.readers.edit')}
                        </Button>
                        <Confirm
                          title={t('audience.readers.revokeTitle')}
                          description={t('audience.readers.revokeConfirmDescription', {
                            username: reader.username,
                          })}
                          confirmLabel={t('audience.readers.revokeSessions')}
                          onConfirm={() => ck.access.revokeSessions(site, reader.id)}
                        >
                          {(open) => (
                            <Button
                              size="sm"
                              variant="ghost"
                              data-testid={`ck-reader-${readerIndex}-revoke`}
                              onClick={open}
                            >
                              {t('audience.readers.revokeSessions')}
                            </Button>
                          )}
                        </Confirm>
                        <Confirm
                          title={t('audience.readers.deleteTitle')}
                          description={t(
                            reader.groups?.length
                              ? 'audience.readers.deleteWithGroups'
                              : 'audience.readers.deleteWithoutGroups',
                            {
                              username: reader.username,
                              name: reader.display_name,
                              groups: reader.groups?.join(', ') ?? '',
                            },
                          )}
                          confirmLabel={t('audience.readers.delete')}
                          destructive
                          onConfirm={async () => {
                            await ck.access.deleteUser(site, reader.id)
                            await invalidate()
                          }}
                        >
                          {(open) => (
                            <Button
                              size="sm"
                              variant="destructive"
                              data-testid={`ck-reader-${readerIndex}-delete`}
                              onClick={open}
                            >
                              {t('audience.readers.delete')}
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
