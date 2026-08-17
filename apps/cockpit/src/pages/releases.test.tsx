import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/app/shell', () => ({
  Page: ({ actions, children }: { actions?: ReactNode; children: ReactNode }) => (
    <div>
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
  useSearch: () => ({ promotion_review: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
  useNavigate: () => vi.fn(),
}))

const promote = vi.fn(() => Promise.resolve({ active: true }))
const remove = vi.fn(() => Promise.resolve({}))
const preview = {
  id: '11111111-1111-4111-8111-111111111111',
  site_id: 'site-1',
  kind: 'preview',
  status: 'preview',
  reason: 'Editorial review',
  created_at: '2026-08-17T10:00:00.000Z',
  completed_at: '2026-08-17T10:01:00.000Z',
  activated_at: null,
  file_count: 2,
  revision_ids: [],
  retire_item_ids: [],
  base_publish_epoch: 7,
  manifest_sha256: 'b'.repeat(64),
}
const review = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  site_id: 'site-1',
  release_id: preview.id,
  manifest_sha256: preview.manifest_sha256,
  status: 'pending',
  reason: 'Editorial review',
  requested_at: '2026-08-17T10:02:00.000Z',
  expires_at: '2026-08-18T10:02:00.000Z',
  decided_at: null,
  changes: [{ content_item_id: 'item-1', title: 'A reviewed article', effect: 'modify', old: null, new: null }],
}
const building = {
  ...preview,
  id: '33333333-3333-4333-8333-333333333333',
  kind: 'release',
  status: 'building',
  reason: 'Scheduled refresh',
  file_count: null,
  manifest_sha256: null,
}

vi.mock('@/api/ck', () => ({
  ck: {
    releases: {
      list: () => Promise.resolve([preview, building]),
      create: () => Promise.resolve({}),
      activate: () => Promise.resolve({}),
      promote,
      remove,
    },
    promotionReviews: { get: () => Promise.resolve(review) },
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

describe('Releases', () => {
  it('uses a deep-linked server-side promotion review only for its immutable preview and manifest binding', async () => {
    const user = userEvent.setup()
    renderPage()
    const card = await screen.findByTestId('promotion-review')
    await within(card).findByText(/1 reviewed content revision/)
    await user.click(within(card).getByRole('button', { name: 'Publish now' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Publish now' }))
    expect(promote).toHaveBeenCalledWith('mikebild', preview.id, preview.manifest_sha256, review.id)
  })

  it('names the reviewed content and explains the live effect before confirmation', async () => {
    renderPage()
    const card = await screen.findByTestId('promotion-review')
    expect(await within(card).findByText('A reviewed article')).toBeInTheDocument()
    expect(within(card).getByText(/public website mikebild changes immediately/i)).toBeInTheDocument()
    expect(within(card).getByText(/nothing changes/i)).toBeInTheDocument()
  })

  it('says a build is running', async () => {
    renderPage()
    expect(await screen.findByTestId('release-building')).toHaveTextContent('Building')
  })

  it('never puts a percentage on a running build', async () => {
    renderPage()
    const progress = within(await screen.findByTestId('release-building')).getByRole('progressbar')
    expect(progress).not.toHaveTextContent('%')
  })

  it('renders the in-flight build as an indeterminate progressbar', async () => {
    renderPage()
    const progress = within(await screen.findByTestId('release-building')).getByRole('progressbar')
    expect(progress).not.toHaveAttribute('aria-valuenow')
  })

  it('keeps deletion out of the list primary surface and behind an overflow confirmation', async () => {
    const user = userEvent.setup()
    renderPage()
    const row = await screen.findByTestId('release-row-0')
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()
  })
})
