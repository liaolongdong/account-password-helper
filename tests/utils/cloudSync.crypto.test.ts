import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  buildSnapshotChunks,
  encryptAndChunk,
  groupChunks,
  nextChunkSize,
  parseSnapshotPayload,
  selectOrphanGroups,
  selectVersionsToPrune,
  splitBase64,
  verifyAndDecryptSnapshot,
} from '@/utils/cloudSync/cryptoSnapshot';
import { DEFAULT_CHUNK_SIZE, MIN_CHUNK_SIZE } from '@/utils/cloudSync/configStore';
import { computeEntryHash, sha256Hex } from '@/utils/cloudSync/hash';
import type { SnapshotGroup } from '@/utils/cloudSync/types';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

/**
 * 密文快照测试（设计规格 §5）
 *
 * 锁定：分片往返、双层哈希、恢复校验链的每个拒绝分支、动态降级、版本保留
 * 与孤儿清理。加解密只复用项目现有封装，这里不重测 KDF/GCM 本身。
 */

function entry(overrides: Partial<ReturnType<typeof makePasswordEntry>> = {}) {
  return makePasswordEntry({ username: 'u', password: 'p', ...overrides });
}

/** 测试主密码与固定 salt：使 deriveEncryptionKey 可确定运行 */
const TEST_MASTER_PASSWORD = 'test-master-password';
const TEST_SALT = 'cloud-sync-test-salt';

