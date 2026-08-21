import { Outlet, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  BookOpen,
  Boxes,
  ChevronDown,
  ChevronsUpDown,
  FileText,
  Globe,
  KeyRound,
  Languages,
  LayoutDashboard,
  ListChecks,
  Library,
  LogOut,
  MessagesSquare,
  Newspaper,
  UserRound,
  Palette,
  Presentation,
  Rocket,
  ScrollText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Volume2,
  Webhook,
} from 'lucide-react'
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { ck } from '@/api/ck'
import { AppLink } from '@/components/app-link'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Spinner } from '@/components/ui/spinner'
import { useSession } from '@/lib/session'
import { useI18n, type LocalePreference, type TranslationKey } from '@/lib/i18n-context'
import { useSite } from '@/lib/site'
import { useTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { visibleLabel } from '@/lib/opaque'
import { keys } from '@/lib/query'

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
 * - `group`     the block of the sidebar it is drawn in (GROUPS below). Two
 *               headings answered "whose endpoints?" and nothing answered "what
 *               am I doing?", so the site's own pages are grouped by the job
 *               they belong to. It is presentation, and the navigation test
 *               checks it against `context` rather than trusting it.
 * - `selection` what the site switcher actually does to this page, checked
 *               against the page's own source: see SELECTION_NOTE below.
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
    group: 'overview',
    selection: 'governs',
    // The release chain is derived from the two lists that answer it; both are
    // site-parameterised, so the page stays in the site context.
    api: [
      '/v1/sites/{site}/stats/*',
      '/v1/sites/{site}/content',
      '/v1/sites/{site}/releases',
      '/v1/sites/{site}/decisions',
      '/v1/audit-events',
    ],
  },
  {
    to: '/decisions',
    label: 'Decisions',
    icon: ListChecks,
    scope: ['content:write', 'moderation:write', 'release:write'],
    context: 'site',
    group: 'overview',
    selection: 'governs',
    api: [
      '/v1/sites/{site}/decisions',
      '/v1/sites/{site}/decisions/{decision}',
      '/v1/sites/{site}/draft-captures/{capture}/triage',
      '/v1/sites/{site}/draft-captures/{capture}/discard',
      '/v1/sites/{site}/promotion-reviews/{review}',
      '/v1/sites/{site}/promotion-reviews/{review}/reject',
      '/v1/sites/{site}/render',
      '/v1/comments/{comment}',
      '/v1/contact-submissions/{id}',
      '/v1/feedback/{item}',
    ],
  },
  {
    to: '/content',
    label: 'Documents',
    icon: FileText,
    scope: 'content:read',
    context: 'site',
    group: 'content',
    selection: 'governs',
    // 'Documents' rather than 'Content': the block above it is called Content,
    // and a page named after its own heading says nothing. The route, the scope
    // and the page are unchanged.
    // /v1/content/{item}… carries no {site}, but an item id resolves to exactly
    // one site and the list that produced it is site-scoped.
    api: [
      '/v1/sites/{site}/content',
      '/v1/sites/{site}/render',
      '/v1/sites/{site}/previews',
      '/v1/sites/{site}/draft-captures',
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
    group: 'content',
    selection: 'governs',
    api: ['/v1/sites/{site}/published', '/v1/sites/{site}/published/*', '/v1/sites/{site}/search'],
  },
  {
    to: '/compositions',
    label: 'Compositions',
    icon: Boxes,
    scope: 'content:read',
    context: 'site',
    group: 'tools',
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
    group: 'tools',
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
    group: 'deliver',
    selection: 'governs',
    api: [
      '/v1/sites/{site}/releases',
      '/v1/sites/{site}/releases/{release}',
      '/v1/sites/{site}/releases/{release}/activate',
      '/v1/sites/{site}/releases/{release}/promote',
      '/v1/sites/{site}/promotion-reviews/{review}',
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
    group: 'deliver',
    selection: 'governs',
    // The per-item audio endpoints belong to Documents, which is where a single
    // item's narration is created and removed; this page is the site's queue.
    api: ['/v1/sites/{site}/audio/*'],
  },
  {
    to: '/access',
    label: 'Reader access',
    icon: ShieldCheck,
    scope: 'access:admin',
    context: 'site',
    group: 'access',
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
    group: 'access',
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
    group: 'settings',
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
    icon: Library,
    scope: 'site:admin',
    context: 'installation',
    group: 'installation',
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
    group: 'installation',
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
    group: 'installation',
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
    group: 'installation',
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
    group: 'installation',
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
    group: 'installation',
    selection: 'scopes',
    api: ['/health', '/ready', '/v1/publish-due', '/v1/maintenance/storage-gc', '/v1/sites/{site}/stats/*'],
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
 * `reason` is documentation for whoever changes the split — the navigation test
 * requires it to name the paths that cross. It is NOT what the switcher draws:
 * nine English sentences reached the German console through `{note.reason}` for
 * exactly as long as this array has existed, because the i18n probe read JSX
 * text and four attributes and a JSX expression is neither
 * (LOCAL-CK-I18N-SONDE-SIEHT-NUR-JSXTEXT). `reasonKey` is the drawn half.
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
    label: 'Overview',
    reasonKey: 'switcher.mixedReason.overview',
    context: 'site',
    crosses: ['/v1/audit-events'],
    reason:
      'the dashboard is site-governed through /v1/sites/{site}/decisions and /v1/sites/{site}/stats/*, while /v1/audit-events contributes the installation activity stream',
  },
  {
    label: 'Webhooks',
    reasonKey: 'switcher.mixedReason.webhooks',
    context: 'site',
    crosses: ['/v1/webhook-deliveries', '/v1/webhook-deliveries/{delivery}/retry'],
    reason:
      'the endpoints are per-site, but /v1/webhook-deliveries holds every site’s attempts and /v1/webhook-deliveries/{delivery}/retry is id-addressed; the page narrows the list with ?site_id=',
  },
  {
    label: 'Decisions',
    reasonKey: 'switcher.mixedReason.decisions',
    context: 'site',
    crosses: ['/v1/comments/{comment}', '/v1/contact-submissions/{id}', '/v1/feedback/{item}'],
    reason:
      'the queue is governed by /v1/sites/{site}/decisions, while /v1/comments/{comment}, /v1/contact-submissions/{id} and /v1/feedback/{item} resolve their site from the reviewed source id',
  },
  {
    label: 'Decks',
    reasonKey: 'switcher.mixedReason.decks',
    context: 'site',
    crosses: ['/v1/deck-themes', '/v1/deck-templates'],
    reason: 'per-site compile and validate, against the installation catalogs /v1/deck-themes and /v1/deck-templates',
  },
  {
    label: 'Compositions',
    reasonKey: 'switcher.mixedReason.compositions',
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
    reasonKey: 'switcher.mixedReason.assistant',
    context: 'installation',
    crosses: ['/v1/sites/{site}/render'],
    reason:
      'installation-wide transport on /v1/assistant/messages and /v1/assistant/elicitations/{elicitation}, but its previews render through /v1/sites/{site}/render for the selected site',
  },
  {
    label: 'System',
    reasonKey: 'switcher.mixedReason.system',
    context: 'installation',
    crosses: [
      '/v1/sites/{site}/stats/audio',
      '/v1/sites/{site}/stats/compositions',
      '/v1/sites/{site}/stats/content',
      '/v1/sites/{site}/stats/decks',
      '/v1/sites/{site}/stats/engagement',
      '/v1/sites/{site}/stats/http',
      '/v1/sites/{site}/stats/mcp',
      '/v1/sites/{site}/stats/readers',
      '/v1/sites/{site}/stats/releases',
      '/v1/sites/{site}/stats/webhooks',
    ],
    reason:
      'process health is installation-wide on /health and /ready, while /v1/sites/{site}/stats/http and /v1/sites/{site}/stats/mcp supply the selected site’s traffic readings',
  },
  {
    label: 'Moderation',
    reasonKey: 'switcher.mixedReason.moderation',
    context: 'installation',
    crosses: ['/v1/sites/{site}/content'],
    reason:
      'installation-wide rows on /v1/comments, /v1/contact-submissions and /v1/feedback; GET /v1/sites/{site}/content is read only to turn an item id in a comment row into the post’s title',
  },
  {
    label: 'Sites',
    reasonKey: 'switcher.mixedReason.sites',
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

/**
 * The blocks the sidebar is drawn in.
 *
 * Sixteen labels in two headed lists was still not a navigation: the two
 * headings said whose endpoints a page reaches, and nothing said what the
 * operator is doing. The site's own pages are therefore grouped by the job —
 * writing it, shipping it, letting people at it, configuring it — and
 * INSTALLATION is one block below them, set apart, because it is the one the
 * switcher does not reach.
 *
 * `context` is repeated here rather than derived so that the navigation test can
 * check every entry against the block it is drawn in: "Moderation reads nicely
 * under Content" must not quietly move an installation-wide page under the
 * switcher, and a block heading is the only thing on screen saying which is
 * which.
 *
 * `startsOpen` is a judgement about how often a block is needed, not about how
 * important it is. Overview, Content and Deliver are where the day is spent;
 * Access, Settings and Installation are visited to change something.
 */
const GROUPS = [
  {
    id: 'overview',
    label: '',
    context: 'site',
    testId: 'nav-group-overview',
    collapsible: false,
    startsOpen: true,
    separated: false,
  },
  {
    id: 'content',
    label: 'Content',
    context: 'site',
    testId: 'nav-group-content',
    collapsible: true,
    startsOpen: true,
    separated: false,
  },
  {
    id: 'deliver',
    label: 'Deliver',
    context: 'site',
    testId: 'nav-group-deliver',
    collapsible: true,
    startsOpen: true,
    separated: false,
  },
  {
    id: 'tools',
    label: 'Tools',
    context: 'site',
    testId: 'nav-group-tools',
    collapsible: true,
    startsOpen: true,
    separated: false,
  },
  {
    id: 'access',
    label: 'Access',
    context: 'site',
    testId: 'nav-group-access',
    collapsible: true,
    startsOpen: false,
    separated: false,
  },
  {
    id: 'settings',
    label: 'Settings',
    context: 'site',
    testId: 'nav-group-settings',
    collapsible: true,
    startsOpen: false,
    separated: false,
  },
  {
    id: 'installation',
    label: 'Installation',
    context: 'installation',
    testId: 'nav-group-installation',
    collapsible: true,
    startsOpen: false,
    separated: true,
  },
] as const

type NavGroupDefinition = (typeof GROUPS)[number]

/** What to say about the switcher on a page it does not fully govern. */
const SELECTION_NOTE = {
  governs: '',
  requires: 'This page needs a site',
  scopes: 'Applies to this page only',
  seeds: 'Only seeded this page’s own filter',
  ignored: 'Not used on this page',
}

const SELECTION_NOTE_KEYS: Record<Exclude<NavEntry['selection'], 'governs'>, TranslationKey> = {
  requires: 'switcher.requires',
  scopes: 'switcher.scopes',
  seeds: 'switcher.seeds',
  ignored: 'switcher.ignored',
}

const NAV_KEYS: Record<(typeof NAV)[number]['to'], TranslationKey> = {
  '/': 'nav.overview',
  '/decisions': 'nav.decisions',
  '/content': 'nav.documents',
  '/published': 'nav.published',
  '/compositions': 'nav.compositions',
  '/decks': 'nav.decks',
  '/releases': 'nav.releases',
  '/audio': 'nav.audio',
  '/access': 'nav.readerAccess',
  '/webhooks': 'nav.webhooks',
  '/settings': 'nav.siteSettings',
  '/sites': 'nav.sites',
  '/moderation': 'nav.moderation',
  '/credentials': 'nav.credentials',
  '/audit': 'nav.audit',
  '/assistant': 'nav.assistant',
  '/system': 'nav.system',
}

/**
 * Total, not `Partial`: a missing entry used to fall through to `group.label`,
 * which is English written in this file. `SECTION_LABEL_KEYS` in
 * site-settings.tsx has always been a total `Record` — there the compiler
 * catches what here only attention caught. `overview` draws no heading (it is
 * `collapsible: false`), and carries its key anyway so that adding a block
 * cannot quietly reopen the fallback.
 */
const GROUP_KEYS: Record<NavGroupDefinition['id'], TranslationKey> = {
  overview: 'nav.overview',
  content: 'nav.content',
  deliver: 'nav.deliver',
  tools: 'nav.tools',
  access: 'nav.readerAccess',
  settings: 'nav.settings',
  installation: 'nav.installation',
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

/** One caption, two wrappers — a reason to disclose is the only difference. */
const NOTE_CLASS = 'px-2 pt-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden'

/** The switcher's caption for the open page, and the key of the reason behind it. */
function switcherNote(open: NavEntry | undefined) {
  const mixture = MIXED.find((entry) => entry.label === open?.label)
  if (!open) return { text: '', reasonKey: undefined }
  if (open.selection !== 'governs') return { text: SELECTION_NOTE[open.selection], reasonKey: mixture?.reasonKey }
  // A page the switcher does govern can still reach past the site — say so
  // rather than leaving the sidebar to imply otherwise.
  return { text: mixture ? 'Parts of this page are installation-wide' : '', reasonKey: mixture?.reasonKey }
}

export function Shell() {
  const session = useSession()
  const selection = useSite()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { t } = useI18n()
  const open = entryFor(pathname)
  const note = switcherNote(open)
  const canReadDecisions = ['content:write', 'moderation:write', 'release:write'].some((scope) =>
    session.product_scopes.includes(scope),
  )
  const decisionCount = useQuery({
    queryKey: keys.decisions(selection.site, { state: 'open', limit: 1 }),
    queryFn: () => ck.decisions.list(selection.site, { state: 'open', limit: 1 }),
    enabled: Boolean(selection.site) && canReadDecisions,
    retry: false,
  })
  const noteText = open
    ? open.selection !== 'governs'
      ? t(SELECTION_NOTE_KEYS[open.selection])
      : note.text
        ? t('switcher.mixed')
        : ''
    : ''

  const visible = NAV.filter(
    (item) =>
      !item.scope ||
      (typeof item.scope === 'string'
        ? session.product_scopes.includes(item.scope)
        : item.scope.some((scope) => session.product_scopes.includes(scope))),
  )
  // The switcher is header chrome above every block, but installation pages read
  // the selection too, so it stays mounted while any visible page reads it —
  // otherwise Moderation, which shows nothing without one, offers no way to
  // choose. It is absent only where nothing on screen or reachable from it would
  // change: a session whose every visible page ignores the selection.
  const switcherUsed = visible.some((item) => item.selection !== 'ignored')

  return (
    <TooltipProvider>
      {/*
       * The one TooltipProvider in the console, and it is load-bearing twice
       * over: `SidebarMenuButton tooltip=…` is what makes the collapsed icon
       * rail readable, and the form fields' definitions and disabled-reason
       * tooltips render nowhere without a provider above them. It wraps the
       * whole shell — the Outlet included — so every route is inside it.
       */}
      {/*
        `h-full min-h-0`, and both halves are load-bearing.

        shadcn's wrapper is `min-h-svh`: it is at least the viewport and grows with
        its content, which is right for a page that scrolls in the document. This
        console does not — `body` is `overflow: hidden` because the panes scroll and
        the document stays put, which is what makes the sidebar stay while a list
        moves. Put those two together and the wrapper grew to nine thousand pixels
        inside an eight-hundred-pixel body, the pane's `overflow-y-auto` never had a
        bounded parent so it never overflowed, and `overflow: hidden` quietly cut off
        everything below the fold. On the releases page that was nine tenths of it.

        `h-full` bounds the wrapper to `#root`, which is bounded to the viewport.
        `min-h-0` is the flexbox half: a flex child's default `min-height: auto`
        refuses to shrink below its content, so without it the inset would push the
        same way from the inside.
      */}
      {/*
        `data-cockpit-ui` on the outermost element — CUI-MARK-2. The meta tags
        say which contract the DOCUMENT implements; this says which contract the
        rendered console implements, and it is what a cross-product probe or a
        screenshot diff can actually see. A console whose head says one thing
        and whose body carries nothing has told a machine only half of it.
      */}
      <SidebarProvider data-cockpit-ui="cockpit-ui" className="h-full min-h-0">
        <Sidebar collapsible="icon" data-testid="sidebar">
          <SidebarHeader>
            {/*
             * The wordmark — COCKPIT-KONVENTION §6. Until now this console was
             * the one product in the family that never said its own name: the
             * header opened with the site switcher, so a screenshot of
             * ContentKit and a screenshot of a sibling were told apart by their
             * navigation and by nothing else.
             *
             * The name comes from the catalogue (`app.name`, identical in EN and
             * DE because it is a proper noun) rather than from a literal here, so
             * there is exactly one place in the product where it is spelled — and
             * it is drawn with neither `.toUpperCase()` nor `uppercase`, because
             * "CONTENTKIT" loses the capital that is part of the name.
             *
             * Unconditional, unlike everything below it: a session whose scopes
             * hide every block still has to be able to see which product it is
             * signed in to.
             */}
            {/*
             * `p-2` expanded, none collapsed — the same pair `SidebarMenuButton`
             * uses, and both halves are measured rather than chosen. Expanded it
             * puts the icon square on the same left edge as the switcher's glyph
             * one line below. Collapsed the rail is `--sidebar-width-icon` (3rem)
             * and SidebarHeader's own `p-2` already spends 1rem of it, leaving
             * exactly the 2rem this square is wide; a second padding here would
             * push it out of the rail.
             */}
            <div
              data-testid="cockpit-wordmark"
              className="flex items-center gap-2 overflow-hidden p-2 group-data-[collapsible=icon]:p-0!"
            >
              <span
                data-testid="cockpit-wordmark-icon"
                className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
              >
                {/*
                 * `newspaper`: ContentKit's subject is the published edition —
                 * documents that become a release and go out. The nav glyphs
                 * were the other candidates and each is worse here, because each
                 * is already spoken for one block below: FileText is Documents,
                 * Library is Compositions, Rocket is Releases. A wordmark
                 * wearing a navigation entry's glyph reads as that entry.
                 */}
                <Newspaper data-icon="inline-start" aria-hidden="true" />
              </span>
              <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">{t('app.name')}</span>
            </div>
            {/*
             * The site switcher, directly beneath the wordmark and still above
             * every block. It used to be the first thing in the sidebar; it now
             * sits second, because the two answer different questions — the line
             * above says which product this is, this one says what the console is
             * currently pointed at — and §6 puts the name on top.
             *
             * What made it header chrome in the first place is unchanged and is
             * the reason it did not move down into the site group: it used to
             * live inside that group so that what it governed was what appeared
             * beneath it, and with the site's pages in four blocks and
             * INSTALLATION below them that arrangement is gone. The words below
             * carry the claim instead — and up here a block that renders nothing
             * for want of a scope cannot take the switcher off screen with it.
             */}
            {switcherUsed ? (
              <div
                data-testid="site-switcher-scope"
                data-relation={open?.selection ?? 'governs'}
                className={cn(open && DIMMED.includes(open.selection) && 'opacity-60')}
              >
                <SiteSwitcher
                  site={selection.site}
                  current={selection.current}
                  setSite={selection.setSite}
                  sites={selection.sites}
                  isLoading={selection.isLoading}
                  error={selection.error}
                />
                {/*
                 * The caption is always on screen; the long reason behind it is a
                 * Tooltip when there is one. It used to be a native `title`, which
                 * offered the explanation to a pointer and to nobody else — and
                 * the operators most likely to be confused by a switcher that does
                 * not reach the open page are not the ones with a mouse to spare.
                 * The trigger is a tab stop, so the sentence is one Tab away.
                 */}
                {noteText ? (
                  note.reasonKey ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div tabIndex={0} data-testid="site-switcher-note" className={NOTE_CLASS}>
                          {noteText}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent data-testid="site-switcher-note-reason">{t(note.reasonKey)}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <div data-testid="site-switcher-note" className={NOTE_CLASS}>
                      {noteText}
                    </div>
                  )
                ) : null}
              </div>
            ) : null}
          </SidebarHeader>

          <SidebarContent>
            <nav data-testid="nav" aria-label={t('nav.label')}>
              {GROUPS.map((group) => {
                const items = visible.filter((item) => item.group === group.id)
                const groupShown = items.length > 0
                if (!groupShown) return null
                return (
                  <Fragment key={group.id}>
                    {group.separated ? <SidebarSeparator data-testid={`${group.testId}-separator`} /> : null}
                    <NavBlock
                      group={group}
                      items={items}
                      open={open}
                      decisionCount={decisionCount.data?.counts.open ?? 0}
                      decisionOverdue={Boolean(decisionCount.data?.counts.overdue)}
                    />
                  </Fragment>
                )
              })}
            </nav>
          </SidebarContent>

          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <AccountMenu />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>

          <SidebarRail data-testid="sidebar-rail" />
        </Sidebar>

        {/* min-h-0 for the same reason: this is the flex child that has to be
            allowed to shrink so the pane below it can overflow and scroll. */}
        {/*
          `min-w-0` is the horizontal twin of `min-h-0`, and it was missing on the
          line whose own comment states the rule for the vertical axis.

          A flex child defaults to `min-width: auto`, which resolves to min-content
          and refuses to shrink below it. So on a page holding a table the inset
          stayed a full viewport wide *beside* the sidebar, the document grew past
          the window, and `body{overflow:hidden}` cut the difference off — the same
          shape as 4.8.0, turned ninety degrees.

          It survived local runs because macOS draws overlay scrollbars that take no
          width. On Linux and Windows the pane's scrollbar takes real width, the
          content beside it overflows by exactly that, and CI found it on the first
          run of the browser suite — which is the whole argument for having one.
        */}
        <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            <SidebarTrigger data-testid="sidebar-toggle" />
          </header>
          <div
            data-testid="page-scroll"
            className="scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-clip"
          >
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}

/**
 * One block of the sidebar.
 *
 * Two things it has to get right that a plain list did not. A block that is
 * closed still has to open itself when the page inside it is the open one —
 * otherwise a ⌘K jump into Access lands on a page whose sidebar entry is not on
 * screen. And collapsed to the icon rail there is no heading to click, so a
 * closed block must show its icons anyway or its pages become unreachable; the
 * label is then carried by `tooltip=` on each button, which is the only text in
 * that state.
 */
function NavBlock({
  group,
  items,
  open,
  decisionCount,
  decisionOverdue,
}: {
  group: NavGroupDefinition
  items: readonly NavEntry[]
  open: NavEntry | undefined
  decisionCount: number
  decisionOverdue: boolean
}) {
  const { t } = useI18n()
  const { state } = useSidebar()
  const [expanded, setExpanded] = useState(group.startsOpen)
  const holdsOpenPage = items.some((item) => item.to === open?.to)

  useEffect(() => {
    if (holdsOpenPage) setExpanded(true)
  }, [holdsOpenPage])

  const menu = (
    <SidebarGroupContent>
      <SidebarMenu>
        {items.map(({ to, icon: Icon }) => {
          const translated = t(NAV_KEYS[to])
          return (
            <SidebarMenuItem key={to}>
              <SidebarMenuButton asChild isActive={open?.to === to} tooltip={translated}>
                <AppLink to={to} data-testid={`nav-${to === '/' ? 'overview' : to.slice(1)}`}>
                  <Icon data-icon="inline-start" />
                  <span>{translated}</span>
                </AppLink>
              </SidebarMenuButton>
              {to === '/decisions' && decisionCount > 0 ? (
                <SidebarMenuBadge className={decisionOverdue ? 'text-destructive' : undefined}>
                  {decisionCount}
                </SidebarMenuBadge>
              ) : null}
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroupContent>
  )

  if (!group.collapsible)
    return (
      <SidebarGroup data-testid={group.testId} data-context={group.context}>
        {menu}
      </SidebarGroup>
    )

  return (
    <Collapsible open={state === 'collapsed' || expanded} onOpenChange={setExpanded} className="group/collapsible">
      <SidebarGroup data-testid={group.testId} data-context={group.context}>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger data-testid={`${group.testId}-toggle`}>
            {t(GROUP_KEYS[group.id])}
            <ChevronDown
              data-icon="inline-end"
              className="ml-auto transition-transform group-data-[state=closed]/collapsible:-rotate-90"
            />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>{menu}</CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

/**
 * Which site the console is pointed at, and the control that changes it.
 *
 * A dropdown rather than a `<select>` because the rail is 3rem wide when the
 * sidebar is collapsed: the trigger has to survive losing its label, which a
 * native select cannot, and the tooltip has to be able to say the site's name
 * where nothing else can. In the lost pass this was the one control in the rail
 * without a tooltip, which meant the control answering "which site am I about to
 * change?" showed a globe and nothing else.
 */
const THEMES: readonly { value: Theme }[] = [{ value: 'system' }, { value: 'light' }, { value: 'dark' }]

const THEME_KEYS: Record<Theme, TranslationKey> = {
  light: 'account.theme.light',
  dark: 'account.theme.dark',
  system: 'account.theme.system',
}

const LANGUAGE_OPTIONS: readonly { value: LocalePreference; key: TranslationKey }[] = [
  { value: 'auto', key: 'account.language.auto' },
  { value: 'en', key: 'account.language.en' },
  { value: 'de', key: 'account.language.de' },
]

function accountRoleKey(role: string | null | undefined): TranslationKey {
  if (role === 'admin') return 'account.role.admin'
  if (role === 'author') return 'account.role.author'
  if (role === 'reader') return 'account.role.reader'
  return 'account.role.operator'
}

/**
 * Three choices, in a menu rather than a two-way flip.
 *
 * This replaced `setTheme(resolved === 'dark' ? 'light' : 'dark')` — a toggle
 * that read the RESOLVED scheme and wrote its opposite. For an operator on
 * `system` that meant the first click stored an explicit choice and there was
 * no UI path back to key-absence: "follow the OS" was silently destroyed, for
 * the life of the browser profile, by the one control that claimed to manage
 * it. The store always supported all three states; the button could only reach
 * two. The family contract (CUI-THEME-1/2) says the choice is one of
 * light|dark|system with `system` as the absence of the key — this menu is the
 * shape that can actually express that, and the sibling console proved it in a
 * 3rem rail first.
 */
/**
 * The operator's own menu: who you are, and the two things you can do about it.
 *
 * This replaced a footer that printed the name and role as inert text with Sign
 * out as a separate row above them. Three elements said one thing between them,
 * and the identity — the part an operator actually looks for — was the only one
 * that could not be clicked. The subject was reachable only through a tooltip,
 * which on a phone means not reachable at all, and it is what an audit line and
 * a support request are keyed by.
 *
 * The sibling console grew the same menu in the same place. Two independent
 * implementations over two different session shapes; the shared part is where
 * an operator looks, not the code.
 */
function initials(value: string): string {
  return (
    value
      .split(/[@\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'CK'
  )
}

function AccountMenu() {
  const session = useSession()
  const { t, preference, setPreference } = useI18n()
  const { theme, setTheme } = useTheme()
  const [signingOut, setSigningOut] = useState(false)
  const name = visibleLabel(session.display_name, session.email) ?? t('account.unknown')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          data-testid="account-menu-trigger"
          tooltip={t('account.menu')}
          className="data-[state=open]:bg-sidebar-accent"
        >
          <Avatar className="size-8 rounded-lg">
            <AvatarFallback className="rounded-lg">{initials(name)}</AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-col text-left leading-tight">
            <span data-testid="operator-name" className="truncate text-sm">
              {name}
            </span>
            <span data-testid="operator-role" className="truncate text-xs text-muted-foreground">
              {t(accountRoleKey(session.role))}
            </span>
          </span>
          <ChevronsUpDown data-icon="inline-end" className="ml-auto shrink-0" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-64" data-testid="account-menu">
        {session.display_name && session.email ? (
          <>
            <DropdownMenuLabel className="font-normal">
              <span className="text-xs break-all text-muted-foreground">{session.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuItem asChild data-testid="profile-link">
            <AppLink to="/profile" data-testid="nav-profile">
              <UserRound data-icon="inline-start" />
              {t('account.profile')}
            </AppLink>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="account-language-menu">
              <Languages data-icon="inline-start" />
              {t('account.language')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent data-testid="account-language-menu-content">
              <DropdownMenuRadioGroup
                value={preference}
                onValueChange={(value) => setPreference(value as LocalePreference)}
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    data-testid={`account-language-${option.value}`}
                  >
                    {t(option.key)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="account-theme-menu">
              <Palette data-icon="inline-start" />
              {t('account.theme')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent data-testid="account-theme-menu-content">
              <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
                {THEMES.map(({ value }) => (
                  <DropdownMenuRadioItem key={value} value={value} data-testid={`account-theme-${value}`}>
                    {t(THEME_KEYS[value])}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            variant="destructive"
            disabled={signingOut}
            data-testid="account-sign-out"
            onSelect={async () => {
              setSigningOut(true)
              try {
                await ck.identity.logout()
                window.location.assign(ck.identity.loginUrl('/cockpit/'))
              } finally {
                setSigningOut(false)
              }
            }}
          >
            {signingOut ? <Spinner data-icon="inline-start" /> : <LogOut data-icon="inline-start" />}
            {t(signingOut ? 'account.signingOut' : 'account.signOut')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SiteSwitcher({
  site,
  current,
  setSite,
  sites,
  isLoading,
  error,
}: {
  site: string
  current: { id: string; slug: string; name: string; environment: 'production' | 'canary' | 'test' } | undefined
  setSite: (site: string) => void
  sites: { id: string; slug: string; name: string; environment: 'production' | 'canary' | 'test' }[]
  isLoading: boolean
  error: unknown
}) {
  const { t } = useI18n()
  const { state, isMobile } = useSidebar()
  const [showTestSites, setShowTestSites] = useState(() => {
    try {
      return window.localStorage.getItem('ck-cockpit-show-test-sites') !== 'false'
    } catch {
      return true
    }
  })
  const name = current?.name || site
  const ordered = ['production', 'canary', 'test'] as const
  const grouped = ordered.map((environment) => ({
    environment,
    sites: sites
      .filter((candidate) => candidate.environment === environment && (environment !== 'test' || showTestSites))
      .sort((left, right) => left.name.localeCompare(right.name)),
  }))

  if (isLoading)
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuSkeleton showIcon data-testid="site-switcher-loading" />
        </SidebarMenuItem>
      </SidebarMenu>
    )

  if (error)
    return (
      <Alert variant="destructive" data-testid="site-switcher-error" className="group-data-[collapsible=icon]:hidden">
        {/* Direct child, before the title: the destructive variant states its
            severity in a hue, and a hue is not a statement — CUI-A11Y-5. It also
            has to be a direct child, because the CVA only re-grids on
            `has-[>svg]` and an icon in a wrapper is not one. */}
        <TriangleAlert />
        <AlertTitle>{t('site.error.title')}</AlertTitle>
        <AlertDescription>{error instanceof Error ? error.message : t('site.error.description')}</AlertDescription>
      </Alert>
    )

  // Not an Empty: in a 16rem header that collapses to a 3rem rail the honest
  // shape is the control that fixes it, not a framed paragraph saying there is
  // nothing to pick.
  if (sites.length === 0)
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild tooltip={t('site.emptyLink')}>
            <AppLink to="/sites" data-testid="site-switcher-empty">
              <Globe data-icon="inline-start" />
              <span>{t('site.none')}</span>
            </AppLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <Tooltip open={state === 'collapsed' && !isMobile ? undefined : false}>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  data-testid="site-switcher"
                  aria-label={t('site.contextLabel', { site: name || t('common.none') })}
                >
                  <span className="flex min-w-0 flex-col text-left">
                    {/*
                     * The trigger is as wide as the sidebar and no wider, so this
                     * one name can still be cut where the menu's no longer can.
                     * UI-UX.md §6 asks for a `title` here; §3 — and the guard in
                     * test/unit/cockpit-forms-density.test.mjs, which has already
                     * evicted two native titles from this very file — forbids one
                     * outright. The console's answer to a cut name is the menu
                     * below, which now spells every name out in full, plus this
                     * button's own `aria-label`. See the note in the result.
                     */}
                    <span className="truncate font-medium">{name || t('site.noneSelected')}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {name ? t('site.context') : t('site.chooseToContinue')}
                    </span>
                  </span>
                  <ChevronsUpDown data-icon="inline-end" className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            {/*
             * Collapsed, this is the only thing on screen that names the site — and
             * it is hand-rolled because `SidebarMenuButton tooltip=` cannot reach a
             * `DropdownMenuTrigger` (SHADCN-MIGRATION.md §6). Hand-rolled means the
             * equivalence has to be maintained by hand, and one half of it was
             * missing: the ten neighbours pass `hidden={state !== 'collapsed' || isMobile}`,
             * because on the mobile sheet every label is visible and `state` still
             * reports the desktop rail. Without `isMobile` this was the one entry in
             * the rail that popped a tooltip its neighbours suppress. `side` and
             * `align` are spelled out for the same reason — so the next reader can
             * diff this against sidebar.tsx without running it.
             */}
            <TooltipContent
              side="right"
              align="center"
              hidden={state !== 'collapsed' || isMobile}
              data-testid="site-switcher-tooltip"
            >
              {t('site.tooltip', { site: name || t('common.none') })}
            </TooltipContent>
          </Tooltip>
          {/*
           * `w-auto` is the whole fix for the truncation an operator photographed:
           * ui/dropdown-menu.tsx pins every menu to `w-(--radix-dropdown-menu-trigger-width)`,
           * and this trigger is the sidebar, so the menu was frozen at ~14rem no
           * matter how long the names were — "Harmoniqs Priva…", "Mission Coc…".
           * Released, the menu takes the width its longest name needs and stops at
           * the viewport, which is what `max-w-(…available-width)` is for.
           */}
          <DropdownMenuContent
            align="start"
            side="right"
            data-testid="site-switcher-menu"
            className="w-auto min-w-56 max-w-(--radix-dropdown-menu-content-available-width)"
          >
            <DropdownMenuLabel>{t('site.list')}</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={showTestSites}
              onCheckedChange={(checked) => {
                setShowTestSites(Boolean(checked))
                try {
                  window.localStorage.setItem('ck-cockpit-show-test-sites', String(Boolean(checked)))
                } catch {
                  // A private browsing policy may deny storage; the session choice still works.
                }
              }}
              data-testid="site-switcher-show-tests"
            >
              {t('site.showTests')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={site} onValueChange={setSite}>
              {grouped.flatMap((group) =>
                group.sites.length
                  ? [
                      <DropdownMenuLabel key={`${group.environment}-label`}>
                        {t(`site.environment.${group.environment}` as TranslationKey)}
                      </DropdownMenuLabel>,
                      ...group.sites.map((candidate) => (
                        /*
                         * Name over slug rather than name beside slug. Side by side, the
                         * slug held a column the name was not allowed to use; stacked, the
                         * name gets the full row and the slug — which is short, and which
                         * the operator already knows — reads as the caption it is.
                         *
                         * A name too long even for that wraps rather than clamps, and this
                         * is deliberate: UI-UX.md §6 says a cut name owes the reader a
                         * `title`, §3 forbids a native `title` anywhere in the console, and
                         * a menu row is the one place where honouring both is free — do not
                         * cut. The `aria-label` keeps the slug from being read as part of
                         * the name.
                         */
                        <DropdownMenuRadioItem
                          key={candidate.id}
                          value={candidate.slug}
                          data-testid={`site-switcher-option-${candidate.slug}`}
                          aria-label={`${candidate.name} (${candidate.slug})`}
                          className="flex-col items-start gap-0"
                        >
                          <span className="break-words">{candidate.name}</span>
                          <span className="text-xs text-muted-foreground">{candidate.slug}</span>
                        </DropdownMenuRadioItem>
                      )),
                    ]
                  : [],
              )}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/** One step of the page header's trail. Composed here; ui/breadcrumb.tsx is parts. */
interface Crumb {
  label: string
  /** A stand-in for something not chosen yet, e.g. "No site selected". */
  placeholder?: boolean
}

/**
 * The trail for the open page: 'Site · <site name> · <page>' where the selected
 * site is a path parameter, 'Installation · <page>' where it is not.
 */
function useCrumbs(title: string): Crumb[] {
  const { t } = useI18n()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { site, current } = useSite()
  const open = entryFor(pathname)
  if (!open) return [{ label: title }]
  if (open.context === 'installation') return [{ label: t('site.installation') }, { label: title }]
  // The name once the list has loaded, the slug meanwhile — never a blank crumb
  // where the site should be.
  const named = current?.name || site
  return [
    { label: t('site.context') },
    { label: named || t('site.noneSelected'), placeholder: !named },
    { label: title },
  ]
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
    <div data-testid="page" data-page={title} className="mx-auto max-w-7xl p-4 sm:p-6">
      {/*
        The actions drop below the title on a phone. Beside it they are
        `shrink-0`, which is right at 1280 and wrong at 390: a 100px button and
        its gap took 116px of a 342px column, so "New content" left the Content
        page's description wrapping in 226px with a third of the row empty
        beside it. Below `sm` the title block gets the whole width and the
        actions get their own row.
      */}
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          {/*
           * No crumb is a link, and BreadcrumbLink is therefore not rendered:
           * two of the three name no route at all — the console has no page for
           * "the site context" — and the third is the page already open, so a
           * link here could only leave a half-filled form or change the site.
           * Exactly one crumb is the BreadcrumbPage, because that part carries
           * aria-current="page" and three of them announce three current pages.
           */}
          <Breadcrumb
            data-testid="breadcrumb"
            data-trail={crumbs.map((crumb) => crumb.label).join(' · ')}
            className="text-xs"
          >
            <BreadcrumbList className="text-xs">
              {crumbs.map((crumb, index) => (
                <Fragment key={`${index}-${crumb.label}`}>
                  {index > 0 ? <BreadcrumbSeparator /> : null}
                  <BreadcrumbItem data-testid={`breadcrumb-item-${index}`}>
                    {index === crumbs.length - 1 ? (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    ) : (
                      <span className={cn('truncate', crumb.placeholder && 'italic')}>{crumb.label}</span>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
          <h1 data-testid="page-title" className="text-lg font-semibold tracking-tight">
            {title}
          </h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
      </header>
      {children}
    </div>
  )
}

/** Shown wherever a site-scoped page has no site selected yet. */
export function NoSite() {
  const { t } = useI18n()
  return (
    <Empty data-testid="no-site" className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Globe />
        </EmptyMedia>
        <EmptyTitle>{t('site.noneSelected')}</EmptyTitle>
        <EmptyDescription>{t('site.noSelection.description')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
