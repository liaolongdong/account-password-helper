import { expect, test } from './harness';
import { addIdentity, cards, openVaultFromMenu } from './identityVaultDom';
import { textOf } from './i18n';

/**
 * 个人信息库卡片标题区切换折叠的真机回归
 *
 * 结构守卫只钉「click 挂在哪」；这里量的是真实浏览器里的三件事：
 * ① 标题区（含类别标签）单击能收起、再单击能展开；
 * ② 复选框与动作行不会被标题的监听器误触；
 * ③ 标题内已有选区时，click 不收起——浏览器拖选后会补发 click，这条守卫生效与否
 *    在源码层看不到，只能在真实 DOM 上造一次选区再点。
 */
test('标题区整行切换折叠，复选框与动作行不误触', async ({ optionsPage: page }) => {
  await openVaultFromMenu(page, true);
  await addIdentity(page, 'e2e-card-toggle', '13800009999');

  const card = cards(page).first();
  const fields = card.locator('.identity-card__fields');
  await expect(fields).toBeVisible();

  // 单击标题文字：收起；再单击：展开
  await card.locator('.identity-card__title').click();
  await expect(card).toHaveClass(/is-collapsed/);
  await expect(fields).toHaveCount(0);

  await card.locator('.identity-card__title').click();
  await expect(card).not.toHaveClass(/is-collapsed/);
  await expect(fields).toBeVisible();

  // 类别标签也在标题触发区内
  await card.locator('.identity-card__category').click();
  await expect(card).toHaveClass(/is-collapsed/);
  await card.locator('.identity-card__title').click();
  await expect(fields).toBeVisible();

  // 拖选守卫：标题内已有选区时，浏览器补发的 click 不得收起卡片
  await card.locator('.identity-card__title').evaluate(title => {
    const range = document.createRange();
    range.selectNodeContents(title);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    selection?.removeAllRanges();
  });
  await expect(card).not.toHaveClass(/is-collapsed/);
  await expect(fields).toBeVisible();

  // 复选框只负责勾选，不折叠
  await card.locator('.identity-card__check').click();
  await expect(card).not.toHaveClass(/is-collapsed/);
  await expect(card.locator('.identity-card__check')).toHaveClass(/is-checked/);

  // 动作行的 chevron 仍是独立入口，且状态与标题区共用同一个折叠集合；
  // aria-expanded 由 Element Plus 透传到真实 button，顺带在真机上核一次
  const collapseButton = card.getByRole('button', { name: textOf('identity.collapseOne') });
  await expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
  await collapseButton.click();
  await expect(card).toHaveClass(/is-collapsed/);

  const expandButton = card.getByRole('button', { name: textOf('identity.expandOne') });
  await expect(expandButton).toHaveAttribute('aria-expanded', 'false');
  await expandButton.click();
  await expect(fields).toBeVisible();
});
