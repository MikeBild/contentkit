import type { ComponentProps, ReactNode } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ApiError } from '@/api/client'

/**
 * Deleting a site: the most destructive act this console can perform, rendered
 * as the operator meets it.
 *
 * `components/confirm.test.tsx` already proves that the confirmation parks focus
 * on a surviving structure when the row that owned its trigger is deleted — but
 * it proves it about a `RowHarness` written in plain tags to *resemble* this
 * page. That is the wrong subject for this promise. The page is where the
 * trigger really is deleted by the act it starts, and the page is what shipped a
 * hand-rolled dialog of its own for as long as the harness was passing: an
 * `AlertDialog` composed inline, no `onCloseAutoFocus`, so focus landed on
 * `<body>` immediately after a site was destroyed. Two suites were green over
 * that the whole time, because one asked its questions of `confirm.tsx` and the
 * other of a lookalike.
 *
 * So these tests render `SitesPage` itself, with the API and the shell mocked
 * and nothing else, click the real controls and then ask the DOM three things:
 * where focus went after the row disappeared, what the server's refusal did to
 * the dialog, and whether the answer that purges can be reached without the
 * refusal that earns it.
 *
 * The site list is served through react-query exactly as the console serves it,
 * so `invalidateQueries` really refetches and the row really unmounts before the
 * dialog closes. That ordering is the whole defect: a test that removed the row
 * afterwards would never see it.
 */

const server = vi.hoisted(() => {
  const site = (slug: string, name: string) => ({
    id: `st_${slug}`,
    slug,
    name,
    description: null,
    base_url: `https://${slug}.example`,
    default_locale: 'de',
    settings: {},
  })
  return {
    sites: [site('alpha', 'Alpha'), site('beta', 'Beta')],
    /** Every DELETE the page sent, in order, with the flag it sent it with. */
    calls: [] as { slug: string; purge: boolean }[],
    /** What the server answers next. Replaced by the tests that need a refusal. */
    remove: null as null | ((slug: string, purge: boolean) => Promise<unknown>),
    reset() {
      this.sites = [site('alpha', 'Alpha'), site('beta', 'Beta')]
      this.calls = []
      this.remove = null
    },
  }
})

vi.mock('@/api/ck', () => ({
  ck: {
    sites: {
      list: () => Promise.resolve(server.sites),
      remove: (slug: string, purge: boolean) => {
        server.calls.push({ slug, purge })
        if (server.remove) return server.remove(slug, purge)
        server.sites = server.sites.filter((entry) => entry.slug !== slug)
        return Promise.resolve({})
      },
    },
  },
}))

// The site list the way the provider supplies it: a real query on the real key,
// so the page's own `invalidateQueries` is what removes the row.
vi.mock('@/lib/site', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  const { keys } = await import('@/lib/query')
  const { ck } = await import('@/api/ck')
  return {
    useSite: () => {
      const query = useQuery({ queryKey: keys.sites.all, queryFn: () => ck.sites.list() })
      return { sites: query.data ?? [], setSite: () => {}, isLoading: query.isPending, error: query.error }
    },
  }
})

vi.mock('@/app/shell', () => ({
  Page: ({ actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) => (
    <div data-testid="page">
      {actions}
      {children}
    </div>
  ),
  NoSite: () => <div data-testid="no-site" />,
}))

vi.mock('@/lib/session', () => ({ useCan: () => () => true }))
// The row's Settings link, without a router. `to` and `search` are TanStack's
// and mean nothing to an `<a>`; passing them through would put a function in an
// href attribute and print a React warning over every case in this file.
vi.mock('@/components/app-link', () => ({
  AppLink: ({ to, search, children, ...props }: { to?: string; search?: unknown } & ComponentProps<'a'>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('@/forms/site/wizard', () => ({ CreateSiteWizard: () => null }))
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: () => {}, dismiss: () => {} }) }))

const { SitesPage } = await import('@/pages/sites')

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SitesPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  server.reset()
})

