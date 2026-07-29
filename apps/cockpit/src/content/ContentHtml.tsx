import { useEffect, useRef } from 'react'
import { enhanceComposition } from '../../../../assets/composition.js'
import { cn } from '@/lib/utils'
import type { ContentScheme } from './scheme'
import './content.css'

/**
 * The console's content surface, and the only place in it that inserts HTML.
 *
 * The HTML always comes from ContentKit: `POST /v1/sites/{site}/render` or the
 * published read API. Both run one pipeline whose `rehype-sanitize` pass sits
 * after the directive plugins and before slugs, KaTeX and Shiki — so the
 * sanitizer sees author-supplied HTML and nothing else, and every attribute
 * added afterwards is ContentKit's own output built from validated data. There
 * is deliberately no client-side re-sanitisation: stripping `style` and `span`
 * again here would erase exactly those additions.
 */
export function ContentHtml({
  html,
  scheme,
  className,
  testId = 'ck-content',
}: {
  html: string
  scheme: ContentScheme
  className?: string
  testId?: string
}) {
  const root = useRef<HTMLDivElement>(null)

  // The real assets/composition.js — the file the published page runs, called on
  // a subtree. A React reimplementation of the tabs and the table controls would
  // be the second renderer this whole design exists to avoid.
  useEffect(() => {
    if (root.current) enhanceComposition(root.current)
  }, [html])

  useEffect(() => {
    const host = root.current
    if (!host) return
    const nodes = pendingDiagrams(host)
    if (!nodes.length) return
    let cancelled = false

    void (async () => {
      try {
        // Mermaid is most of the console's JavaScript and most sessions never
        // see a diagram, so it arrives only when one is on screen.
        const { default: mermaid } = await import('mermaid')
        if (cancelled) return
        mermaid.initialize({
          startOnLoad: false,
          // Mermaid is the one client-side parser of text the console did not
          // produce. `strict` keeps its own DOMPurify pass on, and htmlLabels
          // off means a label is a text node — an `<img onerror=…>` in a node
          // label stays visible literal text instead of becoming an element.
          securityLevel: 'strict',
          htmlLabels: false,
          theme: scheme === 'dark' ? 'dark' : 'default',
        })
        // suppressErrors: one malformed diagram in a long reply must not stop
        // the rest of them; the failed node keeps its own error output.
        await mermaid.run({ nodes, suppressErrors: true })
      } catch {
        // The runtime never arrived. The nodes are hidden until they are drawn,
        // so saying so is the difference between a note and a blank gap.
        for (const node of nodes) decline(node)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [html, scheme])

  // KaTeX has no runtime here: the server emits the finished markup and only the
  // stylesheet is missing, which content.css supplies.
  return (
    <div
      ref={root}
      data-testid={testId}
      data-scheme={scheme}
      className={cn('ck-content', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// ContentKit classifies a Mermaid fence as process, sequence, state, data-model
// or architecture evidence. The console runs the first four. `architecture-beta`
// and the diagram kinds ContentKit does not classify pull in graph engines that
// want 'unsafe-eval', and the console's CSP does not have it — restricting the
// diagram types is the documented answer, loosening the header is not.
const RUNNABLE = /^(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|erDiagram|classDiagram)\b/i

const DECLINED = 'This diagram is not drawn in the console. The published page draws it.'

function decline(node: HTMLElement) {
  node.setAttribute('data-processed', 'declined')
  node.classList.add('ck-diagram-declined')
  node.textContent = DECLINED
}

/**
 * Claims every diagram that has not been handled yet and hands back the ones
 * Mermaid may run. The claim is synchronous and the import is not, so without it
 * two effect passes — which is what React does in development — would both pick
 * up the same nodes and render each diagram twice.
 */
function pendingDiagrams(host: HTMLElement) {
  const runnable: HTMLElement[] = []
  for (const node of host.querySelectorAll<HTMLElement>('pre.mermaid:not([data-processed]):not([data-ck-enhanced])')) {
    node.setAttribute('data-ck-enhanced', '')
    const declaration = (node.textContent || '')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('%%'))
    if (declaration && RUNNABLE.test(declaration)) {
      runnable.push(node)
      continue
    }
    decline(node)
  }
  return runnable
}
