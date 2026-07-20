import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { AriaComponent, DatasetComponent, GridComponent, LegendComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { renderSpecializedReportChartSvg } from './composition-svg.mjs'
import { contentkitFontFamily, contentkitFontFamilyCompact } from './typography.mjs'
import { escapeHtml, escapeXml } from './utils.mjs'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  AriaComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  SVGRenderer,
])

const DEFAULT_THEME = {
  light: {
    background: '#ffffff',
    foreground: '#18181b',
    muted_foreground: '#52525b',
    border: '#d4d4d8',
    chart_1: '#2563eb',
    chart_2: '#0f766e',
    chart_3: '#b45309',
    chart_4: '#7c3aed',
    chart_5: '#be123c',
  },
  dark: {
    background: '#18181b',
    foreground: '#fafafa',
    muted_foreground: '#d4d4d8',
    border: '#52525b',
    chart_1: '#60a5fa',
    chart_2: '#5eead4',
    chart_3: '#fbbf24',
    chart_4: '#c4b5fd',
    chart_5: '#fda4af',
  },
}

const COLOR_KEYS = [
  'background',
  'foreground',
  'muted_foreground',
  'border',
  ...Array.from({ length: 5 }, (_, i) => `chart_${i + 1}`),
]

function cssColor(value, fallback) {
  const raw = String(value || '').trim()
  if (/^-?(?:\d+(?:\.\d+)?|\.\d+)\s+-?(?:\d+(?:\.\d+)?|\.\d+)%\s+-?(?:\d+(?:\.\d+)?|\.\d+)%$/.test(raw)) {
    return `hsl(${raw})`
  }
  if (/^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([^<>]+\)|[a-z]+)$/i.test(raw)) return raw
  return fallback
}

export function reportChartTheme(settings = {}, scheme = 'light') {
  const defaults = DEFAULT_THEME[scheme]
  const authored = settings.theme?.tokens || {}
  return Object.fromEntries(
    COLOR_KEYS.map((key) => {
      const token = authored[key]
      const raw = token && typeof token === 'object' ? token[scheme] : token
      return [key, cssColor(raw, defaults[key])]
    }),
  )
}

function canonicalSvg(svg, description) {
  const names = new Map()
  return String(svg)
    .replace('<svg ', `<svg role="img" aria-labelledby="chart-title chart-description" `)
    .replace(
      /(<svg\b[^>]*>)/,
      `$1<title id="chart-title">${escapeXml(description)}</title><desc id="chart-description">${escapeXml(description)}. The source data follows the chart in an accessible table.</desc>`,
    )
    .replace(/zr\d+-[a-z]+-?\d+/g, (name) => {
      if (!names.has(name)) names.set(name, `ck-chart-${names.size}`)
      return names.get(name)
    })
}

