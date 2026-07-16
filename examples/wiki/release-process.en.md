---
kind: page
layout: wiki
title: Release process
locale: en
slug: release-process
translationKey: wiki-release-process
docKey: release-process
navOrder: 10
summary: Shared knowledge about preparing, approving, and rolling back a release.
---

# Release process

A release is an immutable snapshot. Changes are built as a preview, reviewed,
and activated atomically only after approval.

## Checklist

- Tests and documentation drift checks pass.
- The preview contains every intended revision.
- Sitemap, feeds, and search contain no drafts.
- At least one previous release remains available for rollback.

## After activation

Check the home page, a content page, one static asset, and readiness. If anything
is wrong, activate the previous pointer without rendering the content again.
