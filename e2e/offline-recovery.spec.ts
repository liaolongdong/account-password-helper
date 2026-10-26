import type { Locator, Page } from '@playwright/test';
import { STORAGE_KEYS } from '../utils/storageKeys';
import {
  MASTER_PASSWORD,
  createEntry,
  expect,
  expectSuccessToast,
  footerPrimary,
  rowOf,
  storedArrayCount,
  test,
} from './harness';
import { textOf } from './i18n';

/**
 * 离线恢复密钥 —— 真实扩展里的「创建 → 回填验证 → 忘记主密码后找回」全链路
 *
 * 这条链路只能真机验：密钥包裹依赖浏览器原生 Web Crypto，落盘形态依赖 `chrome.storage.local`，
 * 而「保存后必须回填验证才生效」是纯交互契约，单测里 mock 掉就等于没测。
 * 用例盯五件事：
 * 1. 未回填验证前，恢复配置不落盘（避免用户以为已开启）；
 * 2. 盘上只有包裹结果，不含恢复密钥与数据密钥原文；
 * 3. 当前主密码不对时拒绝创建，且不写配置；
 * 4. 忘记主密码后能用密钥重设，并保住既有条目；
 * 5. 恢复成功后套件换发（配置 id 变化），界面保持锁定、不自动填入密码。
 */

/** 恢复流程里的合成口令：只存在于本用例的临时 profile */
const RECOVERED_PASSWORD = 'E2eRecovered!Passw0rd';
/** 改密用例里「准备改到」的新主密码；用例最后会取消，它不应真的生效 */
const NEXT_PASSWORD = 'E2eNextMaster!Pass1';
const ENTRY = { username: 'e2e-recovery@qa.test', password: 'Synthetic!Recover1' };

/** 打开「安全设置 → 离线恢复密钥」 */
async function openRecoverySettings(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: textOf('options.header.securitySettings') }).click();
  await page.getByRole('menuitem', { name: textOf('recovery.settingsTitle') }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: textOf('recovery.settingsTitle') });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status').first()).toBeVisible();
  return dialog;
}

/** 保存步骤（管理页与锁屏共用同一组件） */
const saveStep = (page: Page): Locator => page.getByRole('region', { name: textOf('recovery.saveTitle') });

const readKey = async (step: Locator): Promise<string> =>
  (await step.locator('[data-recovery-key]').innerText()).trim();

/** 勾选明文知情同意 → 隐藏原码 → 从「已保存的副本」回填 → 确认 */
async function confirmSavedKey(page: Page, key: string): Promise<void> {
  // 知情同意现在是两颗按钮共同的门（下载 = 多一份副本；隐藏原码 = 销毁屏幕上唯一一份），
  // 不先勾上，「我已保存」是禁用的。
  // 点 label 而不是原始 input：EP 把 `.el-checkbox__original` 藏成不可见，直接 check 会超时。
  const ack = saveStep(page).locator('.plaintext-ack');
  await ack.click();
  await expect(ack.locator('input')).toBeChecked();
  await saveStep(page)
    .getByRole('button', { name: textOf('recovery.savedContinue') })
    .click();
  await saveStep(page).getByLabel(textOf('recovery.confirmKey')).first().fill(key);
  await saveStep(page)
    .getByRole('button', { name: textOf('recovery.confirmSaved') })
    .click();
}

/** 在已打开的对话框里走到保存步骤；返回界面上读到的恢复密钥 */
async function prepareKitIn(dialog: Locator, page: Page, masterPassword: string): Promise<string> {
  await dialog.getByLabel(textOf('recovery.currentPassword')).fill(masterPassword);
  await dialog.getByRole('button', { name: textOf('recovery.create') }).click();
  await expect(saveStep(page)).toBeVisible({ timeout: 60_000 });
  return readKey(saveStep(page));
}

/** 关闭当前恢复对话框（组件在成功 / 停用后自行关闭，这里只兜住取消路径） */
async function closeRecoveryDialog(page: Page, dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: textOf('common.cancel') }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

/** 清除会话，把管理页带回锁定态 */
async function lockSession(page: Page): Promise<void> {
  await page.locator('.session-chip').click();
  const validity = page.getByRole('dialog').filter({ hasText: textOf('options.validity.title') });
  await expect(validity).toBeVisible();
  await validity.getByRole('button', { name: textOf('options.validity.clearSession') }).click();
  await page
    .locator('.el-message-box')
    .getByRole('button', { name: textOf('session.clearConfirmBtn') })
    .click();
  await expect(page.getByRole('button', { name: textOf('auth.verifySubmit') })).toBeVisible({ timeout: 30_000 });
}

