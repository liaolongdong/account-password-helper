import { createEntry, expect, test } from './harness';
import { textOf } from './i18n';

/**
 * 版本更新弹窗与一次性评价引导
 *
 * 两条都只在该出现时出现一次：
 * - 首次安装不能弹更新窗；
 * - 已有密码库 + 版本变化弹一次更新弹窗；
 * - 保存第一条密码后出现评价卡片，关闭后不再出现。
 */
const WHATS_NEW_KEY = 'whats_new_seen_version';
const REVIEW_KEY = 'review_prompt_state';

test.describe('更新与评价引导', () => {
  test('首次安装记录已读版本，不显示更新弹窗', async ({ optionsPage: page }) => {
    const version = await page.evaluate(() => chrome.runtime.getManifest().version);
    await expect
      .poll(() => page.evaluate(async key => (await chrome.storage.local.get(key))[key], WHATS_NEW_KEY))
      .toEqual({ seenVersion: version });
    await expect(page.getByRole('dialog').filter({ hasText: textOf('options.growth.whatsNew.title') })).toHaveCount(0);
  });

  test('版本变化弹一次更新弹窗，关闭后写回已读版本', async ({ optionsPage: page }) => {
    const version = await page.evaluate(() => chrome.runtime.getManifest().version);
    await page.evaluate(async ({ key, value }) => chrome.storage.local.set({ [key]: value }), {
      key: WHATS_NEW_KEY,
      value: { seenVersion: '0.0.0' },
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.growth.whatsNew.title') });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.whats-new__list li')).toHaveCount(3);

    await dialog.getByRole('button', { name: textOf('options.growth.whatsNew.dismiss') }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => page.evaluate(async key => (await chrome.storage.local.get(key))[key], WHATS_NEW_KEY))
      .toEqual({ seenVersion: version });
  });

  test('保存第一条密码后询问一次评价，关闭后不再出现', async ({ optionsPage: page }) => {
    const version = await page.evaluate(() => chrome.runtime.getManifest().version);
    await createEntry(page, {
      username: 'review@example.com',
      password: 'Review#Pass1',
      url: 'https://review.example.com',
    });

    await page.evaluate(
      async ({ whatsNewKey, reviewKey, seenVersion }) => {
        await chrome.storage.local.set({
          [whatsNewKey]: { seenVersion },
          [reviewKey]: { dismissedAt: null },
        });
      },
      { whatsNewKey: WHATS_NEW_KEY, reviewKey: REVIEW_KEY, seenVersion: version },
    );
    await page.reload({ waitUntil: 'domcontentloaded' });

    const card = page.locator('.review-prompt');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading')).toHaveText(textOf('options.growth.review.title'));

    await card.getByRole('button', { name: textOf('options.growth.review.dismiss') }).click();
    await expect(card).toHaveCount(0);
    await expect
      .poll(async () => {
        const state = await page.evaluate(async key => (await chrome.storage.local.get(key))[key], REVIEW_KEY);
        return typeof (state as { dismissedAt?: unknown })?.dismissedAt;
      })
      .toBe('number');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.review-prompt')).toHaveCount(0);
  });
});
