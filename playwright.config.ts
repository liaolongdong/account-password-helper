import { defineConfig } from '@playwright/test';

/**
 * Chrome 扩展 E2E 配置
 *
 * 与常规 Web 应用 E2E 的关键差异（也是本目录早前跑不起来的根因）：
 * - 扩展只能在持久化上下文里通过 `--load-extension` 加载，故上下文由 `e2e/harness.ts`
 *   自己启动，这里不再声明 `projects.use.browserName`，也不能并行；
 * - 被测页面来自 `chrome-extension://<id>/`，不是 WXT dev server 的 http 源，
 *   因此**没有 webServer**：`pnpm dev` 只提供模块，扩展页面需要的是已构建的产物，
 *   由 `globalSetup` 负责保证 `.output/chrome-mv3` 新鲜；
 * - 每个用例一个全新临时 profile，互不共享 storage，避免相互污染。
 *
 * 运行：`pnpm test:e2e`（默认无头）。调试用 `E2E_HEADLESS=0` 观察真实窗口，
 * 反复跑同一份产物时用 `E2E_SKIP_BUILD=1` 跳过构建。
 */
export default defineConfig({
  testDir: './e2e',
  // 只把 *.spec.ts 当用例；fixtures / global-setup / i18n 是支撑代码
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // 扩展 + 持久化上下文 + 全局 storage：并行会互相踩 profile 与 Service Worker
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // 录制视频需要 ffmpeg，本机（macOS 13）不在 Playwright 的分发矩阵内，默认关闭
    video: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
});
