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
      try {
        details = JSON.parse(text)
      } catch {}
      // Self-hosted storage-api wraps not-found (and other errors) as HTTP 400
      // while preserving the real status in the JSON body's statusCode. Normalise
      // to that status so callers can rely on error.status (e.g. 404 fallbacks).
      const wrapped = Number(details?.statusCode)
      const status = Number.isInteger(wrapped) && wrapped >= 400 && wrapped < 600 ? wrapped : response.status
      throw new StorageError(
        details?.message || `Supabase Storage request failed (${response.status})`,
        status,
        details,
      )
    }
    return response
  }

  const storage = {
    async ensureBucket() {
      const existing = await request(`/storage/v1/bucket/${encodeURIComponent(config.storageBucket)}`).catch(
        (error) => {
          if (error.status === 404) return null
          throw error
        },
      )
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
      const response = await request(
        `/storage/v1/object/${encodeURIComponent(config.storageBucket)}/${path.split('/').map(encodeURIComponent).join('/')}`,
        {
          method: 'POST',
          headers: {
            'content-type': contentType,
            'cache-control': cacheControl,
            'x-upsert': String(upsert),
          },
          body,
        },
      )
      return response.json()
    },
    // `range` is a raw byte-range header value ("bytes=0-1023"). Object stores
    // answer it with a 206 and a content-range; a store that ignores it answers
    // 200 with the whole object, which callers must be ready to slice themselves.
    async download(path, { head = false, range = '' } = {}) {
      return request(
        `/storage/v1/object/authenticated/${encodeURIComponent(config.storageBucket)}/${path.split('/').map(encodeURIComponent).join('/')}`,
        {
          method: head ? 'HEAD' : 'GET',
          ...(range ? { headers: { range } } : {}),
        },
      )
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
