import test from 'node:test'
import assert from 'node:assert/strict'
import { extractSpeechText } from '../../src/speech-text.mjs'

const doc = (body, frontmatter = 'kind: post\ntitle: Testbeitrag\nlocale: de\nslug: testbeitrag') =>
  `---\n${frontmatter}\n---\n${body}`

test('strips frontmatter and prepends the title as its own sentence', () => {
  const { text } = extractSpeechText(doc('Erster Absatz.'), { title: 'Testbeitrag' })
  assert.equal(text, 'Testbeitrag.\n\nErster Absatz.')
})

test('drops fenced code and mermaid blocks entirely', () => {
  const body = 'Davor.\n\n```js\nconst x = 1\n```\n\n```mermaid\ngraph TD; A-->B\n```\n\nDanach.'
  const { text } = extractSpeechText(doc(body))
  assert.doesNotMatch(text, /const x|graph TD/)
  assert.match(text, /Davor\./)
  assert.match(text, /Danach\./)
})

test('a code-only edit does not change the speech hash, a prose edit does', () => {
  const before = extractSpeechText(doc('Prosa bleibt.\n\n```js\nconst x = 1\n```\n'))
  const codeEdit = extractSpeechText(doc('Prosa bleibt.\n\n```js\nconst x = 2\n```\n'))
  const proseEdit = extractSpeechText(doc('Prosa ändert sich.\n\n```js\nconst x = 1\n```\n'))
  assert.equal(before.sha256, codeEdit.sha256)
  assert.notEqual(before.sha256, proseEdit.sha256)
})

test('cuts the sources section from its heading to the end of the document', () => {
  const body = 'Inhalt.\n\n## Weiterführende Quellen\n\n- [Doku](https://example.com)\n- Noch ein Link\n'
  const { text } = extractSpeechText(doc(body))
  assert.doesNotMatch(text, /Weiterführende Quellen|example\.com|Noch ein Link/)
  assert.match(text, /Inhalt\./)
})

test('links keep their text and lose the URL', () => {
  const { text } = extractSpeechText(doc('Siehe [die Doku](https://example.com/docs) dazu.'))
  assert.equal(text, 'Siehe die Doku dazu.')
})

test('removes the italic series line but keeps inline emphasis elsewhere', () => {
  const body = '*Teil 3 der Serie über Software-Architektur.*\n\nDas ist *wichtig* zu wissen.'
  const { text } = extractSpeechText(doc(body))
  assert.doesNotMatch(text, /Teil 3 der Serie/)
  assert.equal(text, 'Das ist wichtig zu wissen.')
})

test('removes the Auftakt series line variant', () => {
  const { text } = extractSpeechText(doc('*Auftakt der Serie über X.*\n\nProsa.'))
  assert.equal(text, 'Prosa.')
})

test('headings and list items become sentences with a terminal stop', () => {
  const body = '## Ein Abschnitt\n\n- erster Punkt\n- zweiter Punkt!\n\n1. nummeriert'
  const { text } = extractSpeechText(doc(body))
  assert.match(text, /Ein Abschnitt\./)
  assert.match(text, /erster Punkt\./)
  assert.match(text, /zweiter Punkt!/)
  assert.doesNotMatch(text, /zweiter Punkt!\./)
  assert.match(text, /nummeriert\./)
})

test('strips inline code markers, bold markers and blockquote markers but keeps the words', () => {
  const body = '> Ein **wichtiges** Zitat mit `code`.\n\nNormaler _Text_.'
  const { text } = extractSpeechText(doc(body))
  assert.equal(text, 'Ein wichtiges Zitat mit code.\n\nNormaler Text.')
})

test('drops images and collapses the resulting blank lines', () => {
  const body = 'Davor.\n\n![Alt-Text](bild.png)\n\n\n\nDanach.'
  const { text } = extractSpeechText(doc(body))
  assert.equal(text, 'Davor.\n\nDanach.')
})

test('frontmatter audio: false flips enabled off; absence means on', () => {
  const off = extractSpeechText(doc('Text.', 'kind: post\ntitle: T\nlocale: de\nslug: t\naudio: false'))
  const on = extractSpeechText(doc('Text.'))
  assert.equal(off.enabled, false)
  assert.equal(on.enabled, true)
})

test('chars counts the extracted text and the hash is stable', () => {
  const first = extractSpeechText(doc('Hallo Welt.'), { title: 'T' })
  const second = extractSpeechText(doc('Hallo Welt.'), { title: 'T' })
  assert.equal(first.chars, first.text.length)
  assert.equal(first.sha256, second.sha256)
})