/** 只读回恢复配置的公开元数据（id / 包裹结果），不把任何明文密钥带回测试进程 */
async function readRecoveryConfig(page: Page): Promise<{ id?: string; wrappedDataKey?: string } | null> {
  const stored = (await page.evaluate(async key => chrome.storage.local.get(key), STORAGE_KEYS.RECOVERY_CONFIG)) as
    Record<string, unknown> | undefined;
  const config = stored?.[STORAGE_KEYS.RECOVERY_CONFIG];
  return (typeof config === 'object' && config !== null ? config : null) as {
    id?: string;
    wrappedDataKey?: string;
  } | null;
}

test.describe('离线恢复密钥', () => {
  test('创建必须经回填验证才生效，且盘上不落恢复密钥与数据密钥原文', async ({ optionsPage }) => {
    test.setTimeout(180_000);
    const page = optionsPage;
    await createEntry(page, ENTRY);

    const dialog = await openRecoverySettings(page);
    await expect(dialog.getByText(textOf('recovery.disabled'))).toBeVisible();
    expect(await readRecoveryConfig(page)).toBeNull();

    // 当前主密码不对：既不进保存步骤，也不落任何配置
    await dialog.getByLabel(textOf('recovery.currentPassword')).fill('Wrong-but-formatted!1');
    await dialog.getByRole('button', { name: textOf('recovery.create') }).click();
    await expect(dialog.getByRole('alert')).toContainText(textOf('recovery.error.wrongPassword'));
    expect(await readRecoveryConfig(page)).toBeNull();

    const key = await prepareKitIn(dialog, page, MASTER_PASSWORD);
    // 读到密钥、但还没回填确认：配置仍不得生效（半成品配置等于假的安全感）
    expect(await readRecoveryConfig(page)).toBeNull();
    await confirmSavedKey(page, key);
    await expectSuccessToast(page, 'recovery.activated');
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // 重新打开走真实读盘路径：证明「已启用」来自存储，而不是组件里的本地状态
    const reopened = await openRecoverySettings(page);
    await expect(reopened.getByText(textOf('recovery.enabled'))).toBeVisible();
    const config = await readRecoveryConfig(page);
    expect(config?.id).toBeTruthy();
    expect(config?.wrappedDataKey).toBeTruthy();
    const dumped = JSON.stringify(config);
    expect(dumped).not.toContain(key);
    expect(dumped).not.toContain(MASTER_PASSWORD);
    await closeRecoveryDialog(page, reopened);
  });

  test('忘记主密码后可用密钥重设并保住条目，完成后仍保持锁定且套件已换发', async ({ optionsPage }) => {
    test.setTimeout(240_000);
    const page = optionsPage;
    await createEntry(page, ENTRY);
    const before = await storedArrayCount(page, STORAGE_KEYS.PASSWORDS);

    const dialog = await openRecoverySettings(page);
    const originalKey = await prepareKitIn(dialog, page, MASTER_PASSWORD);
    await confirmSavedKey(page, originalKey);
    await expectSuccessToast(page, 'recovery.activated');
    // 等对话框真正关闭再走锁定：弹层的遮罩会挡住头部芯片的点击
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    const originalConfigId = (await readRecoveryConfig(page))?.id;
    expect(originalConfigId).toBeTruthy();

    await lockSession(page);

    // 恢复密钥登记过之后，锁定页那一行才真的有两枚按钮：这是全套用例里唯一能量到
    // 「逃生出口排布」的现场。两个断言各守一个真机读数过的缺陷——
    // 中文三枚合计 362px / 英文两枚 393px 都超过 350px 可用行宽而折行，
    // 以及 link 按钮那 8px 左内边距让文字看起来没和主按钮对齐。
    const actionRow = await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>('.verify-actions');
      const primary = document.querySelector<HTMLElement>('.verify-form .el-button--primary');
      if (!row || !primary) return null;
      const buttons = [...row.querySelectorAll<HTMLElement>('.el-button')];
      const textX = (el: HTMLElement) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return Math.round(r.getBoundingClientRect().x);
      };
      const ys = buttons.map(el => el.getBoundingClientRect().y);
      return {
        count: buttons.length,
        // 不能按「不同的 y 值个数」判行：`margin-right:auto` 分掉的是小数宽度，
        // 同一行的按钮可以量出 410 与 411 两个 y（真机复现过），必须按像素差判。
        ySpread: ys.length ? Math.round(Math.max(...ys) - Math.min(...ys)) : 0,
        firstTextX: buttons.length ? textX(buttons[0]) : null,
        primaryX: Math.round(primary.getBoundingClientRect().x),
      };
    });
    expect(actionRow, '锁定页动作行没渲染出来').not.toBeNull();
    const row = actionRow as NonNullable<typeof actionRow>;
    expect(row.count, '本机已登记恢复密钥，动作行应有「用密钥取回」和「忘记密码」两枚').toBe(2);
    expect(row.ySpread, '逃生出口折成了两行（整行右对齐随之失效）').toBeLessThanOrEqual(2);
    expect(Math.abs((row.firstTextX ?? 0) - row.primaryX), '首枚按钮的文字没和主按钮左边缘同基线').toBeLessThanOrEqual(
      1,
    );

    // 找回向导里的那枚：恢复弹窗必须打开，且向导得真的让位——
    // 同 tick「关一个 + 开一个」会在 300ms 淡出期把两份文字叠成一屏糊字。
    await page.getByRole('button', { name: textOf('auth.forgotPassword') }).click();
    const wizard = page.getByRole('dialog').filter({ hasText: textOf('options.forgot.title') });
    await expect(wizard).toBeVisible();

    // 向导里那颗恢复按钮要和它上面的正文同一条左基线：
    // EP 的 link 按钮自带内边距，文字会被推离段落左缘，读出来就是「没左对齐」。
    const wizardAlign = await page.evaluate(() => {
      const btn = document.querySelector<HTMLElement>('.forgot-path .el-button');
      const li = btn?.closest('.forgot-path');
      const body = li?.querySelector<HTMLElement>('.forgot-path__body');
      if (!btn || !body) return null;
      const bodyRange = document.createRange();
      bodyRange.selectNodeContents(body);
      const btnRange = document.createRange();
      btnRange.selectNodeContents(btn);
      return {
        bodyX: Math.round(bodyRange.getBoundingClientRect().x),
        btnTextX: Math.round(btnRange.getBoundingClientRect().x),
      };
    });
    expect(wizardAlign, '量不到找回向导里的恢复按钮').not.toBeNull();
    const wa = wizardAlign as NonNullable<typeof wizardAlign>;
    expect(
      wa.btnTextX - wa.bodyX,
      `向导里的恢复按钮文字偏离正文左基线 ${wa.btnTextX - wa.bodyX}px`,
    ).toBeLessThanOrEqual(1);

    await wizard.getByRole('button', { name: textOf('options.forgot.recoveryAction') }).click();
    const reset = page.getByRole('dialog').filter({ hasText: textOf('recovery.resetTitle') });
    await expect(reset).toBeVisible();
    await expect(wizard, '恢复弹窗打开后找回向导没有让位，两层模态叠字').toBeHidden({ timeout: 30_000 });
    await reset.getByRole('button', { name: textOf('common.cancel') }).click();
    await expect(reset).toBeHidden({ timeout: 30_000 });

    await page.getByRole('button', { name: textOf('recovery.useKey') }).click();
    await expect(reset).toBeVisible();

    await reset.getByLabel(textOf('recovery.newPassword')).fill(RECOVERED_PASSWORD);
    await reset.getByLabel(textOf('recovery.confirmPassword')).fill(RECOVERED_PASSWORD);

    // 错误密钥必须先被拒：不换钥、不换发套件、不改任何数据
    await reset
      .getByLabel(textOf('recovery.keyInput'))
      .first()
      .fill('0'.repeat(64) + '-00000000');
    await reset.getByRole('button', { name: textOf('recovery.prepareReset') }).click();
    await expect(reset.getByRole('alert')).toContainText(textOf('recovery.error.invalid'));
    expect((await readRecoveryConfig(page))?.id).toBe(originalConfigId);
    expect(await storedArrayCount(page, STORAGE_KEYS.PASSWORDS)).toBe(before);

    await reset.getByLabel(textOf('recovery.keyInput')).first().fill(originalKey);
    await reset.getByRole('button', { name: textOf('recovery.prepareReset') }).click();
    await expect(saveStep(page)).toBeVisible({ timeout: 60_000 });
    const replacementKey = await readKey(saveStep(page));
    expect(replacementKey).not.toBe(originalKey);
    await confirmSavedKey(page, replacementKey);

    // 完成后保持锁定：恢复不等于顺手解锁，且旧套件不再适用于当前库
    await expect(reset.getByText(textOf('recovery.resetSuccess'))).toBeVisible({ timeout: 90_000 });
    expect(await storedArrayCount(page, STORAGE_KEYS.PASSWORDS)).toBe(before);
    const rotated = await readRecoveryConfig(page);
    expect(rotated?.id).toBeTruthy();
    expect(rotated?.id).not.toBe(originalConfigId);

    await reset.getByRole('button', { name: textOf('recovery.close') }).click();
    const verifyInput = page.getByPlaceholder(textOf('auth.verifyPasswordPlaceholder')).first();
    await expect(verifyInput).toBeVisible();
    expect(await verifyInput.inputValue()).toBe('');

    await verifyInput.fill(RECOVERED_PASSWORD);
    await page.getByRole('button', { name: textOf('auth.verifySubmit') }).click();
    await expect(page.locator('.header-title h1')).toBeVisible({ timeout: 60_000 });
    await expect(rowOf(page, ENTRY.username)).toBeVisible({ timeout: 60_000 });
  });

  test('改密换发套件那一步：正文在弹窗内滚、footer 始终可见，草稿不被 Esc 静默丢掉，取消后主密码不变', async ({
    optionsPage,
  }) => {
    test.setTimeout(300_000);
    const page = optionsPage;

    // 只有本机登记过离线恢复，改密才会走到「换发套件」这一步
    const settings = await openRecoverySettings(page);
    const kitKey = await prepareKitIn(settings, page, MASTER_PASSWORD);
    await confirmSavedKey(page, kitKey);
    await expectSuccessToast(page, 'recovery.activated');
    await expect(settings).toBeHidden({ timeout: 30_000 });

    await page.getByRole('button', { name: textOf('options.header.securitySettings') }).click();
    await page.getByRole('menuitem', { name: textOf('options.header.changeMasterPassword') }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.header.changeMasterPassword') });
    await expect(dialog).toBeVisible();

    await dialog.getByPlaceholder(textOf('options.changePwd.oldPasswordPlaceholder')).fill(MASTER_PASSWORD);
    await dialog.getByPlaceholder(textOf('options.changePwd.newPasswordPlaceholder')).fill(NEXT_PASSWORD);
    await dialog.getByPlaceholder(textOf('options.changePwd.confirmPasswordPlaceholder')).fill(NEXT_PASSWORD);
    await footerPrimary(dialog).click();

    // 停在套件步骤——此刻**还没有**任何写入
    await expect(saveStep(page), '改密没有停在「保存新的恢复套件」这一步').toBeVisible({ timeout: 120_000 });

    // 短视口：footer 必须留在折叠线以上，正文自己滚。改版前整段能长出视口，
    // 「返回编辑 / 取消」被推到屏外，而弹窗本身不滚。
    await page.setViewportSize({ width: 1280, height: 628 });
    await page.waitForTimeout(400);
    const geometry = await page.evaluate(() => {
      const dialogEl = document.querySelector<HTMLElement>('.el-dialog');
      const scroller = dialogEl?.querySelector<HTMLElement>('.dialog-body-scroll');
      const footer = dialogEl?.querySelector<HTMLElement>('.el-dialog__footer');
      if (!dialogEl || !scroller || !footer) return null;
      const bottoms = [...footer.querySelectorAll<HTMLElement>('button')].map(el =>
        Math.round(el.getBoundingClientRect().bottom),
      );
      return {
        viewportHeight: innerHeight,
        dialogTop: Math.round(dialogEl.getBoundingClientRect().top),
        scrollable: scroller.scrollHeight - scroller.clientHeight,
        scrollerCount: document.querySelectorAll('.el-dialog .dialog-body-scroll').length,
        footerBottom: bottoms.length ? Math.max(...bottoms) : null,
      };
    });
    expect(geometry, '量不到改密弹窗 / 内滚容器 / footer').not.toBeNull();
    const g = geometry as NonNullable<typeof geometry>;
    expect(g.scrollerCount, '弹窗里出现了不止一个内滚容器（70vh 套 70vh 会出两条滚动带）').toBe(1);
    expect(g.dialogTop, '改密弹窗被推出屏幕上方').toBeGreaterThanOrEqual(0);
    expect(g.footerBottom, '改密弹窗的 footer 落在折叠线以下').toBeLessThanOrEqual(g.viewportHeight);
    expect(g.scrollable, '套件步骤没有在弹窗内滚，内容整段把弹窗撑出去了').toBeGreaterThan(0);

    // 草稿存续期间 Esc 不得静默作废刚发出来的套件
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(dialog, 'Esc 关掉了草稿态弹窗，用户刚存下的新密钥会静默作废').toBeVisible();

    // 取消退出：库里不应有任何改动，旧主密码照样解得开
    await dialog.getByRole('button', { name: textOf('common.cancel') }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await lockSession(page);
    await page.getByPlaceholder(textOf('auth.verifyPasswordPlaceholder')).first().fill(MASTER_PASSWORD);
    await page.getByRole('button', { name: textOf('auth.verifySubmit') }).click();
    await expect(page.locator('.header-title h1'), '取消改密后旧主密码失效了 —— 说明没等套件认证就提交了').toBeVisible({
      timeout: 60_000,
    });
  });
});
