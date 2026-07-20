import { contentkitFontFamily } from './typography.mjs'

export const DESIGN_TOKENS_SCHEMA = 'https://www.designtokens.org/schemas/2025.10/format.json'

const COLOR_KEYS = [
  'background',
  'surface',
  'foreground',
  'muted',
  'muted_foreground',
  'border',
  'primary',
  'primary_foreground',
  'accent',
  'accent_foreground',
  'chart_1',
  'chart_2',
  'chart_3',
  'chart_4',
  'chart_5',
]

const defaults = Object.freeze({
  light: Object.freeze({
    background: '#ffffff',
    surface: '#ffffff',
    foreground: '#020817',
    muted: '#f1f5f9',
    muted_foreground: '#64748b',
    border: '#e2e8f0',
    primary: '#0f172a',
    primary_foreground: '#f8fafc',
    accent: '#2563eb',
    accent_foreground: '#ffffff',
    chart_1: '#2563eb',
    chart_2: '#059669',
    chart_3: '#d97706',
    chart_4: '#7c3aed',
    chart_5: '#dc2626',
  }),
  dark: Object.freeze({
    background: '#020817',
    surface: '#0f172a',
    foreground: '#f8fafc',
    muted: '#1e293b',
    muted_foreground: '#94a3b8',
    border: '#334155',
    primary: '#f8fafc',
    primary_foreground: '#0f172a',
    accent: '#60a5fa',
    accent_foreground: '#020817',
    chart_1: '#60a5fa',
    chart_2: '#34d399',
    chart_3: '#fbbf24',
    chart_4: '#c4b5fd',
    chart_5: '#f87171',
  }),
  radius: '12px',
  font_family: contentkitFontFamily,
  brand_label: 'CONTENTKIT',
})

function color(value, fallback) {
  const raw = String(value || '').trim()
  if (/^-?[\d.]+\s+-?[\d.]+%\s+-?[\d.]+%$/.test(raw)) return `hsl(${raw})`
  if (/^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([^<>;{}]+\)|[a-z]+)$/i.test(raw)) return raw
  return fallback
}

function dimension(value, fallback) {
  const raw = String(value || '').trim()
  return /^(?:0|[\d.]+(?:px|rem|em))$/.test(raw) ? raw : fallback
}

