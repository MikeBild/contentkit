import { readBody } from './http.mjs'

export async function toWebRequest(req, maxBodyBytes, publicUrl) {
  const method = req.method || 'GET'
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const entry of value) headers.append(name, entry)
    else headers.set(name, value)
  }
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req, maxBodyBytes)
  headers.delete('content-length')
  headers.delete('transfer-encoding')
  const base = publicUrl || `http://${req.headers.host || '127.0.0.1'}`
  return new Request(new URL(req.url || '/', base), {
    method,
    headers,
    ...(body === undefined ? {} : { body: new Uint8Array(body) }),
  })
}

export async function pipeWebResponse(response, res) {
  res.statusCode = response.status
  response.headers.forEach((value, name) => res.setHeader(name, value))
  if (!response.body) {
    res.end()
    return
  }
  const reader = response.body.getReader()
  res.once('close', () => void reader.cancel().catch(() => {}))
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done || !res.writable) break
      res.write(value)
    }
  } catch {
    // Socket cancellation ends the response and releases any stream lease.
  } finally {
    res.end()
  }
}

export function nodeWebHandler(mount, { maxBodyBytes, publicUrl }) {
  return async (req, res) => pipeWebResponse(await mount.handler(await toWebRequest(req, maxBodyBytes, publicUrl)), res)
}
