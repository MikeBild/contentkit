import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js'
import { compileCompositionMarkdown } from '../composition-output.mjs'
import { recommendPatterns } from '../composition-registry.mjs'
import { auditActor } from '../audit.mjs'
import { compileDeck, planDeck } from '../decks.mjs'
import {
  getCompositionStats,
  getContentStats,
  getDeckStats,
  getHttpStats,
  getMcpStats,
  getReleaseStats,
  getWebhookStats,
  resolveStatsWindow,
  resolveUsageStatsWindow,
} from '../stats.mjs'
import {
  PRODUCT_SCOPES,
  createIdentityGrant,
  listApiKeys,
  listIdentityGrants,
  publicIdentityGrant,
  requireApiKey,
  requireIdentityGrant,
  resolveApiKeyCreate,
  revokeApiKey,
  revokeIdentityGrant,
  updateIdentityGrant,
} from '../oauth/policy.mjs'
import { sha256 } from '../utils.mjs'
import { createDecision } from '../decisions.mjs'

const siteRef = z.string().min(1).max(100).describe('Site UUID or slug.')
const uuid = z.string().uuid()
const kind = z.enum(['page', 'post', 'project', 'deck'])
const locale = z.string().min(2).max(35)
const limitedMarkdown = z.string().min(1).max(262_144)

// Claude Code requires every tool inputSchema root to be type:"object" and
// rejects the entire tools list otherwise, so a discriminated-union root
// (oneOf without type) is flattened into one object schema for discovery.
// Runtime validation still runs the exact zod union via candidate.schema.
function flattenUnionSchema(schema) {
  const branches = schema.oneOf || schema.anyOf
  if (!branches || schema.type === 'object') return schema
  const discriminator = Object.keys(branches[0].properties || {}).find((key) =>
    branches.every((branch) => branch.properties?.[key]?.const !== undefined),
  )
  const required = (branches[0].required || []).filter((key) =>
    branches.every((branch) => (branch.required || []).includes(key)),
  )
  const properties = {}
  if (discriminator) {
    const perAction = branches.map((branch) => {
      const value = branch.properties[discriminator].const
      const extra = (branch.required || []).filter((key) => key !== discriminator && !required.includes(key))
      return extra.length ? `'${value}' additionally requires ${extra.join(', ')}` : `'${value}'`
    })
    properties[discriminator] = {
      type: 'string',
      enum: branches.map((branch) => branch.properties[discriminator].const),
      description: `One of ${perAction.join('; ')}.`,
    }
  }
  for (const branch of branches) {
    for (const [key, value] of Object.entries(branch.properties || {})) {
      if (key !== discriminator && !(key in properties)) properties[key] = value
    }
  }
  const { oneOf, anyOf, ...rest } = schema
  return { ...rest, type: 'object', properties, required }
}

function tool(definition) {
  const inputSchema = flattenUnionSchema(toJsonSchemaCompat(definition.schema, { target: 'draft-2020-12' }))
  // A renamed input may remain accepted at runtime for saved MCP workflows
  // without advertising the ambiguous legacy name to new agents.
  for (const property of definition.hiddenInputProperties || []) {
    delete inputSchema.properties?.[property]
    if (Array.isArray(inputSchema.required)) {
      inputSchema.required = inputSchema.required.filter((name) => name !== property)
    }
  }
  return {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      ...definition.annotations,
    },
    ...definition,
    inputSchema,
  }
}

function can(principal, scope) {
  return principal?.scopes?.includes('*') || principal?.scopes?.includes(scope)
}

function requireScope(deps, principal, scope, siteId = null) {
  if (!deps.auth.authorize(principal, scope, siteId)) {
    throw Object.assign(new Error('This operation is not available to the current principal.'), { statusCode: 403 })
  }
}

async function resolveSite(deps, principal, site, scope) {
  const row = await deps.repo.getSite(site)
  if (!row) throw Object.assign(new Error('site not found'), { statusCode: 404 })
  requireScope(deps, principal, scope, row.id)
  return row
}

async function resolveSiteAny(deps, principal, site, scopes) {
  const row = await deps.repo.getSite(site)
  if (!row) throw Object.assign(new Error('site not found'), { statusCode: 404 })
  if (!scopes.some((scope) => deps.auth.authorize(principal, scope, row.id))) {
    throw Object.assign(new Error('This operation is not available to the current principal.'), { statusCode: 403 })
  }
  return row
}

function requireAnyScope(deps, principal, scopes, siteId = null) {
  if (!scopes.some((scope) => deps.auth.authorize(principal, scope, siteId))) {
    throw Object.assign(new Error('This operation is not available to the current principal.'), { statusCode: 403 })
  }
}

async function audit(deps, principal, input) {
  return deps.audit.record({ ...auditActor(principal), transport: 'mcp', result: 'success', ...input })
}

async function recordDeckEvent(deps, siteId, event) {
  await deps.db
    .insert(
      'ck_deck_build_events',
      {
        site_id: siteId,
        mode: event.mode,
        result: event.result,
        execution: 'mcp',
        cache_result: event.cache_result || null,
        slide_count: event.slide_count || 0,
        svg_count: event.svg_count || 0,
        png_count: event.png_count || 0,
        output_bytes: event.output_bytes || 0,
        duration_ms: event.duration_ms || 0,
        diagnostic_count: event.diagnostic_count || 0,
      },
      { returning: false },
    )
    .catch((error) => deps.logger.warn('MCP deck metric write failed', { siteId, error: String(error) }))
}

// A form-mode cancel arriving faster than any human could have read the form
// is the CLIENT auto-cancelling (capability advertised, form never rendered) —
// from the wire indistinguishable from a deliberate dismissal except by time.
export const FORM_FAST_CANCEL_MS = 2000

