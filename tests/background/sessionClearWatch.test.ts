import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_MEMORY_KEYS, STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * 后台 storage 监听在「会话被其他上下文清除」时的行为回归测试（S1 + S2 + A3 安全网）
 *
 * 锁定四条不变量：
 * 1. 会话键删除事件必须重置 BG 的会话内存镜像，否则 `isSessionValid()` 会依据
 *    陈旧 expiry 跳过回读 storage 而继续判定有效（上锁在后台不生效）；
 * 2. 锁定/清除路径不得再预热密码缓存——预热会带着会话密钥重建 SW 明文库与
 *    storage.session 快照，把上锁刚销毁的密钥材料又放回去（秒开语义不受影响：
 *    会话创建/rekey 分支仍主动预热）；
 * 3. 回收站出现明文残留时同样触发 at-rest 重加密请求（与主列表同等口径）；
 * 4. 「元数据 flush + 会话清除」被 Chrome 合并成单个 onChanged 事件时，原地修补
 *    分支不得把明文缓存留在锁定后的后台（锁定语义优先于修补快路径）。
 *
 * 装置说明：fake-browser 未实现 idle / notifications 事件源，用 spy 空实现补齐；
 * 监听器不依赖真实 storage 事件派发，改为注册后直接调用回调，
 * 以精确控制「另一上下文清除会话」这一时序。
 */

vi.mock('@/entrypoints/background/sidePanelManager', () => ({
  getSidePanelPorts: vi.fn(() => []),
}));

vi.mock('@/entrypoints/background/passwordCache', async importOriginal => {
  const actual = await importOriginal<typeof import('@/entrypoints/background/passwordCache')>();
  return {
    ...actual,
    warmPasswordCache: vi.fn(async () => {}),
    // 真实实现（清内存明文缓存 + 删 storage.session 快照），仅加可观测性
    invalidatePasswordCache: vi.fn((keepSnapshotForRebuild?: boolean) =>
      actual.invalidatePasswordCache(keepSnapshotForRebuild),
    ),
    // 固定为「原地修补成功」，用于复现「锁定事件与元数据 flush 合并进同一 onChanged」
    // 时 hasRelevantChange 块提前 return、不产生任何失效的窗口
    applyMetadataOnlyUpdate: vi.fn(async () => true),
  };
});

vi.mock('@/utils/sessionManager-storage', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/sessionManager-storage')>();
  return { ...actual, requestReEncryptAtRest: vi.fn() };
});

import { setupBackgroundServices } from '@/entrypoints/background/backgroundServices';
import {
  applyMetadataOnlyUpdate,
  invalidatePasswordCache,
  warmPasswordCache,
} from '@/entrypoints/background/passwordCache';
import { isSessionValid, requestReEncryptAtRest, SESSION_STORAGE_KEYS } from '@/utils/sessionManager-storage';

type StorageChanges = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type StorageChangeListener = (changes: StorageChanges, areaName: string) => void;

/** 冲洗微任务与 0ms 定时器（不触发 setupBackgroundServices 的 500ms 延时预热） */
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

/** fake-browser 未实现的事件源，注册监听前补空实现 */
const stubUnsupportedEvents = (): void => {
  vi.spyOn(chrome.idle.onStateChanged, 'addListener').mockImplementation(() => {});
  vi.spyOn(chrome.notifications.onClicked, 'addListener').mockImplementation(() => {});
};

/** 注册后台监听并取回 storage 变更回调（空实现注册，避免真实事件派发串扰用例） */
const registerWatcher = (): StorageChangeListener => {
  const addSpy = vi.spyOn(chrome.storage.onChanged, 'addListener').mockImplementation(() => {});
  setupBackgroundServices();
  expect(addSpy.mock.calls.length).toBeGreaterThan(0);
  const listener = addSpy.mock.calls[0][0] as unknown as StorageChangeListener;
  return listener;
};

