import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives'
import { useSession } from '@/lib/session'
import {
  CarriedKeys,
  ChoiceCards,
  ColorField,
  DateTimeField,
  DimensionField,
  EntityMultiSelect,
  EnumMultiSelect,
  EnumSelect,
  ExtraFieldsField,
  FontFamilyField,
  KeyValueField,
  LocaleField,
  NumberField,
  ObjectListField,
  OptionalSubtree,
  PathField,
  RevealOnce,
  SchemeColorField,
  ScopePicker,
  SecretField,
  SegmentedField,
  SlugField,
  SwitchField,
  TagListField,
  TextAreaField,
  TextField,
  TokenMapField,
  TriToggle,
  UrlField,
  UrlTemplateField,
  UsernameField,
  choices,
} from './fields'
import { CONTENT_KIND, PRESENTATION_PRESET, THEME_TOKENS, WEBHOOK_EVENT_TYPES } from './contracts/enums.generated'

interface DocVersion extends Record<string, unknown> {
  id: string
  label: string
  current: boolean
}

/**
 * Every field, once, with live state.
 *
 * Not a test and not documentation — a place to see the whole inventory at the
 * same size, in both colour schemes, and catch the field that looks wrong next
 * to its neighbours. It is also the only consumer that exercises all of them, so
 * a field that stops compiling is caught here rather than in the first form that
 * happens to reach for it.
 *
 * Dev build only; `SystemPage` gates it on `import.meta.env.DEV`.
 */
