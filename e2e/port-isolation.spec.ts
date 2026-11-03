import type { Locator, Page } from '@playwright/test';
import {
  createEntry,
  expect,
  expectSuccessToast,
  footerPrimary,
  openHeaderDialog,
  openSidepanelOnSite,
  test,
} from './harness';
import { anchoredTextOf, templatedOf, textOf } from './i18n';

/**
 * 端口隔离（portScope: loose / strict）端到端
 *
 * 与 `cross-subdomain.spec.ts` 盯同一段空白：单测证明的是纯函数，
 * 「从弹窗点一下开关，到侧边栏少了几行、芯片出现、临时放宽把行带回来且不让填」
 * 这条跨入口链路只有真机能证。三件事必须同时成立才算这个功能可用：
 * 1. 默认档（`loose`）与功能存在之前逐条一致——老用户升级后看到的列表不变；
 * 2. `strict` 档下可见集真的按端口收窄，且头部端口芯片给出「为什么少了几条」的出口；
 * 3. 临时放宽只放宽显示：被带出的其他端口条目不可直接填充，否则就把 A 端口的密码填进 B 端口的登录框。
 *
 * 夹具域名沿用 `*.e2e.test`（请求被 route 直接 fulfill，不出网、不依赖 DNS），
 * 端口取 8443 / 9090 两个非默认值，另留一条不带端口的条目作「门面地址」对照——
 * 只有它能在 strict 下被「页面在非默认端口」这一条挡住，从而与 `:9090` 那条区分开成因。
 */

/** 被测站点：带非默认端口，strict 档下端口芯片应当出现 */
const CURRENT_ORIGIN = 'https://port.e2e.test:8443';

const SAME_PORT_ENTRY = {
  username: 'e2e-port-same',
  password: 'Synthetic!Port1',
  url: `${CURRENT_ORIGIN}/login`,
};
/** 同主机、不同端口：strict 档下必须看不见 */
const OTHER_PORT_ENTRY = {
  username: 'e2e-port-other',
  password: 'Synthetic!Port2',
  url: 'https://port.e2e.test:9090/',
};
/** 同主机、未写端口：strict 档下只在协议默认端口可见，因此本页应被挡住 */
const NO_PORT_ENTRY = { username: 'e2e-port-plain', password: 'Synthetic!Port3', url: 'https://port.e2e.test/' };

/** 端口单选块：与档位共用 `.domain-match-option`，按整块文本定位（label 与 desc 同在一个节点内） */
const portOption = (dialog: Locator, labelKey: string) =>
  dialog.locator('.domain-match-option', { hasText: textOf(labelKey) });

/**
 * 经真实的「跨子域名匹配」弹窗改端口档
 *
 * 不直接写 `storage.local`：设置项的入口、单选、保存提示与落盘键是这个功能的一半，
 * 绕过去就只剩「匹配函数正确」，而那是单测已经证过的部分。
 */
async function setPortScope(optionsPage: Page, labelKey: string): Promise<void> {
  const dialog = await openHeaderDialog(optionsPage, 'options.header.securitySettings', 'options.header.domainMatch');
  await portOption(dialog, labelKey).click();
  await footerPrimary(dialog).click();
  await expectSuccessToast(optionsPage, 'options.domainMatch.saved');
  await expect(dialog).toBeHidden();
}

const rows = (panel: Page) => panel.locator('.password-item');
const row = (panel: Page, username: string) => rows(panel).filter({ hasText: username });
/** 端口芯片：只在 strict 且当前页确实带非默认端口时渲染 */
const portChip = (panel: Page) => panel.locator('.port-pill');
/** 芯片里的状态字（放宽前「已按端口隔离」/ 放宽后「已显示全部端口」），与端口号分节点渲染 */
const portChipState = (panel: Page) => portChip(panel).locator('.port-pill__state');
/** 「其他端口」徽章（与跨子域徽章共用 `.scope-badge`，按文案区分） */
const otherPortBadge = (panel: Page, username: string) =>
  row(panel, username).locator('.scope-badge', { hasText: textOf('sidepanel.scope.otherPort') });

/**
 * 三条用例各要跑完「2-3 次经表单录入 → 侧边栏首屏 → 一次切档 / 一次点芯片」。
 * 预算口径与 `cross-subdomain.spec.ts` 一致：侧边栏首屏在机器被抢占时实测可拖到 31s，
 * 默认 90s 铺不满最坏叠加，因此只上调时长，断言与判据一概不动。
 */
test.describe.configure({ timeout: 150_000 });

