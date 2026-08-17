import { randomUUID } from 'node:crypto'

export const DECISION_KINDS = Object.freeze(['draft_capture', 'comment', 'contact', 'feedback', 'promotion'])
export const DECISION_STATES = Object.freeze(['open', 'deferred', 'dismissed', 'decided'])

const invalid = (message) => Object.assign(new Error(message), { statusCode: 422 })

export async function createDecision(exec, { siteId, kind, sourceId, sourceVersion, openedAt = new Date() }) {
  if (!DECISION_KINDS.includes(kind)) throw invalid('decision kind is invalid')
  const opened = new Date(openedAt)
  const rows = await exec.query(
    `INSERT INTO ck_decisions
       (id, site_id, kind, source_id, source_version, state, version, opened_at, due_at)
     VALUES ($1, $2, $3, $4, $5, 'open', 1, $6, $7)
     ON CONFLICT (site_id, kind, source_id, source_version) DO NOTHING
     RETURNING *`,
    [
      randomUUID(),
      siteId,
      kind,
      sourceId,
      String(sourceVersion),
      opened.toISOString(),
      new Date(opened.getTime() + 72 * 60 * 60 * 1000).toISOString(),
    ],
  )
  if (rows[0]) return rows[0]
  const [existing] = await exec.select('ck_decisions', {
    site_id: `eq.${siteId}`,
    kind: `eq.${kind}`,
    source_id: `eq.${sourceId}`,
    source_version: `eq.${String(sourceVersion)}`,
    limit: '1',
  })
  return existing
}

export async function decideSource(exec, { siteId, kind, sourceId, outcome, reason = '', actorId = null }) {
  const [row] = await exec.query(
    `UPDATE ck_decisions
        SET state = 'decided', version = version + 1, decided_at = now(),
            outcome = $4, reason = $5, actor_id = $6, updated_at = now()
      WHERE site_id = $1 AND kind = $2 AND source_id = $3 AND state <> 'decided'
      RETURNING *`,
    [siteId, kind, sourceId, outcome, reason, actorId],
  )
  return row || null
}

function encodeCursor(offset) {
  return Buffer.from(String(offset)).toString('base64url')
}

function decodeCursor(cursor) {
  if (!cursor) return 0
  const value = Number(Buffer.from(String(cursor), 'base64url').toString('utf8'))
  if (!Number.isSafeInteger(value) || value < 0) throw invalid('cursor is invalid')
  return value
}

