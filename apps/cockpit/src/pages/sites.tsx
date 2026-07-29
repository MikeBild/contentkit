import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ck } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { Confirm } from '@/components/confirm'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from '@/components/ui/primitives'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { useSite } from '@/lib/site'

export function SitesPage() {
  const { site, setSite } = useSite()
  const can = useCan()
  const client = useQueryClient()

  const detail = useQuery({
    queryKey: keys.sites.detail(site),
    queryFn: () => ck.sites.get(site),
    enabled: Boolean(site),
  })

  const [settings, setSettings] = useState('')
  const [invalid, setInvalid] = useState<string | null>(null)

  // The editor is seeded from the server and then owned by the operator, so it
  // must not be clobbered by a background refetch mid-edit.
  useEffect(() => {
    if (detail.data) setSettings(JSON.stringify(detail.data.settings ?? {}, null, 2))
  }, [detail.data?.id])

  const save = useMutation({
    mutationFn: () => ck.sites.update(site, { settings: JSON.parse(settings) } as never),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.sites.detail(site) }),
  })

  return (
    <Page title="Sites" description="Site metadata, domains and the settings subtree that drives presentation.">
      {can('site:admin') ? <CreateSite onCreated={(slug) => setSite(slug)} /> : null}

      {!site ? (
        <NoSite />
      ) : detail.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : detail.error ? (
        <p className="text-sm text-chart-5">
          {detail.error instanceof Error ? detail.error.message : 'Could not load the site'}
        </p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[20rem_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>{detail.data.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Field label="Slug" value={detail.data.slug} />
              <Field label="Base URL" value={detail.data.base_url} />
              <Field label="Default locale" value={detail.data.default_locale} />
              <Field label="Description" value={detail.data.description ?? '—'} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
              <p className="text-sm text-muted-foreground">
                PATCH replaces this subtree wholesale, so the console sends the whole object back — editing a
                fragment would silently drop the rest.
              </p>
            </CardHeader>
            <CardContent>
              <Textarea
                className="h-[28rem] font-mono text-xs"
                spellCheck={false}
                value={settings}
                onChange={(event) => {
                  setSettings(event.target.value)
                  try {
                    JSON.parse(event.target.value)
                    setInvalid(null)
                  } catch (error) {
                    setInvalid(error instanceof Error ? error.message : 'Invalid JSON')
                  }
                }}
              />
              {invalid ? <p className="mt-2 text-sm text-chart-5">{invalid}</p> : null}
              {save.error ? (
                <p className="mt-2 text-sm text-chart-5">
                  {save.error instanceof Error ? save.error.message : 'Could not save'}
                </p>
              ) : null}
              {can('site:admin') ? (
                <div className="mt-3 flex justify-end">
                  <Confirm
                    title="Replace the site settings?"
                    description={
                      <>
                        The entire <code>settings</code> object of <strong>{site}</strong> is replaced by what is in
                        the editor. Presentation changes take effect on the next release.
                      </>
                    }
                    confirmLabel="Save settings"
                    onConfirm={() => save.mutateAsync()}
                  >
                    {(open) => (
                      <Button onClick={open} disabled={Boolean(invalid) || save.isPending}>
                        Save settings
                      </Button>
                    )}
                  </Confirm>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </Page>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="truncate" title={value}>
        {value}
      </div>
    </div>
  )
}

function CreateSite({ onCreated }: { onCreated: (slug: string) => void }) {
  const [isOpen, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', base_url: '', default_locale: 'en' })
  const create = useMutation({
    mutationFn: () => ck.sites.create(form),
    onSuccess: (created) => {
      setOpen(false)
      onCreated(created.slug)
    },
  })

  if (!isOpen)
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        New site
      </Button>
    )

  return (
    <Card className="mt-4 max-w-xl">
      <CardHeader>
        <CardTitle>New site</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {(['name', 'base_url', 'default_locale'] as const).map((field) => (
          <div key={field}>
            <Label>{field.replace('_', ' ')}</Label>
            <Input value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} />
          </div>
        ))}
        {create.error ? (
          <p className="text-sm text-chart-5">
            {create.error instanceof Error ? create.error.message : 'Could not create the site'}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !form.name || !form.base_url}>
            Create
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
