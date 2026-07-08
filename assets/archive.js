// Archive filtering: tag facets + free-text, applied in place.
//
// Ships only on /{locale}/archive/ (layout() adds it behind options.archive), so
// it never taxes a page view that cannot use it. search.js, which is on every
// page, stays untouched.
//
// Progressive enhancement, stated honestly. The archive is the crawlable index:
// every post is server-rendered inside a year group before this script runs. The
// facet chips are real <a href="/{locale}/tags/{slug}/"> links, so with scripting
// off a click lands on the real, server-rendered tag page — the correct no-JS
// answer to "filter by tag". Only the free-text field is hidden up front, because
// it has no server-side counterpart and offering it would be a lie.
//
// It does not fetch. The preview HTML rewriter only patches href|src|action|
// data-index attributes, so a fifth path attribute would 404 under /p/<token>/ —
// exactly where nobody would notice. Everything it needs is already in the DOM.
//
// CSP-safe: no inline script, no inline handlers, no innerHTML. Filtering only
// ever toggles `hidden` and writes `textContent`, so no node is ever constructed
// from a string and there is no hand-rolled escaping to get wrong.
;(() => {
  const toolbar = document.querySelector('[data-archive]')
  if (!toolbar) return
  const groups = [...document.querySelectorAll('[data-year-group]')]
  if (!groups.length) return

  const chips = [...toolbar.querySelectorAll('[data-tag]')]
  const searchBox = toolbar.querySelector('[data-archive-search]')
  const input = toolbar.querySelector('[data-archive-q]')
  const reset = toolbar.querySelector('[data-archive-reset]')
  const status = toolbar.querySelector('[data-archive-status]')
  const empty = document.querySelector('[data-archive-empty]')
  const jumpLinks = [...document.querySelectorAll('[data-year-link]')]

  const lang = document.documentElement.lang || 'en'
  const copy = {
    empty: input?.dataset.emptyText || 'No results.',
    one: input?.dataset.countOne || '1 post',
    many: input?.dataset.countMany || '{n} posts',
  }
  const DEBOUNCE = 120
  const MAX_QUERY = 100

  // data-search is pre-folded at build time with the locale's toLocaleLowerCase,
  // so the query has to fold the same way (Turkish dotless i).
  const lower = (value) => String(value).toLocaleLowerCase(lang)

  // The only tag slugs we will ever honour. A ?tag= value that is not a rendered
  // chip is dropped: never let a query parameter reach querySelector, which is a
  // CSS-selector-injection footgun even in a codebase with no innerHTML.
  const known = new Set(chips.map((chip) => chip.dataset.tag))

  const entries = groups.map((group) => ({
    group,
    heading: group.querySelector('[data-year-count]'),
    jump: jumpLinks.find((link) => link.dataset.yearLink === group.dataset.yearGroup) || null,
    items: [...group.querySelectorAll('li[data-search]')].map((li) => ({
      li,
      tags: new Set((li.dataset.tags || '').split(' ').filter(Boolean)),
      text: li.dataset.search || '',
    })),
  }))

  const selected = new Set()
  let query = ''
  let timer = 0

  const matchesText = (item, terms) => terms.every((term) => item.text.includes(term))
  const matchesTags = (item) => [...selected].every((tag) => item.tags.has(tag))

  function apply() {
    const terms = lower(query).trim().split(/\s+/).filter(Boolean)
    let total = 0

    for (const entry of entries) {
      let visible = 0
      for (const item of entry.items) {
        const show = matchesTags(item) && matchesText(item, terms)
        item.li.hidden = !show
        if (show) visible += 1
      }
      total += visible
      entry.group.hidden = visible === 0
      if (entry.heading) entry.heading.textContent = String(visible)
      if (entry.jump) {
        entry.jump.hidden = visible === 0
        const count = entry.jump.querySelector('[data-year-count]')
        if (count) count.textContent = String(visible)
      }
    }

    // Facet counts are computed against the *text filter alone*, ignoring the
    // other selected tags. Otherwise selecting `react` shows every other chip as
    // (0) and the UI dead-ends with nothing left to click.
    for (const chip of chips) {
      const tag = chip.dataset.tag
      let count = 0
      for (const entry of entries)
        for (const item of entry.items) if (item.tags.has(tag) && matchesText(item, terms)) count += 1
      const badge = chip.querySelector('[data-facet-count]')
      if (badge) badge.textContent = String(count)
      const active = selected.has(tag)
      if (active) chip.setAttribute('aria-current', 'true')
      else chip.removeAttribute('aria-current')
    }

    if (empty) empty.hidden = total > 0
    if (status) status.textContent = total === 0 ? copy.empty : total === 1 ? copy.one : copy.many.replace('{n}', total)
    if (reset) reset.hidden = selected.size === 0 && !query

    syncUrl()
  }

  // replaceState, not pushState: the back button should leave the archive, not
  // unwind eight keystrokes. ?tag=…&q=… survives a reload and can be shared.
  // No crawler ever sees these: the chips' href is the real tag page.
  function syncUrl() {
    const params = new URLSearchParams()
    for (const tag of selected) params.append('tag', tag)
    if (query) params.set('q', query)
    const search = params.toString()
    history.replaceState(null, '', search ? `${location.pathname}?${search}` : location.pathname)
  }

  function readUrl() {
    const params = new URLSearchParams(location.search)
    for (const tag of params.getAll('tag')) if (known.has(tag)) selected.add(tag)
    query = (params.get('q') || '').slice(0, MAX_QUERY)
    if (input) input.value = query
  }

  for (const chip of chips) {
    chip.addEventListener('click', (event) => {
      // Let modified clicks and middle-clicks reach the real tag page — the chip
      // is a genuine link and must keep behaving like one.
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button)
        return
      event.preventDefault()
      const tag = chip.dataset.tag
      if (selected.has(tag)) selected.delete(tag)
      else selected.add(tag)
      apply()
    })
  }

  if (input) {
    input.addEventListener('input', () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        query = input.value.slice(0, MAX_QUERY)
        apply()
      }, DEBOUNCE)
    })
    // Enter must not submit anything: there is no form and no server-side filter.
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') event.preventDefault()
      if (event.key === 'Escape' && input.value) {
        input.value = ''
        query = ''
        apply()
      }
    })
  }

  if (reset) {
    reset.addEventListener('click', () => {
      selected.clear()
      query = ''
      if (input) input.value = ''
      apply()
    })
  }

  // The free-text field only becomes real once its script is running.
  if (searchBox) searchBox.hidden = false

  readUrl()
  apply()

  // Deferred scripts run after the browser has already scrolled to #y2019. If a
  // filter from ?tag= hid that year, the scroll landed nowhere; if it did not,
  // re-scrolling is a no-op the user never sees.
  if (location.hash) {
    const target = document.querySelector(`[id="${CSS.escape(location.hash.slice(1))}"]`)
    if (target && !target.closest('[data-year-group]')?.hidden) target.scrollIntoView()
  }
})()
