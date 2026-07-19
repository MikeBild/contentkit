---
title: Code Walkthrough
locale: en
slug: code-walkthrough
summary: A readable vertical sequence for one or more complete code variants.
layout: composition
composition: { format: infographic, canvas: portrait, intent: sequence, preferredPattern: code-walkthrough }
---
::::code-example{title="Agent Workflow" role="primary"}
:::variant{label="Discover" language="bash" default="true"}
```bash
curl "$URL/v1/composition-patterns?nodeType=faq"
```
:::
:::variant{label="Recommend" language="bash"}
```bash
curl -X POST "$URL/v1/sites/$SITE/compositions/recommend" --data @semantic.json
```
:::
:::variant{label="Compile" language="bash"}
```bash
curl -X POST "$URL/v1/sites/$SITE/compositions/compile" --data @document.json
```
:::
::::
