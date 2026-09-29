import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { ENCRYPTED_FIELDS, PLAINTEXT_FIELDS } from '@/utils/cloudSync/schema';
import { getAllGroups } from '@/utils/storage/groupManager';
import { computeEntryHash } from '@/utils/cloudSync/hash';
import { encryptAndChunk } from '@/utils/cloudSync/cryptoSnapshot';
import { CloudSyncError } from '@/utils/cloudSync/errors';
import type { CloudRow, SnapshotChunkRow } from '@/utils/cloudSync/types';
import { getDefaultCloudSyncConfig, saveCloudSyncConfig } from '@/utils/cloudSync/configStore';
import { loadEncryptedMeta, loadSnapshot, saveSnapshot } from '@/utils/cloudSync/snapshotStore';

/**
 * 同步编排测试（设计规格 §2、§4.3、§5、§6、§14）
 *
 * 策略：网络适配器（FeishuAdapter/TencentAdapter）、本地密码库（passwordCrud）、
 * 回收站（trashManager）、凭证（credentialStore）、任务锁（taskLock）、审计写入
 * （appendAuditLog）从接缝 mock；configStore/snapshotStore/diff/hash/schema/
 * sanitize/cryptoSnapshot/urlParse 用真实实现（fakeBrowser 提供 storage 桩），
 * 以验证编排层与各模块的真实集成。
 */

// ==================== mock 接缝 ====================

const h = vi.hoisted(() => {
  interface FakeState {
    rows: unknown[];
    tables: { id: string; name: string }[];
    schemaResult: { ok: true } | { ok: false; missingFields: string[] };
    createTableId: string;
    testConnectionError: unknown;
    upsertResult: unknown;
    deleteResult: unknown;
    tooLargeFailures: number;
    upsertCalls: unknown[][];
    deleteCalls: string[][];
    getRowsCalls: number;
    /** 最近一次构造适配器时收到的飞书私有化地址（null 表示官方 SaaS） */
    lastAdapterBaseUrl: string | null;
    /** 最近一次构造适配器时收到的 HTTP 明文确认状态 */
    lastAdapterAllowInsecure: boolean;
  }
  const state: FakeState = {
    rows: [],
    tables: [],
    schemaResult: { ok: true },
    createTableId: 'tbl-created',
    testConnectionError: null,
    upsertResult: null,
    deleteResult: null,
    tooLargeFailures: 0,
    upsertCalls: [],
    deleteCalls: [],
    getRowsCalls: 0,
    lastAdapterBaseUrl: null,
    lastAdapterAllowInsecure: false,
  };

  class FakeAdapter {
    tableId: string | null;
    sheetId: string | null;
    provider: 'feishu' | 'tencent';
    private options: { onApiCall?: () => void };
    constructor(opts: {
      appToken?: string;
      tableId?: string | null;
      baseUrl?: string | null;
      allowInsecure?: boolean;
      fileId?: string;
      sheetId?: string | null;
      options?: { onApiCall?: () => void };
    }) {
      this.provider = opts.appToken !== undefined ? 'feishu' : 'tencent';
      this.tableId = opts.tableId ?? null;
      this.sheetId = opts.sheetId ?? null;
      this.options = opts.options ?? {};
      state.lastAdapterBaseUrl = opts.baseUrl ?? null;
      state.lastAdapterAllowInsecure = opts.allowInsecure === true;
    }
    private tick() {
      this.options.onApiCall?.();
    }
    async testConnection() {
      this.tick();
      if (state.testConnectionError) throw state.testConnectionError;
    }
    async listTables() {
      this.tick();
      return state.tables;
    }
    async createTable(spec: { name: string }) {
      this.tick();
      this.tableId = state.createTableId;
      this.sheetId = state.createTableId;
      return { id: state.createTableId, name: spec.name };
    }
    async checkTableSchema() {
      this.tick();
      return state.schemaResult;
    }
    async getRows() {
      this.tick();
      state.getRowsCalls += 1;
      return state.rows;
    }
    async batchUpsert(rows: { recordId: string; businessId: string }[]) {
      this.tick();
      state.upsertCalls.push(rows);
      if (state.tooLargeFailures > 0) {
        state.tooLargeFailures -= 1;
        return {
          succeeded: [],
          failed: rows.map(r => ({ businessId: r.businessId, code: 'tooLarge', message: 'TooLargeCell' })),
        };
      }
      if (state.upsertResult) return state.upsertResult;
      return {
        succeeded: rows.map((r, i) => ({ recordId: r.recordId || `rec-${i}`, businessId: r.businessId })),
        failed: [],
      };
    }
    async batchDelete(ids: string[]) {
      this.tick();
      state.deleteCalls.push(ids);
      if (state.deleteResult) return state.deleteResult;
      return { succeeded: ids.map(id => ({ recordId: id, businessId: '' })), failed: [] };
    }
    setTableId(id: string) {
      this.tableId = id;
    }
    setSheetId(id: string) {
      this.sheetId = id;
    }
  }

  return {
    state,
    FakeAdapter,
    releaseMock: vi.fn(),
    acquireTaskLockMock: vi.fn(),
    loadCredentialsMock: vi.fn(),
    getAllPasswordsMock: vi.fn(),
    savePasswordMock: vi.fn(),
    batchApplyPasswordChangesMock: vi.fn(),
    updatePasswordMock: vi.fn(),
    moveToTrashMock: vi.fn(),
    appendAuditLogMock: vi.fn(),
  };
});

// 保留真实模块的纯函数（normalizeFeishuBaseUrl 等），只替换适配器类
vi.mock('@/utils/cloudSync/adapters/feishu', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/cloudSync/adapters/feishu')>();
  return { ...actual, FeishuAdapter: h.FakeAdapter };
});
vi.mock('@/utils/cloudSync/adapters/tencent', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/cloudSync/adapters/tencent')>();
  return { ...actual, TencentAdapter: h.FakeAdapter };
});
vi.mock('@/utils/cloudSync/taskLock', () => ({ acquireTaskLock: h.acquireTaskLockMock, isTargetLocked: vi.fn() }));
vi.mock('@/utils/cloudSync/credentialStore', () => ({ loadCredentials: h.loadCredentialsMock }));
vi.mock('@/utils/storage/passwordCrud', () => ({
  getAllPasswords: h.getAllPasswordsMock,
  savePassword: h.savePasswordMock,
  batchApplyPasswordChanges: h.batchApplyPasswordChangesMock,
  updatePassword: h.updatePasswordMock,
}));
vi.mock('@/utils/storage/trashManager', () => ({ moveToTrash: h.moveToTrashMock }));
vi.mock('@/utils/cloudSync/auditLog', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/cloudSync/auditLog')>();
  return { ...actual, appendAuditLog: h.appendAuditLogMock };
});

