import type { Locator, Page } from '@playwright/test';
import {
  createEntry,
  expect,
  expectSuccessToastFor,
  rowOf,
  runHeaderCommand,
  test,
  verifyMasterPassword,
} from './harness';
import { anchoredTextOf, numericTemplateOf, templatedOf, textOf } from './i18n';

/**
 * 「详情抽屉 → 身份信息库检索」跳转的真机回归
 *
 * 守卫单测（`tests/architecture/identityLookupFromDetailWiring.test.ts`）钉的是源码接线，
 * 下面四件事只有真浏览器 + 已加载的扩展才证得了：
 * ① 复验门槛真的会弹、也真的拦得住——取消复验既不该把用户的抽屉一起关掉，也不该留下半个身份库；
 * ② 用户名真的落进了身份库**已有**的那个搜索框，并即时收敛出命中卡片。这条链跨「抽屉 emit →
 *    App 编排 → composable 状态 → Element Plus 输入框双向绑定」四段，任一段接错，用户看到的都是
 *    「点了没反应」或「库开了但搜索框是空的」，而源码看起来完全正常；
 * ③ 预填是一次性的：关闭即由 teardown 清掉明文搜索词，下一次从菜单打开必须回到全量列表
 *    （否则上一轮的检索条件会悄悄框住这一轮的视野，明文 PII 也多活一轮）；
 * ④ 抽屉与弹窗同屏共存时的收起时序。
 *
 * 身份条目一律走真实表单录入：库里是整包密文（`encryptedPayload`），测试进程没有解密入口，
 * storage 后门造不出「已解锁会话下的身份条目」，也验证不到加解密链路。
 */

/** 合成凭据：RFC 2606 保留域 + 大陆手机号形态的合成品，与任何真实账号无关 */
const SITE_URL = 'https://identity-lookup.e2e.test';
const PHONE_HIT = '13800001234';
const PHONE_MISS = '13900005678';
/** 卡片标题取 `payload.name`，两个名字刻意互不为子串，命中判定才有唯一读数 */
const NAME_HIT = 'e2e-lookup-hit';
const NAME_MISS = 'e2e-lookup-miss';

/**
 * 身份库列表弹窗
 *
 * 不按标题 `hasText` 定位：工具栏「添加」按钮的文案（`identity.add`）与表单弹窗标题
 * （`identity.form.addTitle`）在中英文下都是同一串，表单打开时两个 dialog 会同时命中。
 * 改按只有列表才有的工具栏类名收窄。
 */
const vaultDialog = (page: Page): Locator =>
  page.getByRole('dialog').filter({ has: page.locator('.identity-toolbar') });

/** 身份表单弹窗：只有它有 `.identity-form-footer` */
const identityFormDialog = (page: Page): Locator =>
  page.getByRole('dialog').filter({ has: page.locator('.identity-form-footer') });

/** 详情抽屉（标题「条目详情」为抽屉独有，按文案定位即可） */
const detailDrawer = (page: Page): Locator =>
  page.getByRole('dialog').filter({ hasText: textOf('options.detail.title') });

/** 主密码复验弹窗：按本入口的提示文案定位（每个复验入口的提示语唯一） */
const verifyDialog = (page: Page): Locator =>
  page.getByRole('dialog').filter({ hasText: textOf('identity.verifyPrompt') });

/** 库工具栏的搜索框（跳转唯一要落地的控件） */
const searchInput = (page: Page): Locator => vaultDialog(page).locator('.identity-toolbar__search input');

/** 可见的身份卡片 */
const cards = (page: Page): Locator => vaultDialog(page).locator('.identity-card');

/**
 * 关闭身份库列表弹窗（footer 那颗「关闭」）
 *
 * 名字匹配必须锚定：对话框头还有一颗 EP 自带的 × ，其 `aria-label` 是
 * 「Close this dialog」——非锚定的 /关闭|Close/ 会同时命中两颗按钮而撞 strict mode。
 */
async function closeVault(page: Page): Promise<void> {
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
const identityField = (form: Locator, labelKey: string): Locator => form.getByLabel(textOf(labelKey)).first();

/** 从已打开的身份库里经表单录一条（姓名 + 手机号），并等到成功提示与表单关闭 */
async function addIdentity(page: Page, name: string, phone: string): Promise<void> {
  await vaultDialog(page)
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

/** 经数据管理菜单打开身份库（会弹复验），返回前库已处于已解锁态 */
async function openVaultFromMenu(page: Page): Promise<void> {
  await runHeaderCommand(page, 'options.header.data', 'identity.title');
  await verifyMasterPassword(page, 'identity.verifyPrompt');
  await expect(vaultDialog(page)).toBeVisible();
}

/** 打开某条密码的详情抽屉 */
async function openDrawer(page: Page, username: string): Promise<Locator> {
  await rowOf(page, username)
    .getByRole('button', { name: textOf('options.detail.viewDetail') })
    .click();
  const drawer = detailDrawer(page);
  await expect(drawer).toBeVisible();
  return drawer;
}

test('抽屉跳转：预填搜索框并只留下命中的身份卡片，重开时预填不残留', async ({ optionsPage: page }) => {
  await createEntry(page, { username: PHONE_HIT, password: 'E2eLookup!Passw0rd', url: SITE_URL });

  // 前置：库里先有一条「手机号命中」和一条「不命中」的身份信息
  await openVaultFromMenu(page);
  await addIdentity(page, NAME_HIT, PHONE_HIT);
  await addIdentity(page, NAME_MISS, PHONE_MISS);
  await expect(cards(page)).toHaveCount(2);

  await closeVault(page);

  // 跳转：抽屉用户名行的检索按钮 → 复验 → 库带着该用户名打开
  const drawer = await openDrawer(page, PHONE_HIT);
  await drawer.getByRole('button', { name: textOf('options.detail.searchIdentity') }).click();
  await verifyMasterPassword(page, 'identity.verifyPrompt');

  await expect(searchInput(page)).toHaveValue(PHONE_HIT);
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText(NAME_HIT);
  await expect(vaultDialog(page).locator('.identity-meta')).toContainText(
    templatedOf('identity.matchCount', { count: 1 }),
  );
  await expect(drawer).toBeHidden();

  // 一次性：关闭即复位，下一次从菜单进来必须回到全量列表。
  // 不在关闭态就地读那颗输入框——EP 收起对话框时整层 `display:none`，节点已退出无障碍树，
  // `getByRole('dialog')` 根本解析不到（实测「element(s) not found」），要读只能等它重新可见。
  await closeVault(page);
  await openVaultFromMenu(page);
  await expect(searchInput(page)).toHaveValue('');
  await expect(cards(page)).toHaveCount(2);
  await expect(vaultDialog(page).locator('.identity-meta')).not.toContainText(numericTemplateOf('identity.matchCount'));
});

test('抽屉跳转：取消主密码复验则库不打开，抽屉与已填内容都还在', async ({ optionsPage: page }) => {
  await createEntry(page, { username: PHONE_MISS, password: 'E2eLookup!Passw0rd', url: SITE_URL });

  const drawer = await openDrawer(page, PHONE_MISS);
  await drawer.getByRole('button', { name: textOf('options.detail.searchIdentity') }).click();
  await expect(verifyDialog(page)).toBeVisible();

  await verifyDialog(page)
    .getByRole('button', { name: textOf('common.cancel') })
    .click();
  await expect(verifyDialog(page)).toBeHidden();

  await expect(vaultDialog(page)).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.detail-value__text').first()).toHaveText(PHONE_MISS);
});
