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

export function send(res, status, body = '', headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body))
  res.writeHead(status, {
    'content-length': String(payload.length),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    ...headers,
  })
  res.end(payload)
}

export function sendJson(res, status, body, headers = {}) {
  send(res, status, JSON.stringify(body), { 'content-type': 'application/json; charset=utf-8', ...headers })
}
