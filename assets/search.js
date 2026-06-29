(() => {
  const input = document.querySelector('[data-search-input]')
  const output = document.querySelector('[data-search-results]')
  if (!input || !output) return
  let records = []
  fetch(input.dataset.index).then((r) => r.json()).then((data) => { records = data }).catch(() => {})
  const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  input.addEventListener('input', () => {
    const terms = input.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
    if (!terms.length) { output.innerHTML = ''; return }
    const matches = records.filter((r) => terms.every((t) => r.text.includes(t))).slice(0, 25)
    output.innerHTML = matches.length
      ? matches.map((r) => `<article class="card"><a href="${escape(r.url)}"><h3>${escape(r.title)}</h3><p>${escape(r.summary)}</p></a></article>`).join('')
      : '<p>Keine Ergebnisse.</p>'
  })
})()
