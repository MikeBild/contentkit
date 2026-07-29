import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from './primitives'

/**
 * Values that exist exactly once — a raw API key, a webhook secret — have to be
 * copyable without selecting text by hand. `navigator.clipboard` needs a secure
 * context, so the failure is reported rather than swallowed: silently copying
 * nothing is how a key is lost.
 */
export function CopyButton({
  value,
  label = 'Copy',
  size = 'sm',
  'data-testid': testId = 'ck-copy',
}: {
  value: string
  label?: string
  size?: 'sm' | 'icon'
  'data-testid'?: string
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      data-testid={testId}
      aria-label={size === 'icon' ? label : undefined}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setState('copied')
        } catch {
          setState('failed')
        }
        setTimeout(() => setState('idle'), 2000)
      }}
    >
      {state === 'copied' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {size === 'icon' ? null : state === 'failed' ? 'Copy blocked — select it' : state === 'copied' ? 'Copied' : label}
    </Button>
  )
}
