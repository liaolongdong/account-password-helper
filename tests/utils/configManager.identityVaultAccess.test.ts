import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * 身份信息库复验策略的读写测试
 *
 * 这里是「非法值不会换成少问一次」的唯一执行点：`shouldVerifyIdentityVault` 的 switch
 * 只覆盖 TS 联合类型里的三个合法档，运行时真拿到认不出的值会走到函数末尾返回 `undefined`
 * （falsy = 免验）。所以出口必须把非法值收敛成最严格的 `always`，而不是默认值或放行。
 *
 * 覆盖：
 * - 缺键 / 字段缺失回落默认档 `perSession`（存储层合并默认值，出口拿不到 undefined）；
 * - 显式写进来的非法策略值一律收敛到最严格的 `always`，刻意不同于默认档；
 * - 合法三档可写入并原样读回；
 * - 非法档位写入直接抛错且不落盘，避免把放宽状态长期固化；
 * - 空补丁只补齐默认值，保留已有档位；保存不触碰其他存储键。
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

import { DEFAULT_IDENTITY_VERIFY_POLICY } from '@/utils/identityVaultAccess';
import { getIdentityVaultAccessConfig, saveIdentityVaultAccessConfig } from '@/utils/storage/configManager';

describe('getIdentityVaultAccessConfig', () => {
  it('缺键回落默认档，且默认档与最严档是两条可区分的路径', async () => {
    expect(await getIdentityVaultAccessConfig()).toEqual({ verifyPolicy: DEFAULT_IDENTITY_VERIFY_POLICY });
    // 若哪天默认档被改成 `always`，上一条就与「非法回落」重合、失去各自的信号
    expect(DEFAULT_IDENTITY_VERIFY_POLICY).not.toBe('always');
  });

  it('非法策略值回落最严格的 always，而不是默认档', async () => {
    // 这一条是 fail-CLOSED 的落点：认不出就当作「没设过开关之外更严的档」，
    // 写成 `?? DEFAULT_IDENTITY_VERIFY_POLICY` 也能让其余用例全绿，故刻意断言它不等于默认档
    for (const bad of ['yolo', 'ALWAYS', 'always ', '', null, 0, {}, []]) {
      store[STORAGE_KEYS.IDENTITY_VAULT_ACCESS_CONFIG] = { verifyPolicy: bad };
      expect(await getIdentityVaultAccessConfig()).toEqual({ verifyPolicy: 'always' });
    }
  });

  it('字段缺失走默认档，与「显式写了非法值」不是一回事', async () => {
    // `createConfigStore.get()` 在读取时就把默认值合并进来，所以「没写过这个字段」
    // 到出口时已经是 `perSession`，拿不到 undefined。真正的 fail-closed 只针对**显式
    // 写进来的认不出的值**（上一条用例）。两条路径都会在本文档首开时复验一次，
    // 差别仅在「每次问」与「每文档问一次」，不构成免验通道。
    store[STORAGE_KEYS.IDENTITY_VAULT_ACCESS_CONFIG] = {};
    expect(await getIdentityVaultAccessConfig()).toEqual({ verifyPolicy: DEFAULT_IDENTITY_VERIFY_POLICY });
  });

  it('合法三档原样读回', async () => {
    for (const policy of ['always', 'perSession', 'followValidity'] as const) {
      store[STORAGE_KEYS.IDENTITY_VAULT_ACCESS_CONFIG] = { verifyPolicy: policy };
      expect(await getIdentityVaultAccessConfig()).toEqual({ verifyPolicy: policy });
    }
  });
});

describe('saveIdentityVaultAccessConfig', () => {
  it('写入合法档位并保留其他存储键', async () => {
    store[STORAGE_KEYS.LOCALE] = 'en';
    await saveIdentityVaultAccessConfig({ verifyPolicy: 'followValidity' });

    expect(store[STORAGE_KEYS.IDENTITY_VAULT_ACCESS_CONFIG]).toEqual({ verifyPolicy: 'followValidity' });
    expect(store[STORAGE_KEYS.LOCALE]).toBe('en');
  });

  it('非法档位抛错且不落盘', async () => {
    // 静默忽略（同域匹配档位的写法）在这里不合适：调用方是设置弹窗，
    // 抛错才能让界面给出「保存失败」反馈，而不是让用户以为档位已经生效
    await expect(saveIdentityVaultAccessConfig({ verifyPolicy: 'everything' as never })).rejects.toThrow();
    expect(STORAGE_KEYS.IDENTITY_VAULT_ACCESS_CONFIG in store).toBe(false);
  });

  it('空补丁只补齐默认值，不清空已有档位', async () => {
    await saveIdentityVaultAccessConfig({ verifyPolicy: 'always' });
    await saveIdentityVaultAccessConfig({});
    expect(await getIdentityVaultAccessConfig()).toEqual({ verifyPolicy: 'always' });
  });
});
