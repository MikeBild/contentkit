/**
 * What the command palette may offer, and to whom.
 *
 * A palette is the one place in a console where every destination is one
 * keystroke away, so an entry the operator cannot reach is not a dead link — it
 * is a list of what somebody else is allowed to do, printed for someone who is
 * not. `authorize()` on the server has no hierarchy (site:admin implies none of
 * the read scopes), so a target names the ONE exact scope its destination needs,
 * the same string the sidebar entry names, and is dropped unless the session
 * holds that string. This is the sidebar's rule, applied to the same table.
 *
 * It is pure and view-free on purpose: the filter is the security-relevant half
 * of the palette, and it is worth being able to drive it with real scope sets in
 * a test rather than through a rendered dialog.
 */

export type PaletteGroup = 'Page' | 'Site' | 'Content'

export interface PaletteTarget {
  /** Unique across the groups; also the value the combobox commits. */
  id: string
  label: string
  group: PaletteGroup
  /** One line saying where it goes. Never the only place something is said. */
  hint?: string
  /** The one exact scope `authorize()` checks, or `null` where none is needed. */
  scope: string | null
  run: () => void
}

/** A nav entry as the palette needs it — `shell.tsx`'s NAV satisfies this. */
export interface PaletteNavEntry {
  to: string
  label: string
  scope: string | null
}

export interface PaletteSite {
  slug: string
  name: string
}

export interface PaletteContentItem {
  id: string
  /** Both live on the newest revision, so an item can have neither. */
  title?: string | null
  slug?: string | null
  /** The one name every item row has, merged revision or not. */
  translation_key: string
  kind: string
  locale: string
}

export interface PaletteSources {
  /** The whole navigation table, unfiltered: the filter below is the only one. */
  pages: readonly PaletteNavEntry[]
  /** Every site this credential may read — `GET /v1/sites` already answers that. */
  sites: readonly PaletteSite[]
  /** The selected site's content items, or empty where they were not read. */
  items: readonly PaletteContentItem[]
  /** `session.product_scopes`, verbatim. */
  scopes: readonly string[]
  /** The selected slug, so its own entry can say it is the one already open. */
  site: string
  goTo: (to: string) => void
  pickSite: (slug: string) => void
}

/** The content list is where an item is reachable; its scope is that page's scope. */
export const CONTENT_ROUTE = '/content'

/**
 * A bound on how many items are offered. `GET /v1/sites/{site}/content` takes no
 * `limit` and no `cursor`, so it answers with the whole site; a palette that put
 * every item in one listbox would be slower to type into than the list it is
 * meant to replace.
 */
export const MAX_CONTENT_TARGETS = 500

/** The one gate. `null` means the destination needs no scope, not "any scope". */
export function reachable(targets: readonly PaletteTarget[], scopes: readonly string[]): PaletteTarget[] {
  return targets.filter((target) => target.scope === null || scopes.includes(target.scope))
}

export function paletteTargets(sources: PaletteSources): PaletteTarget[] {
  const pages: PaletteTarget[] = sources.pages.map((entry) => ({
    id: `page:${entry.to}`,
    label: entry.label,
    group: 'Page',
    hint: entry.to,
    scope: entry.scope,
    run: () => sources.goTo(entry.to),
  }))

  // Switching the selection needs no scope of its own: the list came from
  // GET /v1/sites, which is already what this credential may read, and every
  // site-scoped page checks its own scope when it opens.
  const sites: PaletteTarget[] = sources.sites.map((site) => ({
    id: `site:${site.slug}`,
    label: site.name || site.slug,
    group: 'Site',
    hint: site.slug === sources.site ? `${site.slug} · current` : site.slug,
    scope: null,
    run: () => sources.pickSite(site.slug),
  }))

  // An item's scope is read off the content page rather than written here, so
  // the palette cannot drift from the sidebar if that page's scope ever changes.
  // No such page in the table means no scope to check against, and the honest
  // answer to that is to offer nothing rather than to guess one.
  const contentScope = sources.pages.find((entry) => entry.to === CONTENT_ROUTE)?.scope
  const items: PaletteTarget[] =
    contentScope === undefined
      ? []
      : sources.items.slice(0, MAX_CONTENT_TARGETS).map((item) => ({
          id: `item:${item.id}`,
          label: item.title || item.slug || item.translation_key,
          group: 'Content',
          hint: `${item.kind} · ${item.locale}`,
          scope: contentScope,
          run: () => sources.goTo(CONTENT_ROUTE),
        }))

  return reachable([...pages, ...sites, ...items], sources.scopes)
}
