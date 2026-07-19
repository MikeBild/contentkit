import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

export const PATTERN_SCHEMA_VERSION = 1

const root = join(dirname(dirname(fileURLToPath(import.meta.url))), 'patterns')
const primitives = new Set([
  'frame',
  'stack',
  'grid',
  'split',
  'sequence',
  'radial',
  'layers',
  'matrix',
  'card',
  'slot',
  'connector',
])
const statuses = new Set(['experimental', 'stable', 'deprecated'])
const scopes = new Set(['document', 'node'])
const categories = new Set([
  'document',
  'metrics',
  'process',
  'comparison',
  'timeline',
  'structure',
  'data',
  'faq',
  'pricing',
  'gallery',
  'code',
  'stats',
  'table',
  'dashboard',
  'application',
])
const nodeTypes = new Set([
  'hero',
  'metric',
  'process',
  'comparison',
  'timeline',
  'hierarchy',
  'relationship',
  'chart',
  'progress',
  'badge',
  'card',
  'group',
  'faq',
  'code-example',
  'pricing',
  'gallery',
  'data-table',
  'dashboard-section',
  'application-shell',
])
const intents = new Set(['explain', 'compare', 'sequence', 'status', 'explore'])
const canvases = new Set(['portrait', 'landscape', 'square', 'flow'])
const densities = new Set(['compact', 'balanced', 'spacious'])
const dataShapes = new Set([
  'series',
  'range',
  'change',
  'diverging',
  'likert',
  'xy',
  'boxplot',
  'matrix',
  'waterfall',
  'hierarchy',
  'flow',
  'uncertainty',
  'calendar',
  'geo-point',
  'geo-region',
  'samples',
])
const outputCapabilities = new Set(['html', 'svg', 'png', 'print'])
const interactionCapabilities = new Set([
  'disclosure',
  'tabs',
  'copy',
  'sort',
  'filter',
  'pagination',
  'carousel',
  'navigation',
  'drawer',
])
export const patternCapabilities = Object.freeze([
  ...[...outputCapabilities].sort(),
  ...[...interactionCapabilities].sort(),
])
const slotNames = /^[a-z][a-z0-9-]{0,63}$/
const exampleIds = /^[a-z0-9][a-z0-9-/]{0,127}$/

const error = (message) => Object.assign(new Error(`pattern registry: ${message}`), { statusCode: 500 })

function rejectUnknown(value, fields, label) {
  const unknown = Object.keys(value || {}).find((field) => !fields.has(field))
  if (unknown) throw error(`${label} has unknown field ${unknown}`)
}

function stringList(value, allowed, label, fallback) {
  const entries = value ?? fallback
  if (!Array.isArray(entries) || !entries.length || entries.some((entry) => typeof entry !== 'string')) {
    throw error(`${label} must be a non-empty string list`)
  }
  if (allowed && entries.some((entry) => !allowed.has(entry))) throw error(`${label} contains an unknown value`)
  return entries.map(String)
}

function optionalStringList(value, label) {
  if (value == null) return []
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw error(`${label} must be a string list`)
  }
  return value.map(String)
}

function boundedInteger(value, label, { min = 0, max = 100000, fallback = null } = {}) {
  if (value == null) return fallback
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) {
    throw error(`${label} must be an integer from ${min} to ${max}`)
  }
  return number
}

function parseSlots(value, id, acceptedNodeTypes) {
  const source = value ?? [{ name: 'content', accepts: acceptedNodeTypes, min: 1, max: 200, required: true }]
  if (!Array.isArray(source) || !source.length) throw error(`${id}.slots must be a non-empty list`)
  const seen = new Set()
  return source.map((slot, index) => {
    rejectUnknown(slot, new Set(['name', 'accepts', 'min', 'max', 'required']), `${id}.slots[${index}]`)
    const name = String(slot?.name || '')
    if (!slotNames.test(name) || seen.has(name)) throw error(`${id}.slots contains an invalid or duplicate name`)
    seen.add(name)
    const accepts = stringList(slot.accepts, nodeTypes, `${id}.slots.${name}.accepts`, acceptedNodeTypes)
    const min = boundedInteger(slot.min, `${id}.slots.${name}.min`, { min: 0, max: 200, fallback: 0 })
    const max = boundedInteger(slot.max, `${id}.slots.${name}.max`, { min: 1, max: 200, fallback: 200 })
    if (min > max) throw error(`${id}.slots.${name} minimum exceeds maximum`)
    const required = slot.required == null ? min > 0 : slot.required
    if (typeof required !== 'boolean') throw error(`${id}.slots.${name}.required must be boolean`)
    return { name, accepts, min, max, required }
  })
}

