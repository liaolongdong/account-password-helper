import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  createEmptySnapshot,
  listSnapshotKeys,
  loadEncryptedMeta,
  loadSnapshot,
  removeSnapshot,
  saveEncryptedMeta,
  saveSnapshot,
  withEntries,
} from '@/utils/cloudSync/snapshotStore';
import type { EncryptedSnapshotMeta, SyncSnapshot } from '@/utils/cloudSync/types';
import { cloudSyncSnapshotKey } from '@/utils/storageKeys';

/**
 * 本地快照存取测试（设计规格 §6.1、§14）
 *
 * 锁定：多 provider/多文档键隔离、增量更新（withEntries 不改入参）、
 * 写入失败向上抛（供同步引擎终止并告警）、损坏数据降级为 null、全量重建枚举。
 */

function snapshot(overrides: Partial<SyncSnapshot> = {}): SyncSnapshot {
  return {
    provider: 'feishu',
    docKey: 'app:table',
    entries: { e1: { hash: 'h1', recordId: 'rec1', syncedAt: 1000 } },
    ...overrides,
  };
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadSnapshot / saveSnapshot：多文档隔离', () => {
  it('往返一致', async () => {
    await saveSnapshot(snapshot());
    expect(await loadSnapshot('feishu', 'app:table')).toEqual(snapshot());
  });

  it('不同 provider / 不同 docKey 各自独立，互不覆盖', async () => {
    await saveSnapshot(snapshot({ provider: 'feishu', docKey: 'a:1' }));
    await saveSnapshot(snapshot({ provider: 'tencent', docKey: 'f:s' }));
    await saveSnapshot(snapshot({ provider: 'feishu', docKey: 'a:2' }));

    const feishu1 = await loadSnapshot('feishu', 'a:1');
    const tencent = await loadSnapshot('tencent', 'f:s');
    const feishu2 = await loadSnapshot('feishu', 'a:2');
    expect(feishu1?.docKey).toBe('a:1');
    expect(tencent?.provider).toBe('tencent');
    expect(feishu2?.docKey).toBe('a:2');
    // 键名按 provider + docKey 拼接
    expect(cloudSyncSnapshotKey('feishu', 'a:1')).toBe('cloud_sync_snapshot_feishu_a:1');
  });

  it('不存在时返回 null（调用方据此降级）', async () => {
    expect(await loadSnapshot('feishu', 'missing')).toBeNull();
  });

  it('存储为损坏结构时返回 null', async () => {
    const key = cloudSyncSnapshotKey('feishu', 'bad');
    await fakeBrowser.storage.local.set({ [key]: { provider: 'feishu' } }); // 缺 entries
    expect(await loadSnapshot('feishu', 'bad')).toBeNull();
    await fakeBrowser.storage.local.set({ [key]: 'garbage' });
    expect(await loadSnapshot('feishu', 'bad')).toBeNull();
  });

  it('读取异常降级为 null 不抛错', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(new Error('IO'));
    await expect(loadSnapshot('feishu', 'x')).resolves.toBeNull();
  });

  it('写入失败向上抛出（同步引擎据此终止并告警）', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValueOnce(new Error('QuotaExceeded'));
    await expect(saveSnapshot(snapshot())).rejects.toThrow('QuotaExceeded');
  });
});

describe('removeSnapshot', () => {
  it('删除后读取为 null', async () => {
    await saveSnapshot(snapshot());
    await removeSnapshot('feishu', 'app:table');
    expect(await loadSnapshot('feishu', 'app:table')).toBeNull();
  });

  it('删除失败吞错不抛（清理入口属尽力而为）', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'remove').mockRejectedValueOnce(new Error('IO'));
    await expect(removeSnapshot('feishu', 'x')).resolves.toBeUndefined();
  });
});

describe('withEntries：增量更新（纯函数）', () => {
  it('新增与更新条目', () => {
    const base = snapshot();
    const next = withEntries(base, {
      e1: { hash: 'h1-new', recordId: 'rec1', syncedAt: 2000 },
      e2: { hash: 'h2', recordId: 'rec2', syncedAt: 2000 },
    });
    expect(next.entries.e1.hash).toBe('h1-new');
    expect(next.entries.e2.recordId).toBe('rec2');
  });

  it('value 为 null 时删除条目', () => {
    const next = withEntries(snapshot(), { e1: null });
    expect('e1' in next.entries).toBe(false);
  });

  it('返回新对象，不修改入参（便于调用方持有旧值回滚）', () => {
    const base = snapshot();
    const frozen = structuredClone(base);
    const next = withEntries(base, { e1: null });
    expect(base).toEqual(frozen);
    expect(next).not.toBe(base);
    expect(next.entries).not.toBe(base.entries);
  });
});

describe('createEmptySnapshot', () => {
  it('生成空 entries 的快照', () => {
    expect(createEmptySnapshot('tencent', 'f:s')).toEqual({ provider: 'tencent', docKey: 'f:s', entries: {} });
  });
});

describe('listSnapshotKeys：全量重建枚举', () => {
  it('仅返回快照前缀键，过滤其他业务键', async () => {
    await saveSnapshot(snapshot({ provider: 'feishu', docKey: 'a:1' }));
    await saveSnapshot(snapshot({ provider: 'tencent', docKey: 'f:s' }));
    await fakeBrowser.storage.local.set({ unrelated_key: 1, cloud_sync_config: {} });
    const keys = await listSnapshotKeys();
    expect(keys.sort()).toEqual(['cloud_sync_snapshot_feishu_a:1', 'cloud_sync_snapshot_tencent_f:s']);
  });

  it('枚举失败降级为空数组', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(new Error('IO'));
    await expect(listSnapshotKeys()).resolves.toEqual([]);
  });
});

describe('loadEncryptedMeta / saveEncryptedMeta：密文元数据', () => {
  const meta: EncryptedSnapshotMeta = {
    provider: 'feishu',
    docKey: 'app:table',
    snapshotGroupId: 'g-1',
    snapshotHash: 'hash-1',
    exportedAt: 1000,
    totalParts: 3,
  };

  it('往返一致，且与明文快照键分离', async () => {
    await saveEncryptedMeta(meta);
    expect(await loadEncryptedMeta('feishu', 'app:table')).toEqual(meta);
    // 明文快照键不受影响
    expect(await loadSnapshot('feishu', 'app:table')).toBeNull();
  });

  it('不存在或结构非法时返回 null', async () => {
    expect(await loadEncryptedMeta('feishu', 'missing')).toBeNull();
    await fakeBrowser.storage.local.set({ cloud_sync_encrypted_meta_feishu_bad: { provider: 'feishu' } });
    expect(await loadEncryptedMeta('feishu', 'bad')).toBeNull();
  });

  it('元数据绝不记录 Blob 内容或分片明文', async () => {
    await saveEncryptedMeta(meta);
    const stored = await fakeBrowser.storage.local.get('cloud_sync_encrypted_meta_feishu_app:table');
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain('payload');
    expect(Object.keys(meta).sort()).toEqual([
      'docKey',
      'exportedAt',
      'provider',
      'snapshotGroupId',
      'snapshotHash',
      'totalParts',
    ]);
  });
});
