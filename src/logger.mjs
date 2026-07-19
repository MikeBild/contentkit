const levels = { debug: 10, info: 20, warn: 30, error: 40 }

// sd-daemon(3) priority prefixes. journald strips a leading <N> from each
// stdout line and files it as the syslog PRIORITY, so `journalctl -p err`
// finds "level":"error" lines instead of treating every line as info.
// Only warn/error need a marker — info is journald's default priority.
const priorities = { warn: '<4>', error: '<3>' }

export function createLogger(config = {}) {
  const threshold = levels[config.logLevel || config.level] ?? 20
  // systemd sets JOURNAL_STREAM when stdout goes to the journal; terminals
  // and test captures stay plain JSON without the angle-bracket prefix.
  const journal = Boolean(process.env.JOURNAL_STREAM)
  const resource = {
    'service.name': 'contentkit',
    'service.version': config.version || 'unknown',
    'deployment.environment.name': config.deploymentEnvironment || 'development',
  }
  function write(level, msg, fields = {}) {
    if (levels[level] < threshold) return
    const prefix = journal ? priorities[level] || '' : ''
    process.stdout.write(
      `${prefix}${JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields, ...resource })}\n`,
    )
  }
  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  }
}
