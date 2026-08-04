import { useState } from 'react'
import { NoSite, Page } from '@/app/shell'
import { TabPanel, Tabs } from '@/components/ui/tabs'
import { WebhookDeliveriesCard, WebhookEndpointsCard } from '@/forms/platform/webhooks'
import { useSite } from '@/lib/site'

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

export function WebhooksPage() {
  const { site, siteId } = useSite()
  const [tab, setTab] = useState<WebhookTab>('endpoints')

  if (!site)
    return (
      <Page title="Webhooks">
        <NoSite />
      </Page>
    )

  return (
    <Page title="Webhooks" description="Outbound content events, their endpoints and delivery history.">
      <Tabs
        data-testid="ck-webhook-tabs"
        value={tab}
        onValueChange={setTab}
        // The strip scrolls rather than widening the page: §6 lets a table
        // scroll sideways and nothing else.
        className="mb-4 overflow-x-auto"
        tabs={[
          { id: 'endpoints', label: 'Endpoints' },
          { id: 'deliveries', label: 'Deliveries' },
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
