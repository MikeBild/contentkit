---
kind: page
layout: knowledge
title: How do I roll back a release?
locale: en
slug: rollback
translationKey: kb-rollback
docKey: rollback
category: Publishing
navOrder: 10
summary: Activate a known release without running another build.
faq:
  - q: Are newer revisions deleted?
    a: No. Revisions are immutable and remain stored.
---

# How do I roll back a release?

List the site releases and select one with status `active`, `ready`, or
`superseded`. Then activate that release ID.

```bash
curl -X POST "$CONTENTKIT_URL/v1/sites/$SITE/releases/$RELEASE/activate" \
  -H "Authorization: Bearer $CONTENTKIT_PUBLISH_API_KEY"
```

The pointer changes inside a database transaction. Contentkit copies no files
and renders no Markdown during rollback.
