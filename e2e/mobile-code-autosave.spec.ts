import type { BrowserContext, CDPSession, Page } from '@playwright/test';
import { createEntry, E2E_PAGE_ORIGIN, expect, rowOf, test } from './harness';
import { liteExactMatch, liteTextOf, textOf } from './i18n';
import { byClass, queryPierced, type Rect } from './identityHintDom';

/**
 * 手机号 + 短信验证码登录的自动保存（真机端到端）
 *
 * 这条链路是 2026-11-06 那轮留存改造的主体：国内主流登录形态页面上**没有密码框**，
 * 而三个捕获入口此前都要求「存在密码框且值非空」，于是这类登录永远不弹保存、库里永远空着。
 * 单元测试钉住了判据本身（`tests/content/loginAutoSave.mobileCode.test.ts`），
 * 本文件钉住的是**只有真浏览器才能证明的六件事**：
 * 1. 内容脚本真的注进了这个 http 源，且闭包影子树里的弹窗真的出现在页面上；
 * 2. 「保存」经 content → background → 加密落盘 → Options 列表整条跨入口链路走通；
 * 3. 密码框照常成立的老路径没有被放宽门影响（回归）；
 * 4. 弹窗开着时页面别处冒出的口令框进不了库：授权位与口令必须同源（Critical 的真机判据）；
 * 5. 出口轻提醒说的是存储层判定的那一条结局，不是通用的「已保存」（写死通用串会对用户说谎）；
 * 6. 那条提醒在 3s 自删窗口里文案与几何都取得到：长文案折行后仍整块落在视口内。
 *
 * 前三条断言落在**宿主节点的挂载与否**上（捕获链跑完并决定弹窗的唯一外部信号）；
 * 第四到第六条走 CDP pierce 视图读影子树内部、真鼠标点「保存」，再分别断言到管理页详情抽屉
 * 与页面内那条 light DOM 轻提醒（文案整串比对 + 盒模型 + 截图归档）。
 */

const PHONE = '13800000000';
const SMS_CODE = '246813';

/**
 * 让夹具页面「提交但不跳转」
 *
 * 真实站点里手机号 + 短信码登录几乎都是 XHR 提交、页面原地不导航；而原生 form submit
 * 会换掉整个文档，弹窗（以及它所属的那次捕获）随文档一起消失，断言就只能等到超时。
 * 这条脚本把默认行为挡掉，测的才是用户实际遇到的那一种形态。
 */
const NO_NAVIGATE = `<script>document.addEventListener('submit',function(e){e.preventDefault();},true);</script>`;

/** 手机号 + 短信码，无密码框 */
const MOBILE_LOGIN_HTML = `<!doctype html><html><head><title>手机号登录 - e2e</title>${NO_NAVIGATE}</head><body>
  <form id="f">
    <input id="m" type="tel" name="mobile" autocomplete="tel">
    <input id="c" type="text" name="smsCode" placeholder="请输入验证码">
    <button id="go" type="submit">登录</button>
  </form>
</body></html>`;

/** 同上，但**不**挡默认行为：提交即整页跳转，用于验证「跳转后复现弹窗」那条恢复路径 */
const MOBILE_LOGIN_NAVIGATING_HTML = MOBILE_LOGIN_HTML.replace(NO_NAVIGATE, '');

/**
 * 保存出口那条用例专用的账号框形态：`type="text"` + 手机号 placeholder
 *
 * 不能复用上面的 `type="tel"`：点「保存」时 `captureCurrentCredentials` 会做一次全文档重读，
 * 而重读的账号兜底只认 `USERNAME_SELECTORS`（`type="tel"` 不在其中），取不到账号就提前
 * return null，口令随之回退到捕获时的空串——于是「重读读到了页面可控的口令」这条链路
 * 根本走不到，用例会恒绿地什么都没测。国内短信登录页最常见的正是这一种 text + placeholder 写法。
 */
const MOBILE_LOGIN_TEXT_HTML = `<!doctype html><html><head><title>手机号登录 - e2e</title>${NO_NAVIGATE}</head><body>
  <form id="f">
    <input id="m" type="text" name="mobile" placeholder="请输入手机号">
    <input id="c" type="text" name="smsCode" placeholder="请输入验证码">
    <button id="go" type="submit">登录</button>
  </form>
</body></html>`;