function parseCapabilities(value, id) {
  const source = value ?? { outputs: ['html', 'svg', 'png', 'print'], interactions: [] }
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw error(`${id}.capabilities must be an object`)
  }
  rejectUnknown(source, new Set(['outputs', 'interactions']), `${id}.capabilities`)
  return {
    outputs: stringList(source.outputs, outputCapabilities, `${id}.capabilities.outputs`, [
      'html',
      'svg',
      'png',
      'print',
    ]),
    interactions: (() => {
      const interactions = optionalStringList(source.interactions, `${id}.capabilities.interactions`)
      if (interactions.some((entry) => !interactionCapabilities.has(entry))) {
        throw error(`${id}.capabilities.interactions contains an unknown value`)
      }
      return interactions
    })(),
  }
}

function parseRequires(value, id, primitive) {
  const source = value ?? { patterns: [], primitives: [primitive] }
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw error(`${id}.requires must be an object`)
  rejectUnknown(source, new Set(['patterns', 'primitives']), `${id}.requires`)
  const patterns = optionalStringList(source.patterns, `${id}.requires.patterns`)
  if (patterns.some((entry) => !slotNames.test(entry))) throw error(`${id}.requires.patterns contains an invalid id`)
  const requiredPrimitives = source.primitives
    ? stringList(source.primitives, primitives, `${id}.requires.primitives`)
    : [primitive]
  return { patterns, primitives: requiredPrimitives }
}

function parseContentBudget(value, id, accepts) {
  const source = value ?? {}
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw error(`${id}.contentBudget must be an object`)
  }
  const fields = new Set([
    'maxItems',
    'maxTextCharacters',
    'maxWordsPerItem',
    'maxCodeLines',
    'maxTableRows',
    'maxMedia',
    'maxColumns',
    'maxTitleCharacters',
    'maxSummaryCharacters',
    'maxLabelCharacters',
    'maxBodyCharacters',
    'maxSeries',
    'maxCategories',
  ])
  rejectUnknown(source, fields, `${id}.contentBudget`)
  return {
    max_items: boundedInteger(source.maxItems, `${id}.contentBudget.maxItems`, {
      min: 1,
      max: 200,
      fallback: accepts.max_items,
    }),
    max_text_characters: boundedInteger(source.maxTextCharacters, `${id}.contentBudget.maxTextCharacters`, {
      min: 80,
      max: 100000,
      fallback: 12000,
    }),
    max_words_per_item: boundedInteger(source.maxWordsPerItem, `${id}.contentBudget.maxWordsPerItem`, {
      min: 4,
      max: 1000,
      fallback: 80,
    }),
    max_code_lines: boundedInteger(source.maxCodeLines, `${id}.contentBudget.maxCodeLines`, {
      min: 1,
      max: 2000,
      fallback: 120,
    }),
    max_table_rows: boundedInteger(source.maxTableRows, `${id}.contentBudget.maxTableRows`, {
      min: 1,
      max: 2000,
      fallback: 200,
    }),
    max_media: boundedInteger(source.maxMedia, `${id}.contentBudget.maxMedia`, {
      min: 1,
      max: 200,
      fallback: 24,
    }),
    max_columns: boundedInteger(source.maxColumns, `${id}.contentBudget.maxColumns`, {
      min: 1,
      max: 64,
      fallback: 12,
    }),
    max_title_characters: boundedInteger(source.maxTitleCharacters, `${id}.contentBudget.maxTitleCharacters`, {
      min: 12,
      max: 500,
      fallback: 96,
    }),
    max_summary_characters: boundedInteger(source.maxSummaryCharacters, `${id}.contentBudget.maxSummaryCharacters`, {
      min: 20,
      max: 2000,
      fallback: 220,
    }),
    max_label_characters: boundedInteger(source.maxLabelCharacters, `${id}.contentBudget.maxLabelCharacters`, {
      min: 4,
      max: 500,
      fallback: accepts.node_types.includes('metric') ? 48 : 72,
    }),
    max_body_characters: boundedInteger(source.maxBodyCharacters, `${id}.contentBudget.maxBodyCharacters`, {
      min: 20,
      max: 10000,
      fallback: accepts.node_types.includes('faq') ? 480 : 320,
    }),
    max_series: boundedInteger(source.maxSeries, `${id}.contentBudget.maxSeries`, {
      min: 1,
      max: 64,
      fallback: accepts.node_types.includes('chart') ? 8 : 1,
    }),
    max_categories: boundedInteger(source.maxCategories, `${id}.contentBudget.maxCategories`, {
      min: 1,
      max: 1000,
      fallback: accepts.data_shapes.includes('calendar')
        ? 62
        : accepts.node_types.includes('chart')
          ? 30
          : accepts.max_items,
    }),
  }
}

