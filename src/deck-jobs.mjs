import { randomUUID } from 'node:crypto'

// Bounded, process-local job results keep asynchronous rendering ephemeral.
// Published decks remain durable release artifacts; these short-lived jobs are
// only for headless authoring/compile calls and never persist source Markdown.
export function createDeckJobStore({ max = 32, ttlMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
  const jobs = new Map()
  let sweep

  const touch = (job) => {
    job.expires_at = ttlMs > 0 ? now() + ttlMs : 0
    job.updated_at = now()
  }

  if (ttlMs > 0) {
    sweep = setInterval(
      () => {
        const current = now()
        for (const [id, job] of jobs) if (job.expires_at && job.expires_at <= current) jobs.delete(id)
      },
      Math.max(1000, ttlMs),
    )
    sweep.unref?.()
  }

  return {
    create(siteId) {
      const created = now()
      const job = {
        id: randomUUID(),
        site_id: siteId,
        status: 'queued',
        error: null,
        result: null,
        etag: null,
        created_at: created,
        updated_at: created,
      }
      touch(job)
      jobs.set(job.id, job)
      while (jobs.size > max) jobs.delete(jobs.keys().next().value)
      return job
    },
    get(id, siteId) {
      const job = jobs.get(id)
      if (!job || job.site_id !== siteId) return undefined
      if (job.expires_at && job.expires_at <= now()) {
        jobs.delete(id)
        return undefined
      }
      return job
    },
    markRunning(id) {
      const job = jobs.get(id)
      if (job) {
        job.status = 'running'
        touch(job)
      }
    },
    setResult(id, result, etag) {
      const job = jobs.get(id)
      if (job) {
        job.status = 'done'
        job.result = result
        job.etag = etag
        touch(job)
      }
    },
    fail(id, error) {
      const job = jobs.get(id)
      if (job) {
        job.status = 'error'
        job.error = String(error?.code || error?.message || error).slice(0, 240)
        touch(job)
      }
    },
    stop() {
      if (sweep) clearInterval(sweep)
    },
    get size() {
      return jobs.size
    },
  }
}

export function publicDeckJob(job, siteId) {
  const base = `/v1/sites/${siteId}/deck-jobs/${job.id}`
  return {
    job_id: job.id,
    status: job.status,
    created_at: new Date(job.created_at).toISOString(),
    updated_at: new Date(job.updated_at).toISOString(),
    status_url: base,
    result_url: `${base}/result`,
    ...(job.error ? { error: job.error } : {}),
  }
}
