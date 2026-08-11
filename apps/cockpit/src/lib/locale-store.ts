import { LOCALES, type Locale } from './i18n'

export type LocalePreference = Locale | 'auto'
export const LOCALE_STORAGE_KEY = 'ck-cockpit-locale'

export interface LocaleSnapshot { preference: LocalePreference; locale: Locale }
export interface LocaleEnvironment {
  read(key: string): string | null
  write(key: string, value: string): void
  remove(key: string): void
  languages(): readonly string[]
  apply(locale: Locale): void
  watchSystem?(onChange: () => void): () => void
  watchStorage?(onChange: () => void): () => void
}

export function resolveLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.trim().toLowerCase().split('-')[0]
    if (base === 'de' || base === 'en') return base
  }
  return 'en'
}

function storedPreference(value: string | null): LocalePreference {
  return LOCALES.includes(value as Locale) ? (value as Locale) : 'auto'
}

export function createLocaleStore(env: LocaleEnvironment) {
  let preference = storedPreference(env.read(LOCALE_STORAGE_KEY))
  let snapshot: LocaleSnapshot = {
    preference,
    locale: preference === 'auto' ? resolveLocale(env.languages()) : preference,
  }
  const listeners = new Set<() => void>()

  const apply = () => env.apply(snapshot.locale)
  const publish = (nextPreference = preference) => {
    const next: LocaleSnapshot = {
      preference: nextPreference,
      locale: nextPreference === 'auto' ? resolveLocale(env.languages()) : nextPreference,
    }
    preference = nextPreference
    if (next.preference === snapshot.preference && next.locale === snapshot.locale) return
    snapshot = next
    apply()
    listeners.forEach((listener) => listener())
  }
  apply()
  env.watchSystem?.(() => preference === 'auto' && publish())
  env.watchStorage?.(() => publish(storedPreference(env.read(LOCALE_STORAGE_KEY))))

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
    snapshot: () => snapshot,
    set(next: LocalePreference) {
      if (next === 'auto') env.remove(LOCALE_STORAGE_KEY)
      else env.write(LOCALE_STORAGE_KEY, next)
      publish(next)
    },
  }
}
