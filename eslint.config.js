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
      // 性能测量脚本的私有产物：构建快照与测量结果（体积大、非源码，扫到会淹没真实告警）
      'benchmarks/.artifacts/**',
      'benchmarks/results/**',
      // 测量脚本本体是 Node 工具 + 经 `page.evaluate` 注入页面上下文的回调，
      // 浏览器全局只在运行时存在；与 scripts/** 同属开发期工具，沿用同一豁免口径（`.ts` 夹具仍受检）
      'benchmarks/**/*.mjs',
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
