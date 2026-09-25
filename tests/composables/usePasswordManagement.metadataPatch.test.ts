/** @vitest-environment jsdom */

/**
 * 管理页「外部写入仅元数据变更」零解密快路径回归测试
 *
 * 背景（issue #89 数据层报告 P0-3）：其他窗口的填充、网页自动保存只会改动
 * `METADATA_FIELDS` 白名单里的非敏感字段，但 `chrome.storage.onChanged` 送来的
 * 仍是整包 `account_passwords`。改造前 Options 一律 `loadPasswords()` ——
 * N=2000 时那是 5N 次 AES-GCM 解密（实测 410.6 ms）+ 整表换引用重渲染。
 * 现在由 `patchMetadataOnlyFromStorage` 复用侧边栏同一判据就地修补列表，
 * `useStorageWatcher` 只在修补未命中/异常时回退整表重载。
 *
 * 两组各自钉住的故障形状：
 * 1. 判据放宽（把敏感字段变更也当元数据）→ 列表显示与密文不一致，用户在其上编辑并保存即写坏数据；
 * 2. 快路径抛错时不回退 → 列表停留在旧数据，用户看不到其他上下文的真实变更；
 * 3. 本地操作守卫失效（跳过分支被改坏）→ 本地刚做的就地更新被整表重载覆盖，闪回旧值；
 * 4. 只看 old/new 两次整包就放行 → 本地列表比存储少一条时会漏掉那条却报告「已一致」，
 *    缺口要等下一次非元数据写入才暴露。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createApp, effectScope, nextTick, ref, type App, type EffectScope, type Ref } from 'vue';
import { useStorageWatcher } from '@/composables/useStorageWatcher';
import { usePasswordManagement } from '@/composables/usePasswordManagement';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { PasswordEntry } from '@/utils/types';

/** storage 变更监听回调（与 chrome.storage.onChanged 的派发签名一致） */
type StorageChangeHandler = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: chrome.storage.AreaName,
) => void;

/** 构造列表条目：白名单字段可覆写，敏感字段固定占位（本测试只关心其「不可被改动」） */
const makeEntry = (id: string, patch: Partial<PasswordEntry> = {}): PasswordEntry => ({
  id,
  username: `user-${id}`,
  password: 'cipher-text',
  url: 'https://example.com',
  tag: '',
  remark: '',
  createTime: 1,
  updateTime: 2,
  order: 0,
  ...patch,
});

