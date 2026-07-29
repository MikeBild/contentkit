import { useTheme } from '@/lib/theme'

export type ContentScheme = 'light' | 'dark'

/**
 * One source for the surface's `data-scheme` and for the `scheme` a render
 * request asks for. Report charts are rasterised server-side, so asking for the
 * wrong one produces a light chart on a dark pane that no stylesheet can repair.
 *
 * It lives apart from the surface itself so a page can decide which scheme to
 * ask for without pulling the Mermaid and Markdown runtimes into its bundle.
 */
export function useContentScheme(): ContentScheme {
  return useTheme().resolved
}
