import eslintReact from '@eslint-react/eslint-plugin'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import prettier from 'eslint-config-prettier'
import perfectionist from 'eslint-plugin-perfectionist'

export default [
  // Ignore patterns
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-server/**',
      'build/**',
      '*.min.js',
      '*.d.ts'
    ]
  },

  // Base perfectionist rules
  perfectionist.configs['recommended-natural'],

  // TypeScript + React configuration
  {
    files: ['**/*.ts', '**/*.tsx'],
    ...eslintReact.configs['recommended-typescript'],
    languageOptions: {
      ...eslintReact.configs['recommended-typescript'].languageOptions,
      parser: tsparser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        },
        ecmaVersion: 2022,
        project: './tsconfig.json',
        sourceType: 'module',
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      ...eslintReact.configs['recommended-typescript'].plugins,
      '@typescript-eslint': tseslint
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...tseslint.configs['recommended-requiring-type-checking'].rules,
      ...eslintReact.configs['recommended-typescript'].rules,

      '@typescript-eslint/await-thenable': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-enum-comparison': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          // Deliberately unused parameters keep an underscore, so a method can
          // satisfy a shared interface without pretending to use every value.
          argsIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/no-useless-empty-export': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/prefer-promise-reject-errors': 'warn',
      '@typescript-eslint/require-await': 'warn',
      'no-console': ['error', { allow: ['debug', 'error', 'warn'] }]
    }
  },

  // The scene is one long class whose methods form a pipeline. Alphabetising it
  // interleaves unrelated stages, and — because the fixer moves a method
  // without the comment above it — it has repeatedly stranded doc comments on
  // the wrong function.
  {
    files: ['src/wall/scene.ts'],
    rules: {
      'perfectionist/sort-classes': 'off'
    }
  },

  // Override for test files
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'test/**/*.ts', 'test/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off'
    }
  },

  // Override for config files
  {
    files: ['**/*.config.ts', '**/*.config.mjs'],
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
      'no-console': 'off'
    }
  },

  // Prettier config (must be last)
  prettier
]
