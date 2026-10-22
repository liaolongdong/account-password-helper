import type { Page } from '@playwright/test';
import { createEntry, expect, openSidepanelOnSite, test } from './harness';
import { anchoredTextOf, textOf } from './i18n';

/**
 * 本地开发端点的站点范围端到端
 *
 * 单测钉的是纯函数，这里钉真机上那条跨入口链路：内容脚本上报的域名来自 `sender.tab.url`、
 * 侧边栏的本站列表、头部端口芯片、临时放宽后的降级呈现。四件事必须同时成立：
 * 1. 本地页面**不再**列出别的域名的账号——改前 `127.0.0.1:3000` 会把 `foreign.e2e.test`
 *    （未写端口）当本站且当可填充，那是跨 origin 的凭证外填；
 * 2. `localhost` 与 `127.0.0.1` 互认为同一台机器：同端口的账号在两种写法下都出现；
 * 3. 同主机但别的端口仍被挡住，但芯片给出「另有 N 条」的出口，点开后条目只可复制与打开站点；
 * 4. 网址写成 `localhost:*` 的条目在本机任意端口可见（用户逐条授权跨端口复用）。
 *
 * 夹具页面走 route fulfill，不出网也不依赖 DNS；端口取 3000 / 4000 两个非默认值。
 */

/** 被测端点：与条目网址同为 3000，但主机写法不同（127.0.0.1 vs localhost） */
const PAGE_127_3000 = 'http://127.0.0.1:3000';
/** 反向端点：主机写作 localhost，端口 4000 */
const PAGE_LOCAL_4000 = 'http://localhost:4000';

const LOOP_3000 = { username: 'e2e-loop-3000', password: 'Synthetic!Lp1', url: 'http://localhost:3000/login' };
const FOREIGN_PLAIN = { username: 'e2e-foreign-plain', password: 'Synthetic!Lp2', url: 'https://foreign.e2e.test/' };
const FOREIGN_3000 = {
  username: 'e2e-foreign-3000',
  password: 'Synthetic!Lp3',
  url: 'https://foreign.e2e.test:3000/',
};
const LOOP_4000 = { username: 'e2e-loop-4000', password: 'Synthetic!Lp4', url: 'http://localhost:4000/' };
const LOOP_ANY_PORT = { username: 'e2e-loop-anyport', password: 'Synthetic!Lp5', url: 'localhost:*' };
const ALT_4000 = { username: 'e2e-alt-4000', password: 'Synthetic!Lp6', url: 'http://127.0.0.1:4000/' };

const rows = (panel: Page) => panel.locator('.password-item');
const row = (panel: Page, username: string) => rows(panel).filter({ hasText: username });
const portChip = (panel: Page) => panel.locator('.port-pill');
const portChipState = (panel: Page) => portChip(panel).locator('.port-pill__state');
const otherPortBadge = (panel: Page, username: string) =>
  row(panel, username).locator('.scope-badge', { hasText: textOf('sidepanel.scope.otherPort') });

/** 侧边栏首屏在机器被抢占时可拖到 31s，只上调时长，断言与判据不动 */
test.describe.configure({ timeout: 150_000 });

test.describe('本地开发端点的站点范围', () => {
  test('127.0.0.1:3000 页面：只列本机同端点条目，外站条目缺席，芯片给出被端口挡住的出口', async ({
    extContext,
    extensionId,
    optionsPage,
  }) => {
    await createEntry(optionsPage, LOOP_3000);
    await createEntry(optionsPage, FOREIGN_PLAIN);
    await createEntry(optionsPage, FOREIGN_3000);
    await createEntry(optionsPage, LOOP_4000);

    const { panel } = await openSidepanelOnSite(extContext, extensionId, undefined, PAGE_127_3000);

    // 环回别名：条目存成 localhost:3000，页面是 127.0.0.1:3000，仍算同一端点
    await expect(row(panel, LOOP_3000.username)).toHaveCount(1);
    // 外站条目两种形态都不许出现：未写端口（曾被当通用条目）与端口恰好相同（曾被当同端点）
    await expect(row(panel, FOREIGN_PLAIN.username)).toHaveCount(0);
    await expect(row(panel, FOREIGN_3000.username)).toHaveCount(0);
    // 同主机不同端口：默认档下仍隔离
    await expect(row(panel, LOOP_4000.username)).toHaveCount(0);
    await expect(rows(panel)).toHaveCount(1);

    // 芯片即「不是插件坏了，是被端口挡住了」的出口：本地页面在缺省档也会出现
    await expect(portChip(panel)).toHaveCount(1);
    await expect(portChip(panel)).toContainText(':3000');

    await screenshot(panel, 'local-foreign-absent-chip');

    await portChip(panel).click();
    await expect(rows(panel)).toHaveCount(2);
    await expect(otherPortBadge(panel, LOOP_4000.username)).toHaveCount(1);
    await expect(portChipState(panel)).toHaveText(anchoredTextOf('sidepanel.scope.portRelaxed'));
    // 放宽只放宽显示：被带出的条目整行动作从「填充」翻成「打开站点」
    await expect(row(panel, LOOP_4000.username)).toHaveAttribute(
      'aria-label',
      anchoredTextOf('sidepanel.item.openSiteTitle'),
    );
    await expect(row(panel, LOOP_3000.username)).toHaveAttribute(
      'aria-label',
      anchoredTextOf('sidepanel.item.fillTitle'),
    );
    // 首条仍是可填充的同端点条目：一键填充取首条这条约定不因放宽而失守
    await expect(rows(panel).nth(0)).toContainText(LOOP_3000.username);

    await screenshot(panel, 'local-relaxed');
  });

  test('localhost:4000 页面：`localhost:*` 条目跨端口可见，127.0.0.1 同端口条目经别名可见', async ({
    extContext,
    extensionId,
    optionsPage,
  }) => {
    await createEntry(optionsPage, LOOP_ANY_PORT);
    await createEntry(optionsPage, ALT_4000);
    await createEntry(optionsPage, LOOP_3000);

    const { panel } = await openSidepanelOnSite(extContext, extensionId, undefined, PAGE_LOCAL_4000);

    // 逐条声明的跨端口条目在本机另一个端口出现，且没有被标「其他端口」（它本就覆盖所有端口）
    await expect(row(panel, LOOP_ANY_PORT.username)).toHaveCount(1);
    await expect(otherPortBadge(panel, LOOP_ANY_PORT.username)).toHaveCount(0);
    // 反向别名：条目存成 127.0.0.1:4000，页面写的是 localhost:4000
    await expect(row(panel, ALT_4000.username)).toHaveCount(1);
    // 别的端口的精确条目依旧隔离，芯片才有意义
    await expect(row(panel, LOOP_3000.username)).toHaveCount(0);
    await expect(portChip(panel)).toContainText(':4000');

    await screenshot(panel, 'local-port-wildcard-and-reverse-alias');
  });
});

/** 把当前状态截图归档，让「哪几行进来了、芯片在哪儿」留下可比对的凭据而不只是断言通过 */
async function screenshot(page: Page, name: string): Promise<void> {
  const target = `test-results/artifacts/local-dev-site-scope-${name}.png`;
  const body = await page.screenshot({ path: target, fullPage: true });
  await test.info().attach(`local-dev-site-scope-${name}`, { body, contentType: 'image/png' });
}
