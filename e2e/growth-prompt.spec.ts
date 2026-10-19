import { createEntry, expect, expectSuccessToast, onboardAndUnlock, rowOf, test } from './harness';
import { textOf } from './i18n';
import type { Page } from '@playwright/test';

/**
 * 版本更新弹窗与一次性评价引导
 *
 * 两条都只在该出现时出现一次：
 * - 首次安装不能弹更新窗；
 * - 已有密码库 + 版本变化弹一次更新弹窗；
 * - 密码库存在满 7 天且用过一次后询问评价，可延后 30 天或永久关闭。
 */
const WHATS_NEW_KEY = 'whats_new_seen_version';
const REVIEW_KEY = 'review_prompt_state';
const CLOCK_OFFSET_KEY = 'aph-e2e-clock-offset';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 把页面时钟整体拨快指定天数并重新加载
 *
 * 首次使用时间由条目上的真实时间戳派生，测试进程又无法解密后改写条目，因此只能从页面
 * 时间侧制造「已经过去 N 天」。偏移量放进 sessionStorage，让注入脚本在 reload 后仍能读到。
 * 时钟拨快会让旧会话立即过期，所以每次 reload 后都重新解锁。
 */
async function shiftClockAndReload(page: Page, days: number): Promise<void> {
  await page.evaluate(({ key, offset }) => window.sessionStorage.setItem(key, String(offset)), {
    key: CLOCK_OFFSET_KEY,
    offset: days * DAY_MS,
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await onboardAndUnlock(page);
}

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

  test('密码库存在满 7 天且用过一次后询问评价，延后与永久关闭分别生效', async ({ optionsPage: page }) => {
    const version = await page.evaluate(() => chrome.runtime.getManifest().version);
    await createEntry(page, {
      username: 'review@example.com',
      password: 'Review#Pass1',
      url: 'https://review.example.com',
    });

    // 收藏会写入 favoriteUsedAt，作为「确实用过一次」的真实信号
    await rowOf(page, 'review@example.com')
      .getByRole('button', { name: textOf('common.favorite') })
      .click();
    await expectSuccessToast(page, 'sidepanel.favorited');

    await page.evaluate(
      async ({ whatsNewKey, reviewKey, seenVersion }) => {
        await chrome.storage.local.set({
          [whatsNewKey]: { seenVersion },
          [reviewKey]: { dismissedAt: null, snoozedUntil: null },
        });
      },
      { whatsNewKey: WHATS_NEW_KEY, reviewKey: REVIEW_KEY, seenVersion: version },
    );

    // 在后续每一次导航前把 Date.now 拨快；偏移量从 sessionStorage 读取，reload 后仍生效
    await page.addInitScript(
      ({ key }) => {
        const offset = Number(window.sessionStorage.getItem(key) ?? '0');
        if (!Number.isFinite(offset) || offset === 0) return;
        const realNow = Date.now.bind(Date);
        Date.now = () => realNow() + offset;
      },
      { key: CLOCK_OFFSET_KEY },
    );

    // 第 3 天：已经用过，但密码库还不满 7 天，不打扰
    await shiftClockAndReload(page, 3);
    await expect(page.locator('.review-prompt')).toHaveCount(0);

    // 第 8 天：条件满足，卡片出现且三个动作齐全
    await shiftClockAndReload(page, 8);
    const card = page.locator('.review-prompt');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading')).toHaveText(textOf('options.growth.review.title'));
    await expect(card.locator('.review-prompt__desc')).toHaveText(textOf('options.growth.review.desc'));
    await expect(card.getByRole('button', { name: textOf('options.growth.review.cta') })).toBeVisible();
    await expect(card.getByRole('button', { name: textOf('options.growth.review.snooze') })).toBeVisible();
    await expect(card.getByRole('button', { name: textOf('options.growth.review.dismiss') })).toBeVisible();

    // 稍后再说：写入 30 天静默期，刷新后仍不出现
    await card.getByRole('button', { name: textOf('options.growth.review.snooze') }).click();
    await expect(card).toHaveCount(0);
    const snoozedState = await page.evaluate(async key => {
      const state = (await chrome.storage.local.get(key))[key] as
        { dismissedAt?: unknown; snoozedUntil?: unknown } | undefined;
      return { dismissedAt: state?.dismissedAt ?? null, snoozedUntil: state?.snoozedUntil ?? null };
    }, REVIEW_KEY);
    expect(snoozedState.dismissedAt).toBeNull();
    expect(typeof snoozedState.snoozedUntil).toBe('number');
    expect(snoozedState.snoozedUntil).toBeGreaterThan(Date.now());

    await page.reload({ waitUntil: 'domcontentloaded' });
    await onboardAndUnlock(page);
    await expect(page.locator('.review-prompt')).toHaveCount(0);

    // 静默期结束后会再次出现，此时可以永久关闭
    await page.evaluate(async key => {
      await chrome.storage.local.set({ [key]: { dismissedAt: null, snoozedUntil: Date.now() - 60_000 } });
    }, REVIEW_KEY);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await onboardAndUnlock(page);
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: textOf('options.growth.review.dismiss') }).click();
    await expect(card).toHaveCount(0);
    await expect
      .poll(async () => {
        const state = await page.evaluate(async key => {
          const value = (await chrome.storage.local.get(key))[key] as
            { dismissedAt?: unknown; snoozedUntil?: unknown } | undefined;
          return { dismissedAt: typeof value?.dismissedAt, snoozedUntil: value?.snoozedUntil ?? null };
        }, REVIEW_KEY);
        return state;
      })
      .toEqual({ dismissedAt: 'number', snoozedUntil: null });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await onboardAndUnlock(page);
    await expect(page.locator('.review-prompt')).toHaveCount(0);
  });
});
