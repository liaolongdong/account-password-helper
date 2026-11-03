import type { CDPSession, Page } from '@playwright/test';

import { expect, onboardAndUnlock, test, verifyMasterPassword } from './harness';
import { liteExactMatch, liteTextOf, templatedOf, textOf } from './i18n';
import { STORAGE_KEYS } from '../utils/storageKeys';
import {
  blurUntilGone,
  bubbleCount,
  bubbleRect,
  bubbleText,
  buttonRect,
  focusUntilHint,
  openFormPage,
  refocus,
  roleText,
} from './identityHintDom';
import {
  addIdentity,
  cards,
  closeVault,
  openVaultFromHeader,
  searchInput,
  vaultDialog,
  verifyDialog,
} from './identityVaultDom';

/**
 * 页面个人信息字段提示的真机回归
 *
 * 单测（`tests/content/piiClassifier.test.ts`、`identityHint.test.ts`、`formDetector.identityHint.test.ts`）
 * 钉得住判定与接线，但下面三件事只有「真 Chrome + 已加载的扩展」才证得了：
 *
 * 1. **Closed Shadow DOM 真的是 closed**：页面脚本拿不到 `shadowRoot`，宿主的光 DOM 里一个内容节点
 *    都没有。气泡文本一律经 CDP 的 pierce 视图（`DOM.getDocument({pierce:true})`）读取——这同时证明
 *    测试没有在产品代码里留任何测试专用后门。
 * 2. **几何与层叠**：锚在字段下缘、下方放不下才翻到上方、滚动后继续跟随，且与页面自绘的
 *    `z-index: 2147483647` 全屏遮罩同档时仍压在遮罩之上、点得到。
 * 3. **跨入口只流两个标签**：气泡里不出现字段值；深链交给选项页的是「角色 + 一个可选的筛选词」，
 *    而那个词只可能来自同表单里判定为**本人姓名**的那一框。其余字段的值既不进气泡、不进选项页、
 *    不落盘，也不会被写回页面。这些只在真浏览器里有意义——链路另一端是 Service Worker 与选项页，
 *    jsdom 里根本没有那两侧。
 *
 * 焦点事件是一次性的：内容脚本按 `document_idle` 注入，脚本晚到就没人接住那一次 `focusin`。
 * 因此「等气泡出现」写成**反复聚焦直到读到**，而不是「聚焦一次然后等」。
 */

/** 合成值：只用来证明它没有出现在任何出口，与任何真实凭据无关 */
const CANARY = 'e2e-canary-3f9a';

/** 气泡与字段的间距（`IdentityHint.ts` 的 `GAP`，几何断言的唯一口径） */
const GAP = 6;

/**
 * 几何判据按 1px 容差比
 *
 * 两个读数来自两套量具：字段边缘取主世界的 `getBoundingClientRect`（小数），气泡盒模型取
 * CDP 的 `DOM.getBoxModel`（整数化）。实测差值出现过 `6.5`，写死 `toBeCloseTo(GAP, 0)`
 * （容差 0.5）会在翻转档判红——差半像素不是「锚点没锚准」，是量具精度地板。
 */
function withinPixel(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
}

/** 注册页形状的一组个人信息字段（都带 id，便于逐字段聚焦） */
const FORM_HTML = `
  <p><label>真实姓名<input id="f-name" name="realname"></label></p>
  <p><label>证件号码<input id="f-id" name="idNumber"></label></p>
  <p><label>手机号码<input id="f-phone" name="mobile" type="tel"></label></p>
  <p><label>备注<input id="f-remark" name="remark"></label></p>
`;

/**
 * 命中测试：视口坐标处页面能精确到的最上层元素带哪个 `data-aph` 标记
 *
 * shadow 内容对主世界不可见，`elementFromPoint` 会 retarget 到宿主——这恰好是本功能想要的读数：
 * 命中的是「扩展注入的那一枚」还是「页面的遮罩/别的东西」。真鼠标按下之前必须先过这一关，
 * 否则坐标算错只会点到页面元素上，测试红得毫无线索。
 */
