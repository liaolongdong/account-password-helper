import type { Locator, Page } from '@playwright/test';
import { expect, expectSuccessToastFor, verifyMasterPassword } from './harness';
import { anchoredTextOf, textOf } from './i18n';

/**
 * 身份信息库弹窗的真机定位与操作装置（`identity-lookup-from-detail.spec.ts` 与提示深链那条共用）
 *
 * 抽出来的理由不是「少写几行」，而是这一组定位符每一条都带着一段踩过坑的口径：
 * 弹窗标题、按钮文案、表单标签在中英文下互为子串或两两同名，`getByRole('dialog')` 一律会
 * 同时命中列表与表单两颗节点而撞 Playwright strict mode。这类知识复制两份，就意味着改一处
 * 要记得改两处——而漏改的那一份不会报错，只会变成「等 20 秒超时」这种毫无线索的红灯。
 */

/**
 * 身份库列表弹窗
 *
 * 不按标题 `hasText` 定位：工具栏「添加」按钮的文案（`identity.add`）与表单弹窗标题
 * （`identity.form.addTitle`）在中英文下都是同一串，表单打开时两个 dialog 会同时命中。
 * 改按只有列表才有的工具栏类名收窄。
 */
export const vaultDialog = (page: Page): Locator =>
  page.getByRole('dialog').filter({ has: page.locator('.identity-toolbar') });

/** 身份表单弹窗：只有它有 `.identity-form-footer` */
export const identityFormDialog = (page: Page): Locator =>
  page.getByRole('dialog').filter({ has: page.locator('.identity-form-footer') });

/** 主密码复验弹窗：按身份库入口的提示文案定位（每个复验入口的提示语唯一） */
export const verifyDialog = (page: Page): Locator =>
  page.getByRole('dialog').filter({ hasText: textOf('identity.verifyPrompt') });

/** 库工具栏的搜索框（跳转唯一要落地的控件） */
export const searchInput = (page: Page): Locator => vaultDialog(page).locator('.identity-toolbar__search input');

/** 可见的身份卡片 */
export const cards = (page: Page): Locator => vaultDialog(page).locator('.identity-card');

/**
 * 关闭身份库列表弹窗（footer 那颗「关闭」）
 *
 * 名字匹配必须锚定：对话框头还有一颗 EP 自带的 × ，其 `aria-label` 是
 * 「Close this dialog」——非锚定的 /关闭|Close/ 会同时命中两颗按钮而撞 strict mode。
 */
export async function closeVault(page: Page): Promise<void> {
  await vaultDialog(page)
    .getByRole('button', { name: anchoredTextOf('common.close') })
    .click();
  await expect(vaultDialog(page)).toBeHidden();
}

/**
 * 身份表单里某个字段的输入框
 *
 * 走 `getByLabel`：Element Plus 的 `el-form-item` 会把 `for` 落到本项唯一的那个输入框上
 * （实测 12 项全部带 `for`），于是标签即字段名，读屏软件看到的和测试点中的是同一个控件。
 * 不用「`.el-form-item` + `filter({ has: 标签 })`」的结构写法：`has` 里的内层定位符一旦自带
 * 前缀链（这里是以 dialog 收窄后的 `form`）就不再按外层元素重新生根，实测恒匹配 0 个，
 * 表现为 `fill()` 干等 20 秒——诊断时别以为是折叠区没展开。
 */
export const identityField = (form: Locator, labelKey: string): Locator => form.getByLabel(textOf(labelKey)).first();

/**
 * 从已打开的身份库里经表单录一条（姓名 + 手机号），并等到成功提示与表单关闭
 *
 * 「添加」必须按工具栏那一颗定位，不能按角色 + 文案：空库时 `el-empty` 的空态里还藏着第二颗
 * 同名同型的 primary 按钮（那是深链零命中给的那条出路），全弹窗搜名字会同时命中两颗而撞
 * strict mode。工具栏那一颗在任何状态下都在，且才是「打开添加流程」的正规入口。
 */
export async function addIdentity(page: Page, name: string, phone: string): Promise<void> {
  await vaultDialog(page)
    .locator('.identity-toolbar')
    .getByRole('button', { name: textOf('identity.add') })
    .click();
  const form = identityFormDialog(page);
  await expect(form).toBeVisible();
  await identityField(form, 'identity.field.name').fill(name);
  await identityField(form, 'identity.field.phone').fill(phone);
  await expectSuccessToastFor(page, 'identity.form.saveSuccess', () =>
    form.getByRole('button', { name: textOf('common.save') }).click(),
  );
  await expect(form).toBeHidden();
}

/**
 * 经头部一级按钮打开身份库，返回前库已处于已解锁态
 *
 * `expectRecheck` 必须显式传：默认档 `perSession` 的语义是「同一管理页文档会话内第一次打开问、
 * 之后不再问」（`entrypoints/options/App.vue` 的 `identityVaultVerifiedThisSession`）。写成
 * 「有弹窗就填、没弹窗就跳过」会把这条语义整个测没了，所以两种预期各走各的断言。
 * 不问那一趟的判据顺序是**先等库可见**：复验若弹，库被挡在它后面打不开，这一步就超时判红；
 * 反过来先断言「复验层不在」是恒真——点按钮那一手只负责触发、不等任何弹窗落地。
 * 入口自 2026-10-22 起是头部的独立一级按钮（此前蜷在「数据管理」下拉最后一项），
 * 按钮名与菜单项同源 `identity.title`，因此仍按角色 + 文案定位，不写死第几颗。
 */
export async function openVaultFromHeader(page: Page, expectRecheck: boolean): Promise<void> {
  await page.getByRole('button', { name: textOf('identity.title') }).click();
  if (!expectRecheck) {
    await expect(vaultDialog(page)).toBeVisible();
    await expect(verifyDialog(page)).toBeHidden();
    return;
  }
  await verifyMasterPassword(page, 'identity.verifyPrompt');
  await expect(vaultDialog(page)).toBeVisible();
}
