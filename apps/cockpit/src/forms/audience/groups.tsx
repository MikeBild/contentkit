import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { ck, type AccessGroup, type AccessRule, type AccessUser } from '@/api/ck'
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { EntityMultiSelect, SlugField, TextField } from '@/forms/fields'
import { StatusBadge } from '@/forms/status-badge'
import { TableState } from '@/forms/table-state'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'

/** Readers currently in the group. Membership is stored on the reader's side. */
function membersOf(group: AccessGroup, readers: AccessUser[]) {
  return readers.filter((reader) => reader.groups?.includes(group.slug))
}

function GroupDialog({
  site,
  group,
  siblings,
  onClose,
}: {
  site: string
  group?: AccessGroup
  siblings: readonly string[]
  onClose: () => void
}) {
  const client = useQueryClient()
  const [slug, setSlug] = useState(group?.slug ?? '')
  const [name, setName] = useState(group?.name ?? '')
  const editing = Boolean(group)

  const save = useMutation({
    mutationFn: () =>
      group ? ck.access.updateGroup(site, group.id, { name }) : ck.access.createGroup(site, { slug, name }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.access.groups(site) })
      onClose()
    },
  })

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // A group's slug is what every rule points at, and it is fixed once the
        // server has it. Nothing dismisses the box while that request is open.
        if (save.isPending) return
        if (!next) onClose()
      }}
    >
      <DialogContent
        data-testid="ck-group-dialog"
        className="sm:max-w-lg"
        closeDisabled={save.isPending}
        onEscapeKeyDown={(event) => {
          if (save.isPending) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (save.isPending) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${group?.slug}` : 'New group'}</DialogTitle>
          <DialogDescription>
            A group is what an access rule points at. Readers join it, rules grant it.
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-thin flex flex-col gap-4 overflow-y-auto">
          {editing ? (
            <TextField
              data-testid="ck-group-slug"
              label="Slug"
              value={slug}
              disabled
              help="Rules reference a group by its slug, so it is fixed once anything can point at it."
              onChange={() => {}}
            />
          ) : (
            <SlugField
              data-testid="ck-group-slug"
              label="Slug"
              required
              grammar="group"
              derivedFrom={name}
              siblings={siblings}
              help="How rules name this group."
              about="It cannot be changed afterwards."
              value={slug}
              onChange={setSlug}
            />
          )}

          <TextField
            data-testid="ck-group-name"
            label="Name"
            value={name}
            maxLength={120}
            fallback="Empty falls back to the slug."
            onChange={setName}
          />

          {save.error ? (
            <Alert variant="destructive" data-testid="ck-group-error">
              <TriangleAlert />
              <AlertTitle>The group was not saved</AlertTitle>
              <AlertDescription>
                {save.error instanceof Error ? save.error.message : 'Could not save the group'}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" data-testid="ck-group-cancel" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            data-testid="ck-group-submit"
            disabled={save.isPending || !slug || (!editing && siblings.includes(slug))}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Spinner data-icon="inline-start" /> : null}
            {save.isPending ? 'Saving…' : editing ? 'Save group' : 'Create group'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * PUT replaces the membership list wholesale, so the picker is seeded with the
 * complete current list rather than with an empty box. A delta UI over a
 * replace endpoint is how everyone who was already in the group gets dropped.
 */
function MembersDialog({
  site,
  group,
  readers,
  readersQuery,
  onClose,
}: {
  site: string
  group: AccessGroup
  readers: AccessUser[]
  readersQuery: { isPending: boolean; error: unknown }
  onClose: () => void
}) {
  const client = useQueryClient()
  const [selected, setSelected] = useState<string[]>(() => membersOf(group, readers).map((reader) => reader.id))

  const save = useMutation({
    mutationFn: () => ck.access.setGroupMembers(site, group.id, selected),
    onSuccess: async () => {
      // Membership shows up on the reader rows, so both lists are stale.
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.access.users(site) }),
        client.invalidateQueries({ queryKey: keys.access.groups(site) }),
      ])
      onClose()
    },
  })

  const before = membersOf(group, readers).map((reader) => reader.id)
  const removed = before.filter((id) => !selected.includes(id))

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // PUT replaces the membership wholesale. Half a replacement is not a
        // state anyone can read off the screen, so the dialog stays until the
        // server reports which list it now holds.
        if (save.isPending) return
        if (!next) onClose()
      }}
    >
      <DialogContent
        data-testid="ck-group-members-dialog"
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
          <DialogTitle>Members of {group.name}</DialogTitle>
          <DialogDescription>
            This list replaces the group's membership exactly as shown. Anyone taken out here loses the group.
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-thin flex flex-col gap-4 overflow-y-auto">
          <EntityMultiSelect
            data-testid="ck-group-members"
            label="Readers"
            help="Every reader in the group, including the ones who were already in it."
            value={selected}
            isLoading={readersQuery.isPending}
            optionsError={readersQuery.error}
            emptyMessage="No readers on this site yet"
            options={readers.map((reader) => ({
              value: reader.id,
              label: reader.display_name || reader.username,
              hint: reader.active ? reader.username : `${reader.username} · disabled`,
            }))}
            onChange={(next) => setSelected([...next])}
          />

          {/* A consequence of the value as it stands, which is what an Alert is
              for — the amber paragraph it replaces made the same claim in a colour
              and announced nothing. */}
          {removed.length ? (
            <Alert data-testid="ck-group-members-removed">
              <TriangleAlert />
              <AlertTitle>
                {removed.length} reader{removed.length === 1 ? '' : 's'} lose this group
              </AlertTitle>
              <AlertDescription>
                {readers
                  .filter((reader) => removed.includes(reader.id))
                  .map((reader) => reader.username)
                  .join(', ')}
                . Any rule granting only this group stops reaching them at the next release.
              </AlertDescription>
            </Alert>
          ) : null}

          {save.error ? (
            <Alert variant="destructive" data-testid="ck-group-members-error">
              <TriangleAlert />
              <AlertTitle>The membership was not replaced</AlertTitle>
              <AlertDescription>
                {save.error instanceof Error ? save.error.message : 'Could not replace the membership'}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" data-testid="ck-group-members-cancel" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button data-testid="ck-group-members-submit" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner data-icon="inline-start" /> : null}
            {save.isPending ? 'Saving…' : 'Replace membership'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function GroupsCard({ site, onEditRule }: { site: string; onEditRule: (rule: AccessRule) => void }) {
  const can = useCan()
  const client = useQueryClient()
  const [editing, setEditing] = useState<{ group?: AccessGroup } | null>(null)
  const [members, setMembers] = useState<AccessGroup | null>(null)

  const groups = useQuery({
    queryKey: keys.access.groups(site),
    queryFn: () => ck.access.groups(site),
    enabled: Boolean(site),
  })
  const readers = useQuery({
    queryKey: keys.access.users(site),
    queryFn: () => ck.access.users(site),
    enabled: Boolean(site),
  })
  const rules = useQuery({
    queryKey: keys.access.rules(site),
    queryFn: () => ck.access.rules(site),
    enabled: Boolean(site),
  })

  const rows = groups.data ?? []
  const readerRows = readers.data ?? []
  const ruleRows = rules.data ?? []
  const writable = can('site:admin')

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Groups</CardTitle>
        {writable ? (
          <Button size="sm" variant="outline" data-testid="ck-group-new" onClick={() => setEditing({})}>
            New group
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Slug</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Used by</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState
              columns={5}
              isLoading={groups.isPending}
              error={groups.error}
              isEmpty={rows.length === 0}
              onRetry={() => groups.refetch()}
              emptyTitle="No groups yet"
              emptyMessage="A rule can also name readers directly."
            >
              {rows.map((group) => {
                // The server refuses to delete a group any rule still names, so
                // the blockers are shown before the attempt rather than after.
                const blockers = ruleRows.filter((rule) => rule.group_slugs?.includes(group.slug))
                const memberList = membersOf(group, readerRows)
                return (
                  <TableRow key={group.id} data-testid="ck-group-row" data-group={group.id}>
                    <TableCell className="font-mono text-xs">{group.slug}</TableCell>
                    <TableCell>{group.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {memberList.length ? memberList.map((reader) => reader.username).join(', ') : '—'}
                    </TableCell>
                    <TableCell>
                      {blockers.length ? (
                        <TooltipProvider>
                          <div className="flex flex-wrap gap-1">
                            {blockers.map((rule) => (
                              <Tooltip key={rule.id}>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="xs"
                                    className="font-mono"
                                    data-testid={`ck-group-blocker-${rule.id}`}
                                    onClick={() => onEditRule(rule)}
                                  >
                                    {rule.path}
                                  </Button>
                                </TooltipTrigger>
                                {/* The rule the deletion will be refused by, and
                                    the way to it — the refusal was only ever
                                    explained inside the confirmation. */}
                                <TooltipContent>
                                  The server refuses to delete a group a rule still names. Opens the rule.
                                </TooltipContent>
                              </Tooltip>
                            ))}
                          </div>
                        </TooltipProvider>
                      ) : (
                        <StatusBadge>unused</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell className="flex gap-2">
                      {writable ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`ck-group-members-${group.id}`}
                            onClick={() => setMembers(group)}
                          >
                            Members
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            data-testid={`ck-group-edit-${group.id}`}
                            onClick={() => setEditing({ group })}
                          >
                            Edit
                          </Button>
                          <Confirm
                            title={blockers.length ? 'This group is still in use' : 'Delete this group?'}
                            description={
                              blockers.length ? (
                                <>
                                  <strong>{group.name}</strong> is used by {blockers.length} rule
                                  {blockers.length === 1 ? '' : 's'} ({blockers.map((rule) => rule.path).join(', ')}) and
                                  cannot be deleted while that is true. Take the group out of those rules first — the
                                  paths above are buttons that open them.
                                </>
                              ) : (
                                <>
                                  The group <strong>{group.name}</strong> ({group.slug}) is deleted and its{' '}
                                  {memberList.length} member{memberList.length === 1 ? '' : 's'} lose it. The readers
                                  themselves are kept.
                                </>
                              )
                            }
                            confirmLabel="Delete group"
                            destructive
                            onConfirm={async () => {
                              await ck.access.deleteGroup(site, group.id)
                              await Promise.all([
                                client.invalidateQueries({ queryKey: keys.access.groups(site) }),
                                client.invalidateQueries({ queryKey: keys.access.users(site) }),
                              ])
                            }}
                          >
                            {(open) => (
                              <Button
                                size="sm"
                                variant="ghost"
                                data-testid={`ck-group-delete-${group.id}`}
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
                )
              })}
            </TableState>
          </TableBody>
        </Table>
      </CardContent>

      {editing ? (
        <GroupDialog
          site={site}
          group={editing.group}
          siblings={rows.filter((group) => group.id !== editing.group?.id).map((group) => group.slug)}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {members ? (
        <MembersDialog
          site={site}
          group={members}
          readers={readerRows}
          readersQuery={{ isPending: readers.isPending, error: readers.error }}
          onClose={() => setMembers(null)}
        />
      ) : null}
    </Card>
  )
}
