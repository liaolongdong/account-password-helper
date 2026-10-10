import type { Locator, Page } from '@playwright/test';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { expect, runHeaderCommand, storedArrayCount, test } from './harness';
import { textOf } from './i18n';

/**
 * 管理页「按站点筛选」（自动归类视图的真机回归）
 *
 * 单测钉的是算法与接线（`siteUtils` / `siteFilterWiring`），证明不了只有真浏览器才成立的三件事：
 * ① 候选下拉**真的渲染得出来**——站点下拉用的是虚拟列表 `el-select-v2`，它的 `:props` 字段映射、
 *    自定义 option 插槽、`.el-select-dropdown__item` 类名都是 Element Plus 内部约定，
 *    任一条对不上，用户看到的就是一个空面板或一个点不动的控件；
 * ② 多种网址写法在真实数据上确实落进同一个桶（条目经导入落盘为密文，读出来才参与归一）；
 * ③ 选站后主表的行数与内容跟着变，而不是「筛选算了但没接到 `el-table`」。
 *
 * 前置数据沿用 `pagination.spec.ts` 的做法：走真实的「数据管理 → 导入数据」入口灌入。
 */

/** 三个站的条目数刻意各不相等，候选排序（条目数倒序）才有可判定的读数 */
const SITES = { alpha: 6, beta: 4, gamma: 2 } as const;
const TOTAL = SITES.alpha + SITES.beta + SITES.gamma;

/** 合成凭据：RFC 2606 保留域，与任何真实账号无关 */
const domainOf = (letter: string) => `${letter}.e2e-sf.test`;

/** alpha 刻意用三种写法（完整 URL / 纯域名 / 带端口），用来证明归一后同桶；前 3 条挂标签供叠加断言 */
const CSV = [
  'username,password,url,tag,remark',
  ...Array.from({ length: SITES.alpha }, (_, i) => {
    const url = [`https://${domainOf('alpha')}/login`, domainOf('alpha'), `http://${domainOf('alpha')}:8080/dashboard`][
      i % 3
    ];
    return `e2e-sf-a${i + 1},Synthetic!A${i + 1},${url},${i < 3 ? 'sfwork' : ''},`;
  }),
  ...Array.from(
    { length: SITES.beta },
    (_, i) => `e2e-sf-b${i + 1},Synthetic!B${i + 1},https://${domainOf('beta')}/x,,`,
  ),
  ...Array.from({ length: SITES.gamma }, (_, i) => `e2e-sf-g${i + 1},Synthetic!G${i + 1},${domainOf('gamma')},,`),
].join('\n');

/**
 * 主表格行
 *
 * 与 `pagination.spec.ts` 同理：导入弹窗的预览区本身也是一张 `el-table`，按容器收窄才不把预览行算进来。
 */
const mainRows = (page: Page): Locator => page.locator('.password-list tr.el-table__row');

/** 站点下拉的触发器（`.site-filter` 是组件自挂的类，宽度固定 220px） */
const siteSelect = (page: Page): Locator => page.locator('.filters .site-filter');
const tagSelect = (page: Page): Locator => page.locator('.filters .tag-filter');

/**
 * 站点候选面板
 *
 * 按面板里**只有本组件渲染的 `.site-option` 结构**来收窄，而不是按 `.el-select-dropdown` 类名——
 * 页面上同时挂着标签下拉、页码档位下拉等多份面板残留，类名是 Element Plus 的共享命名。
 */
const sitePopper = (page: Page): Locator =>
  page.locator('.el-popper:visible').filter({ has: page.locator('.site-option') });

const siteOption = (page: Page, site: string): Locator =>
  sitePopper(page).locator('.el-select-dropdown__item').filter({ hasText: site });

/** 展开站点下拉 */
async function openSiteDropdown(page: Page): Promise<void> {
  await siteSelect(page).locator('.el-select__wrapper').click();
  await expect(siteOption(page, domainOf('alpha'))).toBeVisible();
}