async function decisionDetails(db, decisions) {
  const ids = (kind) => decisions.filter((row) => row.kind === kind).map((row) => row.source_id)
  const [captures, comments, contacts, reviews, feedbackRows] = await Promise.all([
    ids('draft_capture').length ? db.select('ck_draft_captures', { id: `in.(${ids('draft_capture').join(',')})` }) : [],
    ids('comment').length ? db.select('ck_comments', { id: `in.(${ids('comment').join(',')})` }) : [],
    ids('contact').length ? db.select('ck_contact_submissions', { id: `in.(${ids('contact').join(',')})` }) : [],
    ids('promotion').length ? db.select('ck_promotion_reviews', { id: `in.(${ids('promotion').join(',')})` }) : [],
    ids('feedback').length
      ? db.select('ck_post_feedback', { content_item_id: `in.(${ids('feedback').join(',')})` })
      : [],
  ])
  const byId = (rows) => new Map(rows.map((row) => [row.id, row]))
  const captureById = byId(captures)
  const commentById = byId(comments)
  const contactById = byId(contacts)
  const reviewById = byId(reviews)
  const feedback = new Map()
  for (const row of feedbackRows) {
    const value = feedback.get(row.content_item_id) || { up: 0, down: 0 }
    value[row.vote] += 1
    feedback.set(row.content_item_id, value)
  }
  const itemIds = [...new Set([...ids('feedback'), ...comments.map((row) => row.content_item_id)])]
  const titles = new Map()
  if (itemIds.length && db.query) {
    const rows = await db.query(
      `SELECT DISTINCT ON (item.id) item.id, revision.title
         FROM ck_content_items item
         LEFT JOIN ck_content_revisions revision ON revision.item_id = item.id
        WHERE item.id = ANY($1::uuid[])
        ORDER BY item.id, revision.created_at DESC`,
      [itemIds],
    )
    for (const row of rows) titles.set(row.id, row.title)
  }
  return decisions.map((decision) => {
    let title = decision.kind.replace('_', ' ')
    let summary = ''
    let source = { id: decision.source_id }
    if (decision.kind === 'draft_capture') {
      const capture = captureById.get(decision.source_id)
      const text = capture?.text || ''
      title = text.split(/\r?\n/).find(Boolean)?.slice(0, 120) || 'Untitled draft'
      summary = text.slice(0, 500)
      source = { ...source, text }
    } else if (decision.kind === 'comment') {
      const comment = commentById.get(decision.source_id)
      title = `Comment from ${comment?.author_name || 'anonymous'}`
      summary = comment?.body || ''
      source = { ...source, content_item_id: comment?.content_item_id, author_name: comment?.author_name }
      if (comment?.content_item_id) source.content_title = titles.get(comment.content_item_id) || null
    } else if (decision.kind === 'contact') {
      const contact = contactById.get(decision.source_id)
      title = `Contact from ${contact?.name || 'unknown'}`
      summary = contact?.body || ''
      source = { ...source, name: contact?.name }
    } else if (decision.kind === 'feedback') {
      const counts = feedback.get(decision.source_id) || { up: 0, down: 0 }
      title = titles.get(decision.source_id) || 'Post feedback'
      summary = `${counts.up} up · ${counts.down} down`
      source = { ...source, ...counts }
    } else if (decision.kind === 'promotion') {
      const review = reviewById.get(decision.source_id)
      title = 'Preview ready for activation'
      summary = review?.reason || ''
      source = { ...source, release_id: review?.release_id, review_id: review?.id }
    }
    return { ...decision, title, summary, source }
  })
}

export async function listDecisions(
  db,
  siteId,
  { state = 'open', kind, cursor, limit = 50, allowedKinds = DECISION_KINDS } = {},
) {
  if (!DECISION_STATES.includes(state)) throw invalid('state is invalid')
  if (kind && !DECISION_KINDS.includes(kind)) throw invalid('kind is invalid')
  const pageSize = Math.min(Math.max(Number(limit) || 50, 1), 200)
  const offset = decodeCursor(cursor)
  const rows = await db.select('ck_decisions', { site_id: `eq.${siteId}` })
  const now = Date.now()
  const effectiveState = (row) =>
    row.state === 'deferred' && row.remind_at && Date.parse(row.remind_at) <= now ? 'open' : row.state
  const authorized = rows.filter((row) => allowedKinds.includes(row.kind))
  const visible = authorized
    .filter((row) => effectiveState(row) === state && (!kind || row.kind === kind))
    .sort((left, right) => {
      const leftDue = Date.parse(left.due_at) <= now ? 0 : 1
      const rightDue = Date.parse(right.due_at) <= now ? 0 : 1
      return leftDue - rightDue || Date.parse(left.opened_at) - Date.parse(right.opened_at)
    })
  const page = visible.slice(offset, offset + pageSize)
  const open = authorized.filter((row) => effectiveState(row) === 'open')
  const byKind = Object.fromEntries(
    DECISION_KINDS.map((entry) => [entry, open.filter((row) => row.kind === entry).length]),
  )
  return {
    items: await decisionDetails(db, page),
    next_cursor: offset + pageSize < visible.length ? encodeCursor(offset + pageSize) : null,
    counts: {
      open: open.length,
      overdue: open.filter((row) => Date.parse(row.due_at) <= now).length,
      by_kind: byKind,
    },
  }
}

