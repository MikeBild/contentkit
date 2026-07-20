import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeckJobStore, publicDeckJob } from '../../src/deck-jobs.mjs'

test('deck jobs are site-scoped, bounded and expire without retaining source', () => {
  let now = 1000
  const jobs = createDeckJobStore({ max: 2, ttlMs: 1000, now: () => now })
  const first = jobs.create('site-a')
  assert.equal(jobs.get(first.id, 'site-b'), undefined)
  assert.equal('markdown' in first, false)

  jobs.markRunning(first.id)
  jobs.setResult(first.id, { html: '<html></html>' }, '"etag"')
  assert.equal(jobs.get(first.id, 'site-a').status, 'done')

  jobs.create('site-a')
  jobs.create('site-a')
  assert.equal(jobs.size, 2)
  assert.equal(jobs.get(first.id, 'site-a'), undefined, 'oldest job is evicted over the bound')

  const expiring = jobs.create('site-a')
  now += 1001
  assert.equal(jobs.get(expiring.id, 'site-a'), undefined)
  jobs.stop()
})

test('public deck job exposes poll URLs but no result payload', () => {
  const jobs = createDeckJobStore({ ttlMs: 0 })
  const job = jobs.create('site-a')
  const view = publicDeckJob(job, 'site-a')
  assert.equal(view.job_id, job.id)
  assert.match(view.status_url, new RegExp(`${job.id}$`))
  assert.match(view.result_url, new RegExp(`${job.id}/result$`))
  assert.equal('result' in view, false)
  jobs.stop()
})