function topAt(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(
    ([px, py]) => document.elementFromPoint(px, py)?.getAttribute('data-aph') ?? '<no marker>',
    [x, y],
  );
}

/** 页面里某个元素的上沿/下沿视口坐标（与气泡矩形同一坐标系，用来量「谁在谁下面」） */
const fieldEdge = (page: Page, id: string, edge: 'top' | 'bottom'): Promise<number> =>
  page.evaluate(([targetId, side]) => document.getElementById(targetId)?.getBoundingClientRect()[side] ?? -1, [
    id,
    edge,
  ] as const);

/** 真鼠标点某个按钮的中心：先命中测试确认坐标落在扩展宿主上，再按下 */
async function clickButton(page: Page, cdp: CDPSession, variant: 'ghost' | 'primary'): Promise<void> {
  const rect = await buttonRect(cdp, variant);
  const point = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  expect(await topAt(page, point.x, point.y)).toBe('identity-hint');
  await page.mouse.click(point.x, point.y);
}

test('会话失效时同页收起且不再出气泡；解锁后恢复', async ({ extContext, optionsPage }) => {
  // 多放一个口令框：`data-aph-password` 是内容脚本已注入的同步信号，
  // 否则「脚本还没到」会被误判成「门禁生效」
  const { page, cdp } = await openFormPage(
    extContext,
    `<body>${FORM_HTML}<input type="password" name="unused-password"></body>`,
    '/identity-hint-session',
  );
  await page.waitForSelector('input[data-aph-password]', { state: 'attached', timeout: 15_000 });

  // 先证明解锁态本来能出气泡：内容脚本已注入、角色识别正常
  await focusUntilHint(cdp, page, 'f-id');

  // 锁定：只删会话键、保留主密码配置。同一内容脚本内的会话镜像必须随 storage 变化失效
  await optionsPage.evaluate(
    async keys => chrome.storage.local.remove(keys),
    ['session_wrapped_data_key', 'session_wrap_key', 'session_password_expiry'],
  );
  await expect.poll(() => bubbleCount(cdp), { message: '锁定后屏上的气泡没有收起' }).toBe(0);

  await refocus(page, 'f-id');
  await page.waitForTimeout(800);
  expect(await bubbleCount(cdp), '锁定态仍出了身份提示').toBe(0);

  // 解锁后同一页恢复：新会话键写入，存储监听让内容脚本重新读取
  await optionsPage.reload({ waitUntil: 'domcontentloaded' });
  await onboardAndUnlock(optionsPage);
  await focusUntilHint(cdp, page, 'f-id');

  await page.close();
});

test('气泡只报角色：值不进内容，页面脚本也读不到 shadow 里的东西', async ({
  extContext,
  optionsPage: _optionsPage,
}) => {
  const { page, cdp } = await openFormPage(extContext, `<body>${FORM_HTML}</body>`);

  await page.evaluate(value => {
    (document.getElementById('f-name') as HTMLInputElement).value = value;
  }, CANARY);

  await focusUntilHint(cdp, page, 'f-name');

  expect(await bubbleText(cdp)).toMatch(liteTextOf('cs.identity.hintTitle'));
  expect(await bubbleText(cdp), '字段值出现在了气泡里').not.toContain(CANARY);
  const gateRole = await roleText(cdp);
  expect(liteExactMatch('cs.identity.role.name', gateRole), `角色词报成了「${gateRole}」`).toBe(true);

  // closed：主世界拿不到 shadowRoot，宿主的光 DOM 里也没有任何内容节点。
  // 不断言宿主 outerHTML 为空串——主题令牌是内联写进宿主 style 属性的，那里本就有内容。
  const hostView = await page.evaluate(() => {
    const host = document.querySelector('[data-aph="identity-hint"]') as HTMLElement | null;
    return { exists: !!host, shadow: host?.shadowRoot ?? null, lightChildren: host?.childNodes.length ?? -1 };
  });
  expect(hostView).toEqual({ exists: true, shadow: null, lightChildren: 0 });

  await page.close();
});

