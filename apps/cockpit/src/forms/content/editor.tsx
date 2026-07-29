import { useCallback, useMemo, useRef, useState } from 'react'
import { ck, type ContentItem, type Revision } from '@/api/ck'
import { Card, CardContent, Button } from '@/components/ui/primitives'
import { CopyButton } from '@/components/ui/copy-button'
import { Tabs, TabPanel } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast'
import { canonicalContent, validateContent, type ContentUI } from './contract'
import { FrontmatterForm, effectiveLayout, type ContentForm } from './fields'
import { MarkdownBody } from './body'
import { ServerPreview, StructurePane, ValidatePane } from './preview'
import {
  detect,
  emit,
  parseDocument,
  resolvedLayout,
  roundtripDrift,
  FrontmatterError,
} from './frontmatter'
import { SaveBar, UnsavedPill } from '../save-bar'
import { slugify } from '../fields'
import { useForm } from '../use-form'
import { useUnsavedGuard } from '../use-unsaved-guard'

type PreviewTab = 'structure' | 'rendered' | 'validate'

export interface ContentEditorProps {
  site: string
  /** Absent while creating: the first save is a `POST`, not a new revision. */
  item: ContentItem | null
  source: string
  preset: string
  docsVersions: readonly { id: string; label: string }[]
  reportSeries: readonly { id: string; label: string }[]
  siblings: readonly string[]
  locales: readonly string[]
  accessGroups: readonly string[]
  canWrite: boolean
  canPreview: boolean
  onSaved: (itemId: string) => void
}

/**
 * The editing path — and, until now, the one the console did not have.
 *
 * Every save writes a new immutable revision. Nothing here changes what is
 * served: the live site is whatever release is active, so an operator can be as
 * wrong as they like in this form and the only consequence is another draft.
 * That is what makes the preview worth trusting rather than worth fearing.
 */
