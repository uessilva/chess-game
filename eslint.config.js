import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['src/core/**/*.ts'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        history: 'readonly',
        fetch: 'readonly',
        XMLHttpRequest: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
      },
    },
    rules: {
      'no-restricted-globals': [
        'error',
        'document',
        'window',
        'navigator',
        'location',
        'localStorage',
        'sessionStorage',
        'history',
        'fetch',
        'XMLHttpRequest',
        'alert',
        'confirm',
        'prompt',
      ],
    },
  },
);
