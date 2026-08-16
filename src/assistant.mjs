import { randomUUID } from 'node:crypto'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  jsonSchema,
  stepCountIs,
  streamText,
  tool,
} from 'ai'
import { visibleTools } from './mcp/tools.mjs'

// The console's authoring assistant.
//
// It adds no capabilities: every tool it can call is one of ContentKit's own
// MCP tools, resolved through the same scope filter and validated by the same
// zod schema. The MCP server does exactly four things around a tool call —
// filter by principal, parse the input, build an elicitation context, execute —
// and this does the same four with a different elicitation transport. Nothing
// is reimplemented, so the two surfaces cannot drift apart in what they permit.
const MAX_STEPS = 12
const MAX_MESSAGES = 60

/**
 * The model providers a deployment can select. Only the credential and the
 * model id differ; nothing below this map is provider-aware, so the tools, the
 * scope ceiling and the elicitation transport are identical whichever one runs.
 *
 * No provider option is set here on purpose. The advertised tool schemas are
 * ContentKit's MCP schemas, which carry optional properties and defaults, and a
 * strict JSON-schema mode would reject every one of them at call time while
 * boot and health checks stayed green. Providers must receive these schemas as
 * they are.
 */
const providers = Object.freeze({
  anthropic: (apiKey, fetchImpl) => createAnthropic({ apiKey, fetch: fetchImpl }),
  openai: (apiKey, fetchImpl) => createOpenAI({ apiKey, fetch: fetchImpl }),
  google: (apiKey, fetchImpl) => createGoogleGenerativeAI({ apiKey, fetch: fetchImpl }),
})

export const assistantProviders = Object.freeze(Object.keys(providers))

const INSTRUCTIONS = `You are the authoring assistant inside ContentKit Cockpit, helping an operator produce and inspect content.

ContentKit is a release-oriented Markdown CMS. Content lives in immutable revisions; nothing reaches a live site until a release is built and activated.

How to work:
- Search and read the published snapshot before writing, so you build on what exists instead of contradicting it.
- Author by creating draft revisions. Compile compositions and decks to inspect diagnostics before proposing a publish.
- Prefer showing the operator a draft and its diagnostics over describing what you would do.

Your replies are rendered through ContentKit's own publishing pipeline, so write ContentKit Markdown, not plain prose. Use what carries meaning: tables for comparisons, fenced code with a language, \`\`\`mermaid fences for flows and relationships, $math$ where it is exact, and the semantic directives — :::metric for a single number that matters, :::process for ordered steps, :::timeline for history, :::comparison for options, :::chart for a series. Reach for a directive when it states the shape of the information; ordinary prose is right for everything else.

Directives are validated exactly as a publish would validate them, and a single missing attribute makes the whole reply unrenderable — the operator then sees the refusal instead of your answer. Attributes go on the opening line and the block is closed by its own \`:::\`. Copy these shapes:

:::metric{label="Publications" value="12,480" period="30 days" trend="+8%"}
:::

:::chart{type="line" title="Publications per week" description="Completed publications" unit="Documents"}
| Week | Publications |
| --- | ---: |
| KW 27 | 2640 |
| KW 28 | 2910 |
:::

:::progress{label="Monthly budget" value="68" max="100"}
:::

:::card{title="Current finding"}
Prose goes in the body.
:::

What you must not do:
- Never claim a publication, activation, deletion or credential change happened unless the tool call returned success.
- Publishing and administrative changes require the operator's explicit confirmation, which appears to them as an approval card. You cannot give that confirmation yourself, and a declined or expired card means nothing changed. Say so plainly rather than retrying.
- Never invent content that a source does not support, and never put a secret into your reply.`

/**
 * Pending human decisions, keyed by an id the browser echoes back.
 *
 * Deliberately in-memory and bound to the request that created it: if the
 * stream dies the entry is rejected, the tool call fails and no approval is
 * left dangling for a later, unrelated request to satisfy. That is the same
 * fail-closed coupling the MCP transport gets from `relatedRequestId`.
 */
export function createElicitations() {
  const pending = new Map()

  function request(params, { signal, timeoutMs, onEmit }) {
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const settle = (outcome) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        pending.delete(id)
        resolve(outcome)
      }
      const timer = setTimeout(() => settle({ action: 'cancel' }), timeoutMs)
      const onAbort = () => {
        clearTimeout(timer)
        pending.delete(id)
        reject(Object.assign(new Error('The conversation was interrupted before you decided.'), { statusCode: 409 }))
      }
      if (signal?.aborted) return onAbort()
      signal?.addEventListener('abort', onAbort, { once: true })
      pending.set(id, settle)
      onEmit({ id, ...params })
    })
  }

  function resolve(id, outcome) {
    const settle = pending.get(id)
    if (!settle) return false
    settle(outcome)
    return true
  }

  return {
    request,
    resolve,
    get size() {
      return pending.size
    },
  }
}

/**
 * Tool results become a model message, and only JSON values are valid there.
 * Postgres hands `timestamptz` columns back as Date instances through `pg`, so
 * any tool returning a row — which is most of them — would otherwise fail the
 * entire turn with "the messages do not match the ModelMessage[] schema",
 * after the tool had already run and its effect had already happened.
 *
 * The MCP transport never hits this because it serializes results on the way
 * out. This is the same normalisation, made explicit.
 */
export function jsonSafe(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value))
}

