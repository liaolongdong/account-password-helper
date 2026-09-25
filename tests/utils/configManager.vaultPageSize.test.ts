import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { DEFAULT_PAGE_SIZE } from '@/utils/vaultPageSize';

/**
 * 管理页每页条数（档位）读写测试
 *
 * 档位是「一次喂给 el-table 多少行」的直接开关，因此这里钉死两件事：
 * 1. 读出来的值只可能是 50/100/200 之一——存储被历史版本、导入配置或手改污染时回落默认，
 *    绝不透传 0 / 负数（会让列表空白）或超大值（会绕过 200 这条渲染成本上限）；
 * 2. 写进去的值必须是合法档位，非法写入被忽略且不落盘，避免异常状态长期影响性能。
 *
 * chrome.storage.local 用内存实现打桩，保持测试 hermetic（与档位无关的其他键用来验证不越界写入）。
 */

/** 内存版 chrome.storage.local 后备存储 */
let store: Record<string, unknown>;

beforeEach(() => {
  store = { other_key: 'keep-me' };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import { getVaultPageSize, saveVaultPageSize } from '@/utils/storage/configManager';

describe('getVaultPageSize', () => {
  it('缺键回落默认档位', async () => {
    expect(await getVaultPageSize()).toBe(DEFAULT_PAGE_SIZE);
  });

  it('白名单外的值一律回落默认，绝不透传', async () => {
    for (const bad of [0, -100, 25, 51, 150, 1000, '100', null, undefined, {}, []]) {
      store[STORAGE_KEYS.VAULT_PAGE_SIZE] = bad;
      expect(await getVaultPageSize(), `非法档位 ${String(bad)} 应回落默认`).toBe(DEFAULT_PAGE_SIZE);
    }
  });

  it('三个合法档位原样读回', async () => {
    for (const size of [50, 100, 200]) {
      store[STORAGE_KEYS.VAULT_PAGE_SIZE] = size;
      expect(await getVaultPageSize()).toBe(size);
    }
  });

  it('读取失败降级为默认档位（不向上抛）', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('storage unavailable'));
    expect(await getVaultPageSize()).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe('saveVaultPageSize', () => {
  it('合法档位落盘到约定键，且不触碰其他存储键', async () => {
    await saveVaultPageSize(200);
    expect(store[STORAGE_KEYS.VAULT_PAGE_SIZE]).toBe(200);
    expect(store.other_key).toBe('keep-me');
  });

  it('非法档位忽略写入：既不落盘也不抛错', async () => {
    await saveVaultPageSize(0);
    await saveVaultPageSize(9999);
    expect(STORAGE_KEYS.VAULT_PAGE_SIZE in store).toBe(false);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('写入失败向上抛出，由调用方按非致命处理', async () => {
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('quota'));
    await expect(saveVaultPageSize(50)).rejects.toThrow('quota');
  });
});
