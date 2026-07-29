import js from '@eslint/js'
import globals from 'globals'

export default [
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Static site scripts shipped to the browser.
    files: ['assets/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
  },
  {
    // apps/ holds the Cockpit's TypeScript/TSX sources and its build output;
    // both are checked by that package's own `npm run type-check`.
    ignores: [
      'node_modules/',
      'dist/',
      '.contentkit-local/',
      'docs/',
      'bin/',
      'apps/',
      'assets/cockpit/',
      'src/db/migrations/embedded.mjs',
    ],
  },
]