async function confirm(context, message, label = 'Confirm') {
  const params = {
    mode: 'form',
    message,
    requestedSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        confirmed: {
          type: 'boolean',
          title: label,
          description: 'Confirm this exact operation after reviewing its target and effect.',
          default: false,
        },
      },
      required: ['confirmed'],
    },
  }
  let fastCancelled = false
  // One silent retry on fast cancel: the human never saw attempt 1.
  for (let attempt = 0; attempt < 2; attempt++) {
    const startedAt = Date.now()
    const result = await context.elicitForm(params)
    const elapsed = Date.now() - startedAt
    if (result.action === 'accept' && result.content?.confirmed === true) return
    fastCancelled = result.action === 'cancel' && elapsed < FORM_FAST_CANCEL_MS
    if (!fastCancelled) break
  }
  if (fastCancelled) {
    throw Object.assign(
      new Error('The MCP client auto-cancelled the confirmation form without presenting it; no change was made.'),
      { statusCode: 409, reason: 'elicitation_auto_cancelled' },
    )
  }
  throw Object.assign(new Error('Operation cancelled; no change was made.'), { statusCode: 409, cancelled: true })
}

function promotionReviewUrl(publicUrl, site, reviewId) {
  const url = new URL('/cockpit/releases', publicUrl)
  url.searchParams.set('site', site.slug || site.id)
  url.searchParams.set('promotion_review', reviewId)
  return url.toString()
}

async function elicitHandoffUrl(context, params) {
  // Same fast-cancel discrimination as confirm(): a client auto-cancel is not
  // a human decision, so retry once silently and never classify it as declined.
  for (let attempt = 0; attempt < 2; attempt++) {
    const startedAt = Date.now()
    const result = await context.elicitUrl(params)
    const fastCancelled = result.action === 'cancel' && Date.now() - startedAt < FORM_FAST_CANCEL_MS
    if (!fastCancelled) return result
  }
  throw Object.assign(
    new Error('The MCP client auto-cancelled the secret handoff without presenting it; no change was made.'),
    { statusCode: 409, reason: 'elicitation_auto_cancelled' },
  )
}

