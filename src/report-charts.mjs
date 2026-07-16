import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { AriaComponent, DatasetComponent, GridComponent, LegendComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
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
    background: 'hsl(0 0% 100%)',
    foreground: 'hsl(222.2 84% 4.9%)',
    muted_foreground: 'hsl(215.4 16.3% 46.9%)',
    border: 'hsl(214.3 31.8% 91.4%)',
    chart_1: 'hsl(221 83% 53%)',
    chart_2: 'hsl(160 84% 39%)',
    chart_3: 'hsl(38 92% 50%)',
    chart_4: 'hsl(262 83% 58%)',
    chart_5: 'hsl(0 72% 51%)',
  },
  dark: {
    background: 'hsl(222.2 84% 4.9%)',
    foreground: 'hsl(210 40% 98%)',
    muted_foreground: 'hsl(215 20.2% 65.1%)',
    border: 'hsl(217.2 32.6% 17.5%)',
    chart_1: 'hsl(217 91% 60%)',
    chart_2: 'hsl(158 64% 52%)',
    chart_3: 'hsl(43 96% 56%)',
    chart_4: 'hsl(270 95% 75%)',
    chart_5: 'hsl(0 91% 71%)',
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
    .replace('<svg ', `<svg role="img" aria-label="${escapeXml(description)}" `)
    .replace(/zr\d+-[a-z]+-\d+/g, (name) => {
      if (!names.has(name)) names.set(name, `ck-chart-${names.size}`)
      return names.get(name)
    })
}

function noDataSvg(chart, theme, locale, width, height) {
  const label = String(locale).toLowerCase().startsWith('de') ? 'Keine Daten' : 'No data'
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(chart.description)}"><rect width="${width}" height="${height}" fill="none"/><text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="central" fill="${escapeXml(theme.muted_foreground)}" font-family="Inter,ui-sans-serif,system-ui,sans-serif" font-size="14">${label}</text></svg>`
}

function valueFormatter(locale, unit) {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 })
  return (value) => `${formatter.format(Number(value))}${unit ? ` ${unit}` : ''}`
}

function cartesianOption(chart, theme, locale) {
  const horizontal = chart.type === 'bar' && chart.orientation === 'horizontal'
  const format = valueFormatter(locale, chart.unit)
  const categoryAxis = {
    type: 'category',
    axisLine: { lineStyle: { color: theme.border } },
    axisTick: { show: false },
    axisLabel: { color: theme.muted_foreground, hideOverlap: true },
    splitLine: { show: false },
  }
  const valueAxis = {
    type: 'value',
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: theme.muted_foreground, formatter: format },
    splitLine: { lineStyle: { color: theme.border, type: 'dashed' } },
  }
  const seriesType = chart.type === 'bar' ? 'bar' : 'line'
  return {
    animation: false,
    useUTC: true,
    color: Array.from({ length: 5 }, (_, i) => theme[`chart_${i + 1}`]),
    aria: { enabled: true, description: chart.description, decal: { show: false } },
    dataset: { source: [chart.headers, ...chart.rows] },
    grid: { top: chart.headers.length > 2 ? 48 : 24, right: 40, bottom: 56, left: 88 },
    legend: {
      show: chart.headers.length > 2,
      top: 0,
      textStyle: { color: theme.muted_foreground },
      itemWidth: 14,
      itemHeight: 8,
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: chart.headers.slice(1).map((name) => ({
      name,
      type: seriesType,
      encode: horizontal ? { x: name, y: chart.headers[0] } : { x: chart.headers[0], y: name },
      stack: chart.stacked ? 'total' : undefined,
      silent: true,
      emphasis: { disabled: true },
      barMaxWidth: 48,
      itemStyle: chart.type === 'bar' ? { borderRadius: horizontal ? [0, 5, 5, 0] : [5, 5, 0, 0] } : undefined,
      lineStyle: seriesType === 'line' ? { width: 3 } : undefined,
      symbol: chart.rows.length <= 30 ? 'circle' : 'none',
      symbolSize: 7,
      areaStyle: chart.type === 'area' ? { opacity: 0.18 } : undefined,
      connectNulls: false,
    })),
  }
}

function donutOption(chart, theme, locale) {
  const format = valueFormatter(locale, chart.unit)
  return {
    animation: false,
    color: Array.from({ length: 5 }, (_, i) => theme[`chart_${i + 1}`]),
    aria: { enabled: true, description: chart.description, decal: { show: false } },
    legend: {
      orient: 'vertical',
      right: 16,
      top: 'middle',
      textStyle: { color: theme.muted_foreground },
      itemWidth: 14,
      itemHeight: 8,
    },
    series: [
      {
        name: chart.headers[1],
        type: 'pie',
        radius: ['46%', '72%'],
        center: ['38%', '50%'],
        silent: true,
        emphasis: { disabled: true },
        avoidLabelOverlap: true,
        itemStyle: { borderColor: theme.background, borderWidth: 3, borderRadius: 5 },
        label: { color: theme.foreground, formatter: ({ name, value }) => `${name}\n${format(value)}` },
        labelLine: { lineStyle: { color: theme.border } },
        data: chart.rows.map(([name, value]) => ({ name, value })),
      },
    ],
  }
}

export function renderReportChartSvg(chart, { settings = {}, scheme = 'light', locale = 'en' } = {}) {
  const width = chart.type === 'donut' ? 640 : 800
  const height = 360
  const theme = reportChartTheme(settings, scheme)
  const values = chart.rows.flatMap((row) => row.slice(1)).filter((value) => value != null)
  if (!values.length || (chart.type === 'donut' && values.every((value) => value === 0))) {
    return { svg: noDataSvg(chart, theme, locale, width, height), width, height }
  }
  const instance = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height })
  try {
    instance.setOption(
      chart.type === 'donut' ? donutOption(chart, theme, locale) : cartesianOption(chart, theme, locale),
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
      return `<picture class="report-chart-picture">${darkUrl !== lightUrl ? `<source media="(prefers-color-scheme: dark)" srcset="${escapeHtml(darkUrl)}">` : ''}<img src="${escapeHtml(lightUrl)}" alt="${escapeHtml(chart.description)}" width="${light.width}" height="${light.height}" loading="lazy" decoding="async"></picture>`
    },
  )
  return { ...rendered, html }
}
