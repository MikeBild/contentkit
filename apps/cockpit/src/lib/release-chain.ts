/**
 * Where a site is in the chain that puts writing on the live site.
 *
 * The console used to state the chain as a sentence — "Revisions are immutable.
 * Creating or editing writes a new draft revision; nothing reaches the live site
 * until a release is built and activated." — above a list. The sentence is true
 * and it is not an answer: an operator reading it still cannot see whether their
 * own site has three drafts waiting, a build nobody activated, or an active
 * release from six days ago that is exactly what is being served.
 *
 * So the chain is derived instead, from the two endpoints that answer it and
 * from nothing else:
 *
 *   GET /v1/sites/{site}/content   → what is written but not published
 *   GET /v1/sites/{site}/releases  → what is built, and which build is served
 *
 * Four rules govern every state below, because each one has already been got
 * wrong somewhere in this product:
 *
 *  1. Absent evidence is `null`, never zero. A missing content list means "this
 *     operator cannot see the drafts", which must not render as "no drafts" —
 *     the same contract UsageStats states explicitly with `value_state`. `null`
 *     is also not a small number: `items?.length === 0` is false for an
 *     unreadable list, which is how an unreadable list was once filed under
 *     "this site holds content" and drew a red alarm on evidence nobody had.
 *  2. Only what the endpoint actually answers is claimed. `listReleases`
 *     projects nine fields and `error` is not among them, so a failed build is
 *     reported as failed and the reason is not quoted anywhere in this console.
 *  3. A calm site produces a calm chain. Every step reports a `tone`, and only
 *     'attention' and 'blocked' are worth pixels — four green ticks on a site
 *     with nothing to do is decoration that trains the operator to ignore it.
 *  4. Every sentence the chain says is derived from something in `ChainInput`.
 *     The calm headline claims that what is published is in the build being
 *     served; that claim is `publishedAfterBuild` below, and when the evidence
 *     for it is missing the sentence is a weaker one rather than a hopeful one.
 */

export type ChainStepId = 'drafts' | 'built' | 'active' | 'live'

/**
 * How much of the operator's attention a step has earned.
 *
 * 'done' and 'idle' are both calm: one means the step is satisfied, the other
 * that nothing has happened there yet and nothing is wrong. 'unknown' is the
 * evidence gap — visible, because a chain with a hole in it must not read as a
 * chain that is fine.
 */
export type ChainTone = 'done' | 'idle' | 'unknown' | 'attention' | 'blocked'

const SEVERITY: Record<ChainTone, number> = { done: 0, idle: 1, unknown: 2, attention: 3, blocked: 4 }

export interface ChainStep {
  id: ChainStepId
  /** The step's name, in the operator's words. */
  label: string
  /** The one state this step is in. It is the `data-state` and the testid suffix. */
  state: string
  tone: ChainTone
  /** What the evidence says. Short enough to sit under the step. */
  detail: string
  /** The instant the state is dated by, or null when there is none to show. */
  at: string | null
  /**
   * How many items the step is waiting on — null when the number is unknown,
   * and absent (undefined) when the step is not a count at all. `null` is never
   * rendered as 0.
   */
  count?: number | null
}

export interface ReleaseChain {
  steps: ChainStep[]
  /** The worst tone in the chain: what the summary line is about. */
  tone: ChainTone
  /**
   * Summary first: one sentence naming the exceptions, or the calm state — and
   * carrying the fact that part of the chain was unreadable whenever it was,
   * because a gap in the evidence outranks anything concluded without it.
   */
  headline: string
  /** The steps worth acting on, worst first. Empty on a calm site. */
  exceptions: ChainStep[]
  calm: boolean
  /**
   * What no endpoint can confirm, stated rather than implied. Activation is a
   * pointer swap in ContentKit's own database; whether the host in front of it
   * is serving those files is not a question this API answers, and a site has
   * already served empty pages from a release the console called active.
   */
  unverified: string | null
}

/** Exactly the release fields `GET /v1/sites/{site}/releases` answers with. */
export interface ChainRelease {
  id: string
  kind: 'release' | 'preview'
  status: 'building' | 'preview' | 'ready' | 'active' | 'superseded' | 'failed'
  file_count?: number | null
  created_at?: string | null
  completed_at?: string | null
  activated_at?: string | null
}

