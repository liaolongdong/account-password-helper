import type { Page } from '@playwright/test';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { E2E_PAGE_ORIGIN, expect, createEntry, openSidepanelOnSite, storedArrayCount, test } from './harness';
import { templatedOf, textOf } from './i18n';

/**
 * 侧边栏（快速填充面板）端到端
 *
 * 覆盖的是「Options 录入 → 侧边栏按站点分组展示 → 点击填进真实页面」这条
 * 跨入口链路，单元测试里 `chrome.tabs` 与内容脚本全是桩，拿不到这个结论。
 *
 * 侧边栏以标签页形态而非停靠面板被测，原因见 `harness.ts` 的 `openSidepanelOnSite`；
 * 两处与停靠态的真实差异已在本文件末尾显式记录，不假装测到了没测的东西。
 */

const SITE_ENTRY = { username: 'e2e-site-user', password: 'Synthetic!Site1', url: `${E2E_PAGE_ORIGIN}/login` };
const GENERIC_ENTRY = { username: 'e2e-generic-user', password: 'Synthetic!Generic1', url: '' };
const OFF_SITE_ENTRY = {
  username: 'e2e-offsite-user',
  password: 'Synthetic!OffSite1',
  url: 'https://other-site.e2e.test/',
};
const NO_FORM_ENTRY = { username: 'e2e-noform-user', password: 'Synthetic!NoForm1', url: 'https://no-form.e2e.test/' };
const NO_FORM_ORIGIN = 'https://no-form.e2e.test';

/** 页面里没有任何可识别的登录字段，用于验证「填不进去」有明确反馈 */
const BLANK_PAGE_HTML =
  '<!doctype html><html><head><title>e2e blank</title></head><body><p>nothing here</p></body></html>';

const rows = (panel: Page) => panel.locator('.password-item');
const row = (panel: Page, username: string) => rows(panel).filter({ hasText: username });
const searchInput = (panel: Page) => panel.getByPlaceholder(textOf('sidepanel.searchPlaceholder'));

