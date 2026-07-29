import { Suspense, lazy, type ComponentProps } from 'react'

/**
 * The content surface, loaded when content is on screen and not before.
 *
 * Behind these two boundaries sit the Markdown parser, KaTeX's stylesheet and
 * ContentKit's whole published stylesheet — and behind the first one, on demand
 * again, Mermaid. None of it is needed to show a list of releases, so none of it
 * belongs in the console's first paint.
 */
const Html = lazy(() => import('./ContentHtml').then((module) => ({ default: module.ContentHtml })))
const Markdown = lazy(() => import('./draft').then((module) => ({ default: module.Draft })))

// A named-but-empty box: the chunk arrives in milliseconds from the same origin,
// and a spinner for that would flash more than it explains.
const Pending = <div data-testid="content-pending" className="h-4" />

export function ContentHtml(props: ComponentProps<typeof Html>) {
  return <Suspense fallback={Pending}>{<Html {...props} />}</Suspense>
}

export function Draft(props: ComponentProps<typeof Markdown>) {
  return <Suspense fallback={Pending}>{<Markdown {...props} />}</Suspense>
}

export { useContentScheme, type ContentScheme } from './scheme'
