import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { ck, type ContentItem } from '@/api/ck'
import { AppLink } from '@/components/app-link'
import { Confirm } from '@/components/confirm'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { COMMENT_STATUS, CONTACT_STATUS, type CommentStatus, type ContactStatus } from '@/forms/contracts/enums.generated'
import { StatusBadge } from '@/forms/status-badge'
import { TableState } from '@/forms/table-state'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { useI18n } from '@/lib/i18n-context'

/**
 * "No filter" as a value a Select can hold.
 *
 * Radix spells *deselected* as the empty string and refuses it as an item's
 * value, so the "all of them" row needs a name of its own. It is translated at
 * both edges — the query still sees `''` — and no request or URL ever carries it.
 */
const ANY = '__ck_any__'
const STATUS_KEYS = {
  approved: 'audience.status.approved',
  rejected: 'audience.status.rejected',
  pending: 'audience.status.pending',
  new: 'audience.status.new',
  read: 'audience.status.read',
  closed: 'audience.status.closed',
} as const

/**
 * Every moderation list stores a `content_item_id` and nothing else, so on its
 * own it reads as a column of uuids. The authoring list is the only place the
 * title lives; one shared query resolves it for all three lists.
 */
function useContentTitles(site: string) {
  const content = useQuery({
    queryKey: keys.content.list(site),
    queryFn: () => ck.content.list(site),
    enabled: Boolean(site),
    staleTime: 60_000,
  })
  const items = (content.data ?? []) as ContentItem[]
  return (id: string) => items.find((item) => item.id === id)
}

function ContentTitle({ id, item }: { id: string; item: ContentItem | undefined }) {
  const { t } = useI18n()
  // The uuid is what the row is really keyed by, and the link shows a title
  // instead. `AppLink` spreads its props onto an anchor, so the `title` this used
  // to carry was a native tooltip wearing a component's capital letter: reachable
  // by hover and by nothing else. The link is already a focus target, so it is
  // the trigger and no tab stop is added.
  return (
    <AppLink
      to="/content"
      data-testid={`ck-moderation-item-${id}`}
      className="underline decoration-dotted underline-offset-2 hover:text-foreground"
    >
      {item?.title || item?.slug || t('common.unavailableDocument')}
    </AppLink>
  )
}

// ── Comments ─────────────────────────────────────────────────────────────────

const COMMENT_TONE: Record<CommentStatus, 'success' | 'danger' | 'warning'> = {
  approved: 'success',
  rejected: 'danger',
  pending: 'warning',
}

