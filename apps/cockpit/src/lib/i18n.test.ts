import { describe, expect, it } from 'vitest'
import { globSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { CATALOGS, translate } from './i18n'
import { createLocaleStore, LOCALE_STORAGE_KEY, resolveLocale, type LocalePreference } from './locale-store'

describe('cockpit i18n', () => {
  it('keeps the English and German catalogs structurally identical', () => {
    expect(Object.keys(CATALOGS.de).sort()).toEqual(Object.keys(CATALOGS.en).sort())
    const placeholders = (value: string) => [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort()
    for (const key of Object.keys(CATALOGS.en) as (keyof typeof CATALOGS.en)[]) {
      expect(placeholders(CATALOGS.de[key]), key).toEqual(placeholders(CATALOGS.en[key]))
      expect(translate('en', key), key).not.toBe(key)
      expect(translate('de', key), key).not.toBe(key)
    }
  })

  it('keeps visible product copy and accessible labels in the catalogs', () => {
    const offenders: string[] = []
    const technicalLiterals = new Set([
      'SHA-256',
      'POST /v1/sites —',
      'KiB / 256 KiB',
      '#0f172a',
      'Inter, system-ui, sans-serif',
      'field_name',
    ])
    const accessibleAttributes = new Set(['aria-label', 'placeholder', 'title', 'alt'])

    for (const file of globSync('src/**/*.tsx').filter((entry) => !entry.endsWith('.test.tsx'))) {
      const source = readFileSync(file, 'utf8')
      const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const visit = (node: ts.Node): void => {
        if (ts.isJsxText(node)) {
          const copy = node.text.replace(/\s+/g, ' ').trim()
          if (/[A-Za-zÄÖÜäöüß]/.test(copy) && !technicalLiterals.has(copy)) {
            const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1
            offenders.push(`${file}:${line} raw JSX: ${copy}`)
          }
        }
        if (
          ts.isJsxAttribute(node) &&
          accessibleAttributes.has(node.name.getText(parsed)) &&
          node.initializer &&
          ts.isStringLiteral(node.initializer) &&
          /[A-Za-zÄÖÜäöüß]/.test(node.initializer.text) &&
          !technicalLiterals.has(node.initializer.text)
        ) {
          const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1
          offenders.push(`${file}:${line} raw ${node.name.getText(parsed)}: ${node.initializer.text}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(parsed)
    }

    expect(offenders).toEqual([])
  })

  it('interpolates translated values without changing unknown placeholders', () => {
    expect(translate('de', 'page.overview.description', { site: 'Beispiel' })).toContain('Beispiel')
  })

  it('degrades a key the catalog does not carry instead of throwing', () => {
    // The catalogs are complete and TranslationKey is derived from EN, so this
    // can only be reached through a cast — which is precisely how the console
    // lost the whole Entscheidungen page once (LOCAL-CK-ART-UNBEKANNT). §2 lets
    // the console admit what it does not know; it does not let it leave.
    const missing = 'decisions.kind.spam_review' as keyof typeof CATALOGS.en
    expect(() => translate('de', missing)).not.toThrow()
    expect(translate('de', missing)).toBe(missing)
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
