import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ck, type AccessGroup, type AccessRule, type AccessUser, type RuleInput } from '@/api/ck'
import { Confirm } from '@/components/confirm'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogActions } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ACCESS_RULE_MATCH, type AccessRuleMatch } from '@/forms/contracts/enums.generated'
import { EntityMultiSelect, PathField, SegmentedField } from '@/forms/fields'
import { StatusBadge } from '@/forms/status-badge'
import { TableState } from '@/forms/table-state'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'

const MATCH_OPTIONS = [
  { value: 'prefix' as const, label: 'Prefix' },
  { value: 'exact' as const, label: 'Exact' },
] satisfies readonly { value: AccessRuleMatch; label: string }[]

// The generated set is the contract; this only orders it. If the server ever
// grows a third match mode the mismatch has to be loud rather than silent.
if (MATCH_OPTIONS.length !== ACCESS_RULE_MATCH.length) {
  throw new Error('access rule match options are out of step with the generated contract')
}

function RuleDialog({
  site,
  rule,
  groups,
  groupsQuery,
  readers,
  readersQuery,
  onSaved,
  onClose,
}: {
  site: string
  rule?: AccessRule
  groups: AccessGroup[]
  groupsQuery: { isPending: boolean; error: unknown }
  readers: AccessUser[]
  readersQuery: { isPending: boolean; error: unknown }
  onSaved: () => void
  onClose: () => void
}) {
  const client = useQueryClient()
  const [match, setMatch] = useState<AccessRuleMatch>((rule?.match as AccessRuleMatch) ?? 'prefix')
  const [path, setPath] = useState(rule?.path ?? '/')
  const [groupSlugs, setGroupSlugs] = useState<string[]>([...(rule?.group_slugs ?? [])])
  const [userIds, setUserIds] = useState<string[]>([...(rule?.user_ids ?? [])])

  const save = useMutation({
    mutationFn: () => {
      // PATCH merges key by key, so a body that omits `users` keeps the stored
      // ones — an operator who clears the reader list would watch it come back.
      // Both audience keys go out on every save, create and update alike.
      const input: RuleInput = { match, path, groups: groupSlugs, users: userIds }
      return rule ? ck.access.updateRule(site, rule.id, input) : ck.access.createRule(site, input)
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.access.rules(site) })
      onSaved()
      onClose()
    },
  })

  const audienceEmpty = groupSlugs.length === 0 && userIds.length === 0
  const editing = Boolean(rule)

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      busy={save.isPending}
      data-testid="ck-rule-dialog"
      title={editing ? `Edit rule for ${rule?.path}` : 'New path rule'}
      description="Rules are snapshotted into each release. Saving one changes nothing live until the next build."
      footer={
        <DialogActions>
          <Button variant="outline" data-testid="ck-rule-cancel" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            data-testid="ck-rule-submit"
            disabled={save.isPending || audienceEmpty || !path}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Spinner data-icon="inline-start" /> : null}
            {save.isPending ? 'Saving…' : editing ? 'Save rule' : 'Create rule'}
          </Button>
        </DialogActions>
      }
    >
      <div className="flex flex-col gap-4">
        <SegmentedField
          data-testid="ck-rule-match"
          label="Match"
          value={match}
          options={MATCH_OPTIONS}
          help={
            match === 'prefix'
              ? 'Covers the path and everything below it.'
              : 'Covers exactly this path and nothing below it.'
          }
          onChange={setMatch}
        />

        <PathField
          data-testid="ck-rule-path"
          label="Path"
          required
          help="A published path on this site, for example /de/internal."
          value={path}
          onChange={setPath}
        />

        <EntityMultiSelect
          data-testid="ck-rule-groups"
          label="Groups"
          value={groupSlugs}
          isLoading={groupsQuery.isPending}
          optionsError={groupsQuery.error}
          emptyMessage="No groups on this site yet"
          options={groups.map((group) => ({ value: group.slug, label: group.name, hint: group.slug }))}
          onChange={(next) => setGroupSlugs([...next])}
        />

        <EntityMultiSelect
          data-testid="ck-rule-users"
          label="Readers"
          help="Named directly, independent of any group."
          value={userIds}
          isLoading={readersQuery.isPending}
          optionsError={readersQuery.error}
          emptyMessage="No readers on this site yet"
          options={readers.map((reader) => ({
            value: reader.id,
            label: reader.display_name || reader.username,
            hint: reader.username,
          }))}
          onChange={(next) => setUserIds([...next])}
        />

        {audienceEmpty ? (
          <p data-testid="ck-rule-audience-error" className="text-sm text-chart-5">
            A rule needs at least one group or one reader — the server rejects an empty audience, and a rule nobody
            matches would lock the path away from everyone.
          </p>
        ) : null}

        {save.error ? (
          <Alert variant="destructive" data-testid="ck-rule-error">
            <TriangleAlert />
            <AlertTitle>The rule was not saved</AlertTitle>
            <AlertDescription>
              {save.error instanceof Error ? save.error.message : 'Could not save the rule'}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </Dialog>
  )
}

