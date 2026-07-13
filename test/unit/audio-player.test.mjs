// Tests for the browser-side read-aloud player (assets/audio.js).
//
// The script is an IIFE that talks to the DOM, so it needs a DOM to run in —
// but a headless-browser dependency for one 170-line asset is a poor trade, and
// the surface it touches is small and known. So: a minimal DOM built here, the
// real script evaluated against it with node:vm, and the markup taken from the
// real audioPlayer() template rather than a hand-written fixture. That last part
// matters — it means renaming a data-* hook in templates.mjs breaks these tests
// instead of silently breaking the player.
//
// The regressions these pin down: with preload="none" the element sits at
// readyState 0 until the first play, and the skip buttons and the seek slider
// used to refuse to act in that state, which is every fresh page view.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { audioPlayer, dictionary } from '../../src/templates.mjs'

const SOURCE = await readFile(new URL('../../assets/audio.js', import.meta.url), 'utf8')
const AUDIO_URL = '/media/asset-1/post-vorlesen.mp3'
const STORAGE_KEY = `contentkit-audio:${AUDIO_URL}`

const VOID_TAGS = new Set(['input', 'img', 'br', 'hr', 'meta', 'link'])
const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())

class El {
  constructor(tag, attrs = {}) {
    this.tagName = tag
    this.attrs = attrs
    this.children = []
    this.listeners = new Map()
    this.textContent = ''
    this.hidden = 'hidden' in attrs
    this.dataset = {}
    for (const [name, value] of Object.entries(attrs)) {
      if (name.startsWith('data-')) this.dataset[camel(name.slice(5))] = value
    }

    if (tag === 'audio') {
      // Just enough HTMLMediaElement to be honest about the thing under test:
      // currentTime is assignable at readyState 0 (the browser keeps it as the
      // default playback start position), which is the whole point of the fix.
      this.controls = 'controls' in attrs
      this.readyState = 0
      this.duration = NaN
      this.paused = true
      this.currentTime = 0
      this.playbackRate = 1
      this.src = attrs.src || ''
      this.currentSrc = ''
    }
    if (tag === 'input') {
      this._min = Number(attrs.min ?? 0)
      this._max = Number(attrs.max ?? 100)
      this._value = Number(attrs.value ?? 0)
    }
  }

  // A range input clamps its value into [min, max] — emulated because a
  // collapsed max is exactly how a broken scrubber shows up.
  get value() {
    return String(this._value)
  }
  set value(next) {
    this._value = Math.min(Math.max(Number(next) || 0, this._min), this._max)
  }
  get max() {
    return String(this._max)
  }
  set max(next) {
    this._max = Number(next) || 0
    this._value = Math.min(this._value, this._max)
  }

  append(child) {
    this.children.push(child)
    return child
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value)
  }
  getAttribute(name) {
    return this.attrs[name] ?? null
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(handler)
  }
  dispatch(type) {
    for (const handler of this.listeners.get(type) || []) handler({ type, target: this })
  }
  click() {
    this.dispatch('click')
  }
  play() {
    this.paused = false
    this.dispatch('play')
    return Promise.resolve()
  }
  pause() {
    this.paused = true
    this.dispatch('pause')
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }
  querySelectorAll(selector) {
    const found = []
    for (const child of this.children) {
      if (matches(child, selector)) found.push(child)
      found.push(...child.querySelectorAll(selector))
    }
    return found
  }
}

