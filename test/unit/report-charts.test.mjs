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

test('ECharts report SVGs are deterministic, static and accessible', () => {
  const first = renderReportChartSvg(bar, { locale: 'en', scheme: 'light' })
  const second = renderReportChartSvg(bar, { locale: 'en', scheme: 'light' })
  assert.equal(first.svg, second.svg)
  assert.match(first.svg, /^<svg[^>]+width="800"[^>]+height="360"/)
  assert.match(first.svg, /aria-label="Revenue by month"/)
  assert.doesNotMatch(first.svg, /<script|javascript:|(?:href|src)="https?:\/\//i)
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

test('chart themes consume allowlisted light and dark shadcn-style tokens', () => {
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

test('materialization replaces only trusted placeholders with light and dark images', () => {
  const emitted = []
  const rendered = materializeReportCharts(
    {
      meta: { locale: 'en' },
      charts: [bar],
      html: '<figure><div class="report-chart-visual" data-report-chart="0"></div></figure>',
    },
    {
      emit(svg, { scheme }) {
        emitted.push([scheme, svg])
        return `/assets/chart-${scheme}.svg`
      },
    },
  )
  assert.equal(emitted.length, 2)
  assert.match(rendered.html, /<picture class="report-chart-picture">/)
  assert.match(rendered.html, /prefers-color-scheme: dark/)
  assert.match(rendered.html, /src="\/assets\/chart-light\.svg"/)
  assert.match(rendered.html, /alt="Revenue by month"/)
  assert.doesNotMatch(rendered.html, /data-report-chart/)
})
