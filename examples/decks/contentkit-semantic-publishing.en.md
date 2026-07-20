---
kind: deck
layout: deck
title: ContentKit — one source, one meaning, every surface
locale: en
slug: contentkit-semantic-publishing
summary: How ContentKit turns a reader question, verified evidence and a shared design system into coherent websites, reports, slide decks and machine-readable documentation.
audience: Software architects, editorial teams and product teams publishing the same source through multiple formats.
question: How does verified source material become one coherent story whose meaning survives every output format?
goal: Explain the path from reader question and evidence through semantics and visual design to a verified production release.
thesis: ContentKit fixes meaning before presentation, then selects a truthful visual form and renders every surface through the site's design system.
conclusion: A shared content contract replaces disconnected copies and keeps meaning, design and release state consistent across websites, reports, decks and machine-readable documentation.
action: Begin with one reader question, model the evidence once and verify every output in a real browser before activation.
limitations:
  - A visual form cannot compensate for missing or unverified evidence.
deck:
  template: technical-explainer
  theme: editorial
  visualScheme: auto
  maxSlides: 16
  firstSlide:
    layout: cover
---

# One source. One meaning. Every surface.

ContentKit turns verified evidence into a website, report, slide deck and machine-readable record without reinventing the story for each output.

---
deckRole: problem
---

# Four copies create four competing truths

::::comparison{title="Disconnected copies or one content contract" role="primary" preferredPattern="before-after"}
:::side{label="Copy and paste"}
- Website · words and design drift independently
- Report · metrics lose their period and source
- Slide deck · the argument is rebuilt for every presentation
:::
:::side{label="ContentKit"}
- One source · claims, terms and limits stay connected
- One narrative · question, evidence and conclusion keep their order
- Multiple renderers · only the representation changes
:::
::::

---
deckRole: premise
---

# The reader's question is the first design decision

:::process{title="The editorial contract" role="primary" preferredPattern="chevron-process"}
- Frame the question · what must the reader understand?
- Verify the evidence · which claims actually support the answer?
- Bound the conclusion · what do the facts permit—and what do they not?
- Name the action · what should happen next?
:::

---
deckRole: architecture
---

# Meaning stays at the center

:::relationship{title="One semantic core, multiple controlled outputs" role="primary" preferredPattern="architecture-map"}
- ContentKit · preserves semantics, narrative and source lineage
- Reader question and goal · determine sequence and information density
- Website and article · remain readable, responsive and indexable
- Verified evidence · supplies claims, measurements and limitations
- Report, deck and machine documentation · use the same content state
:::

---
deckRole: semantics
---

# Visual form must tell the truth

::::comparison{title="Visual semantics is an accuracy requirement" role="primary" preferredPattern="split-comparison"}
:::side{label="Use the form the evidence supports"}
- Sequence · a process or timeline
- Equal measures · a common quantitative scale
- One core with peers · a hub-and-spoke relationship
:::
:::side{label="Reject false implications"}
- No funnel · unless something is reduced
- No matrix · without two real dimensions
- No dashboard · merely because cards are available
:::
::::

---
deckRole: journey
---

# The reader follows one deliberate line of thought

:::timeline{title="From an open question to a defensible action" role="primary" preferredPattern="horizontal-timeline"}
- Question · sets expectation and boundary
- Evidence · exposes verifiable facts
- Interpretation · explains relationship and meaning
- Conclusion · answers exactly that question
- Action · makes the next step concrete
:::

---
deckRole: design-system
---

# One typed design system controls every renderer

:::relationship{title="A machine-readable visual contract" role="primary" preferredPattern="architecture-map"}
- Site design tokens · define color, typography, spacing and safe areas
- Site identity · supplies the tenant-specific brand reference
- Deck template · supplies hierarchy, rhythm and narrative slots
- Accessibility rules · bound contrast, density and geometry
- SVG and PNG · remain geometrically equivalent and work offline
:::

---
deckRole: verification
---

# Publication begins with browser evidence

:::process{title="The visual release gate" role="primary" preferredPattern="connected-process"}
- Validate semantics · the form must match the claim
- Render SVG and PNG · both schemes keep the same geometry
- Inspect browsers · measure clipping, overlap, contrast and navigation
- Activate the release · only a passing artifact becomes public
:::

---
deckRole: operations
---

# Every published state remains accountable

:::process{title="From source to a stable public URL" role="primary" preferredPattern="connected-process"}
- Source hash · identifies Markdown and evidence
- Plan hash · fixes template, information architecture and narrative
- Artifact hash · fixes SVG, PNG and deck HTML
- Release pointer · activates or rolls back atomically
:::

---
deckRole: outcome
---

# One statement, four appropriate surfaces

::::comparison{title="The outcome for readers and operators" role="primary" preferredPattern="before-after"}
:::side{label="For readers"}
- One visible guiding question
- Evidence before conclusion
- A visual form that does not distort the claim
:::
:::side{label="For operators"}
- One stable public URL
- Reproducible artifacts without external runtime calls
- Telemetry, release evidence and atomic rollback
:::
::::

---
deckRole: conclusion
---

# Meaning stays fixed. Only the surface changes.

A website, report, slide deck and machine-readable record are not four separate stories. They are four verified views of the same content contract.

---
deckRole: sources
---

# Sources and contracts

- [ContentKit](https://github.com/MikeBild/contentkit)
- [Semantic slide decks](https://github.com/MikeBild/contentkit/blob/main/docs/SLIDE_DECKS.md)
- [Visual compositions](https://github.com/MikeBild/contentkit/blob/main/docs/VISUAL_COMPOSITIONS.md)
- [Product analytics](https://github.com/MikeBild/contentkit/blob/main/docs/PRODUCT_ANALYTICS.md)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Design Tokens Format 2025.10](https://www.designtokens.org/TR/2025.10/format/)
