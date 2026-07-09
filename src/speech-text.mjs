import { parse as parseYaml } from 'yaml'
import { normalizeTitle } from './markdown.mjs'
import { sha256 } from './utils.mjs'

// Turns authored Markdown into the text a TTS voice actually reads aloud.
//
// The returned sha256 is the read-aloud identity of a revision: it hashes the
// *extracted speech text*, not the Markdown source. Fixing a typo inside a code
// fence or appending a link to the sources section changes the source hash but
// not the speech hash — and must never trigger a paid re-synthesis.
//
// What a listener should not have to sit through:
// - frontmatter (metadata, not prose),
// - the trailing `## Weiterführende Quellen` section (a link list),
// - fenced code and mermaid diagrams (read as noise, never as meaning),
// - the italic series line (`*Auftakt der Serie …*` / `*Teil N der Serie …*`),
// - URLs (links keep their text), image syntax, math, HTML.
// Structure that survives is flattened into sentences: headings and list items
// become sentences of their own so the voice pauses where the page breaks.

// The sources section is a convention of the corpus this feature was built for:
// a final H2 of outbound links, valuable on screen and useless in the ear.
const SOURCES_HEADING = /^##\s+Weiterführende Quellen\b[^\n]*$/m

// A line that is nothing but an italic series marker. Requires the whole line to
// be the emphasised span, so an inline "*wichtig*" elsewhere is never touched.
const SERIES_LINE = /^[ \t]*[*_](?:Auftakt der Serie|Teil \d+ der Serie)[^\n]*[*_][ \t]*$/gm

// Headings and list items are clauses, not sentences; give each a terminal stop
// so the synthesised voice pauses instead of running the outline together.
const sentence = (value) => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /[.!?:…]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith('---\n') && !markdown.startsWith('---\r\n')) return { data: {}, content: markdown }
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return { data: {}, content: markdown }
  let data = {}
  try {
    data = parseYaml(match[1], { maxAliasCount: 20 }) || {}
  } catch {
    // Ingest already validated the document; a parse failure here only means
    // "no overrides", never a hard error on the async audio path.
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = {}
  return { data, content: markdown.slice(match[0].length) }
}

export function extractSpeechText(markdown, { title = '' } = {}) {
  const { data, content } = parseFrontmatter(String(markdown || ''))
  // Frontmatter `audio: false` is the per-document opt-out; absence means on.
  const enabled = data.audio !== false

  // Cut the sources section first: everything from its heading to EOF is links.
  const sourcesAt = content.search(SOURCES_HEADING)
  let text = sourcesAt === -1 ? content : content.slice(0, sourcesAt)

  // The rendered page drops a leading `# Heading` that repeats the frontmatter
  // title (dropRedundantTitle in markdown.mjs). The recording must drop it too:
  // the title is prepended as the opening sentence below, so keeping the
  // heading had the voice read the title twice in a row.
  if (title) {
    const heading = text.match(/^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\n|$)/)
    if (heading && normalizeTitle(heading[1]) === normalizeTitle(title)) {
      text = text.slice(heading[0].length)
    }
  }

  text = text
    // Fenced code (``` and ~~~, any info string incl. mermaid); the second
    // pattern catches an unterminated fence running to EOF. Same order and
    // rationale as readingTime() in utils.mjs: fences may contain every other
    // marker, so they must go before anything inline is touched.
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm, ' ')
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*$/m, ' ')
    // HTML comments, then raw tags.
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    // The italic series line is navigation, not prose.
    .replace(SERIES_LINE, ' ')
    // Images vanish entirely; a link keeps its text and loses the URL;
    // reference definitions go entirely.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*\[[^\]]+\]:[^\n]*$/gm, ' ')
    // Math renders as glyphs, not words. Block before inline.
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]*\$/g, ' ')
    // Directive fences (:::tip … :::) lose the markers, keep the content.
    .replace(/^[ \t]*:{3,}[^\n]*$/gm, ' ')
    // Blockquote markers; the quoted prose itself is read.
    .replace(/^[ \t]*>+[ \t]?/gm, '')
    // Headings and list items become sentences of their own.
    .replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, (match, heading) => sentence(heading))
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(.+)$/gm, (match, item) => sentence(item))
    // Inline code keeps its content (usually a single identifier), loses the
    // backticks; bold/italic keep the words, lose the markers.
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/(\*\*|__)([^*_]+)\1/g, '$2')
    .replace(/(\*|_)([^\s*_][^*_]*)\1/g, '$2')
    .replace(/[*_~`]/g, '')
    // Collapse per-line whitespace, then multi-blank-lines to one break.
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // The title opens the recording as its own sentence, so a listener knows what
  // they are hearing before the prose starts.
  if (title) text = text ? `${sentence(title)}\n\n${text}` : sentence(title)

  return { text, sha256: sha256(text), chars: text.length, enabled }
}
