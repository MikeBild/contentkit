"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The one local deviation from what `shadcn add table` writes: below `md`, a
 * row's last cell is pinned to the right edge of the scroller.
 *
 * Measured at 390, every list in this console: the tables are 713px (groups) to
 * 1749px (webhook endpoints) wide inside a 342px container, and **the last
 * column is the row's actions on every one of them**. So `edit`, `revoke`,
 * `delete`, `approve` and `expand` sat between 370px and 1400px off the right
 * of the window — reachable only by scrolling a table sideways first, on a
 * surface where that gesture is also how you scroll the page. On a phone the
 * console was read-only by accident.
 *
 * UI-UX.md §7 lets a table scroll horizontally, and this keeps that: the data
 * still scrolls, in full, with nothing hidden. What stops scrolling is the
 * column that is not data. `md` rather than `sm` because 768px is the console's
 * own breakpoint — `useIsMobile`, the sidebar sheet and this now change shape
 * at the same width — and above it nothing about a table changes at all.
 *
 * `max-w-36` and `flex-wrap` are the other half, and they are what a first
 * attempt without them measured: pinned but unbounded, Readers' three controls
 * ("Edit", "Revoke sessions", "Delete") held 230px of a 342px window open
 * permanently and cut the username to 110px at *every* scroll position — the
 * column that says which reader is being revoked. Bounded, that cell is 139px,
 * the username gets 219px, and the three controls stack. Cells whose actions
 * already fit are untouched: `content` is 62px, `audio` 16px.
 *
 * `:last-child` rather than a marker class because the alternative is a prop
 * threaded through ten call sites that all already put their actions last; the
 * structure is the signal, and the narrow-viewport case in
 * `scripts/validate-cockpit-browser.mjs` is what checks it stays true.
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn(
          "w-full caption-bottom text-sm",
          "max-md:[&_tr>:last-child]:sticky max-md:[&_tr>:last-child]:right-0 max-md:[&_tr>:last-child]:max-w-36 max-md:[&_tr>:last-child]:flex-wrap max-md:[&_tr>:last-child]:bg-card",
          className
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
