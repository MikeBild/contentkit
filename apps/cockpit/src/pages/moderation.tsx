import { useState } from 'react'
import { NoSite, Page } from '@/app/shell'
import { TabPanel, Tabs } from '@/components/ui/tabs'
import { CommentsCard, ContactCard, FeedbackCard } from '@/forms/audience/moderation'
import { useSite } from '@/lib/site'

/**
 * Three parallel readings of one subject — what visitors sent this site — so a
 * tab strip rather than three stacked lists.
 *
 * A moderator arrives to do one of three jobs: clear the comment queue, answer
 * the contact form, or look at what the posts scored. Stacked, the three
 * queried on load, each drew its own filter row, and the one being worked on was
 * the one that happened to be scrolled to; the feedback table — the shortest and
 * the least urgent — sat under two full lists.
 *
 * Nothing here writes into anything else: the three endpoints are separate, each
 * mutation invalidates only its own list, and no control in one panel changes
 * what another panel shows. That is what makes this the tab case rather than the
 * one §1 refuses.
 *
 * `TabPanel` keeps every panel mounted, so a status filter set on Comments
 * survives a look at Feedback — and a request that fails while another tab is
 * open is still that tab's own error, waiting where the reader will next look
 * for it. No action taken on one panel reports its outcome on another.
 */
type ModerationTab = 'comments' | 'contact' | 'feedback'

export function ModerationPage() {
  const { site, siteId } = useSite()
  const [tab, setTab] = useState<ModerationTab>('comments')

  if (!siteId)
    return (
      <Page title="Moderation">
        <NoSite />
      </Page>
    )

  return (
    <Page title="Moderation" description="Visitor comments, contact submissions and anonymous post feedback.">
      <Tabs
        data-testid="ck-moderation-tabs"
        value={tab}
        onValueChange={setTab}
        className="mb-4 overflow-x-auto"
        tabs={[
          { id: 'comments', label: 'Comments' },
          { id: 'contact', label: 'Contact' },
          { id: 'feedback', label: 'Feedback' },
        ]}
      />

      <TabPanel active={tab === 'comments'} data-testid="ck-moderation-tab-comments">
        <CommentsCard site={site} siteId={siteId} />
      </TabPanel>
      <TabPanel active={tab === 'contact'} data-testid="ck-moderation-tab-contact">
        <ContactCard siteId={siteId} />
      </TabPanel>
      <TabPanel active={tab === 'feedback'} data-testid="ck-moderation-tab-feedback">
        <FeedbackCard site={site} siteId={siteId} />
      </TabPanel>
    </Page>
  )
}
