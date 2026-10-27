import type { Page } from '@playwright/test';
import { STORAGE_KEYS } from '../utils/storageKeys';
import { createEntry, expect, test } from './harness';
import { textOf } from './i18n';

/**
 * 备份轻提醒的生命周期：退场动画、不闪现、关闭活过刷新
 *
 * 三条都是用户实际抱怨过的体验，且都只在真浏览器里量得到：
 *
 * 1. **退场动画**。横幅原先是 `v-if` 直接摘掉的，点「本次不再提示」那一瞬整块消失，下面的
 *    搜索条与列表往上跳一次。现在外面套了一层 `grid-template-rows: 1fr → 0fr` 的壳，高度与
 *    透明度一起走 `--aph-duration-mid`（卡片高度由内容决定，`auto` 不可插值，必须有这层壳）。
 *    量法必须在页面里自己走帧：0.2s 的东西靠 CDP 往返采样，读到的永远是结束后的静止值。
 * 2. **不闪现**。条目数在列表到手那一刻就有，备份时间戳还要再读一次；中间那段档位算成
 *    「从未备份」，于是每次刷新都先画一条横幅再收掉。修法是三路输入读全之前一律不出声，
 *    这里用「整个加载过程从未出现过这个节点」来量，而不是「最后看不见」（后者恒真）。
 * 3. **关闭活过刷新**。标记原先只是一个 `ref`，「本次不再提示」实际等于「本次文档不再提示」；
 *    现在记在 `chrome.storage.session`，刷新后不该再出现，而这条判据同样必须靠 reload 才量得到。
 */

/** 横幅壳与那枚「本次不再提示」（壳是 App.vue 渲染的，卡片是组件自己的根） */
const shell = (page: Page) => page.locator('.backup-nudge-shell');
const dismissButton = (page: Page) => shell(page).getByRole('button', { name: textOf('options.backupNudge.dismiss') });

/**
 * 装一个「这个节点有没有出现过」的探针，作用域覆盖接下来的每一次导航
 *
 * 只能靠 `addInitScript` 装在文档脚本之前：横幅是在首帧之后、异步读回的那一瞬间画出来的，
 * 等测试侧拿到 page 再去 `querySelector` 早就错过了。`MutationObserver` 盯整棵树的 childList，
 * 出现过一次就永久记真，正是「闪一下」的形状。
 *
 * 观察对象必须是 `document` 而不是 `document.documentElement`：init script 的执行点早于解析器
 * 造出 `<html>`，那一刻 `documentElement` 还是 `null`，`observe(null)` 抛 TypeError，于是探针
 * **静默失效**——而一个永不置真的探针会让下面每一条 `toBe(false)` 都恒绿（实测就是这样把
 * 「刷新后确实出现过横幅」这条正对照读成 `false` 的）。顺带记一个 `__nudgeProbeArmed`，
 * 让「探针没装上」和「装上后没看见」这两种失败在读数上就能分开。
 */
async function armNudgeProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = window as unknown as { __sawNudge: boolean; __nudgeProbeArmed?: boolean };
    store.__sawNudge = false;
    const check = (): void => {
      if (document.querySelector('.backup-nudge-shell')) store.__sawNudge = true;
    };
    new MutationObserver(check).observe(document, { childList: true, subtree: true });
    store.__nudgeProbeArmed = true;
    check();
  });
}

/** 等首屏真的画完（列表在，说明已解锁且数据到手），再给异步读留一段余量后取探针读数 */
async function settleAndReadProbe(page: Page): Promise<boolean> {
  await expect(page.locator('.filters'), '刷新后没回到已解锁的列表页').toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
  return page.evaluate(() => {
    const store = window as unknown as { __sawNudge: boolean; __nudgeProbeArmed?: boolean };
    // 页内没有 Playwright 的 expect，也不能有：探针失效能直接抛，比让调用方拿到一个假 `false` 好定位
    if (store.__nudgeProbeArmed !== true) throw new Error('探针没装上：这条读数没有意义');
    return store.__sawNudge;
  });
}

/**
 * 起一段页内录像：接下来 1.2s 里逐帧记壳的高度变化与在跑的过渡属性名
 *
 * 高度只记「与上一帧不同」的读数，这样数组本身就是塌缩轨迹；元素被摘掉后不再采样。
 * 过渡属性必须只认壳**自己**那一条：`document.getAnimations()` 是全文档的，而 `.contains()`
 * 还会把横幅里那枚 link 按钮自己的 `color` 过渡也算进来（实测就是这么混进 `color, transform`
 * 的）。被评审的这条声明只挂在壳上，读数也只看壳。
 */
