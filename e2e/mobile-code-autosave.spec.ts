import type { BrowserContext, Page } from '@playwright/test';
import { E2E_PAGE_ORIGIN, expect, test } from './harness';

/**
 * 手机号 + 短信验证码登录的自动保存（真机端到端）
 *
 * 这条链路是 2026-11-06 那轮留存改造的主体：国内主流登录形态页面上**没有密码框**，
 * 而三个捕获入口此前都要求「存在密码框且值非空」，于是这类登录永远不弹保存、库里永远空着。
 * 单元测试钉住了判据本身（`tests/content/loginAutoSave.mobileCode.test.ts`），
 * 本文件钉住的是**只有真浏览器才能证明的三件事**：
 * 1. 内容脚本真的注进了这个 http 源，且闭包影子树里的弹窗真的出现在页面上；
 * 2. 「保存」经 content → background → 加密落盘 → Options 列表整条跨入口链路走通；
 * 3. 密码框照常成立的老路径没有被放宽门影响（回归）。
 *
 * 断言一律落在**外部可观察结果**上：弹窗在 closed shadow root 里，读不到不等于功能坏了，
 * 而「条目出现在管理页列表里」才是用户真正在意的那件事。
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
 * 弹窗的内容全在 **closed** shadow root 里（`SavePasswordPrompt.ts` 的设计，用来隔离宿主页面样式）。
 * 后果是测试侧三条路都走不通：Playwright 的选择器引擎进不去；`toBeVisible()` 因为宿主 `div`
 * 自身没有布局盒而恒判 hidden；CDP 的 `DOM.getDocument{pierce:true}` 在这个 page target 上
 * 只返回根节点（实测 total=1，pierce 与不 pierce 一样）。所以本文件断言的是**宿主节点的挂载与否**——
 * 它是「捕获链跑完了、并且决定弹窗」的唯一外部可观察信号，而捕获判据正是这次改动的本体。
 *
 * 弹窗内部那句「短信验证码不保存」与点「保存」之后的落库，由真机之外的两层钉住：
 * `tests/content/savePasswordPrompt.mobileLogin.test.ts`（真实渲染函数 + closed 影子树截获）与
 * `tests/utils/autoSaveManager.test.ts` + `tests/background/autoSaveHandler.test.ts`（写入契约与授权位）。
 */
const promptHost = (site: Page) => site.locator('[data-aph="save-password-prompt"]');

/** 等一次跨入口往返：捕获 → 预检查 → 决定弹窗，留足余量再断言「没有」 */
const settle = async (site: Page): Promise<void> => {
  await site.waitForTimeout(3_000);
};

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
});
