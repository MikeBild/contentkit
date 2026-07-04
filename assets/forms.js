;(() => {
  for (const form of document.querySelectorAll('[data-contentkit-form]')) {
    const status = form.querySelector('[data-form-status]')
    // Optional success panel rendered as a sibling of the form (contact page).
    // When present, a successful submit hides the form and reveals it; otherwise
    // the inline status alert is used (e.g. the comment "pending moderation" case).
    const successPanel = form.parentElement && form.parentElement.querySelector('[data-form-success]')
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      const button = form.querySelector('button[type=submit]')
      button.disabled = true
      if (status) {
        status.hidden = true
        status.textContent = ''
        status.className = 'form-alert'
      }
      const payload = Object.fromEntries(new FormData(form))
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!response.ok) throw new Error((await response.json()).error || 'request failed')
        form.reset()
        if (successPanel) {
          form.hidden = true
          successPanel.hidden = false
          successPanel.setAttribute('tabindex', '-1')
          successPanel.focus({ preventScroll: true })
          successPanel.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } else if (status) {
          status.hidden = false
          status.textContent = form.dataset.success || 'Gesendet.'
          status.className = 'form-alert form-alert-ok'
        }
      } catch {
        if (status) {
          status.hidden = false
          status.textContent = form.dataset.error || 'Senden fehlgeschlagen.'
          status.className = 'form-alert form-alert-error'
        }
      } finally {
        button.disabled = false
      }
    })
  }
})()
