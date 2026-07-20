const finiteBox = (box, label) => {
  const normalized = Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, Number(box?.[key])]))
  if (
    Object.values(normalized).some((value) => !Number.isFinite(value)) ||
    normalized.width < 0 ||
    normalized.height < 0
  ) {
    throw Object.assign(new Error(`composition layout has invalid ${label} geometry`), { statusCode: 500 })
  }
  return normalized
}

const roundedBox = (box) =>
  Object.fromEntries(Object.entries(box).map(([key, value]) => [key, Number(Number(value).toFixed(2))]))

function layoutBoxes(primitive, frame, count, breakpoint) {
  if (!count) return []
  const gap = breakpoint === 'compact' ? 12 : breakpoint === 'narrow' ? 16 : 20
  const narrow = ['compact', 'narrow'].includes(breakpoint)
  const columnsByPrimitive = {
    split: narrow ? 1 : 2,
    grid: narrow ? 1 : Math.min(3, count),
    matrix: narrow ? 1 : Math.min(4, count),
    sequence: narrow ? 1 : Math.min(4, count),
    connector: narrow ? 1 : Math.min(4, count),
    stack: 1,
    frame: 1,
    card: 1,
    radial: narrow ? 1 : Math.min(3, count),
    layers: 1,
  }
  const columns = columnsByPrimitive[primitive] || 1
  const rows = Math.ceil(count / columns)
  const width = Math.max(0, (frame.width - gap * (columns - 1)) / columns)
  const height = Math.max(0, (frame.height - gap * (rows - 1)) / rows)
  return Array.from({ length: count }, (_entry, index) =>
    roundedBox({
      x: frame.x + (index % columns) * (width + gap),
      y: frame.y + Math.floor(index / columns) * (height + gap),
      width,
      height,
    }),
  )
}

function primitiveType(node) {
  if (node.type === 'chart') return 'chart'
  if (node.type === 'data-table') return 'table'
  if (node.type === 'gallery') return 'image'
  if (node.type === 'faq') return 'disclosure'
  if (node.type === 'process' || node.type === 'timeline' || node.type === 'relationship') return 'connector-group'
  if (node.type === 'hero') return 'text'
  return 'region'
}

function resolvedPrimitives(rendered, pattern, body, context) {
  const nodes = rendered.semantic?.nodes || []
  const boxes = layoutBoxes(pattern.layout.primitive, body, nodes.length, context.breakpoint)
  const children = nodes.map((node, index) => ({
    id: `primitive-${node.id}`,
    type: primitiveType(node),
    semantic_type: node.type,
    role: node.role || 'supporting',
    source_node_ids: [node.id],
    box: boxes[index],
    style: {
      surface: node.role === 'primary' ? 'emphasized' : 'default',
      density: rendered.composition?.density || rendered.meta?.composition?.density || 'balanced',
      typography: node.type === 'hero' ? 'display' : node.type === 'metric' ? 'metric' : 'body',
    },
  }))
  if (['sequence', 'connector'].includes(pattern.layout.primitive) && children.length > 1) {
    const sourceCount = children.length
    for (let index = 0; index < sourceCount - 1; index += 1) {
      const from = children[index].box
      const to = children[index + 1].box
      children.push({
        id: `connector-${index + 1}`,
        type: 'connector',
        role: 'presentation',
        source_node_ids: [...children[index].source_node_ids, ...children[index + 1].source_node_ids],
        from: { x: from.x + from.width, y: from.y + from.height / 2 },
        to: { x: to.x, y: to.y + to.height / 2 },
        style: { kind: 'directed' },
      })
    }
  }
  return children
}

export function responsiveContext(viewport = {}, container = {}) {
  const viewportWidth = Number(viewport?.width || 0)
  const viewportHeight = Number(viewport?.height || 0)
  const containerWidth = Number(
    container?.width || viewport?.container_width || viewport?.container?.width || viewportWidth || 0,
  )
  const containerHeight = Number(
    container?.height || viewport?.container_height || viewport?.container?.height || viewportHeight || 0,
  )
  const effectiveWidth = containerWidth || viewportWidth
  return {
    viewport: { width: viewportWidth || null, height: viewportHeight || null },
    container: { width: containerWidth || null, height: containerHeight || null },
    effective_width: effectiveWidth || null,
    breakpoint:
      effectiveWidth <= 480 ? 'compact' : effectiveWidth <= 720 ? 'narrow' : effectiveWidth <= 1024 ? 'tablet' : 'wide',
  }
}

function itemCount(node = {}) {
  return (
    node.steps?.length ||
    node.sides?.length ||
    node.events?.length ||
    node.items?.length ||
    node.questions?.length ||
    node.variants?.length ||
    node.plans?.length ||
    node.figures?.length ||
    node.rows?.length ||
    node.regions?.length ||
    node.children?.length ||
    1
  )
}

const sourceText = (semantic) =>
  JSON.stringify(semantic?.nodes || [])
    .replace(/[[\]{}",:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function semanticStringLengths(value, keys, lengths = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => semanticStringLengths(entry, keys, lengths))
    return lengths
  }
  if (!value || typeof value !== 'object') return lengths
  for (const [key, entry] of Object.entries(value)) {
    if (keys.has(key) && typeof entry === 'string') lengths.push(entry.length)
    else semanticStringLengths(entry, keys, lengths)
  }
  return lengths
}