function inputContract(accepts, contentBudget) {
  const nodeTypes = new Set(accepts.node_types)
  const dataShapes = new Set(accepts.data_shapes)
  const values = new Set(['text'])
  const fields = []
  const addField = (field, semanticRole, acceptedValues, required = true, constraints = {}) => {
    fields.push({ field, semantic_role: semanticRole, accepted_values: acceptedValues, required, ...constraints })
    acceptedValues.forEach((value) => values.add(value))
  }
  if (nodeTypes.has('metric') || nodeTypes.has('progress')) {
    addField('label', 'metric-name', ['text'], true, { max_characters: contentBudget.max_label_characters })
    addField('value', 'measure', ['number', 'percentage', 'currency', 'duration', 'rate', 'data-size'], true)
    addField('unit', 'measure-unit', ['unit'], false)
    addField('trend', 'change-or-status', ['number', 'percentage-point', 'duration', 'text'], false)
    addField('period', 'observation-window', ['date', 'datetime', 'duration', 'text'], false)
  }
  if (nodeTypes.has('chart')) {
    const dimensionValues = dataShapes.has('calendar')
      ? ['date']
      : dataShapes.has('geo-point')
        ? ['latitude', 'longitude']
        : dataShapes.has('geo-region')
          ? ['geo-region']
          : dataShapes.has('xy')
            ? ['number']
            : ['category', 'ordinal', 'date', 'datetime', 'time']
    addField('dimension', 'independent-variable', dimensionValues)
    addField('measure', 'dependent-variable', ['number', 'percentage', 'currency', 'duration', 'rate', 'data-size'])
    addField('unit', 'shared-series-unit', ['unit'], false)
    addField('series', 'comparable-measure', ['identifier'], false, { max_items: contentBudget.max_series })
  }
  if (nodeTypes.has('timeline')) {
    addField('time', 'temporal-order', ['date', 'datetime', 'time', 'duration', 'ordinal'])
    addField('label', 'event-name', ['text'], true, { max_characters: contentBudget.max_label_characters })
    addField('description', 'event-detail', ['text'], false, { max_characters: contentBudget.max_body_characters })
  }
  if (nodeTypes.has('process')) {
    addField('step', 'ordered-stage', ['ordinal', 'text'])
    addField('role', 'participant-role', ['category', 'identifier'], false)
  }
  if (nodeTypes.has('pricing')) {
    addField('currency', 'monetary-currency', ['currency-code'])
    addField('price', 'monetary-amount', ['number'])
    addField('cadence', 'billing-interval', ['duration', 'one-time'])
    addField('feature', 'plan-capability', ['text', 'boolean'], false, {
      max_characters: contentBudget.max_label_characters,
    })
  }
  if (nodeTypes.has('faq')) {
    addField('question', 'question', ['text'], true, { max_characters: contentBudget.max_label_characters })
    addField('answer', 'answer', ['text'], true, { max_characters: contentBudget.max_body_characters })
    addField('category', 'question-group', ['category'], false)
  }
  if (nodeTypes.has('data-table')) {
    addField('column-role', 'typed-field', [
      'identifier',
      'text',
      'number',
      'percentage',
      'currency',
      'duration',
      'date',
      'datetime',
      'time',
      'status',
      'boolean',
    ])
    addField('row-key', 'record-identity', ['identifier'])
  }
  if (nodeTypes.has('gallery')) {
    addField('asset', 'media-source', ['image', 'svg'])
    addField('alt', 'text-equivalent', ['text'], true, { max_characters: contentBudget.max_body_characters })
    addField('caption', 'figure-caption', ['text'], false, { max_characters: contentBudget.max_label_characters })
  }
  if (nodeTypes.has('code-example')) {
    addField('language', 'programming-language', ['identifier'])
    addField('code', 'source-code', ['code'])
    addField('file', 'source-file', ['path'], false)
  }
  if (!fields.length) {
    addField('title', 'primary-label', ['text'], true, { max_characters: contentBudget.max_title_characters })
    addField('description', 'supporting-detail', ['text'], false, { max_characters: contentBudget.max_body_characters })
  }
  return {
    schema_version: '1',
    value_semantics: [...values].sort(),
    fields,
    units: {
      accepted_kinds: [
        'count',
        'percentage',
        'percentage-point',
        'currency',
        'duration',
        'rate',
        'data-size',
        'distance',
        'area',
        'volume',
        'temperature',
        'angle',
        'custom',
      ],
      currency: 'Use an ISO 4217 currency code and one currency per comparison.',
      duration: 'Store a numeric value and an explicit unit; do not encode duration as an unlabeled number.',
      percentage: 'Distinguish percentage values from percentage-point changes.',
      consistency: 'Use one unit per comparable series unless values are explicitly normalized.',
    },
    temporal: {
      formats: ['ISO 8601 date', 'ISO 8601 datetime with timezone', '24-hour time', 'numeric duration with unit'],
      granularities: ['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'],
      ordering: 'Provide sortable temporal values; display labels may be localized separately.',
    },
  }
}

