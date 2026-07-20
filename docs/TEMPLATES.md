# Presets and page layouts

Contentkit keeps templates controlled and executable-code-free. A site preset
selects the default information architecture; an individual Markdown document
can select one of the built-in layouts. All variants use the same sanitized
Markdown renderer, design tokens, CSP, locales, previews, and atomic releases.

## Site presets

Set `settings.presentation.preset` when creating or updating a site:

| Preset | Intended use | Default page layout |
|---|---|---|
| `portfolio` | Personal site, projects, and blog | `standard` |
| `product-docs` | Versioned product or API documentation | `docs` |
| `wiki` | Hierarchical shared knowledge | `wiki` |
| `knowledge-base` | Support and help center | `knowledge` |
| `product` | Product marketing pages | `landing` |
| `changelog` | Product release notes | `changelog` |

Existing sites without `settings.presentation` continue to use `portfolio`.

Product documentation declares 1–32 supported versions and exactly one current
version. IDs use the same lowercase slug syntax as `docsVersion`, and labels are
limited to 120 characters:

```json
{
  "presentation": {
    "preset": "product-docs",
    "docs": {
      "versions": [
        { "id": "v2", "label": "2.x", "status": "current" },
        { "id": "v1", "label": "1.x", "status": "archived" }
      ]
    }
  }
}
```

Archived version pages remain available but use `noindex,follow` and stay out of
the sitemap. A page can opt out of its preset with `layout: standard`.

## Frontmatter

The following fields are validated on upload:

- `layout`: `standard`, `docs`, `wiki`, `knowledge`, `landing`, `changelog`, or
  `composition`; deck documents use the dedicated `deck` layout. `report` is a
  compatibility alias for a report composition.
- `composition`: visual contract with `format`, `canvas`, `intent`, `density` and optional `preferredPattern`.
- `deck.template`: narrative contract for a deck: `freeform`, `editorial-story`,
  `decision-brief`, `technical-explainer` or `status-report`. Non-freeform
  templates validate ordered per-slide `deckRole` slots before rendering.
- `reportCadence`: optional when `composition.format` is `report`: `hourly`, `daily`, `weekly`,
  `monthly`, `quarterly`, or `yearly`.
- `docKey`: stable page identity within a documentation version or hierarchy.
- `docsVersion`: an ID declared in `settings.presentation.docs.versions`.
- `parent`: the parent page's `docKey` in the same locale, layout, and version.
- `navTitle`: optional short label for sidebars.
- `navOrder`: numeric navigation weight.
- `category`: knowledge-base or changelog category.
- `releaseVersion`: visible changelog release label.
- `changeTypes`: any of `added`, `changed`, `deprecated`, `removed`, `fixed`, `security`.
- `access`: reader-group slugs allowed to open this document.

Relational errors—missing parents, cycles, duplicate `docKey` values, duplicate
generated URLs, unknown versions, and unknown access groups—fail the preview or
release before activation.

## Routes

- Docs: `/{locale}/docs/{version}/{hierarchy}/`
- Wiki: `/{locale}/wiki/{hierarchy}/`
- Knowledge base: `/{locale}/help/{hierarchy}/`
- Changelog: `/{locale}/changelog/{slug}/`
- Landing, composition and standard pages: `/{locale}/{slug}/`
- Semantic slide decks (`deck`): `/{locale}/slides/{slug}/`

Docs, wiki, and knowledge pages render a hierarchy sidebar, breadcrumbs, and a
heading table of contents. Landing pages can use the sanitized `hero`,
`features`, `steps`, and `cta` container directives. These directives add only
Contentkit-owned elements and classes; they cannot inject scripts or raw HTML.

Visual publications use explicit `layout: composition` and semantic `hero`,
`metric`, `process`, `comparison`, `timeline`, `hierarchy`, `relationship`,
`chart`, `progress`, `badge`, `card` and `group` directives. Contentkit resolves
these through its declarative Pattern Registry and emits responsive HTML plus
standalone light/dark SVG and PNG. See
[VISUAL_COMPOSITIONS.md](VISUAL_COMPOSITIONS.md) for all 81 patterns and the
AI-agent contract; [REPORTS.md](REPORTS.md) covers report-specific authoring.

When the `product` preset contains `composition.format: report` pages, its home page becomes a report
narrative automatically. `reportCadence` selects the newest report for each
period. The newest closed interval becomes the primary current-state card and
uses its authored question, conclusion and action; the other cadences form the
remaining decision horizons, and at most six superseded reports form the recent
history. Up to four primary semantic metrics from the lead report are rendered
inside the current-state card, so publishers do not have to maintain separate
home-page values. Reports without the optional field remain compatible and appear as
“Other report”. The home uses only pages visible under its exact reader grant,
so private titles cannot cross access boundaries. No separate home-page model is
required from the workflow that publishes the report Markdown.

## Complete examples

The repository includes production-shaped examples rather than placeholder
fixtures:

- `examples/docs/getting-started.en.md`
- `examples/docs/installation.en.md`
- `examples/docs/customer-runbook.en.md`
- `examples/wiki/release-process.en.md`
- `examples/knowledge/rollback.en.md`
- `examples/landing/product.en.md`
- `examples/changelog/2-0-0.en.md`
- `examples/reports/quarterly.en.md`

The generated review corpus also contains all 81 patterns under
`examples/compositions/` and `examples/pattern-gallery/`. The smoke suite builds the
production-shaped documents together. The compiled-binary E2E suite
uploads and publishes the three documentation files and the quarterly report,
signs in as a real reader, and verifies public/protected delivery plus the
static report SVG contract.

## Slide-deck templates

Deck templates are first-class content templates, not visual themes. Each
template publishes machine-readable narrative slots, required roles, defaults
and visual acceptance rules through `GET /v1/deck-templates`. A theme determines
how a deck looks, semantic composition patterns determine how one slide's
evidence is represented, and the template determines how the complete argument
progresses.

This separation keeps templates tenant-neutral. A site supplies its own typed
design tokens for branding; ContentKit does not embed a customer's identity in
product defaults. See [SLIDE_DECKS.md](SLIDE_DECKS.md) for the authoring and
verification contract.
