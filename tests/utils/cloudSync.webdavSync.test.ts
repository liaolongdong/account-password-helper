import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { getDefaultCloudSyncConfig, saveCloudSyncConfig } from '@/utils/cloudSync/configStore';
import { loadEncryptedMeta } from '@/utils/cloudSync/snapshotStore';
import { encryptToSingleFile } from '@/utils/cloudSync/cryptoSnapshot';
import { getAllGroups } from '@/utils/storage/groupManager';
import type { WebDavTarget } from '@/utils/cloudSync/types';
import type { PasswordGroup } from '@/utils/types';

/**
 * WebDAV 编排测试（WebDAV 规格 §6、§9）
 *
 * mock 面：WebDavAdapter（内存文件系统模拟）、passwordCrud、credentialStore、
 * taskLock、appendAuditLog；configStore/snapshotStore/cryptoSnapshot/runContext
 * 用真实实现（fakeBrowser 提供 storage 桩，Node 原生 Web Crypto）。
 */

const h = vi.hoisted(() => {
  interface FakeFile {
    name: string;
    content: string;
  }
  const state = {
    files: [] as FakeFile[],
    deleted: [] as string[],
    ensureCalls: 0,
    putError: null as unknown,
    deleteError: null as unknown,
    listError: null as unknown,
    dirUrl: 'https://dav.example.com/dav/',
    backupDirUrl: 'https://dav.example.com/dav/aph-backup/',
  };

  class FakeWebDavAdapter {
    readonly provider = 'webdav' as const;
    readonly backupDirUrl = state.backupDirUrl;
    constructor(init: { dirUrl: string }) {
      state.dirUrl = init.dirUrl;
    }
    async testConnection(): Promise<void> {}
    async ensureDirectory(): Promise<boolean> {
      state.ensureCalls += 1;
      return false;
    }
    async listFiles() {
      if (state.listError) throw state.listError;
      return state.files.map(file => ({
        name: file.name,
        url: `${state.backupDirUrl}${encodeURIComponent(file.name)}`,
        size: file.content.length,
      }));
    }
    async putFile(name: string, content: string): Promise<void> {
      if (state.putError) throw state.putError;
      state.files.push({ name, content });
    }
    async getFile(url: string): Promise<string> {
      const name = decodeURIComponent(url.slice(state.backupDirUrl.length));
      const file = state.files.find(candidate => candidate.name === name);
      if (!file) throw Object.assign(new Error('not found'), { kind: 'notFound', name: 'CloudSyncError' });
      return file.content;
    }
    async deleteFile(url: string): Promise<void> {
      if (state.deleteError) throw state.deleteError;
      const name = decodeURIComponent(url.slice(state.backupDirUrl.length));
      state.deleted.push(name);
      state.files = state.files.filter(file => file.name !== name);
    }
  }

  return {
    state,
    FakeWebDavAdapter,
    releaseMock: vi.fn(),
    acquireTaskLockMock: vi.fn(),
    loadCredentialsMock: vi.fn(),
    getAllPasswordsMock: vi.fn(),
    savePasswordMock: vi.fn(),
    updatePasswordMock: vi.fn(),
    appendAuditLogMock: vi.fn(),
  };
});

vi.mock('@/utils/cloudSync/adapters/webdav', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/cloudSync/adapters/webdav')>();
  return { ...actual, WebDavAdapter: h.FakeWebDavAdapter };
});
vi.mock('@/utils/cloudSync/taskLock', () => ({ acquireTaskLock: h.acquireTaskLockMock, isTargetLocked: vi.fn() }));
vi.mock('@/utils/cloudSync/credentialStore', () => ({ loadCredentials: h.loadCredentialsMock }));
vi.mock('@/utils/storage/passwordCrud', () => ({
  getAllPasswords: h.getAllPasswordsMock,
  savePassword: h.savePasswordMock,
  updatePassword: h.updatePasswordMock,
}));
vi.mock('@/utils/cloudSync/auditLog', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/cloudSync/auditLog')>();
  return { ...actual, appendAuditLog: h.appendAuditLogMock };
});

import {
  buildSnapshotFileName,
  clearOldWebDavVersions,
  listWebDavVersions,
  prepareWebDavTarget,
  runWebDavBackup,
  runWebDavRestore,
} from '@/utils/cloudSync/webdavSync';

const MASTER = 'test-master-password';
const WEBDAV_CREDS = { username: 'dav-user', password: 'dav-pass' };

function webdavTarget(overrides: Partial<WebDavTarget> = {}): WebDavTarget {
  return {
    dirUrl: 'https://dav.example.com/dav/',
    backupDirUrl: 'https://dav.example.com/dav/aph-backup/',
    allowInsecure: false,
    ...overrides,
  };
}

