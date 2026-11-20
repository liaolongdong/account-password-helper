import { expect, parkPointer, test, visibleTooltipTexts } from './harness';
import { cards, identityField, identityFormDialog, openVaultFromHeader, vaultDialog } from './identityVaultDom';
import { anchoredTextOf, exactText, templatedOf, textOf } from './i18n';

/**
 * 身份表单「扩展信息组」（更多字段 / 备注 / 自定义字段）的布局与状态可见性回归
 *
 * 源：2026-11-20 的 UI 评估。三条判据在源码层看不到，只能在真实 DOM 上量：
 * ① 两个 section 标题起点一致（此前一个在 EP collapse 里贴左、一个在自定义头里贴左，节奏不同）；
 * ② collapse 的默认三线边框被接管、展开后内部字段标签与外层 100px 标签列对齐；
 * ③ 折叠区已填值时有徽章、编辑回填时默认展开——隐藏数据不静默。
 */
test('扩展信息组对齐、空态与折叠徽章/自动展开', async ({ optionsPage: page }) => {
  await openVaultFromHeader(page, true);
  await vaultDialog(page)
    .locator('.identity-toolbar')
    .getByRole('button', { name: anchoredTextOf('identity.add') })
    .click();
  const form = identityFormDialog(page);
  await expect(form).toBeVisible();
  await form.locator('.identity-form__extra').scrollIntoViewIfNeeded();

  // ① 两个 section 标题同一起点、同一字号
  const moreTitle = form.locator('.identity-form__more .identity-form__section-title');
  const customTitle = form.locator('.identity-form__custom-header .identity-form__section-title');
  await expect(moreTitle).toBeVisible();
  await expect(customTitle).toBeVisible();
  const moreBox = await moreTitle.boundingBox();
  const customBox = await customTitle.boundingBox();
  expect(moreBox && customBox).toBeTruthy();
  expect(Math.abs(moreBox!.x - customBox!.x)).toBeLessThanOrEqual(1);
  const moreFont = await moreTitle.evaluate(el => getComputedStyle(el).fontSize);
  const customFont = await customTitle.evaluate(el => getComputedStyle(el).fontSize);
  expect(moreFont).toBe(customFont);

  // ② collapse 容器不再有上下边框，头部不再有下边框
  const collapseTop = await form.locator('.identity-form__more').evaluate(el => getComputedStyle(el).borderTopWidth);
  expect(collapseTop).toBe('0px');
  const headerBorder = await form
    .locator('.identity-form__more .el-collapse-item__header')
    .evaluate(el => getComputedStyle(el).borderBottomStyle);
  expect(headerBorder).toBe('none');

  // ③ 纵向顺序：备注 → 更多字段 → 自定义字段（备注不被展开的折叠区挤出视野）
  const remarkInput = identityField(form, 'identity.field.remark');
  const moreHeader = form.locator('.identity-form__more .el-collapse-item__header');
  const orderBoxes = [
    await remarkInput.boundingBox(),
    await moreHeader.boundingBox(),
    await form.locator('.identity-form__custom-header').boundingBox(),
  ];
  expect(orderBoxes.every(Boolean), '扩展信息组的三个块都应参与布局').toBe(true);
  const [remarkY, moreY, customY] = orderBoxes.map(box => box!.y);
  expect(remarkY).toBeLessThan(moreY);
  expect(moreY).toBeLessThan(customY);

  // 分隔线（扩展组上沿）在备注之下、更多字段之上：备注属于核心区，不在扩展组内
  const extraBox = await form.locator('.identity-form__extra').boundingBox();
  expect(extraBox, '扩展信息组应参与布局').toBeTruthy();
  expect(remarkY + orderBoxes[0]!.height).toBeLessThanOrEqual(extraBox!.y);
  expect(extraBox!.y).toBeLessThanOrEqual(moreY);

  // ④ 自定义字段空态：引导文案 + 铺满组宽的虚线添加行
  await expect(form.locator('.identity-form__custom-empty')).toHaveText(textOf('identity.form.customEmptyHint'));
  const addRow = form.locator('.identity-form__custom-add');
  await expect(addRow).toBeVisible();
  const dashed = await addRow.evaluate(el => getComputedStyle(el).borderStyle);
  expect(dashed).toContain('dashed');
  const groupBox = await form.locator('.identity-form__custom').boundingBox();
  const addBox = await addRow.boundingBox();
  expect(groupBox && addBox).toBeTruthy();
  expect(Math.abs(groupBox!.width - addBox!.width)).toBeLessThanOrEqual(1);

  // ⑤ 自定义行：新增即聚焦字段名输入框；机密开关前后值输入框宽度不变
  await addRow.click();
  const rows = form.locator('.identity-form__custom-row');
  await expect(rows).toHaveCount(1);
  const firstRow = rows.nth(0);
  await expect(firstRow.locator('input').first()).toBeFocused();
  // 字段名占位符必须在列宽内完整显示（此前 140px 列宽会把中英文案尾部硬裁）
  const placeholderFits = await firstRow
    .locator('input')
    .first()
    .evaluate(el => {
      const input = el as HTMLInputElement;
      const style = getComputedStyle(input);
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return true;
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const available = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return ctx.measureText(input.placeholder).width <= available - 4;
    });
  expect(placeholderFits, '字段名占位符不应被列宽裁剪').toBe(true);
  await expect(form.locator('.identity-form__custom-empty')).toBeHidden();
  await firstRow.locator('input').first().fill('e2e-label');
  await firstRow.locator('input').nth(1).fill('e2e-value');
  const valueInput = firstRow.locator('.identity-form__custom-value');
  const widthBefore = (await valueInput.boundingBox())!.width;

  // EP 的 role="switch" 落在视觉隐藏的原生 input 上，点击要走可见的 .el-switch 根节点
  const secretSwitch = firstRow.getByRole('switch');
  await expect(secretSwitch).toHaveAttribute('aria-label', textOf('identity.form.secret'));
  await firstRow.locator('.identity-form__custom-secret').hover();
  const tooltipTexts = await visibleTooltipTexts(page);
  const secretCopy = [exactText('identity.form.secret', 'zh-CN'), exactText('identity.form.secret', 'en')];
  expect(tooltipTexts.some(text => secretCopy.includes(text.trim()))).toBe(true);
  await parkPointer(page);

  await firstRow.locator('.el-switch').click();
  await expect(secretSwitch).toHaveAttribute('aria-checked', 'true');
  const widthAfter = (await valueInput.boundingBox())!.width;
  expect(Math.abs(widthBefore - widthAfter)).toBeLessThanOrEqual(1);

  // 新增第二行同样聚焦；删除后行数回落
  await addRow.click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1).locator('input').first()).toBeFocused();
  await rows
    .nth(1)
    .getByRole('button', { name: anchoredTextOf('common.delete') })
    .click();
  await expect(rows).toHaveCount(1);

  // ⑥ 展开更多字段：备注仍在折叠内容之上；内部标签与外层标签右缘对齐（同一 100px 标签列）
  await form.locator('.identity-form__more .el-collapse-item__header').click();
  const remarkTop = (await identityField(form, 'identity.field.remark').boundingBox())!.y;
  const expandedTop = (await form.locator('.identity-form__more .el-form-item').first().boundingBox())!.y;
  expect(remarkTop).toBeLessThan(expandedTop);
  const outerLabel = form.locator('.el-form-item__label').first();
  const innerLabel = form.locator('.identity-form__more .el-form-item__label').first();
  const [outerBox, innerBox] = [await outerLabel.boundingBox(), await innerLabel.boundingBox()];
  expect(outerBox && innerBox).toBeTruthy();
  expect(Math.abs(outerBox!.x + outerBox!.width - (innerBox!.x + innerBox!.width))).toBeLessThanOrEqual(1);

  // ⑦ 折叠区填值 → 徽章出现且折叠后保留
  await identityField(form, 'identity.field.cardBank').fill('e2e-extra-bank');
  const badge = form.locator('.identity-form__more .identity-form__badge');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText(templatedOf('identity.form.filledCount', { count: 1 }));
  await form.locator('.identity-form__more .el-collapse-item__header').click();
  await expect(form.locator('.identity-form__more .el-collapse-item__content')).toBeHidden();
  await expect(badge).toBeVisible();

  // ⑧ 保存后重开编辑：折叠区有值 → 默认展开、徽章仍在
  await identityField(form, 'identity.field.name').fill('e2e-extra-section');
  await form.getByRole('button', { name: anchoredTextOf('common.save') }).click();
  await expect(form).toBeHidden();
  const card = cards(page).filter({ hasText: 'e2e-extra-section' }).first();
  await card.getByRole('button', { name: anchoredTextOf('common.edit') }).click();
  const editForm = identityFormDialog(page);
  await expect(editForm).toBeVisible();
  await expect(editForm.locator('.identity-form__more .el-collapse-item__content')).toBeVisible();
  await expect(editForm.locator('.identity-form__more .identity-form__badge')).toHaveText(
    templatedOf('identity.form.filledCount', { count: 1 }),
  );
});
