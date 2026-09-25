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
import { textOf } from './i18n';

/**
 * 跨子域名匹配三档（off / wildcard / sameMainDomain）端到端
 *
 * 单元测试把 `resolveMatchTier` 的每条分支都钉住了，但「真机上切档到底改变了什么」
 * 需要一条跨入口证据：档位从 Options 弹窗落盘 → 已打开的面板经 storage 监听改判 →
 * 列表可见集与来源徽章随之变化，且全程不重新验证主密码。这一段没有单测能覆盖
 * （单测里 storage、消息与 Vue 响应式全是桩），本 spec 专门盯它。
 *
 * 夹具域名的取法有两个约束：
 * - `*.e2e.test` 整个后缀的主域名都是 `e2e.test`，所以「兄弟子域 / apex / 通配」
 *   三种层级天然齐备（`e2e.test` 自身即 apex，不需要额外的根域）；
 * - 必须留一条**不同主域**的对照条目，否则「放宽」与「没放宽」看起来一样。
 *   它指向 `elsewhere.example`，只是个字符串、不会被访问。
 */

/** 被测站点：与 uat 同主域、互为兄弟子域 */
const CURRENT_ORIGIN = 'https://uat.cross-subdomain.e2e.test';

const EXACT_ENTRY = {
  username: 'e2e-tier-exact',
  password: 'Synthetic!Tier1',
  url: `${CURRENT_ORIGIN}/login`,
};
/** 与当前站点同主域的其他子域（tier 3）——多测试环境隔离要挡住的就是它 */
const SIBLING_ENTRY = {
  username: 'e2e-tier-sibling',
  password: 'Synthetic!Tier2',
  url: 'https://fat.cross-subdomain.e2e.test/',
};
/** 同主域 apex（tier 2）：`e2e.test` 就是这一批主机的主域名 */
const APEX_ENTRY = { username: 'e2e-tier-apex', password: 'Synthetic!Tier3', url: 'https://e2e.test/' };
/** 通配条目（tier 1），录入形态与 `utils/domain.ts` 的 `*.qq.com` 口径一致 */
const WILDCARD_ENTRY = { username: 'e2e-tier-wild', password: 'Synthetic!Tier4', url: '*.e2e.test' };
/** 不同主域的对照条目：三档下都不该出现 */
const FOREIGN_ENTRY = { username: 'e2e-tier-other', password: 'Synthetic!Tier5', url: 'https://elsewhere.example/' };

/** 档位弹窗里的某个选项（label 与 desc 同在一个 `.domain-match-option` 内，按整块文本定位） */
const tierOption = (dialog: Locator, labelKey: string) =>
  dialog.locator('.domain-match-option', { hasText: textOf(labelKey) });

/**
 * 经真实的「跨子域名匹配」弹窗改档位
 *
 * 不直接写 `storage.local`：入口、单选、保存提示与落盘键这一整段是档位功能的
 * 一半，绕过去就只剩「匹配函数正确」，而那是单元测试已经证过的部分。
 *
 * 用子串而非 `anchoredTextOf`：整块里 label 与 desc 并存，锚定整串命不中。三个档位文案
 * 一旦改成互为子串，`hasText` 会命中两个节点、strict mode 当场报错，不会静默选错档位。
 */
async function setDomainMatchTier(optionsPage: Page, labelKey: string): Promise<void> {
  const dialog = await openHeaderDialog(optionsPage, 'options.header.securitySettings', 'options.header.domainMatch');
  await tierOption(dialog, labelKey).click();
  await footerPrimary(dialog).click();
  await expectSuccessToast(optionsPage, 'options.domainMatch.saved');
  await expect(dialog).toBeHidden();
}

/** 录满五个档位的条目：主域四层级 + 一条外域对照 */
async function seedTierEntries(optionsPage: Page): Promise<void> {
  for (const entry of [EXACT_ENTRY, SIBLING_ENTRY, APEX_ENTRY, WILDCARD_ENTRY, FOREIGN_ENTRY]) {
    await createEntry(optionsPage, entry);
  }
}

const rows = (panel: Page) => panel.locator('.password-item');
const row = (panel: Page, username: string) => rows(panel).filter({ hasText: username });
/** 跨子域来源徽章：只在 tier 1~3 的行上出现 */
const badge = (panel: Page, username: string) => row(panel, username).locator('.scope-badge');
/** 带来源徽章的整行——徽章只作为行内元素渲染，数行数即数「有几条被标了来源」 */
const rowsWithBadge = (panel: Page) => panel.locator('.password-item:has(.scope-badge)');

/**
 * 本文件的用例各要跑完「5 次经表单录入 → 侧边栏首屏 → 一次切档」。
 * 录入的固定成本来自 `expectSuccessToastFor` 的基线归零（每条最多约 3s），一次切档
 * （开弹窗 + 单选 + 保存提示 + 关闭）实测约 9s，侧边栏首屏在机器被抢占时实测可拖到
 * 31s（见 e2e/README.md），默认 90s 预算不够铺满三条用例的最坏叠加。
 * 因此只上调本文件的时长预算，断言与判据一概不动。
 */
