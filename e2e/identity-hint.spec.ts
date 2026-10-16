import type { BrowserContext, CDPSession, Locator, Page } from '@playwright/test';

import { E2E_PAGE_ORIGIN, expect, test, verifyMasterPassword } from './harness';
import { liteExactText, liteTextOf, textOf } from './i18n';
import { STORAGE_KEYS } from '../utils/storageKeys';

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
 * 3. **零明文跨界**：字段的值既不进气泡、也不进选项页、更不落盘。这条只在真浏览器里有意义——
 *    链路另一端是 Service Worker 与选项页，jsdom 里根本没有那两侧。
 *
 * 焦点事件是一次性的：内容脚本按 `document_idle` 注入，脚本晚到就没人接住那一次 `focusin`。
 * 因此「等气泡出现」写成**反复聚焦直到读到**，而不是「聚焦一次然后等」。
 */

/** CDP pierce 视图里的节点（只声明本文件用到的字段） */
type CdpNode = {
  nodeId: number;
  nodeName?: string;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
  contentDocument?: CdpNode;
};

/**
 * `DOM.getBoxModel` 返回值里本文件用到的部分
 *
 * 四点是 `x1,y1,x2,y2,x3,y3,x4,y4` 顺时针（左上→右上→右下→左下）：
 * 上边 y 是 `[1]`、下边 y 是 `[5]`、左边 x 是 `[0]`、右边 x 是 `[2]`。
 * 把 `[3]` 当成下边会让「翻转档」断言恒真，这套坐标只在 {@link toRect} 一处解释。
 */
type CdpBox = { content: number[]; border: number[] };

/** 视口矩形（CSS 像素，与 `getBoundingClientRect` 同一坐标系） */
type Rect = { top: number; bottom: number; left: number; right: number };

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

/** 读取节点的 class 属性 */
function classOf(node: CdpNode): string {
  const attrs = node.attributes ?? [];
  for (let i = 0; i < attrs.length; i += 2) {
    if (attrs[i] === 'class') return attrs[i + 1] ?? '';
  }
  return '';
}

/** 按 class 整词命中（`aph-idh` 与 `aph-idh__role` 互为前缀，子串匹配会串味） */
const byClass =
  (needle: string) =>
  (node: CdpNode): boolean =>
    classOf(node).split(/\s+/).includes(needle);

/**
 * 在 pierce 视图里查找节点
 *
 * `depth: -1` + `pierce: true` 才会把 closed shadow root 的内容一并送回来。
 * 每次查询都重新取文档：气泡随聚焦重建，缓存 nodeId 会拿到失效句柄。
 */
async function queryPierced(cdp: CDPSession, matcher: (node: CdpNode) => boolean): Promise<CdpNode[]> {
  const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: CdpNode };
  const out: CdpNode[] = [];
  const walk = (node: CdpNode): void => {
    if (matcher(node)) out.push(node);
    (node.children ?? []).forEach(walk);
    (node.shadowRoots ?? []).forEach(walk);
    if (node.contentDocument) walk(node.contentDocument);
  };
  walk(root);
  return out;
}

/**
 * 在同一次快照里「按 class 找第一个节点 + 立刻读数」
 *
 * 单独返回 `CdpNode` 供后续调用是错的：下一次 `DOM.getDocument` 会换掉整批 nodeId，
 * 而 Chrome 可能把旧 id 复用到别的节点上——那时读到的几何/文本来自不相干的元素，测试会
 * 静默地拿错读数。所以取节点与读数必须一次快照内完成，本文件没有任何跨快照的句柄。
 */
async function readFirst(cdp: CDPSession, needle: string, mode: 'rect' | 'text'): Promise<Rect | string> {
  const [node] = await queryPierced(cdp, byClass(needle));
  if (!node) throw new Error(`pierce 视图里找不到 .${needle}`);
  if (mode === 'text') {
    const { outerHTML } = (await cdp.send('DOM.getOuterHTML', { nodeId: node.nodeId })) as { outerHTML: string };
    return outerHTML.replace(/<[^>]*>/g, '').trim();
  }
  const { model } = (await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId })) as { model: CdpBox };
  return toRect(model.border);
}

