#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const invalid = (message) => Object.assign(new Error(message), { statusCode: 2 })

function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

function parts(source) {
  const match = String(source)
    .replace(/^\uFEFF/, '')
    .match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!match) return { frontmatter: {}, body: String(source) }
  return { frontmatter: parseYaml(match[1]) || {}, body: String(source).slice(match[0].length) }
}

export function migrateSlidekitSource(source, options = {}) {
  const { frontmatter: legacy, body } = parts(source)
  const heading = body
    .match(/^#[ \t]+(.+)$/m)?.[1]
    ?.replace(/[*_`]/g, '')
    .trim()
  const title = String(options.title || legacy.title || heading || '').trim()
  if (!title) throw invalid('legacy deck needs a title (headmatter, first H1 or --title)')
  const locale = String(options.locale || legacy.locale || 'en').toLowerCase()
  const slug = slugify(options.slug || legacy.slug || title)
  if (!slug) throw invalid('legacy deck needs a valid slug or --slug')

  const firstSlide = { ...(legacy.deck?.firstSlide || {}) }
  if (legacy.layout && legacy.layout !== 'deck') firstSlide.layout = legacy.layout
  const legacyScheme = legacy.colorSchema === 'dark' || legacy.colorSchema === 'light' ? legacy.colorSchema : 'auto'
  const deck = {
    ...(legacy.deck || {}),
    theme: options.theme || legacy.deck?.theme || 'neutral',
    visualScheme: options.visualScheme || legacy.deck?.visualScheme || legacyScheme,
    maxSlides: Number(options.maxSlides || legacy.deck?.maxSlides || 120),
    ...(Object.keys(firstSlide).length ? { firstSlide } : {}),
  }
  delete deck.first_slide

  const migrated = {
    ...legacy,
    kind: 'deck',
    layout: 'deck',
    title,
    locale,
    slug,
    summary: String(options.summary || legacy.summary || legacy.info || '')
      .trim()
      .slice(0, 500),
    deck,
  }
  delete migrated.theme
  delete migrated.colorSchema
  return `---\n${stringifyYaml(migrated).trim()}\n---\n\n${body.replace(/^\s+/, '')}`
}

function option(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

async function main() {
  const args = process.argv.slice(2)
  const input = args.find(
    (entry, index) => !entry.startsWith('--') && (index === 0 || !args[index - 1].startsWith('--')),
  )
  if (!input)
    throw invalid('usage: npm run migrate:slidekit -- <input.md> [--out output.md] [--locale en] [--theme neutral]')
  const source = await readFile(resolve(input), 'utf8')
  const result = migrateSlidekitSource(source, {
    title: option(args, '--title'),
    slug: option(args, '--slug'),
    locale: option(args, '--locale'),
    summary: option(args, '--summary'),
    theme: option(args, '--theme'),
    visualScheme: option(args, '--visual-scheme'),
    maxSlides: option(args, '--max-slides'),
  })
  const output = option(args, '--out')
  if (output) {
    await writeFile(resolve(output), result, 'utf8')
    process.stderr.write(`wrote ${resolve(output)}\n`)
  } else process.stdout.write(result)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = error.statusCode || 1
  })
}
