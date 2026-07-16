---
kind: page
layout: docs
title: Install Atlas
locale: en
slug: installation
translationKey: atlas-installation-v2
docKey: installation
docsVersion: v2
parent: getting-started
navTitle: Installation
navOrder: 20
summary: Local installation, configuration, and the first health check.
---

# Install Atlas

Install the CLI, then verify that the database and object storage are reachable.

## Configuration

```bash
export ATLAS_DATABASE_URL="postgresql://atlas:secret@127.0.0.1:5432/atlas"
export ATLAS_STORAGE_BUCKET="atlas-content"
```

Do not commit production secrets. Use the secret store provided by the runtime,
and keep administration credentials separate from publishing credentials.

## Check the service

```bash
atlas --version
curl --fail http://127.0.0.1:4050/health
curl --fail http://127.0.0.1:4050/ready
```

`/health` confirms that the process is running. `/ready` succeeds only after
migrations and storage initialization have completed.

:::warning
A failed build must never move the active release pointer. Investigate the
failure and publish another complete preview.
:::
