import js from '@eslint/js';
import babelParser from '@babel/eslint-parser';

const globals = {
  AbortSignal: 'readonly',
  Buffer: 'readonly',
  DOMParser: 'readonly',
  Element: 'readonly',
  Intl: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  URL: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  crypto: 'readonly',
  fetch: 'readonly',
  globalThis: 'readonly',
  jest: 'readonly',
  process: 'readonly',
  test: 'readonly',
  __dirname: 'readonly',
  module: 'readonly',
  require: 'readonly',
  expect: 'readonly',
};

export default [
  {
    ignores: [
      'DerivedData/**',
      'dist/**',
      'macos/Pods/**',
      'macos/build/**',
      'node_modules/**',
      'src/verifier/verifierBundle.generated.ts',
      'src/verifier/trust/snapshot/**',
      'vendor/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 'latest',
        sourceType: 'module',
        requireConfigFile: false,
        babelOptions: { presets: ['@react-native/babel-preset'] },
      },
      globals,
    },
    rules: {
      'no-console': 'error',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-control-regex': 'off',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['src/services/diagnostics.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.cjs', '**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals },
    rules: { 'no-console': 'error' },
  },
];
