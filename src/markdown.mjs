import { parse as parseYaml } from 'yaml'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkDirective from 'remark-directive'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import rehypeShiki from '@shikijs/rehype'
import rehypeStringify from 'rehype-stringify'
import { visit } from 'unist-util-visit'
import { assertSlug, excerpt, parseIsoDate, slugify } from './utils.mjs'
import { resolvePattern } from './composition-registry.mjs'
import { getPublishingGuide } from './publishing-guides.mjs'

const kinds = new Set(['page', 'post', 'project'])
export const layouts = new Set([
  'standard',
  'docs',
  'wiki',
  'knowledge',
  'landing',
  'changelog',
  'report',
  'composition',
])
const accessSlug = /^[a-z0-9][a-z0-9-]{0,63}$/

const COMPOSITION_DIRECTIVES = new Set([
  'group',
  'card',
  'hero',
  'metric',
  'badge',
  'progress',
  'chart',
  'process',
  'comparison',
  'side',
  'timeline',
  'hierarchy',
  'relationship',
  'faq',
  'question',
  'code-example',
  'variant',
  'pricing',
  'plan',
  'gallery',
  'figure',
  'data-table',
  'dashboard-section',
  'application-shell',
  'region',
])
const REPORT_TONES = new Set(['neutral', 'positive', 'warning', 'negative'])
const REPORT_CHART_TYPES = new Set(['bar', 'line', 'area', 'donut'])
const REPORT_CHART_SHAPES = new Set([
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
const REPORT_CADENCES = new Set(['hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'])
const REPORT_MAX_CHARTS = 24
const REPORT_MAX_ROWS = 200
const REPORT_MAX_SERIES = 8

const CHART_STORIES = {
  range: [
    'What interval belongs to each category?',
    'Compare lower and upper bounds without implying one exact value.',
  ],
  change: ['What changed between the two states?', 'Compare paired values and make direction and distance explicit.'],
  diverging: [
    'Which values fall on either side of a meaningful baseline?',
    'Compare positive and negative distance from a shared reference.',
  ],
  likert: [
    'How are ordered responses distributed across the response scale?',
    'Preserve disagreement, neutrality and agreement instead of hiding them in an average.',
  ],
  xy: [
    'How do the two quantitative variables relate?',
    'Reveal association, clusters and outliers without implying causation.',
  ],
  boxplot: [
    'How do distributions differ in centre, spread and extremes?',
    'Compare distributions while preserving quartiles and outliers.',
  ],
  matrix: [
    'Where do two dimensions combine into high, low or exceptional values?',
    'Compare repeated values across two independent dimensions.',
  ],
  waterfall: [
    'Which contributions explain the change from the starting value to the result?',
    'Make additive and subtractive contributions auditable.',
  ],
  hierarchy: ['How is the total divided across nested groups?', 'Show part-to-whole structure at more than one level.'],
  flow: [
    'Where does quantity move between sources and destinations?',
    'Explain weighted movement, transfer or allocation between nodes.',
  ],
  uncertainty: [
    'How does the estimate change, and how uncertain is it?',
    'Keep the central estimate and its lower and upper bounds together.',
  ],
  calendar: [
    'On which dates does activity concentrate, repeat or disappear?',
    'Expose daily rhythm, streaks, seasonality and missing observations.',
  ],
  'geo-point': [
    'Where are observations located, and how do their values differ?',
    'Compare positioned observations without turning proximity into causation.',
  ],
  'geo-region': [
    'How does the measure vary between defined regions?',
    'Compare regional values while preserving the geographic unit of analysis.',
  ],
  samples: [
    'How are individual observations distributed?',
    'Show density, clusters and outliers without reducing the data to one aggregate.',
  ],
}

function chartStory({ type, shape, title, description, question, insight, action, limitation }) {
  const typeStory = {
    bar: ['How do values compare across categories?', 'Compare magnitude on a shared baseline.'],
    line: [
      'How does the measure change across an ordered dimension?',
      'Reveal trend, turning points and continuity across ordered observations.',
    ],
    area: [
      'How does accumulated magnitude change across an ordered dimension?',
      'Emphasize total magnitude and its development over an ordered sequence.',
    ],
    donut: [
      'How is one whole divided among a small number of parts?',
      'Compare part-to-whole contribution, not precise differences between similar values.',
    ],
  }[type]
  const [fallbackQuestion, fallbackGoal] = CHART_STORIES[shape] || typeStory
  const authoredQuestion = boundedText(question, 'chart question', 240)
  const authoredInsight = boundedText(insight, 'chart insight', 500)
  return {
    question: authoredQuestion || fallbackQuestion,
    communication_goal: fallbackGoal,
    intended_insight: authoredInsight || description || title,
    action: boundedText(action, 'chart action', 500) || null,
    limitation: boundedText(limitation, 'chart limitation', 500) || null,
  }
}

const directiveError = (message) => Object.assign(new Error(message), { statusCode: 422 })

function directiveAttributes(node, allowed, required = []) {
  const attributes = node.attributes || {}
  const unknown = Object.keys(attributes).find((key) => !allowed.includes(key))
  if (unknown) throw directiveError(`${node.name} directive has unknown attribute "${unknown}"`)
  for (const key of required) {
    if (!String(attributes[key] || '').trim()) throw directiveError(`${node.name} directive requires ${key}`)
  }
  return attributes
}

function boundedText(value, field, max) {
  const text = String(value || '').trim()
  if (text.length > max) throw directiveError(`${field} must be at most ${max} characters`)
  return text
}

function integerAttribute(value, field, { min, max, fallback = null } = {}) {
  if (value == null || value === '') return fallback
  if (!/^\d+$/.test(String(value)) || Number(value) < min || Number(value) > max) {
    throw directiveError(`${field} must be an integer from ${min} to ${max}`)
  }
  return Number(value)
}

function booleanAttribute(value, field, fallback = false) {
  if (value == null || value === '') return fallback
  if (!['true', 'false'].includes(String(value))) throw directiveError(`${field} must be true or false`)
  return String(value) === 'true'
}

function toneAttribute(value, field = 'tone') {
  const tone = String(value || 'neutral')
  if (!REPORT_TONES.has(tone)) {
    throw directiveError(`${field} must be one of ${[...REPORT_TONES].join(', ')}`)
  }
  return tone
}

function reportNode(tagName, className, children = [], properties = {}) {
  return {
    type: 'reportElement',
    children,
    data: { hName: tagName, hProperties: { className, ...properties } },
  }
}

function textNode(tagName, className, value) {
  return reportNode(tagName, className, [{ type: 'text', value: String(value) }])
}

function spanClass(attributes) {
  const span = integerAttribute(attributes.span, 'span', { min: 1, max: 4, fallback: 1 })
  return `report-span-${span}`
}

function tableCellText(cell) {
  return headingText(cell).replace(/\s+/g, ' ').trim()
}

function chartDescriptor(node, charts) {
  if (charts.length >= REPORT_MAX_CHARTS) {
    throw directiveError(`report allows at most ${REPORT_MAX_CHARTS} charts`)
  }
  const attributes = directiveAttributes(
    node,
    [
      'type',
      'shape',
      'title',
      'description',
      'orientation',
      'stacked',
      'unit',
      'span',
      'question',
      'insight',
      'action',
      'limitation',
    ],
    ['type', 'title', 'description'],
  )
  const type = String(attributes.type)
  if (!REPORT_CHART_TYPES.has(type)) {
    throw directiveError(`chart type must be one of ${[...REPORT_CHART_TYPES].join(', ')}`)
  }
  const shape = String(attributes.shape || 'series')
  if (!REPORT_CHART_SHAPES.has(shape)) {
    throw directiveError(`chart shape must be one of ${[...REPORT_CHART_SHAPES].join(', ')}`)
  }
  const orientation = String(attributes.orientation || 'vertical')
  if (!['vertical', 'horizontal'].includes(orientation)) {
    throw directiveError('chart orientation must be vertical or horizontal')
  }
  if (type !== 'bar' && attributes.orientation != null) {
    throw directiveError('chart orientation is only supported for bar charts')
  }
  const stacked = booleanAttribute(attributes.stacked, 'chart stacked')
  if (stacked && !['bar', 'area'].includes(type)) {
    throw directiveError('chart stacked is only supported for bar and area charts')
  }
  if (node.children?.length !== 1 || node.children[0].type !== 'table') {
    throw directiveError('chart directive must contain exactly one Markdown table')
  }
  const table = node.children[0]
  const [head, ...body] = table.children || []
  if (!head || !body.length) throw directiveError('chart table needs a header and at least one data row')
  if (body.length > REPORT_MAX_ROWS) throw directiveError(`chart table allows at most ${REPORT_MAX_ROWS} data rows`)
  const headers = head.children.map(tableCellText)
  if (headers.length < 2 || headers.some((entry) => !entry)) {
    throw directiveError('chart table needs a category column and at least one named value column')
  }
  if (headers.length - 1 > REPORT_MAX_SERIES) {
    throw directiveError(`chart table allows at most ${REPORT_MAX_SERIES} data series`)
  }
  if (type === 'donut' && shape === 'series' && headers.length !== 2) {
    throw directiveError('donut chart table needs exactly one category and one value column')
  }
  const textColumns = shape === 'flow' || shape === 'hierarchy' ? new Set([1]) : new Set()
  const rows = body.map((row, rowIndex) => {
    if (row.children.length !== headers.length) {
      throw directiveError(`chart table row ${rowIndex + 1} must have ${headers.length} cells`)
    }
    const cells = row.children.map(tableCellText)
    if (!cells[0]) throw directiveError(`chart table row ${rowIndex + 1} needs a category`)
    return [
      cells[0],
      ...cells.slice(1).map((value, valueIndex) => {
        if (textColumns.has(valueIndex + 1)) {
          if (!value) throw directiveError(`chart table row ${rowIndex + 1}, column ${valueIndex + 2} needs text`)
          return boundedText(value, `chart table row ${rowIndex + 1}, column ${valueIndex + 2}`, 120)
        }
        if (value === '—') return null
        if (!value)
          throw directiveError(`chart table row ${rowIndex + 1}, column ${valueIndex + 2} needs a number or —`)
        const number = Number(value)
        if (!Number.isFinite(number)) {
          throw directiveError(`chart table row ${rowIndex + 1}, column ${valueIndex + 2} must be a finite number or —`)
        }
        return number
      }),
    ]
  })
  validateChartShape(shape, headers, rows)
  const chart = {
    id: charts.length,
    type,
    data_shape: shape,
    title: boundedText(attributes.title, 'chart title', 160),
    description: boundedText(attributes.description, 'chart description', 500),
    orientation,
    stacked,
    unit: boundedText(attributes.unit, 'chart unit', 16),
    headers,
    rows,
  }
  chart.narrative = chartStory({ ...attributes, ...chart })
  charts.push(chart)
  return chart
}

function validateChartShape(shape, headers, rows) {
  const columns = headers.length
  const exact = (count) => {
    if (columns !== count) throw directiveError(`chart shape ${shape} requires exactly ${count} columns`)
  }
  if (['range', 'change', 'xy'].includes(shape)) exact(3)
  if (['diverging', 'waterfall', 'calendar', 'geo-region', 'samples'].includes(shape)) exact(2)
  if (['flow', 'hierarchy'].includes(shape)) exact(3)
  if (['uncertainty', 'geo-point'].includes(shape)) exact(4)
  if (shape === 'boxplot') exact(6)
  if (shape === 'likert' && (columns < 4 || columns > 7)) {
    throw directiveError('chart shape likert requires 4-7 columns')
  }
  if (shape === 'matrix' && columns < 3) throw directiveError('chart shape matrix requires at least 3 columns')
  if (shape === 'range' && rows.some((row) => row[1] > row[2])) {
    throw directiveError('chart shape range requires lower values not greater than upper values')
  }
  if (
    shape === 'boxplot' &&
    rows.some((row) => row.slice(1).some((value, index, values) => index && value < values[index - 1]))
  ) {
    throw directiveError('chart shape boxplot requires min, q1, median, q3 and max in ascending order')
  }
  if (shape === 'uncertainty' && rows.some((row) => row[1] > row[2] || row[2] > row[3])) {
    throw directiveError('chart shape uncertainty requires lower, value and upper in ascending order')
  }
  if (['likert', 'hierarchy', 'flow'].includes(shape) && rows.some((row) => Number(row.at(-1)) < 0)) {
    throw directiveError(`chart shape ${shape} requires non-negative values`)
  }
  if (
    shape === 'calendar' &&
    rows.some((row) => !/^\d{4}-\d{2}-\d{2}$/.test(row[0]) || Number.isNaN(Date.parse(`${row[0]}T00:00:00Z`)))
  ) {
    throw directiveError('chart shape calendar requires ISO dates in the first column')
  }
  if (shape === 'geo-point' && rows.some((row) => row[1] < -90 || row[1] > 90 || row[2] < -180 || row[2] > 180)) {
    throw directiveError('chart shape geo-point requires latitude -90..90 and longitude -180..180')
  }
}

function listItems(node) {
  const list = node.children?.find((child) => child.type === 'list')
  return (list?.children || []).map((item, index) => ({
    id: `item-${index + 1}`,
    label: headingText(item).replace(/\s+/g, ' ').trim(),
  }))
}

function childDirectives(node, name) {
  return (node.children || []).filter((child) => child.type?.endsWith('Directive') && child.name === name)
}

function normalizedNodeText(node) {
  if (!node) return ''
  if (typeof node.value === 'string') return node.value
  return (node.children || []).map(normalizedNodeText).join(' ').replace(/\s+/g, ' ').trim()
}

function stateAttribute(value, field) {
  const state = String(value || 'normal')
  if (!['normal', 'empty', 'partial', 'invalid', 'stale', 'error', 'loading'].includes(state)) {
    throw directiveError(`${field} must be normal, empty, partial, invalid, stale, error or loading`)
  }
  return state
}

function collectionBounds(name, state, items, minimum, maximum) {
  const min = state === 'normal' ? minimum : 0
  if (items.length < min || items.length > maximum) {
    throw directiveError(`${name} requires ${min}-${maximum} items for state ${state}`)
  }
}

function tableSemantic(node, attributes) {
  const tables = (node.children || []).filter((child) => child.type === 'table')
  if (tables.length !== 1) throw directiveError('data-table directive must contain exactly one Markdown table')
  const [head, ...body] = tables[0].children || []
  if (!head) throw directiveError('data-table requires a header row')
  if (body.length > 200) throw directiveError('data-table allows at most 200 rows')
  const headers = head.children.map(tableCellText)
  if (headers.length < 2 || headers.length > 12 || headers.some((entry) => !entry)) {
    throw directiveError('data-table requires 2-12 named columns')
  }
  if (new Set(headers).size !== headers.length) throw directiveError('data-table column names must be unique')
  const rows = body.map((row, rowIndex) => {
    if (row.children.length !== headers.length) {
      throw directiveError(`data-table row ${rowIndex + 1} must have ${headers.length} cells`)
    }
    return row.children.map((cell, columnIndex) =>
      boundedText(tableCellText(cell), `data-table row ${rowIndex + 1}, column ${columnIndex + 1}`, 500),
    )
  })
  const rowKey = String(attributes.rowKey || headers[0])
  if (!headers.includes(rowKey)) throw directiveError('data-table rowKey must name an existing column')
  const keyIndex = headers.indexOf(rowKey)
  const keys = rows.map((row) => row[keyIndex])
  if (keys.some((entry) => !entry) || new Set(keys).size !== keys.length) {
    throw directiveError('data-table rowKey values must be non-empty and unique')
  }
  const keyColumns = String(attributes.keyColumns || rowKey)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (keyColumns.some((entry) => !headers.includes(entry))) {
    throw directiveError('data-table keyColumns must name existing columns')
  }
  const roles = Object.fromEntries(
    String(attributes.columnRoles || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [column, role] = entry.split(':').map((part) => part?.trim())
        if (!headers.includes(column) || !['key', 'text', 'number', 'status', 'date', 'link'].includes(role)) {
          throw directiveError('data-table columnRoles must use Column:key|text|number|status|date|link')
        }
        return [column, role]
      }),
  )
  const defaultSort = attributes.defaultSort == null ? null : String(attributes.defaultSort)
  if (defaultSort && !headers.includes(defaultSort)) {
    throw directiveError('data-table defaultSort must name an existing column')
  }
  return { headers, rows, row_key: rowKey, key_columns: keyColumns, column_roles: roles, default_sort: defaultSort }
}

function semanticRole(attributes, fallback = 'supporting') {
  const role = String(attributes.role || fallback)
  if (!['primary', 'supporting', 'evidence'].includes(role)) {
    throw directiveError('role must be primary, supporting or evidence')
  }
  return role
}

function compositionDirectives(meta, charts, semanticNodes) {
  return (tree) => {
    visit(tree, ['containerDirective', 'leafDirective', 'textDirective'], (node) => {
      const data = node.data || (node.data = {})
      if (['note', 'tip', 'warning'].includes(node.name)) {
        data.hName = 'aside'
        data.hProperties = { className: ['callout', `callout-${node.name}`], role: 'note' }
      } else if (['hero', 'features', 'steps', 'cta'].includes(node.name) && meta.layout !== 'composition') {
        data.hName = 'section'
        data.hProperties = { className: ['content-block', `content-block-${node.name}`] }
      } else if (COMPOSITION_DIRECTIVES.has(node.name)) {
        if (meta.layout !== 'composition') {
          throw directiveError(`${node.name} directive requires frontmatter layout: composition`)
        }
        if (node.name === 'faq') {
          const attributes = directiveAttributes(node, ['title', 'role', 'preferredPattern', 'state'], ['title'])
          const state = stateAttribute(attributes.state, 'faq state')
          const questions = childDirectives(node, 'question').map((question, index) => {
            const questionAttributes = directiveAttributes(question, ['title', 'category'], ['title'])
            const answer = boundedText(normalizedNodeText(question), `faq answer ${index + 1}`, 2000)
            if (!answer && state === 'normal') throw directiveError(`faq question ${index + 1} needs an answer`)
            return {
              id: `question-${index + 1}`,
              title: boundedText(questionAttributes.title, `faq question ${index + 1}`, 160),
              answer,
              category: boundedText(questionAttributes.category, `faq category ${index + 1}`, 80),
            }
          })
          collectionBounds('faq', state, questions, 2, 24)
          data.hName = 'section'
          data.hProperties = { className: ['composition-faq', `composition-state-${state}`] }
          node.children.unshift({ type: 'heading', depth: 2, children: [{ type: 'text', value: attributes.title }] })
          semanticNodes.push({
            type: 'faq',
            role: semanticRole(attributes),
            title: boundedText(attributes.title, 'faq title', 160),
            questions,
            state,
            preferred_pattern: attributes.preferredPattern || null,
          })
        } else if (node.name === 'question') {
          const attributes = directiveAttributes(node, ['title', 'category'], ['title'])
          data.hName = 'details'
          data.hProperties = { className: ['composition-question'], open: true }
          node.children.unshift(textNode('summary', ['composition-question-title'], attributes.title))
        } else if (node.name === 'code-example') {
          const attributes = directiveAttributes(node, ['title', 'role', 'preferredPattern', 'state'], ['title'])
          const state = stateAttribute(attributes.state, 'code-example state')
          const variants = childDirectives(node, 'variant').map((variant, index) => {
            const variantAttributes = directiveAttributes(
              variant,
              ['label', 'language', 'file', 'default'],
              ['label', 'language'],
            )
            const blocks = (variant.children || []).filter((child) => child.type === 'code')
            if (blocks.length !== 1) throw directiveError('code-example variant requires exactly one fenced code block')
            const code = String(blocks[0].value || '')
            if (code.split(/\r?\n/).length > 120) throw directiveError('code-example variant allows at most 120 lines')
            return {
              id: `variant-${index + 1}`,
              label: boundedText(variantAttributes.label, `code variant ${index + 1} label`, 80),
              language: boundedText(variantAttributes.language, `code variant ${index + 1} language`, 32),
              file: boundedText(variantAttributes.file, `code variant ${index + 1} file`, 160),
              default: booleanAttribute(variantAttributes.default, 'code variant default'),
              code,
            }
          })
          collectionBounds('code-example', state, variants, 1, 8)
          if (variants.filter((variant) => variant.default).length > 1) {
            throw directiveError('code-example allows at most one default variant')
          }
          if (variants.length && !variants.some((variant) => variant.default)) variants[0].default = true
          data.hName = 'section'
          data.hProperties = { className: ['composition-code-example', `composition-state-${state}`] }
          node.children.unshift({ type: 'heading', depth: 2, children: [{ type: 'text', value: attributes.title }] })
          semanticNodes.push({
            type: 'code-example',
            role: semanticRole(attributes, 'evidence'),
            title: boundedText(attributes.title, 'code-example title', 160),
            variants,
            state,
            preferred_pattern: attributes.preferredPattern || null,
          })
        } else if (node.name === 'variant') {
          const attributes = directiveAttributes(node, ['label', 'language', 'file', 'default'], ['label', 'language'])
          data.hName = 'section'
          data.hProperties = { className: ['composition-code-variant'] }
          node.children.unshift({ type: 'heading', depth: 3, children: [{ type: 'text', value: attributes.label }] })
        } else if (node.name === 'pricing') {
          const attributes = directiveAttributes(
            node,
            ['title', 'currency', 'billing', 'role', 'preferredPattern', 'state'],
            ['title', 'currency', 'billing'],
          )
          const state = stateAttribute(attributes.state, 'pricing state')
          const currency = String(attributes.currency).toUpperCase()
          if (!/^[A-Z]{3}$/.test(currency))
            throw directiveError('pricing currency must be an ISO-style three-letter code')
          const billing = String(attributes.billing)
          if (!['monthly', 'yearly', 'one-time', 'custom'].includes(billing)) {
            throw directiveError('pricing billing must be monthly, yearly, one-time or custom')
          }
          const plans = childDirectives(node, 'plan').map((plan, index) => {
            const planAttributes = directiveAttributes(
              plan,
              ['name', 'price', 'cadence', 'previousPrice', 'recommended', 'description'],
              ['name', 'price', 'cadence'],
            )
            const cadence = String(planAttributes.cadence)
            if (!['month', 'year', 'one-time', 'custom'].includes(cadence)) {
              throw directiveError('plan cadence must be month, year, one-time or custom')
            }
            const features = listItems(plan).map((feature, featureIndex) => ({
              ...feature,
              id: slugify(feature.label) || `feature-${featureIndex + 1}`,
            }))
            if (!features.length || features.length > 16) throw directiveError('plan requires 1-16 features')
            return {
              id: `plan-${index + 1}`,
              name: boundedText(planAttributes.name, `plan ${index + 1} name`, 80),
              price: boundedText(planAttributes.price, `plan ${index + 1} price`, 40),
              previous_price: boundedText(planAttributes.previousPrice, `plan ${index + 1} previousPrice`, 40),
              cadence,
              recommended: booleanAttribute(planAttributes.recommended, 'plan recommended'),
              description: boundedText(planAttributes.description, `plan ${index + 1} description`, 240),
              features,
            }
          })
          collectionBounds('pricing', state, plans, 1, 5)
          if (plans.filter((plan) => plan.recommended).length > 1) {
            throw directiveError('pricing allows at most one recommended plan')
          }
          data.hName = 'section'
          data.hProperties = { className: ['composition-pricing', `composition-state-${state}`] }
          node.children.unshift({ type: 'heading', depth: 2, children: [{ type: 'text', value: attributes.title }] })
          semanticNodes.push({
            type: 'pricing',
            role: semanticRole(attributes, 'primary'),
            title: boundedText(attributes.title, 'pricing title', 160),
            currency,
            billing,
            plans,
            state,
            preferred_pattern: attributes.preferredPattern || null,
          })
        } else if (node.name === 'plan') {
          const attributes = directiveAttributes(
            node,
            ['name', 'price', 'cadence', 'previousPrice', 'recommended', 'description'],
            ['name', 'price', 'cadence'],
          )
          data.hName = 'article'
          data.hProperties = {
            className: [
              'composition-plan',
              booleanAttribute(attributes.recommended, 'plan recommended') ? 'composition-plan-recommended' : '',
            ].filter(Boolean),
          }
          node.children.unshift({
            type: 'heading',
            depth: 3,
            children: [{ type: 'text', value: `${attributes.name} — ${attributes.price}` }],
          })
        } else if (node.name === 'gallery') {
          const attributes = directiveAttributes(node, ['title', 'role', 'preferredPattern', 'state'], ['title'])
          const state = stateAttribute(attributes.state, 'gallery state')
          const figures = childDirectives(node, 'figure').map((figure, index) => {
            const figureAttributes = directiveAttributes(
              figure,
              ['src', 'alt', 'caption', 'aspect', 'decorative'],
              ['src'],
            )
            const src = String(figureAttributes.src)
            if (!/^(?:asset|media):[a-zA-Z0-9/_-]+(?:\.[a-zA-Z0-9]+)?$/.test(src) || src.includes('..')) {
              throw directiveError('gallery figure src must be a safe asset: or media: reference')
            }
            const decorative = booleanAttribute(figureAttributes.decorative, 'gallery figure decorative')
            const alt = boundedText(figureAttributes.alt, `gallery figure ${index + 1} alt`, 300)
            if (!decorative && !alt) throw directiveError('informative gallery figures require alt text')
            const aspect = String(figureAttributes.aspect || '4/3')
            if (!/^(?:1\/1|4\/3|3\/2|16\/9|9\/16)$/.test(aspect)) {
              throw directiveError('gallery figure aspect must be 1/1, 4/3, 3/2, 16/9 or 9/16')
            }
            return {
              id: `figure-${index + 1}`,
              src,
              alt,
              caption: boundedText(figureAttributes.caption, `gallery figure ${index + 1} caption`, 240),
              aspect,
              decorative,
            }
          })
          collectionBounds('gallery', state, figures, 2, 24)
          data.hName = 'section'
          data.hProperties = { className: ['composition-gallery', `composition-state-${state}`] }
          node.children.unshift({ type: 'heading', depth: 2, children: [{ type: 'text', value: attributes.title }] })
          semanticNodes.push({
            type: 'gallery',
            role: semanticRole(attributes),
            title: boundedText(attributes.title, 'gallery title', 160),
            figures,
            state,
            preferred_pattern: attributes.preferredPattern || null,
          })
        } else if (node.name === 'figure') {
          const attributes = directiveAttributes(node, ['src', 'alt', 'caption', 'aspect', 'decorative'], ['src'])
          const decorative = booleanAttribute(attributes.decorative, 'gallery figure decorative')
          data.hName = 'figure'
          data.hProperties = { className: ['composition-figure'] }
          node.type = 'containerDirective'
          node.children = [
            reportNode('div', ['composition-figure-placeholder'], [], {
              role: decorative ? undefined : 'img',
              ariaLabel: decorative ? undefined : attributes.alt,
            }),
            ...(attributes.caption ? [textNode('figcaption', ['composition-figure-caption'], attributes.caption)] : []),
          ]
        } else if (node.name === 'data-table') {
          const attributes = directiveAttributes(
            node,
            [
              'title',
              'description',
              'rowKey',
              'keyColumns',
              'columnRoles',
              'defaultSort',
              'role',
              'preferredPattern',
              'state',
            ],
            ['title'],
          )
          const state = stateAttribute(attributes.state, 'data-table state')
          const table = tableSemantic(node, attributes)
          if (state === 'normal' && !table.rows.length)
            throw directiveError('normal data-table requires at least one row')
          data.hName = 'section'
          data.hProperties = { className: ['composition-data-table', `composition-state-${state}`] }
          const authoredTable = node.children.find((child) => child.type === 'table')
          const keyIndex = table.headers.indexOf(table.row_key)
          const records = reportNode(
            'div',
            ['composition-record-list'],
            table.rows.map((row) =>
              reportNode(
                'article',
                ['composition-record'],
                [
                  textNode('strong', ['composition-record-title'], row[keyIndex]),
                  ...table.headers
                    .map((header, index) =>
                      index === keyIndex
                        ? null
                        : reportNode(
                            'div',
                            ['composition-record-field'],
                            [
                              textNode('span', ['composition-record-label'], header),
                              textNode('span', ['composition-record-value'], row[index]),
                            ],
                          ),
                    )
                    .filter(Boolean),
                ],
              ),
            ),
            { ariaHidden: true },
          )
          node.children = [
            { type: 'heading', depth: 2, children: [{ type: 'text', value: attributes.title }] },
            ...(attributes.description
              ? [{ type: 'paragraph', children: [{ type: 'text', value: attributes.description }] }]
              : []),
            authoredTable,
            records,
          ]
          semanticNodes.push({
            type: 'data-table',
            role: semanticRole(attributes, 'evidence'),
            title: boundedText(attributes.title, 'data-table title', 160),
            description: boundedText(attributes.description, 'data-table description', 500),
            ...table,
            state,
            preferred_pattern: attributes.preferredPattern || null,
          })
        } else if (node.name === 'dashboard-section') {
          const attributes = directiveAttributes(
            node,
            ['title', 'description', 'role', 'preferredPattern', 'state'],
            ['title'],
          )
          const state = stateAttribute(attributes.state, 'dashboard-section state')
          data.hName = 'section'
          data.hProperties = { className: ['composition-dashboard-section', `composition-state-${state}`] }
          node.children.unshift({ type: 'heading', depth: 2, children: [{ type: 'text', value: attributes.title }] })
          semanticNodes.push({
            type: 'dashboard-section',
            role: semanticRole(attributes),
            title: boundedText(attributes.title, 'dashboard-section title', 160),
            description: boundedText(attributes.description, 'dashboard-section description', 500),
            items:
              childDirectives(node, 'metric').length +
              childDirectives(node, 'chart').length +
              childDirectives(node, 'data-table').length,
            state,
            preferred_pattern: attributes.preferredPattern || null,
          })
        } else if (node.name === 'application-shell') {
          const attributes = directiveAttributes(node, ['title', 'role', 'preferredPattern', 'state'], ['title'])
          const state = stateAttribute(attributes.state, 'application-shell state')
          const regions = childDirectives(node, 'region').map((region, index) => {
            const regionAttributes = directiveAttributes(region, ['name', 'label'], ['name', 'label'])
            const name = String(regionAttributes.name)
            if (!['navigation', 'breadcrumbs', 'toolbar', 'main', 'secondary'].includes(name)) {
              throw directiveError('application-shell region name is invalid')
            }
            return {
              id: `region-${index + 1}`,
              name,
              label: boundedText(regionAttributes.label, `region ${index + 1} label`, 80),
              text: boundedText(normalizedNodeText(region), `region ${index + 1} text`, 1200),
            }
          })
          collectionBounds('application-shell', state, regions, 2, 5)
          if (new Set(regions.map((region) => region.name)).size !== regions.length) {
            throw directiveError('application-shell region names must be unique')
          }
          if (state === 'normal' && !regions.some((region) => region.name === 'main')) {
            throw directiveError('application-shell requires a main region')
          }
          data.hName = 'section'
          data.hProperties = { className: ['composition-application-shell', `composition-state-${state}`] }
          node.children.unshift({ type: 'heading', depth: 2, children: [{ type: 'text', value: attributes.title }] })
          semanticNodes.push({
            type: 'application-shell',
            role: semanticRole(attributes, 'primary'),
            title: boundedText(attributes.title, 'application-shell title', 160),
            regions,
            state,
            preferred_pattern: attributes.preferredPattern || null,
          })
        } else if (node.name === 'region') {
          const attributes = directiveAttributes(node, ['name', 'label'], ['name', 'label'])
          data.hName = attributes.name === 'navigation' ? 'nav' : 'section'
          data.hProperties = {
            className: ['composition-shell-region', `composition-shell-${attributes.name}`],
            ariaLabel: attributes.label,
          }
          node.children.unshift({ type: 'heading', depth: 3, children: [{ type: 'text', value: attributes.label }] })
        } else if (node.name === 'group') {
          const attributes = directiveAttributes(node, ['columns', 'role', 'preferredPattern'])
          const columns = integerAttribute(attributes.columns, 'group columns', { min: 1, max: 4, fallback: 4 })
          data.hName = 'div'
          data.hProperties = { className: ['composition-group', `composition-columns-${columns}`] }
          semanticNodes.push({
            type: 'group',
            role: semanticRole(attributes),
            columns,
            items: node.children?.length || 0,
            preferred_pattern: attributes.preferredPattern || null,
          })
        } else if (node.name === 'card') {
          const attributes = directiveAttributes(node, ['title', 'span', 'role'], ['title'])
          const title = boundedText(attributes.title, 'card title', 160)
          const text = headingText(node)
          data.hName = 'section'
          data.hProperties = { className: ['composition-card', spanClass(attributes)] }
          node.children.unshift({ type: 'heading', depth: 3, children: [{ type: 'text', value: title }] })
          semanticNodes.push({ type: 'card', role: semanticRole(attributes), title, text })
        } else if (node.name === 'hero') {
          const attributes = directiveAttributes(node, ['role', 'preferredPattern'])
          const heading = node.children?.find((child) => child.type === 'heading')
          data.hName = 'section'
          data.hProperties = { className: ['composition-hero'] }
          semanticNodes.push({
            type: 'hero',
            role: semanticRole(attributes, 'primary'),
            title: headingText(heading),
            text: (node.children || [])
              .filter((child) => child !== heading)
              .map(headingText)
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim(),
            preferred_pattern: attributes.preferredPattern || null,
          })
        } else if (['process', 'timeline', 'hierarchy', 'relationship'].includes(node.name)) {
          const attributes = directiveAttributes(node, ['title', 'role', 'preferredPattern', 'orientation'])
          const items = listItems(node)
          const minimum = node.name === 'process' || node.name === 'timeline' ? 2 : node.name === 'relationship' ? 3 : 2
          const maximum =
            node.name === 'timeline' ? 12 : node.name === 'relationship' ? 8 : node.name === 'hierarchy' ? 16 : 8
          if (items.length < minimum || items.length > maximum) {
            throw directiveError(`${node.name} requires ${minimum}-${maximum} list items`)
          }
          data.hName = 'section'
          data.hProperties = {
            className: [
              'composition-structure',
              `composition-${node.name}`,
              `composition-orientation-${attributes.orientation || 'auto'}`,
            ],
          }
          semanticNodes.push({
            type: node.name,
            role: semanticRole(attributes),
            title: boundedText(attributes.title, `${node.name} title`, 160),
            items,
            ...(node.name === 'process' ? { steps: items } : {}),
            ...(node.name === 'timeline' ? { events: items } : {}),
            preferred_pattern: attributes.preferredPattern || null,
          })
        } else if (node.name === 'comparison') {
          const attributes = directiveAttributes(node, ['title', 'role', 'preferredPattern'])
          const sides = (node.children || [])
            .filter((child) => child.type?.endsWith('Directive') && child.name === 'side')
            .map((side, index) => ({
              id: `side-${index + 1}`,
              label: String(side.attributes?.label || '').trim(),
              points: listItems(side),
            }))
          if (
            sides.length < 2 ||
            sides.length > 6 ||
            sides.some((side) => !side.label || !side.points.length || side.points.length > 8)
          ) {
            throw directiveError('comparison requires 2-6 labeled side directives with 1-8 points each')
          }
          data.hName = 'section'
          data.hProperties = { className: ['composition-comparison'] }
          semanticNodes.push({
            type: 'comparison',
            role: semanticRole(attributes),
            title: boundedText(attributes.title, 'comparison title', 160),
            sides,
            preferred_pattern: attributes.preferredPattern || null,
          })
        } else if (node.name === 'side') {
          const attributes = directiveAttributes(node, ['label'], ['label'])
          data.hName = 'section'
          data.hProperties = { className: ['composition-side'] }
          node.children.unshift({ type: 'heading', depth: 3, children: [{ type: 'text', value: attributes.label }] })
        } else if (node.name === 'metric') {
          const attributes = directiveAttributes(
            node,
            [
              'label',
              'value',
              'trend',
              'tone',
              'span',
              'role',
              'preferredPattern',
              'period',
              'previous',
              'target',
              'unit',
              'status',
            ],
            ['label', 'value'],
          )
          const tone = toneAttribute(attributes.tone, 'metric tone')
          data.hName = 'article'
          data.hProperties = { className: ['report-metric', `report-tone-${tone}`, spanClass(attributes)] }
          node.type = 'containerDirective'
          node.children = [
            textNode('span', ['report-metric-label'], boundedText(attributes.label, 'metric label', 120)),
            textNode('strong', ['report-metric-value'], boundedText(attributes.value, 'metric value', 120)),
            ...(attributes.trend
              ? [textNode('span', ['report-metric-trend'], boundedText(attributes.trend, 'metric trend', 80))]
              : []),
          ]
          semanticNodes.push({
            type: 'metric',
            role: semanticRole(attributes),
            label: boundedText(attributes.label, 'metric label', 120),
            value: boundedText(attributes.value, 'metric value', 120),
            trend: boundedText(attributes.trend, 'metric trend', 80),
            tone,
            period: boundedText(attributes.period, 'metric period', 80),
            previous: boundedText(attributes.previous, 'metric previous', 80),
            target: boundedText(attributes.target, 'metric target', 80),
            unit: boundedText(attributes.unit, 'metric unit', 32),
            status: boundedText(attributes.status, 'metric status', 40),
            preferred_pattern: attributes.preferredPattern || null,
          })
        } else if (node.name === 'badge') {
          const attributes = directiveAttributes(node, ['tone'])
          const tone = toneAttribute(attributes.tone, 'badge tone')
          if (!headingText(node).trim()) throw directiveError('badge directive needs visible text')
          data.hName = 'span'
          data.hProperties = { className: ['report-badge', `report-tone-${tone}`] }
        } else if (node.name === 'progress') {
          const attributes = directiveAttributes(node, ['label', 'value', 'max', 'span', 'role'], ['label', 'value'])
          const max = Number(attributes.max ?? 100)
          const value = Number(attributes.value)
          if (!Number.isFinite(max) || max <= 0) throw directiveError('progress max must be a positive number')
          if (!Number.isFinite(value) || value < 0 || value > max) {
            throw directiveError('progress value must be a number from 0 to max')
          }
          const percentage = Number(((value / max) * 100).toFixed(4))
          data.hName = 'div'
          data.hProperties = {
            className: ['report-progress', spanClass(attributes)],
            role: 'progressbar',
            ariaValueMin: 0,
            ariaValueMax: max,
            ariaValueNow: value,
            ariaLabel: boundedText(attributes.label, 'progress label', 120),
          }
          node.type = 'containerDirective'
          node.children = [
            reportNode(
              'div',
              ['report-progress-head'],
              [
                textNode('span', ['report-progress-label'], attributes.label),
                textNode('span', ['report-progress-value'], `${value}/${max}`),
              ],
            ),
            reportNode(
              'div',
              ['report-progress-track'],
              [reportNode('span', ['report-progress-fill'], [], { style: `width:${percentage}%` })],
            ),
          ]
          semanticNodes.push({ type: 'progress', role: semanticRole(attributes), label: attributes.label, value, max })
        } else if (node.name === 'chart') {
          const chart = chartDescriptor(node, charts)
          const table = node.children[0]
          data.hName = 'figure'
          data.hProperties = { className: ['report-chart', spanClass(node.attributes || {})] }
          node.children = [
            textNode('figcaption', ['report-chart-caption'], chart.title),
            reportNode('div', ['report-chart-visual'], [], { dataReportChart: chart.id }),
            reportNode(
              'details',
              ['report-chart-data'],
              [textNode('summary', ['report-chart-summary'], 'Data'), table],
            ),
          ]
          semanticNodes.push({ ...chart, type: 'chart', role: 'evidence', chart_type: chart.type })
        }
      } else if (meta.layout === 'composition') {
        throw directiveError(`unknown composition directive "${node.name}"`)
      }
    })
  }
}

function optionalSlug(value, field) {
  return value == null || value === '' ? null : String(assertSlug(value, field))
}

function validateAccess(value) {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 32) {
    throw Object.assign(new Error('frontmatter access must be a list of at most 32 group slugs'), { statusCode: 422 })
  }
  const groups = value.map((entry) => String(entry).trim().toLowerCase())
  if (groups.some((entry) => !accessSlug.test(entry)) || new Set(groups).size !== groups.length) {
    throw Object.assign(new Error('frontmatter access contains an invalid or duplicate group slug'), {
      statusCode: 422,
    })
  }
  return groups
}