/** 把盒模型的四点折成视口矩形 */
function toRect(quad: number[]): Rect {
  return { top: quad[1], bottom: quad[5], left: quad[0], right: quad[2] };
}

const bubbleRect = (cdp: CDPSession): Promise<Rect> => readFirst(cdp, 'aph-idh', 'rect') as Promise<Rect>;
const bubbleText = (cdp: CDPSession): Promise<string> => readFirst(cdp, 'aph-idh', 'text') as Promise<string>;
const roleText = (cdp: CDPSession): Promise<string> => readFirst(cdp, 'aph-idh__role', 'text') as Promise<string>;
const buttonRect = (cdp: CDPSession, variant: 'ghost' | 'primary'): Promise<Rect> =>
  readFirst(cdp, `aph-idh__btn--${variant}`, 'rect') as Promise<Rect>;

/** 收起只清内容、保留宿主，所以判「有没有提示」数的是气泡而不是宿主 */
const bubbleCount = async (cdp: CDPSession): Promise<number> => (await queryPierced(cdp, byClass('aph-idh'))).length;

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

/**
 * 派发一次真实的 `focusin`
 *
 * `focus()` 打在**已经聚焦**的元素上不派发任何焦点事件，而气泡收起的四条路径里有三条
 * （Esc、点「收起」、走到无语义字段）都不动焦点——直接再 `focus()` 会空转，表现为
 * 「等不到提示」而不是「提示没重建」。所以每一轮都先撤焦点再回来，等价于用户 Tab 走又Tab 回。
 */
function refocus(page: Page, id: string): Promise<unknown> {
  return page.evaluate(targetId => {
    const el = document.getElementById(targetId) as HTMLElement | null;
    el?.blur();
    el?.focus();
  }, id);
}

/**
 * 聚焦到某字段并等气泡落地
 *
 * 反复「撤焦点 + 回焦点」直到 pierce 视图读到恰好一枚气泡：内容脚本晚到时要再打一次事件；
 * `showIdentityHint` 对「同字段同角色」幂等，重复聚焦不会叠出第二枚。
 */
async function focusUntilHint(cdp: CDPSession, page: Page, id: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await refocus(page, id);
        return bubbleCount(cdp);
      },
      { message: `聚焦 #${id} 之后没有出现身份提示`, timeout: 25_000 },
    )
    .toBe(1);
}

/** 聚焦并等气泡收起（用于「失焦即收」与开关切换之间的分隔） */
async function blurUntilGone(page: Page, cdp: CDPSession, id: string): Promise<void> {
  await page.evaluate(targetId => (document.getElementById(targetId) as HTMLElement | null)?.blur(), id);
  await expect.poll(() => bubbleCount(cdp), { message: '失焦后气泡没收起' }).toBe(0);
}

/**
 * 打开一页表单并接好 CDP
 *
 * 页面由 `route.fulfill` 直接给出，不出网、不依赖 DNS，域名取 `*.e2e.test` 保留域。
 */
async function openFormPage(extContext: BrowserContext, html: string): Promise<{ page: Page; cdp: CDPSession }> {
  const page = await extContext.newPage();
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
  );
  await page.goto(`${E2E_PAGE_ORIGIN}/identity-hint`);
  const cdp = await extContext.newCDPSession(page);
  await cdp.send('DOM.enable');
  return { page, cdp };
}

/** 身份库列表弹窗（与 `identity-lookup-from-detail.spec.ts` 同口径：只认列表独有的工具栏） */
const vaultDialog = (page: Page): Locator =>
  page.getByRole('dialog').filter({ has: page.locator('.identity-toolbar') });

