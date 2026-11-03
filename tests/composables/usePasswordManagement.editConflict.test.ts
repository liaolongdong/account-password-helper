/** @vitest-environment jsdom */

/**
 * 管理页编辑保存的并发冲突呈现（存量评审 S4 的 UI 半边）
 *
 * 存储层现在会在「打开弹窗后该行被别的上下文改过」时抛 UPDATE_CONFLICT。
 * UI 必须：弹窗不关（用户输入不能凭空消失）、给出可复述的冲突文案、并把编辑基线
 * 推进到刷新后的最新版本——否则用户重试会再次撞同一堵墙。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import type { PasswordEntry } from '@/utils/types';
import { usePasswordManagement } from '@/composables/usePasswordManagement';
import { StorageUtils } from '@/utils/storage';

const makeEntry = (id: string, patch: Partial<PasswordEntry> = {}): PasswordEntry => ({
  id,
  username: `user-${id}`,
  password: 'plain-password',
  url: 'https://example.com',
  tag: '',
  remark: '旧备注',
  totp: '',
  createTime: 1_000,
  updateTime: 5_000,
  order: 0,
  ...patch,
});

let scope: EffectScope;
let mgmt: ReturnType<typeof usePasswordManagement>;

beforeEach(() => {
  Object.assign(globalThis, {
    ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
    ElMessageBox: { confirm: vi.fn(async () => true) },
  });
  vi.spyOn(StorageUtils, 'isSessionValid').mockResolvedValue(true);
  vi.spyOn(StorageUtils, 'getMasterPasswordValidityHours').mockResolvedValue(24);
  vi.spyOn(StorageUtils, 'getAllPasswordsDetailed').mockResolvedValue({
    entries: [makeEntry('a')],
    undecryptableCount: 0,
  });
  scope = effectScope();
  mgmt = scope.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
});

afterEach(() => {
  scope.stop();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).ElMessage;
  delete (globalThis as Record<string, unknown>).ElMessageBox;
});

describe('编辑保存的并发冲突呈现', () => {
  it('存储层抛 UPDATE_CONFLICT：弹窗保持打开、提示冲突、基线推进到最新版本', async () => {
    await mgmt.loadPasswords();
    mgmt.editPassword(mgmt.passwords.value[0]);
    expect(mgmt.showPasswordDialog.value).toBe(true);

    const update = vi
      .spyOn(StorageUtils, 'updatePassword')
      .mockRejectedValue(Object.assign(new Error('conflict'), { code: 'UPDATE_CONFLICT' }));
    mgmt.applyPasswordFormPatch({ remark: '我的新备注' });
    await nextTick();
    await mgmt.handlePasswordFormSave();

    // 第一次提交带上打开弹窗那一刻的基线
    expect(update.mock.calls[0][3]).toEqual({ expectedUpdateTime: 5_000 });
    expect(mgmt.showPasswordDialog.value).toBe(true);
    expect(mgmt.passwordForm.value.remark).toBe('我的新备注');
    expect(ElMessage.error).toHaveBeenCalledWith('form.updateConflict');

    // 列表刷新后基线推进：用户按提示重试时不会再撞同一堵墙
    update.mockResolvedValue(undefined);
    vi.mocked(StorageUtils.getAllPasswordsDetailed).mockResolvedValue({
      entries: [makeEntry('a', { remark: '对方的备注', updateTime: 9_000 })],
      undecryptableCount: 0,
    });
    await mgmt.loadPasswords();
    expect(mgmt.editingBaselineTime.value).toBe(9_000);

    await mgmt.handlePasswordFormSave();
    expect(update.mock.calls[1][3]).toEqual({ expectedUpdateTime: 9_000 });
    expect(mgmt.showPasswordDialog.value).toBe(false);
  });
});