function validateChangeTypes(value) {
  if (value == null) return []
  const allowed = new Set(['added', 'changed', 'deprecated', 'removed', 'fixed', 'security'])
  if (!Array.isArray(value) || value.some((entry) => !allowed.has(String(entry)))) {
    throw Object.assign(new Error(`frontmatter changeTypes must contain only ${[...allowed].join(', ')}`), {
      statusCode: 422,
    })
  }
  return [...new Set(value.map(String))]
}

// Collapse a heading's inline content to plain text. `# A *b* c` -> `A b c`.
function headingText(node) {
  if (typeof node.value === 'string') return node.value
  return (node.children || []).map(headingText).join('')
}

// Compared against `headingText`, which yields the heading's *rendered* text: mdast has
// already turned `` `async/await` `` into an inlineCode node whose value carries no
// backticks, and `*x*` into emphasis around plain text. A frontmatter title, being a raw
// string, still holds that syntax. Strip the inline markers from both sides so the two
// spellings of the same title compare equal. Applied symmetrically, so a literal
// underscore inside a word survives on both sides or on neither.
export const normalizeTitle = (value) =>
  String(value || '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

// The layout already renders the frontmatter `title` as the page's <h1>. Authors
// conventionally repeat it as the document's opening heading, which yields two <h1>
// on the page and a document outline that starts twice. Drop that heading — but only
// when it is the first block *and* its text is the title, so a body that deliberately
// opens with a different top-level heading keeps it.
//
// This edits the rendered HTML only. `source` (and therefore llms-full.txt) keeps the
// document exactly as authored.
function dropRedundantTitle(title) {
  return (tree) => {
    const index = tree.children.findIndex((node) => node.type !== 'yaml')
    const first = tree.children[index]
    if (!first || first.type !== 'heading' || first.depth !== 1) return
    if (normalizeTitle(headingText(first)) !== normalizeTitle(title)) return
    tree.children.splice(index, 1)
  }
}

function mermaidBlocks() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'pre' || node.children?.[0]?.tagName !== 'code') return
      const code = node.children[0]
      if (!(code.properties?.className || []).includes('language-mermaid')) return
      node.properties = { className: ['mermaid'] }
      node.children = [{ type: 'text', value: code.children?.map((child) => child.value || '').join('') || '' }]
    })
  }
}

