import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { IdentityPayload, IdentityRecord } from '@/utils/identity/types';

/**
 * identityCrud.ts 单元测试
 *
 * 覆盖：
 * - 写路径不变量：无数据密钥拒绝保存、读失败上抛且不写、条数上限拒绝；
 * - 读路径不变量：encryptedPayload 非非空字符串的记录跳过 + 不回写；
 * - 整块加密往返：save → getAllIdentity 解密回原文；
 * - 并发令牌：updateIdentity 的 expectedUpdateTime 不匹配被拒；
 * - 前向兼容：编辑后未知键存活（{ ...existing, ...patch } 展开合并）；
 * - reencryptAll：换钥成功、解密失败原样携带；
 * - 硬删除 / 整体替换。
 *
 * 加密模块与 facades.getSessionDataKey 以 mock 注入，避免 600k 次 PBKDF2
 * 拖慢测试，并让「用哪把密钥加密」成为可断言的观测点（回显 key）。
 */

const { encryptData, decryptData, deriveEncryptionKey } = vi.hoisted(() => ({
  encryptData: vi.fn<(data: string, key: string) => Promise<string>>(),
  decryptData: vi.fn<(data: string, key: string) => Promise<string>>(),
  deriveEncryptionKey: vi.fn<(password: string) => Promise<string>>(),
}));

vi.mock('@/utils/encryption', () => ({
  encryptData,
  decryptData,
  deriveEncryptionKey,
}));

const { getSessionDataKey } = vi.hoisted(() => ({
  getSessionDataKey: vi.fn<() => Promise<string | null>>(),
}));

vi.mock('@/utils/storage/facades', () => ({
  getSessionDataKey,
}));

import {
  deleteIdentities,
  getAllIdentity,
  getAllIdentityRaw,
  getIdentityCrudErrorCode,
  reencryptAll,
  replaceAllIdentity,
  replaceAllIdentityRaw,
  saveIdentity,
  updateIdentity,
} from '@/utils/storage/identityCrud';

const SESSION_KEY = 'session-key';
const DERIVED_KEY = 'key:master-pw';

/** 回显 key 的可逆加密桩，模拟 AES-GCM「错钥即抛」语义 */
const enc = (data: string, key: string) => `ENC[${key}]:${data}`;
const dec = (data: string, key: string) => {
  const prefix = `ENC[${key}]:`;
  if (!data.startsWith(prefix)) throw new Error('key mismatch');
  return data.slice(prefix.length);
};

const payload = (overrides: Partial<IdentityPayload> = {}): IdentityPayload => ({
  pv: 1,
  category: 'person',
  name: '张三',
  phone: '13812345678',
  ...overrides,
});

