import { Upload } from 'lucide-react'
import { useState, type DragEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Files in, by drag or by picker.
 *
 * Both, never one. Drag and drop is unreachable by keyboard and impossible on a
 * touch device, so the visible surface here *is* a `<label>` over a real
 * `<input type="file">`: Tab reaches it, Space and Enter open the picker, and the
 * accessible name comes from the label rather than from a `div` with a click
 * handler. The drag handlers sit on the same element, so there is one target and
 * one focus ring.
 *
 * What this component does NOT do is upload. The console has no endpoint to
 * upload an asset to — the only `multipart/form-data` operations in
 * docs/openapi.json are `POST /v1/sites/{site}/content` and
 * `PUT /v1/content/{item}/revisions`, and their one part is `document`, a
 * Markdown file. So this hands the files to its caller and nothing here invents a
 * request; wiring it to a store that does not exist yet would be a control that
 * fails after the operator has already dropped the file.
 */
export function Dropzone({
  onFiles,
  accept,
  multiple = false,
  disabled,
  label = 'Drop a file here, or choose one',
  hint,
  error,
  className,
  children,
  'data-testid': testId = 'ck-dropzone',
}: {
  onFiles: (files: File[]) => void
  /** The same syntax as the input's attribute: '.md,text/markdown', 'image/*'. */
  accept?: string
  multiple?: boolean
  disabled?: boolean
  label?: string
  hint?: ReactNode
  error?: string
  className?: string
  /** What was picked, rendered by the caller — the value is never held here. */
  children?: ReactNode
  'data-testid'?: string
}) {
  const [over, setOver] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)

  function take(files: FileList | null) {
    setRefused(null)
    const all = [...(files ?? [])]
    if (all.length === 0) return
    // `accept` filters the picker for free but says nothing about a drop, and a
    // dropped file of the wrong type has to be refused *here*: the alternative is
    // a 415 from the server, several seconds later, naming nothing the operator
    // recognises.
    const kept = all.filter((file) => matchesAccept(file, accept))
    const dropped = all.length - kept.length
    if (dropped > 0) setRefused(`${dropped === all.length ? 'That file is' : `${dropped} files are`} not ${accept}`)
    if (kept.length === 0) return
    onFiles(multiple ? kept : kept.slice(0, 1))
  }

  function stop(event: DragEvent<HTMLElement>) {
    // Without both of these the browser navigates to the dropped file and the
    // operator loses the page they were working in.
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        data-testid={testId}
        data-over={over ? 'true' : undefined}
        onDragEnter={(event) => {
          stop(event)
          if (!disabled) setOver(true)
        }}
        onDragOver={(event) => {
          stop(event)
          if (!disabled) setOver(true)
        }}
        onDragLeave={(event) => {
          stop(event)
          setOver(false)
        }}
        onDrop={(event) => {
          stop(event)
          setOver(false)
          if (!disabled) take(event.dataTransfer.files)
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center text-sm transition-colors focus-within:ring-2 focus-within:ring-accent',
          over ? 'border-accent bg-accent/10' : 'border-border hover:bg-muted/60',
          error || refused ? 'border-chart-5' : null,
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <input
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          data-testid={`${testId}-input`}
          className="sr-only"
          onChange={(event) => {
            take(event.target.files)
            // Cleared so that picking the same file twice fires again: a
            // re-drop after a failed save is a thing operators do.
            event.target.value = ''
          }}
        />
        <Upload className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <span>{label}</span>
        {accept ? <span className="text-xs text-muted-foreground">{accept}</span> : null}
      </label>

      {children}

      {error || refused ? (
        <p data-testid={`${testId}-error`} className="text-xs text-chart-5">
          {error ?? refused}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

/**
 * One entry of an `accept` list against a file: a MIME type, a `type/*` family or
 * an extension. No `accept` accepts everything, which is what the attribute means.
 */
function matchesAccept(file: File, accept: string | undefined): boolean {
  if (!accept) return true
  return accept.split(',').some((entry) => {
    const pattern = entry.trim().toLowerCase()
    if (!pattern) return false
    if (pattern.startsWith('.')) return file.name.toLowerCase().endsWith(pattern)
    if (pattern.endsWith('/*')) return file.type.toLowerCase().startsWith(pattern.slice(0, -1))
    return file.type.toLowerCase() === pattern
  })
}
