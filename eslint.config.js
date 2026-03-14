import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'

export default tseslint.config(
  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended + strict rules for all TS/TSX source files
  ...tseslint.configs.recommended,
  ...tseslint.configs.strict,

  // Main config for src and packages
  {
    files: ['src/**/*.{ts,tsx}', 'packages/**/*.ts'],
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['src/renderer/*.{ts,tsx}', 'src/renderer/__tests__/*.{ts,tsx}'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Import ordering
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'type',
          ],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
      'import/no-duplicates': 'error',
      'import/no-unresolved': 'off', // Handled by TypeScript

      // TypeScript strict overrides
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      // Disallow console in renderer and preload by default
      'no-console': 'error',

      // Security: disallow dangerous patterns
      'no-eval': 'warn',
      'no-new-func': 'warn',
    },
  },

  // Allow console.* in main process (Node.js backend)
  {
    files: ['src/main/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // Ignore generated/build output
  {
    ignores: ['dist/**', 'out/**', 'node_modules/**', '**/*.d.ts'],
  },
)
