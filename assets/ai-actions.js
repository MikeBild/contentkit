// The copy-Markdown button in a post's AI share row.
//
// Ships only on post pages that have a Markdown twin (layout() adds it behind
// options.aiActions), so it never taxes a page that cannot use it. The button
// is server-rendered [hidden]: without this script it could not do anything,
// and the plain index.md link right next to it is the no-JS answer.
//
// The fetch is same-origin (connect-src 'self'), the deep links in the same row
// are ordinary <a href> navigations — nothing on this page talks to an AI
// provider on the reader's behalf.
//
// CSP-safe: no inline script, no inline handlers, textContent only.
;(() => {
  const button = document.querySelector('[data-copy-markdown]')
  if (!button || !navigator.clipboard) return
  button.hidden = false
  const label = button.textContent
  const copied = button.dataset.copied || label
  let timer = 0
  button.addEventListener('click', async () => {
    try {
      const response = await fetch(button.dataset.copyMarkdown, { credentials: 'same-origin' })
      if (!response.ok) throw new Error('http')
      await navigator.clipboard.writeText(await response.text())
      button.textContent = copied
      clearTimeout(timer)
      timer = setTimeout(() => {
        button.textContent = label
      }, 2000)
    } catch {
      // Clipboard or fetch declined: the index.md link next to the button is
      // the fallback, so failing silently loses the reader nothing.
    }
  })
})()