export function CommentsCard({ site, siteId }: { site: string; siteId: string }) {
  const { t, dateTime } = useI18n()
  const can = useCan()
  const client = useQueryClient()
  const [status, setStatus] = useState<CommentStatus | ''>('')
  const titleFor = useContentTitles(site)

  const query = status ? { status } : undefined
  const comments = useQuery({
    queryKey: keys.moderation.comments(siteId, query),
    queryFn: () => ck.moderation.comments(siteId, query),
    enabled: Boolean(siteId),
  })

  const rows = comments.data ?? []
  const writable = can('moderation:write')
  const invalidate = () => client.invalidateQueries({ queryKey: ['comments', siteId] })

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t('moderation.comments.title')}</CardTitle>
        <Select
          value={status || ANY}
          onValueChange={(next) => setStatus(next === ANY ? '' : (next as CommentStatus))}
        >
          <SelectTrigger
            data-testid="ck-comment-status-filter"
            aria-label={t('moderation.comments.filter')}
            className="w-44"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ANY} data-testid="ck-comment-status-filter-any">
                {t('moderation.comments.allStatuses')}
              </SelectItem>
              {COMMENT_STATUS.map((value) => (
                <SelectItem key={value} value={value} data-testid={`ck-comment-status-filter-${value}`}>
                  {t(STATUS_KEYS[value])}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('moderation.comments.author')}</TableHead>
              <TableHead>{t('moderation.comments.post')}</TableHead>
              <TableHead>{t('moderation.comments.comment')}</TableHead>
              <TableHead>{t('moderation.comments.status')}</TableHead>
              <TableHead>{t('moderation.comments.received')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState
              columns={6}
              isLoading={comments.isPending}
              error={comments.error}
              isEmpty={rows.length === 0}
              onRetry={() => comments.refetch()}
              emptyMessage={
                status
                  ? t('moderation.comments.emptyFiltered', { status: t(STATUS_KEYS[status]) })
                  : t('moderation.comments.empty')
              }
            >
              {rows.map((comment) => (
                <TableRow key={comment.id} data-testid="ck-comment-row" data-comment={comment.id}>
                  <TableCell>{comment.author_name || t('moderation.anonymous')}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <ContentTitle id={comment.content_item_id} item={titleFor(comment.content_item_id)} />
                  </TableCell>
                  <TableCell className="max-w-[28rem] whitespace-pre-wrap break-words">{comment.body}</TableCell>
                  <TableCell>
                    <StatusBadge tone={COMMENT_TONE[comment.status]}>{t(STATUS_KEYS[comment.status])}</StatusBadge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{dateTime(comment.created_at)}</TableCell>
                  <TableCell className="flex gap-2">
                    {writable ? (
                      <>
                        {(['approved', 'rejected'] as const)
                          .filter((next) => next !== comment.status)
                          .map((next) => (
                            <Confirm
                              key={next}
                              title={
                                next === 'approved'
                                  ? t('moderation.comments.approveTitle')
                                  : t('moderation.comments.rejectTitle')
                              }
                              description={t(
                                next === 'approved'
                                  ? 'moderation.comments.approveDescription'
                                  : 'moderation.comments.rejectDescription',
                                { author: comment.author_name || t('moderation.anonymous') },
                              )}
                              confirmLabel={
                                next === 'approved'
                                  ? t('moderation.comments.approve')
                                  : t('moderation.comments.reject')
                              }
                              destructive={next === 'rejected'}
                              onConfirm={async () => {
                                await ck.moderation.moderate(comment.id, next)
                                await invalidate()
                              }}
                            >
                              {(open) => (
                                <Button
                                  size="sm"
                                  variant={next === 'approved' ? 'outline' : 'ghost'}
                                  data-testid={`ck-comment-${next}-${comment.id}`}
                                  onClick={open}
                                >
                                  {next === 'approved'
                                    ? t('moderation.comments.approve')
                                    : t('moderation.comments.reject')}
                                </Button>
                              )}
                            </Confirm>
                          ))}
                        <Confirm
                          title={t('moderation.comments.deleteTitle')}
                          description={t(
                            comment.status === 'approved'
                              ? 'moderation.comments.deleteApproved'
                              : 'moderation.comments.deleteOther',
                            { author: comment.author_name || t('moderation.anonymous') },
                          )}
                          confirmLabel={t('moderation.comments.delete')}
                          destructive
                          onConfirm={async () => {
                            await ck.moderation.deleteComment(comment.id, comment.status === 'approved')
                            await invalidate()
                          }}
                        >
                          {(open) => (
                            <Button
                              size="sm"
                              variant="destructive"
                              data-testid={`ck-comment-delete-${comment.id}`}
                              onClick={open}
                            >
                              {t('moderation.comments.delete')}
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
    </Card>
  )
}

// ── Contact submissions ──────────────────────────────────────────────────────

const CONTACT_TONE: Record<ContactStatus, 'info' | 'neutral' | 'warning'> = {
  new: 'warning',
  read: 'info',
  closed: 'neutral',
}

export function ContactCard({ siteId }: { siteId: string }) {
  const { t, dateTime } = useI18n()
  const can = useCan()
  const client = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)

  const contact = useQuery({
    queryKey: keys.moderation.contact(siteId),
    queryFn: () => ck.moderation.contact(siteId),
    enabled: Boolean(siteId),
  })

  const rows = contact.data ?? []
  const writable = can('moderation:write')
  const invalidate = () => client.invalidateQueries({ queryKey: keys.moderation.contact(siteId) })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('moderation.contact.title')}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('moderation.contact.from')}</TableHead>
              <TableHead>{t('moderation.contact.message')}</TableHead>
              <TableHead>{t('moderation.comments.status')}</TableHead>
              <TableHead>{t('moderation.comments.received')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState
              columns={5}
              isLoading={contact.isPending}
              error={contact.error}
              isEmpty={rows.length === 0}
              onRetry={() => contact.refetch()}
              emptyMessage={t('moderation.contact.empty')}
            >
              {rows.map((submission) => {
                const open = expanded === submission.id
                return (
                  <Fragment key={submission.id}>
                    <TableRow data-testid="ck-contact-row" data-submission={submission.id}>
                      <TableCell>
                        <span className="font-medium">{submission.name || t('moderation.anonymous')}</span>
                        {submission.email ? (
                          <span className="block text-xs text-muted-foreground">{submission.email}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-[24rem]">
                        {/*
                          A truncated message with a `title=` tooltip is
                          unreachable by keyboard and unreadable on touch, and a
                          contact message is exactly the thing that has to be
                          read in full before it is closed.
                        */}
                        <button
                          type="button"
                          data-testid={`ck-contact-expand-${submission.id}`}
                          aria-expanded={open}
                          onClick={() => setExpanded(open ? null : submission.id)}
                          className="w-full truncate text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {submission.body}
                        </button>
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={CONTACT_TONE[submission.status]}>
                          {t(STATUS_KEYS[submission.status])}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {dateTime(submission.created_at)}
                      </TableCell>
                      <TableCell className="flex flex-wrap gap-2">
                        {writable ? (
                          <>
                            {CONTACT_STATUS.filter((next) => next !== submission.status).map((next) => (
                              <Button
                                key={next}
                                size="sm"
                                variant="outline"
                                data-testid={`ck-contact-${next}-${submission.id}`}
                                onClick={async () => {
                                  await ck.moderation.updateContact(submission.id, next)
                                  await invalidate()
                                }}
                              >
                                {next === 'new'
                                  ? t('moderation.contact.reopen')
                                  : next === 'read'
                                    ? t('moderation.contact.markRead')
                                    : t('moderation.contact.close')}
                              </Button>
                            ))}
                            <Confirm
                              title={t('moderation.contact.deleteTitle')}
                              description={t('moderation.contact.deleteDescription')}
                              confirmLabel={t('moderation.contact.delete')}
                              destructive
                              onConfirm={async () => {
                                await ck.moderation.deleteContact(submission.id)
                                await invalidate()
                              }}
                            >
                              {(openDialog) => (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  data-testid={`ck-contact-delete-${submission.id}`}
                                  onClick={openDialog}
                                >
                                  {t('moderation.contact.delete')}
                                </Button>
                              )}
                            </Confirm>
                          </>
                        ) : null}
                      </TableCell>
                    </TableRow>
                    {open ? (
                      <TableRow data-testid={`ck-contact-body-${submission.id}`}>
                        <TableCell colSpan={5} className="bg-muted/40">
                          <p className="whitespace-pre-wrap break-words text-sm">{submission.body}</p>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                )
              })}
            </TableState>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ── Post feedback ────────────────────────────────────────────────────────────

export function FeedbackCard({ site, siteId }: { site: string; siteId: string }) {
  const { t } = useI18n()
  const can = useCan()
  const client = useQueryClient()
  const [post, setPost] = useState('')
  const titleFor = useContentTitles(site)

  const query = post ? { post } : undefined
  const feedback = useQuery({
    queryKey: [...keys.moderation.feedback(siteId), post],
    queryFn: () => ck.moderation.feedback(siteId, query),
    enabled: Boolean(siteId),
  })

  const rows = feedback.data ?? []
  const writable = can('moderation:write')

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t('moderation.feedback.title')}</CardTitle>
        <Select value={post || ANY} onValueChange={(next) => setPost(next === ANY ? '' : next)}>
          <SelectTrigger
            data-testid="ck-feedback-post-filter"
            aria-label={t('moderation.feedback.filter')}
            className="w-56"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ANY} data-testid="ck-feedback-post-filter-any">
                {t('moderation.feedback.allPosts')}
              </SelectItem>
              {(feedback.data ?? []).map((row) => (
                <SelectItem
                  key={row.content_item_id}
                  value={row.content_item_id}
                  data-testid={`ck-feedback-post-filter-${row.content_item_id}`}
                >
                  {titleFor(row.content_item_id)?.title || titleFor(row.content_item_id)?.slug || t('common.unavailableDocument')}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('moderation.comments.post')}</TableHead>
              <TableHead>{t('moderation.feedback.up')}</TableHead>
              <TableHead>{t('moderation.feedback.down')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState
              columns={4}
              isLoading={feedback.isPending}
              error={feedback.error}
              isEmpty={rows.length === 0}
              onRetry={() => feedback.refetch()}
              emptyMessage={t('moderation.feedback.empty')}
            >
              {rows.map((row) => (
                <TableRow key={row.content_item_id} data-testid="ck-feedback-row" data-post={row.content_item_id}>
                  <TableCell>
                    <ContentTitle id={row.content_item_id} item={titleFor(row.content_item_id)} />
                  </TableCell>
                  <TableCell className="tabular-nums text-chart-2">{row.up}</TableCell>
                  <TableCell className="tabular-nums text-destructive">{row.down}</TableCell>
                  <TableCell>
                    {writable ? (
                      <Confirm
                        title={t('moderation.feedback.resetTitle')}
                        description={t('moderation.feedback.resetDescription', {
                          count: row.up + row.down,
                          post:
                            titleFor(row.content_item_id)?.title ||
                            titleFor(row.content_item_id)?.slug ||
                            t('common.unavailableDocument'),
                        })}
                        confirmLabel={t('moderation.feedback.resetCounter')}
                        destructive
                        onConfirm={async () => {
                          await ck.moderation.resetFeedback(row.content_item_id)
                          await client.invalidateQueries({ queryKey: keys.moderation.feedback(siteId) })
                        }}
                      >
                        {(open) => (
                          <Button
                            size="sm"
                            variant="destructive"
                            data-testid={`ck-feedback-reset-${row.content_item_id}`}
                            onClick={open}
                          >
                            {t('moderation.feedback.reset')}
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
      </CardContent>
    </Card>
  )
}
