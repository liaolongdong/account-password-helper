/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, shallowRef, type App, type Component } from 'vue';
import {
  ElAlert,
  ElButton,
  ElCard,
  ElCheckbox,
  ElDialog,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElMessage,
  ElOption,
  ElSelect,
  ElPopover,
  ElProgress,
} from 'element-plus';
import RecoveryKitSaveStep from '@/components/options/RecoveryKitSaveStep.vue';
import RecoverySettingsDialog from '@/components/options/RecoverySettingsDialog.vue';
import RecoveryResetDialog from '@/components/options/RecoveryResetDialog.vue';
import PasswordVerifyView from '@/components/options/PasswordVerifyView.vue';
import ChangeMasterPasswordDialog from '@/components/options/ChangeMasterPasswordDialog.vue';
import { currentLocale, t } from '@/utils/i18n';
import '@/utils/i18n/bundles/options';
import type { RecoveryDraft } from '@/utils/storage/recoveryTypes';

// Web Crypto / storage correctness belongs to the parent's integration tests.
// These boundary doubles control completion order without writing any vault.
const api = vi.hoisted(() => ({
  getRecoveryStatus: vi.fn(),
  prepareRecoveryEnrollment: vi.fn(),
  activateRecovery: vi.fn(),
  disableRecovery: vi.fn(),
  preparePasswordRecovery: vi.fn(),
  recoverMasterPassword: vi.fn(),
  prepareChangedPasswordRecovery: vi.fn(),
  changeMasterPassword: vi.fn(),
}));
vi.mock('@/utils/storage/recovery', () => api);
vi.mock('@/utils/storage/changeMasterPassword', () => ({ changeMasterPassword: api.changeMasterPassword }));

/**
 * 合成套件必须过 `isRecoveryConfig` / `normalizeRecoveryCode` 的真实形状校验：
 * 下载与回填确认那两条链路会直接调用序列化，形状不对会在组件里先抛 RECOVERY_INVALID，
 * 断言就变成「什么都没发生」的假绿。id 32 hex、包裹密文 80 base64、密钥 18 组 ×4 = 72 hex + 4 位校验和。
 */
const draft: RecoveryDraft = {
  material: {
    config: { version: 1, id: 'a'.repeat(32), createdAt: 1700000000000, wrappedDataKey: 'a'.repeat(80) },
    recoveryKey: Array.from({ length: 18 }, () => 'abcd').join('-'),
  },
  sourceMasterFingerprint: 'synthetic-fingerprint',
  sourceRecoveryId: null,
};
let app: App | undefined;
let host: HTMLDivElement;
const opened = shallowRef(true);
const mounted = shallowRef(true);
const confirmed = vi.fn();
const recovered = vi.fn();

/** Flush dynamic imports, Element Plus transitions and Vue updates, without timer polling. */
async function settle() {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await nextTick();
}
/**
 * 断言「某条链路已经跑完」时用这个而不是裸 expect：组件里的动态 `import()` 在机器负载高时
 * 会多花几个宏任务，裸断言会把时序抖动变成假红（同一条用例单跑绿、并发跑红）。
 * 它等的是同一个断言，不放宽任何预期。
 */
async function until(assertion: () => void) {
  await vi.waitFor(assertion, { timeout: 3000, interval: 10 });
}
async function mount(component: Component, extra: Record<string, unknown> = {}) {
  app = createApp({
    render: () =>
      mounted.value
        ? h(component, {
            modelValue: opened.value,
            'onUpdate:modelValue': (v: boolean) => {
              opened.value = v;
            },
            onConfirm: confirmed,
            onRecovered: recovered,
            ...extra,
          })
        : null,
  });
  for (const component of [
    ElAlert,
    ElButton,
    ElCard,
    ElCheckbox,
    ElDialog,
    ElForm,
    ElFormItem,
    ElIcon,
    ElInput,
    ElOption,
    ElSelect,
    ElPopover,
    ElProgress,
  ]) {
    app.component(component.name!, component);
  }
  vi.stubGlobal('ElMessage', ElMessage);
  app.mount(host);
  await settle();
  await settle();
}
function input(label: string): HTMLInputElement | HTMLTextAreaElement {
  const node = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${t(label)}"]`);
  expect(node, label).not.toBeNull();
  return node!;
}
async function enter(label: string, value: string) {
  const node = input(label);
  node.value = value;
  node.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}
