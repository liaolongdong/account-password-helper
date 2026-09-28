import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  encryptToSingleFile,
  parseSnapshotPayload,
  verifyAndDecryptSingleFile,
} from '@/utils/cloudSync/cryptoSnapshot';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import type { PasswordGroup } from '@/utils/types';

/**
 * WebDAV 单文件密文快照测试（WebDAV 规格 §5、§9）
 *
 * 锁定：加密解密往返、恢复校验链的每个拒绝分支（version/blob/exportedAt/
 * snapshotHash/GCM）、非法条目跳过计数、order 剔除。
 * 加解密走真实 utils/encryption（PBKDF2 600k + AES-GCM，Node 原生 Web Crypto）。
 */

const MASTER = 'test-master-password';

beforeEach(async () => {
  fakeBrowser.reset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await fakeBrowser.storage.local.set({
    [STORAGE_KEYS.MASTER_PASSWORD]: { hashedPassword: 'x', salt: 'webdav-test-salt' },
  });
});

describe('encryptToSingleFile：格式与元数据', () => {
  it('产出 version=1、count、exportedAt、snapshotHash、blob', async () => {
    const entries = [makePasswordEntry({ id: 'a', username: 'u1' }), makePasswordEntry({ id: 'b' })];
    const file = await encryptToSingleFile(entries, MASTER, 5000);
    expect(file.version).toBe(1);
    expect(file.count).toBe(2);
    expect(file.exportedAt).toBe(5000);
    expect(file.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof file.blob).toBe('string');
    expect(file.blob.length).toBeGreaterThan(0);
  });

  it('相同输入两次加密 blob 不同（随机 IV），但都可解密', async () => {
    const entries = [makePasswordEntry({ id: 'a' })];
    const f1 = await encryptToSingleFile(entries, MASTER, 1000);
    const f2 = await encryptToSingleFile(entries, MASTER, 1000);
    expect(f1.blob).not.toBe(f2.blob);
    expect((await verifyAndDecryptSingleFile(f1, MASTER)).ok).toBe(true);
    expect((await verifyAndDecryptSingleFile(f2, MASTER)).ok).toBe(true);
  });

  it('分组树随密文载荷往返，旧快照缺失 groups 时兼容为空数组', async () => {
    const groups: PasswordGroup[] = [
      { code: 'work', name: '工作', parentCode: '-1', order: 0 },
      { code: 'project', name: '项目A', parentCode: 'work', order: 0 },
    ];
    const file = await encryptToSingleFile([makePasswordEntry({ id: 'a', groupId: 'project' })], MASTER, 5000, groups);
    const result = await verifyAndDecryptSingleFile(file, MASTER);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.groups).toEqual(groups);

    const legacy = parseSnapshotPayload({ version: 1, exportedAt: 1, count: 0, entries: [] });
    expect(legacy?.groups).toEqual([]);
  });
});