test.describe.configure({ timeout: 150_000 });

test.describe('跨子域名匹配档位', () => {
  test('默认 off 档：只有精确 host 可见，兄弟子域与通配都被挡住', async ({ extContext, extensionId, optionsPage }) => {
    await seedTierEntries(optionsPage);
    const { panel } = await openSidepanelOnSite(extContext, extensionId, undefined, CURRENT_ORIGIN);

    await expect(row(panel, EXACT_ENTRY.username)).toBeVisible();
    await expect(rows(panel)).toHaveCount(1);
    await expect(row(panel, SIBLING_ENTRY.username)).toHaveCount(0);
    await expect(row(panel, WILDCARD_ENTRY.username)).toHaveCount(0);
    await expect(row(panel, APEX_ENTRY.username)).toHaveCount(0);
    // 精确条目不带来源徽章：它不是放宽带出来的
    await expect(badge(panel, EXACT_ENTRY.username)).toHaveCount(0);
  });

  test('wildcard 档：额外放行通配条目，排在精确之后并带来源徽章', async ({ extContext, extensionId, optionsPage }) => {
    await seedTierEntries(optionsPage);
    await setDomainMatchTier(optionsPage, 'options.domainMatch.wildcard');
    const { panel } = await openSidepanelOnSite(extContext, extensionId, undefined, CURRENT_ORIGIN);

    await expect(rows(panel)).toHaveCount(2);
    await expect(row(panel, EXACT_ENTRY.username)).toBeVisible();
    await expect(row(panel, WILDCARD_ENTRY.username)).toBeVisible();
    // apex 与兄弟子域仍属同主域档，通配档不该带出它们
    await expect(row(panel, APEX_ENTRY.username)).toHaveCount(0);
    await expect(row(panel, SIBLING_ENTRY.username)).toHaveCount(0);
    await expect(row(panel, FOREIGN_ENTRY.username)).toHaveCount(0);

    // 排序即层级：精确在前、通配在后（档位优先级同时就是列表顺序）
    await expect(rows(panel).nth(0)).toContainText(EXACT_ENTRY.username);
    await expect(rows(panel).nth(1)).toContainText(WILDCARD_ENTRY.username);
    await expect(badge(panel, WILDCARD_ENTRY.username)).toHaveText(textOf('sidepanel.scope.crossSubdomain'));
    // 只有放宽带出的那一条被标来源，精确条目不带
    await expect(rowsWithBadge(panel)).toHaveCount(1);
  });

  test('sameMainDomain 档：四层级按 tier 排序，且切档不重新验证主密码', async ({
    extContext,
    extensionId,
    optionsPage,
  }) => {
    await seedTierEntries(optionsPage);
    const { panel } = await openSidepanelOnSite(extContext, extensionId, undefined, CURRENT_ORIGIN);

    // 先在 off 档确立「兄弟子域不可见」，再切档让它变可见：改判本身就是断言
    await expect(rows(panel)).toHaveCount(1);
    await expect(row(panel, SIBLING_ENTRY.username)).toHaveCount(0);

    await setDomainMatchTier(optionsPage, 'options.domainMatch.sameMainDomain');

    await expect(row(panel, SIBLING_ENTRY.username)).toBeVisible();
    await expect(rows(panel)).toHaveCount(4);
    await expect(row(panel, FOREIGN_ENTRY.username)).toHaveCount(0);

    // 层级顺序：精确 0 → 通配 1 → apex 2 → 兄弟子域 3
    const order = [EXACT_ENTRY, WILDCARD_ENTRY, APEX_ENTRY, SIBLING_ENTRY].map(e => e.username);
    for (const [index, username] of order.entries()) {
      await expect(rows(panel).nth(index)).toContainText(username);
    }
    // 三条放宽带出的条目都标注来源，精确条目不标
    for (const username of [WILDCARD_ENTRY, APEX_ENTRY, SIBLING_ENTRY].map(e => e.username)) {
      await expect(badge(panel, username)).toHaveText(textOf('sidepanel.scope.crossSubdomain'));
    }
    await expect(badge(panel, EXACT_ENTRY.username)).toHaveCount(0);
    // 恰好三条放宽带出的条目被标来源，精确条目不标
    await expect(rowsWithBadge(panel)).toHaveCount(3);

    /**
     * 切档只改判可见性，不得触碰会话：主密码弹窗一旦冒出，说明档位被当成了
     * 缓存失效键（历史缺陷类别），用户每切一次档就要重验一次。
     */
    await expect(panel.getByPlaceholder(textOf('auth.verifyPasswordPlaceholder'))).toHaveCount(0);
    await expect(panel.locator('.auth-card')).toHaveCount(0);
    // 面板始终是同一个页面实例：改档没有引发重建，走的是 storage 监听的原地改判
    expect(panel.isClosed()).toBe(false);
  });
});
