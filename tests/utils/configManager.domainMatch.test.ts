import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * 站点匹配策略（跨子域档位 + 端口范围）配置读写测试
 *
 * 覆盖：
 * - 缺键 / 非法值一律逐项回落缺省（`off` + `loose`，宁可少显示条目，也不静默放宽匹配）；
 * - 合法三档可写入并读回，旧的单键记录（没有 portScope）自动补齐缺省端口轴；
 * - 保存为增量合并，且不触碰其他存储键；
 * - 非法档位 / 非法端口范围写入被忽略（不落盘），避免异常状态长期影响匹配口径。
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

import {
  DEFAULT_DOMAIN_MATCH_CONFIG,
  DEFAULT_DOMAIN_MATCH_MODE,
  DEFAULT_PORT_SCOPE,
  getDomainMatchConfig,
  saveDomainMatchConfig,
} from '@/utils/storage/configManager';

describe('getDomainMatchConfig', () => {
  it('缺键回落缺省策略（off + loose，即本功能存在之前的口径）', async () => {
    expect(await getDomainMatchConfig()).toEqual({ mode: 'off', portScope: 'loose' });
  });

  it('未知枚举回落 off', async () => {
    store[STORAGE_KEYS.DOMAIN_MATCH_CONFIG] = { mode: 'yolo' };
    expect(await getDomainMatchConfig()).toEqual({ mode: DEFAULT_DOMAIN_MATCH_MODE, portScope: DEFAULT_PORT_SCOPE });
  });

  it('字段缺失或非对象值回落缺省策略', async () => {
    for (const bad of [{}, { mode: null }, 'off', null]) {
      store[STORAGE_KEYS.DOMAIN_MATCH_CONFIG] = bad;
      expect(await getDomainMatchConfig()).toEqual({ mode: 'off', portScope: 'loose' });
    }
  });

  it('端口范围未知时只回落端口轴，档位按存储值读回（两轴各自独立归一）', async () => {
    store[STORAGE_KEYS.DOMAIN_MATCH_CONFIG] = { mode: 'wildcard', portScope: 'strict-ish' };
    expect(await getDomainMatchConfig()).toEqual({ mode: 'wildcard', portScope: DEFAULT_PORT_SCOPE });
  });

  it('合法三档原样读回，旧记录缺 portScope 键时补齐缺省端口轴（无需数据迁移）', async () => {
    for (const mode of ['off', 'wildcard', 'sameMainDomain'] as const) {
      store[STORAGE_KEYS.DOMAIN_MATCH_CONFIG] = { mode };
      expect(await getDomainMatchConfig()).toEqual({ mode, portScope: DEFAULT_PORT_SCOPE });
    }
  });

  it('端口轴合法值原样读回，两键互不遮蔽', async () => {
    store[STORAGE_KEYS.DOMAIN_MATCH_CONFIG] = { mode: 'sameMainDomain', portScope: 'strict' };
    expect(await getDomainMatchConfig()).toEqual({ mode: 'sameMainDomain', portScope: 'strict' });
  });
});

describe('saveDomainMatchConfig', () => {
  it('写入合法档位并保留其他存储键', async () => {
    store[STORAGE_KEYS.LOCALE] = 'en';
    await saveDomainMatchConfig({ mode: 'wildcard' });

    // 增量合并会把另一轴补齐为缺省值落盘，读回形状恒为两项
    expect(store[STORAGE_KEYS.DOMAIN_MATCH_CONFIG]).toEqual({ ...DEFAULT_DOMAIN_MATCH_CONFIG, mode: 'wildcard' });
    expect(store[STORAGE_KEYS.LOCALE]).toBe('en');
  });

  it('写入合法端口范围不影响档位', async () => {
    store[STORAGE_KEYS.DOMAIN_MATCH_CONFIG] = { mode: 'sameMainDomain', portScope: 'loose' };
    await saveDomainMatchConfig({ portScope: 'strict' });

    expect(await getDomainMatchConfig()).toEqual({ mode: 'sameMainDomain', portScope: 'strict' });
  });

  it('非法档位被忽略，不产生落盘', async () => {
    await saveDomainMatchConfig({ mode: 'everything' as never });
    expect(STORAGE_KEYS.DOMAIN_MATCH_CONFIG in store).toBe(false);
  });

  it('非法端口范围被忽略，不产生落盘', async () => {
    await saveDomainMatchConfig({ portScope: 'any' as never });
    expect(STORAGE_KEYS.DOMAIN_MATCH_CONFIG in store).toBe(false);
  });

  it('空补丁只补齐默认值，不清空已有档位', async () => {
    await saveDomainMatchConfig({ mode: 'sameMainDomain' });
    await saveDomainMatchConfig({});
    expect(await getDomainMatchConfig()).toEqual({ mode: 'sameMainDomain', portScope: 'loose' });
  });
});
