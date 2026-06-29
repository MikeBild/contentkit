export function openApi(config) {
  const secured = [{ bearerAuth: [] }]
  const siteParameter = { name: 'site', in: 'path', required: true, schema: { type: 'string' } }
  const jsonBody = (required = []) => ({
    required: true,
    content: { 'application/json': { schema: { type: 'object', required } } },
  })
  const markdownBody = {
    required: true,
    content: {
      'text/markdown': { schema: { type: 'string' } },
      'multipart/form-data': { schema: { type: 'object', properties: { document: { type: 'string', format: 'binary' } } } },
    },
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Contentkit API',
      version: config.version,
      description: 'API-first Markdown CMS publishing immutable multilingual static-site releases.',
    },
    servers: [{ url: config.publicUrl }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Error: {
          type: 'object', required: ['error'],
          properties: { error: { type: 'string' }, request_id: { type: 'string' } },
        },
      },
    },
    paths: {
      '/health': { get: { summary: 'Liveness', responses: { 200: { description: 'OK' } } } },
      '/ready': { get: { summary: 'Readiness', responses: { 200: { description: 'Ready' }, 503: { description: 'Draining' } } } },
      '/v1/sites': {
        post: {
          summary: 'Create a site', security: secured,
          requestBody: jsonBody(['name', 'base_url', 'default_locale']),
          responses: { 201: { description: 'Created' } },
        },
      },
      '/v1/sites/{site}': {
        patch: {
          summary: 'Update site metadata and settings', security: secured, parameters: [siteParameter],
          requestBody: jsonBody(), responses: { 200: { description: 'Updated' } },
        },
      },
      '/v1/sites/{site}/content': {
        get: { summary: 'List content', security: secured, parameters: [siteParameter], responses: { 200: { description: 'Content list' } } },
        post: {
          summary: 'Create content and its first draft revision', security: secured, parameters: [siteParameter],
          requestBody: markdownBody,
          responses: { 201: { description: 'Draft created' } },
        },
      },
      '/v1/content/{item}/revisions': {
        get: {
          summary: 'List immutable revisions', security: secured,
          parameters: [{ name: 'item', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Revision list' } },
        },
        put: {
          summary: 'Create another immutable revision', security: secured,
          parameters: [{ name: 'item', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: markdownBody, responses: { 201: { description: 'Revision created' } },
        },
      },
      '/v1/sites/{site}/previews': {
        post: { summary: 'Build a time-limited preview', security: secured, parameters: [siteParameter], requestBody: jsonBody(), responses: { 201: { description: 'Preview built' } } },
      },
      '/v1/sites/{site}/releases': {
        post: { summary: 'Build and atomically activate a release', security: secured, parameters: [siteParameter], requestBody: jsonBody(), responses: { 201: { description: 'Release active' } } },
      },
      '/v1/sites/{site}/releases/{release}/activate': {
        post: {
          summary: 'Activate a prior release', security: secured,
          parameters: [siteParameter, { name: 'release', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Release active' } },
        },
      },
      '/v1/publish-due': {
        post: { summary: 'Publish scheduled revisions grouped by site', security: secured, responses: { 200: { description: 'Publish results' } } },
      },
      '/public/v1/contact': {
        post: { summary: 'Submit a contact request', responses: { 201: { description: 'Accepted' } } },
      },
      '/public/v1/posts/{post}/comments': {
        post: { summary: 'Submit a guest comment for moderation', responses: { 201: { description: 'Accepted' } } },
      },
      '/v1/comments': {
        get: { summary: 'List the moderation queue', security: secured, responses: { 200: { description: 'Comment list' } } },
      },
      '/v1/comments/{comment}': {
        patch: {
          summary: 'Approve or reject a comment', security: secured,
          parameters: [{ name: 'comment', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: jsonBody(['status']), responses: { 200: { description: 'Moderated' } },
        },
      },
      '/v1/contact-submissions': {
        get: { summary: 'List contact submissions', security: secured, responses: { 200: { description: 'Submission list' } } },
      },
      '/v1/api-keys': {
        post: { summary: 'Create a scoped API key', security: secured, requestBody: jsonBody(['name', 'scopes']), responses: { 201: { description: 'Created; raw key returned once' } } },
      },
    },
  }
}