/** Exactly the content fields the list merges in from the newest revision. */
export interface ChainItem {
  /**
   * Whether the item is live, which is a different question from what its newest
   * revision is — the wording `withLatestRevision` in src/repository.mjs uses.
   * `ck_activate_release` sets this pointer in the same statement that flips the
   * revision to 'published', and clears it for a retired item, so a non-null
   * pointer is the list's answer to "there is published content here".
   *
   * `activeStep` grades on it: nothing published means nothing an activation
   * could have been serving.
   */
  published_revision_id?: string | null
  latest_revision_status?: 'draft' | 'scheduled' | 'published' | 'archived' | null
  /**
   * When the newest revision was *written*: `withLatestRevision` in
   * src/repository.mjs sets this from the revision's `created_at`, not from
   * `published_at`. So it answers "did this revision exist when that build ran",
   * which is the only question `publishedAfterBuild` asks of it.
   */
  latest_revision_at?: string | null
}

export interface ChainInput {
  /** `null` when the list could not be read; `[]` when the site has no releases. */
  releases: readonly ChainRelease[] | null
  /** `null` when the list could not be read; `[]` when the site has no content. */
  items: readonly ChainItem[] | null
  /** Where the active build is served from, when the site record has loaded. */
  baseUrl?: string | null
}

const UNVERIFIED =
  'Activation is a pointer swap in ContentKit. Whether the host in front of it serves those files is not something this API can confirm.'

