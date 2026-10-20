import type { Page } from '@playwright/test';
import { expect, test } from './harness';
import { MessageType } from '../utils/types';

/**
 * Options 首屏骨架与真实视图的交接
 *
 * 骨架是 `#app-skeleton` 的静态 DOM。head 里的同步脚本先按 URL / sessionStorage 预判形态，
 * App 在认证分支落定后校正；观察器记录 `html[data-options-first-view]` 的取值序列，
 * 守住四件事：
 * - 首次安装从 boot / setup 进入，不能闪已解锁表格；
 * - 全新标签页没有提示时先用中性 boot，不猜认证状态；
 * - 同一标签页刷新时首帧直接落到上次视图（不再先闪验证骨架）；
 * - 有效期入口带 `first-view=vault` 的新标签页首帧直接落到表格骨架。
 */

/** 页面内探针：记录骨架出现、视图序列与移除时刻（必须自包含，Playwright 会序列化源码） */
const probeSkeleton = (): void => {
  const state = window as unknown as {
    skeletonSeen?: boolean;
    skeletonRemovedAt?: number;
    skeletonViews?: string[];
    skeletonVariants?: string[];
  };
  state.skeletonSeen = false;
  state.skeletonRemovedAt = 0;
  state.skeletonViews = [];
  state.skeletonVariants = [];
  let observer: MutationObserver | null = null;

  const recordView = (): void => {
    // document_start 时 html 元素可能还不存在；观察 document 本体才能同时覆盖「属性后设」与「骨架插入」
    const view = document.documentElement?.getAttribute('data-options-first-view');
    if (view && !state.skeletonViews!.includes(view)) state.skeletonViews!.push(view);
  };

  /** 记录当前真正可见的骨架形态：只改属性、CSS 没生效时这里会空，断言随之判红 */
  const recordVariant = (): void => {
    for (const className of ['sk-boot', 'sk-auth', 'sk-vault']) {
      const el = document.querySelector(`.${className}`);
      if (el && getComputedStyle(el).display !== 'none') {
        if (!state.skeletonVariants!.includes(className)) state.skeletonVariants!.push(className);
        return;
      }
    }
  };

  const check = (): void => {
    const skeleton = document.getElementById('app-skeleton');
    if (skeleton) {
      state.skeletonSeen = true;
      recordView();
      recordVariant();
      return;
    }
    if (state.skeletonSeen && !state.skeletonRemovedAt) {
      state.skeletonRemovedAt = performance.now();
      observer?.disconnect();
    }
  };

  observer = new MutationObserver(check);
  // 初始化脚本在 document_start 执行：此时 documentElement 还不一定存在，必须观察 document
  observer.observe(document, {
    attributes: true,
    attributeFilter: ['data-options-first-view'],
    childList: true,
    subtree: true,
  });
  recordView();
  check();
};

const skeletonState = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { skeletonSeen?: boolean; skeletonRemovedAt?: number; skeletonViews?: string[] })
        .skeletonViews ?? [],
  );

const skeletonVariants = (page: Page) =>
  page.evaluate(() => (window as unknown as { skeletonVariants?: string[] }).skeletonVariants ?? []);

const waitForSkeletonRemoval = async (page: Page): Promise<void> => {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { skeletonRemovedAt?: number }).skeletonRemovedAt), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
};

test('首次安装：骨架从 boot 切到 setup，不闪已解锁表格', async ({ extContext, extensionId }) => {
  const page = await extContext.newPage();
  await page.addInitScript(probeSkeleton);
  await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });

  await waitForSkeletonRemoval(page);

  const views = await skeletonState(page);
  const variants = await skeletonVariants(page);
  expect(views[0], '首帧不是中性 boot：没有同步提示时不应猜认证状态').toBe('boot');
  expect(views, '首次安装的骨架没有落到 setup 形态').toContain('setup');
  expect(views, '首次安装先闪了已解锁的表格骨架').not.toContain('vault');
  expect(variants[0], '首帧实际显示的不是 boot 骨架').toBe('sk-boot');
  expect(variants, 'setup 形态没有真正显示出来').toContain('sk-auth');
  expect(variants, '首次安装实际显示了表格骨架').not.toContain('sk-vault');

  await expect(page.locator('#app-skeleton')).toHaveCount(0);
  await expect(page.locator('.setup-page')).toBeVisible();
});

