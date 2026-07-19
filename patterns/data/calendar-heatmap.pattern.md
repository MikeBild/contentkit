---
schemaVersion: 1
id: calendar-heatmap
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], dataShapes: [calendar], minItems: 7, preferredMaxItems: 62, maxItems: 200 }
semantics: { conveys: [temporal-activity, seasonality], implies: [daily-granularity] }
narrative: { question: "On which days does activity concentrate, repeat, or disappear?", goal: "Expose daily rhythm, seasonality, streaks, and gaps across calendar time.", arc: [establish-calendar-window, encode-daily-intensity, reveal-streaks-and-gaps, identify-recurring-rhythm], takeaway: "The reader can identify when activity is consistently high, low, or missing.", decisionSupport: "Use for daily observations across weeks or months; reject irregular events or values without a real date." }
selection: { intents: [explore, status], canvases: [portrait, landscape, square, flow], densities: [compact, balanced] }
fallbacks: [data-heatmap]
layout: { primitive: matrix, content: calendar-cells }
accessibility: { readingOrder: chronological, textEquivalent: table }
---
# Calendar Heatmap

Daily values arranged by week and weekday expose activity rhythm and gaps.