function fencedMetadata(value, label) {
  const source = String(value || '').trim()
  if (!source) return {}
  const result = {}
  const consumed = []
  for (const match of source.matchAll(/([a-z][a-z-]*)=(?:"([^"]*)"|'([^']*)')/g)) {
    const key = match[1]
    if (!['title', 'question', 'insight', 'action', 'limitation'].includes(key)) {
      throw directiveError(`${label} has unknown metadata "${key}"`)
    }
    if (key in result) throw directiveError(`${label} metadata "${key}" is duplicated`)
    result[key] = match[2] ?? match[3] ?? ''
    consumed.push([match.index, match.index + match[0].length])
  }
  let remainder = source
  for (const [from, to] of consumed.reverse()) remainder = `${remainder.slice(0, from)}${remainder.slice(to)}`
  if (remainder.trim()) throw directiveError(`${label} metadata must use key="value" pairs`)
  return result
}

function diagramKind(source) {
  const declaration =
    String(source || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('%%')) || ''
  if (/^sequenceDiagram\b/i.test(declaration)) return 'sequence'
  if (/^stateDiagram(?:-v2)?\b/i.test(declaration)) return 'state'
  if (/^(?:erDiagram|classDiagram)\b/i.test(declaration)) return 'data-model'
  if (/^(?:architecture-beta|C4\w*)\b/i.test(declaration)) return 'architecture'
  if (/^(?:flowchart|graph)\b/i.test(declaration)) return 'process'
  return 'technical'
}