/** 走导入入口灌入 12 条，等到候选下拉真的出现 */
async function seedVault(page: Page): Promise<void> {
  await runHeaderCommand(page, 'options.header.data', 'options.header.importData');
  const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.import.title') });
  await expect(dialog).toBeVisible();
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'e2e-site-filter.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf-8') });
  await expect(dialog.locator('.preview-section')).toBeVisible();
  await dialog.locator('.el-dialog__footer .el-button--success').click();
  await expect(dialog).toBeHidden();

  await expect(mainRows(page)).toHaveCount(TOTAL);
  expect(await storedArrayCount(page, STORAGE_KEYS.PASSWORDS)).toBe(TOTAL);
}

test.describe.configure({ timeout: 120_000 });

test.describe('管理页站点筛选', () => {
  test('候选集由条目网址自动汇总：按条目数倒序并带计数', async ({ optionsPage: page }) => {
    await seedVault(page);

    await expect(siteSelect(page)).toBeVisible();
    // 未选中任何站点时显示的是占位文案（候选集不显示在闭合态里）
    await expect(siteSelect(page)).toContainText(textOf('options.filter.sitePlaceholder'));

    await openSiteDropdown(page);
    expect(await sitePopper(page).locator('.site-option__host').allInnerTexts()).toEqual([
      domainOf('alpha'),
      domainOf('beta'),
      domainOf('gamma'),
    ]);
    expect(await sitePopper(page).locator('.site-option__count').allInnerTexts()).toEqual([
      String(SITES.alpha),
      String(SITES.beta),
      String(SITES.gamma),
    ]);
  });

  test('选中站点后主表只留该站条目，同一站的多种网址写法算作一站', async ({ optionsPage: page }) => {
    await seedVault(page);
    await openSiteDropdown(page);

    await siteOption(page, domainOf('alpha')).click();
    await page.keyboard.press('Escape');

    // 6 条全在（完整 URL / 纯域名 / 带端口三种写法同桶），其余两站一条不剩
    await expect(mainRows(page)).toHaveCount(SITES.alpha);
    await expect(mainRows(page).filter({ hasText: `${domainOf('alpha')}:8080` })).toHaveCount(2);
    await expect(mainRows(page).filter({ hasText: domainOf('beta') })).toHaveCount(0);
    await expect(mainRows(page).filter({ hasText: domainOf('gamma') })).toHaveCount(0);
  });

  test('多站之间是或关系，取消到空集合即恢复全量', async ({ optionsPage: page }) => {
    await seedVault(page);
    await openSiteDropdown(page);

    await siteOption(page, domainOf('alpha')).click();
    await expect(mainRows(page)).toHaveCount(SITES.alpha);

    await siteOption(page, domainOf('gamma')).click();
    await expect(mainRows(page)).toHaveCount(SITES.alpha + SITES.gamma);

    await siteOption(page, domainOf('alpha')).click();
    await expect(mainRows(page)).toHaveCount(SITES.gamma);

    // 选中集清空 = 该维度不参与筛选，而不是「筛出一个空集」
    await siteOption(page, domainOf('gamma')).click();
    await page.keyboard.press('Escape');
    await expect(mainRows(page)).toHaveCount(TOTAL);
  });

  test('站点与标签是叠加关系（AND）', async ({ optionsPage: page }) => {
    await seedVault(page);

    await tagSelect(page).locator('.el-select__wrapper').click();
    const tagPopper = page.locator('.el-popper:visible').filter({ hasText: 'sfwork' });
    await tagPopper.locator('.el-select-dropdown__item').filter({ hasText: 'sfwork' }).click();
    await expect(mainRows(page)).toHaveCount(3);

    await openSiteDropdown(page);
    await siteOption(page, domainOf('gamma')).click();
    await page.keyboard.press('Escape');

    // gamma 的两条没有 sfwork 标签：叠加后应当是空表，而不是回落到任一维度
    await expect(mainRows(page)).toHaveCount(0);
  });
});
