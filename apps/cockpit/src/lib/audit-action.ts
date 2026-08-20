import type { TranslationKey } from './i18n'

/**
 * An audit action, turned into something that reads like a sentence.
 *
 * WHY THIS IS NOT A LOOKUP TABLE OF WHOLE ACTIONS
 *
 * The server does not have a fixed list of actions to look up. Roughly half of
 * them are assembled at the call site — `release.${input.action}`,
 * `comment.${input.status}`, `access.${singular}.${verb}` — so a table keyed by
 * the finished string is a table that is out of date the moment a status enum
 * grows, and its failure mode is silent: the row falls back to the raw value and
 * nothing says so. The actions are `<subject>.<verb>` by construction, so this
 * module reads them that way, and a subject or a verb nobody has named here is
 * an honest miss rather than a wrong sentence.
 *
 * WHY THE VERB IS READ FROM THE END
 *
 * `access.reader.create` and `release.promote.approved` both put the thing that
 * happened last. Reading position 1 would name the middle of the first and the
 * subject of the second.
 *
 * WHY THERE IS AN OVERRIDE TABLE AS WELL
 *
 * Composition produces good German for most of the space and nonsense for a
 * handful: `oauth.login` composes to "Anmeldung angemeldet", and
 * `content.delete_draft` has its object in the verb. Those get named outright.
 * The list is short on purpose — an override for every action would be the
 * lookup table this module exists not to be.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It never invents a sentence for an action it does not recognise. `null` is the
 * answer, and the caller prints the machine value instead — a wrong German
 * sentence over an audit row is worse than the raw string it replaced, because
 * the raw string at least admits what it is.
 */

/** The thing an action is about. */
const SUBJECT_KEYS = {
  access: 'audit.subject.access',
  api_key: 'audit.subject.apiKey',
  comment: 'audit.subject.comment',
  composition: 'audit.subject.composition',
  contact: 'audit.subject.contact',
  content: 'audit.subject.content',
  deck: 'audit.subject.deck',
  decision: 'audit.subject.decision',
  draft_capture: 'audit.subject.draft',
  feedback: 'audit.subject.feedback',
  identity: 'audit.subject.identity',
  promotion_review: 'audit.subject.promotion',
  release: 'audit.subject.release',
  site: 'audit.subject.site',
  webhook: 'audit.subject.webhook',
} as const satisfies Record<string, TranslationKey>

/**
 * What happened to it, in the past tense.
 *
 * Past tense because Zone C is called "Zuletzt geschehen" and lists things that
 * are over. The audit page's own action vocabulary is infinitive ("Release
 * aktivieren") because there it labels a *filter* — the same word in the two
 * places would be wrong in one of them.
 *
 * Both spellings of the moderation verbs are here: the REST route audits the
 * resulting status (`comment.approved`), the MCP tool audits the requested
 * action (`comment.approve`), and an operator reading the trail should not have
 * to know which surface wrote the row.
 */
const VERB_KEYS = {
  activate: 'audit.verb.activated',
  approve: 'audit.verb.approved',
  approved: 'audit.verb.approved',
  closed: 'audit.verb.closed',
  compile: 'audit.verb.built',
  create: 'audit.verb.created',
  defer: 'audit.verb.deferred',
  delete: 'audit.verb.deleted',
  discard: 'audit.verb.discarded',
  dismiss: 'audit.verb.discarded',
  ingest: 'audit.verb.ingested',
  new: 'audit.verb.received',
  pending: 'audit.verb.queued',
  preview: 'audit.verb.previewed',
  promote: 'audit.verb.activated',
  publish: 'audit.verb.published',
  read: 'audit.verb.markedRead',
  reject: 'audit.verb.rejected',
  rejected: 'audit.verb.rejected',
  request: 'audit.verb.requested',
  reset: 'audit.verb.reset',
  restore: 'audit.verb.restored',
  revoke: 'audit.verb.revoked',
  triage: 'audit.verb.triaged',
  unpublish: 'audit.verb.unpublished',
  update: 'audit.verb.updated',
} as const satisfies Record<string, TranslationKey>

/** The handful composition gets wrong, named outright. */
const OVERRIDES = {
  'content.delete_draft': { subject: 'audit.subject.draft', verb: 'audit.verb.deleted' },
  'identity.session_issued': { subject: 'audit.subject.session', verb: 'audit.verb.issued' },
  'oauth.client_registered': { subject: 'audit.subject.oauthClient', verb: 'audit.verb.registered' },
  'oauth.consent': { subject: 'audit.subject.consent', verb: 'audit.verb.granted' },
  'oauth.login': { subject: 'audit.subject.session', verb: 'audit.verb.started' },
  'oauth.logout': { subject: 'audit.subject.session', verb: 'audit.verb.ended' },
  'oauth.signup': { subject: 'audit.subject.account', verb: 'audit.verb.created' },
  'oauth.token_issued': { subject: 'audit.subject.token', verb: 'audit.verb.issued' },
} as const satisfies Record<string, AuditPhrase>

export interface AuditPhrase {
  subject: TranslationKey
  verb: TranslationKey
}

/** The phrase for one action, or null when this module cannot name it. */
export function auditPhrase(action: string): AuditPhrase | null {
  if (action in OVERRIDES) return OVERRIDES[action as keyof typeof OVERRIDES]
  const parts = action.split('.')
  if (parts.length < 2) return null
  const subject = SUBJECT_KEYS[parts[0] as keyof typeof SUBJECT_KEYS]
  const verb = VERB_KEYS[parts[parts.length - 1] as keyof typeof VERB_KEYS]
  return subject && verb ? { subject, verb } : null
}
