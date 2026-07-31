import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ck, type Site } from '@/api/ck'
import { ApiError } from '@/api/client'
import { Page } from '@/app/shell'
import { AppLink } from '@/components/app-link'
import { Confirm } from '@/components/confirm'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'
import { TableState } from '@/forms/table-state'
import { CreateSiteWizard } from '@/forms/site/wizard'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { useSite } from '@/lib/site'

/**
 * The site registry: what exists in this installation, plus creating and
 * deleting one.
 *
 * This page used to be both halves at once — the registry *and* the settings
 * form of whichever site the switcher named — and the mixture put the most
 * destructive control in the console under a switcher that was dimmed and
 * captioned "Filters this page only". Delete took its target from the
 * selection, so the one control that decided which site was about to be deleted
 * looked disabled.
 *
 * The two halves are now two routes. Here a site is chosen the way a row is
 * chosen: deliberately, in the table, with the name and the base URL of that
 * row in the confirmation. The switcher plays no part on this page — the
 * sidebar says so — and the settings of the selected site live at /settings.
 */
export function SitesPage() {
  // Deliberately no `site`/`siteId`: the selection must not decide anything
  // here. `setSite` is a write — the wizard hands its new slug to it so the
  // rest of the console follows the site that was just created.
  const { sites, setSite, isLoading, error } = useSite()
  const can = useCan()

  return (
    <Page
      title="Sites"
      description="Every site this credential may read. Creating and deleting one is an installation act; a site's own settings are under Site settings."
      actions={can('site:admin') ? <CreateSiteWizard onCreated={setSite} /> : null}
    >
      {/* The table is the card's whole content, so the vertical padding a Card
          reserves for stacked blocks is taken back rather than drawn around a
          header row that already has its own. */}
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Base URL</TableHead>
              <TableHead>Default locale</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState
              columns={5}
              isLoading={isLoading}
              error={error}
              isEmpty={sites.length === 0}
              emptyTitle="No sites yet"
              emptyMessage="Create one — nothing is public until a release of it is built and activated."
            >
              {sites.map((entry) => (
                <TableRow key={entry.id} data-testid="ck-sites-row" data-site={entry.slug}>
                  <TableCell className="font-medium">{entry.name}</TableCell>
                  <TableCell className="font-mono text-xs">{entry.slug}</TableCell>
                  <TableCell className="text-muted-foreground">{entry.base_url}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{entry.default_locale}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {/*
                      The row is how the settings editor is opened, and the link
                      carries this row's slug as ?site= rather than relying on
                      the switcher: the operator picked this site here.
                    */}
                    <AppLink
                      to="/settings"
                      // The one link in the console that deliberately changes
                      // the site rather than carrying it forward. Written as a
                      // reducer because AppLink is route-agnostic and its search
                      // type is resolved per route.
                      search={(() => ({ site: entry.slug })) as never}
                      data-testid={`ck-sites-settings-${entry.slug}`}
                      className="rounded-md px-2 py-1 text-sm text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
                    >
                      Settings
                    </AppLink>
                    {can('site:admin') ? <DeleteSite site={entry} /> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableState>
          </TableBody>
        </Table>
      </Card>
    </Page>
  )
}

/**
 * Deleting a site, in the two steps the server insists on.
 *
 * A site that still owns content, releases or readers answers 409 with the
 * counts, and that refusal *is* the confirmation step — so the first attempt
 * never passes `purge`. Sending it straight away would turn a deliberate
 * safeguard into a flag the console silently sets.
 *
 * The dialog is `components/confirm.tsx`, the same one every other mutation goes
 * through, and this page hand-rolls none of it any more. That matters here more
 * than anywhere else in the console, because this is the one trigger that is
 * *deleted by the act it starts*: the `<Button>` lives in the `<TableRow>` the
 * mutation removes, so by the time the dialog closes there is nothing left to
 * give focus back to. The page's own dialog dropped focus on `<body>` at that
 * moment — no position in the table, the next Tab starting from the top of the
 * document, after the console's most destructive act. `Confirm` parks focus on
 * the surviving `<table>` instead, and `pages/sites.test.tsx` renders this page
 * and asks the DOM where focus went.
 *
 * The two-step refusal is `Confirm`'s too, and was not reimplemented: a rejected
 * `onConfirm` keeps the dialog open, announces the server's own words through
 * `role="alert"` and leaves the target on screen. All this call site adds is what
 * only it knows — that a 409 means *ask again with `purge`*, and that the second
 * question is a different one, with its own label and its own name.
 *
 * One of these sits in each row and names that row's site. Nothing about it
 * reads the site switcher.
 */
function DeleteSite({ site }: { site: Site }) {
  /**
   * Sticky, and reset every time the dialog is opened.
   *
   * Sticky, because once the server has named what would be lost the operator is
   * answering a different question and a failure of *that* answer must not
   * quietly go back to the safe one. Reset on open, because a refusal the
   * operator walked away from must not arm the purge for whoever opens this row
   * next: the second answer is only ever available directly behind the refusal
   * that earned it.
   */
  const [refused, setRefused] = useState(false)
  /** Which of the two names the announcement carries: the 409 that is part of
   *  the flow, or an ordinary failure that is not. */
  const [failure, setFailure] = useState<'refusal' | 'error'>('error')
  const client = useQueryClient()
  const { toast } = useToast()

  return (
    <Confirm
      title={`Delete ${site.name}?`}
      description={
        <>
          The site row, its content, its releases and the stored objects behind them are removed. None of it is
          recoverable.{' '}
          {refused
            ? 'The server has named what would go; answering again deletes it with the site.'
            : 'A site that still owns content refuses once and names what would go, so the second answer is a decision about known numbers.'}
          {/* The slug, because two sites may carry the same name and only one of
              them is in this row. A span rather than a paragraph: the
              description Radix renders is itself a <p>. */}
          <span data-testid="ck-site-delete-target" className="mt-2 block font-mono text-xs">
            {site.slug} · {site.base_url}
          </span>
        </>
      }
      confirmLabel={refused ? 'Delete the site and all of it' : 'Delete site'}
      destructive
      // The names `scripts/verify-cockpit-prod.md` drives this by, including the
      // one that separates the first answer from the one that destroys a live
      // site. See `ConfirmIds`.
      ids={{
        dialog: 'ck-site-delete-dialog',
        cancel: 'ck-site-delete-cancel',
        accept: refused ? 'ck-site-delete-purge' : 'ck-site-delete-confirm',
        error: failure === 'refusal' ? 'ck-site-delete-refusal' : 'ck-site-delete-error',
      }}
      onConfirm={async () => {
        try {
          await ck.sites.remove(site.slug, refused)
        } catch (thrown) {
          // The 409 is not an error path, it is the second step: it arms the
          // purge and is re-thrown so that Confirm keeps the dialog open and
          // announces the counts the server sent, verbatim.
          const conflict = thrown instanceof ApiError && thrown.status === 409
          if (conflict) setRefused(true)
          setFailure(conflict ? 'refusal' : 'error')
          throw thrown
        }
        toast({ tone: 'success', title: `${site.name} was deleted` })
        // Awaited, so the row is gone before the dialog closes: the trigger this
        // was opened from unmounts with it, and focus lands on the table rather
        // than on a control that is about to disappear.
        // The provider falls back to another site once this one is gone.
        await client.invalidateQueries({ queryKey: keys.sites.all })
      }}
    >
      {(open) => (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Delete ${site.name}`}
          data-testid={`ck-site-delete-${site.slug}`}
          onClick={() => {
            setRefused(false)
            setFailure('error')
            open()
          }}
        >
          {/* No size class on an icon inside a Button: the CVA sizes it per button
              size, and the severity is the dialog's to state, not this icon's. */}
          <Trash2 data-icon="inline-start" />
          Delete
        </Button>
      )}
    </Confirm>
  )
}