/**
 * 弹窗打开后才由页面注入的口令值（合成品，不对应任何真实凭据）
 *
 * 它必须落不进库：`mobileLogin` 是「允许空口令写入」的授权位，存储层两道闸门都以
 * `!password` 为键，非空即全部绕过，还能覆写用户已存的真实口令。
 */
const STRAY_PASSWORD = 'PageControlled!E2e';

/**
 * 弹窗开着的那几秒里，另一张管理页给同一个账号设下的真口令（合成品）
 *
 * 用来复现 `persistAutoSavePassword` 注释里那个陈旧窗口：预检查时库里还没有这条，弹窗因此成立；
 * 用户读弹窗时另一处把它建好并带上口令。此时点保存必须一个字节都不写——`passwordKept` 那条
 * 结局只有这一条可达路径（预检查对「本次无口令、库里那条有」直接判 identical，根本不弹窗）。
 */
const STORED_ELSEWHERE_PASSWORD = 'AlreadyStored!E2e';

/** 只有手机号填写（用户刚点「获取验证码」，登录还没发生） */
const MOBILE_ONLY_SUBMIT_HTML = `<!doctype html><html><head><title>获取验证码 - e2e</title>${NO_NAVIGATE}</head><body>
  <form id="f">
    <input id="m" type="tel" name="mobile" value="${PHONE}">
    <input id="c" type="text" name="smsCode" placeholder="请输入验证码" value="">
    <button id="go" type="submit">获取验证码</button>
  </form>
</body></html>`;

/** 常规账号 + 密码（老路径，必须一字不变） */
const PASSWORD_LOGIN_HTML = `<!doctype html><html><head><title>账号登录 - e2e</title>${NO_NAVIGATE}</head><body>
  <form id="f">
    <input id="u" type="text" name="username" value="alice-e2e">
    <input id="p" type="password" name="password" value="E2ePassw0rd!x">
    <button id="go" type="submit">登录</button>
  </form>
</body></html>`;

/**
 * 打开一个本地伪造的登录站点（请求被 route 直接 fulfill，不出网）
 *
 * 刻意不复用 `openSidepanelOnSite`：那条夹具会额外打开侧边栏并等首屏，
 * 本文件测的是「提交表单 → 捕获 → 落库」，多开一个面板只会把秒开 SLA 的抖动引进来。
 */
async function openSite(extContext: BrowserContext, html: string): Promise<Page> {
  const site = await extContext.newPage();
  await site.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
  );
  await site.goto(`${E2E_PAGE_ORIGIN}/mobile-login`);
  return site;
}

/**
 * 弹窗宿主节点
 *
 * 弹窗的内容全在 **closed** shadow root 里（`SavePasswordPrompt.ts` 的设计，用来隔离宿主页面样式），
 * Playwright 的选择器引擎进不去，`toBeVisible()` 也因为宿主 `div` 自身没有布局盒而恒判 hidden。
 * 捕获门那几条用例因此只断言**宿主节点的挂载与否**——它是「捕获链跑完了、并且决定弹窗」的
 * 唯一外部可观察信号，而捕获判据正是那次改动的本体。
 *
 * 影子树内部并非读不到：CDP 的 `DOM.getDocument` 必须同时给 `depth: -1` 与 `pierce: true`
 * 才会把 closed shadow root 一并送回来（只给 pierce、depth 留默认 1 时只返回根节点，
 * 本文件早前的注释据此误判成「这条路走不通」）。下面那条落库用例正是走 pierce 视图读文案、
 * 取按钮盒模型，再用真鼠标点下去的。
 */
const promptHost = (site: Page) => site.locator('[data-aph="save-password-prompt"]');

/** 建一个能读 closed 影子树的 CDP 会话（口径同 `identityHintDom.openFormPage`） */
async function pierceSession(site: Page): Promise<CDPSession> {
  const cdp = await site.context().newCDPSession(site);
  await cdp.send('DOM.enable');
  return cdp;
}

/** 弹窗卡片的纯文本（标签抹掉；卡片内容全是文本节点） */
async function promptText(cdp: CDPSession): Promise<string> {
  const [card] = await queryPierced(cdp, byClass('aph-prompt'));
  if (!card) throw new Error('pierce 视图里找不到保存弹窗卡片 .aph-prompt');
  const { outerHTML } = (await cdp.send('DOM.getOuterHTML', { nodeId: card.nodeId })) as { outerHTML: string };
  return outerHTML.replace(/<[^>]*>/g, '').trim();
}

