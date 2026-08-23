module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  ignorePatterns: ['dist', 'node_modules', '*.cjs', 'coverage'],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
  },
  overrides: [
    {
      // Domain layer (core + engines) must stay free of UI/framework imports.
      files: ['src/core/**/*.ts', 'src/engines/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              { name: 'react', message: 'core/engines must not depend on React.' },
              { name: 'react-dom', message: 'core/engines must not depend on React.' },
              { name: 'three', message: 'core/engines must not depend on three.' },
              { name: 'zustand', message: 'core/engines must not depend on the store.' },
            ],
            patterns: [
              { group: ['@/components/*', '@/features/*', '@/app/*'], message: 'core/engines must not import UI/state layers.' },
              { group: ['@react-three/*'], message: 'core/engines must not depend on three.' },
            ],
          },
        ],
      },
    },
  ],
};
