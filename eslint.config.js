import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['_site/', 'node_modules/', 'styles.css', 'app/vendor/'] },
  js.configs.recommended,
  {
    // The app and landing page run in the browser as ES modules.
    files: ['app/**/*.js', 'config.js', 'landing.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['app/sw.js'],
    languageOptions: { sourceType: 'script', globals: globals.serviceworker },
  },
  {
    files: ['theme-init.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
  {
    files: ['scripts/**', 'test/**', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Functions passed to page.evaluate run in the browser.
    files: ['scripts/record-video.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: {
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
    },
  },
];
