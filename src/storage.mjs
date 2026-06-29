export class StorageError extends Error {
  constructor(message, status, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

export function createStorage(config, fetchImpl = fetch) {
  const baseHeaders = {
    authorization: `Bearer ${config.storageServiceKey}`,
    apikey: config.storageServiceKey,
  }

  async function request(path, options = {}) {
    if (!config.storageUrl || !config.storageServiceKey) {
      throw new StorageError('Supabase Storage is not configured', 503)
    }
    const response = await fetchImpl(`${config.storageUrl}${path}`, {
      ...options,
      headers: { ...baseHeaders, ...(options.headers || {}) },
    })
    if (!response.ok) {
      const text = await response.text()
      let details = text
      try { details = JSON.parse(text) } catch {}
      throw new StorageError(details?.message || `Supabase Storage request failed (${response.status})`, response.status, details)
    }
    return response
  }

  const storage = {
    async ensureBucket() {
      const existing = await request(`/storage/v1/bucket/${encodeURIComponent(config.storageBucket)}`).catch((error) => {
        if (error.status === 404) return null
        throw error
      })
      if (existing) {
        const bucket = await existing.json()
        if (bucket.public) throw new StorageError(`Storage bucket ${config.storageBucket} must be private`, 503)
        return
      }
      await request('/storage/v1/bucket', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: config.storageBucket, name: config.storageBucket, public: false }),
      })
    },
    async upload(path, body, contentType, cacheControl = '3600', upsert = false) {
      const response = await request(`/storage/v1/object/${encodeURIComponent(config.storageBucket)}/${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'POST',
        headers: {
          'content-type': contentType,
          'cache-control': cacheControl,
          'x-upsert': String(upsert),
        },
        body,
      })
      return response.json()
    },
    async download(path, { head = false } = {}) {
      return request(`/storage/v1/object/authenticated/${encodeURIComponent(config.storageBucket)}/${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: head ? 'HEAD' : 'GET',
      })
    },
    async remove(paths) {
      await request(`/storage/v1/object/${encodeURIComponent(config.storageBucket)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }),
      })
    },
  }

  return { storage, request }
}