test('非登录形态的手机号框照样出提示：让位只给快速填充真正认领的字段', async ({
  extContext,
  optionsPage: _optionsPage,
}) => {
  const { page, cdp } = await openFormPage(extContext, `<body>${FORM_HTML}</body>`);

  await focusUntilHint(cdp, page, 'f-phone');

  const phoneRole = await roleText(cdp);
  expect(liteExactMatch('cs.identity.role.phone', phoneRole), `角色词报成了「${phoneRole}」`).toBe(true);
  // 手机号属「本人且常用」档：不该带核对提示
  expect(await bubbleText(cdp)).not.toMatch(liteTextOf('cs.identity.hintVerify'));

  await page.close();
});

test('地址表单四档各报其角色：中英标签同页并存也不串味', async ({ extContext, optionsPage: _optionsPage }) => {
  // `region` / `postal` / `address` / `org` 是地址表单里最容易互相误判的四档，也是此前只有夹具级证据的三档。
  // 中英两套标签同页并存：分类器的词典是双语的，而气泡用词由扩展自身的界面语言决定，
  // 两个方向必须各自咬住自己的角色。页面语言 ≠ 气泡语言，所以判据只认「这两个候选词之一」。
  const { page, cdp } = await openFormPage(
    extContext,
    `<body>
      <form>
        <p><label>所在地区<input id="r-zh" name="region"></label></p>
        <p><label>详细地址<input id="a-zh" name="address"></label></p>
        <p><label>邮政编码<input id="p-zh" name="zip"></label></p>
        <p><label>单位名称<input id="o-zh" name="company"></label></p>
      </form>
      <form>
        <p><label>State / Province<input id="r-en" name="region"></label></p>
        <p><label>Street address<input id="a-en" name="address"></label></p>
        <p><label>ZIP code<input id="p-en" name="zip"></label></p>
        <p><label>Organization<input id="o-en" name="organization"></label></p>
      </form>
    </body>`,
  );

  const cases = [
    ['r-zh', 'cs.identity.role.region'],
    ['a-zh', 'cs.identity.role.address'],
    ['p-zh', 'cs.identity.role.postal'],
    ['o-zh', 'cs.identity.role.org'],
    ['r-en', 'cs.identity.role.region'],
    ['a-en', 'cs.identity.role.address'],
    ['p-en', 'cs.identity.role.postal'],
    ['o-en', 'cs.identity.role.org'],
  ] as const;

  const seen: string[] = [];
  for (const [id, roleKey] of cases) {
    await focusUntilHint(cdp, page, id);
    const role = await roleText(cdp);
    expect(liteExactMatch(roleKey, role), `#${id} 报成了别的角色「${role}」`).toBe(true);
    seen.push(role);
  }
  // 逐条判据在中英两侧各只允许两个候选词，串味有可能躲过它们（例如把「地区」报成地址的另一种说法）；
  // 这一句按「四档必须报出四个互不相同的词」再兜一层，同页同语言下串味会在这里现形。
  expect(new Set(seen).size).toBe(4);

  await page.close();
});