function specExamples(exampleIds, pattern) {
  const examplesRoot = join(dirname(root), 'examples', 'compositions')
  const positive = exampleIds.flatMap((id) => {
    try {
      return [
        {
          kind: 'positive',
          id,
          expected_pattern: pattern.id,
          markdown: readFileSync(join(examplesRoot, `${id}.en.md`), 'utf8'),
        },
      ]
    } catch (caught) {
      if (caught?.code === 'ENOENT') return []
      throw caught
    }
  })
  const negative = pattern.agent_hints.reject_when.map((reason) => ({
    kind: 'counterexample',
    reason,
    guidance: `Do not select ${pattern.id} when ${reason.replaceAll('-', ' ')}.`,
  }))
  return [...positive, ...negative]
}

const graphicalCategories = new Set(['process', 'structure', 'data'])

function renderingStrategy(category, capabilities) {
  const primaryOutput = graphicalCategories.has(category) ? 'svg' : 'html'
  return {
    primary_output: primaryOutput,
    alternatives: capabilities.outputs.filter((output) => output !== 'print' && output !== primaryOutput),
    png_role: 'derived-static-export',
    rationale:
      primaryOutput === 'html'
        ? 'Prefer semantic HTML and CSS for document, interface, and interaction-oriented content.'
        : 'Prefer SVG when spatial geometry, connectors, axes, or graphical relationships carry meaning.',
  }
}

