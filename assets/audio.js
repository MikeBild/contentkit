// Read-aloud player enhancements: a custom control bar (play/pause, ±15 s,
// seek slider, time readout), playback-tempo buttons (1×/1.25×/1.5×) and a
// remembered listening position per audio URL.
//
// Ships only on pages that render a player (layout() adds it behind
// options.audio), so it never taxes a page view without one. Progressive
// enhancement: the native <audio controls> works without this script; the
// custom bar and the tempo buttons ship in the markup but hidden, because
// without JS they could do nothing. This script swaps the native controls for
// the bar and drives it — all markup is server-rendered, JS only toggles
// attributes and textContent.
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

  // m:ss, mirroring the server-rendered initial readout in templates.mjs.
  const clock = (secs) => {
    const total = Math.max(0, Math.round(Number(secs) || 0))
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  }

  for (const player of players) {
    const audio = player.querySelector('audio')
    if (!audio) continue
    const key = storageKey(player.dataset.audio || audio.currentSrc || audio.src)

    // Resume where the listener left off. Seek on first play, not on load:
    // preload="none" means there is no duration to seek within until the
    // element actually starts fetching. A listener who scrubbed or skipped
    // before pressing play has already said where they want to be, so their
    // choice wins over the stored position.
    let resumed = false
    let userSeeked = false
    audio.addEventListener('play', () => {
      if (resumed) return
      resumed = true
      if (userSeeked) return
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
    if (rates) {
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

    // The custom control bar. Only once everything is wired does it replace
    // the native controls — if any of this throws, the player stays native.
    const ui = player.querySelector('[data-audio-ui]')
    if (!ui) continue
    // preload="none": until metadata arrives the only known duration is the
    // build-time one the markup carries.
    const duration = () =>
      Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number(player.dataset.duration) || 0

    const playButton = ui.querySelector('[data-audio-play]')
    const iconPlay = ui.querySelector('[data-audio-icon="play"]')
    const iconPause = ui.querySelector('[data-audio-icon="pause"]')
    const seek = ui.querySelector('[data-audio-seek]')
    const time = ui.querySelector('[data-audio-time]')

    const renderTime = (current) => {
      if (time) time.textContent = `${clock(current)} / ${clock(duration())}`
    }
    let scrubbing = false
    const render = () => {
      renderTime(audio.currentTime)
      if (seek && !scrubbing) {
        // Only overwrite the server-rendered max once a real duration is known —
        // clamping it to 1 while the duration is still unknown would pin the
        // thumb to the far end and make the whole track a one-second range.
        const limit = Math.round(duration())
        if (limit > 0) seek.max = String(limit)
        seek.value = String(Math.floor(audio.currentTime))
      }
    }

    // Seeking before the audio has loaded is legitimate. With preload="none"
    // readyState stays 0 until the first play, and assigning currentTime in that
    // state is not ignored — it sets the default playback start position, which
    // the browser applies as soon as it has metadata. Refusing to seek on
    // readyState 0 is what left ±15 s and the scrubber dead on a fresh page.
    const seekTo = (seconds) => {
      const limit = duration()
      userSeeked = true
      audio.currentTime = Math.max(0, limit ? Math.min(seconds, limit) : seconds)
      render()
    }

    if (playButton) {
      const setState = (playing) => {
        if (iconPlay) iconPlay.hidden = playing
        if (iconPause) iconPause.hidden = !playing
        const label = playing ? playButton.dataset.labelPause : playButton.dataset.labelPlay
        if (label) playButton.setAttribute('aria-label', label)
      }
      playButton.addEventListener('click', () => {
        // play() rejects on the autoplay policy and on a failed load; neither is
        // worth an unhandled rejection in the console.
        if (audio.paused) audio.play().catch(() => {})
        else audio.pause()
      })
      audio.addEventListener('play', () => setState(true))
      audio.addEventListener('pause', () => setState(false))
      audio.addEventListener('ended', () => setState(false))
    }

    for (const skip of ui.querySelectorAll('[data-audio-skip]')) {
      skip.addEventListener('click', () => {
        const step = Number(skip.dataset.audioSkip) || 0
        seekTo(audio.currentTime + step)
      })
    }

    if (seek) {
      // While dragging, preview the target time but leave playback alone;
      // commit the position on release ('change'). timeupdate must not fight
      // the thumb mid-drag, hence the scrubbing flag.
      seek.addEventListener('input', () => {
        scrubbing = true
        renderTime(Number(seek.value) || 0)
      })
      seek.addEventListener('change', () => {
        scrubbing = false
        seekTo(Number(seek.value) || 0)
      })
    }

    audio.addEventListener('timeupdate', render)
    audio.addEventListener('loadedmetadata', render)
    audio.addEventListener('ended', render)
    render()

    // Swap: hide the native controls (an <audio> without them renders no box)
    // and reveal the bar.
    audio.controls = false
    ui.hidden = false
  }
})()
