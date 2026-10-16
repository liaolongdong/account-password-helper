import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { MAX_IDENTITIES } from '@/utils/identity/constants';
import { TRASH_RETENTION_MS } from '@/utils/storage/trashRetention';
import type { IdentityRecord, TrashedIdentityRecord } from '@/utils/identity/types';

/**
 * 身份信息库回收站（identityTrashManager）回归测试
 *
 * 锁定软删除链路的五条不变量：
 * 1. 移入回收站是**单次原子双写**（IDENTITY + IDENTITY_TRASH），密文原样搬移、只追加 deletedAt；
 * 2. 恢复剥离 deletedAt 追加到主列表末尾，同 id 已存在时仅消费副本，不产生重复条目；
 * 3. 恢复受 MAX_IDENTITIES 守卫：整批要么全恢复要么一条都不写（无部分恢复的中间状态）；
 * 4. 到期清理与密码库共用 TRASH_RETENTION_MS 同一阈值同一比较符（边界日不过早删）；
 * 5. 读路径 fail-closed：主列表/回收站读取上抛时不产生任何写入（防止降级空值覆盖真实数据）。
 *
 * chrome.storage.local 以内存桩实现，与 trashRestoreDedup.test.ts 同口径。
 */

let storageData: Record<string, unknown>;
const localGet = vi.fn();
const localSet = vi.fn();
/** 加密模块以 doMock 注入（仅标题解密用例消费），避免真实 PBKDF2/AES-GCM 拖慢测试 */
const { decryptData } = vi.hoisted(() => ({ decryptData: vi.fn() }));

const readKey = async (key: string): Promise<Record<string, unknown>> =>
  key in storageData ? { [key]: storageData[key] } : {};
const writeItems = async (items: Record<string, unknown>): Promise<void> => {
  Object.assign(storageData, items);
};

/** at-rest 密文形态的身份记录（encryptedPayload 为回显桩，内容不参与本套件判定） */
const cipherRecord = (id: string): IdentityRecord => ({
  id,
  encryptedPayload: `enc[${id}]`,
  createTime: 1,
  updateTime: 1,
});

const trashRecord = (id: string, deletedAt: number): TrashedIdentityRecord => ({
  ...cipherRecord(id),
  deletedAt,
});

const identityIds = (): string[] => ((storageData[STORAGE_KEYS.IDENTITY] as IdentityRecord[]) ?? []).map(e => e.id);
const trashIds = (): string[] =>
  ((storageData[STORAGE_KEYS.IDENTITY_TRASH] as TrashedIdentityRecord[]) ?? []).map(e => e.id);

