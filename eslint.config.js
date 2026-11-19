import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['build/', 'dist/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,js}'],
    languageOptions: {
      globals: {
        ...globals.es2021,
        global: 'readonly',
        log: 'readonly',
        logError: 'readonly',
        print: 'readonly',
        printerr: 'readonly',
      },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['*.js', '*.ts', 'tests/**/*.{ts,js}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
