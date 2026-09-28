import type { Locator, Page } from '@playwright/test';
import fs from 'node:fs';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import {
  allRows,
  createEntry,
  expect,
  expectSuccessToast,
  footerPrimary,
  leaksPlaintext,
  MASTER_PASSWORD,
  openHeaderDialog,
  rowOf,
  runHeaderCommand,
  storedArrayCount,
  test,
  toast,
} from './harness';
import { numericTemplateOf, templatedOf, textOf } from './i18n';

/**
 * 导入导出与工具类入口（CSV 导入 / JSON 导出 / 一键去重 / 快捷键一览 / 密码历史）
 *
 * 原有用例整体作废：旧实现把被测对象当成 `http://localhost:8899` 上的普通 Web 应用，
 * 那是 WXT dev server 的模块源，扩展从未被加载、`chrome.*` 不存在，
 * `beforeEach` 里等 `.header` 必然超时，没有一条用例真正跑到过断言；
 * 其中 `.site-rules-table`、`page.selectOption` 等选择器在仓库里也根本不存在。
 * 现按 e2e/site-rules.spec.ts 的写法用 `optionsPage` 夹具重写。
 *
 * 与 e2e/backup-restore.spec.ts 的分工：那边管「加密备份 .aph 导出→导入」这条恢复链路
 * （验密 + 自检 + 解回明文）；本文件管明文 CSV/JSON 这一对入口，以及去重、快捷键一览、
 * 密码历史三个工具面。
 */

/** 导入用合成凭据：RFC 2606 保留域，不对应任何真实账号 */
const IMPORT_ROWS = [
  { username: 'e2e-import-1', password: 'Synthetic!Import1', url: 'https://import-1.e2e.test', remark: 'csv one' },
  { username: 'e2e-import-2', password: 'Synthetic!Import2', url: 'https://import-2.e2e.test', remark: 'csv two' },
  { username: 'e2e-import-3', password: 'Synthetic!Import3', url: 'https://import-3.e2e.test', remark: 'csv three' },
];

/**
 * 带 BOM 的 CSV：`utils/excelCsv.ts` 显式剥 `\u{FEFF}`，
 * 真实导出文件（Chrome 与本扩展自己的 CSV）都带 BOM，不带反而不是要复现的场景。
 */
const CSV_WITH_BOM = `\u{FEFF}username,password,url,remark
${IMPORT_ROWS.map(row => `${row.username},${row.password},${row.url},${row.remark}`).join('\n')}
`;

const KEEP_ENTRY = { username: 'e2e-keep', password: 'Synthetic!Keep1', url: 'https://keep.e2e.test/' };
const DUP_OLD = { username: 'e2e-dup', password: 'Synthetic!DupOld', url: 'https://dup.e2e.test/' };
const DUP_NEW = { username: 'e2e-dup', password: 'Synthetic!DupNew', url: 'https://dup.e2e.test/' };
/** 同名不同站：去重按 username+url 成组，这条必须原样留着 */
const DUP_OTHER_SITE = { username: 'e2e-dup', password: 'Synthetic!DupOther', url: 'https://other-dup.e2e.test/' };

const HISTORY_ENTRY = { username: 'e2e-history', password: 'Synthetic!HistoryOld' };
const HISTORY_NEW_PASSWORD = 'Synthetic!HistoryNew';

/** 「数据管理」/「安全设置」两个下拉的按钮文案 key */
const DATA_MENU = 'options.header.data';
const SECURITY_MENU = 'options.header.securitySettings';

/** 二次确认框：ElMessageBox 不是 dialog 角色，只能按容器类定位 */
const messageBox = (page: Page): Locator => page.locator('.el-message-box');

/** 弹窗 footer 里的绿色主按钮（导入弹窗的「确认导入（N 条）」） */
const footerSuccess = (dialog: Locator) => dialog.locator('.el-dialog__footer .el-button--success');

