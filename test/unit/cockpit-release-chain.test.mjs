import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The release chain: ContentKit's deploy chain as a state an operator can read.
 *
 * The console used to state the chain in prose above a list — "nothing reaches
 * the live site until a release is built and activated" — which is true and says
 * nothing about *this* site. The derivation under test answers it from the two
 * endpoints that can: the content list and the release list.
 *
 * Two halves, for the reason cockpit-primitives.test.mjs states: the Cockpit has
 * no test runner, so the rules live in a dependency-free `.ts` module that Node
 * can import and call, and everything a pure function cannot be asked is asserted
 * against the sources instead.
 *
 * Only committed files are read. Nothing here touches a generated artefact.
 *
 * The shapes below are the ones the server actually answers. `listReleases` in
 * src/repository.mjs projects exactly nine fields — and notably *not* `error`,
 * `site_id` or `storage_prefix`, which the OpenAPI `Release` schema declares — so
 * no test here may give the derivation a field the list would not carry.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const cockpit = join(root, 'apps', 'cockpit', 'src')
const source = (...parts) => readFileSync(join(cockpit, ...parts), 'utf8')

const chainSource = source('components', 'ui', 'release-chain.tsx')
const chainLogic = source('lib', 'release-chain.ts')
const overview = source('pages', 'overview.tsx')
const releasesPage = source('pages', 'releases.tsx')
const shell = source('app', 'shell.tsx')

const stripsTypes = typeof process.features.typescript === 'string'
let logic = null
let failure = null
try {
  logic = await import('../../apps/cockpit/src/lib/release-chain.ts')
} catch (error) {
  failure = error
}
const behavioural = {
  skip: logic ? false : `this Node cannot import TypeScript (type stripping landed in 22.6): ${failure?.message}`,
}

// ── Fixtures, in the shapes the two endpoints answer ─────────────────────────

/** A completed build. `status` is what distinguishes every case below. */
const build = (over = {}) => ({
  id: over.id ?? 'r1',
  kind: 'release',
  status: 'active',
  file_count: 42,
  created_at: '2026-07-20T10:00:00.000Z',
  completed_at: '2026-07-20T10:01:00.000Z',
  activated_at: null,
  ...over,
})

const item = (over = {}) => ({
  published_revision_id: 'rev-published',
  latest_revision_status: 'published',
  latest_revision_at: '2026-07-01T08:00:00.000Z',
  ...over,
})

/**
 * Written and never published, which is two fields and not one: the newest
 * revision is a draft *and* no published pointer exists. `ck_activate_release`
 * sets `published_revision_id` in the same statement that flips a revision to
 * 'published', and clears it for a retired item, so the two always agree — a
 * draft with a pointer is a live page with a newer draft, which is `item({
 * latest_revision_status: 'draft' })` below and a different fact.
 */
const draft = (over = {}) => item({ published_revision_id: null, latest_revision_status: 'draft', ...over })

const byId = (chain) => new Map(chain.steps.map((step) => [step.id, step]))