function fontFamily(value) {
  const raw = String(value || '').trim()
  return raw && /^[\p{L}\p{N}\s,'"_-]+$/u.test(raw) ? raw : defaults.font_family
}

function brandLabel(value) {
  const raw = String(value || '').trim()
  return raw && /^[\p{L}\p{N}\s·&+._-]{1,80}$/u.test(raw) ? raw : defaults.brand_label
}

function authoredValue(settings, key, scheme) {
  const tokens = settings?.theme?.tokens || {}
  let token = tokens[key]
  if (key === 'surface' && token == null) token = tokens.card
  if (key === 'accent' && token == null) token = settings?.accent
  if (key === 'chart_1' && token == null) token = settings?.accent
  if (token != null && typeof token === 'object') return token[scheme]
  if (token != null) return token
  return null
}

export function resolveDesignSystem(settings = {}) {
  const resolved = {
    schema_version: '1',
    light: {},
    dark: {},
    radius: dimension(settings?.theme?.tokens?.radius, defaults.radius),
    font_family: fontFamily(settings?.theme?.tokens?.font_family),
    brand_label: brandLabel(settings?.theme?.tokens?.brand_label),
  }
  for (const scheme of ['light', 'dark']) {
    for (const key of COLOR_KEYS) {
      resolved[scheme][key] = color(authoredValue(settings, key, scheme), defaults[scheme][key])
    }
  }
  return resolved
}

const cssDeclarations = (tokens) =>
  [
    `--ck-deck-bg:${tokens.background}`,
    `--ck-deck-fg:${tokens.foreground}`,
    `--ck-deck-surface:${tokens.surface}`,
    `--ck-deck-subtle:${tokens.muted}`,
    `--ck-deck-muted:${tokens.muted_foreground}`,
    `--ck-deck-border:${tokens.border}`,
    `--ck-deck-accent:${tokens.accent}`,
    `--ck-deck-accent-fg:${tokens.accent_foreground}`,
  ].join(';')

export function deckDesignStyle(settings = {}) {
  const design = resolveDesignSystem(settings)
  return `<style data-contentkit-design-system>:root{${cssDeclarations(design.light)};--ck-deck-radius:${design.radius};--ck-deck-font:${design.font_family};--ck-deck-brand:${JSON.stringify(design.brand_label)}}html.dark{${cssDeclarations(design.dark)}}</style>`
}

function hslToRgb(hue, saturation, lightness) {
  const h = (((Number(hue) % 360) + 360) % 360) / 360
  const s = Number(saturation) / 100
  const l = Number(lightness) / 100
  if (!s) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (offset) => {
    let t = h + offset
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [channel(1 / 3), channel(0), channel(-1 / 3)]
}

function rgbComponents(value) {
  const raw = String(value).trim()
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(raw)
  if (hex) {
    const expanded = hex[1].length === 3 ? [...hex[1]].map((entry) => entry + entry).join('') : hex[1]
    return [0, 2, 4].map((offset) => parseInt(expanded.slice(offset, offset + 2), 16) / 255)
  }
  const hsl = /^hsl\(\s*(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i.exec(raw)
  return hsl ? hslToRgb(hsl[1], hsl[2], hsl[3]) : null
}

const hexByte = (value) =>
  Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, '0')

function dtcgColor(value) {
  const components = rgbComponents(value)
  if (!components) return { $type: 'string', $value: value }
  return {
    $type: 'color',
    $value: {
      colorSpace: 'srgb',
      components: components.map((entry) => Number(entry.toFixed(6))),
      hex: `#${components.map(hexByte).join('')}`,
    },
  }
}

const dtcgDimension = (value) => {
  const match = /^([\d.]+)(px|rem|em)$/.exec(String(value))
  return match
    ? { $type: 'dimension', $value: { value: Number(match[1]), unit: match[2] === 'em' ? 'rem' : match[2] } }
    : { $type: 'string', $value: String(value) }
}

export function designTokensDocument(site = {}) {
  const design = resolveDesignSystem(site.settings || {})
  const colors = Object.fromEntries(
    COLOR_KEYS.map((key) => [
      key.replaceAll('_', '-'),
      {
        $description: `${key.replaceAll('_', ' ')} in the light and dark color schemes`,
        light: dtcgColor(design.light[key]),
        dark: dtcgColor(design.dark[key]),
      },
    ]),
  )
  return {
    $schema: DESIGN_TOKENS_SCHEMA,
    $description: `${site.name || 'ContentKit site'} corporate design tokens for human and machine consumers`,
    color: colors,
    typography: {
      font: {
        $type: 'fontFamily',
        $description: 'Canonical UI and presentation font stack',
        $value: design.font_family.split(',').map((entry) => entry.trim().replace(/^['"]|['"]$/g, '')),
      },
      display: {
        $type: 'typography',
        $description: 'Editorial display heading used by the website and slide covers',
        $value: {
          fontFamily: '{typography.font}',
          fontSize: { value: 72, unit: 'px' },
          fontWeight: 750,
          letterSpacing: { value: -3.6, unit: 'px' },
          lineHeight: 1.02,
        },
      },
      slideHeading: {
        $type: 'typography',
        $description: 'Default heading inside the native 980 by 551 slide canvas',
        $value: {
          fontFamily: '{typography.font}',
          fontSize: { value: 38, unit: 'px' },
          fontWeight: 750,
          letterSpacing: { value: -1.9, unit: 'px' },
          lineHeight: 1.06,
        },
      },
    },
    spacing: {
      xs: dtcgDimension('4px'),
      sm: dtcgDimension('8px'),
      md: dtcgDimension('16px'),
      lg: dtcgDimension('24px'),
      xl: dtcgDimension('32px'),
      '2xl': dtcgDimension('48px'),
    },
    radius: { card: dtcgDimension(design.radius) },
    slide: {
      canvasWidth: dtcgDimension('980px'),
      canvasHeight: dtcgDimension('551px'),
      safeAreaInline: dtcgDimension('44px'),
      safeAreaBlockStart: dtcgDimension('32px'),
      safeAreaBlockEnd: dtcgDimension('34px'),
      $extensions: {
        'dev.contentkit': {
          aspectRatio: '16:9',
          maxPrimaryQuestion: 1,
          requiredNarrativeOrder: ['question', 'evidence', 'interpretation', 'conclusion', 'action'],
          visualAcceptance: ['no-overlap', 'no-clipping', 'no-off-canvas-connectors', 'one-visible-color-scheme'],
        },
      },
    },
  }
}

export function designSystemMarkdown(site = {}) {
  const design = resolveDesignSystem(site.settings || {})
  return `# ${site.name || 'ContentKit site'} design system

> A compact, machine-readable companion to the public website, semantic compositions and slide decks.

## Identity

The visual language is defined by this site's typed tokens and remains separate from ContentKit's product defaults. The current configuration uses ${design.font_family}, a ${design.light.accent} action accent, generous whitespace and high-contrast surfaces. Visual forms carry information; they are not decorative substitutes for a missing argument.

## Canonical tokens

| Role | Light | Dark |
| --- | --- | --- |
| Background | ${design.light.background} | ${design.dark.background} |
| Surface | ${design.light.surface} | ${design.dark.surface} |
| Foreground | ${design.light.foreground} | ${design.dark.foreground} |
| Muted text | ${design.light.muted_foreground} | ${design.dark.muted_foreground} |
| Border | ${design.light.border} | ${design.dark.border} |
| Accent | ${design.light.accent} | ${design.dark.accent} |

Font: ${design.font_family}

Radius: ${design.radius}

The complete typed token document is available at [design-tokens.json](/design-tokens.json).

## Narrative contract

Every public artifact states one reader question, the minimum evidence needed to answer it, an interpretation, a bounded conclusion and an optional action. Evidence appears before the conclusion. A diagram is used only when its visual implication is true for the source material.

## Slide contract

Slides use a native 980 × 551 pixel, 16:9 canvas. The safe area is 44 pixels inline, 32 pixels at the top and 34 pixels at the bottom. A slide has one dominant statement, one visual or evidence region and at most one compact source line. Light and dark visual variants occupy the same geometry; exactly one variant is visible.

## Acceptance

- no visible element crosses the slide canvas;
- no text, connector, arrowhead or source label is clipped or overlaps another information-bearing element;
- normal text reaches WCAG 2.2 AA contrast and meaningful graphical objects reach non-text contrast;
- the hierarchy survives 200% text zoom and the WCAG text-spacing overrides;
- the public URL is checked at desktop, laptop and mobile-shaped viewports before activation;
- the Markdown source, semantic model, SVG, PNG and released HTML remain source-addressed and reproducible.
`
}