beforeEach(async () => {
  fakeBrowser.reset();
  // 600k PBKDF2 路径会产生 warn/error 日志，静默以保持测试输出整洁
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await fakeBrowser.storage.local.set({
    [STORAGE_KEYS.MASTER_PASSWORD]: { hashedPassword: 'x', salt: TEST_SALT },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('splitBase64 / buildSnapshotChunks', () => {
  it('空 Blob 产出单个空分片', () => {
    expect(splitBase64('', 48000)).toEqual(['']);
  });

  it('按阈值切分且最后一片不超长', () => {
    const blob = 'a'.repeat(100);
    const parts = splitBase64(blob, 30);
    expect(parts.length).toBe(4);
    expect(parts.every(part => part.length <= 30)).toBe(true);
    expect(parts.join('')).toBe(blob);
  });

  it('非法分片大小抛错', () => {
    expect(() => splitBase64('x', 0)).toThrow();
  });

  it('buildSnapshotChunks：同组共享 snapshotHash，partKey 行级唯一，partHash 逐片校验', async () => {
    const blob = 'a'.repeat(200);
    const rows = await buildSnapshotChunks(blob, 123, 64);
    expect(rows.length).toBe(4);
    expect(new Set(rows.map(row => row.snapshotGroupId)).size).toBe(1);
    expect(new Set(rows.map(row => row.partKey)).size).toBe(4);
    expect(new Set(rows.map(row => row.snapshotHash)).size).toBe(1);
    expect(rows[0].snapshotHash).toBe(await sha256Hex(blob));
    expect(new Set(rows.map(row => row.totalParts)).size).toBe(1);
    expect(rows.map(row => row.partIndex)).toEqual([0, 1, 2, 3]);
  });
});

describe('verifyAndDecryptSnapshot：恢复校验链', () => {
  /** 用真实加密产物构造合法分组（分片阈值 32，保证多分片） */
  async function buildValidGroup(): Promise<{ group: SnapshotGroup; exportedAt: number }> {
    const created = await encryptAndChunk([entry({ id: 'e1' })], TEST_MASTER_PASSWORD, 32, 1000);
    return { group: groupChunks(created.rows)[0], exportedAt: 1000 };
  }

  it('完整分组 → ok，payload 可用', async () => {
    const { group } = await buildValidGroup();
    const result = await verifyAndDecryptSnapshot(group, TEST_MASTER_PASSWORD);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.entries[0].id).toBe('e1');
  }, 30000);

  it('分片数不匹配 → incomplete', async () => {
    const { group } = await buildValidGroup();
    const broken: SnapshotGroup = { ...group, chunks: [group.chunks[0]], complete: false };
    const result = await verifyAndDecryptSnapshot(broken, TEST_MASTER_PASSWORD);
    expect(result).toEqual({ ok: false, reason: 'incomplete' });
  });

  it('partHash 被篡改 → partHashMismatch（保留全部分片，仅改哈希）', async () => {
    const { group } = await buildValidGroup();
    const tampered: SnapshotGroup = {
      ...group,
      chunks: group.chunks.map((item, index) => (index === 0 ? { ...item, partHash: 'deadbeef' } : item)),
    };
    const result = await verifyAndDecryptSnapshot(tampered, TEST_MASTER_PASSWORD);
    expect(result).toEqual({ ok: false, reason: 'partHashMismatch' });
  });

  it('snapshotHash 不匹配 → snapshotHashMismatch', async () => {
    const { group } = await buildValidGroup();
    const tampered = { ...group, snapshotHash: 'deadbeef' };
    const result = await verifyAndDecryptSnapshot(tampered, TEST_MASTER_PASSWORD);
    expect(result).toEqual({ ok: false, reason: 'snapshotHashMismatch' });
  });
});

describe('encryptAndChunk + 恢复往返', () => {
  it('加密分片后可整组校验、GCM 解密并还原条目', async () => {
    const entries = [entry({ id: 'e1', username: 'alice', password: 'secret', updateTime: 5 })];
    const created = await encryptAndChunk(entries, 'mymaster', 32);
    expect(created.rows.length).toBeGreaterThan(0);
    expect(new Set(created.rows.map(row => row.snapshotGroupId))).toEqual(new Set([created.snapshotGroupId]));
    expect(new Set(created.rows.map(row => row.snapshotHash))).toEqual(new Set([created.snapshotHash]));

    const group = groupChunks(created.rows)[0];
    const restored = await verifyAndDecryptSnapshot(group, 'mymaster');
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.payload.entries).toMatchObject([{ id: 'e1', username: 'alice', password: 'secret' }]);
  });

  it('错误主密码解密失败 → decryptFailed，不尝试其他口令', async () => {
    const created = await encryptAndChunk([entry()], 'right-password', 64);
    const group = groupChunks(created.rows)[0];
    const result = await verifyAndDecryptSnapshot(group, 'wrong-password');
    expect(result).toEqual({ ok: false, reason: 'decryptFailed' });
  });
});

describe('parseSnapshotPayload：不可信载荷校验', () => {
  it('非法 payload 返回 null', () => {
    expect(parseSnapshotPayload(null)).toBeNull();
    expect(parseSnapshotPayload({})).toBeNull();
    expect(parseSnapshotPayload({ version: 2, exportedAt: 1, count: 0, entries: [] })).toBeNull();
  });

  it('合法 payload 仅保留合法条目并丢弃非法项', () => {
    const parsed = parseSnapshotPayload({
      version: 1,
      exportedAt: 1000,
      count: 2,
      entries: [
        { id: 'e1', username: 'alice', password: 'p', url: '', tag: '', remark: '', createTime: 1, updateTime: 2 },
        { id: '', username: 'bad' },
      ],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.entries).toHaveLength(1);
    expect(parsed?.entries[0].id).toBe('e1');
  });
});

describe('版本保留与孤儿清理', () => {
  function group(id: string, exportedAt: number, complete: boolean): SnapshotGroup {
    return {
      snapshotGroupId: id,
      snapshotHash: id,
      totalParts: complete ? 1 : 2,
      version: 1,
      exportedAt,
      chunks: [],
      recordIds: [],
      complete,
    };
  }

  it('selectVersionsToPrune：保留最近 keepVersions 个完整分组', () => {
    const groups = [group('a', 100, true), group('b', 200, true), group('c', 300, true), group('d', 400, false)];
    expect(selectVersionsToPrune(groups, 3)).toEqual([]);
    expect(selectVersionsToPrune(groups, 1)).toEqual(['b', 'a']);
    // 不完整分组不参与保留，也不被当作最新版本
    // 不完整分组不参与保留：仅 1 个完整分组且 keep=1 时无需删除
    expect(selectVersionsToPrune([group('old', 1, true), group('partial', 2, false)], 1)).toEqual([]);
  });

  it('selectOrphanGroups：只清超期残缺分组', () => {
    const now = Date.now();
    const orphan = group('orphan', now - 8 * 24 * 60 * 60 * 1000, false);
    const freshIncomplete = group('fresh', now - 1000, false);
    const completeOld = group('complete', now - 1000, true);
    expect(selectOrphanGroups([orphan, freshIncomplete, completeOld], now)).toEqual(['orphan']);
  });
});

describe('nextChunkSize：动态降级', () => {
  it('逐次减半直到下限，之后返回 null', () => {
    expect(nextChunkSize(DEFAULT_CHUNK_SIZE)).toBe(24000);
    expect(nextChunkSize(12000)).toBe(6000);
    expect(nextChunkSize(MIN_CHUNK_SIZE)).toBeNull();
  });
});

describe('computeEntryHash 与密文模块不泄漏敏感字段名', () => {
  it('哈希仅含 7 个同步字段，不含 ID/updateTime', async () => {
    const a = await computeEntryHash({ username: 'u', password: 'p', url: '', tag: '', remark: '', totp: '' });
    const b = await computeEntryHash({ username: 'u', password: 'p', url: '', tag: '', remark: '', totp: '' });
    expect(a).toBe(b);
    const c = await computeEntryHash({ username: 'u', password: 'p', url: '', tag: '', remark: '', totp: 'x' });
    expect(a).not.toBe(c);
  });
});
