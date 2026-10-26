/**
 * 管理页「不可解密条目」计数接线
 *
 * Options 与 SidePanel 必须看到同一个事实：解密成功的条目之外还有多少条坏记录。
 * 侧边栏已经通过 `getAllPasswordsDetailed` 拿到计数；管理页此前只取 entries，
 * 导致列表静默变短、备份也静默漏条。这里钉住 composable 复用同一个单快照 API，
 * 不额外读一次大数组、也不把坏记录当成空库。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';
import { StorageUtils } from '@/utils/storage';
import { usePasswordManagement } from '@/composables/usePasswordManagement';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

const good = makePasswordEntry({ id: 'good' });
const detailed = { entries: [good], undecryptableCount: 2 };
const messageBoxConfirm = vi.fn();

describe('usePasswordManagement 的不可解密条目计数', () => {
  let scope: EffectScope;

  beforeEach(() => {
    messageBoxConfirm.mockReset().mockResolvedValue('confirm');
    Object.assign(globalThis, {
      ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
      ElMessageBox: { confirm: messageBoxConfirm },
    });
    vi.spyOn(StorageUtils, 'isSessionValid').mockResolvedValue(true);
    vi.spyOn(StorageUtils, 'getMasterPasswordValidityHours').mockResolvedValue(24);
    vi.spyOn(StorageUtils, 'getAllPasswordsDetailed').mockResolvedValue(detailed);
    scope = effectScope();
  });

  afterEach(() => {
    scope.stop();
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).ElMessage;
    delete (globalThis as Record<string, unknown>).ElMessageBox;
  });

  it('复用 getAllPasswordsDetailed 的单快照计数，且不改动已解密列表', async () => {
    const mgmt = scope.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
    await mgmt.loadPasswords();

    expect(mgmt.passwords.value).toEqual([good]);
    expect(mgmt.undecryptableCount.value).toBe(2);
    expect(StorageUtils.getAllPasswordsDetailed).toHaveBeenCalledTimes(1);
  });

  it('会话失效时计数归零，不残留上一轮的数字', async () => {
    const mgmt = scope.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
    await mgmt.loadPasswords();
    expect(mgmt.undecryptableCount.value).toBe(2);

    vi.spyOn(StorageUtils, 'isSessionValid').mockResolvedValue(false);
    await mgmt.loadPasswords();
    expect(mgmt.undecryptableCount.value).toBe(0);
  });

  it('有坏记录时备份前要求确认，取消则返回 false', async () => {
    const mgmt = scope.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
    await mgmt.loadPasswords();

    await expect(mgmt.confirmIncompleteBackup()).resolves.toBe(true);
    messageBoxConfirm.mockRejectedValueOnce(new Error('cancel'));
    await expect(mgmt.confirmIncompleteBackup()).resolves.toBe(false);
  });

  it('没有坏记录时备份前不打扰用户', async () => {
    vi.spyOn(StorageUtils, 'getAllPasswordsDetailed').mockResolvedValue({
      entries: [good],
      undecryptableCount: 0,
    });
    const mgmt = scope.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
    await mgmt.loadPasswords();

    await expect(mgmt.confirmIncompleteBackup()).resolves.toBe(true);
    expect(messageBoxConfirm).not.toHaveBeenCalled();
  });
});
