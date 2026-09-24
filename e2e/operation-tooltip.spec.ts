import type { Page } from '@playwright/test';
import { createEntry, expect, rowOf, test } from './harness';
import { textOf } from './i18n';

/**
 * 管理页操作列提示的交互等价性（真机）
 *
 * 性能背景：操作列原本每行创建 5 个 `el-tooltip` 实例，600 行 = 3000 个组件实例，
 * 实测占掉整表挂载耗时的四成（`docs/PERF_LARGE_VAULT_EVALUATION.md` 9.9）。
 * 现在全表共享一个 `virtual-triggering` 实例：显示延迟（400 毫秒）搬到
 * `useSharedHoverTooltip`，隐藏（200 毫秒）、`enterable` 与 `aria-describedby` 留给
 * Element Plus——**一条交互被拆到两处实现，正是最容易把它改坏的形状**，
 * 所以这里按「用户能感知到的每一条时序」逐条钉住，而不是只断言"提示出现过"。
 *
 * 单测覆盖不了这些：`aria-describedby` 的挂与摘、浮层实际锚定位置、移入浮层保持显示、
 * 重渲染时的兜底关闭，全都发生在真实 DOM 与真实定时器里。
 */

/** 合成条目：只用于产生行，密码不对应任何真实凭据 */
const ENTRY_A = { username: 'e2e-tip-a', password: 'Synthetic!TipA', url: 'https://tip-a.e2e.test/' };
const ENTRY_B = { username: 'e2e-tip-b', password: 'Synthetic!TipB', url: 'https://tip-b.e2e.test/' };

/** 操作列按钮顺序（与模板一致），每项是「按钮文案 / 提示文案 / 无障碍名」共用的 i18n key */
const OPERATION_KEYS = [
  'options.detail.viewDetail',
  'options.table.copyEntry',
  'common.edit',
  'common.favorite',
  'common.delete',
] as const;

/**
 * 当前可见的 tooltip 浮层文案列表
 *
 * 判据用 `offsetParent`：`persistent` 默认 false，浮层关闭后节点会从 DOM 移除，
 * 因此「有一条可见」几乎等价于「有一个未销毁的浮层节点」。
 * 只认 `role="tooltip"`：el-select / el-dropdown 也复用 `.el-popper`，不加区分会把别的浮层算进来。
 */
const visibleTooltipTexts = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.el-popper[role="tooltip"]')]
      .filter(el => el.offsetParent !== null)
      .map(el => (el.textContent ?? '').trim()),
  );

/**
 * 当前「恰好一条」可见浮层的文案
 *
 * 多于一条或一条都没有时返回 null，让 `toBe` 的失败输出直接把实际状态打出来
 * （Playwright 的正则只在顶层比较生效，套在数组里会退化成严格相等，故用本函数取标量）。
 */
const onlyTooltipText = (page: Page): Promise<string | null> =>
  visibleTooltipTexts(page).then(texts => (texts.length === 1 ? texts[0] : null));

/** 等提示收敛到「恰好一条、且是期望文案」 */
const tooltipShows = (page: Page, key: string) =>
  expect.poll(() => onlyTooltipText(page), { timeout: 5_000, message: `提示没有出现「${key}」` }).toMatch(textOf(key));

/** 等提示完全退场（隐藏 200 毫秒 + 淡出过渡），把每条用例恢复到可重复测量的初态 */
const tooltipIsGone = (page: Page) =>
  expect.poll(() => visibleTooltipTexts(page), { timeout: 5_000, message: '提示没有退场' }).toEqual([]);

/** 取某条条目行内的操作按钮（只有它们带 data-tip） */
const operationButtons = (page: Page, username: string) => rowOf(page, username).locator('button[data-tip]');

/** 把指针移出所有按钮与浮层 */
const parkPointer = async (page: Page) => {
  await page.mouse.move(5, 5);
  await tooltipIsGone(page);
};

