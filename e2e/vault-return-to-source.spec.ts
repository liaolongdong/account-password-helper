import type { CDPSession, Page } from '@playwright/test';

import { expect, test, verifyMasterPassword } from './harness';
import { textOf } from './i18n';
import { buttonRect, focusUntilHint, openFormPage } from './identityHintDom';
import { addIdentity, cards, closeVault, openVaultFromHeader, searchInput, vaultDialog } from './identityVaultDom';

/**
 * 身份库「回到原网页」的真机回归
 *
 * 这条链的全部价值是那一次窗口往返，全部证据也只能在真浏览器里取：来源标签页由 Service Worker
 * 从 `sender.tab` 盖章，切回是 `chrome.tabs.update` + `chrome.windows.update` 的真动作，
 * 焦点归还则由浏览器自己决定——jsdom 与源码扫描都读不到这三件事。钉六条：
 *
 * 1. **召唤与回程共用同一条深链**：从气泡点进库，复验门槛照旧拦在前面（免密通道没被开出），
 *    搜索词照旧预填，而提示条同时出现。
 * 2. **提示条只在有来源时出现**：关掉库窗再从头部按钮重开，没有这条横幅，也不带着上一次召唤的来源。
 * 3. **点下去真的切回去了，而且库窗留着**：活动标签落回来源页，弹窗不关——跨卡取值要来回跑几趟，
 *    每趟都关窗等于逼用户重开；所以同一枚按钮必须还能按第二次（幂等地切回同一个来源）。
 * 4. **焦点归还**：切回后 `document.activeElement` 仍是刚才那一格。这一条用有界轮询等焦点
 *    传播（`tabs.update` 异步，只等活动标签变了就取值会读到上一帧），红了就是 Chrome 不再
 *    恢复每标签页的焦点历史——那时该给内容脚本补一次显式 focus，而不是放宽断言。
 * 5. **发现性只点亮那枚出口按钮**：复制成功后 `identity-return-flash`（底色浅闪）与
 *    `identity-return-nudge`（箭头向左轻推）两支真的在跑。0.2s 的东西不能靠 CDP 往返采样——
 *    一次往返就吃掉几十毫秒，读到的永远是动画结束后的静止值，那条断言会恒真地绿。
 *    因此录像在页面里自己走帧。上一版那圈 4px 主题色 `box-shadow` 呼吸已被否掉，
 *    这里刻意不量它（源码侧另有判据禁它回来）。
 * 6. **`prefers-reduced-motion` 只降视觉，不降功能**：三支动画都不播、标记也不挂（否则白留一个
 *    没人看见的计时器），但出口照样切得回去、还能反复切。
 */

/** 与 `identity-hint.spec.ts` 同形状的注册页；口令框只是内容脚本已注入的同步信号 */
const FORM_HTML = `
  <p><label>真实姓名<input id="f-name" name="realname"></label></p>
  <p><label>证件号码<input id="f-id" name="idNumber"></label></p>
  <p><label>手机号码<input id="f-phone" name="mobile" type="tel"></label></p>
  <input type="password" name="unused-password">
`;

/** 合成品姓名：`idNumber` 角色的检索词走「本人姓名」通道（编号族才取字段名） */
const SELF_NAME = 'e2e-return-holder';

/** 合成品手机号：只用来证明「复制确实写进了剪贴板」，与任何真实号码无关 */
const SELF_PHONE = '13800007777';

/** 点亮的两支动画名（与组件 CSS 同源；改名要让这条用例与源码守卫一起红） */
const FLASH = 'identity-return-flash';
const NUDGE = 'identity-return-nudge';

/**
 * 录像里有没有出现过这支动画
 *
 * 只能按前缀认：`<style scoped>` 会把 `@keyframes` 名字改写成 `identity-return-flash-5ac6174d`
 * （后缀是该组件的 `data-v` 哈希），精确等值匹配永远落空——而 `not.toContain` 那一支会因此
 * 变成恒真的空跑，减动效用例看着绿、其实什么都没量。
 */
const played = (seen: string[], name: string): boolean => seen.some(animation => animation.startsWith(name));

/**
 * 真鼠标点气泡的主按钮（从身份库选择）
 *
 * 气泡在 closed shadow DOM 里，主世界只能命中到宿主，因此先按 CDP 算出按钮中心坐标、
 * 再用命中测试确认那一点确实落在扩展宿主上，然后才按下——坐标算错只会点到页面元素，
 * 红灯会伪装成「功能没反应」。
 */
