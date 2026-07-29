import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ck, type AccessGroup, type AccessRule, type AccessUser } from '@/api/ck'
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
import { EntityMultiSelect, SlugField, TextField } from '@/forms/fields'
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
      onClose={onClose}
      busy={save.isPending}
      data-testid="ck-group-dialog"
      title={editing ? `Edit ${group?.slug}` : 'New group'}
      description="A group is what an access rule points at. Readers join it, rules grant it."
      footer={
        <DialogActions>
          <Button variant="outline" data-testid="ck-group-cancel" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            data-testid="ck-group-submit"
            disabled={save.isPending || !slug || (!editing && siblings.includes(slug))}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : editing ? 'Save group' : 'Create group'}
          </Button>
        </DialogActions>
      }
    >
      <div className="space-y-4">
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
            help="How rules name this group. It cannot be changed afterwards."
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
          <p data-testid="ck-group-error" className="text-sm text-chart-5">
            {save.error instanceof Error ? save.error.message : 'Could not save the group'}
          </p>
        ) : null}
      </div>
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
      size="lg"
      onClose={onClose}
      busy={save.isPending}
      data-testid="ck-group-members-dialog"
      title={`Members of ${group.name}`}
      description="This list replaces the group's membership exactly as shown. Anyone taken out here loses the group."
      footer={
        <DialogActions>
          <Button variant="outline" data-testid="ck-group-members-cancel" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button data-testid="ck-group-members-submit" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Replace membership'}
          </Button>
        </DialogActions>
      }
    >
      <div className="space-y-4">
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

        {removed.length ? (
          <p data-testid="ck-group-members-removed" className="rounded-lg border border-chart-3/30 bg-chart-3/10 p-3 text-xs text-chart-3">
            {removed.length} reader{removed.length === 1 ? '' : 's'} lose this group:{' '}
            {readers
              .filter((reader) => removed.includes(reader.id))
              .map((reader) => reader.username)
              .join(', ')}
            . Any rule granting only this group stops reaching them at the next release.
          </p>
        ) : null}

        {save.error ? (
          <p data-testid="ck-group-members-error" className="text-sm text-chart-5">
            {save.error instanceof Error ? save.error.message : 'Could not replace the membership'}
          </p>
        ) : null}
      </div>
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
          <THead>
            <TR>
              <TH>Slug</TH>
              <TH>Name</TH>
              <TH>Members</TH>
              <TH>Used by</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            <TableState
              columns={5}
              isLoading={groups.isPending}
              error={groups.error}
              isEmpty={rows.length === 0}
              onRetry={() => groups.refetch()}
              emptyMessage="No groups yet. A rule can also name readers directly."
            >
              {rows.map((group) => {
                // The server refuses to delete a group any rule still names, so
                // the blockers are shown before the attempt rather than after.
                const blockers = ruleRows.filter((rule) => rule.group_slugs?.includes(group.slug))
                const memberList = membersOf(group, readerRows)
                return (
                  <TR key={group.id} data-testid="ck-group-row" data-group={group.id}>
                    <TD className="font-mono text-xs">{group.slug}</TD>
                    <TD>{group.name}</TD>
                    <TD className="text-muted-foreground">
                      {memberList.length ? memberList.map((reader) => reader.username).join(', ') : '—'}
                    </TD>
                    <TD>
                      {blockers.length ? (
                        <div className="flex flex-wrap gap-1">
                          {blockers.map((rule) => (
                            <button
                              key={rule.id}
                              type="button"
                              data-testid={`ck-group-blocker-${rule.id}`}
                              onClick={() => onEditRule(rule)}
                              className="rounded-md border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                              {rule.path}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <Badge>unused</Badge>
                      )}
                    </TD>
                    <TD className="flex gap-2">
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
                    </TD>
                  </TR>
                )
              })}
            </TableState>
          </TBody>
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
