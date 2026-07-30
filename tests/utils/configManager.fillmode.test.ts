import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * configManager 填充默认值与存量冻结测试
 *
 * 覆盖：
 * - getDefaultFloatingButtonConfig：默认填充方式为「内联」的规范态组合
 *   （fillMode: 'inline' + autoShowSidepanel: false）；
 * - freezeLegacyFillDefaults（升级钩子）：
 *   - storage 无键（从未保存过偏好）→ 补写历史默认值冻结旧行为；
 *   - 已有完整配置 → 原样保留不写入；
 *   - 旧版本存储缺少单个字段 → 仅补缺失字段，其余字段不受影响。
 *
 * chrome.storage.local 通过 vi.stubGlobal 以内存实现打桩，保持测试 hermetic。
 */

/** 内存版 chrome.storage.local 后备存储 */
let store: Record<string, unknown>;

const storageGet = vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {}));
const storageSet = vi.fn(async (items: Record<string, unknown>) => {
  Object.assign(store, items);
});

beforeEach(() => {
  store = {};
  storageGet.mockClear();
  storageSet.mockClear();
  vi.stubGlobal('chrome', {
    storage: { local: { get: storageGet, set: storageSet } },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import { freezeLegacyFillDefaults, getDefaultFloatingButtonConfig } from '@/utils/storage/configManager';

describe('getDefaultFloatingButtonConfig', () => {
  it('默认填充方式为内联的规范态组合（fillMode=inline + autoShowSidepanel=false）', () => {
    const defaults = getDefaultFloatingButtonConfig();
    expect(defaults.fillMode).toBe('inline');
    expect(defaults.autoShowSidepanel).toBe(false);
  });
});

describe('freezeLegacyFillDefaults', () => {
  it('storage 无键时补写历史默认值（fillMode=sidepanel + autoShowSidepanel=true）', async () => {
    await freezeLegacyFillDefaults();

    expect(store[STORAGE_KEYS.FLOATING_BUTTON_CONFIG]).toEqual({
      fillMode: 'sidepanel',
      autoShowSidepanel: true,
    });
  });

  it('已有完整配置时不做任何写入', async () => {
    const existing = { visible: true, fillMode: 'inline', autoShowSidepanel: false, opacity: 0.9 };
    store[STORAGE_KEYS.FLOATING_BUTTON_CONFIG] = existing;

    await freezeLegacyFillDefaults();

    expect(storageSet).not.toHaveBeenCalled();
    expect(store[STORAGE_KEYS.FLOATING_BUTTON_CONFIG]).toBe(existing);
  });

  it('缺少单个字段时仅补该字段，其余字段原样保留', async () => {
    // 模拟 fillMode 字段上线前保存的旧版本配置（含 autoShowSidepanel 但无 fillMode）
    store[STORAGE_KEYS.FLOATING_BUTTON_CONFIG] = { visible: false, autoShowSidepanel: false, opacity: 0.5 };

    await freezeLegacyFillDefaults();

    expect(store[STORAGE_KEYS.FLOATING_BUTTON_CONFIG]).toEqual({
      visible: false,
      autoShowSidepanel: false,
      opacity: 0.5,
      fillMode: 'sidepanel',
    });
  });

  it('仅缺 autoShowSidepanel 时仅补该字段，保留已有 fillMode', async () => {
    // 对称分支：未来字段演进或手工编辑可能出现只缺一个字段的形态
    store[STORAGE_KEYS.FLOATING_BUTTON_CONFIG] = { visible: true, fillMode: 'inline' };

    await freezeLegacyFillDefaults();

    expect(store[STORAGE_KEYS.FLOATING_BUTTON_CONFIG]).toEqual({
      visible: true,
      fillMode: 'inline',
      autoShowSidepanel: true,
    });
  });

  it('storage 读取异常时静默降级不抛出', async () => {
    storageGet.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(freezeLegacyFillDefaults()).resolves.toBeUndefined();
    expect(storageSet).not.toHaveBeenCalled();
  });
});
