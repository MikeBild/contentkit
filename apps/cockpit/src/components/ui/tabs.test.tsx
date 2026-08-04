import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TabPanel, Tabs } from '@/components/ui/tabs'

/**
 * The console's own tab strip, graded by the accessibility tree rather than by
 * the strings the file contains.
 *
 * This is not shadcn's Tabs. `components/ui/tabs.tsx` is ours — written so the
 * panels stay mounted while the inactive ones are hidden, which shadcn's does
 * not do — so its ARIA contract is ours to keep and ours to pin. Nothing was
 * pinning it: a mutation that deleted `role="tabpanel"` from `TabPanel`
 * altogether left 982 assertions green, because every test that touches a tab
 * in this repository reads source text and the string it looks for is the
 * caller's `<TabPanel`, not the role the caller never writes.
 *
 * Four claims are asked of the DOM here, and the second is the one that costs
 * something on a real page:
 *
 *  1. it is a tablist, and the tab that is selected says so;
 *  2. **only the panel on screen is a `tabpanel` at all** — a hidden panel is
 *     out of the accessibility tree entirely, so anything rendered into an
 *     inactive one is on nobody's screen and in nobody's ear. That is the
 *     hazard `pages/compositions.test.tsx` holds a page to;
 *  3. every tab points at a panel that exists and every panel is named by its
 *     tab — asserted because until this file the opposite was true: `Tabs`
 *     wrote `aria-controls={`${useId()}-${id}-panel`}` and `TabPanel` carried no
 *     `id`, so every tab in the console announced that it controlled an element
 *     that has never existed;
 *  4. ←/→ move between tabs, skip a disabled one, and take the focus ring with
 *     them.
 */

const TABS = [
  { id: 'one' as const, label: 'One' },
  { id: 'two' as const, label: 'Two' },
  { id: 'three' as const, label: 'Three', disabled: true },
]

/**
 * The shape every caller in the console has: a strip and its panels as
 * siblings, with the page holding the value.
 *
 * `group` is threaded through so the same harness renders both halves of claim
 * 3 — the strip that names a group and wires the pair, and the strip that does
 * not and must therefore emit no reference at all rather than a broken one.
 */
function Strip({ group }: { group?: string }) {
  const [tab, setTab] = useState<'one' | 'two' | 'three'>('one')
  return (
    <div>
      <Tabs data-testid="ck-test-tabs" group={group} value={tab} onValueChange={setTab} tabs={TABS} />
      <TabPanel active={tab === 'one'} group={group} id="one" data-testid="ck-test-panel-one">
        the first panel
      </TabPanel>
      <TabPanel active={tab === 'two'} group={group} id="two" data-testid="ck-test-panel-two">
        the second panel
      </TabPanel>
      <TabPanel active={tab === 'three'} group={group} id="three" data-testid="ck-test-panel-three">
        the third panel
      </TabPanel>
    </div>
  )
}

/** Every id one element points another at, and whether it lands on anything. */
function danglingReferences(root: HTMLElement) {
  const out: string[] = []
  for (const attribute of ['aria-controls', 'aria-labelledby', 'aria-describedby']) {
    for (const node of root.querySelectorAll(`[${attribute}]`)) {
      for (const id of (node.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean)) {
        if (!root.querySelector(`#${CSS.escape(id)}`)) out.push(`${node.tagName.toLowerCase()}[${attribute}=${id}]`)
      }
    }
  }
  return out
}

describe('Tabs — the console’s own strip, and the panels it does not unmount', () => {
  it('is a tablist whose selected tab says which one it is', () => {
    render(<Strip group="ck-test" />)

    const strip = screen.getByRole('tablist')
    expect(strip).toHaveAttribute('data-testid', 'ck-test-tabs')

    // Three tabs, one selected — read off the tree, so a strip of divs with the
    // right classes fails here.
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(screen.getByRole('tab', { name: 'One', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Two', selected: false })).toBeInTheDocument()
    // Exactly one tab stop in the strip: the roving tabindex is what stops a
    // keyboard walking three controls to leave a group of three.
    expect(tabs.filter((tab) => tab.getAttribute('tabindex') === '0')).toHaveLength(1)
  })

  it('makes only the panel on screen a tabpanel — a hidden one is in nobody’s accessibility tree', () => {
    render(<Strip group="ck-test" />)

    // The claim, and the whole of it: three panels are mounted, one is a
    // tabpanel. `getAllByRole` reads the accessibility tree, and `hidden`
    // removes an element from it — which is exactly why an Alert rendered into
    // an inactive panel announces to nobody.
    const panels = screen.getAllByRole('tabpanel')
    expect(panels).toHaveLength(1)
    expect(panels[0]).toHaveAttribute('data-testid', 'ck-test-panel-one')
    expect(panels[0]).toHaveTextContent('the first panel')

    // Mounted, though — that is the reason this component exists. The other two
    // are in the document with their state intact and out of the tree.
    expect(screen.getByTestId('ck-test-panel-two')).toBeInTheDocument()
    expect(screen.getByTestId('ck-test-panel-two')).not.toBeVisible()
    expect(screen.queryByRole('tabpanel', { name: 'Two' })).toBeNull()
  })

  it('points every tab at a panel that exists, and names every panel by its tab', () => {
    const { container } = render(<Strip group="ck-test" />)

    for (const id of ['one', 'two', 'three']) {
      const tab = document.getElementById(`ck-test-tab-${id}`)
      const panel = document.getElementById(`ck-test-panel-${id}`)
      expect(tab).not.toBeNull()
      expect(panel).not.toBeNull()
      // Both directions, because a reader uses both: the tab says where its
      // panel is, the panel says which tab named it.
      expect(tab).toHaveAttribute('aria-controls', `ck-test-panel-${id}`)
      expect(panel).toHaveAttribute('aria-labelledby', `ck-test-tab-${id}`)
    }
    // The panel on screen therefore has the tab's words as its accessible name.
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('One')
    expect(danglingReferences(container)).toEqual([])
  })

  it('emits no reference at all when the caller names no group — never a broken one', () => {
    const { container } = render(<Strip />)

    // The state every strip in this console was in. A dangling `aria-controls`
    // announces "controls a panel" and then has no panel to go to, which is
    // worse than saying nothing; so an unconverted strip says nothing.
    for (const tab of screen.getAllByRole('tab')) expect(tab).not.toHaveAttribute('aria-controls')
    expect(screen.getByRole('tabpanel')).not.toHaveAttribute('aria-labelledby')
    expect(danglingReferences(container)).toEqual([])
  })

  it('moves between tabs with ←/→, and the panel on screen moves with them', async () => {
    const user = userEvent.setup()
    render(<Strip group="ck-test" />)

    await user.tab()
    expect(screen.getByRole('tab', { name: 'One' })).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Two', selected: true })).toBeInTheDocument()
    // The panel, not just the tab: a strip that changes its own highlight and
    // leaves the content behind is the mutation this case exists to catch.
    expect(screen.getByRole('tabpanel')).toHaveTextContent('the second panel')
    // And focus went with the selection, rather than staying on a tab that now
    // draws as unselected and holds tabIndex={-1}.
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('the first panel')
  })

  it('skips a disabled tab and never opens its panel', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<Strip group="ck-test" />)

    await user.tab()
    // Two enabled tabs, so ←/→ cycle between them: the third is stepped over
    // rather than selected and then refused, which would flash a panel the
    // reader cannot have.
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'One', selected: true })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Three' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('the first panel')
  })
})
