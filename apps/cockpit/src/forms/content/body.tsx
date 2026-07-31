import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * ContentKit's semantic directive vocabulary, exactly as
 * `POST /v1/sites/{site}/content` documents it. Authors may request one of
 * these; they may not supply geometry, CSS or a renderer specification — so the
 * palette inserts the block and nothing else.
 */
export const SEMANTIC_DIRECTIVES = [
  'hero',
  'metric',
  'process',
  'comparison',
  'timeline',
  'hierarchy',
  'relationship',
  'chart',
  'progress',
  'badge',
  'card',
  'group',
  'faq',
  'question',
  'code-example',
  'variant',
  'pricing',
  'plan',
  'gallery',
  'figure',
  'data-table',
  'dashboard-section',
  'application-shell',
  'region',
] as const

const encoder = new TextEncoder()
// `POST /v1/sites/{site}/render` answers 413 above this, and so would a release.
const MAX_BYTES = 256 * 1024

/**
 * The Markdown body.
 *
 * A textarea rather than a rich editor, because the source is the artefact: the
 * server hashes it, a release republishes it and the Markdown twin serves it to
 * readers and machines. Anything that edited a projection of it would have to
 * round-trip that projection back to bytes, and that is the one thing this
 * console does not do to an author's file.
 */
export function MarkdownBody({
  value,
  onChange,
  disabled,
  rows = 24,
  'data-testid': testId = 'ck-body',
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  rows?: number
  'data-testid'?: string
}) {
  const area = useRef<HTMLTextAreaElement>(null)
  const bytes = encoder.encode(value).length
  const over = bytes > MAX_BYTES

  function insert(directive: string) {
    const node = area.current
    const at = node ? node.selectionStart : value.length
    const before = value.slice(0, at)
    const after = value.slice(at)
    // A directive opened mid-line is a directive the parser never sees, so the
    // block is always given its own paragraph.
    const lead = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : ''
    const snippet = `${lead}:::${directive}\n\n:::\n\n`
    onChange(before + snippet + after)
    requestAnimationFrame(() => {
      const caret = (before + lead).length + directive.length + 4
      node?.focus()
      node?.setSelectionRange(caret, caret)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Markdown</span>
        <span
          data-testid={`${testId}-budget`}
          className={cn('text-xs tabular-nums', over ? 'text-chart-5' : 'text-muted-foreground')}
        >
          {Math.round(bytes / 1024)} KiB / 256 KiB
        </span>
      </div>
      <textarea
        ref={area}
        rows={rows}
        spellCheck={false}
        disabled={disabled}
        data-testid={testId}
        aria-label="Markdown body"
        aria-invalid={over || undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'w-full rounded-lg border border-border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent',
          over && 'border-chart-5 focus-visible:ring-chart-5',
        )}
      />
      {over ? (
        <p data-testid={`${testId}-error`} className="text-xs text-chart-5">
          Over 256 KiB — the render endpoint and the release both refuse this.
        </p>
      ) : null}
      <details data-testid={`${testId}-palette`} className="rounded-lg border border-border">
        <summary className="cursor-pointer p-2 text-xs text-muted-foreground">Insert a semantic directive</summary>
        <div className="flex flex-wrap gap-1 border-t border-border p-2">
          {SEMANTIC_DIRECTIVES.map((directive) => (
            <Button
              key={directive}
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              data-testid={`${testId}-insert-${directive}`}
              onClick={() => insert(directive)}
            >
              {directive}
            </Button>
          ))}
        </div>
      </details>
    </div>
  )
}
