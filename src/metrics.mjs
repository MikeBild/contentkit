export function createMetrics() {
  const requests = new Map()
  let builds = 0
  let buildMs = 0
  const deckBuilds = new Map()
  const deckCache = new Map()
  const deckJobs = new Map()
  const deckOperations = new Map()
  const mcpOperations = new Map()
  let deckBuildMs = 0
  let deckOutputBytes = 0
  // The assistant calls a model, and until 2026-08-20 that was the one thing
  // this process spent money on and did not count. Five sibling products
  // exposed llm_* families; this one exposed none, so its spend was findable
  // only by holding a provider invoice against nothing.
  const llmCalls = new Map()
  const llmTokens = new Map()
  const llmCachedTokens = new Map()
  const llmReasoningTokens = new Map()
  const llmCallMs = new Map()
  return {
    request(method, route, status) {
      const key = `${method}|${route}|${status}`
      requests.set(key, (requests.get(key) || 0) + 1)
    },
    build(ms) {
      builds++
      buildMs += ms
    },
    deckCache(result) {
      deckCache.set(result, (deckCache.get(result) || 0) + 1)
    },
    deckBuild({ result, duration_ms = 0, output_bytes = 0 }) {
      deckBuilds.set(result, (deckBuilds.get(result) || 0) + 1)
      deckBuildMs += Math.max(0, duration_ms)
      deckOutputBytes += Math.max(0, output_bytes)
    },
    deckJob(status) {
      deckJobs.set(status, (deckJobs.get(status) || 0) + 1)
    },
    deckOperation({ mode, result, execution = 'sync' }) {
      const key = `${mode}|${result}|${execution}`
      deckOperations.set(key, (deckOperations.get(key) || 0) + 1)
    },
    mcpOperation({ operation = 'unknown', outcome = 'success' }) {
      const key = `${operation}|${outcome}`
      mcpOperations.set(key, (mcpOperations.get(key) || 0) + 1)
    },
    /**
     * One completed assistant turn, however many model steps it took.
     *
     * `usage` is the AI SDK's LanguageModelUsage, already aggregated across
     * steps by `onEnd`. Two of its figures are BREAKDOWNS rather than additions:
     * the cache counts sit under `inputTokenDetails` and are part of
     * `inputTokens`; reasoning sits under `outputTokenDetails` and is part of
     * `outputTokens`. Both therefore get their own family, named after the
     * total they decompose, instead of another `direction` label on
     * llm_tokens_total. A label that cannot be summed without double counting
     * is a label that will be — the first draft of this function put reasoning
     * beside input and output, and summing the direction label would have
     * over-reported every turn that reasoned.
     *
     * Everything is coerced through `count()`: the SDK types every field as
     * `number | undefined`, a provider that omits one is normal, and `NaN`
     * reaching a counter poisons the series permanently.
     */
    llm({ model = 'unknown', outcome = 'success', durationMs = 0, usage = {} } = {}) {
      const count = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)
      const add = (map, key, value) => map.set(key, (map.get(key) || 0) + value)
      const input = usage.inputTokenDetails || {}
      const output = usage.outputTokenDetails || {}

      add(llmCalls, `${model}|${outcome}`, 1)
      add(llmCallMs, model, count(durationMs))
      add(llmTokens, `${model}|input`, count(usage.inputTokens))
      add(llmTokens, `${model}|output`, count(usage.outputTokens))
      add(llmReasoningTokens, model, count(output.reasoningTokens))
      add(llmCachedTokens, `${model}|read`, count(input.cacheReadTokens))
      add(llmCachedTokens, `${model}|write`, count(input.cacheWriteTokens))
    },
    render(inflight = 0, { deckInflight = 0, deckQueued = 0, mcpSessions = 0 } = {}) {
      const lines = ['# HELP contentkit_requests_total HTTP requests', '# TYPE contentkit_requests_total counter']
      for (const [key, value] of requests) {
        const [method, route, status] = key.split('|')
        lines.push(`contentkit_requests_total{method="${method}",route="${route}",status="${status}"} ${value}`)
      }
      lines.push('# TYPE contentkit_builds_total counter', `contentkit_builds_total ${builds}`)
      lines.push(
        '# TYPE contentkit_build_duration_milliseconds_total counter',
        `contentkit_build_duration_milliseconds_total ${buildMs}`,
      )
      lines.push('# TYPE contentkit_builds_inflight gauge', `contentkit_builds_inflight ${inflight}`)
      lines.push(
        '# TYPE contentkit_deck_builds_inflight gauge',
        `contentkit_deck_builds_inflight ${deckInflight}`,
        '# TYPE contentkit_deck_builds_queued gauge',
        `contentkit_deck_builds_queued ${deckQueued}`,
      )
      lines.push('# TYPE contentkit_deck_builds_total counter')
      for (const [result, value] of deckBuilds) lines.push(`contentkit_deck_builds_total{result="${result}"} ${value}`)
      lines.push('# TYPE contentkit_deck_cache_total counter')
      for (const [result, value] of deckCache) lines.push(`contentkit_deck_cache_total{result="${result}"} ${value}`)
      lines.push('# TYPE contentkit_deck_jobs_total counter')
      for (const [status, value] of deckJobs) lines.push(`contentkit_deck_jobs_total{status="${status}"} ${value}`)
      lines.push('# TYPE contentkit_deck_operations_total counter')
      for (const [key, value] of deckOperations) {
        const [mode, result, execution] = key.split('|')
        lines.push(
          `contentkit_deck_operations_total{mode="${mode}",result="${result}",execution="${execution}"} ${value}`,
        )
      }
      lines.push(
        '# TYPE contentkit_deck_build_duration_milliseconds_total counter',
        `contentkit_deck_build_duration_milliseconds_total ${deckBuildMs}`,
        '# TYPE contentkit_deck_output_bytes_total counter',
        `contentkit_deck_output_bytes_total ${deckOutputBytes}`,
      )
      // The assistant's model spend. HELP lines on all four, because a family
      // whose name has to be guessed from its labels is a family a reader skips.
      lines.push(
        '# HELP contentkit_llm_calls_total Completed assistant turns, one per turn regardless of model steps',
        '# TYPE contentkit_llm_calls_total counter',
      )
      for (const [key, value] of llmCalls) {
        const [model, outcome] = key.split('|')
        lines.push(`contentkit_llm_calls_total{model="${model}",outcome="${outcome}"} ${value}`)
      }
      lines.push(
        '# HELP contentkit_llm_tokens_total Tokens billed by the provider, by direction',
        '# TYPE contentkit_llm_tokens_total counter',
      )
      for (const [key, value] of llmTokens) {
        const [model, direction] = key.split('|')
        lines.push(`contentkit_llm_tokens_total{model="${model}",direction="${direction}"} ${value}`)
      }
      lines.push(
        // Stated in the HELP text, not only in the source: a reader summing
        // this into the family above would count the same tokens twice.
        '# HELP contentkit_llm_cached_tokens_total Cache reads and writes — a breakdown of input tokens, not additional to them',
        '# TYPE contentkit_llm_cached_tokens_total counter',
      )
      for (const [key, value] of llmCachedTokens) {
        const [model, kind] = key.split('|')
        lines.push(`contentkit_llm_cached_tokens_total{model="${model}",kind="${kind}"} ${value}`)
      }
      lines.push(
        '# HELP contentkit_llm_reasoning_tokens_total Reasoning tokens — a breakdown of output tokens, not additional to them',
        '# TYPE contentkit_llm_reasoning_tokens_total counter',
      )
      for (const [model, value] of llmReasoningTokens) {
        lines.push(`contentkit_llm_reasoning_tokens_total{model="${model}"} ${value}`)
      }
      lines.push(
        '# HELP contentkit_llm_call_duration_milliseconds_total Wall time spent in assistant turns',
        '# TYPE contentkit_llm_call_duration_milliseconds_total counter',
      )
      for (const [model, value] of llmCallMs) {
        lines.push(`contentkit_llm_call_duration_milliseconds_total{model="${model}"} ${value}`)
      }

      // Process gauges, read here rather than plumbed through a call site:
      // render() has exactly one caller and the numbers are ambient. Every
      // sibling product exposes these four; this one exposed none, so "is the
      // process healthy" was unanswerable from its own exposition.
      const mem = process.memoryUsage()
      lines.push(
        '# TYPE contentkit_process_memory_heap_used_bytes gauge',
        `contentkit_process_memory_heap_used_bytes ${mem.heapUsed}`,
        '# TYPE contentkit_process_memory_heap_total_bytes gauge',
        `contentkit_process_memory_heap_total_bytes ${mem.heapTotal}`,
        '# TYPE contentkit_process_memory_rss_bytes gauge',
        `contentkit_process_memory_rss_bytes ${mem.rss}`,
        '# TYPE contentkit_process_uptime_seconds gauge',
        `contentkit_process_uptime_seconds ${Math.round(process.uptime())}`,
      )

      lines.push('# TYPE contentkit_mcp_sessions gauge', `contentkit_mcp_sessions ${mcpSessions}`)
      lines.push('# TYPE contentkit_mcp_operations_total counter')
      for (const [key, value] of mcpOperations) {
        const [operation, outcome] = key.split('|')
        lines.push(`contentkit_mcp_operations_total{operation="${operation}",outcome="${outcome}"} ${value}`)
      }
      return `${lines.join('\n')}\n`
    },
  }
}
