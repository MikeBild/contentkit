;(() => {
  const all = (root, selector) => [...root.querySelectorAll(selector)]
  document.documentElement.classList.add('ck-composition-enhanced')

  for (const [exampleIndex, example] of all(document, '.composition-code-example').entries()) {
    const panels = all(example, ':scope > .composition-code-variant')
    if (panels.length < 2) continue
    const tabs = document.createElement('div')
    tabs.className = 'composition-code-tabs'
    tabs.setAttribute('role', 'tablist')
    tabs.setAttribute('aria-label', example.querySelector(':scope > h2')?.textContent || 'Code variants')
    const activate = (index, focus = false) => {
      panels.forEach((panel, panelIndex) => {
        const selected = panelIndex === index
        panel.hidden = !selected
        panel.setAttribute('role', 'tabpanel')
        panel.setAttribute('tabindex', '0')
        tabs.children[panelIndex].setAttribute('aria-selected', String(selected))
        tabs.children[panelIndex].setAttribute('tabindex', selected ? '0' : '-1')
      })
      if (focus) tabs.children[index].focus()
    }
    panels.forEach((panel, index) => {
      const heading = panel.querySelector(':scope > h3')
      const id = panel.id || `composition-code-panel-${exampleIndex + 1}-${index + 1}`
      panel.id = id
      const tab = document.createElement('button')
      tab.type = 'button'
      tab.className = 'composition-code-tab'
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-controls', id)
      tab.textContent = heading?.textContent || `Variant ${index + 1}`
      tab.addEventListener('click', () => activate(index))
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? panels.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + panels.length) % panels.length
        activate(next, true)
      })
      tabs.append(tab)
      const pre = panel.querySelector('pre')
      if (pre) {
        const copy = document.createElement('button')
        copy.type = 'button'
        copy.className = 'composition-code-copy'
        copy.textContent = 'Copy'
        copy.setAttribute('aria-label', `Copy ${tab.textContent}`)
        copy.addEventListener('click', async () => {
          await navigator.clipboard.writeText(pre.textContent || '')
          copy.textContent = 'Copied'
          window.setTimeout(() => {
            copy.textContent = 'Copy'
          }, 1600)
        })
        panel.insertBefore(copy, pre)
      }
    })
    const heading = example.querySelector(':scope > h2')
    heading?.after(tabs)
    activate(0)
  }

  for (const section of all(document, '.composition-data-table')) {
    const table = section.querySelector(':scope > table')
    const body = table?.tBodies?.[0]
    if (!table || !body) continue
    const rows = [...body.rows]
    const controls = document.createElement('div')
    controls.className = 'composition-table-controls'
    const filter = document.createElement('input')
    filter.type = 'search'
    filter.placeholder = 'Filter records'
    filter.setAttribute('aria-label', 'Filter table records')
    filter.addEventListener('input', () => {
      const query = filter.value.toLocaleLowerCase()
      rows.forEach((row) => {
        row.hidden = !row.textContent.toLocaleLowerCase().includes(query)
      })
    })
    controls.append(filter)
    table.before(controls)
    all(table, 'thead th').forEach((header, column) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'composition-table-sort'
      button.textContent = header.textContent
      button.setAttribute('aria-label', `Sort by ${header.textContent}`)
      let direction = 1
      button.addEventListener('click', () => {
        rows
          .sort((left, right) =>
            left.cells[column].textContent.localeCompare(right.cells[column].textContent, undefined, {
              numeric: true,
              sensitivity: 'base',
            }),
          )
          .forEach((row) => body.append(row))
        if (direction < 0) rows.reverse().forEach((row) => body.append(row))
        direction *= -1
      })
      header.textContent = ''
      header.append(button)
    })
  }

  for (const shell of all(document, '.composition-application-shell')) {
    const navigation = shell.querySelector(':scope > .composition-shell-navigation')
    if (!navigation) continue
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'composition-shell-toggle'
    toggle.textContent = 'Navigation'
    toggle.setAttribute('aria-expanded', 'false')
    toggle.addEventListener('click', () => {
      const open = shell.classList.toggle('composition-shell-open')
      toggle.setAttribute('aria-expanded', String(open))
    })
    shell.querySelector(':scope > h2')?.after(toggle)
  }
})()
