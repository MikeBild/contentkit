import { performance } from 'node:perf_hooks'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSite } from '../src/site-builder.mjs'
import { hashReaderPassword, mostSpecificAccess, verifyReaderPassword } from '../src/access.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const budgets = JSON.parse(await readFile(new URL('../benchmarks/budgets.json', import.meta.url), 'utf8'))
const count = Number(process.env.CONTENTKIT_BENCHMARK_DOCUMENTS || 1000)
const revisions = []
for (let index = 0; index < count; index++) {
  const locale = index % 2 ? 'en' : 'de'
  const localIndex = Math.floor(index / 2)
  const rootIndex = Math.floor(localIndex / 10) * 10
  const isRoot = localIndex === rootIndex
  const key = `document-${localIndex}`
  revisions.push({
    id: `revision-${index}`,
    item_id: `item-${index}`,
    kind: 'page',
    locale,
    translation_key: `${key}-v2-${locale}`,
    markdown: `---
kind: page
layout: docs
title: Benchmark document ${index}
locale: ${locale}
slug: ${key}
translationKey: ${key}-v2-${locale}
docKey: ${key}
docsVersion: v2
${isRoot ? '' : `parent: document-${rootIndex}\n`}navOrder: ${localIndex}
${index % 5 === 0 ? 'access: [customers]\n' : ''}---
# Benchmark document ${index}

This realistic benchmark paragraph describes installation, configuration,
publishing, rollback, search, navigation, and protected customer operations.

## Procedure

1. Build an immutable preview.
2. Inspect generated navigation and discovery files.
3. Activate the release atomically.
`,
  })
}

const site = {
  id: 'benchmark-site',
  name: 'Contentkit benchmark',
  description: 'Reproducible documentation benchmark',
  base_url: 'https://benchmark.example',
  default_locale: 'en',
  settings: {
    presentation: {
      preset: 'product-docs',
      docs: { versions: [{ id: 'v2', label: '2.x', status: 'current' }] },
    },
  },
}

// Warm the Markdown processor and static asset reads before measuring the full corpus.
await buildSite({
  root,
  site,
  locales: [{ locale: 'de' }],
  revisions: revisions.slice(0, 1),
  comments: [],
  accessGroups: [{ slug: 'customers' }],
})

const buildStart = performance.now()
const built = await buildSite({
  root,
  site,
  locales: [{ locale: 'de' }, { locale: 'en' }],
  revisions,
  comments: [],
  accessGroups: [{ slug: 'customers' }],
})
const buildMs = performance.now() - buildStart

const rules = Array.from({ length: 20 }, (_, index) => ({
  match: 'prefix',
  path: `/en/docs/v2/document-${index * 10}/`,
  group_slugs: [`group-${index}`],
  user_ids: [],
}))
const accessStart = performance.now()
for (let index = 0; index < 100000; index++) {
  mostSpecificAccess(rules, `/en/docs/v2/document-${index % 200}/child/`)
}
const accessMs = performance.now() - accessStart

const passwordHash = await hashReaderPassword('benchmark-reader-password')
const passwordStart = performance.now()
await verifyReaderPassword('benchmark-reader-password', passwordHash)
const passwordVerifyMs = performance.now() - passwordStart

const report = {
  documents: count,
  generated_files: built.files.size,
  protected_documents: built.accessCatalog.length,
  build_ms: Number(buildMs.toFixed(2)),
  documents_per_second: Number((count / (buildMs / 1000)).toFixed(2)),
  rss_mb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2)),
  access_resolutions: 100000,
  access_resolution_ms: Number(accessMs.toFixed(2)),
  password_verify_ms: Number(passwordVerifyMs.toFixed(2)),
}

const violations = [
  ['build_ms', report.build_ms, budgets.build_ms_max],
  ['rss_mb', report.rss_mb, budgets.rss_mb_max],
  ['access_resolution_ms', report.access_resolution_ms, budgets.access_resolution_ms_max],
  ['password_verify_ms', report.password_verify_ms, budgets.password_verify_ms_max],
]
  .filter(([, actual, maximum]) => actual > maximum)
  .map(([metric, actual, maximum]) => ({ metric, actual, maximum }))
report.budgets = budgets
report.within_budget = violations.length === 0
report.violations = violations

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (process.env.CONTENTKIT_BENCHMARK_ASSERT === '1' && violations.length) process.exitCode = 1
