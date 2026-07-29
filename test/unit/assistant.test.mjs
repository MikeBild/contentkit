import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { createAssistant, createElicitations, jsonSafe } from '../../src/assistant.mjs'
import { visibleTools } from '../../src/mcp/tools.mjs'

const config = {
  anthropicApiKey: 'sk-ant-test',
  assistantModel: 'claude-sonnet-5',
  mcpElicitationTimeoutMs: 60_000,
}

const deps = { logger: { info() {}, warn() {}, error() {} }, usage: {}, repo: {} }

describe('the authoring assistant', () => {
  test('does not exist without a credential', () => {
    // Credential = enabled. No second switch to fall out of step with the key.
    assert.equal(createAssistant({ ...config, anthropicApiKey: '' }, deps), null)
    assert.ok(createAssistant(config, deps))
  })

  test('offers exactly the tools the principal is already allowed on MCP', () => {
    // The assistant must not be a way around the scope ceiling, so it reuses
    // the same filter rather than keeping its own list. Asked of the assistant,
    // not of `visibleTools`: comparing the filter to itself would still pass
    // with the filter removed from the assistant entirely.
    const assistant = createAssistant(config, deps)
    const reader = { scopes: ['content:read'], site_ids: [] }
    const admin = { scopes: ['*'], site_ids: [] }
    const readerTools = assistant.toolNames(reader)
    const adminTools = assistant.toolNames(admin)

    assert.deepEqual(
      readerTools.toSorted(),
      visibleTools(reader)
        .map((candidate) => candidate.name)
        .toSorted(),
    )
    assert.deepEqual(
      adminTools.toSorted(),
      visibleTools(admin)
        .map((candidate) => candidate.name)
        .toSorted(),
    )

    assert.ok(readerTools.length > 0)
    assert.ok(adminTools.length > readerTools.length)
    assert.ok(!readerTools.includes('contentkit_manage_api_keys'))
    assert.ok(adminTools.includes('contentkit_manage_api_keys'))
  })

  test('an unknown or already settled elicitation is refused, not silently accepted', () => {
    const assistant = createAssistant(config, deps)
    // The console turns this into "expired" rather than telling the operator
    // their approval took effect.
    assert.equal(assistant.resolveElicitation('never-issued', { action: 'accept' }), false)
  })
})

// The registry is what carries ContentKit's confirmation contract across the
// browser hop, so it is tested directly rather than through a live model turn.
describe('the elicitation bridge', () => {
  function emitOnce(elicitations, options = {}) {
    let emitted
    const pending = elicitations.request(
      { mode: 'form', message: 'Publish the release?' },
      { timeoutMs: 60_000, onEmit: (payload) => (emitted = payload), ...options },
    )
    return {
      pending,
      get emitted() {
        return emitted
      },
    }
  }

  test('the waiting tool call receives exactly the human decision', async () => {
    const elicitations = createElicitations()
    const { pending, emitted } = emitOnce(elicitations)

    assert.ok(emitted.id, 'the browser needs an id to answer with')
    assert.equal(emitted.message, 'Publish the release?')
    assert.equal(elicitations.size, 1)

    assert.equal(elicitations.resolve(emitted.id, { action: 'accept', content: { confirmed: true } }), true)
    assert.deepEqual(await pending, { action: 'accept', content: { confirmed: true } })
    assert.equal(elicitations.size, 0, 'a settled elicitation must not stay pending')
  })

  test('a decision cannot be replayed onto a settled elicitation', async () => {
    const elicitations = createElicitations()
    const { pending, emitted } = emitOnce(elicitations)
    elicitations.resolve(emitted.id, { action: 'decline' })
    await pending
    // Approving after the fact must not resurrect the operation.
    assert.equal(elicitations.resolve(emitted.id, { action: 'accept', content: { confirmed: true } }), false)
  })

  test('an unanswered card expires as a cancel, which changes nothing', async () => {
    const elicitations = createElicitations()
    const { pending } = emitOnce(elicitations, { timeoutMs: 5 })
    // confirm() treats anything other than accept+confirmed as "cancelled; no
    // change was made", so an ignored card is safe by construction.
    assert.deepEqual(await pending, { action: 'cancel' })
    assert.equal(elicitations.size, 0)
  })

  test('abandoning the conversation fails the tool call closed', async () => {
    const elicitations = createElicitations()
    const controller = new AbortController()
    const { pending } = emitOnce(elicitations, { signal: controller.signal })

    controller.abort()
    await assert.rejects(pending, /interrupted/)
    // No approval may outlive the stream that asked for it.
    assert.equal(elicitations.size, 0)
  })

  test('a request on an already-dead stream never even asks', async () => {
    const elicitations = createElicitations()
    const controller = new AbortController()
    controller.abort()
    let asked = false
    await assert.rejects(
      elicitations.request(
        { mode: 'form', message: 'Publish?' },
        { timeoutMs: 60_000, signal: controller.signal, onEmit: () => (asked = true) },
      ),
      /interrupted/,
    )
    assert.equal(asked, false, 'an aborted turn must not show the operator a card')
  })
})

// A tool result becomes a model message, and only JSON values are valid there.
// Postgres returns timestamptz as Date through `pg`, so almost every tool that
// returns a row used to fail the whole turn — after the tool had already run
// and its effect had already happened.
describe('tool results are normalised before they reach the model', () => {
  test('Date instances become ISO strings instead of failing the turn', () => {
    const at = new Date('2026-07-29T11:46:59.000Z')
    const safe = jsonSafe({ sites: [{ id: 's1', created_at: at, settings: { nested: { at } } }] })
    assert.equal(safe.sites[0].created_at, '2026-07-29T11:46:59.000Z')
    assert.equal(safe.sites[0].settings.nested.at, '2026-07-29T11:46:59.000Z')
    assert.deepEqual(JSON.parse(JSON.stringify(safe)), safe, 'the result must be a plain JSON value')
  })

  test('a tool that returns nothing yields null, never undefined', () => {
    // `undefined` is not a JSON value either, and the SDK rejects it the same way.
    assert.equal(jsonSafe(undefined), null)
    assert.equal(jsonSafe(null), null)
  })

  test('ordinary values pass through unchanged', () => {
    for (const value of [{ a: 1, b: [true, 'x', null] }, [], 'text', 0, false]) {
      assert.deepEqual(jsonSafe(value), value)
    }
  })
})
