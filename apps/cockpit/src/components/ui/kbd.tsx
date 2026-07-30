import type { ReactNode } from 'react'
import { isApplePlatform, modifierLabel } from '@/lib/keyboard'
import { cn } from '@/lib/utils'

/**
 * A key, drawn as a key.
 *
 * `font-sans` on purpose: `<kbd>` defaults to a monospace face, and '⌘' in a
 * monospace fallback is the one glyph most likely to arrive as a box.
 */
export function Kbd({
  children,
  className,
  'data-testid': testId = 'ck-kbd',
}: {
  children: ReactNode
  className?: string
  'data-testid'?: string
}) {
  return (
    <kbd
      data-testid={testId}
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-sans text-[0.7rem] font-medium text-muted-foreground',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

/**
 * The platform's chord for a letter: ⌘K on Apple hardware, Ctrl+K elsewhere.
 *
 * Two `<kbd>` elements rather than one string, because they are two keys. The
 * '+' appears only in the Ctrl form: Apple's own convention writes ⌘K with
 * nothing between, and a hint that does not look like the operator's other
 * shortcuts is one they have to read twice.
 *
 * The platform is read once, at render, from `navigator` — the same source the
 * palette's key handler uses, so the hint and the shortcut cannot disagree.
 */
export function Shortcut({
  letter,
  className,
  'data-testid': testId = 'ck-shortcut',
}: {
  letter: string
  className?: string
  'data-testid'?: string
}) {
  const apple = isApplePlatform(navigator)
  return (
    <span data-testid={testId} className={cn('inline-flex items-center gap-0.5', className)}>
      <Kbd data-testid={`${testId}-modifier`}>{modifierLabel(apple)}</Kbd>
      {apple ? null : <span className="text-[0.7rem] text-muted-foreground">+</span>}
      <Kbd data-testid={`${testId}-letter`}>{letter}</Kbd>
    </span>
  )
}