// Only the selector shapes assets/audio.js actually uses: an optional tag, an
// optional class, and an optional [attr] or [attr="value"].
function matches(el, selector) {
  const parsed = /^([a-z]+)?(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/.exec(selector)
  assert.ok(parsed, `unsupported selector in test DOM: ${selector}`)
  const [, tag, className, attr, attrValue] = parsed
  if (tag && el.tagName !== tag) return false
  if (
    className &&
    !String(el.attrs.class || '')
      .split(/\s+/)
      .includes(className)
  )
    return false
  if (attr) {
    if (!(attr in el.attrs)) return false
    if (attrValue !== undefined && el.attrs[attr] !== attrValue) return false
  }
  return true
}

function parseHtml(html) {
  const root = new El('#root')
  const stack = [root]
  const token = /<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g
  let match
  while ((match = token.exec(html))) {
    const [, closing, tag, rawAttrs, selfClosing, text] = match
    if (closing) {
      if (stack.length > 1) stack.pop()
    } else if (tag) {
      const attrs = {}
      const attr = /([^\s=]+)(?:="([^"]*)")?/g
      let a
      while ((a = attr.exec(rawAttrs || ''))) attrs[a[1].toLowerCase()] = a[2] ?? ''
      const el = stack.at(-1).append(new El(tag, attrs))
      if (!VOID_TAGS.has(tag) && !selfClosing) stack.push(el)
    } else if (text && text.trim()) {
      stack.at(-1).textContent += text
    }
  }
  return root
}

// Renders the real player markup, runs the real script against it, and hands
// back the pieces. `stored` seeds a remembered listening position.
function mount({ durationSecs = 845, stored = null } = {}) {
  const html = audioPlayer(
    { audio: { url: AUDIO_URL, duration_secs: durationSecs } },
    { locale: 'de', t: dictionary('de') },
  )
  const root = parseHtml(html)

  const store = new Map()
  if (stored !== null) store.set(STORAGE_KEY, String(stored))
  const localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }

  runInNewContext(SOURCE, { document: root, localStorage })

  const player = root.querySelector('.audio-player[data-audio]')
  return {
    player,
    store,
    audio: player.querySelector('audio'),
    seek: player.querySelector('[data-audio-seek]'),
    timeReadout: () => player.querySelector('[data-audio-time]').textContent,
    forward: player.querySelector('[data-audio-skip="15"]'),
    back: player.querySelector('[data-audio-skip="-15"]'),
    playButton: player.querySelector('[data-audio-play]'),
  }
}

test('the script wires itself to the real template markup', () => {
  const { player, audio } = mount()
  // If this fails, the template and the script have drifted apart.
  assert.equal(player.dataset.audio, AUDIO_URL)
  assert.equal(player.dataset.duration, '845')
  assert.ok(audio, 'the player must contain an <audio> element')
})

test('the custom bar replaces the native controls once the script has driven it', () => {
  const { player, audio } = mount()
  assert.equal(audio.controls, false, 'native controls must be off')
  assert.equal(player.querySelector('[data-audio-ui]').hidden, false, 'the custom bar must be revealed')
  assert.equal(player.querySelector('[data-audio-rates]').hidden, false, 'the tempo group must be revealed')
})

// The regression. preload="none" means readyState is 0 on every fresh page view,
// and the old code returned early in exactly that state, so the button was dead.
test('+15 s seeks before playback has started (readyState 0)', () => {
  const { audio, forward, seek, timeReadout } = mount()
  assert.equal(audio.readyState, 0, 'precondition: nothing has loaded yet')

  forward.click()

  assert.equal(audio.currentTime, 15)
  assert.equal(seek.value, '15')
  assert.equal(timeReadout(), '0:15 / 14:05')
})

// Same regression, other control: the old code skipped the currentTime write, so
// the thumb sprang back to 0 on the next render.
test('the seek slider commits its position before playback has started', () => {
  const { audio, seek, timeReadout } = mount()

  seek.value = '600'
  seek.dispatch('input')
  seek.dispatch('change')

  assert.equal(audio.currentTime, 600)
  assert.equal(timeReadout(), '10:00 / 14:05')

  // and a later timeupdate must not drag it back
  audio.dispatch('timeupdate')
  assert.equal(audio.currentTime, 600)
  assert.equal(seek.value, '600')
})

test('a deliberate seek before play beats the remembered listening position', () => {
  const { audio, forward } = mount({ stored: 722 })

  forward.click()
  assert.equal(audio.currentTime, 15)

  audio.play()

  assert.equal(audio.currentTime, 15, 'the resume must not override a position the listener chose')
})

