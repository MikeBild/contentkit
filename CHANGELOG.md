# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/MikeBild/contentkit/releases/tag/v1.0.0
