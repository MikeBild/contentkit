export function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let done = false
    req.on('data', (chunk) => {
      if (done) return
      size += chunk.length
      if (size > maxBytes) {
        done = true
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }))
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!done) resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

export function parseJson(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { statusCode: 400 })
  }
}

function parseDisposition(value = '') {
  const out = {}
  for (const part of value.split(';').slice(1)) {
    const [key, ...rest] = part.trim().split('=')
    if (!key || !rest.length) continue
    out[key.toLowerCase()] = rest.join('=').replace(/^"|"$/g, '')
  }
  return out
}

export function parseMultipart(buffer, contentType) {
  const boundary = contentType
    .match(/boundary=(?:"([^"]+)"|([^;]+))/i)
    ?.slice(1)
    .find(Boolean)
  if (!boundary || boundary.length > 200) {
    throw Object.assign(new Error('invalid multipart boundary'), { statusCode: 400 })
  }
  const marker = Buffer.from(`--${boundary}`)
  const parts = []
  let cursor = buffer.indexOf(marker)
  while (cursor !== -1) {
    cursor += marker.length
    if (buffer.subarray(cursor, cursor + 2).toString() === '--') break
    if (buffer.subarray(cursor, cursor + 2).toString() === '\r\n') cursor += 2
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), cursor)
    if (headerEnd === -1) break
    const rawHeaders = buffer.subarray(cursor, headerEnd).toString('utf8')
    const headers = {}
    for (const line of rawHeaders.split('\r\n')) {
      const separator = line.indexOf(':')
      if (separator > 0) headers[line.slice(0, separator).toLowerCase()] = line.slice(separator + 1).trim()
    }
    const next = buffer.indexOf(marker, headerEnd + 4)
    if (next === -1) break
    const bodyEnd = next >= 2 && buffer.subarray(next - 2, next).toString() === '\r\n' ? next - 2 : next
    const disposition = parseDisposition(headers['content-disposition'])
    if (disposition.name) {
      parts.push({
        name: disposition.name,
        filename: disposition.filename,
        contentType: headers['content-type'] || 'application/octet-stream',
        body: buffer.subarray(headerEnd + 4, bodyEnd),
      })
    }
    cursor = next
  }
  return parts
}

// RFC 9110 byte ranges, single-range only. Returns null when the header is
// absent or unusable (the caller then serves the whole thing with a 200 — a
// malformed Range must never fail the request), 'unsatisfiable' for a range
// that starts past the end (416), or the resolved inclusive {start, end}.
//
// Multi-range ("bytes=0-9,20-29") is deliberately declined: answering it means
// multipart/byteranges, and no media element asks for it. Serving the full
// entity instead is a valid response to any range request.
export function parseByteRange(header, total) {
  if (!header || !Number.isFinite(total) || total <= 0) return null
  const spec = String(header)
    .trim()
    .match(/^bytes=(\d*)-(\d*)$/)
  if (!spec) return null
  const [, rawStart, rawEnd] = spec
  if (!rawStart && !rawEnd) return null

  // "bytes=-500" is a suffix: the last 500 bytes, clamped to the whole entity.
  if (!rawStart) {
    const length = Number(rawEnd)
    if (!length) return 'unsatisfiable'
    return { start: Math.max(0, total - length), end: total - 1 }
  }

  const start = Number(rawStart)
  if (start >= total) return 'unsatisfiable'
  const end = rawEnd ? Math.min(Number(rawEnd), total - 1) : total - 1
  if (end < start) return 'unsatisfiable'
  return { start, end }
}

export function send(res, status, body = '', headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body))
  res.writeHead(status, {
    'content-length': String(payload.length),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    ...headers,
  })
  res.end(payload)
  return true
}

export function sendJson(res, status, body, headers = {}) {
  return send(res, status, JSON.stringify(body), { 'content-type': 'application/json; charset=utf-8', ...headers })
}
