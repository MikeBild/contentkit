// What the exposition promises about the assistant's model spend.
//
// WHY THIS FILE EXISTS. Until 2026-08-20 contentkit exposed fourteen metric
// families and not one of them mentioned a model, while `POST
// /v1/assistant/messages` called claude-sonnet-5 on every turn with a
// production API key. The tokens were spent, billed by the provider, and
// absent from the exposition — findable only by holding an invoice against
// nothing. Five sibling products already counted theirs.
//
// The assertions below are mostly about ARITHMETIC rather than plumbing,
// because the way this goes wrong is not a missing counter. It is a counter
// that sums to the wrong number and looks fine.

import assert from 'node:assert/strict'
import test from 'node:test'
import { createMetrics } from '../../src/metrics.mjs'

const MODEL = 'claude-sonnet-5'

/** One turn as the AI SDK reports it: totals, with details that decompose them. */
const usage = ({ input = 0, output = 0, read = 0, write = 0, reasoning = 0 } = {}) => ({
  inputTokens: input,
  outputTokens: output,
  totalTokens: input + output,
  inputTokenDetails: { noCacheTokens: input - read - write, cacheReadTokens: read, cacheWriteTokens: write },
  outputTokenDetails: { textTokens: output - reasoning, reasoningTokens: reasoning },
})

const lines = (text, prefix) => text.split('\n').filter((line) => line.startsWith(prefix))
const value = (text, needle) =>
  Number(
    text
      .split('\n')
      .find((line) => line.startsWith(needle))
      ?.split(' ')
      .pop(),
  )

test('a turn is recorded once, however many model steps it took', () => {
  const m = createMetrics()
  m.llm({ model: MODEL, durationMs: 900, usage: usage({ input: 1200, output: 80 }) })
  const out = m.render(0)

  assert.equal(value(out, `contentkit_llm_calls_total{model="${MODEL}",outcome="success"}`), 1)
  assert.equal(value(out, `contentkit_llm_call_duration_milliseconds_total{model="${MODEL}"}`), 900)
})

test('the direction label partitions the tokens — summing it cannot double count', () => {
  // The defect this guards against was in the first draft: reasoning tokens
  // carried a `direction` of their own beside input and output, although the
  // provider reports them as part of output. Summing the label over-reported
  // every turn that reasoned, silently and only for those turns.
  const m = createMetrics()
  m.llm({ model: MODEL, usage: usage({ input: 900, output: 40, read: 800, write: 100, reasoning: 5 }) })
  const out = m.render(0)

  const total = lines(out, 'contentkit_llm_tokens_total{').reduce((sum, line) => sum + Number(line.split(' ').pop()), 0)
  assert.equal(total, 940, 'input + output and nothing else')
  assert.equal(lines(out, 'contentkit_llm_tokens_total{').length, 2)
})

test('cache and reasoning are published as breakdowns, under their own names', () => {
  const m = createMetrics()
  m.llm({ model: MODEL, usage: usage({ input: 900, output: 40, read: 800, write: 100, reasoning: 5 }) })
  const out = m.render(0)

  assert.equal(value(out, `contentkit_llm_cached_tokens_total{model="${MODEL}",kind="read"}`), 800)
  assert.equal(value(out, `contentkit_llm_cached_tokens_total{model="${MODEL}",kind="write"}`), 100)
  assert.equal(value(out, `contentkit_llm_reasoning_tokens_total{model="${MODEL}"}`), 5)
  // The HELP line is the only place a reader learns not to add these to the
  // totals. If it goes, the family becomes a trap.
  assert.match(out, /# HELP contentkit_llm_cached_tokens_total .*not additional to them/)
  assert.match(out, /# HELP contentkit_llm_reasoning_tokens_total .*not additional to them/)
})

test('turns accumulate rather than replace', () => {
  const m = createMetrics()
  m.llm({ model: MODEL, durationMs: 100, usage: usage({ input: 10, output: 1 }) })
  m.llm({ model: MODEL, durationMs: 250, usage: usage({ input: 20, output: 2 }) })
  const out = m.render(0)

  assert.equal(value(out, `contentkit_llm_calls_total{model="${MODEL}",outcome="success"}`), 2)
  assert.equal(value(out, `contentkit_llm_tokens_total{model="${MODEL}",direction="input"}`), 30)
  assert.equal(value(out, `contentkit_llm_call_duration_milliseconds_total{model="${MODEL}"}`), 350)
})

test('a provider that omits a field contributes zero, never NaN', () => {
  // Every field in the SDK's usage type is `number | undefined`. One NaN
  // reaching a counter poisons that series for the life of the process, and
  // Prometheus will scrape it happily.
  const m = createMetrics()
  m.llm({ model: MODEL, usage: { inputTokens: 500 } })
  m.llm({ model: MODEL, usage: {} })
  m.llm({ model: MODEL })
  const out = m.render(0)

  assert.equal(value(out, `contentkit_llm_tokens_total{model="${MODEL}",direction="input"}`), 500)
  assert.equal(value(out, `contentkit_llm_tokens_total{model="${MODEL}",direction="output"}`), 0)
  assert.ok(!out.includes('NaN'), 'no counter may render NaN')
  assert.ok(!out.includes('undefined'), 'no counter may render undefined')
})

test('a failed turn is counted under its own outcome, not dropped', () => {
  // A failure still consumed input tokens the provider bills. Counting only
  // successes is how a failing assistant comes to look free.
  const m = createMetrics()
  m.llm({ model: MODEL, outcome: 'error', durationMs: 40 })
  const out = m.render(0)

  assert.equal(value(out, `contentkit_llm_calls_total{model="${MODEL}",outcome="error"}`), 1)
})

test('the process gauges are present, so "is it healthy" is answerable here', () => {
  const out = createMetrics().render(0)
  for (const family of [
    'contentkit_process_memory_heap_used_bytes',
    'contentkit_process_memory_heap_total_bytes',
    'contentkit_process_memory_rss_bytes',
    'contentkit_process_uptime_seconds',
  ]) {
    assert.match(out, new RegExp(`^# TYPE ${family} gauge$`, 'm'))
    assert.ok(Number.isFinite(value(out, family)), `${family} must render a number`)
  }
})

test('an exposition with no assistant traffic still declares its families', () => {
  // A family that appears only after it first fires is a family a monitor
  // cannot catalogue — the defect watchkit 0.23.1 was released to fix, seen
  // from the producing side.
  const out = createMetrics().render(0)
  for (const family of [
    'contentkit_llm_calls_total',
    'contentkit_llm_tokens_total',
    'contentkit_llm_cached_tokens_total',
    'contentkit_llm_reasoning_tokens_total',
    'contentkit_llm_call_duration_milliseconds_total',
  ]) {
    assert.match(out, new RegExp(`^# TYPE ${family} counter$`, 'm'), `${family} must be declared before it fires`)
  }
})
