import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

// shadcn-shaped primitives, vendored rather than pulled through the CLI: the
// palette below is ContentKit's own design system, and there is no Next.js
// project for `shadcn add` to write into.

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        accent: 'bg-accent text-accent-foreground hover:opacity-90',
        outline: 'border border-border bg-surface hover:bg-muted',
        ghost: 'hover:bg-muted',
        destructive: 'bg-chart-5 text-white hover:opacity-90',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-xl border border-border bg-surface', className)} {...props} />
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 p-5 pb-3', className)} {...props} />
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 className={cn('text-sm font-semibold tracking-tight', className)} {...props} />
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-5 pt-0', className)} {...props} />
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent',
        className,
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-lg border border-border bg-background p-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent',
        className,
      )}
      {...props}
    />
  )
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 rounded-lg border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent',
        className,
      )}
      {...props}
    />
  )
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-xs font-medium text-muted-foreground', className)} {...props} />
}

const badgeVariants = cva('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      neutral: 'border-border bg-muted text-muted-foreground',
      success: 'border-chart-2/30 bg-chart-2/15 text-chart-2',
      warning: 'border-chart-3/30 bg-chart-3/15 text-chart-3',
      danger: 'border-chart-5/30 bg-chart-5/15 text-chart-5',
      info: 'border-accent/30 bg-accent/15 text-accent',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export function Badge({ className, tone, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
}

export function THead({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('border-b border-border', className)} {...props} />
}

export function TBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={className} {...props} />
}

export function TR({ className, ...props }: ComponentProps<'tr'>) {
  return <tr className={cn('border-b border-border last:border-0 hover:bg-muted/50', className)} {...props} />
}

export function TH({ className, ...props }: ComponentProps<'th'>) {
  return <th className={cn('px-3 py-2 text-left text-xs font-medium text-muted-foreground', className)} {...props} />
}

export function TD({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('px-3 py-2 align-middle', className)} {...props} />
}

/**
 * Every list in the console has the same four states, and conflating them is
 * how "empty" ends up looking identical to "failed". They are spelled out once
 * here so no page can quietly skip one.
 */
export function TableState({
  columns,
  isLoading,
  error,
  isEmpty,
  onRetry,
  emptyMessage = 'Nothing here yet.',
  children,
}: {
  columns: number
  isLoading: boolean
  error: unknown
  isEmpty: boolean
  onRetry?: () => void
  emptyMessage?: string
  children: ReactNode
}) {
  if (isLoading)
    return (
      <TR>
        <TD colSpan={columns} className="h-24 text-center text-muted-foreground">
          Loading…
        </TD>
      </TR>
    )
  if (error)
    return (
      <TR>
        <TD colSpan={columns} className="h-24 text-center">
          <div className="flex flex-col items-center gap-2">
            <span className="text-chart-5">{error instanceof Error ? error.message : 'Request failed'}</span>
            {onRetry ? (
              <Button size="sm" variant="outline" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </div>
        </TD>
      </TR>
    )
  if (isEmpty)
    return (
      <TR>
        <TD colSpan={columns} className="h-24 text-center text-muted-foreground">
          {emptyMessage}
        </TD>
      </TR>
    )
  return <>{children}</>
}
