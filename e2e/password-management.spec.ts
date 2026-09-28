import type { Locator, Page } from '@playwright/test';
import { STORAGE_KEYS } from '../utils/storageKeys';
import {
  allRows,
  createEntry,
  expect,
  expectSuccessToast,
  footerPrimary,
  leaksPlaintext,
  rowOf,
  storedArrayCount,
  test,
} from './harness';
import { textOf } from './i18n';

/**
 * 密码条目增删改查（Options 主列表）
 *
 * 原有用例整体作废：旧实现把被测对象当成 `http://localhost:8899` 上的普通 Web 应用，
 * 那是 WXT dev server 的模块源，扩展从未被加载、`chrome.*` 不存在，
 * `beforeEach` 里等 `.header` 必然超时，没有一条用例真正跑到过断言。
 * 现按 e2e/site-rules.spec.ts 的写法用 `optionsPage` 夹具重写。
 *
 * 为什么每条用例自己录数据（harness 的 `createEntry`）：条目在库里是密文，测试进程没有
 * 解密入口，走 storage 后门既造不出「已解锁会话下的条目」也验证不到加解密链路，
 * 因此前置条件一律经表单完成——顺带让新增本身就是每条用例的第一次断言。
 */

/** 录入用的合成凭据：与任何真实账号无关，且刻意与主密码不同形 */
const ALPHA = { username: 'e2e-alpha', password: 'Synthetic!Alpha1', url: 'alpha.e2e.test' };
const BETA = { username: 'e2e-beta', password: 'Synthetic!Beta2', url: 'beta.e2e.test' };
const GAMMA = { username: 'e2e-gamma', password: 'Synthetic!Gamma3' };

/** 编辑弹窗：按标题与「添加密码」弹窗区分，避免与页面上其他 dialog 抢命中 */
const editDialog = (page: Page): Locator =>
  page.getByRole('dialog').filter({ hasText: textOf('options.form.editTitle') });

const usernameField = (dialog: Locator) => dialog.getByPlaceholder(textOf('options.form.usernamePlaceholder'));
const remarkField = (dialog: Locator) => dialog.getByPlaceholder(textOf('options.form.remarkPlaceholder'));

