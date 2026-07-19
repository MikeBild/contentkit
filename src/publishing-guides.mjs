import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const root = join(dirname(dirname(fileURLToPath(import.meta.url))), 'guides', 'publishing')
const kinds = new Set(['report', 'diagram', 'code'])
const idPattern = /^[a-z][a-z0-9-]{1,63}$/
const fail = (message) => Object.assign(new Error(`publishing guides: ${message}`), { statusCode: 500 })

function strings(value, label, { min = 1 } = {}) {
  if (
    !Array.isArray(value) ||
    value.length < min ||
    value.some((entry) => typeof entry !== 'string' || !entry.trim())
  ) {
    throw fail(`${label} must contain at least ${min} non-empty strings`)
  }
  return value.map((entry) => entry.trim())
}

function text(value, label, { min = 12, max = 800 } = {}) {
  const result = String(value || '').trim()
  if (result.length < min || result.length > max) throw fail(`${label} must be ${min}-${max} characters`)
  return result
}

function parseGuide(path) {
  const source = readFileSync(path, 'utf8')
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) throw fail(`${path} needs YAML frontmatter`)
  const data = parseYaml(match[1], { maxAliasCount: 0 })
  const allowed = new Set([
    'schemaVersion',
    'id',
    'kind',
    'status',
    'semantics',
    'narrative',
    'selection',
    'input',
    'authoring',
    'compatiblePatterns',
    'examples',
  ])
  const unknown = Object.keys(data || {}).find((key) => !allowed.has(key))
  if (unknown) throw fail(`${path} has unknown field ${unknown}`)
  if (data?.schemaVersion !== 1) throw fail(`${path} needs schemaVersion 1`)
  if (!idPattern.test(String(data.id || ''))) throw fail(`${path} has invalid id`)
  if (!kinds.has(data.kind)) throw fail(`${data.id}.kind must be report, diagram, or code`)
  if (!['stable', 'experimental'].includes(data.status)) throw fail(`${data.id}.status is invalid`)
  const body = source.slice(match[0].length).trim()
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const summary = body
    .split(/\r?\n/)
    .find((line) => line.trim() && !line.startsWith('#'))
    ?.trim()
  if (!title || !summary) throw fail(`${data.id} needs a Markdown title and summary`)
  const semantics = data.semantics || {}
  const narrative = data.narrative || {}
  const selection = data.selection || {}
  const input = data.input || {}
  const authoring = data.authoring || {}
  return {
    schema_version: '1',
    id: data.id,
    kind: data.kind,
    status: data.status,
    title,
    summary,
    semantics: {
      conveys: strings(semantics.conveys, `${data.id}.semantics.conveys`),
      implies: strings(semantics.implies || [], `${data.id}.semantics.implies`, { min: 0 }),
      rejects: strings(semantics.rejects || [], `${data.id}.semantics.rejects`, { min: 0 }),
    },
    narrative: {
      question: text(narrative.question, `${data.id}.narrative.question`),
      communication_goal: text(narrative.goal, `${data.id}.narrative.goal`),
      story_arc: strings(narrative.arc, `${data.id}.narrative.arc`, { min: 2 }),
      reader_takeaway: text(narrative.takeaway, `${data.id}.narrative.takeaway`),
    },
    selection: {
      use_when: strings(selection.useWhen, `${data.id}.selection.useWhen`),
      reject_when: strings(selection.rejectWhen, `${data.id}.selection.rejectWhen`, { min: 0 }),
    },
    input_contract: {
      required: strings(input.required, `${data.id}.input.required`),
      optional: strings(input.optional || [], `${data.id}.input.optional`, { min: 0 }),
      constraints: strings(input.constraints, `${data.id}.input.constraints`),
    },
    authoring: {
      syntax: text(authoring.syntax, `${data.id}.authoring.syntax`, { min: 2, max: 80 }),
      guidance: strings(authoring.guidance, `${data.id}.authoring.guidance`),
    },
    compatible_patterns: strings(data.compatiblePatterns || [], `${data.id}.compatiblePatterns`, { min: 0 }),
    examples: strings(data.examples, `${data.id}.examples`),
    documentation: body,
    source_path: path.slice(root.length + 1),
  }
}

export const publishingGuideRegistry = Object.freeze(
  readdirSync(root)
    .filter((name) => name.endsWith('.guide.md'))
    .sort()
    .map((name) => parseGuide(join(root, name))),
)

const byId = new Map(publishingGuideRegistry.map((guide) => [guide.id, guide]))
if (byId.size !== publishingGuideRegistry.length) throw fail('guide ids must be unique')

export const publishingGuideRegistryHash = createHash('sha256')
  .update(JSON.stringify(publishingGuideRegistry))
  .digest('hex')

export function getPublishingGuide(id) {
  return byId.get(String(id)) || null
}
