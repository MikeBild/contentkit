import { readFileSync } from 'node:fs'
import { getPattern, patternRegistryHash } from './composition-registry.mjs'
import { buildCompositionLayoutTree } from './composition-layout.mjs'
import { createCompositionRenderTree, publicRenderTree, serializeCompositionRenderTree } from './render-tree.mjs'
import { renderInformationPattern } from './composition-information-svg.mjs'
import { contentkitFontFaceCss, contentkitFontFamilyCompact, contentkitFontFile } from './typography.mjs'
import { escapeXml } from './utils.mjs'

export const compositionFont = readFileSync(contentkitFontFile)
const fontData = compositionFont.toString('base64')
const embeddedFontCss = contentkitFontFaceCss(`data:font/woff2;base64,${fontData}`)

const canvases = {
  portrait: { width: 1080, height: 1350 },
  landscape: { width: 1600, height: 900 },
  square: { width: 1080, height: 1080 },
  flow: { width: 1200, height: 1500 },
}

const defaults = {
  light: {
    background: '#ffffff',
    surface: '#ffffff',
    foreground: '#18181b',
    muted: '#f4f4f5',
    muted_foreground: '#52525b',
    border: '#d4d4d8',
    primary: '#18181b',
    primary_foreground: '#fafafa',
    chart_1: '#2563eb',
    chart_2: '#0f766e',
    chart_3: '#b45309',
    chart_4: '#7c3aed',
    chart_5: '#be123c',
  },
  dark: {
    background: '#09090b',
    surface: '#111113',
    foreground: '#fafafa',
    muted: '#27272a',
    muted_foreground: '#a1a1aa',
    border: '#3f3f46',
    primary: '#fafafa',
    primary_foreground: '#18181b',
    chart_1: '#60a5fa',
    chart_2: '#5eead4',
    chart_3: '#fbbf24',
    chart_4: '#c4b5fd',
    chart_5: '#fda4af',
  },
}

function color(value, fallback) {
  const raw = String(value || '').trim()
  if (/^-?[\d.]+\s+-?[\d.]+%\s+-?[\d.]+%$/.test(raw)) return `hsl(${raw})`
  if (/^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([^<>]+\)|[a-z]+)$/i.test(raw)) return raw
  return fallback
}

export function compositionTheme(settings = {}, scheme = 'light') {
  const authored = settings.theme?.tokens || {}
  const base = defaults[scheme]
  const theme = Object.fromEntries(
    Object.entries(base).map(([key, fallback]) => {
      const entry = authored[key]
      const value = entry && typeof entry === 'object' ? entry[scheme] : entry
      return [key, color(value, fallback)]
    }),
  )
  theme.surface = color(
    authored.card && typeof authored.card === 'object' ? authored.card[scheme] : authored.card,
    theme.surface,
  )
  theme.subtle = scheme === 'dark' ? '#18181b' : '#fafafa'
  theme.elevated = scheme === 'dark' ? '#1c1c1f' : '#ffffff'
  theme.accent_soft = scheme === 'dark' ? '#172554' : '#eff6ff'
  theme.success_soft = scheme === 'dark' ? '#052e2b' : '#f0fdfa'
  theme.warning_soft = scheme === 'dark' ? '#451a03' : '#fffbeb'
  theme.shadow = scheme === 'dark' ? '#000000' : '#18181b'
  return theme
}

const clean = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

function nodeText(node) {
  if (node.type === 'metric') return `${node.label}: ${node.value}${node.trend ? `, ${node.trend}` : ''}`
  if (node.type === 'progress') return `${node.label}: ${node.value} von ${node.max}`
  if (node.type === 'chart') return `${node.title}. ${node.description}`
  if (node.type === 'faq')
    return `${node.title}. ${node.questions.map((item) => `${item.title}: ${item.answer}`).join('. ')}`
  if (node.type === 'code-example') {
    return `${node.title}. ${node.variants.map((item) => `${item.label}, ${item.language}: ${item.code}`).join('. ')}`
  }
  if (node.type === 'pricing') {
    return `${node.title}. ${node.plans.map((item) => `${item.name}: ${node.currency} ${item.price}. ${item.features.map((feature) => feature.label).join(', ')}`).join('. ')}`
  }
  if (node.type === 'gallery') {
    return `${node.title}. ${node.figures.map((item) => item.caption || item.alt).join('. ')}`
  }
  if (node.type === 'data-table') {
    return `${node.title}. ${node.headers.join(', ')}. ${node.rows.map((row) => row.join(', ')).join('. ')}`
  }
  if (node.type === 'application-shell') {
    return `${node.title}. ${node.regions.map((item) => `${item.label}: ${item.text}`).join('. ')}`
  }
  const items =
    [
      node.steps,
      node.events,
      node.items,
      node.sides,
      node.questions,
      node.variants,
      node.plans,
      node.figures,
      node.rows,
      node.regions,
    ].find(Array.isArray) || []
  return clean(
    [
      node.title,
      node.text,
      items
        .map((item) =>
          clean(`${item.label || ''}${item.points ? `: ${item.points.map((point) => point.label).join(', ')}` : ''}`),
        )
        .join('. '),
    ]
      .filter(Boolean)
      .join('. '),
  )
}

export function accessibleCompositionText(rendered) {
  if (!rendered.semantic) return ''
  return clean(
    [rendered.semantic.title, rendered.semantic.summary, ...rendered.semantic.nodes.map(nodeText)]
      .filter(Boolean)
      .join('. '),
  )
}