// fetchImpl is the same seam createTtsProvider uses: the only way to assert
// what a provider is actually sent is to look at the request it makes.
export function createAssistant(config, deps, fetchImpl = fetch) {
  if (!config.assistantApiKey) return null

  const provider = providers[config.assistantProvider]
  // Unreachable through loadConfig, which rejects an unknown provider at boot.
  // Kept because createAssistant is also constructed from hand-built config.
  if (!provider) {
    throw new Error(`CONTENTKIT_LLM_PROVIDER must be one of ${assistantProviders.join(', ')}`)
  }
  const model = provider(config.assistantApiKey, fetchImpl)(config.assistantModel)
  const elicitations = createElicitations()
  const timeoutMs = config.mcpElicitationTimeoutMs || 5 * 60 * 1000

  /**
   * Wraps ContentKit's tool candidates as AI SDK tools.
   *
   * The advertised schema is `candidate.inputSchema` — the same flattened
   * draft-2020-12 object the MCP manifest advertises, because a union at the
   * schema root is rejected by strict clients. Validation still runs the exact
   * zod union via `candidate.schema`, so a flattened advertisement can never
   * widen what is actually accepted.
   */
  function toolsFor(principal, context) {
    return Object.fromEntries(
      visibleTools(principal).map((candidate) => [
        candidate.name,
        tool({
          description: candidate.description,
          inputSchema: jsonSchema(candidate.inputSchema),
          execute: async (input) => {
            const started = Date.now()
            // Inside the try: a rejected tool input is the failure a model is
            // most likely to produce, and parsing outside it made `outcome:
            // 'error'` undercount by exactly that class. `parsed` is read back
            // afterwards so a schema rejection still records the raw input.
            let parsed
            try {
              parsed = candidate.schema.parse(input ?? {})
              const result = await candidate.execute(deps, principal, parsed, context)
              await record(candidate, principal, parsed, result, started, 'success')
              return jsonSafe(result)
            } catch (error) {
              await record(candidate, principal, parsed ?? input, null, started, 'error')
              // Surfaced to the model as a tool failure rather than killing the
              // stream: a declined confirmation is a normal outcome it must be
              // able to read and report honestly.
              throw error
            }
          },
        }),
      ]),
    )
  }

  async function record(candidate, principal, input, result, started, outcome) {
    try {
      const resultCount = ['items', 'results', 'sites', 'events', 'releases', 'comments']
        .map((key) => result?.[key])
        .find(Array.isArray)?.length
      const siteId = input?.site ? (await deps.repo.getSite(input.site))?.id : result?.site_id
      await deps.usage?.recordMcp?.({
        operation: 'tool_call',
        principal,
        sessionId: null,
        toolName: candidate.name,
        siteId,
        resultCount,
        durationMs: Date.now() - started,
        outcome,
        requestSource: 'cockpit',
      })
    } catch {
      // Telemetry must never be the reason an authoring turn fails.
    }
  }

  return {
    /** Lets the console tell "not deployed" apart from "not permitted". */
    enabled: true,

    resolveElicitation(id, outcome) {
      return elicitations.resolve(id, outcome)
    },

    /**
     * The tool names this principal would actually be offered on a turn.
     *
     * The scope ceiling is this surface's central promise, and it was assertable
     * only by calling `visibleTools` directly — which says nothing about what
     * the assistant does with the answer. Asking the assistant itself is the
     * only question worth testing. A turn's `context` cannot change the answer,
     * so none is required to ask.
     */
    toolNames(principal) {
      return Object.keys(toolsFor(principal, null))
    },

    /**
     * Streams one assistant turn. Returns a Web `Response` carrying the AI SDK
     * UI message stream, which `useChat` in the Cockpit consumes directly.
     */
    stream(principal, { messages, site }, signal) {
      const trimmed = (messages || []).slice(-MAX_MESSAGES)

      const uiStream = createUIMessageStream({
        execute: async ({ writer }) => {
          // The elicitation context ContentKit's tools already expect. Only the
          // transport differs from the MCP mount: a data part on this stream
          // instead of an `elicitation/create` request on a JSON-RPC session.
          const context = {
            async elicitForm(params) {
              return elicitations.request(
                { mode: 'form', message: params.message, requestedSchema: params.requestedSchema },
                {
                  signal,
                  timeoutMs,
                  onEmit: (payload) => writer.write({ type: 'data-elicitation', id: payload.id, data: payload }),
                },
              )
            },
            // URL elicitation hands a one-time page to the human. The secret
            // travels through that page and never through the conversation, so
            // it stays out of the model's context exactly as on MCP.
            async elicitUrl(params) {
              deps.secretHandoffs?.setNotifier?.(params.elicitationId, () => {})
              return elicitations.request(
                { mode: 'url', message: params.message, url: params.url },
                {
                  signal,
                  timeoutMs,
                  onEmit: (payload) => writer.write({ type: 'data-elicitation', id: payload.id, data: payload }),
                },
              )
            },
          }

          const result = streamText({
            model,
            instructions: site ? `${INSTRUCTIONS}\n\nThe operator is working on the site \`${site}\`.` : INSTRUCTIONS,
            // Async despite what the bundled type declaration claims: without
            // the await, streamText receives a Promise and fails deep inside
            // with "messages.some is not a function".
            messages: await convertToModelMessages(trimmed),
            tools: toolsFor(principal, context),
            stopWhen: stepCountIs(MAX_STEPS),
            abortSignal: signal,
            onError: ({ error }) =>
              deps.logger?.warn?.('assistant turn failed', { error: String(error?.message || error) }),
          })

          writer.merge(result.toUIMessageStream({ sendReasoning: false }))
        },
        onError: (error) => (error instanceof Error ? error.message : 'The assistant could not complete this turn'),
      })

      return createUIMessageStreamResponse({ stream: uiStream })
    },
  }
}
