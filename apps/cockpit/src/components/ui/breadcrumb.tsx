import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * Where the open page sits: which context it runs in, and — for a site page —
 * which site that is.
 *
 * The Cockpit's sidebar names two contexts, and half the API is installation-
 * wide, so the page header has to repeat what the sidebar said. An operator who
 * arrives by deep link, or who has scrolled the sidebar, otherwise has nothing
 * on screen telling them whether the action in front of them touches one site
 * or the whole installation.
 *
 * Deliberately not interactive: a crumb that is also a link invites a click
 * that changes the site or leaves an unsaved form, and every existing header
 * already carries its own actions. It is a label, not a navigation control —
 * `Badge` next door draws the same distinction.
 */
export interface Crumb {
  label: string
  /** A stand-in for something not chosen yet, e.g. "No site selected". */
  placeholder?: boolean
}

export function Breadcrumb({
  items,
  className,
  'data-testid': testId = 'breadcrumb',
  ...props
}: Omit<ComponentProps<'nav'>, 'children'> & { items: Crumb[]; 'data-testid'?: string }) {
  if (items.length === 0) return null
  return (
    <nav
      aria-label="Breadcrumb"
      data-testid={testId}
      // The joined trail, so a browser test can assert the whole thing in one
      // read instead of stitching the crumbs back together itself.
      data-trail={items.map((item) => item.label).join(' · ')}
      className={cn('text-xs', className)}
      {...props}
    >
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => {
          const last = index === items.length - 1
          return (
            <li key={`${index}-${item.label}`} className="flex items-center gap-1.5">
              {index > 0 ? (
                <span aria-hidden="true" className="text-border">
                  ·
                </span>
              ) : null}
              <span
                data-testid={`${testId}-item-${index}`}
                aria-current={last ? 'page' : undefined}
                className={cn(
                  'truncate',
                  last ? 'font-medium text-foreground' : 'text-muted-foreground',
                  item.placeholder && 'italic',
                )}
              >
                {item.label}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
