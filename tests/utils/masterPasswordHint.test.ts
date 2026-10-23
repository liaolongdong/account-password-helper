import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * 主密码提示语（hint）存储边界单元测试
 *
 * 覆盖 `setMasterPassword` 的第二参数与 `getMasterPasswordHint`：
 * - 归一化：去首尾空白、按 `MAX_MASTER_PASSWORD_HINT_LENGTH` 截断（表单 `maxlength` 只是体验，
 *   存储侧才是事实来源，DOM/脚本直写也挡得住）；
 * - 空串 / 未传 → **省略** `hint` 字段，而不是写入空串，保持「未设置」只有一种表示；
 * - 存量配置（无 `hint` 字段）读出空串，读取异常同样降级空串且不抛；
 * - 提示语绝不进校验哈希与盐值之外的任何键，也不影响写入后的自校验流程。
 *
 * 加密模块以 mock 注入：真实 PBKDF2 600k 轮会拖慢测试，而这里要观测的是落盘形状，不是密码学强度。
 * chrome.storage.local 以内存实现打桩，保持 hermetic。
 */

const { deriveVerifierHash } = vi.hoisted(() => ({
  deriveVerifierHash: vi.fn<(password: string, salt: string) => Promise<string>>(async () => 'a'.repeat(64)),
}));

vi.mock('@/utils/encryption', () => ({
  deriveVerifierHash,
}));

/** 与 `MasterPasswordConfig.hashedPassword` 同形的合法 64 位 hex，供 verify 比对通过 */
const VERIFIER = 'a'.repeat(64);

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  deriveVerifierHash.mockClear();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
        remove: vi.fn(async (key: string) => {
          delete store[key];
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import {
  MAX_MASTER_PASSWORD_HINT_LENGTH,
  getMasterPasswordHint,
  setMasterPassword,
} from '@/utils/storage/masterPassword';

describe('setMasterPassword 的提示语落盘', () => {
  it('带首尾空白的提示语被 trim 后落盘', async () => {
    await setMasterPassword('Master#123', '  孩子名字 + 入职年份  ');

    expect(store[STORAGE_KEYS.MASTER_PASSWORD]).toMatchObject({ hint: '孩子名字 + 入职年份' });
  });

  it('超长提示语按上限截断，不无限增长存储写入', async () => {
    await setMasterPassword('Master#123', 'x'.repeat(MAX_MASTER_PASSWORD_HINT_LENGTH + 80));

    const config = store[STORAGE_KEYS.MASTER_PASSWORD] as { hint: string };
    expect(config.hint).toHaveLength(MAX_MASTER_PASSWORD_HINT_LENGTH);
  });

  it('未传提示语时省略该字段（而非写入空串），存量形状不变', async () => {
    await setMasterPassword('Master#123');

    const config = store[STORAGE_KEYS.MASTER_PASSWORD] as Record<string, unknown>;
    expect('hint' in config).toBe(false);
    expect(config).toMatchObject({ hashedPassword: VERIFIER, kdf: 'pbkdf2-sha256' });
  });

  it('纯空白提示语等同未设置', async () => {
    await setMasterPassword('Master#123', '   ');

    expect('hint' in (store[STORAGE_KEYS.MASTER_PASSWORD] as Record<string, unknown>)).toBe(false);
  });

  it('提示语不参与校验哈希派生（写入与自校验两次派生都只吃主密码与盐值）', async () => {
    await setMasterPassword('Master#123', 'hint-text');

    // 两次：setMasterPassword 落盘前派生一次，随后 verifyMasterPassword 读回自校验再派生一次
    const calls = deriveVerifierHash.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call[0] === 'Master#123')).toBe(true);
    expect(calls.some(call => String(call[1]).includes('hint-text'))).toBe(false);
  });
});

describe('getMasterPasswordHint', () => {
  it('读取已存的提示语', async () => {
    store[STORAGE_KEYS.MASTER_PASSWORD] = { hashedPassword: VERIFIER, salt: 's', kdf: 'pbkdf2-sha256', hint: 'hi' };
    await expect(getMasterPasswordHint()).resolves.toBe('hi');
  });

  it('存量配置无 hint 字段 → 空串', async () => {
    store[STORAGE_KEYS.MASTER_PASSWORD] = { hashedPassword: VERIFIER, salt: 's', kdf: 'pbkdf2-sha256' };
    await expect(getMasterPasswordHint()).resolves.toBe('');
  });

  it('主密码配置整体缺失 → 空串', async () => {
    await expect(getMasterPasswordHint()).resolves.toBe('');
  });

  it('storage 读取异常 → 降级空串且不抛出', async () => {
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(getMasterPasswordHint()).resolves.toBe('');
  });

  it('读取到的提示语同样按上限归一化（防直写存储把长值喂给解锁页）', async () => {
    store[STORAGE_KEYS.MASTER_PASSWORD] = {
      hashedPassword: VERIFIER,
      salt: 's',
      kdf: 'pbkdf2-sha256',
      hint: `  ${'y'.repeat(MAX_MASTER_PASSWORD_HINT_LENGTH + 40)}  `,
    };
    await expect(getMasterPasswordHint()).resolves.toHaveLength(MAX_MASTER_PASSWORD_HINT_LENGTH);
  });
});