function contentBudgetDiagnostics(rendered, pattern, context, renderLimit) {
  const diagnostics = []
  const nodes = rendered.semantic?.nodes || []
  const primary = nodes.find((node) => node.id === rendered.narrative?.primary_node) || nodes[0] || {}
  const budget = pattern.content_budget
  const count = itemCount(primary)
  const text = sourceText(rendered.semantic)
  const density = rendered.composition?.density || rendered.meta?.composition?.density || 'balanced'
  const densityLimit = { compact: 14000, balanced: 9000, spacious: 5000 }[density] || 9000
  const wordCounts =
    [
      primary.steps,
      primary.events,
      primary.items,
      primary.questions,
      primary.variants,
      primary.plans,
      primary.figures,
      primary.rows,
      primary.regions,
    ]
      .find(Array.isArray)
      ?.map(
        (entry) =>
          JSON.stringify(entry)
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean).length,
      ) || []
  const codeLines = (primary.variants || []).reduce(
    (sum, variant) => sum + String(variant.code || '').split(/\r?\n/).length,
    0,
  )
  const tableRows = primary.type === 'data-table' ? primary.rows?.length || 0 : 0
  const media = primary.type === 'gallery' ? primary.figures?.length || 0 : 0
  const columns = primary.type === 'data-table' ? primary.headers?.length || 0 : 0
  const labelCharacters = Math.max(
    0,
    ...semanticStringLengths(primary, new Set(['label', 'name', 'caption', 'category'])),
  )
  const bodyCharacters = Math.max(
    0,
    ...semanticStringLengths(primary, new Set(['text', 'description', 'answer', 'body', 'alt'])),
  )
  const chart = primary.type === 'chart' ? primary : nodes.find((node) => node.type === 'chart')
  const series = Math.max(0, (chart?.headers?.length || 1) - 1)
  const categories = chart?.rows?.length || 0
  const checks = [
    ['items', count, budget.max_items],
    ['text_characters', text.length, budget.max_text_characters],
    ['words_per_item', Math.max(0, ...wordCounts), budget.max_words_per_item],
    ['code_lines', codeLines, budget.max_code_lines],
    ['table_rows', tableRows, budget.max_table_rows],
    ['media', media, budget.max_media],
    ['columns', columns, budget.max_columns],
    ['title_characters', String(rendered.semantic?.title || '').length, budget.max_title_characters],
    ['summary_characters', String(rendered.semantic?.summary || '').length, budget.max_summary_characters],
    ['label_characters', labelCharacters, budget.max_label_characters],
    ['body_characters', bodyCharacters, budget.max_body_characters],
    ['series', series, budget.max_series],
    ['categories', categories, budget.max_categories],
  ]
  for (const [dimension, actual, maximum] of checks) {
    if (actual > maximum) {
      diagnostics.push({
        code: 'content.budget-exceeded',
        severity: 'error',
        pattern: pattern.id,
        dimension,
        actual,
        maximum,
      })
    }
  }
  if (text.length > densityLimit) {
    diagnostics.push({
      code: 'content.density-exceeded',
      severity: 'warning',
      pattern: pattern.id,
      density,
      actual: text.length,
      maximum: densityLimit,
    })
  }
  if (count > renderLimit) {
    diagnostics.push({
      code: 'items.omitted',
      severity: 'warning',
      pattern: pattern.id,
      authored: count,
      rendered: renderLimit,
      omitted: count - renderLimit,
    })
  }
  if (
    ['compact', 'narrow'].includes(context.breakpoint) &&
    (text.length > 280 || wordCounts.some((count) => count > 24))
  ) {
    diagnostics.push({
      code: 'text.reflow',
      severity: 'info',
      pattern: pattern.id,
      breakpoint: context.breakpoint,
      strategy: 'stack-and-wrap',
    })
  }
  return diagnostics
}

export function buildCompositionLayoutTree({
  rendered,
  pattern,
  width,
  height,
  margin,
  headerHeight,
  frame,
  footerHeight,
  viewport,
  container,
  renderLimit = 24,
}) {
  const context = responsiveContext(viewport || { width, height }, container)
  const body = finiteBox(frame, 'body')
  const slots = pattern.slots.map((slot) => ({
    ...slot,
    node_ids: (rendered.semantic?.nodes || [])
      .filter((node) => slot.accepts.includes(node.type))
      .map((node) => node.id),
  }))
  const tree = {
    schema_version: '1',
    type: 'layout-root',
    pattern: pattern.id,
    primitive: pattern.layout.primitive,
    canvas: { width, height },
    responsive: context,
    box: { x: 0, y: 0, width, height },
    slots,
    children: [
      {
        id: 'header',
        type: 'layout-region',
        role: 'banner',
        box: finiteBox(
          headerHeight <= margin
            ? { x: margin, y: 0, width: width - margin * 2, height: 1 }
            : { x: margin, y: margin, width: width - margin * 2, height: headerHeight - margin },
          'header',
        ),
        node_ids: [],
      },
      {
        id: 'content',
        type: 'layout-region',
        role: 'main',
        box: body,
        node_ids: (rendered.semantic?.nodes || []).map((node) => node.id),
        children: resolvedPrimitives(rendered, pattern, body, context),
      },
      {
        id: 'footer',
        type: 'layout-region',
        role: 'contentinfo',
        box: finiteBox(
          {
            x: margin,
            y: height - margin - footerHeight,
            width: width - margin * 2,
            height: footerHeight,
          },
          'footer',
        ),
        node_ids: [],
      },
    ],
  }
  return {
    tree,
    diagnostics: contentBudgetDiagnostics(rendered, pattern, context, renderLimit),
  }
}
