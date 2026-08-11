import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useSession } from '@/lib/session'
import { useI18n } from '@/lib/i18n-context'
import { CONTENT_KIND, PRESENTATION_PRESET, THEME_TOKENS, WEBHOOK_EVENT_TYPES } from './contracts/enums.generated'
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
  const { t } = useI18n()
  const session = useSession()
  const [state, setState] = useState({
    text: 'ContentKit',
    slug: '',
    username: 'mike',
    body: '.example { color: var(--accent); }',
    kind: 'post' as (typeof CONTENT_KIND)[number] | '',
    preset: 'portfolio' as (typeof PRESENTATION_PRESET)[number],
    density: 'balanced' as 'compact' | 'balanced' | 'spacious',
    tri: undefined as boolean | undefined,
    toggle: true,
    number: 30 as number | undefined,
    dimension: '0.75rem',
    when: undefined as string | undefined,
    url: 'https://example.com',
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
    versions: [{ id: 'v2', label: t('gallery.versionSample'), current: true }] as DocVersion[],
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
      <Section title={t('gallery.section.text')}>
        <TextField data-testid="ck-gallery-text" label={t('gallery.title')} maxLength={60} value={state.text} onChange={set('text')} />
        <SlugField
          data-testid="ck-gallery-slug"
          label={t('gallery.slug')}
          help={t('gallery.slugHelp')}
          derivedFrom={state.text}
          siblings={['contentkit']}
          value={state.slug}
          onChange={set('slug')}
        />
        <UsernameField data-testid="ck-gallery-username" label={t('gallery.username')} value={state.username} onChange={set('username')} />
        <TextAreaField
          data-testid="ck-gallery-textarea"
          label={t('gallery.customCss')}
          maxBytes={8192}
          forbid={/<\/style/i}
          forbidMessage={t('gallery.styleForbidden')}
          monospace
          value={state.body}
          onChange={set('body')}
        />
        <PathField data-testid="ck-gallery-path" label={t('gallery.path')} value={state.path} onChange={set('path')} />
      </Section>

      <Section title={t('gallery.section.choice')}>
        <EnumSelect
          data-testid="ck-gallery-enum"
          label={t('gallery.kind')}
          allowEmpty
          options={choices(CONTENT_KIND)}
          value={state.kind}
          onChange={set('kind')}
        />
        <SegmentedField
          data-testid="ck-gallery-segmented"
          label={t('gallery.density')}
          options={choices(['compact', 'balanced', 'spacious'] as const)}
          value={state.density}
          onChange={set('density')}
        />
        <ChoiceCards
          data-testid="ck-gallery-cards"
          label={t('gallery.presentationPreset')}
          options={PRESENTATION_PRESET.map((preset) => ({
            value: preset,
            label: preset,
            description: t('gallery.presetDescription', { preset: preset.replace('-', ' ') }),
          }))}
          value={state.preset}
          onChange={set('preset')}
        />
        <TriToggle
          data-testid="ck-gallery-tri"
          label={t('gallery.showExtra')}
          defaultLabel={t('gallery.presetDefault')}
          value={state.tri}
          onChange={set('tri')}
        />
        <SwitchField data-testid="ck-gallery-switch" label={t('gallery.feedbackWidget')} value={state.toggle} onChange={set('toggle')} />
      </Section>

      <Section title={t('gallery.section.numbers')}>
        <NumberField
          data-testid="ck-gallery-number"
          label={t('gallery.retention')}
          unit={t('gallery.days')}
          min={1}
          integer
          allowUnset
          value={state.number}
          onChange={set('number')}
        />
        <DimensionField data-testid="ck-gallery-dimension" label={t('gallery.radius')} value={state.dimension} onChange={set('dimension')} />
        <DateTimeField data-testid="ck-gallery-datetime" label={t('gallery.expires')} value={state.when} onChange={set('when')} />
      </Section>

      <Section title={t('gallery.section.addresses')}>
        <UrlField data-testid="ck-gallery-url" label={t('gallery.baseUrl')} value={state.url} onChange={set('url')} />
        <UrlField
          data-testid="ck-gallery-asset"
          label={t('gallery.logo')}
          mode="asset"
          base={state.url}
          fallback={t('gallery.logoFallback')}
          value={state.asset}
          onChange={set('asset')}
        />
        <UrlTemplateField
          data-testid="ck-gallery-template"
          label={t('gallery.feedUrl')}
          placeholders={[{ token: 'slug', description: t('gallery.slugPlaceholder') }]}
          sample={{ slug: 'hello-world' }}
          value={state.template}
          onChange={set('template')}
        />
      </Section>

      <Section title={t('gallery.section.appearance')}>
        <ColorField data-testid="ck-gallery-color" label={t('gallery.accent')} value={state.color} onChange={set('color')} />
        <SchemeColorField
          data-testid="ck-gallery-scheme-color"
          label={t('gallery.background')}
          value={state.scheme}
          onChange={set('scheme')}
        />
        <FontFamilyField data-testid="ck-gallery-font" label={t('gallery.fontFamily')} value={state.font} onChange={set('font')} />
      </Section>

      <Section title={t('gallery.section.sets')}>
        <LocaleField
          data-testid="ck-gallery-locale"
          label={t('gallery.locale')}
          locales={['de', 'en']}
          value={state.locale}
          onChange={set('locale')}
        />
        <TagListField data-testid="ck-gallery-tags" label={t('gallery.tags')} max={8} value={state.tags} onChange={set('tags')} />
        <EnumMultiSelect
          data-testid="ck-gallery-events"
          label={t('gallery.events')}
          options={choices(WEBHOOK_EVENT_TYPES)}
          allEmptyMeans={{ allLabel: t('gallery.everyEvent'), someLabel: t('gallery.selectedEvents') }}
          value={state.events}
          onChange={set('events')}
        />
        <EntityMultiSelect
          data-testid="ck-gallery-groups"
          label={t('gallery.accessGroups')}
          options={[
            { value: 'members', label: t('gallery.members') },
            { value: 'staff', label: t('gallery.staff') },
          ]}
          value={state.groups}
          onChange={set('groups')}
        />
        <ScopePicker
          data-testid="ck-gallery-scopes"
          label={t('gallery.scopes')}
          ceiling={session.product_scopes}
          value={state.scopes}
          onChange={set('scopes')}
        />
      </Section>

      <Section title={t('gallery.section.structures')}>
        <ObjectListField
          data-testid="ck-gallery-versions"
          label={t('gallery.documentationVersions')}
          uniqueBy={(version) => version.id}
          exclusiveFlag={{ key: 'current', label: t('gallery.current') }}
          create={() => ({ id: '', label: '', current: false })}
          itemLabel={(version) => version.label || t('gallery.untitled')}
          value={state.versions}
          onChange={set('versions')}
          renderItem={(version, api) => (
            <div className="grid gap-2 sm:grid-cols-2">
              <TextField
                data-testid={`ck-gallery-version-id-${api.index}`}
                label={t('gallery.id')}
                value={version.id}
                onChange={(id) => api.update({ id })}
              />
              <TextField
                data-testid={`ck-gallery-version-label-${api.index}`}
                label={t('gallery.label')}
                value={version.label}
                onChange={(label) => api.update({ label })}
              />
            </div>
          )}
        />
        <OptionalSubtree
          data-testid="ck-gallery-reports"
          label={t('gallery.reports')}
          description={t('gallery.reportsDescription')}
          create={() => ({ title: t('gallery.weeklyReport') })}
          value={state.reports}
          onChange={set('reports')}
        >
          {(reports) => (
            <TextField
              data-testid="ck-gallery-reports-title"
              label={t('gallery.title')}
              value={reports.title}
              onChange={(title) => set('reports')({ ...reports, title })}
            />
          )}
        </OptionalSubtree>
        <KeyValueField data-testid="ck-gallery-map" label={t('gallery.metadata')} value={state.map} onChange={set('map')} />
        <TokenMapField
          data-testid="ck-gallery-tokens"
          label={t('gallery.themeTokens')}
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
          label={t('gallery.extraFields')}
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

      <Section title={t('gallery.section.secrets')}>
        <SecretField
          data-testid="ck-gallery-secret"
          label={t('gallery.webhookSecret')}
          generate={() => crypto.randomUUID().replaceAll('-', '')}
          value={state.secret}
          onChange={set('secret')}
        />
        <RevealOnce
          data-testid="ck-gallery-reveal"
          title={t('gallery.newApiKey')}
          description={t('gallery.secretOnce')}
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