async function clickBubblePrimary(page: Page, cdp: CDPSession): Promise<void> {
  const rect = await buttonRect(cdp, 'primary');
  const x = (rect.left + rect.right) / 2;
  const y = (rect.top + rect.bottom) / 2;
  const marker = await page.evaluate(
    ([px, py]) => document.elementFromPoint(px, py)?.getAttribute('data-aph') ?? '<no marker>',
    [x, y],
  );
  expect(marker, '点击坐标没有落在身份提示宿主上').toBe('identity-hint');
  await page.mouse.click(x, y);
}

/** 当前窗口里的活动标签页 URL（由扩展侧读，浏览器权威） */
async function activeTabUrl(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url ?? '';
  });
}

/** 提示条与那枚出口按钮（弹窗句柄已收窄过，只有列表弹窗里有它们） */
const returnBar = (page: Page) => vaultDialog(page).locator('.identity-return');
const returnButton = (page: Page) => returnBar(page).locator('.identity-return__action');

/** 提示条此刻生效的动画名（`none` 即入场那支没挂上） */
const animationNameOf = (page: Page): Promise<string> =>
  returnBar(page).evaluate(el => getComputedStyle(el).animationName);

/**
 * 起一段页内录像：把接下来 1.5s 里跑过的动画名记进 `window.__animSeen`
 *
 * 「没播」和「没读到」是两件事，所以量法必须在页面里自己走帧：`requestAnimationFrame` 每帧
 * 采一次 `document.getAnimations()`，测完一次性读回名单。跨进程采样只配得上秒级的东西。
 */
async function startAnimationWatch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as { __animSeen: string[] };
    store.__animSeen = [];
    const end = performance.now() + 1_500;
    const tick = (): void => {
      for (const animation of document.getAnimations()) {
        const name = (animation as unknown as { animationName?: string }).animationName;
        if (name && !store.__animSeen.includes(name)) store.__animSeen.push(name);
      }
      if (performance.now() < end) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** 读回录像里的动画名（录像自带截止，不必显式停） */
async function seenAnimations(page: Page): Promise<string[]> {
  await page.waitForTimeout(400);
  return page.evaluate(() => (window as unknown as { __animSeen: string[] }).__animSeen);
}

/** 复制卡片里那条手机号：走既有的逐字段复制按钮，不碰内部状态，并读回剪贴板坐实成功 */
async function copyPhoneField(page: Page): Promise<void> {
  await cards(page)
    .first()
    .getByRole('button', { name: textOf('common.copy') })
    .first()
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()), { message: '复制没落进剪贴板' })
    .toContain(SELF_PHONE);
}

/**
 * 走完「页面召唤 → 复验 → 库打开」这一段，返回站点页与提示条句柄
 *
 * 两条用例只差后面量什么（一条量点亮与往返，一条在 reduced-motion 下量降级），
 * 前置这九步写两遍就意味着改一处要记得改两处——而它任何一步漂了都会让两条一起红。
 */
async function summonVault(extContext: Parameters<typeof openFormPage>[0], optionsPage: Page, pathName: string) {
  const { page: site, cdp } = await openFormPage(extContext, `<body>${FORM_HTML}</body>`, pathName);
  await site.waitForSelector('input[data-aph-password]', { state: 'attached', timeout: 15_000 });
  await site.locator('#f-name').fill(SELF_NAME);

  // 等提示出现后再点：内容脚本按 document_idle 注入，焦点事件是一次性的
  await focusUntilHint(cdp, site, 'f-id');
  await clickBubblePrimary(site, cdp);

  // 深链落到管理页：复验门槛仍排在开库之前（三档策略的第一次打开必问）
  await verifyMasterPassword(optionsPage, 'identity.verifyPrompt');
  await expect(vaultDialog(optionsPage)).toBeVisible();
  // 召唤本身没被回程改动带坏：检索词照旧按角色通道预填（`idNumber` 取本人姓名）
  await expect(searchInput(optionsPage)).toHaveValue(SELF_NAME);

  const bar = returnBar(optionsPage);
  await expect(bar).toBeVisible();
  // 点名来源站点：这枚按钮会切换标签页，说清它把人送去哪儿才算可预期
  await expect(bar).toContainText('site-rules.e2e.test');
  return { site, bar };
}