test.describe('密码条目增删改', () => {
  test('新增：填写用户名/密码/网址后入列，且库里只有密文', async ({ optionsPage: page }) => {
    await createEntry(page, ALPHA);

    const row = rowOf(page, ALPHA.username);
    await expect(row).toBeVisible();
    await expect(row).toContainText(ALPHA.url);
    await expect(allRows(page)).toHaveCount(1);
    // 默认掩码态：列表不显式回显明文
    await expect(row.locator('.password-cell')).toContainText('*'.repeat(8));

    expect(await storedArrayCount(page, STORAGE_KEYS.PASSWORDS)).toBe(1);
    expect(await leaksPlaintext(page, STORAGE_KEYS.PASSWORDS, ALPHA.password!)).toBe(false);
  });

  test('编辑：弹窗带出原值，保存后按新值更新并提示', async ({ optionsPage: page }) => {
    await createEntry(page, BETA);

    await rowOf(page, BETA.username)
      .getByRole('button', { name: textOf('common.edit') })
      .click();
    const dialog = editDialog(page);
    await expect(dialog).toBeVisible();
    await expect(usernameField(dialog)).toHaveValue(BETA.username);

    const renamed = 'e2e-beta-renamed';
    await usernameField(dialog).fill(renamed);
    await remarkField(dialog).fill('e2e remark');
    await footerPrimary(dialog).click();

    await expectSuccessToast(page, 'form.updateSuccess');
    await expect(dialog).toBeHidden();
    await expect(rowOf(page, renamed)).toBeVisible();
    // 改名是就地更新而非新增，列表仍只有一条
    await expect(allRows(page)).toHaveCount(1);
    expect(await storedArrayCount(page, STORAGE_KEYS.PASSWORDS)).toBe(1);
  });

  test('删除：取消则原地不动，确认后移入回收站而不是消失', async ({ optionsPage: page }) => {
    await createEntry(page, GAMMA);
    const deleteButton = rowOf(page, GAMMA.username).getByRole('button', { name: textOf('common.delete') });

    await deleteButton.click();
    const cancelBox = page.locator('.el-message-box');
    await expect(cancelBox).toBeVisible();
    await cancelBox.getByRole('button', { name: textOf('common.cancel') }).click();
    await expect(cancelBox).toBeHidden();
    await expect(rowOf(page, GAMMA.username)).toBeVisible();
    expect(await storedArrayCount(page, STORAGE_KEYS.PASSWORDS)).toBe(1);
    expect(await storedArrayCount(page, STORAGE_KEYS.TRASH)).toBe(0);

    // 确认删除有 1s 淡出动画，落盘在动画结束后才发生
    await deleteButton.click();
    await page
      .locator('.el-message-box')
      .getByRole('button', { name: textOf('form.moveToTrash') })
      .click();
    await expectSuccessToast(page, 'form.movedToTrash');

    await expect(allRows(page)).toHaveCount(0);
    await expect(page.getByText(textOf('options.emptyGuide.title'))).toBeVisible();
    expect(await storedArrayCount(page, STORAGE_KEYS.PASSWORDS)).toBe(0);
    expect(await storedArrayCount(page, STORAGE_KEYS.TRASH)).toBe(1);
  });

  test('搜索：命中数与行数一致，拼音首字母在模块温热后补齐，清空恢复全量', async ({ optionsPage: page }) => {
    await createEntry(page, ALPHA);
    await createEntry(page, BETA);
    await createEntry(page, { username: '廖小东的账号' });

    const search = page.getByPlaceholder(textOf('options.filter.searchPlaceholder'));
    await search.fill('beta');
    await expect(allRows(page)).toHaveCount(1);
    await expect(rowOf(page, BETA.username)).toBeVisible();
    await expect(page.locator('.password-list-info')).toContainText(textOf('options.filtered'));

    // 子串未命中时降级拼音匹配，依赖异步预热的独立 chunk；未温热前退化为「无结果」，
    // 温热完成会把 pinyinMatcherReady 置真并触发过滤重算，所以这里轮询终值而不是等待固定时长。
    await search.fill('lxd');
    await expect
      .poll(async () => (await rowOf(page, '廖小东的账号').count()) > 0, {
        message: '拼音首字母 lxd 未命中「廖小东的账号」',
      })
      .toBe(true);
    await expect(allRows(page)).toHaveCount(1);

    await search.fill('');
    await expect(allRows(page)).toHaveCount(3);
  });

  test('密码可见性：默认掩码，点击眼睛在明文与掩码间往返', async ({ optionsPage: page }) => {
    await createEntry(page, ALPHA);
    const cell = rowOf(page, ALPHA.username).locator('.password-cell');
    await expect(cell).toContainText('*'.repeat(8));

    await cell.getByRole('button', { name: textOf('common.showPassword') }).click();
    await expect(cell).toContainText(ALPHA.password!);
    await expect(cell.getByRole('button', { name: textOf('common.hidePassword') })).toBeVisible();

    await cell.getByRole('button', { name: textOf('common.hidePassword') }).click();
    await expect(cell).toContainText('*'.repeat(8));
    await expect(cell.getByRole('button', { name: textOf('common.showPassword') })).toBeVisible();
  });

  test('收藏：收藏后置顶并切换按钮语义，取消收藏后回落', async ({ optionsPage: page }) => {
    await createEntry(page, { username: 'e2e-fav-first', password: 'Synthetic!First1' });
    await createEntry(page, { username: 'e2e-fav-second', password: 'Synthetic!Second2' });

    const firstRow = rowOf(page, 'e2e-fav-first');
    await firstRow.getByRole('button', { name: textOf('common.favorite') }).click();
    await expectSuccessToast(page, 'sidepanel.favorited');
    // 收藏置顶是排序里的固定规则，先于更新时间
    await expect(allRows(page).first()).toContainText('e2e-fav-first');
    await expect(firstRow.getByRole('button', { name: textOf('common.unfavorite') })).toBeVisible();

    await firstRow.getByRole('button', { name: textOf('common.unfavorite') }).click();
    await expectSuccessToast(page, 'sidepanel.unfavorited');
    await expect(allRows(page).first()).toContainText('e2e-fav-second');
  });
});
