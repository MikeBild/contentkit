import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer, request } from 'node:http'
import { spawn } from 'node:child_process'
import pg from 'pg'

const binary = process.env.CONTENTKIT_E2E_BINARY
const databaseUrl = process.env.CONTENTKIT_E2E_DATABASE_URL

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function close(server) {
  return new Promise((resolve) => server.close(resolve))
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function responseJson(response, expected) {
  const text = await response.text()
  assert.equal(response.status, expected, text)
  return text ? JSON.parse(text) : null
}

function requestWithHost(origin, path, host) {
  const url = new URL(path, origin)
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'GET',
        headers: { host },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      },
    )
    req.on('error', reject)
    req.end()
  })
}

async function waitForReady(origin, child, logs) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`contentkit exited ${child.exitCode}\n${logs.join('')}`)
    try {
      const response = await fetch(`${origin}/ready`)
      if (response.ok && (await response.json()).status === 'ready') return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`contentkit readiness timeout\n${logs.join('')}`)
}

async function waitForWebhooks(events, count) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (events.length >= count) return events
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`webhook delivery timeout: received ${events.length}/${count}`)
}

test(
  'single binary completes the local CMS lifecycle end to end',
  {
    skip: binary && databaseUrl ? false : 'CONTENTKIT_E2E_BINARY and CONTENTKIT_E2E_DATABASE_URL are required',
    timeout: 120000,
  },
  async () => {
    const objects = new Map()
    const webhookEvents = []
    let bucketExists = false

    const boundary = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (req.method === 'GET' && url.pathname === '/storage/v1/bucket/contentkit') {
        if (!bucketExists) {
          res.writeHead(404, { 'content-type': 'application/json' })
          return res.end('{"message":"not found"}')
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end('{"id":"contentkit","public":false}')
      }
      if (req.method === 'POST' && url.pathname === '/storage/v1/bucket') {
        bucketExists = true
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end('{}')
      }
      const uploadPrefix = '/storage/v1/object/contentkit/'
      if (req.method === 'POST' && url.pathname.startsWith(uploadPrefix)) {
        const path = decodeURIComponent(url.pathname.slice(uploadPrefix.length))
        objects.set(path, {
          body: await readBody(req),
          contentType: req.headers['content-type'] || 'application/octet-stream',
          cacheControl: req.headers['cache-control'] || '3600',
        })
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end('{}')
      }
      if (req.method === 'DELETE' && url.pathname === '/storage/v1/object/contentkit') {
        const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        let deleted = 0
        for (const key of payload.prefixes || []) if (objects.delete(key)) deleted++
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ deleted }))
      }
      const downloadPrefix = '/storage/v1/object/authenticated/contentkit/'
      if (['GET', 'HEAD'].includes(req.method) && url.pathname.startsWith(downloadPrefix)) {
        const path = decodeURIComponent(url.pathname.slice(downloadPrefix.length))
        const object = objects.get(path)
        if (!object) {
          // Self-hosted storage-api wraps a missing object as HTTP 400 while
          // carrying the real 404 in the body; the gateway must still fall back.
          res.writeHead(400, { 'content-type': 'application/json' })
          return res.end('{"statusCode":"404","error":"not_found","message":"Object not found"}')
        }
        res.writeHead(200, {
          'content-type': object.contentType,
          'cache-control': object.cacheControl,
          etag: '"local-e2e"',
        })
        return res.end(req.method === 'HEAD' ? undefined : object.body)
      }
      if (req.method === 'POST' && url.pathname.startsWith('/hooks/')) {
        webhookEvents.push({ path: url.pathname, headers: req.headers, body: (await readBody(req)).toString('utf8') })
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end('{}')
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"message":"not found"}')
    })

    const boundaryPort = await listen(boundary)
    const portProbe = createServer()
    const contentkitPort = await listen(portProbe)
    await close(portProbe)
    const origin = `http://127.0.0.1:${contentkitPort}`
    const boundaryOrigin = `http://127.0.0.1:${boundaryPort}`
    const webhookSecret = 'local-e2e-webhook-secret'
    const bootstrapKey = 'local-e2e-bootstrap-key'
    const logs = []
    const child = spawn(binary, [], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: String(contentkitPort),
        DATABASE_URL: databaseUrl,
        CONTENTKIT_PUBLIC_URL: origin,
        CONTENTKIT_BOOTSTRAP_API_KEY: bootstrapKey,
        CONTENTKIT_KEY_PEPPER: 'local-e2e-key-pepper',
        CONTENTKIT_PREVIEW_SECRET: 'local-e2e-preview-secret',
        SUPABASE_URL: boundaryOrigin,
        SUPABASE_SERVICE_ROLE_KEY: 'local-e2e-storage-key',
        CONTENTKIT_STORAGE_BUCKET: 'contentkit',
        CONTENTKIT_WEBHOOK_URL: `${boundaryOrigin}/hooks/contentkit-notifications`,
        CONTENTKIT_WEBHOOK_SECRET: webhookSecret,
        CONTENTKIT_WEBHOOK_POLL_MS: '1000',
        CONTENTKIT_TURNSTILE_DEV_BYPASS: 'true',
        CONTENTKIT_RELEASE_RETENTION_MS: '0',
        CONTENTKIT_RELEASE_HISTORY_KEEP: '1',
        LOG_LEVEL: 'warn',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => logs.push(chunk.toString()))
    child.stderr.on('data', (chunk) => logs.push(chunk.toString()))

    const auth = { authorization: `Bearer ${bootstrapKey}` }
    try {
      await waitForReady(origin, child, logs)
      assert.equal(bucketExists, true)

      const site = await responseJson(
        await fetch(`${origin}/v1/sites`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Local E2E',
            base_url: 'http://e2e.local',
            default_locale: 'de',
            locales: ['de'],
            domains: ['e2e.local'],
          }),
        }),
        201,
      )

      // Register a managed webhook endpoint filtered to contact submissions.
      const endpoint = await responseJson(
        await fetch(`${origin}/v1/sites/${site.id}/webhooks`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ url: `${boundaryOrigin}/hooks/managed`, events: ['contact.submitted'] }),
        }),
        201,
      )
      const managedSecret = endpoint.secret
      assert.match(managedSecret, /^whsec_/)

      const markdown = `---
kind: post
title: Lokaler E2E Beitrag
locale: de
slug: lokaler-e2e-beitrag
translationKey: local-e2e-post
summary: Durch die echte Single-Binary erzeugt.
date: 2026-06-29T10:00:00+02:00
tags: [E2E, Contentkit]
---

# Vollständiger Durchlauf

Markdown rein, veröffentlichte HTML-Seite raus.

![Lokales Asset](images/e2e.png)
`
      const multipart = new FormData()
      multipart.set('document', new Blob([markdown], { type: 'text/markdown' }), 'post.md')
      multipart.set('asset:images/e2e.png', new Blob(['local-image-bytes'], { type: 'image/png' }), 'e2e.png')
      const ingested = await responseJson(
        await fetch(`${origin}/v1/sites/${site.id}/content`, {
          method: 'POST',
          headers: auth,
          body: multipart,
        }),
        201,
      )
      assert.equal(ingested.assets.length, 1)
      const assetResponse = await fetch(`${origin}${ingested.assets[0]}`)
      assert.equal(assetResponse.status, 200)
      assert.equal(await assetResponse.text(), 'local-image-bytes')

      const preview = await responseJson(
        await fetch(`${origin}/v1/sites/${site.id}/previews`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ revision_ids: [ingested.revision.id], expires_in: 600 }),
        }),
        201,
      )
      const previewPage = await fetch(`${preview.url}de/blog/lokaler-e2e-beitrag/`)
      assert.equal(previewPage.status, 200)
      assert.equal(previewPage.headers.get('x-robots-tag'), 'noindex,nofollow,noarchive')
      assert.match(await previewPage.text(), /Lokaler E2E Beitrag/)

      const release = await responseJson(
        await fetch(`${origin}/v1/sites/${site.id}/releases`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ revision_ids: [ingested.revision.id], reason: 'local E2E' }),
        }),
        201,
      )
      assert.equal(release.active, true)
      assert.ok(release.file_count > 10)

      const publicPage = await requestWithHost(origin, '/de/blog/lokaler-e2e-beitrag/', 'e2e.local')
      assert.equal(publicPage.status, 200)
      assert.match(publicPage.body, /Markdown rein, veröffentlichte HTML-Seite raus/)
      // P4 metadata renders end-to-end through the compiled binary.
      assert.match(publicPage.body, /property="og:site_name"/)
      assert.match(publicPage.body, /property="article:published_time"/)
      assert.match(publicPage.body, /rel="manifest" href="\/manifest\.webmanifest"/)
      const manifestResponse = await requestWithHost(origin, '/manifest.webmanifest', 'e2e.local')
      assert.equal(manifestResponse.status, 200)
      assert.match(manifestResponse.body, /"name":"Local E2E"/)

      const contact = await responseJson(
        await fetch(`${origin}/public/v1/contact`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            site_id: site.id,
            name: 'E2E Tester',
            email: 'e2e@example.com',
            message: 'Lokale Nachricht',
          }),
        }),
        201,
      )
      assert.equal(contact.accepted, true)

      const comment = await responseJson(
        await fetch(`${origin}/public/v1/posts/${ingested.item.id}/comments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            site_id: site.id,
            name: 'E2E Kommentator',
            email: 'comment@example.com',
            message: 'Freigegebener E2E-Kommentar',
          }),
        }),
        201,
      )
      assert.equal(comment.accepted, true)

      const approved = await responseJson(
        await fetch(`${origin}/v1/comments/${comment.id}`, {
          method: 'PATCH',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'approved' }),
        }),
        200,
      )
      assert.equal(approved.comment.status, 'approved')
      assert.equal(approved.release.active, true)

      const updatedPage = await requestWithHost(origin, '/de/blog/lokaler-e2e-beitrag/', 'e2e.local')
      assert.equal(updatedPage.status, 200)
      assert.match(updatedPage.body, /Freigegebener E2E-Kommentar/)

      const releaseList = await responseJson(
        await fetch(`${origin}/v1/sites/${site.id}/releases`, { headers: auth }),
        200,
      )
      assert.ok(releaseList.length >= 2)
      assert.equal(releaseList.filter((entry) => entry.status === 'active').length, 1)

      const unpublished = await responseJson(
        await fetch(`${origin}/v1/content/${ingested.item.id}/published`, {
          method: 'DELETE',
          headers: auth,
        }),
        200,
      )
      assert.equal(unpublished.unpublished, true)
      assert.equal(unpublished.release.active, true)

      const retiredPage = await requestWithHost(origin, '/de/blog/lokaler-e2e-beitrag/', 'e2e.local')
      assert.equal(retiredPage.status, 404)

      const conflict = await fetch(`${origin}/v1/content/${ingested.item.id}/published`, {
        method: 'DELETE',
        headers: auth,
      })
      assert.equal(conflict.status, 409)

      const republished = await responseJson(
        await fetch(`${origin}/v1/sites/${site.id}/releases`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ revision_ids: [ingested.revision.id], reason: 'republish after unpublish' }),
        }),
        201,
      )
      assert.equal(republished.active, true)
      const restoredPage = await requestWithHost(origin, '/de/blog/lokaler-e2e-beitrag/', 'e2e.local')
      assert.equal(restoredPage.status, 200)
      assert.match(restoredPage.body, /Markdown rein, veröffentlichte HTML-Seite raus/)

      // Storage GC (retention 0, keep 1): sweeps superseded releases and their
      // objects while leaving the active release intact.
      const gc = await responseJson(
        await fetch(`${origin}/v1/maintenance/storage-gc`, { method: 'POST', headers: auth }),
        200,
      )
      assert.ok(gc.removed_releases >= 1, `expected GC to remove releases, got ${JSON.stringify(gc)}`)
      assert.ok(gc.removed_objects >= 1, 'GC removed orphaned objects')
      const afterGc = await requestWithHost(origin, '/de/blog/lokaler-e2e-beitrag/', 'e2e.local')
      assert.equal(afterGc.status, 200, 'active release still served after GC')

      // The built-in env endpoint receives all 3 events; the managed endpoint,
      // filtered to contact.submitted, receives exactly 1 (fan-out) — 4 total.
      const webhooks = await waitForWebhooks(webhookEvents, 4)
      const envHooks = webhooks.filter((event) => event.path === '/hooks/contentkit-notifications')
      const managedHooks = webhooks.filter((event) => event.path === '/hooks/managed')
      assert.deepEqual(
        new Set(envHooks.map((event) => event.headers['webhook-type'])),
        new Set(['contentkit.contact.submitted', 'contentkit.comment.submitted', 'contentkit.comment.approved']),
      )
      for (const webhook of envHooks) {
        const expected = createHmac('sha256', webhookSecret)
          .update(`${webhook.headers['webhook-id']}.${webhook.headers['webhook-timestamp']}.${webhook.body}`)
          .digest('base64')
        assert.equal(webhook.headers['webhook-signature'], `v1,${expected}`)
      }
      // Managed endpoint: exactly the contact event, signed with its own secret,
      // and carrying the submitted form content in the payload.
      assert.equal(managedHooks.length, 1)
      assert.equal(managedHooks[0].headers['webhook-type'], 'contentkit.contact.submitted')
      const managedExpected = createHmac('sha256', managedSecret)
        .update(
          `${managedHooks[0].headers['webhook-id']}.${managedHooks[0].headers['webhook-timestamp']}.${managedHooks[0].body}`,
        )
        .digest('base64')
      assert.equal(managedHooks[0].headers['webhook-signature'], `v1,${managedExpected}`)
      assert.equal(JSON.parse(managedHooks[0].body).data.email, 'e2e@example.com')

      const pool = new pg.Pool({ connectionString: databaseUrl })
      try {
        let delivered = 0
        for (let attempt = 0; attempt < 40; attempt++) {
          delivered = (
            await pool.query("SELECT count(*)::int AS n FROM public.ck_webhook_deliveries WHERE status = 'delivered'")
          ).rows[0].n
          if (delivered >= 4) break
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
        const state = await pool.query(`
        SELECT
          (SELECT count(*)::int FROM contentkit.__contentkit_migrations) AS migrations,
          (SELECT count(*)::int FROM public.ck_releases WHERE status = 'active') AS active_releases,
          (SELECT count(*)::int FROM public.ck_outbox_events) AS events
      `)
        assert.deepEqual(state.rows[0], {
          migrations: 4,
          active_releases: 1,
          events: 3,
        })
        assert.equal(delivered, 4, 'all fan-out deliveries succeed')
      } finally {
        await pool.end()
      }
      assert.ok(objects.size > 20)
    } finally {
      child.kill('SIGTERM')
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ])
      if (child.exitCode === null) child.kill('SIGKILL')
      await close(boundary)
    }
  },
)
