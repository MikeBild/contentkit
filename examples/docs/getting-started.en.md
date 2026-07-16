---
kind: page
layout: docs
title: Getting started with Atlas
locale: en
slug: getting-started
translationKey: atlas-getting-started-v2
docKey: getting-started
docsVersion: v2
navTitle: Getting started
navOrder: 10
summary: Install Atlas, configure it, and publish the first workspace.
---

# Getting started with Atlas

Atlas packages Markdown documents, images, and configuration into reproducible
workspaces. This guide takes a new project from an empty directory to its first
published documentation release.

## Requirements

- Node.js 20 or newer
- Docker Desktop or a PostgreSQL 16 instance
- Git for version control

## Create the project

```bash
mkdir atlas-handbook
cd atlas-handbook
npm init -y
```

Create `docs/` for content and `assets/` for images. Atlas leaves source files
unchanged and writes every generated site to a new immutable release.

:::tip
Publish a preview first. The public website changes only after a complete build
has succeeded.
:::

## Next step

Continue with [Installation](/en/docs/v2/getting-started/installation/).
