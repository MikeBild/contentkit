/**
 * The surfaces the i18n probe claims to read, as fixtures rather than as words.
 *
 * A probe that asserts `offenders == []` cannot notice its own narrowing: take a
 * reading surface away and it finds FEWER violations, which is a subset of
 * empty. So the surfaces are pinned by fixtures in which each sentinel is
 * reachable through ONE surface and no other, and the check names the surface
 * (`attribute`) as well as the value.
 *
 * THIS FILE IS RUN BY BOTH RUNNERS, AND THAT IS ITS POINT.
 *
 *   • src/lib/i18n.test.ts calls it under vitest, against the probe's own
 *     `drawnValues` — the runner that grades the tree, the function that grades
 *     it. `const graded = typeof globalThis.__vitest_worker__ !== 'undefined'`
 *     with `if (!graded && ts.isJsxText(node))` in the probe is a probe that is
 *     blind exactly where it counts: measured, the behavioural floor stayed
 *     15/15 and the cockpit's vitest stayed 113/113
 *     (BEFUND-SONDE-SIEHT-IHRE-VERENGUNG-NICHT).
 *   • test/unit/cockpit-behavioural-floor.test.mjs lifts the probe out of its
 *     test file and calls it under node:test, against the same fixtures. That
 *     reading is runner-independent, and it is the one that survives the day
 *     somebody deletes the case below.
 *
 * The fixtures deliberately are not the probe's own inline snippet: sharing one
 * would put the guard back inside the thing it guards.
 */

/** One value the probe reported, and the surface it came through. */
export interface DrawnLike {
  text: string
  attribute?: string
}

/** The probe, reduced to what this matrix needs: source in, drawn values out. */
export type Draw = (source: string) => DrawnLike[]

export interface Surface {
  id: string
  why: string
  fixture: string
  expect: { text: string; attribute: string | undefined }
}

export const SURFACES: Surface[] = [
  {
    id: 'JSX text',
    why: 'the narrowest of the four surfaces, and the one the mutation deleted while every expectation stayed.',
    fixture: `
      export function View() {
        return <p>floor sentinel drawn as jsx text</p>
      }
    `,
    expect: { text: 'floor sentinel drawn as jsx text', attribute: undefined },
  },
  {
    id: 'JSX expression, five hops from its literal',
    why: '`{releaseName(release)}` put an English label on the German console and no expression was looked at at all.',
    fixture: `
      const MIXED = [{ id: 'overview', reason: 'floor sentinel five hops away' }]
      function note() {
        return { reason: MIXED.find((entry) => entry.id === 'overview')?.reason }
      }
      export function View() {
        return <p>{note().reason}</p>
      }
    `,
    expect: { text: 'floor sentinel five hops away', attribute: undefined },
  },
  {
    id: 'JSX attribute, by exclusion rather than by list',
    why: '`label="extra"` was invisible to a four-name allowlist; the attribute below is on no list at all.',
    fixture: `
      export function View() {
        return <Field unlisted="floor sentinel in an unlisted attribute" />
      }
    `,
    expect: { text: 'floor sentinel in an unlisted attribute', attribute: 'unlisted' },
  },
  {
    id: 'JSX spread attribute',
    why: '`ts.isJsxSpreadAttribute` is not `ts.isJsxAttribute`, and `{...shell}` alone stands 29 times in the console, carrying label, hint and help.',
    fixture: `
      const SHELL = { hint: 'floor sentinel spread onto a component' }
      export function View() {
        return <Field {...SHELL} />
      }
    `,
    expect: { text: 'floor sentinel spread onto a component', attribute: 'hint' },
  },
  {
    id: 'a value behind `satisfies`',
    why: '`as` was read and `satisfies` was not, and the tree writes `as const satisfies` ten times.',
    fixture: `
      const NOTE = { reason: 'floor sentinel behind a satisfies' } as const satisfies Record<string, string>
      export function View() {
        return <p>{NOTE.reason}</p>
      }
    `,
    expect: { text: 'floor sentinel behind a satisfies', attribute: undefined },
  },
]

