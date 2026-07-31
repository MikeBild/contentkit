import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ck } from '@/api/ck'
import { isApplePlatform, isShortcut } from '@/lib/keyboard'
import {
  CONTENT_ROUTE,
  paletteTargets,
  type PaletteGroup,
  type PaletteNavEntry,
  type PaletteTarget,
} from '@/lib/palette'
import { keys } from '@/lib/query'
import { useSession } from '@/lib/session'
import { useSite } from '@/lib/site'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './command'
import { Shortcut } from './kbd'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from './sidebar'

/**
 * ⌘K over the pages, the sites and the selected site's content.
 *
 * Built on cmdk's CommandDialog, which owns the input, the list and the
 * selection together. It used to be a Combobox inside the console's own Dialog,
 * and it paid for the mismatch twice: the combobox's listbox is an absolutely
 * positioned sibling and the dialog panel clips its overflow, so the panel had to
 * reserve a fixed height it could not need; and the dialog focuses its own close
 * button first, so the caret had to be moved onto the input a frame later. Both
 * hacks are gone rather than rewritten — the list is inside the panel and the
 * input is the panel's first focusable — and the closing key is the dialog's to
 * handle, not this component's.
 *
 * What it offers is decided by `paletteTargets`, which drops every entry whose one
 * exact scope the session does not hold — the sidebar's rule, over the sidebar's
 * table. `authorize()` has no hierarchy, so nothing here is offered on the
 * strength of a role.
 *
 * The trigger is part of the component. A shortcut nobody can see is not a
 * feature, and the hint is where an operator learns the chord in the first place.
 */

/**
 * The three kinds of destination, in the order the list draws them.
 *
 * Written out rather than derived from the targets, so an empty group cannot
 * reorder the two that are left under an operator who is already typing.
 */
const GROUP_ORDER: readonly PaletteGroup[] = ['Page', 'Site', 'Content']

export function CommandPalette({
  pages,
  'data-testid': testId = 'ck-command-palette',
}: {
  /** shell.tsx's NAV table, whole: the scope filter below is the only one. */
  pages: readonly PaletteNavEntry[]
  'data-testid'?: string
}) {
  const session = useSession()
  const { site, setSite, sites } = useSite()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
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
            search: ((previous: Record<string, unknown>) => (previous.site ? { site: previous.site } : {})) as never,
          }),
        pickSite: setSite,
      }),
    [pages, sites, items.data, session.product_scopes, site, navigate, setSite],
  )

  function run(target: PaletteTarget) {
    setOpen(false)
    target.run()
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton data-testid={`${testId}-open`} tooltip="Jump to…" onClick={() => setOpen(true)}>
            <Search data-icon="inline-start" />
            <span>Jump to…</span>
            <Shortcut letter="K" data-testid={`${testId}-hint`} className="ml-auto" />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Jump to"
        description="Pages, sites and this site’s content — only what this session may reach."
      >
        <Command data-testid={testId}>
          <CommandInput data-testid={`${testId}-search`} placeholder="Search pages, sites and content…" />
          <CommandList>
            <CommandEmpty>Nothing here matches.</CommandEmpty>
            {GROUP_ORDER.map((group) => {
              const inGroup = targets.filter((target) => target.group === group)
              if (inGroup.length === 0) return null
              return (
                <CommandGroup key={group} heading={group}>
                  {inGroup.map((target) => (
                    <CommandItem
                      key={target.id}
                      value={`${target.label} ${target.hint ?? ''}`}
                      data-testid={`${testId}-target-${target.id}`}
                      onSelect={() => run(target)}
                    >
                      <span className="truncate">{target.label}</span>
                      {target.hint ? (
                        <span className="ml-auto truncate text-xs text-muted-foreground">{target.hint}</span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
