---
title: File Code
locale: en
slug: file-code
summary: An authored file index and a code surface communicate a small implementation structure.
layout: composition
composition: { format: infographic, canvas: landscape, intent: explain, preferredPattern: file-code }
---
::::code-example{title="Headless Client" role="primary"}
:::variant{label="Configuration" language="javascript" file="config.mjs" default="true"}
```javascript
export const endpoint = process.env.CONTENTKIT_URL
export const site = process.env.CONTENTKIT_SITE
```
:::
:::variant{label="Compile" language="javascript" file="compile.mjs"}
```javascript
export async function compile(input) {
  return fetch(`${endpoint}/v1/sites/${site}/compositions/compile`, {
    method: "POST",
    body: JSON.stringify(input)
  })
}
```
:::
::::
