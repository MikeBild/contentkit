import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { formatDateTime, formatNumber, LOCALE_TAGS, translate, type Locale, type TranslationKey } from './i18n'
import { createLocaleStore, LOCALE_STORAGE_KEY, type LocalePreference } from './locale-store'

const localeStore = createLocaleStore({
  read: (key) => { try { return window.localStorage.getItem(key) } catch { return null } },
  write: (key, value) => { try { window.localStorage.setItem(key, value) } catch { /* keep in-memory choice */ } },
  remove: (key) => { try { window.localStorage.removeItem(key) } catch { /* keep in-memory choice */ } },
  languages: () => window.navigator.languages,
  apply: (locale) => { document.documentElement.lang = locale },
  watchSystem: (onChange) => {
    window.addEventListener('languagechange', onChange)
    return () => window.removeEventListener('languagechange', onChange)
  },
  watchStorage: (onChange) => {
    const handler = (event: StorageEvent) => {
      if (event.key === null || event.key === LOCALE_STORAGE_KEY) onChange()
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  },
})

export interface I18nValue {
  locale: Locale
  preference: LocalePreference
  setPreference(preference: LocalePreference): void
  t(key: TranslationKey, values?: Readonly<Record<string, string | number>>): string
  number(value: number): string
  list(values: readonly string[]): string
  dateTime(value: string | number | Date): string
  relativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string
}

const FALLBACK_I18N: I18nValue = {
  locale: 'en',
  preference: 'auto',
  setPreference: () => undefined,
  t: (key, values) => translate('en', key, values),
  number: (value) => formatNumber('en', value),
  list: (values) => new Intl.ListFormat(LOCALE_TAGS.en, { style: 'short', type: 'conjunction' }).format(values),
  dateTime: (value) => formatDateTime('en', value),
  relativeTime: (value, unit) => new Intl.RelativeTimeFormat(LOCALE_TAGS.en, { numeric: 'auto' }).format(value, unit),
}

const I18nContext = createContext<I18nValue>(FALLBACK_I18N)

export function I18nProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(localeStore.subscribe, localeStore.snapshot, localeStore.snapshot)
  const value = useMemo<I18nValue>(() => ({
    ...snapshot,
    setPreference: localeStore.set,
    t: (key, values) => translate(snapshot.locale, key, values),
    number: (value) => formatNumber(snapshot.locale, value),
    list: (values) => new Intl.ListFormat(LOCALE_TAGS[snapshot.locale], { style: 'short', type: 'conjunction' }).format(values),
    dateTime: (value) => formatDateTime(snapshot.locale, value),
    relativeTime: (value, unit) => new Intl.RelativeTimeFormat(LOCALE_TAGS[snapshot.locale], { numeric: 'auto' }).format(value, unit),
  }), [snapshot])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  return useContext(I18nContext)
}

export type { LocalePreference, TranslationKey }