test.describe('端口隔离', () => {
  test('默认 loose 档：同域名不同端口的条目互相可见（与功能引入前一致）', async ({
    extContext,
    extensionId,
    optionsPage,
  }) => {
    await createEntry(optionsPage, SAME_PORT_ENTRY);
    await createEntry(optionsPage, OTHER_PORT_ENTRY);
    await createEntry(optionsPage, NO_PORT_ENTRY);

    const { panel } = await openSidepanelOnSite(extContext, extensionId, undefined, CURRENT_ORIGIN);

    await expect(rows(panel)).toHaveCount(3);
    // 端口轴未开启时不该出现任何端口呈现：芯片与「其他端口」徽章都必须缺席
    await expect(portChip(panel)).toHaveCount(0);
    await expect(panel.locator('.scope-badge')).toHaveCount(0);

    await testInfoScreenshot(panel, 'loose-all-visible');
  });

  test('strict 档：只留同端口条目，端口芯片给出当前端口', async ({ extContext, extensionId, optionsPage }) => {
    await createEntry(optionsPage, SAME_PORT_ENTRY);
    await createEntry(optionsPage, OTHER_PORT_ENTRY);
    await createEntry(optionsPage, NO_PORT_ENTRY);
    await setPortScope(optionsPage, 'options.domainMatch.portStrict');

    const { panel } = await openSidepanelOnSite(extContext, extensionId, undefined, CURRENT_ORIGIN);

    await expect(rows(panel)).toHaveCount(1);
    await expect(row(panel, SAME_PORT_ENTRY.username)).toBeVisible();
    await expect(row(panel, OTHER_PORT_ENTRY.username)).toHaveCount(0);
    await expect(row(panel, NO_PORT_ENTRY.username)).toHaveCount(0);

    // 芯片文案即当前端口，且几何上落在域名行内（信息就近原则，不是另起一行）
    await expect(portChip(panel)).toHaveCount(1);
    await expect(portChip(panel)).toContainText(':8443');
    const chipBox = await portChip(panel).boundingBox();
    const urlBox = await panel.locator('.current-url').boundingBox();
    expect(chipBox).not.toBeNull();
    expect(urlBox).not.toBeNull();
    expect(chipBox!.x).toBeGreaterThanOrEqual(urlBox!.x);
    expect(chipBox!.y + chipBox!.height).toBeLessThanOrEqual(urlBox!.y + urlBox!.height + 1);

    await testInfoScreenshot(panel, 'strict-only-same-port');
  });

  test('点芯片临时放宽：其他端口的条目被带回且不可直接填充', async ({ extContext, extensionId, optionsPage }) => {
    await createEntry(optionsPage, SAME_PORT_ENTRY);
    await createEntry(optionsPage, OTHER_PORT_ENTRY);
    await createEntry(optionsPage, NO_PORT_ENTRY);
    await setPortScope(optionsPage, 'options.domainMatch.portStrict');

    const { panel } = await openSidepanelOnSite(extContext, extensionId, undefined, CURRENT_ORIGIN);
    await expect(rows(panel)).toHaveCount(1);

    await portChip(panel).click();
    await expect(rows(panel)).toHaveCount(3);
    // 放宽态的芯片文案随之翻转，用户能看出自己此刻看的是「全部端口」
    await expect(portChipState(panel)).toHaveText(anchoredTextOf('sidepanel.scope.portRelaxed'));

    // 带出的两条都标了来源，未标的那条才是能填的
    await expect(otherPortBadge(panel, OTHER_PORT_ENTRY.username)).toHaveCount(1);
    await expect(otherPortBadge(panel, NO_PORT_ENTRY.username)).toHaveCount(1);
    await expect(row(panel, SAME_PORT_ENTRY.username).locator('.scope-badge')).toHaveCount(0);

    // 降级即「不可填充当前页」：整行动作的无障碍文案从「填充」翻成「打开站点」
    await expect(row(panel, SAME_PORT_ENTRY.username)).toHaveAttribute(
      'aria-label',
      anchoredTextOf('sidepanel.item.fillTitle'),
    );
    await expect(row(panel, OTHER_PORT_ENTRY.username)).toHaveAttribute(
      'aria-label',
      anchoredTextOf('sidepanel.item.openSiteTitle'),
    );

    // 排序即归属：同端口那条仍占首位，另两条沉到末尾（「首条即可填充」不因放宽而失守，
    // 一键填充与内联下拉走的是持久化策略，本就更窄）
    await expect(rows(panel).nth(0)).toContainText(SAME_PORT_ENTRY.username);
    await expect(rows(panel).nth(1)).toHaveCount(1);
    await expect(rows(panel).nth(2)).toHaveCount(1);

    await testInfoScreenshot(panel, 'relaxed-rows-revealed');

    // 再点一次收回：放宽是本站临时态，不是第二个隐藏开关
    await portChip(panel).click();
    await expect(rows(panel)).toHaveCount(1);
  });

  test('本站被端口全部挡空时，空态给出「显示其他端口」的出口', async ({ extContext, extensionId, optionsPage }) => {
    // 只录一条别的端口的账号：strict 下本站一条都不剩，空态必须解释「不是插件坏了」
    await createEntry(optionsPage, OTHER_PORT_ENTRY);
    await setPortScope(optionsPage, 'options.domainMatch.portStrict');

    const { panel } = await openSidepanelOnSite(extContext, extensionId, undefined, CURRENT_ORIGIN);
    await expect(rows(panel)).toHaveCount(0);

    const hint = panel.locator('.cross-domain-hint').filter({
      hasText: templatedOf('sidepanel.scope.portHiddenHint', { count: 1 }),
    });
    await expect(hint).toHaveCount(1);
    await hint.click();

    await expect(rows(panel)).toHaveCount(1);
    await expect(otherPortBadge(panel, OTHER_PORT_ENTRY.username)).toHaveCount(1);

    await testInfoScreenshot(panel, 'empty-state-port-hint');
  });
});

/**
 * 把当前状态截图归档到 Playwright 的 output 目录（仓库内 `test-results/`），
 * 让「列表少了几行 / 芯片出现在哪里」这类呈现结论留下可比对的凭据，而不是只有断言通过记录。
 */
async function testInfoScreenshot(page: Page, name: string): Promise<void> {
  const file = `test-results/artifacts/port-isolation-${name}.png`;
  const body = await page.screenshot({ path: file, fullPage: true });
  await test.info().attach(`port-isolation-${name}`, { body, contentType: 'image/png' });
}