const time = (value: string | null | undefined) => {
  if (!value) return null
  const parsed = new Date(value).valueOf()
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * A step's `at`, and only when there is one.
 *
 * Every date in a step ends up in RelativeTime, so a value that will not parse
 * has to be dropped here: shown, it becomes "55 years ago" or worse, and a step
 * dated by nonsense is a step nobody can date.
 */
const instant = (value: string | null | undefined) => (time(value) === null ? null : (value as string))

/**
 * Newest first, by `created_at`, with an unreadable instant sorted last.
 *
 * Sorted last and *not* standing in for a date: no number is a defensible
 * substitute for an instant nobody can read, which is the rule `?? 0` broke in
 * `builtStep` and `?? -1` broke here. Sorting an undated row last says only "put
 * it where it disturbs least" — it is not evidence that the row is old, so no
 * step below concludes "this build is newer than that one" from the order. The
 * one step that makes that claim compares the two instants itself, and reports a
 * gap when either is missing.
 */
function newestFirst(releases: readonly ChainRelease[]): ChainRelease[] {
  return [...releases].sort((left, right) => {
    const before = time(left.created_at)
    const after = time(right.created_at)
    if (before === null && after === null) return 0
    if (before === null) return 1
    if (after === null) return -1
    return after - before
  })
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/**
 * What `publishedAfterBuild` could establish about the build being served.
 *
 * There is no shape of this that means "no evidence": the function answers
 * `null` for that, and a `null` may not be read as a zero (rule 1).
 */
interface PublishedAfterBuild {
  /** How many published items were written after the active build ran. */
  count: number
  /** The oldest of them: how long the site has been serving without it. */
  since: string | null
  /**
   * True only when every published item could be placed on one side of the build
   * or the other. False means `count` is a floor — enough to raise the alarm,
   * never enough to claim that everything published is in the build.
   */
  certain: boolean
}

/**
 * Published, and not in the build this site serves.
 *
 * The state the product design is about: a release must be built *and*
 * activated, so publishing is not the last step of the chain. A revision written
 * after the active build's `created_at` did not exist when that build read the
 * published set, so it cannot be in it — the site keeps serving the older files
 * until somebody builds again, and no other step notices. `draftsStep` counts
 * 'draft' and 'scheduled' only; a revision published four days after the build
 * is 'published' and was counted nowhere.
 *
 * Strictly *after*, because only that is evidence: a revision written in the
 * same instant the build read the set is not proof of anything missing, and this
 * module raises alarms on evidence rather than on coincidence.
 *
 * `null` means the comparison could not be made at all — a list is unreadable,
 * nothing is active, or the active build carries no readable `created_at` — and
 * then nothing may be claimed in either direction.
 *
 * The reverse shape, a build that predates the publish it is missing, is not
 * this function's to catch: activating an older release leaves the newer build
 * 'superseded', which `builtStep` already reports as 'stale'.
 */
function publishedAfterBuild(
  releases: readonly ChainRelease[] | null,
  items: readonly ChainItem[] | null,
): PublishedAfterBuild | null {
  if (!releases || !items) return null
  const active = newestFirst(releases).find((release) => release.status === 'active')
  const built = active ? time(active.created_at) : null
  if (built === null) return null
  const after: number[] = []
  let certain = true
  for (const item of items) {
    if (item.latest_revision_status !== 'published') continue
    const at = time(item.latest_revision_at)
    // An instant that cannot be read cannot be placed either side of the build.
    // It does not silence an item that is provably late, and it does stop the
    // headline claiming that everything published is in the build.
    if (at === null) certain = false
    else if (at > built) after.push(at)
  }
  return {
    count: after.length,
    since: after.length > 0 ? new Date(Math.min(...after)).toISOString() : null,
    certain,
  }
}

// ── The four steps ───────────────────────────────────────────────────────────

/**
 * Written, and not published yet.
 *
 * A draft revision cannot be in any release: a release is built from published
 * revisions plus the ones the build names, so `latest_revision_status: 'draft'`
 * is unreleased work by definition. A scheduled revision is counted separately
 * because it is waiting for POST /v1/publish-due, not for an operator.
 *
 * This step is only the *publishing* half of "written but not live". Work that
 * is published and still absent from the build being served is a different
 * state with a different remedy — build a release, not publish a draft — so it
 * belongs to the built step below and is counted there, never here.
 */
function draftsStep(items: readonly ChainItem[] | null): ChainStep {
  const label = 'Drafts'
  if (!items) {
    return { id: 'drafts', label, state: 'unknown', tone: 'unknown', detail: 'not readable', at: null, count: null }
  }
  if (items.length === 0) {
    return { id: 'drafts', label, state: 'empty', tone: 'idle', detail: 'no content yet', at: null, count: 0 }
  }
  const drafts = items.filter((item) => item.latest_revision_status === 'draft')
  const scheduled = items.filter((item) => item.latest_revision_status === 'scheduled')
  const waiting = drafts.length + scheduled.length
  if (waiting === 0) {
    return { id: 'drafts', label, state: 'clear', tone: 'done', detail: 'nothing waiting', at: null, count: 0 }
  }
  // The oldest one, not the newest: a draft written this morning is work in
  // progress, and one from three weeks ago is the thing that got forgotten.
  const oldest = [...drafts, ...scheduled]
    .map((item) => time(item.latest_revision_at))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)[0]
  const said = [
    drafts.length ? `${plural(drafts.length, 'draft', 'drafts')} waiting` : '',
    scheduled.length ? `${scheduled.length} scheduled` : '',
  ].filter(Boolean)
  return {
    id: 'drafts',
    label,
    state: 'waiting',
    tone: 'attention',
    detail: said.join(' · '),
    at: oldest === undefined ? null : new Date(oldest).toISOString(),
    count: waiting,
  }
}

/**
 * Whether the newest build is the one the site serves.
 *
 * This is the step operators lose. `POST /v1/sites/{site}/releases` builds and
 * activates in one call, so the shapes that survive are the ones where those two
 * came apart: a build left at 'ready' because the activation never landed, and a
 * newer build sitting 'superseded' behind a rollback that was never rolled
 * forward. Both mean the same thing on screen — the newest build is not live —
 * and neither is visible anywhere else in the console.
 *
 * The third shape is the one with no release row to see it in at all: the newest
 * build *is* live and content has been published since it ran, so the build the
 * site serves is missing that work. `after` is the evidence for it.
 *
 * The first two rank one build against another, and the fourth shape is the one
 * where that ranking cannot be made at all: a build whose `created_at` will not
 * parse is neither newer nor older than anything, so the step says which build is
 * live and stops. It used to conclude 'stale' there — `newestFirst` sorts an undated
 * row last, so an undated *active* row was passed over and a superseded
 * predecessor was read as the newest complete build. That is the guess the
 * failure branch below refuses to make, made in the other direction.
 */
function builtStep(releases: readonly ChainRelease[] | null, after: PublishedAfterBuild | null): ChainStep {
  const label = 'Release built'
  if (!releases) return { id: 'built', label, state: 'unknown', tone: 'unknown', detail: 'not readable', at: null }
  // Previews are builds behind an invitation and are never activatable; the
  // server answers 404 for an attempt. They are not candidates for this step.
  const builds = newestFirst(releases.filter((release) => release.kind === 'release'))
  if (builds.length === 0) {
    return { id: 'built', label, state: 'none', tone: 'idle', detail: 'no build', at: null }
  }
  const building = builds.find((release) => release.status === 'building')
  if (building) {
    return { id: 'built', label, state: 'building', tone: 'attention', detail: 'building now', at: instant(building.created_at) }
  }
  // Which build the site serves is a status the list carries — the unique index
  // ck_releases_one_active_per_site leaves at most one 'active' row — so it is
  // read off that row and never inferred from where the row sorted.
  const active = builds.find((release) => release.status === 'active')
  // The complete builds that could be newer than the served one: 'ready' is an
  // activation that never landed, 'superseded' a rollback nobody rolled forward.
  const others = builds.filter(
    (release) => release !== active && (release.status === 'ready' || release.status === 'superseded'),
  )
  const failed = builds.find((release) => release.status === 'failed')
  // An old failure that a later build already replaced is not an exception. Only
  // a failure no complete build has followed still blocks anything — and the two
  // have to be *orderable* for that to be known. `?? 0` used to order an
  // unreadable instant as the epoch, which silenced an undated failure by
  // concluding it was history; "it failed" is the fact and "something newer fixed
  // it" is the guess, so an unorderable pair reports the failure.
  const failedAt = failed ? time(failed.created_at) : null
  const completeAt = [...(active ? [active] : []), ...others]
    .map((release) => time(release.created_at))
    .filter((value): value is number => value !== null)
  const replaced = failedAt !== null && completeAt.some((value) => value >= failedAt)
  if (failed && !replaced) {
    return {
      id: 'built',
      label,
      state: 'failed',
      tone: 'blocked',
      // The list answers no `error`, so this says that it failed and stops.
      detail: 'the last build failed',
      at: instant(failed.completed_at) ?? instant(failed.created_at),
    }
  }
  if (!active) {
    // Nothing is served, which is the active step's exception and not this one's.
    // What this step has is a build the site never activated — and 'ready' *is*
    // that, on the row itself, so it is preferred over comparing dates that may
    // not both be readable. Only if none is 'ready' does the step name the newest
    // row it can, which is what `newestFirst` puts first.
    const waiting = others.find((release) => release.status === 'ready') ?? others[0]
    if (!waiting) return { id: 'built', label, state: 'none', tone: 'idle', detail: 'no build', at: null }
    return {
      id: 'built',
      label,
      state: waiting.status === 'ready' ? 'ready' : 'stale',
      tone: 'attention',
      detail: waiting.status === 'ready' ? 'built, never activated' : 'a newer build is not the one being served',
      at: instant(waiting.completed_at) ?? instant(waiting.created_at),
    }
  }
  // "Newer than the build being served" is a comparison, so it is drawn only from
  // instants that parsed: every other complete build has to be placeable against
  // the active one before this step may report that one of them is ahead of it.
  const activeAt = time(active.created_at)
  const comparable = others.length === 0 || (activeAt !== null && others.every((release) => time(release.created_at) !== null))
  const ahead = comparable && activeAt !== null ? others.filter((release) => (time(release.created_at) as number) > activeAt) : []
  const newer = ahead[0]
  if (newer) {
    return {
      id: 'built',
      label,
      state: newer.status === 'ready' ? 'ready' : 'stale',
      tone: 'attention',
      detail: newer.status === 'ready' ? 'built, never activated' : 'a newer build is not the one being served',
      at: instant(newer.completed_at) ?? instant(newer.created_at),
    }
  }
  // The build being served is live, which is not yet the whole claim: what has
  // been published since it ran is not in it. Dated by the oldest such item —
  // that is how long the live site has been missing it.
  if (after && after.count > 0) {
    return {
      id: 'built',
      label,
      state: 'behind',
      tone: 'attention',
      detail: `${plural(after.count, 'published item is', 'published items are')} not in this build`,
      at: after.since,
      count: after.count,
    }
  }
  if (!comparable) {
    return {
      id: 'built',
      label,
      state: 'unordered',
      tone: 'unknown',
      detail: 'a build is live; whether it is the newest could not be read',
      at: instant(active.completed_at),
    }
  }
  return { id: 'built', label, state: 'current', tone: 'done', detail: 'the newest build is live', at: instant(active.completed_at) }
}

/**
 * Which build the site points at. `ck_activate_release` demotes the previous
 * active row in the same statement, so there is at most one — and it never
 * clears `activated_at`, which is why "active since" may only ever be read off
 * the active row and never off the newest `activated_at` in the list.
 */
function activeStep(releases: readonly ChainRelease[] | null, items: readonly ChainItem[] | null): ChainStep {
  const label = 'Active'
  if (!releases) return { id: 'active', label, state: 'unknown', tone: 'unknown', detail: 'not readable', at: null }
  const active = newestFirst(releases).find((release) => release.status === 'active')
  if (active) {
    return { id: 'active', label, state: 'active', tone: 'done', detail: 'active since', at: instant(active.activated_at) }
  }
  // Nothing is active — a fact the release list answered. How bad it is comes
  // from the *other* list, which is a separate read, and it has four answers:
  //
  //   unreadable      → the severity is unknown, and 'unknown' is what says so.
  //     This was `items?.length === 0`, which is `undefined === 0`, which is
  //     false — so a list nobody could read was filed under "the site holds
  //     content" and drew the red alarm on evidence the code did not have.
  //   empty           → the site has not got there yet; nothing is withheld.
  //   nothing published → written, and never published: an operator who has
  //     ingested content and not built yet, or a migration before its first
  //     release. Nothing is published, so there is nothing an activation could
  //     have been serving and nothing is being withheld from anybody. This step
  //     graded 'blocked' — the loudest tone in the chain — on `items.length`,
  //     which asks whether the site holds any content at all, and so shouted
  //     permanently at a site in a completely normal state. Whatever is waiting
  //     here is a draft or a schedule, and `draftsStep` counts both at 'attention'.
  //   published       → the site has live content and is serving none of it. Only
  //     this one is blocked, and `published_revision_id` is the pointer that says
  //     so: `ck_activate_release` sets it and retiring an item clears it.
  if (!items) {
    return {
      id: 'active',
      label,
      state: 'none',
      tone: 'unknown',
      detail: 'no release is active, and the content list could not be read',
      at: null,
    }
  }
  const published = items.filter((item) => Boolean(item.published_revision_id))
  const detail = items.length === 0 ? 'nothing to activate yet' : published.length === 0 ? 'nothing published yet' : 'no release is active'
  return {
    id: 'active',
    label,
    state: 'none',
    tone: published.length === 0 ? 'idle' : 'blocked',
    detail,
    at: null,
  }
}

/**
 * What the active build actually contains, and where it is served from.
 *
 * `file_count` is the only evidence the API offers about the fourth step, and a
 * build of zero files is an active release that serves nothing — which is
 * precisely how a site once came to answer empty pages while every status in the
 * console read green. An absent count is unknown, not zero.
 */
function liveStep(releases: readonly ChainRelease[] | null, baseUrl?: string | null): ChainStep {
  const label = 'Live'
  if (!releases) return { id: 'live', label, state: 'unknown', tone: 'unknown', detail: 'not readable', at: null }
  const active = newestFirst(releases).find((release) => release.status === 'active')
  // No active release is already the previous step's exception; repeating it here
  // would spend two alarms on one fact.
  if (!active) return { id: 'live', label, state: 'nothing', tone: 'idle', detail: 'nothing is served', at: null }
  const files = active.file_count
  if (files === null || files === undefined) {
    return { id: 'live', label, state: 'unknown', tone: 'unknown', detail: 'the active build reports no file count', at: null, count: null }
  }
  if (files === 0) {
    return {
      id: 'live',
      label,
      state: 'empty',
      tone: 'blocked',
      detail: 'the active build has no files',
      at: instant(active.activated_at),
      count: 0,
    }
  }
  return {
    id: 'live',
    label,
    state: 'served',
    tone: 'done',
    detail: `${plural(files, 'file', 'files')}${baseUrl ? ` at ${hostOf(baseUrl)}` : ''}`,
    at: instant(active.activated_at),
    count: files,
  }
}

/** The host, when the base URL is one — a site record can carry anything. */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl
  } catch {
    return baseUrl
  }
}