async function startDismissWatch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as { __heights: number[]; __props: string[] };
    store.__heights = [];
    store.__props = [];
    const end = performance.now() + 1_200;
    const tick = (): void => {
      const el = document.querySelector<HTMLElement>('.backup-nudge-shell');
      if (el) {
        const height = Math.round(el.getBoundingClientRect().height);
        if (store.__heights[store.__heights.length - 1] !== height) store.__heights.push(height);
        for (const animation of document.getAnimations()) {
          const target = (animation.effect as unknown as { target?: Node } | null)?.target;
          if (target !== el) continue;
          const property = (animation as unknown as { transitionProperty?: string }).transitionProperty;
          if (property && !store.__props.includes(property)) store.__props.push(property);
        }
      }
      if (performance.now() < end) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** 读回录像（录像自带截止时间，不必显式停） */
async function readDismissWatch(page: Page): Promise<{ heights: number[]; props: string[] }> {
  await page.waitForTimeout(500);
  return page.evaluate(() => ({
    heights: (window as unknown as { __heights: number[] }).__heights,
    props: (window as unknown as { __props: string[] }).__props,
  }));
}

/** 让横幅出现在屏上：建一条条目 → 收掉与之互斥的安全起步清单 */
async function revealNudge(page: Page): Promise<number> {
  await createEntry(page, { username: 'nudge-motion@qa.test', password: 'Synthetic!Motion1' });

  const checklist = page.locator('.activation');
  if (await checklist.isVisible().catch(() => false)) {
    await checklist.getByRole('button', { name: textOf('options.activation.dismiss') }).click();
    await expect(checklist, '清单没收起，横幅会被它互斥掉').toBeHidden();
  }

  await expect(shell(page), '从未备份时备份提醒横幅应当出现').toBeVisible({ timeout: 15_000 });

  // 基线必须等入场收口之后再取：`toBeVisible` 在元素一出现就通过，那时高度还停在入场动画中途
  // （实测读到过 46px，收口后是 136px）。拿中途值当「初始高度」，退场途中那些比它大的读数
  // 会被全部判成「没收高度」，红的是量法，不是动画。
  let height = 0;
  await expect
    .poll(
      async () => {
        const next = await shell(page).evaluate(el => Math.round(el.getBoundingClientRect().height));
        const settled = next > 0 && next === height;
        height = next;
        return settled;
      },
      { message: '横幅高度迟迟不稳定，入场动画没有收口？', timeout: 5_000 },
    )
    .toBe(true);
  return height;
}

test('点「本次不再提示」时高度与透明度一起收，退场途中能读到中间值', async ({ optionsPage }) => {
  test.setTimeout(180_000);
  const page = optionsPage;
  const initial = await revealNudge(page);

  await startDismissWatch(page);
  await dismissButton(page).click();

  const { heights, props } = await readDismissWatch(page);
  await expect(shell(page), '退场结束后壳应当真的不在了').toBeHidden();

  const middle = heights.filter(h => h > 0 && h < initial - 4);
  expect(
    middle.length,
    `退场没有收高度（初始 ${initial}px，采样轨迹 ${heights.join(' → ') || '<空>'}）`,
  ).toBeGreaterThanOrEqual(2);
  expect(props, `在跑的过渡里没有收高度那一条：${props.join(', ') || '<无>'}`).toContain('grid-template-rows');
  expect(props, `在跑的过渡里没有淡出那一条：${props.join(', ') || '<无>'}`).toContain('opacity');
});

test('reduced-motion 下不播这两下，横幅当场消失', async ({ optionsPage }) => {
  test.setTimeout(180_000);
  const page = optionsPage;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const initial = await revealNudge(page);

  await startDismissWatch(page);
  await dismissButton(page).click();

  const { heights, props } = await readDismissWatch(page);
  await expect(shell(page)).toBeHidden();

  const middle = heights.filter(h => h > 0 && h < initial - 4);
  expect(middle, `减动效档还在收高度，轨迹 ${heights.join(' → ')}`).toHaveLength(0);
  expect(props, `减动效档还挂着过渡：${props.join(', ') || '<无>'}`).toEqual([]);
});

test('关掉之后刷新不再出现：「本次不再提示」活过刷新', async ({ optionsPage }) => {
  test.setTimeout(180_000);
  const page = optionsPage;
  await revealNudge(page);
  await dismissButton(page).click();
  await expect(shell(page), '退场结束后壳应当真的不在了').toBeHidden();

  await armNudgeProbe(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect(await settleAndReadProbe(page), '刷新又把同一条提醒画出来了：关闭只活到本次文档').toBe(false);
});

test('档位本不该出声时，整个加载过程从未画出横幅（不闪现）', async ({ optionsPage }) => {
  test.setTimeout(180_000);
  const page = optionsPage;
  // 借这一步收掉与之互斥的安全起步清单，让横幅成为唯一的候选横幅
  await revealNudge(page);

  // 正对照（这条判据的刀）：探针必须看得见一条**本该出现**的横幅。少了这一步，
  // 下面那句 `toBe(false)` 与「探针根本没装上」是同一种绿。
  await armNudgeProbe(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect(await settleAndReadProbe(page), '探针连合法出现的横幅都读不到，负对照就没有意义').toBe(true);

  // 把「已通过自检的备份时间戳」写成刚刚：终态档位是 ok，横幅不该出现。而条目数在列表到手
  // 那一刻就有、时间戳要等 `refresh()` 读回来，中间那段档位是 critical——就是闪一下的来源。
  await page.evaluate(
    async keys => {
      const now = Date.now();
      await chrome.storage.local.set({ [keys.backup]: now, [keys.change]: now - 86_400_000 });
    },
    { backup: STORAGE_KEYS.LAST_VERIFIED_BACKUP_AT, change: STORAGE_KEYS.LAST_PASSWORD_CHANGE_AT },
  );

  await armNudgeProbe(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect(await settleAndReadProbe(page), '加载途中画过一次再收掉：三路输入读全之前不该出声').toBe(false);
});
