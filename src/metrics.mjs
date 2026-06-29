export function createMetrics() {
  const requests = new Map()
  let builds = 0
  let buildMs = 0
  return {
    request(method, route, status) {
      const key = `${method}|${route}|${status}`
      requests.set(key, (requests.get(key) || 0) + 1)
    },
    build(ms) { builds++; buildMs += ms },
    render(inflight = 0) {
      const lines = [
        '# HELP contentkit_requests_total HTTP requests',
        '# TYPE contentkit_requests_total counter',
      ]
      for (const [key, value] of requests) {
        const [method, route, status] = key.split('|')
        lines.push(`contentkit_requests_total{method="${method}",route="${route}",status="${status}"} ${value}`)
      }
      lines.push('# TYPE contentkit_builds_total counter', `contentkit_builds_total ${builds}`)
      lines.push('# TYPE contentkit_build_duration_milliseconds_total counter', `contentkit_build_duration_milliseconds_total ${buildMs}`)
      lines.push('# TYPE contentkit_builds_inflight gauge', `contentkit_builds_inflight ${inflight}`)
      return `${lines.join('\n')}\n`
    },
  }
}
