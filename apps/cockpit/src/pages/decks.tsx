import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ck } from '@/api/ck'
import { Page } from '@/app/shell'
import { useI18n } from '@/lib/i18n-context'
import { Confirm } from '@/components/confirm'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FieldGroup, FieldLegend, FieldSet } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/forms/status-badge'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { useSite } from '@/lib/site'

const DECK_PLACEHOLDER = [
  '---',
  'kind: deck',
  'layout: deck',
  'title: A deck',
  'locale: en',
  'slug: a-deck',
  '---',
  '',
  '# Slide one',
  '',
  'The opening claim.',
  '',
  '---',
  '',
  '# Slide two',
  '',
  'What follows from it.',
  '',
].join('\n')

/**
 * Two cards side by side, and deliberately not tabs.
 *
 * The container ladder puts Tabs above Card, but it excludes the case where the
 * reader compares two panels — and this is stronger than comparison: clicking a
 * theme rewrites the frontmatter in the textarea beside it. Behind a tab the
 * button would be a control whose entire effect is off screen, which is the one
 * arrangement that would make the sentence under "Themes and templates" untrue.
 */
export function DecksPage() {
  const { t } = useI18n()
  const { site } = useSite()
  const can = useCan()
  const themes = useQuery({ queryKey: keys.deckThemes, queryFn: () => ck.decks.themes() })
  const templates = useQuery({ queryKey: keys.deckTemplates, queryFn: () => ck.decks.templates() })
  // The placeholder has to be a deck the server actually accepts, or the page
  // teaches its first lesson wrong: planning demands `kind: deck` (a `layout`
  // alone is refused), and frontmatter validation demands a title, a locale and
  // a slug before it looks at anything deck-specific.
  const [source, setSource] = useState(DECK_PLACEHOLDER)
  const [job, setJob] = useState<string | null>(null)

  const validate = useMutation({ mutationFn: () => ck.decks.validate(site, { markdown: source }) })
  const compile = useMutation({
    // Always asynchronous. A synchronous compile answers 200 with the deck
    // itself, which this page has nowhere to put — the operator confirmed a
    // render and then watched nothing happen. `async` answers 202 with a job id,
    // which is what the status line and the download link below are built on.
    mutationFn: () => ck.decks.compile(site, { markdown: source, async: true }),
    onSuccess: (result) => {
      const id =
        (result as { job_id?: string; job?: { id?: string } })?.job_id ?? (result as { job?: { id?: string } })?.job?.id
      setJob(id ?? null)
    },
  })

  const jobStatus = useQuery({
    queryKey: ['deck-job', site, job],
    queryFn: () => ck.decks.job(site, job as string),
    enabled: Boolean(site && job),
    refetchInterval: (query) =>
      query.state.data?.status === 'done' || query.state.data?.status === 'failed' ? false : 2000,
  })

  const result = useQuery({
    queryKey: ['deck-job', site, job, 'result'],
    queryFn: () => ck.decks.jobResult(site, job as string),
    enabled: Boolean(site && job) && jobStatus.data?.status === 'done',
  })

  // Frontmatter is the deck's own source of truth for theme and template, so a
  // card writes into it rather than into a hidden request field the operator
  // would have to remember alongside the text they can see.
  const applyFrontmatter = (key: string, value: string) =>
    setSource((current) =>
      new RegExp(`^${key}:.*$`, 'm').test(current)
        ? current.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`)
        : current.replace(/^---\n/, `---\n${key}: ${value}\n`),
    )

  const diagnostics = ((validate.data as { diagnostics?: { severity?: string; message?: string }[] } | undefined)
    ?.diagnostics ?? []) as { severity?: string; message?: string }[]

  return (
    <Page title={t('page.decks.title')} description={t('page.decks.description')}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('decks.source')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Textarea
              data-testid="deck-source"
              aria-label={t('decks.markdownLabel')}
              className="h-72 font-mono text-xs"
              spellCheck={false}
              value={source}
              onChange={(event) => setSource(event.target.value)}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                data-testid="deck-validate"
                variant="outline"
                onClick={() => validate.mutate()}
                disabled={!site || validate.isPending}
              >
                {validate.isPending ? <Spinner data-icon="inline-start" /> : null}
                {t('decks.validate')}
              </Button>
              <Confirm
                title={t('decks.renderTitle')}
                description={t('decks.renderDescription')}
                confirmLabel={t('decks.renderAction')}
                onConfirm={() => compile.mutateAsync()}
              >
                {(open) => (
                  <Button
                    data-testid="deck-render"
                    onClick={open}
                    disabled={!site || !can('deck:render') || compile.isPending}
                    aria-busy={compile.isPending}
                  >
                    {compile.isPending ? <Spinner data-icon="inline-start" /> : null}
                    {t('decks.renderAction')}
                  </Button>
                )}
              </Confirm>
            </div>

            {validate.error ? (
              <Alert variant="destructive" data-testid="deck-validate-error">
                <TriangleAlert />
                <AlertTitle>{t('decks.validationFailed')}</AlertTitle>
                <AlertDescription>
                  {validate.error instanceof Error ? validate.error.message : t('decks.validationFailed')}
                </AlertDescription>
              </Alert>
            ) : null}
            {diagnostics.length ? (
              <ul data-testid="deck-diagnostics" className="flex flex-col gap-1 text-xs">
                {diagnostics.map((diagnostic, index) => (
                  <li key={index} className="flex gap-2">
                    <StatusBadge tone={diagnostic.severity === 'error' ? 'danger' : 'warning'}>
                      {diagnostic.severity}
                    </StatusBadge>
                    <span className="text-muted-foreground">{diagnostic.message}</span>
                  </li>
                ))}
              </ul>
            ) : validate.isSuccess ? (
              // A clean run reports itself in the same grammar as a dirty one: a
              // tone-carrying badge and a sentence, in the place the findings
              // would be. It was an Alert, which is where this console says a
              // consequence, a warning or a refusal out loud — and "it compiles"
              // is none of the three, so the box was three times the pixels of
              // the line it replaced and a different shape from the list beside
              // it. The words are unchanged and `success` is still a named tone,
              // never a chart colour.
              <p data-testid="deck-diagnostics-clean" className="flex gap-2 text-xs">
                <StatusBadge tone="success">{t('decks.noDiagnostics')}</StatusBadge>
                <span className="text-muted-foreground">{t('decks.compiles')}</span>
              </p>
            ) : null}

            {job ? (
              <div data-testid="deck-job" className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>
                  {t('decks.render')} ·{' '}
                  {jobStatus.data?.status === 'done'
                    ? t('decks.status.done')
                    : jobStatus.data?.status === 'failed'
                      ? t('decks.status.failed')
                      : jobStatus.data?.status
                        ? t('decks.status.running')
                        : t('decks.queued')}
                  {jobStatus.data?.error ? <span className="text-destructive"> · {jobStatus.data.error}</span> : null}
                </span>
                {/*
                  The result was reachable only by calling the API by hand. A
                  render nobody can download is a render that did not happen. It
                  is an <a href>, so it is styled as one link rather than as the
                  bare underlined anchor it was — the same grammar the rest of the
                  console uses for something that is not a mutation.
                */}
                {result.data ? (
                  <Button asChild variant="link" size="sm" className="h-auto p-0">
                    <a
                      data-testid="deck-job-download"
                      download={`deck-${job}.json`}
                      href={URL.createObjectURL(
                        new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' }),
                      )}
                    >
                      {t('decks.download')}
                    </a>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('decks.themesTemplates')}</CardTitle>
            <CardDescription>{t('decks.themesTemplatesDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Two labelled groups of controls, so a FieldSet each with a
                FieldLegend: a bare `Label` with no `htmlFor` and no control to
                wrap named nothing, which is what it was doing here. */}
            <FieldGroup>
              <FieldSet>
                <FieldLegend variant="label">{t('decks.theme')}</FieldLegend>
                <div className="flex flex-wrap gap-2">
                  {(themes.data?.themes ?? []).map((name) => (
                    <Button
                      key={name}
                      size="sm"
                      variant="outline"
                      data-testid={`deck-theme-${name}`}
                      onClick={() => applyFrontmatter('theme', name)}
                    >
                      {name}
                      {name === themes.data?.default ? ` · ${t('decks.default')}` : ''}
                    </Button>
                  ))}
                </div>
              </FieldSet>
              <FieldSet>
                <FieldLegend variant="label">{t('decks.template')}</FieldLegend>
                <div className="flex flex-wrap gap-2">
                  {(templates.data?.ids ?? []).map((id) => (
                    <Button
                      key={id}
                      size="sm"
                      variant="outline"
                      data-testid={`deck-template-${id}`}
                      onClick={() => applyFrontmatter('template', id)}
                    >
                      {id}
                      {id === templates.data?.default ? ` · ${t('decks.default')}` : ''}
                    </Button>
                  ))}
                </div>
              </FieldSet>
              {themes.error || templates.error ? (
                <Alert variant="destructive" data-testid="deck-registry-error">
                  <TriangleAlert />
                  <AlertTitle>{t('decks.registryError')}</AlertTitle>
                  <AlertDescription>{t('decks.registryErrorDescription')}</AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}