function button(key: string): HTMLButtonElement {
  const node = [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === t(key));
  expect(node, key).toBeTruthy();
  return node!;
}
async function click(key: string) {
  button(key).click();
  await settle();
}
function checkbox(label: string): HTMLInputElement {
  const node = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(input =>
    input.closest('label')?.textContent?.includes(t(label)),
  );
  expect(node, label).toBeTruthy();
  return node!;
}
async function check(label: string) {
  checkbox(label).click();
  await settle();
}
/** 已渲染的 ElMessage 文案（改密弹窗的失败反馈历来走 toast，这条口径由断言钉住） */
function toastText(): string {
  return [...document.querySelectorAll('.el-message')].map(node => node.textContent?.trim() ?? '').join(' | ');
}
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
async function fillReset() {
  await enter('recovery.keyInput', 'saved-old-recovery-key');
  await enter('recovery.newPassword', '  Fresh!pass82  ');
  await enter('recovery.confirmPassword', 'Fresh!pass82');
}
async function confirmKit() {
  await click('recovery.savedContinue');
  expect(document.querySelector('[data-recovery-key]')).toBeNull();
  await enter('recovery.confirmKey', draft.material.recoveryKey);
  await click('recovery.confirmSaved');
}

beforeEach(() => {
  Object.values(api).forEach(mock => mock.mockReset());
  api.getRecoveryStatus.mockResolvedValue({ enabled: false, config: null, corrupted: false });
  api.prepareRecoveryEnrollment.mockResolvedValue(draft);
  api.preparePasswordRecovery.mockResolvedValue(draft);
  api.prepareChangedPasswordRecovery.mockResolvedValue(null);
  confirmed.mockReset();
  recovered.mockReset();
  opened.value = true;
  mounted.value = true;
  currentLocale.value = 'en';
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  host.remove();
  document.querySelectorAll('.el-overlay, .el-message').forEach(el => el.remove());
  vi.restoreAllMocks();
  currentLocale.value = 'zh-CN';
});

