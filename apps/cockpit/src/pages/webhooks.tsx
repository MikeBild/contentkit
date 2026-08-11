import { useState } from 'react'
import { ck } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { useI18n } from '@/lib/i18n-context'
import { TabCountBadge } from '@/components/tab-count'
import { TabPanel, Tabs } from '@/components/ui/tabs'
import { WebhookDeliveriesCard, WebhookEndpointsCard } from '@/forms/platform/webhooks'
import { keys } from '@/lib/query'
import { useSite } from '@/lib/site'
import { useTabCount } from '@/lib/tab-counts'

/**
 * Two parallel readings of one subject — what this site sends, and what came of
 * it — so a tab strip rather than two stacked cards.
 *
 * An operator is in exactly one of them at a time: configuring an endpoint, or
 * finding out why yesterday's release never reached it. Stacked, the delivery
 * log — the longer of the two and the one with three filters of its own — began
 * below whatever number of endpoints happened to be configured.
 *
 * Neither panel's controls touch the other's content, which is the condition
 * UI-UX.md §1 puts on this step: creating an endpoint adds an option to the
 * delivery filter, and the filter reads that list from the API rather than from
 * this page's state, so nothing here has an effect the reader cannot see.
 *
 * A failure in either panel is that panel's own — no button on Endpoints
 * produces a result on Deliveries — so no error can arrive into a hidden panel
 * while the reader is looking at the other one.
 */
type WebhookTab = 'endpoints' | 'deliveries'

/**
 * `GET /v1/webhook-deliveries` is limit-paged and defaults to 50, so a count
 * read off it is a floor rather than a total. 200 is high enough that a site
 * with a handful of broken endpoints gets an exact number, and the badge says
 * "200+" rather than "200" when it is not — see `atLeast` in lib/tab-counts.ts.
 */
const FAILED = { status: 'failed', limit: 200 } as const

export function WebhooksPage() {
  const { t } = useI18n()
  const { site, siteId } = useSite()
  const [tab, setTab] = useState<WebhookTab>('endpoints')

  /*
    Endpoints is a free read: both cards already query `keys.webhooks.list(site)`
    — the delivery filter names its endpoints from it — so this observes a row
    that exists whichever tab is open.

    Deliveries is the one request this page adds, and it is the one that answers
    the question an operator has while looking at the other tab: not how many
    events were sent, but how many never arrived. `pending` is a queue draining
    itself and `delivered` is the ordinary case; `failed` is the only one of the
    three with a Retry button under it, which is what "waiting" means here.
  */
  const endpoints = useTabCount({
    queryKey: keys.webhooks.list(site),
    queryFn: () => ck.webhooks.list(site),
    count: (rows) => rows.length,
    enabled: Boolean(site),
    open: tab === 'endpoints',
  })
  const failed = useTabCount({
    queryKey: keys.webhooks.deliveries(siteId, FAILED),
    queryFn: () => ck.webhooks.deliveries(siteId, FAILED),
    count: (rows) => rows.length,
    enabled: Boolean(siteId),
    open: tab === 'deliveries',
  })

  // Destructive, and the word "failed" beside the number: §8 refuses to convey a
  // severity by colour alone, and without the noun the figure would read as the
  // size of the delivery log rather than the part of it that went nowhere.
  const endpointsBadge = <TabCountBadge count={endpoints} data-testid="ck-webhook-count-endpoints" />
  const deliveriesBadge = (
    <TabCountBadge
      count={failed}
      noun="failed"
      variant="destructive"
      atLeast={failed === FAILED.limit}
      data-testid="ck-webhook-count-deliveries"
    />
  )

  if (!site)
    return (
      <Page title={t('page.webhooks.title')}>
        <NoSite />
      </Page>
    )

  return (
    <Page title={t('page.webhooks.title')} description={t('page.webhooks.description')}>
      <Tabs
        data-testid="ck-webhook-tabs"
        value={tab}
        onValueChange={setTab}
        // The strip scrolls rather than widening the page: §6 lets a table
        // scroll sideways and nothing else.
        className="mb-4 overflow-x-auto"
        tabs={[
          { id: 'endpoints', label: t('webhook.endpoints'), badge: endpointsBadge },
          { id: 'deliveries', label: t('webhook.deliveries'), badge: deliveriesBadge },
        ]}
      />

      <TabPanel active={tab === 'endpoints'} data-testid="ck-webhook-tab-endpoints">
        <WebhookEndpointsCard site={site} />
      </TabPanel>
      <TabPanel active={tab === 'deliveries'} data-testid="ck-webhook-tab-deliveries">
        <WebhookDeliveriesCard site={site} siteId={siteId} />
      </TabPanel>
    </Page>
  )
}
