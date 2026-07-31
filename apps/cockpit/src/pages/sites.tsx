import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { ck, type Site } from '@/api/ck'
import { ApiError } from '@/api/client'
import { Page } from '@/app/shell'
import { AppLink } from '@/components/app-link'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
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
 * One of these sits in each row and names that row's site. Nothing about it
 * reads the site switcher.
 */
function DeleteSite({ site }: { site: Site }) {
  const [isOpen, setOpen] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const client = useQueryClient()
  const { toast } = useToast()

  const remove = useMutation({
    mutationFn: (purge: boolean) => ck.sites.remove(site.slug, purge),
    onSuccess: async () => {
      setOpen(false)
      setRefusal(null)
      toast({ tone: 'success', title: `${site.name} was deleted` })
      // The provider falls back to another site once this one is gone.
      await client.invalidateQueries({ queryKey: keys.sites.all })
    },
    onError: (failure) => {
      if (failure instanceof ApiError && failure.status === 409) setRefusal(failure.message)
    },
  })

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Delete ${site.name}`}
        data-testid={`ck-site-delete-${site.slug}`}
        onClick={() => {
          setRefusal(null)
          remove.reset()
          setOpen(true)
        }}
      >
        {/* No size class on an icon inside a Button: the CVA sizes it per button
            size, and the severity is the dialog's to state, not this icon's. */}
        <Trash2 data-icon="inline-start" />
        Delete
      </Button>
      {/*
        An AlertDialog rather than a Dialog: this is the console's most
        destructive act, and an alert dialog has no light-dismiss, traps focus on
        Cancel and is announced as a decision. A confirmation a stray click on the
        backdrop can answer is not a confirmation.
      */}
      <AlertDialog
        open={isOpen}
        onOpenChange={(next) => {
          // A DELETE that is still in the air is not one that can be taken back,
          // so only its answer closes this.
          if (remove.isPending) return
          setOpen(next)
        }}
      >
        <AlertDialogContent
          data-testid="ck-site-delete-dialog"
          onEscapeKeyDown={(event) => {
            if (remove.isPending) event.preventDefault()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {site.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The site row, its content, its releases and the stored objects behind them are removed. None of it is
              recoverable.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* The slug, because two sites may carry the same name and only one of
              them is in this row. */}
          <p data-testid="ck-site-delete-target" className="font-mono text-xs text-muted-foreground">
            {site.slug} · {site.base_url}
          </p>

          {refusal ? (
            // The server's own refusal, verbatim and announced: the 409 carries
            // the counts that make the second answer a decision about known
            // numbers rather than a repeat of the first.
            <Alert variant="destructive" data-testid="ck-site-delete-refusal">
              <TriangleAlert />
              <AlertTitle>The server refused</AlertTitle>
              <AlertDescription>{refusal}</AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">
              A site that still owns content refuses once and names what would go, so the second answer is a decision
              about known numbers.
            </p>
          )}

          {remove.error && !(remove.error instanceof ApiError && remove.error.status === 409) ? (
            <Alert variant="destructive" data-testid="ck-site-delete-error">
              <TriangleAlert />
              <AlertTitle>The site was not deleted</AlertTitle>
              <AlertDescription>{remove.error.message}</AlertDescription>
            </Alert>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel size="sm" data-testid="ck-site-delete-cancel" disabled={remove.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              size="sm"
              data-testid={refusal ? 'ck-site-delete-purge' : 'ck-site-delete-confirm'}
              disabled={remove.isPending}
              aria-busy={remove.isPending}
              // Radix closes on this click, and the 409 that turns the first
              // answer into the second arrives afterwards — so the close is
              // refused here and the answer is what closes it.
              onClick={(event) => {
                event.preventDefault()
                remove.mutate(Boolean(refusal))
              }}
            >
              {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
              {refusal ? 'Delete the site and all of it' : 'Delete site'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
