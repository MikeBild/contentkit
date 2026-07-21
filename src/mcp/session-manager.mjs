// Streamable HTTP sessions are bounded leases, not authentication state.
// Owner binding prevents a valid credential from riding another principal's
// already initialized SDK server (whose handlers close over that principal).
export const SESSION_SWEEP_INTERVAL_MS = 60_000
export const STREAM_RETAIN_START_GRACE_MS = 30_000

export function ownerKey(principal) {
  const scopes = [...new Set(principal.scopes || [])].sort().join(',')
  const sites = Array.isArray(principal.site_ids) ? [...new Set(principal.site_ids)].sort().join(',') : '*'
  return `${principal.credential_id || principal.id}:${principal.name || ''}:${scopes}:${sites}`
}

export function createSessionManager(options) {
  const { ttlMs, maxSessions, logger } = options
  const now = options.now || Date.now
  const sweepIntervalMs = options.sweepIntervalMs || SESSION_SWEEP_INTERVAL_MS
  const sessions = new Map()
  let reservations = 0
  let sweeper

  function evict(sessionId, reason) {
    const session = sessions.get(sessionId)
    if (!session) return
    sessions.delete(sessionId)
    options.onEvict?.({ sessionId, reason, activeSessions: sessions.size })
    logger.info('mcp session evicted', {
      session_id: sessionId,
      reason,
      idle_ms: now() - session.lastSeenAt,
      sessions_open: sessions.size,
    })
    void session.server.close().catch((error) => {
      logger.warn('failed to close evicted mcp session', {
        session_id: sessionId,
        error: String(error.message || error),
      })
    })
  }

  function stopSweeper() {
    if (!sweeper) return
    clearInterval(sweeper)
    sweeper = undefined
  }

  function retain(session) {
    session.inFlight += 1
    session.lastSeenAt = now()
  }

  function release(session) {
    if (session.inFlight > 0) session.inFlight -= 1
    session.lastSeenAt = now()
  }

  function tick() {
    const cutoff = now() - ttlMs
    for (const [sessionId, session] of sessions) {
      if (session.inFlight === 0 && session.lastSeenAt <= cutoff) evict(sessionId, 'idle_ttl')
    }
    if (sessions.size === 0) stopSweeper()
  }

  function startSweeper() {
    if (sweeper) return
    sweeper = setInterval(tick, sweepIntervalMs)
    sweeper.unref?.()
  }

  function evictOverflow() {
    while (sessions.size >= maxSessions) {
      let oldestId
      let oldestSeenAt = Number.POSITIVE_INFINITY
      for (const [sessionId, session] of sessions) {
        if (session.inFlight > 0) continue
        if (session.lastSeenAt < oldestSeenAt) {
          oldestId = sessionId
          oldestSeenAt = session.lastSeenAt
        }
      }
      if (!oldestId) {
        logger.warn('mcp session cap reached while every lease is busy', { sessions_open: sessions.size })
        return
      }
      evict(oldestId, 'capacity')
    }
  }

  function reserve() {
    while (sessions.size + reservations >= maxSessions) {
      let oldestId
      let oldestSeenAt = Number.POSITIVE_INFINITY
      for (const [sessionId, session] of sessions) {
        if (session.inFlight > 0) continue
        if (session.lastSeenAt < oldestSeenAt) {
          oldestId = sessionId
          oldestSeenAt = session.lastSeenAt
        }
      }
      if (!oldestId) {
        logger.warn('mcp session cap reached while every lease is busy', {
          sessions_open: sessions.size,
          reservations,
        })
        return false
      }
      evict(oldestId, 'capacity')
    }
    reservations += 1
    return true
  }

  function commit(sessionId, session) {
    if (reservations > 0) reservations -= 1
    sessions.set(sessionId, session)
  }

  function releaseReservation() {
    if (reservations > 0) reservations -= 1
  }

  function closeAll() {
    stopSweeper()
    reservations = 0
    for (const sessionId of [...sessions.keys()]) evict(sessionId, 'shutdown')
  }

  return {
    sessions,
    evict,
    tick,
    startSweeper,
    stopSweeper,
    evictOverflow,
    reserve,
    commit,
    releaseReservation,
    retain,
    release,
    closeAll,
  }
}

export function trackStreamLifetime(body, retain, graceMs = STREAM_RETAIN_START_GRACE_MS) {
  const reader = body.getReader()
  let started = false
  let held = true
  let closed = false
  let grace = setTimeout(() => {
    grace = undefined
    if (started || closed) return
    held = false
    retain.release()
    retain.onForceReleased()
  }, graceMs)
  grace.unref?.()

  const disarm = () => {
    if (!grace) return
    clearTimeout(grace)
    grace = undefined
  }
  const activate = () => {
    started = true
    disarm()
    if (!held) {
      held = true
      retain.reacquire()
    }
  }
  const finish = () => {
    if (closed) return
    closed = true
    disarm()
    if (held) {
      held = false
      retain.release()
    }
  }

  return new ReadableStream(
    {
      async pull(controller) {
        activate()
        try {
          const chunk = await reader.read()
          if (chunk.done) {
            finish()
            controller.close()
          } else controller.enqueue(chunk.value)
        } catch (error) {
          finish()
          controller.error(error)
        }
      },
      async cancel(reason) {
        finish()
        await reader.cancel(reason)
      },
    },
    { highWaterMark: 0 },
  )
}
