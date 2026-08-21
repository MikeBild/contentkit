# Cockpit Convention

Version 1.6 · 2026-08-21 · Applies to ContentKit, SubKit, WorkKit, WikiKit, CodeKit and WatchKit

**This is a shortened English translation for operators, not the standard.** Where the two differ, the German source wins. That source is [`COCKPIT-KONVENTION.md`](../COCKPIT-KONVENTION.md) in the repository root — version 1.6, SHA-256 `8f94e9cb4233382faf4b4962ea9d6ee6eee764993d8c09370cac1160768f3f31`. This copy is tenant-neutral and drops detail the source carries; read it to get oriented, and settle any question against the source. The convention is copied, not shared as code: every product owns its components and releases. A product may document a justified deviation, but these rules are the default.

## 0. What the cockpit is for

**Decision of 2026-08-21 — this section applies before all others.**

The cockpit shows the **present**: users and workflows, overview, reports, current data, and **the decisions that are waiting to be made**.

**The past belongs in the audit trail.** Every product has its own area in the cockpit for it, and the past is retrievable there in full — which is exactly why it must not be reused anywhere else.

The distinction that settles a doubtful case:

- A **property of a current thing** stays where that thing is. “Last used” on a key row describes the key, not the history.
- A **stream of past events** belongs in the audit trail. Not a second surface, not a counter tile, not a dimmed section below a list.

Before building a surface, answer this first: **does a human have to do something here, or see something current?** If not, it belongs in the audit trail, not in the cockpit.

## 1. Home-screen contract

The first screen has three zones in this order:

1. **Waiting for you.** One card contains every human gate, its count, the age of the oldest item and one action per row. It turns amber when non-empty. The Overview navigation entry repeats the deduplicated count. The card is the top slice of the Decisions queue and links to it; decisions happen on the Decisions page.
2. **Core-object hero.** ContentKit's product signature is the release chain.
3. **The way to the past, not the past itself.** One line at the end: “What happened recently → **Audit trail**.” No event stream on the home screen, no list of recent runs. *(Decision of 2026-08-21.)*

Every count links to its source. Every red state provides a path to the cause. Operational HTTP, p95 and call metrics live under Installation → System, never on Overview.

## 2. State vocabulary

Use the same semantic roles with an icon or dot and a word—never colour alone: running (blue), waiting for you (amber), successful (green), failed (red), cancelled (neutral), and draft (neutral with a dashed border). Do not display “unknown”; show “not determinable since …” and the reason.

## 3. Run lists

Every run list shows a meaningful name, state, relative start time, duration and progress. Never shorten a UUID into a pretend name. Failed rows name their cause and repeated failures can be grouped by cause.

## 4. Three kinds of empty

Measured zero, not collected and never used are different states. A skeleton resolves to a result, empty state or error; it must not wait forever. A never-used state leads to a guided action such as a prepared Assistant prompt, not an empty form.

## 5. Language and naming

Use plain product language at the top level and technical terms in details. Destructive actions never occupy the red primary surface of a list row; they live in an overflow menu and require confirmation. Titles summarize and never expose raw prompts or UUIDs.

Every named object carries a one- or two-sentence summary, and collection lists show it under the title. The reading path is map → summary → full text. Full-text search is a fallback, not the first map of a domain.

## 6. Structural constants

The left sidebar contains a wordmark, grouped navigation and the account at the bottom. Installation contains at least System, Settings, Credentials, Notifications and Audit. Deep links work, and unknown routes provide a designed way back. The site switcher separates Production, Canary and Test, sorts sites within those groups, and lets the operator hide Test.

Shared group names are canonical: **Installation**, not Administration; **Decisions** is ungrouped directly below Overview; the role name is **Administrator**. Product-specific groups use normal, localized language. ContentKit groups Compositions and Presentations as **Tools**, separate from content collections.

The wordmark sits at the top of the sidebar: the product icon beside the product name in its canonical spelling — WorkKit, SubKit, WikiKit, ContentKit, CodeKit, WatchKit. That spelling is fixed. No capitalisation transform (neither `toUpperCase()` in code nor `text-transform` in a stylesheet), no lower-casing, no hard-coded text: the name comes from the translation catalogue (`app.name`), so it is spelled in exactly one place. Every product has an app icon and it appears twice — as the favicon in the browser tab and beside the wordmark. The anatomy is the same across the family, a glyph on the product colour, square with soft corners; the motif is product-specific. The browser title reads `<Product> Cockpit`. A console that does not name its product, or spells it differently from its siblings, is inconsistent at the place it is read first.

