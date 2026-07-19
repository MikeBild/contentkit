---
title: FAQ List
locale: en
slug: faq-list
summary: A complete vertical question-and-answer sequence with optional HTML disclosure.
layout: composition
composition: { format: infographic, canvas: portrait, intent: explain, preferredPattern: faq-list }
---
::::faq{title="Frequently asked questions" role="primary"}
:::question{title="Can ContentKit be used without a browser?" category="Operations"}
Yes. The Semantic AST, recommendations, validation, and all static outputs are available through the headless API.
:::
:::question{title="Does SVG remain standalone?" category="Output"}
Yes. Font, geometry, colors, and accessible text equivalents are fully embedded.
:::
:::question{title="What happens on small displays?" category="Layout"}
The pattern resolves to a readable stacked structure based on container width.
:::
:::question{title="Who decides on fallbacks?" category="Layout"}
ContentKit validates declarative rules deterministically. An agent may express preferences but cannot inject geometry.
:::
::::
