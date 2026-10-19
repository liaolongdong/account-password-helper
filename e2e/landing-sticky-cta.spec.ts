import type { Page } from '@playwright/test';
import { expect, test } from './harness';

/**
 * 落地页悬浮安装入口：收起 / 展开 / 页脚让位
 *
 * 这枚浮层此前只会随滚动出现，不能收起，滚动到页脚微信区时会压住卡片。
 * 用真实 Chrome 验证三件事：按钮能切换 aria-expanded 与收起态、选择能持久化、
 * 页脚进入视口后浮层让位。
 */
const LANDING_ZH = new URL('../index.html', import.meta.url).href;
const COLLAPSED_KEY = 'aph-sticky-cta-collapsed';

async function scrollToFeatures(page: Page): Promise<void> {
  await page.locator('#features').scrollIntoViewIfNeeded();
  await expect(page.locator('#stickyCta')).toBeVisible();
}

test.describe('落地页悬浮安装入口', () => {
  test('可收起、可展开，并记住收起状态', async ({ extContext }) => {
    const page = await extContext.newPage();
    await page.goto(LANDING_ZH, { waitUntil: 'load' });
    await page.evaluate(key => localStorage.removeItem(key), COLLAPSED_KEY);
    await page.reload({ waitUntil: 'load' });
    await scrollToFeatures(page);

    const cta = page.locator('#stickyCta');
    const toggle = page.locator('#stickyCtaToggle');
    const label = page.locator('#stickyCta .sticky-cta__label');
    await expect(label).toBeVisible();

    await toggle.click();
    await expect(cta).toHaveClass(/is-collapsed/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(label).toBeHidden();
    expect(await page.evaluate(key => localStorage.getItem(key), COLLAPSED_KEY)).toBe('1');
    // 收起态下载链接仍在，只是文字让位
    await expect(page.locator('#stickyCtaLink')).toBeVisible();

    await toggle.click();
    await expect(cta).not.toHaveClass(/is-collapsed/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(label).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), COLLAPSED_KEY)).toBe('0');

    // 收起后刷新，滚动到同一位置仍应保持收起
    await toggle.click();
    await expect(cta).toHaveClass(/is-collapsed/);
    await page.reload({ waitUntil: 'load' });
    await scrollToFeatures(page);
    await expect(page.locator('#stickyCta')).toHaveClass(/is-collapsed/);
    await expect(page.locator('#stickyCtaToggle')).toHaveAttribute('aria-expanded', 'false');

    await page.close();
  });

  test('滚到页脚时让位，不遮挡微信交流区', async ({ extContext }) => {
    const page = await extContext.newPage();
    await page.goto(LANDING_ZH, { waitUntil: 'load' });
    await scrollToFeatures(page);
    await expect(page.locator('#stickyCta')).toBeVisible();

    await page.locator('footer').scrollIntoViewIfNeeded();
    await expect(page.locator('#stickyCta')).toBeHidden();
    await expect(page.locator('#contact')).toBeVisible();

    await page.close();
  });

  test('移动端收起后仍是一条紧凑入口，页面不横向溢出', async ({ extContext }) => {
    const page = await extContext.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(LANDING_ZH, { waitUntil: 'load' });
    await page.evaluate(key => localStorage.removeItem(key), COLLAPSED_KEY);
    await page.reload({ waitUntil: 'load' });
    await scrollToFeatures(page);

    await page.locator('#stickyCtaToggle').click();
    await expect(page.locator('#stickyCta')).toHaveClass(/is-collapsed/);
    const box = await page.locator('#stickyCta').boundingBox();
    expect(box, '收起后的悬浮入口没有可测尺寸').not.toBeNull();
    expect(box!.width, '收起后仍占掉过宽').toBeLessThan(100);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      '移动端出现横向滚动',
    ).toBe(true);

    await page.close();
  });
});
