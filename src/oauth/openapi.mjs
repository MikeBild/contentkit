// Product-local registration of the common public MCP-auth protocol.
const json = (schema) => ({ 'application/json': { schema } })
const html = { 'text/html': { schema: { type: 'string' } } }
const form = {
  required: true,
  content: {
    'application/x-www-form-urlencoded': { schema: { type: 'object', additionalProperties: { type: 'string' } } },
  },
}
const errors = {
  400: { description: 'Invalid request', content: json({ $ref: '#/components/schemas/OAuthError' }) },
  401: { description: 'Identity assertion rejected', content: json({ $ref: '#/components/schemas/OAuthError' }) },
  403: {
    description: 'Identity or requested access denied',
    content: json({ $ref: '#/components/schemas/OAuthError' }),
  },
}

export const MCP_AUTH_OPERATIONS = [
  'get /.well-known/oauth-protected-resource',
  'get /.well-known/oauth-protected-resource/mcp',
  'get /.well-known/oauth-authorization-server',
  'post /v1/oauth/register',
  'get /v1/oauth/authorize',
  'post /v1/oauth/authorize/decision',
  'post /v1/oauth/token',
  'post /v1/oauth/revoke',
  'get /v1/identity/providers',
  'post /v1/identity/sessions',
  'get /v1/identity/login/start',
  'post /v1/identity/login/start',
  'get /v1/identity/login/callback',
  'post /v1/identity/logout',
]

export function registerMcpAuthOpenApi(spec) {
  Object.assign(spec.components.schemas, {
    AuthProvider: {
      type: 'object',
      additionalProperties: false,
      required: ['protocol', 'id', 'label'],
      properties: {
        protocol: { type: 'string', enum: ['api_key', 'oidc'] },
        id: { type: 'string' },
        label: { type: 'string', enum: ['SSO', 'API key'] },
        issuer: { type: 'string', format: 'uri' },
      },
    },
    ProvidersResponse: {
      type: 'object',
      additionalProperties: false,
      required: ['providers'],
      properties: { providers: { type: 'array', items: { $ref: '#/components/schemas/AuthProvider' } } },
    },
    IdentitySessionRequest: {
      type: 'object',
      additionalProperties: false,
      required: ['provider_id', 'identity_token'],
      properties: {
        provider_id: { type: 'string', minLength: 1 },
        identity_token: { type: 'string', minLength: 1 },
      },
    },
    IdentitySessionResponse: {
      type: 'object',
      additionalProperties: false,
      required: ['api_key', 'principal_id', 'context_id', 'email'],
      properties: {
        api_key: { type: 'string' },
        principal_id: { type: 'string' },
        context_id: { type: ['string', 'null'] },
        email: { type: 'string' },
      },
    },
    OAuthError: {
      type: 'object',
      additionalProperties: true,
      properties: { error: { type: 'string' }, error_description: { type: 'string' }, code: { type: 'string' } },
    },
  })
  const tag = ['MCP authentication']
  const discovery = (operationId, summary) => ({
    get: {
      operationId,
      tags: tag,
      summary,
      responses: { 200: { description: 'Metadata', content: json({ type: 'object' }) } },
    },
  })
  Object.assign(spec.paths, {
    '/.well-known/oauth-protected-resource': discovery(
      'getOAuthProtectedResource',
      'Read MCP protected-resource metadata',
    ),
    '/.well-known/oauth-protected-resource/mcp': discovery(
      'getMcpOAuthProtectedResource',
      'Read MCP protected-resource metadata',
    ),
    '/.well-known/oauth-authorization-server': discovery(
      'getOAuthAuthorizationServer',
      'Read OAuth authorization-server metadata',
    ),
    '/v1/oauth/register': {
      post: {
        operationId: 'registerOAuthClient',
        tags: tag,
        summary: 'Register a public OAuth client',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['redirect_uris'],
            properties: {
              redirect_uris: { type: 'array', items: { type: 'string', format: 'uri' } },
              client_name: { type: 'string' },
            },
          }),
        },
        responses: { 201: { description: 'Client registered', content: json({ type: 'object' }) }, ...errors },
      },
    },
    '/v1/oauth/authorize': {
      get: {
        operationId: 'authorizeOAuthClient',
        tags: tag,
        summary: 'Start authorization-code login and consent',
        responses: {
          200: { description: 'Login or consent HTML', content: html },
          302: { description: 'Redirect' },
          ...errors,
        },
      },
    },
    '/v1/oauth/authorize/decision': {
      post: {
        operationId: 'decideOAuthConsent',
        tags: tag,
        summary: 'Approve or deny consent',
        requestBody: form,
        responses: { 302: { description: 'OAuth redirect' }, ...errors },
      },
    },
    '/v1/oauth/token': {
      post: {
        operationId: 'exchangeOAuthToken',
        tags: tag,
        summary: 'Exchange or refresh OAuth tokens',
        requestBody: form,
        responses: { 200: { description: 'Tokens', content: json({ type: 'object' }) }, ...errors },
      },
    },
    '/v1/oauth/revoke': {
      post: {
        operationId: 'revokeOAuthToken',
        tags: tag,
        summary: 'Revoke an OAuth token family',
        requestBody: form,
        responses: { 200: { description: 'Revoked' }, ...errors },
      },
    },
    '/v1/identity/providers': {
      get: {
        operationId: 'listIdentityProviders',
        tags: tag,
        summary: 'List available MCP authentication methods',
        responses: {
          200: {
            description: 'Canonical SSO-first method matrix',
            content: json({ $ref: '#/components/schemas/ProvidersResponse' }),
          },
        },
      },
    },
    '/v1/identity/sessions': {
      post: {
        operationId: 'createIdentitySession',
        tags: tag,
        summary: 'Exchange a configured identity assertion for a scoped API key',
        requestBody: { required: true, content: json({ $ref: '#/components/schemas/IdentitySessionRequest' }) },
        responses: {
          200: {
            description: 'Scoped product session',
            content: json({ $ref: '#/components/schemas/IdentitySessionResponse' }),
          },
          ...errors,
        },
      },
    },
    '/v1/identity/login/start': {
      get: {
        operationId: 'startIdentityLogin',
        tags: tag,
        summary: 'Show the SSO-first login chooser or start a selected method',
        responses: {
          200: { description: 'Login HTML', content: html },
          302: { description: 'Provider redirect' },
          ...errors,
        },
      },
      post: {
        operationId: 'submitApiKeyLogin',
        tags: tag,
        summary: 'Authenticate the API-key login method',
        requestBody: form,
        responses: { 200: { description: 'Consent HTML', content: html }, ...errors },
      },
    },
    '/v1/identity/login/callback': {
      get: {
        operationId: 'completeOidcLogin',
        tags: tag,
        summary: 'Complete an OIDC login adapter',
        responses: { 200: { description: 'Consent HTML', content: html }, 302: { description: 'Redirect' }, ...errors },
      },
    },
    '/v1/identity/logout': {
      post: {
        operationId: 'logoutIdentitySession',
        tags: tag,
        summary: 'Revoke the browser operator session',
        responses: { 200: { description: 'Logged out' }, 204: { description: 'Completed' } },
      },
    },
  })
}
