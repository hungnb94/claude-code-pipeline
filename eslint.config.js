const js = require('@eslint/js');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  js.configs.recommended,
  prettierConfig,
  {
    rules: {
      'no-unused-vars': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'curly': 'error',
    },
  },
];
