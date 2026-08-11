import { useState } from 'react'
import { type AccessRule } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { useI18n } from '@/lib/i18n-context'
import { GroupsCard } from '@/forms/audience/groups'
import { ReadersCard } from '@/forms/audience/readers'
import { RebuildBanner, useRebuildRequired } from '@/forms/audience/rebuild-banner'
import { RulesCard } from '@/forms/audience/rules'
import { useSite } from '@/lib/site'

/**
 * Who may read the published site — and the one page in this group that is
 * deliberately NOT a tab strip.
 *
 * Readers, path rules and groups are three parallel readings of one subject, so
 * the container ladder's second step is the obvious answer and it is the wrong
 * one here: `editingRule` is lifted out of the rules card precisely so the
 * groups card can open the very rule that is blocking a deletion, rather than
 * only naming it. That is one panel's control acting on another panel's
 * content, which UI-UX.md §1 names as the case Tabs must not be used for — a
 * button whose whole effect is off screen describes itself falsely.
 *
 * The three lists also read each other's data on screen: a group row prints the
 * rules that name it, and a rule row prints the groups and readers it admits.
 * Behind tabs, deleting the last rule that blocks a group would change a count
 * the reader cannot see.
 *
 * So it is three cards, stacked, which is the ladder's third step and the
 * honest one.
 */
export function AccessPage() {
  const { t } = useI18n()
  const { site } = useSite()
  const rebuild = useRebuildRequired(site)
  // Lifted out of the rules card so the groups card can open the very rule that
  // is blocking a deletion, instead of only naming it.
  const [editingRule, setEditingRule] = useState<{ rule?: AccessRule } | null>(null)

  if (!site)
    return (
      <Page title={t('page.access.title')}>
        <NoSite />
      </Page>
    )

  return (
    <Page
      title={t('page.access.title')}
      description={t('page.access.description')}
    >
      {rebuild.required ? <RebuildBanner site={site} onBuilt={rebuild.clear} /> : null}

      <div className="flex flex-col gap-4">
        <ReadersCard site={site} />
        <RulesCard
          site={site}
          editing={editingRule}
          onEditingChange={setEditingRule}
          onRebuildRequired={rebuild.mark}
        />
        <GroupsCard site={site} onEditRule={(rule) => setEditingRule({ rule })} />
      </div>
    </Page>
  )
}