/**
 * 按产品文案在 pierce 视图里找到弹窗按钮并取它的视口矩形
 *
 * 找节点与读数必须在**同一次快照**内完成：下一次 `DOM.getDocument` 会换掉整批 nodeId，
 * 旧 id 可能被复用到不相干的元素上，那时读到的几何来自别处而测试静默拿错读数
 * （口径同 `identityHintDom.readFirst`）。这里复用它的 `queryPierced` 取快照，
 * 之后不再取文档，故句柄全程有效。
 */
async function promptButtonRect(cdp: CDPSession, key: string): Promise<Rect> {
  const buttons = await queryPierced(cdp, node => node.nodeName === 'BUTTON');
  for (const node of buttons) {
    const { outerHTML } = (await cdp.send('DOM.getOuterHTML', { nodeId: node.nodeId })) as { outerHTML: string };
    if (!liteExactMatch(key, outerHTML.replace(/<[^>]*>/g, '').trim())) continue;
    const { model } = (await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId })) as {
      model: { border: number[] };
    };
    // 四点顺时针：上边 y=[1]、下边 y=[5]、左边 x=[0]、右边 x=[2]
    return { top: model.border[1], bottom: model.border[5], left: model.border[0], right: model.border[2] };
  }
  throw new Error(`pierce 视图里找不到文案为 ${key} 的弹窗按钮`);
}

/**
 * 真鼠标点弹窗的「保存」
 *
 * 先命中测试确认坐标确实落在扩展宿主上再按下：坐标算错只会点到页面元素，
 * 红灯会伪装成「保存没反应」（口径同 `vault-return-to-source.clickBubblePrimary`）。
 */
async function clickPromptSave(site: Page, cdp: CDPSession): Promise<void> {
  const rect = await promptButtonRect(cdp, 'cs.save.save');
  const x = (rect.left + rect.right) / 2;
  const y = (rect.top + rect.bottom) / 2;
  const marker = await site.evaluate(
    ([px, py]) => document.elementFromPoint(px, py)?.getAttribute('data-aph') ?? '<no marker>',
    [x, y],
  );
  expect(marker, '点击坐标没有落在保存弹窗宿主上').toBe('save-password-prompt');
  await site.mouse.click(x, y);
}

/** 等一次跨入口往返：捕获 → 预检查 → 决定弹窗，留足余量再断言「没有」 */
const settle = async (site: Page): Promise<void> => {
  await site.waitForTimeout(3_000);
};

/**
 * 保存出口那条轻提醒
 *
 * 名字里有 native，但它**不是**操作系统通知：`showNativeNotification` 往宿主页面 body 挂一个
 * light DOM 的 `.native-form-detector-notification`，3000ms 后自删。所以它不像弹窗那样需要
 * CDP pierce，普通选择器读得到；代价是所有读数与截图都得挤在那 3 秒里。
 */
const notice = (site: Page) => site.locator('.native-form-detector-notification');

/**
 * 读一次保存出口轻提醒：文案、几何、截图，全在 3s 自删窗口内取完
 *
 * 这条提醒是「结局由存储层判定并本地化」那次改动唯一的外部可观察面：三种 success（新存一条 /
 * 更新已有 / 该账号已存有密码本次未改动）说的不是同一件事，回落成通用的「账号密码已保存」
 * 会对用户说谎——他据此以为短信码登录已入库，下次仍填不出东西。判据因此分三层：
 *
 * 1. 文案**整串等于**该结局的词条（`liteExactMatch`，中英任一份），且不得命中通用串；
 * 2. 提醒里不回显账号（它只说结局，凭据不进这条呈现面）；
 * 3. 盒子整块在视口内、右边缘锚在 20px、min-height 生效。英文那句 66 字符会在 max-width 处
 *    折行把高度撑起来，只断言「看得见」量不到溢出与裁切，所以几何要单独读。
 *
 * 截图排在最后：它本身要几百毫秒，先取文案与盒模型才不会把 3s 窗口吃光后拿到一张空图。
 */