## 7. Drift control without shared code

This file is versioned in each product. Updating the family convention deliberately requires a change in every repository. Runtime conformance checks may verify a small number of rendered promises, but no shared UI package is introduced.

## 8. Decision grammar

Products with human gates have one Decisions page. It answers: What will happen? Does it need me? What do I do?

### 8.1 Navigation

Decisions sits directly below Overview with a live, deduplicated count. The count turns red when an item is overdue or represents a health problem.

### 8.2 Queue

Use one column, about 780 px wide. Sort expiring items first, then oldest first. Items older than three days appear under **Waiting longer**. Provide kind filters and persisted grouping when grouping materially helps comparison.

### 8.3 Row

Show state and kind, a linked source, deadline and origin when present, a human title, a one-line effect and a source line. Action labels name the action: Approve, Reject, Request changes—never OK. The decision happens in place. A successful decision hides the row and reports success; a failure restores it.

The overflow menu contains reminders, permanent dismissal with confirmation and Open source. Where the domain distinguishes them, show three kinds of no: reject with a reason returns work for revision; reject without a reason ends it; dismiss leaves the baseline untouched. An unanswered deadline is visibly expired, never silently approved. An identical rejected proposal recalls the earlier rejection instead of reopening automatically.

### 8.4 Expansion

More context uses a named control such as **Show more**, never an unlabeled chevron. The expanded area contains full reasoning, source data or a structured response form.

### 8.5 State and history are separate surfaces

The Decisions page shows only what is waiting for a human. Deferred, dismissed and decided items are past: finished work leaves the queue rather than being dimmed, struck through, parked in sections below it or brought back by state chips. A control that switches the queue to a past state breaks the convention; queue filters filter the **kind**, never the state. The full history lives in the append-only audit trail and is reachable from the Decisions page through **exactly one** link—a sentence, not a row of counters. Where the past arrives there as a machine value only, name it and make it filterable in the trail; do not move the sections back into the queue.

### 8.5a Counter tiles

Wanted for **open** work — when they break decisions down by **category** and thereby create an overview, rather than repeating a total. Every tile leads to the filtered list. For **finished** work there are none. *(2026-08-21.)*

### 8.5b The number itself is a design question

A Decisions page that puts hundreds of items in front of a human has failed at its job, however well it is structured. That is not a presentation problem but a scoping one: **what is alike is folded into one decision; what has no consequence is not a decision at all.**

### 8.6 Empty and incidents

An empty open queue says **All done** and that nothing currently needs a decision. A filter-only empty state names the filter and offers a reset. Overview shows a persistent red incident banner when a deadline or health gate is breached.

## 9. Diff approval

An automated proposal appears where it originated and also in Decisions. A diff card names the target and version, renders before and after, presents the preview or dry-run evidence beside it, and offers explicit decision actions. Both surfaces use the same decision API and audit trail. ContentKit renders Markdown changes and links to the safe preview; activation remains a separate, explicit browser review and is never triggered by the diff card.

## 10. Collection lists

Collections provide search, sortable headers and category chips above the list. **All** is the only fixed chip; every category comes from current data. Recategorization happens in the row's overflow area. A filtered empty state names the filter and offers **Show all**. Summaries are visible and are not repaired by truncation.

## 11. Connections and permission inventory

A connection shows authentication state as a word and badge, its environment and a visible Test connection action with an in-place result. An expired state explains how to renew it.

Connections also state what they can do—read, search, write, and so on—and expose a read/outbound/writes risk badge. Write access is never fine print. Every installation has a permission inventory for accumulated grants and keys, sorted by last use, with age, never-used marking and in-place revocation. Product text labels enforced permission checks as a **Boundary** and model instructions as a **Guardrail**.

## 12. Report grammar

Automated reports end with **What you need to decide**, using the same queue items and links. A report with no findings is evidence that a check ran: “0 findings · checked 2 minutes ago.” Report sequences reveal missing runs. Measured-none, never checked and no access remain distinct. Success claims link to evidence; Assistant answers link to their source objects.

## 13. Check before repair

Checking and repairing are separate actions in that order. Check reads and changes nothing. Repair begins only after the proposed change list is visible and only inside allowed boundaries. Deletion is always a proposal, never an automatic action; uncertainty leaves data untouched. Results name the version and single source of the rules used to check them.

## 14. Modes and boundaries

Every autonomy or approval mode shows its gate matrix: which gates remain and which are removed. A mode name alone is not a safety statement. Policy rows distinguish a model-facing **Guardrail** from a **Boundary** enforced through authorization, isolation or payload-bound human approval.