test('四条收起路径：失焦、Esc、点「收起」、走到无语义字段', async ({ extContext, optionsPage: _optionsPage }) => {
  const { page, cdp } = await openFormPage(extContext, `<body>${FORM_HTML}</body>`);

  await focusUntilHint(cdp, page, 'f-name');
  await blurUntilGone(page, cdp, 'f-name');

  await focusUntilHint(cdp, page, 'f-name');
  await page.keyboard.press('Escape');
  await expect.poll(() => bubbleCount(cdp), { message: 'Esc 后气泡没收起' }).toBe(0);

  await focusUntilHint(cdp, page, 'f-name');
  await clickButton(page, cdp, 'ghost');
  await expect.poll(() => bubbleCount(cdp), { message: '点「收起」后气泡没收起' }).toBe(0);

  // 按下不该把焦点从字段上抢走。这条才是「点收起」那步有牙的判据：默认动作一旦没被
  // `pointerdown/mousedown` 的 preventDefault 挡掉，focusout 会让气泡在 click 落地前就收掉，
  // 上面那句「气泡数是 0」照样成立——只有读焦点才分得清是按钮生效还是被 blur 抢先。
  await focusUntilHint(cdp, page, 'f-name');
  await clickButton(page, cdp, 'ghost');
  expect(await page.evaluate(() => document.activeElement?.id ?? null)).toBe('f-name');

  // 走到没有身份语义的字段上，上一枚必须跟着收（Tab 走过一串无关框不留残影）
  await focusUntilHint(cdp, page, 'f-name');
  await page.evaluate(() => (document.getElementById('f-remark') as HTMLElement).focus());
  await expect.poll(() => bubbleCount(cdp), { message: '移到无语义字段后残影没收' }).toBe(0);

  await page.close();
});

test('锚定下缘、跟随滚动、贴底翻上方，证件号档额外带核对提示', async ({ extContext, optionsPage: _optionsPage }) => {
  // 上下都留缓冲：①② 需要「下方放得下」的常规档，④ 需要「下方放不下」的翻转档，
  // 两种形态各用滚动量构造出来，不依赖某个固定像素布局碰巧落在哪一侧。
  const { page, cdp } = await openFormPage(
    extContext,
    `<body style="margin:0">
      <div style="height:200px"></div>
      <p><label>真实姓名<input id="f-name" name="realname"></label></p>
      <div style="height:900px"></div>
      <p><label>证件号码<input id="f-id" name="idNumber"></label></p>
      <div style="height:400px"></div>
    </body>`,
  );

  // ① 常规档：气泡顶边贴在字段下缘下方 GAP 处
  await focusUntilHint(cdp, page, 'f-name');
  const gapBelow = async (): Promise<number> =>
    (await bubbleRect(cdp)).top - (await fieldEdge(page, 'f-name', 'bottom'));
  withinPixel(await gapBelow(), GAP);

  // ② 跟随滚动：字段上移 120px，气泡必须一起上移，而不是钉在原地
  const topBefore = (await bubbleRect(cdp)).top;
  await page.evaluate(() => window.scrollBy(0, 120));
  await expect
    .poll(async () => Math.abs((await gapBelow()) - GAP), { message: '滚动后气泡与字段的间距没保持' })
    .toBeLessThanOrEqual(1);
  withinPixel((await bubbleRect(cdp)).top, topBefore - 120);

  // ③ 滚动只动布局、不动焦点：气泡绑的是原来那个字段
  expect(await page.evaluate(() => document.activeElement?.id ?? null)).toBe('f-name');

  // ④ 翻转档：把证件号框滚到「下方只剩 40px」，此时下方放不下，只能翻到字段上方
  await page.evaluate(() => {
    const el = document.getElementById('f-id') as HTMLElement;
    window.scrollBy(0, el.getBoundingClientRect().bottom - window.innerHeight + 40);
  });
  await focusUntilHint(cdp, page, 'f-id');
  expect(await bubbleText(cdp)).toMatch(liteTextOf('cs.identity.hintVerify'));

  const idTop = await fieldEdge(page, 'f-id', 'top');
  const flipped = await bubbleRect(cdp);
  expect(flipped.bottom).toBeLessThanOrEqual(idTop);
  withinPixel(idTop - flipped.bottom, GAP);

  await page.close();
});