describe('the release chain, derived', behavioural, () => {
  test('the module these tests drive loads wherever Node can read TypeScript', () => {
    if (!stripsTypes) {
      assert.equal(logic, null, 'a Node without type stripping cannot have imported it')
      return
    }
    assert.ok(logic, `the derivation could not load: ${failure?.stack}`)
  })

  test('the four steps are the documented chain, in order, always', () => {
    // The order is the chain: drafts become a build, a build becomes active, and
    // the active build is what is served. A chain that reorders itself by state
    // would stop being readable as a chain.
    for (const input of [
      { releases: null, items: null },
      { releases: [], items: [] },
      { releases: [build({ status: 'ready' })], items: [draft()] },
    ]) {
      assert.deepEqual(
        logic.deriveReleaseChain(input).steps.map((step) => step.id),
        ['drafts', 'built', 'active', 'live'],
      )
    }
  })

  // ── The five states the task names ─────────────────────────────────────────

  test('a site with no content and no release at all reads as calm, not as broken', () => {
    const chain = logic.deriveReleaseChain({ releases: [], items: [] })
    const steps = byId(chain)
    assert.equal(steps.get('drafts').state, 'empty')
    assert.equal(steps.get('built').state, 'none')
    assert.equal(steps.get('active').state, 'none')
    assert.equal(steps.get('live').state, 'nothing')
    // Nothing has happened, and nothing is wrong: no step may claim attention.
    assert.deepEqual(
      chain.steps.map((step) => step.tone),
      ['idle', 'idle', 'idle', 'idle'],
    )
    assert.equal(chain.tone, 'idle')
    assert.equal(chain.calm, true)
    assert.deepEqual(chain.exceptions, [])
    assert.equal(chain.headline, 'Nothing written, nothing built.')
    assert.equal(chain.unverified, null, 'nothing is served, so there is nothing to caveat')
  })

  test('a release with no content but nothing published is not an alarm', () => {
    // The site holds no content at all yet its release is active: an empty build
    // is what it should be serving. "no release is active" would be the alarm,
    // and this is not it.
    const chain = logic.deriveReleaseChain({
      releases: [build({ status: 'active', activated_at: '2026-07-20T10:02:00.000Z', file_count: 3 })],
      items: [],
    })
    assert.equal(byId(chain).get('drafts').state, 'empty')
    assert.equal(byId(chain).get('drafts').count, 0)
    assert.equal(chain.calm, true)
  })

  // ── What 'blocked' costs, and what earns it ────────────────────────────────

  test('a site that has ingested content and not built yet is not the loudest state in the chain', () => {
    // A 106-document migration before its first release, and every operator who
    // wrote a draft and has not built. `activeStep` graded severity on
    // `items.length === 0` — *does the site hold any content*, not *does it hold
    // anything published* — so this read 'blocked', the loudest tone the chain
    // has, permanently, on a site in a completely normal state. The Overview turns
    // that into the card with the alert triangle (variant={chain.calm ? 'compact'
    // : 'card'}).
    //
    // Nothing is published, so there is nothing an activation could have been
    // serving and nothing is being withheld from anybody. The work that is waiting
    // is a draft, and the drafts step reports it — once.
    const chain = logic.deriveReleaseChain({
      releases: [],
      items: [draft({ latest_revision_at: '2026-07-28T09:00:00.000Z' })],
    })
    const steps = byId(chain)
    assert.equal(steps.get('active').state, 'none', 'nothing is active: that part is still the fact')
    assert.equal(steps.get('active').tone, 'idle')
    assert.notEqual(steps.get('active').tone, 'blocked')
    assert.match(steps.get('active').detail, /nothing published/)
    assert.equal(steps.get('drafts').tone, 'attention', 'the one thing waiting, reported where it is fixed')
    assert.equal(chain.tone, 'attention')
    assert.notEqual(chain.tone, 'blocked', 'a draft-only site is never blocked')
    assert.deepEqual(
      chain.exceptions.map((step) => step.id),
      ['drafts'],
    )
    assert.equal(chain.headline, '1 draft waiting')
    assert.doesNotMatch(chain.headline, /no release is active/, 'the alarm this site did not earn')
  })

  test('a whole migration of drafts is the same normal state, at any size', () => {
    // Size is not severity: 106 unpublished documents are 106 drafts, not an
    // incident. The count is the drafts step's, and the active step stays quiet.
    const chain = logic.deriveReleaseChain({
      releases: [],
      items: Array.from({ length: 106 }, () => draft()),
    })
    assert.equal(byId(chain).get('drafts').count, 106)
    assert.equal(byId(chain).get('active').tone, 'idle')
    assert.equal(chain.tone, 'attention')
    assert.notEqual(chain.tone, 'blocked')
  })

  test('scheduled work that has never been published is not blocked either', () => {
    // A scheduled revision sets no published pointer (the reason removeLocale in
    // src/repository.mjs has to look for it separately), so nothing is live yet.
    // POST /v1/publish-due builds and activates for it; no operator has to.
    const chain = logic.deriveReleaseChain({
      releases: [],
      items: [item({ published_revision_id: null, latest_revision_status: 'scheduled' })],
    })
    assert.equal(byId(chain).get('active').tone, 'idle')
    assert.notEqual(chain.tone, 'blocked')
  })

  test('published content that nothing is serving is what blocked means', () => {
    // The state the loudest tone is for: something is live in the database and no
    // release is putting it on the site. `published_revision_id` is the evidence —
    // it is what says whether the item is live, in the wording of
    // withLatestRevision in src/repository.mjs — and it was declared on ChainItem
    // and never read.
    const chain = logic.deriveReleaseChain({ releases: [], items: [item()] })
    const active = byId(chain).get('active')
    assert.equal(active.state, 'none')
    assert.equal(active.tone, 'blocked')
    assert.equal(active.detail, 'no release is active')
    assert.equal(chain.tone, 'blocked')
    assert.equal(chain.calm, false)
    assert.equal(chain.headline, 'no release is active')
    // Two items, one published: one is enough, and the mixed shape must not be
    // graded by the draft it also holds.
    const mixed = logic.deriveReleaseChain({ releases: [], items: [draft(), item()] })
    assert.equal(byId(mixed).get('active').tone, 'blocked')
    // A live page whose newest revision is a newer draft is published content too,
    // and `latest_revision_status` alone would call it a draft.
    const newerDraft = logic.deriveReleaseChain({
      releases: [],
      items: [item({ latest_revision_status: 'draft' })],
    })
    assert.equal(byId(newerDraft).get('active').tone, 'blocked', 'the pointer says live; the newest revision does not')
  })

  test('a site whose published work was all retired is calm again', () => {
    // Retiring an item clears published_revision_id and archives its live revision
    // (ck_activate_release), so a site that unpublished everything holds content
    // and publishes none of it. Nothing is being withheld, so nothing is blocked —
    // and the summary may not claim anything about a build that does not exist.
    const chain = logic.deriveReleaseChain({
      releases: [],
      items: [item({ published_revision_id: null, latest_revision_status: 'archived' })],
    })
    assert.equal(byId(chain).get('active').tone, 'idle')
    assert.equal(chain.tone, 'idle')
    assert.equal(chain.calm, true)
    assert.deepEqual(chain.exceptions, [])
    assert.equal(chain.headline, 'Nothing is built, so nothing is being served.')
    assert.doesNotMatch(chain.headline, /newest build/, 'there is no build to say anything about')
  })

  test('a build that was never activated is the state operators lose, and it says so', () => {
    // The fourth step of the deploy chain, the one that gets forgotten. 'ready'
    // is what src/releases.mjs writes when the build finished and the activation
    // did not follow, and it must never look like 'active'.
    const chain = logic.deriveReleaseChain({
      releases: [build({ status: 'ready', activated_at: null })],
      items: [item()],
    })
    const steps = byId(chain)
    assert.equal(steps.get('built').state, 'ready')
    assert.equal(steps.get('built').tone, 'attention')
    assert.match(steps.get('built').detail, /never activated/)
    assert.equal(steps.get('built').at, '2026-07-20T10:01:00.000Z', 'dated by when the build finished')
    // Nothing is active, and the site holds content — so it is serving none of it.
    assert.equal(steps.get('active').state, 'none')
    assert.equal(steps.get('active').tone, 'blocked')
    assert.equal(steps.get('live').state, 'nothing')
    assert.equal(steps.get('live').tone, 'idle', 'the missing activation is one exception, not two')
    assert.equal(chain.tone, 'blocked')
    assert.equal(chain.calm, false)
    // Worst first: the thing that is broken outranks the thing that is waiting.
    assert.deepEqual(
      chain.exceptions.map((step) => step.id),
      ['active', 'built'],
    )
  })

  test('built-but-not-active is visibly distinct from active — different state, different tone', () => {
    const ready = byId(logic.deriveReleaseChain({ releases: [build({ status: 'ready' })], items: [item()] }))
    const active = byId(
      logic.deriveReleaseChain({
        releases: [build({ status: 'active', activated_at: '2026-07-20T10:02:00.000Z' })],
        items: [item()],
      }),
    )
    assert.notEqual(ready.get('built').state, active.get('built').state)
    assert.notEqual(ready.get('built').tone, active.get('built').tone)
    assert.equal(active.get('built').tone, 'done', 'the newest build being live is not an exception')
    assert.equal(ready.get('built').tone, 'attention', 'a build nobody activated is')
  })

  test('a rollback that was never rolled forward is the same fact, in the other shape', () => {
    // Activating an older release supersedes the newer build rather than
    // returning it to 'ready'. The newest build is still not what is served, and
    // nothing else in the console shows that.
    const chain = logic.deriveReleaseChain({
      releases: [
        build({
          id: 'new',
          status: 'superseded',
          created_at: '2026-07-21T09:00:00.000Z',
          completed_at: '2026-07-21T09:02:00.000Z',
        }),
        build({ id: 'old', status: 'active', activated_at: '2026-07-22T07:00:00.000Z' }),
      ],
      items: [item()],
    })
    const steps = byId(chain)
    assert.equal(steps.get('built').state, 'stale')
    assert.equal(steps.get('built').tone, 'attention')
    assert.match(steps.get('built').detail, /newer build/)
    assert.equal(steps.get('active').state, 'active', 'something *is* being served — just not the newest build')
    assert.equal(steps.get('active').at, '2026-07-22T07:00:00.000Z')
  })

  test('an active build with no readable date is not a stale build', () => {
    // 'stale' is a comparison — *a newer build* is not the one being served — and
    // this pair cannot be compared: `created_at` is `not null default now()` in
    // ck_releases, so an unreadable one is a broken payload, and nothing about it
    // says the served build is the older of the two.
    //
    // It read 'stale' all the same, with 'a newer build is not the one being
    // served' and tone 'attention', on a site whose newest build may well be the
    // one it serves: `newestFirst` sorts the undated row last, so the *active* row
    // was passed over and the superseded predecessor came back as the newest
    // complete build. Position is a layout, not an age.
    const undatedActive = logic.deriveReleaseChain({
      releases: [
        build({ id: 'old', status: 'superseded', created_at: '2026-07-01T09:00:00.000Z' }),
        build({
          id: 'live',
          status: 'active',
          created_at: null,
          completed_at: '2026-07-28T10:01:00.000Z',
          activated_at: '2026-07-28T10:02:00.000Z',
        }),
      ],
      items: [item()],
    })
    const built = byId(undatedActive).get('built')
    assert.notEqual(built.state, 'stale', 'the alarm this shape has no evidence for')
    assert.notEqual(built.tone, 'attention')
    assert.equal(built.state, 'unordered')
    assert.equal(built.tone, 'unknown', 'a comparison that could not be made is a gap, not a conclusion')
    assert.match(built.detail, /a build is live/, 'which build is served was answered, and it is said')
    assert.match(built.detail, /could not be read/, 'and what could not be is said too')
    assert.doesNotMatch(built.detail, /newer/, 'nothing here knows whether a newer build exists')
    // The step is dated by the build it is about, and only by an instant that
    // parsed: the active row's completed_at, never the predecessor's.
    assert.equal(built.at, '2026-07-28T10:01:00.000Z')
    // The rest of the chain still answers what it can, and the gap reaches the
    // summary rather than being implied by silence.
    assert.equal(byId(undatedActive).get('active').state, 'active')
    assert.equal(byId(undatedActive).get('live').state, 'served')
    assert.equal(undatedActive.tone, 'unknown')
    assert.deepEqual(undatedActive.exceptions, [], 'there is nothing to go and fix')
    assert.equal(undatedActive.headline, 'Part of this chain could not be read.')
    assert.doesNotMatch(undatedActive.headline, /newer build/)

    // The same gap in the other row: the served build is dated and a predecessor
    // is not, so that predecessor cannot be placed either — it might be the newer
    // one. Sorting it last is not the answer to that question.
    const undatedPredecessor = logic.deriveReleaseChain({
      releases: [
        build({ id: 'live', status: 'active', activated_at: '2026-07-20T10:02:00.000Z' }),
        build({ id: 'mystery', status: 'superseded', created_at: 'not a date', completed_at: null }),
      ],
      items: [item()],
    })
    assert.equal(byId(undatedPredecessor).get('built').state, 'unordered')
    assert.equal(byId(undatedPredecessor).get('built').tone, 'unknown')
  })

  test('an undated active build with nothing to compare it to is the only build there is', () => {
    // The gap above is about *ordering two builds*, so with one build there is no
    // gap: the newest build and the served build are the same row, whatever its
    // date says. This is the shape "a comparison that could not be made" below
    // already fixes the headline for, and it stays calm.
    const chain = logic.deriveReleaseChain({
      releases: [
        build({
          id: 'live',
          status: 'active',
          created_at: null,
          completed_at: '2026-07-28T10:01:00.000Z',
          activated_at: '2026-07-28T10:02:00.000Z',
        }),
      ],
      items: [item()],
    })
    const built = byId(chain).get('built')
    assert.equal(built.state, 'current')
    assert.equal(built.tone, 'done')
    assert.equal(chain.calm, true, 'nothing is wrong and nothing is unreadable about a single build')
    assert.match(chain.headline, /could not be checked/, 'only the published comparison is beyond it')
    // A preview is not a build of this site, so it is not something to order
    // against either — the same rule the rest of the step keeps.
    const withPreview = logic.deriveReleaseChain({
      releases: [
        {
          id: 'p1',
          kind: 'preview',
          status: 'preview',
          file_count: 9,
          created_at: '2026-07-29T09:00:00.000Z',
          completed_at: '2026-07-29T09:01:00.000Z',
          activated_at: null,
        },
        build({
          id: 'live',
          status: 'active',
          created_at: null,
          completed_at: '2026-07-28T10:01:00.000Z',
          activated_at: '2026-07-28T10:02:00.000Z',
        }),
      ],
      items: [item()],
    })
    assert.equal(byId(withPreview).get('built').state, 'current')
    assert.equal(withPreview.calm, true)
  })

  test('a build in flight outranks an ordering nobody can make', () => {
    // Precedence, stated: 'building' is a fact the list answered about a row of its
    // own, and it does not depend on ordering anything. The gap must not swallow it.
    const chain = logic.deriveReleaseChain({
      releases: [
        build({
          id: 'inflight',
          status: 'building',
          created_at: '2026-07-29T09:00:00.000Z',
          completed_at: null,
          file_count: 0,
        }),
        build({ id: 'old', status: 'superseded', created_at: '2026-07-01T09:00:00.000Z' }),
        build({
          id: 'live',
          status: 'active',
          created_at: null,
          completed_at: '2026-07-28T10:01:00.000Z',
          activated_at: '2026-07-28T10:02:00.000Z',
        }),
      ],
      items: [item()],
    })
    assert.equal(byId(chain).get('built').state, 'building')
    assert.equal(byId(chain).get('built').tone, 'attention')
  })

  test('work the served build is provably missing outranks the ordering gap too', () => {
    // The 'behind' evidence is a comparison against the *served* build's own date,
    // which parsed here — an undated predecessor makes "is a newer build waiting"
    // unanswerable without touching it. So the exception is reported, and it is not
    // downgraded to a gap.
    const chain = logic.deriveReleaseChain({
      releases: [
        build({ id: 'live', status: 'active', activated_at: '2026-07-20T10:02:00.000Z' }),
        build({ id: 'mystery', status: 'superseded', created_at: 'not a date', completed_at: null }),
      ],
      items: [item({ latest_revision_at: '2026-07-26T09:00:00.000Z' })],
    })
    const built = byId(chain).get('built')
    assert.equal(built.state, 'behind')
    assert.equal(built.tone, 'attention')
    assert.equal(built.count, 1)
    assert.equal(chain.headline, '1 published item is not in this build')
  })

  test('an active release with drafts waiting counts the drafts and dates the oldest', () => {
    const chain = logic.deriveReleaseChain({
      releases: [build({ status: 'active', activated_at: '2026-07-24T12:00:00.000Z' })],
      items: [
        item(),
        draft({ latest_revision_at: '2026-07-23T08:00:00.000Z' }),
        // A published item whose newest revision is a draft: unreleased work on
        // something that is already live. The authoring list calls it a "newer
        // draft"; it is waiting all the same.
        item({ latest_revision_status: 'draft', latest_revision_at: '2026-07-10T08:00:00.000Z' }),
        draft({ latest_revision_at: '2026-07-19T08:00:00.000Z' }),
      ],
    })
    const steps = byId(chain)
    assert.equal(steps.get('drafts').state, 'waiting')
    assert.equal(steps.get('drafts').tone, 'attention')
    assert.equal(steps.get('drafts').count, 3)
    assert.match(steps.get('drafts').detail, /^3 drafts waiting$/)
    // The oldest, not the newest: this morning's draft is work in progress and
    // the three-week-old one is what got forgotten.
    assert.equal(steps.get('drafts').at, '2026-07-10T08:00:00.000Z')
    assert.equal(steps.get('built').tone, 'done')
    assert.equal(steps.get('active').tone, 'done')
    assert.equal(chain.tone, 'attention')
    assert.equal(chain.calm, false)
    assert.equal(chain.headline, '3 drafts waiting')
  })

  test('one draft is one draft', () => {
    const chain = logic.deriveReleaseChain({ releases: [build({ status: 'ready' })], items: [draft()] })
    assert.match(byId(chain).get('drafts').detail, /^1 draft waiting$/)
    assert.equal(byId(chain).get('drafts').count, 1)
  })

  test('a scheduled revision is waiting on the clock, and is counted apart from a draft', () => {
    // POST /v1/publish-due builds and activates for these; no operator has to.
    const chain = logic.deriveReleaseChain({
      releases: [build({ status: 'active', activated_at: '2026-07-24T12:00:00.000Z' })],
      items: [
        item({ latest_revision_status: 'scheduled', latest_revision_at: '2026-06-01T08:00:00.000Z' }),
        draft({ latest_revision_at: '2026-07-23T08:00:00.000Z' }),
      ],
    })
    const drafts = byId(chain).get('drafts')
    assert.equal(drafts.count, 2)
    assert.match(drafts.detail, /1 draft waiting/)
    assert.match(drafts.detail, /1 scheduled/)
    assert.equal(drafts.at, '2026-06-01T08:00:00.000Z', 'a scheduled revision ages like every other one')
  })

  test('an archived or published newest revision is not waiting for anything', () => {
    const chain = logic.deriveReleaseChain({
      releases: [build({ status: 'active', activated_at: '2026-07-24T12:00:00.000Z' })],
      items: [item(), item({ latest_revision_status: 'archived' }), item({ latest_revision_status: null })],
    })
    const drafts = byId(chain).get('drafts')
    assert.equal(drafts.state, 'clear')
    assert.equal(drafts.tone, 'done')
    assert.equal(drafts.count, 0)
  })

  test('an active release with nothing waiting reads as calm — no row of green ticks', () => {
    const chain = logic.deriveReleaseChain({
      releases: [
        build({ id: 'old', status: 'superseded', created_at: '2026-07-01T10:00:00.000Z' }),
        build({ id: 'live', status: 'active', activated_at: '2026-07-24T12:00:00.000Z', file_count: 128 }),
      ],
      // Every one of these was written before the build being served ran
      // (2026-07-20T10:00), including the one written a millisecond before it —
      // which is what earns the headline below. The dates are the point of this
      // fixture: the assertion on that sentence used to hold whatever the dates
      // said, because nothing compared them.
      items: [item(), item(), item({ latest_revision_at: '2026-07-20T09:59:59.999Z' })],
      baseUrl: 'https://mikebild.example/',
    })
    assert.deepEqual(
      chain.steps.map((step) => step.tone),
      ['done', 'done', 'done', 'done'],
    )
    assert.equal(chain.tone, 'done')
    assert.equal(chain.calm, true)
    assert.deepEqual(chain.exceptions, [])
    assert.equal(chain.headline, 'Everything published is in the build this site serves.')
    assert.equal(byId(chain).get('built').state, 'current', 'and the build step is the one that checked it')
    const live = byId(chain).get('live')
    assert.equal(live.state, 'served')
    assert.equal(live.count, 128)
    assert.match(live.detail, /128 files/)
    assert.match(live.detail, /mikebild\.example/, 'the host it is served from, not the whole URL')
    assert.doesNotMatch(live.detail, /https/)
    // What the API cannot answer is written down rather than implied by silence.
    assert.match(chain.unverified, /pointer swap/)
    assert.match(chain.unverified, /not something this API can confirm/)
  })

  // ── Published, and not in the build being served ───────────────────────────

  test('content published after the build ran is not in it, and the chain stops saying it is', () => {
    // The state the product design is about: a release must be built *and*
    // activated. This item was written four days after the build the site serves,
    // so it cannot be in it — and it is 'published', which means draftsStep does
    // not count it and, until this state existed, nothing else did either. The
    // chain answered calm/done/no exceptions and the headline claimed
    // "Everything published is in the build this site serves."
    const chain = logic.deriveReleaseChain({
      releases: [
        {
          id: 'r1',
          kind: 'release',
          status: 'active',
          file_count: 128,
          created_at: '2026-07-24T10:00:00.000Z',
          completed_at: '2026-07-24T10:01:00.000Z',
          activated_at: '2026-07-24T10:02:00.000Z',
        },
      ],
      items: [
        {
          published_revision_id: 'rev-new',
          latest_revision_status: 'published',
          latest_revision_at: '2026-07-28T09:00:00.000Z',
        },
      ],
    })
    const steps = byId(chain)
    assert.equal(steps.get('built').state, 'behind')
    assert.equal(steps.get('built').tone, 'attention')
    assert.equal(steps.get('built').count, 1)
    assert.match(steps.get('built').detail, /^1 published item is not in this build$/)
    assert.equal(steps.get('built').at, '2026-07-28T09:00:00.000Z', 'dated by how long the live site has missed it')
    // Nothing is wrong with the *other* three steps: there is no draft waiting, a
    // release is active, and it is serving 128 files. That is exactly why this
    // state had to exist — no other step in the chain can see this.
    assert.equal(steps.get('drafts').state, 'clear')
    assert.equal(steps.get('active').tone, 'done')
    assert.equal(steps.get('live').state, 'served')
    assert.equal(chain.tone, 'attention')
    assert.equal(chain.calm, false, 'a site serving a build that is missing published work is not calm')
    assert.deepEqual(
      chain.exceptions.map((step) => step.id),
      ['built'],
    )
    assert.equal(chain.headline, '1 published item is not in this build')
    assert.doesNotMatch(chain.headline, /Everything published/, 'the sentence this state exists to stop')
  })

  test('several late items are counted, and the chain is dated by the one waiting longest', () => {
    const chain = logic.deriveReleaseChain({
      releases: [build({ id: 'live', status: 'active', activated_at: '2026-07-20T10:02:00.000Z' })],
      items: [
        item(),
        item({ latest_revision_at: '2026-07-26T09:00:00.000Z' }),
        item({ latest_revision_at: '2026-07-22T09:00:00.000Z' }),
        // Not published, so not this step's business: a draft is waiting to be
        // published, and these are waiting to be built.
        draft({ latest_revision_at: '2026-07-27T09:00:00.000Z' }),
        // Archived after the build: not published, so it is not in the count.
        item({ latest_revision_status: 'archived', latest_revision_at: '2026-07-28T09:00:00.000Z' }),
      ],
    })
    const built = byId(chain).get('built')
    assert.equal(built.state, 'behind')
    assert.equal(built.count, 2, 'the two published ones, and neither the draft nor the archived one')
    assert.match(built.detail, /^2 published items are not in this build$/)
    assert.equal(built.at, '2026-07-22T09:00:00.000Z', 'the oldest of the two, not the newest')
    // Two exceptions, worst-equal, and the chain names both in the order it holds
    // them: the draft is still waiting to be published.
    assert.deepEqual(
      chain.exceptions.map((step) => step.id),
      ['drafts', 'built'],
    )
    assert.equal(chain.headline, '1 draft waiting · 2 published items are not in this build')
  })

  test('the comparison is strictly after the build: the same instant is not evidence of anything', () => {
    // `latest_revision_at` is the newest revision's `created_at`
    // (withLatestRevision in src/repository.mjs), so "written after the build read
    // the published set" is what it can answer. An item written in the very
    // instant of `created_at` is not proof that the build missed it, and this
    // module alarms on evidence rather than on coincidence.
    const at = (latest) =>
      byId(
        logic.deriveReleaseChain({
          releases: [build({ status: 'active', activated_at: '2026-07-20T10:02:00.000Z' })],
          items: [item({ latest_revision_at: latest })],
        }),
      ).get('built')
    // build() is created_at 2026-07-20T10:00:00.000Z.
    assert.equal(at('2026-07-20T10:00:00.000Z').state, 'current', 'the same instant is in the build')
    assert.equal(at('2026-07-20T10:00:00.001Z').state, 'behind', 'one millisecond later is not')
  })

  test('a comparison that could not be made is not reported as one that passed', () => {
    // Two shapes, one rule: the calm sentence is a claim about two endpoints at
    // once, so it is made only when both answered. Neither shape is an alarm —
    // there is no evidence for one — and neither gets the claim.
    const undatedBuild = logic.deriveReleaseChain({
      releases: [build({ status: 'active', activated_at: '2026-07-24T12:00:00.000Z', created_at: 'not a date' })],
      items: [item()],
    })
    const undatedItem = logic.deriveReleaseChain({
      releases: [build({ status: 'active', activated_at: '2026-07-24T12:00:00.000Z' })],
      items: [item({ latest_revision_at: null })],
    })
    for (const [name, chain] of [
      ['the build carries no readable created_at', undatedBuild],
      ['a published item carries no readable instant', undatedItem],
    ]) {
      assert.equal(byId(chain).get('built').state, 'current', `${name}: which build is live is still known`)
      assert.equal(chain.calm, true, `${name}: absent evidence is not an alarm`)
      assert.deepEqual(chain.exceptions, [], name)
      assert.doesNotMatch(chain.headline, /Everything published/, `${name}: the claim is not earned`)
      assert.match(chain.headline, /could not be checked/, `${name}: and the summary says so`)
    }
    // One unreadable instant does not silence an item that is provably late.
    const mixed = logic.deriveReleaseChain({
      releases: [build({ status: 'active', activated_at: '2026-07-24T12:00:00.000Z' })],
      items: [item({ latest_revision_at: null }), item({ latest_revision_at: '2026-07-26T09:00:00.000Z' })],
    })
    assert.equal(byId(mixed).get('built').state, 'behind')
    assert.equal(byId(mixed).get('built').count, 1, 'the one that could be placed, and it is a floor')
  })

  test('nothing is published, so there is nothing the build can be missing', () => {
    // A site whose only content is a draft: the build being served holds no
    // published work because there is none, which is not the 'behind' state.
    const chain = logic.deriveReleaseChain({
      releases: [build({ status: 'active', activated_at: '2026-07-24T12:00:00.000Z' })],
      items: [draft({ latest_revision_at: '2026-07-28T09:00:00.000Z' })],
    })
    assert.equal(byId(chain).get('built').state, 'current')
    assert.deepEqual(
      chain.exceptions.map((step) => step.id),
      ['drafts'],
      'the draft is the only thing waiting on anybody',
    )
  })

  // ── Absent evidence ────────────────────────────────────────────────────────

  test('a list that could not be read is unknown, and never zero', () => {
    // The UsageStats contract, applied to the chain: `missing` is not 0. An
    // operator holding stats:read but not content:read must not be told that
    // nothing is waiting.
    const chain = logic.deriveReleaseChain({ releases: null, items: null })
    for (const step of chain.steps) {
      assert.equal(step.tone, 'unknown', `${step.id} must be unknown`)
      assert.equal(step.state, 'unknown', `${step.id} must say so in its state`)
      assert.notEqual(step.count, 0, `${step.id} must not report a count of 0 it never read`)
    }
    assert.equal(byId(chain).get('drafts').count, null)
    assert.equal(chain.calm, false, 'a chain with a hole in it is not a calm chain')
    assert.equal(chain.tone, 'unknown')
    assert.deepEqual(chain.exceptions, [], 'unknown is not an exception to act on — it is a gap to explain')
    assert.match(chain.headline, /could not be read/)
    assert.doesNotMatch(chain.headline, /scope/i, 'a failed request is not a missing scope; name neither')
    assert.equal(chain.unverified, null)
  })

  test('one list missing does not take the other one down with it', () => {
    const chain = logic.deriveReleaseChain({
      releases: [build({ status: 'active', activated_at: '2026-07-24T12:00:00.000Z' })],
      items: null,
    })
    const steps = byId(chain)
    assert.equal(steps.get('drafts').state, 'unknown')
    assert.equal(steps.get('active').state, 'active', 'the release list was readable and answered this')
    assert.equal(steps.get('live').state, 'served')
  })

  test('an unreadable content list is not the site holding content', () => {
    // The exact shape the bug was in. `items?.length === 0` is `undefined === 0`,
    // which is false — so a content list nobody could read was filed under "this
    // site holds content and serves none of it" and drew the red alarm on
    // evidence the code did not have. The release list said "nothing is active";
    // how bad that is, only the content list can say, and it did not answer.
    const chain = logic.deriveReleaseChain({ releases: [], items: null })
    const active = byId(chain).get('active')
    assert.equal(active.state, 'none', 'nothing is active — that part the release list did answer')
    assert.equal(active.tone, 'unknown')
    assert.notEqual(active.tone, 'blocked', 'a severity nobody can read is not the worst one')
    assert.match(active.detail, /could not be read/)
    assert.equal(chain.tone, 'unknown')
    assert.equal(chain.calm, false)
    assert.deepEqual(chain.exceptions, [], 'there is nothing to act on until the list can be read')
    assert.equal(chain.headline, 'Part of this chain could not be read.')
    assert.doesNotMatch(chain.headline, /no release is active/, 'the conclusion drawn from the absence')
  })

  test('the content list has four answers, so the active step has four', () => {
    // null, [], [draft()] and [item()] are four different facts and must not
    // collapse into fewer. Same release list — no release at all — in every one of
    // them, so the release list is not what tells them apart.
    const toneFor = (items) => byId(logic.deriveReleaseChain({ releases: [], items })).get('active')
    assert.equal(toneFor(null).tone, 'unknown', 'unreadable: the severity is not known')
    assert.equal(toneFor([]).tone, 'idle', 'empty: the site has not got there yet')
    assert.equal(toneFor([draft()]).tone, 'idle', 'written, never published: nothing is being withheld')
    assert.equal(toneFor([item()]).tone, 'blocked', 'published: the site is live in the database and served nowhere')
    const details = [toneFor(null), toneFor([]), toneFor([draft()]), toneFor([item()])].map((step) => step.detail)
    assert.equal(new Set(details).size, 4, `and each one says which of the four it is: ${details.join(' / ')}`)
    // The two calm answers are calm for different reasons and only one of them is
    // "no content": a list of drafts is content, and the severity does not follow
    // from its length.
    assert.notEqual(toneFor([]).detail, toneFor([draft()]).detail)
  })

  test('a gap in the evidence reaches the summary even when an exception is named first', () => {
    // The headline preferred the exceptions and dropped the gap entirely, so a
    // chain half of whose evidence was missing reported a conclusion and hid
    // that. The exception is still first — it is the thing to act on — and the
    // gap is not one of the two slots it competes for.
    const chain = logic.deriveReleaseChain({ releases: [build({ status: 'ready' })], items: null })
    assert.equal(byId(chain).get('built').state, 'ready')
    assert.equal(chain.tone, 'attention', 'something to act on outranks something to explain')
    assert.ok(chain.headline.startsWith('built, never activated'), chain.headline)
    assert.match(chain.headline, /part of this chain could not be read$/)
    assert.equal(chain.headline, 'built, never activated · part of this chain could not be read')
  })

  test('an unreadable release list does not make "no release is active" up', () => {
    const chain = logic.deriveReleaseChain({ releases: null, items: [item()] })
    const steps = byId(chain)
    assert.equal(steps.get('active').state, 'unknown')
    assert.equal(steps.get('built').state, 'unknown')
    assert.equal(steps.get('live').state, 'unknown')
    assert.equal(steps.get('drafts').state, 'clear', 'the content list was readable')
  })

  test('an active build with no file count is unknown, not empty', () => {
    // file_count is required by the schema and written by every build, so this is
    // the defensive branch — and it is the one where drawing a missing number as
    // 0 would report a serving site as serving nothing.
    for (const files of [null, undefined]) {
      const chain = logic.deriveReleaseChain({
        releases: [build({ status: 'active', activated_at: '2026-07-24T12:00:00.000Z', file_count: files })],
        items: [item()],
      })
      const live = byId(chain).get('live')
      assert.equal(live.state, 'unknown', `file_count: ${String(files)}`)
      assert.equal(live.tone, 'unknown')
      assert.equal(live.count, null)
      assert.notEqual(live.state, 'empty')
    }
  })

  test('an active build of zero files is the incident, and it is blocked', () => {
    // A site has already served empty pages from a release every status in the
    // console called active. Zero files is the one piece of evidence the API has.
    const chain = logic.deriveReleaseChain({
      releases: [build({ status: 'active', activated_at: '2026-07-24T12:00:00.000Z', file_count: 0 })],
      items: [item()],
    })
    const live = byId(chain).get('live')
    assert.equal(live.state, 'empty')
    assert.equal(live.tone, 'blocked')
    assert.equal(live.count, 0)
    assert.equal(chain.calm, false)
    assert.equal(chain.tone, 'blocked')
    assert.equal(chain.unverified, null, 'nothing is served, so nothing is claimed to be')
  })

  // ── Builds in flight, and builds that failed ───────────────────────────────

  test('a build in flight is reported as one', () => {
    const chain = logic.deriveReleaseChain({
      releases: [
        build({
          id: 'inflight',
          status: 'building',
          created_at: '2026-07-25T09:00:00.000Z',
          completed_at: null,
          file_count: 0,
        }),
        build({ id: 'live', status: 'active', activated_at: '2026-07-24T12:00:00.000Z' }),
      ],
      items: [item()],
    })
    const built = byId(chain).get('built')
    assert.equal(built.state, 'building')
    assert.equal(built.tone, 'attention')
    assert.equal(built.at, '2026-07-25T09:00:00.000Z')
    // The build in flight has no files yet; the live step must read the active
    // release, not whichever row happens to be newest.
    assert.equal(byId(chain).get('live').count, 42)
  })

  test('the newest build having failed is blocked, and the list cannot say why', () => {
    const chain = logic.deriveReleaseChain({
      releases: [
        build({
          id: 'bad',
          status: 'failed',
          created_at: '2026-07-25T09:00:00.000Z',
          completed_at: null,
          file_count: 0,
        }),
        build({ id: 'live', status: 'active', activated_at: '2026-07-24T12:00:00.000Z' }),
      ],
      items: [item()],
    })
    const built = byId(chain).get('built')
    assert.equal(built.state, 'failed')
    assert.equal(built.tone, 'blocked')
    assert.equal(built.at, '2026-07-25T09:00:00.000Z', 'a failure has no completed_at, so it is dated by created_at')
    // GET /v1/sites/{site}/releases projects no `error`, so nothing here may
    // pretend to quote one.
    assert.doesNotMatch(built.detail, /:/, 'no reason is quoted, because the list carries none')
    assert.equal(chain.tone, 'blocked')
  })

  test('a failure a later build already replaced is history, not an exception', () => {
    const chain = logic.deriveReleaseChain({
      releases: [
        build({
          id: 'good',
          status: 'active',
          created_at: '2026-07-25T09:00:00.000Z',
          activated_at: '2026-07-25T09:02:00.000Z',
        }),
        build({
          id: 'bad',
          status: 'failed',
          created_at: '2026-07-24T09:00:00.000Z',
          completed_at: null,
          file_count: 0,
        }),
      ],
      items: [item()],
    })
    assert.equal(byId(chain).get('built').state, 'current')
    assert.equal(chain.calm, true, 'a fixed failure must not keep the chain shouting')
  })

  test('a failure that cannot be ordered against the newest build is still a failure', () => {
    // The test above is what makes an old failure history: a *later* complete
    // build replaced it. When the failure carries no readable instant there is no
    // later and no earlier, and ordering it as the epoch — which `?? 0` did —
    // concluded "history" from evidence that says nothing.
    const chain = logic.deriveReleaseChain({
      releases: [
        build({
          id: 'good',
          status: 'active',
          created_at: '2026-07-25T09:00:00.000Z',
          activated_at: '2026-07-25T09:02:00.000Z',
        }),
        build({ id: 'bad', status: 'failed', created_at: 'not a date', completed_at: null, file_count: 0 }),
      ],
      items: [item()],
    })
    assert.equal(byId(chain).get('built').state, 'failed')
    assert.equal(byId(chain).get('built').tone, 'blocked')
    assert.equal(chain.calm, false)
    // And the same unreadable instant is not then shown as a date: it is the only
    // one this state has, so the step carries none.
    assert.equal(byId(chain).get('built').at, null)
  })

  test('a site whose only builds failed has no build to point at', () => {
    const releases = [build({ status: 'failed', completed_at: null, file_count: 0 })]
    const draftOnly = logic.deriveReleaseChain({ releases, items: [draft()] })
    assert.equal(byId(draftOnly).get('built').state, 'failed')
    assert.equal(byId(draftOnly).get('built').tone, 'blocked', 'the failure is the exception')
    assert.equal(byId(draftOnly).get('active').state, 'none')
    // And the missing activation is not a second one: nothing is published, so no
    // activation could have been serving anything. This step used to answer
    // 'blocked' here as well, on nothing more than the site holding a draft.
    assert.equal(byId(draftOnly).get('active').tone, 'idle')
    // Two exceptions, and the missing activation is neither of them: the build that
    // failed, and the draft that is waiting to be published.
    assert.deepEqual(
      draftOnly.exceptions.map((step) => step.id),
      ['built', 'drafts'],
    )
    // Publish that work and the second exception is earned: something is live in
    // the database and no release is serving it.
    const published = logic.deriveReleaseChain({ releases, items: [item()] })
    assert.equal(byId(published).get('active').tone, 'blocked')
    assert.deepEqual(
      published.exceptions.map((step) => step.id),
      ['built', 'active'],
    )
  })

  // ── What must not be mistaken for a release ────────────────────────────────

  test('a preview is never a candidate for the live site', () => {
    // A preview is a build behind an invitation; the server answers 404 for an
    // attempt to activate one. Counting it as "built" would promise a rollback
    // target that does not exist.
    const chain = logic.deriveReleaseChain({
      releases: [
        {
          id: 'p1',
          kind: 'preview',
          status: 'preview',
          file_count: 9,
          created_at: '2026-07-25T09:00:00.000Z',
          completed_at: '2026-07-25T09:01:00.000Z',
          activated_at: null,
        },
      ],
      items: [draft()],
    })
    const steps = byId(chain)
    assert.equal(steps.get('built').state, 'none', 'a preview is not a build of the site')
    assert.equal(steps.get('active').state, 'none')
    assert.equal(steps.get('live').state, 'nothing')
  })

  test('a preview being built, or one that failed, is not the site’s build', () => {
    // A preview goes through the same builder and carries the same 'building' and
    // 'failed' statuses — src/releases.mjs writes both before it knows which kind
    // it is. Reading them off the site's chain would report a preview somebody
    // else is rendering as this site's release building, and a broken preview as
    // a broken site.
    const serving = build({ id: 'live', status: 'active', activated_at: '2026-07-24T12:00:00.000Z' })
    const preview = (status) => ({
      id: `p-${status}`,
      kind: 'preview',
      status,
      file_count: 0,
      created_at: '2026-07-26T09:00:00.000Z',
      completed_at: null,
      activated_at: null,
    })
    for (const status of ['building', 'failed']) {
      const chain = logic.deriveReleaseChain({ releases: [preview(status), serving], items: [item()] })
      assert.equal(byId(chain).get('built').state, 'current', `a ${status} preview is not the site's build`)
      assert.equal(chain.calm, true)
    }
  })

  test('"active since" comes off the active row, never off the newest activated_at', () => {
    // ck_activate_release sets activated_at and never clears it, so a superseded
    // release keeps the instant it was live — and after a rollback that instant
    // is *newer* than the active one's. Reading the maximum would date the live
    // site by a release it stopped serving.
    const chain = logic.deriveReleaseChain({
      releases: [
        build({
          id: 'rolled-back',
          status: 'superseded',
          created_at: '2026-07-21T09:00:00.000Z',
          activated_at: '2026-07-21T09:05:00.000Z',
        }),
        build({
          id: 'serving',
          status: 'active',
          created_at: '2026-07-01T09:00:00.000Z',
          activated_at: '2026-07-22T07:00:00.000Z',
        }),
      ],
      items: [item()],
    })
    assert.equal(byId(chain).get('active').at, '2026-07-22T07:00:00.000Z')
    assert.equal(byId(chain).get('live').at, '2026-07-22T07:00:00.000Z')
  })

  test('the answer does not depend on the order the list arrives in', () => {
    // The endpoint documents "newest first" and the repository orders by
    // created_at desc — but a derivation that only works while that holds is one
    // ordering change away from reporting the wrong build as live.
    const rows = [
      build({ id: 'oldest', status: 'superseded', created_at: '2026-07-01T09:00:00.000Z' }),
      build({
        id: 'live',
        status: 'active',
        created_at: '2026-07-10T09:00:00.000Z',
        activated_at: '2026-07-10T09:05:00.000Z',
      }),
      build({
        id: 'newest',
        status: 'ready',
        created_at: '2026-07-21T09:00:00.000Z',
        completed_at: '2026-07-21T09:02:00.000Z',
      }),
    ]
    const expected = logic.deriveReleaseChain({ releases: rows, items: [item()] })
    for (const order of [[...rows].reverse(), [rows[1], rows[2], rows[0]], [rows[2], rows[0], rows[1]]]) {
      assert.deepEqual(logic.deriveReleaseChain({ releases: order, items: [item()] }).steps, expected.steps)
    }
    // And the newest build is the 'ready' one, which is not what is being served.
    assert.equal(byId(expected).get('built').state, 'ready')
    assert.equal(byId(expected).get('active').state, 'active')
  })

  test('of the builds ahead of the served one, the newest is the one named', () => {
    // Two complete builds postdate the build being served, and which of them the
    // step is about follows from their dates and not from where they sit in the
    // list: the newest is superseded, so the newest build is not the one being
    // served. Both orders are asserted, because a list order that happened to
    // agree with the dates would make this true by accident.
    const rows = [
      build({
        id: 'served',
        status: 'active',
        created_at: '2026-07-10T09:00:00.000Z',
        activated_at: '2026-07-10T09:05:00.000Z',
      }),
      build({
        id: 'ready',
        status: 'ready',
        created_at: '2026-07-15T09:00:00.000Z',
        completed_at: '2026-07-15T09:02:00.000Z',
      }),
      build({
        id: 'newest',
        status: 'superseded',
        created_at: '2026-07-21T09:00:00.000Z',
        completed_at: '2026-07-21T09:02:00.000Z',
      }),
    ]
    for (const order of [rows, [...rows].reverse()]) {
      const built = byId(logic.deriveReleaseChain({ releases: order, items: [item()] })).get('built')
      assert.equal(built.state, 'stale')
      assert.equal(built.at, '2026-07-21T09:02:00.000Z', 'dated by the newest build, not by the first one in the list')
    }
  })

  test('with nothing served, the step names a build it can date', () => {
    // Neither build is being served and neither is 'ready', so the step names the
    // newest — and an unreadable `created_at` is not a date this comparator will
    // rank first. Sorting the undated row last is the whole of that rule: it is not
    // evidence the row is old, which is why nothing above concludes anything from
    // the position.
    const chain = logic.deriveReleaseChain({
      releases: [
        build({ id: 'undated', status: 'superseded', created_at: 'not a date', completed_at: null }),
        build({
          id: 'dated',
          status: 'superseded',
          created_at: '2026-07-01T09:00:00.000Z',
          completed_at: '2026-07-01T09:02:00.000Z',
        }),
      ],
      items: [item()],
    })
    const built = byId(chain).get('built')
    assert.equal(built.state, 'stale')
    assert.equal(built.at, '2026-07-01T09:02:00.000Z')
  })

  test('a build nobody activated says so without any date being compared', () => {
    // 'ready' is "built, never activated" on the row itself, and nothing is served
    // here, so the step needs no ordering to report it — which is what makes the
    // answer the same whether or not the other rows carry readable instants.
    for (const other of [
      build({ id: 'old', status: 'superseded', created_at: '2026-07-01T09:00:00.000Z' }),
      build({ id: 'undated', status: 'superseded', created_at: 'not a date', completed_at: null }),
      build({ id: 'newer', status: 'superseded', created_at: '2026-07-28T09:00:00.000Z' }),
    ]) {
      const chain = logic.deriveReleaseChain({
        releases: [other, build({ id: 'waiting', status: 'ready', created_at: '2026-07-20T10:00:00.000Z' })],
        items: [item()],
      })
      const built = byId(chain).get('built')
      assert.equal(built.state, 'ready', `against ${other.id}`)
      assert.equal(built.detail, 'built, never activated')
      assert.equal(built.at, '2026-07-20T10:01:00.000Z', 'dated by the build that is waiting')
    }
  })

  test('an unreadable or absent instant is dropped rather than shown as an epoch', () => {
    const chain = logic.deriveReleaseChain({
      releases: [build({ status: 'active', activated_at: null, created_at: 'not a date' })],
      items: [draft({ latest_revision_at: null }), draft({ latest_revision_at: 'yesterday' })],
    })
    assert.equal(byId(chain).get('drafts').at, null)
    assert.equal(byId(chain).get('active').at, null)
    assert.equal(byId(chain).get('drafts').count, 2, 'a missing timestamp does not uncount the draft')
  })

  test('a base URL that is not a URL is shown as it is, not thrown over', () => {
    const chain = logic.deriveReleaseChain({
      releases: [build({ status: 'active', activated_at: '2026-07-24T12:00:00.000Z' })],
      items: [item()],
      baseUrl: 'mikebild.example',
    })
    assert.match(byId(chain).get('live').detail, /mikebild\.example/)
  })

  // ── The summary ────────────────────────────────────────────────────────────

  test('the headline names the exceptions and stops at two', () => {
    const chain = logic.deriveReleaseChain({
      releases: [
        build({
          id: 'inflight',
          status: 'building',
          created_at: '2026-07-25T09:00:00.000Z',
          completed_at: null,
          file_count: 0,
        }),
        build({ id: 'live', status: 'active', activated_at: '2026-07-24T12:00:00.000Z', file_count: 0 }),
      ],
      items: [draft()],
    })
    assert.equal(chain.exceptions.length, 3, 'drafts waiting, a build in flight, and an empty active build')
    const named = chain.headline.split(' · ')
    assert.equal(named.length, 3, 'two exceptions and a count of the rest')
    assert.match(chain.headline, /and 1 more$/)
    // Worst first, so the summary opens with the thing that is broken.
    assert.equal(chain.exceptions[0].tone, 'blocked')
    assert.ok(chain.headline.startsWith(chain.exceptions[0].detail))
  })

  test('every step is addressable by a stable state string', () => {
    // The state is the `data-state` attribute and the testid suffix, so it has to
    // be a slug rather than a sentence.
    const inputs = [
      { releases: null, items: null },
      { releases: [], items: [] },
      { releases: [build({ status: 'ready' })], items: [draft()] },
      { releases: [build({ status: 'failed', file_count: 0 })], items: [item()] },
      { releases: [build({ status: 'active', activated_at: '2026-07-24T12:00:00.000Z' })], items: [item()] },
      { releases: [build({ status: 'active', activated_at: '2026-07-24T12:00:00.000Z', file_count: 0 })], items: [] },
      { releases: [build({ status: 'building', completed_at: null })], items: [] },
      {
        releases: [build({ status: 'active', activated_at: '2026-07-24T12:00:00.000Z' })],
        items: [item({ latest_revision_at: '2026-07-28T09:00:00.000Z' })],
      },
      // Every date in this one is unreadable, which is what makes it worth
      // including: the `at` invariant below is the guard that a step never hands
      // RelativeTime a value that will not parse.
      {
        releases: [build({ status: 'failed', created_at: 'not a date', completed_at: 'nor this', file_count: 0 })],
        items: [item({ latest_revision_at: 'yesterday' }), draft({ latest_revision_at: 'soon' })],
      },
      // An active build that cannot be ordered against its predecessor: the state
      // that says which build is live and refuses to guess whether it is the newest.
      {
        releases: [
          build({ id: 'old', status: 'superseded', created_at: '2026-07-01T09:00:00.000Z' }),
          build({ id: 'live', status: 'active', created_at: null, activated_at: '2026-07-28T10:02:00.000Z' }),
        ],
        items: [item()],
      },
    ]
    const seen = new Set()
    for (const input of inputs) {
      for (const step of logic.deriveReleaseChain(input).steps) {
        assert.match(step.state, /^[a-z]+$/, `${step.id} is in state "${step.state}"`)
        assert.ok(step.detail.length > 0, `${step.id} says nothing`)
        assert.ok(['done', 'idle', 'unknown', 'attention', 'blocked'].includes(step.tone))
        assert.ok(step.at === null || !Number.isNaN(new Date(step.at).valueOf()), `${step.id} carries a bad instant`)
        seen.add(`${step.id}:${step.state}`)
      }
    }
    // Every state these tests claim exists is reachable from a real shape.
    for (const state of [
      'drafts:unknown',
      'drafts:empty',
      'drafts:clear',
      'drafts:waiting',
      'built:unknown',
      'built:none',
      'built:building',
      'built:failed',
      'built:ready',
      'built:current',
      'built:behind',
      'built:unordered',
      'active:unknown',
      'active:none',
      'active:active',
      'live:unknown',
      'live:nothing',
      'live:empty',
      'live:served',
    ]) {
      assert.ok(seen.has(state), `${state} is documented but no input above produces it`)
    }
  })
})

