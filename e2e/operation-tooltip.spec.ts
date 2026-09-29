import type { Page } from '@playwright/test';
import { createEntry, expect, parkPointer, rowOf, test, visibleTooltipTexts } from './harness';
import { textOf } from './i18n';

/**
 * 管理页操作列提示的交互等价性（真机）
 *
 * 性能背景：操作列原本每行创建 5 个 `el-tooltip` 实例，600 行 = 3000 个组件实例，
 * 实测占掉整表挂载耗时的四成（`docs/PERF_LARGE_VAULT_EVALUATION.md` 9.9）。
 * 现在全表共享一个 `virtual-triggering` 实例：显示延迟（400 毫秒）搬到
 * `useSharedHoverTooltip`，隐藏（200 毫秒）与 `aria-describedby` 留给 Element Plus，
 * 而浮层对指针透明是由实例上的 popper 样式决定的——**一条交互被拆到三处实现，正是最容易把它
 * 改坏的形状**，所以这里按「用户能感知到的每一条时序」逐条钉住，而不是只断言"提示出现过"。
 *
 * 单测覆盖不了这些：`aria-describedby` 的挂与摘、浮层实际锚定位置、浮层会不会吃掉它下面
 * 那颗按钮的点击、重渲染时的兜底关闭，全都发生在真实 DOM 与真实定时器里。
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

/**
 * 从「浮层还在」到「一条不剩」的退场过程，页面内单次测量
 *
 * 三条判据全部只看**状态**、不看时长：这条快路径的摘除实测只跨两帧（击键后 ≈214 毫秒行消失并
 * 切档、≈244 毫秒摘掉，中间 ≈30 毫秒），任何"我这一刻看没看见它"的断言都是在跟这两帧赛跑——
 * 本机 3/3 绿、全量套件第 18 条却输过一次。必须在页面里一次测完：跨进程逐次采样会把
 * CDP 往返算进时长。选择器与 `visibleTooltipTexts` 同源。
 *
 * - `leftoverTexts`：首次采样时仍带文案的浮层。清空文案与切档、关闭在同一次 `onUpdated` 里，
 *   还看得见旧文案就意味着这条路径根本没走（或被换成延迟关）。
 * - `notLeaving`：首次采样时可见、但**没带上 Vue 的 `*-leave-active` 类**的浮层。带上它才说明
 *   `hide()` 真的被调用了；只剩 `onBeforeUpdate` 那条 200 毫秒延迟关时，这一条在首次采样时仍
 *   停在"开着"的状态（实测稳定态类名只有 `is-dark el-tooltip`）。
 * - `animatingDurations`：其中还挂着过渡时长（`transition-duration !== 0s`）的那些。无淡出档
 *   没切上时这里是 `["0.2s"]`——EP 的 `el-fade-in-linear` 取 `--el-transition-duration-fast`
 *   = 0.2 秒（实测值；注释与文档里此前写的 300 毫秒是错的）。
 * - `goneInMs`：首次采样到「全部不可见」的毫秒数；350 毫秒内没退场则为 `null`。
 *   这个上限不是判据（判据是上面三条状态），而是测量窗口：无头指针停在的位置会在
 *   行消失的那一帧被 Chrome 重新算成"下一行那颗按钮"，400 毫秒后重新悬停计时到点、下一条提示
 *   就出现了，再往后等的量就不再是这条路径的退场时长。实测健康值 ≈30 毫秒，与 400 毫秒之间
 *   有 13 倍余量；真·不退场（`hide()` 与兜底关都没了）同样落进 `null`。
 */
