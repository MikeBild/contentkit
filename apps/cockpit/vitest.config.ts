import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ THIS RUNNER EXISTING IS NOT THE SAME THING AS BEHAVIOUR BEING COVERED.    │
 * │                                                                           │
 * │ It grades 62 contracts. 16 named flows — the sidebar collapse and its     │
 * │ tooltips, the unsaved-changes guard, the wizard step gate, the site       │
 * │ switcher, the data table's four branches, all sixteen Dialog CALL SITES   │
 * │ (the component itself is covered now; what each caller does with it is    │
 * │ not), thirteen of the pages — have NO rendering test and are still graded │
 * │ by grep.                                                                  │
 * │                                                                           │
 * │ The ledger, and the floor that stops either number moving by accident:    │
 * │     test/unit/cockpit-behavioural-floor.test.mjs                          │
 * │ Read it before you read the rest of this file, and before you conclude    │
 * │ from a green run that a component behaves.                                │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * The runner that can see behaviour — for the part of the console it reaches.
 *
 * Every other test in this repository reads source text: it greps for
 * `<AlertDialogContent`, finds it, and concludes that focus is trapped, returned
 * and Escape-dismissable. Three runtime behaviours, none of them visible to a
 * string match — and two mutations (an `onCloseAutoFocus` opt-out on the
 * confirmation dialog, a second Button stack imported into a page) have already
 * survived a full 940-test run on exactly that blindness.
 *
 * So this config exists to render the components into a DOM and ask the DOM what
 * an operator would get. It is deliberately NOT `vite.config.ts` with a `test`
 * block bolted on: the app build carries the Tailwind plugin, a CSS generator and
 * a `/v1` proxy, none of which a component test needs, and inheriting them would
 * make every test run depend on `gen:css` having been run first.
 *
 * `environment: 'jsdom'` rather than happy-dom, for one reason that is the whole
 * point of this suite: the subject under test is focus. jsdom implements the HTML
 * focus algorithm — `document.activeElement`, focus/blur event order,
 * `HTMLElement.focus()` refusing a disabled or hidden element — and Radix's focus
 * scope, `aria-hidden` sibling hiding and `react-remove-scroll` are all exercised
 * against it upstream. happy-dom is faster and lighter, and its focus and
 * `getComputedStyle` implementations are the parts most often approximated; a
 * suite whose central claim is "focus went back to the trigger" cannot be run on
 * an approximation of focus. Speed is not the constraint here — these are a few
 * dozen component renders.
 *
 * No `globals`. Every test imports `describe`/`it`/`expect` by name, because
 * `tsconfig.json` pins `types: ["vite/client"]` and these files live under `src`,
 * so `tsc --noEmit` — the cockpit's only safety net, since eslint does not lint
 * this tree — type-checks them along with the app. A test that does not compile
 * fails the build, which is the point.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // CSS is a build concern and these assertions are about roles, names and
    // focus. Parsing Tailwind here would only slow the run down.
    css: false,
    restoreMocks: true,
  },
})
