import { useChat } from '@ai-sdk/react'
import { useQuery } from '@tanstack/react-query'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Page } from '@/app/shell'
import { Badge, Button, Card, CardContent, Textarea } from '@/components/ui/primitives'
import { ApiError, getCsrfToken } from '@/api/client'
import { ck } from '@/api/ck'
import { ContentHtml, Draft, useContentScheme } from '@/content/lazy'
import { clearRenders, loadConversation, loadRender, saveConversation, saveRender } from '@/lib/conversations'
import { keys } from '@/lib/query'
import { useSite } from '@/lib/site'
import { cn } from '@/lib/utils'

/**
 * The assistant reuses ContentKit's own MCP tool registry server-side, so the
 * tools it can call are exactly the ones the operator's scopes already allow —
 * no second permission model.
 *
 * Anything that mutates published state still asks a human. ContentKit's
 * `confirm()` contract is preserved verbatim; only its transport changed, and
 * it arrives here as a `data-elicitation` part rendered as an approval card.
 */
interface Elicitation {
  id: string
  message: string
  mode: 'form' | 'url'
  url?: string
  requestedSchema?: unknown
}

export function AssistantPage() {
  const { site } = useSite()
  const [input, setInput] = useState('')
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  // The AI SDK drives this POST itself, so it never passes through the API
  // client that attaches the CSRF header — without this every turn is rejected
  // with 403 before it reaches the model.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/v1/assistant/messages',
        credentials: 'same-origin',
        headers: () => ({ 'x-contentkit-csrf': getCsrfToken() }),
        body: () => ({ site }),
      }),
    [site],
  )

  const { messages, sendMessage, status, error, setMessages, stop } = useChat({ transport })

  // Conversations live in IndexedDB: no second database to operate, and the
  // history stays on the operator's own machine.
  useEffect(() => {
    loadConversation().then((stored) => stored.length && setMessages(stored as UIMessage[]))
  }, [setMessages])
  useEffect(() => {
    if (messages.length) void saveConversation(messages)
  }, [messages])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Without CONTENTKIT_ANTHROPIC_API_KEY the route does not exist at all.
  useEffect(() => {
    fetch('/v1/assistant/messages', { method: 'OPTIONS' })
      .then((response) => setEnabled(response.status !== 404))
      .catch(() => setEnabled(false))
  }, [])

  if (enabled === false) {
    return (
      <Page title="Assistant">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            The authoring assistant is not enabled on this deployment. Set{' '}
            <code className="rounded bg-muted px-1">CONTENTKIT_ANTHROPIC_API_KEY</code> to turn it on.
          </CardContent>
        </Card>
      </Page>
    )
  }

  return (
    <Page
      title="Assistant"
      description="Describe what you want to publish. The assistant drafts revisions; publishing still needs your explicit approval."
      actions={
        messages.length > 0 ? (
          <Button
            variant="outline"
            data-testid="assistant-new"
            onClick={() => {
              setMessages([])
              void saveConversation([])
              void clearRenders()
            }}
          >
            New conversation
          </Button>
        ) : null
      }
    >
      <div className="flex h-[calc(100vh-11rem)] flex-col rounded-xl border border-border bg-surface">
        <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Try: “Draft a post about our release process, then show me the composition diagnostics.”
            </p>
          ) : null}

          {messages.map((message, index) => (
            <Message
              key={message.id}
              message={message}
              // Only the last message can still be arriving, and only while the
              // run is open. Everything above it is final, which is what makes
              // "one render per finished message" decidable here.
              streaming={index === messages.length - 1 && (status === 'streaming' || status === 'submitted')}
            />
          ))}

          {error ? <p className="text-sm text-chart-5">{error.message}</p> : null}
          <div ref={bottom} />
        </div>

        <form
          className="flex gap-2 border-t border-border p-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!input.trim()) return
            sendMessage({ text: input })
            setInput('')
          }}
        >
          <Textarea
            data-testid="assistant-input"
            className="h-20 flex-1 resize-none"
            placeholder={site ? `Working on ${site}…` : 'Choose a site in the sidebar first'}
            value={input}
            disabled={!site}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (input.trim()) {
                  sendMessage({ text: input })
                  setInput('')
                }
              }
            }}
          />
          {status === 'streaming' || status === 'submitted' ? (
            <Button data-testid="assistant-stop" type="button" variant="outline" onClick={() => stop()}>
              Stop
            </Button>
          ) : (
            <Button data-testid="assistant-send" type="submit" disabled={!site || !input.trim()}>
              Send
            </Button>
          )}
        </form>
      </div>
    </Page>
  )
}

