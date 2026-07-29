import { Check, Minus } from 'lucide-react'
import { useEffect, useRef, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * A real `input[type=checkbox]` under a drawn box. The input stays in the
 * accessibility tree and in form semantics; only its appearance is replaced.
 *
 * `indeterminate` is a DOM property with no HTML attribute, so it is applied
 * through the ref — a "some of these are selected" header box cannot be
 * expressed any other way.
 */
export function Checkbox({
  checked,
  indeterminate,
  onCheckedChange,
  className,
  disabled,
  ...props
}: Omit<ComponentProps<'input'>, 'type' | 'onChange' | 'checked'> & {
  checked: boolean
  indeterminate?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (input.current) input.current.indeterminate = Boolean(indeterminate)
  }, [indeterminate])

  return (
    <span className={cn('relative inline-flex h-4 w-4 shrink-0', className)}>
      <input
        ref={input}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-border bg-background outline-none checked:border-accent checked:bg-accent indeterminate:border-accent indeterminate:bg-accent focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      />
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-accent-foreground opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-100">
        {indeterminate && !checked ? <Minus className="h-3 w-3" /> : <Check className="h-3 w-3" />}
      </span>
    </span>
  )
}