/** 走「数据管理 → 导入数据」，返回按弹窗标题定位到的导入弹窗 */
async function openImportDialog(page: Page): Promise<Locator> {
  await runHeaderCommand(page, DATA_MENU, 'options.header.importData');
  const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.import.title') });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('导入导出与工具入口', () => {
  test('CSV 导入：带 BOM 自动检测走通，预览计数与落盘条数一致且库里只有密文', async ({ optionsPage: page }) => {
    const dialog = await openImportDialog(page);

    await dialog.locator('input[type=file]').setInputFiles({
      name: 'e2e-import.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(CSV_WITH_BOM, 'utf-8'),
    });

    // 解析成功才出现预览区；条数以预览计数为准，不硬编码气泡文案
    const preview = dialog.locator('.preview-section');
    await expect(preview).toBeVisible();
    await expect(preview.locator('.preview-total')).toHaveText(
      templatedOf('options.import.previewTotal', { count: IMPORT_ROWS.length }),
    );
    // 预览默认掩码：不把明文铺在屏幕上
    await expect(preview.locator('.preview-footer')).toContainText(textOf('options.import.showPassword'));
    await expect(preview.locator('tr.el-table__row')).toHaveCount(IMPORT_ROWS.length);

    await footerSuccess(dialog).click();
    await expect(dialog).toBeHidden();
    await expect(
      toast(page, 'options.import.importSuccess', numericTemplateOf('options.import.importSuccess')),
    ).toBeVisible();

    await expect(allRows(page)).toHaveCount(IMPORT_ROWS.length);
    for (const row of IMPORT_ROWS) {
      await expect(rowOf(page, row.username)).toContainText(row.url);
    }
    expect(await storedArrayCount(page, STORAGE_KEYS.PASSWORDS)).toBe(IMPORT_ROWS.length);
    expect(await leaksPlaintext(page, STORAGE_KEYS.PASSWORDS, IMPORT_ROWS[0].password)).toBe(false);
  });

  test('JSON 导出：空库先挡下，错密码原地拒绝，验通过后才产出明文文件', async ({ optionsPage: page }) => {
    // 空库：只给可读提示，连验密框都不该弹
    await runHeaderCommand(page, DATA_MENU, 'options.header.exportJson');
    await expect(toast(page, 'form.noDataToExport')).toBeVisible();
    await expect(page.getByPlaceholder(textOf('auth.verifyPasswordPlaceholder'))).toHaveCount(0);

    await createEntry(page, KEEP_ENTRY);

    await runHeaderCommand(page, DATA_MENU, 'options.header.exportJson');
    const verify = page.getByRole('dialog').filter({ hasText: textOf('form.exportVerifyPrompt') });
    await expect(verify).toBeVisible();

    const passwordField = verify.getByPlaceholder(textOf('auth.verifyPasswordPlaceholder'));
    await passwordField.fill('E2eWrong!Passw0rd');
    await footerPrimary(verify).click();
    await expect(verify.locator('.verify-error-inline')).toContainText(textOf('verify.wrongPassword'));
    await expect(verify).toBeVisible();

    // 重试验证：下载事件必须在提交前挂好，否则会错过
    const downloadPromise = page.waitForEvent('download');
    await passwordField.fill(MASTER_PASSWORD);
    await footerPrimary(verify).click();
    const download = await downloadPromise;

    await expect(verify).toBeHidden();
    await expect(toast(page, 'form.exportSuccess')).toBeVisible();
    // 文件名口径来自 usePasswordManagement 的 `passwords_${formatTimestampCompact(now)}.json`
    expect(download.suggestedFilename()).toMatch(/^passwords_\d{8}_\d{6}\.json$/);

    const downloadedPath = await download.path();
    // 载荷是 `{ version, exportedAt, count, entries }` 信封而非裸数组（utils/excelExport.exportToJSON）
    const payload = JSON.parse(fs.readFileSync(downloadedPath!, 'utf-8')) as {
      version: number;
      count: number;
      entries: Array<Record<string, unknown>>;
    };
    expect(payload.version).toBe(1);
    expect(payload.count).toBe(1);
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0].username).toBe(KEEP_ENTRY.username);
    // 明文导出是这一格式的定义本身（供第三方密码管理器消费），
    // 因此这里断言「导出的就是原值」，与 .aph 那条「只有密文」的断言互为对照。
    expect(payload.entries[0].password).toBe(KEEP_ENTRY.password);
    // 信封导出的是去掉 `id`/`order` 的条目形态，本地主键不外泄
    expect(payload.entries[0].id).toBeUndefined();
    expect(payload.entries[0].url).toBe(KEEP_ENTRY.url);
  });

  test('一键去重：无重复只给提示，取消确认不动数据，确认后多余条目进回收站', async ({ optionsPage: page }) => {
    await createEntry(page, KEEP_ENTRY);
    await runHeaderCommand(page, DATA_MENU, 'options.header.removeDuplicates');
    await expect(toast(page, 'form.noDuplicates')).toBeVisible();
    expect(await storedArrayCount(page, STORAGE_KEYS.PASSWORDS)).toBe(1);

    await createEntry(page, DUP_OLD);
    await createEntry(page, DUP_NEW);
    await createEntry(page, DUP_OTHER_SITE);
    await expect(allRows(page)).toHaveCount(4);

    // 取消：一条都不能少，回收站保持空
    await runHeaderCommand(page, DATA_MENU, 'options.header.removeDuplicates');
    const box = messageBox(page);
    await expect(box).toBeVisible();
    await box.getByRole('button', { name: textOf('common.cancel') }).click();
    await expect(box).toBeHidden();
    await expect(allRows(page)).toHaveCount(4);
    expect(await storedArrayCount(page, STORAGE_KEYS.TRASH)).toBe(0);

    await runHeaderCommand(page, DATA_MENU, 'options.header.removeDuplicates');
    await expect(messageBox(page)).toContainText(numericTemplateOf('form.dedupeConfirm'));
    await messageBox(page)
      .getByRole('button', { name: textOf('common.confirm') })
      .click();
    await expect(toast(page, 'form.dedupeDone', numericTemplateOf('form.dedupeDone'))).toBeVisible();

    // 每组只留一条：同名同站的两条并成一条，同名不同站那条不受影响
    await expect(allRows(page)).toHaveCount(3);
    await expect(rowOf(page, DUP_OTHER_SITE.username)).toHaveCount(2);
    expect(await storedArrayCount(page, STORAGE_KEYS.PASSWORDS)).toBe(3);
    expect(await storedArrayCount(page, STORAGE_KEYS.TRASH)).toBe(1);
  });

  test('快捷键一览：逐条展示 manifest 命令的真实绑定状态，未绑定才给指引', async ({ optionsPage: page }) => {
    const dialog = await openHeaderDialog(page, SECURITY_MENU, 'options.header.shortcuts');

    /**
     * 命令标识与展示文案 key 成对列出：标识与 `wxt.config.ts` 的 manifest.commands 键名
     * 一致（两处一致性由 tests/utils/shortcutCommands.test.ts 静态守卫），数组顺序即
     * `SHORTCUT_COMMANDS` 的展示顺序，因此可以按行号逐条对上。
     */
    const commands = [
      { id: 'open_options', labelKey: 'options.shortcuts.label.openOptions' },
      { id: 'toggle_sidepanel', labelKey: 'options.shortcuts.label.toggleSidepanel' },
      { id: 'quick_fill', labelKey: 'options.shortcuts.label.quickFill' },
      { id: 'open_inline_dropdown', labelKey: 'options.shortcuts.label.openInlineDropdown' },
    ];
    // 绑定状态以运行时 `chrome.commands.getAll()` 为事实来源：suggested_key 能否注册成功
    // 取决于机器上是否有占用，硬编码「已生效」换台机器就会假失败。
    const boundById = await page.evaluate(async () => {
      const commands = await chrome.commands.getAll();
      return Object.fromEntries(commands.map(command => [command.name ?? '', Boolean(command.shortcut)]));
    });

    const items = dialog.locator('.shortcut-item');
    await expect(items).toHaveCount(commands.length);
    for (const [index, command] of commands.entries()) {
      const item = items.nth(index);
      await expect(item.locator('.shortcut-item__name')).toHaveText(textOf(command.labelKey));
      expect(boundById[command.id]).toBeDefined();
      if (boundById[command.id]) {
        await expect(item.locator('.el-text--success')).toBeVisible();
        await expect(item.locator('.shortcut-item__hint')).toHaveCount(0);
      } else {
        await expect(item.locator('.el-text--warning')).toBeVisible();
        await expect(item.locator('.shortcut-item__hint')).toBeVisible();
      }
    }
  });

  test('密码历史：改密后旧值只以密文入库，详情抽屉里默认掩码', async ({ optionsPage: page }) => {
    await createEntry(page, HISTORY_ENTRY);

    await rowOf(page, HISTORY_ENTRY.username)
      .getByRole('button', { name: textOf('common.edit') })
      .click();
    const edit = page.getByRole('dialog').filter({ hasText: textOf('options.form.editTitle') });
    await edit.getByPlaceholder(textOf('options.form.passwordPlaceholder')).fill(HISTORY_NEW_PASSWORD);
    await footerPrimary(edit).click();
    await expectSuccessToast(page, 'form.updateSuccess');
    await expect(edit).toBeHidden();

    // 历史默认开启（configManager 的 DEFAULT_PASSWORD_HISTORY_CONFIG.enabled）
    expect(await storedArrayCount(page, STORAGE_KEYS.PASSWORD_HISTORY)).toBe(1);
    expect(await leaksPlaintext(page, STORAGE_KEYS.PASSWORD_HISTORY, HISTORY_ENTRY.password!)).toBe(false);
    // 旧密码不再留在当前条目里
    expect(await leaksPlaintext(page, STORAGE_KEYS.PASSWORDS, HISTORY_ENTRY.password!)).toBe(false);

    await rowOf(page, HISTORY_ENTRY.username)
      .getByRole('button', { name: textOf('options.detail.viewDetail') })
      .click();
    const drawer = page.getByRole('dialog').filter({ hasText: textOf('options.detail.title') });
    await expect(drawer).toBeVisible();
    const historyItems = drawer.locator('.detail-history__item');
    await expect(historyItems).toHaveCount(1);
    // 历史项默认是点位掩码，点开眼睛才解密
    await expect(historyItems.first()).toContainText('••••••••');
  });
});
