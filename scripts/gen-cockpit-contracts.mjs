import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openApi } from '../src/openapi.mjs'
import { PRODUCT_SCOPES } from '../src/oauth/policy.mjs'
import { THEME_TOKEN_ALLOWLIST } from '../src/repository.mjs'
import { WEBHOOK_EVENT_TYPES } from '../src/webhook-events.mjs'
import { VERSION } from '../src/version.mjs'

// The Cockpit's forms may not restate a closed set. Every enum select, scope
// picker and token menu in apps/cockpit reads its options from the file this
// script emits, so a set that changes on the server changes in the console in
// the same commit — or docs-drift fails. The generator is deliberately
// selector-based rather than a blind walk of every `enum` in the spec: a
// generated file nobody can read is one nobody keeps honest.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const OUTPUT = join(root, 'apps', 'cockpit', 'src', 'forms', 'contracts', 'enums.generated.ts')

/**
 * Walks a schema by property name, transparently stepping through `properties`
 * and `items` so a selector reads like the shape it describes rather than like
 * JSON Schema.
 */
function descend(node, path, where) {
  let current = node
  for (const segment of path) {
    const next = current?.properties?.[segment] ?? current?.[segment]
    if (!next) throw new Error(`${where}: no such member ${path.join('.')}`)
    current = next
  }
  const values = current.enum
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${where}: ${path.join('.')} has no enum`)
  // `null` appears in nullable enums (a content item with no revision yet). A
  // select offers absence through its own empty option, never as a member.
  return values.filter((value) => value !== null)
}

function operation(spec, operationId) {
  for (const methods of Object.values(spec.paths)) {
    for (const candidate of Object.values(methods)) {
      if (candidate?.operationId === operationId) return candidate
    }
  }
  throw new Error(`unknown operationId ${operationId}`)
}

const sources = (spec) => ({
  schema: (name, ...path) => {
    const schema = spec.components?.schemas?.[name]
    if (!schema) throw new Error(`unknown schema ${name}`)
    return descend(schema, path, `schemas.${name}`)
  },
  query: (operationId, name) => {
    const parameter = operation(spec, operationId).parameters?.find((entry) => entry.name === name)
    if (!parameter) throw new Error(`${operationId}: no query parameter ${name}`)
    return descend(parameter.schema, [], `${operationId}?${name}`)
  },
  requestBody: (operationId, ...path) =>
    descend(
      operation(spec, operationId).requestBody?.content?.['application/json']?.schema,
      path,
      `${operationId} body`,
    ),
  response: (operationId, ...path) =>
    descend(
      operation(spec, operationId).responses?.[200]?.content?.['application/json']?.schema,
      path,
      `${operationId} 200`,
    ),
})

// Order is the order the console offers the options in, so it is the spec's
// order everywhere — the server already lists the safe or common member first.
function openApiEnums(spec) {
  const { schema, query, requestBody, response } = sources(spec)
  return [
    ['CONTENT_KIND', 'ContentKind', schema('ContentItem', 'kind')],
    ['REVISION_STATUS', 'RevisionStatus', schema('ContentItem', 'latest_revision_status')],
    ['COMMENT_STATUS', 'CommentStatus', query('commentList', 'status')],
    ['CONTACT_STATUS', 'ContactStatus', requestBody('contactSubmissionUpdate', 'status')],
    ['WEBHOOK_DELIVERY_STATUS', 'WebhookDeliveryStatus', query('webhookDeliveryList', 'status')],
    ['AUDIO_JOB_STATUS', 'AudioJobStatus', query('audioJobList', 'status')],
    ['ACCESS_RULE_MATCH', 'AccessRuleMatch', schema('AccessRule', 'match')],
    ['OPERATOR_ROLE', 'OperatorRole', response('describeCockpitSession', 'role')],
    ['PRESENTATION_PRESET', 'PresentationPreset', schema('SitePresentationSettings', 'preset')],
    ['REPORT_CADENCE', 'ReportCadence', schema('ReportSeriesSetting', 'lead_cadence')],
    ['RENDER_SCHEME', 'RenderScheme', requestBody('renderMarkdownFragment', 'scheme')],
    ['STATS_BUCKET', 'StatsBucket', schema('ProductStats', 'bucket')],
    ['TRAFFIC_CLASS', 'TrafficClass', schema('UsageStats', 'traffic_class')],
    ['COMPOSITION_OUTPUT', 'CompositionOutput', schema('CompositionAction', 'outputs', 'items')],
    ['HTML_PRESENTATION', 'HtmlPresentation', schema('CompositionAction', 'html_presentation')],
    ['PATTERN_SCOPE', 'PatternScope', schema('PatternDescriptor', 'scope')],
    ['PATTERN_STATUS', 'PatternStatus', schema('PatternDescriptor', 'status')],
    ['PATTERN_CATEGORY', 'PatternCategory', schema('PatternDescriptor', 'category')],
    ['PUBLISHING_GUIDE_KIND', 'PublishingGuideKind', schema('PublishingGuide', 'kind')],
  ]
}

function block(constant, type, values, comment) {
  const members = values.map((value) => `  '${value}',`).join('\n')
  return `${comment}\nexport const ${constant} = [\n${members}\n] as const\nexport type ${type} = (typeof ${constant})[number]\n`
}

export function cockpitContracts() {
  const spec = openApi({ publicUrl: 'https://contentkit-api.example.com', version: VERSION })
  const blocks = openApiEnums(spec).map(([constant, type, values]) =>
    block(constant, type, values, `/** ${constant.toLowerCase().replaceAll('_', ' ')}, from the OpenAPI document. */`),
  )
  blocks.push(
    block(
      'PRODUCT_SCOPES',
      'ProductScope',
      PRODUCT_SCOPES,
      '/**\n * Every scope a credential can hold. `authorize()` has no hierarchy, so this\n * is a flat set and `*` is deliberately absent — it exists in stored grants,\n * never as something a form may hand out.\n */',
    ),
    block(
      'THEME_TOKENS',
      'ThemeToken',
      THEME_TOKEN_ALLOWLIST,
      '/**\n * The only custom properties settings.theme.tokens may name. An unknown key\n * fails the whole PATCH, which is why the console offers a menu of these and\n * never a free-text key.\n */',
    ),
    block(
      'WEBHOOK_EVENT_TYPES',
      'WebhookEventType',
      WEBHOOK_EVENT_TYPES,
      '/** Every event contentkit emits. An endpoint filter naming anything else is a 422. */',
    ),
  )
  return `${[
    '// Generated by scripts/gen-cockpit-contracts.mjs — do not edit.',
    '// Run `npm run docs:gen-openapi` in the repository root after changing a',
    '// closed set on the server. test/unit/docs-drift.test.mjs guards this file.',
    '',
    ...blocks,
  ].join('\n')}`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(OUTPUT, cockpitContracts())
}