function semanticFencedBlocks(semanticNodes) {
  const guideByKind = {
    process: 'process-diagram',
    sequence: 'sequence-diagram',
    state: 'state-diagram',
    'data-model': 'data-model-diagram',
    architecture: 'architecture-diagram',
    technical: 'architecture-diagram',
  }
  return (tree) => {
    visit(tree, 'code', (node) => {
      if (node.lang !== 'mermaid') return
      const metadata = fencedMetadata(node.meta, 'mermaid fence')
      const kind = diagramKind(node.value)
      const guide = getPublishingGuide(guideByKind[kind])
      semanticNodes.push({
        type: 'diagram',
        role: 'evidence',
        diagram_kind: kind,
        title: boundedText(metadata.title, 'diagram title', 160) || null,
        publishing_guide: guide.id,
        semantics: guide.semantics,
        narrative: {
          ...guide.narrative,
          question: boundedText(metadata.question, 'diagram question', 240) || guide.narrative.question,
          reader_takeaway: boundedText(metadata.insight, 'diagram insight', 500) || guide.narrative.reader_takeaway,
          action: boundedText(metadata.action, 'diagram action', 500) || null,
          limitation: boundedText(metadata.limitation, 'diagram limitation', 500) || null,
        },
      })
    })
  }
}

const schema = {
  ...defaultSchema,
  tagNames: [
    ...new Set([
      ...(defaultSchema.tagNames || []),
      'aside',
      'input',
      'span',
      'div',
      'pre',
      'article',
      'section',
      'figure',
      'figcaption',
      'details',
      'summary',
      'strong',
    ]),
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...(defaultSchema.attributes?.['*'] || []),
      'className',
      'ariaHidden',
      'ariaLabel',
      'ariaValueMin',
      'ariaValueMax',
      'ariaValueNow',
      'role',
    ],
    a: [...(defaultSchema.attributes?.a || []), 'dataFootnoteRef', 'dataFootnoteBackref'],
    input: ['type', 'checked', 'disabled'],
    code: ['className', 'style'],
    pre: ['className', 'style'],
    span: ['className', 'style'],
    div: ['className', 'style', 'dataReportChart'],
    aside: ['className', 'role'],
    section: ['className'],
    article: ['className'],
    figure: ['className'],
    figcaption: ['className'],
    details: ['className', 'open'],
    summary: ['className'],
    strong: ['className'],
  },
}