export async function transitionDecision(db, siteId, decisionId, input, actorId = null) {
  if (!Number.isInteger(input.version) || input.version < 1) throw invalid('version must be a positive integer')
  if (!['defer', 'dismiss', 'restore'].includes(input.action)) throw invalid('action is invalid')
  let state = 'open'
  let remindAt = null
  if (input.action === 'defer') {
    state = 'deferred'
    remindAt = new Date(input.remind_at)
    if (Number.isNaN(remindAt.getTime()) || remindAt.getTime() <= Date.now()) {
      throw invalid('remind_at must be a future ISO 8601 timestamp')
    }
  } else if (input.action === 'dismiss') state = 'dismissed'
  const [row] = await db.query(
    `UPDATE ck_decisions
        SET state = $4, remind_at = $5, version = version + 1,
            actor_id = $6, updated_at = now()
      WHERE site_id = $1 AND id = $2 AND version = $3 AND state <> 'decided'
      RETURNING *`,
    [siteId, decisionId, input.version, state, remindAt?.toISOString() || null, actorId],
  )
  if (row) return row
  const existing = await db.select('ck_decisions', { id: `eq.${decisionId}`, site_id: `eq.${siteId}`, limit: '1' })
  if (!existing[0]) throw Object.assign(new Error('decision not found'), { statusCode: 404 })
  throw Object.assign(new Error('decision changed since it was read'), { statusCode: 409 })
}

export async function promotionReviewDetails(db, publicUrl, siteId, reviewId) {
  const [review] = await db.select('ck_promotion_reviews', {
    id: `eq.${reviewId}`,
    site_id: `eq.${siteId}`,
    limit: '1',
  })
  if (!review) return null
  const [release] = await db.select('ck_releases', {
    id: `eq.${review.release_id}`,
    site_id: `eq.${siteId}`,
    limit: '1',
  })
  if (!release) return null
  const [access] = await db.select('ck_preview_access', { release_id: `eq.${release.id}`, limit: '1' })
  const revisionIds = release.revision_ids || []
  const revisions = revisionIds.length
    ? await db.select('ck_content_revisions', { id: `in.(${revisionIds.join(',')})` })
    : []
  const itemIds = [...new Set([...revisions.map((row) => row.item_id), ...(release.retire_item_ids || [])])]
  const items = itemIds.length ? await db.select('ck_content_items', { id: `in.(${itemIds.join(',')})` }) : []
  const itemById = new Map(items.map((row) => [row.id, row]))
  const oldIds = items.map((row) => row.published_revision_id).filter(Boolean)
  const oldRevisions = oldIds.length ? await db.select('ck_content_revisions', { id: `in.(${oldIds.join(',')})` }) : []
  const oldById = new Map(oldRevisions.map((row) => [row.id, row]))
  const changes = revisions.map((revision) => {
    const item = itemById.get(revision.item_id)
    const old = item?.published_revision_id ? oldById.get(item.published_revision_id) : null
    return {
      content_item_id: revision.item_id,
      title: revision.title,
      effect: old ? 'modified' : 'added',
      old: old ? { revision_id: old.id, markdown: old.markdown } : null,
      new: { revision_id: revision.id, markdown: revision.markdown },
    }
  })
  for (const itemId of release.retire_item_ids || []) {
    const item = itemById.get(itemId)
    const old = item?.published_revision_id ? oldById.get(item.published_revision_id) : null
    changes.push({
      content_item_id: itemId,
      title: old?.title || item?.translation_key || 'Removed document',
      effect: 'removed',
      old: old ? { revision_id: old.id, markdown: old.markdown } : null,
      new: null,
    })
  }
  const expired = !access || Boolean(access.revoked_at) || Date.parse(access.expires_at) <= Date.now()
  const base = new URL(publicUrl)
  const previewUrl = access ? new URL(`/previews/${access.slug}/`, base).toString() : null
  return {
    ...review,
    status: review.status === 'pending' && expired ? 'expired' : review.status,
    preview_url: expired ? null : previewUrl,
    expires_at: access?.expires_at || null,
    release: {
      id: release.id,
      manifest_sha256: release.manifest_sha256,
      base_publish_epoch: release.base_publish_epoch,
      reason: release.reason,
    },
    changes,
  }
}
