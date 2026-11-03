import { expect, expectSuccessToast, openHeaderMenu, test } from './harness';
import { anchoredTextOf, textOf } from './i18n';

/**
 * 命令面板的入口能不能真的把目标界面唤出来
 *
 * 这里守的是 `entrypoints/options/App.vue` 里 `buildPaletteActions` 的**执行**这一环。
 * 已有的判据都到不了它：`tests/architecture/commandPaletteCopy.test.ts` 只做源码扫描，
 * 数的是条目数量与 14 处对外文案是否对得上，一条都不点；`useCommandPalette` 的单测在
 * Node 环境里跑，压根没有弹窗可等。于是「面板里列出了这条命令、点下去却什么也没发生」
 * 这类错误原本无人认领 —— 而它恰恰是最容易犯的一种：
 *
 * `run: replayTour` （直接写函数名）会在 setup 期抛 `Cannot access 'replayTour' before
 * initialization`。`useCommandPalette` 里的 `watch(filtered, …)` 初次求值就会跑一遍清单，
 * 而 `replayTour` 声明在清单之后约 330 行处。这种写法不是假设：清单里早于声明的 handler
 * 全部写作 `run: () => foo()`，正是为了让这条 TDZ 永远踩不到（组件的 JSDoc 记着同一件事）。
 *
 * 负对照是真实量到的，不是推的：本用例第一次跑的时候产物落后源码一版（`.output` 里还没有
 * `tour`/`about` 两条），两次都在「命中 1 条」那行红成 `Received: 0`；重新构建后才转绿。
 * 也就是说这条判据在「入口没进包 / 关键词漂了 / 执行链路断了」三种情况下都会红。
 *
 * 检索词刻意用 `about`/`tour` 这两个**语言无关的 keywords**（`keywords` 只参与匹配、不渲染，
 * 故不受 i18n 约束），而不是界面当前显示的中/英文标签：夹具不锁语言，硬编码任一侧都会在
 * 另一侧失配。命中数被钉成 1，是为了让「按 Enter 执行的是这条」不含歧义 —— 活动项恒为第 0 项。
 *
 * 每条用例各起一个全新 profile，实测约 3.5s/条；引导那条放在最后，因为 `canOpen` 在
 * `tour.isActive` 期间会拒绝再次唤起面板，跑完就不再需要面板了。
 */
