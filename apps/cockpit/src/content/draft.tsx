/**
 * The streaming draft — and its contract, which is the whole point of the file:
 *
 * **This file must never learn a ContentKit semantic.** No remark-directive, no
 * remark-math, no chart shapes, no pattern registry, no raw HTML, no rehype-*.
 * It is CommonMark plus GFM rendered to React elements, nothing else, ever.
 *
 * Everything ContentKit adds on top is rendered by ContentKit, once, when the
 * message is finished (see `ck.render`). A client-side approximation of those
 * semantics would be a second renderer that silently disagrees with what gets
 * published — the failure this design exists to prevent. So a block this file
 * cannot draw becomes a neutral placeholder: never raw `:::` noise, and never a
 * guess at what it would have looked like.
 *
 * Because there is no HTML anywhere in this path — react-markdown emits React
 * elements — the streaming surface has no XSS area to defend at all.
 */
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

const SAFE_HREF = /^https?:\/\//i
const SAFE_IMAGE = /^(?:https?:\/\/|data:image\/(?:png|jpeg|gif|webp|svg\+xml);)/i

const components: Components = {
  // A link is followed by a human, so only the two schemes a human expects
  // survive as links; anything else (javascript:, data:, mailto-lookalikes)
  // stays visible text and stops being clickable.
  a: ({ href, children }) =>
    href && SAFE_HREF.test(href) ? (
      <a data-testid="draft-link" className="underline" href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    ) : (
      <span data-testid="draft-link-inert">{children}</span>
    ),
  img: ({ src, alt }) =>
    typeof src === 'string' && SAFE_IMAGE.test(src) ? (
      <img data-testid="draft-image" className="max-w-full rounded-lg" src={src} alt={alt || ''} />
    ) : (
      <span data-testid="draft-image-inert" className="text-muted-foreground">
        {alt || 'image'}
      </span>
    ),
}

export function Draft({
  markdown,
  testId = 'assistant-draft',
  unrendered = false,
}: {
  markdown: string
  testId?: string
  /**
   * The draft is still on screen after the message finished, because the server
   * refused to render it. Promising that it will be rendered "when the message
   * is finished" would then be a statement the console knows to be false — the
   * diagnostic below the message already says why.
   */
  unrendered?: boolean
}) {
  // A column with a gap rather than a stacking utility that hangs a margin on
  // every child but the first: the segments here are a mix of rendered markdown
  // and placeholder paragraphs, and how many there are changes as the message
  // streams in. Spacing that lives on the children therefore depends on which
  // segment happens to be first at that instant, and the first one has no top
  // margin — so the block moved as it grew. A gap on the parent does not reach
  // into the children at all.
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-2 text-sm leading-relaxed [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc"
    >
      {segments(markdown).map((segment, index) =>
        segment.kind === 'markdown' ? (
          <Markdown key={index} remarkPlugins={[remarkGfm]} components={components}>
            {segment.text}
          </Markdown>
        ) : (
          <p
            key={index}
            data-testid="draft-placeholder"
            data-label={segment.label}
            className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
          >
            {unrendered
              ? `${segment.label} — not shown: this message could not be rendered as published.`
              : `${segment.label} — rendered when the message is finished.`}
          </p>
        ),
      )}
    </div>
  )
}

type Segment = { kind: 'markdown'; text: string } | { kind: 'placeholder'; label: string }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*(\S*)/
const CONTAINER_OPEN = /^ {0,3}:{3,}\s*\S/
const CONTAINER_CLOSE = /^ {0,3}:{3,}\s*$/
const MATH = /^ {0,3}\$\$\s*$/

// The names of blocks this file refuses to draw. Knowing that a fence called
// "mermaid" exists is not knowing what a Mermaid diagram means; nothing here
// reads inside one.
const UNDRAWABLE: Record<string, string> = { mermaid: 'Diagram', chart: 'Chart' }

/**
 * Splits the source into what CommonMark can draw and what it cannot. A block
 * left open — which, mid-stream, most of them are — takes the rest of the text
 * with it, so a half-arrived diagram is a placeholder rather than its own
 * source code scrolling past.
 */
function segments(markdown: string): Segment[] {
  const out: Segment[] = []
  const lines = markdown.split('\n')
  let buffer: string[] = []

  const flush = () => {
    if (buffer.join('').trim()) out.push({ kind: 'markdown', text: buffer.join('\n') })
    buffer = []
  }
  const placeholder = (label: string) => {
    flush()
    out.push({ kind: 'placeholder', label })
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string
    const fence = FENCE.exec(line)

    if (fence) {
      const marker = fence[1] as string
      const label = UNDRAWABLE[(fence[2] || '').toLowerCase()]
      const body: string[] = [line]
      // A code fence closes only on a marker of the same character, at least as
      // long — the CommonMark rule, so a nested shorter fence cannot end it.
      const closer = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`)
      while (index + 1 < lines.length && !closer.test(lines[index + 1] as string)) {
        index += 1
        body.push(lines[index] as string)
      }
      const closed = index + 1 < lines.length
      if (closed) {
        index += 1
        body.push(lines[index] as string)
      }
      if (label) placeholder(label)
      else if (closed) buffer.push(...body)
      // An unterminated ordinary fence is still code, but drawing it now would
      // re-flow on every token; it becomes a placeholder until it closes.
      else placeholder('Code')
      continue
    }

    if (CONTAINER_OPEN.test(line)) {
      while (index + 1 < lines.length && !CONTAINER_CLOSE.test(lines[index + 1] as string)) index += 1
      if (index + 1 < lines.length) index += 1
      placeholder('Block')
      continue
    }

    if (MATH.test(line)) {
      while (index + 1 < lines.length && !MATH.test(lines[index + 1] as string)) index += 1
      if (index + 1 < lines.length) index += 1
      placeholder('Formula')
      continue
    }

    buffer.push(line)
  }

  flush()
  return out
}
