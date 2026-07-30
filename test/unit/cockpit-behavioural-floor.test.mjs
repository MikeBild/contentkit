import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  THE COCKPIT'S BEHAVIOURAL COVERAGE LEDGER — READ THIS BEFORE vitest.config.ts
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A DOM RUNNER EXISTS. THAT IS NOT THE SAME THING AS BEHAVIOUR BEING COVERED.
 *
 * `apps/cockpit/vitest.config.ts` renders components into jsdom and its docblock
 * says so at length. It is easy to read that file, see the mutations it names,
 * and conclude the console's behaviour is graded. It is not. As of this file,
 * FIVE test files assert against NINE modules. Everything else in
 * apps/cockpit/src — the sidebar and its collapse, the command palette's
 * keyboard path, the unsaved-changes guard, the site wizard's step gate, the
 * data table's four branches, every modal except the confirmation, and seven of
 * the nine pages — is graded by grep: a Node test reads the source as text,
 * finds the string it expects, and concludes that focus is trapped, that a label
 * is linked, that a bar is honest. Three runtime behaviours, none of them
 * visible to a string match. Two mutations have already survived a full green
 * run on exactly that blindness, and the second one survived it twice.
 *
 * So this file does two jobs, and neither of them is "test the console".
 *
 *  1. A FLOOR. `CONTRACTS` below pins, by name, every promise that is currently
 *     kept by a rendering test. Deleting a case, gutting a case until it asserts
 *     nothing, or deleting a whole test file drops the contract's match count
 *     below its pinned minimum and this file goes red — in the ROOT `npm test`
 *     gate, which runs before the cockpit's own vitest step. Contracts are
 *     matched against the corpus of every `*.test.tsx` under apps/cockpit/src,
 *     never against a named file, so renaming or moving a test file does not
 *     defeat the pin; only removing the assertion does.
 *
 *  2. A LEDGER. `UNCOVERED` below enumerates, by flow, what has NO rendering
 *     test. Together the two lists must account for every module in
 *     apps/cockpit/src. A module that is neither the subject of a contract nor
 *     claimed by an uncovered flow fails the last test in this file — so a new
 *     component cannot be added to this console without someone deciding, in
 *     writing, which side of the line it is on.
 *
 * WHAT THIS FILE DOES NOT BUY — state this plainly, because overstating it is
 * how the blindness got here:
 *
 *   • This file is ITSELF A GREP. It reads test source as text and checks that a
 *     case with a matching title contains matching assertion tokens. It cannot
 *     tell a real assertion from a plausible-looking one, and a case rewritten
 *     to `expect(true).toBe(true)` while keeping its title and the token
 *     `toHaveFocus` in a comment would satisfy it. What stops that is the vitest
 *     step: a case that no longer holds fails there. The two gates are only
 *     useful together — this one says the case still EXISTS, that one says it
 *     still PASSES. Neither alone is a floor.
 *   • It proves nothing about the modules on the uncovered side — 126 of them as
 *     this runs, printed on every run rather than pinned, because a count that
 *     fails on unrelated work stops being read. It only proves the number is
 *     written down and cannot shrink by accident or grow in silence.
 *   • It does not make the covered contracts good ones. It makes them countable.
 *
 * ADDING A CONTRACT is a deliberate act: write the rendering test, then add the
 * entry here. REMOVING one is meant to be impossible by accident — if a contract
 * is genuinely obsolete, deleting its entry is a reviewable line in a diff, not a
 * silently vanished assertion.
 *
 * Node reads none of the cockpit as a module — every check here is over text —
 * so this runs identically wherever the root suite runs, with or without the
 * cockpit's own node_modules installed.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const cockpit = join(root, 'apps', 'cockpit', 'src')
const rel = (path) => relative(cockpit, path).split(sep).join('/')

