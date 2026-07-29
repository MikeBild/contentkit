import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ck, type ApiKey, type CreatedApiKey } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { Confirm } from '@/components/confirm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableState,
} from '@/components/ui/primitives'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { useSite } from '@/lib/site'
import { formatDate } from '@/lib/utils'

const PRODUCT_SCOPES = [
  'content:read',
  'content:write',
  'deck:render',
  'release:preview',
  'release:write',
  'site:admin',
  'access:admin',
  'webhook:admin',
  'api-key:admin',
  'identity:admin',
  'moderation:write',
  'audit:read',
  'stats:read',
]

// ── Reader access ────────────────────────────────────────────────────────────

export function AccessPage() {
  const { site } = useSite()
  const client = useQueryClient()

  const users = useQuery({ queryKey: keys.access.users(site), queryFn: () => ck.access.users(site), enabled: !!site })
  const groups = useQuery({
    queryKey: keys.access.groups(site),
    queryFn: () => ck.access.groups(site),
    enabled: !!site,
  })
  const rules = useQuery({ queryKey: keys.access.rules(site), queryFn: () => ck.access.rules(site), enabled: !!site })

  if (!site)
    return (
      <Page title="Reader access">
        <NoSite />
      </Page>
    )

  const userRows = users.data ?? []
  const groupRows = groups.data ?? []
  const ruleRows = rules.data ?? []

  return (
    <Page
      title="Reader access"
      description="Who may read the published site. Rules are snapshotted into each release, so changes take effect on the next build."
    >
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Readers</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Username</TH>
                  <TH>Display name</TH>
                  <TH>Active</TH>
                  <TH>Groups</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                <TableState
                  columns={5}
                  isLoading={users.isPending}
                  error={users.error}
                  isEmpty={userRows.length === 0}
                  onRetry={() => users.refetch()}
                  emptyMessage="No readers. The site is public unless a rule says otherwise."
                >
                  {userRows.map((user) => (
                    <TR key={user.id} data-testid="access-user-row" data-user={user.id}>
                      <TD className="font-medium">{user.username}</TD>
                      <TD className="text-muted-foreground">{user.display_name}</TD>
                      <TD>{user.active ? <Badge tone="success">active</Badge> : <Badge>disabled</Badge>}</TD>
                      <TD className="text-muted-foreground">{user.groups?.join(', ') || '—'}</TD>
                      <TD className="flex gap-2">
                        <Confirm
                          title="Sign this reader out everywhere?"
                          description={
                            <>
                              Every active session of <strong>{user.username}</strong> is revoked immediately.
                            </>
                          }
                          confirmLabel="Revoke sessions"
                          onConfirm={() => ck.access.revokeSessions(site, user.id)}
                        >
                          {(open) => (
                            <Button size="sm" variant="outline" onClick={open}>
                              Revoke sessions
                            </Button>
                          )}
                        </Confirm>
                        <Confirm
                          title="Delete this reader?"
                          description={
                            <>
                              <strong>{user.username}</strong> loses access to the site. This cannot be undone.
                            </>
                          }
                          confirmLabel="Delete"
                          destructive
                          onConfirm={async () => {
                            await ck.access.deleteUser(site, user.id)
                            await client.invalidateQueries({ queryKey: keys.access.users(site) })
                          }}
                        >
                          {(open) => (
                            <Button size="sm" variant="ghost" onClick={open}>
                              Delete
                            </Button>
                          )}
                        </Confirm>
                      </TD>
                    </TR>
                  ))}
                </TableState>
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Groups</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Slug</TH>
                    <TH>Name</TH>
                  </TR>
                </THead>
                <TBody>
                  <TableState
                    columns={2}
                    isLoading={groups.isPending}
                    error={groups.error}
                    isEmpty={groupRows.length === 0}
                    onRetry={() => groups.refetch()}
                  >
                    {groupRows.map((group) => (
                      <TR key={group.id} data-testid="access-group-row" data-group={group.id}>
                        <TD className="font-mono text-xs">{group.slug}</TD>
                        <TD>{group.name}</TD>
                      </TR>
                    ))}
                  </TableState>
                </TBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Path rules</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Match</TH>
                    <TH>Path</TH>
                    <TH>Audience</TH>
                  </TR>
                </THead>
                <TBody>
                  <TableState
                    columns={3}
                    isLoading={rules.isPending}
                    error={rules.error}
                    isEmpty={ruleRows.length === 0}
                    onRetry={() => rules.refetch()}
                    emptyMessage="No rules — everything published is public."
                  >
                    {ruleRows.map((rule) => (
                      <TR key={rule.id} data-testid="access-rule-row" data-rule={rule.id}>
                        <TD>
                          <Badge tone="info">{rule.match}</Badge>
                        </TD>
                        <TD className="font-mono text-xs">{rule.path}</TD>
                        <TD className="text-muted-foreground">
                          {[...(rule.group_slugs ?? []), ...(rule.user_ids ?? [])].join(', ') || '—'}
                        </TD>
                      </TR>
                    ))}
                  </TableState>
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </Page>
  )
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

export function WebhooksPage() {
  const { site } = useSite()
  const client = useQueryClient()
  const endpoints = useQuery({
    queryKey: keys.webhooks.list(site),
    queryFn: () => ck.webhooks.list(site),
    enabled: !!site,
  })
  const deliveries = useQuery({ queryKey: keys.webhooks.deliveries(), queryFn: () => ck.webhooks.deliveries() })

  if (!site)
    return (
      <Page title="Webhooks">
        <NoSite />
      </Page>
    )

  const endpointRows = endpoints.data ?? []
  const deliveryRows = deliveries.data ?? []

  return (
    <Page title="Webhooks" description="Outbound content events, their endpoints and delivery history.">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Endpoints</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>URL</TH>
                  <TH>Events</TH>
                  <TH>Active</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                <TableState
                  columns={4}
                  isLoading={endpoints.isPending}
                  error={endpoints.error}
                  isEmpty={endpointRows.length === 0}
                  onRetry={() => endpoints.refetch()}
                >
                  {endpointRows.map((endpoint) => (
                    <TR key={endpoint.id} data-testid="webhook-row" data-endpoint={endpoint.id}>
                      <TD className="max-w-[24rem] truncate font-mono text-xs">{endpoint.url}</TD>
                      <TD className="text-muted-foreground">{endpoint.events?.join(', ')}</TD>
                      <TD>{endpoint.active ? <Badge tone="success">active</Badge> : <Badge>paused</Badge>}</TD>
                      <TD className="flex gap-2">
                        <Confirm
                          title="Rotate the signing secret?"
                          description="The current secret stops being valid at once. The replacement is handed over out-of-band and never appears in an API response."
                          confirmLabel="Rotate"
                          onConfirm={() => ck.webhooks.rotate(site, endpoint.id)}
                        >
                          {(open) => (
                            <Button size="sm" variant="outline" onClick={open}>
                              Rotate secret
                            </Button>
                          )}
                        </Confirm>
                        <Confirm
                          title="Delete this endpoint?"
                          description={<>No further events are delivered to {endpoint.url}.</>}
                          confirmLabel="Delete"
                          destructive
                          onConfirm={async () => {
                            await ck.webhooks.remove(site, endpoint.id)
                            await client.invalidateQueries({ queryKey: keys.webhooks.list(site) })
                          }}
                        >
                          {(open) => (
                            <Button size="sm" variant="ghost" onClick={open}>
                              Delete
                            </Button>
                          )}
                        </Confirm>
                      </TD>
                    </TR>
                  ))}
                </TableState>
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Deliveries</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Event</TH>
                  <TH>Status</TH>
                  <TH>Attempts</TH>
                  <TH>Response</TH>
                  <TH>Created</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                <TableState
                  columns={6}
                  isLoading={deliveries.isPending}
                  error={deliveries.error}
                  isEmpty={deliveryRows.length === 0}
                  onRetry={() => deliveries.refetch()}
                >
                  {deliveryRows.map((delivery) => (
                    <TR key={delivery.id} data-testid="webhook-delivery-row" data-delivery={delivery.id}>
                      <TD className="font-mono text-xs">{delivery.event}</TD>
                      <TD>
                        <Badge
                          tone={
                            delivery.status === 'delivered'
                              ? 'success'
                              : delivery.status === 'failed'
                                ? 'danger'
                                : 'warning'
                          }
                        >
                          {delivery.status}
                        </Badge>
                      </TD>
                      <TD className="text-muted-foreground">{delivery.attempts}</TD>
                      <TD className="text-muted-foreground">{delivery.response_status ?? '—'}</TD>
                      <TD className="text-muted-foreground">{formatDate(delivery.created_at)}</TD>
                      <TD>
                        {delivery.status === 'failed' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              await ck.webhooks.retry(delivery.id)
                              await deliveries.refetch()
                            }}
                          >
                            Retry
                          </Button>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TableState>
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}

// ── Moderation ───────────────────────────────────────────────────────────────

export function ModerationPage() {
  const client = useQueryClient()
  const comments = useQuery({ queryKey: keys.moderation.comments(), queryFn: () => ck.moderation.comments() })
  const contact = useQuery({ queryKey: keys.moderation.contact(), queryFn: () => ck.moderation.contact() })
  const feedback = useQuery({ queryKey: keys.moderation.feedback, queryFn: () => ck.moderation.feedback() })

  const commentRows = comments.data ?? []
  const contactRows = contact.data ?? []
  const feedbackRows = feedback.data ?? []

  return (
    <Page title="Moderation" description="Visitor comments, contact submissions and anonymous post feedback.">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Comments</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Author</TH>
                  <TH>Comment</TH>
                  <TH>Status</TH>
                  <TH>Received</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                <TableState
                  columns={5}
                  isLoading={comments.isPending}
                  error={comments.error}
                  isEmpty={commentRows.length === 0}
                  onRetry={() => comments.refetch()}
                  emptyMessage="Nothing waiting for moderation."
                >
                  {commentRows.map((comment) => (
                    <TR key={comment.id} data-testid="comment-row" data-comment={comment.id}>
                      <TD>{comment.author_name || 'anonymous'}</TD>
                      <TD className="max-w-[28rem] truncate" title={comment.body}>
                        {comment.body}
                      </TD>
                      <TD>
                        <Badge
                          tone={
                            comment.status === 'approved'
                              ? 'success'
                              : comment.status === 'rejected'
                                ? 'danger'
                                : 'warning'
                          }
                        >
                          {comment.status}
                        </Badge>
                      </TD>
                      <TD className="text-muted-foreground">{formatDate(comment.created_at)}</TD>
                      <TD className="flex gap-2">
                        {(['approved', 'rejected'] as const).map((status) => (
                          <Confirm
                            key={status}
                            title={status === 'approved' ? 'Publish this comment?' : 'Reject this comment?'}
                            description={
                              status === 'approved'
                                ? 'It becomes visible on the published post at the next release.'
                                : 'It stays hidden. The author is not notified.'
                            }
                            confirmLabel={status === 'approved' ? 'Approve' : 'Reject'}
                            destructive={status === 'rejected'}
                            onConfirm={async () => {
                              await ck.moderation.moderate(comment.id, status)
                              await client.invalidateQueries({ queryKey: keys.moderation.comments() })
                            }}
                          >
                            {(open) => (
                              <Button size="sm" variant={status === 'approved' ? 'outline' : 'ghost'} onClick={open}>
                                {status === 'approved' ? 'Approve' : 'Reject'}
                              </Button>
                            )}
                          </Confirm>
                        ))}
                      </TD>
                    </TR>
                  ))}
                </TableState>
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Contact submissions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>From</TH>
                    <TH>Message</TH>
                    <TH>Status</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  <TableState
                    columns={4}
                    isLoading={contact.isPending}
                    error={contact.error}
                    isEmpty={contactRows.length === 0}
                    onRetry={() => contact.refetch()}
                  >
                    {contactRows.map((submission) => (
                      <TR key={submission.id} data-testid="contact-row" data-submission={submission.id}>
                        <TD>{submission.email || submission.name || 'anonymous'}</TD>
                        <TD className="max-w-[16rem] truncate" title={submission.body}>
                          {submission.body}
                        </TD>
                        <TD>
                          <Badge tone={submission.status === 'closed' ? 'neutral' : 'info'}>{submission.status}</Badge>
                        </TD>
                        <TD>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              await ck.moderation.updateContact(
                                submission.id,
                                submission.status === 'new' ? 'read' : 'closed',
                              )
                              await client.invalidateQueries({ queryKey: keys.moderation.contact() })
                            }}
                          >
                            {submission.status === 'new' ? 'Mark read' : 'Close'}
                          </Button>
                        </TD>
                      </TR>
                    ))}
                  </TableState>
                </TBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Post feedback</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Post</TH>
                    <TH>Up</TH>
                    <TH>Down</TH>
                  </TR>
                </THead>
                <TBody>
                  <TableState
                    columns={3}
                    isLoading={feedback.isPending}
                    error={feedback.error}
                    isEmpty={feedbackRows.length === 0}
                    onRetry={() => feedback.refetch()}
                  >
                    {feedbackRows.map((row) => (
                      <TR key={row.content_item_id} data-testid="feedback-row">
                        <TD className="font-mono text-xs">{row.content_item_id.slice(0, 12)}</TD>
                        <TD className="text-chart-2">{row.up}</TD>
                        <TD className="text-chart-5">{row.down}</TD>
                      </TR>
                    ))}
                  </TableState>
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </Page>
  )
}

// ── Credentials ──────────────────────────────────────────────────────────────

export function CredentialsPage() {
  const can = useCan()
  const client = useQueryClient()
  const apiKeys = useQuery({ queryKey: keys.credentials.apiKeys, queryFn: () => ck.credentials.apiKeys() })
  const grants = useQuery({
    queryKey: keys.credentials.grants,
    queryFn: () => ck.credentials.grants(),
    enabled: can('identity:admin'),
  })
  const [revealed, setRevealed] = useState<CreatedApiKey | null>(null)

  const keyRows = apiKeys.data ?? []
  const grantRows = grants.data ?? []

  return (
    <Page title="Credentials" description="API keys and the OAuth identity grants that bound what a token may ever do.">
      {revealed ? <RevealedKey created={revealed} onDismiss={() => setRevealed(null)} /> : null}

      <div className="space-y-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>API keys</CardTitle>
            {can('api-key:admin') ? <CreateApiKey onCreated={setRevealed} /> : null}
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Prefix</TH>
                  <TH>Scopes</TH>
                  <TH>Last used</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                <TableState
                  columns={5}
                  isLoading={apiKeys.isPending}
                  error={apiKeys.error}
                  isEmpty={keyRows.length === 0}
                  onRetry={() => apiKeys.refetch()}
                >
                  {keyRows.map((key: ApiKey) => (
                    <TR key={key.id} data-testid="api-key-row" data-key={key.id}>
                      <TD className="font-medium">{key.name}</TD>
                      <TD className="font-mono text-xs text-muted-foreground">{key.key_prefix}</TD>
                      <TD className="max-w-[22rem] truncate text-xs text-muted-foreground">{key.scopes?.join(', ')}</TD>
                      <TD className="text-muted-foreground">{formatDate(key.last_used_at)}</TD>
                      <TD>
                        {can('api-key:admin') && !key.revoked_at ? (
                          <Confirm
                            title="Revoke this key?"
                            description={
                              <>
                                <strong>{key.name}</strong> stops working immediately, and every OAuth token derived
                                from it is invalidated with it. This cannot be undone.
                              </>
                            }
                            confirmLabel="Revoke"
                            destructive
                            onConfirm={async () => {
                              await ck.credentials.revokeApiKey(key.id)
                              await client.invalidateQueries({ queryKey: keys.credentials.apiKeys })
                            }}
                          >
                            {(open) => (
                              <Button size="sm" variant="ghost" onClick={open}>
                                Revoke
                              </Button>
                            )}
                          </Confirm>
                        ) : key.revoked_at ? (
                          <Badge tone="danger">revoked</Badge>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TableState>
              </TBody>
            </Table>
          </CardContent>
        </Card>

        {can('identity:admin') ? (
          <Card>
            <CardHeader>
              <CardTitle>Identity grants</CardTitle>
              <p className="text-sm text-muted-foreground">
                The stored product-scope ceiling is the only truth. Shrinking it takes effect on the very next request,
                without reissuing anything.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Subject</TH>
                    <TH>Provider</TH>
                    <TH>Role</TH>
                    <TH>Ceiling</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  <TableState
                    columns={5}
                    isLoading={grants.isPending}
                    error={grants.error}
                    isEmpty={grantRows.length === 0}
                    onRetry={() => grants.refetch()}
                  >
                    {grantRows.map((grant) => (
                      <TR key={grant.id} data-testid="grant-row" data-grant={grant.id}>
                        <TD className="font-medium">{grant.email || grant.subject}</TD>
                        <TD className="text-muted-foreground">{grant.provider_id}</TD>
                        <TD>
                          <Badge tone={grant.role === 'admin' ? 'warning' : 'info'}>{grant.role}</Badge>
                        </TD>
                        <TD className="max-w-[22rem] truncate text-xs text-muted-foreground">
                          {grant.product_scopes?.join(', ')}
                        </TD>
                        <TD>
                          {grant.revoked_at ? (
                            <Badge tone="danger">revoked</Badge>
                          ) : (
                            <Confirm
                              title="Revoke this grant?"
                              description={
                                <>
                                  <strong>{grant.email || grant.subject}</strong> loses access at once, including every
                                  OAuth token and browser session issued from this grant.
                                </>
                              }
                              confirmLabel="Revoke"
                              destructive
                              onConfirm={async () => {
                                await ck.credentials.revokeGrant(grant.id)
                                await client.invalidateQueries({ queryKey: keys.credentials.grants })
                              }}
                            >
                              {(open) => (
                                <Button size="sm" variant="ghost" onClick={open}>
                                  Revoke
                                </Button>
                              )}
                            </Confirm>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TableState>
                </TBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </Page>
  )
}

function CreateApiKey({ onCreated }: { onCreated: (created: CreatedApiKey) => void }) {
  const client = useQueryClient()
  const [isOpen, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(['content:read'])

  const create = useMutation({
    mutationFn: () => ck.credentials.createApiKey({ name, scopes }),
    onSuccess: async (created) => {
      setOpen(false)
      setName('')
      onCreated(created)
      await client.invalidateQueries({ queryKey: keys.credentials.apiKeys })
    },
  })

  if (!isOpen)
    return (
      <Button data-testid="api-key-new" size="sm" variant="outline" onClick={() => setOpen(true)}>
        New key
      </Button>
    )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>New API key</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div>
            <Label>Scopes</Label>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {PRODUCT_SCOPES.map((scope) => (
                <label key={scope} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={(event) =>
                      setScopes(event.target.checked ? [...scopes, scope] : scopes.filter((value) => value !== scope))
                    }
                  />
                  {scope}
                </label>
              ))}
            </div>
          </div>
          {create.error ? (
            <p className="text-sm text-chart-5">
              {create.error instanceof Error ? create.error.message : 'Could not create the key'}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid="api-key-create-submit"
              onClick={() => create.mutate()}
              disabled={!name || scopes.length === 0 || create.isPending}
            >
              Create key
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/** The raw key exists in exactly one response. Once dismissed it is unrecoverable. */
function RevealedKey({ created, onDismiss }: { created: CreatedApiKey; onDismiss: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Copy this key now</CardTitle>
          <p className="text-sm text-muted-foreground">
            It is shown once and never again — ContentKit stores only a hash.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <code
            data-testid="api-key-secret"
            className="block break-all rounded-lg border border-border bg-muted p-3 font-mono text-xs"
          >
            {created.api_key}
          </code>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => navigator.clipboard?.writeText(created.api_key)}>
              Copy
            </Button>
            <Button onClick={onDismiss}>I have stored it</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Audit ────────────────────────────────────────────────────────────────────

export function AuditPage() {
  const [action, setAction] = useState('')
  const query = action ? { action } : undefined
  const events = useQuery({ queryKey: keys.audit(query), queryFn: () => ck.audit(query as never) })
  const rows = events.data ?? []

  return (
    <Page title="Audit" description="Append-only, redacted record of every privileged action.">
      <div className="mb-3">
        <Select value={action} onChange={(event) => setAction(event.target.value)}>
          <option value="">All actions</option>
          {[...new Set(rows.map((event) => event.action))].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </div>
      <div className="rounded-xl border border-border bg-surface">
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Actor</TH>
              <TH>Action</TH>
              <TH>Resource</TH>
              <TH>Result</TH>
              <TH>Transport</TH>
            </TR>
          </THead>
          <TBody>
            <TableState
              columns={6}
              isLoading={events.isPending}
              error={events.error}
              isEmpty={rows.length === 0}
              onRetry={() => events.refetch()}
            >
              {rows.map((event) => (
                <TR key={event.id} data-testid="audit-row">
                  <TD className="whitespace-nowrap text-muted-foreground">{formatDate(event.created_at)}</TD>
                  <TD className="text-muted-foreground">{event.actor_type}</TD>
                  <TD className="font-mono text-xs">{event.action}</TD>
                  <TD className="text-muted-foreground">{event.resource_type ?? '—'}</TD>
                  <TD>
                    <Badge tone={event.result === 'success' ? 'success' : 'danger'}>{event.result}</Badge>
                  </TD>
                  <TD className="text-muted-foreground">{event.transport ?? '—'}</TD>
                </TR>
              ))}
            </TableState>
          </TBody>
        </Table>
      </div>
    </Page>
  )
}