// ── The chain ────────────────────────────────────────────────────────────────

export function deriveReleaseChain({ releases, items, baseUrl }: ChainInput): ReleaseChain {
  // Derived once and read twice: the built step turns it into a state, and the
  // headline needs it to know whether its calm sentence has been earned.
  const after = publishedAfterBuild(releases, items)
  const steps = [draftsStep(items), builtStep(releases, after), activeStep(releases, items), liveStep(releases, baseUrl)]
  const tone = steps.reduce<ChainTone>((worst, step) => (SEVERITY[step.tone] > SEVERITY[worst] ? step.tone : worst), 'done')
  const exceptions = steps
    .filter((step) => step.tone === 'attention' || step.tone === 'blocked')
    .sort((left, right) => SEVERITY[right.tone] - SEVERITY[left.tone])
  const calm = SEVERITY[tone] <= SEVERITY.idle

  return {
    steps,
    tone,
    exceptions,
    calm,
    headline: headlineFor(steps, exceptions, after),
    // The caveat is attached to a chain that claims something is live at all.
    unverified: steps[3]?.state === 'served' ? UNVERIFIED : null,
  }
}

/**
 * One sentence: the exceptions, or the calm state — plus the gap, if there is
 * one.
 *
 * Two exceptions at most, because a summary that lists four things is the list it
 * was meant to replace. The gap is not one of the two and does not take one of
 * their slots: an unreadable list is not a thing to go and fix, it is the reason
 * the rest of this sentence may be incomplete, and it used to be dropped
 * entirely the moment any exception existed — which is how the summary came to
 * report a conclusion while hiding that half its evidence was missing.
 */