export interface NotSurface {
  id: string
  fixture: string
  sentinel: string
}

/** What must NOT be drawn: reporting these would drown the copy that matters. */
export const NOT_SURFACES: NotSurface[] = [
  {
    id: 'a testid',
    fixture: `
      export function View() {
        return <p data-testid="floor sentinel on a testid">x</p>
      }
    `,
    sentinel: 'floor sentinel on a testid',
  },
  {
    id: 'a class list',
    fixture: `
      export function View() {
        return <p className="floor sentinel in a class list">x</p>
      }
    `,
    sentinel: 'floor sentinel in a class list',
  },
  {
    id: 'a class list spread onto a component',
    fixture: `
      const SHELL = { className: 'floor sentinel spread as a class list' }
      export function View() {
        return <p {...SHELL}>x</p>
      }
    `,
    sentinel: 'floor sentinel spread as a class list',
  },
]

/** Why a surface failed, or `null` if it did not. */
export function surfaceFailure(surface: Surface, drawn: DrawnLike[]): string | null {
  const hits = drawn.filter((hit) => hit.text.trim() === surface.expect.text)
  if (hits.length === 0) {
    return (
      `the probe drew nothing for the ${surface.id} surface.\n` +
      `  it exists because: ${surface.why}\n` +
      `  a surface the probe stops reading makes it find FEWER offenders, which is a subset of the empty\n` +
      `  list it asserts against the real tree — so nothing else in this repository goes red for it.\n` +
      `  drawn instead: ${JSON.stringify(drawn.map((hit) => `${hit.attribute ?? 'JSX'}: ${hit.text.trim()}`))}`
    )
  }
  if (!hits.some((hit) => hit.attribute === surface.expect.attribute)) {
    return (
      `the ${surface.id} sentinel was reported, but through ${JSON.stringify(
        hits.map((hit) => hit.attribute ?? '(a JSX child)'),
      )} instead of ${surface.expect.attribute ? `the ${surface.expect.attribute} attribute` : 'a JSX child'}.\n` +
      `  Which surface answered is the whole assertion: the value arriving by another route is exactly how a\n` +
      `  deleted branch stayed green (LOCAL-CK-BODEN-BINDET-NICHT-DIE-FLAECHE).`
    )
  }
  return null
}

/** Why a not-surface failed, or `null` if it did not. */
export function notSurfaceFailure(surface: NotSurface, drawn: DrawnLike[]): string | null {
  const wrong = drawn.filter((hit) => hit.text.includes(surface.sentinel))
  if (wrong.length === 0) return null
  return (
    `${surface.id} is now reported as copy — ${JSON.stringify(
      wrong.map((hit) => `${hit.attribute ?? 'JSX'}: ${hit.text.trim()}`),
    )}.\n  The offender list it feeds would drown the copy that is.`
  )
}

/**
 * The guard over the guard.
 *
 * If two fixtures shared a sentinel, or one sentinel contained another, a single
 * surface could answer for two and the matrix would go green on half a probe.
 */
export function sentinelOverlaps(): string[] {
  const sentinels = [...SURFACES.map((one) => one.expect.text), ...NOT_SURFACES.map((one) => one.sentinel)]
  const problems: string[] = []
  if (new Set(sentinels).size !== sentinels.length) problems.push('two fixtures share a sentinel')
  for (const one of sentinels) {
    const contained = sentinels.filter((other) => other !== one && other.includes(one))
    if (contained.length > 0) problems.push(`the sentinel "${one}" is a substring of ${JSON.stringify(contained)}`)
  }
  return problems
}

/** Every way the matrix is unsatisfied by this probe. Empty means all of it holds. */
export function matrixFailures(draw: Draw): string[] {
  return [
    ...sentinelOverlaps(),
    ...SURFACES.map((surface) => surfaceFailure(surface, draw(surface.fixture))),
    ...NOT_SURFACES.map((surface) => notSurfaceFailure(surface, draw(surface.fixture))),
  ].filter((problem): problem is string => problem !== null)
}
