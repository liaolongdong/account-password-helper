import type { Locator, Page } from '@playwright/test';
import { STORAGE_KEYS } from '../utils/storageKeys';
import {
  expect,
  expectSuccessToast,
  onboardAndUnlock,
  readStoredConfig,
  storedArrayCount,
  test,
  verifyMasterPassword,
} from './harness';
import { numericTemplateOf, textOf } from './i18n';

/**
 * 会话与锁定 —— Options 一级界面
 *
 * 原有用例整体作废：旧实现把被测对象当成 `http://localhost:8899` 上的普通 Web 应用，
 * 那是 WXT dev server 的模块源，扩展从未被加载、`chrome.*` 不存在，
 * `beforeEach` 里等 `.header` 必然超时，没有一条用例真正跑到过断言。
 *
 * 会话剩余时间按「天/时/分/秒」逐级降档：默认 24 小时有效期只会显示到分钟，
 * 一分钟内才见秒。因此「倒计时在走」这条只能把有效期调到 1 小时——
 * 剩余立刻落到 `分钟+秒` 档位，秒位每 tick 变化，是真实可观测的活体信号。
 */

/** 剩余时间的四种展示形态（与会话徽标、有效期弹窗共用） */
const REMAINING = numericTemplateOf('session.dayHour', 'session.hourMinute', 'session.minuteSecond', 'session.second');
/** 1 小时有效期下的展示档位 */
const MINUTE_SECOND = numericTemplateOf('session.minuteSecond');

const chip = (page: Page) => page.locator('.session-chip');
const chipTime = (page: Page) => page.locator('.session-chip__time');

const validityDialog = (page: Page) => page.getByRole('dialog').filter({ hasText: textOf('options.validity.title') });

/** 点徽标打开「验证有效期设置」弹窗 */
async function openValidityDialog(page: Page): Promise<Locator> {
  await chip(page).click();
  const dialog = validityDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('会话管理', () => {
  test('解锁后头部常驻展示会话剩余时间', async ({ optionsPage: page }) => {
    await expect(chip(page)).toBeVisible();
    await expect(chip(page)).toHaveAttribute('title', textOf('options.header.sessionChipTitle'));
    await expect(chipTime(page)).toHaveText(REMAINING);
  });

  test('点击徽标直达有效期设置，并展示当前会话状态', async ({ optionsPage: page }) => {
    const dialog = await openValidityDialog(page);
    await expect(dialog.getByText(textOf('options.validity.sessionStatus'))).toBeVisible();
    await expect(dialog.getByText(textOf('options.validity.sessionActive'))).toBeVisible();
    const remainingRow = dialog.locator('.session-expiry');
    await expect(remainingRow).toContainText(textOf('options.validity.remaining'));
    await expect(remainingRow).toContainText(REMAINING);
  });

  test('调整有效期需验证主密码，保存后徽标按新时长重新倒计时', async ({ optionsPage: page }) => {
    let dialog = await openValidityDialog(page);
    await dialog.locator('.el-select__wrapper').click();
    // 下拉面板 teleport 到 body，不在弹窗子树里，只能从页面根定位
    await page.getByRole('option', { name: textOf('validity.h1') }).click();
    await dialog.locator('.el-dialog__footer .el-button--primary').click();

    await verifyMasterPassword(page, 'session.verifyPrompt');
    await expectSuccessToast(page, 'session.validitySaved');
    await expect(dialog).toBeHidden();
    expect(await readStoredConfig(page, STORAGE_KEYS.MASTER_PASSWORD_VALIDITY)).toBe(1);

    // 1 小时档位下剩余时间落在「分钟+秒」，秒位应随 tick 递减
    await expect(chipTime(page)).toHaveText(MINUTE_SECOND);
    const firstSample = await chipTime(page).innerText();
    await expect
      .poll(async () => chipTime(page).innerText(), { message: '会话徽标没有按秒刷新' })
      .not.toBe(firstSample);

    dialog = await openValidityDialog(page);
    await expect(dialog.locator('.el-select__wrapper')).toContainText(textOf('validity.h1'));
  });

  test('清除会话的二次确认：取消则保持已解锁', async ({ optionsPage: page }) => {
    const dialog = await openValidityDialog(page);
    await dialog.getByRole('button', { name: textOf('options.validity.clearSession') }).click();
    const confirmBox = page.locator('.el-message-box');
    await expect(confirmBox).toContainText(textOf('session.clearConfirm'));
    await confirmBox.getByRole('button', { name: textOf('common.cancel') }).click();
    await expect(confirmBox).toBeHidden();
    // 取消后既没清会话也没关设置弹窗；徽标仍在，说明仍是已解锁态
    await expect(dialog).toBeVisible();
    await expect(chip(page)).toBeVisible();
    await expect(page.getByRole('button', { name: textOf('options.header.addPassword') })).toBeVisible();
  });

  test('清除会话：确认后回到验证页、密文原样保留，可用主密码重新解锁', async ({ optionsPage: page }) => {
    await page.getByRole('button', { name: textOf('options.header.addPassword') }).click();
    const form = page.getByRole('dialog').filter({ hasText: textOf('options.form.addTitle') });
    await form.getByPlaceholder(textOf('options.form.usernamePlaceholder')).fill('e2e-session-keeps-data');
    await form.locator('.el-dialog__footer .el-button--primary').click();
    await expectSuccessToast(page, 'form.addSuccess');

    const beforeLock = await storedArrayCount(page, STORAGE_KEYS.PASSWORDS);
    expect(beforeLock).toBe(1);

    const dialog = await openValidityDialog(page);
    await dialog.getByRole('button', { name: textOf('options.validity.clearSession') }).click();
    await page
      .locator('.el-message-box')
      .getByRole('button', { name: textOf('session.clearConfirmBtn') })
      .click();

    await expect(page.getByRole('button', { name: textOf('auth.verifySubmit') })).toBeVisible();
    await expectSuccessToast(page, 'session.cleared');
    // 清的是会话密钥，不是数据
    expect(await storedArrayCount(page, STORAGE_KEYS.PASSWORDS)).toBe(beforeLock);

    await onboardAndUnlock(page);
    await expect(chip(page)).toBeVisible();
    await expect(page.locator('tr.el-table__row', { hasText: 'e2e-session-keeps-data' })).toBeVisible();
  });

  /**
   * 空闲自动锁定不在 E2E 里演：触发源是 `chrome.idle.onStateChanged('idle')`，
   * 由浏览器按真实无操作时长派发，测试既没有时钟控制也没有办法「什么都不做满 5 分钟」。
   * 编排本身（状态判定 → 锁会话 → 通知各上下文）已由 tests/background/idleLock.test.ts 覆盖，
   * 这里只保留配置入口的可见性，改由 security.spec.ts 断言设置能落盘。
   */
  test('空闲自动锁定的触发回路', () => {
    test.skip(true, '依赖 chrome.idle 真实空闲事件，无时钟控制；逻辑由 tests/background/idleLock.test.ts 覆盖');
  });
});
