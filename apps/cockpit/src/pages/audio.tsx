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
import { formatDate } from '@/lib/utils'

const AUDIO_LIMITS = [50, 100, 250, 500]

export function AudioPage() {
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
      <Page title="Audio">
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
      ? 'Characters used this month: not reported'
      : `${usedChars.toLocaleString()} characters used this month`

  return (
    <Page
      title="Audio"
      description="Read-aloud rendering jobs and the monthly character budget."
      actions={
        can('release:write') ? (
          <Confirm
            title="Backfill read-aloud audio?"
            description={
              <>
                Every published post of <strong>{site}</strong> without audio is queued for rendering. This spends the
                monthly character budget
                {limitChars === undefined ? '' : `, capped at ${limitChars.toLocaleString()} characters for this run`}.
              </>
            }
            confirmLabel="Start backfill"
            onConfirm={async () => {
              await ck.content.audio.backfill(site, limitChars === undefined ? {} : { limit_chars: limitChars })
              await jobs.refetch()
            }}
          >
            {(open) => (
              <Button data-testid="audio-backfill" onClick={open}>
                Backfill
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
                aria-label="Characters used this month"
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
                    {budget.used.toLocaleString()} of {budget.budget.toLocaleString()} characters ·{' '}
                    {budget.remaining.toLocaleString()} left
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
                  {budget.tone === 'danger' ? 'Budget spent' : 'Budget nearly spent'}
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
                  <AlertTitle>The month's characters are spent</AlertTitle>
                  <AlertDescription>
                    Publishing a post no longer queues narration; it resets with the next calendar month (UTC). A
                    backfill still runs — its cap applies to that one run, not to what is left of the month.
                  </AlertDescription>
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
              {budgetChars === null ? 'no budget configured' : `budget ${budgetChars.toLocaleString()} characters`}
            </span>
          )}
          <div className="flex flex-wrap gap-4">
            {AUDIO_JOB_STATUS.map((name) => (
              <span key={name} data-testid={`audio-count-${name}`}>
                {/* A counter the response omitted is not a status with no jobs;
                    src/audio.mjs zero-fills the statuses it knows, and the ones it
                    does not know are the whole reason this is not `?? 0`. */}
                {name}: {reportedCount(summary[name])?.toLocaleString() ?? '—'}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {can('release:write') ? (
        <div className="mb-3 max-w-sm">
          <NumberField
            data-testid="audio-limit-chars"
            label="Backfill character cap"
            integer
            unit="characters"
            min={1}
            allowUnset
            unsetLabel="Whole budget"
            help="Stops the run once this many characters have been queued."
            fallback={`Unset uses the site's configured budget${current?.settings?.audio ? '' : ', which this site has not set'}.`}
            value={limitChars}
            onChange={setLimitChars}
          />
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2">
        <Select value={status || ANY} onValueChange={(next) => setStatus(next === ANY ? '' : (next as AudioJobStatus))}>
          <SelectTrigger className="w-44" data-testid="audio-status-filter" aria-label="Filter audio jobs by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ANY}>All statuses</SelectItem>
              {AUDIO_JOB_STATUS.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={String(limit)} onValueChange={(next) => setLimit(Number(next))}>
          <SelectTrigger className="w-32" data-testid="audio-limit-filter" aria-label="Number of audio jobs to load">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {AUDIO_LIMITS.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  Last {value}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <Card className="py-0">
        <div className="scrollbar-thin overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Characters</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Created</TableHead>
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
                emptyTitle={status ? `No ${status} jobs` : 'No audio jobs'}
                emptyMessage={
                  status
                    ? 'Another status may have them — the filter is above.'
                    : 'Enable settings.audio for this site to start.'
                }
              >
                {rows.map((job) => (
                  <TableRow key={job.id} data-testid="audio-job-row" data-job={job.id}>
                    {/* Wraps rather than truncates: §6 wants the whole name in a
                        `title` when a column cuts it, §3 forbids a native
                        `title`, and cockpit-forms-density.test.mjs enforces §3
                        with no exemption. Not cutting it satisfies both. */}
                    <TableCell className="max-w-[18rem] break-words">
                      {job.title || job.slug || job.item_id.slice(0, 12)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={job.status === 'done' ? 'success' : job.status === 'failed' ? 'danger' : 'warning'}
                      >
                        {job.status}
                      </StatusBadge>
                      {job.error ? <span className="ml-2 text-xs text-destructive">{job.error}</span> : null}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {job.chars?.toLocaleString() ?? '—'}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{job.attempts}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(job.created_at)}
                    </TableCell>
                    <TableCell>
                      {can('release:write') && job.status === 'failed' ? (
                        <Confirm
                          title="Retry this job?"
                          description={
                            <>
                              <strong>{job.title || job.slug || job.item_id}</strong> is queued again with its backoff
                              clock reset. This spends the monthly character budget and ends in a rebuild.
                            </>
                          }
                          confirmLabel="Retry"
                          onConfirm={async () => {
                            await ck.content.audio.retry(site, job.id)
                            await jobs.refetch()
                          }}
                        >
                          {(open) => (
                            <Button size="sm" variant="outline" data-testid={`audio-retry-${job.id}`} onClick={open}>
                              Retry
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
        </div>
      </Card>
    </Page>
  )
}