async function expectNotice(site: Page, key: string, artifact: string): Promise<void> {
  const target = notice(site);
  await expect(target).toBeVisible({ timeout: 15_000 });

  // 提醒里有两个 span：图标在前、文案在后，读整块 textContent 会把 ✓ 也算进文案比对
  const text = (await target.locator('span').last().textContent())?.trim() ?? '';
  expect(liteExactMatch(key, text), `轻提醒说的是「${text}」，不是 ${key} 那条结局`).toBe(true);
  expect(text, '轻提醒回落到了通用的「已保存」，会对用户说谎').not.toMatch(liteTextOf('cs.notify.saved'));
  expect(text, '轻提醒回显了账号').not.toContain(PHONE);

  const box = await target.boundingBox();
  const viewport = site.viewportSize();
  if (!box || !viewport) throw new Error('轻提醒没有布局盒，或取不到视口尺寸');
  expect(box.x, '轻提醒左边出了视口').toBeGreaterThanOrEqual(0);
  expect(box.y, '轻提醒上边出了视口').toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, '轻提醒右边出了视口').toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height, '折行后轻提醒下边出了视口').toBeLessThanOrEqual(viewport.height);
  expect(Math.round(box.x + box.width), '右边缘没有锚在 20px').toBe(viewport.width - 20);
  expect(box.height, 'min-height 40px 没生效').toBeGreaterThanOrEqual(40);

  const body = await site.screenshot({ path: `test-results/artifacts/${artifact}.png` });
  await test.info().attach(artifact, { body, contentType: 'image/png' });
}

/**
 * 会话前置：三条用例都必须取 `optionsPage`
 *
 * 这个 fixture 负责把主密码设好并解锁会话。少了它，捕获链在 `LoginAutoSave` 的
 * `isSessionValid` 那一步就返回，弹窗永远不出现——于是「断言弹窗出现」变成恒红、
 * 「断言不弹窗」变成恒绿。本文件第一轮里两条用例就是这么一红一假绿的，
 * 所以这一位不是可选的准备动作，而是这三条断言能成立的条件。
 */