test('气泡只报角色：值不进内容，页面脚本也读不到 shadow 里的东西', async ({ extContext }) => {
  const { page, cdp } = await openFormPage(extContext, `<body>${FORM_HTML}</body>`);

  await page.evaluate(value => {
    (document.getElementById('f-name') as HTMLInputElement).value = value;
  }, CANARY);

  await focusUntilHint(cdp, page, 'f-name');

  expect(await bubbleText(cdp)).toMatch(liteTextOf('cs.identity.hintTitle'));
  expect(await bubbleText(cdp), '字段值出现在了气泡里').not.toContain(CANARY);
  expect(await roleText(cdp)).toMatch(liteExactText('cs.identity.role.name'));

  // closed：主世界拿不到 shadowRoot，宿主的光 DOM 里也没有任何内容节点。
  // 不断言宿主 outerHTML 为空串——主题令牌是内联写进宿主 style 属性的，那里本就有内容。
  const hostView = await page.evaluate(() => {
    const host = document.querySelector('[data-aph="identity-hint"]') as HTMLElement | null;
    return { exists: !!host, shadow: host?.shadowRoot ?? null, lightChildren: host?.childNodes.length ?? -1 };
  });
  expect(hostView).toEqual({ exists: true, shadow: null, lightChildren: 0 });

  await page.close();
});

test('非登录形态的手机号框照样出提示：让位只给快速填充真正认领的字段', async ({ extContext }) => {
  const { page, cdp } = await openFormPage(extContext, `<body>${FORM_HTML}</body>`);

  await focusUntilHint(cdp, page, 'f-phone');

  expect(await roleText(cdp)).toMatch(liteExactText('cs.identity.role.phone'));
  // 手机号属「本人且常用」档：不该带核对提示
  expect(await bubbleText(cdp)).not.toMatch(liteTextOf('cs.identity.hintVerify'));

  await page.close();
});

test('地址表单四档各报其角色：中英标签同页并存也不串味', async ({ extContext }) => {
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
    expect(role, `#${id} 报成了别的角色`).toMatch(liteExactText(roleKey));
    seen.push(role);
  }
  // 逐条判据在中英两侧各只允许两个候选词，串味有可能躲过它们（例如把「地区」报成地址的另一种说法）；
  // 这一句按「四档必须报出四个互不相同的词」再兜一层，同页同语言下串味会在这里现形。
  expect(new Set(seen).size).toBe(4);

  await page.close();
});

test('四条收起路径：失焦、Esc、点「收起」、走到无语义字段', async ({ extContext }) => {
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

test('锚定下缘、跟随滚动、贴底翻上方，证件号档额外带核对提示', async ({ extContext }) => {
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

test('与页面同款最高层级遮罩同屏：提示压在遮罩之上、点得到，且事件不外溢', async ({ extContext }) => {
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

test('总闸关掉时不再出提示，拨回来立刻恢复', async ({ extContext, extensionId }) => {
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

  await focusUntilHint(cdp, page, 'f-name');
  await blurUntilGone(page, cdp, 'f-name');

  // `set` 的 Promise 只覆盖写入方那侧，跨上下文广播还要再落一帧；不等这一帧，读到的 0
  // 可能只是「监听器还没跑到」，而不是「总闸关着」。这一帧只给关闸那一次拨动等，
  // 之后每次聚焦都立刻读数（气泡是同步建起来的，再睡只会把 90s 用例预算吃光）。
  await setGate(false);
  await page.waitForTimeout(400);
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

test('深链「从身份库选择」：过复验门槛打开身份库，类别筛选预选到对应档，值不跨界', async ({
  extContext,
  optionsPage,
}) => {
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

  // 角色 → 类别档位：证件号落在「证件」档，用户少点一次筛选
  await expect(optionsPage.locator('.identity-toolbar__filter .is-active')).toHaveText(
    textOf('identity.category.id_card'),
  );

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