const measureTipExit = (
  page: Page,
): Promise<{ leftoverTexts: string[]; notLeaving: string[]; animatingDurations: string[]; goneInMs: number | null }> =>
  page.evaluate(async () => {
    const visible = () =>
      [...document.querySelectorAll<HTMLElement>('.el-popper[role="tooltip"]')].filter(el => el.offsetParent !== null);
    const first = visible();
    const label = (el: HTMLElement) => `${(el.textContent ?? '').trim()}[${el.className}]`;
    const leftoverTexts = first.map(el => (el.textContent ?? '').trim()).filter(text => text !== '');
    const notLeaving = first.filter(el => !/-leave-active/.test(el.className)).map(label);
    const animatingDurations = first
      .map(el => getComputedStyle(el).transitionDuration)
      .filter(duration => duration !== '0s');
    const startedAt = performance.now();
    // 上限必须短于「重新悬停」的 400 毫秒，否则等到的可能是下一条提示。
    const ceilingMs = 350;
    while (performance.now() - startedAt < ceilingMs) {
      if (visible().length === 0) {
        return { leftoverTexts, notLeaving, animatingDurations, goneInMs: Math.round(performance.now() - startedAt) };
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return { leftoverTexts, notLeaving, animatingDurations, goneInMs: null };
  });

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

  test('浮层对指针透明：盖住上一行的按钮也吃不掉那次点击', async ({ optionsPage }) => {
    // `placement="top"` 决定了浮层落在触发按钮的上方，也就是上一行操作按钮那一侧：真机实测行距
    // 61 像素时压住那颗 28 像素高的按钮 11 像素（按钮中心还归按钮，所以本机不复现），行距 45 像素
    // 时压住 27 像素、`elementFromPoint(按钮中心)` 已落进浮层（runner 的 ≈42 像素是同一档）。
    // Element Plus 的浮层默认 `enterable`（参与命中测试），于是它接走了本应落在那颗按钮上的指针事件：
    // 真机表现为「指针明明停在按钮上，点了没反应」，CI 侧则是 Playwright 判「subtree intercepts
    // pointer events」后在同一点重试到超时。现在浮层带 `pointer-events: none`，这条不变量
    // 与行距、与 hide-after 和淡出时序都无关；被换掉的「移入浮层保持显示」在操作列没有可感知的
    // 价值——提示只是那颗按钮文案的复述，里面没有可点、可选中、可滚动的内容。
    const starA = operationButtons(optionsPage, ENTRY_A.username).nth(3);
    const starB = operationButtons(optionsPage, ENTRY_B.username).nth(3);
    // 哪一行在上头由排序决定，不写死：悬停下面那颗，点击上面那颗（也就是被浮层压住的那颗）
    const boxA = (await starA.boundingBox())!;
    const boxB = (await starB.boundingBox())!;
    const [upper, lower] = boxA.y < boxB.y ? ([starA, starB] as const) : ([starB, starA] as const);

    await lower.hover();
    await tooltipShows(optionsPage, 'common.favorite');

    // ① 与行距无关的那颗牙：浮层最"实"的点——它自己的中心——不允许是命中测试的落点。
    //    摘掉 popper 样式（退回可命中的 enterable 浮层）时，本地和 runner 都会在这一条红。
    const tipId = await lower.getAttribute('aria-describedby');
    expect(tipId, '浮层没有携带 aria-describedby，拿不到它的节点').toBeTruthy();
    const hit = await optionsPage.evaluate((id: string) => {
      const tip = document.getElementById(id);
      if (!tip) return { pointerEvents: 'node-missing', hitsSelf: false };
      const rect = tip.getBoundingClientRect();
      const node = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        pointerEvents: getComputedStyle(tip).pointerEvents,
        hitsSelf: Boolean(node) && (node === tip || tip.contains(node)),
      };
    }, tipId!);
    expect(hit.pointerEvents, '浮层仍在参与指针命中').toBe('none');
    expect(hit.hitsSelf, '浮层自己仍是命中测试的落点').toBe(false);

    // ② 点击层面的等价：紧凑行距（runner）下这一击正穿过浮层，本机行距宽时它只是顺带通过，
    //    真正的牙在 ①——那样写是为了「产品哪天把浮层挪出相邻行的范围」时本条不会反而变红。
    await upper.click();
    await expect(upper).toHaveAttribute('data-tip', textOf('common.unfavorite'));

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
    // 整表重渲染会连带移除触发元素，而卸载后的元素再不会有 `mouseleave`：共享实例若只剩
    // `onBeforeUpdate` 那条 200 毫秒延迟关，提示就会原地悬停；`hide()` 又只跳过 `hide-after`，
    // 淡出照样走完 200 毫秒，原位于是悬着一个空气泡。产品侧用「切无淡出过渡名 + `hide()` + 清文案」
    // 三件事一起把这段压进两帧。
    //
    // 这里因此**不断言"行没了的同一刻看不见浮层"**：真机逐帧采样（Chrome for Testing）实测
    // 击键后 ≈214 毫秒行消失、同一帧切档并清空文案，≈244 毫秒浮层才从 DOM 摘掉——Vue 的
    // `<Transition>` 在 leave 起始取不到过渡类型时也是双 `requestAnimationFrame` 之后才 `done()`，
    // 中间那 ≈30 毫秒它确实「可见且为空」。原写法是在跟这两帧赛跑：本机 3/3 绿、全量套件第 18 条
    // 却输过一次；而这一格从本波起是硬门禁（`e2e.yml` 的 `continue-on-error` 已删），
    // 这种量级的偶发红会堵住所有 PR。换成三条与帧调度无关的状态判据：文案必须已空（否则是延迟关
    // 或整条路径没走）、残留的那一条必须已经带上 `*-leave-active`（否则 `hide()` 没被调用）、
    // 且不得还挂着过渡时长（否则是淡出档，会先悬成空气泡）。最后只兜一条"终究会消失"。
    const exit = await measureTipExit(optionsPage);
    expect(exit.leftoverTexts, '行已被移除，提示却还带着文案悬在原处').toEqual([]);
    expect(exit.notLeaving, '残留的浮层没处于退场状态：`hide()` 没被调用，它会原地悬着').toEqual([]);
    expect(exit.animatingDurations, '浮层还挂着淡出：它会先在原位悬成一个空气泡再慢慢退场').toEqual([]);
    expect(exit.goneInMs, '浮层始终没有退场').not.toBeNull();

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