test.describe('手机号 + 短信验证码登录的自动保存', () => {
  test('两框都填写后提交：捕获链决定弹窗（改动前这一步永远不会出现宿主节点）', async ({ extContext, optionsPage }) => {
    void optionsPage;
    const site = await openSite(extContext, MOBILE_LOGIN_HTML);

    await site.fill('#m', PHONE);
    await site.fill('#c', SMS_CODE);
    await site.click('#go');

    await expect(promptHost(site)).toBeAttached({ timeout: 15_000 });
  });

  test('验证码框还空着就提交（点的是「获取验证码」）：不弹窗', async ({ extContext, optionsPage }) => {
    // optionsPage 是这条用例成立的前提：它把会话解锁出来。没有会话时捕获链在
    // `isSessionValid` 就返回，「不弹窗」会变成环境造成的假绿。
    void optionsPage;
    const site = await openSite(extContext, MOBILE_ONLY_SUBMIT_HTML);

    await site.click('#go');
    await settle(site);
    await expect(promptHost(site)).toHaveCount(0);
  });

  test('账号 + 密码的老路径照常弹窗（放宽门没把老形态挤掉）', async ({ extContext, optionsPage }) => {
    void optionsPage;
    const site = await openSite(extContext, PASSWORD_LOGIN_HTML);

    await site.click('#go');
    await expect(promptHost(site)).toBeAttached({ timeout: 15_000 });
  });

  test('整页跳转式短信登录：新文档加载后仍要复现弹窗', async ({ extContext, optionsPage }) => {
    void optionsPage;
    // 这一条是评审抓出来的 Blocker 的判据：国内 PC 站的短信登录常常整页跳转而不是 XHR。
    // 捕获侧把待确认凭证加密暂存 sessionStorage，恢复侧必须认得「空口令 + mobileLogin」这一形态；
    // 恢复校验此前写的是「必须有用户名和密码」，于是刚写进去的凭证在新页面被当脏数据删掉。
    // 夹具刻意不挡默认行为（与上面三条相反）：提交即换文档，弹窗只能由恢复路径给出。
    // route 会把跳转后的文档 fulfill 成同一份 HTML，字段值随导航丢失，正好还原真实形态。
    const site = await openSite(extContext, MOBILE_LOGIN_NAVIGATING_HTML);

    await site.fill('#m', PHONE);
    await site.fill('#c', SMS_CODE);
    await site.click('#go');

    await expect(promptHost(site)).toBeAttached({ timeout: 15_000 });
  });

  test('弹窗开着时页面别处冒出非空口令框：点保存后落库的仍是空口令', async ({ extContext, optionsPage }) => {
    const site = await openSite(extContext, MOBILE_LOGIN_TEXT_HTML);
    await site.fill('#m', PHONE);
    await site.fill('#c', SMS_CODE);
    await site.click('#go');
    await expect(promptHost(site)).toBeAttached({ timeout: 15_000 });

    const cdp = await pierceSession(site);
    // 刻意在弹窗出现**之后**才注入：捕获时页面上没有口令框（授权位因此为真），
    // 重读时才有——SPA 切视图、站点把 OTP 做成掩码框都是这个形状。
    // 挂在 body 上而不是 form 里，重读的账号才会走全文档兜底而不是 form 作用域。
    await site.evaluate(value => {
      const stray = document.createElement('input');
      stray.type = 'password';
      stray.value = value;
      document.body.appendChild(stray);
    }, STRAY_PASSWORD);

    // 用户此刻看到的是「短信验证码不保存」，并且正是据此点的保存
    const text = await promptText(cdp);
    expect(text, '弹窗没有告知验证码不保存').toMatch(liteTextOf('cs.save.mobileLoginNote'));
    expect(text, '页面可控的口令值出现在了弹窗里').not.toContain(STRAY_PASSWORD);

    await clickPromptSave(site, cdp);
    await expect(promptHost(site)).toHaveCount(0);

    // 落库断言：条目真的进了库，且详情抽屉走的是「未设置密码」那一支
    // （显隐/复制按钮只挂在有口令的分支上，它们缺席才是空口令落盘的证据）
    await optionsPage.bringToFront();
    await optionsPage.reload({ waitUntil: 'domcontentloaded' });
    await expect(rowOf(optionsPage, PHONE)).toBeVisible({ timeout: 30_000 });
    await rowOf(optionsPage, PHONE)
      .getByRole('button', { name: textOf('options.detail.viewDetail') })
      .click();
    const drawer = optionsPage.getByRole('dialog').filter({ hasText: textOf('options.detail.title') });
    await expect(drawer).toBeVisible();
    await expect(
      drawer.locator('.detail-muted').filter({ hasText: textOf('options.detail.noPassword') }),
    ).toBeVisible();
    await expect(drawer.getByRole('button', { name: textOf('common.showPassword') })).toHaveCount(0);
    await expect(drawer).not.toContainText(STRAY_PASSWORD);
  });

  test('新存一条：出口轻提醒说的是「已自动保存新账号密码」，不是通用串', async ({ extContext, optionsPage }) => {
    void optionsPage;
    const site = await openSite(extContext, MOBILE_LOGIN_TEXT_HTML);
    await site.fill('#m', PHONE);
    await site.fill('#c', SMS_CODE);
    await site.click('#go');
    await expect(promptHost(site)).toBeAttached({ timeout: 15_000 });

    const cdp = await pierceSession(site);
    await clickPromptSave(site, cdp);

    await expectNotice(site, 'bg.autoSave.savedNew', 'mobile-code-notice-saved-new');
  });

  test('弹窗开着时另一处给这条设了密码：出口轻提醒如实说「本次未改动」', async ({ extContext, optionsPage }) => {
    const site = await openSite(extContext, MOBILE_LOGIN_TEXT_HTML);
    await site.fill('#m', PHONE);
    await site.fill('#c', SMS_CODE);
    await site.click('#go');
    await expect(promptHost(site)).toBeAttached({ timeout: 15_000 });
    const cdp = await pierceSession(site);

    // 预检查时库里没有这条，弹窗才成立；用户读弹窗的这几秒里另一张管理页把它建好并带上口令。
    // 这是 passwordKept 唯一可达的生产路径，也是「静默清掉一把口令不可逆」那条守卫的现场。
    await createEntry(optionsPage, {
      username: PHONE,
      password: STORED_ELSEWHERE_PASSWORD,
      url: E2E_PAGE_ORIGIN,
    });
    await site.bringToFront();
    await clickPromptSave(site, cdp);

    await expectNotice(site, 'bg.autoSave.passwordKept', 'mobile-code-notice-password-kept');
  });
});
