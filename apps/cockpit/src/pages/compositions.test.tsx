import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * The one thing the tab strip on this page genuinely cost, held at the page.
 *
 * Compositions has three parallel concerns and a strip is right for it — but
 * `TabPanel` hides its inactive panels rather than unmounting them, and a hidden
 * element is out of the accessibility tree. The compile, validate and recommend
 * refusals were rendered inside the Compile panel. So a compile that failed
 * while the reader was reading the pattern registry produced: no toast, no badge
 * on the strip, and an `Alert role="alert"` in a `display:none` div, which
 * announces to nobody — a live region that is not rendered does not speak. The
 * reader's evidence that their request was refused was reachable only by
 * guessing to change tabs.
 *
 * `components/ui/tabs.test.tsx` pins the hazard at the component: a hidden panel
 * is not a `tabpanel` and nothing inside it is queryable by role. This file pins
 * the consequence at the page, and it is deliberately asserted through
 * `getByRole('alert')` rather than `getByTestId` — the testid finds the node
 * whether or not anyone can see it, which is exactly the mistake being tested
 * for. The role query reads the tree an assistive technology reads.
 *
 * The page is rendered with its frame stubbed — `Page` reads the router and this
 * is not a test of breadcrumbs — and its API mocked.
 */

vi.mock('@/app/shell', () => ({
  Page: ({ children }: { title: string; description?: string; children: ReactNode }) => (
    <div data-testid="page">{children}</div>
  ),
  NoSite: () => <div data-testid="no-site" />,
}))

vi.mock('@/lib/site', () => ({ useSite: () => ({ site: 'mikebild', current: null }) }))
vi.mock('@/lib/session', () => ({ useCan: () => () => true }))

const REFUSAL = 'compile refused: unknown directive :::metrik at line 3'

vi.mock('@/api/ck', () => ({
  ck: {
    compositions: {
      patterns: () =>
        Promise.resolve({
          patterns: [{ id: 'narrative.lede', category: 'narrative', scope: 'document', status: 'stable' }],
        }),
      guides: () => Promise.resolve({ guides: [] }),
      compile: () => Promise.reject(new Error(REFUSAL)),
      validate: () => Promise.resolve({}),
      recommend: () => Promise.resolve({}),
    },
  },
}))

const { CompositionsPage } = await import('@/pages/compositions')

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CompositionsPage />
    </QueryClientProvider>,
  )
}

/** Presses Compile and waits for the refusal to arrive. */
async function compileAndFail(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('composition-compile'))
  await screen.findByRole('alert')
}

describe('Compositions — a refusal the reader is not looking at', () => {
  it('REACHES THE READER ON ANOTHER TAB: a compile that failed while they were on Patterns is still announced', async () => {
    const user = userEvent.setup()
    renderPage()
    await compileAndFail(user)

    await user.click(screen.getByTestId('composition-tabs-patterns'))
    // The reader is now on Patterns — the panel that produced the refusal is
    // hidden — and the refusal is still in the accessibility tree, carrying the
    // server's own words rather than a rewrite of them.
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-testid', 'composition-tab-patterns')
    const alert = screen.getByRole('alert')
    expect(alert).toBeVisible()
    expect(alert).toHaveTextContent('Compile failed')
    expect(alert).toHaveTextContent(REFUSAL)

    // And on the third tab too: it belongs to the page, not to a panel.
    await user.click(screen.getByTestId('composition-tabs-guides'))
    expect(screen.getByRole('alert')).toBeVisible()
  })

  it('says on the strip which panel failed, in a word rather than in a colour', async () => {
    const user = userEvent.setup()
    renderPage()

    // Before: the strip carries counts for Patterns and Guides and nothing for
    // Compile, because there is nothing to say.
    expect(screen.queryByTestId('composition-tab-compile-failed')).toBeNull()

    await compileAndFail(user)
    expect(screen.getByTestId('composition-tab-compile-failed')).toHaveTextContent('1 failed')
    // Read off the tree: the tab announces the state, so the reader does not
    // have to see that it is red to know which panel to open. `\s*` because
    // jsdom has no layout and so inserts no space between the label and the
    // badge beside it; a browser says "Compile 1 failed".
    expect(screen.getByRole('tab', { name: /Compile\s*1 failed/ })).toBeInTheDocument()
  })

  it('shows one panel at a time, and each tab of this page really has its own', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('pattern-row')

    for (const [tab, panel] of [
      ['patterns', 'composition-tab-patterns'],
      ['guides', 'composition-tab-guides'],
      ['compile', 'composition-tab-compile'],
    ] as const) {
      await user.click(screen.getByTestId(`composition-tabs-${tab}`))
      await waitFor(() => expect(screen.getAllByRole('tabpanel')).toHaveLength(1))
      expect(screen.getByRole('tabpanel')).toHaveAttribute('data-testid', panel)
    }
  })
})