export function ContentEditor({
  site,
  item,
  source,
  preset,
  docsVersions,
  reportSeries,
  siblings,
  locales,
  accessGroups,
  canWrite,
  canPreview,
  onSaved,
}: ContentEditorProps) {
  const { toast } = useToast()
  const [tab, setTab] = useState<PreviewTab>('structure')
  const [preview, setPreview] = useState<{ preview_url: string; invitation_url: string } | null>(null)
  const [isBuilding, setBuilding] = useState(false)
  const itemId = useRef<string | null>(item?.id ?? null)

  const parsed = useMemo(() => {
    try {
      return { ...parseDocument(source), failure: null as string | null }
    } catch (failure) {
      return {
        frontmatter: {} as Record<string, unknown>,
        body: source,
        raw: source,
        failure: failure instanceof FrontmatterError ? failure.message : 'The document could not be parsed',
      }
    }
  }, [source])

  const initial = useMemo<ContentUI>(
    () => ({ fm: detect(parsed.frontmatter), body: parsed.body }),
    [parsed.frontmatter, parsed.body],
  )

  // Computed once from the stored document, never from what is being typed: the
  // question is whether this form understands the author's file, and a form that
  // does not must refuse to be the thing that rewrites it.
  const drift = useMemo(
    () => (parsed.failure ? { keys: [] } : roundtripDrift(parsed.frontmatter, parsed.body)),
    [parsed.frontmatter, parsed.body, parsed.failure],
  )

  const onSave = useCallback(
    async (values: ContentUI) => {
      const document = emit(values.fm, values.body)
      if (itemId.current) {
        await ck.content.addRevision(itemId.current, document)
      } else {
        const created = await ck.content.create(site, document)
        itemId.current = created.item.id
      }
      // The write answers with the item and the revision, but the two endpoints
      // do not answer the same shape and only one of them is typed. The list is
      // the shape the console already trusts, so the new revision is read back
      // rather than inferred from the write.
      const [newest] = await ck.content.revisions(itemId.current!)
      onSaved(itemId.current!)
      return newest?.markdown ? seed(newest) : values
    },
    [site, onSaved],
  )

  const form: ContentForm = useForm<ContentUI>({
    initial,
    validate: validateContent,
    canonical: canonicalContent,
    onSave,
  })

  const document = emit(form.values.fm, form.values.body)
  const layout = effectiveLayout(form.values.fm, preset)
  const blocked = drift.keys.length > 0 || Boolean(parsed.failure)
  const guard = useUnsavedGuard({
    when: form.dirty,
    onSave: blocked ? undefined : () => form.save(),
    isSaving: form.isSaving,
  })

  async function buildPreview() {
    setBuilding(true)
    try {
      if (form.dirty && !(await form.save())) return
      const id = itemId.current
      if (!id) return
      const revisions = await ck.content.revisions(id)
      const newest = revisions[0]
      if (!newest) return
      const name = slugify(`draft-${form.values.fm.slug || form.values.fm.title || id}`).slice(0, 80)
      const built = await ck.releases.preview(site, {
        slug: name.length >= 3 ? name : `draft-${id.slice(0, 8)}`,
        revision_ids: [newest.id],
        reason: 'Editor preview',
      })
      setPreview({ preview_url: built.preview_url, invitation_url: built.invitation_url })
    } catch (failure) {
      toast({
        tone: 'danger',
        title: 'The preview could not be built',
        detail: failure instanceof Error ? failure.message : undefined,
      })
    } finally {
      setBuilding(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {guard.prompt}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UnsavedPill dirty={form.dirty} />
          <span className="text-xs text-muted-foreground">
            Revisions are immutable. Saving writes a new draft; nothing is live until a release carries it.
          </span>
        </div>
        <SaveBar
          data-testid="ck-content-save-bar"
          dirty={form.dirty}
          canSave={form.canSave && canWrite && !blocked}
          isSaving={form.isSaving}
          errorCount={Object.keys(form.errors).length}
          onReset={form.reset}
          onSave={() => void form.save()}
          extra={
            canPreview ? (
              <Button
                size="sm"
                variant="outline"
                data-testid="ck-content-build-preview"
                disabled={!canWrite || blocked || isBuilding || form.isSaving}
                onClick={() => void buildPreview()}
              >
                {isBuilding ? 'Building…' : 'Save and build a preview'}
              </Button>
            ) : null
          }
        />
      </div>

      {parsed.failure ? (
        <Banner tone="error" testId="ck-content-parse-error">
          {parsed.failure} — the document cannot be edited here until its frontmatter parses.
        </Banner>
      ) : null}

      {drift.keys.length ? (
        <Banner tone="error" testId="ck-content-drift">
          This form does not read {drift.keys.map((key) => `“${key}”`).join(', ')} the way it is written, so
          saving would rewrite it. Editing is disabled for this document rather than changing an author's file silently.
          {drift.reason ? ` (${drift.reason})` : ''}
        </Banner>
      ) : null}

      {form.unassignedError ? (
        <Banner tone="error" testId="ck-content-server-error" onDismiss={form.clearUnassigned}>
          The write was rejected and no revision was created: {form.unassignedError}
        </Banner>
      ) : null}

      {preview ? (
        <div data-testid="ck-content-preview-built" className="rounded-xl border border-chart-2/30 bg-chart-2/10 p-3">
          <p className="text-xs text-chart-2">
            The preview is built. The invitation is a one-time secret: opening it creates the session and consumes it.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a
              href={preview.preview_url}
              target="_blank"
              rel="noopener"
              data-testid="ck-content-preview-url"
              className="text-xs text-accent underline"
            >
              {preview.preview_url}
            </a>
            <CopyButton value={preview.invitation_url} data-testid="ck-content-invitation-copy" label="Copy invitation" />
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          <FrontmatterForm
            form={form}
            preset={preset}
            docsVersions={docsVersions}
            reportSeries={reportSeries}
            siblings={siblings}
            locales={locales}
            accessGroups={accessGroups}
            disabled={!canWrite || blocked}
          />
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="pt-5">
              <MarkdownBody
                data-testid="ck-content-body"
                value={form.values.body}
                disabled={!canWrite || blocked}
                onChange={(value) => form.set('body', value)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <Tabs
                data-testid="ck-content-preview-tabs"
                value={tab}
                onValueChange={setTab}
                tabs={[
                  { id: 'structure', label: 'Structure' },
                  { id: 'rendered', label: 'Rendered' },
                  { id: 'validate', label: 'Validate' },
                ]}
              />
              <div className="pt-4">
                <TabPanel active={tab === 'structure'} data-testid="ck-content-tab-structure">
                  <StructurePane fm={form.values.fm} body={form.values.body} preset={preset} />
                </TabPanel>
                <TabPanel active={tab === 'rendered'} data-testid="ck-content-tab-rendered">
                  <ServerPreview
                    site={site}
                    source={document}
                    locale={form.values.fm.locale}
                    disabled={tab !== 'rendered'}
                  />
                </TabPanel>
                <TabPanel active={tab === 'validate'} data-testid="ck-content-tab-validate">
                  <ValidatePane
                    site={site}
                    source={document}
                    kind={form.values.fm.kind || 'page'}
                    layout={resolvedLayout(form.values.fm) || layout}
                    disabled={!canWrite}
                  />
                </TabPanel>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** A saved revision back into form state, so the baseline is what was stored. */
function seed(revision: Revision): ContentUI {
  const parsed = parseDocument(revision.markdown ?? '')
  return { fm: detect(parsed.frontmatter), body: parsed.body }
}

function Banner({
  tone,
  testId,
  onDismiss,
  children,
}: {
  tone: 'error' | 'warning'
  testId: string
  onDismiss?: () => void
  children: React.ReactNode
}) {
  return (
    <div
      data-testid={testId}
      className={
        tone === 'error'
          ? 'flex items-start justify-between gap-3 rounded-lg border border-chart-5/30 bg-chart-5/10 p-3 text-xs text-chart-5'
          : 'flex items-start justify-between gap-3 rounded-lg border border-chart-3/30 bg-chart-3/10 p-3 text-xs text-chart-3'
      }
    >
      <span className="min-w-0">{children}</span>
      {onDismiss ? (
        <Button variant="ghost" size="sm" data-testid={`${testId}-dismiss`} onClick={onDismiss}>
          Dismiss
        </Button>
      ) : null}
    </div>
  )
}