beforeEach(() => {
  storageData = {};
  localGet.mockImplementation(readKey);
  localSet.mockImplementation(writeItems);
  localGet.mockClear();
  localSet.mockClear();
  vi.stubGlobal('chrome', {
    storage: {
      local: { get: localGet, set: localSet, remove: vi.fn(async () => {}) },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('moveIdentitiesToTrash（软删除）', () => {
  it('原子双写两键：主列表移除、回收站追加 deletedAt，密文原样搬移', async () => {
    const { moveIdentitiesToTrash } = await import('@/utils/storage/identityTrashManager');
    storageData[STORAGE_KEYS.IDENTITY] = [cipherRecord('a'), cipherRecord('b')];
    storageData[STORAGE_KEYS.IDENTITY_TRASH] = [trashRecord('old', 1)];

    await moveIdentitiesToTrash(['a']);

    expect(localSet).toHaveBeenCalledTimes(1);
    const written = localSet.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual([STORAGE_KEYS.IDENTITY, STORAGE_KEYS.IDENTITY_TRASH].sort());
    expect(identityIds()).toEqual(['b']);
    const trash = storageData[STORAGE_KEYS.IDENTITY_TRASH] as TrashedIdentityRecord[];
    expect(trashIds()).toEqual(['old', 'a']);
    const moved = trash.find(e => e.id === 'a')!;
    expect(moved.encryptedPayload).toBe('enc[a]');
    expect(moved.deletedAt).toBeGreaterThan(0);
  });

  it('ids 未命中任何主列表条目时不写入', async () => {
    const { moveIdentitiesToTrash } = await import('@/utils/storage/identityTrashManager');
    storageData[STORAGE_KEYS.IDENTITY] = [cipherRecord('a')];
    storageData[STORAGE_KEYS.IDENTITY_TRASH] = [];

    await moveIdentitiesToTrash(['ghost']);

    expect(localSet).not.toHaveBeenCalled();
    expect(identityIds()).toEqual(['a']);
  });

  it('主列表读取失败时上抛且不写入（fail-closed，防止空覆盖）', async () => {
    const { moveIdentitiesToTrash } = await import('@/utils/storage/identityTrashManager');
    localGet.mockImplementationOnce(() => {
      throw new Error('storage boom');
    });

    await expect(moveIdentitiesToTrash(['a'])).rejects.toThrow('storage boom');
    expect(localSet).not.toHaveBeenCalled();
  });
});

describe('restoreIdentitiesFromTrash（恢复）', () => {
  it('恢复到主列表末尾且剥离 deletedAt，回收站移除该条', async () => {
    const { restoreIdentitiesFromTrash } = await import('@/utils/storage/identityTrashManager');
    storageData[STORAGE_KEYS.IDENTITY] = [cipherRecord('keep')];
    storageData[STORAGE_KEYS.IDENTITY_TRASH] = [trashRecord('r', 5), trashRecord('stay', 6)];

    await restoreIdentitiesFromTrash(['r']);

    expect(identityIds()).toEqual(['keep', 'r']);
    const restored = (storageData[STORAGE_KEYS.IDENTITY] as Record<string, unknown>[])[1];
    expect(restored).not.toHaveProperty('deletedAt');
    expect(trashIds()).toEqual(['stay']);
  });

  it('主列表已存在同 id 时仅消费回收站副本，不追加第二条', async () => {
    const { restoreIdentitiesFromTrash } = await import('@/utils/storage/identityTrashManager');
    storageData[STORAGE_KEYS.IDENTITY] = [cipherRecord('dup')];
    storageData[STORAGE_KEYS.IDENTITY_TRASH] = [trashRecord('dup', 5)];

    await restoreIdentitiesFromTrash(['dup']);

    expect(identityIds()).toEqual(['dup']);
    expect(trashIds()).toEqual([]);
  });

  it('恢复后将超出 MAX_IDENTITIES 时整批拒绝，两键保持原状', async () => {
    const { restoreIdentitiesFromTrash } = await import('@/utils/storage/identityTrashManager');
    const full = Array.from({ length: MAX_IDENTITIES }, (_, i) => cipherRecord(`f${i}`));
    storageData[STORAGE_KEYS.IDENTITY] = full;
    storageData[STORAGE_KEYS.IDENTITY_TRASH] = [trashRecord('overflow', 5)];

    await expect(restoreIdentitiesFromTrash(['overflow'])).rejects.toThrow(/条目数超出上限/);
    expect(localSet).not.toHaveBeenCalled();
    expect(storageData[STORAGE_KEYS.IDENTITY] as IdentityRecord[]).toHaveLength(MAX_IDENTITIES);
    expect(trashIds()).toEqual(['overflow']);
  });

  it('容量判定计入同批已存在条目：重复项不占新额度', async () => {
    const { restoreIdentitiesFromTrash } = await import('@/utils/storage/identityTrashManager');
    const full = Array.from({ length: MAX_IDENTITIES }, (_, i) => cipherRecord(`f${i}`));
    // 回收站一条与主列表同 id（仅消费副本），一条全新（会超上限）——整批拒绝
    storageData[STORAGE_KEYS.IDENTITY] = full;
    storageData[STORAGE_KEYS.IDENTITY_TRASH] = [trashRecord('f0', 5), trashRecord('fresh', 6)];

    await expect(restoreIdentitiesFromTrash(['f0', 'fresh'])).rejects.toThrow(/条目数超出上限/);
    expect(localSet).not.toHaveBeenCalled();
  });
});

describe('permanentDeleteIdentitiesFromTrash / emptyIdentityTrash', () => {
  it('彻底删除仅移除指定条目，其余回收站条目不受影响', async () => {
    const { permanentDeleteIdentitiesFromTrash } = await import('@/utils/storage/identityTrashManager');
    storageData[STORAGE_KEYS.IDENTITY_TRASH] = [trashRecord('x', 1), trashRecord('y', 2)];

    await permanentDeleteIdentitiesFromTrash(['x']);

    expect(trashIds()).toEqual(['y']);
  });

  it('清空写入空数组；回收站已为空时不写入', async () => {
    const { emptyIdentityTrash } = await import('@/utils/storage/identityTrashManager');
    storageData[STORAGE_KEYS.IDENTITY_TRASH] = [trashRecord('x', 1)];
    await emptyIdentityTrash();
    expect(trashIds()).toEqual([]);

    localSet.mockClear();
    await emptyIdentityTrash();
    expect(localSet).not.toHaveBeenCalled();
  });
});

describe('cleanExpiredIdentityTrash（30 天 TTL，与密码库同阈值同比较符）', () => {
  it('严格超过 TRASH_RETENTION_MS 才删除，边界值保留', async () => {
    const { cleanExpiredIdentityTrash } = await import('@/utils/storage/identityTrashManager');
    const now = Date.now();
    storageData[STORAGE_KEYS.IDENTITY_TRASH] = [
      trashRecord('exact', now - TRASH_RETENTION_MS), // 恰好到期：`now - deletedAt > MS` 为 false，保留
      trashRecord('expired', now - TRASH_RETENTION_MS - 1), // 超出 1ms：删除
      trashRecord('fresh', now - 1000), // 保留
    ];

    await cleanExpiredIdentityTrash();

    expect(trashIds()).toEqual(['exact', 'fresh']);
  });

  it('无过期条目时不写入', async () => {
    const { cleanExpiredIdentityTrash } = await import('@/utils/storage/identityTrashManager');
    storageData[STORAGE_KEYS.IDENTITY_TRASH] = [trashRecord('fresh', Date.now())];

    await cleanExpiredIdentityTrash();

    expect(localSet).not.toHaveBeenCalled();
  });
});

describe('展示读取（getIdentityTrashEntries / getIdentityTrashCount）', () => {
  it('列表恒按最近删除在前排序；读失败降级为空列表/0', async () => {
    const { getIdentityTrashEntries, getIdentityTrashCount } = await import('@/utils/storage/identityTrashManager');
    storageData[STORAGE_KEYS.IDENTITY_TRASH] = [trashRecord('old', 1), trashRecord('new', 100)];

    const entries = await getIdentityTrashEntries();
    expect(entries.map(e => e.id)).toEqual(['new', 'old']);
    expect(await getIdentityTrashCount()).toBe(2);

    localGet.mockImplementationOnce(() => {
      throw new Error('storage boom');
    });
    expect(await getIdentityTrashEntries()).toEqual([]);
    localGet.mockImplementationOnce(() => {
      throw new Error('storage boom');
    });
    expect(await getIdentityTrashCount()).toBe(0);
  });
});

describe('decryptIdentityTrashTitles（展示面收窄：只出标题 + 类别）', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/utils/encryption', () => ({ decryptData }));
  });

  it('解密成功仅返回标题与类别，其余 PII 不出现在返回值', async () => {
    const { decryptIdentityTrashTitles } = await import('@/utils/storage/identityTrashManager');
    decryptData.mockImplementation(async () =>
      JSON.stringify({ category: 'bank_card', name: '张三', cardNo: '6222020000000000', cardCvv: '123' }),
    );
    const titleOf = (payload: { name?: string }) => payload.name ?? '';

    const result = await decryptIdentityTrashTitles([trashRecord('a', 1)], 'key', titleOf);

    expect(result).toEqual([{ id: 'a', title: '张三', category: 'bank_card' }]);
    expect(JSON.stringify(result)).not.toContain('6222020000000000');
    expect(JSON.stringify(result)).not.toContain('123');
  });

  it('单条解密失败降级为 title=null / category 空串，不外抛', async () => {
    const { decryptIdentityTrashTitles } = await import('@/utils/storage/identityTrashManager');
    decryptData.mockImplementation(async (data: string) => {
      if (data === 'enc[bad]') throw new Error('decrypt boom');
      return JSON.stringify({ category: 'person', name: '李四' });
    });
    const titleOf = (payload: { name?: string }) => payload.name ?? '';

    const result = await decryptIdentityTrashTitles([trashRecord('bad', 1), trashRecord('ok', 2)], 'key', titleOf);

    expect(result).toEqual([
      { id: 'bad', title: null, category: '' },
      { id: 'ok', title: '李四', category: 'person' },
    ]);
  });
});