function parseAgentHints(value, id, pattern) {
  const source = value ?? {
    useWhen: pattern.semantics.conveys,
    rejectWhen: pattern.semantics.rejects,
    authoring: [`Use ${pattern.id} only when its semantic implications are intended.`],
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw error(`${id}.agentHints must be an object`)
  rejectUnknown(source, new Set(['useWhen', 'rejectWhen', 'authoring']), `${id}.agentHints`)
  return {
    use_when: optionalStringList(source.useWhen, `${id}.agentHints.useWhen`),
    reject_when: optionalStringList(source.rejectWhen, `${id}.agentHints.rejectWhen`),
    authoring: optionalStringList(source.authoring, `${id}.agentHints.authoring`),
  }
}

const narrativeDefaults = {
  metrics: [
    'Which number matters, what context gives it meaning, and is movement good or bad?',
    ['name-the-measure', 'show-value-and-unit', 'add-target-period-or-trend', 'state-meaning'],
  ],
  stats: [
    'Which quantitative fact deserves attention, and what evidence makes it meaningful?',
    ['establish-context', 'emphasize-the-fact', 'show-comparison-or-time', 'state-implication'],
  ],
  process: [
    'What happens in which order, and where do decisions, handoffs, or loops change the outcome?',
    ['name-trigger', 'follow-stages', 'expose-handoffs-or-branches', 'arrive-at-outcome'],
  ],
  comparison: [
    'What differs under shared criteria, and which tradeoff should shape the choice?',
    ['introduce-options', 'establish-shared-criteria', 'reveal-differences', 'support-choice'],
  ],
  timeline: [
    'What changed over time, in which order, and which moments alter the interpretation?',
    ['establish-time-window', 'follow-events', 'emphasize-milestones', 'connect-past-to-current-state'],
  ],
  structure: [
    'Which elements exist, how are they organized, and what do their relationships imply?',
    ['establish-boundary-or-root', 'group-elements', 'connect-relationships', 'reveal-structural-meaning'],
  ],
  faq: [
    'Which questions block understanding, and what direct answers remove that friction?',
    ['group-reader-questions', 'prioritize-common-blockers', 'answer-directly', 'link-to-next-action'],
  ],
  code: [
    'How can the reader understand or perform the implementation and verify the result?',
    ['state-task-and-result', 'establish-prerequisites', 'show-code-in-reading-order', 'verify-output'],
  ],
  pricing: [
    'Which offer fits which need, and which differences materially affect the choice?',
    ['establish-buyer-context', 'align-plans', 'compare-decisive-features', 'support-fit-based-choice'],
  ],
  gallery: [
    'How should media be ordered or grouped so that each item advances one editorial story?',
    ['establish-theme', 'sequence-or-group-media', 'add-essential-captions', 'resolve-editorial-takeaway'],
  ],
  table: [
    'Which records require precise comparison, lookup, or inspection across shared fields?',
    ['define-records-and-fields', 'preserve-exact-values', 'support-scan-and-lookup', 'surface-exceptions'],
  ],
  dashboard: [
    'What is the current state, what changed, and where is action required?',
    ['state-overall-health', 'show-priority-signals', 'surface-exceptions', 'connect-exceptions-to-action'],
  ],
  application: [
    'Which workspace structure helps the user understand context and complete the task?',
    ['establish-navigation-and-context', 'focus-primary-task', 'place-supporting-tools', 'preserve-orientation'],
  ],
  document: [
    'How should related information be ordered so the reader reaches one coherent understanding?',
    ['establish-primary-message', 'organize-supporting-information', 'present-evidence', 'resolve-takeaway'],
  ],
}

function parseNarrativeContract(value, id, { title, summary, selection, category }) {
  const [question, arc] = narrativeDefaults[category] || [
    `What should the reader understand from ${title}?`,
    ['establish-context', 'present-evidence', 'deliver-takeaway'],
  ]
  const source = value ?? {
    question,
    goal: summary,
    arc,
    takeaway: summary,
    decisionSupport:
      selection.intents.includes('compare') || selection.intents.includes('status')
        ? 'Help the reader compare evidence and decide what deserves attention next.'
        : 'Help the reader form an accurate mental model of the information.',
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw error(`${id}.narrative must be an object`)
  }
  rejectUnknown(source, new Set(['question', 'goal', 'arc', 'takeaway', 'decisionSupport']), `${id}.narrative`)
  const requiredText = (field) => {
    const text = String(source[field] || '').trim()
    if (text.length < 12 || text.length > 500) throw error(`${id}.narrative.${field} must be 12-500 characters`)
    return text
  }
  return {
    question: requiredText('question'),
    communication_goal: requiredText('goal'),
    story_arc: stringList(source.arc, null, `${id}.narrative.arc`).map((entry) => entry.trim()),
    reader_takeaway: requiredText('takeaway'),
    decision_support: requiredText('decisionSupport'),
  }
}

function filesAt(path) {
  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) =>
      entry.isDirectory()
        ? filesAt(join(path, entry.name))
        : entry.name.endsWith('.pattern.md')
          ? [join(path, entry.name)]
          : [],
    )
}