// Frontmatter-authored reader aids. Validation is strict on shape (a wrong type
// fails the upload with a 422 the author sees immediately) but tolerant on
// scalars: YAML happily parses `- 42` as a number, so scalar entries are
// stringified rather than rejected.
const scalar = (value) => value != null && typeof value !== 'object'

function validateTldr(value) {
  if (value == null) return []
  if (!Array.isArray(value) || !value.every(scalar)) {
    throw Object.assign(new Error('frontmatter tldr must be a list of strings'), { statusCode: 422 })
  }
  const lines = value.map((entry) => String(entry).trim()).filter(Boolean)
  if (lines.length !== value.length) {
    throw Object.assign(new Error('frontmatter tldr must not contain empty entries'), { statusCode: 422 })
  }
  return lines
}

function validateFaq(value) {
  if (value == null) return []
  const wellFormed =
    Array.isArray(value) &&
    value.every((entry) => entry && typeof entry === 'object' && scalar(entry.q) && scalar(entry.a))
  if (!wellFormed) {
    throw Object.assign(new Error('frontmatter faq must be a list of { q, a } entries'), { statusCode: 422 })
  }
  return value.map((entry) => {
    const q = String(entry.q).trim()
    const a = String(entry.a).trim()
    if (!q || !a) {
      throw Object.assign(new Error('frontmatter faq entries need a non-empty q and a'), { statusCode: 422 })
    }
    return { q, a }
  })
}

