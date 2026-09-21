import type { Locator, Page } from '@playwright/test';
import { STORAGE_KEYS } from '../utils/storageKeys';
import {
  MASTER_PASSWORD,
  createEntry,
  expect,
  expectSuccessToastFor,
  footerPrimary,
  readStoredConfig,
  test,
  toast,
} from './harness';
import { templatedOf, textOf } from './i18n';

/**
 * 安全设置 —— Options「安全设置」菜单里的偏好弹窗与主密码 rekey
 *
 * 原有用例整体作废：旧实现把被测对象当成 `http://localhost:8899` 上的普通 Web 应用，
 * 那是 WXT dev server 的模块源，扩展从未被加载、`chrome.*` 不存在，
 * `beforeEach` 里等 `.header` 必然超时，没有一条用例真正跑到过断言。
 *
 * 这一组用例盯的是「设置真的落盘」：弹窗里的开关和表单只有写进 `chrome.storage.local`
 * 才产生效果，而回显与 toast 都可能来自组件内部的本地副本，所以每条链路都以
 * `readStoredConfig` 收尾，把 UI 操作与存储事实对上。
 */

/** 新主密码同样只存在于测试 profile；四条强度规则全通过才允许提交 */
const NEW_MASTER_PASSWORD = 'E2eRotated!Passw0rd';

/** rekey 用的合成条目：必须带密码，否则「重加密后还能解回原文」这条断言就落空 */
const REKEY_ENTRY = { username: 'e2e-rekey@qa.test', password: 'Synthetic!Rekey1' };

/** 打开「安全设置」菜单里的某个设置项，返回其弹窗 */
async function openSecurityDialog(page: Page, itemKey: string): Promise<Locator> {
  await page.getByRole('button', { name: textOf('options.header.securitySettings') }).click();
  await page.getByRole('menuitem', { name: textOf(itemKey) }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: textOf(itemKey) });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Element Plus 的 switch 真实控件被隐藏（opacity:0、宽高 0），点击要落在外层容器上 */
const switchBox = (dialog: Locator) => dialog.locator('.el-switch');
/** 同上，checkbox 的 `input` 不可见，点 label 才会触发 change */
const checkboxBox = (dialog: Locator, key: string) => dialog.locator('.el-checkbox', { hasText: textOf(key) });

/** 只读 `auto_save_config.enabled`，不把整份配置（含域名规则）搬进断言 */
async function readAutoSaveEnabled(page: Page): Promise<boolean | null> {
  const stored = (await readStoredConfig(page, STORAGE_KEYS.AUTO_SAVE_CONFIG)) as { enabled?: boolean } | null;
  return stored?.enabled ?? null;
}

/** 走「清除会话」：徽标 → 有效期弹窗 → 清除 → 二次确认，落到主密码验证页 */
async function clearSessionAndLock(page: Page): Promise<void> {
  await page.locator('.session-chip').click();
  const validity = page.getByRole('dialog').filter({ hasText: textOf('options.validity.title') });
  await expect(validity).toBeVisible();
  await validity.getByRole('button', { name: textOf('options.validity.clearSession') }).click();
  await page
    .locator('.el-message-box')
    .getByRole('button', { name: textOf('session.clearConfirmBtn') })
    .click();
  await expect(page.getByRole('button', { name: textOf('auth.verifySubmit') })).toBeVisible();
}

/** 强度气泡：el-popover 的内容 teleport 到 body，只能从页面根定位 */
const strengthPopover = (page: Page) => page.locator('.password-rules-popover');
/** 气泡里某一条规则的展示项 */
const ruleItem = (page: Page, ruleKey: string) => strengthPopover(page).locator('li', { hasText: textOf(ruleKey) });

