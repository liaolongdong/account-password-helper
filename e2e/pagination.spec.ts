import type { Locator, Page } from '@playwright/test';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { DEFAULT_PAGE_SIZE } from '@/utils/vaultPageSize';
import { createEntry, expect, readStoredConfig, runHeaderCommand, storedArrayCount, test } from './harness';
import { templatedOf, textOf } from './i18n';

/**
 * 管理页分页（大 Vault 首屏渲染止血项的真机回归）
 *
 * 单测能证明切片算得对，证明不了三件只有真机才成立的事：
 * ① `el-table` 真的只渲染一页——分页失效最常见的形态就是「算了但没接上」；
 * ② 跨页勾选在换页后仍然亮着。这条能力的全部依赖是 Element Plus 选择列的
 *    `reserve-selection`，它一旦被动过，用户读到的是「翻页把选择丢了」；
 * ③ 新增条目会把用户带到它所在的那一页（新条目按更新时间排在最前，人却可能停在末页）；
 * ④ 每页条数是**落盘的视图偏好**——换档后重载管理页仍是那一档，而页码刻意不回灌（它恒回第 1 页）。
 *
 * 前置数据经真实的「数据管理 → 导入数据」入口灌入：条目在库里是密文，测试进程没有解密
 * 入口，逐条表单录入 250 条会把这条用例拖成分钟级；导入本就是产品给用户的批量入口，
 * 用它造数据同时也验到了它。
 */

/** 造的条目总数：刻意留 50 条余数，末页长度必须不等于页大小 */
const TOTAL = 250;
/** 默认每页条数直接取实现常量，档位改动会立刻在这里变成断言失败而不是静默失配 */
const PAGE_SIZE = DEFAULT_PAGE_SIZE;
const PAGE_COUNT = Math.ceil(TOTAL / PAGE_SIZE);

/** 合成凭据：RFC 2606 保留域，与任何真实账号无关 */
const rowName = (index: number) => `e2e-pg-${String(index).padStart(4, '0')}`;
/** 前一半挂 alpha 域、后一半挂 beta 域，给「筛选后回第 1 页」留一条可数的命中集 */
const rowUrl = (index: number) => `https://${index <= TOTAL / 2 ? 'alpha' : 'beta'}.e2e-pg.test/${index}`;

const CSV = `\u{FEFF}username,password,url
${Array.from({ length: TOTAL }, (_, i) => `${rowName(i + 1)},Synthetic!Pg${i + 1},${rowUrl(i + 1)}`).join('\n')}
`;

/**
 * 主表格行
 *
 * 不复用 harness 的 `allRows` / `rowOf`：导入弹窗的预览区本身也是一张 `el-table`，
 * 而 Element Plus 默认不销毁渲染过的弹窗内容，关闭后那 5 行预览仍挂在 DOM 里。
 * 分页要证明的是「主表只渲染一页」，按容器收窄才不会把预览行算进页长。
 */
const mainRows = (page: Page): Locator => page.locator('.password-list tr.el-table__row');
const mainRowOf = (page: Page, username: string): Locator => mainRows(page).filter({ hasText: username });

/** 分页条与其中的读数区 */
const pager = (page: Page): Locator => page.locator('.password-pagination');
const pagerState = (page: Page): Locator => pager(page).locator('.pagination__state');
const pageButton = (page: Page, label: number) =>
  pager(page).locator('.pagination__page', { hasText: new RegExp(`^${label}$`) });

/** 表头全选框（选择列表头，EP 固定列同属一张 header 表） */
const headerCheckbox = (page: Page): Locator =>
  page.locator('.el-table__header-wrapper th.el-table-column--selection .el-checkbox').first();

const pageOf = (current: number) => templatedOf('options.pagination.pageOf', { current, total: PAGE_COUNT });
const offPageHint = (count: number, offPage: number) =>
  templatedOf('options.pagination.selectedOffPage', { count, offPage });

/** 走导入入口灌入 250 条，等到列表真的分页为止 */
async function seedVault(page: Page): Promise<void> {
  await runHeaderCommand(page, 'options.header.data', 'options.header.importData');
  const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.import.title') });
  await expect(dialog).toBeVisible();
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'e2e-pagination.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf-8') });

  const preview = dialog.locator('.preview-section');
  await expect(preview).toBeVisible();
  await dialog.locator('.el-dialog__footer .el-button--success').click();
  await expect(dialog).toBeHidden();

  await expect(pagerState(page)).toContainText(pageOf(1));
}

/** 取当前页全部行的用户名——分页正确性的最小可观测量：不重、不漏 */
async function usernamesOnPage(page: Page): Promise<string[]> {
  // 用户名固定在第 2 格（第 1 格是勾选框）：按格取文本，因为整行的 textContent
  // 会把各列文本无分隔地拼在一起，切不出用户名
  const cells = await mainRows(page).locator('td:nth-child(2)').allInnerTexts();
  return cells.map(text => text.trim());
}

/** 勾选某一行（EP 的选择框在首列的 `.el-checkbox` 里） */
const toggleRowCheckbox = async (page: Page, username: string): Promise<void> => {
  await mainRowOf(page, username).locator('.el-checkbox').first().click();
};
const rowCheckbox = (page: Page, username: string) => mainRowOf(page, username).locator('.el-checkbox').first();

// 每条用例都要先经导入入口灌 250 条密文，默认 90 秒会在慢机上判死
test.describe.configure({ timeout: 150_000 });

