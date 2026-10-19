import { expect, test } from './harness';

/**
 * Options 首屏骨架与真实视图的交接
 *
 * 之前骨架放在 #app 内部，Vue 一挂载就被清掉，而认证检查 / 列表解密还在进行，
 * 中间会露出空白。现在骨架是 #app 的兄弟覆盖层，App 在首屏真实视图绘制完成后
 * 发出 ready 事件，main.ts 再淡出并移除。这里用页面内观察器确认：
 * 骨架确实出现过、确实被移除，且移除后真实页面可见。
 */
test('Options 首屏骨架等真实视图绘制后再淡出', async ({ extContext, extensionId }) => {
  const page = await extContext.newPage();
  await page.addInitScript(() => {
    const state = window as unknown as { skeletonSeen?: boolean; skeletonRemovedAt?: number };
    state.skeletonSeen = false;
    state.skeletonRemovedAt = 0;
    let observer: MutationObserver | null = null;
    const check = () => {
      const skeleton = document.getElementById('app-skeleton');
      if (skeleton) {
        state.skeletonSeen = true;
        return;
      }
      if (state.skeletonSeen && !state.skeletonRemovedAt) {
        state.skeletonRemovedAt = performance.now();
        observer?.disconnect();
      }
    };
    observer = new MutationObserver(check);
    // 初始化脚本可能在骨架已写入 DOM 之后才执行，先同步检查一次，再靠 observer 等移除
    observer.observe(document, { childList: true, subtree: true });
    check();
  });

  await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { skeletonSeen?: boolean }).skeletonSeen))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { skeletonRemovedAt?: number }).skeletonRemovedAt), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  await expect(page.locator('#app-skeleton')).toHaveCount(0);
  await expect(page.locator('.options-page')).toBeVisible();
});
