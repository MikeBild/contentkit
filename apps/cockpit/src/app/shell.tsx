import { Outlet, useRouterState } from '@tanstack/react-router'
import {
  Activity,
  BookOpen,
  Boxes,
  FileText,
  Globe,
  KeyRound,
  LayoutDashboard,
  MessagesSquare,
  Moon,
  Presentation,
  Rocket,
  ScrollText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Volume2,
  Webhook,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { ck } from '@/api/ck'
import { AppLink } from '@/components/app-link'
import { Breadcrumb, type Crumb } from '@/components/ui/breadcrumb'
import { CommandPalette } from '@/components/ui/command-palette'
import { Button, Select } from '@/components/ui/primitives'
import { useSession } from '@/lib/session'
import { useSite } from '@/lib/site'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

/**
 * The console's two contexts.
 *
 * A large part of the documented /v1 surface carries no {site} at all —
 * Moderation runs on /v1/comments, /v1/contact-submissions and /v1/feedback,
 * Credentials on /v1/api-keys and /v1/identity-grants, Audit on
 * /v1/audit-events. (The exact split is counted from docs/openapi.json by
 * test/unit/cockpit-navigation.test.mjs; a number written down here would be
 * stale the next time a path is added, and was.) A single flat list under a
 * single site switcher therefore claimed something untrue: that the selected
 * site governs every page. It governs the pages below, and no others.
 *
 * So every entry declares:
 *
 * - `scope`     the one exact scope its page needs. authorize() has no
 *               hierarchy, so a nav item must never be shown on the strength of
 *               a role, and these strings are a contract with the server.
 * - `context`   'site' where the selected site is a path parameter of what the
 *               page reads and writes — including `/v1/sites/{site}` itself,
 *               which is one site's record — and 'installation' where it is
 *               not. `GET/POST /v1/sites` is the registry: a list, and a
 *               creation that names no existing site.
 * - `selection` what the site switcher actually does to this page, checked
 *               against the page's own source: see SELECTION below.
 * - `api`       the documented paths the page talks to, as exact paths or a
 *               `/*` prefix. The navigation test does not take this list on
 *               trust: it derives the paths each page really reaches from the
 *               `ck.*` calls in its module tree and requires the two sets to be
 *               equal, so a declaration cannot drift from the code and a
 *               crossing cannot arrive unnoticed.
 */
/**
 * What the site switcher does to a page, in the five shapes the console has.
 *
 * The navigation test derives the right value for each page from that page's own
 * source — which names it destructures out of `useSite()`, whether it renders
 * <NoSite/> without a selection, whether it copies the selection into
 * `useState` — and compares it with what is declared here. None of these is a
 * word anyone can simply assert over a page that does something else.
 *
 * - 'governs'  the site is a path parameter. Site context by definition, and the
 *              page shows nothing without a selection.
 * - 'requires' the endpoints are installation-wide, but the page renders
 *              <NoSite/> until a site is selected. The switcher is the control
 *              that fixes exactly that, so it is never dimmed here.
 * - 'scopes'   installation-wide, reads the selection live, still renders
 *              without one.
 * - 'seeds'    the page copies the selection into its own state once. Moving the
 *              switcher afterwards changes nothing on screen, so the caption
 *              must not promise a filter.
 * - 'ignored'  the page never reads the selection.
 *
 * Only 'seeds' and 'ignored' are dimmed: they are the two where moving the
 * switcher does not change what the open page shows.
 */
const NAV = [
  {
    to: '/',
    label: 'Overview',
    icon: LayoutDashboard,
    scope: 'stats:read',
    context: 'site',
    selection: 'governs',
    // The release chain is derived from the two lists that answer it; both are
    // site-parameterised, so the page stays in the site context.
    api: ['/v1/sites/{site}/stats/*', '/v1/sites/{site}/content', '/v1/sites/{site}/releases'],
  },
  {
    to: '/content',
    label: 'Content',
    icon: FileText,
    scope: 'content:read',
    context: 'site',
    selection: 'governs',
    // /v1/content/{item}… carries no {site}, but an item id resolves to exactly
    // one site and the list that produced it is site-scoped.
    api: [
      '/v1/sites/{site}/content',
      '/v1/sites/{site}/render',
      '/v1/sites/{site}/previews',
      '/v1/sites/{site}/access/groups',
      '/v1/sites/{site}/audio/jobs',
      '/v1/sites/{site}/compositions/validate',
      '/v1/sites/{site}/decks/validate',
      '/v1/sites/{site}/published/{kind}/{locale}/{slug}',
      '/v1/content/{item}',
      '/v1/content/{item}/revisions',
      '/v1/content/{item}/published',
      '/v1/content/{item}/audio',
    ],
  },
  {
    to: '/published',
    label: 'Published',
    icon: Search,
    scope: 'content:read',
    context: 'site',
    selection: 'governs',
    api: ['/v1/sites/{site}/published', '/v1/sites/{site}/published/*', '/v1/sites/{site}/search'],
  },
  {
    to: '/compositions',
    label: 'Compositions',
    icon: Boxes,
    scope: 'content:read',
    context: 'site',
    selection: 'governs',
    api: [
      '/v1/sites/{site}/compositions/*',
      '/v1/composition-patterns',
      '/v1/composition-patterns/{pattern}',
      '/v1/publishing-guides',
      '/v1/publishing-guides/{guide}',
    ],
  },
  {
    to: '/decks',
    label: 'Decks',
    icon: Presentation,
    scope: 'content:read',
    context: 'site',
    selection: 'governs',
    // Not /v1/sites/{site}/decks/plan: the Cockpit compiles and validates, and
    // nothing in it calls plan. A `decks/*` prefix here would have claimed it.
    api: [
      '/v1/sites/{site}/decks/compile',
      '/v1/sites/{site}/decks/validate',
      '/v1/sites/{site}/deck-jobs/*',
      '/v1/deck-themes',
      '/v1/deck-templates',
    ],
  },
  {
    to: '/releases',
    label: 'Releases',
    icon: Rocket,
    scope: 'content:read',
    context: 'site',
    selection: 'governs',
    api: [
      '/v1/sites/{site}/releases',
      '/v1/sites/{site}/releases/*',
      '/v1/sites/{site}/previews',
      '/v1/sites/{site}/content',
      '/v1/content/{item}/revisions',
    ],
  },
  {
    to: '/audio',
    label: 'Audio',
    icon: Volume2,
    scope: 'content:read',
    context: 'site',
    selection: 'governs',
    // The per-item audio endpoints belong to Content, which is where a single
    // item's narration is created and removed; this page is the site's queue.
    api: ['/v1/sites/{site}/audio/*'],
  },
  {
    to: '/access',
    label: 'Reader access',
    icon: ShieldCheck,
    scope: 'access:admin',
    context: 'site',
    selection: 'governs',
    // The rebuild banner builds a release, because access rules are snapshotted
    // into one and nothing changes for a reader until then.
    api: ['/v1/sites/{site}/access/*', '/v1/sites/{site}/releases'],
  },
  {
    to: '/webhooks',
    label: 'Webhooks',
    icon: Webhook,
    scope: 'webhook:admin',
    context: 'site',
    selection: 'governs',
    api: [
      '/v1/sites/{site}/webhooks',
      '/v1/sites/{site}/webhooks/*',
      '/v1/webhook-deliveries',
      '/v1/webhook-deliveries/{delivery}/retry',
    ],
  },
  {
    to: '/settings',
    label: 'Site settings',
    icon: SlidersHorizontal,
    scope: 'site:admin',
    context: 'site',
    // GET and PATCH /v1/sites/{site} for the one slug the switcher names. It is
    // the same path the registry deletes through, which is exactly why the two
    // are separate pages: here the switcher decides the target, there the row
    // does. The locale rows live here too and nowhere else: `SitePatch` never
    // writes them, so the build matrix is edited through its own endpoints —
    // still the selected site's, so nothing crosses out of the site context.
    selection: 'governs',
    api: ['/v1/sites/{site}', '/v1/sites/{site}/locales', '/v1/sites/{site}/locales/{locale}'],
  },
  {
    to: '/sites',
    label: 'Sites',
    icon: Globe,
    scope: 'site:admin',
    context: 'installation',
    // The registry: what exists, one creation, one deletion per row. The
    // creation is a single POST /v1/sites that carries the locale rows and the
    // settings with it, so no locale endpoint is reached from here. Nothing
    // reads the switcher — the site being deleted is the row the operator
    // opened the dialog from.
    selection: 'ignored',
    api: ['/v1/sites', '/v1/sites/{site}'],
  },
  {
    to: '/moderation',
    label: 'Moderation',
    icon: MessagesSquare,
    scope: 'moderation:write',
    context: 'installation',
    // The endpoints hold every site's rows and the page narrows its lists with
    // ?site_id=; the mutations are id-addressed and carry no site at all. It
    // renders nothing at all without a selection, though, which is why the
    // switcher stays bright here.
    selection: 'requires',
    api: [
      '/v1/comments',
      '/v1/comments/{comment}',
      '/v1/contact-submissions',
      '/v1/contact-submissions/{id}',
      '/v1/feedback',
      '/v1/feedback/{item}',
      '/v1/sites/{site}/content',
    ],
  },
  {
    to: '/credentials',
    label: 'Credentials',
    icon: KeyRound,
    scope: 'api-key:admin',
    context: 'installation',
    // A key or grant may name site_ids, but it is issued installation-wide and
    // this page never reads the switcher.
    selection: 'ignored',
    api: [
      '/v1/api-keys',
      '/v1/api-keys/{id}',
      '/v1/identity-grants',
      '/v1/identity-grants/{id}',
      '/v1/identity/providers',
    ],
  },
  {
    to: '/audit',
    label: 'Audit',
    icon: ScrollText,
    scope: 'audit:read',
    context: 'installation',
    // One append-only trail for the installation, with its own in-page site
    // filter. `useState(site)` seeds that filter from the selection on the
    // page's first render and it is the operator's from then on — so on a cold
    // load, where no site is selected yet, it opens on every site, and moving
    // the switcher afterwards never re-narrows the list. The caption must claim
    // neither.
    selection: 'seeds',
    api: ['/v1/audit-events'],
  },
  {
    to: '/assistant',
    label: 'Assistant',
    icon: BookOpen,
    scope: 'content:write',
    context: 'installation',
    // Installation-wide transport, but every turn is sent with the selected
    // site and previews render through it. The page renders without a
    // selection; only sending is disabled.
    selection: 'scopes',
    api: ['/v1/assistant/messages', '/v1/assistant/elicitations/{elicitation}', '/v1/sites/{site}/render'],
  },
  {
    to: '/system',
    label: 'System',
    icon: Activity,
    scope: null,
    context: 'installation',
    selection: 'ignored',
    api: ['/health', '/ready', '/v1/publish-due', '/v1/maintenance/storage-gc'],
  },
] as const

type NavEntry = (typeof NAV)[number]

/**
 * Pages whose endpoints straddle the two contexts, and why they are not split.
 *
 * This used to be a list of labels, and a label is a two-way blanket: it excused
 * a site page reaching installation paths *and* an installation page reaching
 * site paths, so moving an entry to the wrong side of the split changed nothing
 * that any test could see. Four of fifteen entries were unpinned — exactly the
 * four judgement calls the split exists to make.
 *
 * So an exemption is now directional and exhaustive. It repeats the `context`
 * the entry claims, and it lists every path that crosses out of that context by
 * name. The test refuses a crossing that is not listed, a listed path that no
 * longer crosses, and a `context` that disagrees with the NAV entry — so
 * flipping a context makes the crossing set the other set, and the exemption
 * stops matching.
 */
const MIXED = [
  {
    label: 'Webhooks',
    context: 'site',
    crosses: ['/v1/webhook-deliveries', '/v1/webhook-deliveries/{delivery}/retry'],
    reason:
      'the endpoints are per-site, but /v1/webhook-deliveries holds every site’s attempts and /v1/webhook-deliveries/{delivery}/retry is id-addressed; the page narrows the list with ?site_id=',
  },
  {
    label: 'Decks',
    context: 'site',
    crosses: ['/v1/deck-themes', '/v1/deck-templates'],
    reason: 'per-site compile and validate, against the installation catalogs /v1/deck-themes and /v1/deck-templates',
  },
  {
    label: 'Compositions',
    context: 'site',
    crosses: [
      '/v1/composition-patterns',
      '/v1/composition-patterns/{pattern}',
      '/v1/publishing-guides',
      '/v1/publishing-guides/{guide}',
    ],
    reason:
      'per-site compile, against the installation catalogs /v1/composition-patterns and /v1/publishing-guides, which describe the software rather than any site',
  },
  {
    label: 'Assistant',
    context: 'installation',
    crosses: ['/v1/sites/{site}/render'],
    reason:
      'installation-wide transport on /v1/assistant/messages and /v1/assistant/elicitations/{elicitation}, but its previews render through /v1/sites/{site}/render for the selected site',
  },
  {
    label: 'Moderation',
    context: 'installation',
    crosses: ['/v1/sites/{site}/content'],
    reason:
      'installation-wide rows on /v1/comments, /v1/contact-submissions and /v1/feedback; GET /v1/sites/{site}/content is read only to turn an item id in a comment row into the post’s title',
  },
  {
    label: 'Sites',
    context: 'installation',
    crosses: ['/v1/sites/{site}'],
    reason:
      'a registry over /v1/sites, where creating a site carries its locale rows and its settings in that one call, but deleting one is DELETE /v1/sites/{site} — and that names the row the dialog was opened from, never the switcher',
  },
] as const

/**
 * The entry the open path belongs to, by two rules that decide nothing today.
 *
 * '/' is matched exactly rather than by the general branch, which for it would
 * read `pathname.startsWith('//')` — correct only for as long as no doubled
 * slash ever reaches the router. And where two entries both match, the longest
 * `to` wins, for a nested route ('/content/drafts' under '/content') the table
 * does not have. No entry's `to` is a prefix of another right now, so both are
 * guards for a shape that does not yet exist: neither changes an outcome for the
 * sixteen routes above, and two mutations to this function survived a whole
 * round because of it. test/unit/cockpit-navigation.test.mjs therefore drives it
 * with a table of its own, so the rules are pinned by what they do rather than
 * by a table that happens not to exercise them.
 */
function entryFor(pathname: string): NavEntry | undefined {
  return NAV.filter((item) =>
    item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`),
  ).sort((first, second) => second.to.length - first.to.length)[0]
}

const GROUPS = [
  { context: 'site' as const, label: 'Site', testId: 'nav-group-site' },
  { context: 'installation' as const, label: 'Installation', testId: 'nav-group-installation' },
]

/** What to say about the switcher on a page it does not fully govern. */
const SELECTION_NOTE = {
  governs: '',
  requires: 'This page needs a site',
  scopes: 'Applies to this page only',
  seeds: 'Only seeded this page’s own filter',
  ignored: 'Not used on this page',
}

/**
 * The two relations where moving the switcher changes nothing on the open page.
 *
 * Dimming a control the page cannot do without — Moderation shows <NoSite/>
 * until one is selected — told the operator to ignore the one thing that would
 * fix the empty page. 'requires' and 'scopes' therefore stay at full opacity
 * and say what they do in words instead.
 */
const DIMMED: readonly NavEntry['selection'][] = ['seeds', 'ignored']

/** The switcher's caption for the open page, and the long reason behind it. */
function switcherNote(open: NavEntry | undefined) {
  const mixture = MIXED.find((entry) => entry.label === open?.label)
  if (!open) return { text: '', reason: undefined }
  if (open.selection !== 'governs') return { text: SELECTION_NOTE[open.selection], reason: mixture?.reason }
  // A page the switcher does govern can still reach past the site — say so
  // rather than leaving the sidebar to imply otherwise.
  return { text: mixture ? 'Parts of this page are installation-wide' : '', reason: mixture?.reason }
}

export function Shell() {
  const session = useSession()
  const { site, setSite, sites, isLoading, error } = useSite()
  const { resolved, setTheme } = useTheme()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const open = entryFor(pathname)
  const note = switcherNote(open)

  const visible = NAV.filter((item) => !item.scope || session.product_scopes.includes(item.scope))
  // The switcher belongs to the site group, but installation pages read the
  // selection too, so it has to stay reachable while any page that reads it is
  // visible — otherwise Moderation, which shows nothing without one, offers no
  // way to choose.
  const switcherUsed = visible.some((item) => item.selection !== 'ignored')

  return (
    <div className="flex h-full">
      <aside data-testid="sidebar" className="flex w-56 shrink-0 flex-col border-r border-border bg-surface">
        <div className="px-4 py-4">
          <div className="text-[0.7rem] font-semibold tracking-[0.18em] text-muted-foreground">CONTENTKIT</div>
          <div className="text-sm font-semibold">Cockpit</div>
        </div>

        {/*
         * The palette sits above both groups because it reaches into both, and it
         * is passed the whole NAV table rather than the filtered `visible` list:
         * it applies the same scope rule itself (lib/palette.ts), so the one place
         * an entry can be offered is the one place it is checked. The trigger is
         * visible on every page — a ⌘K nobody is told about is not a feature.
         */}
        <div className="px-3 pb-3">
          <CommandPalette pages={NAV} />
        </div>

        <nav data-testid="nav" className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-2">
          {GROUPS.map((group) => {
            const items = visible.filter((item) => item.context === group.context)
            const carriesSwitcher = group.context === 'site' && switcherUsed
            if (items.length === 0 && !carriesSwitcher) return null
            return (
              <div key={group.context} data-testid={group.testId} className="mb-3">
                <div className="px-2 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {group.label}
                </div>

                {/*
                 * The switcher sits under the "Site" heading rather than above
                 * both groups, so what it governs is what appears beneath it.
                 *
                 * It is captioned on every page it does not simply govern, and
                 * dimmed only where moving it changes nothing here (see DIMMED).
                 * It is never MOVED: one position and one testid on every route,
                 * because a control that jumps as the route changes costs the
                 * operator a second look every time, and because `?site=` stays
                 * in the URL and in effect across every route — the selection is
                 * live state whether or not the open page reads it, so an
                 * operator can line up the next site before they navigate.
                 *
                 * It is unmounted in exactly one case, and it is not a route: a
                 * session for which no VISIBLE page reads the selection at all
                 * (`switcherUsed` above — Credentials and System, say). There the
                 * control would govern nothing that is on screen or reachable
                 * from it, and an empty site group would be a heading over a
                 * control with no consequence.
                 */}
                {carriesSwitcher ? (
                  <div
                    data-testid="site-switcher-scope"
                    data-relation={open?.selection ?? 'governs'}
                    className={cn('px-1 pb-2', open && DIMMED.includes(open.selection) && 'opacity-60')}
                  >
                    <SiteSwitcher site={site} setSite={setSite} sites={sites} isLoading={isLoading} error={error} />
                    {note.text ? (
                      <div
                        data-testid="site-switcher-note"
                        title={note.reason}
                        className="px-1 pt-1 text-[0.65rem] text-muted-foreground"
                      >
                        {note.text}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {items.map(({ to, label, icon: Icon }) => (
                  <AppLink
                    key={to}
                    to={to}
                    data-testid={`nav-${to === '/' ? 'overview' : to.slice(1)}`}
                    className={cn(
                      'mb-0.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
                      open?.to === to
                        ? 'bg-muted font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted/60',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                  </AppLink>
                ))}
              </div>
            )
          })}
        </nav>

        <div className="border-t border-border p-3">
          <div data-testid="operator-name" className="truncate text-xs text-muted-foreground" title={session.subject}>
            {session.display_name || session.email || session.subject}
          </div>
          <div
            data-testid="operator-role"
            className="mt-0.5 text-[0.7rem] uppercase tracking-wide text-muted-foreground"
          >
            {session.role}
          </div>
          <div className="mt-2 flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle theme"
              data-testid="theme-toggle"
              onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
            >
              {resolved === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="sign-out"
              onClick={async () => {
                await ck.identity.logout()
                window.location.assign(ck.identity.loginUrl('/cockpit/'))
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </aside>

      <main className="scrollbar-thin flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}

function SiteSwitcher({
  site,
  setSite,
  sites,
  isLoading,
  error,
}: {
  site: string
  setSite: (site: string) => void
  sites: { id: string; slug: string; name: string }[]
  isLoading: boolean
  error: unknown
}) {
  if (isLoading) return <div className="px-1 text-xs text-muted-foreground">Loading sites…</div>
  if (error)
    return (
      <div className="px-1 text-xs text-chart-5">
        {error instanceof Error ? error.message : 'Sites could not be loaded'}
      </div>
    )
  if (sites.length === 0)
    return <div className="px-1 text-xs text-muted-foreground">No sites yet — create one under Sites.</div>
  return (
    <Select
      data-testid="site-switcher"
      className="w-full"
      value={site}
      onChange={(event) => setSite(event.target.value)}
    >
      {sites.map((candidate) => (
        <option key={candidate.id} value={candidate.slug}>
          {candidate.name}
        </option>
      ))}
    </Select>
  )
}

/**
 * The trail for the open page: 'Site · <site name> · <page>' where the selected
 * site is a path parameter, 'Installation · <page>' where it is not.
 */
function useCrumbs(title: string): Crumb[] {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { site, current } = useSite()
  const open = entryFor(pathname)
  if (!open) return [{ label: title }]
  if (open.context === 'installation') return [{ label: 'Installation' }, { label: title }]
  // The name once the list has loaded, the slug meanwhile — never a blank crumb
  // where the site should be.
  const named = current?.name || site
  return [{ label: 'Site' }, { label: named || 'No site selected', placeholder: !named }, { label: title }]
}

export function Page({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  const crumbs = useCrumbs(title)
  return (
    <div data-testid="page" data-page={title} className="mx-auto max-w-7xl p-6">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <Breadcrumb items={crumbs} className="mb-1" />
          <h1 data-testid="page-title" className="text-lg font-semibold tracking-tight">
            {title}
          </h1>
          {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
      </header>
      {children}
    </div>
  )
}

/** Shown wherever a site-scoped page has no site selected yet. */
export function NoSite() {
  return (
    <div
      data-testid="no-site"
      className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground"
    >
      Choose a site in the sidebar to continue.
    </div>
  )
}
