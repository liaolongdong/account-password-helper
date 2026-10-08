import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { DEFAULT_IDENTITY_SORT_MODE } from '@/utils/identity/constants';

/**
 * 身份信息库排序档位的落盘读写测试
 *
 * 档位是**明文单键**（枚举值、零 PII），所以它不走整块加密那条通道，而是与
 * `vault_page_size` 同一形态的偏好读写。这里钉死两件事，形状照
 * `configManager.vaultPageSize.test.ts`：
 * 1. 读出来的值只可能是 `IDENTITY_SORT_MODES` 白名单里的一档——存储被历史版本、手改或导入污染时回落默认档，
 *    绝不把坏值透传给视图层（否则 `sortIdentityEntries` 会走进兜底分支，用户看到的是
 *    「排序坏了」而不是「回落了」）；
 * 2. 非法写入被忽略且**不落盘**：视图偏好不值得为一次坏写入向用户报错，但把非法状态
 *    写进存储会长期影响结果。
 *
 * `chrome.storage.local` 用内存实现打桩，保持 hermetic；另一枚无关键用来验证写入不越界。
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

import { getIdentitySortMode, saveIdentitySortMode } from '@/utils/storage/identityCrud';

describe('getIdentitySortMode', () => {
  it('缺键回落默认档（首次使用不该看到「未定义顺序」）', async () => {
    expect(await getIdentitySortMode()).toBe(DEFAULT_IDENTITY_SORT_MODE);
  });

  it('白名单外的值一律回落默认，绝不透传', async () => {
    for (const bad of ['updatedAt', 'TITLE', '', 1, null, undefined, {}, ['title']]) {
      store[STORAGE_KEYS.IDENTITY_SORT_MODE] = bad;
      expect(await getIdentitySortMode(), `非法档位 ${String(bad)} 应回落默认`).toBe(DEFAULT_IDENTITY_SORT_MODE);
    }
  });

  it('五个合法档位原样读回', async () => {
    // 这份字面量不会因新增档位而变红（它是写死的，不是从 IDENTITY_SORT_MODES 派生的），
    // 所以加一档必须同时补进来——否则新档位的落盘读回无人验证。
    for (const mode of ['updated', 'created', 'category', 'title', 'manual'] as const) {
      store[STORAGE_KEYS.IDENTITY_SORT_MODE] = mode;
      expect(await getIdentitySortMode()).toBe(mode);
    }
  });

  it('读取失败降级为默认档（视图偏好不该阻断弹窗打开）', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('storage unavailable'));
    expect(await getIdentitySortMode()).toBe(DEFAULT_IDENTITY_SORT_MODE);
  });
});

describe('saveIdentitySortMode', () => {
  it('合法档位落盘到约定键，且不触碰其他存储键', async () => {
    await saveIdentitySortMode('category');
    expect(store[STORAGE_KEYS.IDENTITY_SORT_MODE]).toBe('category');
    expect(store.other_key).toBe('keep-me');
  });

  it('非法档位忽略写入：既不落盘也不抛错', async () => {
    await saveIdentitySortMode('nope' as never);
    await saveIdentitySortMode(undefined as never);
    expect(STORAGE_KEYS.IDENTITY_SORT_MODE in store).toBe(false);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('写入失败向上抛出，由调用方按非致命处理', async () => {
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('quota'));
    await expect(saveIdentitySortMode('title')).rejects.toThrow('quota');
  });
});
