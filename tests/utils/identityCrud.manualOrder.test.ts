import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { MAX_IDENTITIES } from '@/utils/identity/constants';

/**
 * 身份信息库 `manual` 档手排序号的落盘读写测试
 *
 * 手排序号与排序档位同属「明文单键、零 PII」的视图偏好（键值只有 `generateId()` 的随机
 * id），形状照 `identityCrud.sortMode.test.ts`，但脏数据的处理口径更要紧：这张数组直接
 * 决定列表顺序，一旦被历史版本、手改或并发写坏成任意形状，**必须整体回落空数组**而不是
 * 尽力修补——修补出来的位次会静默决定用户的手排结果，回落则退化为「未登记 → 落末尾」，
 * 列表照常显示、一条不丢。这里钉死三件事：
 * 1. 合法数组原样读回，读写互逆；
 * 2. 非 `string[]` / 含重复 id / 含空串 / 超过条目上限一律回落 `[]`，读失败同样回落，
 *    坏数据永不炸弹窗；
 * 3. 非法写入忽略且**不落盘**（照 `saveIdentitySortMode` 的取舍），写入失败向上抛出。
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

import { getIdentityManualOrder, saveIdentityManualOrder } from '@/utils/storage/identityCrud';

describe('getIdentityManualOrder', () => {
  it('缺键回落空数组（首次使用 = 谁都没排过序，不是坏数据）', async () => {
    expect(await getIdentityManualOrder()).toEqual([]);
  });

  it('合法数组原样读回', async () => {
    store[STORAGE_KEYS.IDENTITY_MANUAL_ORDER] = ['uuid-b', 'uuid-a', 'uuid-c'];
    expect(await getIdentityManualOrder()).toEqual(['uuid-b', 'uuid-a', 'uuid-c']);
  });

  it('脏数据一律回落空数组：非数组、非字符串元素、空串、重复 id、超长', async () => {
    const dirty: unknown[] = [
      'not-an-array',
      null,
      undefined,
      {},
      ['uuid-a', 1],
      ['uuid-a', ''],
      ['uuid-a', 'uuid-a'],
      ['uuid-a', { id: 'uuid-b' }],
      Array.from({ length: MAX_IDENTITIES + 1 }, (_, i) => `uuid-${i}`),
    ];
    for (const value of dirty) {
      store[STORAGE_KEYS.IDENTITY_MANUAL_ORDER] = value;
      expect(await getIdentityManualOrder(), `脏值 ${JSON.stringify(value)} 应回落空数组`).toEqual([]);
    }
  });

  it('恰好等于条目上限的数组合法（30 条满库不该被判成脏数据）', async () => {
    const full = Array.from({ length: MAX_IDENTITIES }, (_, i) => `uuid-${i}`);
    store[STORAGE_KEYS.IDENTITY_MANUAL_ORDER] = full;
    expect(await getIdentityManualOrder()).toEqual(full);
  });

  it('读取失败降级为空数组（视图偏好不该阻断弹窗打开）', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('storage unavailable'));
    expect(await getIdentityManualOrder()).toEqual([]);
  });
});

describe('saveIdentityManualOrder', () => {
  it('落盘到约定键、读写互逆，且不触碰其他存储键', async () => {
    await saveIdentityManualOrder(['uuid-a', 'uuid-b']);
    expect(store[STORAGE_KEYS.IDENTITY_MANUAL_ORDER]).toEqual(['uuid-a', 'uuid-b']);
    expect(store.other_key).toBe('keep-me');
    expect(await getIdentityManualOrder()).toEqual(['uuid-a', 'uuid-b']);
  });

  it('写入的是副本：调用方随后改动入参数组不影响已落盘的值', async () => {
    const ids = ['uuid-a', 'uuid-b'];
    await saveIdentityManualOrder(ids);
    ids.push('uuid-c');
    expect(store[STORAGE_KEYS.IDENTITY_MANUAL_ORDER]).toEqual(['uuid-a', 'uuid-b']);
  });

  it('空数组照常落盘（等于清空手排偏好，是一次有效写入）', async () => {
    store[STORAGE_KEYS.IDENTITY_MANUAL_ORDER] = ['uuid-a'];
    await saveIdentityManualOrder([]);
    expect(store[STORAGE_KEYS.IDENTITY_MANUAL_ORDER]).toEqual([]);
    expect(await getIdentityManualOrder()).toEqual([]);
  });

  it('非法写入忽略：既不落盘也不抛错', async () => {
    await saveIdentityManualOrder(['', 'uuid-a']);
    await saveIdentityManualOrder(Array.from({ length: MAX_IDENTITIES + 1 }, (_, i) => `uuid-${i}`));
    await saveIdentityManualOrder(['uuid-a', 1 as never]);
    expect(STORAGE_KEYS.IDENTITY_MANUAL_ORDER in store).toBe(false);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('写入失败向上抛出，由调用方按非致命处理', async () => {
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('quota'));
    await expect(saveIdentityManualOrder(['uuid-a'])).rejects.toThrow('quota');
  });
});
