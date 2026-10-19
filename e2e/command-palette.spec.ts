import { expect, expectSuccessToast, test } from './harness';
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
 * 两条用例各起一个全新 profile，实测 3.5s/条；引导那条放在最后，因为 `canOpen` 在
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
    await page.getByRole('button', { name: textOf('options.header.about') }).click();
    const drawer = page.getByRole('dialog').filter({ hasText: textOf('options.about.title') });
    await expect(drawer).toBeVisible();

    const review = drawer.getByRole('button', { name: textOf('options.about.review') });
    const share = drawer.getByRole('button', { name: textOf('options.about.share') });
    // 抽屉自带的关闭按钮 aria-label 也是 "Close this dialog"，非锚定匹配会同时命中两个；
    // 这里要量的是页脚那颗 small 按钮，必须整串相等。
    const close = drawer.getByRole('button', { name: anchoredTextOf('common.close') });
    await expect(review).toBeVisible();
    const reviewBox = await review.boundingBox();
    const shareBox = await share.boundingBox();
    const closeBox = await close.boundingBox();
    expect(reviewBox, '评价按钮没有可测尺寸').not.toBeNull();
    expect(shareBox, '分享按钮没有可测尺寸').not.toBeNull();
    expect(closeBox, '关闭按钮没有可测尺寸').not.toBeNull();
    expect(reviewBox!.x + reviewBox!.width, '评价入口应在分享左侧').toBeLessThanOrEqual(shareBox!.x);
    expect(shareBox!.x - (reviewBox!.x + reviewBox!.width), '评价与分享间距没有收紧').toBeLessThanOrEqual(8);
    expect(closeBox!.x - (shareBox!.x + shareBox!.width), '分享与关闭间距没有收紧').toBeLessThanOrEqual(8);
    expect(Math.abs(closeBox!.y - reviewBox!.y), '三个按钮没有排在同一行').toBeLessThanOrEqual(1);

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