test.describe('命令面板执行入口', () => {
  test('HeaderBar 的可见入口 → 打开命令面板', async ({ optionsPage: page }) => {
    await page.getByRole('button', { name: textOf('options.header.commandPaletteTitle') }).click();
    await expect(page.locator('.cp-overlay'), '可见入口没唤起命令面板').toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.cp-overlay')).toBeHidden();
  });

  test('关于 → 打开关于抽屉', async ({ optionsPage: page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.cp-overlay'), 'Ctrl+K 没唤起命令面板').toBeVisible();

    await page.locator('.cp-panel input').fill('about');
    await expect(page.locator('.cp-item'), 'about 关键词命中的不是 1 条').toHaveCount(1);

    await page.keyboard.press('Enter');
    await expect(page.locator('.cp-overlay')).toBeHidden();
    // 按文案过滤而不是 `.el-drawer` 裸取：页面里同时存在「查看详情」抽屉的节点，裸取会撞 strict mode
    await expect(page.getByRole('dialog').filter({ hasText: textOf('options.about.title') })).toBeVisible();
  });

  test('关于 → 分享给同事复制带 UTM 的产品页与商店链接', async ({ optionsPage: page }) => {
    // 「关于」自 2026-10-22 起收在头部「帮助」下拉里，不再是常驻按钮
    await openHeaderMenu(page, 'options.header.help');
    await page.getByRole('menuitem', { name: textOf('options.header.about') }).click();
    const drawer = page.getByRole('dialog').filter({ hasText: textOf('options.about.title') });
    await expect(drawer).toBeVisible();

    const review = drawer.getByRole('button', { name: textOf('options.about.review') });
    const share = drawer.getByRole('button', { name: textOf('options.about.share') });
    // 抽屉自带的关闭按钮 aria-label 也是 "Close this dialog"，非锚定匹配会同时命中两个；
    // 这里要量的是页脚那颗文字按钮，必须整串相等。
    const close = drawer.getByRole('button', { name: anchoredTextOf('common.close') });
    await expect(review).toBeVisible();
    await expect(share).toBeVisible();
    await expect(close).toBeVisible();
    /*
     * 三颗按钮的几何必须在**同一帧**里读。`el-drawer` 是滑入动画，分三次 `boundingBox()`
     * 就是三次 CDP 往返，抽屉还在往左搬，后一次量到的 x 必然比前一次小——「评价在分享左侧」
     * 会被动画本身判死（本机差 0.6 像素，CI 差 86 像素）。一次 evaluate 里的三次 rect 同属
     * 一帧，整块平移不影响它们的相对关系，因此判据与动画时刻无关。
     * 身份仍按可访问名认领（不靠 DOM 顺序下标）：页脚少渲染一颗、或顺序被调换，
     * 都必须让这条用例红，而不是拿错位后的矩形继续算「通过」。
     */
    const footer = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.about-footer .el-button')].map(el => {
        const rect = el.getBoundingClientRect();
        return {
          text: el.textContent?.trim() ?? '',
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      }),
    );
    expect(footer, '「关于」页脚不是三颗按钮').toHaveLength(3);
    const pick = (matcher: RegExp, label: string) => {
      const found = footer.find(button => matcher.test(button.text));
      expect(found, `页脚认不出「${label}」那颗按钮`).toBeDefined();
      expect(found!.width, `「${label}」量到零宽：不可见节点没有几何可谈`).toBeGreaterThan(0);
      return found!;
    };
    const reviewBox = pick(textOf('options.about.review'), '评价');
    const shareBox = pick(textOf('options.about.share'), '分享');
    const closeBox = pick(anchoredTextOf('common.close'), '关闭');
    expect(reviewBox.x + reviewBox.width, '评价入口应在分享左侧').toBeLessThanOrEqual(shareBox.x);
    expect(shareBox.x - (reviewBox.x + reviewBox.width), '评价与分享间距没有收紧').toBeLessThanOrEqual(8);
    expect(closeBox.x - (shareBox.x + shareBox.width), '分享与关闭间距没有收紧').toBeLessThanOrEqual(8);
    expect(Math.abs(closeBox.y - reviewBox.y), '三个按钮没有排在同一行').toBeLessThanOrEqual(1);

    await share.click();
    await expectSuccessToast(page, 'options.about.shareCopied');

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('liaolongdong.github.io/account-password-helper/?utm_source=about');
    expect(copied).toContain('chromewebstore.google.com');
    // 产品页与商店页各带一次 UTM，避免两条链接只有一条可归因
    expect(copied.match(/utm_source=about/g)).toHaveLength(2);
    expect(copied).toContain('utm_campaign=teammate');
    // 文案必须把「开源免费 / 安全加密 / 核心功能」三件事讲全
    expect(copied).toContain('GPL-3.0');
    expect(copied).toContain('AES-256-GCM');
    expect(copied).toContain('TOTP');
    expect(copied).toMatch(/可选自动登录|optional auto-login/i);
    expect(copied).toMatch(/个人信息库|personal info vault/i);
  });

  /**
   * 指针停在列表上连按 ↓，高亮只能往下走
   *
   * 钉的是 2026-10-22 那个「上下箭头有 bug」的根因：逐行 `@mouseenter` 直接把活动项改成
   * 指针那一行，而活动项一变就 `scrollIntoView()`——列表一滚，另一行被搬到静止的指针底下，
   * Chromium 重算 hover 并补发 `mouseenter`，游标被改回去。实测连按 ↓ 会 `4 → 3`、`5 → 4`。
   * 修法是改挂容器的 `mousemove`（滚动会补发 enter/leave，但**不会**补发 mousemove）。
   *
   * 为什么必须有这一条：`useCommandPalette` 的单测在 node 环境里跑，没有布局也没有指针；
   * 组件的源码扫描守卫只能挡「有人把 `@mouseenter` 加回去」，挡不住加回去之后到底会不会抖。
   * 这个 bug 活在 composable（索引）与组件（悬停 + 滚动）的接缝里，此前三层各管一段、缝里没人站。
   *
   * 三处前提各否掉一种假绿：`room > 0` 保证列表真的可滚；`scrolled > 0` 保证这一轮**确实滚过**
   * （不滚就复现不了本 bug，断言将是空跑）；`start + STEPS < total` 保证没走到循环回绕那一格，
   * 否则 `27 → 0` 会被读成「倒退」。落点取列表顶部而非中部：指针停在哪都行，但停得越低，
   * 起点索引越大、越容易撞上回绕。
   *
   * 刻意不用 `locator.click()` / `locator.hover()`：前者动作前会经 CDP 预滚文档（口径见
   * `dialog-scroll-isolation.spec.ts` 文件头），后者会把指针停在元素几何中心。这里要的是
   * 「指针落定后再也不动」，只有 `page.mouse.move` 与 `page.keyboard.press` 不搬指针也不滚文档。
   */
  test('指针停在列表上连按 ↓，高亮只往下走（悬停不抢键盘游标）', async ({ optionsPage: page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.cp-overlay'), 'Ctrl+K 没唤起命令面板').toBeVisible();
    // 不填关键词：只有全量清单才装得下「列表可滚」这个前提
    const list = page.locator('.cp-list');
    await expect
      .poll(() => list.evaluate(el => el.scrollHeight - el.clientHeight), {
        message: '列表没有超出可视高度，判据是空的',
      })
      .toBeGreaterThan(0);

    const box = await list.boundingBox();
    expect(box, '列表量不到位置').not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 16);

    const readActive = () =>
      list.evaluate(el => {
        const active = el.querySelector<HTMLElement>('.cp-item--active');
        return {
          index: active ? Number(active.dataset.index) : -1,
          total: el.querySelectorAll('.cp-item').length,
        };
      });

    const start = await readActive();
    expect(start.index, '指针落下之后读不到活动项').toBeGreaterThanOrEqual(0);
    const STEPS = 14;
    expect(start.index + STEPS, '起点太低都躲不开循环回绕，样本量得再收').toBeLessThan(start.total);

    const seen: number[] = [];
    for (let i = 0; i < STEPS; i++) {
      await page.keyboard.press('ArrowDown');
      seen.push((await readActive()).index);
    }

    expect(seen, '高亮出现倒退或原地不动：悬停把键盘游标抢回去了').toEqual(
      Array.from({ length: STEPS }, (_, i) => start.index + 1 + i),
    );
    // 非空跑自证：这一轮确实发生过滚动，否则上面那条断言没有触及本 bug 的触发条件
    expect(await list.evaluate(el => el.scrollTop), '列表压根没滚过，复现不了「滚到指针下」这个前提').toBeGreaterThan(
      0,
    );
  });

  test('新手引导 → 起引导层', async ({ optionsPage: page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.cp-overlay'), 'Ctrl+K 没唤起命令面板').toBeVisible();

    await page.locator('.cp-panel input').fill('tour');
    await expect(page.locator('.cp-item'), 'tour 关键词命中的不是 1 条').toHaveCount(1);

    await page.keyboard.press('Enter');
    await expect(page.locator('.cp-overlay')).toBeHidden();
    await expect(page.locator('.tour')).toBeVisible();
  });
});
