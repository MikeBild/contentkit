import { useState } from 'react'
import { ck } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { useI18n } from '@/lib/i18n-context'
import { TabCountBadge } from '@/components/tab-count'
import { TabPanel, Tabs } from '@/components/ui/tabs'
import { CommentsCard, ContactCard, FeedbackCard } from '@/forms/audience/moderation'
import { keys } from '@/lib/query'
import { useSite } from '@/lib/site'
import { useTabCount } from '@/lib/tab-counts'

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

/**
 * The one narrow question `GET /v1/comments` can be asked. Comments is the only
 * one of the three lists with a status, so it is the only badge that can count
 * what is waiting rather than what exists.
 */
const PENDING = { status: 'pending' } as const

export function ModerationPage() {
  const { t } = useI18n()
  const { site, siteId } = useSite()
  const [tab, setTab] = useState<ModerationTab>('comments')

  /*
    Three counts, and they cost between zero and one request.

    Contact's card queries `keys.moderation.contact(siteId)` with no filter at
    all, and every panel here stays mounted, so on arrival this key is already in
    flight for the panel: the badge is a free read of it, and the two surfaces
    cannot disagree because there is only one row in the cache.

    Feedback's card carries a post filter in its own key. Unfiltered — which is
    how it arrives — that key is `[...feedback(siteId), '']`, so this is the same
    free read; it becomes a request of its own only once the reader has narrowed
    the panel, and then it is deliberately the *unnarrowed* count.

    Comments is the second request the other two are not: the card's key carries
    a status this page does not have, and `pending` is a different question from
    whatever the card is showing. It is not fetched while Comments is the open
    tab, so arriving on this page costs nothing.
  */
  const enabled = Boolean(siteId)
  const pending = useTabCount({
    queryKey: keys.moderation.comments(siteId, PENDING),
    queryFn: () => ck.moderation.comments(siteId, PENDING),
    count: (rows) => rows.length,
    enabled,
    open: tab === 'comments',
  })
  const contact = useTabCount({
    queryKey: keys.moderation.contact(siteId),
    queryFn: () => ck.moderation.contact(siteId),
    count: (rows) => rows.length,
    enabled,
    open: tab === 'contact',
  })
  const feedback = useTabCount({
    queryKey: [...keys.moderation.feedback(siteId), ''],
    queryFn: () => ck.moderation.feedback(siteId),
    count: (rows) => rows.length,
    enabled,
    open: tab === 'feedback',
  })

  /*
    Named above the strip, not written into it: a tab definition is a row in a
    small table — id, label, badge — and a strip whose rows each run to three
    lines of JSX stops reading as the list of tabs it is.

    "4 pending" rather than "4" on Comments, because the panel under that tab may
    be showing every status and a bare number beside forty rows would claim to be
    their count. The other two count whole lists, so their number needs no noun.
  */
  const commentsBadge = <TabCountBadge count={pending} noun="pending" data-testid="ck-moderation-count-comments" />
  const contactBadge = <TabCountBadge count={contact} data-testid="ck-moderation-count-contact" />
  const feedbackBadge = <TabCountBadge count={feedback} data-testid="ck-moderation-count-feedback" />

  if (!siteId)
    return (
      <Page title={t('page.moderation.title')}>
        <NoSite />
      </Page>
    )

  return (
    <Page title={t('page.moderation.title')} description={t('page.moderation.description')}>
      <Tabs
        data-testid="ck-moderation-tabs"
        value={tab}
        onValueChange={setTab}
        className="mb-4 overflow-x-auto"
        tabs={[
          { id: 'comments', label: t('moderation.comments.title'), badge: commentsBadge },
          { id: 'contact', label: t('moderation.contact.title'), badge: contactBadge },
          { id: 'feedback', label: t('moderation.feedback.title'), badge: feedbackBadge },
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
