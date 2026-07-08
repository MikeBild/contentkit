// Cookie consent for the site's optional Google Analytics 4.
//
// GA4 is non-essential under § 25 Abs. 1 TDDDG / Art. 6 Abs. 1 lit. a DSGVO, so
// it must not load before an explicit opt-in. This script therefore ships in
// place of the gtag loader: it never touches Google until the visitor clicks
// "accept" — no Consent-Mode "advanced" ping, which German authorities do not
// treat as a substitute for prior consent. Everything runs from a first-party
// asset so the strict CSP stays free of 'unsafe-inline'.
//
// The measurement id arrives via the tag's `data-ga-id` attribute (keeps this
// asset generic and content-hashable across sites). Banner copy is localized
// from <html lang>. The decision is stored in localStorage and can be revoked
// any time via any element carrying [data-consent-settings] (footer link),
// making withdrawal as easy as granting (Art. 7 Abs. 3 DSGVO).
;(() => {
  const tag = document.currentScript || document.querySelector('script[data-ga-id]')
  const gaId = (tag && tag.dataset.gaId ? tag.dataset.gaId : '').replace(/[^A-Za-z0-9-]/g, '')
  if (!gaId) return

  const STORAGE_KEY = 'ck-consent'
  const lang = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase()
  const copy = {
    de: {
      body: 'Diese Website nutzt Google Analytics, um die Nutzung statistisch auszuwerten. Das geschieht nur mit deiner Einwilligung. Details in der',
      privacy: 'Datenschutzerklärung',
      privacyHref: '/de/datenschutz/',
      accept: 'Alles akzeptieren',
      reject: 'Alles ablehnen',
      label: 'Cookie-Einwilligung',
    },
    en: {
      body: 'This site uses Google Analytics to measure usage statistically. It only loads with your consent. Details in the',
      privacy: 'privacy policy',
      privacyHref: '/en/privacy/',
      accept: 'Accept all',
      reject: 'Reject all',
      label: 'Cookie consent',
    },
  }
  const t = copy[lang] || copy.en

  function readDecision() {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  }
  function storeDecision(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value)
    } catch {
      /* private mode / storage disabled — decision just isn't remembered */
    }
  }

  let loaded = false
  function loadAnalytics() {
    if (loaded) return
    loaded = true
    window.dataLayer = window.dataLayer || []
    function gtag() {
      window.dataLayer.push(arguments)
    }
    window.gtag = gtag
    gtag('js', new Date())
    // Ads signals stay denied; only analytics_storage is granted by this opt-in.
    gtag('consent', 'default', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'granted',
    })
    gtag('config', gaId)
    const loader = document.createElement('script')
    loader.async = true
    loader.src = 'https://www.googletagmanager.com/gtag/js?id=' + gaId
    document.head.appendChild(loader)
  }

  let banner = null
  function closeBanner() {
    if (banner) {
      banner.remove()
      banner = null
    }
  }
  function showBanner() {
    if (banner) return
    banner = document.createElement('div')
    banner.className = 'consent-banner'
    banner.setAttribute('role', 'dialog')
    banner.setAttribute('aria-label', t.label)
    banner.innerHTML =
      '<div class="consent-inner">' +
      '<p class="consent-text">' +
      t.body +
      ' <a href="' +
      t.privacyHref +
      '">' +
      t.privacy +
      '</a>.</p>' +
      '<div class="consent-actions">' +
      '<button type="button" class="button button-ghost" data-consent-reject>' +
      t.reject +
      '</button>' +
      '<button type="button" class="button" data-consent-accept>' +
      t.accept +
      '</button>' +
      '</div></div>'
    banner.querySelector('[data-consent-accept]').addEventListener('click', () => {
      storeDecision('granted')
      closeBanner()
      loadAnalytics()
    })
    banner.querySelector('[data-consent-reject]').addEventListener('click', () => {
      storeDecision('denied')
      closeBanner()
    })
    document.body.appendChild(banner)
  }

  // Footer "Cookie-Einstellungen" reopens the banner so consent is revocable.
  for (const trigger of document.querySelectorAll('[data-consent-settings]')) {
    trigger.addEventListener('click', (event) => {
      event.preventDefault()
      showBanner()
    })
  }

  const decision = readDecision()
  if (decision === 'granted') loadAnalytics()
  else if (decision !== 'denied') showBanner()
})()
