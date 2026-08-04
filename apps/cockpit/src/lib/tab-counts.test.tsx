import { describe, expect, it } from 'vitest'
import { tabCountLabel } from '@/lib/tab-counts'

/**
 * A count that could not be read must not look like a count of zero.
 *
 * Both used to render nothing, so a badge query that failed put "nothing waiting"
 * on the strip beside a panel holding thirty rows — an adversarial pass drove it
 * and confirmed it. Silence on a tab is the reader's evidence that the queue is
 * empty; a failure may not borrow that evidence. UI-UX.md section 4 states the rule
 * in general and this is the surface where it was broken.
 */
describe('a tab badge tells zero from unknown', () => {
  it('prints nothing for a measured zero, because an empty queue needs no pixels', () => {
    expect(tabCountLabel(0)).toBeNull()
  })

  it('prints an em dash for a count that was asked for and refused', () => {
    expect(tabCountLabel('unknown')).toBe('—')
  })

  it('prints nothing while the count has not been asked for yet', () => {
    // Distinct from a refusal on purpose: a dash that flickers on every page load
    // would train the reader to ignore the one that means something.
    expect(tabCountLabel(undefined)).toBeNull()
  })

  it('prints the number when there is one', () => {
    expect(tabCountLabel(12)).toBe('12')
    expect(tabCountLabel(3, { noun: 'pending' })).toBe('3 pending')
    expect(tabCountLabel(200, { atLeast: true })).toBe('200+')
  })

  it('keeps the unknown dash unqualified — a noun on a number nobody has is a claim', () => {
    expect(tabCountLabel('unknown', { noun: 'pending', atLeast: true })).toBe('—')
  })
})
