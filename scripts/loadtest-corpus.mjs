// The corpus the release-build load harness builds. Kept separate from the
// harness so the harness, the regression test and any future comparison run
// measure the same documents rather than three similar-looking ones.
//
// Deliberately CPU-shaped: every document carries a fenced code block (Shiki),
// display math (KaTeX) and — every fourth document — chart directives (ECharts
// SSR). Those three are the synchronous stretches between `renderMarkdown`'s
// awaits, which is what holds the event loop.

const CODE = `\`\`\`ts
export async function publish(site: string, revisions: string[]) {
  const release = await client.post(\`/v1/sites/\${site}/releases\`, { revisions })
  if (release.status !== 'ready') throw new Error(\`release \${release.id} is \${release.status}\`)
  return release
}
\`\`\``

const MATH = `$$
\\operatorname{cost}(n) = \\sum_{i=1}^{n} \\left( \\frac{r_i}{1 + e^{-k(t_i - t_0)}} \\right)
$$`

const chartTable = (index) =>
  [
    '| Period | Actual | Plan |',
    '|-|-:|-:|',
    ...Array.from({ length: 12 }, (_, row) => `| P${row + 1} | ${index * 7 + row} | ${index * 7 + row + 4} |`),
  ].join('\n')

const charts = (index) =>
  ['bar', 'line']
    .map(
      (type) => `:::chart{type="${type}" title="${type} ${index}" description="Load harness ${type} chart ${index}"}
${chartTable(index)}
:::`,
    )
    .join('\n\n')

export function loadTestCorpus(count) {
  const revisions = []
  for (let index = 0; index < count; index++) {
    const locale = index % 2 ? 'en' : 'de'
    const key = `load-document-${index}`
    const withCharts = index % 4 === 0
    revisions.push({
      id: `revision-${index}`,
      item_id: `item-${index}`,
      kind: 'page',
      locale,
      translation_key: `${key}-${locale}`,
      markdown: `---
kind: page
title: Load harness document ${index}
locale: ${locale}
slug: ${key}
translationKey: ${key}-${locale}
summary: A document shaped like the ones a real release renders.
---
# Load harness document ${index}

This paragraph exists so the renderer has prose to walk: installation,
configuration, publishing, rollback, search, navigation and access control.

## Procedure

1. Build an immutable preview.
2. Inspect the generated navigation and discovery files.
3. Activate the release atomically.

${CODE}

## Model

${MATH}

${withCharts ? charts(index) : ''}

> A closing note so the document does not end on a directive.
`,
    })
  }
  return revisions
}

export const loadTestSite = {
  id: 'loadtest-site',
  name: 'ContentKit load harness',
  description: 'Reproducible release-build load corpus',
  base_url: 'https://loadtest.example',
  default_locale: 'en',
  settings: {},
}

export const loadTestLocales = [{ locale: 'de' }, { locale: 'en' }]
