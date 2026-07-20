export function createMetrics() {
  const requests = new Map()
  let builds = 0
  let buildMs = 0
  const deckBuilds = new Map()
  const deckCache = new Map()
  const deckJobs = new Map()
  const deckOperations = new Map()
  let deckBuildMs = 0
  let deckOutputBytes = 0
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
    render(inflight = 0, { deckInflight = 0, deckQueued = 0 } = {}) {
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
      return `${lines.join('\n')}\n`
    },
  }
}