export function FieldGallery() {
  const session = useSession()
  const [state, setState] = useState({
    text: 'ContentKit',
    slug: '',
    username: 'mike',
    body: 'Two paragraphs of body text.',
    kind: 'post' as (typeof CONTENT_KIND)[number] | '',
    preset: 'portfolio' as (typeof PRESENTATION_PRESET)[number],
    density: 'balanced' as 'compact' | 'balanced' | 'spacious',
    tri: undefined as boolean | undefined,
    toggle: true,
    number: 30 as number | undefined,
    dimension: '0.75rem',
    when: undefined as string | undefined,
    url: 'https://mikebild.dev',
    asset: '/assets/logo.svg',
    template: 'https://example.com/feed/{slug}.xml',
    color: '#0f172a',
    scheme: { light: '#0f172a', dark: '#f8fafc' } as string | { light: string; dark: string },
    font: 'Inter, system-ui, sans-serif',
    locale: 'de',
    tags: ['architecture', 'contentkit'] as readonly string[],
    events: [] as readonly (typeof WEBHOOK_EVENT_TYPES)[number][],
    groups: [] as readonly string[],
    path: '/docs/getting-started',
    versions: [{ id: 'v2', label: 'Version 2', current: true }] as DocVersion[],
    reports: undefined as { title: string } | undefined,
    map: { author: 'Mike' } as Record<string, string>,
    tokens: { primary: '#0f172a' } as Record<string, unknown>,
    extra: { reading_time: 4 } as Record<string, unknown>,
    secret: '',
    scopes: ['content:read'] as string[],
    carried: { legacy_flag: true, nested: { a: 1 } } as Record<string, unknown>,
  })

  const set = <K extends keyof typeof state>(key: K) => (value: (typeof state)[K]) =>
    setState((current) => ({ ...current, [key]: value }))

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="ck-field-gallery">
      <Section title="Text">
        <TextField data-testid="ck-gallery-text" label="Title" maxLength={60} value={state.text} onChange={set('text')} />
        <SlugField
          data-testid="ck-gallery-slug"
          label="Slug"
          help="Derived from the title until you change it."
          derivedFrom={state.text}
          siblings={['contentkit']}
          value={state.slug}
          onChange={set('slug')}
        />
        <UsernameField data-testid="ck-gallery-username" label="Username" value={state.username} onChange={set('username')} />
        <TextAreaField
          data-testid="ck-gallery-textarea"
          label="Custom CSS"
          maxBytes={8192}
          forbid={/<\/style/i}
          forbidMessage="“</style” would break out of the style element"
          monospace
          value={state.body}
          onChange={set('body')}
        />
        <PathField data-testid="ck-gallery-path" label="Path" value={state.path} onChange={set('path')} />
      </Section>

      <Section title="Choice">
        <EnumSelect
          data-testid="ck-gallery-enum"
          label="Kind"
          allowEmpty
          options={choices(CONTENT_KIND)}
          value={state.kind}
          onChange={set('kind')}
        />
        <SegmentedField
          data-testid="ck-gallery-segmented"
          label="Density"
          options={choices(['compact', 'balanced', 'spacious'] as const)}
          value={state.density}
          onChange={set('density')}
        />
        <ChoiceCards
          data-testid="ck-gallery-cards"
          label="Presentation preset"
          options={PRESENTATION_PRESET.map((preset) => ({
            value: preset,
            label: preset,
            description: `Renders the site as a ${preset.replace('-', ' ')}.`,
          }))}
          value={state.preset}
          onChange={set('preset')}
        />
        <TriToggle
          data-testid="ck-gallery-tri"
          label="Show extra fields"
          defaultLabel="whatever the preset says"
          value={state.tri}
          onChange={set('tri')}
        />
        <SwitchField data-testid="ck-gallery-switch" label="Feedback widget" value={state.toggle} onChange={set('toggle')} />
      </Section>

      <Section title="Numbers and time">
        <NumberField
          data-testid="ck-gallery-number"
          label="Retention"
          unit="days"
          min={1}
          integer
          allowUnset
          value={state.number}
          onChange={set('number')}
        />
        <DimensionField data-testid="ck-gallery-dimension" label="Radius" value={state.dimension} onChange={set('dimension')} />
        <DateTimeField data-testid="ck-gallery-datetime" label="Expires" value={state.when} onChange={set('when')} />
      </Section>

      <Section title="Addresses">
        <UrlField data-testid="ck-gallery-url" label="Base URL" value={state.url} onChange={set('url')} />
        <UrlField
          data-testid="ck-gallery-asset"
          label="Logo"
          mode="asset"
          base={state.url}
          fallback="Empty falls back to the site name."
          value={state.asset}
          onChange={set('asset')}
        />
        <UrlTemplateField
          data-testid="ck-gallery-template"
          label="Feed URL"
          placeholders={[{ token: 'slug', description: 'The content item’s slug' }]}
          sample={{ slug: 'hello-world' }}
          value={state.template}
          onChange={set('template')}
        />
      </Section>

      <Section title="Appearance">
        <ColorField data-testid="ck-gallery-color" label="Accent" value={state.color} onChange={set('color')} />
        <SchemeColorField
          data-testid="ck-gallery-scheme-color"
          label="Background"
          value={state.scheme}
          onChange={set('scheme')}
        />
        <FontFamilyField data-testid="ck-gallery-font" label="Font family" value={state.font} onChange={set('font')} />
      </Section>

      <Section title="Sets">
        <LocaleField
          data-testid="ck-gallery-locale"
          label="Locale"
          locales={['de', 'en']}
          value={state.locale}
          onChange={set('locale')}
        />
        <TagListField data-testid="ck-gallery-tags" label="Tags" max={8} value={state.tags} onChange={set('tags')} />
        <EnumMultiSelect
          data-testid="ck-gallery-events"
          label="Events"
          options={choices(WEBHOOK_EVENT_TYPES)}
          allEmptyMeans={{ allLabel: 'Every event', someLabel: 'Only the events I choose' }}
          value={state.events}
          onChange={set('events')}
        />
        <EntityMultiSelect
          data-testid="ck-gallery-groups"
          label="Access groups"
          options={[
            { value: 'members', label: 'Members' },
            { value: 'staff', label: 'Staff' },
          ]}
          value={state.groups}
          onChange={set('groups')}
        />
        <ScopePicker
          data-testid="ck-gallery-scopes"
          label="Scopes"
          ceiling={session.product_scopes}
          value={state.scopes}
          onChange={set('scopes')}
        />
      </Section>

      <Section title="Structures">
        <ObjectListField
          data-testid="ck-gallery-versions"
          label="Documentation versions"
          uniqueBy={(version) => version.id}
          exclusiveFlag={{ key: 'current', label: 'Current' }}
          create={() => ({ id: '', label: '', current: false })}
          itemLabel={(version) => version.label || 'Untitled'}
          value={state.versions}
          onChange={set('versions')}
          renderItem={(version, api) => (
            <div className="grid gap-2 sm:grid-cols-2">
              <TextField
                data-testid={`ck-gallery-version-id-${api.index}`}
                label="Id"
                value={version.id}
                onChange={(id) => api.update({ id })}
              />
              <TextField
                data-testid={`ck-gallery-version-label-${api.index}`}
                label="Label"
                value={version.label}
                onChange={(label) => api.update({ label })}
              />
            </div>
          )}
        />
        <OptionalSubtree
          data-testid="ck-gallery-reports"
          label="Reports"
          description="Absent unless this site publishes a report series."
          create={() => ({ title: 'Weekly report' })}
          value={state.reports}
          onChange={set('reports')}
        >
          {(reports) => (
            <TextField
              data-testid="ck-gallery-reports-title"
              label="Title"
              value={reports.title}
              onChange={(title) => set('reports')({ ...reports, title })}
            />
          )}
        </OptionalSubtree>
        <KeyValueField data-testid="ck-gallery-map" label="Metadata" value={state.map} onChange={set('map')} />
        <TokenMapField
          data-testid="ck-gallery-tokens"
          label="Theme tokens"
          tokens={THEME_TOKENS.map((token) => ({ key: token, label: token.replaceAll('_', ' ') }))}
          value={state.tokens}
          onChange={set('tokens')}
          renderValue={(token, entry, setValue) => (
            <ColorField
              data-testid={`ck-gallery-token-${token.key}`}
              label={token.label}
              value={typeof entry === 'string' ? entry : ''}
              onChange={setValue}
            />
          )}
        />
        <ExtraFieldsField
          data-testid="ck-gallery-extra"
          label="Extra fields"
          maxBytes={4096}
          value={state.extra}
          onChange={set('extra')}
        />
        <CarriedKeys
          data-testid="ck-gallery-carried"
          value={state.carried}
          onRemove={(key) => {
            const { [key]: _removed, ...rest } = state.carried
            set('carried')(rest)
          }}
        />
      </Section>

      <Section title="Secrets">
        <SecretField
          data-testid="ck-gallery-secret"
          label="Webhook secret"
          generate={() => crypto.randomUUID().replaceAll('-', '')}
          value={state.secret}
          onChange={set('secret')}
        />
        <RevealOnce
          data-testid="ck-gallery-reveal"
          title="Your new API key"
          description="This is the only time it is readable."
          value="ck_live_example_key_shown_once"
          onDismiss={() => undefined}
        />
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  )
}
