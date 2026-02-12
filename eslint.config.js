import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // Ignore build output and dependencies
  { ignores: ['dist/**', 'node_modules/**', '.claude/**', 'api/**'] },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended (type-aware where possible)
  ...tseslint.configs.recommended,

  // React hooks rules - catches stale closures & missing deps
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Project-specific overrides: focus on bug prevention, not style
  {
    rules: {
      // --- Bug prevention (errors) ---
      'no-unreachable': 'error',
      'no-constant-condition': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'warn',

      // --- TypeScript-specific bug prevention ---
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'off',  // Phase 1: don't enforce yet (tsconfig will handle this incrementally)

      // --- Intentionally relaxed (avoid noise) ---
      'no-unused-vars': 'off',  // handled by @typescript-eslint/no-unused-vars
      '@typescript-eslint/no-require-imports': 'off',  // vite.config uses require
      '@typescript-eslint/ban-ts-comment': 'off',  // allow @ts-ignore for pragmatic fixes
    },
  }
);
