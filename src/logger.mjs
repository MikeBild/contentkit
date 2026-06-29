const levels = { debug: 10, info: 20, warn: 30, error: 40 }

export function createLogger(config = {}) {
  const threshold = levels[config.logLevel || config.level] ?? 20
  function write(level, msg, fields = {}) {
    if (levels[level] < threshold) return
    process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields })}\n`)
  }
  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  }
}
