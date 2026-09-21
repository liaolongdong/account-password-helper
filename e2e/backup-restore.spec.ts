import type { Locator, Page } from '@playwright/test';
import fs from 'node:fs';
import { STORAGE_KEYS } from '../utils/storageKeys';
import {
  MASTER_PASSWORD,
  allRows,
  createEntry,
  expect,
  expectSuccessToast,
  expectSuccessToastFor,
  footerPrimary,
  leaksPlaintext,
  readStoredConfig,
  rowOf,
  storedArrayCount,
  test,
  toast,
} from './harness';
import { anchoredTextOf, textOf } from './i18n';

/**
 * 备份与恢复 —— 加密 .aph 容器的导出、导入回环，以及邮箱备份配置
 *
 * 原有用例整体作废：旧实现把被测对象当成 `http://localhost:8899` 上的普通 Web 应用，
 * 那是 WXT dev server 的模块源，扩展从未被加载、`chrome.*` 不存在，
 * `beforeEach` 里等 `.header` 必然超时，没有一条用例真正跑到过断言。
 *
 * 为什么走真实下载再原样传回：`.aph` 是 `salt‖iv‖密文` 的二进制容器，测试进程既没有解密
 * 入口，也没有理由手工拼一份「看起来对」的字节串——只有把扩展自己产出的文件喂回去，
 * 才同时验到导出格式、落盘前的 round-trip 自检和导入侧的解析口径。
 * 取回的字节只用于回环上传，断言一律停在文件名、条数、「明文有没有落盘」这类
 * 既不需要解密、也不会把密文带进 trace 的观测上。
 */

/** 回环用的合成凭据：导入后要能在列表里解回这一份明文，所以必须是可断言的具体值 */
const ROUND_TRIP = { username: 'e2e-roundtrip', password: 'Synthetic!RoundTrip1' };

/** 备份邮箱地址：RFC 2606 保留域，不指向任何真实收件人，且本组用例不会触发实际发信 */
const BACKUP_EMAIL = 'e2e-backup@example.com';

/** 数据管理下拉按钮：加密备份导出 / 导入 / 备份到邮箱都从这里进 */
const dataButton = (page: Page) => page.getByRole('button', { name: textOf('options.header.data') });

/**
 * 菜单顶部的「最近验证备份」数值
 *
 * 它是 disabled 的只读状态条而非操作项，断言取数值那一截，标题由
 * backupStatusLabel 单独承载，整行一起读会把「从未导出」这类文案和标题混在一起。
 */
const backupStatusValue = (page: Page) => page.locator('.backup-status-bar__value');

/** 打开「数据管理」菜单：EP 的 popper 懒渲染，展开后状态条才在 DOM 里 */
async function openDataMenu(page: Page): Promise<void> {
  await dataButton(page).click();
  await expect(backupStatusValue(page)).toBeVisible();
}

/** 选中「数据管理」菜单里的某条命令（dropdown item 是 role=menuitem，选中后菜单自动收起） */
async function runDataCommand(page: Page, itemKey: string): Promise<void> {
  await openDataMenu(page);
  await page.getByRole('menuitem', { name: textOf(itemKey) }).click();
}

