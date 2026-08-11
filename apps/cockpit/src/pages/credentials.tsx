import { useState } from 'react'
import { ck } from '@/api/ck'
import { Page } from '@/app/shell'
import { useI18n } from '@/lib/i18n-context'
import { TabCountBadge } from '@/components/tab-count'
import { TabPanel, Tabs } from '@/components/ui/tabs'
import { ApiKeysCard } from '@/forms/platform/api-keys'
import { IdentityGrantsCard } from '@/forms/platform/identity'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { useTabCount } from '@/lib/tab-counts'

/**
 * Two parallel readings of one subject — what a credential may ever do — so a
 * tab strip, and only where there are two of them to read.
 *
 * A key is issued with its scopes fixed and is never edited; a grant is a
 * ceiling that can be shrunk and takes effect on the next request. Those are
 * different objects with different lifecycles, and an operator is here for one
 * of them: issuing a key, or narrowing an identity. Neither panel's controls
 * touch the other's rows.
 *
 * `IdentityGrantsCard` renders nothing at all without `identity:admin`, and a
 * tab whose panel is empty is a control that lies about what is behind it. So a
 * session that cannot read grants gets no strip and no panel — one list, which
 * is the ladder's first step and what this page then is.
 */
type CredentialTab = 'keys' | 'grants'

export function CredentialsPage() {
  const { t } = useI18n()
  const can = useCan()
  const [tab, setTab] = useState<CredentialTab>('keys')
  const grants = can('identity:admin')

  /*
    Both counts are free. Neither list takes a filter — `/v1/api-keys` has no
    query parameters at all and the grants card asks for every identity — so
    these are the panels' own keys, and both panels are mounted whichever tab is
    on top. The badge is a second observer of one row in the cache, so it counts
    exactly the rows the panel below it lists, by construction rather than by
    agreement.

    Gated on `identity:admin` for the same reason the strip is: without it there
    is no strip, no grants panel and nothing to count.
  */
  const keyCount = useTabCount({
    queryKey: keys.credentials.apiKeys,
    queryFn: () => ck.credentials.apiKeys(),
    count: (rows) => rows.length,
    enabled: grants,
    open: tab === 'keys',
  })
  const grantCount = useTabCount({
    queryKey: keys.credentials.grants,
    queryFn: () => ck.credentials.grants(),
    count: (rows) => rows.length,
    enabled: grants,
    open: tab === 'grants',
  })

  const keysBadge = <TabCountBadge count={keyCount} data-testid="ck-credentials-count-keys" />
  const grantsBadge = <TabCountBadge count={grantCount} data-testid="ck-credentials-count-grants" />

  return (
    <Page title={t('page.credentials.title')} description={t('page.credentials.description')}>
      {grants ? (
        <>
          <Tabs
            data-testid="ck-credentials-tabs"
            value={tab}
            onValueChange={setTab}
            className="mb-4 overflow-x-auto"
            tabs={[
              { id: 'keys', label: t('apiKey.keys'), badge: keysBadge },
              { id: 'grants', label: t('identity.grants'), badge: grantsBadge },
            ]}
          />
          <TabPanel active={tab === 'keys'} data-testid="ck-credentials-tab-keys">
            <ApiKeysCard />
          </TabPanel>
          <TabPanel active={tab === 'grants'} data-testid="ck-credentials-tab-grants">
            <IdentityGrantsCard />
          </TabPanel>
        </>
      ) : (
        <ApiKeysCard />
      )}
    </Page>
  )
}
