import { useChat } from '@ai-sdk/react'
import { useQuery } from '@tanstack/react-query'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BotMessageSquare, ExternalLink, ShieldQuestionMark, TriangleAlert } from 'lucide-react'
import { Page } from '@/app/shell'
import { useI18n } from '@/lib/i18n-context'
import { ModelAttribution } from '@/components/ai/model-attribution'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/forms/status-badge'
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
  const { t } = useI18n()
  const { site } = useSite()
  const [input, setInput] = useState('')
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [model, setModel] = useState<string | null>(null)
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
      .then((response) => {
        setEnabled(response.status !== 404)
        // The same probe now answers WHICH model replies — CUI-AI-2. This page
        // streams a model's prose and attributed it to nobody, which it could
        // not fix on its own: the model is deployment configuration, and the
        // stream carries text. Null when the header is absent, and the
        // attribution then renders nothing rather than inventing a name.
        setModel(response.headers.get('x-assistant-model'))
      })
      .catch(() => setEnabled(false))
  }, [])

  if (enabled === false) {
    return (
      <Page title={t('page.assistant.title')}>
        {/* Not a failure and not a blank list: the feature exists and this
            deployment has not switched it on, which is what Empty says. */}
        <Empty className="border" data-testid="assistant-disabled">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BotMessageSquare />
            </EmptyMedia>
            <EmptyTitle>{t('assistant.disabledTitle')}</EmptyTitle>
            <EmptyDescription>
              {t('assistant.disabledDescription')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Page>
    )
  }

  return (
    <Page
      title={t('page.assistant.title')}
      description={t('assistant.description')}
      actions={
        <div className="flex items-center gap-3">
          {/* Which model is answering, beside the words it produces — CUI-AI-2.
              Not on a settings page and not behind a disclosure: this is where
              somebody decides whether to act on what they just read. */}
          <ModelAttribution model={model} />
          {messages.length > 0 ? (
            <Button
              variant="outline"
              data-testid="assistant-new"
              onClick={() => {
                setMessages([])
                void saveConversation([])
                void clearRenders()
              }}
            >
              {t('assistant.newConversation')}
            </Button>
          ) : null}
        </div>
      }
    >
      <Card className="h-[calc(100vh-11rem)] gap-0 py-0">
        <div className="scrollbar-thin flex flex-1 flex-col gap-4 overflow-y-auto p-5">
          {messages.length === 0 ? (
            <Empty data-testid="assistant-blank">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BotMessageSquare />
                </EmptyMedia>
                <EmptyTitle>{t('assistant.emptyTitle')}</EmptyTitle>
                <EmptyDescription>{t('assistant.emptyDescription')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
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

          {error ? (
            <Alert variant="destructive" data-testid="assistant-error">
              <TriangleAlert />
              <AlertTitle>{t('assistant.stopped')}</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : null}
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
            placeholder={site ? t('assistant.workingOn', { site }) : t('assistant.chooseSite')}
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
              {t('assistant.stop')}
            </Button>
          ) : (
            <Button data-testid="assistant-send" type="submit" disabled={!site || !input.trim()}>
              {t('assistant.send')}
            </Button>
          )}
        </form>
      </Card>
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
      <div className={cn('flex max-w-[85%] flex-col gap-2', mine && 'items-end text-right')}>
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
      <Draft markdown={text} unrendered={Boolean(rendered.error)} />
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
  const { t } = useI18n()
  const rejected = error instanceof ApiError && error.status === 422
  return (
    <Alert
      variant="destructive"
      className="mt-2"
      data-testid="assistant-render-problem"
      data-status={error instanceof ApiError ? error.status : 'unknown'}
    >
      {/* Direct child of Alert and before the title: the CVA switches to a
          two-column grid on `has-[>svg]`, and an icon in a wrapper breaks it. */}
      <TriangleAlert />
      <AlertTitle>{rejected ? t('assistant.notRenderable') : t('assistant.renderFailed')}</AlertTitle>
      <AlertDescription>{error instanceof Error ? error.message : String(error)}</AlertDescription>
    </Alert>
  )
}

function ToolCall({ part }: { part: { type: string; state?: string; toolName?: string } }) {
  const { t } = useI18n()
  const name = part.toolName ?? part.type.replace(/^tool-/, '')
  const done = part.state === 'output-available'
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1 text-xs">
      <StatusBadge tone={done ? 'success' : 'info'}>
        {done ? t('assistant.toolDone') : t('assistant.toolRunning')}
      </StatusBadge>
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
  const { t } = useI18n()
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
      if (!response.ok) throw new Error(t('assistant.decisionWithStatus', { status: response.status }))
      setResolved(action)
    } catch (error) {
      setFailed(error instanceof Error ? error.message : t('assistant.decisionFallback'))
    }
  }

  if (elicitation.mode === 'url')
    return (
      // A callout, so an Alert — and `role="alert"` is the component's own, which
      // is what gets a decision request announced rather than merely tinted.
      <Alert data-testid="assistant-elicitation" className="text-left">
        <ExternalLink />
        <AlertTitle>{elicitation.message}</AlertTitle>
        <AlertDescription>
          {t('assistant.secureDescription')}
        </AlertDescription>
        <div className="col-start-2 mt-2">
          {/*
            This opens a page; it changes nothing here. It was a filled button
            calling `window.open`, which is a link wearing a mutation's clothes —
            no middle-click, no "open in new tab", nothing to copy, and invisible
            to anything that reads the document for its links. It is an anchor
            now, styled as the console's one link.

            Rendered only when there is somewhere to go: an anchor with no href
            is not a link but unfocusable text that looks like one, and `url` is
            optional on the wire. Where it is absent the callout stands on its
            own words, which are the ones that matter.
          */}
          {elicitation.url ? (
            <Button asChild size="sm" variant="link" className="h-auto p-0">
              <a
                data-testid="assistant-elicitation-open"
                href={elicitation.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t('assistant.openSecurePage')}
              </a>
            </Button>
          ) : null}
        </div>
      </Alert>
    )

  return (
    <Alert data-testid="elicitation-card" className="text-left">
      <ShieldQuestionMark />
      <AlertTitle>{t('assistant.confirmationRequired')}</AlertTitle>
      <AlertDescription>{elicitation.message}</AlertDescription>
      {failed ? (
        // The refusal keeps its own frame rather than being a tinted line inside
        // this one: the decision was not recorded, which is a different fact from
        // the decision being asked for.
        <Alert variant="destructive" className="col-start-2 mt-2" data-testid="elicitation-failed">
          <TriangleAlert />
          <AlertTitle>{t('assistant.decisionFailed')}</AlertTitle>
          <AlertDescription>{failed}</AlertDescription>
        </Alert>
      ) : null}
      {resolved ? (
        <p className="col-start-2 mt-2 text-xs text-muted-foreground">
          {resolved === 'accept' ? t('assistant.approved') : t('assistant.declined')}
        </p>
      ) : (
        <div className="col-start-2 mt-3 flex gap-2">
          {/*
            The page's one filled button is `assistant-send`. This callout sits
            in the same scroll as the composer, so a second filled button here
            put two "the thing to do" controls on screen at once — and the one
            that was filled was a decision the operator should make on the
            request's own terms, not because it was the loud one. Approve leads,
            Decline is quieter still; neither pretends to be the page's purpose.
          */}
          <Button data-testid="elicitation-approve" size="sm" variant="outline" onClick={() => respond('accept')}>
            {t('assistant.approve')}
          </Button>
          <Button data-testid="elicitation-decline" size="sm" variant="ghost" onClick={() => respond('decline')}>
            {t('assistant.decline')}
          </Button>
        </div>
      )}
    </Alert>
  )
}
