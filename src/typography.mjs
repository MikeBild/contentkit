import { fileURLToPath } from 'node:url'

export const contentkitFontFace = 'Inter'

export const contentkitFontFamily =
  "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

export const contentkitFontFamilyCompact = contentkitFontFamily.replaceAll(', ', ',')

export const contentkitFontAssetName = 'inter-latin-variable.woff2'
export const contentkitFontFile = fileURLToPath(
  import.meta.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'),
)

export function contentkitFontFaceCss(source, { display } = {}) {
  return `@font-face{font-family:${contentkitFontFace};font-style:normal;font-weight:100 900;${display ? `font-display:${display};` : ''}src:url(${source}) format('woff2')}`
}