// Author-owned custom fields (`extra:`), passed through to the revision's
// metadata verbatim with their YAML types preserved. There is no schema
// builder: the shape rules below are the whole contract, and consumers (the
// Read API, per-site tooling) interpret the fields themselves. Bounded so a
// single document cannot turn the metadata column into a blob store.
const EXTRA_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const EXTRA_MAX_FIELDS = 32
const EXTRA_MAX_LIST_ENTRIES = 64
const EXTRA_MAX_MAP_ENTRIES = 32
const EXTRA_MAX_BYTES = 16384

function validateExtra(value) {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('frontmatter extra must be a map of custom fields'), { statusCode: 422 })
  }
  const entries = Object.entries(value)
  if (!entries.length) return null
  if (entries.length > EXTRA_MAX_FIELDS) {
    throw Object.assign(new Error(`frontmatter extra allows at most ${EXTRA_MAX_FIELDS} fields`), { statusCode: 422 })
  }
  const assertKey = (key) => {
    if (!EXTRA_KEY_PATTERN.test(key)) {
      throw Object.assign(new Error('frontmatter extra keys must match [a-z][a-z0-9_]{0,63}'), { statusCode: 422 })
    }
  }
  const badValue = () =>
    Object.assign(new Error('frontmatter extra values must be scalars, lists of scalars or flat maps of scalars'), {
      statusCode: 422,
    })
  for (const [key, entry] of entries) {
    assertKey(key)
    if (scalar(entry)) continue
    if (Array.isArray(entry)) {
      if (entry.length > EXTRA_MAX_LIST_ENTRIES) {
        throw Object.assign(new Error(`frontmatter extra lists allow at most ${EXTRA_MAX_LIST_ENTRIES} entries`), {
          statusCode: 422,
        })
      }
      if (!entry.every(scalar)) throw badValue()
      continue
    }
    if (entry && typeof entry === 'object') {
      const nested = Object.entries(entry)
      if (nested.length > EXTRA_MAX_MAP_ENTRIES) {
        throw Object.assign(new Error(`frontmatter extra maps allow at most ${EXTRA_MAX_MAP_ENTRIES} entries`), {
          statusCode: 422,
        })
      }
      for (const [nestedKey, nestedValue] of nested) {
        assertKey(nestedKey)
        if (!scalar(nestedValue)) throw badValue()
      }
      continue
    }
    throw badValue() // null entries: an absent value is expressed by omitting the key
  }
  if (Buffer.byteLength(JSON.stringify(value)) > EXTRA_MAX_BYTES) {
    throw Object.assign(new Error('frontmatter extra must not exceed 16 KiB'), { statusCode: 422 })
  }
  return value
}