describe('RecoveryKitSaveStep', () => {
  it('never confirms while the original code is visible; requires independently re-entered material', async () => {
    await mount(RecoveryKitSaveStep, { material: draft.material });
    expect(document.querySelector('[data-recovery-key]')?.textContent).toBe(draft.material.recoveryKey);
    expect(document.querySelector(`[aria-label="${t('recovery.confirmKey')}"]`)).toBeNull();
    expect(confirmed).not.toHaveBeenCalled();
    await click('recovery.savedContinue');
    expect(document.body.textContent).not.toContain(draft.material.recoveryKey);
    expect(button('recovery.confirmSaved').disabled).toBe(true);
    await enter('recovery.confirmKey', 'saved-confirmation');
    await click('recovery.confirmSaved');
    expect(confirmed).toHaveBeenCalledWith('saved-confirmation');
  });

  it('rejects oversized files before reading and oversized decoded text before accepting it', async () => {
    await mount(RecoveryKitSaveStep, { material: draft.material });
    await click('recovery.savedContinue');
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const read = vi.fn().mockResolvedValue('x'.repeat(4097));
    const upload = async (size: number) => {
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [{ size, text: read }] });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
    };
    await upload(16385);
    expect(read).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(t('recovery.fileTooLarge'));
    await upload(4097);
    expect(read).toHaveBeenCalledTimes(1);
    expect(input('recovery.confirmKey').value).toBe('');
    expect(button('recovery.confirmSaved').disabled).toBe(true);
  });

  it('requires the plaintext acknowledgment before the kit download is enabled', async () => {
    await mount(RecoveryKitSaveStep, { material: draft.material });
    expect(button('recovery.downloadKit').disabled, '未确认明文风险时下载必须禁用').toBe(true);
    await check('recovery.plaintextAck');
    expect(button('recovery.downloadKit').disabled).toBe(false);
  });

  it('attaches the kit download anchor to the document before clicking it, and names it after the kit id', async () => {
    // jsdom 不实现 createObjectURL：就地桩掉，这条断言量的只是「游离 `<a>` 在部分浏览器是空操作」
    // 这个真实缺陷——点完就会隐藏原码，静默失败等于让用户丢掉唯一一份密钥。
    const urlHost = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    const originals = { create: urlHost.createObjectURL, revoke: urlHost.revokeObjectURL };
    urlHost.createObjectURL = () => 'blob:aph-stub';
    urlHost.revokeObjectURL = () => undefined;
    const seen: Array<{ inDoc: boolean; name: string }> = [];
    const nativeClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
      seen.push({ inDoc: document.contains(this), name: this.getAttribute('download') ?? '' });
    };
    try {
      await mount(RecoveryKitSaveStep, { material: draft.material });
      await check('recovery.plaintextAck');
      await click('recovery.downloadKit');
    } finally {
      HTMLAnchorElement.prototype.click = nativeClick;
      urlHost.createObjectURL = originals.create;
      urlHost.revokeObjectURL = originals.revoke;
    }
    expect(seen).toHaveLength(1);
    expect(seen[0].inDoc, '下载锚点没有挂进文档就被点击').toBe(true);
    expect(seen[0].name).toBe(`offline-recovery-${draft.material.config.id.slice(0, 8)}.aphrecovery`);
  });
});

describe('RecoverySettingsDialog', () => {
  it('reads status only, authenticates before drafting, and activates only after saved-material confirmation', async () => {
    await mount(RecoverySettingsDialog);
    await until(() => expect(api.getRecoveryStatus).toHaveBeenCalledTimes(1));
    expect(button('recovery.create').disabled).toBe(true);
    await enter('recovery.currentPassword', '  Current!pass82  ');
    await click('recovery.create');
    await until(() => expect(api.prepareRecoveryEnrollment).toHaveBeenCalledWith('Current!pass82'));
    expect(api.activateRecovery).not.toHaveBeenCalled();
    await confirmKit();
    await until(() =>
      expect(api.activateRecovery).toHaveBeenCalledWith('Current!pass82', draft, draft.material.recoveryKey),
    );
    await until(() => expect(opened.value).toBe(false));
  });

  it('cancelling a replacement leaves the old recovery untouched and clears detached password inputs', async () => {
    api.getRecoveryStatus.mockResolvedValue({ enabled: true, config: draft.material.config, corrupted: false });
    await mount(RecoverySettingsDialog);
    await enter('recovery.currentPassword', 'Current!pass82');
    const oldInput = input('recovery.currentPassword');
    await click('recovery.replace');
    await click('common.cancel');
    expect(api.activateRecovery).not.toHaveBeenCalled();
    expect(api.disableRecovery).not.toHaveBeenCalled();
    expect(oldInput.value).toBe('');
  });

  it('requires explicit disable acknowledgement and current password', async () => {
    api.getRecoveryStatus.mockResolvedValue({ enabled: true, config: draft.material.config, corrupted: false });
    await mount(RecoverySettingsDialog);
    await enter('recovery.currentPassword', 'Current!pass82');
    expect(button('recovery.disable').disabled).toBe(true);
    const check = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    check.click();
    await settle();
    expect(document.body.textContent).toContain(t('recovery.disableWarning'));
    await click('recovery.disable');
    await until(() => expect(api.disableRecovery).toHaveBeenCalledWith('Current!pass82'));
  });

  it.each(['close', 'unmount', 'pagehide'])('ignores late drafts after %s', async action => {
    const task = pending<RecoveryDraft>();
    api.prepareRecoveryEnrollment.mockReturnValue(task.promise);
    await mount(RecoverySettingsDialog);
    await enter('recovery.currentPassword', 'Current!pass82');
    await click('recovery.create');
    expect(button('common.cancel').disabled).toBe(true);
    if (action === 'close') opened.value = false;
    else if (action === 'unmount') mounted.value = false;
    else window.dispatchEvent(new Event('pagehide'));
    await settle();
    task.resolve(draft);
    await settle();
    expect(document.querySelector('[data-recovery-key]')).toBeNull();
    expect(api.activateRecovery).not.toHaveBeenCalled();
  });
});