describe('verifyAndDecryptSingleFile：恢复校验链', () => {
  it('往返：解密还原全部条目，原始 order 不进密文（恢复后归一化为 0）', async () => {
    // order 为本地 UX 状态，不参与备份：输入非零 order，恢复后应被归一化为 0
    const entries = [
      makePasswordEntry({ id: 'a', username: 'u1', order: 7 }),
      makePasswordEntry({ id: 'b', order: 3 }),
    ];
    const file = await encryptToSingleFile(entries, MASTER, 5000);
    const result = await verifyAndDecryptSingleFile(JSON.parse(JSON.stringify(file)), MASTER);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.entries.map(e => e.id)).toEqual(['a', 'b']);
      expect(result.payload.entries[0].username).toBe('u1');
      // 类型层面 entries 为 Omit<PasswordEntry,'order'>；运行时原始 order 值（7/3）不得出现
      const serialized = JSON.stringify(result.payload.entries);
      expect(serialized).not.toContain('"order":7');
      expect(serialized).not.toContain('"order":3');
      expect(result.payload.exportedAt).toBe(5000);
    }
  });

  it('snapshotHash 篡改 → snapshotHashMismatch', async () => {
    const file = await encryptToSingleFile([makePasswordEntry()], MASTER);
    expect(await verifyAndDecryptSingleFile({ ...file, snapshotHash: 'f'.repeat(64) }, MASTER)).toEqual({
      ok: false,
      reason: 'snapshotHashMismatch',
    });
  });

  it('blob 篡改（hash 不再匹配）→ snapshotHashMismatch', async () => {
    const file = await encryptToSingleFile([makePasswordEntry()], MASTER);
    const tampered = file.blob.slice(0, -4) + (file.blob.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(await verifyAndDecryptSingleFile({ ...file, blob: tampered }, MASTER)).toEqual({
      ok: false,
      reason: 'snapshotHashMismatch',
    });
  });

  it('错误主密码（rekey 场景）→ decryptFailed', async () => {
    const file = await encryptToSingleFile([makePasswordEntry()], MASTER);
    expect(await verifyAndDecryptSingleFile(file, 'wrong-password')).toEqual({ ok: false, reason: 'decryptFailed' });
  });

  it('version 不符 → invalidPayload（不猜测旧/新格式）', async () => {
    const file = await encryptToSingleFile([makePasswordEntry()], MASTER);
    expect(await verifyAndDecryptSingleFile({ ...file, version: 2 }, MASTER)).toEqual({
      ok: false,
      reason: 'invalidPayload',
    });
    expect(await verifyAndDecryptSingleFile({ ...file, version: undefined }, MASTER)).toEqual({
      ok: false,
      reason: 'invalidPayload',
    });
  });

  it('blob 空/非字符串 → invalidPayload', async () => {
    const file = await encryptToSingleFile([makePasswordEntry()], MASTER);
    expect(await verifyAndDecryptSingleFile({ ...file, blob: '' }, MASTER)).toEqual({
      ok: false,
      reason: 'invalidPayload',
    });
    expect(await verifyAndDecryptSingleFile({ ...file, blob: 123 }, MASTER)).toEqual({
      ok: false,
      reason: 'invalidPayload',
    });
  });

  it('exportedAt 非有限数 → invalidPayload', async () => {
    const file = await encryptToSingleFile([makePasswordEntry()], MASTER);
    expect(await verifyAndDecryptSingleFile({ ...file, exportedAt: Number.NaN }, MASTER)).toEqual({
      ok: false,
      reason: 'invalidPayload',
    });
  });

  it('非对象输入（字符串/null/数组）→ invalidPayload', async () => {
    expect(await verifyAndDecryptSingleFile('garbage', MASTER)).toEqual({ ok: false, reason: 'invalidPayload' });
    expect(await verifyAndDecryptSingleFile(null, MASTER)).toEqual({ ok: false, reason: 'invalidPayload' });
    expect(await verifyAndDecryptSingleFile([1, 2], MASTER)).toEqual({ ok: false, reason: 'invalidPayload' });
  });

  it('snapshotHash 缺失 → snapshotHashMismatch（typeof 校验）', async () => {
    const file = await encryptToSingleFile([makePasswordEntry()], MASTER);
    const { snapshotHash: _drop, ...noHash } = file;
    expect(await verifyAndDecryptSingleFile(noHash, MASTER)).toEqual({ ok: false, reason: 'snapshotHashMismatch' });
  });
});

describe('parseSnapshotPayload：不可信载荷逐条校验', () => {
  it('非法条目（空 id / null / 非对象）跳过，合法条目保留', () => {
    const parsed = parseSnapshotPayload({
      version: 1,
      exportedAt: 1,
      count: 3,
      entries: [{ id: 'ok', username: 'u' }, { id: '' }, null],
    });
    expect(parsed?.entries).toHaveLength(1);
    expect(parsed?.entries[0].id).toBe('ok');
    expect(parsed?.count).toBe(1);
  });

  it('缺失字段回退默认值，order 恒为 0', () => {
    const parsed = parseSnapshotPayload({ version: 1, exportedAt: 99, count: 1, entries: [{ id: 'x' }] });
    expect(parsed?.entries[0]).toEqual({
      id: 'x',
      username: '',
      password: '',
      url: '',
      tag: '',
      remark: '',
      totp: '',
      createTime: 99,
      updateTime: 99,
      order: 0,
    });
  });
});