test('与页面同款最高层级遮罩同屏：提示压在遮罩之上、点得到，且事件不外溢', async ({
  extContext,
  optionsPage: _optionsPage,
}) => {
  const { page, cdp } = await openFormPage(
    extContext,
    `<body style="margin:0">
      <div id="mask" style="position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.5)"></div>
      <p><label>真实姓名<input id="f-name" name="realname"></label></p>
    </body>`,
  );

  await focusUntilHint(cdp, page, 'f-name');
  const rect = await bubbleRect(cdp);
  const center = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };

  // 遮罩同为 z-index 上限：宿主是 documentElement 的最后一个子节点，必须压在它之上
  expect(await topAt(page, center.x, center.y)).toBe('identity-hint');
  // 反向对照：同一坐标系里气泡之外的一处仍是页面元素，证明上一句不是「整页都命中宿主」
  expect(await topAt(page, 5, 5)).not.toBe('identity-hint');

  // 事件隔离：注入子树里的点击冒泡到宿主即被终结，页面挂在 document 上的「点外部关闭」收不到
  await page.evaluate(() => {
    const counter = window as unknown as { __aphDocClicks: number };
    counter.__aphDocClicks = 0;
    document.addEventListener('click', () => {
      counter.__aphDocClicks += 1;
    });
  });
  await page.evaluate(() => document.querySelector<HTMLElement>('[data-aph="identity-hint"]')?.click());
  expect(await page.evaluate(() => (window as unknown as { __aphDocClicks: number }).__aphDocClicks)).toBe(0);
  // 正向对照：同一套计数在页面自己的字段上会涨，说明那个 0 是隔离的结果，不是根本没人监听
  await page.evaluate(() => (document.getElementById('f-name') as HTMLElement).click());
  expect(await page.evaluate(() => (window as unknown as { __aphDocClicks: number }).__aphDocClicks)).toBe(1);

  await page.close();
});

test('总闸关掉时屏上那枚当场收起且不再出提示，拨回来立刻恢复', async ({
  extContext,
  extensionId,
  optionsPage: _optionsPage,
}) => {
  // 顺序是「开 → 关 → 开」：中间那次读数只有夹在两次能出提示的读数之间，才证得清是总闸在起作用，
  // 而不是内容脚本压根没注入。判据数的是气泡而不是宿主——宿主是常驻单例，收起只清内容。
  const { page, cdp } = await openFormPage(extContext, `<body>${FORM_HTML}</body>`);

  const configPage = await extContext.newPage();
  await configPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
  const setGate = (enabled: boolean): Promise<unknown> =>
    configPage.evaluate(async args => chrome.storage.local.set({ [args.key]: { identityHintEnabled: args.enabled } }), {
      key: STORAGE_KEYS.FLOATING_BUTTON_CONFIG,
      enabled,
    });

  // 关闸发生在**气泡可见的那一刻**：失焦收起由另一条用例负责，这里要验的是别处拨闸不需要用户
  // 先点一下别处或刷新页面——管理页与侧边栏的偏好设置弹窗都在另一个上下文里写这份配置。
  await focusUntilHint(cdp, page, 'f-name');

  // `set` 的 Promise 只覆盖写入方那侧，跨上下文广播还要再落一帧；不等这一帧，读到的 0
  // 可能只是「监听器还没跑到」，而不是「总闸关着」。这一帧只给关闸那一次拨动等，
  // 之后每次聚焦都立刻读数（气泡是同步建起来的，再睡只会把 90s 用例预算吃光）。
  await setGate(false);
  await expect.poll(() => bubbleCount(cdp), { message: '关闸后屏上那枚气泡没收起来' }).toBe(0);
  await refocus(page, 'f-id');
  expect(await bubbleCount(cdp)).toBe(0);
  await refocus(page, 'f-phone');
  expect(await bubbleCount(cdp)).toBe(0);

  await setGate(true);
  await page.waitForTimeout(400);
  await focusUntilHint(cdp, page, 'f-id');

  await page.close();
  await configPage.close();
});

