import { useState } from 'react'
import { Page } from '@/app/shell'
import { TabPanel, Tabs } from '@/components/ui/tabs'
import { ApiKeysCard } from '@/forms/platform/api-keys'
import { IdentityGrantsCard } from '@/forms/platform/identity'
import { useCan } from '@/lib/session'

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
  const can = useCan()
  const [tab, setTab] = useState<CredentialTab>('keys')
  const grants = can('identity:admin')

  return (
    <Page title="Credentials" description="API keys and the OAuth identity grants that bound what a token may ever do.">
      {grants ? (
        <>
          <Tabs
            data-testid="ck-credentials-tabs"
            value={tab}
            onValueChange={setTab}
            className="mb-4 overflow-x-auto"
            tabs={[
              { id: 'keys', label: 'API keys' },
              { id: 'grants', label: 'Identity grants' },
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
