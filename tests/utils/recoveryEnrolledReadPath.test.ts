/**
 * 锁定页「是否登记过恢复密钥」的读取成本（评审报告 P2-17）
 *
 * 锁定态首帧只需要一个布尔位，原先却动态 `import('@/utils/storage/recovery')`——
 * 那个模块静态依赖 `changeMasterPassword`（整库重加密）与 `recoveryCrypto`，
 * 实测把 ~20 KB 的换钥依赖图 + 一次额外盘读拉进 `preRowMs` 窗口。
 * 现在改读 `recoveryState.isRecoveryEnrolled()`：只看配置在不在，零加密依赖。
 *
 * 语义必须与 `getRecoveryStatus().enabled` 一致，否则解锁页的恢复入口会与恢复弹窗
 * 看到的状态分叉：值为 `undefined`/`null` 才算未启用；**形状损坏也算登记过**，
 * 因为那正是要把用户引到恢复界面处理的场景。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { isRecoveryEnrolled } from '@/utils/storage/recoveryState';

beforeEach(async () => {
  await chrome.storage.local.clear();
});

describe('isRecoveryEnrolled 的存在性口径', () => {
  it('没有配置 → false', async () => {
    expect(await isRecoveryEnrolled()).toBe(false);
  });

  it('有效配置与损坏配置都算「登记过」（与 enabled 同口径，不分叉）', async () => {
    const valid = { version: 1, id: 'a'.repeat(32), createdAt: 1, wrappedDataKey: 'A'.repeat(80) };
    await chrome.storage.local.set({ [STORAGE_KEYS.RECOVERY_CONFIG]: valid });
    expect(await isRecoveryEnrolled()).toBe(true);

    await chrome.storage.local.set({ [STORAGE_KEYS.RECOVERY_CONFIG]: { nonsense: true } });
    expect(await isRecoveryEnrolled(), '损坏形态也要亮出入口，否则用户被留在「以为没登记」的死路').toBe(true);
  });
});

describe('锁定页不再为布尔位拉换钥依赖图', () => {
  const source = readFileSync(path.resolve(__dirname, '../../components/options/PasswordVerifyView.vue'), 'utf8');

  it('动态 import 指向 recoveryState，而不是静态/动态引入 recovery', () => {
    expect(source).toContain("import('@/utils/storage/recoveryState')");
    expect(source).toContain('isRecoveryEnrolled()');
    expect(source, 'recovery.ts 静态依赖 changeMasterPassword，会拉进 ~20 KB 换钥图').not.toContain(
      "import('@/utils/storage/recovery')",
    );
  });
});