// Authored references (`related:`), a list of same-locale post slugs. Stored
// as `related_slugs` so it cannot collide with the derived `related` link
// projection the site builder attaches at build time. Validation is
// write-time only — whether a slug resolves is decided at build time, where
// a broken reference is dropped with a warning instead of failing a release.
const RELATED_MAX_REFERENCES = 8

function validateRelated(value, slug) {
  if (value == null) return null
  if (!Array.isArray(value)) {
    throw Object.assign(new Error('frontmatter related must be a list of slugs'), { statusCode: 422 })
  }
  // YAML parses `- 42` as a number; assertSlug accepts it (its regex coerces),
  // so normalize to strings for stable comparisons against post slugs.
  const slugs = value.map((entry) => String(assertSlug(entry, 'related')))
  if (!slugs.length) return null
  if (slugs.length > RELATED_MAX_REFERENCES) {
    throw Object.assign(new Error(`frontmatter related allows at most ${RELATED_MAX_REFERENCES} references`), {
      statusCode: 422,
    })
  }
  if (new Set(slugs).size !== slugs.length) {
    throw Object.assign(new Error('frontmatter related must not contain duplicates'), { statusCode: 422 })
  }
  if (slugs.includes(slug)) {
    throw Object.assign(new Error('frontmatter related must not reference the document itself'), { statusCode: 422 })
  }
  return slugs
}

function validateComposition(value, pageLayout, { legacyReport = false } = {}) {
  if (pageLayout !== 'composition') {
    if (value !== undefined)
      throw Object.assign(new Error('frontmatter composition requires layout: composition'), { statusCode: 422 })
    return null
  }
  if (value == null) value = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('frontmatter composition must be an object'), { statusCode: 422 })
  }
  const allowed = new Set([
    'format',
    'canvas',
    'intent',
    'density',
    'preferredPattern',
    'audience',
    'question',
    'goal',
    'thesis',
    'conclusion',
    'action',
    'limitations',
    'disclosure',
  ])
  const unknown = Object.keys(value).find((key) => !allowed.has(key))
  if (unknown)
    throw Object.assign(new Error(`frontmatter composition has unknown field "${unknown}"`), { statusCode: 422 })
  const format = String(value.format || (legacyReport ? 'report' : 'infographic'))
  const canvas = String(value.canvas || (format === 'report' ? 'flow' : 'portrait'))
  const intent = String(value.intent || 'explain')
  const density = String(value.density || 'balanced')
  const choices = [
    ['format', format, ['infographic', 'report']],
    ['canvas', canvas, ['portrait', 'landscape', 'square', 'flow']],
    ['intent', intent, ['explain', 'compare', 'sequence', 'status', 'explore']],
    ['density', density, ['compact', 'balanced', 'spacious']],
  ]
  for (const [field, entry, values] of choices) {
    if (!values.includes(entry)) {
      throw Object.assign(new Error(`frontmatter composition.${field} must be one of ${values.join(', ')}`), {
        statusCode: 422,
      })
    }
  }
  const preferredPattern = value.preferredPattern == null ? null : String(value.preferredPattern)
  if (preferredPattern && !/^[a-z][a-z0-9-]{1,63}$/.test(preferredPattern)) {
    throw Object.assign(new Error('frontmatter composition.preferredPattern is invalid'), { statusCode: 422 })
  }
  const disclosure = String(value.disclosure || 'complete')
  if (!['overview', 'progressive', 'complete'].includes(disclosure)) {
    throw Object.assign(new Error('frontmatter composition.disclosure must be overview, progressive or complete'), {
      statusCode: 422,
    })
  }
  const limitations = value.limitations == null ? [] : value.limitations
  if (
    !Array.isArray(limitations) ||
    limitations.length > 12 ||
    limitations.some((entry) => typeof entry !== 'string' || !entry.trim() || entry.trim().length > 300)
  ) {
    throw Object.assign(
      new Error('frontmatter composition.limitations must contain at most 12 non-empty strings of 300 characters'),
      { statusCode: 422 },
    )
  }
  return {
    format,
    canvas,
    intent,
    density,
    preferred_pattern: preferredPattern,
    audience: boundedText(value.audience, 'composition audience', 120),
    question: boundedText(value.question, 'composition question', 240),
    goal: boundedText(value.goal, 'composition goal', 240),
    thesis: boundedText(value.thesis, 'composition thesis', 500),
    conclusion: boundedText(value.conclusion, 'composition conclusion', 500),
    action: boundedText(value.action, 'composition action', 500),
    limitations: limitations.map((entry) => entry.trim()),
    disclosure,
  }
}

