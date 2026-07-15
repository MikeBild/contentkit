// One-click post feedback ("Was this post helpful?"). Ships only on post pages
// whose site opted in (layout() adds it behind options.feedback).
//
// The vote buttons are server-rendered [hidden]: without this script a click
// could do nothing. Dedup is a localStorage marker per post — honest readers
// vote once per device, and the server-side rate limit bounds everyone else.
// Nothing identifying is stored or sent: the payload is the site id, the vote,
// and the empty honeypot field the endpoint expects.
//
// CSP-safe: no inline handlers; the POST is same-origin (connect-src 'self').
;(() => {
  const section = document.querySelector('[data-feedback]')
  if (!section) return
  const key = `contentkit-feedback:${section.dataset.feedback}`
  const prompt = section.querySelector('.post-feedback-prompt')
  const thanks = section.querySelector('[data-feedback-thanks]')
  const buttons = [...section.querySelectorAll('[data-feedback-vote]')]

  const done = () => {
    for (const button of buttons) button.hidden = true
    if (prompt) prompt.hidden = true
    thanks.textContent = section.dataset.thanks
    thanks.hidden = false
  }

  let voted = null
  try {
    voted = localStorage.getItem(key)
  } catch {
    // Private mode without storage: voting still works, only the marker is lost.
  }
  if (voted) return done()

  for (const button of buttons) {
    button.hidden = false
    button.addEventListener('click', async () => {
      for (const b of buttons) b.disabled = true
      try {
        const response = await fetch(section.dataset.action, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ site_id: section.dataset.site, vote: button.dataset.feedbackVote, website: '' }),
        })
        if (!response.ok) throw new Error('http')
        try {
          localStorage.setItem(key, button.dataset.feedbackVote)
        } catch {
          /* see above */
        }
        done()
      } catch {
        for (const b of buttons) b.disabled = false
      }
    })
  }
})()