function Message({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  const mine = message.role === 'user'
  return (
    <div
      data-testid="assistant-message"
      data-id={message.id}
      data-role={message.role}
      className={cn('flex', mine && 'justify-end')}
    >
      <div className={cn('max-w-[85%] space-y-2', mine && 'text-right')}>
        {message.parts.map((part, index) => {
          if (part.type === 'text')
            return mine ? (
              <div
                key={index}
                className="inline-block whitespace-pre-wrap rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground"
              >
                {part.text}
              </div>
            ) : (
              <AssistantText key={index} id={`${message.id}:${index}`} text={part.text} streaming={streaming} />
            )

          if (part.type === 'data-elicitation')
            return <ApprovalCard key={index} elicitation={part.data as Elicitation} />

          if (part.type.startsWith('tool-') || part.type === 'dynamic-tool')
            return <ToolCall key={index} part={part as { type: string; state?: string; toolName?: string }} />

          return null
        })}
      </div>
    </div>
  )
}

/**
 * Assistant prose, in its two states.
 *
 * While the message is arriving it is a typographic draft: React elements, no
 * HTML, no ContentKit semantics (see src/content/draft.tsx). Rendering per token
 * would mean a server round-trip per token, and a half-arrived `:::` block is a
 * 422 by construction — so nothing is asked of the server until the message is
 * whole. Then exactly one request runs it through the very pipeline that would
 * publish it.
 *
 * The query key is the unit of that promise: one entry per message part and
 * colour scheme, never retried, cached across reloads in IndexedDB. Switching
 * the theme is a new key, because report charts are rasterised server-side and
 * no stylesheet can recolour an SVG that has already been drawn.
 */
function AssistantText({ id, text, streaming }: { id: string; text: string; streaming: boolean }) {
  const { site } = useSite()
  const scheme = useContentScheme()
  const key = `${site}:${id}:${scheme}`

  const rendered = useQuery({
    queryKey: keys.render(site, id, scheme),
    queryFn: async () => {
      const stored = await loadRender(key)
      if (stored !== null) return stored
      const result = await ck.render(site, { markdown: text, scheme })
      await saveRender(key, result.html)
      return result.html
    },
    enabled: Boolean(site) && !streaming && text.trim().length > 0,
    staleTime: Infinity,
    gcTime: Infinity,
    // A rejected fragment is a verdict, not a hiccup: asking again produces the
    // same 422, and the operator is meant to read it and fix the Markdown.
    retry: false,
  })

  if (rendered.data) return <ContentHtml html={rendered.data} scheme={scheme} testId="assistant-rendered" />

  return (
    <div className="text-left">
      <Draft markdown={text} />
      {rendered.error ? <RenderProblem error={rendered.error} /> : null}
    </div>
  )
}

/**
 * ContentKit's own refusal, shown verbatim. It is the same 422 a release would
 * raise, so surfacing it here is the point: the draft stays on screen, the rest
 * of the conversation keeps rendering, and the operator sees why this message
 * would not publish.
 */
function RenderProblem({ error }: { error: unknown }) {
  const rejected = error instanceof ApiError && error.status === 422
  return (
    <p
      data-testid="assistant-render-problem"
      data-status={error instanceof ApiError ? error.status : 'unknown'}
      className="mt-2 rounded-lg border border-chart-3/40 bg-chart-3/10 px-3 py-2 text-xs"
    >
      <span className="font-medium">{rejected ? 'Not renderable as published' : 'Rendering failed'}</span>{' '}
      <span className="text-muted-foreground">{error instanceof Error ? error.message : String(error)}</span>
    </p>
  )
}

function ToolCall({ part }: { part: { type: string; state?: string; toolName?: string } }) {
  const name = part.toolName ?? part.type.replace(/^tool-/, '')
  const done = part.state === 'output-available'
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1 text-xs">
      <Badge tone={done ? 'success' : 'info'}>{done ? 'done' : 'running'}</Badge>
      <span className="font-mono text-muted-foreground">{name}</span>
    </div>
  )
}

/**
 * The human decision, made in the UI and nowhere else. Declining, dismissing or
 * simply letting it time out all leave the system unchanged — the model never
 * gets to infer a confirmation.
 */
function ApprovalCard({ elicitation }: { elicitation: Elicitation }) {
  const [resolved, setResolved] = useState<'accept' | 'decline' | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  async function respond(action: 'accept' | 'decline') {
    setFailed(null)
    try {
      const response = await fetch(`/v1/assistant/elicitations/${elicitation.id}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          // The cookie is HttpOnly, so the value comes from the session, not document.cookie.
          'x-contentkit-csrf': getCsrfToken(),
        },
        body: JSON.stringify(action === 'accept' ? { action, content: { confirmed: true } } : { action }),
      })
      if (!response.ok) throw new Error(`The decision could not be recorded (${response.status})`)
      setResolved(action)
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'The decision could not be recorded')
    }
  }

  if (elicitation.mode === 'url')
    return (
      <div className="rounded-xl border border-accent/40 bg-accent/10 p-3 text-left text-sm">
        <p>{elicitation.message}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The secret is shown on a ContentKit page and never passes through the conversation.
        </p>
        <Button
          data-testid="assistant-elicitation-open"
          className="mt-2"
          size="sm"
          onClick={() => elicitation.url && window.open(elicitation.url, '_blank', 'noopener,noreferrer')}
        >
          Open secure page
        </Button>
      </div>
    )

  return (
    <div
      data-testid="elicitation-card"
      className="rounded-xl border border-chart-3/40 bg-chart-3/10 p-3 text-left text-sm"
    >
      <p className="font-medium">Your confirmation is required</p>
      <p className="mt-1 text-muted-foreground">{elicitation.message}</p>
      {failed ? <p className="mt-2 text-xs text-chart-5">{failed}</p> : null}
      {resolved ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {resolved === 'accept' ? 'Approved.' : 'Declined — nothing was changed.'}
        </p>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button data-testid="elicitation-approve" size="sm" onClick={() => respond('accept')}>
            Approve
          </Button>
          <Button data-testid="elicitation-decline" size="sm" variant="outline" onClick={() => respond('decline')}>
            Decline
          </Button>
        </div>
      )}
    </div>
  )
}