async function setupWebdavConfig(target = webdavTarget(), keepVersions = 3) {
  const config = getDefaultCloudSyncConfig();
  config.keepVersions = keepVersions;
  config.providers.webdav = {
    configured: true,
    mode: 'encrypted',
    target,
    chunkSize: 48000,
    lastSyncAt: null,
  };
  await saveCloudSyncConfig(config);
}

/** 预置一个云端快照文件（真实加密，可被恢复流程解密） */
async function seedCloudSnapshot(
  fileName: string,
  entries: ReturnType<typeof makePasswordEntry>[],
  groups: PasswordGroup[] = [],
): Promise<void> {
  const snapshot = await encryptToSingleFile(entries, MASTER, 5000, groups);
  h.state.files.push({ name: fileName, content: JSON.stringify(snapshot) });
}

beforeEach(async () => {
  fakeBrowser.reset();
  h.state.files = [];
  h.state.deleted = [];
  h.state.ensureCalls = 0;
  h.state.putError = null;
  h.state.deleteError = null;
  h.state.listError = null;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  h.releaseMock.mockReset();
  h.acquireTaskLockMock.mockReset();
  h.acquireTaskLockMock.mockResolvedValue({
    ok: true,
    handle: { targetKey: 'k', release: h.releaseMock },
    preempted: false,
  });
  h.loadCredentialsMock.mockReset();
  h.loadCredentialsMock.mockResolvedValue({ status: 'ok', credentials: WEBDAV_CREDS });
  h.getAllPasswordsMock.mockReset();
  h.getAllPasswordsMock.mockResolvedValue([]);
  h.savePasswordMock.mockReset();
  h.savePasswordMock.mockImplementation(async (entry: Record<string, unknown>) => ({
    ...entry,
    id: `saved-${Math.random().toString(36).slice(2, 8)}`,
  }));
  h.updatePasswordMock.mockReset();
  h.updatePasswordMock.mockResolvedValue(undefined);
  h.appendAuditLogMock.mockReset();
  h.appendAuditLogMock.mockResolvedValue(true);

  await fakeBrowser.storage.local.set({
    [STORAGE_KEYS.MASTER_PASSWORD]: { hashedPassword: 'x', salt: 'webdav-sync-test-salt' },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildSnapshotFileName：文件命名（规格 §5.3）', () => {
  it('aph-<UTC 14 位时间戳>-<6 位随机>.aphdav', () => {
    const name = buildSnapshotFileName(new Date(Date.UTC(2026, 8, 24, 10, 15, 30)));
    expect(name).toMatch(/^aph-20260924101530-[a-z0-9]{6}\.aphdav$/);
  });

  it('两次生成不重名（随机后缀）', () => {
    const now = new Date();
    expect(buildSnapshotFileName(now)).not.toBe(buildSnapshotFileName(now));
  });
});

describe('prepareWebDavTarget', () => {
  it('成功：ensureDirectory + 回写 configured/target + 审计 prepareTarget', async () => {
    const result = await prepareWebDavTarget(WEBDAV_CREDS, 'https://dav.example.com/dav/');
    expect(result.provider).toBe('webdav');
    expect(result.backupDirUrl).toBe('https://dav.example.com/dav/aph-backup/');
    expect(h.state.ensureCalls).toBe(1);
    expect(h.appendAuditLogMock).toHaveBeenCalled();
    const entry = h.appendAuditLogMock.mock.calls[0][0] as { action: string; provider: string };
    expect(entry.action).toBe('prepareTarget');
    expect(entry.provider).toBe('webdav');
  });

  it('http 内网未确认 → 抛 notFound（安全门不信任 UI）', async () => {
    await expect(prepareWebDavTarget(WEBDAV_CREDS, 'http://192.168.1.5/dav/')).rejects.toMatchObject({
      kind: 'notFound',
    });
  });

  it('http 内网 + allowInsecure → 成功且 target.allowInsecure=true 回写', async () => {
    const result = await prepareWebDavTarget(WEBDAV_CREDS, 'http://192.168.1.5/dav/', { allowInsecure: true });
    expect(result.target.allowInsecure).toBe(true);
    const { getCloudSyncConfig } = await import('@/utils/cloudSync/configStore');
    const config = await getCloudSyncConfig();
    expect(config.providers.webdav.configured).toBe(true);
    expect((config.providers.webdav.target as WebDavTarget).allowInsecure).toBe(true);
  });
});

describe('runWebDavBackup（规格 §6.3）', () => {
  it('成功：PUT 单文件 + meta 记录文件名 + stats.created=1 + 释放锁', async () => {
    await setupWebdavConfig();
    h.getAllPasswordsMock.mockResolvedValue([makePasswordEntry({ id: 'a' })]);

    const report = await runWebDavBackup(MASTER);
    expect(report.provider).toBe('webdav');
    expect(report.mode).toBe('encrypted');
    expect(report.stats.created).toBe(1);
    expect(report.cancelled).toBe(false);
    expect(h.state.files).toHaveLength(1);
    expect(h.state.files[0].name).toMatch(/^aph-\d{14}-[a-z0-9]{6}\.aphdav$/);

    const meta = await loadEncryptedMeta('webdav', h.state.backupDirUrl);
    expect(meta?.snapshotGroupId).toBe(h.state.files[0].name);
    expect(meta?.totalParts).toBe(1);
    expect(h.releaseMock).toHaveBeenCalled();
  });

  it('超保留数清理：keepVersions=3 时 5 版删 2（删最旧）', async () => {
    await setupWebdavConfig(webdavTarget(), 3);
    // 预置 4 个旧版本（2025 年时间戳，确保早于本次备份），本次备份产生第 5 个
    for (const stamp of ['20250101000000', '20250201000000', '20250301000000', '20250401000000']) {
      h.state.files.push({ name: `aph-${stamp}-aaaaaa.aphdav`, content: 'old' });
    }
    h.getAllPasswordsMock.mockResolvedValue([makePasswordEntry({ id: 'a' })]);

    const report = await runWebDavBackup(MASTER);
    expect(report.stats.deleted).toBe(2);
    expect(h.state.deleted.sort()).toEqual(['aph-20250101000000-aaaaaa.aphdav', 'aph-20250201000000-aaaaaa.aphdav']);
    expect(h.state.files).toHaveLength(3);
  });

  it('清理失败不回滚备份：deleteFile 抛错 → failures 记录，meta 已写', async () => {
    await setupWebdavConfig(webdavTarget(), 1);
    h.state.files.push({ name: 'aph-20260101000000-aaaaaa.aphdav', content: 'old' });
    h.getAllPasswordsMock.mockResolvedValue([makePasswordEntry({ id: 'a' })]);
    h.state.deleteError = new Error('server gone');

    const report = await runWebDavBackup(MASTER);
    expect(report.stats.created).toBe(1); // 备份本身成功
    expect(report.failures.length).toBeGreaterThanOrEqual(1);
    const meta = await loadEncryptedMeta('webdav', h.state.backupDirUrl);
    expect(meta).not.toBeNull();
  });

  it('allowInsecure → 报告含 insecureTransport 警告', async () => {
    await setupWebdavConfig(
      webdavTarget({
        dirUrl: 'http://192.168.1.5/dav/',
        backupDirUrl: 'http://192.168.1.5/dav/aph-backup/',
        allowInsecure: true,
      }),
    );
    const report = await runWebDavBackup(MASTER);
    expect(report.warnings.some(w => w.key === 'cloudSync.warning.insecureTransport')).toBe(true);
  });

  it('锁占用 → writeConflict 且不释放他人锁', async () => {
    await setupWebdavConfig();
    h.acquireTaskLockMock.mockResolvedValue({ ok: false, reason: 'busy', heartbeatAt: 0 });
    await expect(runWebDavBackup(MASTER)).rejects.toMatchObject({ kind: 'writeConflict' });
    expect(h.releaseMock).not.toHaveBeenCalled();
  });

  it('凭证四态 empty/locked/corrupted → invalidCredential', async () => {
    await setupWebdavConfig();
    for (const status of ['empty', 'locked', 'corrupted'] as const) {
      h.loadCredentialsMock.mockResolvedValue({ status });
      await expect(runWebDavBackup(MASTER)).rejects.toMatchObject({ kind: 'invalidCredential' });
    }
  });

  it('取消（signal 已 abort）→ 请求层抛 aborted → cancelled=true 仍释放锁', async () => {
    await setupWebdavConfig();
    const controller = new AbortController();
    controller.abort();
    // FakeAdapter 不检查 signal；用 putError 模拟请求层 abort 错误
    h.state.putError = Object.assign(new Error('aborted'), { kind: 'aborted', name: 'CloudSyncError' });
    const { CloudSyncError } = await import('@/utils/cloudSync/errors');
    h.state.putError = new CloudSyncError('aborted', 'aborted');

    const report = await runWebDavBackup(MASTER, { signal: controller.signal });
    expect(report.cancelled).toBe(true);
    expect(h.releaseMock).toHaveBeenCalled();
  });

  it('审计失败 → auditLogFailed 警告，备份仍成功', async () => {
    await setupWebdavConfig();
    h.appendAuditLogMock.mockResolvedValue(false);
    const report = await runWebDavBackup(MASTER);
    expect(report.stats.created).toBe(1);
    expect(report.warnings.some(w => w.key === 'cloudSync.warning.auditLogFailed')).toBe(true);
  });

  it('PUT 失败 → 抛领域错误 + failures 记录 + 释放锁', async () => {
    await setupWebdavConfig();
    const { CloudSyncError } = await import('@/utils/cloudSync/errors');
    h.state.putError = new CloudSyncError('tooLarge', 'payload too large', 413);
    await expect(runWebDavBackup(MASTER)).rejects.toMatchObject({ kind: 'tooLarge' });
    expect(h.releaseMock).toHaveBeenCalled();
  });
});

describe('runWebDavRestore（规格 §6.4）', () => {
  it('增量合并三分支：本地无→added；云端新→updated；本地新→skipped；绝不删除本地', async () => {
    await setupWebdavConfig();
    await seedCloudSnapshot('aph-20260924101530-aaaaaa.aphdav', [
      makePasswordEntry({ id: 'new-one', username: 'cloud-new', updateTime: 5000 }),
      makePasswordEntry({ id: 'both', username: 'cloud-ver', updateTime: 9000 }),
      makePasswordEntry({ id: 'local-newer', username: 'cloud-old', updateTime: 1000 }),
    ]);
    h.getAllPasswordsMock.mockResolvedValue([
      makePasswordEntry({ id: 'both', username: 'local-ver', updateTime: 1000 }),
      makePasswordEntry({ id: 'local-newer', username: 'local-fresh', updateTime: 9999 }),
    ]);

    const report = await runWebDavRestore(MASTER);
    expect(report.restore).toEqual({ added: 1, updated: 1, skipped: 1, rejected: 0 });
    expect(h.savePasswordMock).toHaveBeenCalledTimes(1);
    expect(h.updatePasswordMock).toHaveBeenCalledTimes(1);
    expect(h.releaseMock).toHaveBeenCalled();
  });

  it('versionName 指定版本恢复；不存在 → notFound', async () => {
    await setupWebdavConfig();
    await seedCloudSnapshot('aph-20260101000000-aaaaaa.aphdav', [makePasswordEntry({ id: 'v1', username: 'from-v1' })]);
    await seedCloudSnapshot('aph-20260901000000-bbbbbb.aphdav', [makePasswordEntry({ id: 'v2', username: 'from-v2' })]);

    const report = await runWebDavRestore(MASTER, { versionName: 'aph-20260101000000-aaaaaa.aphdav' });
    expect(report.restore?.added).toBe(1);
    expect(h.savePasswordMock.mock.calls[0][0]).toMatchObject({ username: 'from-v1' });

    await expect(runWebDavRestore(MASTER, { versionName: 'aph-missing.aphdav' })).rejects.toMatchObject({
      kind: 'notFound',
    });
  });

  it('未指定时 meta 文件名匹配优先于最新', async () => {
    await setupWebdavConfig();
    await seedCloudSnapshot('aph-20260101000000-aaaaaa.aphdav', [
      makePasswordEntry({ id: 'meta-pick', username: 'from-meta' }),
    ]);
    await seedCloudSnapshot('aph-20260901000000-bbbbbb.aphdav', [
      makePasswordEntry({ id: 'latest', username: 'from-latest' }),
    ]);
    // meta 指向旧版本
    const { saveEncryptedMeta } = await import('@/utils/cloudSync/snapshotStore');
    await saveEncryptedMeta({
      provider: 'webdav',
      docKey: h.state.backupDirUrl,
      snapshotGroupId: 'aph-20260101000000-aaaaaa.aphdav',
      snapshotHash: 'x',
      exportedAt: 1,
      totalParts: 1,
    });

    const report = await runWebDavRestore(MASTER);
    expect(report.restore?.added).toBe(1);
    expect(h.savePasswordMock.mock.calls[0][0]).toMatchObject({ username: 'from-meta' });
  });

  it('meta 缺失 → 取最新版本', async () => {
    await setupWebdavConfig();
    await seedCloudSnapshot('aph-20260101000000-aaaaaa.aphdav', [
      makePasswordEntry({ id: 'old', username: 'from-old' }),
    ]);
    await seedCloudSnapshot('aph-20260901000000-bbbbbb.aphdav', [
      makePasswordEntry({ id: 'new', username: 'from-new' }),
    ]);

    const report = await runWebDavRestore(MASTER);
    expect(report.restore?.added).toBe(1);
    expect(h.savePasswordMock.mock.calls[0][0]).toMatchObject({ username: 'from-new' });
  });

  it('恢复时合并快照分组树，并把条目 groupId 重映射到本地 code', async () => {
    await setupWebdavConfig();
    await seedCloudSnapshot(
      'aph-20260924101530-grouped.aphdav',
      [makePasswordEntry({ id: 'grouped', username: 'grouped', updateTime: 5000, groupId: 'remote-project' })],
      [
        { code: 'remote-work', name: '工作', parentCode: '-1', order: 0 },
        { code: 'remote-project', name: '项目A', parentCode: 'remote-work', order: 0 },
      ],
    );
    h.getAllPasswordsMock.mockResolvedValue([]);

    await runWebDavRestore(MASTER);

    const groups = await getAllGroups();
    const project = groups.find(group => group.name === '项目A');
    expect(groups.map(group => group.name)).toEqual(['工作', '项目A']);
    expect(h.savePasswordMock.mock.calls[0][0]).toMatchObject({ groupId: project?.code });
  });

  it('列表为空 → notFound', async () => {
    await setupWebdavConfig();
    await expect(runWebDavRestore(MASTER)).rejects.toMatchObject({ kind: 'notFound' });
    expect(h.releaseMock).toHaveBeenCalled();
  });

  it('快照被篡改（hash 不匹配）→ schema 错误，拒绝恢复', async () => {
    await setupWebdavConfig();
    await seedCloudSnapshot('aph-20260924101530-aaaaaa.aphdav', [makePasswordEntry({ id: 'a' })]);
    const file = h.state.files[0];
    const parsed = JSON.parse(file.content) as { snapshotHash: string };
    parsed.snapshotHash = 'f'.repeat(64);
    file.content = JSON.stringify(parsed);

    await expect(runWebDavRestore(MASTER)).rejects.toMatchObject({ kind: 'schema' });
    expect(h.savePasswordMock).not.toHaveBeenCalled();
  });

  it('错误主密码（rekey 后）→ schema 错误（decryptFailed）', async () => {
    await setupWebdavConfig();
    await seedCloudSnapshot('aph-20260924101530-aaaaaa.aphdav', [makePasswordEntry({ id: 'a' })]);
    await expect(runWebDavRestore('wrong-password')).rejects.toMatchObject({ kind: 'schema' });
  });
});

describe('listWebDavVersions', () => {
  it('按文件名时间戳降序；解析失败排最后', async () => {
    await setupWebdavConfig();
    h.state.files = [
      { name: 'aph-20260101000000-aaaaaa.aphdav', content: 'x' },
      { name: 'aph-notatimestamp-bbbbbb.aphdav', content: 'x' },
      { name: 'aph-20260901000000-cccccc.aphdav', content: 'x' },
    ];
    const versions = await listWebDavVersions();
    expect(versions.map(v => v.name)).toEqual([
      'aph-20260901000000-cccccc.aphdav',
      'aph-20260101000000-aaaaaa.aphdav',
      'aph-notatimestamp-bbbbbb.aphdav',
    ]);
    expect(versions[0].exportedAt).toBe(Date.UTC(2026, 8, 1));
    expect(versions[2].exportedAt).toBe(0);
  });
});

describe('clearOldWebDavVersions', () => {
  it('保留最近 keepVersions 个，删除其余；无需主密码', async () => {
    // keepVersions 必须取配置白名单 [1,3,5,10] 中的值，否则归一化回退默认 3
    await setupWebdavConfig(webdavTarget(), 1);
    for (const stamp of ['20260101000000', '20260201000000', '20260301000000']) {
      h.state.files.push({ name: `aph-${stamp}-aaaaaa.aphdav`, content: 'old' });
    }
    const report = await clearOldWebDavVersions();
    expect(report.stats.deleted).toBe(2);
    expect(h.state.deleted.sort()).toEqual(['aph-20260101000000-aaaaaa.aphdav', 'aph-20260201000000-aaaaaa.aphdav']);
    expect(h.state.files).toHaveLength(1);
    expect(h.state.files[0].name).toBe('aph-20260301000000-aaaaaa.aphdav');
    expect(h.releaseMock).toHaveBeenCalled();
  });

  it('锁占用 → writeConflict', async () => {
    await setupWebdavConfig();
    h.acquireTaskLockMock.mockResolvedValue({ ok: false, reason: 'busy', heartbeatAt: 0 });
    await expect(clearOldWebDavVersions()).rejects.toMatchObject({ kind: 'writeConflict' });
  });
});
