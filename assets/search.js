// Site search: one combobox in the site header on every page, plus an inline
// results list on /{locale}/search/.
//
// The index is fetched lazily — on the first pointerdown/focus or keystroke —
// and at most once. This script ships on every page, so a plain page view must
// not cost an extra request.
//
// CSP-safe: no inline script, no inline handlers (script-src 'self'). Result rows
// are built with createElement + textContent, so there is no HTML concatenation
// and no hand-rolled escaping to get wrong.
//
// Graceful degradation, stated honestly: /{locale}/search/ is a static page and
// there is no server-side search. The header <form method="get"> exists so that
// Enter before the index has loaded, and shared ?q= deep links, still land
// somewhere useful — where this script then runs the query. It is not a no-JS search.
;(() => {
  const form = document.querySelector('[data-site-search]')
  if (!form) return
  const input = form.querySelector('[data-search-input]')
  const panel = form.querySelector('[data-search-panel]')
  const listbox = form.querySelector('[data-search-listbox]')
  const empty = form.querySelector('[data-search-empty]')
  const status = form.querySelector('[data-search-status]')
  if (!input || !panel || !listbox || !empty || !status) return

  // Present only on /{locale}/search/. When it exists, results render inline and
  // the header input is a plain search box rather than a combobox with a popup.
  const page = document.querySelector('[data-search-results]')

  const lang = document.documentElement.lang || 'en'
  const copy = {
    empty: input.dataset.emptyText || 'No results.',
    one: input.dataset.countOne || '1 result',
    many: input.dataset.countMany || '{n} results',
  }
  const LIMIT = 25
  const DEBOUNCE = 120
  const MAX_ATTEMPTS = 3

  let records = null
  let pending = null
  let attempts = 0
  let options = []
  let active = -1
  let timer = 0

  // search-index.json stores `text` pre-lowercased with the build locale's
  // toLocaleLowerCase, so the query has to fold the same way (Turkish dotless i).
  const lower = (value) => String(value).toLocaleLowerCase(lang)
  const internal = (url) => typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')

  function loadIndex() {
    if (records) return Promise.resolve(records)
    if (pending) return pending
    if (attempts >= MAX_ATTEMPTS) return Promise.resolve(null)
    attempts += 1
    pending = Promise.all([
      fetch(input.dataset.index, { credentials: 'same-origin' }).then((response) =>
        response.ok ? response.json() : Promise.reject(new Error('http')),
      ),
      fetch(`/_contentkit/search-index.json?locale=${encodeURIComponent(lang)}`, { credentials: 'same-origin' })
        .then((response) => (response.ok ? response.json() : []))
        .catch(() => []),
    ])
      .then(([publicData, protectedData]) => {
        // A poisoned index must not be able to produce javascript: hrefs.
        const merged = [
          ...(Array.isArray(publicData) ? publicData : []),
          ...(Array.isArray(protectedData) ? protectedData : []),
        ]
        records = [
          ...new Map(merged.filter((record) => internal(record.url)).map((record) => [record.url, record])).values(),
        ]
        pending = null
        return records
      })
      .catch(() => {
        // Leave `records` null: Enter then falls through to a real navigation.
        pending = null
        return null
      })
    return pending
  }

  // Every term must appear somewhere in the record's text (the AND semantics the
  // substring search always had); ranking then prefers where it appears: a title
  // hit outranks a summary hit outranks a body hit, and a title that *starts*
  // with the term outranks one that merely contains it. Ties keep index order,
  // which is build order — newest first. The corpus is a personal site, so
  // scoring every record and sorting is cheaper than any cleverness.
  function match(query) {
    const terms = lower(query).trim().split(/\s+/).filter(Boolean)
    if (!terms.length || !records) return []
    const scored = []
    for (const record of records) {
      if (!terms.every((term) => record.text.includes(term))) continue
      const title = lower(record.title || '')
      const summary = lower(record.summary || '')
      let score = 0
      for (const term of terms) {
        if (title.includes(term)) score += title.startsWith(term) ? 5 : 3
        else if (summary.includes(term)) score += 2
        else score += 1
      }
      scored.push({ record, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, LIMIT).map((entry) => entry.record)
  }

  function announce(count) {
    status.textContent = count === 0 ? copy.empty : count === 1 ? copy.one : copy.many.replace('{n}', String(count))
  }

  function reset() {
    listbox.textContent = ''
    options = []
    active = -1
    input.removeAttribute('aria-activedescendant')
  }

  function close() {
    reset()
    panel.hidden = true
    listbox.hidden = true
    empty.hidden = true
    if (!page) input.setAttribute('aria-expanded', 'false')
  }

  function setActive(next) {
    if (!options.length) return
    if (active >= 0) options[active].setAttribute('aria-selected', 'false')
    active = (next + options.length) % options.length
    const option = options[active]
    option.setAttribute('aria-selected', 'true')
    input.setAttribute('aria-activedescendant', option.id)
    option.scrollIntoView({ block: 'nearest' })
  }

  // A real <a role="option"> keeps middle-click, cmd-click and the status-bar URL
  // preview. `option` is children-presentational, so the spans collapse into the
  // option's accessible name rather than surfacing separately.
  function buildOption(record, index) {
    const link = document.createElement('a')
    link.className = 'search-option'
    link.id = `ck-search-option-${index}`
    link.href = record.url
    link.tabIndex = -1
    link.setAttribute('role', 'option')
    link.setAttribute('aria-selected', 'false')
    const title = document.createElement('span')
    title.className = 'search-option-title'
    title.textContent = record.title
    link.append(title)
    if (record.summary) {
      const summary = document.createElement('span')
      summary.className = 'search-option-summary'
      summary.textContent = record.summary
      link.append(summary)
    }
    return link
  }

  function openDropdown(matches) {
    reset()
    matches.forEach((record, index) => {
      const option = buildOption(record, index)
      options.push(option)
      listbox.append(option)
    })
    // role="listbox" may only contain options, so zero results show the sibling
    // paragraph instead and aria-expanded stays false — no popup is displayed.
    listbox.hidden = matches.length === 0
    empty.hidden = matches.length !== 0
    panel.hidden = false
    input.setAttribute('aria-expanded', matches.length ? 'true' : 'false')
  }

  function buildCard(record) {
    const article = document.createElement('article')
    article.className = 'card'
    const link = document.createElement('a')
    link.href = record.url
    const title = document.createElement('h3')
    title.textContent = record.title
    const summary = document.createElement('p')
    summary.textContent = record.summary || ''
    link.append(title, summary)
    article.append(link)
    return article
  }

  function renderPage(matches) {
    page.textContent = ''
    if (!input.value.trim()) return
    if (!matches.length) {
      const message = document.createElement('p')
      message.textContent = copy.empty
      page.append(message)
      return
    }
    for (const record of matches) page.append(buildCard(record))
  }

  async function run(query) {
    if (!query.trim()) {
      status.textContent = ''
      if (page) renderPage([])
      else close()
      return
    }
    const loaded = await loadIndex()
    if (!loaded) return // index unavailable: Enter still navigates to the search page
    if (input.value !== query) return // a newer keystroke already superseded this run
    const matches = match(query)
    announce(matches.length)
    if (page) renderPage(matches)
    else openDropdown(matches)
  }

  if (page) {
    // No popup here — results are already on the page. Demote the combobox so the
    // input does not advertise a listbox it will never show.
    for (const attribute of ['role', 'aria-expanded', 'aria-controls', 'aria-autocomplete', 'aria-haspopup'])
      input.removeAttribute(attribute)
    panel.hidden = true
  }

  input.addEventListener('input', () => {
    clearTimeout(timer)
    const query = input.value
    if (!query.trim()) {
      run(query)
      return
    }
    timer = setTimeout(() => run(query), DEBOUNCE)
  })

  input.addEventListener('pointerdown', loadIndex)
  input.addEventListener('focus', () => {
    loadIndex()
    if (!page && input.value.trim() && panel.hidden) run(input.value)
  })

  input.addEventListener('keydown', (event) => {
    if (page) return
    const isOpen = !panel.hidden && options.length > 0
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (isOpen) setActive(active + 1)
        else run(input.value)
        break
      case 'ArrowUp':
        event.preventDefault()
        if (isOpen) setActive(active - 1)
        break
      // The APG reserves Home/End for caret movement in an editable combobox, so
      // they only jump to the first/last option while the popup is open.
      case 'Home':
        if (!isOpen) break
        event.preventDefault()
        setActive(0)
        break
      case 'End':
        if (!isOpen) break
        event.preventDefault()
        setActive(options.length - 1)
        break
      case 'Escape':
        if (!panel.hidden) {
          event.preventDefault()
          close()
        } else if (input.value) {
          // appearance:none drops WebKit's native clear button; Escape replaces it.
          input.value = ''
          status.textContent = ''
        }
        break
      case 'Enter':
        if (isOpen && active >= 0) {
          event.preventDefault()
          options[active].click()
        }
        break
      default:
        break
    }
  })

  form.addEventListener('submit', (event) => {
    if (!page && !panel.hidden && active >= 0) {
      event.preventDefault()
      options[active].click()
      return
    }
    if (!records) return // index not loaded yet, or it failed: let the GET navigate
    event.preventDefault()
    run(input.value)
  })

  // pointerdown, not click, so the popup is gone before an outside activation
  // lands. Options live inside the form, so activating one is exempt.
  document.addEventListener('pointerdown', (event) => {
    if (!page && !form.contains(event.target)) close()
  })
  form.addEventListener('focusout', (event) => {
    if (!page && !form.contains(event.relatedTarget)) close()
  })

  if (page) {
    const query = new URLSearchParams(location.search).get('q') || ''
    if (query) {
      input.value = query.slice(0, 100)
      run(input.value)
    }
    if (!location.hash) input.focus({ preventScroll: true })
  }
})()
