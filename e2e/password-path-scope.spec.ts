import type { Page } from '@playwright/test';
import { allRows, expect, expectSuccessToastFor, footerPrimary, rowOf, test } from './harness';
import { anchoredTextOf, textOf } from './i18n';

/**
 * 限定路径（pathScope）的可见性与表单提示
 *
 * 2026-11-20 用户收敛后的范围：不进侧边栏徽章、不进列表列（低频字段不占高频扫读面），
 * 只保证「详情可见 + 搜索可达 + 表单冲突只读提示」三件事。
 * 提示是纯只读：不阻断保存、不改校验，因此这里同时断言「出现」与「填路径后消失」两态。
 */

const ADMIN = {
  username: 'e2e-scope-user',
  password: 'Synthetic!Scoped1',
  url: 'scope.e2e.test',
  pathScope: '/#/admin',
};

/** 走完整表单录一条带限定路径的条目（高级选项默认收起，需先展开） */
async function createScopedEntry(page: Page, entry: typeof ADMIN): Promise<void> {
  await page.getByRole('button', { name: textOf('options.header.addPassword') }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.form.addTitle') });
  await expect(dialog).toBeVisible();

  await dialog.getByPlaceholder(textOf('options.form.usernamePlaceholder')).fill(entry.username);
  await dialog.getByPlaceholder(textOf('options.form.passwordPlaceholder')).fill(entry.password);
  await dialog.getByPlaceholder(textOf('options.form.urlPlaceholder')).fill(entry.url);
  await dialog.getByRole('button', { name: textOf('options.form.advancedOptions') }).click();
  await dialog.getByPlaceholder(textOf('options.form.pathScopePlaceholder')).fill(entry.pathScope);

  await expectSuccessToastFor(page, 'form.addSuccess', () => footerPrimary(dialog).click());
  await expect(dialog).toBeHidden();
}

test.describe('限定路径的详情与搜索', () => {
  test('详情抽屉显示限定路径；搜索路由片段命中对应条目', async ({ optionsPage: page }) => {
    await createScopedEntry(page, ADMIN);
    // 对照条目：同页存在但不带路径作用域
    await page.getByRole('button', { name: textOf('options.header.addPassword') }).click();
    const addDialog = page.getByRole('dialog').filter({ hasText: textOf('options.form.addTitle') });
    await addDialog.getByPlaceholder(textOf('options.form.usernamePlaceholder')).fill('e2e-scope-plain');
    await addDialog.getByPlaceholder(textOf('options.form.passwordPlaceholder')).fill('Synthetic!Plain2');
    await addDialog.getByPlaceholder(textOf('options.form.urlPlaceholder')).fill('plain.e2e.test');
    await expectSuccessToastFor(page, 'form.addSuccess', () => footerPrimary(addDialog).click());
    await expect(addDialog).toBeHidden();

    // 详情抽屉：只在 pathScope 非空时出现「限定路径」一行
    await rowOf(page, ADMIN.username)
      .getByRole('button', { name: textOf('options.detail.viewDetail') })
      .click();
    const drawer = page.locator('.el-drawer').filter({ hasText: ADMIN.pathScope });
    await expect(drawer.getByText(textOf('options.form.pathScope'))).toBeVisible();
    await expect(drawer.getByText(ADMIN.pathScope, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    // 搜索：路由片段（不出现在用户名 / 标签 / 备注 / 网址里）只命中带该路径的条目
    const search = page.getByPlaceholder(textOf('options.filter.searchPlaceholder'));
    await search.fill('admin');
    await expect(allRows(page)).toHaveCount(1);
    await expect(rowOf(page, ADMIN.username)).toBeVisible();
    await search.fill('zzz-no-such-keyword');
    await expect(allRows(page)).toHaveCount(0);
    await search.fill('');
    await expect(allRows(page)).toHaveCount(2);
  });
});

test.describe('表单路径冲突只读提示', () => {
  test('同账号在其它路径已有条目时提示出现，填写限定路径后消失', async ({ optionsPage: page }) => {
    await createScopedEntry(page, ADMIN);

    // 再开新增表单：填同样的用户名与网址，但路径留空
    await page.getByRole('button', { name: textOf('options.header.addPassword') }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.form.addTitle') });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder(textOf('options.form.usernamePlaceholder')).fill(ADMIN.username);
    await dialog.getByPlaceholder(textOf('options.form.urlPlaceholder')).fill(ADMIN.url);

    // 提示跟在「网址」字段下方，无需展开高级选项即可看到
    const peerTip = dialog.getByText(textOf('options.form.pathScopePeerTip'));
    await expect(peerTip).toBeVisible();

    // 用户自己填了路径（做区分）后，提示消失；不阻断保存流程
    await dialog.getByRole('button', { name: textOf('options.form.advancedOptions') }).click();
    await dialog.getByPlaceholder(textOf('options.form.pathScopePlaceholder')).fill('/#/user');
    await expect(peerTip).toBeHidden();

    await dialog.getByRole('button', { name: anchoredTextOf('common.cancel') }).click();
    await expect(dialog).toBeHidden();
  });
});
