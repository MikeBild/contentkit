---
title: Tabbed Code
locale: en
slug: tabbed-code
summary: Equivalent implementations share one frame while static output lists every variant.
layout: composition
composition: { format: infographic, canvas: landscape, intent: explain, preferredPattern: tabbed-code }
---
::::code-example{title="Compile a composition" role="primary"}
:::variant{label="curl" language="bash" file="compile.sh" default="true"}
```bash
curl -X POST "$CONTENTKIT_URL/v1/sites/$SITE/compositions/compile" \
  -H "authorization: Bearer $CONTENTKIT_KEY" \
  -H "content-type: application/json" \
  --data @request.json
```
:::
:::variant{label="JavaScript" language="javascript" file="compile.mjs"}
```javascript
const response = await fetch(url, {
  method: "POST",
  headers: { authorization: `Bearer ${key}` },
  body: JSON.stringify(input)
})
```
:::
::::
