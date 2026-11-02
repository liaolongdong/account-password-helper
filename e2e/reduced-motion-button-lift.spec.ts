import type { Page } from '@playwright/test';
import { expect, test } from './harness';

/**
 * 减弱动效档下，管理页按钮的 1px 悬浮上浮必须真的被撤掉（评审 2026-11-02 U1 的真机证据）
 *
 * 静态那条腿是 `tests/architecture/reducedMotionCoverage.test.ts` 的层叠判据：它证明
 * `transform: none` 排在基规则之后。但「排在后面」到「浏览器真的用它」之间还隔着一整条层叠
 * 与过渡链，而这条链上曾出过一次全员漏过的事故——媒体查询不增加特异性、源序后者胜这件事，
 * stylelint 不管、守卫原先只看文件里有没有 `@media`。
 *
 * 量法有两个坑，都踩过：
 * 1. `.el-button` 基规则带着 `transition: transform .2s`，减弱档只撤 `transform` 的值、
 *    不撤这条过渡。刚 hover 上就读，拿到的是**插值途中**的矩阵，不是终值——所以必须 poll 到稳定。
 * 2. 只有正对照不算证据：默认档必须量到真的上浮（`matrix(..., -1)`），否则「减弱档读到 none」
 *    可能只是因为这条选择器压根没生效过。
 */

/**
 * hover 后等这枚元素上的 CSS 过渡真的结束再读终值
 *
 * 基规则 `.el-button` 带着 `transition: transform .2s`，而减弱档撤的是 `transform` 的**值**、
 * 不撤这条过渡：刚 hover 上就读，拿到的是插值途中的矩阵。默认档下过渡会起（等到空），减弱档下
 * 目标值与当前值都是 `none`、压根不起动画（立即返回），两种情形都落在终值上。
 */
async function settledTransform(page: Page, button: string): Promise<string> {
  const target = page.locator(button).first();
  await target.hover();
  await target.evaluate(async (el: HTMLElement) => {
    // 先给一帧让过渡真的建立起来，再等它清空
    await new Promise(resolve => setTimeout(resolve, 120));
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline && el.getAnimations().length > 0) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  });
  return target.evaluate((el: Element) => getComputedStyle(el).transform);
}

/** 管理页头部确实有真按钮：探针不许空跑 */
async function requireHeaderButton(page: Page): Promise<void> {
  await expect(page.locator('.header .el-button').first(), '头部没有按钮，下面的读数没有意义').toBeVisible();
}

test('正对照：默认档下头部按钮悬浮确实上浮 1px', async ({ optionsPage }) => {
  test.setTimeout(180_000);
  const page = optionsPage;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await requireHeaderButton(page);

  const transform = await settledTransform(page, '.header .el-button');
  expect(
    transform,
    '默认档读不到上浮，说明这条选择器在真页面上根本没生效，减弱档那条断言也就成了空读数',
  ).toMatch(/matrix\(1, 0, 0, 1, 0, -1\)/);
});

test('减弱档下同一枚按钮悬浮不再上浮', async ({ optionsPage }) => {
  test.setTimeout(180_000);
  const page = optionsPage;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await requireHeaderButton(page);

  const transform = await settledTransform(page, '.header .el-button');
  expect(
    transform,
    '减弱档还在上浮：撤销声明被同选择器的后来者压过了（媒体查询不加特异性，源序后者胜）',
  ).toBe('none');
});
