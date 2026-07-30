import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ck } from '@/api/ck'
import { isApplePlatform, isShortcut } from '@/lib/keyboard'
import { CONTENT_ROUTE, paletteTargets, type PaletteNavEntry, type PaletteTarget } from '@/lib/palette'
import { keys } from '@/lib/query'
import { useSession } from '@/lib/session'
import { useSite } from '@/lib/site'
import { cn } from '@/lib/utils'
import { Combobox } from './combobox'
import { Dialog } from './dialog'
import { Shortcut } from './kbd'
import { Button } from './primitives'

/**
 * ⌘K over the pages, the sites and the selected site's content.
 *
 * Built on the dialog and the combobox that already exist rather than on a sixth
 * hand-rolled overlay: the dialog is what handles Escape, the focus trap and
 * returning focus to whatever opened it, and the combobox is what handles typing,
 * the arrow keys, Enter and the three states an option list can be in. A palette
 * is a dialog holding a combobox, and writing it as anything else would have been
 * a second component stack with the same two bugs the first one had.
 *
 * What it offers is decided by `paletteTargets`, which drops every entry whose one
 * exact scope the session does not hold — the sidebar's rule, over the sidebar's
 * table. `authorize()` has no hierarchy, so nothing here is offered on the
 * strength of a role.
 *
 * The trigger is part of the component. A shortcut nobody can see is not a
 * feature, and the hint is where an operator learns the chord in the first place.
 */
export function CommandPalette({
  pages,
  className,
  'data-testid': testId = 'ck-command-palette',
}: {
  /** shell.tsx's NAV table, whole: the scope filter below is the only one. */
  pages: readonly PaletteNavEntry[]
  className?: string
  'data-testid'?: string
}) {
  const session = useSession()
  const { site, setSite, sites } = useSite()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const search = useRef<HTMLDivElement>(null)
  const apple = useMemo(() => isApplePlatform(navigator), [])
  const mayReadContent = pages.some(
    (entry) => entry.to === CONTENT_ROUTE && (entry.scope === null || session.product_scopes.includes(entry.scope)),
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isShortcut(event, 'k', apple)) return
      // Ctrl+K is the address bar in a Chromium browser and ⌘K is a bookmark
      // dialog in some builds, so the default has to go — but only for this one
      // chord, which is why `isShortcut` refuses every neighbouring combination.
      event.preventDefault()
      setOpen((value) => !value)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [apple])

  useEffect(() => {
    if (!open) return
    // The dialog focuses its panel's first focusable, and in DOM order that is
    // the dialog's own close button. A palette that has to be Tabbed into before
    // it can be typed into is not a palette, so the caret is moved on the frame
    // after the dialog has had its turn. Focusing the input is also what opens
    // the combobox's list, so the whole set is visible before the first keystroke.
    const frame = requestAnimationFrame(() => search.current?.querySelector('input')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  // Nothing is fetched until the palette is opened by someone who may read it:
  // the sidebar is on every page, and a console that loaded a site's whole
  // content list to draw a button would pay for the palette on every navigation.
  const items = useQuery({
    queryKey: keys.content.list(site, {}),
    queryFn: () => ck.content.list(site, {}),
    enabled: open && Boolean(site) && mayReadContent,
    staleTime: 60_000,
  })

  const targets = useMemo(
    () =>
      paletteTargets({
        pages,
        sites,
        items: items.data ?? [],
        scopes: session.product_scopes,
        site,
        goTo: (to) =>
          void navigate({
            to,
            // The same one-key carry as components/app-link.tsx: TanStack
            // replaces the search on navigation, and dropping `?site=` here
            // would land the operator on a different site than the one the
            // palette was opened from.
            search: ((previous: Record<string, unknown>) =>
              previous.site ? { site: previous.site } : {}) as never,
          }),
        pickSite: setSite,
      }),
    [pages, sites, items.data, session.product_scopes, site, navigate, setSite],
  )

  const byId = useMemo(() => new Map(targets.map((target) => [target.id, target])), [targets])

  function run(target: PaletteTarget | undefined) {
    if (!target) return
    setOpen(false)
    target.run()
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        data-testid={`${testId}-open`}
        className={cn('w-full justify-between', className)}
        onClick={() => setOpen(true)}
      >
        <span className="flex items-center gap-2 text-muted-foreground">
          <Search className="h-3.5 w-3.5" />
          Jump to…
        </span>
        <Shortcut letter="K" data-testid={`${testId}-hint`} />
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Jump to"
        description="Pages, sites and this site’s content — only what this session may reach."
        size="lg"
        // The combobox's list is an absolutely positioned sibling and the dialog
        // panel clips its overflow, so the panel reserves the room instead of the
        // palette resizing under the operator as they type.
        className="h-[26rem]"
        data-testid={testId}
      >
        <div ref={search}>
          <Combobox
            data-testid={`${testId}-search`}
            placeholder="Search pages, sites and content…"
            value=""
            isLoading={items.isPending && items.fetchStatus === 'fetching'}
            error={items.error}
            emptyMessage="Nothing here matches."
            options={targets.map((target) => ({
              value: target.id,
              label: target.label,
              hint: target.hint ? `${target.group} · ${target.hint}` : target.group,
            }))}
            onChange={(id) => run(byId.get(id))}
          />
        </div>
      </Dialog>
    </>
  )
}
