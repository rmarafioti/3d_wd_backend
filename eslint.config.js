// ESLint flat config: the recommended rules for CommonJS Node code. Formatting is left to
// Prettier (.prettierrc); the recommended set has no formatting rules, so the two never clash.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', 'prisma/migrations/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: {
      // `const { id, ...data } = item` is how a field is dropped before a write (reconcileItems).
      // Express identifies the error handler by its four arguments, so its unused `next` stays.
      'no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^next$' }],
    },
  },
];
