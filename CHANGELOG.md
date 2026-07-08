# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-07-08

### Added

- Site-level `settings.comments.enabled=false` support to suppress public post
  comment forms while keeping approved comments visible.

### Changed

- Locale search pages are now emitted with `noindex,nofollow` and are omitted
  from the sitemap.
- Search indexes now exclude `noindex` content and only include title, summary
  and tags by default. Full body indexing is opt-in via
  `settings.search.index_body=true`.

### Fixed

- Public comment submissions now return `404` when comments are disabled for a
  site, so stale cached forms cannot continue to submit. Contact forms are
  unaffected.

## [1.1.0] - 2026-07-08

### Added

- Cookie consent for GA4 (`assets/consent.js`): when a site configures the
  `ga4` analytics provider, the Google tag loader is now withheld until the
  visitor gives explicit opt-in consent (§ 25 TDDDG / Art. 6 Abs. 1 lit. a
  DSGVO). The banner is localized (de/en), offers an equally prominent
  "reject all" alongside "accept all", wires up Google Consent Mode, and adds a
  footer "Cookie settings" control so consent can be withdrawn at any time.

### Changed

- The `ga4` provider no longer emits the `gtag/js` loader directly in the head
  or a per-site `assets/analytics.js` init file. The head instead references the
  content-hashed `consent.js`, passing the measurement id via `data-ga-id`, and
  no request reaches Google before consent. Plausible (cookieless) is unchanged
  and still needs no banner.

## [1.0.1] - 2026-07-04

### Changed

- Dependency updates: `@shikijs/rehype` 4.x, `katex` 0.17, and current major
  versions of all GitHub Actions used by CI and the release pipeline.

### Fixed

- A timing race in the build-serialization integration test that could hang
  the suite on slow CI runners.

## [1.0.0] - 2026-07-04

First public release. Contentkit is an API-first Markdown mini-CMS that turns
Markdown revisions into immutable, multilingual static-site releases with
atomic activation and pointer-based rollback.

### Added

- Community files for open source: contributing guide, code of conduct,
  security policy, issue and pull request templates.
- ESLint and Prettier configuration with CI enforcement.
- Unit tests for the site builder, release manager and OpenAPI spec
  (including router/spec consistency checks).

### Changed

- The built-in webhook endpoint is now configured through
  `CONTENTKIT_WEBHOOK_URL` / `CONTENTKIT_WEBHOOK_SECRET` (previously
  `CONTENTKIT_SUBKIT_WEBHOOK_URL` / `CONTENTKIT_SUBKIT_WEBHOOK_SECRET`).
  Deployments must rename these variables.
- The HTTP layer was split into focused modules (`routes`, `security`,
  `server`) without behavior changes.
- The webhook documentation was rewritten around the Standard Webhooks
  specification with a generic receiver example.

### Fixed

- A hex `accent` site setting is converted to an HSL triple before it reaches
  the `--primary` CSS variable; previously a raw hex value silently disabled
  the accent color (e.g. an invisible submit button).
- Tag links on content cards now use the same slug as the generated tag pages;
  multi-word tags previously linked to a non-existent URL.

[1.1.1]: https://github.com/MikeBild/contentkit/releases/tag/v1.1.1
[1.1.0]: https://github.com/MikeBild/contentkit/releases/tag/v1.1.0
[1.0.1]: https://github.com/MikeBild/contentkit/releases/tag/v1.0.1
[1.0.0]: https://github.com/MikeBild/contentkit/releases/tag/v1.0.0
