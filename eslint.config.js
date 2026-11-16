import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Core isolation (spec 01, D-015): src/core may only import other files inside src/core.
// Bare specifiers and Node built-ins are forbidden here. Relative paths that escape
// src/core are caught by tests/boundary/core-isolation.test.ts (authoritative).
const CORE_RESTRICTED_IMPORTS = {
  patterns: [
    {
      regex: '^(?!\\.{1,2}(/|$)).+',
      message:
        'src/core must not import packages or Node built-ins. Only relative imports inside src/core are allowed.',
    },
    {
      regex: '(^|/)(adapters|pwa|sender|supabase)(/|$)',
      message: 'src/core must not import infrastructure (adapters, pwa, sender, supabase).',
    },
  ],
}

const CORE_RESTRICTED_GLOBALS = [
  'fetch',
  'process',
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'navigator',
  'require',
  'Buffer',
  'setTimeout',
  'setInterval',
  'XMLHttpRequest',
  'WebSocket',
].map((name) => ({
  name,
  message: 'src/core is pure: no I/O, timers, or environment globals. Inject them through a port or parameter.',
}))

export default tseslint.config(
  { ignores: ['node_modules/', 'dist/', 'coverage/', 'supabase/.temp/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['src/pwa/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['src/pwa/sw.ts'],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },
  {
    files: ['src/core/**/*.ts'],
    languageOptions: {
      // Do not predeclare Node/browser globals in core.
      globals: {},
    },
    rules: {
      'no-restricted-imports': ['error', CORE_RESTRICTED_IMPORTS],
      'no-restricted-globals': ['error', ...CORE_RESTRICTED_GLOBALS],
    },
  },
)