describe('patchMetadataOnlyFromStorage：判据与就地修补语义', () => {
  let scope: EffectScope;
  let mgmt: ReturnType<typeof usePasswordManagement>;

  beforeEach(() => {
    Object.assign(globalThis, {
      ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
      ElMessageBox: { confirm: vi.fn().mockResolvedValue('confirm') },
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

  it('仅白名单字段变化：就地改字段、不换数组引用，并报告已修补', async () => {
    mgmt.passwords.value = [makeEntry('a', { favorite: false, lastUsedAt: 100 }), makeEntry('b')];
    const before = mgmt.passwords.value;
    const oldValue = [{ ...before[0] }, { ...before[1] }];
    const newValue = [{ ...before[0], favorite: true, lastUsedAt: 900 }, { ...before[1] }];

    await expect(mgmt.patchMetadataOnlyFromStorage({ oldValue, newValue })).resolves.toBe(true);

    expect(mgmt.passwords.value).toBe(before); // 换引用会触发整表重渲染，快路径必须避免
    expect(mgmt.passwords.value[0].favorite).toBe(true);
    expect(mgmt.passwords.value[0].lastUsedAt).toBe(900);
  });

  it('敏感字段被改动时不修补、不改任何字段（交由整表重载）', async () => {
    mgmt.passwords.value = [makeEntry('a', { username: 'old-name' })];
    const snapshot = { ...mgmt.passwords.value[0] };

    const patched = await mgmt.patchMetadataOnlyFromStorage({
      oldValue: [snapshot],
      newValue: [{ ...snapshot, username: 'new-name' }],
    });

    expect(patched).toBe(false);
    expect(mgmt.passwords.value[0].username).toBe('old-name');
  });

  it('白名单字段在新值中缺失时同步删除，避免列表与存储持续偏离', async () => {
    mgmt.passwords.value = [makeEntry('a', { favorite: true, favoriteUsedAt: 555 } as Partial<PasswordEntry>)];
    const withKey = { ...mgmt.passwords.value[0], favoriteUsedAt: 555 };
    const withoutKey = { ...(mgmt.passwords.value[0] as unknown as Record<string, unknown>) } as Record<
      string,
      unknown
    >;
    delete withoutKey.favoriteUsedAt;

    await expect(mgmt.patchMetadataOnlyFromStorage({ oldValue: [withKey], newValue: [withoutKey] })).resolves.toBe(
      true,
    );

    expect('favoriteUsedAt' in (mgmt.passwords.value[0] as unknown as Record<string, unknown>)).toBe(false);
  });

  it('条目增删（长度或 id 序列变化）一律判为非元数据变更', async () => {
    mgmt.passwords.value = [makeEntry('a'), makeEntry('b')];

    await expect(
      mgmt.patchMetadataOnlyFromStorage({
        oldValue: [{ ...mgmt.passwords.value[0] }],
        newValue: [{ ...mgmt.passwords.value[0] }, { ...mgmt.passwords.value[1] }],
      }),
    ).resolves.toBe(false);

    // 同长度但 id 错位（删除 + 新增撞出等长）同样不放行
    await expect(
      mgmt.patchMetadataOnlyFromStorage({
        oldValue: [{ ...mgmt.passwords.value[0] }, { ...mgmt.passwords.value[1] }],
        newValue: [{ ...mgmt.passwords.value[1] }, { ...mgmt.passwords.value[0] }],
      }),
    ).resolves.toBe(false);
  });

  it('列表为空（锁定态/未加载）时保守返回 false，仍走原重载路径', async () => {
    mgmt.passwords.value = [];
    const entry = { ...makeEntry('a') };

    await expect(mgmt.patchMetadataOnlyFromStorage({ oldValue: [entry], newValue: [entry] })).resolves.toBe(false);
  });

  it('存储里有本地列表缺少的 id 时返回 false：列表已偏离存储，快路径不得宣称已一致', async () => {
    // 判据只看 old/new 两次整包（等长、id 序列对齐、差异全在白名单），
    // 本地少一条时它照样放行——此时就地修补会漏掉那条条目却报告「已一致」，
    // 缺口要等下一次非元数据写入才被发现，必须回退重载。
    mgmt.passwords.value = [makeEntry('a')];
    const ghost = { ...makeEntry('ghost'), lastUsedAt: 100 };

    await expect(
      mgmt.patchMetadataOnlyFromStorage({ oldValue: [ghost], newValue: [{ ...ghost, lastUsedAt: 900 }] }),
    ).resolves.toBe(false);
  });
});

describe('useStorageWatcher 的元数据快路径接线', () => {
  let handler: StorageChangeHandler | null = null;
  let app: App | null = null;
  let onAuthChange: Mock<() => void>;
  let onPasswordDataChange: Mock<() => void>;

  /**
   * 在真实组件作用域内挂载 watcher（监听注册发生在 onMounted）
   *
   * 全文件只保留这一处 `createApp`：`vue/one-component-per-file` 会把多个内联组件判为违规。
   */
  const mountWatcher = (
    overrides: {
      patchMetadataOnly?: (change: chrome.storage.StorageChange) => Promise<boolean> | boolean;
      skipIf?: Ref<boolean>;
    } = {},
  ) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
      setup() {
        useStorageWatcher({
          onAuthChange,
          onPasswordDataChange,
          ...(overrides.patchMetadataOnly ? { patchMetadataOnly: overrides.patchMetadataOnly } : {}),
          ...(overrides.skipIf ? { skipIf: overrides.skipIf } : {}),
        });
        return () => null;
      },
    });
    app.mount(host);
  };

  const emitPasswordsChange = (change: chrome.storage.StorageChange = { newValue: 'whatever' }) => {
    handler?.({ [STORAGE_KEYS.PASSWORDS]: change }, 'local');
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    handler = null;
    onAuthChange = vi.fn();
    onPasswordDataChange = vi.fn();
    vi.spyOn(chrome.storage.onChanged, 'addListener').mockImplementation(callback => {
      handler = callback as StorageChangeHandler;
    });
    vi.spyOn(chrome.storage.onChanged, 'removeListener').mockImplementation(() => {});
  });

  afterEach(() => {
    app?.unmount();
    app = null;
    vi.restoreAllMocks();
  });

  it('快路径命中时不再请求整表重载', async () => {
    const patch = vi.fn(async () => true);
    mountWatcher({ patchMetadataOnly: patch });
    emitPasswordsChange({ oldValue: [], newValue: [] });
    // 修补判定在微任务里完成
    await nextTick();
    await vi.waitFor(() => expect(patch).toHaveBeenCalledTimes(1));

    expect(onPasswordDataChange).not.toHaveBeenCalled();
  });

  it('快路径返回 false 时回退整表重载（一次，且不重复）', async () => {
    mountWatcher({ patchMetadataOnly: async () => false });
    emitPasswordsChange({ oldValue: [], newValue: [] });
    await vi.waitFor(() => expect(onPasswordDataChange).toHaveBeenCalledTimes(1));

    expect(onPasswordDataChange).toHaveBeenCalledTimes(1);
  });

  it('快路径抛错时仍回退整表重载，不把列表留在旧数据上', async () => {
    mountWatcher({
      patchMetadataOnly: async () => {
        throw new Error('判据模块加载失败');
      },
    });
    emitPasswordsChange({ oldValue: [], newValue: [] });
    await vi.waitFor(() => expect(onPasswordDataChange).toHaveBeenCalledTimes(1));

    expect(onPasswordDataChange).toHaveBeenCalledTimes(1);
  });

  it('未接入快路径的调用方保持原语义：每次密码变更都重载', async () => {
    mountWatcher();
    emitPasswordsChange();
    await vi.waitFor(() => expect(onPasswordDataChange).toHaveBeenCalledTimes(1));

    expect(onPasswordDataChange).toHaveBeenCalledTimes(1);
  });

  it('本地操作守卫生效时不调用快路径（就地更新已由 Vue 层完成）', async () => {
    const patch = vi.fn(async () => true);
    mountWatcher({ patchMetadataOnly: patch, skipIf: ref(true) });

    emitPasswordsChange({ oldValue: [], newValue: [] });
    await nextTick();

    expect(patch).not.toHaveBeenCalled();
    expect(onPasswordDataChange).not.toHaveBeenCalled();
  });

  it('非密码 key 的认证变更不触及快路径', async () => {
    const patch = vi.fn(async () => true);
    mountWatcher({ patchMetadataOnly: patch });
    handler?.({ [STORAGE_KEYS.MASTER_PASSWORD]: { newValue: 'x' } }, 'local');
    await nextTick();

    expect(patch).not.toHaveBeenCalled();
    expect(onPasswordDataChange).not.toHaveBeenCalled();
    expect(onAuthChange).toHaveBeenCalledTimes(1);
  });
});
