import { createEntry, expect, test } from './harness';
import { textOf } from './i18n';

/**
 * 更新提示与一次性评价引导
 *
 * 两条都是「只在该出现时出现一次」的卡片，最难验证的不是文案而是触发边界：
 * - 首次安装不能在设置主密码后被更新卡片打扰；
 * - 已有密码库 + 版本变化才显示 What's New；
 * - 评价引导只在完成起步清单（≥3 条、备份、体检）后出现，关闭后不再出现。
 */
const WHATS_NEW_KEY = 'whats_new_seen_version';
const REVIEW_KEY = 'review_prompt_state';
const BACKUP_KEY = 'last_verified_backup_at';
const HEALTH_KEY = 'password_health_history';

test.describe('更新与评价引导', () => {
  test('首次安装记录已读版本，不显示更新卡片', async ({ optionsPage: page }) => {
    const version = await page.evaluate(() => chrome.runtime.getManifest().version);
    await expect
      .poll(() => page.evaluate(async key => (await chrome.storage.local.get(key))[key], WHATS_NEW_KEY))
      .toEqual({ seenVersion: version });
    await expect(page.locator('.growth--whats-new')).toHaveCount(0);
  });

  test('版本变化显示一次 What is new，关闭后写回已读版本', async ({ optionsPage: page }) => {
    const version = await page.evaluate(() => chrome.runtime.getManifest().version);
    await page.evaluate(async ({ key, value }) => chrome.storage.local.set({ [key]: value }), {
      key: WHATS_NEW_KEY,
      value: { seenVersion: '0.0.0' },
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    const card = page.locator('.growth--whats-new');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading')).toHaveText(textOf('options.growth.whatsNew.title'));
    await expect(card.locator('.growth__list li')).toHaveCount(3);

    await card.getByRole('button', { name: textOf('options.growth.whatsNew.dismiss') }).click();
    await expect(card).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(async key => (await chrome.storage.local.get(key))[key], WHATS_NEW_KEY))
      .toEqual({ seenVersion: version });
  });

  test('完成起步清单后一次性询问评价，关闭后不再出现', async ({ optionsPage: page }) => {
    const version = await page.evaluate(() => chrome.runtime.getManifest().version);
    await createEntry(page, {
      username: 'review-1@example.com',
      password: 'Review#Pass1',
      url: 'https://review.example.com',
    });
    await createEntry(page, {
      username: 'review-2@example.com',
      password: 'Review#Pass2',
      url: 'https://review.example.com',
    });
    await createEntry(page, {
      username: 'review-3@example.com',
      password: 'Review#Pass3',
      url: 'https://review.example.com',
    });

    await page.evaluate(
      async ({ whatsNewKey, reviewKey, backupKey, healthKey, seenVersion }) => {
        await chrome.storage.local.set({
          [whatsNewKey]: { seenVersion },
          [reviewKey]: { dismissedAt: null },
          [backupKey]: Date.now(),
          [healthKey]: [
            {
              at: Date.now(),
              score: 88,
              total: 3,
              reuse: 0,
              weak: 0,
              breached: 0,
              stale: 0,
            },
          ],
        });
      },
      {
        whatsNewKey: WHATS_NEW_KEY,
        reviewKey: REVIEW_KEY,
        backupKey: BACKUP_KEY,
        healthKey: HEALTH_KEY,
        seenVersion: version,
      },
    );
    await page.reload({ waitUntil: 'domcontentloaded' });

    const card = page.locator('.growth--review');
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
    await expect(page.locator('.growth--review')).toHaveCount(0);
  });
});
