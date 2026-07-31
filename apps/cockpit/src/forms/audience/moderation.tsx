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
import { formatDate } from '@/lib/utils'

/**
 * "No filter" as a value a Select can hold.
 *
 * Radix spells *deselected* as the empty string and refuses it as an item's
 * value, so the "all of them" row needs a name of its own. It is translated at
 * both edges — the query still sees `''` — and no request or URL ever carries it.
 */
const ANY = '__ck_any__'


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
  return (
    <AppLink
      to="/content"
      data-testid={`ck-moderation-item-${id}`}
      className="underline decoration-dotted underline-offset-2 hover:text-foreground"
      title={id}
    >
      {item?.title || item?.slug || `${id.slice(0, 12)}…`}
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
        <CardTitle>Comments</CardTitle>
        <Select
          value={status || ANY}
          onValueChange={(next) => setStatus(next === ANY ? '' : (next as CommentStatus))}
        >
          <SelectTrigger
            data-testid="ck-comment-status-filter"
            aria-label="Filter comments by status"
            className="w-44"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ANY} data-testid="ck-comment-status-filter-any">
                All statuses
              </SelectItem>
              {COMMENT_STATUS.map((value) => (
                <SelectItem key={value} value={value} data-testid={`ck-comment-status-filter-${value}`}>
                  {value}
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
              <TableHead>Author</TableHead>
              <TableHead>Post</TableHead>
              <TableHead>Comment</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Received</TableHead>
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
              emptyMessage={status ? `No ${status} comments.` : 'Nothing waiting for moderation.'}
            >
              {rows.map((comment) => (
                <TableRow key={comment.id} data-testid="ck-comment-row" data-comment={comment.id}>
                  <TableCell>{comment.author_name || 'anonymous'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <ContentTitle id={comment.content_item_id} item={titleFor(comment.content_item_id)} />
                  </TableCell>
                  <TableCell className="max-w-[28rem] whitespace-pre-wrap break-words">{comment.body}</TableCell>
                  <TableCell>
                    <StatusBadge tone={COMMENT_TONE[comment.status]}>{comment.status}</StatusBadge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(comment.created_at)}</TableCell>
                  <TableCell className="flex gap-2">
                    {writable ? (
                      <>
                        {(['approved', 'rejected'] as const)
                          .filter((next) => next !== comment.status)
                          .map((next) => (
                            <Confirm
                              key={next}
                              title={next === 'approved' ? 'Publish this comment?' : 'Reject this comment?'}
                              description={
                                next === 'approved' ? (
                                  <>
                                    The comment by <strong>{comment.author_name || 'anonymous'}</strong> becomes visible
                                    on the published post at the next release.
                                  </>
                                ) : (
                                  <>
                                    The comment by <strong>{comment.author_name || 'anonymous'}</strong> stays hidden
                                    and is kept for the record. The author is not notified.
                                  </>
                                )
                              }
                              confirmLabel={next === 'approved' ? 'Approve' : 'Reject'}
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
                                  {next === 'approved' ? 'Approve' : 'Reject'}
                                </Button>
                              )}
                            </Confirm>
                          ))}
                        <Confirm
                          title="Delete this comment for good?"
                          description={
                            <>
                              The comment by <strong>{comment.author_name || 'anonymous'}</strong> is erased — the row,
                              the text and the author's email.
                              {comment.status === 'approved'
                                ? ' It is on the live site, so this also builds and activates a release without it.'
                                : ' Rejecting instead would keep it for the record.'}{' '}
                              This cannot be undone.
                            </>
                          }
                          confirmLabel="Delete comment"
                          destructive
                          onConfirm={async () => {
                            await ck.moderation.deleteComment(comment.id, comment.status === 'approved')
                            await invalidate()
                          }}
                        >
                          {(open) => (
                            <Button
                              size="sm"
                              variant="ghost"
                              data-testid={`ck-comment-delete-${comment.id}`}
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
        <CardTitle>Contact submissions</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>From</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Received</TableHead>
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
              emptyMessage="No contact submissions."
            >
              {rows.map((submission) => {
                const open = expanded === submission.id
                return (
                  <Fragment key={submission.id}>
                    <TableRow data-testid="ck-contact-row" data-submission={submission.id}>
                      <TableCell>
                        <span className="font-medium">{submission.name || 'anonymous'}</span>
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
                        <StatusBadge tone={CONTACT_TONE[submission.status]}>{submission.status}</StatusBadge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(submission.created_at)}</TableCell>
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
                                {next === 'new' ? 'Reopen' : next === 'read' ? 'Mark read' : 'Close'}
                              </Button>
                            ))}
                            <Confirm
                              title="Delete this submission?"
                              description={
                                <>
                                  The sender's name, email address and message are erased. Closing it instead keeps the
                                  record. This cannot be undone.
                                </>
                              }
                              confirmLabel="Delete submission"
                              destructive
                              onConfirm={async () => {
                                await ck.moderation.deleteContact(submission.id)
                                await invalidate()
                              }}
                            >
                              {(openDialog) => (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  data-testid={`ck-contact-delete-${submission.id}`}
                                  onClick={openDialog}
                                >
                                  Delete
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
        <CardTitle>Post feedback</CardTitle>
        <Select value={post || ANY} onValueChange={(next) => setPost(next === ANY ? '' : next)}>
          <SelectTrigger data-testid="ck-feedback-post-filter" aria-label="Filter feedback by post" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ANY} data-testid="ck-feedback-post-filter-any">
                All posts
              </SelectItem>
              {(feedback.data ?? []).map((row) => (
                <SelectItem
                  key={row.content_item_id}
                  value={row.content_item_id}
                  data-testid={`ck-feedback-post-filter-${row.content_item_id}`}
                >
                  {titleFor(row.content_item_id)?.title || row.content_item_id.slice(0, 12)}
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
              <TableHead>Post</TableHead>
              <TableHead>Up</TableHead>
              <TableHead>Down</TableHead>
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
              emptyMessage="No votes yet."
            >
              {rows.map((row) => (
                <TableRow key={row.content_item_id} data-testid="ck-feedback-row" data-post={row.content_item_id}>
                  <TableCell>
                    <ContentTitle id={row.content_item_id} item={titleFor(row.content_item_id)} />
                  </TableCell>
                  <TableCell className="tabular-nums text-chart-2">{row.up}</TableCell>
                  <TableCell className="tabular-nums text-chart-5">{row.down}</TableCell>
                  <TableCell>
                    {writable ? (
                      <Confirm
                        title="Reset this counter?"
                        description={
                          <>
                            All {row.up + row.down} anonymous votes on{' '}
                            <strong>{titleFor(row.content_item_id)?.title || row.content_item_id}</strong> are deleted
                            and the counter starts at zero. There is nothing else stored about them, so this cannot be
                            undone.
                          </>
                        }
                        confirmLabel="Reset counter"
                        destructive
                        onConfirm={async () => {
                          await ck.moderation.resetFeedback(row.content_item_id)
                          await client.invalidateQueries({ queryKey: keys.moderation.feedback(siteId) })
                        }}
                      >
                        {(open) => (
                          <Button
                            size="sm"
                            variant="ghost"
                            data-testid={`ck-feedback-reset-${row.content_item_id}`}
                            onClick={open}
                          >
                            Reset
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