function parsePattern(path) {
  const source = readFileSync(path, 'utf8')
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) throw error(`${path} needs YAML frontmatter`)
  const data = parseYaml(match[1], { maxAliasCount: 0 })
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw error(`${path} frontmatter must be an object`)
  rejectUnknown(
    data,
    new Set([
      'schemaVersion',
      'id',
      'version',
      'status',
      'category',
      'scope',
      'accepts',
      'semantics',
      'selection',
      'responsive',
      'fallbacks',
      'layout',
      'accessibility',
      'slots',
      'capabilities',
      'requires',
      'contentBudget',
      'examples',
      'agentHints',
      'narrative',
      'staticFallback',
    ]),
    path,
  )
  if (data.schemaVersion !== PATTERN_SCHEMA_VERSION)
    throw error(`${path} needs schemaVersion ${PATTERN_SCHEMA_VERSION}`)
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(String(data.id || ''))) throw error(`${path} has invalid id`)
  if (!Number.isInteger(data.version) || data.version < 1) throw error(`${data.id} needs a positive integer version`)
  if (!statuses.has(data.status)) throw error(`${data.id} has invalid status`)
  if (!scopes.has(data.scope)) throw error(`${data.id} has invalid scope`)
  if (!categories.has(data.category)) throw error(`${data.id} has invalid category`)
  rejectUnknown(
    data.accepts,
    new Set(['nodeTypes', 'dataShapes', 'minItems', 'preferredMaxItems', 'maxItems']),
    `${data.id}.accepts`,
  )
  const acceptedNodeTypes = stringList(data.accepts?.nodeTypes, nodeTypes, `${data.id}.accepts.nodeTypes`)
  const acceptedDataShapes = data.accepts?.dataShapes
    ? stringList(data.accepts.dataShapes, dataShapes, `${data.id}.accepts.dataShapes`)
    : []
  const minItems = Number(data.accepts?.minItems ?? 1)
  const maxItems = Number(data.accepts?.maxItems ?? 12)
  const preferredMaxItems = Number(data.accepts?.preferredMaxItems ?? maxItems)
  if (
    ![minItems, preferredMaxItems, maxItems].every(Number.isInteger) ||
    minItems < 1 ||
    maxItems > 200 ||
    minItems > preferredMaxItems ||
    preferredMaxItems > maxItems
  ) {
    throw error(`${data.id}.accepts item limits must be ordered integers from 1 to 200`)
  }
  rejectUnknown(data.semantics, new Set(['conveys', 'implies', 'rejects']), `${data.id}.semantics`)
  const conveys = optionalStringList(data.semantics?.conveys, `${data.id}.semantics.conveys`)
  const implies = optionalStringList(data.semantics?.implies, `${data.id}.semantics.implies`)
  const rejects = optionalStringList(data.semantics?.rejects, `${data.id}.semantics.rejects`)
  rejectUnknown(data.selection, new Set(['intents', 'canvases', 'densities']), `${data.id}.selection`)
  const selectedIntents = stringList(data.selection?.intents, intents, `${data.id}.selection.intents`, ['explain'])
  const selectedCanvases = stringList(data.selection?.canvases, canvases, `${data.id}.selection.canvases`, [
    'portrait',
    'landscape',
    'square',
    'flow',
  ])
  const selectedDensities = stringList(data.selection?.densities, densities, `${data.id}.selection.densities`, [
    'compact',
    'balanced',
    'spacious',
  ])
  if (!Array.isArray(data.responsive || [])) throw error(`${data.id}.responsive must be a list`)
  const responsive = (data.responsive || []).map((rule) => {
    rejectUnknown(rule, new Set(['maxWidth', 'use']), `${data.id}.responsive`)
    const maxWidth = Number(rule?.maxWidth)
    if (
      !Number.isInteger(maxWidth) ||
      maxWidth < 320 ||
      maxWidth > 4096 ||
      !/^[a-z][a-z0-9-]{1,63}$/.test(String(rule?.use || ''))
    ) {
      throw error(`${data.id}.responsive needs maxWidth 320-4096 and a valid use id`)
    }
    return { max_width: maxWidth, use: String(rule.use) }
  })
  const fallbacks = data.fallbacks || []
  if (!Array.isArray(fallbacks) || fallbacks.some((entry) => !/^[a-z][a-z0-9-]{1,63}$/.test(String(entry)))) {
    throw error(`${data.id}.fallbacks must contain valid pattern ids`)
  }
  if (!data.layout || typeof data.layout !== 'object' || Array.isArray(data.layout)) {
    throw error(`${data.id}.layout must be an object`)
  }
  rejectUnknown(data.accessibility, new Set(['readingOrder', 'textEquivalent']), `${data.id}.accessibility`)
  const primitive = data.layout?.primitive
  if (!primitives.has(primitive)) throw error(`${data.id} uses unknown layout primitive ${primitive}`)
  const body = source.slice(match[0].length).trim()
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const summary = body
    .split(/\r?\n/)
    .find((line) => line.trim() && !line.startsWith('#'))
    ?.trim()
  if (!title || !summary) throw error(`${data.id} needs a title and summary in Markdown`)
  const accepts = {
    node_types: acceptedNodeTypes,
    data_shapes: acceptedDataShapes,
    min_items: minItems,
    preferred_max_items: preferredMaxItems,
    max_items: maxItems,
  }
  const semantics = { conveys, implies, rejects }
  const slots = parseSlots(data.slots, data.id, acceptedNodeTypes)
  const capabilities = parseCapabilities(data.capabilities, data.id)
  const requires = parseRequires(data.requires, data.id, primitive)
  const contentBudget = parseContentBudget(data.contentBudget, data.id, accepts)
  const examples = data.examples ?? [data.id]
  if (!Array.isArray(examples) || !examples.length || examples.some((entry) => !exampleIds.test(String(entry)))) {
    throw error(`${data.id}.examples must contain valid repository example ids`)
  }
  const staticFallback = String(data.staticFallback || data.fallbacks?.[0] || data.id)
  if (!slotNames.test(staticFallback)) throw error(`${data.id}.staticFallback must be a valid pattern id`)
  const pattern = {
    schema_version: data.schemaVersion,
    id: data.id,
    version: data.version,
    status: data.status,
    category: data.category,
    scope: data.scope,
    title,
    summary,
    accepts,
    semantics,
    narrative: parseNarrativeContract(data.narrative, data.id, {
      title,
      summary,
      semantics,
      selection: { intents: selectedIntents },
      category: data.category,
    }),
    selection: {
      intents: selectedIntents,
      canvases: selectedCanvases,
      densities: selectedDensities,
    },
    responsive,
    fallbacks: fallbacks.map(String),
    layout: data.layout,
    accessibility: {
      reading_order: String(data.accessibility?.readingOrder || 'source-order'),
      text_equivalent: String(data.accessibility?.textEquivalent || 'structured-text'),
    },
    slots,
    capabilities,
    rendering_strategy: renderingStrategy(data.category, capabilities),
    requires,
    content_budget: contentBudget,
    input_contract: inputContract(accepts, contentBudget),
    examples: examples.map(String),
    spec_examples: null,
    agent_hints: null,
    static_fallback: staticFallback,
    documentation: body,
    source_path: path.slice(root.length + 1),
  }
  pattern.agent_hints = parseAgentHints(data.agentHints, data.id, pattern)
  pattern.spec_examples = specExamples(pattern.examples, pattern)
  return pattern
}

