import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '@modelcontextprotocol/sdk/types.js'
import { buildToolManifest, findTool } from './tools.mjs'
import { createSessionManager, ownerKey, trackStreamLifetime } from './session-manager.mjs'

const INSTRUCTIONS = `ContentKit is a release-oriented Markdown CMS with semantic and narrative information architecture, truthful visual compositions, and slide decks.

Start with contentkit_context. Search/read the active published snapshot before authoring. contentkit_ingest only creates immutable draft revisions. Use contentkit_composition and contentkit_deck to inspect diagnostics and source traceability before publishing. Preview first when practical.

Only tools allowed by the current credential are listed. Publication, activation, unpublishing, deletion, credential changes, identity changes and administrative mutations require native human elicitation. The model must never infer confirmation. Decline, cancel, timeout or unsupported elicitation makes no change.

Read contentkit://system/agent-guide for the complete workflow and contentkit://docs/llms.txt for documentation routing.`

const RESOURCES = [
  {
    uri: 'contentkit://system/agent-guide',
    name: 'ContentKit agent guide',
    description: 'Domain workflow, safety boundaries, semantic composition and deck guidance.',
    file: 'MCP.md',
    mimeType: 'text/markdown',
  },
  {
    uri: 'contentkit://docs/llms.txt',
    name: 'ContentKit documentation index',
    description: 'Compact documentation index for agents.',
    file: 'llms.txt',
    mimeType: 'text/plain',
  },
  {
    uri: 'contentkit://docs/llms-full.txt',
    name: 'ContentKit full documentation',
    description: 'Complete API, MCP, auth, schemas and operations reference.',
    file: 'llms-full.txt',
    mimeType: 'text/plain',
  },
  {
    uri: 'contentkit://docs/openapi.json',
    name: 'ContentKit REST OpenAPI',
    description: 'The REST contract. MCP transport and OAuth discovery are documented separately.',
    file: 'openapi.json',
    mimeType: 'application/json',
  },
]

const PROMPTS = [
  {
    name: 'contentkit_author',
    title: 'Author safely',
    description: 'Read context, draft ContentKit Markdown, validate and preview without publishing.',
    arguments: [
      { name: 'task', description: 'The requested content outcome.', required: true },
      { name: 'site', description: 'Optional site UUID or slug.', required: false },
    ],
  },
  {
    name: 'contentkit_visualize',
    title: 'Design a semantic visualization',
    description: 'Design a truthful semantic/narrative composition with accessible fallbacks.',
    arguments: [
      { name: 'task', required: true },
      { name: 'site', required: false },
    ],
  },
  {
    name: 'contentkit_deck',
    title: 'Design a narrative deck',
    description: 'Plan and compile a source-traceable slide deck.',
    arguments: [
      { name: 'task', required: true },
      { name: 'site', required: false },
    ],
  },
  {
    name: 'contentkit_publish_review',
    title: 'Review a release',
    description: 'Inspect exact revisions, diagnostics and preview before asking a human to publish.',
    arguments: [
      { name: 'site', required: true },
      { name: 'revision_ids', description: 'Comma-separated revision UUIDs.', required: true },
    ],
  },
]

function requestId() {
  return randomBytes(6).toString('hex')
}

function jsonRpcError(status, code, message, headers = {}) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}

function validateRequest(request, config) {
  const origin = request.headers.get('origin')
  if (origin) {
    let valid = false
    try {
      const parsed = new URL(origin)
      const publicUrl = new URL(config.publicUrl)
      const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
      valid =
        parsed.origin === publicUrl.origin ||
        (loopback.has(publicUrl.hostname) && loopback.has(parsed.hostname) && parsed.port === publicUrl.port)
    } catch {}
    if (!valid) return jsonRpcError(403, -32000, 'Forbidden: invalid Origin header')
  }
  const version = request.headers.get('mcp-protocol-version')
  if (version && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    return jsonRpcError(400, -32000, `Bad Request: unsupported protocol version ${version}`)
  }
  return null
}

function outcome(error) {
  if (error?.cancelled) return 'cancelled'
  if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) return 'timeout'
  const status = error?.statusCode || error?.status
  return status && status < 500 ? 'client_error' : 'server_error'
}

function toolError(error, id) {
  const status = error?.statusCode || error?.status || 500
  const message = status >= 500 ? 'ContentKit could not complete the operation.' : String(error.message || error)
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          error: message,
          request_id: id,
          next_best_actions:
            status === 403
              ? ['call tools/list and use an operation visible to this credential']
              : status === 422
                ? ['correct the input using the tool schema and diagnostics']
                : ['inspect the target state and retry only when appropriate'],
        }),
      },
    ],
  }
}