function noDataSvg(chart, theme, locale, width, height) {
  const label = String(locale).toLowerCase().startsWith('de') ? 'Keine Daten' : 'No data'
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="chart-title chart-description"><title id="chart-title">${escapeXml(chart.description)}</title><desc id="chart-description">${label}</desc><rect width="${width}" height="${height}" fill="none"/><text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="central" fill="${escapeXml(theme.muted_foreground)}" font-family="${contentkitFontFamilyCompact}" font-size="14">${label}</text></svg>`
}

function valueFormatter(locale, unit) {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 })
  return (value) => `${formatter.format(Number(value))}${unit ? ` ${unit}` : ''}`
}

function cartesianOption(chart, theme, locale, compact = false) {
  const horizontal = chart.type === 'bar' && chart.orientation === 'horizontal'
  const format = valueFormatter(locale, chart.unit)
  const seriesCount = chart.headers.length - 1
  const showValues = chart.rows.length <= 12 && seriesCount <= 2
  const categoryAxis = {
    type: 'category',
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      color: theme.muted_foreground,
      fontSize: compact ? 12 : 13,
      margin: compact ? 10 : 14,
      hideOverlap: true,
    },
    splitLine: { show: false },
  }
  const valueAxis = {
    type: 'value',
    scale: chart.type === 'line',
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      color: theme.muted_foreground,
      fontSize: compact ? 10 : 12,
      margin: compact ? 8 : 12,
      formatter: format,
    },
    splitLine: { lineStyle: { color: theme.border, width: 1 } },
  }
  const seriesType = chart.type === 'bar' ? 'bar' : 'line'
  return {
    animation: false,
    useUTC: true,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: contentkitFontFamily, fontSize: compact ? 12 : 13, color: theme.foreground },
    color: Array.from({ length: 5 }, (_, i) => theme[`chart_${i + 1}`]),
    aria: { enabled: true, description: chart.description, decal: { show: false } },
    dataset: { source: [chart.headers, ...chart.rows] },
    grid: compact
      ? {
          top: seriesCount > 1 ? 66 : 24,
          right: showValues ? 44 : 24,
          bottom: 56,
          left: horizontal ? 104 : 58,
        }
      : { top: seriesCount > 1 ? 58 : 28, right: showValues ? 76 : 42, bottom: 58, left: 82 },
    legend: {
      show: chart.headers.length > 2,
      top: 0,
      textStyle: { color: theme.foreground, fontSize: compact ? 10 : 12 },
      itemWidth: compact ? 12 : 18,
      itemHeight: 3,
      itemGap: 22,
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: chart.headers.slice(1).map((name, index) => ({
      name,
      type: seriesType,
      encode: horizontal ? { x: name, y: chart.headers[0] } : { x: chart.headers[0], y: name },
      stack: chart.stacked ? 'total' : undefined,
      silent: true,
      emphasis: { disabled: true },
      barMaxWidth: 34,
      itemStyle: chart.type === 'bar' ? { borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] } : undefined,
      lineStyle: seriesType === 'line' ? { width: 3, type: ['solid', 'dashed', 'dotted'][index % 3] } : undefined,
      symbol: chart.rows.length <= 30 ? 'circle' : 'none',
      symbolSize: 6,
      areaStyle: chart.type === 'area' ? { opacity: 0.09 } : undefined,
      label: showValues
        ? {
            show: true,
            position: horizontal ? 'right' : 'top',
            distance: 7,
            color: theme.foreground,
            fontSize: compact ? 11 : 12,
            fontWeight: 600,
            formatter: ({ value }) => format(Array.isArray(value) ? value[index + 1] : value),
          }
        : undefined,
      connectNulls: false,
    })),
  }
}

function donutOption(chart, theme, locale) {
  const format = valueFormatter(locale, chart.unit)
  const total = chart.rows.reduce((sum, row) => sum + Number(row[1] || 0), 0)
  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: contentkitFontFamily, color: theme.foreground },
    color: Array.from({ length: 5 }, (_, i) => theme[`chart_${i + 1}`]),
    aria: { enabled: true, description: chart.description, decal: { show: false } },
    legend: { show: false },
    series: [
      {
        name: chart.headers[1],
        type: 'pie',
        radius: ['47%', '68%'],
        center: ['50%', '50%'],
        silent: true,
        emphasis: { disabled: true },
        avoidLabelOverlap: true,
        itemStyle: { borderColor: theme.background, borderWidth: 4, borderRadius: 3 },
        label: {
          color: theme.foreground,
          fontSize: 12,
          lineHeight: 18,
          formatter: ({ name, value }) =>
            `${name}\n${format(value)} · ${total ? Math.round((Number(value) / total) * 100) : 0}%`,
        },
        labelLine: { length: 14, length2: 12, lineStyle: { color: theme.muted_foreground, width: 1 } },
        data: chart.rows.map(([name, value]) => ({ name, value })),
      },
    ],
  }
}

export function renderReportChartSvg(
  chart,
  { settings = {}, scheme = 'light', locale = 'en', width: requestedWidth, height: requestedHeight } = {},
) {
  if (chart.data_shape && chart.data_shape !== 'series') {
    const specialized = renderSpecializedReportChartSvg(chart, {
      settings,
      scheme,
      width: requestedWidth,
      height: requestedHeight,
    })
    if (specialized) return specialized
  }
  const defaultWidth = chart.type === 'donut' ? 760 : 960
  const defaultHeight = chart.type === 'donut' ? 460 : 480
  const width = Math.max(320, Math.min(1920, Number(requestedWidth) || defaultWidth))
  const height = Math.max(280, Math.min(1600, Number(requestedHeight) || defaultHeight))
  const compact = width <= 480
  const theme = reportChartTheme(settings, scheme)
  const values = chart.rows.flatMap((row) => row.slice(1)).filter((value) => value != null)
  if (!values.length || (chart.type === 'donut' && values.every((value) => value === 0))) {
    return { svg: noDataSvg(chart, theme, locale, width, height), width, height }
  }
  const instance = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height })
  try {
    instance.setOption(
      chart.type === 'donut' ? donutOption(chart, theme, locale) : cartesianOption(chart, theme, locale, compact),
    )
    return { svg: canonicalSvg(instance.renderToSVGString(), chart.description), width, height }
  } finally {
    instance.dispose()
  }
}

const dataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

export function materializeReportCharts(
  rendered,
  { settings = {}, locale = rendered.meta?.locale || 'en', emit } = {},
) {
  if (!rendered.charts?.length) return rendered
  const chartById = new Map(rendered.charts.map((chart) => [String(chart.id), chart]))
  const html = rendered.html.replace(
    /<div class="report-chart-visual" data-report-chart="(\d+)"><\/div>/g,
    (placeholder, id) => {
      const chart = chartById.get(id)
      if (!chart) return placeholder
      const light = renderReportChartSvg(chart, { settings, scheme: 'light', locale })
      const dark = renderReportChartSvg(chart, { settings, scheme: 'dark', locale })
      const lightUrl = emit ? emit(light.svg, { chart, scheme: 'light' }) : dataUri(light.svg)
      const darkUrl =
        light.svg === dark.svg ? lightUrl : emit ? emit(dark.svg, { chart, scheme: 'dark' }) : dataUri(dark.svg)
      const specialized = chart.data_shape && chart.data_shape !== 'series'
      const mobileLight = renderReportChartSvg(chart, {
        settings,
        scheme: 'light',
        locale,
        width: 390,
        height: specialized ? 620 : 360,
      })
      const mobileDark = renderReportChartSvg(chart, {
        settings,
        scheme: 'dark',
        locale,
        width: 390,
        height: specialized ? 620 : 360,
      })
      const mobileLightUrl = emit
        ? emit(mobileLight.svg, { chart, scheme: 'light', viewport: 'mobile' })
        : dataUri(mobileLight.svg)
      const mobileDarkUrl =
        mobileLight.svg === mobileDark.svg
          ? mobileLightUrl
          : emit
            ? emit(mobileDark.svg, { chart, scheme: 'dark', viewport: 'mobile' })
            : dataUri(mobileDark.svg)
      const mobileSources = `${mobileDarkUrl !== mobileLightUrl ? `<source media="(prefers-color-scheme: dark) and (max-width: 760px)" srcset="${escapeHtml(mobileDarkUrl)}">` : ''}<source media="(max-width: 760px)" srcset="${escapeHtml(mobileLightUrl)}">`
      return `<picture class="report-chart-picture">${mobileSources}${darkUrl !== lightUrl ? `<source media="(prefers-color-scheme: dark)" srcset="${escapeHtml(darkUrl)}">` : ''}<img src="${escapeHtml(lightUrl)}" alt="${escapeHtml(chart.description)}" width="${light.width}" height="${light.height}" loading="lazy" decoding="async"></picture>`
    },
  )
  return { ...rendered, html }
}
