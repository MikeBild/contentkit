import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ck, type AccessGroup, type AccessRule, type AccessUser, type RuleInput } from '@/api/ck'
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
import { ACCESS_RULE_MATCH, type AccessRuleMatch } from '@/forms/contracts/enums.generated'
import { EntityMultiSelect, PathField, SegmentedField } from '@/forms/fields'
import { StatusBadge } from '@/forms/status-badge'
import { TableState } from '@/forms/table-state'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { useI18n } from '@/lib/i18n-context'

const MATCH_VALUES = ['prefix', 'exact'] as const satisfies readonly AccessRuleMatch[]

// The generated set is the contract; this only orders it. If the server ever
// grows a third match mode the mismatch has to be loud rather than silent.
if (MATCH_VALUES.length !== ACCESS_RULE_MATCH.length) {
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
  const { t } = useI18n()
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
  const matchOptions = MATCH_VALUES.map((value) => ({
    value,
    label: t(value === 'prefix' ? 'audience.rules.prefix' : 'audience.rules.exact'),
  }))

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // A rule decides who can read a path. Until the server says which
        // audience it stored, there is no answer to dismiss.
        if (save.isPending) return
        if (!next) onClose()
      }}
    >
      <DialogContent
        data-testid="ck-rule-dialog"
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
            {editing ? t('audience.rules.editTitle', { path: rule?.path ?? '' }) : t('audience.rules.newTitle')}
          </DialogTitle>
          <DialogDescription>{t('audience.rules.description')}</DialogDescription>
        </DialogHeader>
        <div className="scrollbar-thin min-h-0 flex flex-col gap-4 overflow-y-auto">
          <SegmentedField
            data-testid="ck-rule-match"
            label={t('audience.rules.match')}
            value={match}
            options={matchOptions}
            help={
              match === 'prefix'
                ? t('audience.rules.prefixHelp')
                : t('audience.rules.exactHelp')
            }
            onChange={setMatch}
          />

          <PathField
            data-testid="ck-rule-path"
            label={t('audience.rules.path')}
            required
            help={t('audience.rules.pathHelp')}
            value={path}
            onChange={setPath}
          />

          <EntityMultiSelect
            data-testid="ck-rule-groups"
            label={t('audience.readers.groups')}
            value={groupSlugs}
            isLoading={groupsQuery.isPending}
            optionsError={groupsQuery.error}
            emptyMessage={t('audience.readers.noGroups')}
            options={groups.map((group) => ({ value: group.slug, label: group.name, hint: group.slug }))}
            onChange={(next) => setGroupSlugs([...next])}
          />

          <EntityMultiSelect
            data-testid="ck-rule-users"
            label={t('audience.readers.title')}
            help={t('audience.rules.directReadersHelp')}
            value={userIds}
            isLoading={readersQuery.isPending}
            optionsError={readersQuery.error}
            emptyMessage={t('audience.groups.noReaders')}
            options={readers.map((reader) => ({
              value: reader.id,
              label: reader.display_name || reader.username,
              hint: reader.username,
            }))}
            onChange={(next) => setUserIds([...next])}
          />

          {audienceEmpty ? (
            <Alert variant="destructive" data-testid="ck-rule-audience-error">
              <TriangleAlert />
              <AlertTitle>{t('audience.rules.emptyAudienceTitle')}</AlertTitle>
              <AlertDescription>{t('audience.rules.emptyAudienceDescription')}</AlertDescription>
            </Alert>
          ) : null}

          {save.error ? (
            <Alert variant="destructive" data-testid="ck-rule-error">
              <TriangleAlert />
              <AlertTitle>{t('audience.rules.saveError')}</AlertTitle>
              <AlertDescription>
                {save.error instanceof Error ? save.error.message : t('audience.rules.saveErrorFallback')}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" data-testid="ck-rule-cancel" disabled={save.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            data-testid="ck-rule-submit"
            disabled={save.isPending || audienceEmpty || !path}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Spinner data-icon="inline-start" /> : null}
            {editing ? t('audience.rules.save') : t('audience.rules.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
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
  const { t, list } = useI18n()
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
        <CardTitle>{t('audience.rules.title')}</CardTitle>
        {writable ? (
          <Button size="sm" variant="outline" data-testid="ck-rule-new" onClick={() => onEditingChange({})}>
            {t('audience.rules.new')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <Table
          mobileLabels={[
            t('audience.rules.match'),
            t('audience.rules.path'),
            t('audience.readers.groups'),
            t('audience.readers.title'),
            '',
          ]}
        >
          <TableHeader>
            <TableRow>
              <TableHead>{t('audience.rules.match')}</TableHead>
              <TableHead>{t('audience.rules.path')}</TableHead>
              <TableHead>{t('audience.readers.groups')}</TableHead>
              <TableHead>{t('audience.readers.title')}</TableHead>
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
              emptyMessage={t('audience.rules.empty')}
            >
              {rows.map((rule, ruleIndex) => (
                <TableRow key={rule.id} data-testid={`ck-rule-row-${ruleIndex}`} data-rule={rule.id}>
                  <TableCell>
                    <StatusBadge tone="info">
                      {t(rule.match === 'prefix' ? 'audience.rules.prefix' : 'audience.rules.exact')}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{rule.path}</TableCell>
                  <TableCell className="text-muted-foreground">{rule.group_slugs?.length ? list(rule.group_slugs) : '—'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {rule.user_ids?.length
                      ? rule.user_ids
                          .map(
                            (id) =>
                              readerRows.find((reader) => reader.id === id)?.username ??
                              t('audience.rules.unknownReader'),
                          )
                          .join(', ')
                      : '—'}
                  </TableCell>
                  <TableCell className="flex gap-2">
                    {writable ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`ck-rule-${ruleIndex}-edit`}
                          onClick={() => onEditingChange({ rule })}
                        >
                          {t('audience.rules.edit')}
                        </Button>
                        <Confirm
                          title={t('audience.rules.deleteTitle')}
                          description={t('audience.rules.deleteDescription', {
                            match: t(rule.match === 'prefix' ? 'audience.rules.prefix' : 'audience.rules.exact'),
                            path: rule.path,
                          })}
                          confirmLabel={t('audience.rules.delete')}
                          destructive
                          onConfirm={async () => {
                            await ck.access.deleteRule(site, rule.id)
                            await client.invalidateQueries({ queryKey: keys.access.rules(site) })
                            onRebuildRequired()
                          }}
                        >
                          {(open) => (
                            <Button size="sm" variant="destructive" data-testid={`ck-rule-${ruleIndex}-delete`} onClick={open}>
                              {t('audience.rules.delete')}
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
