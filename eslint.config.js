// @ts-check
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },

  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.ts'],
    rules: {
      'func-style': ['error', 'expression'],

      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportNamespaceSpecifier',
          message: 'Use named imports instead of namespace imports (import * as X).',
        },
      ],

      '@typescript-eslint/no-require-imports': 'error',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
)
