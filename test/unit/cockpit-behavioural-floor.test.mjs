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
 * SEVEN test files assert against TEN modules. Everything else in
 * apps/cockpit/src — the sidebar and its collapse, the unsaved-changes guard,
 * the site wizard's step gate, the
 * data table's four branches, every modal except the confirmation, and six of
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
 *   • It proves nothing about the modules on the uncovered side — 122 of them as
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
  // ── Responsive tables: components/ui/table.tsx ────────────────────────────
  {
    id: 'table/mobile-labels-distinguish-data-from-actions',
    promise:
      'Every narrow table row receives its translated data labels in column order, while an intentionally blank final label identifies controls that belong after the data rather than beside a fake heading.',
    incident:
      'Pinning the last cell kept controls reachable but left every table two to five phone widths wide; the data still required horizontal scrolling.',
    title: /marks an action column|ordinary final data column/i,
    asserts: [/mobileLabels/, /data-mobile-actions/],
    min: 2,
  },

  // ── The console's one Dialog: components/ui/dialog.tsx ─────────────────────
  //
  // Added when `ui/dialog.tsx` stopped being the console's own `role="dialog"`
  // div and became the vendored Radix Dialog. Every claim here was true of the
  // old file as prose and false as behaviour, and a source-reading test could
  // not tell the two apart — which is why these are pinned the moment the
  // replacement lands rather than at some later tidying.
  {
    id: 'dialog/is-modal-by-hiding-the-page-not-by-saying-so',
    promise:
      'The dialog is named by its own DialogTitle and the rest of the document is genuinely aria-hidden — not an aria-modal written onto a panel while the page underneath stays readable.',
    incident:
      'The hand-rolled overlay carried aria-modal="true" and hid nothing; every test it had asserted the attribute.',
    title: /is a real modal/i,
    asserts: [/getByRole\(['"]dialog/, /aria-hidden/],
    min: 1,
  },
  {
    id: 'dialog/not-dismissable-while-a-mutation-is-in-flight',
    promise:
      'While the request is in the air, neither Escape nor a click on the backdrop nor the X closes the dialog, and the X says so by being disabled.',
    incident:
      'The overlay this replaces dismissed on any mousedown that reached the backdrop, including one that began as a drag inside the panel.',
    title: /cannot be dismissed/i,
    asserts: [/\{Escape\}/, /dialog-overlay/, /toBeDisabled/],
    min: 1,
  },
  {
    id: 'dialog/the-guard-lifts-when-the-request-answers',
    promise: 'Once the mutation settles the dialog is dismissable again — a guard that never lifts is a trap.',
    title: /dismissed again the moment/i,
    asserts: [/toBeEnabled/, /not\.toBeInTheDocument/],
    min: 1,
  },
  {
    id: 'dialog/focus-returns-to-the-opener',
    promise:
      'Closing hands focus back to the control that opened it. Radix cancels its own restore in favour of a DialogTrigger ref, and no dialog in this console uses a DialogTrigger, so without the local handler focus lands on <body>.',
    incident: 'Every one of the sixteen converted call sites dropped focus on <body> until this was added.',
    title: /returns focus to the control that opened it/i,
    asserts: [/activeElement/, /toBe\(trigger\)/],
    min: 1,
  },

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
    // Two, since the site registry moved onto <Confirm>: the component's own
    // harness and `pages/sites.test.tsx`, which deletes a real row from the real
    // page. Held at both, because the harness proves the mechanism and the page
    // proves the mechanism is what the operator actually meets — a page that
    // hand-rolls its own dialog again passes the first and fails the second.
    min: 2,
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
    id: 'confirm/localized-copy-and-identifiers-stay-contained',
    promise:
      'A confirmation keeps long localized actions and opaque identifiers inside a responsive panel whose footer can wrap.',
    incident:
      'The German preview-promotion action escaped the narrow dialog and the manifest forced the explanatory copy beyond its readable width.',
    title: /localized actions and opaque identifiers inside a responsive dialog/i,
    asserts: [/w-\[calc/, /sm:flex-wrap/, /overflow-wrap:anywhere/],
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

  // ── The console's own tab strip: components/ui/tabs.tsx ────────────────────
  //
  // Not shadcn's. This one keeps its panels mounted and hides the inactive ones,
  // which is a decision with an ARIA contract attached, and nothing was holding
  // it: a mutation that deleted `role="tabpanel"` from `TabPanel` altogether
  // left 982 assertions green, because every test that touches a tab in this
  // repository looks for the caller's `<TabPanel`, not for the role the caller
  // never writes.
  {
    id: 'tabs/the-strip-is-a-tablist-and-says-which-tab-is-selected',
    promise:
      'The strip is a real tablist: three tabs in the accessibility tree, one selected, one tab stop between them.',
    title: /is a tablist whose selected tab/i,
    asserts: [/getByRole\(['"]tablist/, /selected: true/],
    min: 1,
  },
  {
    id: 'tabs/only-the-panel-on-screen-is-a-tabpanel',
    promise:
      'Exactly one panel is a tabpanel; the mounted-but-hidden ones are out of the accessibility tree entirely — which is why nothing a reader must be told may be rendered into one.',
    incident: 'M2: TabPanel lost its role and 982 tests passed.',
    title: /only the panel on screen a tabpanel/i,
    asserts: [/getAllByRole\(['"]tabpanel/, /not\.toBeVisible/],
    min: 1,
  },
  {
    id: 'tabs/every-tab-points-at-a-panel-that-exists',
    promise:
      'aria-controls resolves to the panel and aria-labelledby resolves back to the tab, so the panel on screen carries the tab’s words as its accessible name.',
    incident:
      'Tabs wrote aria-controls from a useId() the panels never saw and TabPanel carried no id, so every tab in the console pointed at an element that has never existed.',
    title: /points every tab at a panel that exists/i,
    asserts: [/aria-controls/, /aria-labelledby/, /toHaveAccessibleName/],
    min: 1,
  },
  {
    id: 'tabs/an-unwired-strip-emits-no-broken-reference',
    promise:
      'A strip whose caller has named no group emits no aria-controls at all. "Controls a panel" with no panel to go to is worse than silence.',
    title: /no reference at all when the caller names no group/i,
    asserts: [/not\.toHaveAttribute\(['"]aria-controls/, /danglingReferences/],
    min: 1,
  },
  {
    id: 'tabs/arrows-move-the-selection-the-panel-and-the-focus',
    promise:
      '←/→ change which tab is selected, which panel is on screen, and where the focus ring is — all three, or the strip has moved and the keyboard has not.',
    incident: 'M9: a tab strip made inert left two panels unreachable and 982 tests passed.',
    title: /moves between tabs with/i,
    asserts: [/\{ArrowRight\}/, /getByRole\(['"]tabpanel/, /toHaveFocus/],
    min: 1,
  },
  {
    id: 'tabs/a-disabled-tab-is-stepped-over',
    promise: 'A disabled tab is skipped by the arrow keys and cannot be opened by clicking it.',
    title: /skips a disabled tab/i,
    asserts: [/\{ArrowRight\}\{ArrowRight\}/, /toHaveTextContent/],
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
    id: 'page/releases-promotion-review-is-bound-to-one-preview-manifest',
    promise:
      'A deep-linked promotion review resolves one durable server record and forwards only the immutable preview and manifest binding returned by that record.',
    title: /deep-linked server-side promotion review only for its immutable preview and manifest binding/i,
    asserts: [/manifest_sha256/, /toHaveBeenCalledWith/],
    min: 1,
  },
  {
    id: 'page/releases-promotion-review-explains-content-effect-and-exit',
    promise:
      'Before the exact preview can be published, the review names the content, states the immediate live effect and says that leaving changes nothing.',
    incident:
      'The former gate led with a release UUID and manifest digest, so an operator could verify the binding but not understand the decision.',
    title: /names the reviewed content and explains the live effect before confirmation/i,
    asserts: [/A reviewed article/, /nothing changes/, /changes immediately/],
    min: 1,
  },
  {
    id: 'page/releases-destructive-delete-lives-in-overflow',
    promise: 'Release deletion is absent from the primary row surface and remains behind an overflow confirmation.',
    title: /keeps deletion out of the list primary surface and behind an overflow confirmation/i,
    asserts: [/menuitem/, /alertdialog/, /not\.toHaveBeenCalled/],
    min: 1,
  },
  // ── The site registry: the console's most destructive page ────────────────
  //
  // Added when `pages/sites.tsx` stopped composing its own AlertDialog. The
  // component's suite proved the focus restore against a harness shaped like
  // this page while this page was not using the component at all — so the three
  // below are asserted through the real page, with its real table, its real
  // react-query invalidation and the real order in which the row and the dialog
  // disappear.
  {
    id: 'page/sites-focus-survives-the-row-it-deleted',
    promise:
      'Deleting a site leaves focus in the sites table — never on <body>, which is no position in a list and starts the next Tab at the top of the document.',
    incident:
      'The page composed an AlertDialog inline with no onCloseAutoFocus: focus was dropped on <body> after the console’s most destructive act, under a green suite.',
    title: /FOCUS IN THE SITES TABLE/i,
    asserts: [/document\.body/, /toHaveFocus/],
    min: 1,
  },
  {
    id: 'page/sites-refusal-turns-into-the-second-question',
    promise:
      'A 409 keeps the dialog open, announces the server’s own counts through role="alert", and turns the accept control into the differently-named one that purges — the first answer never carries the flag.',
    title: /KEEPS THE DIALOG OPEN on the server/i,
    asserts: [/getByRole\(['"]alert['"]\)/, /ck-site-delete-purge/, /purge: false/],
    min: 1,
  },
  {
    id: 'page/sites-the-purge-is-not-armed-by-a-refusal-nobody-answered',
    promise:
      'A refusal the operator walked away from does not survive the close: reopening asks the first question again, so the answer that destroys content is only ever one click behind the refusal that named it.',
    title: /ARM THE PURGE/i,
    asserts: [/queryByTestId\(['"]ck-site-delete-purge/, /toEqual/],
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
  // ── Compositions: the one thing the tab strips cost ────────────────────────
  //
  // `TabPanel` hides rather than unmounts, and a hidden element is out of the
  // accessibility tree — so the compile refusals this page rendered inside its
  // Compile panel reached nobody who was reading the pattern registry when the
  // request came back. No toast, no badge, and role="alert" in a display:none
  // div, which announces nothing. Pinned at the page because it is a property of
  // where the page puts its Alert, not of the component.
  {
    id: 'page/compositions-a-refusal-reaches-a-reader-on-another-tab',
    promise:
      'A compile that fails while the reader is on Patterns is still in the accessibility tree, visible, and carrying the server’s own words — on every tab, because it belongs to the page and not to a panel.',
    incident: 'The alert lived inside TabPanel, which keeps hidden panels mounted and announces from none of them.',
    title: /REACHES THE READER ON ANOTHER TAB/i,
    asserts: [/getByRole\(['"]alert['"]\)/, /toBeVisible/, /toHaveTextContent/],
    min: 1,
  },
  {
    id: 'page/compositions-the-strip-says-which-panel-failed',
    promise:
      'The tab whose panel produced the refusal says so in a word — the tab’s accessible name reads "Compile 1 failed" — rather than in a colour the strip alone would carry.',
    title: /which panel failed/i,
    asserts: [/getByRole\(['"]tab['"]/, /toHaveTextContent/],
    min: 1,
  },
  {
    id: 'page/compositions-one-panel-at-a-time',
    promise: 'Each of this page’s three tabs really shows its own panel, and only ever one of them.',
    incident: 'M11: a five-view detail cut to one view passed 982 tests.',
    title: /each tab of this page really has its own/i,
    asserts: [/getAllByRole\(['"]tabpanel/, /toHaveAttribute/],
    min: 1,
  },

  // ── "Save and leave", when the save says no ────────────────────────────────
  //
  // The only finding in this whole migration that destroyed something, and it
  // predated the migration: the guard awaited onSave() in a try/catch and left
  // unless something was thrown, while neither caller throws — use-form's save()
  // and site-settings' attemptSave() both return `false`. So a failed save was
  // indistinguishable from a successful one and the guard navigated away with the
  // edits. Pinned as three cases because the failure is a three-way decision and
  // only one of the three was ever exercised.
  {
    id: 'unsaved-guard/a-failed-save-does-not-leave',
    promise:
      'A save that resolves false keeps the operator in the dialog. That is how both callers report failure; neither throws.',
    incident:
      'The guard read every non-throwing answer as success and called proceed(), discarding the edits it exists to protect.',
    title: /STAYS PUT when the save resolves false/i,
    asserts: [/Promise\.resolve\(false\)/, /not\.toHaveBeenCalled/],
    min: 1,
  },
  {
    id: 'unsaved-guard/a-thrown-save-does-not-leave',
    promise: 'A save that throws also keeps the operator in the dialog — the one case the old code did handle.',
    title: /stays put when the save throws/i,
    asserts: [/Promise\.reject/, /not\.toHaveBeenCalled/],
    min: 1,
  },
  {
    id: 'unsaved-guard/a-successful-save-leaves',
    promise:
      'A save that succeeds leaves, including a caller that resolves with nothing — the declared return type is unknown, so only an explicit false is a refusal. Reading absence as failure would strand an operator after a save that worked.',
    title: /leaves when the (save succeeds|caller resolves with nothing)/i,
    asserts: [/toHaveBeenCalledOnce/],
    min: 2,
  },
  // ── A tab badge tells zero from unknown ────────────────────────────────────
  //
  // Both used to render nothing, so a count query that failed put "nothing waiting"
  // on the strip beside a panel holding thirty rows. Silence on a tab is the
  // reader's evidence that the queue is empty, and a failure may not borrow it.
  {
    id: 'tab-counts/unknown-is-not-zero',
    promise:
      'A count that was asked for and refused prints an em dash. A measured zero prints nothing, and so does a count not asked for yet — three answers, three appearances.',
    incident: 'TabCount was number | undefined, so a failed query and an empty queue were one state on screen.',
    title: /(measured zero|asked for and refused|not been asked for yet)/i,
    asserts: [/toBeNull|toBe\('—'\)/],
    min: 3,
  },
  {
    id: 'tab-counts/a-number-is-printed-as-itself',
    promise:
      'A real count prints, with its noun where the number answers a narrowed question and a plus where the list saturated its own limit — and the unknown dash takes neither, because a noun on a number nobody has is a claim.',
    title: /(the number when there is one|unknown dash unqualified)/i,
    asserts: [/tabCountLabel/],
    min: 2,
  },
]

const THEME_CONTRACTS = [
  {
    id: 'theme/system-is-the-absence-of-a-choice',
    promise:
      'With nothing stored the theme is `system` and resolves from the OS, and choosing `system` again REMOVES the key — "follow the OS" and "was once set to whatever the OS said" stay different states.',
    incident:
      'The pre-paint script in index.html distinguishes them by the key being absent, so a store that wrote the literal string would light the console differently before and after first paint.',
    title: /follows the OS|way back to system/,
    asserts: [/theme: 'system'/],
    min: 2,
  },
  {
    id: 'theme/an-explicit-choice-wins-and-keeps-winning',
    promise: 'An explicit theme overrides the OS at read time and keeps overriding it when the OS changes underneath.',
    title: /overrides the OS|ignores the OS changing/,
    asserts: [/resolved/],
    min: 2,
  },
  {
    id: 'theme/a-hand-edited-key-costs-a-colour-not-the-console',
    promise: 'An unrecognised stored value falls back to `system` instead of passing through as a scheme.',
    incident:
      'The module-level singleton this store replaced cast whatever it found straight to `Theme`; a hand-edited value became a "resolved" scheme that was neither light nor dark and every reader of it misrendered quietly.',
    title: /garbage in localStorage/,
    asserts: [/theme: 'system'/],
    min: 1,
  },
  {
    id: 'theme/subscribers-are-notified-exactly-when-something-changed',
    promise:
      'The snapshot is reference-stable, an OS change reaches subscribers and applies the class, and setting the theme it already has notifies nobody.',
    incident:
      'useSyncExternalStore compares snapshots by identity; one rebuilt per read re-renders every consumer on every unrelated event and React eventually reports it as an infinite loop rather than as slowness.',
    title: /reference-stable|tracks the OS changing|notifies nobody/,
    asserts: [/snapshot\(\)|notified/],
    min: 3,
  },
  {
    id: 'theme/two-tabs-of-one-console-agree',
    promise: 'A theme chosen in another tab reaches this one, in both directions — a write and a return to `system`.',
    incident:
      'Two tabs are two copies of the store over one storage. Without a `storage` subscription the second never learns, and it then shows a theme that is no longer stored anywhere — observed live, and mistaken for a broken store before the cause was found.',
    title: /another tab/,
    asserts: [/setStored/],
    min: 2,
  },
  {
    id: 'theme/the-choice-reaches-the-server-rendered-funnel',
    promise:
      'An explicit choice is mirrored into the cookie, `system` deletes it, and construction reconciles both directions — so the login page the operator meets is the scheme they chose.',
    incident:
      'The funnel is server-rendered under a CSP that allows no script, so it cannot read localStorage; the cookie is the only channel, and an operator who chose dark before it existed would otherwise keep meeting a white login page forever.',
    title: /funnel cookie|deletes the cookie|reconciled at construction|stale cookie/,
    asserts: [/cookie\(\)/],
    min: 4,
  },
]

const I18N_CONTRACTS = [
  {
    id: 'i18n/visible-copy-is-catalogued',
    promise:
      'Visible product copy and accessible labels come from the typed catalogs; only explicit technical literals stay raw.',
    title: /visible product copy and accessible labels/i,
    asserts: [/isJsxText/, /accessibleAttributes/, /offenders/],
    min: 1,
  },
  {
    id: 'i18n/catalogs-have-one-shape',
    promise: 'English and German expose exactly the same keys and interpolation fields.',
    title: /catalogs structurally identical/i,
    asserts: [/Object\.keys/, /toEqual/],
    min: 1,
  },
  {
    id: 'i18n/interpolation-keeps-values',
    promise: 'Translated copy interpolates dynamic values rather than dropping them.',
    title: /interpolates translated values/i,
    asserts: [/translate\(/, /toContain/],
    min: 1,
  },
  {
    id: 'i18n/automatic-locale-has-a-safe-fallback',
    promise: 'Automatic language selection recognizes German and English and otherwise chooses English.',
    title: /resolves supported browser languages/i,
    asserts: [/resolveLocale/, /toBe/],
    min: 1,
  },
  {
    id: 'i18n/manual-and-cross-tab-choice',
    promise: 'Manual locale selection persists and storage changes from another tab are applied.',
    title: /auto detection, manual choice and external storage changes/i,
    asserts: [/store\.snapshot/, /storageChange/],
    min: 1,
  },
]

/* ── The theme store: lib/theme-store.ts ───────────────────────────────────────
 *
 * The only non-rendering subject in this file, and deliberately so. The store is
 * a pure module — the whole point of the factoring — so its cases assert
 * snapshots and cookie lifecycle rather than the DOM, and the `asserts` tokens
 * below name those instead of queries. The floor's promise is unchanged: no case
 * may be deleted in silence, whatever it drives.
 */

/**
 * Every contract, rendering and pure alike. The two lists are kept apart above
 * because they assert in different currencies, and merged here because the floor
 * is one floor: a case claimed by neither list is a case nobody would miss.
 */
const ALL_CONTRACTS = [...CONTRACTS, ...THEME_CONTRACTS, ...I18N_CONTRACTS]

/** The modules a contract above actually asserts against. Everything else is grep. */
const COVERED_SUBJECTS = [
  'components/confirm.tsx',
  'components/ui/dialog.tsx',
  'components/ui/progress.tsx',
  'components/ui/spinner.tsx',
  'components/ui/tabs.tsx',
  'forms/fields/field.tsx',
  'forms/fields/choice.tsx',
  'forms/fields/scopes.tsx',
  'forms/fields/text.tsx',
  'pages/compositions.tsx',
  'pages/releases.tsx',
  'pages/sites.tsx',
  // Not a rendering subject — a pure module, asserted head-on with a fake
  // environment and no DOM. It is listed here because the question this array
  // answers is "does a test assert against this module", and for theme-store.ts
  // the answer is now yes, more directly than any rendering test could manage.
  'lib/theme-store.ts',
  'lib/i18n.ts',
  'lib/locale-store.ts',
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
    id: 'decisions/the-unified-human-queue',
    missing:
      'The queue filters, overdue split, draft triage, moderation actions and promotion-review handoff are exercised by browser validation and source contracts, but the Decisions page does not yet have a dedicated rendering suite.',
    where: ['pages/decisions.tsx'],
  },
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
    id: 'ai/how-model-output-is-labelled',
    missing:
      'That the attribution renders nothing when no model is reported rather than an empty chip; that a confidence with a denominator reads differently from a self-reported one; that the assistant page shows the name the OPTIONS probe returned and not a stale one from a previous deployment.',
    where: ['components/ai/model-attribution.tsx'],
  },
  {
    id: 'profile/the-account-surface',
    missing:
      'That both session clocks count down against one shared tick; that the held and not-held scope lists are complements over PRODUCT_SCOPES; and that a profile remains useful when the session has neither a display name nor an email. The account-menu structure, safe fallback and route are pinned by cockpit-navigation.test.mjs.',
    where: ['pages/profile.tsx', 'hooks/use-now.ts'],
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
      'The COMPONENT is covered now — `components/ui/dialog.test.tsx` renders it and asks the DOM about modality, the busy guard and focus restore — but the sixteen CALL SITES still are not. Whether the identity editor actually passes its own `isPending` into `onOpenChange`, whether the wizard keeps the operator on the step they were on, whether the reader dialog surfaces the issued password before it closes: every one of those is a property of the call site and is graded by "the string DialogContent is present".',
    where: [
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
    id: 'pages/every-page-but-releases-and-the-registry',
    missing:
      'Overview, content, site settings, the assistant, four of the five pages `authoring.tsx` was split into — published, decks, audio and system — and the five `governance.tsx` was split into: reader access, webhooks, moderation, credentials and audit. Three pages of sixteen have a rendering test — releases, the site registry since its delete moved onto <Confirm>, and compositions since its compile refusals came out of a hidden panel. site-settings.tsx is the nearest gap: its identity confirmation goes through the same component and is graded here only as text. The remaining tab strips are the next: content, published, webhooks, moderation, credentials and the content editor render one each, and which panel is on screen is graded there by reading source.',
    where: [
      'pages/access.tsx',
      'pages/assistant.tsx',
      'pages/audio.tsx',
      'pages/audit.tsx',
      'pages/credentials.tsx',
      'pages/decks.tsx',
      'pages/moderation.tsx',
      'pages/published.tsx',
      'pages/system.tsx',
      'pages/content.tsx',
      'pages/overview.tsx',
      'pages/site-settings.tsx',
      'pages/webhooks.tsx',
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
      'components/ui/skeleton.tsx',
    ],
  },
  {
    id: 'ui/the-interactive-primitives',
    missing:
      'Select, checkbox, switch, toggle group, accordion, collapsible, popover, dropdown menu, hover card, tooltip, combobox, segmented control, dropzone, icon button and copy button: every one has a keyboard contract and an announcement, and none is rendered by a test. (The tab strip was one of them until `components/ui/tabs.test.tsx`.) The accordion is the newest and the site settings form is its only caller: that ←/→/Home/End move between nine section headers, and that a section refused by the server still announces its count while closed, are both graded by reading the page.',
    where: [
      'components/ui/accordion.tsx',
      'components/ui/select.tsx',
      'components/ui/checkbox.tsx',
      'components/ui/switch.tsx',
      'components/ui/toggle.tsx',
      'components/ui/toggle-group.tsx',
      'components/ui/collapsible.tsx',
      'components/ui/popover.tsx',
      'components/ui/dropdown-menu.tsx',
      'components/ui/hover-card.tsx',
      'components/ui/tooltip.tsx',
      'components/ui/combobox.tsx',
      'components/ui/segmented.tsx',
      'components/ui/dropzone.tsx',
      'components/ui/copy-button.tsx',
      'components/ui/icon-button.tsx',
      'components/ui/chip.tsx',
      'components/context-help.tsx',
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
      'components/ui/avatar.tsx',
    ],
  },
  {
    id: 'ui/derived-readouts',
    missing:
      'Relative time, the release chain, the stat tiles, the audio budget and a tab strip’s count badge: each turns numbers into a sentence an operator trusts, and each is checked only by unit tests over the maths, never over what is rendered. The tab count is the newest and the one with a rule worth rendering — a known zero and an unknown must both draw nothing, and nothing is exactly what a jsdom assertion about an absent badge cannot tell apart from a page that failed to render. It is graded instead by scripts/validate-cockpit-browser.mjs, which reads the badge and then opens the panel it counts.',
    where: [
      'components/ui/relative-time.tsx',
      'components/ui/release-chain.tsx',
      'components/ui/progress-value.ts',
      'components/tab-count.tsx',
      'lib/relative-time.ts',
      'lib/release-chain.ts',
      'lib/stat-tile.ts',
      'lib/audio-budget.ts',
      'lib/reported.ts',
      'lib/tab-counts.ts',
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
      'lib/select-any.ts',
      'lib/i18n-context.tsx',
      'lib/opaque.ts',
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
      suiteFiles.length >= 7,
      `only ${suiteFiles.length} rendering test file(s) under apps/cockpit/src; there were 7. ` +
        `Files found: ${suiteFiles.map((f) => f.id).join(', ') || '(none)'}`,
    )
    assert.ok(cases.length >= 66, `only ${cases.length} rendering cases parsed out of the corpus; there were 66.`)
  })

  test('every pinned contract is still held by a rendering case', () => {
    const broken = []
    for (const contract of ALL_CONTRACTS) {
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
          !ALL_CONTRACTS.some(
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