function promptMessages(name, args = {}) {
  const site = args.site ? ` Site: ${args.site}.` : ''
  if (name === 'contentkit_author')
    return `Use ContentKit to complete this authoring task: ${args.task}.${site} Call contentkit_context, then search/read existing published content. Draft and ingest an immutable revision, validate semantic/narrative output, and create a preview. Do not publish unless the user separately requests it and confirms through native elicitation.`
  if (name === 'contentkit_visualize')
    return `Design a ContentKit semantic visual for: ${args.task}.${site} Preserve source claims in the semantic model, make the narrative thesis explicit, use contentkit_composition recommend then validate, and report accessibility and diagnostic results. Do not substitute decorative graphics for information architecture.`
  if (name === 'contentkit_deck')
    return `Create a source-traceable ContentKit deck for: ${args.task}.${site} Establish audience, question, thesis, evidence arc, limitations, conclusion and action. Use contentkit_deck plan, validate and compile; preserve slide source_refs and surface all fallback diagnostics.`
  return `Review a ContentKit publication for site ${args.site}. Exact revision IDs: ${args.revision_ids}. Read the revisions, validate compositions/decks, build a preview, and summarize the live-site delta. Only then call contentkit_publish; the human must decide in native elicitation.`
}

async function docsText(config, file) {
  try {
    return await readFile(join(config.root, file === 'MCP.md' ? file : `docs/${file}`), 'utf8')
  } catch {
    return null
  }
}

export function createSessionServer(config, deps, principal, sessionId = () => null) {
  const server = new Server(
    { name: 'contentkit', version: config.version },
    { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: INSTRUCTIONS },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    await deps.usage.recordMcp({ operation: 'tools_list', principal, sessionId: sessionId() })
    return { tools: buildToolManifest(principal) }
  })
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    await deps.usage.recordMcp({ operation: 'resources_list', principal, sessionId: sessionId() })
    const available = []
    for (const resource of RESOURCES) if ((await docsText(config, resource.file)) !== null) available.push(resource)
    return { resources: available.map(({ file, ...resource }) => resource) }
  })
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = RESOURCES.find((entry) => entry.uri === request.params.uri)
    const text = resource ? await docsText(config, resource.file) : null
    if (!resource || text === null)
      throw new McpError(ErrorCode.InvalidParams, `unknown resource: ${request.params.uri}`)
    await deps.usage.recordMcp({
      operation: 'resource_read',
      resourceKind: 'documentation',
      principal,
      sessionId: sessionId(),
    })
    return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text }] }
  })
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    await deps.usage.recordMcp({ operation: 'prompts_list', principal, sessionId: sessionId() })
    return { prompts: PROMPTS }
  })
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = PROMPTS.find((entry) => entry.name === request.params.name)
    if (!prompt) throw new McpError(ErrorCode.InvalidParams, `unknown prompt: ${request.params.name}`)
    await deps.usage.recordMcp({ operation: 'prompt_get', resourceKind: 'prompt', principal, sessionId: sessionId() })
    return {
      description: prompt.description,
      messages: [
        { role: 'user', content: { type: 'text', text: promptMessages(prompt.name, request.params.arguments) } },
      ],
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const id = requestId()
    const started = Date.now()
    const candidate = findTool(principal, request.params.name)
    if (!candidate)
      return toolError(Object.assign(new Error(`unknown tool: ${request.params.name}`), { statusCode: 404 }), id)
    try {
      const input = candidate.schema.parse(request.params.arguments || {})
      const capabilities = server.getClientCapabilities()?.elicitation
      const formCapable =
        capabilities !== undefined && (capabilities.form !== undefined || capabilities.url === undefined)
      const urlCapable = capabilities?.url !== undefined
      const context = {
        async elicitForm(params) {
          if (!formCapable)
            throw Object.assign(new Error('This operation requires MCP form elicitation support.'), { statusCode: 409 })
          return server.request(
            { method: 'elicitation/create', params: { mode: 'form', ...params } },
            // Server.elicitInput validates accepted content and handles the current result schema.
            // Using it here would reject the backwards-compatible elicitation:{} capability.
            (await import('@modelcontextprotocol/sdk/types.js')).ElicitResultSchema,
            {
              relatedRequestId: extra.requestId,
              signal: extra.signal,
              timeout: config.mcpElicitationTimeoutMs,
              maxTotalTimeout: config.mcpElicitationTimeoutMs,
            },
          )
        },
        ...(urlCapable
          ? {
              async elicitUrl(params) {
                deps.secretHandoffs.setNotifier(
                  params.elicitationId,
                  server.createElicitationCompletionNotifier(params.elicitationId),
                )
                return server.elicitInput(params, {
                  relatedRequestId: extra.requestId,
                  signal: extra.signal,
                  timeout: config.mcpElicitationTimeoutMs,
                  maxTotalTimeout: config.mcpElicitationTimeoutMs,
                })
              },
            }
          : {}),
      }
      const result = await candidate.execute(deps, principal, input, context)
      const resultCount = ['items', 'results', 'sites', 'events', 'releases', 'comments']
        .map((key) => result?.[key])
        .find(Array.isArray)?.length
      const siteId = input.site ? (await deps.repo.getSite(input.site))?.id : result?.site_id
      await deps.usage.recordMcp({
        operation: 'tool_call',
        principal,
        sessionId: sessionId(),
        toolName: candidate.name,
        siteId,
        resultCount,
        durationMs: Date.now() - started,
        outcome: 'success',
      })
      return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (error) {
      const siteId = request.params.arguments?.site
        ? (await deps.repo.getSite(request.params.arguments.site).catch(() => null))?.id
        : null
      await deps.usage.recordMcp({
        operation: 'tool_call',
        principal,
        sessionId: sessionId(),
        toolName: candidate.name,
        siteId,
        durationMs: Date.now() - started,
        outcome: outcome(error),
      })
      deps.logger.warn('mcp tool call failed', {
        tool: candidate.name,
        request_id: id,
        actor_id: principal.id,
        error: String(error.message || error),
      })
      return toolError(error, id)
    }
  })
  return server
}

