import test from 'node:test'
import assert from 'node:assert/strict'
import { materializeReportCharts, renderReportChartSvg, reportChartTheme } from '../../src/report-charts.mjs'

const bar = {
  id: 0,
  type: 'bar',
  title: 'Revenue',
  description: 'Revenue by month',
  orientation: 'vertical',
  stacked: false,
  unit: '€',
  headers: ['Month', 'Revenue'],
  rows: [
    ['Jan', 42],
    ['Feb', 51],
  ],
}

test('report SVGs are deterministic, static and accessible', () => {
  const first = renderReportChartSvg(bar, { locale: 'en', scheme: 'light' })
  const second = renderReportChartSvg(bar, { locale: 'en', scheme: 'light' })
  assert.equal(first.svg, second.svg)
  assert.match(first.svg, /^<svg[^>]+width="960"[^>]+height="480"/)
  assert.match(first.svg, /aria-labelledby="chart-title chart-description"/)
  assert.match(first.svg, /<title id="chart-title">Revenue by month<\/title>/)
  assert.match(first.svg, /<desc id="chart-description">/)
  assert.doesNotMatch(first.svg, /zr\d+-/)
  assert.doesNotMatch(first.svg, /<script|javascript:|(?:href|src)="https?:\/\//i)

  const mobile = renderReportChartSvg(bar, { locale: 'en', scheme: 'light', width: 390, height: 360 })
  assert.equal(mobile.width, 390)
  assert.equal(mobile.height, 360)
  assert.match(mobile.svg, /^<svg[^>]+width="390"[^>]+height="360"/)
})

test('authored labels and descriptions stay text inside the generated SVG', () => {
  const rendered = renderReportChartSvg(
    {
      ...bar,
      description: 'Revenue <script>alert("description")</script>',
      rows: [['<script>alert("label")</script>', 42]],
    },
    { locale: 'en' },
  )
  assert.doesNotMatch(rendered.svg, /<script|alert\("(?:description|label)"\)/)
  assert.match(rendered.svg, /&lt;script&gt;/)
})

test('chart themes consume allowlisted light and dark design tokens', () => {
  const settings = {
    theme: {
      tokens: {
        chart_1: { light: '#112233', dark: '210 80% 70%' },
        foreground: { light: '#010203', dark: '#fefefe' },
      },
    },
  }
  assert.equal(reportChartTheme(settings, 'light').chart_1, '#112233')
  assert.equal(reportChartTheme(settings, 'dark').chart_1, 'hsl(210 80% 70%)')
  assert.equal(reportChartTheme(settings, 'dark').foreground, '#fefefe')
})

test('all-missing data renders a localized empty SVG state', () => {
  const empty = renderReportChartSvg({ ...bar, rows: [['Jan', null]] }, { locale: 'de' })
  assert.match(empty.svg, />Keine Daten<\/text>/)
})

test('specialized data shapes use their semantic SVG geometry in report HTML', () => {
  const chart = {
    ...bar,
    type: 'line',
    data_shape: 'uncertainty',
    headers: ['Quarter', 'Lower', 'Estimate', 'Upper'],
    rows: [
      ['Q1', 10, 14, 19],
      ['Q2', 12, 17, 23],
    ],
  }
  const rendered = renderReportChartSvg(chart)
  assert.match(rendered.svg, /<polygon points=/)
  assert.match(rendered.svg, /<polyline points=/)
  assert.match(
    rendered.svg,
    /font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif/,
  )
  assert.doesNotMatch(rendered.svg, /echarts|ck-chart-/)

  const html = materializeReportCharts({
    meta: { locale: 'en' },
    charts: [chart],
    html: '<figure><div class="report-chart-visual" data-report-chart="0"></div></figure>',
  }).html
  assert.match(html, /media="\(max-width: 760px\)"/)
  assert.match(html, /width="960" height="480"/)
  const mobile = html.match(/media="\(max-width: 760px\)" srcset="data:image\/svg\+xml;base64,([^"]+)/)?.[1]
  assert.ok(mobile)
  assert.match(Buffer.from(mobile, 'base64').toString(), /viewBox="0 0 390 620"/)
})

test('materialization replaces only trusted placeholders with light and dark images', () => {
  const emitted = []
  const rendered = materializeReportCharts(
    {
      meta: { locale: 'en' },
      charts: [bar],
      html: '<figure><div class="report-chart-visual" data-report-chart="0"></div></figure>',
    },
    {
      emit(svg, { scheme, viewport }) {
        emitted.push([scheme, viewport || 'desktop', svg])
        return `/assets/chart-${scheme}-${viewport || 'desktop'}.svg`
      },
    },
  )
  assert.equal(emitted.length, 4)
  assert.match(rendered.html, /<picture class="report-chart-picture">/)
  assert.match(rendered.html, /media="\(max-width: 760px\)"/)
  assert.match(rendered.html, /prefers-color-scheme: dark/)
  assert.match(rendered.html, /src="\/assets\/chart-light-desktop\.svg"/)
  assert.match(rendered.html, /alt="Revenue by month"/)
  assert.doesNotMatch(rendered.html, /data-report-chart/)
})
