import type { Locator } from '@playwright/test';
import { expect, expectSuccessToastFor, test } from './harness';
import { identityField, identityFormDialog, openVaultFromMenu, vaultDialog } from './identityVaultDom';
import { MAX_IDENTITIES } from '../utils/identity/constants';
import { STORAGE_KEYS } from '../utils/storageKeys';
import { templatedOf, textOf } from './i18n';

/**
 * 个人信息库「全选行」的真机几何守卫
 *
 * 钉三件源码层量不出来的事：
 * 1. **两枚批量动作按钮净间距 8px、字面可见间距 14px**。声明值由
 *    `tests/architecture/dialogFooterDensityWiring.test.ts` 钉，但它证不了 `:deep`
 *    压得过 Element Plus，也证不了盒子里那 1px 边框 + 2px 内边距——这里读真实 DOM 的矩形。
 * 2. **上限指示与搜索命中数都落在这同一行里**（它们原先自占一行），且**中英两态都不换行**。
 *    en 的摘要与「n of max used」比 zh 长，只有真机能量出 760px 弹窗的 728px 内容区
 *    塞不塞得下；一旦换行，本次省下的那一行垂直空间就静默还回去了。
 * 3. 旧状态栏节点必须真的不在 DOM 里——若只是被 CSS 藏起来，读数照样对，
 *    而用户要省的那一行并没有省下来。
 */

/** 元素盒子矩形（含 `is-link` 那 2px 内边距） */
const boxOf = (el: Locator) => el.evaluate(node => node.getBoundingClientRect().toJSON());

/** 元素**文字**内容的矩形右缘 / 左缘（用户眼里的间距是这两个数之差） */
const textEdge = (el: Locator, side: 'left' | 'right') =>
  el.evaluate((node, which) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect()[which];
  }, side);

/**
 * 全选行的行高与直接子元素矩形
 *
 * 判「有没有换行」用的是**容器行高 = 最高子元素行高**：`align-items: center` 下单行就是这个等式，
 * 一旦换行，容器要再吃下一整行加一档 `gap`。不能用「所有子元素顶边相同」——同一行里
 * 18px 的字与 24px 的按钮盒子顶边本就差 1px（实测 302 / 301），那是对齐方式的正常结果，不是换行。
 */
const rowGeometry = (bar: Locator) =>
  bar.evaluate(el => {
    const barHeight = Math.round(el.getBoundingClientRect().height);
    const kids = [...el.children].map(node => {
      const r = node.getBoundingClientRect();
      return { cls: node.className.toString().split(' ')[0], top: Math.round(r.y), height: Math.round(r.height) };
    });
    return { barHeight, kids };
  });

/** 切换界面语言（管理页经 `chrome.storage.onChanged` 实时同步，无需重载文档） */
const setLocale = (page: import('@playwright/test').Page, locale: 'zh-CN' | 'en'): Promise<void> =>
  page.evaluate(
    async (payload: { key: string; value: string }) => {
      await chrome.storage.local.set({ [payload.key]: payload.value });
    },
    { key: STORAGE_KEYS.LOCALE, value: locale },
  );

test('全选行一行装下全部读数，批量按钮净间距 8px / 可见间距 14px，中英两态均不换行', async ({ optionsPage: page }) => {
  await openVaultFromMenu(page, true);

  // 建一条带机密字段的条目：没有机密字段时「显示全部机密」整枚按钮不出现，
  // 就没有两枚按钮的间距可量。护照形态的证件号（非 18 位）不做校验位检查，落库最省事。
  await vaultDialog(page)
    .getByRole('button', { name: textOf('identity.add') })
    .click();
  const form = identityFormDialog(page);
  await expect(form).toBeVisible();
  await identityField(form, 'identity.field.name').fill('e2e-density');
  // 证件号码在「更多字段」折叠区里，不展开就是 `element is not visible`（实测 20s 超时）
  await form.locator('.el-collapse-item__header').click();
  await identityField(form, 'identity.field.idNumber').fill('E20260001');
  await expectSuccessToastFor(page, 'identity.form.saveSuccess', () =>
    form.getByRole('button', { name: textOf('common.save') }).click(),
  );
  await expect(form).toBeHidden();

  const dialog = vaultDialog(page);
  const bar = dialog.locator('.identity-selectbar');
  await expect(bar).toBeVisible();
  const reveal = dialog.getByRole('button', { name: textOf('identity.revealAll') });
  const collapse = dialog.getByRole('button', { name: textOf('identity.collapseAll') });

  for (const locale of ['zh-CN', 'en'] as const) {
    await setLocale(page, locale);

    // 上限指示已并入本行，且条数用的是 `MAX_IDENTITIES`（不写死数字，改上限不需改用例）
    await expect(dialog.locator('.identity-selectbar__count')).toContainText(
      templatedOf('identity.countIndicator', { count: 1, max: MAX_IDENTITIES }),
    );
    // 旧状态栏整块消失，不是被藏起来
    await expect(dialog.locator('.identity-meta')).toHaveCount(0);
    await expect(reveal).toBeVisible();
    await expect(collapse).toBeVisible();

    const [revealBox, collapseBox] = await Promise.all([boxOf(reveal), boxOf(collapse)]);
    const netGap = Math.round(collapseBox.left - (revealBox.left + revealBox.width));
    expect(netGap, `${locale} 态两枚按钮的净盒间距不是 8px（读到 ${netGap}px）`).toBe(8);

    const [revealTextRight, collapseTextLeft] = await Promise.all([
      textEdge(reveal, 'right'),
      textEdge(collapse, 'left'),
    ]);
    const inkGap = Math.round(collapseTextLeft - revealTextRight);
    expect(inkGap, `${locale} 态两枚按钮的字面可见间距不是 14px（读到 ${inkGap}px）`).toBe(14);

    const { barHeight, kids } = await rowGeometry(bar);
    expect(
      kids.map(kid => kid.cls),
      `${locale} 态全选行里的读数/动作组与预期不符，判据落点已失效`,
    ).toEqual([
      'el-checkbox',
      'identity-selectbar__summary',
      'identity-selectbar__count',
      'identity-selectbar__actions',
    ]);
    const tallest = Math.max(...kids.map(kid => kid.height));
    expect(
      barHeight - tallest,
      `${locale} 态全选行换行了（行高 ${barHeight}，最高子元素 ${tallest}，明细 ${JSON.stringify(kids)}）`,
    ).toBeLessThanOrEqual(1);

    await bar.screenshot({ path: `.e2e-visual/identity-selectbar-${locale}.png` });
  }
});
