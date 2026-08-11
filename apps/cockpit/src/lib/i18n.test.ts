import { describe, expect, it } from 'vitest'
import { CATALOGS, translate } from './i18n'
import { createLocaleStore, LOCALE_STORAGE_KEY, resolveLocale, type LocalePreference } from './locale-store'

describe('cockpit i18n', () => {
  it('keeps the English and German catalogs structurally identical', () => {
    expect(Object.keys(CATALOGS.de).sort()).toEqual(Object.keys(CATALOGS.en).sort())
    const placeholders = (value: string) => [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort()
    for (const key of Object.keys(CATALOGS.en) as (keyof typeof CATALOGS.en)[]) {
      expect(placeholders(CATALOGS.de[key]), key).toEqual(placeholders(CATALOGS.en[key]))
    }
  })

  it('interpolates translated values without changing unknown placeholders', () => {
    expect(translate('de', 'page.overview.description', { site: 'Beispiel' })).toContain('Beispiel')
  })

  it('resolves supported browser languages and falls back to English', () => {
    expect(resolveLocale(['fr-FR', 'de-DE'])).toBe('de')
    expect(resolveLocale(['fr-FR'])).toBe('en')
  })

  it('supports auto detection, manual choice and external storage changes', () => {
    let stored: string | null = null
    let languages = ['de-DE']
    let applied = ''
    let systemChange: () => void = () => undefined
    let storageChange: () => void = () => undefined
    const store = createLocaleStore({
      read: () => stored,
      write: (_key, value) => { stored = value },
      remove: () => { stored = null },
      languages: () => languages,
      apply: (locale) => { applied = locale },
      watchSystem: (listener) => { systemChange = listener; return () => undefined },
      watchStorage: (listener) => { storageChange = listener; return () => undefined },
    })

    expect(store.snapshot()).toEqual({ preference: 'auto', locale: 'de' })
    store.set('en')
    expect(stored).toBe('en')
    expect(store.snapshot()).toEqual({ preference: 'en', locale: 'en' })
    languages = ['de-DE']
    systemChange()
    expect(applied).toBe('en')
    stored = 'de'
    storageChange()
    expect(store.snapshot()).toEqual({ preference: 'de', locale: 'de' })
    store.set('auto' as LocalePreference)
    expect(stored).toBeNull()
    expect(applied).toBe('de')
    expect(LOCALE_STORAGE_KEY).toBe('ck-cockpit-locale')
  })
})