test.describe('操作列共享 tooltip', () => {
  test.beforeEach(async ({ optionsPage }) => {
    await createEntry(optionsPage, ENTRY_A);
    await createEntry(optionsPage, ENTRY_B);
  });

  test('五个操作按钮各自携带与无障碍名同源的文案', async ({ optionsPage }) => {
    const buttons = operationButtons(optionsPage, ENTRY_A.username);
    await expect(buttons).toHaveCount(OPERATION_KEYS.length);

    for (let i = 0; i < OPERATION_KEYS.length; i++) {
      const expected = textOf(OPERATION_KEYS[i]);
      await expect(buttons.nth(i)).toHaveAttribute('aria-label', expected);
      // 提示文案与屏幕阅读器读到的名字同源，避免两处文案各自漂移
      await expect(buttons.nth(i)).toHaveAttribute('data-tip', expected);
    }
  });

  test('悬停满 400 毫秒才出现，且锚定在按钮上方、带 aria-describedby', async ({ optionsPage }) => {
    const editBtn = operationButtons(optionsPage, ENTRY_A.username).nth(2);
    const box = (await editBtn.boundingBox())!;

    await editBtn.hover();
    // 延迟不能丢：200 毫秒时还不该有任何浮层（原来是 el-tooltip 的 show-after=400）
    await optionsPage.waitForTimeout(200);
    expect(await visibleTooltipTexts(optionsPage)).toEqual([]);

    await tooltipShows(optionsPage, 'common.edit');

    // 无障碍关联：打开期间触发元素必须指向「当前这个」浮层（逐行实例时代由 el-tooltip 负责，
    // 共享实例的 id 只有一份，最容易出的错是关联停在已被复用的旧节点上）
    const describedBy = await editBtn.getAttribute('aria-describedby');
    const popper = await optionsPage.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.el-popper[role="tooltip"]')].find(
        node => node.offsetParent !== null,
      );
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { id: el.id, cx: rect.left + rect.width / 2, bottom: rect.bottom };
    });
    expect(popper, '提示没有出现').not.toBeNull();
    expect(describedBy).toBe(popper!.id);

    // 锚定位置：浮层水平中心贴着按钮，且位于按钮上方
    expect(Math.abs(popper!.cx - (box.x + box.width / 2))).toBeLessThan(60);
    expect(popper!.bottom).toBeLessThanOrEqual(box.y + 4);
  });

  test('移到相邻按钮：旧提示不即时关掉，最终只剩新文案、且无障碍关联随之迁移', async ({ optionsPage }) => {
    const buttons = operationButtons(optionsPage, ENTRY_A.username);
    await buttons.nth(2).hover();
    await tooltipShows(optionsPage, 'common.edit');

    await buttons.nth(4).hover();
    // 隐藏仍走 Element Plus 的 hide-after（200 毫秒）：120 毫秒时旧文案必须还在，
    // 这一条同时排掉「文本原地替换」——原地替换意味着两个定时器被并成了一个。
    await optionsPage.waitForTimeout(120);
    await tooltipShows(optionsPage, 'common.edit');

    await tooltipShows(optionsPage, 'common.delete');
    await expect(buttons.nth(4)).toHaveAttribute('aria-describedby', /.+/);
    await expect(buttons.nth(2)).not.toHaveAttribute('aria-describedby', /.+/);
  });

  test('指针移入浮层时保持显示（enterable），移出后才关', async ({ optionsPage }) => {
    const editBtn = operationButtons(optionsPage, ENTRY_A.username).nth(2);
    await editBtn.hover();
    await tooltipShows(optionsPage, 'common.edit');

    const popper = optionsPage.locator('.el-popper[role="tooltip"]').filter({ hasText: textOf('common.edit') });
    const popperBox = (await popper.boundingBox())!;
    await optionsPage.mouse.move(popperBox.x + popperBox.width / 2, popperBox.y + popperBox.height / 2);

    // 停留超过 hide-after：共享实例若在触发元素切换时丢掉 enterable，这里就会关掉
    await optionsPage.waitForTimeout(900);
    await tooltipShows(optionsPage, 'common.edit');

    await parkPointer(optionsPage);
  });

  test('离开后再次悬停同一颗按钮，仍按 400 毫秒延迟出现', async ({ optionsPage }) => {
    const editBtn = operationButtons(optionsPage, ENTRY_A.username).nth(2);
    await editBtn.hover();
    await tooltipShows(optionsPage, 'common.edit');
    await parkPointer(optionsPage);

    // 第二次悬停是共享实例特有的一条路径：第一次打开时 Element Plus 已把 `mouseenter`
    // 绑到这颗按钮上，若共享实例的 `show-after` 留 0，它会**即时**弹出（逐行实例永远要等
    // 400 毫秒）。上面的 `parkPointer` 让浮层彻底退场，这里量「指针到位 → 浮层可见」的间隔，
    // 而不是只断言"出现过"——只断言出现过对 0 毫秒和 400 毫秒同样通过，等于没测。
    const box = (await editBtn.boundingBox())!;
    const started = Date.now();
    await optionsPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await optionsPage.waitForTimeout(200);
    expect(await visibleTooltipTexts(optionsPage), '200 毫秒时还不该出现').toEqual([]);

    await tooltipShows(optionsPage, 'common.edit');
    const elapsed = Date.now() - started;
    expect(
      elapsed,
      `二次悬停同一颗按钮只等了 ${elapsed} 毫秒就弹出，延迟被 Element Plus 自己接管`,
    ).toBeGreaterThanOrEqual(300);
    expect(elapsed, `二次悬停等了 ${elapsed} 毫秒，超出可用范围`).toBeLessThan(1500);
    await parkPointer(optionsPage);
  });

  test('收藏态在两次悬停之间被切换，再次悬停给的是切换后的文案', async ({ optionsPage }) => {
    const buttons = operationButtons(optionsPage, ENTRY_A.username);
    const favBtn = buttons.nth(3);
    await favBtn.hover();
    await tooltipShows(optionsPage, 'common.favorite');
    await parkPointer(optionsPage);

    await favBtn.click();
    await parkPointer(optionsPage);
    await expect(favBtn).toHaveAttribute('data-tip', textOf('common.unfavorite'));

    // 提示文案存在排程器里（`content`），而按钮上的 `data-tip` 已经变了：
    // 到点必须先按当前 `data-tip` 改写再打开，否则会读到切换前的旧文案。
    const box = (await favBtn.boundingBox())!;
    await optionsPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await optionsPage.waitForTimeout(200);
    expect(await visibleTooltipTexts(optionsPage), '200 毫秒时还不该出现').toEqual([]);
    await tooltipShows(optionsPage, 'common.unfavorite');
    await parkPointer(optionsPage);
  });

  test('跨行连续悬停六个按钮，每次只出现该按钮自己的文案', async ({ optionsPage }) => {
    // 逐行实例时代每行 5 个实例，共享之后最典型的回归是「文案与按钮错位」，
    // 因此跨行、跨按钮各测一次，而不是只测同一个。
    for (const username of [ENTRY_A.username, ENTRY_B.username]) {
      const buttons = operationButtons(optionsPage, username);
      for (const index of [0, 1, 3]) {
        await buttons.nth(index).hover();
        await tooltipShows(optionsPage, OPERATION_KEYS[index]);
        await parkPointer(optionsPage);
      }
    }
  });

  test('点击操作按钮后提示关掉，详情页正常打开', async ({ optionsPage }) => {
    const buttons = operationButtons(optionsPage, ENTRY_A.username);
    await buttons.nth(0).hover();
    await tooltipShows(optionsPage, 'options.detail.viewDetail');

    await buttons.nth(0).click();
    const drawer = optionsPage.getByRole('dialog').filter({ hasText: textOf('options.detail.title') });
    await expect(drawer).toBeVisible();
    await tooltipIsGone(optionsPage);
  });

  test('浮层开着时该行被过滤掉，不残留悬空提示', async ({ optionsPage }) => {
    const buttons = operationButtons(optionsPage, ENTRY_A.username);
    await buttons.nth(4).hover();
    await tooltipShows(optionsPage, 'common.delete');

    const search = optionsPage.locator('.filters input').first();
    await search.fill(ENTRY_B.username);
    await expect(rowOf(optionsPage, ENTRY_A.username)).toHaveCount(0);
    // 整表重渲染会连带移除触发元素。逐行实例时代浮层随该行实例同帧消失；共享实例只剩
    // `onBeforeUpdate` 那条 200 毫秒延迟关，而卸载后的元素再不会有 mouseleave——
    // 所以这里断言"行没了的同一刻提示就没了"，只断言最终消失会把这段原地悬停放过去。
    expect(await visibleTooltipTexts(optionsPage), '行已被移除，提示仍悬在原处').toEqual([]);

    await search.fill('');
    await expect(rowOf(optionsPage, ENTRY_A.username)).toHaveCount(1);
    // 这条路径把过渡名切到了"无淡出"档，必须在下一次悬停时还原：否则提示虽然还能开，
    // 但所有正常关闭都变成硬切，是一次看不见的交互退化。
    await buttons.nth(4).hover();
    await tooltipShows(optionsPage, 'common.delete');
    await parkPointer(optionsPage);
  });

  test('键盘聚焦不弹提示（与原 hover-only 口径一致），但无障碍名仍在', async ({ optionsPage }) => {
    const editBtn = operationButtons(optionsPage, ENTRY_A.username).nth(2);
    await editBtn.focus();
    await optionsPage.waitForTimeout(900);

    // el-tooltip 默认 trigger=hover，focus 不触发；共享实例也必须保持这个边界
    expect(await visibleTooltipTexts(optionsPage)).toEqual([]);
    await expect(editBtn).toHaveAttribute('aria-label', textOf('common.edit'));
  });
});
