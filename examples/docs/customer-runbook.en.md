---
kind: page
layout: docs
title: Customer runbook
locale: en
slug: customer-runbook
translationKey: atlas-customer-runbook-v2
docKey: customer-runbook
docsVersion: v2
parent: getting-started
navTitle: Customer runbook
navOrder: 30
summary: Protected operational procedures for Atlas customers.
access: [customers]
---

# Customer runbook

This document contains operational information for signed-in customers. It must
not appear in public search, sitemaps, feeds, or machine-readable AI files.

## Triage an incident

1. Check `/ready` and the active release.
2. Compare the time of the last successful publication.
3. Activate the previous release pointer if the content is faulty.
4. Keep logs and the request ID for the incident review.

## Escalation

Send the timestamp, affected domain, release ID, and request ID to support.
Never transmit API keys or session cookies.
