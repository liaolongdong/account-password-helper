import { createEntry, expect, onboardAndUnlock, test } from './harness';
import { textOf } from './i18n';
import type { Page } from '@playwright/test';

/**
 * 版本更新弹窗与一次性评价引导
 *
 * 两条都只在该出现时出现一次：
 * - 首次安装不能弹更新窗；
 * - 已有密码库 + 版本变化弹一次更新弹窗；
 * - 评价引导要同时满足「密码多于 1 条 + 成功填充过 + 首次填充已满 7 天」，本用例按一次
 *   只翻动一个变量的方式把三道门槛逐一钉住，再验证延后 30 天与永久关闭的落盘。
 *
 * 首次填充时间（`firstFillAt`）在这里是直接写进存储的，不是靠真实填充产生：E2E 里侧边栏
 * 以标签页形态打开，`sender.tab` 有值会被 `isTrustedInternalSender` 拒掉（与 harness 记录的
 * 「快速添加在非停靠形态被守卫拒绝」同一限制），填充的使用痕迹委托因此到不了后台；快捷键
 * 走 CDP 派发按键，触发不了浏览器级的 manifest command。「真实填充 → 后台元数据落盘 → 记
 * 一次锚点」这条链由 `tests/utils/passwordCrudFirstFillAnchor.test.ts` 在真实的防抖 flush
 * 函数上验证，本文件不假装在真实浏览器里测到了它。
 */
const WHATS_NEW_KEY = 'whats_new_seen_version';
const REVIEW_KEY = 'review_prompt_state';
const CLOCK_OFFSET_KEY = 'aph-e2e-clock-offset';
const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_ENTRY = {
  username: 'review-first@example.com',
  password: 'Review#Pass1',
  url: 'https://first.example.com',
};
const SECOND_ENTRY = {
  username: 'review-second@example.com',
  password: 'Review#Pass2',
  url: 'https://second.example.com',
};

type ReviewState = { dismissedAt: number | null; snoozedUntil: number | null; firstFillAt: number | null };

/**
 * 把页面时钟整体拨快指定天数并重新加载
 *
 * 偏移量放进 sessionStorage，让注入脚本在 reload 后仍能读到；时钟拨快会让旧会话立即过期，
 * 所以每次 reload 后都重新解锁。锚点用测试进程的真实时钟写入，两者相减即「过去几天」。
 */
async function shiftClockAndReload(page: Page, days: number): Promise<void> {
  await page.evaluate(({ key, offset }) => window.sessionStorage.setItem(key, String(offset)), {
    key: CLOCK_OFFSET_KEY,
    offset: days * DAY_MS,
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await onboardAndUnlock(page);
}

/** 写入评价引导状态（只有三个时间戳，无任何账号数据） */
async function seedReviewState(page: Page, state: ReviewState): Promise<void> {
  await page.evaluate(async ({ key, value }) => chrome.storage.local.set({ [key]: value }), {
    key: REVIEW_KEY,
    value: state,
  });
}

/** 读评价引导状态（三个时间戳，无账号数据） */
async function readReviewState(page: Page): Promise<ReviewState> {
  return page.evaluate(async key => {
    const value = (await chrome.storage.local.get(key))[key] as
      { dismissedAt?: number | null; snoozedUntil?: number | null; firstFillAt?: number | null } | undefined;
    return {
      dismissedAt: value?.dismissedAt ?? null,
      snoozedUntil: value?.snoozedUntil ?? null,
      firstFillAt: value?.firstFillAt ?? null,
    };
  }, REVIEW_KEY);
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

  test('密码多于 1 条、填充过、首次填充满 7 天，三道门槛缺一即不出现', async ({ optionsPage: page }) => {
    const version = await page.evaluate(() => chrome.runtime.getManifest().version);
    await page.evaluate(
      async ({ whatsNewKey, reviewKey, seenVersion }) => {
        await chrome.storage.local.set({
          [whatsNewKey]: { seenVersion },
          [reviewKey]: { dismissedAt: null, snoozedUntil: null, firstFillAt: null },
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

    // 锚点取测试进程的真实时钟：页面里的 Date.now 已被拨快，不能用它造「刚刚填充过」
    const anchor = Date.now();
    const filled: ReviewState = { dismissedAt: null, snoozedUntil: null, firstFillAt: anchor };
    const card = page.locator('.review-prompt');

    // 门槛一：已填充、已满 7 天，但只有 1 条密码 → 不打扰
    await createEntry(page, FIRST_ENTRY);
    await seedReviewState(page, filled);
    await shiftClockAndReload(page, 8);
    await expect(card).toHaveCount(0);

    // 三条齐了：再录一条，卡片当场出现且三个动作齐全
    await createEntry(page, SECOND_ENTRY);
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading')).toHaveText(textOf('options.growth.review.title'));
    await expect(card.locator('.review-prompt__desc')).toHaveText(textOf('options.growth.review.desc'));
    await expect(card.getByRole('button', { name: textOf('options.growth.review.cta') })).toBeVisible();
    await expect(card.getByRole('button', { name: textOf('options.growth.review.snooze') })).toBeVisible();
    await expect(card.getByRole('button', { name: textOf('options.growth.review.dismiss') })).toBeVisible();

    // 门槛二：抹掉首次填充时间（只录入、从未填充）→ 另外两条再满足也不问
    await seedReviewState(page, { dismissedAt: null, snoozedUntil: null, firstFillAt: null });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await onboardAndUnlock(page);
    await expect(card).toHaveCount(0);

    // 门槛三：恢复锚点但退到第 3 天 → 不满 7 天，仍不打扰
    await seedReviewState(page, filled);
    await shiftClockAndReload(page, 3);
    await expect(card).toHaveCount(0);

    // 第 8 天：出现。「稍后再说」写 30 天静默期并保留锚点，刷新后仍静默
    await shiftClockAndReload(page, 8);
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: textOf('options.growth.review.snooze') }).click();
    await expect(card).toHaveCount(0);
    const snoozedState = await readReviewState(page);
    expect(snoozedState.dismissedAt).toBeNull();
    expect(typeof snoozedState.snoozedUntil).toBe('number');
    expect(snoozedState.firstFillAt).toBe(anchor);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await onboardAndUnlock(page);
    await expect(card).toHaveCount(0);

    // 静默期结束后会再次出现，此时可以永久关闭
    await seedReviewState(page, { ...filled, snoozedUntil: Date.now() - 60_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await onboardAndUnlock(page);
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: textOf('options.growth.review.dismiss') }).click();
    await expect(card).toHaveCount(0);
    await expect
      .poll(async () => {
        const state = await readReviewState(page);
        return {
          dismissedAt: typeof state.dismissedAt,
          snoozedUntil: state.snoozedUntil,
          firstFillAt: typeof state.firstFillAt,
        };
      })
      .toEqual({ dismissedAt: 'number', snoozedUntil: null, firstFillAt: 'number' });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await onboardAndUnlock(page);
    await expect(page.locator('.review-prompt')).toHaveCount(0);
  });
});
