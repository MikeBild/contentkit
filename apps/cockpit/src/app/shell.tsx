import { Link, Outlet, useRouterState } from '@tanstack/react-router'
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
  Sun,
  Volume2,
  Webhook,
} from 'lucide-react'
import { ck } from '@/api/ck'
import { Button, Select } from '@/components/ui/primitives'
import { useSession } from '@/lib/session'
import { useSite } from '@/lib/site'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

// Each entry names the exact scope its page needs. authorize() has no
// hierarchy, so a nav item must not be shown on the strength of a role.
const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, scope: 'stats:read' },
  { to: '/sites', label: 'Sites', icon: Globe, scope: 'site:admin' },
  { to: '/content', label: 'Content', icon: FileText, scope: 'content:read' },
  { to: '/published', label: 'Published', icon: Search, scope: 'content:read' },
  { to: '/compositions', label: 'Compositions', icon: Boxes, scope: 'content:read' },
  { to: '/decks', label: 'Decks', icon: Presentation, scope: 'content:read' },
  { to: '/releases', label: 'Releases', icon: Rocket, scope: 'content:read' },
  { to: '/audio', label: 'Audio', icon: Volume2, scope: 'content:read' },
  { to: '/access', label: 'Reader access', icon: ShieldCheck, scope: 'access:admin' },
  { to: '/webhooks', label: 'Webhooks', icon: Webhook, scope: 'webhook:admin' },
  { to: '/moderation', label: 'Moderation', icon: MessagesSquare, scope: 'moderation:write' },
  { to: '/credentials', label: 'Credentials', icon: KeyRound, scope: 'api-key:admin' },
  { to: '/audit', label: 'Audit', icon: ScrollText, scope: 'audit:read' },
  { to: '/assistant', label: 'Assistant', icon: BookOpen, scope: 'content:write' },
  { to: '/system', label: 'System', icon: Activity, scope: null },
] as const

export function Shell() {
  const session = useSession()
  const { site, setSite, sites, isLoading, error } = useSite()
  const { resolved, setTheme } = useTheme()
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  const visible = NAV.filter((item) => !item.scope || session.product_scopes.includes(item.scope))

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface">
        <div className="px-4 py-4">
          <div className="text-[0.7rem] font-semibold tracking-[0.18em] text-muted-foreground">CONTENTKIT</div>
          <div className="text-sm font-semibold">Cockpit</div>
        </div>

        <div className="px-3 pb-3">
          <SiteSwitcher site={site} setSite={setSite} sites={sites} isLoading={isLoading} error={error} />
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-2">
          {visible.map(({ to, label, icon: Icon }) => {
            const active = to === '/' ? pathname === '/' : pathname.startsWith(to)
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'mb-0.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
                  active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-border p-3">
          <div className="truncate text-xs text-muted-foreground" title={session.subject}>
            {session.display_name || session.email || session.subject}
          </div>
          <div className="mt-0.5 text-[0.7rem] uppercase tracking-wide text-muted-foreground">{session.role}</div>
          <div className="mt-2 flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle theme"
              onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
            >
              {resolved === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
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
    <Select className="w-full" value={site} onChange={(event) => setSite(event.target.value)}>
      {sites.map((candidate) => (
        <option key={candidate.id} value={candidate.slug}>
          {candidate.name}
        </option>
      ))}
    </Select>
  )
}

export function Page({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-7xl p-6">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
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
    <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
      Choose a site in the sidebar to continue.
    </div>
  )
}