beforeEach(async () => {
  vi.useFakeTimers();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  vi.mocked(warmPasswordCache).mockClear();
  vi.mocked(invalidatePasswordCache).mockClear();
  vi.mocked(applyMetadataOnlyUpdate).mockClear();
  vi.mocked(requestReEncryptAtRest).mockClear();
  stubUnsupportedEvents();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 播种「此刻有效」的会话，并让 BG 通过一次校验把会话键写入内存镜像 */
const primeStaleMirror = async (): Promise<number> => {
  const expiry = Date.now() + 60 * 60 * 1000;
  await chrome.storage.local.set({
    [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'wrapped-key-material',
    [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: expiry,
    [SESSION_STORAGE_KEYS.VALIDITY_HOURS]: 24,
  });
  await chrome.storage.session.set({ [SESSION_MEMORY_KEYS.DATA_KEY]: 'session-data-key' });
  await isSessionValid();
  return expiry;
};

/**
 * 模拟「另一上下文清除会话」：先真删 storage 中的会话键（本上下文内存镜像保持陈旧），
 * 再返回该操作落到后台监听的变化对象。
 */
const simulateCrossContextClear = async (expiry: number): Promise<StorageChanges> => {
  await chrome.storage.local.remove([
    SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY,
    SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
    SESSION_STORAGE_KEYS.VALIDITY_HOURS,
  ]);
  await chrome.storage.session.remove(SESSION_MEMORY_KEYS.DATA_KEY);
  return {
    [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: { oldValue: 'wrapped-key-material', newValue: undefined },
    [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: { oldValue: expiry, newValue: undefined },
  };
};

describe('会话被其他上下文清除', () => {
  it('重置 BG 会话内存镜像，isSessionValid 回落到 storage 判定为无效', async () => {
    const expiry = await primeStaleMirror();
    const listener = registerWatcher();

    listener(await simulateCrossContextClear(expiry), 'local');
    await flush();

    await expect(isSessionValid()).resolves.toBe(false);
  });

  it('不再预热密码缓存（避免重建已销毁的明文库与快照）', async () => {
    const expiry = await primeStaleMirror();
    const listener = registerWatcher();
    expect(warmPasswordCache).not.toHaveBeenCalled();

    listener(await simulateCrossContextClear(expiry), 'local');
    await flush();

    expect(warmPasswordCache).not.toHaveBeenCalled();
  });

  it('与元数据 flush 合并进同一事件时，仍失效 SW 明文缓存', async () => {
    // Chrome 会把短时间内的多次 set 合并为一个 onChanged：使用痕迹落盘（原地修补、
    // 刻意保留缓存）与另一上下文的清除会话同批到达时，锁定语义必须压过修补快路径，
    // 否则上锁后 SW 仍持有整库明文与可解密快照
    const expiry = await primeStaleMirror();
    await chrome.storage.session.set({ [SESSION_MEMORY_KEYS.METADATA_FLUSH_AT]: Date.now() });
    const listener = registerWatcher();

    listener(
      {
        [STORAGE_KEYS.PASSWORDS]: {
          oldValue: [{ id: 'a', encrypted: true, url: 'enc(u)', lastUsedAt: 100 }],
          newValue: [{ id: 'a', encrypted: true, url: 'enc(u)', lastUsedAt: 200 }],
        },
        ...(await simulateCrossContextClear(expiry)),
      },
      'local',
    );
    await flush();

    // 修补分支确实胜出（该分支自身不产生任何失效）
    expect(applyMetadataOnlyUpdate).toHaveBeenCalledTimes(1);
    expect(invalidatePasswordCache).toHaveBeenCalledTimes(1);
    expect(warmPasswordCache).not.toHaveBeenCalled();
  });
});

describe('会话创建 / rekey（秒开预热路径保持不变）', () => {
  it('会话键新写入时仍主动预热缓存', async () => {
    const listener = registerWatcher();

    listener(
      {
        [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: { newValue: 'wrapped-key-material' },
        [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: { newValue: Date.now() + 60 * 60 * 1000 },
      },
      'local',
    );
    await flush();

    expect(warmPasswordCache).toHaveBeenCalledTimes(1);
  });
});

describe('at-rest 明文残留安全网', () => {
  it('主列表出现明文残留时请求重跑密文化', async () => {
    const listener = registerWatcher();

    listener({ [STORAGE_KEYS.PASSWORDS]: { oldValue: [], newValue: [{ id: 'p1' }] } }, 'local');
    await flush();

    expect(requestReEncryptAtRest).toHaveBeenCalledTimes(1);
  });

  it('回收站出现明文残留时同样请求重跑密文化', async () => {
    const listener = registerWatcher();

    listener({ [STORAGE_KEYS.TRASH]: { oldValue: [], newValue: [{ id: 't1', deletedAt: 1 }] } }, 'local');
    await flush();

    expect(requestReEncryptAtRest).toHaveBeenCalledTimes(1);
  });

  it('全密文落盘时不触发（稳态无副作用）', async () => {
    const listener = registerWatcher();

    listener(
      {
        [STORAGE_KEYS.PASSWORDS]: { oldValue: [], newValue: [{ id: 'p1', encrypted: true }] },
        [STORAGE_KEYS.TRASH]: { oldValue: [], newValue: [{ id: 't1', encrypted: true }] },
      },
      'local',
    );
    await flush();

    expect(requestReEncryptAtRest).not.toHaveBeenCalled();
  });
});
