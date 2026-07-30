import { Input } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import { dateState, fromDayInput, toDayInput, todayInput } from './date-value'
import { FieldShell, invalidBorder, type FieldShellProps } from './field'
import type { ValueProps } from './text'

/**
 * A calendar day, with "not set" as a state you can see and get back to.
 *
 * The bare control shows `tt.mm.jjjj` and nothing else, which reads as an
 * unfinished field — and in this product an empty date is a *decision*: an unset
 * publication date is the moment the release is built, and an unset `scheduled_at`
 * publishes with the next release. So the three states are drawn differently, the
 * caller's `fallback` sentence says what empty does, and nothing here ever fills
 * the field in on the operator's behalf. Clearing is a control of its own because
 * a date input's own clear affordance is a browser detail and in some browsers
 * absent — an operator who cannot get back to empty has lost a documented
 * behaviour.
 *
 * The value on the wire is the spelling the document uses: `date-value.ts` keeps a
 * calendar day a calendar day — both spellings of one, `date: 2026-07-30` as an
 * author writes it and `2026-07-30T00:00:00.000Z` as the API writes it back, because
 * reading either as a local moment showed the day before to every operator west of
 * Greenwich — and keeps every other instant an instant, shown as its local day and
 * carrying its local time of day across an edit, so correcting a year does not
 * silently move a document scheduled for 09:00 to midnight. The cost of calling
 * 00:00Z a day is written down in `isDayOnly`.
 *
 * No warning for a date in the past: unlike a credential's expiry, a backdated
 * publication date is ordinary. A caller that means something else passes its own.
 */
export function DateField({
  value,
  onChange,
  presets = false,
  min,
  max,
  ...shell
}: FieldShellProps &
  ValueProps<string | undefined> & {
    /**
     * The "Today" quick set. Off by default: a publication date is picked, not
     * offset — and the 30/90/365/Never counted-forward sets belong to a
     * credential's expiry, where `now + 30 days` is an answer somebody wants.
     */
    presets?: boolean
    /** Bounds for the control, as ISO instants or as days. */
    min?: string
    max?: string
  }) {
  const state = dateState(value)
  const error = shell.error ?? (state === 'invalid' ? `Not a date: ${value}` : undefined)

  return (
    <FieldShell {...shell} error={error}>
      {(control) => (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Input
              {...control}
              type="date"
              min={toDayInput(min)}
              max={toDayInput(max)}
              className={cn('w-auto', state === 'unset' && 'text-muted-foreground', invalidBorder(error))}
              value={toDayInput(value)}
              onChange={(event) => {
                // An empty control is the unset state, not a failed parse: the
                // operator emptying the field is the documented way to say
                // "whatever the release decides".
                if (event.target.value === '') {
                  onChange(undefined)
                  return
                }
                const next = fromDayInput(event.target.value, value)
                // A half-typed year is `undefined` from the parser but must not
                // clear a value the operator has not finished editing.
                if (next) onChange(next)
              }}
            />
            {/* The state in words, and all three of them. "tt.mm.jjjj" is a format
                rather than an answer; a control that has been cleared looks the
                same as one nobody has reached yet; and a value the control cannot
                render is blank there too, so calling that "Not set" would be the
                one conflation date-value.ts keeps a third state to prevent — an
                unset date will stay unset on save, an unreadable one is kept
                exactly as the author wrote it. */}
            <span data-testid={`${control['data-testid']}-state`} className="text-xs text-muted-foreground">
              {state === 'set' ? 'Set' : state === 'invalid' ? 'Not a date' : 'Not set'}
            </span>
            {state === 'unset' ? null : (
              <button
                type="button"
                data-testid={`${control['data-testid']}-clear`}
                disabled={control.disabled}
                onClick={() => onChange(undefined)}
                className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>

          {presets ? (
            <button
              type="button"
              data-testid={`${control['data-testid']}-preset-today`}
              disabled={control.disabled}
              // The clock is read on the click and nowhere else — this is the
              // operator asking for today, not the field deciding they meant it.
              // Routed through the same function a typed day takes, so the button
              // cannot mean something the control does not: today's day, keeping
              // the time of day of an instant it replaces.
              onClick={() => onChange(fromDayInput(todayInput(), value))}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              Today
            </button>
          ) : null}
        </div>
      )}
    </FieldShell>
  )
}
