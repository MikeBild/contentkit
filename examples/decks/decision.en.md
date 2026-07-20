---
kind: deck
layout: deck
title: Verified product decision
locale: en
slug: verified-product-decision
summary: A production-shaped semantic deck with evidence and a clear action.
question: Which product path should we ship next?
goal: Turn verified source evidence into an actionable decision.
thesis: Ship the measured path and preserve the rollback boundary.
conclusion: The measured path has the strongest evidence and lowest operational risk.
action: Release to the canary audience, verify telemetry, then expand.
deck:
  theme: editorial
  visualScheme: auto
  maxSlides: 12
  firstSlide:
    layout: cover
---

# Which path should we ship?

Evidence, trade-offs and the production decision.

---

# Verified outcome

:::metric{label="Successful canary checks" value="18/18" trend="complete" role="primary"}
:::

---

# Release sequence

:::process{title="Safe production rollout" role="primary"}
- Build and verify
- Deploy canary
- Inspect telemetry
- Expand or roll back
:::

---

# Decision

Ship the measured path after the canary remains healthy.

---

# Sources

- [ContentKit release verification](https://github.com/MikeBild/contentkit)
- [Production readiness and telemetry](https://contentkit-api.example.com/ready)