export const patternRegistry = Object.freeze(filesAt(root).map(parsePattern))
const patternById = new Map(patternRegistry.map((pattern) => [pattern.id, pattern]))
if (patternById.size !== patternRegistry.length) throw error('pattern ids must be unique')

for (const pattern of patternRegistry) {
  for (const target of [
    ...pattern.fallbacks,
    ...pattern.responsive.map((rule) => rule.use),
    ...pattern.requires.patterns,
    pattern.static_fallback,
  ]) {
    if (!patternById.has(target)) throw error(`${pattern.id} references unknown fallback ${target}`)
  }
}

function visitFallback(id, visiting = new Set(), visited = new Set()) {
  if (visited.has(id)) return
  if (visiting.has(id)) throw error(`fallback cycle at ${id}`)
  const next = new Set(visiting).add(id)
  for (const target of patternById.get(id)?.fallbacks || []) visitFallback(target, next, visited)
  visited.add(id)
}
for (const pattern of patternRegistry) visitFallback(pattern.id)

export const patternRegistryHash = createHash('sha256').update(JSON.stringify(patternRegistry)).digest('hex')

export function getPattern(id) {
  return patternById.get(String(id)) || null
}

function nodeItemCount(node) {
  if (Number.isInteger(node.items)) return node.items
  return (
    node.steps?.length ||
    node.sides?.length ||
    node.events?.length ||
    node.items?.length ||
    node.rows?.length ||
    node.children?.length ||
    node.questions?.length ||
    node.variants?.length ||
    node.plans?.length ||
    node.figures?.length ||
    node.regions?.length ||
    1
  )
}

function candidateContext(semantic) {
  const nodes = semantic?.nodes || []
  const primary = nodes.find((node) => node.role === 'primary') || nodes[0]
  const peerCount =
    primary?.type === 'metric' ? nodes.filter((node) => node.type === 'metric').length : nodeItemCount(primary || {})
  return { nodes, primary, nodeTypes: new Set(nodes.map((node) => node.type)), itemCount: peerCount }
}