/** 打开「数据管理」里某个标题与菜单项同源的弹窗 */
async function openDataDialog(page: Page, itemKey: string): Promise<Locator> {
  await runDataCommand(page, itemKey);
  const dialog = page.getByRole('dialog').filter({ hasText: textOf(itemKey) });
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * 走一遍「加密备份导出」，把扩展产出的 .aph 字节取回来
 *
 * 导出前先验主密码，再加密、再自检，最后才落盘下载，所以这一步同时是
 * 「备份文件确实能被本扩展解回」这条契约的前半程。
 */
async function exportBackupFile(page: Page): Promise<Buffer> {
  await runDataCommand(page, 'options.header.backupExport');

  const verify = page.getByRole('dialog').filter({ hasText: textOf('options.backup.exportPrompt') });
  await expect(verify).toBeVisible();
  await verify.getByPlaceholder(textOf('auth.verifyPasswordPlaceholder')).fill(MASTER_PASSWORD);

  const downloadPromise = page.waitForEvent('download');
  await footerPrimary(verify).click();
  await expect(verify).toBeHidden();
  const download = await downloadPromise;

  // 文件名口径来自 utils/dateFormat.formatTimestampCompact：backup_YYYYMMDD_HHmmss.aph
  expect(download.suggestedFilename()).toMatch(/^backup_\d{8}_\d{6}\.aph$/);
  await expect(toast(page, 'options.backup.exportSuccess')).toBeVisible();

  const downloadedPath = await download.path();
  if (!downloadedPath) throw new Error('下载内容未落盘，无法用于导入回环');
  return fs.readFileSync(downloadedPath);
}

/** 走一遍「加密备份导入」：选文件 → 填导出时使用的主密码 → 解密预览 → 确认导入 */
async function importBackupFile(page: Page, filename: string, buffer: Buffer): Promise<void> {
  const dialog = await openDataDialog(page, 'options.header.backupImport');

  await dialog
    .locator('.el-upload__input')
    .setInputFiles({ name: filename, mimeType: 'application/octet-stream', buffer });
  await expect(dialog.locator('.file-info-name')).toHaveText(filename);

  await dialog.getByPlaceholder(textOf('options.backupImport.passwordPlaceholder')).fill(MASTER_PASSWORD);
  await dialog.getByRole('button', { name: textOf('options.backupImport.decryptPreview') }).click();
  await expect(dialog.locator('.preview-section')).toBeVisible();

  const importButton = dialog.locator('.el-dialog__footer .el-button--success');
  await expectSuccessToastFor(page, 'options.import.importSuccess', () => importButton.click());
  await expect(dialog).toBeHidden();
}

test.describe('加密备份导出与导入', () => {
  test('空库时拒绝导出：给出可读提示，「最近验证备份」仍停在从未导出', async ({ optionsPage: page }) => {
    await runDataCommand(page, 'options.header.backupExport');
    await expect(toast(page, 'message.noDataToBackup')).toBeVisible();
    // 没有数据就不该弹主密码验证框：验证本身要跑一次 PBKDF2，而这次导出根本不会发生
    await expect(page.getByRole('dialog').filter({ hasText: textOf('options.backup.exportPrompt') })).toBeHidden();

    await openDataMenu(page);
    await expect(backupStatusValue(page)).toHaveText(textOf('options.header.backupStatusNone'));
  });

  test('导出前必须过主密码：错密码原地拒绝，对密码才产出 .aph 并记下备份时间', async ({ optionsPage: page }) => {
    await createEntry(page, ROUND_TRIP);

    await runDataCommand(page, 'options.header.backupExport');
    const verify = page.getByRole('dialog').filter({ hasText: textOf('options.backup.exportPrompt') });
    await expect(verify).toBeVisible();
    const passwordInput = verify.getByPlaceholder(textOf('auth.verifyPasswordPlaceholder'));

    await passwordInput.fill('E2eWrong!Passw0rd');
    await footerPrimary(verify).click();
    await expect(verify.locator('.verify-error-inline')).toContainText(textOf('verify.wrongPassword'));
    await expect(verify).toBeVisible();
    expect(await readStoredConfig(page, STORAGE_KEYS.LAST_VERIFIED_BACKUP_AT)).toBeNull();

    const downloadPromise = page.waitForEvent('download');
    await passwordInput.fill(MASTER_PASSWORD);
    await footerPrimary(verify).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^backup_\d{8}_\d{6}\.aph$/);
    await expect(verify).toBeHidden();
    await expect(toast(page, 'options.backup.exportSuccess')).toBeVisible();

    // 时间戳只在「自检通过 + 文件已产出」之后写，提醒元数据不能反过来被当成备份成功的证据
    const recordedAt = await readStoredConfig(page, STORAGE_KEYS.LAST_VERIFIED_BACKUP_AT);
    expect(typeof recordedAt).toBe('number');

    await openDataMenu(page);
    await expect(backupStatusValue(page)).toHaveText(textOf('options.header.backupStatusToday'));
  });

  test('导出 → 删除 → 导入回环：条目按原样解回，库里依然只有密文', async ({ optionsPage: page }) => {
    await createEntry(page, ROUND_TRIP);
    const backupFile = await exportBackupFile(page);

    // 删除是软删：移进回收站、列表清空，此时导入才是一次真的恢复而不是补一条重复
    await rowOf(page, ROUND_TRIP.username)
      .getByRole('button', { name: textOf('common.delete') })
      .click();
    await page
      .locator('.el-message-box')
      .getByRole('button', { name: textOf('form.moveToTrash') })
      .click();
    await expectSuccessToast(page, 'form.movedToTrash');
    await expect(allRows(page)).toHaveCount(0);

    await importBackupFile(page, 'e2e-roundtrip.aph', backupFile);

    const row = rowOf(page, ROUND_TRIP.username);
    await expect(row).toBeVisible();
    expect(await storedArrayCount(page, STORAGE_KEYS.PASSWORDS)).toBe(1);

    // 导入的条目走的是当前会话的加密链路：默认掩码，点开才回显导出前那份明文
    const cell = row.locator('.password-cell');
    await expect(cell).toContainText('*'.repeat(8));
    await cell.getByRole('button', { name: textOf('common.showPassword') }).click();
    await expect(cell).toContainText(ROUND_TRIP.password);

    expect(await leaksPlaintext(page, STORAGE_KEYS.PASSWORDS, ROUND_TRIP.password)).toBe(false);
  });

  test('导入时主密码不对：解密失败说清原因，不预览也不放行导入', async ({ optionsPage: page }) => {
    await createEntry(page, ROUND_TRIP);
    const backupFile = await exportBackupFile(page);

    const dialog = await openDataDialog(page, 'options.header.backupImport');
    await dialog
      .locator('.el-upload__input')
      .setInputFiles({ name: 'e2e-roundtrip.aph', mimeType: 'application/octet-stream', buffer: backupFile });
    const importButton = dialog.locator('.el-dialog__footer .el-button--success');
    await expect(importButton).toBeDisabled();

    await dialog.getByPlaceholder(textOf('options.backupImport.passwordPlaceholder')).fill('E2eWrong!Passw0rd');
    await dialog.getByRole('button', { name: textOf('options.backupImport.decryptPreview') }).click();

    // GCM 校验和不过只能报「密码错或文件损坏」，两种原因在密文上无法区分，文案不越界
    await expect(toast(page, 'backup.wrongPasswordOrCorrupted')).toBeVisible();
    await expect(dialog.locator('.preview-section')).toHaveCount(0);
    await expect(importButton).toBeDisabled();
    // 失败路径不清掉已选文件：改对密码就能接着解，不必重新选一次
    await expect(dialog.locator('.file-info-name')).toHaveText('e2e-roundtrip.aph');
  });

  test('非 .aph 文件在选择环节挡下，不进入解密流程', async ({ optionsPage: page }) => {
    const dialog = await openDataDialog(page, 'options.header.backupImport');
    await dialog
      .locator('.el-upload__input')
      .setInputFiles({ name: 'e2e-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a backup file') });

    await expect(toast(page, 'options.backupImport.unsupportedFormat')).toBeVisible();
    // 被拒的文件同时从选择列表里清掉，主密码输入区随 v-if 收起，不留半个流程
    await expect(dialog.locator('.file-info')).toHaveCount(0);
    await expect(dialog.locator('.password-section')).toHaveCount(0);
  });
});