import {
  chunksToUpsertRows,
  clearOldSnapshotVersions,
  prepareProviderTarget,
  rebuildSnapshot,
  rowsToChunks,
  runEncryptedBackup,
  runEncryptedRestore,
  runPlaintextSync,
} from '@/utils/cloudSync/syncEngine';

const TEST_MASTER_PASSWORD = 'test-master-password';
const FEISHU_CREDS = { appId: 'cli_test', appSecret: 'secret_test' };

// ==================== 夹具辅助 ====================

function resetState() {
  h.state.rows = [];
  h.state.tables = [];
  h.state.schemaResult = { ok: true };
  h.state.createTableId = 'tbl-created';
  h.state.testConnectionError = null;
  h.state.upsertResult = null;
  h.state.deleteResult = null;
  h.state.tooLargeFailures = 0;
  h.state.upsertCalls = [];
  h.state.deleteCalls = [];
  h.state.getRowsCalls = 0;
  h.state.lastAdapterBaseUrl = null;
  h.state.lastAdapterAllowInsecure = false;
}

async function setupConfig(
  provider: 'feishu' | 'tencent',
  mode: 'encrypted' | 'plaintext',
  overrides: Record<string, unknown> = {},
) {
  const config = getDefaultCloudSyncConfig();
  const target =
    provider === 'feishu'
      ? { appToken: 'app', tableId: 'tbl', fileUrl: null, baseUrl: null, allowInsecure: false }
      : { fileId: 'file', sheetId: 'sheet', fileUrl: null, baseUrl: null, allowInsecure: false };
  config.providers[provider] = { ...config.providers[provider], configured: true, mode, target, ...overrides } as never;
  await saveCloudSyncConfig(config);
}

function plaintextRow(fields: Partial<Record<string, string | number>>, overrides: Partial<CloudRow> = {}): CloudRow {
  return {
    recordId: 'rec1',
    fields: {
      [PLAINTEXT_FIELDS.username]: 'alice',
      [PLAINTEXT_FIELDS.password]: 'p1',
      [PLAINTEXT_FIELDS.url]: 'https://a.example',
      [PLAINTEXT_FIELDS.tag]: '',
      [PLAINTEXT_FIELDS.remark]: '',
      [PLAINTEXT_FIELDS.totp]: '',
      [PLAINTEXT_FIELDS.group]: '',
      [PLAINTEXT_FIELDS.localUpdateTime]: 1000,
      [PLAINTEXT_FIELDS.id]: 'e1',
      ...fields,
    },
    cloudModifiedAt: 1000,
    ...overrides,
  };
}

function chunkToRow(chunk: SnapshotChunkRow, recordId: string): CloudRow {
  return {
    recordId,
    fields: {
      [ENCRYPTED_FIELDS.partKey]: chunk.partKey,
      [ENCRYPTED_FIELDS.snapshotGroupId]: chunk.snapshotGroupId,
      [ENCRYPTED_FIELDS.partIndex]: chunk.partIndex,
      [ENCRYPTED_FIELDS.totalParts]: chunk.totalParts,
      [ENCRYPTED_FIELDS.snapshotHash]: chunk.snapshotHash,
      [ENCRYPTED_FIELDS.partHash]: chunk.partHash,
      [ENCRYPTED_FIELDS.payload]: chunk.payload,
      [ENCRYPTED_FIELDS.version]: chunk.version,
      [ENCRYPTED_FIELDS.exportedAt]: chunk.exportedAt,
    },
    cloudModifiedAt: chunk.exportedAt,
  };
}

function fakeChunk(groupId: string, exportedAt: number): SnapshotChunkRow {
  return {
    partKey: `${groupId}#0`,
    snapshotGroupId: groupId,
    partIndex: 0,
    totalParts: 1,
    snapshotHash: 'h',
    partHash: 'p',
    payload: 'x',
    version: 1,
    exportedAt,
  };
}