export function recommendPatterns(semantic, preferences = {}, viewport = {}) {
  const context = candidateContext(semantic)
  const intent = preferences.intent || 'explain'
  const canvas = preferences.canvas || 'portrait'
  const density = preferences.density || 'balanced'
  const requiredCapabilities = new Set(preferences.capabilities || (preferences.output ? [preferences.output] : []))
  const unknownCapability = [...requiredCapabilities].find(
    (capability) => !outputCapabilities.has(capability) && !interactionCapabilities.has(capability),
  )
  if (unknownCapability) {
    throw Object.assign(new Error(`unknown composition capability "${unknownCapability}"`), { statusCode: 422 })
  }
  const effectiveWidth = Number(viewport.container_width || viewport.container?.width || viewport.width || 0)
  return patternRegistry
    .map((pattern) => {
      const relevant =
        pattern.scope === 'document'
          ? context.nodes.length > 1
          : pattern.accepts.node_types.includes(context.primary?.type)
      const dataShapeOk =
        !pattern.accepts.data_shapes.length ||
        pattern.accepts.data_shapes.includes(context.primary?.data_shape || 'series')
      const countOk =
        pattern.scope === 'document' ||
        (context.itemCount >= pattern.accepts.min_items && context.itemCount <= pattern.accepts.max_items)
      const canvasOk = pattern.selection.canvases.includes(canvas)
      const capabilityOk = [...requiredCapabilities].every(
        (capability) =>
          pattern.capabilities.outputs.includes(capability) || pattern.capabilities.interactions.includes(capability),
      )
      const eligible = relevant && dataShapeOk && countOk && canvasOk && capabilityOk
      const reasons = []
      const rejections = []
      let score = 0
      if (relevant) {
        score += 40
        reasons.push(`semantic.${pattern.scope === 'document' ? 'document' : context.primary?.type}`)
      } else rejections.push('semantic.incompatible')
      if (dataShapeOk) {
        if (pattern.accepts.data_shapes.length) {
          score += 24
          reasons.push(`data.${context.primary?.data_shape || 'series'}`)
        }
      } else rejections.push('semantic.data_shape')
      if (pattern.selection.intents.includes(intent)) {
        score += 20
        reasons.push(`intent.${intent}`)
      }
      if (countOk) {
        score += context.itemCount <= pattern.accepts.preferred_max_items ? 15 : 10
        reasons.push('item_count.accepted')
      } else rejections.push('item_count.out_of_range')
      if (canvasOk) {
        score += 15
        reasons.push(`canvas.${canvas}`)
      } else rejections.push('canvas.unsupported')
      if (capabilityOk) {
        if (requiredCapabilities.size) {
          score += 12
          reasons.push('capability.supported')
        }
      } else rejections.push('capability.unsupported')
      if (pattern.selection.densities.includes(density)) {
        score += 10
        reasons.push(`density.${density}`)
      }
      const responsive = pattern.responsive.find((rule) => effectiveWidth && effectiveWidth <= rule.max_width)
      return { pattern: pattern.id, score, eligible, reasons, rejections, responsive_pattern: responsive?.use || null }
    })
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.pattern.localeCompare(b.pattern))
}

export function resolvePattern(semantic, preferences = {}, viewport = {}) {
  const recommendations = recommendPatterns(semantic, preferences, viewport)
  const requested = preferences.preferred_pattern || null
  const requestedCandidate = recommendations.find((entry) => entry.pattern === requested)
  const selected = requestedCandidate?.eligible ? requestedCandidate : recommendations.find((entry) => entry.eligible)
  if (!selected) throw Object.assign(new Error('composition has no eligible pattern'), { statusCode: 422 })
  const resolved = selected.responsive_pattern || selected.pattern
  const diagnostics = []
  if (requested && !requestedCandidate) {
    diagnostics.push({ code: 'pattern.unknown', severity: 'error', requested_pattern: requested })
  } else if (requested && !requestedCandidate.eligible) {
    diagnostics.push({
      code: 'pattern.incompatible',
      severity: 'warning',
      requested_pattern: requested,
      reasons: requestedCandidate.rejections,
    })
    if (requestedCandidate.rejections.includes('capability.unsupported')) {
      diagnostics.push({
        code: 'capability.unavailable',
        severity: 'warning',
        requested_pattern: requested,
        requested_capabilities: [...new Set(preferences.capabilities || [])],
      })
    }
  }
  if (resolved !== (requested || selected.pattern)) {
    diagnostics.push({
      code: 'pattern.fallback',
      severity: 'info',
      requested_pattern: requested || selected.pattern,
      resolved_pattern: resolved,
    })
    diagnostics.push({
      code: 'pattern.degraded',
      severity: 'info',
      requested_pattern: requested || selected.pattern,
      resolved_pattern: resolved,
      reason: selected.responsive_pattern ? 'container-width' : 'eligibility',
    })
  }
  return { requested_pattern: requested, resolved_pattern: resolved, recommendations, diagnostics }
}