test.describe('主密码修改与强度校验', () => {
  test('当前密码错误时拒绝修改，正确时全库重加密且旧密码就此失效', async ({ optionsPage: page }) => {
    await createEntry(page, REKEY_ENTRY);
    const rekeyRow = page.locator('tr.el-table__row', { hasText: REKEY_ENTRY.username });

    const dialog = await openSecurityDialog(page, 'options.header.changeMasterPassword');
    await expect(dialog.getByText(textOf('options.changePwd.alertTitle'))).toBeVisible();
    const oldInput = dialog.getByPlaceholder(textOf('options.changePwd.oldPasswordPlaceholder'));
    const newInput = dialog.getByPlaceholder(textOf('options.changePwd.newPasswordPlaceholder'));
    const confirmInput = dialog.getByPlaceholder(textOf('options.changePwd.confirmPasswordPlaceholder'));

    // ① 当前密码不对：给出可理解的失败反馈，弹窗保持打开，数据不动
    await oldInput.fill('E2eWrong!Passw0rd');
    await newInput.fill(NEW_MASTER_PASSWORD);
    await confirmInput.fill(NEW_MASTER_PASSWORD);
    await footerPrimary(dialog).click();
    await expect(toast(page, 'options.changePwd.wrongOldPassword')).toBeVisible();
    await expect(dialog).toBeVisible();

    // ② 当前密码正确：rekey 完成后列表按新密钥重新解密，原账号仍在
    await oldInput.fill(MASTER_PASSWORD);
    await expectSuccessToastFor(page, 'options.changePwd.success', () => footerPrimary(dialog).click());
    await expect(dialog).toBeHidden();
    await expect(rekeyRow).toBeVisible();

    // ③ 重新解锁：旧主密码已被新校验值拒绝，新主密码才解得开重加密后的密文。
    // rekey 刻意保留原 salt（换了派生密钥就变了），所以这一步同时守住了那条契约。
    await clearSessionAndLock(page);
    const verifyInput = page.getByPlaceholder(textOf('auth.verifyPasswordPlaceholder'));
    const verifySubmit = page.getByRole('button', { name: textOf('auth.verifySubmit') });
    await verifyInput.fill(MASTER_PASSWORD);
    await verifySubmit.click();
    await expect(page.locator('.verify-error-inline')).toContainText(textOf('auth.wrongPassword'));

    await verifyInput.fill(NEW_MASTER_PASSWORD);
    await verifySubmit.click();
    await expect(page.locator('.session-chip')).toBeVisible();
    await expect(rekeyRow).toBeVisible();

    // ④ 重加密不是「把数据原样留下」：新密钥必须能把条目解回录入时的那份明文，
    // 这一步才真正证明密文与派生密钥是一起换过的。
    const cell = rekeyRow.locator('.password-cell');
    await cell.getByRole('button', { name: textOf('common.showPassword') }).click();
    await expect(cell).toContainText(REKEY_ENTRY.password);
  });

  test('新密码强度实时反馈，弱密码被表单挡下', async ({ optionsPage: page }) => {
    const dialog = await openSecurityDialog(page, 'options.header.changeMasterPassword');
    const newInput = dialog.getByPlaceholder(textOf('options.changePwd.newPasswordPlaceholder'));

    await newInput.click();
    await expect(strengthPopover(page)).toBeVisible();
    await expect(strengthPopover(page).locator('.rules-title')).toHaveText(textOf('auth.passwordRequirements'));
    await expect(strengthPopover(page).locator('.rules-hint')).toHaveText(textOf('auth.passwordRequirementsHint'));

    // 8 位纯字母（非泄露字典词）：长度与字母通过，数字与符号不通过 → 中等
    await newInput.fill('kmvxtqpd');
    await expect(strengthPopover(page).locator('.strength-label')).toHaveText(textOf('strength.medium'));
    await expect(ruleItem(page, 'strength.ruleMinLength')).toHaveClass(/passed/);
    await expect(ruleItem(page, 'strength.ruleHasLetter')).toHaveClass(/passed/);
    await expect(ruleItem(page, 'strength.ruleHasNumber')).not.toHaveClass(/passed/);
    await expect(ruleItem(page, 'strength.ruleHasSymbol')).not.toHaveClass(/passed/);

    // 8 位中文：长度够，但字母/数字/符号三条全不命中 → 弱
    await newInput.fill('口令测试口令测试');
    await expect(strengthPopover(page).locator('.strength-label')).toHaveText(textOf('strength.weak'));
    await expect(ruleItem(page, 'strength.ruleMinLength')).toHaveClass(/passed/);
    await expect(ruleItem(page, 'strength.ruleHasNumber')).not.toHaveClass(/passed/);

    // 提交：强度校验器在表单层挡下弱密码，不进入 rekey
    await dialog.getByPlaceholder(textOf('options.changePwd.oldPasswordPlaceholder')).fill(MASTER_PASSWORD);
    await dialog.getByPlaceholder(textOf('options.changePwd.confirmPasswordPlaceholder')).fill('口令测试口令测试');
    await footerPrimary(dialog).click();
    await expect(
      dialog.locator('.el-form-item__error').filter({ hasText: textOf('options.changePwd.weakPassword') }),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(await toast(page, 'options.changePwd.success').count()).toBe(0);
  });
});

test.describe('填充与锁定偏好', () => {
  test('自动保存开关即时落盘，域名规则经正则校验与去重后随保存写入', async ({ optionsPage: page }) => {
    const dialog = await openSecurityDialog(page, 'options.header.autoSave');
    const switchInput = dialog.getByRole('switch');
    await expect(switchInput).toBeChecked();

    await expectSuccessToastFor(page, 'options.autoSave.disabled', () => switchBox(dialog).click());
    await expect(switchInput).not.toBeChecked();
    expect(await readAutoSaveEnabled(page)).toBe(false);

    await expectSuccessToastFor(page, 'options.autoSave.enabled', () => switchBox(dialog).click());
    await expect(switchInput).toBeChecked();
    expect(await readAutoSaveEnabled(page)).toBe(true);

    // 空规则表按「匹配所有域名」口径展示
    const emptyHint = dialog.locator('.domain-patterns-section .el-table__empty-text');
    await expect(emptyHint).toContainText(textOf('options.autoSave.noRules'));

    // 非法正则只在本地拒绝，不进规则表
    await checkboxBox(dialog, 'options.autoSave.regex').click();
    await dialog.getByPlaceholder(textOf('options.autoSave.regexPlaceholder')).fill('([unclosed');
    await dialog.getByRole('button', { name: textOf('common.add') }).click();
    await expect(toast(page, 'options.autoSave.invalidRegex')).toBeVisible();
    await expect(emptyHint).toBeVisible();
    await checkboxBox(dialog, 'options.autoSave.regex').click();

    // 同一条规则重复添加被去重
    const domainInput = dialog.getByPlaceholder(textOf('options.autoSave.domainPlaceholder'));
    await domainInput.fill('github.com');
    await dialog.getByRole('button', { name: textOf('common.add') }).click();
    await expect(dialog.locator('.domain-patterns-section .pattern-text')).toHaveText('github.com');
    await domainInput.fill('github.com');
    await dialog.getByRole('button', { name: textOf('common.add') }).click();
    await expect(toast(page, 'options.autoSave.duplicateRule')).toBeVisible();
    await expect(dialog.locator('.domain-patterns-section tbody tr.el-table__row')).toHaveCount(1);

    await expectSuccessToastFor(page, 'options.autoSave.saved', () => footerPrimary(dialog).click());
    await expect(dialog).toBeHidden();
    const stored = (await readStoredConfig(page, STORAGE_KEYS.AUTO_SAVE_CONFIG)) as {
      enabled: boolean;
      domainPatterns: { pattern: string; isRegex: boolean }[];
    };
    expect(stored.enabled).toBe(true);
    expect(stored.domainPatterns.map(p => [p.pattern, p.isRegex])).toEqual([['github.com', false]]);
  });

  test('剪贴板自动清除的开关与延时档位按配置落盘', async ({ optionsPage: page }) => {
    const dialog = await openSecurityDialog(page, 'options.header.clipboard');
    await expect(dialog.getByRole('switch')).toBeChecked();
    await expect(dialog.getByText(textOf('options.clipboard.autoClearTip'))).toBeVisible();

    // 延时档位是「{n} 秒」这种靠数字区分的选项，得把具体值代入文案再匹配
    await dialog.locator('.el-select__wrapper').click();
    await page.getByRole('option', { name: templatedOf('options.clipboard.sec', { n: 15 }) }).click();
    await expectSuccessToastFor(page, 'options.clipboard.savedOn', () => footerPrimary(dialog).click());
    await expect(dialog).toBeHidden();
    expect(await readStoredConfig(page, STORAGE_KEYS.CLIPBOARD_CONFIG)).toEqual({
      autoClear: true,
      clearAfterSeconds: 15,
    });

    // 关掉开关后延时选择器随之收起，落盘的是「不自动清除」，但延时值本身保留
    const reopened = await openSecurityDialog(page, 'options.header.clipboard');
    await switchBox(reopened).click();
    await expect(reopened.getByRole('switch')).not.toBeChecked();
    await expect(reopened.locator('.el-select')).toHaveCount(0);
    await expectSuccessToastFor(page, 'options.clipboard.savedOff', () => footerPrimary(reopened).click());
    expect(await readStoredConfig(page, STORAGE_KEYS.CLIPBOARD_CONFIG)).toEqual({
      autoClear: false,
      clearAfterSeconds: 15,
    });
  });

  test('收藏上限保存后落盘，重新打开弹窗回显已保存的值', async ({ optionsPage: page }) => {
    const dialog = await openSecurityDialog(page, 'options.header.favoriteLimit');
    const limitInput = dialog.getByRole('spinbutton');
    await expect(limitInput).toHaveValue('10');
    await expect(dialog.getByText(textOf('options.favoriteLimit.tip'))).toBeVisible();

    await limitInput.fill('3');
    await expectSuccessToastFor(page, 'options.favoriteLimit.saved', () => footerPrimary(dialog).click());
    await expect(
      toast(page, 'options.favoriteLimit.saved', templatedOf('options.favoriteLimit.saved', { count: 3 })),
    ).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(await readStoredConfig(page, STORAGE_KEYS.FAVORITE_LIMIT)).toBe(3);

    const reopened = await openSecurityDialog(page, 'options.header.favoriteLimit');
    await expect(reopened.getByRole('spinbutton')).toHaveValue('3');
  });

  test('自动锁定的闲置时长与重启重锁开关落盘', async ({ optionsPage: page }) => {
    const dialog = await openSecurityDialog(page, 'options.header.idleLock');
    await dialog.locator('.el-select__wrapper').click();
    await page.getByRole('option', { name: textOf('options.idleLock.min10') }).click();
    await switchBox(dialog).click();
    await expect(dialog.getByRole('switch')).toBeChecked();
    await expectSuccessToastFor(page, 'options.idleLock.saved', () => footerPrimary(dialog).click());
    await expect(dialog).toBeHidden();
    expect(await readStoredConfig(page, STORAGE_KEYS.IDLE_LOCK_CONFIG)).toEqual({
      idleLockMinutes: 10,
      relockOnBrowserRestart: true,
    });

    /*
      触发回路不在这里演：源是 `chrome.idle.onStateChanged('idle')`，由浏览器按真实
      无操作时长派发，测试既没有时钟控制，也无法「什么都不做满 10 分钟」。
      编排本身（状态判定 → 锁会话 → 通知各上下文）由 tests/background/idleLock.test.ts 覆盖。
    */
  });
});
