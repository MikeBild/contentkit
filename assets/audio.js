// Read-aloud player enhancements: playback-tempo buttons (1×/1.25×/1.5×) and a
// remembered listening position per audio URL.
//
// Ships only on pages that render a player (layout() adds it behind
// options.audio), so it never taxes a page view without one. The <audio
// controls> element itself works without this script; the tempo buttons ship
// hidden and are unhidden here, because without JS they could do nothing.
//
// CSP-safe: no inline script, no inline handlers, no innerHTML. localStorage is
// wrapped — private-mode browsers throw on access, and losing the resume
// position must never break playback.
;(() => {
  const players = [...document.querySelectorAll('.audio-player[data-audio]')]
  if (!players.length) return

  const storageKey = (url) => `contentkit-audio:${url}`
  const read = (key) => {
    try {
      return Number(localStorage.getItem(key)) || 0
    } catch {
      return 0
    }
  }
  const write = (key, value) => {
    try {
      if (value > 0) localStorage.setItem(key, String(Math.floor(value)))
      else localStorage.removeItem(key)
    } catch {
      /* private mode: playback works, resume does not */
    }
  }

  for (const player of players) {
    const audio = player.querySelector('audio')
    if (!audio) continue
    const key = storageKey(player.dataset.audio || audio.currentSrc || audio.src)

    // Resume where the listener left off. Seek on first play, not on load:
    // preload="none" means there is no duration to seek within until the
    // element actually starts fetching.
    let resumed = false
    audio.addEventListener('play', () => {
      if (resumed) return
      resumed = true
      const position = read(key)
      // Near-the-end positions restart from zero — resuming into the last
      // seconds of a post is never what a returning listener wants.
      if (position > 5 && (!audio.duration || position < audio.duration - 10)) {
        audio.currentTime = position
      }
    })

    // Persist sparsely: every ~5s while playing, plus on pause. Finishing
    // clears the slot so the next visit starts from the top.
    let lastSaved = 0
    audio.addEventListener('timeupdate', () => {
      if (audio.paused) return
      const now = Date.now()
      if (now - lastSaved < 5000) return
      lastSaved = now
      write(key, audio.currentTime)
    })
    audio.addEventListener('pause', () => write(key, audio.currentTime))
    audio.addEventListener('ended', () => write(key, 0))

    // Tempo switch. aria-pressed carries the visual state, so no extra class.
    const rates = player.querySelector('[data-audio-rates]')
    if (!rates) continue
    const buttons = [...rates.querySelectorAll('[data-audio-rate]')]
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const rate = Number(button.dataset.audioRate) || 1
        audio.playbackRate = rate
        for (const other of buttons) other.setAttribute('aria-pressed', String(other === button))
      })
    }
    rates.hidden = false
  }
})()
