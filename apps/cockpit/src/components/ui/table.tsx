"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type TableProps = React.ComponentProps<"table"> & {
  /**
   * Column names in visual order. They become the left-hand labels of the
   * stacked row below `md`; an empty final label marks an action cell.
   */
  mobileLabels: readonly string[]
}

/**
 * A table at desktop widths and a labelled record list below the shell's `md`
 * breakpoint. The native table remains in the DOM, so its headers and row
 * relationships stay available to assistive technology while CSS changes only
 * the visual layout. Fixed desktop layout plus wrapping keeps long identifiers,
 * URLs and translated headings inside the available pane instead of creating a
 * second horizontal navigation axis.
 */
function Table({ className, mobileLabels, style, ...props }: TableProps) {
  const labelProperties = Object.fromEntries(
    mobileLabels.map((label, index) => [`--ck-table-label-${index + 1}`, JSON.stringify(label)]),
  ) as React.CSSProperties
  const hasActionColumn = mobileLabels.at(-1) === ''

  return (
    <div
      data-slot="table-container"
      className="relative min-w-0 w-full overflow-x-clip"
    >
      <table
        data-slot="table"
        data-responsive-table="true"
        data-mobile-actions={hasActionColumn ? 'true' : undefined}
        className={cn(
          "w-full table-fixed caption-bottom text-sm",
          className
        )}
        style={{ ...labelProperties, ...style }}
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
        "h-10 px-2 text-left align-middle font-medium whitespace-normal break-words text-foreground [&:has([role=checkbox])]:pr-0",
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
        "p-2 align-middle whitespace-normal break-words [overflow-wrap:anywhere] [&:has([role=checkbox])]:pr-0",
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
