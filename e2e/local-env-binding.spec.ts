import type { Page } from '@playwright/test';
import { createEntry, expect, openSidepanelOnSite, test } from './harness';
import { textOf } from './i18n';

/**
 * 本地开发页「选环境」芯片端到端
 *
 * 单测钉的是纯函数与存储层，这里钉真机上那条跨上下文链路：侧边栏点选 → 后台 `storage.session`
 * → 本站列表与行内徽章，以及**面板重开后仍按同一条绑定呈现**。四件事必须同时成立：
 *
 * 1. 芯片只在环回页面出现，未绑定时本地页**不列**远端环境的账号（那是上一轮修掉的越界外填）；
 * 2. 选 fat 之后 fat 的条目进列表、带来源徽章，而本机端点自己的账号一条不少——并集，不是替换；
 * 3. 生产候选（`prod.` 前缀）第一次点必须经过确认条，确认之前不生效；
 * 4. 绑定活在同一浏览器会话里：重新加载侧边栏仍然按同一条绑定列出账号（换浏览器进程即清，
 *    那一条属重启语义，不在 e2e 里造）。
 *
 * 夹具页面走 route fulfill，不出网也不依赖 DNS；条目里的 `fat.example.com` 只是库里的一行网址，
 * 不需要真的可访问。
 */

// 夹具走 127.0.0.1 而非 `localhost`：本机 e2e 环境里 `http://localhost:<port>` 的 route fulfill
// 拿不到首屏域名（既有 `local-dev-site-scope.spec.ts` 同样只用 127.0.0.1 起步）。
// 别名折叠让两者在插件眼里是同一端点，因此这里的断言与用 `localhost` 等价。
const PAGE_LOCAL_3000 = 'http://127.0.0.1:3000';

const LOCAL_ACC = { username: 'e2e-env-local', password: 'Synthetic!Ev1', url: 'http://localhost:3000/login' };
const FAT_ACC = { username: 'e2e-env-fat', password: 'Synthetic!Ev2', url: 'fat.example.com' };
const DEV_ACC = { username: 'e2e-env-dev', password: 'Synthetic!Ev3', url: 'dev.example.com' };
const PROD_ACC = { username: 'e2e-env-prod', password: 'Synthetic!Ev4', url: 'prod.example.com' };

const rows = (panel: Page) => panel.locator('.password-item');
const row = (panel: Page, username: string) => rows(panel).filter({ hasText: username });
const envChip = (panel: Page) => panel.locator('.env-pill');
const envBar = (panel: Page) => panel.locator('.env-bar');
const envOption = (panel: Page, label: string | RegExp) => envBar(panel).locator('.env-bar__opt', { hasText: label });
const envConfirm = (panel: Page) => panel.locator('.env-confirm');
const envConfirmYes = (panel: Page) => envConfirm(panel).locator('.env-confirm__btn--yes');
const envBadge = (panel: Page, username: string) => row(panel, username).locator('.scope-badge', { hasText: '·' });

/** 侧边栏首屏在机器被抢占时可拖到 31s，只上调时长，断言与判据不动 */
test.describe.configure({ timeout: 180_000 });

test.describe('本地页环境绑定', () => {
  test('未绑定不列远端账号；选 fat 后其条目带来源徽章进站，本机条目一条不少', async ({
    extContext,
    extensionId,
    optionsPage,
  }) => {
    await createEntry(optionsPage, LOCAL_ACC);
    await createEntry(optionsPage, FAT_ACC);
    await createEntry(optionsPage, DEV_ACC);

    const { panel } = await openSidepanelOnSite(extContext, extensionId, undefined, PAGE_LOCAL_3000);

    await expect(row(panel, LOCAL_ACC.username)).toBeVisible();
    await expect(row(panel, FAT_ACC.username)).toHaveCount(0);
    await expect(envChip(panel)).toHaveText(textOf('sidepanel.env.pick'));

    await envChip(panel).click();
    await expect(envBar(panel)).toBeVisible();
    await expect(envOption(panel, 'fat')).toBeVisible();
    await expect(envOption(panel, 'dev')).toBeVisible();

    await envOption(panel, 'fat').click();
    await expect(envBar(panel)).toHaveCount(0);
    await expect(envChip(panel)).toContainText('fat · example.com');
    await expect(row(panel, FAT_ACC.username)).toBeVisible();
    await expect(row(panel, DEV_ACC.username)).toHaveCount(0);
    // 并集：本机那条不会因为绑了 fat 而消失
    await expect(row(panel, LOCAL_ACC.username)).toBeVisible();
    // 来源徽章只挂在被绑定带入的那条上
    await expect(envBadge(panel, FAT_ACC.username)).toContainText('fat · example.com');
    await expect(row(panel, LOCAL_ACC.username).locator('.scope-badge', { hasText: '·' })).toHaveCount(0);

    // 收回：再点一次当前环境
    await envChip(panel).click();
    await envOption(panel, 'fat').click();
    await expect(envChip(panel)).toHaveText(textOf('sidepanel.env.pick'));
    await expect(row(panel, FAT_ACC.username)).toHaveCount(0);
    await expect(row(panel, LOCAL_ACC.username)).toBeVisible();
  });

  test('生产候选第一次点必须先确认，确认前不生效', async ({ extContext, extensionId, optionsPage }) => {
    await createEntry(optionsPage, LOCAL_ACC);
    await createEntry(optionsPage, PROD_ACC);

    const { panel } = await openSidepanelOnSite(extContext, extensionId, undefined, PAGE_LOCAL_3000);

    await envChip(panel).click();
    await envOption(panel, 'prod').click();

    // 确认条出现，绑定尚未生效
    await expect(envConfirm(panel)).toBeVisible();
    await expect(row(panel, PROD_ACC.username)).toHaveCount(0);
    await expect(envChip(panel)).toHaveText(textOf('sidepanel.env.pick'));

    await envConfirmYes(panel).click();
    await expect(envConfirm(panel)).toHaveCount(0);
    await expect(envChip(panel)).toContainText('prod · example.com');
    await expect(row(panel, PROD_ACC.username)).toBeVisible();
  });

  test('绑定在同一浏览器会话内跨面板重开保持（事实来源是后台，不是面板内存）', async ({
    extContext,
    extensionId,
    optionsPage,
  }) => {
    await createEntry(optionsPage, LOCAL_ACC);
    await createEntry(optionsPage, FAT_ACC);

    const { panel } = await openSidepanelOnSite(extContext, extensionId, undefined, PAGE_LOCAL_3000);
    await envChip(panel).click();
    await envOption(panel, 'fat').click();
    await expect(row(panel, FAT_ACC.username)).toBeVisible();

    await panel.reload();
    await expect(row(panel, LOCAL_ACC.username)).toBeVisible();
    await expect(envChip(panel)).toContainText('fat · example.com');
    await expect(row(panel, FAT_ACC.username)).toBeVisible();
  });
});