function headlineFor(steps: ChainStep[], exceptions: ChainStep[], after: PublishedAfterBuild | null): string {
  // Not "with these scopes": a list can also be missing because the request
  // failed, and naming the wrong cause is worse than naming none.
  const gap = steps.some((step) => step.tone === 'unknown') ? 'part of this chain could not be read' : null
  if (exceptions.length > 0) {
    const named = exceptions.slice(0, 2).map((step) => step.detail)
    const rest = exceptions.length - named.length
    return `${named.join(' · ')}${rest > 0 ? ` · and ${rest} more` : ''}${gap ? ` · ${gap}` : ''}`
  }
  if (gap) return 'Part of this chain could not be read.'
  // No build exists, so none of the sentences below — each of them about the build
  // being served — can be said at all: 'none' means the release list carried no
  // build of this site, which is also why nothing can be being served. A site
  // that holds content and has published none of it now reaches this line calmly,
  // where it used to be dragged past it by a 'blocked' active step.
  if (steps[1]?.state === 'none') {
    return steps[0]?.state === 'empty' ? 'Nothing written, nothing built.' : 'Nothing is built, so nothing is being served.'
  }
  // The one claim in this file that is about two endpoints at once, so it is made
  // only when both of them answered: nothing published postdates the build being
  // served, and every published item could be placed either side of it.
  if (after && after.count === 0 && after.certain) return 'Everything published is in the build this site serves.'
  // Reached only with the built step at 'current' — the release list said which
  // build is live, and the comparison against what is published could not be
  // made. So the sentence claims the first and states that it is not the second.
  return 'The newest build is the one this site serves; whether it holds everything published could not be checked.'
}
