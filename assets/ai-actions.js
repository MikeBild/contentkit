// The shared clipboard module: the copy-Markdown button in a post's AI share
// row and the copy-feed-URL button in a subscribe row (blog index, blogcast).
//
// Ships only on pages with a copy affordance (layout() adds it behind
// options.aiActions), so it never taxes a page that cannot use it. The buttons
// are server-rendered [hidden]: without this script they could not do
// anything, and the plain link right next to each (index.md, the RSS feed) is
// the no-JS answer.
//
// The Markdown fetch is same-origin (connect-src 'self'), the deep links in
// the same rows are ordinary <a href> navigations — nothing on these pages
// talks to an AI provider on the reader's behalf.
//
// CSP-safe: no inline script, no inline handlers, textContent only.
;(() => {
  if (!navigator.clipboard) return

  // The confirmation is mirrored into a visually hidden role="status" region:
  // renaming an already-focused button is not reliably announced, the live
  // region is (the search/archive counters set this precedent).
  const status = document.createElement('span')
  status.className = 'sr-only'
  status.setAttribute('role', 'status')
  document.body.append(status)

  const wire = (button, getText) => {
    button.hidden = false
    const label = button.textContent
    const copied = button.dataset.copied || label
    let timer = 0
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(await getText())
        button.textContent = copied
        status.textContent = copied
        clearTimeout(timer)
        timer = setTimeout(() => {
          button.textContent = label
          status.textContent = ''
        }, 2000)
      } catch {
        // Clipboard or fetch declined: the plain link next to the button is
        // the fallback, so failing silently loses the reader nothing.
      }
    })
  }

  for (const button of document.querySelectorAll('[data-copy-markdown]')) {
    wire(button, async () => {
      const response = await fetch(button.dataset.copyMarkdown, { credentials: 'same-origin' })
      if (!response.ok) throw new Error('http')
      return response.text()
    })
  }
  for (const button of document.querySelectorAll('[data-copy-feed]')) {
    wire(button, () => button.dataset.copyFeed)
  }
})()
