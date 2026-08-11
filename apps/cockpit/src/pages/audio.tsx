import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ck } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { Confirm } from '@/components/confirm'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/forms/status-badge'
import { TableState } from '@/forms/table-state'
import { AUDIO_JOB_STATUS, type AudioJobStatus } from '@/forms/contracts/enums.generated'
import { NumberField } from '@/forms/fields'
import { audioBudget } from '@/lib/audio-budget'
import { keys } from '@/lib/query'
import { reportedCount } from '@/lib/reported'
import { ANY } from '@/lib/select-any'
import { useCan } from '@/lib/session'
import { useSite } from '@/lib/site'
import { useI18n } from '@/lib/i18n-context'

const AUDIO_LIMITS = [50, 100, 250, 500]
const STATUS_KEYS = {
  pending: 'audio.status.pending',
  processing: 'audio.status.processing',
  done: 'audio.status.done',
  failed: 'audio.status.failed',
  skipped: 'audio.status.skipped',
} as const

export function AudioPage() {
  const { t, number, dateTime } = useI18n()
  const { site, current } = useSite()
  const can = useCan()
  const [status, setStatus] = useState<AudioJobStatus | ''>('')
  const [limit, setLimit] = useState(100)
  const [limitChars, setLimitChars] = useState<number | undefined>(undefined)

  const query = { ...(status ? { status } : {}), limit }
  const jobs = useQuery({
    queryKey: [...keys.audio.jobs(site), query],
    queryFn: () => ck.content.audio.jobs(site, query),
    enabled: Boolean(site),
  })

  if (!site)
    return (
      <Page title={t('page.audio.title')}>
        <NoSite />
      </Page>
    )

  const rows = jobs.data?.jobs ?? []
  const summary = jobs.data?.summary
  // A real fraction when the site configured a budget, and `null` when it did
  // not — which is what most sites report. See lib/audio-budget.ts for why the
  // second case is a sentence rather than an empty or a pulsing bar.
  const budget = audioBudget(summary)
  // The two numbers that decision is made of, kept apart because the sentence
  // below has to say which of them is missing: `audioBudget` answers null for a
  // numerator nobody sent just as it does for a budget nobody configured.
  const usedChars = reportedCount(summary?.chars_this_month)
  const budgetChars = reportedCount(summary?.monthly_char_budget)
  // "0 characters used this month" for a month nobody measured would be this
  // screen inventing a measurement, so an absent numerator says it is absent.
  const usedThisMonth =
    usedChars === null
      ? t('audio.usedNotReported')
      : t('audio.usedThisMonth', { count: number(usedChars) })

  return (
    <Page
      title={t('page.audio.title')}
      description={t('audio.description')}
      actions={
        can('release:write') ? (
          <Confirm
            title={t('audio.backfillTitle')}
            description={t('audio.backfillDescription', {
              site,
              cap:
                limitChars === undefined
                  ? ''
                  : t('audio.backfillCap', { count: number(limitChars) }),
            })}
            confirmLabel={t('audio.startBackfill')}
            onConfirm={async () => {
              await ck.content.audio.backfill(site, limitChars === undefined ? {} : { limit_chars: limitChars })
              await jobs.refetch()
            }}
          >
            {(open) => (
              <Button data-testid="audio-backfill" onClick={open}>
                {t('audio.backfill')}
              </Button>
            )}
          </Confirm>
        ) : null
      }
    >
      {summary ? (
        <div data-testid="audio-summary" className="mb-3 flex flex-col gap-2 text-sm text-muted-foreground">
          {budget ? (
            <div className="max-w-md">
              <Progress
                data-testid="audio-budget-bar"
                // Named rather than captioned: the sentence beside the bar is the
                // numbers, and a reader who lands on the bar itself would
                // otherwise be given a percentage with no noun on it.
                aria-label={t('audio.usedLabel')}
                // The API's two numbers, unaltered: the rounding and the clamp a
                // spent budget needs happen once, in progress-value.ts, which has
                // a unit test by name.
                value={budget.used}
                max={budget.budget}
                tone={budget.tone}
                // The numbers in words as well as a bar: a percentage alone does
                // not answer "can this backfill still run", and the cap below is
                // entered in characters.
                valueLabel={
                  <span data-testid="audio-budget-value">
                    {t('audio.budgetValue', {
                      used: number(budget.used),
                      budget: number(budget.budget),
                      remaining: number(budget.remaining),
                    })}
                  </span>
                }
              />
              {/* A tint is not a message: an operator who cannot separate amber
                  from accent still has to be told the budget is nearly gone.
                  When it escalates is audio-budget.ts's decision, the same one
                  the bar takes its tone from. */}
              {budget.tone === 'accent' ? null : (
                <Badge
                  data-testid="audio-budget-tone"
                  variant={budget.tone === 'danger' ? 'destructive' : 'outline'}
                  className="mt-1.5 w-fit"
                >
                  {budget.tone === 'danger' ? t('audio.budgetSpent') : t('audio.budgetNearlySpent')}
                </Badge>
              )}
              {budget.spent ? (
                // Precisely what a spent budget does, because the two paths
                // differ: publishing a post checks the month (src/audio.mjs
                // enqueueAudioJobs skips it once used + its characters exceed the
                // budget), while a backfill's cap is per run and counts only its
                // own characters. Saying "nothing will render" would be wrong and
                // would be discovered as a surprise bill.
                <Alert variant="destructive" className="mt-1.5" data-testid="audio-budget-spent">
                  <TriangleAlert />
                  <AlertTitle>{t('audio.monthSpentTitle')}</AlertTitle>
                  <AlertDescription>{t('audio.monthSpentDescription')}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : (
            // No denominator, so no bar. An indeterminate one would read as work
            // in progress, and nothing is in progress. Which half is missing is
            // said rather than assumed: usually the budget, which
            // `monthly_char_budget: null` is exactly how the API says it, and a
            // numerator the response did not carry lands in this branch too.
            // Every piece is an expression, including the separator, so the
            // rendered sentence is these values joined and no other text.
            <span data-testid="audio-budget-unmeasured">
              {usedThisMonth}
              {' · '}
              {budgetChars === null
                ? t('audio.noBudget')
                : t('audio.budgetConfigured', { count: number(budgetChars) })}
            </span>
          )}
          <div className="flex flex-wrap gap-4">
            {AUDIO_JOB_STATUS.map((name) => (
              <span key={name} data-testid={`audio-count-${name}`}>
                {/* A counter the response omitted is not a status with no jobs;
                    src/audio.mjs zero-fills the statuses it knows, and the ones it
                    does not know are the whole reason this is not `?? 0`. */}
                {t(STATUS_KEYS[name])}:{' '}
                {reportedCount(summary[name]) === null ? '—' : number(reportedCount(summary[name])!)}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {can('release:write') ? (
        <div className="mb-3 max-w-sm">
          <NumberField
            data-testid="audio-limit-chars"
            label={t('audio.backfillCapLabel')}
            integer
            unit={t('audio.characters')}
            min={1}
            allowUnset
            unsetLabel={t('audio.wholeBudget')}
            help={t('audio.backfillCapHelp')}
            fallback={t('audio.backfillCapFallback', {
              missing: current?.settings?.audio ? '' : t('audio.budgetMissing'),
            })}
            value={limitChars}
            onChange={setLimitChars}
          />
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2">
        <Select value={status || ANY} onValueChange={(next) => setStatus(next === ANY ? '' : (next as AudioJobStatus))}>
          <SelectTrigger
            className="w-44"
            data-testid="audio-status-filter"
            aria-label={t('audio.filterStatus')}
          >
            <SelectValue placeholder={t('audio.allStatuses')} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ANY}>{t('audio.allStatuses')}</SelectItem>
              {AUDIO_JOB_STATUS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(STATUS_KEYS[value])}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={String(limit)} onValueChange={(next) => setLimit(Number(next))}>
          <SelectTrigger className="w-32" data-testid="audio-limit-filter" aria-label={t('audio.limitLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {AUDIO_LIMITS.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {t('audio.last', { count: value })}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <Card className="py-0">
          <Table
            mobileLabels={[
              t('audio.title'),
              t('audio.status'),
              t('audio.characters'),
              t('audio.attempts'),
              t('audio.created'),
              '',
            ]}
          >
            <TableHeader>
              <TableRow>
                <TableHead>{t('audio.title')}</TableHead>
                <TableHead>{t('audio.status')}</TableHead>
                <TableHead>{t('audio.characters')}</TableHead>
                <TableHead>{t('audio.attempts')}</TableHead>
                <TableHead>{t('audio.created')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState
                columns={6}
                isLoading={jobs.isPending}
                error={jobs.error}
                isEmpty={rows.length === 0}
                onRetry={() => jobs.refetch()}
                emptyTitle={status ? t('audio.emptyFiltered', { status: t(STATUS_KEYS[status]) }) : t('audio.empty')}
                emptyMessage={
                  status
                    ? t('audio.emptyFilteredDescription')
                    : t('audio.emptyDescription')
                }
              >
                {rows.map((job, jobIndex) => (
                  <TableRow key={job.id} data-testid={`audio-job-row-${jobIndex}`} data-job={job.id}>
                    {/* Wraps rather than truncates: §6 wants the whole name in a
                        `title` when a column cuts it, §3 forbids a native
                        `title`, and cockpit-forms-density.test.mjs enforces §3
                        with no exemption. Not cutting it satisfies both. */}
                    <TableCell className="max-w-[18rem] break-words">
                      {job.title || job.slug || t('common.unavailableDocument')}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={job.status === 'done' ? 'success' : job.status === 'failed' ? 'danger' : 'warning'}
                      >
                        {t(STATUS_KEYS[job.status])}
                      </StatusBadge>
                      {job.error ? <span className="ml-2 text-xs text-destructive">{job.error}</span> : null}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {job.chars === null || job.chars === undefined ? '—' : number(job.chars)}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{job.attempts}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {dateTime(job.created_at)}
                    </TableCell>
                    <TableCell>
                      {can('release:write') && job.status === 'failed' ? (
                        <Confirm
                          title={t('audio.retryTitle')}
                          description={t('audio.retryDescription', {
                            name: job.title || job.slug || t('common.unavailableDocument'),
                          })}
                          confirmLabel={t('audio.retry')}
                          onConfirm={async () => {
                            await ck.content.audio.retry(site, job.id)
                            await jobs.refetch()
                          }}
                        >
                          {(open) => (
                            <Button size="sm" variant="outline" data-testid={`audio-${jobIndex}-retry`} onClick={open}>
                              {t('audio.retry')}
                            </Button>
                          )}
                        </Confirm>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableState>
            </TableBody>
          </Table>
      </Card>
    </Page>
  )
}