function validateFrontmatter(data, { lenient = false, warnings = [] } = {}) {
  const kind = data.kind || 'page'
  if (!kinds.has(kind))
    throw Object.assign(new Error('frontmatter kind must be page, post or project'), { statusCode: 422 })
  const title = String(data.title || '').trim()
  if (!title) throw Object.assign(new Error('frontmatter title is required'), { statusCode: 422 })
  const locale = String(data.locale || '').toLowerCase()
  if (!/^[a-z]{2}(?:-[a-z]{2})?$/.test(locale)) {
    throw Object.assign(new Error('frontmatter locale must be an IETF language tag such as de or en-us'), {
      statusCode: 422,
    })
  }
  const slug = assertSlug(data.slug || slugify(title))
  const translationKey = assertSlug(data.translationKey || data.translation_key || slug, 'translationKey')
  const tags = Array.isArray(data.tags) ? data.tags.map((tag) => String(tag).trim()).filter(Boolean) : []
  const authoredLayout = data.layout == null ? null : String(data.layout)
  if (authoredLayout && !layouts.has(authoredLayout)) {
    throw Object.assign(new Error(`frontmatter layout must be one of ${[...layouts].join(', ')}`), { statusCode: 422 })
  }
  const legacyReport = authoredLayout === 'report'
  const pageLayout = legacyReport ? 'composition' : authoredLayout
  const composition = validateComposition(data.composition, pageLayout, { legacyReport })
  const reportCadence = data.reportCadence == null ? null : String(data.reportCadence).trim()
  if (reportCadence && !REPORT_CADENCES.has(reportCadence)) {
    throw Object.assign(new Error(`frontmatter reportCadence must be one of ${[...REPORT_CADENCES].join(', ')}`), {
      statusCode: 422,
    })
  }
  if (reportCadence && composition?.format !== 'report') {
    throw Object.assign(new Error('frontmatter reportCadence requires composition.format: report'), { statusCode: 422 })
  }
  const meta = {
    kind,
    title,
    locale,
    slug,
    translation_key: translationKey,
    summary: String(data.summary || '').trim(),
    tags,
    published_at: parseIsoDate(data.date || data.publishedAt, 'date'),
    scheduled_at: parseIsoDate(data.scheduledAt, 'scheduledAt'),
    updated_at: parseIsoDate(data.updatedAt, 'updatedAt'),
    cover: data.cover || data.image ? String(data.cover || data.image) : null,
    cover_alt: data.coverAlt || data.imageAlt ? String(data.coverAlt || data.imageAlt) : '',
    noindex: Boolean(data.noindex),
    // Authored reader aids: TL;DR bullets and an FAQ, rendered on the page and
    // exposed to machines (JSON-LD abstract/FAQPage, Markdown export, search
    // index). Authored content like `summary` — contentkit never generates them.
    tldr: validateTldr(data.tldr),
    faq: validateFaq(data.faq),
    // Authored opt-out for the read-aloud feature; absence means eligible.
    audio: data.audio !== false,
    featured: Boolean(data.featured),
    technologies: Array.isArray(data.technologies) ? data.technologies.map(String) : [],
    external_url: data.externalUrl ? String(data.externalUrl) : null,
    nav_order: Number.isFinite(Number(data.navOrder)) ? Number(data.navOrder) : null,
    layout: pageLayout,
    composition,
    report_cadence: reportCadence,
    doc_key: optionalSlug(data.docKey, 'docKey'),
    docs_version: optionalSlug(data.docsVersion, 'docsVersion'),
    parent: optionalSlug(data.parent, 'parent'),
    nav_title: data.navTitle == null ? null : String(data.navTitle).trim().slice(0, 120),
    category: data.category == null ? null : String(data.category).trim().slice(0, 120),
    release_version: data.releaseVersion == null ? null : String(data.releaseVersion).trim().slice(0, 64),
    change_types: validateChangeTypes(data.changeTypes),
    access: validateAccess(data.access),
  }
  // Content modeling light: both keys are additive and omitted entirely when
  // absent or empty, so revisions written before they existed keep
  // byte-identical metadata. The write path validates strictly (422 the author
  // sees immediately); the lenient render paths that replay stored revisions
  // (site builds, the Read API) instead drop a malformed value with a warning —
  // a document that was valid when written must never fail a future release.
  const dropWhenLenient = (key, validate) => {
    try {
      return validate()
    } catch (error) {
      if (!lenient || error.statusCode !== 422) throw error
      warnings.push(`frontmatter ${key} dropped: ${error.message}`)
      return null
    }
  }
  const extra = dropWhenLenient('extra', () => validateExtra(data.extra))
  if (extra) meta.extra = extra
  const relatedSlugs = dropWhenLenient('related', () => validateRelated(data.related, slug))
  if (relatedSlugs) meta.related_slugs = relatedSlugs
  return meta
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith('---\n') && !markdown.startsWith('---\r\n')) {
    return { data: {}, content: markdown }
  }
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) throw Object.assign(new Error('frontmatter is not terminated with ---'), { statusCode: 422 })
  let data
  try {
    data = parseYaml(match[1], { maxAliasCount: 20 }) || {}
  } catch (error) {
    throw Object.assign(new Error(`invalid YAML frontmatter: ${error.message}`), { statusCode: 422 })
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw Object.assign(new Error('frontmatter must be a YAML object'), { statusCode: 422 })
  }
  return { data, content: markdown.slice(match[0].length) }
}

export async function renderMarkdown(markdown, { lenient = false } = {}) {
  const parsed = parseFrontmatter(markdown)
  const warnings = []
  const meta = validateFrontmatter(parsed.data, { lenient, warnings })
  const charts = []
  const semanticNodes = []
  if (!meta.summary) meta.summary = excerpt(parsed.content.replace(/[`#>*_[\]()!-]/g, ' '))
  const content =
    parsed.data.layout === 'report'
      ? parsed.content.replace(/(:{2,})report-grid\b/g, '$1group').replace(/(:{2,})report-card\b/g, '$1card')
      : parsed.content

  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkDirective)
    .use(compositionDirectives, meta, charts, semanticNodes)
    .use(semanticFencedBlocks, semanticNodes)
    .use(dropRedundantTitle, meta.title)
    .use(remarkRehype)
    .use(mermaidBlocks)
    .use(rehypeSanitize, schema)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, { behavior: 'wrap', properties: { className: ['heading-anchor'] } })
    .use(rehypeKatex)
    .use(rehypeShiki, { themes: { light: 'github-light', dark: 'github-dark' } })
    .use(rehypeStringify)

  const html = String(await processor.process(content))
  const semantic = {
    schema_version: '1',
    title: meta.title,
    summary: meta.summary,
    locale: meta.locale,
    nodes: semanticNodes.map((node, index) => ({ id: `node-${index + 1}`, ...node })),
  }
  let narrative = null
  let composition = null
  let diagnostics = []
  if (meta.layout === 'composition') {
    if (!semantic.nodes.length) throw directiveError('layout: composition requires at least one semantic directive')
    const primary = semantic.nodes.find((node) => node.role === 'primary') || semantic.nodes[0]
    narrative = {
      schema_version: '1',
      intent: meta.composition.intent,
      target_audience: meta.composition.audience || null,
      question: meta.composition.question || null,
      communication_goal: meta.composition.goal || null,
      thesis: meta.composition.thesis || null,
      conclusion: meta.composition.conclusion || null,
      action: meta.composition.action || null,
      limitations: meta.composition.limitations,
      disclosure: meta.composition.disclosure,
      primary_node: primary.id,
      sequence: semantic.nodes.map((node) => node.id),
      evidence: semantic.nodes.filter((node) => node.role === 'evidence').map((node) => node.id),
      stages: {
        primary: semantic.nodes.filter((node) => node.role === 'primary').map((node) => node.id),
        supporting: semantic.nodes.filter((node) => node.role === 'supporting').map((node) => node.id),
        evidence: semantic.nodes.filter((node) => node.role === 'evidence').map((node) => node.id),
      },
      relationships: [
        ...semantic.nodes.slice(1).map((node, index) => ({
          from: semantic.nodes[index].id,
          to: node.id,
          relation: 'precedes',
        })),
        ...semantic.nodes
          .filter((node) => node.role === 'evidence')
          .map((node) => ({ from: node.id, to: primary.id, relation: 'supports' })),
      ],
    }
    const preferred = meta.composition.preferred_pattern || primary.preferred_pattern || null
    const resolved = resolvePattern(semantic, { ...meta.composition, preferred_pattern: preferred })
    composition = {
      schema_version: '1',
      format: meta.composition.format,
      canvas: meta.composition.canvas,
      density: meta.composition.density,
      requested_pattern: resolved.requested_pattern,
      resolved_pattern: resolved.resolved_pattern,
      recommendations: resolved.recommendations.slice(0, 5),
    }
    diagnostics = resolved.diagnostics
  }
  return {
    meta,
    html,
    source: parsed.content,
    hasMermaid: /class="mermaid"/.test(html),
    charts,
    semantic,
    narrative,
    composition,
    diagnostics,
    warnings,
  }
}