test('已解锁会话的新标签页：boot 后切到表格形态', async ({ extContext, extensionId, optionsPage: _optionsPage }) => {
  // 同一 context 里的会话已由 optionsPage 夹具解锁；新标签页没有 sessionStorage 提示
  const page = await extContext.newPage();
  await page.addInitScript(probeSkeleton);
  await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });

  await waitForSkeletonRemoval(page);

  const views = await skeletonState(page);
  const variants = await skeletonVariants(page);
  expect(views[0], '无提示的新标签页首帧不是中性 boot').toBe('boot');
  expect(views, '已解锁会话没有切到表格骨架').toContain('vault');
  expect(views, '已解锁会话的骨架闪了认证形态').not.toContain('verify');
  expect(variants[0], '新标签页首帧实际显示的不是 boot 骨架').toBe('sk-boot');
  expect(variants, '已解锁会话实际没有显示表格骨架').toContain('sk-vault');
  expect(variants, '已解锁会话实际显示了认证骨架').not.toContain('sk-auth');

  await expect(page.locator('#app-skeleton')).toHaveCount(0);
  await expect(page.locator('.header-title h1')).toBeVisible();
});

test('同一标签页刷新：首帧直接落到上次的表格形态', async ({ optionsPage }) => {
  // 夹具页面已解析过一次 vault，markOptionsFirstView / 认证 watcher 已把提示写进 sessionStorage
  await optionsPage.addInitScript(probeSkeleton);
  await optionsPage.reload({ waitUntil: 'domcontentloaded' });
  await waitForSkeletonRemoval(optionsPage);

  const views = await skeletonState(optionsPage);
  const variants = await skeletonVariants(optionsPage);
  expect(views[0], '刷新首帧先闪了验证 / 中性骨架，而不是上次的表格形态').toBe('vault');
  expect(views, '刷新过程中闪回了验证骨架').not.toContain('verify');
  expect(variants[0], '刷新首帧实际显示的不是表格骨架').toBe('sk-vault');
  expect(variants, '刷新过程中实际显示了认证骨架').not.toContain('sk-auth');

  await expect(optionsPage.locator('#app-skeleton')).toHaveCount(0);
  await expect(optionsPage.locator('.header-title h1')).toBeVisible();
});

test('管理入口（侧边栏 / 悬浮按钮 / popup 共用指令）：会话有效时带 first-view=vault', async ({
  extContext,
  extensionId,
  optionsPage,
}) => {
  // 关掉夹具的管理页，确保这次 OPEN_OPTIONS_PAGE 会新建标签页
  await optionsPage.close();
  const sender = await extContext.newPage();
  await sender.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });

  const [opened] = await Promise.all([
    extContext.waitForEvent('page'),
    sender.evaluate(type => chrome.runtime.sendMessage({ type }), MessageType.OPEN_OPTIONS_PAGE),
  ]);

  await expect(opened, '管理入口没有把会话状态带进首帧预判').toHaveURL(/options\.html\?first-view=vault/, {
    timeout: 15_000,
  });
  await expect(opened.locator('.header-title h1')).toBeVisible({ timeout: 15_000 });
  await sender.close();
});

test('有效期入口：带 first-view=vault 的新标签页首帧直接落到表格形态', async ({
  extContext,
  extensionId,
  optionsPage: _optionsPage,
}) => {
  const page = await extContext.newPage();
  await page.addInitScript(probeSkeleton);
  await page.goto(`chrome-extension://${extensionId}/options.html?first-view=vault`, {
    waitUntil: 'domcontentloaded',
  });

  await waitForSkeletonRemoval(page);

  const views = await skeletonState(page);
  const variants = await skeletonVariants(page);
  expect(views[0], '有效期入口的首帧没有直接用 URL 提示').toBe('vault');
  expect(views, '有效期入口先闪了验证 / 中性骨架').not.toContain('verify');
  expect(variants[0], '有效期入口首帧实际显示的不是表格骨架').toBe('sk-vault');

  await expect(page.locator('#app-skeleton')).toHaveCount(0);
  await expect(page.locator('.header-title h1')).toBeVisible();

  // URL 参数会一直留在地址栏；页面内锁定后 sessionStorage 必须优先，刷新不能又闪回表格
  expect(page.url()).toContain('first-view=vault');
  await page.evaluate(
    async keys => chrome.storage.local.remove(keys),
    ['session_wrapped_data_key', 'session_wrap_key', 'session_password_expiry'],
  );
  await expect(page.locator('.verify-page')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('aph-options-first-view'))).toBe('verify');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForSkeletonRemoval(page);
  expect((await skeletonState(page))[0], '地址栏的 first-view=vault 盖过了锁定后的 sessionStorage').toBe('verify');
  expect((await skeletonVariants(page))[0], '锁定后刷新首帧实际显示的不是认证骨架').toBe('sk-auth');
  await expect(page.locator('.verify-page')).toBeVisible();
});