function glyphWidth(character) {
  if (/\s/.test(character)) return 0.28
  if (/[ilI1|.,:;'`]/.test(character)) return 0.27
  if (/[mwMW@%&]/.test(character)) return 0.86
  if (/[A-ZÄÖÜ0-9]/.test(character)) return 0.63
  return 0.52
}

function textWidth(value, size) {
  return [...clean(value)].reduce((sum, character) => sum + glyphWidth(character) * size, 0) * 1.12
}

function ellipsis(value, maxWidth, size, force = false) {
  let result = clean(value)
  if (!force && textWidth(result, size) <= maxWidth) return result
  while (result && textWidth(result, size) > maxWidth) result = result.slice(0, -1).trimEnd()
  return result
}

function wrap(value, maxWidth, size, maxLines = 3) {
  const words = clean(value).split(' ').filter(Boolean)
  if (!words.length) return []
  const lines = []
  let line = ''
  for (const rawWord of words) {
    const word = textWidth(rawWord, size) > maxWidth ? ellipsis(rawWord, maxWidth, size) : rawWord
    const candidate = line ? `${line} ${word}` : word
    if (line && textWidth(candidate, size) > maxWidth) {
      lines.push(line)
      line = word
      if (lines.length === maxLines) break
    } else line = candidate
  }
  if (lines.length < maxLines && line) lines.push(line)
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    lines[maxLines - 1] = ellipsis(lines[maxLines - 1], maxWidth, size, true)
  }
  return lines
}

let activeTypographyWidth = 1080

function responsiveFontSize(value, viewportWidth = activeTypographyWidth) {
  const size = Number(value)
  if (!Number.isFinite(size) || size >= 32) return size
  const minimum = viewportWidth <= 480 ? 14 : viewportWidth <= 800 ? 14 : viewportWidth <= 1100 ? 15 : 16
  const step = viewportWidth <= 480 ? 0.82 : viewportWidth <= 800 ? 0.88 : viewportWidth <= 1100 ? 0.92 : 0.96
  return Math.max(size, Math.round(minimum + Math.max(0, size - 12) * step))
}

function withResponsiveTypography(width, render) {
  const previous = activeTypographyWidth
  activeTypographyWidth = width
  try {
    return render()
  } finally {
    activeTypographyWidth = previous
  }
}

function resolveRawTypography(svg, width) {
  return svg.replace(/<text\b([^>]*)>/g, (tag, attributes) => {
    if (attributes.includes('data-ck-font-size="resolved"')) {
      return tag.replace(' data-ck-font-size="resolved"', '')
    }
    return tag.replace(/font-size="([\d.]+)"/, (_match, size) => `font-size="${responsiveFontSize(size, width)}"`)
  })
}

function text(value, x, y, options = {}) {
  const {
    size: requestedSize = 24,
    weight = 500,
    fill,
    width = 400,
    lines = 3,
    anchor = 'start',
    lineHeight = 1.18,
    tracking,
    transform,
    className,
  } = options
  const size = responsiveFontSize(requestedSize)
  const resolvedTracking =
    tracking ??
    (size >= 38 && weight >= 650
      ? Number((-size * 0.045).toFixed(2))
      : size >= 23 && weight >= 650
        ? Number((-size * 0.026).toFixed(2))
        : size >= 16 && weight >= 650
          ? Number((-size * 0.012).toFixed(2))
          : null)
  const rows = wrap(value, width, size, lines)
  const attrs = [
    `x="${x}"`,
    `y="${y}"`,
    `font-size="${size}"`,
    `font-weight="${weight}"`,
    `fill="${escapeXml(fill)}"`,
    `text-anchor="${anchor}"`,
    resolvedTracking == null ? '' : `letter-spacing="${resolvedTracking}"`,
    transform ? `transform="${transform}"` : '',
    className ? `class="${className}"` : '',
    'data-ck-font-size="resolved"',
  ]
    .filter(Boolean)
    .join(' ')
  return {
    rows,
    height: rows.length * size * lineHeight,
    svg: `<text ${attrs}>${rows
      .map((row, index) => `<tspan x="${x}" dy="${index ? size * lineHeight : 0}">${escapeXml(row)}</tspan>`)
      .join('')}</text>`,
  }
}

const rect = (x, y, width, height, options = {}) =>
  `<rect x="${x}" y="${y}" width="${Math.max(0, width)}" height="${Math.max(0, height)}" rx="${options.radius ?? 16}" fill="${options.fill ?? 'none'}"${options.opacity == null ? '' : ` fill-opacity="${options.opacity}"`} stroke="${options.stroke ?? 'none'}" stroke-width="${options.strokeWidth ?? 1}"${options.dash ? ` stroke-dasharray="${options.dash}"` : ''}${options.filter ? ` filter="${options.filter}"` : ''}${options.className ? ` class="${options.className}"` : ''}/>`

const line = (x1, y1, x2, y2, options = {}) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${options.stroke}" stroke-width="${options.width ?? 2}"${options.dash ? ` stroke-dasharray="${options.dash}"` : ''}${options.marker ? ' marker-end="url(#arrow)"' : ''}/>`

const circle = (cx, cy, radius, options = {}) =>
  `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${options.fill ?? 'none'}" stroke="${options.stroke ?? 'none'}" stroke-width="${options.strokeWidth ?? 1}"/>`

function card(item, box, theme, options = {}) {
  const { index, accent = false, quiet = false, metric = false } = options
  const padding = Math.max(18, Math.min(30, box.width * 0.08))
  const title = metric ? item.title || item.value : item.title
  const body = metric ? item.body || item.label : item.body
  const shortMetric = metric && box.height < 145
  const titleSize = metric
    ? Math.min(54, Math.max(24, Math.min(box.width / 5.8, box.height * 0.28)))
    : Math.min(27, Math.max(16, Math.min(box.width / 12, box.height * 0.22)))
  const titleY = metric
    ? shortMetric
      ? box.y + box.height - 20
      : box.y + Math.max(94, box.height * 0.45)
    : box.y + padding + titleSize + 34
  const detail = shortMetric
    ? [body, item.trend || item.period].filter(Boolean).join(' · ')
    : item.trend || item.period || (index == null ? '' : String(index + 1).padStart(2, '0'))
  const accentColor = theme[`chart_${((index || 0) % 5) + 1}`]
  return `<g>${rect(box.x, box.y + 2, box.width, box.height - 2, {
    radius: 12,
    fill: quiet ? theme.background : theme.surface,
    stroke: accent ? theme.primary : theme.border,
    strokeWidth: accent ? 1.5 : 1,
    filter: 'url(#ck-card-shadow)',
  })}${rect(box.x + 1, box.y + 3, box.width - 2, 3, { fill: accent ? accentColor : theme.muted, radius: 2 })}${circle(box.x + padding + 9, box.y + 34, 9, { fill: accent ? theme.accent_soft : theme.muted, stroke: accent ? accentColor : theme.border })}<circle cx="${box.x + padding + 9}" cy="${box.y + 34}" r="3" fill="${accentColor}"/>${detail ? text(detail, box.x + padding + 28, box.y + 39, { size: 10, weight: 720, fill: theme.muted_foreground, width: box.width - padding * 2 - 28, lines: 1, tracking: 0.7 }).svg : ''}${
    text(title, box.x + padding, titleY + (index == null ? 0 : 18), {
      size: titleSize,
      weight: metric ? 780 : 700,
      fill: theme.foreground,
      width: box.width - padding * 2,
      lines: metric ? 2 : 2,
    }).svg
  }${
    body && !shortMetric
      ? text(body, box.x + padding, titleY + titleSize * 1.25 + (index == null ? 0 : 18), {
          size: Math.min(17, Math.max(12, Math.min(box.width / 19, box.height * 0.15))),
          weight: 450,
          fill: theme.muted_foreground,
          width: box.width - padding * 2,
          lines: box.height < 160 ? 1 : 3,
          lineHeight: 1.28,
        }).svg
      : ''
  }</g>`
}

function visualItems(rendered) {
  const nodes = rendered.semantic.nodes
  const primary = nodes.find((node) => node.id === rendered.narrative?.primary_node) || nodes[0]
  if (primary?.type === 'faq') {
    return primary.questions.map((item) => ({
      title: item.title,
      body: item.answer,
      category: item.category,
      type: 'question',
      source: item,
    }))
  }
  if (primary?.type === 'code-example') {
    return primary.variants.map((item) => ({
      title: item.label,
      body: item.file || item.language,
      type: 'variant',
      code: item.code,
      language: item.language,
      file: item.file,
      active: item.default,
      source: item,
    }))
  }
  if (primary?.type === 'pricing') {
    return primary.plans.map((item) => ({
      title: item.name,
      body: item.description,
      type: 'plan',
      value: item.price,
      currency: primary.currency,
      cadence: item.cadence,
      recommended: item.recommended,
      points: item.features,
      source: item,
    }))
  }
  if (primary?.type === 'gallery') {
    return primary.figures.map((item) => ({
      title: item.caption || item.alt || 'Decorative media',
      body: item.alt,
      type: 'figure',
      aspect: item.aspect,
      src: item.src,
      source: item,
    }))
  }
  if (primary?.type === 'data-table') {
    const keyIndex = primary.headers.indexOf(primary.row_key)
    return primary.rows.map((row) => ({
      title: row[keyIndex],
      body: primary.headers
        .map((header, index) => (index === keyIndex ? '' : `${header}: ${row[index]}`))
        .filter(Boolean)
        .join(' · '),
      type: 'record',
      fields: primary.headers.map((header, index) => ({ label: header, value: row[index] })),
      source: row,
    }))
  }
  if (primary?.type === 'application-shell') {
    return primary.regions.map((item) => ({
      title: item.label,
      body: item.text,
      type: 'region',
      region: item.name,
      source: item,
    }))
  }
  const nested = [primary?.steps, primary?.events, primary?.items].find(Array.isArray)
  if (nested?.length > 1) {
    return nested.map((item) => {
      const parts = clean(item.label).split(/\s+·\s+/)
      const separatesLabel = ['process', 'relationship', 'hierarchy'].includes(primary.type) && parts.length > 1
      return {
        title: separatesLabel ? parts[0] : item.label,
        body: item.description || (separatesLabel ? parts.slice(1).join(' · ') : ''),
        source: item,
      }
    })
  }
  if (primary?.sides?.length > 1) {
    return primary.sides.map((side) => ({
      title: side.label,
      body: side.points.map((point) => point.label).join(' · '),
      points: side.points,
      source: side,
    }))
  }
  const meaningful = nodes.length > 1 ? nodes.filter((node) => node.type !== 'group') : nodes
  return meaningful.map((node) => ({
    title: node.type === 'metric' ? node.value : node.title || node.label || node.type,
    body:
      node.type === 'metric'
        ? [node.label, node.period, node.trend, node.target ? `Target ${node.target}` : '', node.status]
            .filter(Boolean)
            .join(' · ')
        : node.type === 'progress'
          ? `${node.value} von ${node.max}`
          : node.type === 'hero'
            ? clean(node.text) || rendered.meta.summary
            : node.type === 'card'
              ? clean(node.text)
              : nodeText(node),
    type: node.type,
    value: node.value,
    label: node.label,
    trend: node.trend,
    period: node.period,
    target: node.target,
    previous: node.previous,
    unit: node.unit,
    status: node.status,
    points: node.points,
    source: node,
  }))
}

function grid(items, frame, theme, columns, options = {}) {
  const gap = options.gap ?? 18
  const rows = Math.max(1, Math.ceil(items.length / columns))
  const width = (frame.width - gap * (columns - 1)) / columns
  const height = (frame.height - gap * (rows - 1)) / rows
  return items
    .map((item, index) =>
      card(
        item,
        {
          x: frame.x + (index % columns) * (width + gap),
          y: frame.y + Math.floor(index / columns) * (height + gap),
          width,
          height,
        },
        theme,
        {
          index: options.numbered ? index : null,
          metric: item.type === 'metric',
          accent: index === 0 && options.accent,
        },
      ),
    )
    .join('')
}

function editorialPoster(items, frame, theme, rendered) {
  const statement = items[0]?.title || rendered.meta.title
  const lead = items[0]?.body || rendered.meta.summary
  const statementSize = Math.min(82, Math.max(48, frame.width / 14))
  const statementBlock = text(statement, frame.x, frame.y + statementSize, {
    size: statementSize,
    weight: 780,
    fill: theme.foreground,
    width: frame.width * 0.72,
    lines: 3,
    lineHeight: 1.02,
  })
  const lowerY = frame.y + Math.max(statementBlock.height + 60, frame.height * 0.48)
  const supporting = items.slice(1, 4)
  return `${statementBlock.svg}${
    text(lead, frame.x + frame.width * 0.77, frame.y + 28, {
      size: 19,
      weight: 500,
      fill: theme.muted_foreground,
      width: frame.width * 0.23,
      lines: 6,
      lineHeight: 1.35,
    }).svg
  }${line(frame.x, lowerY - 30, frame.x + frame.width, lowerY - 30, { stroke: theme.foreground, width: 2 })}${supporting
    .map((item, index) => {
      const width = frame.width / Math.max(1, supporting.length)
      return `<g>${
        text(String(index + 1).padStart(2, '0'), frame.x + index * width, lowerY, {
          size: 14,
          weight: 750,
          fill: theme.chart_1,
          width: 40,
        }).svg
      }${
        text(item.title, frame.x + index * width, lowerY + 42, {
          size: 25,
          weight: 680,
          fill: theme.foreground,
          width: width - 30,
          lines: 2,
        }).svg
      }${
        text(item.body, frame.x + index * width, lowerY + 112, {
          size: 16,
          weight: 450,
          fill: theme.muted_foreground,
          width: width - 30,
          lines: 4,
          lineHeight: 1.3,
        }).svg
      }</g>`
    })
    .join('')}`
}

function stratified(items, frame, theme) {
  const count = Math.max(items.length, 1)
  const gap = 14
  const height = (frame.height - gap * (count - 1)) / count
  return items
    .map((item, index) => {
      const y = frame.y + index * (height + gap)
      const inset = index * Math.min(28, frame.width * 0.035)
      const mobile = frame.width < 500
      const fill = index === 0 ? theme.foreground : index % 2 ? theme.surface : theme.muted
      const foreground = index === 0 ? theme.primary_foreground : theme.foreground
      const secondary = index === 0 ? theme.border : theme.muted_foreground
      if (mobile) {
        const roomForTwoTitleLines = height >= 90
        return `<g>${rect(frame.x + inset, y, frame.width - inset, height, {
          fill,
          stroke: index === 0 ? theme.foreground : theme.border,
          radius: 12,
        })}<text x="${frame.x + inset + 18}" y="${y + 25}" font-size="11" font-weight="750" fill="${secondary}" letter-spacing="1.2">${String(index + 1).padStart(2, '0')}</text>${
          text(item.title, frame.x + inset + 62, y + 27, {
            size: Math.min(17, height * 0.18),
            weight: 700,
            fill: foreground,
            width: frame.width - inset - 78,
            lines: roomForTwoTitleLines ? 2 : 1,
          }).svg
        }${
          item.body && height >= 105
            ? text(item.body, frame.x + inset + 18, y + (roomForTwoTitleLines ? 72 : 56), {
                size: 12,
                weight: 450,
                fill: secondary,
                width: frame.width - inset - 36,
                lines: 2,
                lineHeight: 1.2,
              }).svg
            : ''
        }</g>`
      }
      return `<g>${rect(frame.x + inset, y, frame.width - inset, height, {
        fill,
        stroke: index === 0 ? theme.foreground : theme.border,
        radius: 12,
      })}<text x="${frame.x + inset + 24}" y="${y + 31}" font-size="13" font-weight="750" fill="${index === 0 ? theme.primary_foreground : theme.muted_foreground}" letter-spacing="1.3">${String(index + 1).padStart(2, '0')}</text>${
        text(item.title, frame.x + inset + 82, y + height * 0.48, {
          size: Math.min(30, height * 0.25),
          weight: 700,
          fill: foreground,
          width: frame.width * 0.38,
          lines: 2,
        }).svg
      }${
        text(item.body, frame.x + frame.width * 0.55, y + height * 0.42, {
          size: Math.min(17, height * 0.16),
          weight: 450,
          fill: secondary,
          width: frame.width * 0.38 - inset,
          lines: 3,
        }).svg
      }</g>`
    })
    .join('')
}

function bento(items, frame, theme) {
  const source = items.length >= 4 ? items.slice(0, 5) : [...items, ...items, ...items].slice(0, 5)
  const gap = 18
  const unitW = (frame.width - gap * 2) / 3
  const unitH = (frame.height - gap) / 2
  const boxes = [
    { x: frame.x, y: frame.y, width: unitW * 2 + gap, height: unitH },
    { x: frame.x + (unitW + gap) * 2, y: frame.y, width: unitW, height: unitH },
    { x: frame.x, y: frame.y + unitH + gap, width: unitW, height: unitH },
    { x: frame.x + unitW + gap, y: frame.y + unitH + gap, width: unitW, height: unitH },
    { x: frame.x + (unitW + gap) * 2, y: frame.y + unitH + gap, width: unitW, height: unitH },
  ]
  return source
    .map((item, index) => card(item, boxes[index], theme, { metric: item.type === 'metric', accent: index === 0 }))
    .join('')
}

function dashboard(items, frame, theme, table = false) {
  if (!table) {
    const headingH = 58
    if (frame.width < 500) {
      const gap = 10
      const contentY = frame.y + headingH + 14
      const rowH = (frame.height - headingH - 28 - gap * Math.max(0, items.length - 1)) / Math.max(1, items.length)
      return `<g>${rect(frame.x, frame.y, frame.width, frame.height, { fill: theme.surface, stroke: theme.border, radius: 18 })}${text('OVERVIEW', frame.x + 20, frame.y + 35, { size: 14, weight: 750, fill: theme.muted_foreground, width: 180, tracking: 1.2 }).svg}${line(frame.x, frame.y + headingH, frame.x + frame.width, frame.y + headingH, { stroke: theme.border, width: 1 })}${items
        .map((item, index) => {
          const y = contentY + index * (rowH + gap)
          const labelW = Math.min(132, frame.width * 0.4)
          return `<g>${rect(frame.x + 14, y, frame.width - 28, rowH, { fill: theme.background, stroke: theme.border, radius: 12 })}${text(item.title, frame.x + 30, y + 30, { size: 12, weight: 720, fill: theme.foreground, width: labelW - 16, lines: 2 }).svg}${text(item.body, frame.x + 30 + labelW, y + 30, { size: 12, weight: 480, fill: theme.muted_foreground, width: frame.width - labelW - 76, lines: 4, lineHeight: 1.2 }).svg}</g>`
        })
        .join('')}</g>`
    }
    return `<g>${rect(frame.x, frame.y, frame.width, frame.height, { fill: theme.surface, stroke: theme.border, radius: 18 })}${text('OVERVIEW', frame.x + 26, frame.y + 35, { size: 14, weight: 750, fill: theme.muted_foreground, width: 200, tracking: 1.2 }).svg}${line(frame.x, frame.y + headingH, frame.x + frame.width, frame.y + headingH, { stroke: theme.border, width: 1 })}${grid(items, { x: frame.x + 20, y: frame.y + headingH + 20, width: frame.width - 40, height: frame.height - headingH - 40 }, theme, Math.min(3, Math.max(1, Math.ceil(Math.sqrt(items.length)))), { gap: 14 })}</g>`
  }
  const columns = Math.min(4, Math.max(2, items.length))
  const colW = frame.width / columns
  const rowH = frame.height / 3
  return `<g>${rect(frame.x, frame.y, frame.width, frame.height, { fill: theme.surface, stroke: theme.border, radius: 14 })}${Array.from(
    { length: columns },
    (_, index) => {
      const item = items[index % items.length]
      const x = frame.x + index * colW
      const bars = [0.42, 0.68, 0.54]
        .map((factor, barIndex) =>
          rect(x + 24, frame.y + rowH * (barIndex + 1) + 22, (colW - 48) * factor, 8, {
            fill: barIndex === 1 ? theme.chart_1 : theme.border,
            radius: 4,
          }),
        )
        .join('')
      return `<g>${index ? line(x, frame.y, x, frame.y + frame.height, { stroke: theme.border, width: 1 }) : ''}${text(item.title, x + 24, frame.y + 44, { size: 18, weight: 680, fill: theme.foreground, width: colW - 48, lines: 2 }).svg}${text(item.body, x + 24, frame.y + 96, { size: 14, weight: 450, fill: theme.muted_foreground, width: colW - 48, lines: 3 }).svg}${bars}</g>`
    },
  ).join(
    '',
  )}${line(frame.x, frame.y + rowH, frame.x + frame.width, frame.y + rowH, { stroke: theme.border, width: 1 })}${line(frame.x, frame.y + rowH * 2, frame.x + frame.width, frame.y + rowH * 2, { stroke: theme.border, width: 1 })}</g>`
}

function heroBanner(items, frame, theme, rendered) {
  const item = items[0] || { title: rendered.meta.title, body: rendered.meta.summary }
  const titleWidth = frame.width - 84
  const baseTitleSize = Math.min(106, Math.max(44, frame.width / 10.5))
  const longestWord = clean(item.title)
    .split(/\s+/)
    .reduce(
      (longest, word) => (textWidth(word, baseTitleSize) > textWidth(longest, baseTitleSize) ? word : longest),
      '',
    )
  const titleSize = Math.max(
    38,
    Math.min(baseTitleSize, (baseTitleSize * titleWidth * 0.92) / Math.max(1, textWidth(longestWord, baseTitleSize))),
  )
  const motifX = frame.x + frame.width * 0.76
  const motifY = frame.y + frame.height * 0.24
  const motifScale = Math.min(frame.width, frame.height)
  return `<g>${rect(frame.x, frame.y, frame.width, frame.height, { fill: theme.foreground, stroke: theme.foreground, radius: 20 })}<circle cx="${motifX}" cy="${motifY}" r="${motifScale * 0.22}" fill="none" stroke="${theme.chart_1}" stroke-width="2"/><circle cx="${motifX}" cy="${motifY}" r="${motifScale * 0.14}" fill="none" stroke="${theme.border}" stroke-width="1"/>${text(item.title, frame.x + 42, frame.y + titleSize + 34, { size: titleSize, weight: 800, fill: theme.primary_foreground, width: titleWidth, lines: 3, lineHeight: 0.98 }).svg}${text(item.body, frame.x + 42, frame.y + frame.height - 74, { size: 17, weight: 500, fill: theme.border, width: frame.width - 84, lines: 3 }).svg}</g>`
}

function metricCard(items, frame, theme) {
  const item = items.find((entry) => entry.type === 'metric') || items[0]
  const value = item?.title || '—'
  return `<g>${rect(frame.x, frame.y, frame.width, frame.height, { fill: theme.surface, stroke: theme.border, radius: 20 })}${text(item?.body || item?.label, frame.x + 40, frame.y + 48, { size: 16, weight: 700, fill: theme.muted_foreground, width: frame.width - 80, tracking: 1.1 }).svg}${text(value, frame.x + 40, frame.y + frame.height * 0.48, { size: Math.min(128, frame.width / 5), weight: 790, fill: theme.foreground, width: frame.width - 80, lines: 2, lineHeight: 0.95 }).svg}${line(frame.x + 40, frame.y + frame.height - 86, frame.x + frame.width - 40, frame.y + frame.height - 86, { stroke: theme.border, width: 1 })}${text(item?.trend || 'Current status', frame.x + 40, frame.y + frame.height - 45, { size: 17, weight: 620, fill: theme.chart_2, width: frame.width - 80 }).svg}</g>`
}

function scorecard(items, frame, theme) {
  const rows = items.filter((item) => item.type !== 'group').slice(0, 7)
  const rowH = frame.height / Math.max(rows.length, 1)
  return `<g>${rect(frame.x, frame.y, frame.width, frame.height, { fill: theme.surface, stroke: theme.border, radius: 16 })}${rows
    .map((item, index) => {
      const y = frame.y + index * rowH
      const value =
        item.type === 'progress' ? Number(item.value) / Number(item.source.max || 100) : 0.68 + (index % 3) * 0.1
      return `<g>${index ? line(frame.x, y, frame.x + frame.width, y, { stroke: theme.border, width: 1 }) : ''}${circle(frame.x + 28, y + rowH / 2, 6, { fill: index === rows.length - 1 ? theme.chart_3 : theme.chart_2 })}${text(item.body || item.title, frame.x + 50, y + rowH / 2 + 6, { size: Math.min(18, rowH * 0.28), weight: 620, fill: theme.foreground, width: frame.width * 0.42, lines: 1 }).svg}${rect(frame.x + frame.width * 0.55, y + rowH / 2 - 5, frame.width * 0.34, 10, { fill: theme.muted, radius: 5 })}${rect(frame.x + frame.width * 0.55, y + rowH / 2 - 5, frame.width * 0.34 * Math.min(1, value), 10, { fill: theme.chart_1, radius: 5 })}<text x="${frame.x + frame.width - 28}" y="${y + rowH / 2 + 6}" text-anchor="end" font-size="14" font-weight="700" fill="${theme.muted_foreground}">${Math.round(value * 100)}%</text></g>`
    })
    .join('')}</g>`
}

function connected(items, frame, theme, vertical = false) {
  const count = Math.max(items.length, 1)
  if (vertical) {
    const step = frame.height / count
    const axisX = frame.x + 34
    return `<g>${line(axisX, frame.y + 18, axisX, frame.y + frame.height - 18, { stroke: theme.border, width: 3 })}${items
      .map((item, index) => {
        const rowY = frame.y + step * index
        const y = rowY + step / 2
        const titleSize = Math.min(27, step * 0.28)
        const titleBaseline = rowY + step * 0.36
        const titleBlock = text(item.title, axisX + 38, titleBaseline, {
          size: titleSize,
          weight: 700,
          fill: theme.foreground,
          width: frame.width - 90,
          lines: item.body ? 2 : 3,
        })
        const bodyY = Math.min(rowY + step - 18, titleBaseline + titleBlock.height + 10)
        return `<g>${circle(axisX, y, 14, { fill: theme.background, stroke: theme.foreground, strokeWidth: 3 })}${circle(axisX, y, 4, { fill: theme.chart_1 })}${titleBlock.svg}${item.body ? text(item.body, axisX + 38, bodyY, { size: 13, weight: 450, fill: theme.muted_foreground, width: frame.width - 90, lines: 2 }).svg : ''}</g>`
      })
      .join('')}</g>`
  }
  const gap = 28
  const width = (frame.width - gap * (count - 1)) / count
  const y = frame.y + frame.height * 0.48
  return `<g>${line(frame.x + width / 2, y, frame.x + frame.width - width / 2, y, { stroke: theme.border, width: 4 })}${items
    .map((item, index) => {
      const x = frame.x + index * (width + gap)
      const center = x + width / 2
      return `<g>${index < count - 1 ? line(center + 28, y, center + width + gap - 28, y, { stroke: theme.foreground, width: 2, marker: true }) : ''}${circle(center, y, 28, { fill: index === 0 ? theme.foreground : theme.surface, stroke: theme.foreground, strokeWidth: 2 })}<text x="${center}" y="${y + 7}" text-anchor="middle" font-size="17" font-weight="750" fill="${index === 0 ? theme.primary_foreground : theme.foreground}">${index + 1}</text>${text(item.title, center, y - 66, { size: Math.min(24, width / 8), weight: 700, fill: theme.foreground, width: width, lines: 2, anchor: 'middle' }).svg}${text(item.body, center, y + 78, { size: 14, weight: 450, fill: theme.muted_foreground, width: width, lines: 3, anchor: 'middle' }).svg}</g>`
    })
    .join('')}</g>`
}

function cycle(items, frame, theme) {
  const count = Math.max(items.length, 1)
  const cx = frame.x + frame.width / 2
  const cy = frame.y + frame.height / 2
  const radius = Math.min(frame.width, frame.height) * 0.31
  const nodeW = Math.min(170, frame.width * 0.18)
  const nodeH = 94
  return `<g>${circle(cx, cy, radius, { stroke: theme.border, strokeWidth: 3 })}${circle(cx, cy, radius * 0.38, { fill: theme.foreground })}${text('Zyklus', cx, cy + 7, { size: 11, weight: 700, fill: theme.primary_foreground, width: radius * 0.7, lines: 1, anchor: 'middle' }).svg}${items
    .map((item, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / count
      const x = cx + Math.cos(angle) * radius - nodeW / 2
      const y = cy + Math.sin(angle) * radius - nodeH / 2
      const nextAngle = -Math.PI / 2 + (((index + 0.42) % count) * Math.PI * 2) / count
      const markerX = cx + Math.cos(nextAngle) * radius
      const markerY = cy + Math.sin(nextAngle) * radius
      return `<g>${circle(markerX, markerY, 5, { fill: theme.chart_1 })}${rect(x, y, nodeW, nodeH, { fill: theme.surface, stroke: index === 0 ? theme.foreground : theme.border, strokeWidth: index === 0 ? 2 : 1, radius: 14 })}${text(item.title, x + nodeW / 2, y + 41, { size: 18, weight: 680, fill: theme.foreground, width: nodeW - 24, lines: 2, anchor: 'middle' }).svg}</g>`
    })
    .join('')}</g>`
}

function funnel(items, frame, theme) {
  const count = Math.max(items.length, 1)
  const gap = 9
  const h = (frame.height - gap * (count - 1)) / count
  return `<g>${items
    .map((item, index) => {
      const topWidth = frame.width * (1 - index * 0.12)
      const bottomWidth = frame.width * (1 - (index + 1) * 0.12)
      const y = frame.y + index * (h + gap)
      const topX = frame.x + (frame.width - topWidth) / 2
      const bottomX = frame.x + (frame.width - bottomWidth) / 2
      const fill = index === count - 1 ? theme.foreground : index % 2 ? theme.surface : theme.muted
      return `<g><path d="M ${topX} ${y} H ${topX + topWidth} L ${bottomX + bottomWidth} ${y + h} H ${bottomX} Z" fill="${fill}" stroke="${index === count - 1 ? theme.foreground : theme.border}" stroke-width="1.5"/>${text(item.title, frame.x + frame.width / 2, y + h / 2 + 7, { size: Math.min(22, h * 0.28), weight: 700, fill: index === count - 1 ? theme.primary_foreground : theme.foreground, width: bottomWidth - 40, lines: 2, anchor: 'middle' }).svg}</g>`
    })
    .join('')}</g>`
}

function split(items, frame, theme, beforeAfter = false) {
  const left = items[0] || { title: 'A', body: '' }
  const right = items[1] || { title: 'B', body: '' }
  if (frame.width < 500) {
    const gap = 52
    const height = (frame.height - gap) / 2
    const verticalPanel = (item, y, active) => {
      const points = (item.points || item.body.split(' · ').map((label) => ({ label }))).slice(0, 4)
      const contentTop = y + 86
      const step = Math.max(34, (height - 104) / Math.max(1, points.length))
      return `<g>${rect(frame.x, y, frame.width, height, { fill: active ? theme.foreground : theme.surface, stroke: active ? theme.foreground : theme.border, radius: 14 })}${text(item.title, frame.x + 22, y + 40, { size: 20, weight: 740, fill: active ? theme.primary_foreground : theme.foreground, width: frame.width - 44, lines: 2 }).svg}${points
        .map((point, index) => {
          const baseline = contentTop + index * step
          return `<g>${circle(frame.x + 28, baseline - 5, 4, { fill: active ? theme.chart_1 : theme.foreground })}${text(point.label || point, frame.x + 44, baseline, { size: 12, weight: 500, fill: active ? theme.border : theme.foreground, width: frame.width - 66, lines: step >= 42 ? 2 : 1 }).svg}</g>`
        })
        .join('')}</g>`
    }
    const arrowY = frame.y + height + gap / 2
    return `${verticalPanel(left, frame.y, false)}${line(frame.x + frame.width / 2, frame.y + height + 8, frame.x + frame.width / 2, frame.y + height + gap - 8, { stroke: theme.foreground, width: 2, marker: true })}${circle(frame.x + frame.width / 2, arrowY, 15, { fill: theme.background, stroke: theme.foreground, strokeWidth: 1 })}${verticalPanel(right, frame.y + height + gap, true)}`
  }
  const gap = beforeAfter ? 90 : 24
  const width = (frame.width - gap) / 2
  const panel = (item, x, active) =>
    `<g>${rect(x, frame.y, width, frame.height, { fill: active ? theme.foreground : theme.surface, stroke: active ? theme.foreground : theme.border, radius: 18 })}${text(item.title, x + 30, frame.y + 55, { size: 28, weight: 750, fill: active ? theme.primary_foreground : theme.foreground, width: width - 60, lines: 2 }).svg}${(
      item.points || item.body.split(' · ').map((label) => ({ label }))
    )
      .slice(0, 6)
      .map(
        (point, index) =>
          `<g>${circle(x + 36, frame.y + 126 + index * 66, 5, { fill: active ? theme.chart_1 : theme.foreground })}${text(point.label || point, x + 56, frame.y + 133 + index * 66, { size: 17, weight: 500, fill: active ? theme.border : theme.foreground, width: width - 86, lines: 2 }).svg}</g>`,
      )
      .join('')}</g>`
  const middle = beforeAfter
    ? `<g>${circle(frame.x + width + gap / 2, frame.y + frame.height / 2, 25, { fill: theme.chart_1 })}<path d="M ${frame.x + width + gap / 2 - 9} ${frame.y + frame.height / 2} H ${frame.x + width + gap / 2 + 9} M ${frame.x + width + gap / 2 + 3} ${frame.y + frame.height / 2 - 6} L ${frame.x + width + gap / 2 + 9} ${frame.y + frame.height / 2} L ${frame.x + width + gap / 2 + 3} ${frame.y + frame.height / 2 + 6}" fill="none" stroke="white" stroke-width="2"/></g>`
    : `<g>${circle(frame.x + width + gap / 2, frame.y + 48, 20, { fill: theme.background, stroke: theme.border, strokeWidth: 1 })}<text x="${frame.x + width + gap / 2}" y="${frame.y + 54}" text-anchor="middle" font-size="12" font-weight="750" fill="${theme.muted_foreground}">VS</text></g>`
  return `${panel(left, frame.x, false)}${panel(right, frame.x + width + gap, true)}${middle}`
}

function matrix(items, frame, theme) {
  const columns = Math.max(2, Math.min(3, items.length))
  const dimensions = [
    ...new Set(items.flatMap((item) => (item.points || []).map((point) => clean(point.label).split(/\s+·\s+/)[0]))),
  ].slice(0, 6)
  const rowLabels = dimensions.length ? dimensions : ['Kriterium A', 'Kriterium B', 'Kriterium C']
  if (frame.width < 500) {
    const visibleItems = items.slice(0, columns)
    const gap = 12
    const panelH = (frame.height - gap * Math.max(0, visibleItems.length - 1)) / visibleItems.length
    return `<g>${visibleItems
      .map((item, itemIndex) => {
        const y = frame.y + itemIndex * (panelH + gap)
        const active = itemIndex === visibleItems.length - 1
        const rows = rowLabels.slice(0, Math.max(1, Math.min(3, Math.floor((panelH - 44) / 25))))
        const step = Math.max(24, (panelH - 54) / Math.max(1, rows.length))
        return `<g>${rect(frame.x, y, frame.width, panelH, { fill: active ? theme.accent_soft : theme.surface, stroke: active ? theme.chart_1 : theme.border, strokeWidth: active ? 1.5 : 1, radius: 12, filter: 'url(#ck-card-shadow)' })}${text(item.title, frame.x + 18, y + 31, { size: 16, weight: 720, fill: theme.foreground, width: frame.width - 36, lines: 1 }).svg}${rows
          .map((label, rowIndex) => {
            const point = (item.points || []).find((entry) => clean(entry.label).split(/\s+·\s+/)[0] === label)
            const parts = clean(point?.label).split(/\s+·\s+/)
            const value = parts.length > 1 ? parts.slice(1).join(' · ') : point ? 'Ja' : '—'
            const rowY = y + 54 + rowIndex * step
            return `<g>${text(label, frame.x + 18, rowY, { size: 11, weight: 560, fill: theme.muted_foreground, width: frame.width * 0.46, lines: 1 }).svg}${text(value, frame.x + frame.width - 18, rowY, { size: 11, weight: 700, fill: active ? theme.chart_1 : theme.foreground, width: frame.width * 0.48, lines: 1, anchor: 'end' }).svg}</g>`
          })
          .join('')}</g>`
      })
      .join('')}</g>`
  }
  const labelW = frame.width * 0.27
  const colW = (frame.width - labelW) / columns
  const headH = 72
  const rowH = (frame.height - headH) / rowLabels.length
  return `<g>${rect(frame.x, frame.y, frame.width, frame.height, { fill: theme.surface, stroke: theme.border, radius: 14 })}${rect(frame.x, frame.y, frame.width, headH, { fill: theme.muted, radius: 14 })}${items
    .slice(0, columns)
    .map(
      (item, index) =>
        text(item.title, frame.x + labelW + colW * index + colW / 2, frame.y + 42, {
          size: 18,
          weight: 700,
          fill: theme.foreground,
          width: colW - 24,
          lines: 2,
          anchor: 'middle',
        }).svg,
    )
    .join('')}${rowLabels
    .map((label, row) => {
      const y = frame.y + headH + row * rowH
      return `<g>${line(frame.x, y, frame.x + frame.width, y, { stroke: theme.border, width: 1 })}${text(label, frame.x + 22, y + rowH / 2 + 6, { size: 15, weight: 620, fill: theme.foreground, width: labelW - 40, lines: 2 }).svg}${Array.from(
        { length: columns },
        (_, col) => {
          const point = (items[col]?.points || []).find((entry) => clean(entry.label).split(/\s+·\s+/)[0] === label)
          const parts = clean(point?.label).split(/\s+·\s+/)
          const value = parts.length > 1 ? parts.slice(1).join(' · ') : point ? 'Ja' : '—'
          return text(value, frame.x + labelW + colW * col + colW / 2, y + rowH / 2 + 6, {
            size: 14,
            weight: col === columns - 1 ? 700 : 500,
            fill: col === columns - 1 ? theme.chart_1 : theme.muted_foreground,
            width: colW - 28,
            lines: 2,
            anchor: 'middle',
          }).svg
        },
      ).join('')}</g>`
    })
    .join(
      '',
    )}${Array.from({ length: columns }, (_, index) => line(frame.x + labelW + colW * index, frame.y, frame.x + labelW + colW * index, frame.y + frame.height, { stroke: theme.border, width: 1 })).join('')}</g>`
}

function timeline(items, frame, theme, vertical = false) {
  if (vertical) return connected(items, frame, theme, true)
  const count = Math.max(items.length, 1)
  const axisY = frame.y + frame.height / 2
  const step = frame.width / Math.max(1, count - 1)
  return `<g>${line(frame.x, axisY, frame.x + frame.width, axisY, { stroke: theme.foreground, width: 2 })}${items
    .map((item, index) => {
      const x = frame.x + (count === 1 ? frame.width / 2 : index * step)
      const above = index % 2 === 0
      const anchor = index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'
      return `<g>${circle(x, axisY, 10, { fill: theme.background, stroke: theme.foreground, strokeWidth: 3 })}${circle(x, axisY, 3, { fill: theme.chart_1 })}${line(x, axisY + (above ? -12 : 12), x, axisY + (above ? -52 : 52), { stroke: theme.border, width: 1 })}${text(item.title, x, axisY + (above ? -72 : 76), { size: Math.min(20, step / 7), weight: 680, fill: theme.foreground, width: Math.max(120, step - 20), lines: 3, anchor }).svg}</g>`
    })
    .join('')}</g>`
}

function roadmap(items, frame, theme) {
  const columns = Math.min(4, Math.max(2, items.length))
  const colW = frame.width / columns
  const rowH = frame.height / Math.min(3, Math.max(1, Math.ceil(items.length / columns)))
  return `<g>${Array.from({ length: columns }, (_, index) => `<g>${index ? line(frame.x + index * colW, frame.y, frame.x + index * colW, frame.y + frame.height, { stroke: theme.border, width: 1, dash: '5 7' }) : ''}<text x="${frame.x + index * colW + 12}" y="${frame.y + 22}" font-size="12" font-weight="750" fill="${theme.muted_foreground}" letter-spacing="1">PHASE ${index + 1}</text></g>`).join('')}${items
    .map((item, index) => {
      const col = index % columns
      const row = Math.floor(index / columns)
      const x = frame.x + col * colW + 10
      const y = frame.y + 46 + row * rowH
      return `<g>${rect(x, y, colW - 20, Math.min(100, rowH - 18), { fill: index === 0 ? theme.foreground : theme.surface, stroke: index === 0 ? theme.foreground : theme.border, radius: 12 })}${text(item.title, x + 18, y + 39, { size: 17, weight: 680, fill: index === 0 ? theme.primary_foreground : theme.foreground, width: colW - 56, lines: 2 }).svg}</g>`
    })
    .join('')}</g>`
}

function tree(items, frame, theme) {
  const root = items[0] || { title: 'Root' }
  const children = items.slice(1)
  if (frame.width < 500) {
    const gap = 10
    const rootH = 86
    const branchInset = 30
    const childX = frame.x + branchInset
    const childW = frame.width - branchInset
    const childrenY = frame.y + rootH + 18
    const childH = Math.max(
      70,
      (frame.y + frame.height - childrenY - gap * Math.max(0, children.length - 1)) / Math.max(1, children.length),
    )
    const connectorX = frame.x + 12
    return `<g>${card(root, { x: frame.x, y: frame.y, width: frame.width, height: rootH }, theme, { accent: true })}${
      children.length
        ? line(
            connectorX,
            frame.y + rootH,
            connectorX,
            childrenY + (children.length - 1) * (childH + gap) + childH / 2,
            {
              stroke: theme.foreground,
              width: 2,
            },
          )
        : ''
    }${children
      .map((item, index) => {
        const y = childrenY + index * (childH + gap)
        return `<g>${line(connectorX, y + childH / 2, childX, y + childH / 2, { stroke: theme.foreground, width: 2 })}${circle(connectorX, y + childH / 2, 4, { fill: theme.background, stroke: theme.foreground, strokeWidth: 2 })}${card(item, { x: childX, y, width: childW, height: childH }, theme)}</g>`
      })
      .join('')}</g>`
  }
  const rootW = Math.min(300, frame.width * 0.35)
  const rootH = 94
  const rootX = frame.x + (frame.width - rootW) / 2
  const rootY = frame.y
  const childGap = 16
  const childW = (frame.width - childGap * Math.max(0, children.length - 1)) / Math.max(1, children.length)
  const childY = frame.y + frame.height * 0.58
  const busY = frame.y + frame.height * 0.39
  return `<g>${card(root, { x: rootX, y: rootY, width: rootW, height: rootH }, theme, { accent: true })}${children.length ? line(rootX + rootW / 2, rootY + rootH, rootX + rootW / 2, busY, { stroke: theme.foreground, width: 2 }) : ''}${children.length ? line(frame.x + childW / 2, busY, frame.x + frame.width - childW / 2, busY, { stroke: theme.foreground, width: 2 }) : ''}${children
    .map((item, index) => {
      const x = frame.x + index * (childW + childGap)
      return `<g>${line(x + childW / 2, busY, x + childW / 2, childY, { stroke: theme.foreground, width: 2 })}${card(item, { x, y: childY, width: childW, height: Math.min(150, frame.y + frame.height - childY) }, theme)}</g>`
    })
    .join('')}</g>`
}

function layers(items, frame, theme) {
  const count = Math.max(items.length, 1)
  const depth = Math.min(34, frame.height / (count * 3))
  const layerH = Math.min(110, (frame.height - depth * (count - 1)) / count)
  return `<g>${[...items]
    .reverse()
    .map((item, reverseIndex) => {
      const index = count - reverseIndex - 1
      const inset = index * Math.min(34, frame.width * 0.04)
      const y = frame.y + index * (layerH + depth)
      const x = frame.x + inset
      const width = frame.width - inset * 2
      const foreground = index === 0 ? theme.primary_foreground : theme.foreground
      const secondary = index === 0 ? theme.border : theme.muted_foreground
      return `<g><path d="M ${x + 28} ${y} H ${x + width} L ${x + width - 28} ${y + layerH} H ${x} Z" fill="${index === 0 ? theme.foreground : index % 2 ? theme.surface : theme.muted}" stroke="${index === 0 ? theme.foreground : theme.border}" stroke-width="1.5"/>${text(item.title, x + width / 2, y + layerH * (item.body ? 0.32 : 0.58), { size: 11, weight: 720, fill: foreground, width: width - 48, lines: 1, anchor: 'middle' }).svg}${item.body ? text(item.body, x + width / 2, y + layerH * 0.8, { size: 11, weight: 500, fill: secondary, width: width - 32, lines: 1, anchor: 'middle' }).svg : ''}</g>`
    })
    .join('')}</g>`
}

function pyramid(items, frame, theme) {
  const count = Math.max(items.length, 1)
  const gap = 7
  const h = (frame.height - gap * (count - 1)) / count
  const compact = frame.width < 500
  const topWidth = frame.width * (compact ? 0.44 : 0.26)
  return `<g>${items
    .map((item, index) => {
      const currentTop = topWidth + ((frame.width - topWidth) * index) / count
      const currentBottom = topWidth + ((frame.width - topWidth) * (index + 1)) / count
      const y = frame.y + index * (h + gap)
      const topX = frame.x + (frame.width - currentTop) / 2
      const bottomX = frame.x + (frame.width - currentBottom) / 2
      const fill = index === 0 ? theme.foreground : index % 2 ? theme.surface : theme.muted
      return `<g><path d="M ${topX} ${y} H ${topX + currentTop} L ${bottomX + currentBottom} ${y + h} H ${bottomX} Z" fill="${fill}" stroke="${index === 0 ? theme.foreground : theme.border}" stroke-width="1.5"/>${text(item.title, frame.x + frame.width / 2, y + h / 2 + 7, { size: Math.min(compact ? 18 : 21, h * (compact ? 0.24 : 0.28)), weight: 700, fill: index === 0 ? theme.primary_foreground : theme.foreground, width: currentTop - 30, lines: 2, anchor: 'middle' }).svg}</g>`
    })
    .join('')}</g>`
}

function hub(items, frame, theme) {
  const hubItem = items[0] || { title: 'Zentrum' }
  const spokes = items.slice(1)
  const cx = frame.x + frame.width / 2
  const cy = frame.y + frame.height / 2
  const hubRadius = Math.min(92, Math.min(frame.width, frame.height) * 0.16)
  const radiusX = frame.width * 0.37
  const radiusY = frame.height * 0.35
  const nodeW = Math.min(220, frame.width * 0.22)
  const nodeH = 84
  return `<g>${spokes
    .map((item, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(spokes.length, 1)
      const nodeCx = cx + Math.cos(angle) * radiusX
      const nodeCy = cy + Math.sin(angle) * radiusY
      return `<g>${line(cx + Math.cos(angle) * hubRadius, cy + Math.sin(angle) * hubRadius, nodeCx, nodeCy, { stroke: theme.border, width: 2 })}${circle(nodeCx, nodeCy, 5, { fill: theme.chart_1 })}${rect(nodeCx - nodeW / 2, nodeCy - nodeH / 2, nodeW, nodeH, { fill: theme.surface, stroke: theme.border, radius: 14 })}${text(item.title, nodeCx, nodeCy + 6, { size: 17, weight: 680, fill: theme.foreground, width: nodeW - 26, lines: 2, anchor: 'middle' }).svg}</g>`
    })
    .join(
      '',
    )}${circle(cx, cy, hubRadius, { fill: theme.foreground, stroke: theme.foreground, strokeWidth: 2 })}${text(hubItem.title, cx, cy + 7, { size: 19, weight: 720, fill: theme.primary_foreground, width: hubRadius * 1.45, lines: 3, anchor: 'middle' }).svg}</g>`
}

function detailedChart(rendered, frame, theme) {
  const chart = rendered.semantic.nodes.find((node) => node.type === 'chart')
  if (!chart?.rows?.length) return grid(visualItems(rendered), frame, theme, 1)
  const values = chart.rows.flatMap((row) => row.slice(1)).filter((value) => Number.isFinite(value))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const compact = frame.width < 500
  const seriesCount = Math.max(1, chart.headers.length - 1)
  const legendH = compact ? Math.ceil(seriesCount / 2) * 28 + 12 : 0
  const plot = {
    x: frame.x + (compact ? 48 : 70),
    y: frame.y + 36 + legendH,
    width: frame.width - (compact ? 62 : 100),
    height: frame.height - (compact ? 128 + legendH : 100),
  }
  const x = (index) => plot.x + (index / Math.max(1, chart.rows.length - 1)) * plot.width
  const y = (value) => plot.y + plot.height - ((value - min) / range) * plot.height
  const gridLines = Array.from({ length: 5 }, (_, index) => {
    const gy = plot.y + (plot.height * index) / 4
    const value = max - (range * index) / 4
    return `<g>${line(plot.x, gy, plot.x + plot.width, gy, { stroke: theme.border, width: 1, dash: index === 4 ? null : '3 7' })}<text x="${plot.x - 14}" y="${gy + 5}" text-anchor="end" font-size="12" font-weight="550" fill="${theme.muted_foreground}">${Number(value.toFixed(1))}</text></g>`
  }).join('')
  const series = chart.headers
    .slice(1)
    .map((name, seriesIndex) => {
      const points = chart.rows
        .map((row, index) => (row[seriesIndex + 1] == null ? null : `${x(index)},${y(row[seriesIndex + 1])}`))
        .filter(Boolean)
      const stroke = theme[`chart_${(seriesIndex % 5) + 1}`]
      const endLabel = compact
        ? ''
        : text(name, plot.x + plot.width - 4, y(chart.rows.at(-1)[seriesIndex + 1]) - 14, {
            size: 13,
            weight: 700,
            fill: stroke,
            width: 140,
            lines: 1,
            anchor: 'end',
          }).svg
      return `<g><polyline points="${points.join(' ')}" fill="none" stroke="${stroke}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${chart.rows.map((row, index) => (row[seriesIndex + 1] == null ? '' : circle(x(index), y(row[seriesIndex + 1]), 5, { fill: theme.surface, stroke, strokeWidth: 3 }))).join('')}${endLabel}</g>`
    })
    .join('')
  const legend = compact
    ? chart.headers
        .slice(1)
        .map((name, index) => {
          const column = index % 2
          const row = Math.floor(index / 2)
          const cellW = frame.width / 2
          const x = frame.x + column * cellW
          const baseline = frame.y + 22 + row * 28
          const stroke = theme[`chart_${(index % 5) + 1}`]
          return `<g>${line(x, baseline - 5, x + 20, baseline - 5, { stroke, width: 3 })}${text(name, x + 28, baseline, { size: 11, weight: 680, fill: theme.foreground, width: cellW - 34, lines: 1 }).svg}</g>`
        })
        .join('')
    : ''
  const labels = chart.rows
    .map((row, index) => {
      if (
        compact &&
        chart.rows.length > 4 &&
        index !== 0 &&
        index !== Math.floor(chart.rows.length / 2) &&
        index !== chart.rows.length - 1
      )
        return ''
      const anchor = compact && index === 0 ? 'start' : compact && index === chart.rows.length - 1 ? 'end' : 'middle'
      const labelY = plot.y + plot.height + (compact ? 28 + (index % 2) * 24 : 34)
      return `<text x="${x(index)}" y="${labelY}" text-anchor="${anchor}" font-size="12" font-weight="550" fill="${theme.muted_foreground}">${escapeXml(row[0])}</text>`
    })
    .join('')
  return `<g>${legend}${gridLines}${series}${labels}</g>`
}

function executiveBrief(items, frame, theme, rendered) {
  if (frame.width < 500) return stratified(items, frame, theme)
  const primary = items[0] || { title: rendered.meta.title, body: rendered.meta.summary }
  const support = items.slice(1, 5)
  const leadW = frame.width * 0.58
  const gap = 26
  const rightX = frame.x + leadW + gap
  const rightW = frame.width - leadW - gap
  const leadTitleY = frame.y + 108
  const leadTitle = text(primary.title, frame.x + 34, leadTitleY, {
    size: Math.min(48, leadW / 11),
    weight: 780,
    fill: theme.primary_foreground,
    width: leadW - 68,
    lines: 4,
    lineHeight: 1.03,
  })
  return `<g>${rect(frame.x, frame.y, leadW, frame.height, { fill: theme.foreground, stroke: theme.foreground, radius: 18 })}<text x="${frame.x + 34}" y="${frame.y + 38}" font-size="12" font-weight="760" fill="${theme.chart_1}" letter-spacing="1.5">DECISION BRIEF</text>${leadTitle.svg}${text(primary.body || rendered.meta.summary, frame.x + 36, leadTitleY + leadTitle.height + 34, { size: 18, weight: 470, fill: theme.border, width: leadW - 72, lines: 6, lineHeight: 1.35 }).svg}${line(frame.x + 36, frame.y + frame.height - 96, frame.x + leadW - 36, frame.y + frame.height - 96, { stroke: theme.border, width: 1 })}${text('Clear recommendation · Verifiable evidence', frame.x + 36, frame.y + frame.height - 52, { size: 14, weight: 650, fill: theme.primary_foreground, width: leadW - 72 }).svg}${support
    .map((item, index) => {
      const h = (frame.height - gap * Math.max(0, support.length - 1)) / Math.max(1, support.length)
      const y = frame.y + index * (h + gap)
      return `<g>${rect(rightX, y, rightW, h, { fill: theme.surface, stroke: theme.border, radius: 14 })}<text x="${rightX + rightW - 18}" y="${y + 24}" text-anchor="end" font-size="11" font-weight="750" fill="${theme.chart_1}" letter-spacing="1.2">${String(index + 1).padStart(2, '0')}</text>${text(item.title, rightX + 20, y + (h >= 115 ? 34 : h / 2 + 7), { size: Math.min(18, h * 0.2), weight: 700, fill: theme.foreground, width: rightW - 56, lines: 1 }).svg}${h >= 115 ? text(item.body, rightX + 20, y + 72, { size: 12, weight: 450, fill: theme.muted_foreground, width: rightW - 40, lines: 2, lineHeight: 1.2 }).svg : ''}</g>`
    })
    .join('')}</g>`
}

function magazineStory(items, frame, theme) {
  const lead = items[0] || { title: 'Story', body: '' }
  const rest = items.slice(1, 5)
  const leadW = frame.width * 0.57
  const leadSize = Math.min(66, leadW / 8.5)
  return `<g>${line(frame.x + leadW + 20, frame.y, frame.x + leadW + 20, frame.y + frame.height, { stroke: theme.foreground, width: 2 })}<text x="${frame.x}" y="${frame.y + 18}" font-size="12" font-weight="760" fill="${theme.chart_1}" letter-spacing="1.6">THE STORY</text>${text(lead.title, frame.x, frame.y + 88, { size: leadSize, weight: 790, fill: theme.foreground, width: leadW - 22, lines: 5, lineHeight: 0.98 }).svg}${text(lead.body, frame.x, frame.y + frame.height - 112, { size: 18, weight: 470, fill: theme.muted_foreground, width: leadW - 44, lines: 5, lineHeight: 1.35 }).svg}${rest
    .map((item, index) => {
      const x = frame.x + leadW + 54
      const h = frame.height / Math.max(1, rest.length)
      const y = frame.y + index * h
      const titleBlock = text(item.title, x, y + 68, {
        size: Math.min(25, h * 0.19),
        weight: 720,
        fill: theme.foreground,
        width: frame.width - leadW - 66,
        lines: 2,
      })
      const bodyY = Math.min(y + h - 12, y + 68 + titleBlock.height + 8)
      const bodyLines = Math.max(1, Math.min(2, Math.floor((y + h - bodyY + 20) / responsiveFontSize(11))))
      return `<g>${index ? line(x, y, frame.x + frame.width, y, { stroke: theme.border, width: 1 }) : ''}<text x="${x}" y="${y + 29}" font-size="12" font-weight="750" fill="${theme.muted_foreground}" letter-spacing="1.1">${String(index + 1).padStart(2, '0')}</text>${titleBlock.svg}${text(item.body, x, bodyY, { size: 11, weight: 450, fill: theme.muted_foreground, width: frame.width - leadW - 66, lines: bodyLines }).svg}</g>`
    })
    .join('')}</g>`
}

function kpiStrip(items, frame, theme) {
  const metrics = items.filter((item) => item.type !== 'group').slice(0, 8)
  const width = frame.width / Math.max(1, metrics.length)
  return `<g>${rect(frame.x, frame.y + frame.height * 0.19, frame.width, frame.height * 0.62, { fill: theme.surface, stroke: theme.border, radius: 16 })}${metrics
    .map((item, index) => {
      const x = frame.x + index * width
      return `<g>${index ? line(x, frame.y + frame.height * 0.19, x, frame.y + frame.height * 0.81, { stroke: theme.border, width: 1 }) : ''}${text(item.body?.split(' · ')[0] || item.label, x + 22, frame.y + frame.height * 0.31, { size: 13, weight: 700, fill: theme.muted_foreground, width: width - 44, lines: 2, tracking: 0.7 }).svg}${text(item.title, x + 22, frame.y + frame.height * 0.52, { size: Math.min(42, width / 4.4), weight: 770, fill: theme.foreground, width: width - 44, lines: 2 }).svg}${text(item.trend || item.body?.split(' · ').slice(1).join(' · '), x + 22, frame.y + frame.height * 0.69, { size: 13, weight: 620, fill: index % 4 === 2 ? theme.chart_3 : theme.chart_2, width: width - 44, lines: 2 }).svg}</g>`
    })
    .join('')}</g>`
}

function progressRings(items, frame, theme) {
  const entries = items.filter((item) => item.type !== 'group').slice(0, 6)
  const columns = frame.width < 500 ? Math.min(2, entries.length) : entries.length <= 4 ? entries.length : 3
  const rows = Math.ceil(entries.length / columns)
  const cellW = frame.width / columns
  const cellH = frame.height / rows
  return `<g>${entries
    .map((item, index) => {
      const value =
        item.type === 'progress' ? Number(item.value) / Number(item.source.max || 100) : 0.65 + (index % 4) * 0.08
      const cx = frame.x + (index % columns) * cellW + cellW / 2
      const cy = frame.y + Math.floor(index / columns) * cellH + cellH * 0.47
      const radius = Math.min(cellW, cellH) * 0.27
      const circumference = 2 * Math.PI * radius
      return `<g>${circle(cx, cy, radius, { stroke: theme.muted, strokeWidth: 14 })}<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${theme[`chart_${(index % 5) + 1}`]}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${circumference * Math.min(1, value)} ${circumference}" transform="rotate(-90 ${cx} ${cy})"/>${text(`${Math.round(value * 100)}%`, cx, cy + 10, { size: Math.min(31, radius * 0.62), weight: 780, fill: theme.foreground, width: radius * 1.45, lines: 1, anchor: 'middle' }).svg}${text(item.label || item.body || item.title, cx, cy + radius + 36, { size: 15, weight: 650, fill: theme.foreground, width: cellW - 34, lines: 2, anchor: 'middle' }).svg}</g>`
    })
    .join('')}</g>`
}

function bulletScoreboard(items, frame, theme) {
  const entries = items.filter((item) => item.type !== 'group').slice(0, 10)
  const rowH = frame.height / Math.max(1, entries.length)
  const labelW = frame.width * 0.3
  return `<g>${entries
    .map((item, index) => {
      const y = frame.y + index * rowH
      const value =
        item.type === 'progress' ? Number(item.value) / Number(item.source.max || 100) : 0.64 + (index % 4) * 0.08
      const compact = frame.width < 500
      const barX = compact ? frame.x : frame.x + labelW
      const barW = frame.width - (compact ? 64 : labelW + 64)
      const barCenterY = compact ? y + rowH * 0.7 : y + rowH / 2
      const target = 0.9
      const labelY = compact ? y + 25 : y + rowH / 2 + 6
      const labelWidth = compact ? frame.width : labelW - 22
      return `<g>${index ? line(frame.x, y, frame.x + frame.width, y, { stroke: theme.border, width: 1 }) : ''}${text(item.label || item.body || item.title, frame.x, labelY, { size: compact ? 12 : Math.min(17, rowH * 0.28), weight: 650, fill: theme.foreground, width: labelWidth, lines: compact ? 1 : 2 }).svg}${rect(barX, barCenterY - 7, barW, 14, { fill: theme.muted, radius: 3 })}${rect(barX, barCenterY - 7, barW * Math.min(1, value), 14, { fill: theme.chart_1, radius: 3 })}${line(barX + barW * target, barCenterY - 15, barX + barW * target, barCenterY + 15, { stroke: theme.foreground, width: 3 })}<text x="${frame.x + frame.width}" y="${barCenterY + 6}" text-anchor="end" font-size="14" font-weight="740" fill="${theme.foreground}">${Math.round(value * 100)}%</text></g>`
    })
    .join('')}</g>`
}

function chevronProcess(items, frame, theme) {
  const count = items.length
  const overlap = 28
  const width = (frame.width + overlap * Math.max(0, count - 1)) / Math.max(1, count)
  const h = Math.min(frame.height * 0.62, 280)
  const y = frame.y + (frame.height - h) / 2
  return `<g>${items
    .map((item, index) => {
      const x = frame.x + index * (width - overlap)
      const start = index ? overlap : 0
      const path = `M ${x + start} ${y} H ${x + width - overlap} L ${x + width} ${y + h / 2} L ${x + width - overlap} ${y + h} H ${x + start} L ${x + (index ? overlap : 0)} ${y + h / 2} Z`
      const active = index === 0
      return `<g><path d="${path}" fill="${active ? theme.foreground : index % 2 ? theme.surface : theme.muted}" stroke="${active ? theme.foreground : theme.border}" stroke-width="1.5"/>${text(String(index + 1).padStart(2, '0'), x + start + 20, y + 32, { size: 12, weight: 760, fill: active ? theme.chart_1 : theme.muted_foreground, width: 35 }).svg}${text(item.title, x + start + 20, y + h * 0.46, { size: Math.min(23, width / 8), weight: 720, fill: active ? theme.primary_foreground : theme.foreground, width: width - start - overlap - 34, lines: 2 }).svg}${text(item.body, x + start + 20, y + h * 0.7, { size: 13, weight: 450, fill: active ? theme.border : theme.muted_foreground, width: width - start - overlap - 34, lines: 3 }).svg}</g>`
    })
    .join('')}</g>`
}

function swimlane(items, frame, theme) {
  const laneH = frame.height / 2
  const step = frame.width / Math.max(1, items.length)
  return `<g>${rect(frame.x, frame.y, frame.width, laneH, { fill: theme.surface, stroke: theme.border, radius: 12 })}${rect(frame.x, frame.y + laneH, frame.width, laneH, { fill: theme.muted, stroke: theme.border, radius: 12 })}<text x="${frame.x + 18}" y="${frame.y + 26}" font-size="11" font-weight="760" fill="${theme.muted_foreground}" letter-spacing="1.2">LANE A</text><text x="${frame.x + 18}" y="${frame.y + laneH + 26}" font-size="11" font-weight="760" fill="${theme.muted_foreground}" letter-spacing="1.2">LANE B</text>${items
    .map((item, index) => {
      const cx = frame.x + step * index + step / 2
      const cy = frame.y + (index % 2 ? laneH * 1.5 : laneH * 0.5)
      const nextCy = frame.y + ((index + 1) % 2 ? laneH * 1.5 : laneH * 0.5)
      return `<g>${index < items.length - 1 ? line(cx + 24, cy, cx + step - 24, nextCy, { stroke: theme.foreground, width: 2, marker: true }) : ''}${circle(cx, cy, 25, { fill: index === 0 ? theme.foreground : theme.background, stroke: theme.foreground, strokeWidth: 2 })}<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="15" font-weight="750" fill="${index === 0 ? theme.primary_foreground : theme.foreground}">${index + 1}</text>${text(item.title, cx, cy - 45, { size: Math.min(17, step / 7), weight: 700, fill: theme.foreground, width: step - 18, lines: 2, anchor: 'middle' }).svg}${text(item.body, cx, cy + 56, { size: 12, weight: 500, fill: theme.muted_foreground, width: step - 20, lines: 2, anchor: 'middle' }).svg}</g>`
    })
    .join('')}</g>`
}

function featureTable(items, frame, theme) {
  const columns = Math.min(4, items.length)
  const dimensions = [
    ...new Set(items.flatMap((item) => (item.points || []).map((point) => clean(point.label).split(/\s+·\s+/)[0]))),
  ].slice(0, 7)
  const labelW = frame.width * 0.24
  const headH = 68
  const rowH = (frame.height - headH) / Math.max(1, dimensions.length)
  const colW = (frame.width - labelW) / columns
  return `<g>${rect(frame.x, frame.y, frame.width, frame.height, { fill: theme.surface, stroke: theme.border, radius: 12 })}${rect(frame.x, frame.y, labelW, frame.height, { fill: theme.foreground, radius: 12 })}${items
    .slice(0, columns)
    .map(
      (item, index) =>
        text(item.title, frame.x + labelW + index * colW + colW / 2, frame.y + 40, {
          size: 16,
          weight: 720,
          fill: theme.foreground,
          width: colW - 22,
          lines: 2,
          anchor: 'middle',
        }).svg,
    )
    .join('')}${dimensions
    .map((dimension, row) => {
      const y = frame.y + headH + row * rowH
      return `<g>${row % 2 ? rect(frame.x + labelW, y, frame.width - labelW, rowH, { fill: theme.muted, radius: 0 }) : ''}${text(dimension, frame.x + 18, y + rowH / 2 + 5, { size: 14, weight: 660, fill: theme.primary_foreground, width: labelW - 36, lines: 2 }).svg}${items
        .slice(0, columns)
        .map((item, col) => {
          const entry = (item.points || []).find((point) => clean(point.label).split(/\s+·\s+/)[0] === dimension)
          const parts = clean(entry?.label).split(/\s+·\s+/)
          return text(
            parts.slice(1).join(' · ') || (entry ? 'Ja' : '—'),
            frame.x + labelW + col * colW + colW / 2,
            y + rowH / 2 + 5,
            {
              size: 13,
              weight: col === columns - 1 ? 700 : 500,
              fill: col === columns - 1 ? theme.chart_1 : theme.muted_foreground,
              width: colW - 20,
              lines: 2,
              anchor: 'middle',
            },
          ).svg
        })
        .join('')}</g>`
    })
    .join('')}</g>`
}

function spectrum(items, frame, theme) {
  const dimensions = [
    ...new Set(items.flatMap((item) => (item.points || []).map((point) => clean(point.label).split(/\s+·\s+/)[0]))),
  ].slice(0, 5)
  const rowH = frame.height / Math.max(1, dimensions.length)
  const axisX = frame.x + frame.width * 0.24
  const axisW = frame.width * 0.7
  const valuePosition = (value, fallback) => {
    const raw = clean(value).toLowerCase()
    if (/gering|low|individuell|hoch gekoppelt/.test(raw)) return 0.12
    if (/mittel|medium|intern/.test(raw)) return 0.5
    if (/hoch|high|gemeinsam|gering gekoppelt/.test(raw)) return 0.88
    return fallback
  }
  return `<g>${dimensions
    .map((dimension, row) => {
      const y = frame.y + row * rowH + rowH / 2
      return `<g>${text(dimension, frame.x, y + 5, { size: 15, weight: 680, fill: theme.foreground, width: frame.width * 0.2, lines: 2 }).svg}${line(axisX, y, axisX + axisW, y, { stroke: theme.border, width: 4 })}<text x="${axisX}" y="${y + 28}" font-size="11" fill="${theme.muted_foreground}">LOW</text><text x="${axisX + axisW}" y="${y + 28}" text-anchor="end" font-size="11" fill="${theme.muted_foreground}">HIGH</text>${items
        .map((item, index) => {
          const point = (item.points || []).find((entry) => clean(entry.label).split(/\s+·\s+/)[0] === dimension)
          const value = clean(point?.label)
            .split(/\s+·\s+/)
            .slice(1)
            .join(' · ')
          const x = axisX + axisW * valuePosition(value, (index + 1) / (items.length + 1))
          const offset = (index - (items.length - 1) / 2) * 13
          return `<g>${circle(x, y + offset, 8, { fill: theme[`chart_${(index % 5) + 1}`], stroke: theme.background, strokeWidth: 2 })}${text(item.title, x, y + offset - 14, { size: 11, weight: 700, fill: theme.foreground, width: 120, lines: 1, anchor: 'middle' }).svg}</g>`
        })
        .join('')}</g>`
    })
    .join('')}</g>`
}

function milestoneRoadmap(items, frame, theme) {
  const count = items.length
  const step = frame.width / Math.max(1, count - 1)
  const y = frame.y + frame.height * 0.55
  return `<g><path d="M ${frame.x} ${y} C ${frame.x + frame.width * 0.28} ${y - 90}, ${frame.x + frame.width * 0.68} ${y + 90}, ${frame.x + frame.width} ${y}" fill="none" stroke="${theme.foreground}" stroke-width="3"/>${items
    .map((item, index) => {
      const x = frame.x + (count === 1 ? frame.width / 2 : index * step)
      const offsetY = Math.sin((index / Math.max(1, count - 1)) * Math.PI * 2) * 42
      const cy = y - offsetY
      const diamond = `${x},${cy - 16} ${x + 16},${cy} ${x},${cy + 16} ${x - 16},${cy}`
      const above = index % 2 === 0
      const anchor = index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'
      return `<g><polygon points="${diamond}" fill="${index === 0 ? theme.foreground : theme.surface}" stroke="${theme.foreground}" stroke-width="2"/>${text(item.title, x, cy + (above ? -46 : 58), { size: Math.min(17, step / 7), weight: 700, fill: theme.foreground, width: Math.max(110, step - 16), lines: 3, anchor }).svg}</g>`
    })
    .join('')}</g>`
}

function phaseTimeline(items, frame, theme) {
  const count = items.length
  const width = frame.width / Math.max(1, count)
  return `<g>${items
    .map((item, index) => {
      const x = frame.x + index * width
      const inset = index % 2 ? frame.height * 0.12 : 0
      const h = frame.height - inset
      return `<g>${rect(x, frame.y + inset, width, h, { fill: index % 2 ? theme.surface : theme.muted, stroke: theme.border, radius: index === 0 || index === count - 1 ? 12 : 0 })}<text x="${x + 20}" y="${frame.y + inset + 30}" font-size="12" font-weight="760" fill="${theme.chart_1}" letter-spacing="1.1">PHASE ${index + 1}</text>${text(item.title, x + 20, frame.y + inset + 78, { size: Math.min(22, width / 8), weight: 720, fill: theme.foreground, width: width - 40, lines: 3 }).svg}${line(x + 20, frame.y + h - 62, x + width - 20, frame.y + h - 62, { stroke: theme.border, width: 2 })}${circle(x + 24, frame.y + h - 62, 6, { fill: theme.chart_1 })}</g>`
    })
    .join('')}</g>`
}

function concentric(items, frame, theme) {
  const cx = frame.x + frame.width / 2
  const cy = frame.y + frame.height / 2
  const maxRadius = Math.min(frame.width, frame.height) * 0.47
  const ordered = items.slice(0, 7)
  return `<g>${[...ordered]
    .reverse()
    .map((item, reversedIndex) => {
      const index = ordered.length - 1 - reversedIndex
      const radius = maxRadius * ((index + 1) / ordered.length)
      const fill = index === 0 ? theme.foreground : index % 2 ? theme.surface : theme.muted
      return `<g>${circle(cx, cy, radius, { fill, stroke: theme.border, strokeWidth: 1.5 })}${text(item.title, cx, cy - radius + 28, { size: Math.max(11, Math.min(16, radius / 7)), weight: 680, fill: index === 0 ? theme.primary_foreground : theme.foreground, width: radius * 1.55, lines: 1, anchor: 'middle' }).svg}</g>`
    })
    .join('')}</g>`
}

function architectureMap(items, frame, theme) {
  const core = items[0] || { title: 'Core' }
  const related = items.slice(1)
  const left = related.filter((_, index) => index % 2 === 0)
  const right = related.filter((_, index) => index % 2 === 1)
  const coreW = frame.width * 0.28
  const coreH = frame.height * 0.46
  const coreX = frame.x + (frame.width - coreW) / 2
  const coreY = frame.y + (frame.height - coreH) / 2
  const sideW = frame.width * 0.24
  const nodes = (entries, side) =>
    entries
      .map((item, index) => {
        const h = Math.min(100, (frame.height - 18 * Math.max(0, entries.length - 1)) / Math.max(1, entries.length))
        const y = frame.y + index * (h + 18)
        const x = side === 'left' ? frame.x : frame.x + frame.width - sideW
        const startX = side === 'left' ? x + sideW : coreX + coreW
        const endX = side === 'left' ? coreX : x
        return `<g>${line(startX, y + h / 2, endX, coreY + coreH / 2, { stroke: theme.border, width: 2, marker: true })}${rect(x, y, sideW, h, { fill: theme.surface, stroke: theme.border, radius: 12 })}${text(item.title, x + sideW / 2, y + h / 2 + 6, { size: 15, weight: 680, fill: theme.foreground, width: sideW - 28, lines: 2, anchor: 'middle' }).svg}</g>`
      })
      .join('')
  return `<g>${nodes(left, 'left')}${nodes(right, 'right')}${rect(coreX, coreY, coreW, coreH, { fill: theme.foreground, stroke: theme.foreground, radius: 18 })}<text x="${coreX + 24}" y="${coreY + 34}" font-size="11" font-weight="760" fill="${theme.chart_1}" letter-spacing="1.2">CORE</text>${text(core.title, coreX + coreW / 2, coreY + coreH / 2 + 8, { size: Math.min(27, coreW / 8), weight: 760, fill: theme.primary_foreground, width: coreW - 44, lines: 3, anchor: 'middle' }).svg}</g>`
}

function chartNode(rendered) {
  return rendered.semantic.nodes.find((node) => node.type === 'chart')
}

function rankedBars(rendered, frame, theme, lollipop = false) {
  const chart = chartNode(rendered)
  if (!chart?.rows?.length) return detailedChart(rendered, frame, theme)
  const rows = (lollipop ? [...chart.rows] : [...chart.rows].sort((a, b) => Number(b[1]) - Number(a[1]))).slice(0, 16)
  const values = rows.map((row) => Number(row[1] || 0))
  const max = Math.max(...values, 1)
  const rowH = frame.height / rows.length
  const compact = frame.width < 500
  const labelW = frame.width * (compact ? 0.31 : 0.24)
  const valueW = frame.width * (compact ? 0.18 : 0.12)
  const barX = frame.x + labelW
  const barW = frame.width - labelW - valueW
  return `<g>${rows
    .map((row, index) => {
      const y = frame.y + index * rowH
      const width = (Number(row[1] || 0) / max) * barW
      return `<g>${index ? line(frame.x, y, frame.x + frame.width, y, { stroke: theme.border, width: 1 }) : ''}${text(row[0], frame.x, y + rowH / 2 + 5, { size: Math.min(compact ? 13 : 15, rowH * 0.28), weight: 620, fill: theme.foreground, width: labelW - (compact ? 8 : 20), lines: 1 }).svg}${lollipop ? `${line(barX, y + rowH / 2, barX + width, y + rowH / 2, { stroke: theme.border, width: 3 })}${circle(barX + width, y + rowH / 2, 8, { fill: theme.chart_1, stroke: theme.background, strokeWidth: 2 })}` : rect(barX, y + rowH * 0.3, width, rowH * 0.4, { fill: index === 0 ? theme.foreground : theme.chart_1, radius: 3 })}<text x="${frame.x + frame.width}" y="${y + rowH / 2 + 5}" text-anchor="end" font-size="13" font-weight="720" fill="${theme.foreground}">${escapeXml(row[1])}${chart.unit ? ` ${escapeXml(chart.unit)}` : ''}</text></g>`
    })
    .join('')}</g>`
}

function slopeChart(rendered, frame, theme) {
  const chart = chartNode(rendered)
  if (!chart?.rows?.length || chart.rows.length !== 2) return detailedChart(rendered, frame, theme)
  const values = chart.rows.flatMap((row) => row.slice(1)).filter(Number.isFinite)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const compact = frame.width < 500
  const leftX = frame.x + frame.width * 0.22
  const rightX = frame.x + frame.width * 0.78
  const top = frame.y + 60
  const legendHeight = compact ? Math.max(94, chart.headers.length * 25) : 0
  const plotH = frame.height - 120 - legendHeight
  const y = (value) => top + plotH - ((value - min) / range) * plotH
  const series = chart.headers.slice(1)
  const slopes = series
    .map((name, index) => {
      const from = chart.rows[0][index + 1]
      const to = chart.rows[1][index + 1]
      const color = theme[`chart_${(index % 5) + 1}`]
      const unit = chart.unit || ''
      const leftLabel = compact ? `${from}${unit}` : `${name} ${from}${unit}`
      const rightLabel = compact ? `${to}${unit}` : `${name} ${to}${unit}`
      return `<g>${line(leftX, y(from), rightX, y(to), { stroke: color, width: 3 })}${circle(leftX, y(from), 5, { fill: theme.background, stroke: color, strokeWidth: 3 })}${circle(rightX, y(to), 5, { fill: theme.background, stroke: color, strokeWidth: 3 })}${text(leftLabel, leftX - 14, y(from) + 5, { size: 12, weight: 700, fill: color, width: frame.width * 0.18, lines: 1, anchor: 'end' }).svg}${text(rightLabel, rightX + 14, y(to) + 5, { size: 12, weight: 700, fill: color, width: frame.width * 0.18, lines: 1 }).svg}</g>`
    })
    .join('')
  const legend = compact
    ? series
        .map((name, index) => {
          const from = chart.rows[0][index + 1]
          const to = chart.rows[1][index + 1]
          const color = theme[`chart_${(index % 5) + 1}`]
          const rowY = frame.y + frame.height - legendHeight + 36 + index * 25
          const delta = to - from
          return `<g>${line(frame.x + 4, rowY - 5, frame.x + 22, rowY - 5, { stroke: color, width: 3 })}${circle(frame.x + 13, rowY - 5, 4, { fill: theme.background, stroke: color, strokeWidth: 2 })}${text(name, frame.x + 32, rowY, { size: 12, weight: 650, fill: theme.foreground, width: frame.width * 0.58, lines: 1 }).svg}<text x="${frame.x + frame.width}" y="${rowY}" text-anchor="end" font-size="12" font-weight="720" fill="${color}">${delta >= 0 ? '+' : ''}${delta}${escapeXml(chart.unit || '')}</text></g>`
        })
        .join('')
    : ''
  return `<g>${line(leftX, top, leftX, top + plotH, { stroke: theme.border, width: 1 })}${line(rightX, top, rightX, top + plotH, { stroke: theme.border, width: 1 })}${text(chart.rows[0][0], leftX, frame.y + 26, { size: 16, weight: 720, fill: theme.foreground, width: 160, lines: 1, anchor: 'middle' }).svg}${text(chart.rows[1][0], rightX, frame.y + 26, { size: 16, weight: 720, fill: theme.foreground, width: 160, lines: 1, anchor: 'middle' }).svg}${slopes}${legend}</g>`
}

function smallMultiples(rendered, frame, theme) {
  const chart = chartNode(rendered)
  if (!chart?.rows?.length) return detailedChart(rendered, frame, theme)
  const series = chart.headers.slice(1).slice(0, 8)
  const columns = series.length === 4 ? 2 : Math.min(3, series.length)
  const rows = Math.ceil(series.length / columns)
  const gap = 18
  const cellW = (frame.width - gap * (columns - 1)) / columns
  const cellH = (frame.height - gap * (rows - 1)) / rows
  const all = chart.rows.flatMap((row) => row.slice(1)).filter(Number.isFinite)
  const min = Math.min(...all)
  const max = Math.max(...all)
  const range = max - min || 1
  return `<g>${series
    .map((name, seriesIndex) => {
      const x = frame.x + (seriesIndex % columns) * (cellW + gap)
      const y = frame.y + Math.floor(seriesIndex / columns) * (cellH + gap)
      const padX = 28
      const headerH = frame.width < 500 ? 48 : 50
      const plotTop = y + headerH + 12
      const plotBottom = y + cellH - 24
      const points = chart.rows.map(
        (row, index) =>
          `${x + padX + (index / Math.max(1, chart.rows.length - 1)) * (cellW - padX * 2)},${plotBottom - ((row[seriesIndex + 1] - min) / range) * (plotBottom - plotTop)}`,
      )
      return `<g>${rect(x, y, cellW, cellH, { fill: theme.surface, stroke: theme.border, radius: 12 })}${text(name, x + 18, y + 31, { size: 13, weight: 720, fill: theme.foreground, width: cellW - 36, lines: 1 }).svg}${line(x + 16, y + headerH, x + cellW - 16, y + headerH, { stroke: theme.border, width: 1 })}<polyline points="${points.join(' ')}" fill="none" stroke="${theme[`chart_${(seriesIndex % 5) + 1}`]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>`
    })
    .join('')}</g>`
}

const finite = (value) => Number.isFinite(Number(value))
const number = (value) => (finite(value) ? Number(value) : 0)
const extent = (values, includeZero = false) => {
  const entries = values.map(Number).filter(Number.isFinite)
  let min = entries.length ? Math.min(...entries) : 0
  let max = entries.length ? Math.max(...entries) : 1
  if (includeZero) {
    min = Math.min(0, min)
    max = Math.max(0, max)
  }
  if (min === max) {
    min -= 1
    max += 1
  }
  return [min, max]
}
const scale = (value, min, max, start, end) => start + ((number(value) - min) / (max - min || 1)) * (end - start)
const displayValue = (value, unit = '') =>
  `${Number(value).toLocaleString('de-DE', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`

function intervalPlot(rendered, frame, theme, mode = 'range') {
  const chart = chartNode(rendered)
  if (!chart?.rows?.length) return detailedChart(rendered, frame, theme)
  const rows = chart.rows.slice(0, 14)
  const [min, max] = extent(rows.flatMap((row) => row.slice(1)))
  const compact = frame.width < 500
  const headerH = compact ? 28 : 0
  const labelW = frame.width * 0.22
  const valueW = compact ? 0 : frame.width * 0.14
  const plotX = compact ? frame.x : frame.x + labelW
  const plotW = frame.width - (compact ? 0 : labelW + valueW)
  const rowH = (frame.height - headerH) / rows.length
  return `<g>${rows
    .map((row, index) => {
      const rowY = frame.y + headerH + rowH * index
      const cy = compact ? rowY + rowH * 0.7 : rowY + rowH * 0.5
      const from = scale(row[1], min, max, plotX, plotX + plotW)
      const to = scale(row[2], min, max, plotX, plotX + plotW)
      const delta = number(row[2]) - number(row[1])
      const accent = mode === 'change' ? (delta >= 0 ? theme.chart_2 : theme.chart_5) : theme.chart_1
      const band =
        mode === 'range' ? rect(from, cy - 6, to - from, 12, { fill: theme.chart_1, opacity: 0.18, radius: 6 }) : ''
      return `<g>${index ? line(frame.x, rowY, frame.x + frame.width, rowY, { stroke: theme.border, width: 1 }) : ''}${text(row[0], frame.x, compact ? rowY + 23 : cy + 5, { size: 12, weight: 650, fill: theme.foreground, width: compact ? frame.width : labelW - 10, lines: 1 }).svg}${band}${line(from, cy, to, cy, { stroke: accent, width: mode === 'change' ? 5 : 3 })}${circle(from, cy, mode === 'change' ? 7 : 6, { fill: theme.background, stroke: accent, strokeWidth: 3 })}${circle(to, cy, mode === 'change' ? 8 : 6, { fill: accent, stroke: theme.background, strokeWidth: 2 })}${compact ? '' : `<text x="${frame.x + frame.width}" y="${cy + 5}" text-anchor="end" font-size="12" font-weight="720" fill="${accent}">${mode === 'change' ? `${delta >= 0 ? '+' : ''}${displayValue(delta, chart.unit)}` : `${displayValue(row[1], chart.unit)}–${displayValue(row[2], chart.unit)}`}</text>`}</g>`
    })
    .join(
      '',
    )}<text x="${plotX}" y="${frame.y + 12}" font-size="11" font-weight="650" fill="${theme.muted_foreground}">${displayValue(min, chart.unit)}</text><text x="${plotX + plotW}" y="${frame.y + 12}" text-anchor="end" font-size="11" font-weight="650" fill="${theme.muted_foreground}">${displayValue(max, chart.unit)}</text></g>`
}

function divergingBars(rendered, frame, theme, inputRows) {
  const chart = chartNode(rendered)
  if (!chart?.rows?.length) return detailedChart(rendered, frame, theme)
  const rows = (inputRows || chart.rows).slice(0, 16)
  const [min, max] = extent(
    rows.map((row) => row[1]),
    true,
  )
  const compact = frame.width < 500
  const labelW = frame.width * 0.23
  const valueW = compact ? frame.width * 0.22 : 0
  const plotX = compact ? frame.x + 8 : frame.x + labelW
  const plotW = frame.width - (compact ? valueW + 16 : labelW + valueW)
  const zero = scale(0, min, max, plotX, plotX + plotW)
  const rowH = frame.height / rows.length
  return `<g>${compact ? '' : line(zero, frame.y, zero, frame.y + frame.height, { stroke: theme.foreground, width: 1.5 })}${rows
    .map((row, index) => {
      const value = number(row[1])
      const x = scale(value, min, max, plotX, plotX + plotW)
      const y = frame.y + index * rowH
      const start = Math.min(zero, x)
      const width = Math.abs(x - zero)
      const fill = value >= 0 ? theme.chart_2 : theme.chart_5
      const valueX = compact ? frame.x + frame.width : value >= 0 ? x - 7 : x + 7
      const valueAnchor = compact ? 'end' : value >= 0 ? 'end' : 'start'
      const barY = compact ? y + rowH * 0.56 : y + rowH * 0.26
      const barH = compact ? rowH * 0.28 : rowH * 0.48
      const valueY = compact ? barY + barH / 2 + 5 : y + rowH / 2 + 4
      return `<g>${text(row[0], frame.x, compact ? y + 23 : y + rowH / 2 + 5, { size: 12, weight: 650, fill: theme.foreground, width: compact ? frame.width : labelW - 10, lines: 1 }).svg}${compact ? line(zero, barY - 5, zero, barY + barH + 5, { stroke: theme.foreground, width: 1.5 }) : ''}${rect(start, barY, width, barH, { fill, radius: 3 })}<text x="${valueX}" y="${valueY}" text-anchor="${valueAnchor}" font-size="11" font-weight="760" fill="${fill}">${value > 0 ? '+' : ''}${displayValue(value, chart.unit)}</text></g>`
    })
    .join('')}</g>`
}

function likertDistribution(rendered, frame, theme) {
  const chart = chartNode(rendered)
  if (!chart?.rows?.length) return detailedChart(rendered, frame, theme)
  const rows = chart.rows.slice(0, 10)
  const compact = frame.width < 500
  const headerH = 32
  const labelW = compact ? 0 : frame.width * 0.24
  const plotX = frame.x + labelW
  const plotW = frame.width - labelW
  const rowH = (frame.height - headerH) / rows.length
  const colors =
    chart.headers.length === 4
      ? [theme.chart_5, theme.border, theme.chart_2]
      : [theme.chart_5, theme.chart_3, theme.border, theme.chart_2, theme.chart_1]
  return `<g>${rows
    .map((row, index) => {
      const values = row.slice(1).map(number)
      const total = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1
      const widths = values.map((value) => (Math.max(0, value) / total) * plotW)
      let cursor = plotX
      const y = frame.y + headerH + index * rowH
      const barY = compact ? y + Math.min(44, rowH * 0.43) : y + rowH * 0.27
      const barH = compact ? Math.min(28, rowH * 0.3) : rowH * 0.46
      const segments = widths
        .map((width, valueIndex) => {
          const value = values[valueIndex]
          const current = cursor
          cursor += width
          return `${rect(current, barY, width, barH, { fill: colors[valueIndex] || theme.chart_1, radius: 2 })}${width > responsiveFontSize(11) * 2.8 ? `<text x="${current + width / 2}" y="${barY + barH / 2 + 5}" text-anchor="middle" font-size="11" font-weight="760" fill="${valueIndex === 2 ? theme.foreground : theme.background}">${Math.round((value / total) * 100)}%</text>` : ''}`
        })
        .join('')
      const label = compact
        ? text(row[0], frame.x, y + 21, { size: 12, weight: 650, fill: theme.foreground, width: frame.width, lines: 1 })
            .svg
        : text(row[0], frame.x, y + rowH * 0.42, {
            size: 12,
            weight: 650,
            fill: theme.foreground,
            width: labelW - 18,
            lines: 2,
          }).svg
      return `<g>${label}${segments}</g>`
    })
    .join(
      '',
    )}<text x="${plotX}" y="${frame.y + 17}" font-size="11" font-weight="700" fill="${theme.chart_5}">Ablehnung</text><text x="${plotX + plotW}" y="${frame.y + 17}" text-anchor="end" font-size="11" font-weight="700" fill="${theme.chart_2}">Zustimmung</text></g>`
}

function scatterCorrelation(rendered, frame, theme) {
  const chart = chartNode(rendered)
  if (!chart?.rows?.length) return detailedChart(rendered, frame, theme)
  const rows = chart.rows.slice(0, 80)
  const [minX, maxX] = extent(rows.map((row) => row[1]))
  const [minY, maxY] = extent(rows.map((row) => row[2]))
  const left = frame.x + (frame.width < 500 ? 38 : 62)
  const right = frame.x + frame.width - 18
  const top = frame.y + 22
  const bottom = frame.y + frame.height - 42
  const px = (value) => scale(value, minX, maxX, left, right)
  const py = (value) => scale(value, minY, maxY, bottom, top)
  return `<g>${line(left, top, left, bottom, { stroke: theme.border, width: 1 })}${line(left, bottom, right, bottom, { stroke: theme.border, width: 1 })}${rows
    .map((row, index) => {
      const x = px(row[1])
      const y = py(row[2])
      const anchor = x > right - 70 ? 'end' : 'start'
      const labelX = x + (anchor === 'end' ? -8 : 8)
      const labelY = Math.max(top + 11, Math.min(bottom - 4, y + (index % 2 ? -7 : 14)))
      return `<g>${circle(x, y, 6, { fill: theme[`chart_${(index % 5) + 1}`], stroke: theme.background, strokeWidth: 2 })}${rows.length <= 14 ? `<text x="${labelX}" y="${labelY}" text-anchor="${anchor}" font-size="11" font-weight="650" fill="${theme.foreground}">${escapeXml(row[0])}</text>` : ''}</g>`
    })
    .join(
      '',
    )}<text x="${(left + right) / 2}" y="${frame.y + frame.height - 10}" text-anchor="middle" font-size="11" font-weight="700" fill="${theme.muted_foreground}">${escapeXml(chart.headers[1])}</text><text x="${left}" y="${top - 8}" font-size="11" font-weight="700" fill="${theme.muted_foreground}">${escapeXml(chart.headers[2])}</text></g>`
}

function distributionBoxplot(rendered, frame, theme) {
  const chart = chartNode(rendered)
  if (!chart?.rows?.length) return detailedChart(rendered, frame, theme)
  const rows = chart.rows.slice(0, 12)
  const [min, max] = extent(rows.flatMap((row) => row.slice(1)))
  const compact = frame.width < 500
  const labelW = frame.width * 0.2
  const plotX = compact ? frame.x + 10 : frame.x + labelW
  const plotW = frame.width - (compact ? 20 : labelW + 8)
  const rowH = frame.height / rows.length
  return `<g>${rows
    .map((row, index) => {
      const rowY = frame.y + rowH * index
      const y = compact ? rowY + rowH * 0.68 : rowY + rowH * 0.5
      const [low, q1, median, q3, high] = row.slice(1).map((value) => scale(value, min, max, plotX, plotX + plotW))
      return `<g>${text(row[0], frame.x, compact ? rowY + 24 : y + 5, { size: 12, weight: 650, fill: theme.foreground, width: compact ? frame.width : labelW - 10, lines: 1 }).svg}${line(low, y, high, y, { stroke: theme.border, width: 2 })}${line(low, y - 9, low, y + 9, { stroke: theme.foreground, width: 2 })}${line(high, y - 9, high, y + 9, { stroke: theme.foreground, width: 2 })}${rect(q1, y - Math.min(17, rowH * 0.24), q3 - q1, Math.min(34, rowH * 0.48), { fill: theme.chart_1, opacity: 0.18, stroke: theme.chart_1, strokeWidth: 2, radius: 3 })}${line(median, y - Math.min(17, rowH * 0.24), median, y + Math.min(17, rowH * 0.24), { stroke: theme.chart_1, width: 3 })}<text x="${median}" y="${y - Math.min(22, rowH * 0.31)}" text-anchor="middle" font-size="11" font-weight="750" fill="${theme.chart_1}">${displayValue(row[3], chart.unit)}</text></g>`
    })
    .join('')}</g>`
}

function dataHeatmap(rendered, frame, theme) {
  const chart = chartNode(rendered)
  if (!chart?.rows?.length) return detailedChart(rendered, frame, theme)
  const rows = chart.rows.slice(0, 14)
  const columns = chart.headers.slice(1)
  const values = rows.flatMap((row) => row.slice(1)).map(number)
  const [min, max] = extent(values)
  const compact = frame.width < 500
  const labelW = frame.width * (compact ? 0.28 : 0.18)
  const headH = Math.min(48, frame.height * 0.14)
  const cellW = (frame.width - labelW) / columns.length
  const cellH = (frame.height - headH) / rows.length
  return `<g>${columns
    .map(
      (column, index) =>
        `<text x="${frame.x + labelW + cellW * (index + 0.5)}" y="${frame.y + 14}" text-anchor="middle" font-size="11" font-weight="700" fill="${theme.muted_foreground}">${escapeXml(ellipsis(column, cellW - 4, 11))}</text>`,
    )
    .join('')}${rows
    .map((row, rowIndex) => {
      const y = frame.y + headH + rowIndex * cellH
      return `<g>${text(row[0], frame.x, y + cellH / 2 + 4, { size: 11, weight: 650, fill: theme.foreground, width: labelW - 8, lines: 1 }).svg}${row
        .slice(1)
        .map((value, columnIndex) => {
          const intensity = 0.12 + ((number(value) - min) / (max - min || 1)) * 0.82
          const x = frame.x + labelW + columnIndex * cellW
          return `${rect(x + 1, y + 1, cellW - 2, cellH - 2, { fill: theme.chart_1, opacity: intensity, radius: Math.min(5, cellW * 0.08) })}${cellW >= 31 && cellH >= 22 ? `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 4}" text-anchor="middle" font-size="11" font-weight="760" fill="${intensity > 0.56 ? theme.background : theme.foreground}">${escapeXml(displayValue(value, chart.unit))}</text>` : ''}`
        })
        .join('')}</g>`
    })
    .join('')}</g>`
}

function waterfall(rendered, frame, theme) {
  const chart = chartNode(rendered)
  if (!chart?.rows?.length) return detailedChart(rendered, frame, theme)
  const rows = chart.rows.slice(0, 12)
  const compact = frame.width < 500
  const total = rows.reduce((sum, row) => sum + number(row[1]), 0)
  if (compact) return divergingBars(rendered, frame, theme, [...rows, ['Ergebnis', total]])
  const states = []
  let running = 0
  for (const row of rows) {
    const before = running
    running += number(row[1])
    states.push({ row, before, after: running })
  }
  states.push({ row: ['Ergebnis', running], before: 0, after: running, total: true })
  const [min, max] = extent([0, ...states.flatMap((state) => [state.before, state.after])], true)
  const plotTop = frame.y + 24
  const plotBottom = frame.y + frame.height - 54
  const y = (value) => scale(value, min, max, plotBottom, plotTop)
  const gap = 12
  const barW = (frame.width - gap * (states.length - 1)) / states.length
  return `<g>${line(frame.x, y(0), frame.x + frame.width, y(0), { stroke: theme.border, width: 1.5 })}${states
    .map((state, index) => {
      const x = frame.x + index * (barW + gap)
      const top = Math.min(y(state.before), y(state.after))
      const height = Math.max(3, Math.abs(y(state.before) - y(state.after)))
      const positive = number(state.row[1]) >= 0
      const fill = state.total ? theme.foreground : positive ? theme.chart_2 : theme.chart_5
      const connector =
        index < states.length - 1
          ? line(x + barW, y(state.after), x + barW + gap, y(state.after), {
              stroke: theme.border,
              width: 1,
              dash: '3 3',
            })
          : ''
      return `<g>${rect(x, top, barW, height, { fill, radius: 3 })}${connector}<text x="${x + barW / 2}" y="${Math.max(frame.y + 11, top - 7)}" text-anchor="middle" font-size="11" font-weight="760" fill="${fill}">${state.total ? '' : positive ? '+' : ''}${displayValue(state.row[1], chart.unit)}</text>${text(state.row[0], x + barW / 2, frame.y + frame.height - 34, { size: 11, weight: 650, fill: theme.foreground, width: barW - 6, lines: 2, anchor: 'middle', lineHeight: 1.05 }).svg}</g>`
    })
    .join('')}</g>`
}

function treemap(rendered, frame, theme) {
  const chart = chartNode(rendered)
  if (!chart?.rows?.length) return detailedChart(rendered, frame, theme)
  const groups = new Map()
  for (const row of chart.rows) {
    const group = String(row[1])
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group).push(row)
  }
  const entries = [...groups.entries()].map(([name, rows]) => ({
    name,
    rows,
    total: rows.reduce((sum, row) => sum + Math.max(0, number(row[2])), 0),
  }))
  const total = entries.reduce((sum, entry) => sum + entry.total, 0) || 1
  const compact = frame.width < 500
  let cursor = compact ? frame.y : frame.x
  return `<g>${entries
    .map((entry, groupIndex) => {
      const span = compact ? frame.height / entries.length : (entry.total / total) * frame.width
      const groupBox = compact
        ? { x: frame.x, y: cursor, width: frame.width, height: span }
        : { x: cursor, y: frame.y, width: span, height: frame.height }
      cursor += span
      const headerH = compact ? 34 : 42
      const content = {
        x: groupBox.x,
        y: groupBox.y + headerH,
        width: groupBox.width,
        height: Math.max(0, groupBox.height - headerH),
      }
      let childCursor = content.y
      const children = entry.rows
        .map((row, childIndex) => {
          const childSpan = (Math.max(0, number(row[2])) / Math.max(1, entry.total)) * content.height
          const box = { x: content.x, y: childCursor, width: content.width, height: childSpan }
          childCursor += childSpan
          const room = box.width > 110 && box.height >= 34
          const baseline = box.y + box.height / 2 + 6
          return `<g>${rect(box.x + 2, box.y + 2, box.width - 4, box.height - 4, { fill: theme[`chart_${((groupIndex + childIndex) % 5) + 1}`], opacity: 0.18 + (childIndex % 3) * 0.12, stroke: theme.background, radius: 5 })}${room ? `${text(row[0], box.x + 12, baseline, { size: 11, weight: 740, fill: theme.foreground, width: Math.max(48, box.width - (compact ? 98 : 112)), lines: 1 }).svg}<text x="${box.x + box.width - 12}" y="${baseline}" text-anchor="end" font-size="11" font-weight="680" fill="${theme.muted_foreground}">${displayValue(row[2], chart.unit)}</text>` : ''}</g>`
        })
        .join('')
      return `<g>${rect(groupBox.x + 1, groupBox.y + 1, groupBox.width - 2, groupBox.height - 2, { fill: theme.surface, stroke: theme.border, radius: 8 })}${text(entry.name, groupBox.x + 12, groupBox.y + 25, { size: 11, weight: 780, fill: theme.foreground, width: groupBox.width - 24, lines: 1 }).svg}${children}</g>`
    })
    .join('')}</g>`
}

function sankeyFlow(rendered, frame, theme) {
  const chart = chartNode(rendered)
  if (!chart?.rows?.length) return detailedChart(rendered, frame, theme)
  const links = chart.rows
    .slice(0, 24)
    .map((row) => ({ source: String(row[0]), target: String(row[1]), value: Math.max(0, number(row[2])) }))
  const names = [...new Set(links.flatMap((link) => [link.source, link.target]))]
  const depth = new Map(names.map((name) => [name, 0]))
  for (let pass = 0; pass < names.length; pass += 1) {
    for (const link of links) depth.set(link.target, Math.max(depth.get(link.target), depth.get(link.source) + 1))
  }
  const maxDepth = Math.max(...depth.values(), 1)
  const compact = frame.width < 500
  const stages = Array.from({ length: maxDepth + 1 }, (_, index) => names.filter((name) => depth.get(name) === index))
  const positions = new Map()
  stages.forEach((stage, stageIndex) => {
    stage.forEach((name, index) => {
      const x = compact
        ? frame.x + (index + 0.5) * (frame.width / stage.length)
        : frame.x + stageIndex * (frame.width / maxDepth)
      const y = compact
        ? frame.y + 36 + stageIndex * ((frame.height - 72) / maxDepth)
        : frame.y + (index + 0.5) * (frame.height / stage.length)
      positions.set(name, { x, y })
    })
  })
  const maxValue = Math.max(...links.map((link) => link.value), 1)
  const curves = links
    .map((link, index) => {
      const from = positions.get(link.source)
      const to = positions.get(link.target)
      const width = 2 + (link.value / maxValue) * 13
      const path = compact
        ? `M ${from.x} ${from.y + 12} C ${from.x} ${(from.y + to.y) / 2}, ${to.x} ${(from.y + to.y) / 2}, ${to.x} ${to.y - 12}`
        : `M ${from.x + 8} ${from.y} C ${(from.x + to.x) / 2} ${from.y}, ${(from.x + to.x) / 2} ${to.y}, ${to.x - 8} ${to.y}`
      return `<path d="${path}" fill="none" stroke="${theme[`chart_${(index % 5) + 1}`]}" stroke-opacity="0.32" stroke-width="${width}" stroke-linecap="round"/>`
    })
    .join('')
  const nodes = names
    .map((name, index) => {
      const position = positions.get(name)
      const x = compact ? position.x - 22 : position.x - 7
      const y = compact ? position.y - 7 : position.y - 22
      const width = compact ? 44 : 14
      const height = compact ? 14 : 44
      const stage = stages[depth.get(name)] || []
      const stageItemIndex = stage.indexOf(name)
      const labelY = compact ? (stageItemIndex % 2 ? y + height + 23 : y - 8) : y + height + 15
      const nearStart = position.x - frame.x < 90
      const nearEnd = frame.x + frame.width - position.x < 90
      const anchor = nearStart ? 'start' : nearEnd ? 'end' : 'middle'
      const labelX = position.x + (nearStart ? 2 : nearEnd ? -2 : 0)
      return `<g>${rect(x, y, width, height, { fill: theme[`chart_${(index % 5) + 1}`], stroke: theme.background, strokeWidth: 2, radius: 4 })}${text(name, labelX, labelY, { size: 11, weight: 720, fill: theme.foreground, width: compact ? Math.max(64, frame.width / 2.4) : Math.min(190, frame.width / 3), lines: 1, anchor }).svg}</g>`
    })
    .join('')
  return `<g>${curves}${nodes}</g>`
}

function uncertaintyBand(rendered, frame, theme) {
  const chart = chartNode(rendered)
  if (!chart?.rows?.length) return detailedChart(rendered, frame, theme)
  const rows = chart.rows.slice(0, 30)
  const [min, max] = extent(rows.flatMap((row) => row.slice(1)))
  const left = frame.x + 12
  const right = frame.x + frame.width - 12
  const top = frame.y + 24
  const compact = frame.width < 500
  const bottom = frame.y + frame.height - (compact ? 76 : 46)
  const x = (index) => left + (index / Math.max(1, rows.length - 1)) * (right - left)
  const y = (value) => scale(value, min, max, bottom, top)
  const upper = rows.map((row, index) => `${x(index)},${y(row[3])}`)
  const lower = rows.map((row, index) => `${x(index)},${y(row[1])}`).reverse()
  const estimate = rows.map((row, index) => `${x(index)},${y(row[2])}`)
  const labelLimit = compact ? 5 : 9
  const stride = Math.max(1, Math.ceil(rows.length / labelLimit))
  const visibleLabels = rows
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => index === 0 || index === rows.length - 1 || index % stride === 0)
  return `<g><polygon points="${[...upper, ...lower].join(' ')}" fill="${theme.chart_1}" fill-opacity="0.16"/><polyline points="${estimate.join(' ')}" fill="none" stroke="${theme.chart_1}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${rows.map((row, index) => circle(x(index), y(row[2]), 4, { fill: theme.chart_1, stroke: theme.background, strokeWidth: 2 })).join('')}${visibleLabels
    .map(({ row, index }, labelIndex) => {
      const anchor = index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle'
      const labelY = bottom + (compact ? 28 + (labelIndex % 2) * 24 : 30)
      return `<text x="${x(index)}" y="${labelY}" text-anchor="${anchor}" font-size="11" font-weight="650" fill="${theme.muted_foreground}">${escapeXml(row[0])}</text>`
    })
    .join(
      '',
    )}<text x="${left}" y="${top - 8}" font-size="11" font-weight="700" fill="${theme.chart_1}">Band + estimate</text></g>`
}

function calendarHeatmap(rendered, frame, theme) {
  const chart = chartNode(rendered)
  if (!chart?.rows?.length) return detailedChart(rendered, frame, theme)
  const entries = chart.rows.map((row) => ({ date: new Date(`${row[0]}T00:00:00Z`), value: number(row[1]) }))
  const first = new Date(Math.min(...entries.map((entry) => entry.date.getTime())))
  const mondayOffset = (first.getUTCDay() + 6) % 7
  const origin = new Date(first)
  origin.setUTCDate(first.getUTCDate() - mondayOffset)
  const weeks = Math.max(1, ...entries.map((entry) => Math.floor((entry.date - origin) / 604800000) + 1))
  const [min, max] = extent(entries.map((entry) => entry.value))
  const labelW = frame.width < 500 ? 24 : 42
  const cell = Math.min((frame.width - labelW) / weeks, frame.height / 7)
  const gridW = cell * weeks
  const gridH = cell * 7
  const startX = frame.x + labelW + (frame.width - labelW - gridW) / 2
  const startY = frame.y + (frame.height - gridH) / 2
  const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
  return `<g>${days.map((day, index) => `<text x="${startX - 7}" y="${startY + cell * (index + 0.62)}" text-anchor="end" font-size="11" font-weight="650" fill="${theme.muted_foreground}">${day}</text>`).join('')}${entries
    .map((entry) => {
      const week = Math.floor((entry.date - origin) / 604800000)
      const day = (entry.date.getUTCDay() + 6) % 7
      const x = startX + week * cell
      const y = startY + day * cell
      const intensity = 0.12 + ((entry.value - min) / (max - min || 1)) * 0.82
      return `<g>${rect(x + 2, y + 2, cell - 4, cell - 4, { fill: theme.chart_2, opacity: intensity, radius: Math.min(5, cell * 0.12) })}${cell >= 30 ? `<text x="${x + cell / 2}" y="${y + cell / 2 + 4}" text-anchor="middle" font-size="11" font-weight="750" fill="${intensity > 0.55 ? theme.background : theme.foreground}">${entry.value}</text>` : ''}</g>`
    })
    .join('')}</g>`
}

function coordinateMap(rendered, frame, theme) {
  const chart = chartNode(rendered)
  if (!chart?.rows?.length) return detailedChart(rendered, frame, theme)
  const rows = chart.rows.slice(0, 24)
  const lats = rows.map((row) => number(row[1]))
  const lons = rows.map((row) => number(row[2]))
  const loads = rows.map((row) => Math.max(0, number(row[3])))
  const [minLat, maxLat] = extent(lats)
  const [minLon, maxLon] = extent(lons)
  const left = frame.x + 24
  const right = frame.x + frame.width - 36
  const top = frame.y + 28
  const bottom = frame.y + frame.height - 28
  const maxLoad = Math.max(...loads, 1)
  return `<g>${rect(frame.x, frame.y, frame.width, frame.height, { fill: theme.muted, stroke: theme.border, radius: 14 })}${[0.25, 0.5, 0.75].map((part) => line(left + (right - left) * part, top, left + (right - left) * part, bottom, { stroke: theme.border, width: 1, dash: '3 5' })).join('')}${[0.25, 0.5, 0.75].map((part) => line(left, top + (bottom - top) * part, right, top + (bottom - top) * part, { stroke: theme.border, width: 1, dash: '3 5' })).join('')}${rows
    .map((row, index) => {
      const x = scale(row[2], minLon, maxLon, left, right)
      const y = scale(row[1], minLat, maxLat, bottom, top)
      const radius = 5 + Math.sqrt(loads[index] / maxLoad) * 14
      const anchor = x > right - 80 ? 'end' : 'start'
      const labelY = Math.max(top + 13, Math.min(bottom - 4, y + (index % 2 ? -13 : 42)))
      return `<g>${circle(x, y, radius, { fill: theme.chart_1, stroke: theme.background, strokeWidth: 3 })}<text x="${x + (anchor === 'end' ? -radius - 5 : radius + 5)}" y="${labelY}" text-anchor="${anchor}" font-size="11" font-weight="720" fill="${theme.foreground}">${escapeXml(row[0])}</text></g>`
    })
    .join('')}${
    text(
      frame.width < 500
        ? `Circle area = ${chart.headers[3]}`
        : `Coordinate projection · circle area = ${chart.headers[3]}`,
      frame.x + 12,
      frame.y + 18,
      {
        size: 11,
        weight: 700,
        fill: theme.muted_foreground,
        width: frame.width - 24,
        lines: 1,
      },
    ).svg
  }</g>`
}

function tileChoropleth(rendered, frame, theme) {
  const chart = chartNode(rendered)
  if (!chart?.rows?.length) return detailedChart(rendered, frame, theme)
  const rows = chart.rows.slice(0, 24)
  const compact = frame.width < 500
  const key = (value) =>
    String(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
  const germany = new Map([
    ['schleswig-holstein', [2, 0]],
    ['hamburg', [2, 1]],
    ['mecklenburg-vorpommern', [4, 1]],
    ['bremen', [0, 2]],
    ['niedersachsen', [1, 2]],
    ['berlin', [3, 2]],
    ['brandenburg', [4, 2]],
    ['nordrhein-westfalen', [0, 3]],
    ['hessen', [1, 3]],
    ['sachsen-anhalt', [2, 3]],
    ['sachsen', [4, 3]],
    ['rheinland-pfalz', [0, 4]],
    ['thuringen', [3, 4]],
    ['saarland', [0, 5]],
    ['baden-wurttemberg', [2, 5]],
    ['bayern', [4, 5]],
  ])
  const preservesTopology = !compact && rows.every((row) => germany.has(key(row[0])))
  const columns = preservesTopology ? 5 : compact ? 3 : Math.min(5, Math.ceil(Math.sqrt(rows.length * 1.35)))
  const gridRows = preservesTopology ? 6 : Math.ceil(rows.length / columns)
  const gap = 10
  const cellW = (frame.width - gap * (columns - 1)) / columns
  const cellH = (frame.height - gap * (gridRows - 1)) / gridRows
  const [min, max] = extent(rows.map((row) => row[1]))
  const regionCodes = new Map([
    ['schleswig-holstein', 'SH'],
    ['hamburg', 'HH'],
    ['mecklenburg-vorpommern', 'MV'],
    ['bremen', 'HB'],
    ['niedersachsen', 'NI'],
    ['berlin', 'BE'],
    ['brandenburg', 'BB'],
    ['nordrhein-westfalen', 'NW'],
    ['hessen', 'HE'],
    ['sachsen-anhalt', 'ST'],
    ['sachsen', 'SN'],
    ['rheinland-pfalz', 'RP'],
    ['thuringen', 'TH'],
    ['saarland', 'SL'],
    ['baden-wurttemberg', 'BW'],
    ['bayern', 'BY'],
  ])
  const regionalLabel = (value) => {
    if (compact) return regionCodes.get(key(value)) || String(value)
    return key(value) === 'mecklenburg-vorpommern' ? 'Meckl.-Vorpommern' : String(value)
  }
  return `<g>${rows
    .map((row, index) => {
      const [column, gridRow] = preservesTopology
        ? germany.get(key(row[0]))
        : [index % columns, Math.floor(index / columns)]
      const x = frame.x + column * (cellW + gap)
      const safeW = cellW
      const y = frame.y + gridRow * (cellH + gap)
      const intensity = 0.14 + ((number(row[1]) - min) / (max - min || 1)) * 0.8
      return `<g>${rect(x, y, safeW, cellH, { fill: theme.chart_4, opacity: intensity, stroke: theme.background, strokeWidth: 2, radius: 12 })}${text(regionalLabel(row[0]), x + safeW / 2, y + cellH * 0.34, { size: 11, weight: 740, fill: intensity > 0.58 ? theme.background : theme.foreground, width: safeW - 24, lines: 1, anchor: 'middle' }).svg}<text x="${x + safeW / 2}" y="${y + cellH * 0.82}" text-anchor="middle" font-size="11" font-weight="760" fill="${intensity > 0.58 ? theme.background : theme.foreground}">${displayValue(row[1], chart.unit)}</text></g>`
    })
    .join('')}</g>`
}

function beeswarmDistribution(rendered, frame, theme) {
  const chart = chartNode(rendered)
  if (!chart?.rows?.length) return detailedChart(rendered, frame, theme)
  const groups = [...new Set(chart.rows.map((row) => String(row[0])))]
  const [min, max] = extent(chart.rows.map((row) => row[1]))
  const compact = frame.width < 500
  const labelW = frame.width * 0.16
  const plotX = compact ? frame.x : frame.x + labelW + 8
  const plotW = frame.width - (compact ? 0 : labelW + 16)
  const headerH = compact ? 28 : 0
  const rowH = (frame.height - headerH) / groups.length
  return `<g>${groups
    .map((group, groupIndex) => {
      const values = chart.rows
        .filter((row) => String(row[0]) === group)
        .map((row) => number(row[1]))
        .sort((a, b) => a - b)
      const rowY = frame.y + headerH + rowH * groupIndex
      const centerY = compact ? rowY + rowH * 0.63 : rowY + rowH * 0.5
      const points = values
        .map((value, index) => {
          const offsetIndex = index % 2 ? Math.ceil(index / 2) : -Math.floor(index / 2)
          const cy = Math.max(
            frame.y + 6,
            Math.min(frame.y + frame.height - 6, centerY + offsetIndex * Math.min(11, rowH * 0.13)),
          )
          return circle(scale(value, min, max, plotX, plotX + plotW), cy, 5, {
            fill: theme[`chart_${(groupIndex % 5) + 1}`],
            stroke: theme.background,
            strokeWidth: 1.5,
          })
        })
        .join('')
      const median = values[Math.floor(values.length / 2)]
      const medianX = scale(median, min, max, plotX, plotX + plotW)
      return `<g>${text(group, frame.x, compact ? rowY + 24 : centerY + 5, { size: 12, weight: 680, fill: theme.foreground, width: compact ? frame.width : labelW - 8, lines: 1 }).svg}${line(plotX, centerY, plotX + plotW, centerY, { stroke: theme.border, width: 1 })}${points}${line(medianX, centerY - Math.min(20, rowH * 0.3), medianX, centerY + Math.min(20, rowH * 0.3), { stroke: theme.foreground, width: 2 })}</g>`
    })
    .join(
      '',
    )}<text x="${plotX}" y="${frame.y + 12}" font-size="11" font-weight="650" fill="${theme.muted_foreground}">${displayValue(min, chart.unit)}</text><text x="${plotX + plotW}" y="${frame.y + 12}" text-anchor="end" font-size="11" font-weight="650" fill="${theme.muted_foreground}">${displayValue(max, chart.unit)}</text></g>`
}

function renderPattern(rendered, pattern, items, frame, theme) {
  const information = renderInformationPattern({
    rendered,
    pattern,
    items,
    frame,
    theme,
    ui: { rect, line, circle, text, clean, escapeXml },
  })
  if (information != null) return information
  switch (pattern.id) {
    case 'editorial-poster':
      return editorialPoster(items, frame, theme, rendered)
    case 'stratified-story':
      return stratified(items, frame, theme)
    case 'bento-summary':
      return bento(items, frame, theme)
    case 'grouped-dashboard':
      return dashboard(items, frame, theme)
    case 'table-dashboard':
      return dashboard(items, frame, theme, true)
    case 'executive-brief':
      return executiveBrief(items, frame, theme, rendered)
    case 'magazine-story':
      return magazineStory(items, frame, theme)
    case 'hero-banner':
      return heroBanner(items, frame, theme, rendered)
    case 'metric-card':
      return metricCard(items, frame, theme)
    case 'metric-wall':
      return grid(
        items.filter((item) => item.type !== 'group'),
        frame,
        theme,
        frame.width < 500 ? 1 : Math.min(3, Math.max(1, items.length)),
        { gap: 16 },
      )
    case 'scorecard':
      return scorecard(items, frame, theme)
    case 'kpi-strip':
      return kpiStrip(items, frame, theme)
    case 'progress-rings':
      return progressRings(items, frame, theme)
    case 'bullet-scoreboard':
      return bulletScoreboard(items, frame, theme)
    case 'connected-process':
      return connected(items, frame, theme)
    case 'vertical-journey':
      return connected(items, frame, theme, true)
    case 'circular-lifecycle':
      return cycle(items, frame, theme)
    case 'funnel':
      return funnel(items, frame, theme)
    case 'chevron-process':
      return chevronProcess(items, frame, theme)
    case 'swimlane-process':
      return swimlane(items, frame, theme)
    case 'split-comparison':
      return split(items, frame, theme)
    case 'before-after':
      return split(items, frame, theme, true)
    case 'comparison-matrix':
      return matrix(items, frame, theme)
    case 'feature-table':
      return featureTable(items, frame, theme)
    case 'spectrum-comparison':
      return spectrum(items, frame, theme)
    case 'horizontal-timeline':
      return timeline(items, frame, theme)
    case 'vertical-timeline':
      return timeline(items, frame, theme, true)
    case 'roadmap':
      return roadmap(items, frame, theme)
    case 'milestone-roadmap':
      return milestoneRoadmap(items, frame, theme)
    case 'phase-timeline':
      return phaseTimeline(items, frame, theme)
    case 'tree-hierarchy':
      return tree(items, frame, theme)
    case 'layer-stack':
      return layers(items, frame, theme)
    case 'pyramid':
      return pyramid(items, frame, theme)
    case 'hub-and-spoke':
      return hub(items, frame, theme)
    case 'concentric-layers':
      return concentric(items, frame, theme)
    case 'architecture-map':
      return architectureMap(items, frame, theme)
    case 'detailed-chart':
      return detailedChart(rendered, frame, theme)
    case 'ranked-bars':
      return rankedBars(rendered, frame, theme)
    case 'lollipop-chart':
      return rankedBars(rendered, frame, theme, true)
    case 'slope-chart':
      return slopeChart(rendered, frame, theme)
    case 'small-multiples':
      return smallMultiples(rendered, frame, theme)
    case 'range-dot-plot':
      return intervalPlot(rendered, frame, theme)
    case 'dumbbell-change':
      return intervalPlot(rendered, frame, theme, 'change')
    case 'diverging-bars':
      return divergingBars(rendered, frame, theme)
    case 'likert-distribution':
      return likertDistribution(rendered, frame, theme)
    case 'scatter-correlation':
      return scatterCorrelation(rendered, frame, theme)
    case 'distribution-boxplot':
      return distributionBoxplot(rendered, frame, theme)
    case 'data-heatmap':
      return dataHeatmap(rendered, frame, theme)
    case 'waterfall':
      return waterfall(rendered, frame, theme)
    case 'treemap':
      return treemap(rendered, frame, theme)
    case 'sankey-flow':
      return sankeyFlow(rendered, frame, theme)
    case 'uncertainty-band':
      return uncertaintyBand(rendered, frame, theme)
    case 'calendar-heatmap':
      return calendarHeatmap(rendered, frame, theme)
    case 'coordinate-map':
      return coordinateMap(rendered, frame, theme)
    case 'tile-choropleth':
      return tileChoropleth(rendered, frame, theme)
    case 'beeswarm-distribution':
      return beeswarmDistribution(rendered, frame, theme)
    default:
      return grid(items, frame, theme, Math.min(3, Math.max(1, Math.ceil(Math.sqrt(items.length)))))
  }
}

function header() {
  return { height: 1, svg: '' }
}

export function renderCompositionArtifact(rendered, { settings = {}, scheme = 'light', viewport, container } = {}) {
  if (!rendered.composition) return null
  const canvas = viewport || canvases[rendered.composition.canvas] || canvases.portrait
  const width = Math.round(canvas.width)
  const height = Math.round(canvas.height)
  return withResponsiveTypography(width, () => {
    const margin = width < 700 ? 28 : Math.max(52, Math.round(width * 0.045))
    const theme = compositionTheme(settings, scheme)
    const pattern = getPattern(rendered.composition.resolved_pattern)
    const allItems = visualItems(rendered)
    const informationLimits = {
      'faq-list': width < 700 ? 2 : 5,
      'faq-columns': width < 700 ? 4 : 8,
      'faq-categorized': width < 700 ? 4 : 8,
      'tabbed-code': 3,
      'file-code': 3,
      'code-walkthrough': 4,
      'gallery-grid': width < 700 ? 6 : 9,
      'editorial-gallery': width < 700 ? 5 : 7,
      'captioned-gallery': width < 700 ? 6 : 8,
      'responsive-data-table': width < 700 ? 6 : 10,
      'grouped-data-table': width < 700 ? 6 : 10,
      'record-cards': width < 700 ? 3 : 8,
    }
    const renderLimit = informationLimits[pattern.id] || 24
    const items = allItems.slice(0, renderLimit)
    const top = header(rendered, pattern, width, margin, theme)
    const footerHeight = 12
    const frame = {
      x: margin,
      y: top.height + Math.max(26, margin * 0.58),
      width: width - margin * 2,
      height: height - top.height - Math.max(26, margin * 0.58) - margin - footerHeight - 8,
    }
    const description = accessibleCompositionText(rendered)
    const body = renderPattern(rendered, pattern, items, frame, theme)
    const footer = ''
    const layout = buildCompositionLayoutTree({
      rendered,
      pattern,
      width,
      height,
      margin,
      headerHeight: top.height,
      frame,
      footerHeight,
      viewport: viewport || { width, height },
      container,
      renderLimit,
    })
    const renderTree = createCompositionRenderTree({
      width,
      height,
      title: rendered.meta.title,
      description,
      metadata: {
        schema_version: '1',
        pattern: pattern.id,
        registry_hash: patternRegistryHash,
        layout_schema_version: layout.tree.schema_version,
      },
      definitions: `<style>${embeddedFontCss}text{font-family:${contentkitFontFamilyCompact};font-kerning:normal;font-variant-ligatures:common-ligatures;text-rendering:geometricPrecision}</style><linearGradient id="ck-canvas" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${theme.background}"/><stop offset="1" stop-color="${theme.subtle}"/></linearGradient><filter id="ck-card-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="${theme.shadow}" flood-opacity="0.08"/></filter><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${theme.foreground}"/></marker>`,
      background: 'url(#ck-canvas)',
      layers: [
        {
          type: 'markup',
          id: 'header',
          role: 'banner',
          box: layout.tree.children[0].box,
          markup: top.svg,
        },
        {
          type: 'markup',
          id: 'content',
          role: 'main',
          adapter: pattern.id,
          box: frame,
          source_node_ids: layout.tree.children[1].node_ids,
          markup: body,
        },
        {
          type: 'markup',
          id: 'footer',
          role: 'contentinfo',
          box: layout.tree.children[2].box,
          markup: footer,
        },
      ],
    })
    const svg = resolveRawTypography(serializeCompositionRenderTree(renderTree), width)
    return {
      svg,
      layout_tree: layout.tree,
      render_tree: publicRenderTree(renderTree),
      diagnostics: layout.diagnostics,
    }
  })
}

