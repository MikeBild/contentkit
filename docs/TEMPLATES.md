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

- `layout`: `standard`, `docs`, `wiki`, `knowledge`, `landing`, `changelog`, or `report`.
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
- Landing, report and standard pages: `/{locale}/{slug}/`

Docs, wiki, and knowledge pages render a hierarchy sidebar, breadcrumbs, and a
heading table of contents. Landing pages can use the sanitized `hero`,
`features`, `steps`, and `cta` container directives. These directives add only
Contentkit-owned elements and classes; they cannot inject scripts or raw HTML.

Reports use explicit `layout: report` and the sanitized `report-grid`,
`report-card`, `metric`, `badge`, `progress` and `chart` directives. Charts take
one ordinary Markdown table and become content-hashed light/dark SVG assets at
release build time; the table remains as accessible source data and no chart
JavaScript ships to readers. See [REPORTS.md](REPORTS.md) for the complete
authoring and validation contract.

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

The smoke suite builds all of them together. The compiled-binary E2E suite
uploads and publishes the three documentation files and the quarterly report,
signs in as a real reader, and verifies public/protected delivery plus the
static report SVG contract.