describe('RecoveryResetDialog', () => {
  it('explains disabled recovery without offering a bypass', async () => {
    await mount(RecoveryResetDialog);
    expect(document.body.textContent).toContain(t('recovery.notEnabled'));
    expect(document.querySelector(`[aria-label="${t('recovery.newPassword')}"]`)).toBeNull();
    expect(api.preparePasswordRecovery).not.toHaveBeenCalled();
  });

  it('validates normalized passwords, prepares without writing, then recovers and emits refresh without unlocking', async () => {
    api.getRecoveryStatus.mockResolvedValue({ enabled: true, config: draft.material.config, corrupted: false });
    await mount(RecoveryResetDialog);
    await fillReset();
    await click('recovery.prepareReset');
    await until(() =>
      expect(api.preparePasswordRecovery).toHaveBeenCalledWith('saved-old-recovery-key', 'Fresh!pass82'),
    );
    expect(api.recoverMasterPassword).not.toHaveBeenCalled();
    expect(document.querySelector(`[aria-label="${t('recovery.newPassword')}"]`)).toBeNull();
    await confirmKit();
    await until(() =>
      expect(api.recoverMasterPassword).toHaveBeenCalledWith(
        'saved-old-recovery-key',
        'Fresh!pass82',
        draft,
        draft.material.recoveryKey,
        // 第 5 个参数是「知情跳过」，默认必须 fail-closed：没勾选过就传 false
        false,
      ),
    );
    await until(() => expect(recovered).toHaveBeenCalledTimes(1));
    expect(document.body.textContent).toContain(t('recovery.resetSuccess'));
    // 没走过知情跳过，就不该冒出「部分数据已不可读」的追加说明
    expect(document.body.textContent).not.toContain(t('recovery.resetPartialNote'));
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('只在零容忍真的挡过一次之后才亮出知情跳过，并把同意带到存储层', async () => {
    api.getRecoveryStatus.mockResolvedValue({ enabled: true, config: draft.material.config, corrupted: false });
    const incomplete = () => Object.assign(new Error('RECOVERY_INCOMPLETE'), { code: 'RECOVERY_INCOMPLETE' });
    // 前两次提交都被零容忍中止；第三次（勾选后）走默认的成功返回
    api.recoverMasterPassword.mockRejectedValueOnce(incomplete()).mockRejectedValueOnce(incomplete());
    await mount(RecoveryResetDialog);
    await fillReset();
    await click('recovery.prepareReset');
    await until(() => expect(api.preparePasswordRecovery).toHaveBeenCalled());
    await confirmKit();
    await until(() => expect(api.recoverMasterPassword).toHaveBeenCalledTimes(1));

    // 门只在失败原因确实是「有记录解不开」时出现，且必须用户主动勾选
    const check = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(check).toBeTruthy();
    expect(check.checked).toBe(false);
    expect(document.body.textContent).toContain(t('recovery.skipNote'));

    // 不勾选就重试：仍然按 fail-closed 传 false，行为与修复前一致
    await enter('recovery.confirmKey', draft.material.recoveryKey);
    await click('recovery.confirmSaved');
    await until(() => expect(api.recoverMasterPassword).toHaveBeenCalledTimes(2));
    expect(api.recoverMasterPassword).toHaveBeenLastCalledWith(
      'saved-old-recovery-key',
      'Fresh!pass82',
      draft,
      draft.material.recoveryKey,
      false,
    );

    // 勾选后重试：把知情同意带到存储层，并在成功文案里点明有记录被跳过
    check.click();
    await settle();
    expect(check.checked).toBe(true);
    await enter('recovery.confirmKey', draft.material.recoveryKey);
    await click('recovery.confirmSaved');
    await until(() =>
      expect(api.recoverMasterPassword).toHaveBeenLastCalledWith(
        'saved-old-recovery-key',
        'Fresh!pass82',
        draft,
        draft.material.recoveryKey,
        true,
      ),
    );
    await until(() => expect(recovered).toHaveBeenCalledTimes(1));
    expect(document.body.textContent).toContain(t('recovery.resetSuccess'));
    expect(document.body.textContent).toContain(t('recovery.resetPartialNote'));
  });

  it('其它失败原因不会伪造出一扇跳过的门', async () => {
    api.getRecoveryStatus.mockResolvedValue({ enabled: true, config: draft.material.config, corrupted: false });
    api.recoverMasterPassword.mockRejectedValueOnce(
      Object.assign(new Error('RECOVERY_STALE'), { code: 'RECOVERY_STALE' }),
    );
    await mount(RecoveryResetDialog);
    await fillReset();
    await click('recovery.prepareReset');
    await until(() => expect(api.preparePasswordRecovery).toHaveBeenCalled());
    await confirmKit();
    await until(() => expect(api.recoverMasterPassword).toHaveBeenCalledTimes(1));
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    expect(document.body.textContent).not.toContain(t('recovery.skipNote'));
    expect(document.body.textContent).toContain(t('recovery.error.stale'));
  });

  it('结构损坏不亮跳过门：它不是解密失败，勾选也不可能成功', async () => {
    api.getRecoveryStatus.mockResolvedValue({ enabled: true, config: draft.material.config, corrupted: false });
    api.recoverMasterPassword.mockRejectedValueOnce(
      Object.assign(new Error('VAULT_DATA_CORRUPTED'), { code: 'VAULT_DATA_CORRUPTED' }),
    );
    await mount(RecoveryResetDialog);
    await fillReset();
    await click('recovery.prepareReset');
    await until(() => expect(api.preparePasswordRecovery).toHaveBeenCalled());
    await confirmKit();
    await until(() => expect(api.recoverMasterPassword).toHaveBeenCalledTimes(1));
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    expect(document.body.textContent).not.toContain(t('recovery.skipNote'));
    expect(document.body.textContent).toContain(t('recovery.error.corrupted'));
  });

  it('rejects weak or mismatched passwords before calling recovery', async () => {
    api.getRecoveryStatus.mockResolvedValue({ enabled: true, config: draft.material.config, corrupted: false });
    await mount(RecoveryResetDialog);
    await fillReset();
    await enter('recovery.newPassword', 'no-symbol82');
    await enter('recovery.confirmPassword', 'different');
    await click('recovery.prepareReset');
    expect(api.preparePasswordRecovery).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });

  it('maps coded errors and never displays raw sensitive error content', async () => {
    api.getRecoveryStatus.mockResolvedValue({ enabled: true, config: draft.material.config, corrupted: false });
    api.preparePasswordRecovery.mockRejectedValue(
      Object.assign(new Error('sensitive-original-key'), { code: 'RECOVERY_INVALID' }),
    );
    await mount(RecoveryResetDialog);
    await fillReset();
    await click('recovery.prepareReset');
    await until(() => expect(document.body.textContent).toContain(t('recovery.error.invalid')));
    expect(document.body.textContent).not.toContain('sensitive-original-key');
    expect(api.recoverMasterPassword).not.toHaveBeenCalled();
  });
});

describe('PasswordVerifyView recovery entry', () => {
  it('hides the recovery entry entirely when the vault never enabled recovery', async () => {
    // 锁定页在改造前只有「忘记密码」一个出口；未启用恢复时不得多挂一颗走不通的主色链接
    await mount(PasswordVerifyView, {
      verifyForm: { password: '', validityHours: 24 },
      verifyRules: {},
      verifyLoading: false,
      verifyError: '',
      verifyShake: false,
      isDev: false,
      hint: '',
      failCount: 0,
    });
    await settle();
    await settle();
    await until(() => expect(api.getRecoveryStatus).toHaveBeenCalledTimes(1));
    expect(document.querySelector(`[aria-label="${t('recovery.useKey')}"]`)).toBeNull();
    expect([...document.querySelectorAll('button')].some(el => el.textContent?.trim() === t('recovery.useKey'))).toBe(
      false,
    );
    expect(
      [...document.querySelectorAll('button')].some(el => el.textContent?.trim() === t('auth.forgotPassword')),
    ).toBe(true);
  });

  it('forwards recovered and clears the unlock password without leaving secrets behind', async () => {
    api.getRecoveryStatus.mockResolvedValue({ enabled: true, config: draft.material.config, corrupted: false });
    await mount(PasswordVerifyView, {
      verifyForm: { password: 'previous-unlock-attempt', validityHours: 24 },
      verifyRules: {},
      verifyLoading: false,
      verifyError: '',
      verifyShake: false,
      isDev: false,
      hint: '',
      failCount: 0,
    });
    // 挂载时读一次只为决定入口是否出现；弹窗尚未打开
    await until(() => expect(api.getRecoveryStatus).toHaveBeenCalledTimes(1));
    await click('recovery.useKey');
    await settle();
    await fillReset();
    await click('recovery.prepareReset');
    await confirmKit();
    await until(() => expect(recovered).toHaveBeenCalledTimes(1));
    expect(document.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')?.value).toBe('');
  });
});

describe('ChangeMasterPasswordDialog recovery replacement', () => {
  async function fillChange() {
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')];
    for (const [index, value] of ['Current!pass82', 'Fresh!pass82', 'Fresh!pass82'].entries()) {
      inputs[index]!.value = value;
      inputs[index]!.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await settle();
    await click('options.changePwd.confirm');
  }
  it('keeps the existing two-argument change path when recovery is disabled', async () => {
    await mount(ChangeMasterPasswordDialog);
    await fillChange();
    await until(() =>
      expect(api.prepareChangedPasswordRecovery).toHaveBeenCalledWith('Current!pass82', 'Fresh!pass82'),
    );
    await until(() => expect(api.changeMasterPassword).toHaveBeenCalledWith('Current!pass82', 'Fresh!pass82'));
  });
  it('warns on the first screen that the held kit dies, before any password is typed', async () => {
    api.getRecoveryStatus.mockResolvedValue({ enabled: true, config: draft.material.config, corrupted: false });
    await mount(ChangeMasterPasswordDialog);
    await until(() =>
      expect(document.querySelector('.el-dialog__body')?.textContent).toContain(
        t('options.changePwd.alertDescRecovery'),
      ),
    );
    // 第一屏仍是表单本身：提前披露不等于把用户提前推进套件步骤
    expect(document.querySelector('[data-recovery-key]')).toBeNull();
  });
  it('keeps the first screen free of recovery copy for users who never enabled it', async () => {
    await mount(ChangeMasterPasswordDialog);
    await settle();
    expect(document.querySelector('.el-dialog__body')?.textContent).not.toContain(
      t('options.changePwd.alertDescRecovery'),
    );
  });
  it('keeps the pre-existing localized toast for change-password failures instead of an inline alert', async () => {
    api.changeMasterPassword.mockRejectedValue(
      Object.assign(new Error('当前密码验证失败'), { code: 'WRONG_PASSWORD' }),
    );
    await mount(ChangeMasterPasswordDialog);
    await fillChange();
    await until(() => expect(toastText()).toContain(t('options.changePwd.wrongOldPassword')));
    // ElMessage 自己就带 role="alert"，这里要钉的是「弹窗正文里没有新增内联告警段落」
    expect(document.querySelector('.el-dialog__body .recovery-error')).toBeNull();
  });
  it('routes recovery codes raised by the change path to recovery copy, never to a raw code', async () => {
    api.changeMasterPassword.mockRejectedValue(
      Object.assign(new Error('RECOVERY_SAME_PASSWORD'), {
        code: 'RECOVERY_SAME_PASSWORD',
      }),
    );
    await mount(ChangeMasterPasswordDialog);
    await fillChange();
    await until(() => expect(toastText()).toContain(t('recovery.error.samePassword')));
    expect(toastText()).not.toContain('RECOVERY_SAME_PASSWORD');
  });
  it('freezes passwords for a draft and discards it on returning to edit', async () => {
    api.prepareChangedPasswordRecovery.mockResolvedValue(draft);
    await mount(ChangeMasterPasswordDialog);
    await fillChange();
    expect(api.changeMasterPassword).not.toHaveBeenCalled();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    await click('recovery.backToEdit');
    expect(document.querySelector('[data-recovery-key]')).toBeNull();
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(3);
    expect(api.changeMasterPassword).not.toHaveBeenCalled();
  });
  it('passes a replacement only after saving and confirming the new kit', async () => {
    api.prepareChangedPasswordRecovery.mockResolvedValue(draft);
    await mount(ChangeMasterPasswordDialog);
    await fillChange();
    await confirmKit();
    await until(() =>
      expect(api.changeMasterPassword).toHaveBeenCalledWith('Current!pass82', 'Fresh!pass82', {
        draft,
        confirmation: draft.material.recoveryKey,
      }),
    );
    await until(() => expect(opened.value).toBe(false));
  });

  it('offers the informed carry even when offline recovery is disabled', async () => {
    api.prepareChangedPasswordRecovery.mockResolvedValue(null);
    api.changeMasterPassword.mockRejectedValueOnce(
      Object.assign(new Error('UNDECRYPTABLE_RECORDS'), { code: 'UNDECRYPTABLE_RECORDS' }),
    );
    await mount(ChangeMasterPasswordDialog);
    await fillChange();
    await until(() => expect(api.changeMasterPassword).toHaveBeenCalledTimes(1));
    expect(api.changeMasterPassword).toHaveBeenNthCalledWith(1, 'Current!pass82', 'Fresh!pass82');
    expect(checkbox('recovery.skipChangeConfirm').checked).toBe(false);

    await check('recovery.skipChangeConfirm');
    await click('options.changePwd.confirm');
    await until(() =>
      expect(api.changeMasterPassword).toHaveBeenNthCalledWith(2, 'Current!pass82', 'Fresh!pass82', undefined, true),
    );
    await until(() => expect(opened.value).toBe(false));
    expect(toastText()).toContain(t('recovery.partialChangeNote'));
  });

  it('offers the same informed carry after a password change is blocked by undecryptable records', async () => {
    api.prepareChangedPasswordRecovery.mockResolvedValue(draft);
    api.changeMasterPassword.mockRejectedValueOnce(
      Object.assign(new Error('UNDECRYPTABLE_RECORDS'), { code: 'UNDECRYPTABLE_RECORDS' }),
    );
    await mount(ChangeMasterPasswordDialog);
    await fillChange();
    await confirmKit();
    await until(() => expect(api.changeMasterPassword).toHaveBeenCalledTimes(1));
    expect(api.changeMasterPassword).toHaveBeenNthCalledWith(1, 'Current!pass82', 'Fresh!pass82', {
      draft,
      confirmation: draft.material.recoveryKey,
    });
    // 默认 fail-closed：没勾选前不会把 allowUndecryptable 带下去
    expect(checkbox('recovery.skipChangeConfirm').checked).toBe(false);

    await check('recovery.skipChangeConfirm');
    await enter('recovery.confirmKey', draft.material.recoveryKey);
    await click('recovery.confirmSaved');
    await until(() =>
      expect(api.changeMasterPassword).toHaveBeenNthCalledWith(
        2,
        'Current!pass82',
        'Fresh!pass82',
        { draft, confirmation: draft.material.recoveryKey },
        true,
      ),
    );
    await until(() => expect(opened.value).toBe(false));
    expect(toastText()).toContain(t('recovery.partialChangeNote'));
  });
});
