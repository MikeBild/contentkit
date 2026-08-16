import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * The release build, as it actually ships.
 *
 * `Progress` gets the indeterminate case right — `src/components/ui/progress.test.tsx`
 * drives it — but the release page does not use `Progress`. It hand-rolls the
 * in-flight readout as a `role="status"` div, and that is a different promise:
 * `status` is a live region, it says "here is some text, read it when it changes",
 * and it makes no claim about progress at all. A screen-reader user tabbing onto
 * the card after the announcement has passed is told nothing about a build being
 * in flight; ARIA's spelling for that is a labelled `progressbar` with no
 * `aria-valuenow`, which is exactly the contract two review rounds established.
 *
 * The page is rendered with its frame stubbed — `Page` reads the router and this
 * is not a test of breadcrumbs — and its API mocked, so what is asserted is this
 * page's own markup and nothing else.
 */

vi.mock('@/app/shell', () => ({
  Page: ({ actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) => (
    <div data-testid="page">
      {actions}
      {children}
    </div>
  ),
  NoSite: () => <div data-testid="no-site" />,
}))

vi.mock('@/lib/site', () => ({ useSite: () => ({ site: 'mikebild', current: null }) }))
vi.mock('@/lib/session', () => ({ useCan: () => () => true }))
vi.mock('@/forms/platform/previews', () => ({ PreviewsCard: () => null }))
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({
    promotion_release: '11111111-1111-4111-8111-111111111111',
    promotion_manifest: 'a'.repeat(64),
  }),
}))

const building = {
  id: 'rel_building',
  kind: 'release',
  status: 'building',
  reason: 'nightly',
  created_at: new Date(Date.now() - 40_000).toISOString(),
  completed_at: null,
  activated_at: null,
  file_count: null,
  revision_ids: null,
}

const promotable = {
  id: '11111111-1111-4111-8111-111111111111',
  site_id: 'site-1',
  kind: 'preview',
  status: 'preview',
  reason: 'editorial review',
  created_at: new Date(Date.now() - 60_000).toISOString(),
  completed_at: new Date(Date.now() - 55_000).toISOString(),
  activated_at: null,
  file_count: 42,
  revision_ids: ['22222222-2222-4222-8222-222222222222'],
  retire_item_ids: [],
  base_publish_epoch: 7,
  manifest_sha256: 'a'.repeat(64),
}

vi.mock('@/api/ck', () => ({
  ck: {
    releases: {
      list: () => Promise.resolve([building, promotable]),
      create: () => Promise.resolve({}),
      activate: () => Promise.resolve({}),
      promote: () => Promise.resolve({}),
      remove: () => Promise.resolve({}),
    },
    content: { list: () => Promise.resolve([]) },
  },
}))

const { ReleasesPage } = await import('@/pages/releases')

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ReleasesPage />
    </QueryClientProvider>,
  )
}

describe('Releases — a build in flight', () => {
  it('renders a deep-linked promotion review only for the exact preview and manifest', async () => {
    renderPage()
    await screen.findByTestId('promotion-review-confirm')
    const review = screen.getByTestId('promotion-review')
    expect(review).toHaveTextContent(promotable.id)
    expect(review).toHaveTextContent(promotable.manifest_sha256)
    expect(within(review).getByTestId('promotion-review-confirm')).toBeEnabled()
  })

  it('says a build is running', async () => {
    renderPage()
    const card = await screen.findByTestId('release-building')
    expect(card).toHaveTextContent('Building')
  })

  it('exposes the in-flight build as an indeterminate PROGRESSBAR, not a status region', async () => {
    renderPage()
    const card = await screen.findByTestId('release-building')

    // The honesty contract, in ARIA's own words: a named progressbar that
    // publishes no value is "indeterminate". `role="status"` announces once and
    // then describes nothing — a reader that arrives late is told the card is
    // text, not that a build is in flight.
    const bar = within(card).getByRole('progressbar')
    expect(bar).toHaveAccessibleName(/build/i)
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(bar).not.toHaveAttribute('aria-valuemin')
    expect(bar).not.toHaveAttribute('aria-valuemax')
  })

  it('still refuses to invent a percentage', async () => {
    renderPage()
    const card = await screen.findByTestId('release-building')

    // This part the page gets right and must keep: elapsed time is the one fact
    // an unmeasured build has.
    expect(card).not.toHaveTextContent('%')
    expect(within(card).getByTestId('release-build-since')).toBeInTheDocument()
  })
})
