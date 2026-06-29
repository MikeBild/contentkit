---
kind: post
title: Ein erster Beitrag
locale: de
slug: erster-beitrag
translationKey: first-post
summary: Ein vollständiges Beispiel für Contentkit-Markdown.
date: 2026-06-29T10:00:00+02:00
tags: [Contentkit, Markdown]
---

# Ein erster Beitrag

Contentkit unterstützt **GitHub Flavored Markdown**, Fußnoten[^1], Mathematik
$E=mc^2$ und hervorgehobenen Quellcode.

| Bereich | Status |
| --- | --- |
| Markdown | fertig |
| Releases | atomar |

```js
console.log('Markdown in, HTML out')
```

:::tip
Direktiven werden als sichere Callouts ausgegeben.
:::

```mermaid
flowchart LR
  Markdown --> Contentkit --> Supabase Storage
```

[^1]: Fußnoten sind Teil des Rich-Markdown-Profils.