test('从页面召唤进库取完值，一键回到刚才那一格（点亮只在那枚按钮上）', async ({ extContext, optionsPage }) => {
  const { site, bar } = await summonVault(extContext, optionsPage, '/vault-return');

  // 入场那支挂在提示条上（读浏览器算出来的值，不读源码声明）
  expect(await animationNameOf(optionsPage)).toContain('identity-return-in');
  // 静态那条腿：主题色文字按钮 + 返回图标。刻意不是实心主按钮——工具栏已经有一颗「添加」在抢焦点
  const backButton = returnButton(optionsPage);
  await expect(backButton).toHaveClass(/is-link/);
  expect(await backButton.getAttribute('class'), '回程按钮又变回实心主按钮').not.toContain('el-button--primary');
  await expect(backButton.locator('svg')).toBeVisible();
  const shotBox = await bar.boundingBox();
  if (shotBox) {
    await optionsPage.screenshot({
      path: '.e2e-visual/vault-return-bar.png',
      clip: { x: shotBox.x - 10, y: shotBox.y - 8, width: shotBox.width + 20, height: shotBox.height + 16 },
    });
  }

  // 点亮挂在一个真实时刻上：录下复制之后那一段里跑过的动画
  await addIdentity(optionsPage, SELF_NAME, SELF_PHONE);
  await expect(cards(optionsPage)).toHaveCount(1);
  await startAnimationWatch(optionsPage);
  await copyPhoneField(optionsPage);
  const seen = await seenAnimations(optionsPage);
  expect(played(seen, FLASH), `复制成功后没点亮出口按钮（这段时间里跑过：${seen.join(' | ') || '<无>'}）`).toBe(true);
  expect(played(seen, NUDGE), '点亮只剩底色、箭头没推：读起来像背景闪了一下').toBe(true);
  // 0.2s 之后标记必须自摘：留着会让下一次复制接不上，也说明 CSS 与计时器脱了钩
  await expect(bar).not.toHaveClass(/is-pulse/, { timeout: 2_000 });

  // 切回去：活动标签落回来源页——但库窗不关，跨卡取值还要用
  await backButton.click();
  await expect
    .poll(() => activeTabUrl(optionsPage), { message: '点「回到原网页」后活动标签没切回来源页' })
    .toContain('/vault-return');
  await expect(vaultDialog(optionsPage)).toBeVisible();
  await expect(returnBar(optionsPage)).toBeVisible();

  // 焦点归还：`tabs.update` 是异步的，上一行只等到「活动标签变了」，不等焦点传播；
  // 有界轮询把这段竞态收掉。实测 Chrome 会恢复每个标签页的焦点历史，所以内容脚本没有
  // 补第二次显式 focus——这条红了说明那个前提没了，修法是给来源框补一次 focus（属行为
  // 变化，需先确认），而不是放宽断言。
  await expect
    .poll(() => site.evaluate(() => document.activeElement?.id ?? '<none>'), {
      message: '切回后焦点没落回刚才那一格',
      timeout: 3_000,
    })
    .toBe('f-id');

  // 同一枚按钮还能再按：回程是幂等动作，不是一次性消耗品
  await optionsPage.bringToFront();
  await returnButton(optionsPage).click();
  await expect
    .poll(() => activeTabUrl(optionsPage), { message: '第二次回程失效：意图被第一次用掉了' })
    .toContain('/vault-return');

  // 关掉库窗再从头部重开：横幅不该跟着回来，检索词也不该留着上一次召唤的那一句
  await optionsPage.bringToFront();
  await closeVault(optionsPage);
  await openVaultFromHeader(optionsPage, false);
  await expect(vaultDialog(optionsPage)).toBeVisible();
  await expect(returnBar(optionsPage)).toHaveCount(0);
  await expect(searchInput(optionsPage)).toHaveValue('');
  await closeVault(optionsPage);
});

test('reduced-motion 下三支动画都不播，但回程出口照样能用', async ({ extContext, optionsPage }) => {
  await optionsPage.emulateMedia({ reducedMotion: 'reduce' });
  const { bar } = await summonVault(extContext, optionsPage, '/vault-return-reduced');

  expect(await animationNameOf(optionsPage), 'reduced-motion 下入场动画仍在播').toBe('none');

  await addIdentity(optionsPage, SELF_NAME, SELF_PHONE);
  await startAnimationWatch(optionsPage);
  await copyPhoneField(optionsPage);
  const seen = await seenAnimations(optionsPage);
  expect(played(seen, FLASH), `reduced-motion 下仍播了点亮：${seen.join(' | ')}`).toBe(false);
  expect(played(seen, NUDGE), 'reduced-motion 下仍播了箭头轻推').toBe(false);
  // 标记也不该挂：CSS 已经把它渲染成无，挂上只是白留一个没人看见的计时器
  await expect(bar, 'reduced-motion 下复制成功仍给提示条挂了点亮标记').not.toHaveClass(/is-pulse/);

  // 功能一字不折：静态线索（主题色文字 + 图标 + 点名站点）撑起发现性，点下去照样切回去
  await expect(returnButton(optionsPage)).toHaveClass(/is-link/);
  await returnButton(optionsPage).click();
  await expect
    .poll(() => activeTabUrl(optionsPage), { message: 'reduced-motion 下回程按钮失效' })
    .toContain('/vault-return-reduced');
});