test('the remembered position is still restored when the listener did not seek', () => {
  const { audio } = mount({ stored: 722 })

  audio.play()

  assert.equal(audio.currentTime, 722)
})

test('a remembered position within the last seconds restarts from the top', () => {
  const { audio } = mount({ stored: 840 })
  audio.duration = 844.66

  audio.play()

  assert.equal(audio.currentTime, 0, 'resuming into the final seconds is never what a listener wants')
})

test('skipping clamps to the start and to the duration', () => {
  const { audio, forward, back } = mount()

  audio.currentTime = 5
  back.click()
  assert.equal(audio.currentTime, 0, 'must not seek to a negative time')

  audio.duration = 844.66
  audio.currentTime = 840
  forward.click()
  assert.equal(audio.currentTime, 844.66, 'must not seek past the end')
})

test('skipping steps by exactly 15 s during playback', () => {
  const { audio, forward, back } = mount()
  audio.readyState = 4
  audio.duration = 844.66
  audio.currentTime = 400

  forward.click()
  assert.equal(audio.currentTime, 415)
  back.click()
  assert.equal(audio.currentTime, 400)
})

test('real metadata replaces the build-time duration on the scrubber and the readout', () => {
  const { audio, seek, timeReadout } = mount()
  assert.equal(seek.max, '845', 'until metadata arrives, the build-time duration is all we have')

  audio.duration = 903.4
  audio.dispatch('loadedmetadata')

  assert.equal(seek.max, '903')
  assert.equal(timeReadout(), '0:00 / 15:03')
})

test('the play button toggles playback, its icons and its label', () => {
  const { audio, player, playButton } = mount()
  const iconPlay = player.querySelector('[data-audio-icon="play"]')
  const iconPause = player.querySelector('[data-audio-icon="pause"]')
  assert.equal(playButton.getAttribute('aria-label'), 'Abspielen')

  playButton.click()
  assert.equal(audio.paused, false)
  assert.equal(iconPlay.hidden, true)
  assert.equal(iconPause.hidden, false)
  assert.equal(playButton.getAttribute('aria-label'), 'Pause')

  playButton.click()
  assert.equal(audio.paused, true)
  assert.equal(iconPlay.hidden, false)
  assert.equal(iconPause.hidden, true)
  assert.equal(playButton.getAttribute('aria-label'), 'Abspielen')
})

test('the tempo buttons set the playback rate and carry the pressed state', () => {
  const { audio, player } = mount()
  const rates = player.querySelectorAll('[data-audio-rate]')
  const [one, faster] = [rates[0], rates[2]]
  assert.equal(faster.dataset.audioRate, '1.5')

  faster.click()

  assert.equal(audio.playbackRate, 1.5)
  assert.equal(faster.getAttribute('aria-pressed'), 'true')
  assert.equal(one.getAttribute('aria-pressed'), 'false')
})

test('the listening position is persisted on pause and cleared when the post ends', () => {
  const { audio, store } = mount()

  audio.currentTime = 321
  audio.pause()
  assert.equal(store.get(STORAGE_KEY), '321')

  audio.dispatch('ended')
  assert.equal(store.has(STORAGE_KEY), false, 'finishing must start the next visit from the top')
})

test('a browser that forbids localStorage does not break playback', () => {
  const html = audioPlayer({ audio: { url: AUDIO_URL, duration_secs: 845 } }, { locale: 'de', t: dictionary('de') })
  const root = parseHtml(html)
  const hostile = {
    getItem() {
      throw new Error('private mode')
    },
    setItem() {
      throw new Error('private mode')
    },
    removeItem() {
      throw new Error('private mode')
    },
  }

  runInNewContext(SOURCE, { document: root, localStorage: hostile })

  const player = root.querySelector('.audio-player[data-audio]')
  const audio = player.querySelector('audio')
  audio.play() // reads the resume position
  player.querySelector('[data-audio-skip="15"]').click()
  audio.pause() // writes the resume position

  assert.equal(audio.currentTime, 15, 'the player still works; only the resume position is lost')
})