test('深链「从身份库选择」：过复验门槛打开身份库，档位停在「全部」，值不跨界', async ({ extContext, optionsPage }) => {
  const { page, cdp } = await openFormPage(extContext, `<body>${FORM_HTML}</body>`);

  await focusUntilHint(cdp, page, 'f-id');
  // 给证件号框塞一个合成值：这条用例要证的恰恰是它哪儿都不去
  await page.evaluate(value => {
    const el = document.getElementById('f-id') as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, CANARY);

  await clickButton(page, cdp, 'primary');

  // 门槛只有选项页这一处：默认档 perSession 的第一次打开必问主密码
  await verifyMasterPassword(optionsPage, 'identity.verifyPrompt');
  await expect(vaultDialog(optionsPage)).toBeVisible();

  // 档位停在「全部」：一条身份条目同时携带证件号、手机号等多个值，按页面角色预选类别
  // 会把该命中的条目筛出视野（2026-10-17 改判，见 `identityHintWiring.test.ts` 头注第 3 条）
  await expect(optionsPage.locator('.identity-toolbar__filter .is-active')).toHaveText(textOf('identity.filter.all'));

  // 姓名框留空 ⇒ 这条深链不带任何预填：搜索框必须是空的，而不是「没筛」被读成「筛成空」
  await expect(searchInput(optionsPage)).toHaveValue('');

  // 动作落地即收起：气泡不能挡着用户回到表单
  await expect.poll(() => bubbleCount(cdp), { message: '深链后气泡没收起' }).toBe(0);

  // 零明文跨界：选项页的可见文本里没有那个合成值，整份 storage 里也没有。
  // 只把布尔值带回测试进程——`get(null)` 会含整包密文，绝不能当断言消息打出去。
  expect(await optionsPage.evaluate(() => document.body.innerText), '字段值出现在选项页可见文本里').not.toContain(
    CANARY,
  );
  expect(
    await optionsPage.evaluate(
      async needle => JSON.stringify(await chrome.storage.local.get(null)).includes(needle),
      CANARY,
    ),
    '字段值落盘了',
  ).toBe(false);
  // 本功能不填充：页面里的值必须还是用户自己填进去的那串
  expect(await page.evaluate(() => (document.getElementById('f-id') as HTMLInputElement).value), '页面被改写').toBe(
    CANARY,
  );

  await page.close();
});

/**
 * 姓名通道（唯一那条明文出口）的真机面
 *
 * 上面那条把姓名框留空，证的是「没姓名 ⇒ 载荷缺席」；这一条把姓名打上，证的是
 * 「有姓名 ⇒ 它真的落进库的搜索框并把列表收敛到那一个人」。两段合起来才钉得住
 * `{keyword?}` 这个契约——单测（`tests/content/identityHint.test.ts` 与
 * `tests/background/senderValidation.test.ts`）钉的是消息形状，落进 Element Plus 输入框
 * 并即时驱动 `filteredRows` 这一段只有真页面能看到。
 *
 * 点的字段仍是**手机号**，但理由换了：改判前点证件号框会把类别筛到「证件」，卡片数为 0
 * 既可能是筛对也可能是姓名通道没接通；现在档位恒为「全部」，那副歧义不复存在，卡片数 1
 * 只可能来自姓名筛选。下面那条 `.is-active` 断言反过来钉住「没有偷偷按角色预选」。
 */
test('深链带筛选词：点「从身份库选择」时把本人姓名框的值送进库的搜索框，其余字段的值照旧不跨界', async ({
  extContext,
  optionsPage,
}) => {
  // 合成品：ASCII 姓名互不为子串，命中判定才有唯一读数，与任何真实人名无关
  const SELF_NAME = 'e2e-self-name';
  const OTHER_NAME = 'e2e-other-person';

  // 前置：库里两条「个人信息」档的身份。这一趟是本文档会话第一次开库 ⇒ perSession 必问
  await openVaultFromHeader(optionsPage, true);
  await addIdentity(optionsPage, SELF_NAME, '13800002222');
  await addIdentity(optionsPage, OTHER_NAME, '13900003333');
  await expect(cards(optionsPage)).toHaveCount(2);
  await closeVault(optionsPage);

  const { page, cdp } = await openFormPage(extContext, `<body>${FORM_HTML}</body>`);
  await page.locator('#f-name').fill(SELF_NAME);
  await page.locator('#f-phone').fill(CANARY);

  await focusUntilHint(cdp, page, 'f-phone');
  await clickButton(page, cdp, 'primary');

  // 第二趟：本会话已复验过，不该再问。判据顺序仍是**先等库可见**——复验若弹，库被挡在它后面，
  // 这一句就超时判红；反过来先断言「复验层不在」是恒真，点菜单那步并不等任何弹窗落地。
  await expect(vaultDialog(optionsPage)).toBeVisible();
  await expect(verifyDialog(optionsPage)).toBeHidden();

  await expect(searchInput(optionsPage)).toHaveValue(SELF_NAME);
  await expect(cards(optionsPage)).toHaveCount(1);
  await expect(cards(optionsPage).first()).toContainText(SELF_NAME);
  await expect(vaultDialog(optionsPage).locator('.identity-selectbar__matched')).toContainText(
    templatedOf('identity.matchCount', { count: 1 }),
  );
  // 档位停在「全部」：姓名只作检索词，不替用户决定「这条身份属于哪一档」
  await expect(optionsPage.locator('.identity-toolbar__filter .is-active')).toHaveText(textOf('identity.filter.all'));

  await expect.poll(() => bubbleCount(cdp), { message: '深链后气泡没收起' }).toBe(0);

  // 边界照旧：除姓名那一路之外，别的字段值哪儿都不去，页面也没被回填
  const optionsText = await optionsPage.evaluate(() => document.body.innerText);
  expect(optionsText, '其它字段的值出现在选项页可见文本里').not.toContain(CANARY);
  expect(optionsText, '没命中的那条身份的名字也出现在页面上').not.toContain(OTHER_NAME);
  // 只把布尔值带回测试进程——`get(null)` 含整包密文，绝不能当断言消息打出去
  const atRest = (needle: string): Promise<boolean> =>
    optionsPage.evaluate(async value => JSON.stringify(await chrome.storage.local.get(null)).includes(value), needle);
  expect(await atRest(CANARY), '字段值落盘了').toBe(false);
  expect(await atRest(SELF_NAME), '姓名筛选词落盘了').toBe(false);
  expect(await page.evaluate(() => (document.getElementById('f-phone') as HTMLInputElement).value), '页面被改写').toBe(
    CANARY,
  );
  expect(await page.evaluate(() => (document.getElementById('f-name') as HTMLInputElement).value), '页面被改写').toBe(
    SELF_NAME,
  );

  // 一次性：关闭即由 teardown 清掉明文搜索词，下一轮从菜单进来必须回到全量列表
  // （这一句同时把「姓名只活在搜索框这一层」钉成可验收的动作，而不是注释里的承诺）
  await closeVault(optionsPage);
  await openVaultFromHeader(optionsPage, false);
  await expect(searchInput(optionsPage)).toHaveValue('');
  await expect(cards(optionsPage)).toHaveCount(2);

  await page.close();
});

/**
 * 编号族那一格：深链带过去的是**这一格叫什么**，不是这一框自己的值
 *
 * 上面那条证的是取值分派器的姓名支，这一条证的是另一支：`serialNumber` 这类「库里没有那一格」的角色
 * 带过去的必须是标签文字——用户在身份里存的是自拟的自定义字段，把本人姓名送过去在那一格搜不出任何东西。
 * 页面只摆这一枚编号框（不带姓名框），是为了让「分派走错支」也读得出红：姓名支在那儿取不到值，
 * 载荷会整体缺席、搜索框恒空，正好与「字段名那支断了」同样判红，两种走错都躲不过去。
 *
 * 卡片数 0 是本趟的预期读数（没有种带「学历证书编号」那格的记录），它反向钉住检索词**真的跨过了进程**：
 * 载荷若在后台被丢、或被收成空串键，搜索框都是空的而不是这一串。「字段名与字段值都在检索面里」
 * 那一半住在 `tests/composables/useIdentityVault.test.ts`，真机这一侧不重复种自定义字段（编辑器要多三步，
 * 而那半边的判定与 Element Plus 无关）。
 */
test('深链带字段名：编号族那一格点「从身份库选择」时，落进库的搜索框的是标签文字而不是它自己的值', async ({
  extContext,
  optionsPage,
}) => {
  const FIELD_LABEL = '学历证书编号';

  // 前置：先经菜单开一次库（本会话第一次 ⇒ 必问复验），顺带种两条身份，
  // 于是「卡片 0」只可能是被字段名筛掉的，而不是库本来就空
  await openVaultFromHeader(optionsPage, true);
  await addIdentity(optionsPage, 'e2e-vault-holder-a', '13800004444');
  await addIdentity(optionsPage, 'e2e-vault-holder-b', '13900005555');
  await expect(cards(optionsPage)).toHaveCount(2);
  await closeVault(optionsPage);

  const { page, cdp } = await openFormPage(
    extContext,
    `<body><p><label>${FIELD_LABEL}<input id="f-serial" name="certificateNo"></label></p></body>`,
  );
  await page.locator('#f-serial').fill(CANARY);

  await focusUntilHint(cdp, page, 'f-serial');
  expect(await roleText(cdp)).toMatch(liteTextOf('cs.identity.role.serialNumber'));
  // 这一档在库里没有对应的格，气泡必须自己把落点说出来（其余角色不带这一行）
  expect(await bubbleText(cdp)).toMatch(liteTextOf('cs.identity.hintCustomField'));
  await clickButton(page, cdp, 'primary');

  await expect(vaultDialog(optionsPage)).toBeVisible();
  await expect(verifyDialog(optionsPage)).toBeHidden();
  await expect(searchInput(optionsPage)).toHaveValue(FIELD_LABEL);
  await expect(cards(optionsPage)).toHaveCount(0);
  // 档位停在「全部」：字段名也只作检索词，不替用户决定这一格属于哪一档
  await expect(optionsPage.locator('.identity-toolbar__filter .is-active')).toHaveText(textOf('identity.filter.all'));
  await expect.poll(() => bubbleCount(cdp), { message: '深链后气泡没收起' }).toBe(0);

  // 边界照旧：那一框自己的值哪儿都不去，页面也没被回填
  const optionsText = await optionsPage.evaluate(() => document.body.innerText);
  expect(optionsText, '编号框里的值出现在选项页可见文本里').not.toContain(CANARY);
  const atRest = (needle: string): Promise<boolean> =>
    optionsPage.evaluate(async value => JSON.stringify(await chrome.storage.local.get(null)).includes(value), needle);
  expect(await atRest(CANARY), '字段值落盘了').toBe(false);
  expect(await atRest(FIELD_LABEL), '字段名检索词落盘了').toBe(false);
  expect(await page.evaluate(() => (document.getElementById('f-serial') as HTMLInputElement).value), '页面被改写').toBe(
    CANARY,
  );

  // 一次性：关掉库之后检索词必须跟着清，下一轮进来回到全量列表
  await closeVault(optionsPage);
  await openVaultFromHeader(optionsPage, false);
  await expect(searchInput(optionsPage)).toHaveValue('');
  await expect(cards(optionsPage)).toHaveCount(2);

  await page.close();
});