test.describe('管理页分页', () => {
  test('250 条只渲染一页，三页合起来不重不漏', async ({ optionsPage: page }) => {
    await seedVault(page);
    expect(await storedArrayCount(page, STORAGE_KEYS.PASSWORDS)).toBe(TOTAL);

    const seen: string[] = [];
    for (let current = 1; current <= PAGE_COUNT; current++) {
      if (current > 1) await pageButton(page, current).click();
      await expect(pagerState(page)).toContainText(pageOf(current));

      const names = await usernamesOnPage(page);
      expect(names).toHaveLength(current === PAGE_COUNT ? TOTAL - (PAGE_COUNT - 1) * PAGE_SIZE : PAGE_SIZE);
      // 同一页内不重：Set 去重后长度不变
      expect(new Set(names).size).toBe(names.length);
      seen.push(...names);
    }

    // 三页合起来不重不漏：全集恰好是那 250 个用户名
    expect(new Set(seen).size).toBe(TOTAL);
    expect(seen.slice().sort()).toEqual(Array.from({ length: TOTAL }, (_, i) => rowName(i + 1)).sort());
  });

  test('跨页勾选在换页后仍然保留，并如实报出差额', async ({ optionsPage: page }) => {
    await seedVault(page);

    const pickedOnPage1 = (await usernamesOnPage(page))[0]!;
    await toggleRowCheckbox(page, pickedOnPage1);
    await expect(rowCheckbox(page, pickedOnPage1)).toHaveClass(/is-checked/);

    await pageButton(page, 2).click();
    const pickedOnPage2 = (await usernamesOnPage(page))[0]!;
    await toggleRowCheckbox(page, pickedOnPage2);
    await expect(pagerState(page)).toContainText(offPageHint(2, 1));

    await pageButton(page, 1).click();
    // 换页把第 1 页的勾选丢了 = reserve-selection 失效
    await expect(rowCheckbox(page, pickedOnPage1)).toHaveClass(/is-checked/);
    await expect(pagerState(page)).toContainText(offPageHint(2, 1));

    // 批量入口拿到的是跨页全集，而不是「当前页可见的几条」
    await expect(
      page.getByRole('button', { name: templatedOf('options.filter.batchDelete', { count: 2 }) }),
    ).toBeVisible();
  });

  test('表头全选只作用当前页，换页不抹掉它', async ({ optionsPage: page }) => {
    await seedVault(page);

    await headerCheckbox(page).click();
    await expect(mainRows(page).locator('.el-checkbox.is-checked')).toHaveCount(PAGE_SIZE);

    await pageButton(page, 2).click();
    // 当前页一条都没勾，但第 1 页那 100 条仍在选择集里：差额必须说清
    await expect(mainRows(page).locator('.el-checkbox.is-checked')).toHaveCount(0);
    await expect(pagerState(page)).toContainText(offPageHint(PAGE_SIZE, PAGE_SIZE));

    await pageButton(page, 1).click();
    await expect(mainRows(page).locator('.el-checkbox.is-checked')).toHaveCount(PAGE_SIZE);
  });

  test('筛选口径变化回到第 1 页，可见行全部属于命中集', async ({ optionsPage: page }) => {
    await seedVault(page);
    await pageButton(page, 3).click();

    await page.getByPlaceholder(textOf('options.filter.searchPlaceholder')).fill('beta.e2e-pg.test');
    await expect(mainRows(page)).toHaveCount(PAGE_SIZE);
    // 停在越界页会读到空白：筛选后必须回到第 1 页（命中 125 条 = 2 页）
    await expect(pagerState(page)).toContainText(templatedOf('options.pagination.pageOf', { current: 1, total: 2 }));
    await expect(mainRows(page).filter({ hasText: 'alpha.e2e-pg.test' })).toHaveCount(0);
  });

  test('新增条目会把用户带到它所在的那一页并高亮', async ({ optionsPage: page }) => {
    await seedVault(page);
    await pageButton(page, 3).click();

    await createEntry(page, { username: 'e2e-pg-fresh', password: 'Synthetic!Fresh', url: 'fresh.e2e-pg.test' });

    // 新条目按更新时间排到第 1 页：定位必须连带换页，否则表现为「添加了却没看到」
    await expect(pagerState(page)).toContainText(pageOf(1));
    await expect(mainRowOf(page, 'e2e-pg-fresh')).toBeVisible();
    await expect(mainRowOf(page, 'e2e-pg-fresh')).toHaveClass(/new-item/);
  });

  test('档位记在本机、重载后仍是那一档；页码刻意不回灌', async ({ optionsPage: page }) => {
    await seedVault(page);

    // 选 200 而不是 50：它与默认 100 的差在 DOM 上直接数得出来，
    // 而且这一档的行数最多，恢复若晚于首帧渲染会被后面的重排掩盖掉。
    const size = 200;
    const pages = Math.ceil(TOTAL / size);
    await page.locator('.pagination__size').click();
    await page
      .locator('.el-select-dropdown__item')
      .filter({ hasText: templatedOf('options.pagination.pageSizeLabel', { size }) })
      .click();

    await expect(mainRows(page)).toHaveCount(size);
    await expect(pagerState(page)).toContainText(
      templatedOf('options.pagination.pageOf', { current: 1, total: pages }),
    );
    // 落盘的只有档位这一个数字：没有整份配置对象，也没有页码
    await expect.poll(() => readStoredConfig(page, STORAGE_KEYS.VAULT_PAGE_SIZE)).toBe(size);

    // 先换到末页再重载，才能证明「重载后停在第 1 页」是页码不落盘的结果，
    // 而不是「用户本来就没换过页」
    await pageButton(page, pages).click();
    await expect(mainRows(page)).toHaveCount(TOTAL - (pages - 1) * size);

    await page.reload();
    await expect(mainRows(page)).toHaveCount(size, { timeout: 30_000 });
    await expect(pagerState(page)).toContainText(
      templatedOf('options.pagination.pageOf', { current: 1, total: pages }),
    );
  });
});
