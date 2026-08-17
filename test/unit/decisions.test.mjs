import assert from 'node:assert/strict'
import test from 'node:test'
import { createDecision, listDecisions, transitionDecision } from '../../src/decisions.mjs'

test('an identical rejected proposal is returned as history and is never reopened', async () => {
  const rejected = {
    id: 'decision-1',
    site_id: 'site-1',
    kind: 'promotion',
    source_id: 'review-1',
    source_version: 'manifest-1',
    state: 'decided',
    outcome: 'rejected',
    version: 2,
  }
  let writes = 0
  const db = {
    async query(sql) {
      assert.match(sql, /ON CONFLICT .* DO NOTHING/s)
      writes += 1
      return []
    },
    async select() {
      return [rejected]
    },
  }
  assert.equal(
    await createDecision(db, {
      siteId: 'site-1',
      kind: 'promotion',
      sourceId: 'review-1',
      sourceVersion: 'manifest-1',
    }),
    rejected,
  )
  assert.equal(writes, 1)
  assert.equal(rejected.state, 'decided')
})

test('the queue sorts overdue first, counts only authorized kinds and restores elapsed reminders', async () => {
  const now = Date.now()
  const rows = [
    {
      id: 'new',
      kind: 'comment',
      source_id: 'comment-1',
      state: 'open',
      opened_at: new Date(now - 1_000).toISOString(),
      due_at: new Date(now + 60_000).toISOString(),
    },
    {
      id: 'old',
      kind: 'comment',
      source_id: 'comment-2',
      state: 'open',
      opened_at: new Date(now - 20_000).toISOString(),
      due_at: new Date(now - 1_000).toISOString(),
    },
    {
      id: 'reminder',
      kind: 'comment',
      source_id: 'comment-3',
      state: 'deferred',
      remind_at: new Date(now - 1_000).toISOString(),
      opened_at: new Date(now - 10_000).toISOString(),
      due_at: new Date(now + 60_000).toISOString(),
    },
    {
      id: 'hidden',
      kind: 'promotion',
      source_id: 'review-1',
      state: 'open',
      opened_at: new Date(now - 30_000).toISOString(),
      due_at: new Date(now - 2_000).toISOString(),
    },
  ]
  const comments = {
    'comment-1': { id: 'comment-1', author_name: 'New', body: 'new' },
    'comment-2': { id: 'comment-2', author_name: 'Old', body: 'old' },
    'comment-3': { id: 'comment-3', author_name: 'Reminder', body: 'reminder' },
  }
  const db = {
    async select(table, query) {
      if (table === 'ck_decisions') return rows
      if (table === 'ck_comments') return Object.values(comments).filter((row) => query.id.includes(row.id))
      return []
    },
    async query() {
      return []
    },
  }
  const result = await listDecisions(db, 'site-1', { allowedKinds: ['comment'] })
  assert.deepEqual(
    result.items.map((row) => row.id),
    ['old', 'reminder', 'new'],
  )
  assert.equal(result.counts.open, 3)
  assert.equal(result.counts.overdue, 1)
  assert.equal(result.counts.by_kind.promotion, 0)
})

test('decision transitions use optimistic versions and report a stale write as conflict', async () => {
  const db = {
    async query() {
      return []
    },
    async select() {
      return [{ id: 'decision-1', version: 3 }]
    },
  }
  await assert.rejects(
    transitionDecision(db, 'site-1', 'decision-1', { version: 2, action: 'dismiss' }),
    (error) => error.statusCode === 409,
  )
})
