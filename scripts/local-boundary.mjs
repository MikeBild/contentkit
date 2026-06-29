import { createServer } from 'node:http'
import {
  appendFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

function safePath(root, value) {
  const target = resolve(root, ...decodeURIComponent(value).split('/').filter(Boolean))
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error('invalid storage path')
  return target
}

async function body(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function json(res, status, value) {
  const payload = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

export async function startLocalBoundary({
  host = '127.0.0.1',
  port = 55433,
  dataDir,
  logger = console,
} = {}) {
  const root = resolve(dataDir || '.contentkit-local')
  const objectsDir = join(root, 'storage')
  const metadataPath = join(root, 'metadata.json')
  const bucketPath = join(root, 'bucket.json')
  const webhookPath = join(root, 'webhooks.ndjson')
  await mkdir(objectsDir, { recursive: true })
  let metadata = {}
  try { metadata = JSON.parse(await readFile(metadataPath, 'utf8')) } catch {}

  async function persistMetadata() {
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${host}:${port}`)
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { status: 'ok' })
      if (req.method === 'GET' && url.pathname === '/storage/v1/bucket/contentkit') {
        try {
          const bucket = JSON.parse(await readFile(bucketPath, 'utf8'))
          return json(res, 200, bucket)
        } catch {
          return json(res, 404, { message: 'bucket not found' })
        }
      }
      if (req.method === 'POST' && url.pathname === '/storage/v1/bucket') {
        const input = JSON.parse((await body(req)).toString('utf8'))
        await writeFile(bucketPath, `${JSON.stringify({ id: input.id, name: input.name, public: false })}\n`)
        return json(res, 200, { id: input.id })
      }

      const uploadPrefix = '/storage/v1/object/contentkit/'
      if (req.method === 'POST' && url.pathname.startsWith(uploadPrefix)) {
        const objectName = decodeURIComponent(url.pathname.slice(uploadPrefix.length))
        const target = safePath(objectsDir, objectName)
        if (req.headers['x-upsert'] !== 'true') {
          try {
            await stat(target)
            return json(res, 409, { message: 'object already exists' })
          } catch {}
        }
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, await body(req))
        metadata[objectName] = {
          contentType: req.headers['content-type'] || 'application/octet-stream',
          cacheControl: req.headers['cache-control'] || '3600',
        }
        await persistMetadata()
        return json(res, 200, { path: objectName })
      }

      const downloadPrefix = '/storage/v1/object/authenticated/contentkit/'
      if (['GET', 'HEAD'].includes(req.method) && url.pathname.startsWith(downloadPrefix)) {
        const objectName = decodeURIComponent(url.pathname.slice(downloadPrefix.length))
        let payload
        try { payload = await readFile(safePath(objectsDir, objectName)) } catch {
          return json(res, 404, { message: 'object not found' })
        }
        const meta = metadata[objectName] || {}
        res.writeHead(200, {
          'content-type': meta.contentType || 'application/octet-stream',
          'cache-control': meta.cacheControl || '3600',
          'content-length': payload.length,
          etag: '"contentkit-local"',
        })
        return res.end(req.method === 'HEAD' ? undefined : payload)
      }

      if (req.method === 'DELETE' && url.pathname === '/storage/v1/object/contentkit') {
        const input = JSON.parse((await body(req)).toString('utf8'))
        for (const prefix of input.prefixes || []) {
          await rm(safePath(objectsDir, prefix), { recursive: true, force: true })
          delete metadata[prefix]
        }
        await persistMetadata()
        return json(res, 200, [])
      }

      if (req.method === 'POST' && url.pathname === '/hooks/contentkit-notifications') {
        const raw = await body(req)
        await appendFile(webhookPath, `${JSON.stringify({
          received_at: new Date().toISOString(),
          webhook_id: req.headers['webhook-id'],
          webhook_type: req.headers['webhook-type'],
          body: JSON.parse(raw.toString('utf8')),
        })}\n`)
        logger.info?.(`local Subkit webhook: ${req.headers['webhook-type']} (${req.headers['webhook-id']})`)
        return json(res, 200, { accepted: true })
      }
      return json(res, 404, { message: 'not found' })
    } catch (error) {
      logger.error?.(`local boundary error: ${error.message}`)
      return json(res, 500, { message: error.message })
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  return {
    server,
    root,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  }
}