test.describe('侧边栏', () => {
  test('会话未验证时只给解锁引导，不渲染账号列表', async ({ extContext, extensionId }) => {
    // 不请求 optionsPage 夹具：全新 profile 从未设置过主密码，必然停在锁屏态
    const { panel } = await openSidepanelOnSite(extContext, extensionId);

    const authCard = panel.locator('.auth-card');
    await expect(authCard).toBeVisible();
    await expect(authCard).toContainText(textOf('sidepanel.sessionExpired'));
    await expect(panel.getByRole('button', { name: textOf('sidepanel.verifyPassword') })).toBeVisible();

    // 认证视图是异步组件：锁屏态连 chunk 都不该挂载，列表区零节点
    await expect(panel.locator('.search-card')).toHaveCount(0);
    await expect(rows(panel)).toHaveCount(0);
  });

  test('本站范围只列本站与通用条目，搜不到时给全站出口并把外站降级为打开站点', async ({
    extContext,
    extensionId,
    optionsPage,
  }) => {
    await createEntry(optionsPage, SITE_ENTRY);
    await createEntry(optionsPage, GENERIC_ENTRY);
    await createEntry(optionsPage, OFF_SITE_ENTRY);
    const { panel } = await openSidepanelOnSite(extContext, extensionId);

    // 默认「本站」：域名精确匹配的条目 + 空 URL 通用条目，外站条目不出现
    await expect(row(panel, SITE_ENTRY.username)).toBeVisible();
    await expect(row(panel, GENERIC_ENTRY.username)).toBeVisible();
    await expect(rows(panel)).toHaveCount(2);

    // 本站无结果、全库有命中：空态给「在全部条目中查找（N 条）」，而不是停在死胡同
    await searchInput(panel).fill('e2e-offsite-user');
    await expect(panel.locator('.empty-state')).toContainText(textOf('sidepanel.noMatch'));
    const searchAllCta = panel.locator('.empty-search-all-btn');
    await expect(searchAllCta).toHaveText(templatedOf('sidepanel.scope.searchAllCta', { count: 1 }));
    await searchAllCta.click();

    // 全站：搜索词继续参与过滤，此时只剩那条外站条目；范围状态条常驻
    await expect(panel.locator('.scope-bar')).toBeVisible();
    await expect(rows(panel)).toHaveCount(1);
    // 清空关键词才放开为全库三条 —— 范围与过滤是叠加关系，不是互相覆盖
    await searchInput(panel).fill('');
    await expect(rows(panel)).toHaveCount(3);

    const offSiteRow = row(panel, OFF_SITE_ENTRY.username);
    await expect(offSiteRow).toHaveAttribute('aria-label', textOf('sidepanel.item.openSiteTitle'));
    await expect(offSiteRow.locator('.off-site-icon')).toBeVisible();
    await expect(offSiteRow.locator('.auto-login-icon')).toHaveCount(0);
    // 本站条目不受影响，仍是填充语义
    await expect(row(panel, SITE_ENTRY.username)).toHaveAttribute('aria-label', textOf('sidepanel.item.fillTitle'));

    // 切回本站：状态条消失，列表重新收敛
    await panel.locator('.scope-toggle-btn').click();
    await expect(panel.locator('.scope-bar')).toHaveCount(0);
    await expect(rows(panel)).toHaveCount(2);
  });

  test('点击条目把账号与密码填进当前页，并收起面板', async ({ extContext, extensionId, optionsPage }) => {
    await createEntry(optionsPage, SITE_ENTRY);
    const { site, panel } = await openSidepanelOnSite(extContext, extensionId);

    await row(panel, SITE_ENTRY.username).click();

    // 填充结果以页面输入框的 value 为准：这才是「跨入口真的把凭据送进了目标页」的证据
    await expect(site.locator('#login-username')).toHaveValue(SITE_ENTRY.username);
    await expect(site.locator('#login-password')).toHaveValue(SITE_ENTRY.password);
    // 成功分支才会走到「收起面板」：填充成功 → HIDE_SIDEPANEL → 面板侧 window.close()。
    // 成功提示与关闭同帧发生，气泡来不及被断言命中（实测拿到的就是页面已销毁），
    // 所以这里用「面板消失」这条稳定的可观察结果收口，与产品语义一致。
    await expect.poll(() => panel.isClosed()).toBe(true);
  });

  test('当前页没有登录表单时明确报错，而不是静默失败', async ({ extContext, extensionId, optionsPage }) => {
    await createEntry(optionsPage, NO_FORM_ENTRY);
    const { panel } = await openSidepanelOnSite(extContext, extensionId, BLANK_PAGE_HTML, NO_FORM_ORIGIN);

    await expect(row(panel, NO_FORM_ENTRY.username)).toBeVisible();
    await row(panel, NO_FORM_ENTRY.username).click();

    // 走的是 ElMessage.warning，同样落在 role=alert 上；断言「说的是没检测到表单」而不是「有个气泡」
    await expect(panel.getByRole('alert').filter({ hasText: textOf('fill.noLoginForm') })).toBeVisible();
  });

  test('快速添加弹窗预填当前站点、用户名必填，且非停靠形态被发送方守卫拒绝', async ({
    extContext,
    extensionId,
    optionsPage,
  }) => {
    await createEntry(optionsPage, SITE_ENTRY);
    const { panel } = await openSidepanelOnSite(extContext, extensionId);

    await panel.locator('.add-site-plus').click();
    const dialog = panel.getByRole('dialog').filter({ hasText: textOf('sidepanel.quickAdd.title') });
    await expect(dialog).toBeVisible();
    // 域名由面板传给弹窗：用户不必手输当前站点
    await expect(dialog.getByPlaceholder(textOf('sidepanel.quickAdd.urlPlaceholder'))).toHaveValue(
      new URL(E2E_PAGE_ORIGIN).hostname,
    );

    // 用户名为唯一必填项：空提交被表单校验拦下，弹窗不关、不发请求
    await dialog.locator('.quick-add-actions .el-button--primary').click();
    await expect(dialog.getByText(textOf('form.usernameRequired'))).toBeVisible();
    expect(await storedArrayCount(panel, STORAGE_KEYS.PASSWORDS)).toBe(1);

    await dialog.getByPlaceholder(textOf('sidepanel.quickAdd.usernamePlaceholder')).fill('e2e-quick-user');
    await dialog.getByPlaceholder(textOf('sidepanel.quickAdd.passwordPlaceholder')).fill('Synthetic!Quick1');
    await dialog.locator('.quick-add-actions .el-button--primary').click();

    // 落盘被拒是**产品正确的 fail-closed 行为**，不是缺陷：`QUICK_ADD_PASSWORD` 只接受
    // `sender.tab === undefined` 的扩展内部上下文（messageRouter.ts 的 isTrustedInternalSender），
    // 真停靠面板与 popup 属于这一类；本用例以标签页形态打开 sidepanel.html，`sender.tab` 有值，
    // 与内容脚本越权同形，因此必须被拒。弹窗保持打开 + 库里不多不少，就是这条守卫的证据。
    // 落盘成功路径由单元测试覆盖（tests/background/quickAddHandler.test.ts、
    // tests/background/senderValidation.test.ts），这里不声称验证过它。
    await expect(dialog).toBeVisible();
    await expect(row(panel, 'e2e-quick-user')).toHaveCount(0);
    expect(await storedArrayCount(panel, STORAGE_KEYS.PASSWORDS)).toBe(1);
  });

  test('管理页新增条目后，已打开的面板经 storage 监听即时刷新', async ({ extContext, extensionId, optionsPage }) => {
    await createEntry(optionsPage, SITE_ENTRY);
    const { panel } = await openSidepanelOnSite(extContext, extensionId);
    await expect(rows(panel)).toHaveCount(1);

    // 空 URL 的通用条目在「本站」范围内始终展示，用它验证刷新不必先切范围
    await createEntry(optionsPage, GENERIC_ENTRY);
    await expect(row(panel, GENERIC_ENTRY.username)).toBeVisible();
    await expect(rows(panel)).toHaveCount(2);
  });
});

/**
 * 与停靠态的三处已知差异（刻意不覆盖，避免写出「测了但没测」的断言）：
 * 1. 填充成功后面板收起：停靠态由 `chrome.sidePanel.close()` 直接收，标签页形态下它会以
 *    「No active tab-specific side panel」落入预期错误分支，实际生效的是同一条链路上
 *    background 经 port 发来的 `CLOSE_SIDEPANEL` → 面板 `window.close()`。结果一致（面板消失），
 *    但载体不同，所以这里只断言「面板消失了」，不声称验证过 `sidePanel.close` 本身；
 * 2. 列表超过 30 条时的分批放开依赖 rAF，标签页形态下可能被后台节流拖慢——
 *    本文件的用例都在 30 条以内，不受影响，也不声称验证过了大列表首屏；
 * 3. 快速添加的落盘成功路径：`QUICK_ADD_PASSWORD` 的发送方守卫以 `sender.tab` 判定
 *    「扩展内部页面」，停靠面板没有 tab、标签页形态有，因此本文件只能验证到守卫拒绝为止
 *    （见对应用例内的注释），成功路径由 `tests/background/quickAddHandler.test.ts` 覆盖。
 */
