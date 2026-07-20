import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateSlidekitSource } from '../../scripts/migrate-slidekit-deck.mjs'
import { planDeck } from '../../src/decks.mjs'

test('SlideKit migration adds ContentKit identity and preserves slide layouts', async () => {
  const legacy = `---
theme: seriph
title: Legacy deck
layout: cover
class: text-center
colorSchema: all
---
# Legacy deck

---
layout: two-cols
---
# Evidence
`
  const migrated = migrateSlidekitSource(legacy, { locale: 'de', theme: 'editorial' })
  assert.match(migrated, /kind: deck/)
  assert.match(migrated, /layout: deck/)
  assert.match(migrated, /firstSlide:\n\s+layout: cover/)
  assert.doesNotMatch(migrated, /^theme: seriph$/m)
  const plan = await planDeck(migrated)
  assert.equal(plan.locale, 'de')
  assert.equal(plan.settings.theme, 'editorial')
  assert.equal(plan.settings.first_slide.layout, 'cover')
  assert.equal(plan.slides[1].slide_frontmatter.layout, 'two-cols')
})