export function RulesCard({
  site,
  editing,
  onEditingChange,
  onRebuildRequired,
}: {
  site: string
  /** Lifted so the groups card can open a rule that blocks its deletion. */
  editing: { rule?: AccessRule } | null
  onEditingChange: (editing: { rule?: AccessRule } | null) => void
  onRebuildRequired: () => void
}) {
  const can = useCan()
  const client = useQueryClient()

  const rules = useQuery({
    queryKey: keys.access.rules(site),
    queryFn: () => ck.access.rules(site),
    enabled: Boolean(site),
  })
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

  const rows = rules.data ?? []
  const readerRows = readers.data ?? []
  const writable = can('site:admin')

  // Closing a dialog for a rule that no longer exists would leave it open on a
  // stale record; a refetch that drops the row closes the editor with it. The
  // pending guard matters: without it the first render — where the list is
  // still empty — would close a dialog the groups card had just opened.
  useEffect(() => {
    if (rules.isPending) return
    if (editing?.rule && !rows.some((rule) => rule.id === editing.rule?.id)) onEditingChange(null)
  }, [rows, editing, onEditingChange, rules.isPending])

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Path rules</CardTitle>
        {writable ? (
          <Button size="sm" variant="outline" data-testid="ck-rule-new" onClick={() => onEditingChange({})}>
            New rule
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Match</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Groups</TableHead>
              <TableHead>Readers</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState
              columns={5}
              isLoading={rules.isPending}
              error={rules.error}
              isEmpty={rows.length === 0}
              onRetry={() => rules.refetch()}
              emptyMessage="No rules — everything published is public."
            >
              {rows.map((rule) => (
                <TableRow key={rule.id} data-testid="ck-rule-row" data-rule={rule.id}>
                  <TableCell>
                    <StatusBadge tone="info">{rule.match}</StatusBadge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{rule.path}</TableCell>
                  <TableCell className="text-muted-foreground">{rule.group_slugs?.join(', ') || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {rule.user_ids?.length
                      ? rule.user_ids
                          .map((id) => readerRows.find((reader) => reader.id === id)?.username ?? id.slice(0, 8))
                          .join(', ')
                      : '—'}
                  </TableCell>
                  <TableCell className="flex gap-2">
                    {writable ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`ck-rule-edit-${rule.id}`}
                          onClick={() => onEditingChange({ rule })}
                        >
                          Edit
                        </Button>
                        <Confirm
                          title="Delete this rule?"
                          description={
                            <>
                              The {rule.match} rule on <strong>{rule.path}</strong> is deleted. That path becomes public
                              unless another rule still covers it — and only at the next release, because rules take
                              effect when they are built into one.
                            </>
                          }
                          confirmLabel="Delete rule"
                          destructive
                          onConfirm={async () => {
                            await ck.access.deleteRule(site, rule.id)
                            await client.invalidateQueries({ queryKey: keys.access.rules(site) })
                            onRebuildRequired()
                          }}
                        >
                          {(open) => (
                            <Button size="sm" variant="ghost" data-testid={`ck-rule-delete-${rule.id}`} onClick={open}>
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
        <RuleDialog
          site={site}
          rule={editing.rule}
          groups={groups.data ?? []}
          groupsQuery={{ isPending: groups.isPending, error: groups.error }}
          readers={readerRows}
          readersQuery={{ isPending: readers.isPending, error: readers.error }}
          onSaved={onRebuildRequired}
          onClose={() => onEditingChange(null)}
        />
      ) : null}
    </Card>
  )
}
