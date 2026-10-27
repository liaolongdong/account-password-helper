import { expect, test } from './harness';
import { identityFormDialog, openVaultFromHeader, vaultDialog } from './identityVaultDom';
import { textOf } from './i18n';

/**
 * 个人信息库「真实空态」的真机回归
 *
 * 缺陷本体：`identity.empty` 让用户「点击下方『添加个人信息』」，但该分支只画了一个 `el-empty`，
 * 唯一的添加按钮在顶部工具栏。页面侧右键 / 字段提示第一次把新用户送进空库时，这句话会当场落空。
 * 结构守卫（`tests/components/identityEmptyState.dom.test.ts`）只钉模板形状，这里量真实渲染的三件事：
 * ① 空态里确实有一颗可点的添加按钮（不是只有文案在指路）；
 * ② 空态说明库里能存什么；
 * ③ 点它打开的是既有表单，不自建第二套添加流程。
 *
 * 按钮必须按 `.identity-empty` 收窄：工具栏那颗同名 primary 按钮在任何状态下都在，
 * 按角色 + 文案全弹窗搜会同时命中两颗而撞 Playwright strict mode（口径同 `addIdentity`）。
 */
test('空库落点给出「添加个人信息」出口，并复用既有表单', async ({ optionsPage: page }) => {
  await openVaultFromHeader(page, true);

  const empty = vaultDialog(page).locator('.identity-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText(textOf('identity.emptyHint'));

  await empty.getByRole('button', { name: textOf('identity.add') }).click();
  await expect(identityFormDialog(page)).toBeVisible();
});
