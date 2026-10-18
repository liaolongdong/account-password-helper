import type { Locator, Page } from '@playwright/test';
import { createEntry, expect, rowOf, test } from './harness';
import { numericTemplateOf, templatedOf, textOf } from './i18n';
import {
  addIdentity,
  cards,
  closeVault,
  openVaultFromMenu,
  searchInput,
  vaultDialog,
  verifyDialog,
} from './identityVaultDom';

/**
 * 「详情抽屉 → 身份信息库检索」跳转的真机回归
 *
 * 守卫单测（`tests/architecture/identityLookupFromDetailWiring.test.ts`）钉的是源码接线，
 * 下面四件事只有真浏览器 + 已加载的扩展才证得了：
 * ① 复验门槛按默认档 `perSession` 走两面：本文档会话的第一趟真的会弹、也真的拦得住（取消复验既
 *    不该把用户的抽屉一起关掉，也不该留下半个身份库），第二趟不该再问——两面分别由两条用例承载；
 * ② 用户名真的落进了身份库**已有**的那个搜索框，并即时收敛出命中卡片。这条链跨「抽屉 emit →
 *    App 编排 → composable 状态 → Element Plus 输入框双向绑定」四段，任一段接错，用户看到的都是
 *    「点了没反应」或「库开了但搜索框是空的」，而源码看起来完全正常；
 * ③ 预填是一次性的：关闭即由 teardown 清掉明文搜索词，下一次从菜单打开必须回到全量列表
 *    （否则上一轮的检索条件会悄悄框住这一轮的视野，明文 PII 也多活一轮）；
 * ④ 抽屉与弹窗同屏共存时的收起时序；
 * ⑤ 零命中那一屏：气泡说「可在自定义字段里存下它」把人送进库里，若他从没建过那一格，
 *    空态必须把差的那个名字说出来（`{keyword}` 是否真被插值）并给出与工具栏同一条添加出路——
 *    这两点源码守卫证不了，只有真浏览器渲染得出来；
 * ⑥ 字段名检索的落点：把屏上那一列的名字喂回搜索框，命中要落在**标签列**的高亮上，
 *    清空关键词后屏上不留高亮实例（EP 的 `#label` 插槽在 border 模式下是否真渲染，只有真机量得到）。
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
 * 详情抽屉（标题「条目详情」为抽屉独有，按文案定位即可）
 *
 * 只有本文件用到，故留在原地；弹窗与表单那一组跨文件共用的定位口径在 `./identityVaultDom`。
 */
const detailDrawer = (page: Page): Locator =>
  page.getByRole('dialog').filter({ hasText: textOf('options.detail.title') });

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
  // 这一趟是本文档会话里的第一次打开，默认档 perSession 下必须问
  await openVaultFromMenu(page, true);
  await addIdentity(page, NAME_HIT, PHONE_HIT);
  await addIdentity(page, NAME_MISS, PHONE_MISS);
  await expect(cards(page)).toHaveCount(2);

  await closeVault(page);

  // 跳转：抽屉用户名行的检索按钮 → 库带着该用户名直接打开
  // 前置播种已经在本会话复验过一次，perSession 这一趟**不该再问**；判据是搜索框真的落进了
  // 值——复验若弹，库根本不会打开，这一句就超时判红。「会弹、且取消就不打开」由下面那条用例钉。
  const drawer = await openDrawer(page, PHONE_HIT);
  await drawer.getByRole('button', { name: textOf('options.detail.searchIdentity') }).click();

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
  await openVaultFromMenu(page, false);
  await expect(searchInput(page)).toHaveValue('');
  await expect(cards(page)).toHaveCount(2);
  await expect(vaultDialog(page).locator('.identity-meta')).not.toContainText(numericTemplateOf('identity.matchCount'));

  // ⑤ 零命中那一行：气泡把用户送到库里，而他从没建过那一格时，空态必须说清「差的是哪个名字」，
  //    并给出与工具栏同一条添加出路。源码守卫只看接线，这句话是否真的渲染出来、
  //    `{keyword}` 是否真的被插值，只有真浏览器量得到。
  await searchInput(page).fill('e2e-no-such-field');
  await expect(cards(page)).toHaveCount(0);
  const empty = vaultDialog(page).locator('.identity-empty');
  await expect(empty.locator('.identity-empty__hint')).toContainText('e2e-no-such-field');
  await expect(empty.getByRole('button', { name: textOf('identity.add') })).toBeVisible();
  await expect(empty.getByRole('button', { name: textOf('identity.clearFilters') })).toBeVisible();

  // 词清掉之后列表必须回全量：出路不能把用户永久钉在空态里
  await searchInput(page).fill('');
  await expect(cards(page)).toHaveCount(2);
  await expect(empty).toHaveCount(0);

  // ⑥ 按字段名检索：把屏上那一列的名字原样喂回搜索框——中英两侧都不必硬编码文案。
  //    判据分两半：命中的是「名字」而不是标题里的字（标题那一格不许有高亮），
  //    而那一格的高亮必须真的落在标签列上——Element Plus 的 `#label` 插槽在 border 模式下
  //    到底渲染不渲染，源码守卫证不了，只有真浏览器给得起答案。
  const firstCard = cards(page).first();
  const phoneLabel = firstCard.locator('.identity-field__label').nth(1);
  const labelName = (await phoneLabel.innerText()).trim();
  expect(labelName, '标签列读出来是空的：字段名那一格没渲染').not.toBe('');

  await searchInput(page).fill(labelName);
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).first().locator('.identity-field__label').nth(1).locator('.search-hit')).toHaveText(
    labelName,
  );
  await expect(cards(page).first().locator('.identity-card__title .search-hit')).toHaveCount(0);

  await searchInput(page).fill('');
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).first().locator('.search-hit')).toHaveCount(0);
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
