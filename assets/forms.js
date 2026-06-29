(() => {
  for (const form of document.querySelectorAll('[data-contentkit-form]')) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      const status = form.querySelector('[data-form-status]')
      const button = form.querySelector('button[type=submit]')
      button.disabled = true
      status.textContent = ''
      const payload = Object.fromEntries(new FormData(form))
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: {'content-type':'application/json'},
          body: JSON.stringify(payload),
        })
        if (!response.ok) throw new Error((await response.json()).error || 'request failed')
        form.reset()
        status.textContent = form.dataset.success || 'Gesendet.'
      } catch {
        status.textContent = form.dataset.error || 'Senden fehlgeschlagen.'
      } finally {
        button.disabled = false
      }
    })
  }
})()