function sessionNotFound() {
  return jsonRpcError(404, -32001, 'Session not found')
}

function isEventStream(response) {
  return response.headers.get('content-type')?.includes('text/event-stream') || false
}

export function createMcpMount(config, deps) {
  const manager = createSessionManager({
    ttlMs: config.mcpSessionTtlMs,
    maxSessions: config.mcpMaxSessions,
    logger: deps.logger,
    onEvict: ({ sessionId, reason, activeSessions }) =>
      void deps.usage.recordMcp({
        operation: `session_evicted_${reason}`,
        sessionId,
        activeSessions,
        outcome: reason === 'shutdown' ? 'cancelled' : 'success',
      }),
  })

  async function handler(request) {
    const guard = validateRequest(request, config)
    if (guard) {
      await deps.usage.recordMcp({ operation: 'transport_rejected', outcome: 'rejected' })
      return guard
    }
    const principal = await deps.auth.authenticate(request.headers)
    if (!principal) {
      await deps.usage.recordMcp({ operation: 'authentication_rejected', outcome: 'rejected' })
      return new Response(JSON.stringify({ error: 'authentication required' }), {
        status: 401,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'www-authenticate': `Bearer resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource/mcp", scope="${config.oauthAllowedScopes.join(' ')}"`,
        },
      })
    }

    const requestedId = request.headers.get('mcp-session-id')
    let session = requestedId ? manager.sessions.get(requestedId) : undefined
    if (requestedId && (!session || session.owner !== ownerKey(principal))) return sessionNotFound()
    let fresh = false
    let registered = false
    let reserved = false
    if (!session) {
      fresh = true
      if (!manager.reserve()) {
        await deps.usage.recordMcp({ operation: 'session_capacity_rejected', outcome: 'rejected' })
        return jsonRpcError(503, -32002, 'Server busy: MCP session capacity reached')
      }
      reserved = true
      const transportRef = {}
      const leaseRef = {}
      const server = createSessionServer(config, deps, principal, () => transportRef.current?.sessionId || null)
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: false,
        onsessioninitialized: (id) => {
          if (!leaseRef.current) return
          registered = true
          manager.commit(id, leaseRef.current)
          reserved = false
          manager.startSweeper()
          deps.logger.info('mcp session initialized', {
            session_id: id,
            actor_id: principal.id,
            sessions_open: manager.sessions.size,
          })
          void deps.usage.recordMcp({
            operation: 'session_initialized',
            principal,
            sessionId: id,
            activeSessions: manager.sessions.size,
          })
        },
        onsessionclosed: (id) => {
          manager.sessions.delete(id)
          if (manager.sessions.size === 0) manager.stopSweeper()
          void deps.usage.recordMcp({
            operation: 'session_closed',
            principal,
            sessionId: id,
            activeSessions: manager.sessions.size,
          })
        },
      })
      transportRef.current = transport
      transport.onerror = (error) => deps.logger.warn('mcp transport error', { error: error.message })
      leaseRef.current = { transport, server, owner: ownerKey(principal), lastSeenAt: Date.now(), inFlight: 0 }
      try {
        await server.connect(transport)
      } catch (error) {
        manager.releaseReservation()
        await server.close().catch(() => {})
        throw error
      }
      session = leaseRef.current
    }

    if (request.method === 'GET') session.transport.closeStandaloneSSEStream()
    manager.retain(session)
    let streamed = false
    const started = Date.now()
    try {
      const response = await session.transport.handleRequest(request)
      const mode = !response.body ? 'none' : isEventStream(response) ? 'sse' : 'json'
      await deps.usage.recordMcp({
        operation: `transport_${request.method.toLowerCase()}`,
        principal,
        sessionId: session.transport.sessionId,
        outcome: response.status >= 500 ? 'server_error' : response.status >= 400 ? 'client_error' : 'success',
        durationMs: Date.now() - started,
        responseMode: mode,
        activeSessions: manager.sessions.size,
      })
      if (!response.body || mode !== 'sse') return response
      streamed = true
      return new Response(
        trackStreamLifetime(response.body, {
          release: () => manager.release(session),
          reacquire: () => manager.retain(session),
          onForceReleased: () =>
            deps.logger.warn('unconsumed MCP SSE body released', { session_id: session.transport.sessionId }),
        }),
        { status: response.status, statusText: response.statusText, headers: response.headers },
      )
    } finally {
      if (!streamed) manager.release(session)
      if (fresh && !registered) {
        if (reserved) manager.releaseReservation()
        void session.server.close().catch(() => {})
      }
    }
  }
  return { handler, sessions: manager, stop: () => manager.closeAll() }
}
