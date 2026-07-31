import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { cn } from '@/lib/utils'
import { FieldShell, type FieldShellProps } from './field'

export interface ObjectListItemApi<T> {
  index: number
  /** Merges into this row. The array itself stays immutable. */
  update: (patch: Partial<T>) => void
  /** Dotted path for this row's fields, so nested errors and testids line up. */
  path: (key: string) => string
}

/**
 * An ordered list of objects: add, remove, and move.
 *
 * Order is data here, not presentation — a docs version list renders in the
 * order it is stored — so reordering is an explicit action rather than a sort.
 * Buttons and not drag-and-drop: a keyboard operator can use these, and there is
 * no drop target to miss.
 *
 * `exclusiveFlag` is the interesting one. "Exactly one version is current" is a
 * rule a checkbox column can break in two directions at once; a radio column
 * cannot express either violation. The invalid state is removed rather than
 * validated.
 */
export function ObjectListField<T extends Record<string, unknown>>({
  value,
  onChange,
  create,
  renderItem,
  itemLabel,
  uniqueBy,
  exclusiveFlag,
  addLabel = 'Add',
  emptyMessage = 'None yet.',
  max,
  ...shell
}: FieldShellProps & {
  value: readonly T[]
  onChange: (value: T[]) => void
  /** The row a fresh "Add" produces, already valid enough to render. */
  create: () => T
  renderItem: (item: T, api: ObjectListItemApi<T>) => ReactNode
  itemLabel?: (item: T, index: number) => ReactNode
  /** Whatever must not repeat — a version id, a slug. Duplicates are named, not dropped. */
  uniqueBy?: (item: T) => string
  exclusiveFlag?: { key: keyof T & string; label: string }
  addLabel?: string
  emptyMessage?: string
  max?: number
}) {
  const keys = uniqueBy ? value.map(uniqueBy) : []
  const duplicates = new Set(keys.filter((key, index) => key && keys.indexOf(key) !== index))
  const error =
    shell.error ??
    (duplicates.size ? `Duplicate: ${[...duplicates].join(', ')}` : undefined) ??
    (max !== undefined && value.length > max ? `At most ${max}` : undefined)

  function replace(index: number, next: T) {
    onChange(value.map((item, at) => (at === index ? next : item)))
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= value.length) return
    const next = [...value]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    onChange(next)
  }

  return (
    <FieldShell {...shell} error={error} hint={shell.hint ?? `${value.length}${max ? `/${max}` : ''}`}>
      {(control) => (
        <div className="flex flex-col gap-2" data-testid={control['data-testid']}>
          {value.length === 0 ? (
            <Empty className="border" data-testid={`${control['data-testid']}-empty`}>
              <EmptyHeader>
                <EmptyTitle>{emptyMessage}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : null}

          {value.map((item, index) => {
            const duplicate = uniqueBy ? duplicates.has(uniqueBy(item)) : false
            return (
              <div
                key={index}
                data-testid={`${control['data-testid']}-item-${index}`}
                className={cn(
                  'rounded-lg border p-3',
                  duplicate ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-background',
                )}
              >
                <div className="mb-2 flex items-center gap-2">
                  {exclusiveFlag ? (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="radio"
                        name={`${control.id}-${exclusiveFlag.key}`}
                        checked={Boolean(item[exclusiveFlag.key])}
                        disabled={control.disabled}
                        data-testid={`${control['data-testid']}-exclusive-${index}`}
                        onChange={() =>
                          onChange(
                            value.map((entry, at) => ({ ...entry, [exclusiveFlag.key]: at === index }) as T),
                          )
                        }
                      />
                      {exclusiveFlag.label}
                    </label>
                  ) : null}
                  <span className="text-xs font-medium text-muted-foreground">
                    {itemLabel ? itemLabel(item, index) : `#${index + 1}`}
                  </span>
                  <div className="ml-auto flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Move up"
                      data-testid={`${control['data-testid']}-up-${index}`}
                      disabled={control.disabled || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Move down"
                      data-testid={`${control['data-testid']}-down-${index}`}
                      disabled={control.disabled || index === value.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon-sm"
                      aria-label="Remove"
                      data-testid={`${control['data-testid']}-remove-${index}`}
                      disabled={control.disabled}
                      onClick={() => onChange(value.filter((_, at) => at !== index))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                {renderItem(item, {
                  index,
                  update: (patch) => replace(index, { ...item, ...patch }),
                  path: (key) => `${index}.${key}`,
                })}
              </div>
            )
          })}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            data-testid={`${control['data-testid']}-add`}
            disabled={control.disabled || (max !== undefined && value.length >= max)}
            onClick={() => {
              const fresh = create()
              // A first row that owns the exclusive flag by construction: an
              // empty list has nothing to be "current", a one-row list must.
              onChange([...value, exclusiveFlag && value.length === 0 ? { ...fresh, [exclusiveFlag.key]: true } : fresh])
            }}
          >
            <Plus data-icon="inline-start" />
            {addLabel}
          </Button>
        </div>
      )}
    </FieldShell>
  )
}
