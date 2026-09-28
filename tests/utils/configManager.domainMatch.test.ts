import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * 跨子域匹配档位配置读写测试
 *
 * 覆盖：
 * - 缺键 / 非法值一律回落 `off`（宁可少显示条目，也不静默放宽匹配）；
 * - 合法三档可写入并读回；
 * - 保存为增量合并，且不触碰其他存储键；
 * - 非法档位写入被忽略（不落盘），避免异常状态长期影响匹配口径。
 *
 * chrome.storage.local 通过 vi.stubGlobal 以内存实现打桩，保持测试 hermetic。
 */

/** 内存版 chrome.storage.local 后备存储 */
let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
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

import { DEFAULT_DOMAIN_MATCH_MODE, getDomainMatchConfig, saveDomainMatchConfig } from '@/utils/storage/configManager';

describe('getDomainMatchConfig', () => {
  it('缺键回落 off', async () => {
    expect(await getDomainMatchConfig()).toEqual({ mode: 'off' });
  });

  it('未知枚举回落 off', async () => {
    store[STORAGE_KEYS.DOMAIN_MATCH_CONFIG] = { mode: 'yolo' };
    expect(await getDomainMatchConfig()).toEqual({ mode: DEFAULT_DOMAIN_MATCH_MODE });
  });

  it('字段缺失或非对象值回落 off', async () => {
    for (const bad of [{}, { mode: null }, 'off', null]) {
      store[STORAGE_KEYS.DOMAIN_MATCH_CONFIG] = bad;
      expect(await getDomainMatchConfig()).toEqual({ mode: 'off' });
    }
  });

  it('合法三档原样读回', async () => {
    for (const mode of ['off', 'wildcard', 'sameMainDomain'] as const) {
      store[STORAGE_KEYS.DOMAIN_MATCH_CONFIG] = { mode };
      expect(await getDomainMatchConfig()).toEqual({ mode });
    }
  });
});

describe('saveDomainMatchConfig', () => {
  it('写入合法档位并保留其他存储键', async () => {
    store[STORAGE_KEYS.LOCALE] = 'en';
    await saveDomainMatchConfig({ mode: 'wildcard' });

    expect(store[STORAGE_KEYS.DOMAIN_MATCH_CONFIG]).toEqual({ mode: 'wildcard' });
    expect(store[STORAGE_KEYS.LOCALE]).toBe('en');
  });

  it('非法档位被忽略，不产生落盘', async () => {
    await saveDomainMatchConfig({ mode: 'everything' as never });
    expect(STORAGE_KEYS.DOMAIN_MATCH_CONFIG in store).toBe(false);
  });

  it('空补丁只补齐默认值，不清空已有档位', async () => {
    await saveDomainMatchConfig({ mode: 'sameMainDomain' });
    await saveDomainMatchConfig({});
    expect(await getDomainMatchConfig()).toEqual({ mode: 'sameMainDomain' });
  });
});