test.describe('邮箱备份设置', () => {
  test('非法邮箱被表单挡下，合法配置与提醒间隔按落盘为准', async ({ optionsPage: page }) => {
    const dialog = await openDataDialog(page, 'options.header.emailBackup');
    const emailInput = dialog.getByPlaceholder(textOf('options.emailBackup.emailPlaceholder'));
    const saveButton = dialog.getByRole('button', { name: textOf('options.emailBackup.saveConfig') });

    // ① 非法地址：表单就地报错，配置一个字节都不写
    await emailInput.fill('not-an-email');
    await saveButton.click();
    await expect(
      dialog.locator('.el-form-item__error').filter({ hasText: textOf('options.emailBackup.emailInvalid') }),
    ).toBeVisible();
    expect(await readStoredConfig(page, STORAGE_KEYS.EMAIL_BACKUP_CONFIG)).toBeNull();

    // ② 加密备份方式：只多一条「只能通过加密备份导入解开」的提醒，不改写入语义。
    // 两个 radio 的文案互为子串（加密备份 ⊂ 不加密备份），必须整串锚定才不撞 strict mode。
    await dialog.locator('.el-radio', { hasText: anchoredTextOf('options.emailBackup.encrypted') }).click();
    await expect(dialog.locator('.encrypted-backup-tip')).toContainText(
      textOf('options.emailBackup.encryptedTipPrefix'),
    );

    // ③ 合法地址 + 打开自动提醒 + 间隔改成每3天，一次保存全部落盘
    await emailInput.fill(BACKUP_EMAIL);
    await dialog.locator('.el-switch').click();
    await expect(dialog.getByRole('switch')).toBeChecked();
    await dialog.locator('.el-select__wrapper').click();
    await page.getByRole('option', { name: textOf('options.emailBackup.every3Days') }).click();

    await expectSuccessToastFor(page, 'options.emailBackup.configSaved', () => saveButton.click());
    expect(await readStoredConfig(page, STORAGE_KEYS.EMAIL_BACKUP_CONFIG)).toMatchObject({
      email: BACKUP_EMAIL,
      autoBackup: true,
      autoBackupIntervalDays: 3,
    });

    // 重新打开是从存储回读，不是组件里的本地副本：这一步才证明「设置真的生效」
    await dialog.getByRole('button', { name: textOf('common.cancel') }).click();
    const reopened = await openDataDialog(page, 'options.header.emailBackup');
    await expect(reopened.getByPlaceholder(textOf('options.emailBackup.emailPlaceholder'))).toHaveValue(BACKUP_EMAIL);
    await expect(reopened.getByRole('switch')).toBeChecked();
    await expect(reopened.locator('.el-select')).toContainText(textOf('options.emailBackup.every3Days'));

    /*
      「立即备份」不在这里点：它会先验证主密码、下载一份数据文件，再 `window.open('mailto:...')`
      把邮件交给操作系统注册的邮件客户端。无头环境里既没有 mailto 处理器，也没有任何一步能
      回读邮件结果，跑了只会得到不可复现的外部程序拉起。两种备份方式产出的字节分别由
      utils/backupExport 与 utils/emailBackup 的单元测试覆盖，本用例守的是配置落盘与回显。
    */
  });
});