let localStore: Record<string, unknown>;
let localGet: ReturnType<typeof vi.fn>;
let localSet: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  localStore = {};

  encryptData.mockImplementation(async (data, key) => enc(data, key));
  decryptData.mockImplementation(async (data, key) => dec(data, key));
  deriveEncryptionKey.mockImplementation(async password => `key:${password}`);
  getSessionDataKey.mockResolvedValue(SESSION_KEY);

  localGet = vi.fn(async (key: string) => (key in localStore ? { [key]: localStore[key] } : {}));
  localSet = vi.fn(async (items: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(items)) {
      localStore[k] = JSON.parse(JSON.stringify(v));
    }
  });

  vi.stubGlobal('chrome', {
    storage: {
      local: { get: localGet, set: localSet },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getAllIdentityRaw', () => {
  it('无数据时返回空数组', async () => {
    await expect(getAllIdentityRaw()).resolves.toEqual([]);
  });

  it('读失败上抛（不降级为空数组）', async () => {
    localGet.mockRejectedValueOnce(new Error('storage read error'));
    await expect(getAllIdentityRaw()).rejects.toThrow('storage read error');
  });
});

describe('saveIdentity', () => {
  it('整块加密落盘，且可解密回原文', async () => {
    const saved = await saveIdentity(payload());
    expect(saved.payload).toMatchObject({ name: '张三', category: 'person' });

    const raw = await getAllIdentityRaw();
    expect(raw).toHaveLength(1);
    expect(raw[0].encryptedPayload.startsWith(`ENC[${SESSION_KEY}]:`)).toBe(true);
    // 明文字段（除 4 个结构键外）不进落盘形状
    expect(Object.keys(raw[0]).sort()).toEqual(['createTime', 'encryptedPayload', 'id', 'updateTime']);

    const { entries, skippedIds } = await getAllIdentity();
    expect(skippedIds).toEqual([]);
    expect(entries[0].payload.name).toBe('张三');
  });

  it('无数据密钥时拒绝保存，绝不退回明文', async () => {
    getSessionDataKey.mockResolvedValue(null);
    await expect(saveIdentity(payload())).rejects.toThrow('无法获取加密密钥');
    expect(localSet).not.toHaveBeenCalled();
  });

  it('读失败时整次写入放弃（不写「仅含新条目」的数组）', async () => {
    localGet.mockRejectedValueOnce(new Error('storage read error'));
    await expect(saveIdentity(payload())).rejects.toThrow('storage read error');
    expect(localSet).not.toHaveBeenCalled();
  });

  it('达到条数上限时拒绝新增', async () => {
    const full: IdentityRecord[] = Array.from({ length: 30 }, (_, i) => ({
      id: `id-${i}`,
      encryptedPayload: enc(JSON.stringify(payload()), SESSION_KEY),
      createTime: 1,
      updateTime: 1,
    }));
    localStore[STORAGE_KEYS.IDENTITY] = full;
    await expect(saveIdentity(payload())).rejects.toThrow('已达上限');
    expect(localSet).not.toHaveBeenCalled();
  });

  it('锁定态显式传主密码时用派生密钥加密', async () => {
    const saved = await saveIdentity(payload(), 'master-pw');
    expect(deriveEncryptionKey).toHaveBeenCalledWith('master-pw');
    expect(saved.encryptedPayload.startsWith(`ENC[${DERIVED_KEY}]:`)).toBe(true);
  });
});

describe('getAllIdentity（读路径不变量）', () => {
  it('encryptedPayload 非非空字符串的记录跳过 + 不回写', async () => {
    localStore[STORAGE_KEYS.IDENTITY] = [
      { id: 'empty', encryptedPayload: '', createTime: 1, updateTime: 1 },
      { id: 'non-string', encryptedPayload: 123, createTime: 1, updateTime: 1 },
      { id: 'ok', encryptedPayload: enc(JSON.stringify(payload()), SESSION_KEY), createTime: 1, updateTime: 1 },
    ];
    const { entries, skippedIds } = await getAllIdentity();
    expect(entries.map(e => e.id)).toEqual(['ok']);
    expect(skippedIds.sort()).toEqual(['empty', 'non-string']);
    // 跳过不回写：localSet 未被调用
    expect(localSet).not.toHaveBeenCalled();
  });

  it('无密钥且存在记录时抛错', async () => {
    localStore[STORAGE_KEYS.IDENTITY] = [
      { id: 'x', encryptedPayload: enc('{}', SESSION_KEY), createTime: 1, updateTime: 1 },
    ];
    getSessionDataKey.mockResolvedValue(null);
    await expect(getAllIdentity()).rejects.toThrow('需要主密码来解密数据');
  });

  it('密文损坏（解密失败）的记录计入 skippedIds', async () => {
    localStore[STORAGE_KEYS.IDENTITY] = [
      { id: 'bad', encryptedPayload: 'not-encrypted', createTime: 1, updateTime: 1 },
    ];
    const { entries, skippedIds } = await getAllIdentity();
    expect(entries).toEqual([]);
    expect(skippedIds).toEqual(['bad']);
  });
});

describe('updateIdentity', () => {
  const seed = async (): Promise<IdentityRecord> => {
    await saveIdentity(payload());
    return (await getAllIdentityRaw())[0];
  };

  it('并发令牌匹配时合并写入，且前向兼容未知键', async () => {
    const record = await seed();
    const originalPayload = JSON.parse(dec(record.encryptedPayload, SESSION_KEY)) as Record<string, unknown>;
    // 模拟未来版本新增的未知键
    originalPayload.futureField = 'kept';
    localStore[STORAGE_KEYS.IDENTITY] = [
      { ...record, encryptedPayload: enc(JSON.stringify(originalPayload), SESSION_KEY) },
    ];

    await updateIdentity(record.id, { name: '李四' }, record.updateTime);

    const raw = await getAllIdentityRaw();
    const updated = JSON.parse(dec(raw[0].encryptedPayload, SESSION_KEY)) as Record<string, unknown>;
    expect(updated.name).toBe('李四');
    expect(updated.futureField).toBe('kept');
    expect(updated.pv).toBe(1);
  });

  it('并发令牌不匹配时拒绝并抛错', async () => {
    const record = await seed();
    localSet.mockClear();
    await expect(updateIdentity(record.id, { name: '李四' }, record.updateTime + 1)).rejects.toThrow(
      '已被其他窗口修改',
    );
    expect(localSet).not.toHaveBeenCalled();
  });

  it('不存在的 id 抛错（编辑被并发删除，不静默成功）', async () => {
    await seed();
    localSet.mockClear();
    await expect(updateIdentity('nope', { name: '李四' }, 1)).rejects.toThrow('已被删除');
    expect(localSet).not.toHaveBeenCalled();
  });
});

describe('deleteIdentities', () => {
  it('硬删除指定条目，不存在的 id 忽略', async () => {
    await saveIdentity(payload({ name: 'A' }));
    await saveIdentity(payload({ name: 'B' }));
    const raw = await getAllIdentityRaw();
    await deleteIdentities([raw[0].id, 'nope']);

    const remaining = await getAllIdentityRaw();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(raw[1].id);
  });
});

describe('reencryptAll', () => {
  it('用新钥重加密全部条目', async () => {
    const raw: IdentityRecord[] = [
      { id: 'a', encryptedPayload: enc(JSON.stringify(payload()), 'OLD'), createTime: 1, updateTime: 1 },
      { id: 'b', encryptedPayload: enc(JSON.stringify(payload({ name: 'B' })), 'OLD'), createTime: 1, updateTime: 1 },
    ];
    const result = await reencryptAll(raw, 'OLD', 'NEW');

    expect(result).toHaveLength(2);
    for (const r of result) {
      // 新密文须能用 NEW 解、不能用 OLD 解
      expect(JSON.parse(dec(r.encryptedPayload, 'NEW'))).toBeTruthy();
      expect(() => dec(r.encryptedPayload, 'OLD')).toThrow();
    }
    expect(result.map(r => r.id)).toEqual(['a', 'b']);
  });

  it('解密失败的单条原样携带（不清空、不丢弃）', async () => {
    const broken: IdentityRecord = { id: 'broken', encryptedPayload: 'corrupted', createTime: 1, updateTime: 1 };
    const ok: IdentityRecord = { id: 'ok', encryptedPayload: enc('{}', 'OLD'), createTime: 1, updateTime: 1 };
    const result = await reencryptAll([broken, ok], 'OLD', 'NEW');

    expect(result).toHaveLength(2);
    expect(result.find(r => r.id === 'broken')?.encryptedPayload).toBe('corrupted');
    expect(JSON.parse(dec(result.find(r => r.id === 'ok')!.encryptedPayload, 'NEW'))).toEqual({});
  });
});

describe('replaceAllIdentityRaw', () => {
  it('整体替换身份条目列表', async () => {
    const records: IdentityRecord[] = [{ id: 'a', encryptedPayload: 'x', createTime: 1, updateTime: 1 }];
    await replaceAllIdentityRaw(records);
    expect(await getAllIdentityRaw()).toEqual(records);
  });
});

describe('replaceAllIdentity（导入写回不丢弃不可解密记录）', () => {
  it('磁盘上解密失败、未进入调用方明文列表的记录被原样保留（密文不动）', async () => {
    const good: IdentityRecord = {
      id: 'good',
      encryptedPayload: enc(JSON.stringify(payload()), SESSION_KEY),
      createTime: 1,
      updateTime: 1,
    };
    const bad: IdentityRecord = {
      id: 'bad',
      encryptedPayload: 'corrupted-not-decryptable',
      createTime: 2,
      updateTime: 2,
    };
    localStore[STORAGE_KEYS.IDENTITY] = [good, bad];

    // 模拟导入流：调用方只能拿到可解密的明文列表（getAllIdentity 已跳过 bad）
    const { entries, skippedIds } = await getAllIdentity();
    expect(entries.map(e => e.id)).toEqual(['good']);
    expect(skippedIds).toEqual(['bad']);
    await replaceAllIdentity(
      entries.map(e => ({ id: e.id, createTime: e.createTime, updateTime: e.updateTime, payload: e.payload })),
    );

    const raw = await getAllIdentityRaw();
    expect(raw.map(r => r.id).sort()).toEqual(['bad', 'good']);
    expect(raw.find(r => r.id === 'bad')?.encryptedPayload).toBe('corrupted-not-decryptable');
  });

  it('入参 id 命中磁盘记录时以新明文为准（覆盖旧密文，不重复保留）', async () => {
    localStore[STORAGE_KEYS.IDENTITY] = [{ id: 'x', encryptedPayload: 'old-cipher', createTime: 1, updateTime: 1 }];
    await replaceAllIdentity([{ id: 'x', createTime: 5, updateTime: 9, payload: payload({ name: '新值' }) }]);

    const raw = await getAllIdentityRaw();
    expect(raw).toHaveLength(1);
    expect(raw[0].id).toBe('x');
    expect(raw[0].encryptedPayload).not.toBe('old-cipher');
    expect(JSON.parse(dec(raw[0].encryptedPayload, SESSION_KEY)).name).toBe('新值');
  });
});

describe('getIdentityCrudErrorCode（类型化错误码，替代散文匹配）', () => {
  it('saveIdentity 上限错误携带 LIMIT_REACHED', async () => {
    const full: IdentityRecord[] = Array.from({ length: 30 }, (_, i) => ({
      id: `id-${i}`,
      encryptedPayload: enc(JSON.stringify(payload()), SESSION_KEY),
      createTime: 1,
      updateTime: 1,
    }));
    localStore[STORAGE_KEYS.IDENTITY] = full;
    const err = await saveIdentity(payload()).catch(e => e);
    expect(getIdentityCrudErrorCode(err)).toBe('LIMIT_REACHED');
  });

  it('updateIdentity 冲突/缺失分别携带 UPDATE_CONFLICT / NOT_FOUND', async () => {
    await saveIdentity(payload());
    const record = (await getAllIdentityRaw())[0];
    const conflict = await updateIdentity(record.id, { name: '李四' }, record.updateTime + 1).catch(e => e);
    expect(getIdentityCrudErrorCode(conflict)).toBe('UPDATE_CONFLICT');
    const missing = await updateIdentity('nope', { name: '李四' }, 1).catch(e => e);
    expect(getIdentityCrudErrorCode(missing)).toBe('NOT_FOUND');
  });

  it('无关错误（无 code / 非本模块 code）返回 undefined', () => {
    expect(getIdentityCrudErrorCode(new Error('x'))).toBeUndefined();
    expect(getIdentityCrudErrorCode({ code: 'NOT_APHID' })).toBeUndefined();
  });
});
