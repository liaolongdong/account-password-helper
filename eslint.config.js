import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import vueTsEslintConfig from '@vue/eslint-config-typescript';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'dist/**',
      '.output/**',
      '.wxt/**',
      '.qoder/**',
      '.husky/**',
      'node_modules/**',
      'scripts/**',
      'public/**',
      'icons/**',
      'assets/**',
    ],
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  ...vueTsEslintConfig(),
  eslintConfigPrettier,
  {
    rules: {
      // 禁止直接使用 console，仅允许 warn/error（logger.ts 内部通过 eslint-disable 豁免）
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'warn',
      // 关闭基础 no-unused-vars，使用 TypeScript 版本
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // 项目中 Element Plus 表单验证器等场景广泛使用 any
      '@typescript-eslint/no-explicit-any': 'off',
      // Vue 组件允许单单词命名（如 BrandLogo 等）
      'vue/multi-word-component-names': 'off',
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },
];