/* ─────────────────────────────────────────────────────────────────────────────
 * The corpus: every rendering test in the console, whatever it is called.
 * ────────────────────────────────────────────────────────────────────────── */

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (/\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

const TEST_FILE = /\.test\.tsx?$/
const modules = walk(cockpit).map((path) => ({ id: rel(path), path, src: readFileSync(path, 'utf8') }))
const suiteFiles = modules.filter((file) => TEST_FILE.test(file.id))

/**
 * Every `it(…)` in the corpus as `{ file, suite, title, body }`.
 *
 * Indentation-delimited rather than parsed: these files are prettier-formatted,
 * so a case ends at the first line that closes at the `it(`'s own indent. A
 * `it.each` table would collapse to one case and trip the pinned minimums — that
 * is a deliberate failure, not a bug: consolidating four assertions into one
 * parameterised case changes what the floor is holding, and the pin has to be
 * re-stated by hand when it does.
 */
function casesIn(file) {
  const lines = file.src.split('\n')
  const out = []
  let suite = ''
  for (let i = 0; i < lines.length; i++) {
    const opened = /^\s*describe(?:\.\w+)?\(\s*(['"`])(.*?)\1/.exec(lines[i])
    if (opened) {
      suite = opened[2]
      continue
    }
    const started = /^(\s*)(?:it|test)(?:\.\w+)?\(\s*(['"`])(.*?)\2/.exec(lines[i])
    if (!started) continue
    const closing = new RegExp(`^${started[1]}\\}\\)`)
    const body = []
    for (let j = i + 1; j < lines.length && !closing.test(lines[j]); j++) body.push(lines[j])
    out.push({ file: file.id, suite, title: started[3], body: body.join('\n') })
  }
  return out
}

const cases = suiteFiles.flatMap(casesIn)
/** Title matching runs over describe + it, so a promise can be stated in either. */
const named = (kase) => `${kase.suite} ${kase.title}`

/* ─────────────────────────────────────────────────────────────────────────────
 * 1 — THE FLOOR. What a rendering test currently holds.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * `min` is the number of cases that must match, not a lower bound to be
 * comfortable about: it is set to what the suite has today, so deleting ANY one
 * of them is red. `asserts` are tokens that must all appear in the case body —
 * they are what stops a case being emptied while keeping its title.
 */
const CONTRACTS = [
  // ── The confirmation dialog: components/confirm.tsx ────────────────────────
  {
    id: 'confirm/focus-enters-the-dialog',
    promise: 'Opening a destructive confirmation moves focus into the dialog, not onto <body>.',
    title: /focus\s+INTO\s+the\s+dialog/i,
    asserts: [/findByRole\(['"]alertdialog/, /activeElement/],
    min: 1,
  },
  {
    id: 'confirm/focus-is-trapped-inside',
    promise: 'Tab from the last control in the dialog wraps to the first, never out to the page behind it.',
    title: /traps? focus|wraps to the first/i,
    asserts: [/\.tab\(/, /toHaveFocus/],
    min: 1,
  },
  {
    id: 'confirm/escape-closes-it',
    promise: 'Escape dismisses the confirmation.',
    title: /closes on Escape/i,
    asserts: [/\{Escape\}/, /not\.toBeInTheDocument/],
    min: 1,
  },
  {
    id: 'confirm/focus-returns-to-the-trigger',
    promise: 'All three exits — Escape, Cancel, and a mutation that succeeded — hand focus back to the trigger.',
    incident: 'An onCloseAutoFocus opt-out shipped and survived a full green run; nothing could see focus.',
    title: /RETURNS FOCUS TO THE TRIGGER/i,
    asserts: [/trigger/, /toHaveFocus/],
    min: 3,
  },
  {
    id: 'confirm/a-disabled-trigger-does-not-strand-focus',
    promise:
      'When the caller keeps the trigger disabled across the close — the sanctioned `disabled={isPending}` shape — focus is not left on <body>, and the trigger gets it back once it can take it.',
    title: /disabled.{0,60}(in flight|after the close)/i,
    asserts: [/document\.body/, /toHaveFocus|activeElement/],
    min: 2,
  },
  {
    id: 'confirm/focus-survives-the-trigger-being-deleted',
    promise:
      'The ordinary destructive path — the row and its trigger unmount — parks focus on a surviving structure the reader announces, not on <body>.',
    incident: 'B1: the restore held only while the trigger stayed mounted, which deleting a site never does.',
    title: /(row|trigger).{0,60}(was deleted|deleted|removed|unmounted)/i,
    asserts: [/toHaveFocus/, /document\.body/],
    min: 1,
  },
  {
    id: 'confirm/does-not-steal-focus-back-from-the-operator',
    promise: 'An operator who moved on while the mutation settled keeps the control they chose.',
    // "operator who has moved on" alone would also match the field suite's live
    // region case; the promise here is specifically about focus being taken back.
    title: /take[s]? focus back/i,
    asserts: [/toHaveFocus/, /not\.toHaveFocus/],
    min: 1,
  },
  {
    id: 'confirm/parks-on-something-a-reader-announces',
    promise: 'The parking spot is a table, list, form or landmark — never the nearest anonymous <div>.',
    title: /anonymous wrapper|a reader announces|landmark/i,
    asserts: [/getByRole\(/, /not\.toHaveFocus/],
    min: 1,
  },
  {
    id: 'confirm/announces-a-server-refusal',
    promise: 'A refused mutation is announced through role="alert" carrying the server\'s own words, not a colour.',
    title: /announces? a server refusal/i,
    asserts: [/ByRole\(['"]alert['"]/, /toHaveTextContent/],
    min: 1,
  },
  {
    id: 'confirm/stays-open-after-a-refusal',
    promise: 'A refusal leaves the dialog open with the target still readable and a way out still enabled.',
    title: /open after a refusal/i,
    asserts: [/toBeInTheDocument/, /toBeEnabled/],
    min: 1,
  },
  {
    id: 'confirm/cannot-be-dismissed-while-the-mutation-is-in-flight',
    promise: 'A request whose outcome is unknown cannot be Escaped away as if it had been cancelled.',
    title: /dismissed while the mutation|mutation is in the air/i,
    asserts: [/\{Escape\}/, /toBeInTheDocument/],
    min: 1,
  },
  {
    id: 'confirm/has-no-light-dismiss',
    promise: 'A stray click on the overlay does not answer a confirmation.',
    title: /stray click outside|light.?dismiss/i,
    asserts: [/toBeInTheDocument/],
    min: 1,
  },
  {
    id: 'confirm/cancelling-runs-no-mutation',
    promise: 'Cancelling calls nothing.',
    title: /does not run the mutation when it is cancelled/i,
    asserts: [/not\.toHaveBeenCalled/],
    min: 1,
  },

  // ── The field shell: forms/fields/field.tsx and the shapes built on it ─────
  {
    id: 'field/the-label-names-the-control',
    promise:
      'Every field shape — text, select, switch, checkbox group — is reachable by its label text and carries it as its accessible name.',
    incident: 'B2: htmlFor/id could be cut in two edits and 962 assertions stayed green.',
    title: /called what its label says|label names the control/i,
    asserts: [/getByLabelText/, /toHaveAccessibleName/],
    min: 4,
  },
  {
    id: 'field/clicking-the-label-focuses-the-control',
    promise: 'The htmlFor link works from the other side: clicking the label puts the caret in the control.',
    title: /clicking the label/i,
    asserts: [/toHaveFocus/],
    min: 1,
  },
  {
    id: 'field/help-becomes-the-accessible-description',
    promise: 'Help and fallback text reach every field shape as aria-describedby, not as decoration beside it.',
    title: /help reaches the control as its accessible description/i,
    asserts: [/toHaveAccessibleDescription\(/],
    min: 6,
  },
  {
    id: 'field/no-description-when-there-is-nothing-to-say',
    promise:
      'A field with nothing to say has an empty description and no dangling aria-describedby — the control case that stops every description assertion passing for the wrong reason.',
    title: /nothing to say has no description/i,
    asserts: [/toHaveAccessibleDescription\(''\)/, /aria-describedby/],
    min: 1,
  },
  {
    id: 'field/an-error-is-linked-and-marks-the-control-invalid',
    promise: 'An error joins the description and sets aria-invalid on every field shape.',
    title: /an error is linked, announced, and marks the control invalid/i,
    asserts: [/aria-invalid|toBeInvalid/],
    min: 5,
  },
  {
    id: 'field/an-error-is-a-live-region',
    promise: 'The error is role="alert", so a save refused after the operator tabbed away is still spoken.',
    title: /live region/i,
    asserts: [/getByRole\(['"]alert['"]\)/, /toHaveTextContent/],
    min: 1,
  },
  {
    id: 'field/hint-warning-and-error-coexist',
    promise: 'A hint, a warning and an error are all linked at once, in order, and none is dropped.',
    title: /two things to say at once/i,
    asserts: [/toHaveAccessibleDescription/],
    min: 3,
  },
  {
    id: 'field/disabled-is-in-the-accessibility-tree',
    promise: 'A disabled field is disabled on the element — for every shape, including each box of a group.',
    title: /a disabled field says so in the accessibility tree/i,
    asserts: [/toBeDisabled/],
    min: 4,
  },
  {
    id: 'field/disabled-is-not-tabbable',
    promise: 'Disabled means Tab does not stop there, not a class that looks grey.',
    title: /not reachable by keyboard/i,
    asserts: [/\.tab\(/, /not\.toHaveFocus/],
    min: 1,
  },
  {
    id: 'field/every-emitted-reference-resolves',
    promise:
      'Every label[for] and every aria-describedby token the shell emits addresses an element that exists — audited over the whole rendered document, with everything on at once and with nothing but a label.',
    title: /every reference the shell emits resolves/i,
    asserts: [/aria-describedby|label\[for\]|auditReferences/],
    min: 2,
  },

  // ── Progress: the honesty contract ─────────────────────────────────────────
  {
    id: 'progress/indeterminate-publishes-no-value',
    promise: 'Work with no fraction is a progressbar with no aria-valuenow, valuemin, valuemax or valuetext.',
    title: /indeterminate progressbar/i,
    asserts: [/getByRole\(['"]progressbar/, /not\.toHaveAttribute\(['"]aria-valuenow/],
    min: 1,
  },
  {
    id: 'progress/indeterminate-is-not-a-status-region',
    promise: 'role="progressbar" and not role="status": a live region makes no claim about how far along anything is.',
    title: /not a status region/i,
    asserts: [/queryByRole\(['"]status['"]\)/],
    min: 1,
  },
  {
    id: 'progress/no-invented-percentage',
    promise:
      'Nothing puts a percentage in front of the operator for work that reports no fraction — held at the component AND at the page that renders it.',
    title: /(never puts|refuses to invent) a percentage/i,
    asserts: [/not\.toHaveTextContent\(['"]%['"]\)/],
    min: 2,
  },
  {
    id: 'progress/determinate-publishes-the-full-value-triple',
    promise: 'A real fraction publishes valuenow, valuemin, valuemax and a valuetext a reader can speak.',
    title: /full value triple/i,
    asserts: [/aria-valuenow/, /aria-valuemin/, /aria-valuemax/, /aria-valuetext/],
    min: 1,
  },
  {
    id: 'progress/the-percentage-is-not-the-geometry',
    promise: '400k of 1M is announced as 40 out of 100, not as a bar running off the end.',
    title: /keeps the geometry out of/i,
    asserts: [/aria-valuemax/, /aria-valuenow/],
    min: 1,
  },
  {
    id: 'progress/a-missing-budget-is-indeterminate-not-zero',
    promise: 'A denominator that does not exist is not announced as a maximum, and not drawn as zero.',
    title: /budget as indeterminate, not as zero/i,
    asserts: [/not\.toHaveAttribute\(['"]aria-valuenow/],
    min: 1,
  },
  {
    id: 'progress/zero-is-a-measurement',
    promise: 'Zero is announced, because zero is a fact and "unknown" is a different one.',
    title: /announces zero/i,
    asserts: [/aria-valuenow/],
    min: 1,
  },
  {
    id: 'progress/overshoot-clamps-the-bar-not-the-words',
    promise: 'Over budget draws 100 while the sentence beside it keeps the real numbers.',
    title: /clamps the picture at 100/i,
    asserts: [/aria-valuenow/, /toHaveTextContent/],
    min: 1,
  },

  // ── Spinner: said once, or not at all ──────────────────────────────────────
  {
    id: 'spinner/decorative-is-out-of-the-accessibility-tree',
    promise: 'A spinner standing beside words is aria-hidden and is not a status region.',
    title: /not in the accessibility tree/i,
    asserts: [/queryByRole\(['"]status['"]\)/, /aria-hidden/],
    min: 1,
  },
  {
    id: 'spinner/a-busy-button-keeps-its-name',
    promise:
      'A button that grows a spinner keeps the accessible name it had — "Delete site", not "Loading Delete site".',
    title: /button saying what it always said/i,
    asserts: [/toHaveAccessibleName/],
    min: 1,
  },
  {
    id: 'spinner/standalone-announces-itself',
    promise:
      'A spinner standing alone is role="status" carrying the sentence — spelled `label` or spelled `aria-label`.',
    title: /status region carrying the sentence|the way the DOM spells it/i,
    asserts: [/getByRole\(['"]status['"]\)/, /toHaveTextContent/],
    min: 2,
  },
  {
    id: 'spinner/announces-once-not-twice',
    promise: 'The icon inside an announced spinner stays hidden, so the sentence is spoken once.',
    title: /once, not twice/i,
    asserts: [/aria-hidden/],
    min: 1,
  },

  // ── One page, rendered end to end ──────────────────────────────────────────
  {
    id: 'page/releases-names-a-running-build',
    promise: 'The releases page says, in text, that a build is running.',
    title: /says a build is running/i,
    asserts: [/toHaveTextContent/],
    min: 1,
  },
  {
    id: 'page/releases-in-flight-build-is-an-indeterminate-progressbar',
    promise:
      'The in-flight build card exposes a named progressbar with no value — the honesty contract asserted through the real page, not just the component.',
    title: /in-flight build as an indeterminate/i,
    asserts: [/getByRole\(['"]progressbar/, /not\.toHaveAttribute\(['"]aria-valuenow/],
    min: 1,
  },
]

/** The modules a contract above actually asserts against. Everything else is grep. */
const COVERED_SUBJECTS = [
  'components/confirm.tsx',
  'components/ui/progress.tsx',
  'components/ui/spinner.tsx',
  'forms/fields/field.tsx',
  'forms/fields/choice.tsx',
  'forms/fields/scopes.tsx',
  'forms/fields/text.tsx',
  'pages/releases.tsx',
]

/* ─────────────────────────────────────────────────────────────────────────────
 * 2 — THE LEDGER. What is still graded by grep, named out loud.
 *
 * Each entry claims modules by glob. Together with COVERED_SUBJECTS they must
 * claim every module in apps/cockpit/src, so a component cannot arrive without
 * being classified. `where` globs, not exact paths: a flow keeps its entry when
 * a file inside it is renamed, and an entry that stops matching anything at all
 * fails, because a ledger line about code that no longer exists is a lie too.
 * ────────────────────────────────────────────────────────────────────────── */

const UNCOVERED = [
  {
    id: 'shell/sidebar-collapse-and-its-tooltips',
    missing:
      'Collapse to the icon rail and back; the tooltips that are the only labels in the collapsed state; the mobile Sheet; the keyboard shortcut; which nav item is aria-current.',
    where: [
      'app/shell.tsx',
      'components/ui/sidebar.tsx',
      'components/ui/sheet.tsx',
      'components/ui/breadcrumb.tsx',
      'components/app-link.tsx',
      'router.tsx',
      'main.tsx',
      'hooks/use-mobile.ts',
    ],
  },
  {
    id: 'palette/command-palette-keyboard-path',
    missing:
      'Cmd-K opens it, typing filters, arrows move the active option, Enter navigates, Escape closes and returns focus, and the no-results state says so out loud. Every step of that is keyboard-only and invisible to a string match.',
    where: [
      'components/ui/command-palette.tsx',
      'components/ui/command.tsx',
      'components/ui/kbd.tsx',
      'lib/palette.ts',
      'lib/keyboard.ts',
    ],
  },
  {
    id: 'forms/unsaved-changes-guard',
    missing:
      'Navigating away from a dirty form must be blocked, the dialog must trap focus, "discard" must actually discard and "stay" must leave the edits intact. Nothing renders it.',
    where: ['forms/use-unsaved-guard.tsx', 'forms/use-dirty.ts', 'forms/use-form.ts', 'forms/save-bar.tsx'],
  },
  {
    id: 'dialogs/every-modal-except-the-confirmation',
    missing:
      'Seventeen `<Dialog>` sites across fourteen modules — the credential dialogs, the reader and group editors, the webhook and identity editors, the preview dialog, the revision viewer, the site conflict dialog, the pattern and guide viewers. components/confirm.tsx is the ONLY one with a rendering test; the other seventeen are graded by "the string DialogTitle is present".',
    where: [
      'components/ui/dialog.tsx',
      'components/ui/alert-dialog.tsx',
      'forms/audience/*.tsx',
      'forms/platform/*.tsx',
      'forms/content/revisions.tsx',
      'forms/site/conflict.tsx',
    ],
  },
  {
    id: 'wizard/step-gate',
    missing:
      'The new-site wizard advances only when the step validates, Back preserves what was typed, and the step indicator announces where the operator is. Asserted nowhere that renders it.',
    where: [
      'forms/site/wizard.tsx',
      'forms/site/sections.tsx',
      'forms/site/rules.ts',
      'forms/site/contract.ts',
      'components/ui/steps.tsx',
    ],
  },
  {
    id: 'site/switcher-and-session-gate',
    missing:
      'Switching the active site re-scopes every query; the session gate decides between the console and the sign-in path. Both are pure runtime behaviour.',
    where: ['lib/site.tsx', 'lib/session.tsx', 'lib/theme.ts', 'components/session-gate.tsx'],
  },
  {
    id: 'data-table/four-branches',
    missing:
      'Loading, empty, error and rows — plus sorting, the cursor pagination and the "n selected" state. Four branches, no rendering test picks any of them.',
    where: [
      'components/ui/data-table.tsx',
      'components/ui/table.tsx',
      'components/ui/pagination.tsx',
      'forms/table-state.tsx',
      'lib/table-view.ts',
      'lib/cursor.ts',
    ],
  },
  {
    id: 'fields/the-shapes-the-field-suite-does-not-render',
    missing:
      'field.test.tsx renders text, select, switch and the scope group. Date, number, url, colour, secret, list, map, object-list and subtree share the same FieldShell and are asserted by none of it — the B2 wiring is proven for four shapes out of thirteen.',
    where: [
      'forms/fields/color.tsx',
      'forms/fields/date.tsx',
      'forms/fields/date-value.ts',
      'forms/fields/list.tsx',
      'forms/fields/map.tsx',
      'forms/fields/number.tsx',
      'forms/fields/object-list.tsx',
      'forms/fields/secret.tsx',
      'forms/fields/subtree.tsx',
      'forms/fields/url.tsx',
      'forms/fields/index.ts',
    ],
  },
  {
    id: 'content/editor-preview-and-draft',
    missing: 'The body editor, the frontmatter form, the preview pane and the draft/scheme plumbing behind them.',
    where: ['forms/content/*', 'content/*'],
  },
  {
    id: 'pages/every-page-but-releases',
    missing:
      'Overview, sites, content, governance, site settings, authoring and the assistant. One page of nine has a rendering test.',
    where: [
      'pages/assistant.tsx',
      'pages/authoring.tsx',
      'pages/content.tsx',
      'pages/governance.tsx',
      'pages/overview.tsx',
      'pages/site-settings.tsx',
      'pages/sites.tsx',
    ],
  },
  {
    id: 'feedback/toasts-alerts-empties-and-skeletons',
    missing:
      'Whether a toast is announced, whether an Alert is a live region, whether an Empty names its action, whether a Skeleton is hidden from a reader. All four are announcement questions and all four are graded by grep.',
    where: [
      'components/ui/toast.tsx',
      'components/ui/sonner.tsx',
      'components/ui/alert.tsx',
      'components/ui/empty.tsx',
      'components/ui/empty-state.tsx',
      'components/ui/skeleton.tsx',
    ],
  },
  {
    id: 'ui/the-interactive-primitives',
    missing:
      'Select, checkbox, switch, toggle group, tabs, collapsible, popover, dropdown menu, hover card, tooltip, combobox, segmented control, dropzone and copy button: every one has a keyboard contract and an announcement, and none is rendered by a test.',
    where: [
      'components/ui/select.tsx',
      'components/ui/checkbox.tsx',
      'components/ui/switch.tsx',
      'components/ui/toggle.tsx',
      'components/ui/toggle-group.tsx',
      'components/ui/tabs.tsx',
      'components/ui/collapsible.tsx',
      'components/ui/popover.tsx',
      'components/ui/dropdown-menu.tsx',
      'components/ui/hover-card.tsx',
      'components/ui/tooltip.tsx',
      'components/ui/combobox.tsx',
      'components/ui/segmented.tsx',
      'components/ui/dropzone.tsx',
      'components/ui/copy-button.tsx',
      'components/ui/chip.tsx',
    ],
  },
  {
    id: 'ui/the-presentational-primitives',
    missing:
      'Button, card, input, textarea, label, badge, separator, scroll area, input group and the field wrapper. Lower risk — but "lower risk" is a judgement, not a test.',
    where: [
      'components/ui/button.tsx',
      'components/ui/card.tsx',
      'components/ui/input.tsx',
      'components/ui/textarea.tsx',
      'components/ui/label.tsx',
      'components/ui/badge.tsx',
      'components/ui/separator.tsx',
      'components/ui/scroll-area.tsx',
      'components/ui/input-group.tsx',
      'components/ui/field.tsx',
      'components/ui/primitives.tsx',
    ],
  },
  {
    id: 'ui/derived-readouts',
    missing:
      'Relative time, the release chain, the stat tiles and the audio budget: each turns numbers into a sentence an operator trusts, and each is checked only by unit tests over the maths, never over what is rendered.',
    where: [
      'components/ui/relative-time.tsx',
      'components/ui/release-chain.tsx',
      'components/ui/progress-value.ts',
      'lib/relative-time.ts',
      'lib/release-chain.ts',
      'lib/stat-tile.ts',
      'lib/audio-budget.ts',
    ],
  },
  {
    id: 'plumbing/api-query-and-the-remaining-form-scaffolding',
    missing:
      'The API client, the query layer, the conversation store, and the aside/gallery/status-badge/path/contract scaffolding the forms are built from.',
    where: [
      'api/*',
      'lib/query.ts',
      'lib/conversations.ts',
      'lib/utils.ts',
      'forms/aside.tsx',
      'forms/gallery.tsx',
      'forms/status-badge.tsx',
      'forms/path.ts',
      'forms/contracts/*',
    ],
  },
]

/* ────────────────────────────────────────────────────────────────────────── */

const globToRe = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`)
const claimants = UNCOVERED.map((entry) => ({ ...entry, res: entry.where.map(globToRe) }))

const IGNORED = (id) => TEST_FILE.test(id) || id.endsWith('.d.ts') || id === 'test-setup.ts'
const graded = modules.filter((file) => !IGNORED(file.id))

describe('the behavioural suite has a floor it cannot fall through', () => {
  test('the corpus is found at all — a floor over zero test files is not a floor', () => {
    assert.ok(
      suiteFiles.length >= 5,
      `only ${suiteFiles.length} rendering test file(s) under apps/cockpit/src; there were 5. ` +
        `Files found: ${suiteFiles.map((f) => f.id).join(', ') || '(none)'}`,
    )
    assert.ok(cases.length >= 59, `only ${cases.length} rendering cases parsed out of the corpus; there were 59.`)
  })

  test('every pinned contract is still held by a rendering case', () => {
    const broken = []
    for (const contract of CONTRACTS) {
      const hits = cases.filter(
        (kase) => contract.title.test(named(kase)) && contract.asserts.every((token) => token.test(kase.body)),
      )
      if (hits.length >= contract.min) continue
      const titleOnly = cases.filter((kase) => contract.title.test(named(kase)))
      const gutted = titleOnly.filter((kase) => !contract.asserts.every((token) => token.test(kase.body)))
      broken.push(
        [
          `${contract.id}: ${hits.length} of ${contract.min} required rendering case(s).`,
          `  promise: ${contract.promise}`,
          contract.incident ? `  it exists because: ${contract.incident}` : null,
          gutted.length
            ? `  ${gutted.length} case(s) still carry the title but no longer assert it: ` +
              gutted.map((kase) => `"${kase.title}" (${kase.file})`).join('; ')
            : `  no case anywhere in the corpus matches ${contract.title}.`,
          '  A contract may be retired only by deleting its entry in CONTRACTS, which is a reviewable line in a diff.',
        ]
          .filter(Boolean)
          .join('\n'),
      )
    }
    assert.deepEqual(broken, [], `the behavioural suite lost coverage it had:\n\n${broken.join('\n\n')}`)
  })

  test('no rendering case is unpinned — a case nobody claims can be deleted in silence', () => {
    const orphans = cases
      .filter(
        (kase) =>
          !CONTRACTS.some(
            (contract) => contract.title.test(named(kase)) && contract.asserts.every((token) => token.test(kase.body)),
          ),
      )
      .map((kase) => `${kase.file}: "${kase.title}"`)
    assert.deepEqual(
      orphans,
      [],
      'these rendering cases are not claimed by any entry in CONTRACTS, so deleting them would be invisible.\n' +
        'Add a contract naming the promise (and raise the `min` of an existing one if it belongs there):\n' +
        orphans.join('\n'),
    )
  })

  test('the runner that grades behaviour is still wired up', () => {
    // A suite nobody invokes is not a floor either, and narrowing `include` is a
    // quieter way to delete tests than deleting them.
    const config = readFileSync(join(root, 'apps', 'cockpit', 'vitest.config.ts'), 'utf8')
    assert.match(config, /environment:\s*'jsdom'/, 'the behavioural runner is no longer a DOM environment')
    assert.match(
      config,
      /include:\s*\[\s*'src\/\*\*\/\*\.test\.\{ts,tsx\}'/,
      'vitest.config.ts no longer includes every src/**/*.test.{ts,tsx}; a narrowed glob deletes tests without touching them',
    )
    const pkg = JSON.parse(readFileSync(join(root, 'apps', 'cockpit', 'package.json'), 'utf8'))
    assert.match(pkg.scripts?.test ?? '', /vitest/, "apps/cockpit's `test` script no longer runs vitest")
    const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
    assert.match(
      ci,
      /npm --prefix apps\/cockpit run test|working-directory:\s*apps\/cockpit[\s\S]{0,400}?vitest/,
      'CI no longer runs the cockpit behavioural suite',
    )
  })
})

describe('what is still graded by grep is written down', () => {
  test('every module in the console is on one side of the line or the other', () => {
    const covered = new Set(COVERED_SUBJECTS)
    const unclaimed = graded
      .filter((file) => !covered.has(file.id) && !claimants.some((entry) => entry.res.some((re) => re.test(file.id))))
      .map((file) => file.id)
    assert.deepEqual(
      unclaimed,
      [],
      'these modules are in neither COVERED_SUBJECTS nor any UNCOVERED entry, so nobody has said whether their\n' +
        'behaviour is tested or merely grepped. Put each one on a side — that decision is the whole point of this file:\n' +
        unclaimed.join('\n'),
    )
  })

  test('the ledger describes code that exists', () => {
    const stale = claimants
      .filter((entry) => !graded.some((file) => entry.res.some((re) => re.test(file.id))))
      .map((entry) => entry.id)
    assert.deepEqual(
      stale,
      [],
      `these UNCOVERED entries match no module any more and must be removed:\n${stale.join('\n')}`,
    )
  })

  test('a module named as covered really is the subject of a rendering test', () => {
    const missing = COVERED_SUBJECTS.filter((id) => !existsSync(join(cockpit, id)))
    assert.deepEqual(missing, [], `COVERED_SUBJECTS names modules that do not exist: ${missing.join(', ')}`)
    // The corpus must reach each of them: directly imported, or imported by a
    // module a test imports one hop away (the field suite renders field.tsx
    // through text/choice/scopes, the releases suite renders progress.tsx
    // through the page).
    // `from '…'` and `await import('…')` both count: releases.test.tsx has to
    // load its page dynamically, after the API mock is in place.
    const bySpecifier = (id) =>
      new RegExp(
        `(?:from |import\\()\\s*['"](@/${id.replace(/\.tsx?$/, '')}|\\./${id
          .split('/')
          .pop()
          .replace(/\.tsx?$/, '')})['"]`,
      )
    const reachable = new Set()
    const seed = suiteFiles.map((f) => f.src).join('\n')
    for (const file of graded) if (bySpecifier(file.id).test(seed)) reachable.add(file.id)
    const oneHop = graded
      .filter((file) => reachable.has(file.id))
      .map((f) => f.src)
      .join('\n')
    for (const file of graded) if (bySpecifier(file.id).test(oneHop)) reachable.add(file.id)
    const unreached = COVERED_SUBJECTS.filter((id) => !reachable.has(id))
    assert.deepEqual(
      unreached,
      [],
      `COVERED_SUBJECTS claims these are rendered by a test, but no test in the corpus imports them, directly or\n` +
        `one hop away. Either the test was deleted or the claim was never true:\n${unreached.join('\n')}`,
    )
  })

  test('the counts this file publishes are the counts vitest.config.ts states', () => {
    // The pointer a reviewer meets first has to carry the same numbers as the
    // ledger, or "there is a DOM runner" drifts back into "behaviour is covered".
    const N = CONTRACTS.length
    const M = UNCOVERED.length
    const config = readFileSync(join(root, 'apps', 'cockpit', 'vitest.config.ts'), 'utf8')
    assert.ok(
      config.includes(`${N} contracts`),
      `vitest.config.ts must state "${N} contracts" — the number of promises this floor pins.`,
    )
    assert.ok(
      config.includes(`${M} named flows`),
      `vitest.config.ts must state "${M} named flows" — the number of uncovered flows in the ledger.`,
    )
    assert.ok(
      config.includes('test/unit/cockpit-behavioural-floor.test.mjs'),
      'vitest.config.ts must point at the ledger before it describes itself.',
    )
    // Reported, not pinned: this moves whenever the console gains or loses a
    // module, and a number that fails on unrelated work stops being read.
    const uncoveredModules = graded.filter((file) => !COVERED_SUBJECTS.includes(file.id)).length
    console.log(
      `behavioural floor: ${N} contracts pinned across ${cases.length} rendering cases in ${suiteFiles.length} files, ` +
        `over ${COVERED_SUBJECTS.length} modules — ${M} named flows and ${uncoveredModules} modules still graded by grep.`,
    )
  })
})
