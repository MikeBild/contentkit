// The complete set of event types contentkit emits. They used to live as string
// literals at every emit site, which made the endpoint filter unverifiable: an
// `events: ['contentkit.content.publised']` was accepted and then silently
// matched nothing. One constant is what lets the emitters and the filter
// validator disagree loudly instead of quietly.
export const WEBHOOK_EVENT = Object.freeze({
  contactSubmitted: 'contentkit.contact.submitted',
  commentSubmitted: 'contentkit.comment.submitted',
  commentApproved: 'contentkit.comment.approved',
  contentPublished: 'contentkit.content.published',
  contentUnpublished: 'contentkit.content.unpublished',
  deckPublished: 'contentkit.deck.published',
  releasePublished: 'contentkit.release.published',
  releaseFailed: 'contentkit.release.failed',
  deckReleaseFailed: 'contentkit.deck.release_failed',
})

export const WEBHOOK_EVENT_TYPES = Object.freeze(Object.values(WEBHOOK_EVENT))

// An endpoint filter entry is not necessarily a full type: the delivery matcher
// also accepts a bare suffix (`comment.approved`) and the un-prefixed form, so
// validation has to accept exactly what matchesEvent() would honour — no more.
export function knownWebhookEventFilter(entry) {
  const value = String(entry || '')
  return WEBHOOK_EVENT_TYPES.some(
    (type) => type === value || type === `contentkit.${value}` || (value !== '' && type.endsWith(`.${value}`)),
  )
}

// Validates an endpoint's `events` filter. An empty list means "everything" and
// stays valid; an entry that matches no known type is a 422 rather than an
// endpoint that will never fire.
export function validateWebhookEvents(events) {
  if (events === undefined || events === null) return []
  if (!Array.isArray(events)) {
    throw Object.assign(new Error('events must be an array of event types'), { statusCode: 422 })
  }
  const unknown = events.filter((entry) => !knownWebhookEventFilter(entry))
  if (unknown.length) {
    throw Object.assign(
      new Error(`unknown webhook event(s): ${unknown.join(', ')}; known types are ${WEBHOOK_EVENT_TYPES.join(', ')}`),
      { statusCode: 422 },
    )
  }
  return events.map(String)
}
