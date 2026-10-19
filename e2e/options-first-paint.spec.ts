import type { Page } from '@playwright/test';
import { expect, test } from './harness';

/**
 * Options 首屏骨架与真实视图的交接
 *
 * 骨架是 `#app-skeleton` 的静态 DOM，App 在首屏真实视图绘制完成后发出 ready 事件，
 * main.ts 再淡出并移除。认证分支落定得比 ready 早：`useAuthFlow` 在列表解密前上报
 * setup / verify / vault，骨架据此切换形态。这里用页面内观察器同时记录「骨架出现过」
 * 「形态切换过哪些值」与「何时被移除」，守住两件事：
 * - 首次安装 / 锁定态不能先闪一屏「已解锁 + 有数据」的表格骨架；
 * - 已解锁会话要在列表加载期间切到表格形态。
 */

/** 页面内探针：记录骨架出现、形态变化与移除时刻（必须自包含，Playwright 会序列化源码） */
const probeSkeleton = (): void => {
  const state = window as unknown as {
    skeletonSeen?: boolean;
    skeletonRemovedAt?: number;
    skeletonViews?: string[];
  };
  state.skeletonSeen = false;
  state.skeletonRemovedAt = 0;
  state.skeletonViews = [];
  let observer: MutationObserver | null = null;

  const recordView = (): void => {
    const view = document.getElementById('app-skeleton')?.getAttribute('data-view');
    if (view && !state.skeletonViews!.includes(view)) state.skeletonViews!.push(view);
  };

  const check = (): void => {
    const skeleton = document.getElementById('app-skeleton');
    if (skeleton) {
      state.skeletonSeen = true;
      recordView();
      return;
    }
    if (state.skeletonSeen && !state.skeletonRemovedAt) {
      state.skeletonRemovedAt = performance.now();
      observer?.disconnect();
    }
  };

  observer = new MutationObserver(check);
  // 初始化脚本可能在骨架已写入 DOM 之后才执行，先同步检查一次，再靠 observer 等形态变化与移除
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-view'] });
  check();
};

const skeletonState = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { skeletonSeen?: boolean; skeletonRemovedAt?: number; skeletonViews?: string[] })
        .skeletonViews ?? [],
  );

test('首次安装：骨架从认证形态淡出，不闪表格', async ({ extContext, extensionId }) => {
  const page = await extContext.newPage();
  await page.addInitScript(probeSkeleton);
  await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { skeletonSeen?: boolean }).skeletonSeen))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { skeletonRemovedAt?: number }).skeletonRemovedAt), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  const views = await skeletonState(page);
  expect(views, '首次安装的骨架没有落到 setup 形态').toContain('setup');
  expect(views, '首次安装先闪了已解锁的表格骨架').not.toContain('vault');

  await expect(page.locator('#app-skeleton')).toHaveCount(0);
  await expect(page.locator('.setup-page')).toBeVisible();
});

test('已解锁会话：骨架在列表加载期间切到表格形态', async ({ extContext, extensionId, optionsPage: _optionsPage }) => {
  // 同一 context 里的会话已由 optionsPage 夹具解锁；新开一页走完整的 checkAuth
  const page = await extContext.newPage();
  await page.addInitScript(probeSkeleton);
  await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { skeletonRemovedAt?: number }).skeletonRemovedAt), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  const views = await skeletonState(page);
  expect(views, '已解锁会话没有切到表格骨架').toContain('vault');

  await expect(page.locator('#app-skeleton')).toHaveCount(0);
  await expect(page.locator('.header-title h1')).toBeVisible();
});
