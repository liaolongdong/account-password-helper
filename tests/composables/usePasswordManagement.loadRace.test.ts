/** @vitest-environment jsdom */

/**
 * 管理页整表加载的代际竞态回归测试（usePasswordManagement）
 *
 * `loadPasswords` 内有三次 await，每一次都是「手里的快照可能已经过期」的窗口。
 * 钉住两件事：
 *
 * 1. **只有最新一次加载有权提交**。认证回调、可见性变化与 storage 事件都能并发启动
 *    加载；晚完成的旧快照若照常提交，列表会被盖回旧数据，被取代的那次还会顺手熄灭
 *    新加载正在显示的遮罩。
 * 2. **加载在飞时「仅元数据就地修补」必须让位**。这是本仓最容易被漏掉的一条：
 *    修补改的是即将被整表替换的旧条目，而它返回 true 会让 storage watcher 省掉
 *    本该发生的那次重载——一次「另一窗口填充 → onChanged 落在整表加载的 410ms 窗口里」
 *    就把列表静默停在过期状态，且没有下一次写入来自愈。
 *
 * 两条都只改「谁的结果落地」，不改加解密、不改存储、不改任何用户可见口径；
 * 空闲态的快路径命中（第 3 例）一并钉住，防止守卫把既有优化收窄掉。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref, toRaw, type EffectScope } from 'vue';
import type { PasswordEntry } from '@/utils/types';
import { usePasswordManagement } from '@/composables/usePasswordManagement';
import { StorageUtils } from '@/utils/storage';

/** 造一条最小可用条目 */
const makeEntry = (id: string, patch: Partial<PasswordEntry> = {}): PasswordEntry => ({
  id,
  username: `user-${id}`,
  password: 'p',
  url: '',
  tag: '',
  remark: '',
  totp: '',
  createTime: 1_000_000,
  updateTime: 1_000_000,
  order: 0,
  ...patch,
});

/** 手动可控的 promise，用于把「加载在飞」这个时间窗摊开到测试断言之间 */
const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('usePasswordManagement 的整表加载代际守卫', () => {
  let scope: EffectScope;
  let mgmt: ReturnType<typeof usePasswordManagement>;
  let getAll: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.assign(globalThis, {
      ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
      ElMessageBox: { confirm: vi.fn().mockResolvedValue('confirm') },
    });
    vi.spyOn(StorageUtils, 'isSessionValid').mockResolvedValue(true);
    vi.spyOn(StorageUtils, 'getMasterPasswordValidityHours').mockResolvedValue(24);
    getAll = vi.spyOn(StorageUtils, 'getAllPasswords');

    scope = effectScope();
    mgmt = scope.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
  });

  afterEach(() => {
    scope.stop();
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).ElMessage;
    delete (globalThis as Record<string, unknown>).ElMessageBox;
  });

  it('两次重叠加载只由最新一次读取并提交，被取代的那次不熄灭遮罩', async () => {
    const pending = deferred<PasswordEntry[]>();
    getAll.mockImplementation(() => pending.promise);

    const first = mgmt.loadPasswords();
    const second = mgmt.loadPasswords();
    await Promise.resolve();
    await Promise.resolve();

    // 早启动的那次在第一个 await 边界就让位，连整包读取都不再发起
    // （修复前：两次读取都会发生，晚完成的那次还能把列表盖回旧快照）
    expect(getAll).toHaveBeenCalledTimes(1);

    pending.resolve([makeEntry('fresh')]);
    await first;
    // 被取代的那次收尾时不得熄灭仍在加载的遮罩
    expect(mgmt.tableLoading.value).toBe(true);

    await second;
    expect(mgmt.passwords.value.map(entry => entry.id)).toEqual(['fresh']);
    expect(mgmt.tableLoading.value).toBe(false);
  });

  it('加载在飞时收到的仅元数据外部写入不走快路径', async () => {
    const storedOld = [makeEntry('r1', { tag: '工作' })];
    const storedNew = [makeEntry('r1', { tag: '个人' })];
    // 本地已有列表（快路径的前提之一），且与 oldValue 对齐
    mgmt.passwords.value = storedOld.map(entry => ({ ...entry }));

    const pending = deferred<PasswordEntry[]>();
    getAll.mockReturnValue(pending.promise);
    const loading = mgmt.loadPasswords();
    expect(StorageUtils.isMetadataOnlyChange(storedOld, storedNew)).toBe(true);

    // 修复前：判据命中即就地修补并返回 true，watcher 据此跳过整表重载
    await expect(mgmt.patchMetadataOnlyFromStorage({ oldValue: storedOld, newValue: storedNew })).resolves.toBe(false);

    pending.resolve(storedNew.map(entry => ({ ...entry })));
    await loading;
    expect(mgmt.passwords.value[0].tag).toBe('个人');
  });

  it('空闲态的仅元数据修补仍然命中，且只改条目不换数组引用', async () => {
    const storedOld = [makeEntry('r1', { tag: '工作', favorite: false })];
    const storedNew = [makeEntry('r1', { tag: '个人', favorite: true })];
    const localList = storedOld.map(entry => ({ ...entry }));
    mgmt.passwords.value = localList;
    // ref 深响应会包一层 proxy，断言引用不变要看原始对象（proxy 每次取值都复用同一实例）
    const listRef = toRaw(mgmt.passwords.value);
    const firstRow = toRaw(mgmt.passwords.value[0]);

    await expect(mgmt.patchMetadataOnlyFromStorage({ oldValue: storedOld, newValue: storedNew })).resolves.toBe(true);
    // 数组引用不变：命中快路径的意义就是不做整表替换与重渲染
    expect(toRaw(mgmt.passwords.value)).toBe(listRef);
    expect(toRaw(mgmt.passwords.value[0])).toBe(firstRow);
    expect(mgmt.passwords.value[0].tag).toBe('个人');
    expect(mgmt.passwords.value[0].favorite).toBe(true);
  });
});