export function renderCompositionSvg(rendered, options = {}) {
  return renderCompositionArtifact(rendered, options)?.svg || null
}

export function renderSpecializedReportChartSvg(
  chart,
  { settings = {}, scheme = 'light', width = 960, height = 480 } = {},
) {
  const theme = compositionTheme(settings, scheme)
  const rendered = { semantic: { nodes: [{ ...chart, type: 'chart', chart_type: chart.type }] } }
  const frame = { x: 42, y: 32, width: width - 84, height: height - 64 }
  const renderers = {
    range: () => intervalPlot(rendered, frame, theme),
    change: () => intervalPlot(rendered, frame, theme, 'change'),
    diverging: () => divergingBars(rendered, frame, theme),
    likert: () => likertDistribution(rendered, frame, theme),
    xy: () => scatterCorrelation(rendered, frame, theme),
    boxplot: () => distributionBoxplot(rendered, frame, theme),
    matrix: () => dataHeatmap(rendered, frame, theme),
    waterfall: () => waterfall(rendered, frame, theme),
    hierarchy: () => treemap(rendered, frame, theme),
    flow: () => sankeyFlow(rendered, frame, theme),
    uncertainty: () => uncertaintyBand(rendered, frame, theme),
    calendar: () => calendarHeatmap(rendered, frame, theme),
    'geo-point': () => coordinateMap(rendered, frame, theme),
    'geo-region': () => tileChoropleth(rendered, frame, theme),
    samples: () => beeswarmDistribution(rendered, frame, theme),
  }
  return withResponsiveTypography(width, () => {
    const body = renderers[chart.data_shape]?.()
    if (!body) return null
    const description = `${chart.description}. Source data follows as an accessible table.`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title chart-description"><title id="chart-title">${escapeXml(chart.title || chart.description)}</title><desc id="chart-description">${escapeXml(description)}</desc><defs><style>${embeddedFontCss}text{font-family:${contentkitFontFamilyCompact};font-kerning:normal;font-variant-ligatures:common-ligatures;text-rendering:geometricPrecision}</style></defs><rect width="${width}" height="${height}" fill="${theme.background}"/>${body}</svg>`
    return { width, height, svg: resolveRawTypography(svg, width) }
  })
}