beforeEach(async () => {
  fakeBrowser.reset();
  resetState();
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
  h.loadCredentialsMock.mockResolvedValue({ status: 'ok', credentials: FEISHU_CREDS });
  h.getAllPasswordsMock.mockReset();
  h.getAllPasswordsMock.mockResolvedValue([]);
  h.savePasswordMock.mockReset();
  h.savePasswordMock.mockImplementation(async (entry: Record<string, unknown>) => ({
    ...entry,
    id: `saved-${Math.random().toString(36).slice(2, 8)}`,
  }));
  h.batchApplyPasswordChangesMock.mockReset();
  h.batchApplyPasswordChangesMock.mockImplementation(
    async (
      creates: Array<{ id?: string; entry: Record<string, unknown> }>,
      _updates: Array<{ id: string; updates: Record<string, unknown> }>,
    ) => ({
      created: creates.map((create, index) => ({
        ...create.entry,
        id: create.id ?? `saved-batch-${index}`,
        order: index,
      })),
    }),
  );
  h.updatePasswordMock.mockReset();
  h.updatePasswordMock.mockResolvedValue(undefined);
  h.moveToTrashMock.mockReset();
  h.moveToTrashMock.mockResolvedValue(undefined);
  h.appendAuditLogMock.mockReset();
  h.appendAuditLogMock.mockResolvedValue(true);

  await fakeBrowser.storage.local.set({
    [STORAGE_KEYS.MASTER_PASSWORD]: { hashedPassword: 'x', salt: 'cloud-sync-test-salt' },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ==================== 纯函数 ====================

describe('rowsToChunks / chunksToUpsertRows：纯函数往返', () => {
  it('rowsToChunks 跳过缺关键字段的行，数字字段强制转换', () => {
    const valid = chunkToRow(fakeChunk('g1', 1000), 'rec1');
    const invalid: CloudRow = { recordId: 'rec2', fields: { [ENCRYPTED_FIELDS.partKey]: 'g2#0' }, cloudModifiedAt: 0 };
    const chunks = rowsToChunks([valid, invalid]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].snapshotGroupId).toBe('g1');
    expect(chunks[0].partIndex).toBe(0);
  });

  it('chunksToUpsertRows 以 partKey 为 businessId，recordId 为空（新增）', () => {
    const rows = chunksToUpsertRows([fakeChunk('g1', 1000)]);
    expect(rows[0].recordId).toBe('');
    expect(rows[0].businessId).toBe('g1#0');
    expect(rows[0].fields[ENCRYPTED_FIELDS.payload]).toBe('x');
  });
});

// ==================== 建表 / 探测 ====================

describe('prepareProviderTarget：建表与探测（§4.3）', () => {
  it('无法识别的 URL 抛 notFound', async () => {
    await expect(prepareProviderTarget('feishu', FEISHU_CREDS, 'not-a-url', 'encrypted')).rejects.toMatchObject({
      kind: 'notFound',
    });
  });

  it('目标表不存在时自动建表，created=true，回写 target', async () => {
    h.state.tables = [];
    const result = await prepareProviderTarget(
      'feishu',
      FEISHU_CREDS,
      'https://x.feishu.cn/base/appToken123',
      'encrypted',
    );
    expect(result.created).toBe(true);
    expect(result.tableName).toBe('APH-Sync-Encrypted');
    expect(result.target).toMatchObject({ appToken: 'appToken123', tableId: 'tbl-created' });
    // 配置被回写为已就绪
    const config = await import('@/utils/cloudSync/configStore').then(m => m.getCloudSyncConfig());
    expect(config.providers.feishu.configured).toBe(true);
    expect(config.providers.feishu.target.tableId).toBe('tbl-created');
  });

  it('已存在同名表且结构匹配 → 复用，created=false', async () => {
    h.state.tables = [{ id: 'tbl-existing', name: 'APH-Sync-Encrypted' }];
    h.state.schemaResult = { ok: true };
    const result = await prepareProviderTarget(
      'feishu',
      FEISHU_CREDS,
      'https://x.feishu.cn/base/appToken123',
      'encrypted',
    );
    expect(result.created).toBe(false);
    expect((result.target as { tableId?: string }).tableId).toBe('tbl-existing');
  });

  it('已存在同名表但结构不符 → 抛 schema，不自动改表', async () => {
    h.state.tables = [{ id: 'tbl-existing', name: 'APH-Sync-Encrypted' }];
    h.state.schemaResult = { ok: false, missingFields: ['payload', 'partHash'] };
    await expect(
      prepareProviderTarget('feishu', FEISHU_CREDS, 'https://x.feishu.cn/base/appToken123', 'encrypted'),
    ).rejects.toMatchObject({ kind: 'schema' });
  });

  it('testConnection 失败向上抛出', async () => {
    h.state.testConnectionError = new CloudSyncError('invalidCredential', 'bad token');
    await expect(
      prepareProviderTarget('feishu', FEISHU_CREDS, 'https://x.feishu.cn/base/appToken123', 'encrypted'),
    ).rejects.toMatchObject({ kind: 'invalidCredential' });
  });

  it('私有化部署：自定义地址透传适配器、随 target 落盘，并放行自有域名的文档链接', async () => {
    h.state.tables = [{ id: 'tbl-existing', name: 'APH-Sync-Encrypted' }];
    h.state.schemaResult = { ok: true };
    const result = await prepareProviderTarget(
      'feishu',
      FEISHU_CREDS,
      'https://docs.corp.example/base/appToken123?table=tbl-existing',
      'encrypted',
      {},
      { feishuBaseUrl: 'https://open.corp.example/' },
    );
    expect(result.target).toMatchObject({
      appToken: 'appToken123',
      tableId: 'tbl-existing',
      baseUrl: 'https://open.corp.example',
    });
    expect(h.state.lastAdapterBaseUrl).toBe('https://open.corp.example');
    const config = await import('@/utils/cloudSync/configStore').then(m => m.getCloudSyncConfig());
    expect(config.providers.feishu.target.baseUrl).toBe('https://open.corp.example');
  });

  it('填写官方地址等同留空：target.baseUrl 归一为 null', async () => {
    h.state.tables = [];
    const result = await prepareProviderTarget(
      'feishu',
      FEISHU_CREDS,
      'https://x.feishu.cn/base/appToken123',
      'encrypted',
      {},
      { feishuBaseUrl: 'https://open.feishu.cn/' },
    );
    expect((result.target as { baseUrl?: string | null }).baseUrl).toBeNull();
    expect(h.state.lastAdapterBaseUrl).toBeNull();
  });

  it('私有化地址非法（公网 http）→ notFound，不落盘配置', async () => {
    await expect(
      prepareProviderTarget(
        'feishu',
        FEISHU_CREDS,
        'https://x.feishu.cn/base/appToken123',
        'encrypted',
        {},
        { feishuBaseUrl: 'http://open.corp.example' },
      ),
    ).rejects.toMatchObject({ kind: 'notFound' });
    const config = await import('@/utils/cloudSync/configStore').then(m => m.getCloudSyncConfig());
    expect(config.providers.feishu.configured).toBe(false);
  });

  it('未配置私有化地址时，非白名单文档域名仍被拒绝（既有行为不变）', async () => {
    await expect(
      prepareProviderTarget('feishu', FEISHU_CREDS, 'https://docs.corp.example/base/appToken123', 'encrypted'),
    ).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('私有化地址只对飞书生效，腾讯 target 保持官方默认地址', async () => {
    h.state.tables = [];
    const result = await prepareProviderTarget(
      'tencent',
      { clientId: 'c', openId: 'o', accessToken: 'a' },
      'https://docs.qq.com/smartsheet/file123',
      'encrypted',
      {},
      { feishuBaseUrl: 'https://open.corp.example' },
    );
    expect(result.target).toEqual({
      fileId: 'file123',
      sheetId: 'tbl-created',
      fileUrl: 'https://docs.qq.com/smartsheet/file123',
      baseUrl: null,
      allowInsecure: false,
    });
  });

  it('腾讯私有化部署：自定义 API 地址与自有文档域名可用并落盘', async () => {
    h.state.tables = [{ id: 'tbl-existing', name: 'APH-Sync-Encrypted' }];
    h.state.schemaResult = { ok: true };
    const result = await prepareProviderTarget(
      'tencent',
      { clientId: 'c', openId: 'o', accessToken: 'a' },
      'https://docs.corp.example/smartsheet/file123?tab=tbl-existing',
      'encrypted',
      {},
      { tencentBaseUrl: 'https://api.corp.example/gateway/' },
    );
    expect(result.target).toEqual({
      fileId: 'file123',
      sheetId: 'tbl-existing',
      fileUrl: 'https://docs.corp.example/smartsheet/file123?tab=tbl-existing',
      baseUrl: 'https://api.corp.example/gateway',
      allowInsecure: false,
    });
    expect(h.state.lastAdapterBaseUrl).toBe('https://api.corp.example/gateway');
  });

  it('腾讯内网 HTTP 未确认时拒绝，显式确认后允许并记录标记', async () => {
    await expect(
      prepareProviderTarget(
        'tencent',
        { clientId: 'c', openId: 'o', accessToken: 'a' },
        'http://192.168.1.8:8080/smartsheet/file123',
        'encrypted',
        {},
        { tencentBaseUrl: 'http://192.168.1.8:8080' },
      ),
    ).rejects.toMatchObject({ kind: 'notFound' });

    h.state.tables = [];
    const result = await prepareProviderTarget(
      'tencent',
      { clientId: 'c', openId: 'o', accessToken: 'a' },
      'http://192.168.1.8:8080/smartsheet/file123',
      'encrypted',
      {},
      { tencentBaseUrl: 'http://192.168.1.8:8080/', allowInsecure: true },
    );
    expect(result.target).toMatchObject({
      baseUrl: 'http://192.168.1.8:8080',
      allowInsecure: true,
    });
    expect(h.state.lastAdapterBaseUrl).toBe('http://192.168.1.8:8080');
    expect(h.state.lastAdapterAllowInsecure).toBe(true);
  });
});

describe('已保存的私有化地址在执行期透传适配器', () => {
  it('rebuildSnapshot 用配置里的 baseUrl 构造适配器', async () => {
    await setupConfig('feishu', 'plaintext', {
      target: {
        appToken: 'app',
        tableId: 'tbl',
        fileUrl: null,
        baseUrl: 'https://open.corp.example',
        allowInsecure: false,
      },
    });
    await rebuildSnapshot('feishu', TEST_MASTER_PASSWORD);
    expect(h.state.lastAdapterBaseUrl).toBe('https://open.corp.example');
  });

  it('未配置 baseUrl 时透传 null，适配器自行回退官方地址', async () => {
    await setupConfig('feishu', 'plaintext');
    await rebuildSnapshot('feishu', TEST_MASTER_PASSWORD);
    expect(h.state.lastAdapterBaseUrl).toBeNull();
  });

  it('腾讯 rebuildSnapshot 透传已保存的自定义地址', async () => {
    await setupConfig('tencent', 'plaintext', {
      target: {
        fileId: 'file',
        sheetId: 'sheet',
        fileUrl: 'https://docs.corp.example/sheet/file',
        baseUrl: 'https://api.corp.example',
        allowInsecure: false,
      },
    });
    await rebuildSnapshot('tencent', TEST_MASTER_PASSWORD);
    expect(h.state.lastAdapterBaseUrl).toBe('https://api.corp.example');
  });
});

// ==================== 前置校验 ====================

describe('runPlaintextSync：前置校验', () => {
  it('凭证未配置（empty）→ invalidCredential', async () => {
    await setupConfig('feishu', 'plaintext');
    h.loadCredentialsMock.mockResolvedValue({ status: 'empty' });
    await expect(runPlaintextSync('feishu', TEST_MASTER_PASSWORD)).rejects.toMatchObject({ kind: 'invalidCredential' });
  });

  it('会话锁定（locked）→ invalidCredential', async () => {
    await setupConfig('feishu', 'plaintext');
    h.loadCredentialsMock.mockResolvedValue({ status: 'locked' });
    await expect(runPlaintextSync('feishu', TEST_MASTER_PASSWORD)).rejects.toMatchObject({ kind: 'invalidCredential' });
  });

  it('rekey 后凭证不可解（corrupted）→ invalidCredential', async () => {
    await setupConfig('feishu', 'plaintext');
    h.loadCredentialsMock.mockResolvedValue({ status: 'corrupted' });
    await expect(runPlaintextSync('feishu', TEST_MASTER_PASSWORD)).rejects.toMatchObject({ kind: 'invalidCredential' });
  });

  it('目标未配置 → notFound', async () => {
    const config = getDefaultCloudSyncConfig();
    await saveCloudSyncConfig(config); // configured=false
    await expect(runPlaintextSync('feishu', TEST_MASTER_PASSWORD)).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('模式不匹配（配置为密文却跑明文同步）→ 抛错', async () => {
    await setupConfig('feishu', 'encrypted');
    await expect(runPlaintextSync('feishu', TEST_MASTER_PASSWORD)).rejects.toBeInstanceOf(CloudSyncError);
  });

  it('任务锁被占用 → writeConflict，且不释放他人锁', async () => {
    await setupConfig('feishu', 'plaintext');
    h.acquireTaskLockMock.mockResolvedValue({ ok: false, reason: 'busy', heartbeatAt: 0 });
    await expect(runPlaintextSync('feishu', TEST_MASTER_PASSWORD)).rejects.toMatchObject({ kind: 'writeConflict' });
    expect(h.releaseMock).not.toHaveBeenCalled();
  });
});

// ==================== 明文双向同步 ====================

describe('runPlaintextSync：明文双向同步（§6）', () => {
  it('本地新增 → 推送云端，stats.created=1，快照写回 recordId', async () => {
    await setupConfig('feishu', 'plaintext');
    const e1 = makePasswordEntry({
      id: 'e1',
      username: 'alice',
      password: 'p1',
      url: 'https://a.example',
      updateTime: 1000,
    });
    h.getAllPasswordsMock.mockResolvedValue([e1]);
    h.state.rows = []; // 云端空

    const report = await runPlaintextSync('feishu', TEST_MASTER_PASSWORD);
    expect(report.stats.created).toBe(1);
    expect(report.cancelled).toBe(false);
    expect(h.releaseMock).toHaveBeenCalled();

    const snap = await loadSnapshot('feishu', 'app:tbl');
    expect(snap?.entries.e1).toBeDefined();
    expect(snap?.entries.e1.recordId).toBe('rec-0');
  });

  it('推送到表格：只执行本地上行，不拉取云端独有行', async () => {
    await setupConfig('feishu', 'plaintext');
    const e1 = makePasswordEntry({
      id: 'e1',
      username: 'alice',
      password: 'p1',
      url: 'https://a.example',
      updateTime: 1000,
    });
    h.getAllPasswordsMock.mockResolvedValue([e1]);
    h.state.rows = [
      plaintextRow(
        {
          [PLAINTEXT_FIELDS.id]: '',
          [PLAINTEXT_FIELDS.username]: 'bob',
          [PLAINTEXT_FIELDS.url]: 'https://b.example',
        },
        { recordId: 'rec-cloud-only' },
      ),
    ];

    const report = await runPlaintextSync('feishu', TEST_MASTER_PASSWORD, { direction: 'push' });

    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.upsertCalls[0][0]).toMatchObject({ businessId: 'e1' });
    expect(h.savePasswordMock).not.toHaveBeenCalled();
    expect(h.batchApplyPasswordChangesMock).not.toHaveBeenCalled();
    expect(report.stats.created).toBe(1);
    expect(report.stats.pulled).toBe(0);
  });

  it('从表格拉取：只执行云端下行，不推送本地独有行', async () => {
    await setupConfig('feishu', 'plaintext');
    const e1 = makePasswordEntry({
      id: 'e1',
      username: 'alice',
      password: 'p1',
      url: 'https://a.example',
      updateTime: 1000,
    });
    h.getAllPasswordsMock.mockResolvedValue([e1]);
    h.state.rows = [
      plaintextRow(
        {
          [PLAINTEXT_FIELDS.id]: '',
          [PLAINTEXT_FIELDS.username]: 'bob',
          [PLAINTEXT_FIELDS.url]: 'https://b.example',
        },
        { recordId: 'rec-cloud-only' },
      ),
    ];

    const report = await runPlaintextSync('feishu', TEST_MASTER_PASSWORD, { direction: 'pull' });

    expect(h.state.upsertCalls).toHaveLength(0);
    expect(h.batchApplyPasswordChangesMock).toHaveBeenCalledTimes(1);
    expect(h.savePasswordMock).not.toHaveBeenCalled();
    expect(report.stats.created).toBe(0);
    expect(report.stats.pulled).toBe(1);
  });

  it('本地为空且推送已确认 → 删除线上全部账号行，并清空本地快照', async () => {
    await setupConfig('feishu', 'plaintext');
    h.getAllPasswordsMock.mockResolvedValue([]);
    h.state.rows = [
      plaintextRow({ [PLAINTEXT_FIELDS.id]: 'e1' }, { recordId: 'rec1' }),
      plaintextRow({ [PLAINTEXT_FIELDS.id]: 'e2' }, { recordId: 'rec2' }),
    ];
    const confirm = vi.fn().mockResolvedValue(true);

    const report = await runPlaintextSync('feishu', TEST_MASTER_PASSWORD, {
      direction: 'push',
      onEmptyLocalCloud: confirm,
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(h.state.deleteCalls.flat()).toEqual(['rec1', 'rec2']);
    expect(report.stats.deleted).toBe(2);
    expect(report.cancelled).toBe(false);
    const snapshot = await loadSnapshot('feishu', 'app:tbl');
    expect(snapshot?.entries).toEqual({});
  });

  it('本地为空但用户取消删除 → 本轮取消且不删除任何云端行', async () => {
    await setupConfig('feishu', 'plaintext');
    h.getAllPasswordsMock.mockResolvedValue([]);
    h.state.rows = [plaintextRow({ [PLAINTEXT_FIELDS.id]: 'e1' }, { recordId: 'rec1' })];

    const report = await runPlaintextSync('feishu', TEST_MASTER_PASSWORD, {
      direction: 'both',
      onEmptyLocalCloud: vi.fn().mockResolvedValue(false),
    });

    expect(h.state.deleteCalls).toHaveLength(0);
    expect(report.cancelled).toBe(true);
    expect(report.stats.deleted).toBe(0);
  });

  it('从表格拉取时本地为空不会触发云端删除确认', async () => {
    await setupConfig('feishu', 'plaintext');
    h.getAllPasswordsMock.mockResolvedValue([]);
    h.state.rows = [plaintextRow({ [PLAINTEXT_FIELDS.id]: '' }, { recordId: 'rec-cloud-only' })];
    const confirm = vi.fn().mockResolvedValue(true);

    const report = await runPlaintextSync('feishu', TEST_MASTER_PASSWORD, {
      direction: 'pull',
      onEmptyLocalCloud: confirm,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(h.state.deleteCalls).toHaveLength(0);
    expect(report.stats.pulled).toBe(1);
  });

  it('云端删除 + 本地未变 → 条目进回收站（trashLocal），stats.trashed=1', async () => {
    await setupConfig('feishu', 'plaintext');
    const e1 = makePasswordEntry({
      id: 'e1',
      username: 'alice',
      password: 'p1',
      url: 'https://a.example',
      updateTime: 1000,
    });
    h.getAllPasswordsMock.mockResolvedValue([e1]);
    h.state.rows = []; // 云端已无该行
    // 快照存在且哈希与本地一致（本地未变）
    await saveSnapshot({
      provider: 'feishu',
      docKey: 'app:tbl',
      entries: { e1: { hash: await computeEntryHash(e1), recordId: 'rec1', syncedAt: 1000 } },
    });

    const report = await runPlaintextSync('feishu', TEST_MASTER_PASSWORD);
    expect(h.moveToTrashMock).toHaveBeenCalledWith(['e1']);
    expect(report.stats.trashed).toBe(1);
    const snap = await loadSnapshot('feishu', 'app:tbl');
    expect(snap?.entries.e1).toBeUndefined();
  });

  it('云端手工新增（无业务 ID）→ 拉取到本地，stats.pulled=1', async () => {
    await setupConfig('feishu', 'plaintext');
    h.getAllPasswordsMock.mockResolvedValue([]);
    h.state.rows = [plaintextRow({ [PLAINTEXT_FIELDS.id]: '' }, { recordId: 'rec-new' })];

    const report = await runPlaintextSync('feishu', TEST_MASTER_PASSWORD);
    expect(h.batchApplyPasswordChangesMock).toHaveBeenCalledTimes(1);
    expect(report.stats.pulled).toBe(1);
  });

  it('跨设备新增（带业务 ID）→ 保留原 ID 拉取并写入快照，不报人工冲突', async () => {
    await setupConfig('feishu', 'plaintext');
    h.getAllPasswordsMock.mockResolvedValue([]);
    h.state.rows = [
      plaintextRow(
        {
          [PLAINTEXT_FIELDS.id]: 'uuid-browser-b',
          [PLAINTEXT_FIELDS.username]: 'bob',
          [PLAINTEXT_FIELDS.password]: 'p2',
          [PLAINTEXT_FIELDS.url]: 'https://b.example',
        },
        { recordId: 'rec-browser-b' },
      ),
    ];

    const report = await runPlaintextSync('feishu', TEST_MASTER_PASSWORD);

    expect(h.batchApplyPasswordChangesMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'uuid-browser-b',
          entry: expect.objectContaining({ username: 'bob', password: 'p2', url: 'https://b.example' }),
        }),
      ],
      [],
      TEST_MASTER_PASSWORD,
    );
    expect(h.savePasswordMock).not.toHaveBeenCalled();
    expect(report.stats.pulled).toBe(1);
    expect(report.stats.conflicts).toBe(0);
    const snapshot = await loadSnapshot('feishu', 'app:tbl');
    expect(snapshot?.entries['uuid-browser-b']).toMatchObject({ recordId: 'rec-browser-b' });
  });

  it('多行云端新增与更新合并为一次本地批量落库', async () => {
    await setupConfig('feishu', 'plaintext');
    const local = makePasswordEntry({
      id: 'existing',
      username: 'old-name',
      password: 'old-pass',
      url: 'https://existing.example',
      updateTime: 1000,
    });
    h.getAllPasswordsMock.mockResolvedValue([local]);
    h.state.rows = [
      plaintextRow(
        {
          [PLAINTEXT_FIELDS.id]: 'existing',
          [PLAINTEXT_FIELDS.username]: 'cloud-name',
          [PLAINTEXT_FIELDS.password]: 'cloud-pass',
          [PLAINTEXT_FIELDS.url]: 'https://existing.example',
          [PLAINTEXT_FIELDS.localUpdateTime]: 2000,
        },
        { recordId: 'rec-existing', cloudModifiedAt: 2000 },
      ),
      plaintextRow(
        {
          [PLAINTEXT_FIELDS.id]: '',
          [PLAINTEXT_FIELDS.username]: 'new-user',
          [PLAINTEXT_FIELDS.password]: 'new-pass',
          [PLAINTEXT_FIELDS.url]: 'https://new.example',
          [PLAINTEXT_FIELDS.localUpdateTime]: 3000,
        },
        { recordId: 'rec-new', cloudModifiedAt: 3000 },
      ),
    ];
    await saveSnapshot({
      provider: 'feishu',
      docKey: 'app:tbl',
      entries: {
        existing: {
          hash: await computeEntryHash(local),
          recordId: 'rec-existing',
          syncedAt: 1000,
        },
      },
    });

    const report = await runPlaintextSync('feishu', TEST_MASTER_PASSWORD);

    expect(h.batchApplyPasswordChangesMock).toHaveBeenCalledTimes(1);
    const [creates, updates] = h.batchApplyPasswordChangesMock.mock.calls[0] as [
      Array<{ entry: Record<string, unknown> }>,
      Array<{ id: string; updates: Record<string, unknown> }>,
    ];
    expect(creates).toHaveLength(1);
    expect(updates).toEqual([
      {
        id: 'existing',
        updates: expect.objectContaining({
          username: 'cloud-name',
          password: 'cloud-pass',
          updateTime: 2000,
        }),
      },
    ]);
    expect(report.stats.pulled).toBe(2);
  });

  it('推送到表格：跳过跨设备带业务 ID 的新增行，不拉取也不报人工冲突', async () => {
    await setupConfig('feishu', 'plaintext');
    h.getAllPasswordsMock.mockResolvedValue([]);
    h.state.rows = [
      plaintextRow(
        {
          [PLAINTEXT_FIELDS.id]: 'uuid-browser-b',
          [PLAINTEXT_FIELDS.username]: 'bob',
          [PLAINTEXT_FIELDS.url]: 'https://b.example',
        },
        { recordId: 'rec-browser-b' },
      ),
    ];

    const report = await runPlaintextSync('feishu', TEST_MASTER_PASSWORD, { direction: 'push' });

    expect(h.batchApplyPasswordChangesMock).not.toHaveBeenCalled();
    expect(report.stats.pulled).toBe(0);
    expect(report.stats.conflicts).toBe(0);
  });

  it('本地删除 + 云端仍在 + 快照证明 → 删除云端行，stats.deleted=1', async () => {
    await setupConfig('feishu', 'plaintext');
    h.getAllPasswordsMock.mockResolvedValue([]); // 本地已无
    h.state.rows = [plaintextRow({}, { recordId: 'rec1' })]; // 云端仍在，带业务 ID e1
    await saveSnapshot({
      provider: 'feishu',
      docKey: 'app:tbl',
      entries: { e1: { hash: 'old', recordId: 'rec1', syncedAt: 1000 } },
    });

    const report = await runPlaintextSync('feishu', TEST_MASTER_PASSWORD);
    expect(h.state.deleteCalls.flat()).toContain('rec1');
    expect(report.stats.deleted).toBe(1);
  });

  it('审计写入失败 → 报告含 auditLogFailed 警告，但同步成功', async () => {
    await setupConfig('feishu', 'plaintext');
    h.appendAuditLogMock.mockResolvedValue(false);
    const report = await runPlaintextSync('feishu', TEST_MASTER_PASSWORD);
    expect(report.warnings.some(w => w.key === 'cloudSync.warning.auditLogFailed')).toBe(true);
  });

  it('目标已确认内网 HTTP → 每次明文同步都报告明文传输警告', async () => {
    await setupConfig('feishu', 'plaintext', {
      target: {
        appToken: 'app',
        tableId: 'tbl',
        fileUrl: 'http://docs.corp.example/base/app',
        baseUrl: 'http://10.0.0.8:8080',
        allowInsecure: true,
      },
    });
    const report = await runPlaintextSync('feishu', TEST_MASTER_PASSWORD);
    expect(report.warnings.some(w => w.key === 'cloudSync.warning.insecureTransport')).toBe(true);
  });

  it('快照缺失 → 降级全量比对，报告含 snapshotDegraded 警告', async () => {
    await setupConfig('feishu', 'plaintext');
    const e1 = makePasswordEntry({
      id: 'e1',
      username: 'alice',
      password: 'p1',
      url: 'https://a.example',
      updateTime: 1000,
    });
    h.getAllPasswordsMock.mockResolvedValue([e1]);
    h.state.rows = [plaintextRow({}, { recordId: 'rec1' })]; // 云端有匹配行但无快照

    const report = await runPlaintextSync('feishu', TEST_MASTER_PASSWORD);
    expect(report.warnings.some(w => w.key === 'cloudSync.warning.snapshotDegraded')).toBe(true);
  });

  it('批量结果缺失条目 → failures 含 missing-result', async () => {
    await setupConfig('feishu', 'plaintext');
    const e1 = makePasswordEntry({
      id: 'e1',
      username: 'alice',
      password: 'p1',
      url: 'https://a.example',
      updateTime: 1000,
    });
    h.getAllPasswordsMock.mockResolvedValue([e1]);
    h.state.rows = [];
    // upsert 返回空结果（既无 succeeded 也无 failed）
    h.state.upsertResult = { succeeded: [], failed: [] };

    const report = await runPlaintextSync('feishu', TEST_MASTER_PASSWORD);
    expect(report.failures.some(f => f.code === 'missing-result')).toBe(true);
    expect(report.stats.failed).toBeGreaterThanOrEqual(1);
  });

  it('用户取消（signal.aborted）→ cancelled=true，仍释放锁', async () => {
    await setupConfig('feishu', 'plaintext');
    const controller = new AbortController();
    controller.abort();
    const e1 = makePasswordEntry({
      id: 'e1',
      username: 'alice',
      password: 'p1',
      url: 'https://a.example',
      updateTime: 1000,
    });
    h.getAllPasswordsMock.mockResolvedValue([e1]);
    h.state.rows = [];

    const report = await runPlaintextSync('feishu', TEST_MASTER_PASSWORD, { signal: controller.signal });
    expect(report.cancelled).toBe(true);
    expect(h.releaseMock).toHaveBeenCalled();
  });
});

describe('runPlaintextSync：分组列（云同步规格 V1.3）', () => {
  it('本地推送时把 groupId 转成完整路径写入“分组”列', async () => {
    await setupConfig('feishu', 'plaintext');
    await fakeBrowser.storage.local.set({
      [STORAGE_KEYS.PASSWORD_GROUPS]: [
        { code: 'work', name: '工作', parentCode: '-1', order: 0 },
        { code: 'project', name: '项目A', parentCode: 'work', order: 0 },
      ],
    });
    h.getAllPasswordsMock.mockResolvedValue([makePasswordEntry({ id: 'e1', groupId: 'project' })]);
    h.state.rows = [];

    await runPlaintextSync('feishu', TEST_MASTER_PASSWORD);

    const firstCall = h.state.upsertCalls[0] as Array<{ fields: Record<string, string | number> }>;
    const fields = firstCall[0].fields;
    expect(fields[PLAINTEXT_FIELDS.group]).toBe('工作/项目A');
  });

  it('云端拉取时按路径逐级建组，并把新 groupId 写入条目', async () => {
    await setupConfig('feishu', 'plaintext');
    h.getAllPasswordsMock.mockResolvedValue([]);
    h.state.rows = [
      plaintextRow(
        {
          [PLAINTEXT_FIELDS.id]: '',
          [PLAINTEXT_FIELDS.group]: '工作/项目A',
        },
        { recordId: 'rec-grouped' },
      ),
    ];

    await runPlaintextSync('feishu', TEST_MASTER_PASSWORD);

    const [creates] = h.batchApplyPasswordChangesMock.mock.calls[0] as [Array<{ entry: { groupId?: string } }>];
    const groups = await getAllGroups();
    expect(groups.map(group => group.name)).toEqual(['工作', '项目A']);
    expect(creates[0].entry.groupId).toBe(groups.find(group => group.name === '项目A')?.code);
  });
});

// ==================== 密文备份 ====================

describe('runEncryptedBackup：密文备份（§5）', () => {
  it('全部分片写入成功 → 保存元数据，stats.created=分片数', async () => {
    await setupConfig('feishu', 'encrypted');
    h.getAllPasswordsMock.mockResolvedValue([makePasswordEntry({ id: 'a' })]);
    h.state.rows = [];

    const report = await runEncryptedBackup('feishu', TEST_MASTER_PASSWORD);
    expect(report.mode).toBe('encrypted');
    expect(report.stats.created).toBeGreaterThanOrEqual(1);
    expect(report.chunkDowngrades).toBe(0);
    const meta = await loadEncryptedMeta('feishu', 'app:tbl');
    expect(meta?.totalParts).toBe(report.stats.created);
    expect(meta?.snapshotGroupId).toBeTruthy();
    expect(h.releaseMock).toHaveBeenCalled();
  });

  it('模式不匹配（配置为明文却跑密文备份）→ 抛错', async () => {
    await setupConfig('feishu', 'plaintext');
    await expect(runEncryptedBackup('feishu', TEST_MASTER_PASSWORD)).rejects.toBeInstanceOf(CloudSyncError);
  });

  it('单元格过大（tooLarge）→ 分片减半重试，chunkDowngrades 递增', async () => {
    await setupConfig('feishu', 'encrypted');
    h.getAllPasswordsMock.mockResolvedValue([makePasswordEntry({ id: 'a' })]);
    h.state.rows = [];
    h.state.tooLargeFailures = 1; // 第一次全失败 tooLarge，第二次成功

    const report = await runEncryptedBackup('feishu', TEST_MASTER_PASSWORD);
    expect(report.chunkDowngrades).toBe(1);
    expect(report.stats.created).toBeGreaterThanOrEqual(1);
  });

  it('部分分片写入失败 → 清理已写分片并抛错', async () => {
    await setupConfig('feishu', 'encrypted');
    h.getAllPasswordsMock.mockResolvedValue([makePasswordEntry({ id: 'a' })]);
    h.state.rows = [];
    h.state.upsertResult = { succeeded: [], failed: [{ businessId: 'x', code: 'server-error', message: 'boom' }] };

    await expect(runEncryptedBackup('feishu', TEST_MASTER_PASSWORD)).rejects.toMatchObject({ kind: 'unknown' });
    expect(h.releaseMock).toHaveBeenCalled();
  });

  it('目标已确认内网 HTTP → 密文备份报告明文传输警告', async () => {
    await setupConfig('tencent', 'encrypted', {
      target: {
        fileId: 'file',
        sheetId: 'sheet',
        fileUrl: 'http://docs.corp.example/sheet/file',
        baseUrl: 'http://10.0.0.8:8080',
        allowInsecure: true,
      },
    });
    h.getAllPasswordsMock.mockResolvedValue([makePasswordEntry({ id: 'a' })]);
    const report = await runEncryptedBackup('tencent', TEST_MASTER_PASSWORD);
    expect(report.warnings.some(w => w.key === 'cloudSync.warning.insecureTransport')).toBe(true);
  });
});

// ==================== 密文恢复 ====================

describe('runEncryptedRestore：密文恢复（§5.3）', () => {
  async function seedEncryptedRows(
    entries: ReturnType<typeof makePasswordEntry>[],
    corrupt = false,
    groups: { code: string; name: string; parentCode: string; order: number }[] = [],
  ) {
    const { rows } = await encryptAndChunk(entries, TEST_MASTER_PASSWORD, 48000, 5000, groups);
    if (corrupt && rows.length > 0) rows[0] = { ...rows[0], payload: `${rows[0].payload}TAMPER` };
    h.state.rows = rows.map((chunk, i) => chunkToRow(chunk, `rec-${i}`));
  }

  it('云端无完整快照 → notFound', async () => {
    await setupConfig('feishu', 'encrypted');
    h.state.rows = [];
    await expect(runEncryptedRestore('feishu', TEST_MASTER_PASSWORD)).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('分片被篡改（partHash 不匹配）→ schema 错误，拒绝恢复', async () => {
    await setupConfig('feishu', 'encrypted');
    await seedEncryptedRows([makePasswordEntry({ id: 'a', updateTime: 5000 })], true);
    await expect(runEncryptedRestore('feishu', TEST_MASTER_PASSWORD)).rejects.toMatchObject({ kind: 'schema' });
  });

  it('按 ID 增量合并：本地无→新增，云端较新→更新，本地较新→跳过', async () => {
    await setupConfig('feishu', 'encrypted');
    // 云端快照含 a(updateTime 5000) 与 b(5000)
    await seedEncryptedRows([
      makePasswordEntry({ id: 'a', username: 'cloud-a', updateTime: 5000 }),
      makePasswordEntry({ id: 'b', username: 'cloud-b', updateTime: 5000 }),
    ]);
    // 本地仅有 a，且较旧（1000）→ 应被更新；b 本地无 → 新增
    h.getAllPasswordsMock.mockResolvedValue([makePasswordEntry({ id: 'a', username: 'local-a', updateTime: 1000 })]);

    const report = await runEncryptedRestore('feishu', TEST_MASTER_PASSWORD);
    expect(report.restore).toEqual({ added: 1, updated: 1, skipped: 0, rejected: 0 });
    expect(h.savePasswordMock).toHaveBeenCalledTimes(1); // b 新增
    expect(h.updatePasswordMock).toHaveBeenCalledTimes(1); // a 更新
    expect(h.releaseMock).toHaveBeenCalled();
  });

  it('本地较新 → 跳过不覆盖（恢复不删除本地任何条目）', async () => {
    await setupConfig('feishu', 'encrypted');
    await seedEncryptedRows([makePasswordEntry({ id: 'a', updateTime: 1000 })]);
    h.getAllPasswordsMock.mockResolvedValue([makePasswordEntry({ id: 'a', updateTime: 9000 })]);

    const report = await runEncryptedRestore('feishu', TEST_MASTER_PASSWORD);
    expect(report.restore).toEqual({ added: 0, updated: 0, skipped: 1, rejected: 0 });
    expect(h.updatePasswordMock).not.toHaveBeenCalled();
  });

  it('快照分组树按同名路径合并，条目 groupId 重映射到本地 code', async () => {
    await setupConfig('feishu', 'encrypted');
    await seedEncryptedRows(
      [makePasswordEntry({ id: 'a', username: 'grouped', updateTime: 5000, groupId: 'remote-project' })],
      false,
      [
        { code: 'remote-work', name: '工作', parentCode: '-1', order: 0 },
        { code: 'remote-project', name: '项目A', parentCode: 'remote-work', order: 0 },
      ],
    );
    h.getAllPasswordsMock.mockResolvedValue([]);

    await runEncryptedRestore('feishu', TEST_MASTER_PASSWORD);

    const groups = await getAllGroups();
    const project = groups.find(group => group.name === '项目A');
    expect(groups.map(group => group.name)).toEqual(['工作', '项目A']);
    expect(project).toBeDefined();
    expect(h.savePasswordMock.mock.calls[0][0]).toMatchObject({ groupId: project?.code });
  });

  it('目标已确认内网 HTTP → 密文恢复报告明文传输警告', async () => {
    await setupConfig('feishu', 'encrypted', {
      target: {
        appToken: 'app',
        tableId: 'tbl',
        fileUrl: 'http://docs.corp.example/base/app',
        baseUrl: 'http://10.0.0.8:8080',
        allowInsecure: true,
      },
    });
    await seedEncryptedRows([makePasswordEntry({ id: 'a', updateTime: 5000 })]);
    h.getAllPasswordsMock.mockResolvedValue([]);
    const report = await runEncryptedRestore('feishu', TEST_MASTER_PASSWORD);
    expect(report.warnings.some(w => w.key === 'cloudSync.warning.insecureTransport')).toBe(true);
  });
});

// ==================== 重建快照 / 清理旧版本 ====================

describe('rebuildSnapshot：全量拉取重建本地快照（§6.1）', () => {
  it('仅为云端与本地都存在的业务 ID 建立快照条目', async () => {
    await setupConfig('feishu', 'plaintext');
    const e1 = makePasswordEntry({
      id: 'e1',
      username: 'alice',
      password: 'p1',
      url: 'https://a.example',
      updateTime: 1000,
    });
    h.getAllPasswordsMock.mockResolvedValue([e1]);
    h.state.rows = [
      plaintextRow({}, { recordId: 'rec1' }), // 业务 ID e1，本地存在
      plaintextRow({ [PLAINTEXT_FIELDS.id]: 'unknown' }, { recordId: 'rec2' }), // 本地无
    ];

    await rebuildSnapshot('feishu', TEST_MASTER_PASSWORD);
    const snap = await loadSnapshot('feishu', 'app:tbl');
    expect(snap?.entries.e1).toBeDefined();
    expect(snap?.entries.e1.recordId).toBe('rec1');
    expect(snap?.entries.unknown).toBeUndefined();
    expect(h.releaseMock).toHaveBeenCalled();
  });
});

describe('clearOldSnapshotVersions：按保留策略清理云端旧分组（§5.1）', () => {
  it('超出保留数的旧分组被删除（默认 keepVersions=3）', async () => {
    await setupConfig('feishu', 'encrypted');
    // 5 个完整分组，exportedAt 1000..5000
    const chunks = [1000, 2000, 3000, 4000, 5000].map((at, i) => fakeChunk(`g${i}`, at));
    h.state.rows = chunks.map((chunk, i) => chunkToRow(chunk, `rec-${i}`));

    const report = await clearOldSnapshotVersions('feishu');
    // 保留最近 3 个（5000/4000/3000），删除 2 个（2000/1000）
    expect(report.stats.deleted).toBe(2);
    expect(h.state.deleteCalls.length).toBe(2);
    expect(h.releaseMock).toHaveBeenCalled();
  });
});