// ── What only the sources can be asked ───────────────────────────────────────

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const openingTags = (text, tag) =>
  [...stripComments(text).matchAll(new RegExp(`<${tag}\\b(?:[^>]|=>)*>`, 'g'))].map((hit) => hit[0])

describe('the release chain, on screen', () => {
  test('every step and its state are addressable in the browser', () => {
    // The standing rule for this console, and the chain's own requirement: one
    // testid per step plus one for the state it is in.
    for (const suffix of ['-step-${step.id}', '-state-${step.id}', '-dot-${step.id}', '-headline']) {
      assert.ok(
        chainSource.includes(`\${testId}${suffix}`) || chainSource.includes(`${suffix}`),
        `the chain must render a data-testid ending in ${suffix}`,
      )
    }
    // Both variants render the four steps, and a state readable in one layout and
    // not the other is a testid that works until somebody changes the variant.
    const occurrences = (pattern) => (chainSource.match(pattern) ?? []).length
    assert.equal(occurrences(/data-state=\{step\.state\}/g), 2, 'both variants must expose the state they drew')
    assert.equal(occurrences(/data-tone=\{step\.tone\}/g), 2, 'and how loudly they drew it')
    assert.equal(occurrences(/data-testid=\{`\$\{testId\}-step-\$\{step\.id\}`\}/g), 2, 'and the step itself')
  })

  test('every interactive element carries a data-testid', () => {
    for (const tag of ['AppLink', 'button', 'Button', 'a']) {
      for (const opening of openingTags(chainSource, tag)) {
        assert.ok(/data-testid/.test(opening), `release-chain.tsx renders <${tag}> with no data-testid: ${opening}`)
      }
    }
  })

  test('the chain is built on the primitives, not on a second copy of them', () => {
    assert.match(chainSource, /from '@\/components\/ui\/relative-time'/, '"active since" is RelativeTime’s job')
    assert.match(chainSource, /from '@\/components\/ui\/skeleton'/, 'and the loading state is the skeleton’s')
    assert.doesNotMatch(
      chainSource,
      /Intl\.RelativeTimeFormat/,
      'a second relative formatter would drift from the first',
    )
    assert.doesNotMatch(chainSource, /animate-pulse/, 'the placeholder shapes belong to Skeleton')
    assert.match(chainSource, /from '@\/components\/app-link'/, 'an in-app link has to carry ?site= forward')
  })

  test('nothing here reached for a dependency the console does not already have', () => {
    const dependencies = new Set(
      Object.keys(JSON.parse(readFileSync(join(root, 'apps', 'cockpit', 'package.json'), 'utf8')).dependencies ?? {}),
    )
    for (const [name, text] of [
      ['components/ui/release-chain.tsx', chainSource],
      ['lib/release-chain.ts', chainLogic],
      ['pages/overview.tsx', overview],
    ]) {
      for (const [, imported] of text.matchAll(/from '([^']+)'/g)) {
        if (imported.startsWith('@/') || imported.startsWith('.')) continue
        assert.ok(dependencies.has(imported), `${name} imports "${imported}", which is not a Cockpit dependency`)
      }
    }
  })

  test('the derivation is a module of its own, and the component holds none of it', () => {
    // A rule written in JSX cannot be driven by the tests above, which is how the
    // console ended up with a chain nobody could check.
    assert.match(chainSource, /from '@\/lib\/release-chain'/)
    assert.doesNotMatch(chainSource, /latest_revision_status|file_count|'superseded'/, 'that is the derivation’s work')
    // Node imports the module by stripping types; a component in it could not be
    // loaded here, and a rule that cannot be loaded cannot be driven.
    assert.doesNotMatch(chainLogic, /<\/[A-Za-z]|\/>/, 'the derivation module must stay free of JSX')
    assert.doesNotMatch(chainLogic, /from 'react'/, 'nor may it reach into React')
  })

  test('the compact variant is the same derivation, laid out differently', () => {
    // In scope only because it costs no second reading of the two endpoints: both
    // variants take the derived chain as a prop.
    assert.match(chainSource, /variant\?:\s*'card' \| 'compact'/)
    assert.match(chainSource, /chain: ReleaseChainState/, 'the chain is derived once, by the caller')
    assert.doesNotMatch(chainSource, /deriveReleaseChain\(/, 'a component that derives its own would derive it twice')
    // Progressive disclosure, and the reason the variant exists at all: a chain
    // with nothing wrong in it is one line, and a chain with an exception in it
    // earns the block. A page that always drew the block would be spending the
    // same pixels on a site with nothing to say.
    assert.match(overview, /variant=\{chain\.calm \? 'compact' : 'card'\}/)
    assert.match(chainSource, /isLoading/, 'and the wait is a skeleton rather than the word "Loading…"')
    assert.match(overview, /isLoading=\{chainLoading\}/)
  })

  test('a missing count is never drawn as a zero', () => {
    // The UsageStats contract this page already keeps, applied to the chain.
    assert.match(
      chainSource,
      /typeof step\.count === 'number' && step\.count > 0/,
      'the count renders only when the endpoint answered a number',
    )
  })

  test('the overview reads the two lists the chain is derived from, and turns absence into null', () => {
    assert.match(overview, /ck\.releases\.list\(site\)/)
    assert.match(overview, /ck\.content\.list\(site\)/)
    assert.match(overview, /releases:\s*releases\.data \?\? null/, 'an unanswered list is null, not []')
    assert.match(overview, /items:\s*content\.data \?\? null/)
    assert.doesNotMatch(
      overview,
      /(?:releases|content)\.data \?\? \[\]/,
      'an empty array here would mean "nothing waiting"',
    )
    assert.match(overview, /can\('content:read'\)/, 'both lists are content:read; this page’s scope is stats:read')
    // Per query, not once in the file: this page already carried `retry: false`
    // on its stats tiles, so a file-wide match would have been true before either
    // of these two queries existed.
    for (const call of ['ck.releases.list(site)', 'ck.content.list(site)']) {
      const start = overview.indexOf(call)
      assert.ok(start > 0, `${call} is not called`)
      const block = overview.slice(start, overview.indexOf('\n  })', start))
      assert.match(block, /retry: false/, `${call}: a 403 does not become true by being asked again`)
      assert.match(block, /enabled: Boolean\(site\) && canReadChain/, `${call}: asked only when it can be answered`)
    }
  })

  test('the Releases page and the chain give one release one answer about its files', () => {
    // liveStep calls an absent file_count 'unknown' for a stated reason: a build
    // of zero files is an active release that serves nothing, which is how a site
    // once came to answer empty pages while every status read green. This page
    // printed that same absence as "0 files" — the incident's own value — so the
    // Overview and the Releases page disagreed about one release.
    // Read past the comments: this file's own reasons quote the defect they are
    // about, and a rule that trips over the sentence explaining it is no rule.
    //
    // The ban used to be spelled `?? 0`, and while it held, the derivation went on
    // to sort by `time(created_at) ?? -1` — the same substitution of a number for
    // an instant nobody could read, one character to the side, and the guard read
    // straight past it. Swapping -1 back to 0 went red, which is a spelling check
    // and not a rule. So the rule is the class: in the derivation no fallback
    // operator may answer missing evidence with a number, whichever number it is.
    //
    // Scoped to this module deliberately. `??`/`||` onto a number is legitimate
    // arithmetic elsewhere — overview.tsx guards a zero span with `max - min || 1`
    // — and this file does no arithmetic on anything but instants and counts it has
    // already established. A regex cannot catch the class in every spelling
    // (`x === null ? 0 : x` is the same lie), so the two behavioural tests carry
    // that weight: "a failure that cannot be ordered against the newest build is
    // still a failure" and "an active build with no readable date is not a stale
    // build" both fail the moment an unreadable instant is given a number.
    const defaulted = [...stripComments(chainLogic).matchAll(/(?:\?\?|\|\|)\s*-?\d+(?:\.\d+)?/g)].map((hit) => hit[0])
    assert.deepEqual(defaulted, [], `the derivation answers missing evidence with a number: ${defaulted.join(', ')}`)
    assert.doesNotMatch(stripComments(releasesPage), /file_count \?\? 0/, 'and the page has to keep it')
    assert.doesNotMatch(stripComments(releasesPage), /\?\? 0/, 'in every column, not only that one')
    assert.match(releasesPage, /count === null \|\| count === undefined/, 'absent is tested for, not defaulted away')
    assert.match(releasesPage, /'no file count reported'/, 'and named')
    assert.match(releasesPage, /\{fileCount\(active\.file_count\)\}/, 'the live summary goes through it')
    assert.match(releasesPage, /count === 1 \? 'file' : 'files'/, 'and one file is not "1 files"')
  })

  test('the overview draws no missing product total as a zero either', () => {
    // The same class of lie, one file over: `Number(totals[name] ?? 0)` answered a
    // total the payload never sent with the one number an operator reads as "this
    // happened, nought times" — in the same function whose next three lines
    // already refuse to do that to the points.
    assert.doesNotMatch(stripComments(overview), /\?\? 0/)
    assert.match(overview, /typeof totals\[name\] === 'number' \? totals\[name\] : null/)
  })

  test('the overview still refuses to draw a missing statistic as zero', () => {
    // The contract this page already had. A chain added above the tiles must not
    // cost it: `missing` stays null all the way into the sparkline. Both halves
    // are named, because the totals and the buckets are two separate reads and
    // the totals one is what the tile prints.
    assert.match(overview, /metric\.value_state === 'missing' \? null/, 'a missing usage total is null, not 0')
    assert.match(overview, /point\.value_state === 'missing' \? null : point\.value/)
    assert.match(overview, /if \(metric\.total === null\) return '—'/, 'and null prints as an em dash')
    assert.match(overview, /value === null/, 'the sparkline breaks the line at a gap rather than bridging it')
  })

  test('the page declares the two paths it now reaches', () => {
    // cockpit-navigation.test.mjs requires the declaration and the code to agree.
    // Repeated here so the reason is written where the change was made.
    // The Overview entry alone: the next `to:` ends it. Slicing to '/sites'
    // instead swept in the Content entry, which declares the content path itself
    // — and made half of this test true whatever Overview said.
    const start = shell.indexOf("to: '/',")
    assert.ok(start > 0, 'the Overview nav entry is not where this test looks for it')
    const entry = shell.slice(start, shell.indexOf('to: ', start + 8))
    assert.match(entry, /'\/v1\/sites\/\{site\}\/content'/)
    assert.match(entry, /'\/v1\/sites\/\{site\}\/releases'/)
    assert.match(entry, /'\/v1\/sites\/\{site\}\/stats\/\*'/, 'and keeps the one it already had')
  })
})
