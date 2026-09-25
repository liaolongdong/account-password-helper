import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

/**
 * Vitest 配置
 *
 * 复用 WXT 官方测试集成 `WxtVitest()`，它会基于 `wxt.config.ts`：
 * - 应用 `@/` 路径别名，使测试内的模块解析与扩展运行时一致；
 * - 配置 auto-import（Vue/Element Plus）；
 * - 通过内存态 `fakeBrowser` 桩注入全局 `chrome`/`browser` 扩展 API。
 *
 * 测试环境固定为 `node`：Node 22 原生提供 Web Crypto（`crypto.subtle`），
 * 加密相关测试无需任何 polyfill。
 */
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // 口径限定：这份报告只统计 `utils/` 这一层纯领域逻辑，不代表整仓覆盖率。
      // 它不进任何 CI 门禁（ci.yml 只跑 `pnpm test:run` 与 `tests/architecture`），
      // 扩大到 entrypoints/composables 只会改变人工读数、不会拦住任何回归，故按需再议。
      include: ['utils/**/*.ts'],
      exclude: ['utils/**/*.d.ts'],
    },
  },
});