async function idempotent(deps, principal, operation, key, input, execute) {
  if (!key) return execute()
  const inputHash = sha256(JSON.stringify(input))
  const actorId = principal.id
  const rows = await deps.db.select('ck_idempotency_keys', {
    actor_id: `eq.${actorId}`,
    operation: `eq.${operation}`,
    idempotency_key: `eq.${key}`,
    limit: '1',
  })
  const existing = rows[0]
  if (existing) {
    if (new Date(existing.expires_at) <= new Date()) {
      await deps.db.remove('ck_idempotency_keys', { id: `eq.${existing.id}` })
      return idempotent(deps, principal, operation, key, input, execute)
    }
    if (existing.input_sha256 !== inputHash) {
      throw Object.assign(new Error('idempotency_key was already used with different input'), { statusCode: 409 })
    }
    if (existing.status === 'done') return existing.result
    throw Object.assign(new Error('an operation with this idempotency_key is already running'), { statusCode: 409 })
  }
  const id = randomUUID()
  try {
    await deps.db.insert('ck_idempotency_keys', {
      id,
      actor_id: actorId,
      operation,
      idempotency_key: key,
      input_sha256: inputHash,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
  } catch (error) {
    if (String(error.message || error).includes('unique'))
      return idempotent(deps, principal, operation, key, input, execute)
    throw error
  }
  try {
    const result = await execute()
    await deps.db.update('ck_idempotency_keys', { id: `eq.${id}` }, { status: 'done', result })
    return result
  } catch (error) {
    await deps.db.update('ck_idempotency_keys', { id: `eq.${id}` }, { status: 'failed' }).catch(() => {})
    throw error
  }
}

const TOOLS = [
  tool({
    name: 'contentkit_context',
    title: 'Select ContentKit context',
    description:
      'Start here. Lists the sites visible to the current principal and returns the safe read/author/publish workflow for the user task.',
    scopes: ['content:read'],
    schema: z.object({ task: z.string().min(1).max(1000), site_hint: z.string().max(100).optional() }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    async execute(deps, principal, input) {
      const sites = await deps.db.select('ck_sites', { order: 'name.asc' })
      const visible = sites.filter((site) => deps.auth.authorize(principal, 'content:read', site.id))
      const hinted = input.site_hint
        ? visible.find((site) => site.id === input.site_hint || site.slug === input.site_hint)
        : null
      return {
        task: input.task,
        selected_site: hinted || (visible.length === 1 ? visible[0] : null),
        sites: visible.map(({ id, slug, name, description, default_locale }) => ({
          id,
          slug,
          name,
          description,
          default_locale,
        })),
        workflow: [
          'Search and read published content before changing it.',
          'Ingest creates an immutable draft revision; it does not publish.',
          'Preview or compile semantic compositions and decks before publication.',
          'Publishing, activation, unpublishing and destructive administration require native human confirmation.',
        ],
        resources: ['contentkit://system/agent-guide', 'contentkit://docs/llms.txt'],
      }
    },
  }),
  tool({
    name: 'contentkit_sites',
    title: 'Read sites',
    description: 'List visible sites or retrieve one site with locales. This is read-only.',
    scopes: ['content:read'],
    schema: z.object({ site: siteRef.optional() }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    async execute(deps, principal, input) {
      if (input.site) {
        const site = await resolveSite(deps, principal, input.site, 'content:read')
        return { site, locales: await deps.repo.getLocales(site.id) }
      }
      const rows = await deps.db.select('ck_sites', { order: 'name.asc' })
      return { sites: rows.filter((site) => deps.auth.authorize(principal, 'content:read', site.id)) }
    },
  }),
  tool({
    name: 'contentkit_search',
    title: 'Search published content',
    description: 'Search the currently active published snapshot; never searches drafts.',
    scopes: ['content:read'],
    schema: z.object({
      site: siteRef,
      q: z.string().min(1).max(200),
      locale: locale.optional(),
      kind: kind.optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    async execute(deps, principal, input) {
      const site = await resolveSite(deps, principal, input.site, 'content:read')
      return deps.repo.searchPublished(site.id, input)
    },
  }),
  tool({
    name: 'contentkit_read',
    title: 'Read published content',
    description:
      'Read a published item including Markdown, semantic/narrative models, composition diagnostics and deck plan.',
    scopes: ['content:read'],
    schema: z.object({
      site: siteRef,
      kind,
      locale,
      slug: z.string().min(1).max(160),
      formats: z
        .array(z.enum(['svg', 'png']))
        .max(2)
        .default([]),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    async execute(deps, principal, input) {
      const site = await resolveSite(deps, principal, input.site, 'content:read')
      const entry = await deps.repo.getPublished(site.id, input.kind, input.locale, input.slug, {
        formats: input.formats,
      })
      if (!entry) throw Object.assign(new Error('published content not found'), { statusCode: 404 })
      return entry
    },
  }),
  tool({
    name: 'contentkit_content',
    title: 'Inspect content workspace',
    description:
      'List content items and immutable revisions in the authoring workspace, including draft/published state.',
    scopes: ['content:write'],
    schema: z.discriminatedUnion('action', [
      z.object({ action: z.literal('list'), site: siteRef, kind: kind.optional(), locale: locale.optional() }),
      z.object({ action: z.literal('revisions'), site: siteRef, item_id: uuid }),
      z.object({ action: z.literal('delete_draft'), site: siteRef, item_id: uuid }),
    ]),
    async execute(deps, principal, input, context) {
      const site = await resolveSite(deps, principal, input.site, 'content:write')
      if (input.action === 'list') return { items: await deps.repo.listContent(site.id, input) }
      const [item] = await deps.db.select('ck_content_items', {
        id: `eq.${input.item_id}`,
        site_id: `eq.${site.id}`,
        limit: '1',
      })
      if (!item) throw Object.assign(new Error('content item not found'), { statusCode: 404 })
      if (input.action === 'revisions') return { item, revisions: await deps.repo.revisions(item.id) }
      if (item.published_revision_id)
        throw Object.assign(new Error('published content cannot be deleted; unpublish it first'), { statusCode: 409 })
      await confirm(
        context,
        `Delete draft content item ${item.id} and all of its revisions? This cannot be undone.`,
        'Delete draft',
      )
      await deps.db.remove('ck_content_items', { id: `eq.${item.id}` })
      await audit(deps, principal, {
        siteId: site.id,
        action: 'content.delete_draft',
        resourceType: 'content',
        resourceId: item.id,
      })
      return { deleted: true, item_id: item.id }
    },
  }),
  tool({
    name: 'contentkit_ingest',
    title: 'Create a draft revision',
    description: 'Validate ContentKit Markdown and create an immutable draft revision. It never publishes.',
    scopes: ['content:write'],
    schema: z.object({ site: siteRef, markdown: limitedMarkdown, item_id: uuid.optional() }),
    async execute(deps, principal, input) {
      const site = await resolveSite(deps, principal, input.site, 'content:write')
      const result = await deps.repo.ingest(site.id, input.markdown, [], input.item_id || null)
      await audit(deps, principal, {
        siteId: site.id,
        action: 'content.ingest',
        resourceType: 'revision',
        resourceId: result.revision.id,
      })
      return result
    },
  }),
  tool({
    name: 'contentkit_composition',
    title: 'Design semantic visual compositions',
    description:
      'Recommend, validate or compile truthful semantic/narrative information architecture into accessible visual outputs.',
    scopes: ['content:write'],
    schema: z.object({
      action: z.enum(['recommend', 'validate', 'compile']),
      site: siteRef,
      markdown: limitedMarkdown,
      preferences: z.record(z.string(), z.unknown()).default({}),
      scheme: z.enum(['light', 'dark']).default('light'),
      outputs: z
        .array(z.enum(['model', 'html', 'svg', 'png', 'print']))
        .min(1)
        .max(5)
        .default(['model', 'html']),
      viewport: z.object({ width: z.number().int(), height: z.number().int() }).optional(),
    }),
    async execute(deps, principal, input) {
      const site = await resolveSite(deps, principal, input.site, 'content:write')
      const compiled = await compileCompositionMarkdown(input.markdown, {
        settings: site.settings || {},
        scheme: input.scheme,
        outputs: input.action === 'compile' ? input.outputs : ['model'],
        viewport: input.viewport,
      })
      if (input.action === 'recommend') {
        return {
          recommendations: recommendPatterns(compiled.semantic, input.preferences, input.viewport || {}),
          semantic: compiled.semantic,
          narrative: compiled.narrative,
        }
      }
      if (input.action === 'validate') {
        return {
          valid: !compiled.diagnostics.some((entry) => entry.severity === 'error'),
          diagnostics: compiled.diagnostics,
          semantic: compiled.semantic,
          narrative: compiled.narrative,
          composition: compiled.composition,
        }
      }
      await audit(deps, principal, {
        siteId: site.id,
        action: 'composition.compile',
        resourceType: 'composition',
        metadata: { outputs: input.outputs },
      })
      return compiled
    },
  }),
  tool({
    name: 'contentkit_deck',
    title: 'Plan, validate or compile slide decks',
    description: 'Turn narrative Markdown into a source-traceable deck plan and semantic visual slide artifacts.',
    scopes: ['deck:render'],
    schema: z.object({
      action: z.enum(['plan', 'validate', 'compile']),
      site: siteRef,
      markdown: limitedMarkdown,
      preferences: z.record(z.string(), z.unknown()).default({}),
      include_artifacts: z.boolean().default(false),
    }),
    async execute(deps, principal, input) {
      const site = await resolveSite(deps, principal, input.site, 'deck:render')
      const started = Date.now()
      try {
        const plan = await planDeck(input.markdown, input.preferences)
        if (input.action === 'plan') {
          await recordDeckEvent(deps, site.id, {
            mode: 'plan',
            result: 'success',
            slide_count: plan.slides.length,
            diagnostic_count: plan.diagnostics.length,
            duration_ms: Date.now() - started,
          })
          return plan
        }
        if (input.action === 'validate') {
          const valid = !plan.diagnostics.some((entry) => entry.severity === 'error')
          await recordDeckEvent(deps, site.id, {
            mode: 'validate',
            result: valid ? 'success' : 'rejected',
            slide_count: plan.slides.length,
            diagnostic_count: plan.diagnostics.length,
            duration_ms: Date.now() - started,
          })
          return {
            valid,
            diagnostics: plan.diagnostics,
            plan,
          }
        }
        let cacheResult = null
        const compile = (render) =>
          compileDeck(input.markdown, {
            settings: site.settings || {},
            preferences: input.preferences,
            includeArtifactData: input.include_artifacts,
            renderHtml: async (markdown, theme) => {
              const rendered = await render(markdown, theme)
              cacheResult = rendered.cache
              return rendered.html
            },
          })
        const result = deps.deckRenderer.run
          ? await deps.deckRenderer.run(compile)
          : await compile(deps.deckRenderer.render.bind(deps.deckRenderer))
        const visualCount = result.artifacts.length * (result.plan.settings.visual_scheme === 'auto' ? 2 : 1)
        await recordDeckEvent(deps, site.id, {
          mode: 'compile',
          result: 'success',
          cache_result: cacheResult,
          slide_count: result.plan.slides.length,
          svg_count: visualCount,
          png_count: visualCount,
          output_bytes: Buffer.byteLength(result.html || ''),
          diagnostic_count: result.plan.diagnostics.length,
          duration_ms: Date.now() - started,
        })
        await audit(deps, principal, {
          siteId: site.id,
          action: 'deck.compile',
          resourceType: 'deck',
          metadata: { slides: result.plan.slides.length },
        })
        return result
      } catch (error) {
        await recordDeckEvent(deps, site.id, {
          mode: input.action,
          result: error.code === 'TIMEOUT' ? 'timeout' : 'error',
          duration_ms: Date.now() - started,
        })
        throw error
      }
    },
  }),
  tool({
    name: 'contentkit_releases',
    title: 'Inspect releases',
    description: 'List release/preview history or retrieve a release. Read-only.',
    scopes: ['content:read'],
    schema: z.object({ site: siteRef, release_id: uuid.optional() }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    async execute(deps, principal, input) {
      const site = await resolveSite(deps, principal, input.site, 'content:read')
      if (!input.release_id) return { releases: await deps.repo.listReleases(site.id) }
      const release = await deps.repo.getRelease(input.release_id)
      if (!release || release.site_id !== site.id)
        throw Object.assign(new Error('release not found'), { statusCode: 404 })
      return release
    },
  }),
  tool({
    name: 'contentkit_publish',
    title: 'Preview, promote, publish, activate or unpublish',
    description:
      'Lifecycle boundary for immutable releases. Promote/publish/activate/unpublish require a human decision. Native form elicitation is primary; immutable promotion returns an exact ContentKit Cockpit review link when the calling client cannot render a live form.',
    scopes: ['release:preview', 'release:write'],
    schema: z
      .object({
        action: z.enum(['preview', 'promote', 'publish', 'activate', 'unpublish']),
        site: siteRef,
        revision_ids: z
          .array(uuid)
          .max(200)
          .default([])
          .describe('Immutable revision IDs to add or replace for preview/publish. Do not pass content item IDs.'),
        retire_item_ids: z
          .array(uuid)
          .max(200)
          .default([])
          .describe('Content item IDs to remove from the preview or live site. Leave empty for additive publication.'),
        // Backward compatibility for saved workflows authored before the field
        // was named after its destructive meaning. It is hidden from tools/list.
        item_ids: z.array(uuid).max(200).optional(),
        release_id: uuid.optional(),
        manifest_sha256: z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .optional(),
        reason: z.string().max(500).default('MCP operation'),
        preview_slug: z.string().max(80).optional(),
        expires_in: z.number().int().min(60).max(604800).default(3600),
        idempotency_key: z.string().min(8).max(128).optional(),
      })
      .superRefine((input, context) => {
        if (input.item_ids !== undefined && input.retire_item_ids.length > 0) {
          context.addIssue({
            code: 'custom',
            path: ['retire_item_ids'],
            message: 'Use retire_item_ids only; do not combine it with the deprecated item_ids alias.',
          })
        }
      }),
    hiddenInputProperties: ['item_ids'],
    annotations: { destructiveHint: true },
    async execute(deps, principal, input, context) {
      const retireItemIds = input.retire_item_ids?.length > 0 ? input.retire_item_ids : input.item_ids || []
      const site =
        input.action === 'preview'
          ? await resolveSiteAny(deps, principal, input.site, ['release:preview', 'release:write'])
          : await resolveSite(deps, principal, input.site, 'release:write')
      if (input.action === 'preview') {
        const result = await deps.releases.preview({
          siteId: site.id,
          revisionIds: input.revision_ids,
          retireItemIds,
          expiresIn: input.expires_in,
          previewSlug: input.preview_slug,
          reason: input.reason,
        })
        await audit(deps, principal, {
          siteId: site.id,
          action: 'release.preview',
          resourceType: 'release',
          resourceId: result.release_id,
        })
        return result
      }
      // Preview promotion has a durable browser fallback. A nested MCP client
      // (for example an orchestration engine calling ContentKit) often cannot
      // render a second, live form inside its own tool call. Failing there made
      // the exact promotion path unusable even though ContentKit already owns
      // every immutable binding the reviewer needs. ContentKit stores those
      // bindings in a promotion-review row and the browser URL carries only its
      // opaque id.
      //
      // The fallback does NOT approve or mutate anything. It hands the human to
      // ContentKit Cockpit, whose operator session, CSRF gate and release:write
      // scope protect the final POST. The promote endpoint re-checks the exact
      // manifest and publish epoch, so changing the site after review fails
      // closed. Other destructive actions have no immutable preview object and
      // continue to require live form elicitation.
      if (input.action === 'promote' && context?.formElicitationSupported === false) {
        if (!input.release_id || !input.manifest_sha256)
          throw Object.assign(new Error('release_id and manifest_sha256 are required for promote'), {
            statusCode: 422,
          })
        const release = await deps.repo.getRelease(input.release_id)
        if (
          !release ||
          release.site_id !== site.id ||
          release.kind !== 'preview' ||
          release.status !== 'preview' ||
          release.manifest_sha256 !== input.manifest_sha256
        ) {
          throw Object.assign(new Error('preview not found or manifest binding does not match'), { statusCode: 409 })
        }
        const transact = deps.db.tx ? deps.db.tx.bind(deps.db) : async (fn) => fn(deps.db)
        const review = await transact(async (tx) => {
          const existing = await tx.select('ck_promotion_reviews', {
            site_id: `eq.${site.id}`,
            release_id: `eq.${input.release_id}`,
            manifest_sha256: `eq.${input.manifest_sha256}`,
            limit: '1',
          })
          if (existing[0]) return existing[0]
          const [created] = await tx.insert('ck_promotion_reviews', {
            id: randomUUID(),
            site_id: site.id,
            release_id: input.release_id,
            manifest_sha256: input.manifest_sha256,
            status: 'pending',
            reason: input.reason || '',
          })
          await createDecision(tx, {
            siteId: site.id,
            kind: 'promotion',
            sourceId: created.id,
            sourceVersion: input.manifest_sha256,
            openedAt: created.requested_at,
          })
          const event = {
            ...auditActor(principal),
            siteId: site.id,
            action: 'promotion_review.request',
            resourceType: 'promotion_review',
            resourceId: created.id,
            result: 'success',
            transport: 'mcp',
            metadata: { release_id: input.release_id, manifest_sha256: input.manifest_sha256 },
          }
          if (deps.audit.recordStrict) await deps.audit.recordStrict(event, tx)
          else await deps.audit.record(event)
          return created
        })
        const reviewUrl = promotionReviewUrl(context.publicUrl, site, review.id)
        return {
          status: review.status === 'rejected' ? 'human_review_rejected' : 'human_review_required',
          mutation_applied: false,
          promotion_review_id: review.id,
          release_id: input.release_id,
          manifest_sha256: input.manifest_sha256,
          review_url: reviewUrl,
          poll_with: 'contentkit_releases',
          agent_instructions:
            `Give the operator this exact ContentKit review link: ${reviewUrl} ` +
            'ContentKit will promote only after the signed-in human confirms there. ' +
            'Do not infer approval, do not call promote again, and verify the release and live site after the browser decision.',
        }
      }
      const summary =
        input.action === 'promote'
          ? `Promote reviewed preview ${input.release_id} for ${site.name}? This activates the exact immutable preview and changes the live site.`
          : input.action === 'activate'
            ? `Activate release ${input.release_id} for ${site.name}? This changes the live site.`
            : input.action === 'unpublish'
              ? `Unpublish ${retireItemIds.length} content item(s) from ${site.name}? This changes the live site.`
              : `Publish ${input.revision_ids.length} revision(s) to ${site.name}? This changes the live site.`
      await confirm(context, summary, input.action === 'unpublish' ? 'Unpublish' : 'Change live site')
      if (input.action === 'promote') {
        const approvalAudit = await audit(deps, principal, {
          siteId: site.id,
          action: 'release.promote.approved',
          resourceType: 'release',
          resourceId: input.release_id,
          metadata: { manifest_sha256: input.manifest_sha256 },
        })
        if (!approvalAudit) {
          throw Object.assign(
            new Error('The human decision could not be written to the audit log; no change was made.'),
            { statusCode: 503, reason: 'approval_audit_unavailable' },
          )
        }
      }
      const execute = async () => {
        if (input.action === 'promote') {
          if (!input.release_id || !input.manifest_sha256)
            throw Object.assign(new Error('release_id and manifest_sha256 are required for promote'), {
              statusCode: 422,
            })
          return deps.releases.promote({
            siteId: site.id,
            releaseId: input.release_id,
            manifestSha256: input.manifest_sha256,
          })
        }
        if (input.action === 'activate') {
          if (!input.release_id)
            throw Object.assign(new Error('release_id is required for activate'), { statusCode: 422 })
          return deps.releases.rollback(site.id, input.release_id)
        }
        return deps.releases.publish({
          siteId: site.id,
          revisionIds: input.action === 'publish' ? input.revision_ids : [],
          retireItemIds: input.action === 'unpublish' ? retireItemIds : [],
          reason: input.reason,
        })
      }
      const result = await idempotent(deps, principal, `release.${input.action}`, input.idempotency_key, input, execute)
      await audit(deps, principal, {
        siteId: site.id,
        action: `release.${input.action}`,
        resourceType: 'release',
        resourceId: result.release_id,
      })
      return result
    },
  }),
  tool({
    name: 'contentkit_stats',
    title: 'Read product statistics',
    description: 'Read privacy-bounded release, content, deck, webhook, HTTP or composition statistics.',
    scopes: ['stats:read', 'content:read'],
    schema: z.object({
      surface: z.enum(['releases', 'content', 'decks', 'webhooks', 'http', 'compositions', 'mcp']),
      site: siteRef,
      bucket: z.enum(['hour', 'day', 'month', 'year']).default('hour'),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      traffic_class: z.enum(['organic', 'synthetic', 'internal', 'all']).default('organic'),
      group_by: z.string().max(80).optional(),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    async execute(deps, principal, input) {
      const site = await resolveSiteAny(deps, principal, input.site, ['stats:read', 'content:read'])
      if (input.surface === 'releases') return getReleaseStats(deps.db, site.id, resolveStatsWindow(input))
      if (input.surface === 'content') return getContentStats(deps.db, site.id, resolveStatsWindow(input))
      if (input.surface === 'decks') return getDeckStats(deps.db, site.id, resolveStatsWindow(input))
      if (input.surface === 'webhooks') return getWebhookStats(deps.db, site.id, resolveStatsWindow(input))
      const window = resolveUsageStatsWindow(input, input.surface)
      if (input.surface === 'http') return getHttpStats(deps.db, site.id, window, deps.usage.quality())
      if (input.surface === 'mcp') return getMcpStats(deps.db, site.id, window, deps.usage.quality())
      return getCompositionStats(deps.db, site.id, window, deps.usage.quality())
    },
  }),
  tool({
    name: 'contentkit_manage_sites',
    title: 'Administer sites',
    description: 'CRUD administration for site configuration. Mutations require human confirmation.',
    scopes: ['site:admin'],
    schema: z.discriminatedUnion('action', [
      z.object({
        action: z.literal('create'),
        name: z.string().min(1).max(160),
        slug: z.string().max(100).optional(),
        description: z.string().max(2000).default(''),
        base_url: z.string().url(),
        default_locale: locale,
        locales: z.array(locale).min(1).max(50),
        domains: z.array(z.string().max(253)).max(50).default([]),
        settings: z.record(z.string(), z.unknown()).default({}),
      }),
      z.object({ action: z.literal('update'), site: siteRef, patch: z.record(z.string(), z.unknown()) }),
    ]),
    async execute(deps, principal, input, context) {
      requireScope(deps, principal, 'site:admin')
      if (input.action === 'create' && Array.isArray(principal.site_ids) && principal.site_ids.length > 0) {
        throw Object.assign(new Error('creating a site requires an unrestricted site administrator'), {
          statusCode: 403,
        })
      }
      await confirm(
        context,
        `${input.action === 'create' ? 'Create' : 'Update'} ContentKit site configuration?`,
        `${input.action} site`,
      )
      const result =
        input.action === 'create'
          ? await deps.repo.createSite(input)
          : await deps.repo.updateSite((await resolveSite(deps, principal, input.site, 'site:admin')).id, input.patch)
      if (!result) throw Object.assign(new Error('site not found'), { statusCode: 404 })
      await audit(deps, principal, {
        siteId: result.id,
        action: `site.${input.action}`,
        resourceType: 'site',
        resourceId: result.id,
      })
      return result
    },
  }),
  tool({
    name: 'contentkit_manage_access',
    title: 'Administer reader access',
    description:
      'CRUD for reader users, groups and path rules. Read actions are direct; mutations require confirmation.',
    scopes: ['access:admin', 'site:admin'],
    schema: z.object({
      action: z.enum([
        'list_users',
        'create_user',
        'update_user',
        'delete_user',
        'list_groups',
        'create_group',
        'update_group',
        'delete_group',
        'list_rules',
        'create_rule',
        'update_rule',
        'delete_rule',
      ]),
      site: siteRef,
      id: uuid.optional(),
      input: z.record(z.string(), z.unknown()).default({}),
    }),
    async execute(deps, principal, input, context) {
      const site = await resolveSiteAny(deps, principal, input.site, ['access:admin', 'site:admin'])
      const [verb, noun] = input.action.split('_')
      if (verb === 'list') {
        const method = noun === 'users' ? 'listAccessUsers' : noun === 'groups' ? 'listAccessGroups' : 'listAccessRules'
        return { [noun]: await deps.repo[method](site.id) }
      }
      if (verb !== 'create' && !input.id) throw Object.assign(new Error('id is required'), { statusCode: 422 })
      await confirm(context, `${verb} reader-access ${noun.replace(/s$/, '')} on ${site.name}?`, `${verb} ${noun}`)
      const singular = noun.replace(/s$/, '')
      const suffix = singular[0].toUpperCase() + singular.slice(1)
      const method = `${verb}Access${suffix}`
      const result =
        verb === 'create'
          ? await deps.repo[method](site.id, input.input)
          : await deps.repo[method](site.id, input.id, input.input)
      if (!result) throw Object.assign(new Error(`access ${singular} not found`), { statusCode: 404 })
      await audit(deps, principal, {
        siteId: site.id,
        action: `access.${singular}.${verb}`,
        resourceType: `access_${singular}`,
        resourceId: result?.id || input.id,
      })
      return verb === 'delete' ? { deleted: true, id: input.id } : result
    },
  }),
  tool({
    name: 'contentkit_manage_webhooks',
    title: 'Administer webhooks',
    description:
      'CRUD and delivery retry for site webhooks. Creation/rotation secrets use native URL elicitation and never pass through the MCP client.',
    scopes: ['webhook:admin', 'site:admin'],
    schema: z.object({
      action: z.enum(['list', 'create', 'update', 'delete', 'rotate', 'deliveries', 'retry']),
      site: siteRef,
      id: uuid.optional(),
      input: z.record(z.string(), z.unknown()).default({}),
    }),
    async execute(deps, principal, input, context) {
      const site = await resolveSiteAny(deps, principal, input.site, ['webhook:admin', 'site:admin'])
      if (input.action === 'list') return { webhooks: await deps.repo.listWebhookEndpoints(site.id) }
      if (input.action === 'deliveries')
        return { deliveries: await deps.repo.listDeliveries({ siteId: site.id, endpointId: input.id, limit: 50 }) }
      if (input.action !== 'create' && !input.id) throw Object.assign(new Error('id is required'), { statusCode: 422 })
      if (['create', 'rotate'].includes(input.action) && !context.elicitUrl)
        throw Object.assign(new Error('Webhook secret handoff requires MCP URL elicitation support.'), {
          statusCode: 409,
          reason: 'elicitation_unsupported',
        })
      let deliveryToRetry
      if (input.action === 'retry') {
        deliveryToRetry = await deps.repo.getDelivery(input.id)
        if (!deliveryToRetry || deliveryToRetry.site_id !== site.id) {
          throw Object.assign(new Error('webhook delivery not found'), { statusCode: 404 })
        }
      }
      await confirm(context, `${input.action} webhook configuration on ${site.name}?`, `${input.action} webhook`)
      let result
      let previousSecret
      if (input.action === 'create')
        result = await deps.repo.createWebhookEndpoint(site.id, { ...input.input, enabled: false })
      else if (input.action === 'update') result = await deps.repo.updateWebhookEndpoint(site.id, input.id, input.input)
      else if (input.action === 'delete') result = await deps.repo.deleteWebhookEndpoint(site.id, input.id)
      else if (input.action === 'rotate') {
        ;[previousSecret] = await deps.db.select('ck_webhook_endpoints', {
          id: `eq.${input.id}`,
          site_id: `eq.${site.id}`,
          limit: '1',
        })
        result = await deps.repo.rotateWebhookSecret(site.id, input.id, { disable: true })
      } else result = await deps.repo.retryDelivery(deliveryToRetry.id)
      if (!result) throw Object.assign(new Error('webhook endpoint or delivery not found'), { statusCode: 404 })
      const secret = result?.secret
      const safe =
        input.action === 'delete'
          ? { deleted: true, id: input.id }
          : result && typeof result === 'object'
            ? Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'secret'))
            : {}
      if (['create', 'rotate'].includes(input.action)) {
        if (!secret) throw Object.assign(new Error('webhook endpoint not found'), { statusCode: 404 })
        // URL handoffs are process-local. Keep a new/rotated endpoint disabled
        // until the browser has activated the one-time handoff so a crash can
        // never leave an unknown signing secret in active use.
        await deps.db.update(
          'ck_webhook_endpoints',
          { id: `eq.${result.id}`, site_id: `eq.${site.id}` },
          { disabled_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          { returning: false },
        )
        const handoff = deps.secretHandoffs.create({
          secret,
          label: `ContentKit webhook secret ${result.id}`,
          onReveal: () =>
            deps.db.update(
              'ck_webhook_endpoints',
              { id: `eq.${result.id}`, site_id: `eq.${site.id}` },
              {
                disabled_at: input.action === 'create' ? null : previousSecret.disabled_at || null,
                updated_at: new Date().toISOString(),
              },
              { returning: false },
            ),
          onExpire: () =>
            input.action === 'create'
              ? deps.db.remove('ck_webhook_endpoints', { id: `eq.${result.id}`, site_id: `eq.${site.id}` })
              : deps.db.update(
                  'ck_webhook_endpoints',
                  { id: `eq.${result.id}`, site_id: `eq.${site.id}` },
                  {
                    secret_encrypted: previousSecret.secret_encrypted,
                    disabled_at: previousSecret.disabled_at || null,
                    updated_at: new Date().toISOString(),
                  },
                  { returning: false },
                ),
        })
        let elicited
        try {
          elicited = await elicitHandoffUrl(context, {
            mode: 'url',
            message:
              'Open ContentKit to reveal this webhook signing secret once. It never passes through the MCP client.',
            url: handoff.url,
            elicitationId: handoff.id,
          })
        } catch (error) {
          await deps.secretHandoffs.cancel(handoff.id)
          throw error
        }
        if (elicited.action !== 'accept') {
          await deps.secretHandoffs.cancel(handoff.id)
          throw Object.assign(new Error('Webhook secret change cancelled and rolled back.'), {
            statusCode: 409,
            cancelled: true,
          })
        }
        safe.status = 'secret_handoff_pending'
        safe.expires_in_seconds = handoff.expiresInSeconds
      }
      await audit(deps, principal, {
        siteId: site.id,
        action: `webhook.${input.action}`,
        resourceType: 'webhook',
        resourceId: result?.id || input.id,
      })
      return safe
    },
  }),
  tool({
    name: 'contentkit_manage_api_keys',
    title: 'Administer API keys',
    description:
      'List, create or revoke API keys. Creation uses native URL elicitation so the secret never passes through the MCP client.',
    scopes: ['api-key:admin', 'site:admin'],
    schema: z.object({
      action: z.enum(['list', 'create', 'revoke']),
      id: uuid.optional(),
      name: z.string().max(160).optional(),
      scopes: z.array(z.enum(PRODUCT_SCOPES)).max(PRODUCT_SCOPES.length).optional(),
      site_ids: z.array(uuid).max(100).optional(),
      expires_at: z.string().datetime().optional(),
    }),
    async execute(deps, principal, input, context) {
      requireAnyScope(deps, principal, ['api-key:admin', 'site:admin'])
      if (input.action === 'list') return { api_keys: await listApiKeys(deps.db, principal) }
      if (input.action === 'revoke') {
        if (!input.id) throw Object.assign(new Error('id is required'), { statusCode: 422 })
        // Containment first: a key this principal may not see must be a 404
        // before the operator is shown a confirmation naming it.
        await requireApiKey(deps.db, principal, input.id)
        await confirm(
          context,
          `Revoke API key ${input.id}? Existing clients using it will stop working.`,
          'Revoke API key',
        )
        const row = await revokeApiKey(deps.db, input.id)
        await audit(deps, principal, { action: 'api_key.revoke', resourceType: 'api_key', resourceId: row.id })
        return { revoked: true, id: row.id }
      }
      if (!context.elicitUrl)
        throw Object.assign(new Error('API key creation requires a client with MCP URL elicitation.'), {
          statusCode: 409,
          reason: 'elicitation_unsupported',
        })
      const created = await deps.repo.createApiKey(
        resolveApiKeyCreate(principal, input, (scope) => deps.auth.authorize(principal, scope)),
      )
      // A handoff must fail closed across a process crash: keep the key revoked
      // until the one-time page is actually opened, then activate it immediately
      // before revealing the secret.
      await deps.db.update(
        'ck_api_keys',
        { id: `eq.${created.id}` },
        { revoked_at: new Date().toISOString() },
        { returning: false },
      )
      const handoff = deps.secretHandoffs.create({
        secret: created.key,
        label: `ContentKit API key ${created.key_prefix}`,
        onReveal: () =>
          deps.db.update('ck_api_keys', { id: `eq.${created.id}` }, { revoked_at: null }, { returning: false }),
        onExpire: () =>
          deps.db
            .update('ck_api_keys', { id: `eq.${created.id}` }, { revoked_at: new Date().toISOString() })
            .catch(() => {}),
      })
      let result
      try {
        result = await elicitHandoffUrl(context, {
          mode: 'url',
          message: 'Open ContentKit to reveal this new API key once. The secret never passes through the MCP client.',
          url: handoff.url,
          elicitationId: handoff.id,
        })
      } catch (error) {
        await deps.secretHandoffs.cancel(handoff.id)
        throw error
      }
      if (result.action !== 'accept') {
        await deps.secretHandoffs.cancel(handoff.id)
        await deps.db.update('ck_api_keys', { id: `eq.${created.id}` }, { revoked_at: new Date().toISOString() })
        throw Object.assign(new Error('API key creation cancelled and the new key was revoked.'), {
          statusCode: 409,
          cancelled: true,
        })
      }
      await audit(deps, principal, { action: 'api_key.create', resourceType: 'api_key', resourceId: created.id })
      return {
        id: created.id,
        key_prefix: created.key_prefix,
        status: 'secret_handoff_pending',
        expires_in_seconds: handoff.expiresInSeconds,
      }
    },
  }),
  tool({
    name: 'contentkit_manage_identities',
    title: 'Administer OAuth identity grants',
    description: 'Pre-provision, update or revoke exact OIDC subject grants and their product-scope/site ceiling.',
    scopes: ['identity:admin'],
    schema: z.object({
      action: z.enum(['list', 'create', 'update', 'revoke']),
      id: uuid.optional(),
      input: z.record(z.string(), z.unknown()).default({}),
    }),
    async execute(deps, principal, input, context) {
      requireScope(deps, principal, 'identity:admin')
      if (input.action === 'list') {
        return { identities: await listIdentityGrants(deps.db, principal, input.input) }
      }
      if (input.action !== 'create' && !input.id) throw Object.assign(new Error('id is required'), { statusCode: 422 })
      // Resolved before the confirmation, not after: a grant this principal may
      // not see must 404 without ever being described to the operator.
      const restore = input.action === 'update' && input.input.restore === true
      if (input.action !== 'create') await requireIdentityGrant(deps.db, principal, input.id, { restore })
      await confirm(
        context,
        `${input.action} OAuth identity grant${input.id ? ` ${input.id}` : ''}?`,
        `${input.action} identity`,
      )
      const result =
        input.action === 'create'
          ? await createIdentityGrant(deps.db, principal, input.input, deps.config.oauthProviders || [])
          : input.action === 'update'
            ? await updateIdentityGrant(deps.db, principal, input.id, input.input)
            : await revokeIdentityGrant(deps.db, input.id)
      await audit(deps, principal, {
        action: `identity.${input.action}`,
        resourceType: 'identity_grant',
        resourceId: result.id,
      })
      return publicIdentityGrant(result)
    },
  }),
  tool({
    name: 'contentkit_moderation',
    title: 'Moderate comments',
    description: 'List pending comments or approve/reject one with human confirmation.',
    scopes: ['moderation:write'],
    schema: z.object({
      action: z.enum(['list', 'approve', 'reject']),
      site: siteRef,
      id: uuid.optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    async execute(deps, principal, input, context) {
      const site = await resolveSite(deps, principal, input.site, 'moderation:write')
      if (input.action === 'list')
        return {
          comments: await deps.db.select('ck_comments', {
            site_id: `eq.${site.id}`,
            status: 'eq.pending',
            order: 'created_at.asc',
            limit: String(input.limit),
          }),
        }
      if (!input.id) throw Object.assign(new Error('id is required'), { statusCode: 422 })
      await confirm(context, `${input.action} comment ${input.id} on ${site.name}?`, `${input.action} comment`)
      const [row] = await deps.db.update(
        'ck_comments',
        { id: `eq.${input.id}`, site_id: `eq.${site.id}`, status: 'eq.pending' },
        { status: input.action === 'approve' ? 'approved' : 'rejected' },
      )
      if (!row) throw Object.assign(new Error('pending comment not found'), { statusCode: 404 })
      await audit(deps, principal, {
        siteId: site.id,
        action: `comment.${input.action}`,
        resourceType: 'comment',
        resourceId: row.id,
      })
      return row
    },
  }),
  tool({
    name: 'contentkit_audit',
    title: 'Read audit events',
    description: 'Query append-only, redacted administrative and publication audit events.',
    scopes: ['audit:read'],
    schema: z.object({
      site: siteRef.optional(),
      action: z.string().max(120).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    async execute(deps, principal, input) {
      requireScope(deps, principal, 'audit:read')
      let siteId
      if (input.site) siteId = (await resolveSite(deps, principal, input.site, 'audit:read')).id
      const rows = await deps.db.select('ck_audit_events', {
        ...(siteId ? { site_id: `eq.${siteId}` } : {}),
        ...(input.action ? { action: `eq.${input.action}` } : {}),
        order: 'created_at.desc',
        limit: String(input.limit),
      })
      const ceiling = Array.isArray(principal.site_ids) ? principal.site_ids : []
      return {
        events: ceiling.length ? rows.filter((row) => row.site_id && ceiling.includes(row.site_id)) : rows,
      }
    },
  }),
]

export function visibleTools(principal) {
  return TOOLS.filter((candidate) => candidate.scopes.some((scope) => can(principal, scope)))
}

export function buildToolManifest(principal) {
  return visibleTools(principal).map(({ name, title, description, inputSchema, annotations }) => ({
    name,
    title,
    description,
    inputSchema,
    annotations,
  }))
}

export function findTool(principal, name) {
  return visibleTools(principal).find((candidate) => candidate.name === name)
}
