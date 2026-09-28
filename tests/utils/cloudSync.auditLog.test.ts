import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  AUDIT_LOG_MAX_ENTRIES,
  appendAuditLog,
  clearAuditLog,
  getAuditLog,
  makeAuditEntry,
  sanitizeEntry,
} from '@/utils/cloudSync/auditLog';
import type { AuditEntry } from '@/utils/cloudSync/types';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * 审计日志测试（设计规格 §8、§14）
 *
 * 锁定：字段白名单（敏感字段被剥离）、FIFO 100 条淘汰、写入失败不阻断主流程
 * （返回 false 不抛错）、清空失败向上抛。
 */

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    at: 1000,
    provider: 'feishu',
    mode: 'encrypted',
    action: 'backup',
    docKey: 'doc-1',
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

describe('sanitizeEntry：字段白名单（安全硬约束）', () => {
  it('剥离误传的敏感字段（password/totp/username/token/payload）', () => {
    const dirty = {
      ...entry(),
      password: 'p@ssw0rd',
      totp: 'JBSWY3DPEHPK3PXP',
      username: 'alice',
      url: 'https://secret.example',
      remark: 'private note',
      token: 'access-token-value',
      payload: 'full-base64-blob',
    } as unknown as AuditEntry;
    const clean = sanitizeEntry(dirty);
    const serialized = JSON.stringify(clean);
    for (const secret of [
      'p@ssw0rd',
      'JBSWY3DPEHPK3PXP',
      'alice',
      'secret.example',
      'private note',
      'access-token-value',
      'full-base64-blob',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(Object.keys(clean).sort()).toEqual(['action', 'at', 'docKey', 'mode', 'provider']);
  });

  it('非法 provider/mode 回退安全默认（feishu/encrypted）', () => {
    const clean = sanitizeEntry(entry({ provider: 'xxx' as never, mode: undefined as never }));
    expect(clean.provider).toBe('feishu');
    expect(clean.mode).toBe('encrypted');
  });

  it('at 非有限数回退 Date.now()', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5000);
    try {
      expect(sanitizeEntry(entry({ at: Number.NaN })).at).toBe(5000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('docKey 非字符串回退空串，超长截断至 200', () => {
    expect(sanitizeEntry(entry({ docKey: 123 as never })).docKey).toBe('');
    expect(sanitizeEntry(entry({ docKey: 'k'.repeat(300) })).docKey.length).toBe(200);
  });

  it('stats 仅保留白名单键且值须为有限数字；全非法时省略 stats 键', () => {
    const clean = sanitizeEntry(entry({ stats: { created: 2, failed: 1, hacked: 9, skipped: Number.NaN } as never }));
    expect(clean.stats).toEqual({ created: 2, failed: 1 });

    const allInvalid = sanitizeEntry(entry({ stats: { hacked: 1 } as never }));
    expect('stats' in allInvalid).toBe(false);
  });

  it('recordIds/conflictIds 过滤非字符串并截断至 20 个', () => {
    const clean = sanitizeEntry(
      entry({
        recordIds: [...Array.from({ length: 25 }, (_, i) => `r${i}`), 42 as never],
        conflictIds: ['c1', null as never, 'c2'],
      }),
    );
    expect(clean.recordIds).toHaveLength(20);
    expect(clean.recordIds?.[0]).toBe('r0');
    expect(clean.conflictIds).toEqual(['c1', 'c2']);
  });

  it('error 仅保留 kind/code/message，message 截断至 200，code 为 undefined 时省略', () => {
    const clean = sanitizeEntry(
      entry({ error: { kind: 'network', code: undefined, message: 'm'.repeat(300), extra: 'x' } as never }),
    );
    expect(clean.error).toEqual({ kind: 'network', message: 'm'.repeat(200) });
  });
});

describe('makeAuditEntry：工厂', () => {
  it('extra 中夹带的敏感字段同样被剥离', () => {
    const made = makeAuditEntry('tencent', 'plaintext', 'sync', 'doc-2', {
      stats: { created: 1 },
      password: 'leak-me',
    } as never);
    expect(made.provider).toBe('tencent');
    expect(made.mode).toBe('plaintext');
    expect(made.action).toBe('sync');
    expect(made.stats).toEqual({ created: 1 });
    expect(JSON.stringify(made)).not.toContain('leak-me');
  });
});

describe('appendAuditLog / getAuditLog：持久化与 FIFO', () => {
  it('追加后可读回，写入 storage.local 独立键', async () => {
    expect(await appendAuditLog(entry())).toBe(true);
    const log = await getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].docKey).toBe('doc-1');
    const stored = await fakeBrowser.storage.local.get(STORAGE_KEYS.CLOUD_SYNC_AUDIT_LOG);
    expect(Array.isArray(stored[STORAGE_KEYS.CLOUD_SYNC_AUDIT_LOG])).toBe(true);
  });

  it(`超过 ${AUDIT_LOG_MAX_ENTRIES} 条时 FIFO 淘汰最早记录`, async () => {
    for (let i = 0; i < AUDIT_LOG_MAX_ENTRIES; i++) {
      await appendAuditLog(entry({ docKey: `doc-${i}` }));
    }
    await appendAuditLog(entry({ docKey: 'newest' }));
    const log = await getAuditLog();
    expect(log).toHaveLength(AUDIT_LOG_MAX_ENTRIES);
    expect(log[0].docKey).toBe('doc-1'); // doc-0 被淘汰
    expect(log[AUDIT_LOG_MAX_ENTRIES - 1].docKey).toBe('newest');
  });

  it('存储中为非数组脏数据时 getAuditLog 降级为空数组', async () => {
    await fakeBrowser.storage.local.set({ [STORAGE_KEYS.CLOUD_SYNC_AUDIT_LOG]: 'garbage' });
    expect(await getAuditLog()).toEqual([]);
  });

  it('写入失败返回 false 不抛错（不阻断同步主流程）', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValueOnce(new Error('QuotaExceeded'));
    await expect(appendAuditLog(entry())).resolves.toBe(false);
  });

  it('读取失败时 getAuditLog 返回空数组不抛错', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(new Error('IO'));
    await expect(getAuditLog()).resolves.toEqual([]);
  });
});

describe('clearAuditLog', () => {
  it('清空后读取为空数组', async () => {
    await appendAuditLog(entry());
    await clearAuditLog();
    expect(await getAuditLog()).toEqual([]);
  });

  it('清空失败向上抛出（与 append 的吞错语义不同）', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'remove').mockRejectedValueOnce(new Error('IO'));
    await expect(clearAuditLog()).rejects.toThrow('IO');
  });
});