describe('Sites — deleting one, and where that leaves the operator', () => {
  it('PUTS FOCUS IN THE SITES TABLE when the row that owned the trigger was deleted', async () => {
    const user = userEvent.setup()
    renderPage()

    const trigger = await screen.findByTestId('ck-site-delete-alpha')
    await user.click(trigger)

    // The names the production runbook drives this by, on the dialog the page
    // now gets from the one component rather than composing itself.
    const dialog = await screen.findByTestId('ck-site-delete-dialog')
    expect(dialog).toBe(screen.getByRole('alertdialog'))
    expect(within(dialog).getByTestId('ck-site-delete-target')).toHaveTextContent('alpha · https://alpha.example')

    await user.click(screen.getByTestId('ck-site-delete-confirm'))

    // The ordinary destructive path, in this order: the row goes — because the
    // page awaits the invalidation inside the confirmation — and then the dialog.
    await waitFor(() => expect(screen.queryByTestId('ck-site-delete-alpha')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    // `<body>` is the failure this test exists for: no position in the table, and
    // the next Tab starts from the top of the document — from the sidebar, past
    // every nav item, after destroying a site.
    expect(document.activeElement).not.toBe(document.body)

    // Where it goes instead: the table the row was deleted from, which is still
    // on screen, is announced as a table with its rows, and puts the next Tab on
    // the controls of the row that took the deleted one's place.
    const table = screen.getByRole('table')
    await waitFor(() => expect(table).toHaveFocus())
    // Not the surviving row's own delete button: focus belongs to the list, not
    // to a destructive control the operator never pressed.
    expect(screen.getByTestId('ck-site-delete-beta')).not.toHaveFocus()
    // One DELETE, and not the one that purges: the row was empty, so the server
    // had nothing to refuse.
    expect(server.calls).toEqual([{ slug: 'alpha', purge: false }])
  })

  it('KEEPS THE DIALOG OPEN on the server’s refusal and makes the second answer the one that purges', async () => {
    const user = userEvent.setup()
    // What the API really answers: a 409 naming what would be lost. The counts
    // are the whole point — they are what turns the second answer into a
    // decision about known numbers.
    server.remove = (_slug, purge) =>
      purge
        ? Promise.resolve({})
        : Promise.reject(new ApiError(409, 'conflict', 'alpha still has 2 published and 1 scheduled content item(s)'))
    renderPage()

    await user.click(await screen.findByTestId('ck-site-delete-alpha'))
    const dialog = await screen.findByTestId('ck-site-delete-dialog')
    await user.click(screen.getByTestId('ck-site-delete-confirm'))

    // Announced, not merely coloured: `role="alert"` is what a screen reader
    // speaks the moment the refusal appears, and it carries the server's own
    // sentence with its numbers rather than a summary of it.
    const refusal = await screen.findByTestId('ck-site-delete-refusal')
    expect(refusal).toBe(screen.getByRole('alert'))
    expect(refusal).toHaveTextContent('alpha still has 2 published and 1 scheduled content item(s)')

    // The dialog is still open, still naming its target, and the way out still
    // works: a refusal is a question, not a dead end.
    expect(dialog).toBeInTheDocument()
    expect(screen.getByTestId('ck-site-delete-target')).toHaveTextContent('alpha')
    expect(screen.getByTestId('ck-site-delete-cancel')).toBeEnabled()

    // The second answer is a different control with a different name, because
    // clicking it against a live site destroys it and the runbook has to be able
    // to tell the two apart.
    expect(screen.queryByTestId('ck-site-delete-confirm')).not.toBeInTheDocument()
    const purge = screen.getByTestId('ck-site-delete-purge')
    expect(purge).toHaveTextContent('Delete the site and all of it')

    await user.click(purge)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    // The first attempt never carries `purge`: the refusal is a safeguard the
    // server enforces, not a flag the console sets on the operator's behalf.
    expect(server.calls).toEqual([
      { slug: 'alpha', purge: false },
      { slug: 'alpha', purge: true },
    ])
  })

  it('DOES NOT ARM THE PURGE for the next operator who opens the dialog', async () => {
    const user = userEvent.setup()
    server.remove = (_slug, purge) =>
      purge ? Promise.resolve({}) : Promise.reject(new ApiError(409, 'conflict', 'alpha still has 2 content item(s)'))
    renderPage()

    await user.click(await screen.findByTestId('ck-site-delete-alpha'))
    await screen.findByTestId('ck-site-delete-dialog')
    await user.click(screen.getByTestId('ck-site-delete-confirm'))
    await screen.findByTestId('ck-site-delete-refusal')

    // The operator reads the counts and walks away.
    await user.click(screen.getByTestId('ck-site-delete-cancel'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    // Reopening asks the *first* question again. A refusal that survived the
    // close would mean the next click deleted the content the server had just
    // refused to delete — one click, no second question, from a dialog that
    // looks exactly like the safe one.
    await user.click(screen.getByTestId('ck-site-delete-alpha'))
    await screen.findByTestId('ck-site-delete-dialog')
    expect(screen.getByTestId('ck-site-delete-confirm')).toHaveTextContent('Delete site')
    expect(screen.queryByTestId('ck-site-delete-purge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ck-site-delete-refusal')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('ck-site-delete-confirm'))
    await screen.findByTestId('ck-site-delete-refusal')
    expect(server.calls).toEqual([
      { slug: 'alpha', purge: false },
      { slug: 'alpha', purge: false },
    ])
  })
})
