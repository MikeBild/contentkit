import { contentkitFontFamilyCompact } from './typography.mjs'
import { escapeXml } from './utils.mjs'

const layoutMode = (primitive) =>
  ({
    split: 'split',
    stack: 'stack',
    sequence: 'sequence',
    matrix: 'matrix',
    connector: 'sequence',
    grid: 'grid',
    frame: 'frame',
    card: 'card',
    radial: 'radial',
    layers: 'stack',
  })[primitive] || 'stack'

export function renderVisualCompositionHtml(rendered, layout, { scheme = 'light' } = {}) {
  const pattern = layout.pattern
  const mode = layoutMode(layout.primitive)
  const label = rendered.meta?.title || rendered.semantic?.title || 'Visual composition'
  const dark = scheme === 'dark'
  const colors = dark
    ? { background: '#09090b', surface: '#111113', text: '#fafafa', muted: '#a1a1aa', border: '#3f3f46' }
    : { background: '#ffffff', surface: '#ffffff', text: '#18181b', muted: '#52525b', border: '#d4d4d8' }
  return `<section class="ck-visual-composition ck-layout-${mode}" data-pattern="${escapeXml(pattern)}" data-layout-schema="${escapeXml(layout.schema_version)}" data-scheme="${scheme}" aria-label="${escapeXml(label)}"><style>
.ck-visual-composition{--ck-bg:${colors.background};--ck-surface:${colors.surface};--ck-fg:${colors.text};--ck-muted:${colors.muted};--ck-border:${colors.border};box-sizing:border-box;width:100%;container-type:inline-size;background:var(--ck-bg);color:var(--ck-fg);font-family:${contentkitFontFamilyCompact};font-kerning:normal;font-variant-ligatures:common-ligatures;letter-spacing:-.012em;line-height:1.45;padding:clamp(1.25rem,4cqi,4rem)}
.ck-visual-composition *{box-sizing:border-box;min-width:0}.ck-visual-composition> :not(style)+*{margin-block-start:clamp(1rem,2.4cqi,2rem)}
.ck-visual-composition :is(h1,h2,h3,h4,p,ul,ol,figure,pre,table){margin-block-start:0}.ck-visual-composition :is(h1,h2){letter-spacing:-.045em;line-height:1.02;text-wrap:balance}.ck-visual-composition h1{font-size:clamp(2.25rem,7cqi,5.5rem)}.ck-visual-composition h2{font-size:clamp(1.8rem,5cqi,3.75rem)}.ck-visual-composition h3{font-size:clamp(1.125rem,2.1cqi,1.5rem)}.ck-visual-composition p,.ck-visual-composition li,.ck-visual-composition td,.ck-visual-composition th{font-size:clamp(.9375rem,1.5cqi,1.125rem)}
.ck-visual-composition .heading-anchor{color:inherit;text-decoration:none}.ck-visual-composition :is(.composition-question,.composition-plan,.composition-card)>:last-child{margin-block-end:0}
.ck-visual-composition :is(.composition-card,.composition-plan,.composition-question,.composition-dashboard-section,.composition-shell-region,.composition-side,.composition-figure,.composition-record){border:1px solid var(--ck-border);border-radius:clamp(.75rem,1.4cqi,1.125rem);background:var(--ck-surface);padding:clamp(1rem,2.4cqi,2rem)}
.ck-visual-composition :is(.composition-group,.composition-comparison,.composition-pricing,.composition-gallery,.composition-data-table,.composition-application-shell){display:grid;gap:clamp(.75rem,1.8cqi,1.5rem)}
.ck-layout-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr));gap:clamp(.75rem,1.8cqi,1.5rem)}.ck-layout-grid>style{display:none}.ck-layout-grid>:is(.composition-group,.composition-pricing,.composition-gallery,.composition-faq,.composition-structure){grid-column:1/-1}.ck-layout-grid>.composition-hero{grid-column:span 2}.ck-layout-grid :is(.composition-group,.composition-pricing,.composition-gallery),.ck-layout-matrix :is(.composition-group,.composition-pricing,.composition-gallery){grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))}.ck-visual-composition :is(.composition-pricing,.composition-gallery)>:is(h2,h3),.ck-visual-composition .composition-faq>h2{grid-column:1/-1}.ck-layout-split :is(.composition-comparison,.composition-group,.composition-application-shell){grid-template-columns:repeat(2,minmax(0,1fr))}
.ck-visual-composition .composition-structure>ul{list-style:none;margin:0;padding:0;display:grid;gap:clamp(.75rem,1.8cqi,1.5rem);counter-reset:ck-item}.ck-visual-composition .composition-structure>ul>li{position:relative;min-height:clamp(5.5rem,12cqi,8rem);padding:clamp(1rem,2cqi,1.5rem);border:1px solid var(--ck-border);border-radius:clamp(.75rem,1.4cqi,1.125rem);background:var(--ck-surface);font-weight:650;counter-increment:ck-item}.ck-visual-composition .composition-structure>ul>li::before{content:counter(ck-item,decimal-leading-zero);display:block;margin-block-end:.75rem;color:var(--ck-muted);font-size:.75rem;font-weight:750;letter-spacing:.08em}.ck-layout-sequence .composition-structure>ul,[data-pattern="roadmap"] .composition-structure>ul{grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))}.ck-layout-sequence .composition-structure>ul>li,[data-pattern="roadmap"] .composition-structure>ul>li{border-top:2px solid var(--ck-fg);scroll-snap-align:start}.ck-visual-composition .composition-faq{display:grid;gap:clamp(.75rem,1.8cqi,1.5rem)}
.ck-visual-composition .report-metric{display:grid;align-content:space-between;min-height:clamp(8rem,15cqi,11rem);padding:clamp(1rem,2.4cqi,2rem);border:1px solid var(--ck-border);border-radius:clamp(.75rem,1.4cqi,1.125rem);background:var(--ck-surface)}.ck-visual-composition .report-metric-label{color:var(--ck-muted);font-size:.8125rem;font-weight:650}.ck-visual-composition .report-metric-value{font-size:clamp(2rem,5cqi,4rem);letter-spacing:-.05em;line-height:1}.ck-visual-composition .report-metric-trend{width:fit-content;padding:.25rem .5rem;border-radius:999px;background:color-mix(in srgb,var(--ck-border) 45%,transparent);font-size:.75rem;font-weight:650}
.ck-visual-composition table{width:100%;border-collapse:collapse}.ck-visual-composition :is(th,td){padding:.75rem;text-align:start;border-bottom:1px solid var(--ck-border)}.ck-visual-composition pre{max-width:100%;overflow:auto;border:1px solid var(--ck-border);border-radius:.75rem;padding:1rem}.ck-visual-composition img,.ck-visual-composition svg{display:block;max-width:100%;height:auto}.ck-visual-composition figcaption,.ck-visual-composition .composition-record-label{color:var(--ck-muted);font-size:.9375rem}.ck-visual-composition details>summary{display:flex;align-items:center;width:fit-content;min-width:44px;min-height:44px;padding-inline:.5rem;cursor:pointer;font-weight:650}.ck-visual-composition .composition-hero{max-width:62rem;padding-block:clamp(1rem,3cqi,3rem)}
@container (max-width:720px){.ck-visual-composition{padding:1.25rem}.ck-layout-grid{grid-template-columns:1fr}.ck-layout-grid>.composition-hero{grid-column:auto}.ck-layout-split :is(.composition-comparison,.composition-group,.composition-application-shell){grid-template-columns:1fr}.ck-layout-sequence .composition-structure>ul,[data-pattern="roadmap"] .composition-structure>ul{grid-template-columns:1fr}.ck-visual-composition :is(.composition-card,.composition-plan,.composition-question,.composition-dashboard-section,.composition-shell-region,.composition-side,.composition-figure,.composition-record){padding:1rem}}
@media print{.ck-visual-composition{padding:0;background:#fff;color:#000}.ck-visual-composition details:not([open])>*:not(summary){display:block}.ck-visual-composition :is(.composition-card,.composition-plan,.composition-question,.composition-dashboard-section,.composition-shell-region,.composition-side,.composition-figure,.composition-record){break-inside:avoid}}
</style>${rendered.html}</section>`
}
