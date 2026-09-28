# WebDAV 密文备份同步实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在既有云文档同步体系中新增 WebDAV 平台，支持整库加密单文件备份到用户自选 WebDAV 服务器、多版本保留与手动恢复。

**架构：** WebDAV 作为第三个 `CloudProvider` 并入现有体系；新增 `FileStorageAdapter` 抽象（与 `TableAdapter` 并列）承载文件协议；单文件密文快照复用既有 AES-256-GCM 加密与校验链；凭证/任务锁/审计/报告全部复用现有基础设施。前置条件是把全部 provider 二元分支改造为穷尽式 `switch`，防止 webdav 静默落入 tencent 分支。

**技术栈：** TypeScript strict、WXT/Vue 3、原生 `fetch` + `DOMParser`（零新增依赖）、Vitest（node 环境 + jsdom docblock）。

**规格：** `docs/superpowers/specs/2026-09-24-webdav-sync-design.md`（V1.0，已批准）

**Commit 约定：** 本项目 `AGENTS.md` 规定未经用户明确要求不 commit。各任务末尾的「检查点」只跑验证命令，不执行 git commit；用户明确要求时再统一提交。

---

## 文件结构

| 文件                                                         | 操作 | 职责                                                                                    |
| ------------------------------------------------------------ | ---- | --------------------------------------------------------------------------------------- |
| `utils/cloudSync/types.ts`                                   | 修改 | `CloudProvider` 加 `'webdav'`；新增 `WebDavTarget`/`WebDavCredentials`；两个 Map 加分支 |
| `utils/cloudSync/configStore.ts`                             | 修改 | 穷尽化 4 处分支；webdav 默认配置/归一化/docKey                                          |
| `utils/cloudSync/credentialStore.ts`                         | 修改 | `isValidWebDav` 校验；`isValidCredentials` 穷尽化                                       |
| `utils/cloudSync/auditLog.ts`                                | 修改 | `sanitizeEntry` provider 白名单化                                                       |
| `utils/cloudSync/urlParse.ts`                                | 修改 | `parseCloudUrl` 穷尽化（webdav 抛错防误用）                                             |
| `utils/cloudSync/syncEngine.ts`                              | 修改 | 移出 3 个共享函数；表格函数加 webdav 守卫                                               |
| `utils/cloudSync/runContext.ts`                              | 创建 | `loadReadyContext`/`emptyStats`/`buildReport` 共享编排基元                              |
| `utils/cloudSync/adapters/fileStorage.ts`                    | 创建 | `FileStorageAdapter` 接口 + `RemoteFile` 类型                                           |
| `utils/cloudSync/adapters/webdav.ts`                         | 创建 | WebDAV 协议实现 + `mapWebDavStatus` + URL 工具                                          |
| `utils/cloudSync/cryptoSnapshot.ts`                          | 修改 | 新增 `encryptToSingleFile`/`verifyAndDecryptSingleFile`                                 |
| `utils/cloudSync/webdavSync.ts`                              | 创建 | WebDAV 编排：prepare/backup/restore/clearVersions/listVersions                          |
| `utils/i18n/locales/zh-CN/cloudSync.json`                    | 修改 | 新增 webdav 文案（中文）                                                                |
| `utils/i18n/locales/en/cloudSync.json`                       | 修改 | 新增 webdav 文案（英文，key 集与中文一致）                                              |
| `components/options/CloudSyncDialog.vue`                     | 修改 | 第三页签、表单、版本下拉、穷尽分派                                                      |
| `tests/utils/cloudSync.providerExhaustive.test.ts`           | 创建 | 穷尽化回归守卫                                                                          |
| `tests/utils/cloudSync.webdav.test.ts`                       | 创建 | 适配器协议测试（jsdom）                                                                 |
| `tests/utils/cloudSync.fileSnapshot.test.ts`                 | 创建 | 单文件快照测试                                                                          |
| `tests/utils/cloudSync.webdavSync.test.ts`                   | 创建 | 编排测试                                                                                |
| `README.md` / `README.en.md`                                 | 修改 | 功能说明 + 坚果云应用密码提示                                                           |
| `docs/ARCHITECTURE.md` / `.en.md`                            | 修改 | 云文档同步节补 WebDAV                                                                   |
| `privacy.html` / `privacy.en.html`                           | 修改 | 数据外传说明补 WebDAV                                                                   |
| `docs/CWS_FILL_CONTENT.md`                                   | 修改 | 隐私口径                                                                                |
| `docs/superpowers/specs/2026-09-23-cloud-doc-sync-design.md` | 修改 | §3 补 WebDAV 引用                                                                       |

---

### 任务 1：P0 穷尽化改造（零行为变化）

**文件：**

- 修改：`utils/cloudSync/configStore.ts`（`defaultProviderConfig`/`normalizeConfig`/`patchProviderConfig`/`getDocKey`）
- 修改：`utils/cloudSync/credentialStore.ts:45-50`（`isValidCredentials`）
- 修改：`utils/cloudSync/auditLog.ts:48`（`sanitizeEntry` provider 行）
- 修改：`utils/cloudSync/urlParse.ts:72-74`（`parseCloudUrl`）
- 修改：`utils/cloudSync/syncEngine.ts`（`createAdapter`/`applySubKey`/`readSubKey`）
- 测试：`tests/utils/cloudSync.providerExhaustive.test.ts`（创建）

**说明：** 本任务在 `CloudProvider` 仍为二元联合时先落地 `switch` 结构（`default` 分支用 `never` 兜底），任务 2 扩展联合类型后 TS 自动强制补分支。改造前后行为完全等价，由既有 937 个测试守卫。

- [ ] **步骤 1.1：编写穷尽化回归守卫测试**

```ts
// tests/utils/cloudSync.providerExhaustive.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  getDocKey,
  patchProviderConfig,
  getCloudSyncConfig,
} from '@/utils/cloudSync/configStore';
import { sanitizeEntry } from '@/utils/cloudSync/auditLog';
import type { AuditEntry } from '@/utils/cloudSync/types';

/**
 * provider 穷尽分派守卫（WebDAV 规格 §2）
 *
 * 锁定：每个 provider 的配置/docKey/审计平台字段都落在自己名下，
 * 防止二元分支把新 provider 静默归入错误平台。
 */
beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('provider 穷尽分派', () => {
  it('getDocKey：各 provider 读各自 target 字段', () => {
    expect(
      getDocKey('feishu', { appToken: 'a', tableId: 't', fileUrl: null }),
    ).toBe('a:t');
    expect(
      getDocKey('tencent', { fileId: 'f', sheetId: 's', fileUrl: null }),
    ).toBe('f:s');
    // webdav 分支在任务 2 加入后补充断言
  });

  it('patchProviderConfig：写入落在对应 provider 名下', async () => {
    await patchProviderConfig('tencent', { configured: true });
    const config = await getCloudSyncConfig();
    expect(config.providers.tencent.configured).toBe(true);
    expect(config.providers.feishu.configured).toBe(false);
  });

  it('sanitizeEntry：合法 provider 原样保留', () => {
    const base: AuditEntry = {
      at: 1,
      provider: 'tencent',
      mode: 'encrypted',
      action: 'backup',
      docKey: 'd',
    };
    expect(sanitizeEntry(base).provider).toBe('tencent');
    expect(sanitizeEntry({ ...base, provider: 'feishu' }).provider).toBe(
      'feishu',
    );
    expect(
      sanitizeEntry({ ...base, provider: 'bogus' as never }).provider,
    ).toBe('feishu');
  });
});
```

- [ ] **步骤 1.2：运行验证测试先通过（改造前基线）**

运行：`pnpm exec vitest run tests/utils/cloudSync.providerExhaustive.test.ts`
预期：PASS（现有二元实现对 feishu/tencent 行为正确）

- [ ] **步骤 1.3：改造 `configStore.ts` 四处分支为穷尽 switch**

`getDocKey` 改造后（其余三处同模式）：

```ts
export function getDocKey<P extends CloudProvider>(
  provider: P,
  target: ProviderTargetMap[P],
): string | null {
  switch (provider) {
    case 'feishu': {
      const t = target as ProviderTargetMap['feishu'];
      return t.appToken && t.tableId ? `${t.appToken}:${t.tableId}` : null;
    }
    case 'tencent': {
      const t = target as ProviderTargetMap['tencent'];
      return t.fileId && t.sheetId ? `${t.fileId}:${t.sheetId}` : null;
    }
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unsupported provider: ${String(_exhaustive)}`);
    }
  }
}
```

`defaultProviderConfig`/`patchProviderConfig` 同模式改造；`normalizeConfig` 保持逐 provider 显式赋值（任务 2 加 webdav 行）。

- [ ] **步骤 1.4：改造 `credentialStore.ts` / `auditLog.ts` / `urlParse.ts` / `syncEngine.ts`**

`isValidCredentials`：

```ts
function isValidCredentials<P extends CloudProvider>(
  provider: P,
  value: unknown,
): value is ProviderCredentialMap[P] {
  switch (provider) {
    case 'feishu':
      return isValidFeishu(value);
    case 'tencent':
      return isValidTencent(value);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unsupported provider: ${String(_exhaustive)}`);
    }
  }
}
```

`auditLog.sanitizeEntry` provider 行改白名单：

```ts
const PROVIDERS = new Set(['feishu', 'tencent']);
// sanitizeEntry 内：
provider: PROVIDERS.has(entry.provider) ? entry.provider : 'feishu',
```

`urlParse.parseCloudUrl` 与 `syncEngine` 的 `createAdapter`/`applySubKey`/`readSubKey` 同模式加 `default: never` 兜底（syncEngine 的 default 抛 `CloudSyncError('unknown', ...)`）。

- [ ] **步骤 1.5：全量验证行为等价**

运行：`pnpm typecheck` → 预期 0 错误
运行：`pnpm exec vitest run` → 预期 76 文件全绿（938 测试，含新守卫文件）
运行：`pnpm lint` → 预期 0 问题

- [ ] **步骤 1.6：检查点** —— 行为等价确认，不 commit（见头部约定）

---

### 任务 2：类型与配置扩展

**文件：**

- 修改：`utils/cloudSync/types.ts`（`CloudProvider`/`WebDavTarget`/`WebDavCredentials`/两个 Map/`CloudSyncConfig.providers`）
- 修改：`utils/cloudSync/configStore.ts`（webdav 默认配置/归一化/patch/docKey 分支）
- 修改：`utils/cloudSync/credentialStore.ts`（`isValidWebDav`）
- 修改：`utils/cloudSync/auditLog.ts`（PROVIDERS 加 webdav）
- 修改：`utils/cloudSync/urlParse.ts`（webdav 分支抛错）
- 修改：`utils/cloudSync/syncEngine.ts`（webdav 守卫抛错）
- 测试：`tests/utils/cloudSync.providerExhaustive.test.ts`（补 webdav 断言）

- [ ] **步骤 2.1：types.ts 加类型（规格 §3.1 原文）**

```ts
export type CloudProvider = 'feishu' | 'tencent' | 'webdav';

/** WebDAV 目标：用户自选服务器上的备份目录 */
export interface WebDavTarget {
  dirUrl: string | null;
  backupDirUrl: string | null;
  /** 用户已显式确认允许 HTTP 明文传输（规格 §4.4） */
  allowInsecure: boolean;
}

/** WebDAV 凭证：Basic 为主，Bearer 可选（非空则优先） */
export interface WebDavCredentials {
  username: string;
  password: string;
  bearerToken?: string;
}
```

`ProviderTargetMap`/`ProviderCredentialMap`/`CloudSyncConfig['providers']` 各加 `webdav` 键。

- [ ] **步骤 2.2：typecheck 暴露全部待补分支**

运行：`pnpm typecheck`
预期：FAIL——任务 1 的 `never` 兜底与 `Record<CloudProvider, …>` 在每个漏改处报错。逐一按报错位置补 webdav 分支：

- `configStore.defaultProviderConfig`：`case 'webdav': return { ...BASE_PROVIDER_CONFIG, target: { dirUrl: null, backupDirUrl: null, allowInsecure: false } }`
- `configStore.normalizeConfig`：加 `normalized.providers.webdav = normalizeProvider('webdav', providers.webdav, defaults.providers.webdav)`
- `configStore.normalizeProvider`：webdav 时 `mode` 强制 `'encrypted'`（规格 §3.2）
- `configStore.patchProviderConfig`：加 `case 'webdav'` 赋值分支
- `configStore.getDocKey`：`case 'webdav': return t.backupDirUrl ?? null`（dirUrl 有而 backupDirUrl 空视为未就绪）
- `credentialStore`：新增 `isValidWebDav`（bearerToken 非空字符串，或 username+password 均非空字符串）+ switch 加分支
- `auditLog`：`PROVIDERS` 加 `'webdav'`
- `urlParse.parseCloudUrl`：`case 'webdav': throw new Error('webdav does not use document url parsing')`
- `syncEngine.createAdapter/applySubKey/readSubKey`：`case 'webdav': throw new CloudSyncError('unknown', 'webdav uses FileStorageAdapter')`

- [ ] **步骤 2.3：补守卫测试 webdav 断言**

```ts
it('getDocKey：webdav 读 backupDirUrl', () => {
  expect(
    getDocKey('webdav', {
      dirUrl: 'https://x/dav/',
      backupDirUrl: 'https://x/dav/aph-backup/',
      allowInsecure: false,
    }),
  ).toBe('https://x/dav/aph-backup/');
  expect(
    getDocKey('webdav', {
      dirUrl: 'https://x/dav/',
      backupDirUrl: null,
      allowInsecure: false,
    }),
  ).toBeNull();
});

it('patchProviderConfig：webdav 写入自己名下且 mode 强制 encrypted', async () => {
  await patchProviderConfig('webdav', {
    configured: true,
    mode: 'plaintext' as never,
  });
  const config = await getCloudSyncConfig();
  expect(config.providers.webdav.configured).toBe(true);
  expect(config.providers.webdav.mode).toBe('encrypted');
  expect(config.providers.tencent.configured).toBe(false);
});

it('sanitizeEntry：webdav 平台字段不被归入 feishu', () => {
  const entry: AuditEntry = {
    at: 1,
    provider: 'webdav',
    mode: 'encrypted',
    action: 'backup',
    docKey: 'd',
  };
  expect(sanitizeEntry(entry).provider).toBe('webdav');
});
```

- [ ] **步骤 2.4：验证**

运行：`pnpm typecheck` → 0 错误
运行：`pnpm exec vitest run` → 全绿
运行：`pnpm lint` → 0 问题

- [ ] **步骤 2.5：检查点**

---

### 任务 3：单文件密文快照（cryptoSnapshot 扩展）

**文件：**

- 修改：`utils/cloudSync/cryptoSnapshot.ts`（文件末尾追加）
- 测试：`tests/utils/cloudSync.fileSnapshot.test.ts`（创建）

- [ ] **步骤 3.1：编写失败测试**

```ts
// tests/utils/cloudSync.fileSnapshot.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  encryptToSingleFile,
  verifyAndDecryptSingleFile,
} from '@/utils/cloudSync/cryptoSnapshot';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

const MASTER = 'test-master-password';

beforeEach(async () => {
  fakeBrowser.reset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await fakeBrowser.storage.local.set({
    [STORAGE_KEYS.MASTER_PASSWORD]: {
      hashedPassword: 'x',
      salt: 'webdav-test-salt',
    },
  });
});

describe('encryptToSingleFile / verifyAndDecryptSingleFile', () => {
  it('往返：加密后校验解密还原全部条目（order 被剔除）', async () => {
    const entries = [
      makePasswordEntry({ id: 'a', username: 'u1' }),
      makePasswordEntry({ id: 'b' }),
    ];
    const file = await encryptToSingleFile(entries, MASTER, 5000);
    expect(file.version).toBe(1);
    expect(file.count).toBe(2);
    expect(file.exportedAt).toBe(5000);
    const result = await verifyAndDecryptSingleFile(
      JSON.parse(JSON.stringify(file)),
      MASTER,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.entries.map(e => e.id)).toEqual(['a', 'b']);
      expect('order' in result.payload.entries[0]).toBe(false);
    }
  });

  it('snapshotHash 篡改 → snapshotHashMismatch', async () => {
    const file = await encryptToSingleFile([makePasswordEntry()], MASTER);
    const result = await verifyAndDecryptSingleFile(
      { ...file, snapshotHash: 'f'.repeat(64) },
      MASTER,
    );
    expect(result).toEqual({ ok: false, reason: 'snapshotHashMismatch' });
  });

  it('blob 篡改 → snapshotHashMismatch；错误主密码 → decryptFailed', async () => {
    const file = await encryptToSingleFile([makePasswordEntry()], MASTER);
    expect(
      await verifyAndDecryptSingleFile(
        { ...file, blob: file.blob.slice(0, -4) + 'AAAA' },
        MASTER,
      ),
    ).toEqual({ ok: false, reason: 'snapshotHashMismatch' });
    // 绕过 hash 校验只能整体重算：直接构造 hash 正确但密钥错误的场景 = 用另一 salt 派生
    const wrong = await verifyAndDecryptSingleFile(file, 'wrong-password');
    expect(wrong).toEqual({ ok: false, reason: 'decryptFailed' });
  });

  it('version 不符 / blob 空 / exportedAt 非法 / 非对象 → invalidPayload', async () => {
    const file = await encryptToSingleFile([makePasswordEntry()], MASTER);
    expect(
      await verifyAndDecryptSingleFile({ ...file, version: 2 }, MASTER),
    ).toEqual({ ok: false, reason: 'invalidPayload' });
    expect(
      await verifyAndDecryptSingleFile({ ...file, blob: '' }, MASTER),
    ).toEqual({ ok: false, reason: 'invalidPayload' });
    expect(
      await verifyAndDecryptSingleFile(
        { ...file, exportedAt: Number.NaN },
        MASTER,
      ),
    ).toEqual({ ok: false, reason: 'invalidPayload' });
    expect(await verifyAndDecryptSingleFile('garbage', MASTER)).toEqual({
      ok: false,
      reason: 'invalidPayload',
    });
    expect(await verifyAndDecryptSingleFile(null, MASTER)).toEqual({
      ok: false,
      reason: 'invalidPayload',
    });
  });

  it('载荷含非法条目 → 跳过并计数，合法条目保留', async () => {
    const file = await encryptToSingleFile(
      [makePasswordEntry({ id: 'ok' })],
      MASTER,
    );
    // 解密后手工注入非法条目再验证 parseSnapshotPayload 行为：直接测 parseSnapshotPayload
    const { parseSnapshotPayload } =
      await import('@/utils/cloudSync/cryptoSnapshot');
    const parsed = parseSnapshotPayload({
      version: 1,
      exportedAt: 1,
      count: 2,
      entries: [{ id: 'ok', username: 'u' }, { id: '' }, null],
    });
    expect(parsed?.entries).toHaveLength(1);
    void file;
  });
});
```

- [ ] **步骤 3.2：运行验证失败**

运行：`pnpm exec vitest run tests/utils/cloudSync.fileSnapshot.test.ts`
预期：FAIL（`encryptToSingleFile` 未导出）

- [ ] **步骤 3.3：实现（cryptoSnapshot.ts 末尾追加）**

```ts
/** WebDAV 单文件快照格式（不分片，规格 §5.1） */
export interface SingleFileSnapshot {
  version: 1;
  exportedAt: number;
  count: number;
  /** blob 的 SHA-256（hex） */
  snapshotHash: string;
  /** Base64(IV[12] + AES-256-GCM 密文)，即 encryptData 输出 */
  blob: string;
}

/** 整库加密为单文件快照（复用既有 PBKDF2 600k + 随机 IV + GCM 路径） */
export async function encryptToSingleFile(
  entries: PasswordEntry[],
  masterPassword: string,
  exportedAt = Date.now(),
): Promise<SingleFileSnapshot> {
  const payload = buildSnapshotPayload(entries, exportedAt);
  const hexKey = await deriveEncryptionKey(masterPassword);
  const blob = await encryptData(JSON.stringify(payload), hexKey);
  return {
    version: SNAPSHOT_FORMAT_VERSION,
    exportedAt,
    count: entries.length,
    snapshotHash: await sha256Hex(blob),
    blob,
  };
}

/** 单文件恢复校验链（规格 §5.2，串行，任一失败即拒绝） */
export async function verifyAndDecryptSingleFile(
  raw: unknown,
  masterPassword: string,
): Promise<RestoreResult> {
  if (!raw || typeof raw !== 'object')
    return { ok: false, reason: 'invalidPayload' };
  const file = raw as Partial<SingleFileSnapshot>;
  if (file.version !== SNAPSHOT_FORMAT_VERSION)
    return { ok: false, reason: 'invalidPayload' };
  if (typeof file.blob !== 'string' || file.blob === '')
    return { ok: false, reason: 'invalidPayload' };
  if (typeof file.exportedAt !== 'number' || !Number.isFinite(file.exportedAt))
    return { ok: false, reason: 'invalidPayload' };
  if (
    typeof file.snapshotHash !== 'string' ||
    (await sha256Hex(file.blob)) !== file.snapshotHash
  ) {
    return { ok: false, reason: 'snapshotHashMismatch' };
  }
  let plaintext: string;
  try {
    plaintext = await decryptData(
      file.blob,
      await deriveEncryptionKey(masterPassword),
    );
  } catch {
    return { ok: false, reason: 'decryptFailed' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext) as unknown;
  } catch {
    return { ok: false, reason: 'invalidPayload' };
  }
  const payload = parseSnapshotPayload(parsed);
  return payload
    ? { ok: true, payload }
    : { ok: false, reason: 'invalidPayload' };
}
```

- [ ] **步骤 3.4：运行验证通过**

运行：`pnpm exec vitest run tests/utils/cloudSync.fileSnapshot.test.ts tests/utils/cloudSync.crypto.test.ts`
预期：PASS（新文件 + 既有密文测试不回归）

- [ ] **步骤 3.5：检查点**（typecheck + lint 过）

---

### 任务 4：FileStorageAdapter 接口 + WebDAV 适配器

**文件：**

- 创建：`utils/cloudSync/adapters/fileStorage.ts`
- 创建：`utils/cloudSync/adapters/webdav.ts`
- 测试：`tests/utils/cloudSync.webdav.test.ts`（创建，文件头 `// @vitest-environment jsdom`）

- [ ] **步骤 4.1：创建接口文件（规格 §4.1 原文）**

```ts
// utils/cloudSync/adapters/fileStorage.ts
/** 远程文件元信息（由 PROPFIND 解析） */
export interface RemoteFile {
  name: string;
  url: string;
  size: number;
}

/** 适配器运行期选项复用表格侧定义 */
import type { AdapterOptions } from '../types';

/**
 * 文件存储适配器（与 TableAdapter 并列，规格 §4.1）
 *
 * 文件协议不硬套表格语义：无 recordId、无字段、无单元格上限。
 */
export interface FileStorageAdapter {
  readonly provider: 'webdav';
  testConnection(): Promise<void>;
  ensureDirectory(): Promise<void>;
  listFiles(): Promise<RemoteFile[]>;
  putFile(name: string, content: string): Promise<void>;
  getFile(url: string, expectedSize?: number): Promise<string>;
  deleteFile(url: string): Promise<void>;
}

export type { AdapterOptions };
```

- [ ] **步骤 4.2：编写适配器失败测试（核心用例，完整清单见规格 §9 第一行）**

```ts
// @vitest-environment jsdom
// tests/utils/cloudSync.webdav.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WebDavAdapter,
  mapWebDavStatus,
  normalizeWebDavDirUrl,
  buildBasicAuthHeader,
  needsInsecureConfirm,
} from '@/utils/cloudSync/adapters/webdav';

const CREDS = { username: 'user', password: 'pass' };

function stubFetchSequence(
  responses: {
    status?: number;
    body?: string;
    headers?: Record<string, string>;
  }[],
) {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return new Response(next.body ?? '', {
        status: next.status ?? 200,
        headers: next.headers,
      });
    }),
  );
  return { calls };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeAdapter(dirUrl = 'https://dav.example.com/dav/') {
  return new WebDavAdapter({ dirUrl, credentials: CREDS });
}

describe('认证头', () => {
  it('无 bearerToken → Basic base64(user:pass)', () => {
    expect(buildBasicAuthHeader('user', 'pass')).toBe(
      `Basic ${btoa('user:pass')}`,
    );
  });
  it('非 ASCII 用户名不抛错', () => {
    expect(() => buildBasicAuthHeader('张三', 'pass')).not.toThrow();
  });
  it('bearerToken 非空 → Bearer 优先', async () => {
    const { calls } = stubFetchSequence([
      { status: 207, body: '<d:multistatus xmlns:d="DAV:"/>' },
    ]);
    await new WebDavAdapter({
      dirUrl: 'https://x/dav/',
      credentials: { username: 'u', password: 'p', bearerToken: 'tk' },
    }).testConnection();
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBe('Bearer tk');
  });
});

describe('URL 归一化与安全校验', () => {
  it('补尾斜杠并派生 aph-backup/ 子目录', () => {
    expect(normalizeWebDavDirUrl('https://x/dav')).toBe('https://x/dav/');
  });
  it('https 通过；localhost http 通过；内网 http 需确认；ftp 拒绝', () => {
    expect(needsInsecureConfirm('https://x/dav/')).toBe(false);
    expect(needsInsecureConfirm('http://localhost/dav/')).toBe(false);
    expect(needsInsecureConfirm('http://192.168.1.5/dav/')).toBe(true);
    expect(() => needsInsecureConfirm('ftp://x/dav/')).toThrow();
  });
});

describe('PROPFIND 解析', () => {
  it('多命名空间前缀均按 localName 解析；过滤集合自身与非 aph 文件', async () => {
    const xml = `<D:multistatus xmlns:D="DAV:">
      <D:response><D:href>/dav/aph-backup/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>
      <D:response><D:href>/dav/aph-backup/aph-20260924101530-k3n9x2.aphdav</D:href><D:propstat><D:prop><D:resourcetype/><D:getcontentlength>123</D:getcontentlength></D:prop></D:propstat></D:response>
      <D:response><D:href>/dav/aph-backup/notes.txt</D:href><D:propstat><D:prop><D:resourcetype/></D:prop></D:propstat></D:response>
    </D:multistatus>`;
    stubFetchSequence([{ status: 207, body: xml }]);
    const files = await makeAdapter().listFiles();
    expect(files).toEqual([
      {
        name: 'aph-20260924101530-k3n9x2.aphdav',
        url: 'https://dav.example.com/dav/aph-backup/aph-20260924101530-k3n9x2.aphdav',
        size: 123,
      },
    ]);
  });
  it('非 XML 响应 → unknown 错误', async () => {
    stubFetchSequence([{ status: 207, body: 'not xml' }]);
    await expect(makeAdapter().listFiles()).rejects.toMatchObject({
      kind: 'unknown',
    });
  });
});

describe('MKCOL / PUT / GET / DELETE', () => {
  it('MKCOL 201 与 405 均视为成功', async () => {
    stubFetchSequence([{ status: 201 }, { status: 405 }]);
    const adapter = makeAdapter();
    await expect(adapter.ensureDirectory()).resolves.toBeUndefined();
    await expect(adapter.ensureDirectory()).resolves.toBeUndefined();
  });
  it('MKCOL 409 → notFound', async () => {
    stubFetchSequence([{ status: 409 }]);
    await expect(makeAdapter().ensureDirectory()).rejects.toMatchObject({
      kind: 'notFound',
    });
  });
  it('PUT 用 encodeURIComponent 文件名；GET 返回文本；DELETE 404 视为成功', async () => {
    const { calls } = stubFetchSequence([
      { status: 201 },
      { status: 200, body: 'content' },
      { status: 404 },
    ]);
    const adapter = makeAdapter();
    await adapter.putFile('aph-1.aphdav', 'content');
    expect(calls[0].init.method).toBe('PUT');
    await expect(
      adapter.getFile('https://dav.example.com/dav/aph-backup/aph-1.aphdav'),
    ).resolves.toBe('content');
    await expect(
      adapter.deleteFile('https://dav.example.com/dav/aph-backup/gone.aphdav'),
    ).resolves.toBeUndefined();
  });
  it('getFile 超 50MB 上限 → tooLarge', async () => {
    stubFetchSequence([{ status: 200, body: 'x' }]);
    await expect(
      makeAdapter().getFile('https://x/f.aphdav', 51 * 1024 * 1024),
    ).rejects.toMatchObject({ kind: 'tooLarge' });
  });
});

describe('mapWebDavStatus：状态码映射全表', () => {
  it('按规格 §4.3 映射', () => {
    expect(mapWebDavStatus(401, 'x').kind).toBe('invalidCredential');
    expect(mapWebDavStatus(403, 'x').kind).toBe('permission');
    expect(mapWebDavStatus(404, 'x').kind).toBe('notFound');
    expect(mapWebDavStatus(407, 'x').kind).toBe('permission');
    expect(mapWebDavStatus(409, 'x').kind).toBe('notFound');
    expect(mapWebDavStatus(413, 'x').kind).toBe('tooLarge');
    expect(mapWebDavStatus(423, 'x').kind).toBe('writeConflict');
    expect(mapWebDavStatus(429, 'x').kind).toBe('rateLimit');
    expect(mapWebDavStatus(507, 'x').kind).toBe('quota');
    expect(mapWebDavStatus(500, 'x').kind).toBe('network');
    expect(mapWebDavStatus(418, 'x').kind).toBe('unknown');
  });
});
```

- [ ] **步骤 4.3：运行验证失败**

运行：`pnpm exec vitest run tests/utils/cloudSync.webdav.test.ts`
预期：FAIL（模块不存在）

- [ ] **步骤 4.4：实现 `webdav.ts`**

关键实现要点（完整代码在实现时按此结构编写）：

```ts
/**
 * WebDAV 文件存储适配器（规格 §4）
 *
 * 运行上下文约束：DOMParser 是 Window API，Service Worker 中不存在。
 * 本模块仅可在 Options 页面使用，严禁被 background/content 入口 import。
 */
import { CloudSyncError } from '../errors';
import type { WebDavCredentials } from '../types';
import type { FileStorageAdapter, RemoteFile } from './fileStorage';
import {
  isTransientStatus,
  requestWithRetry,
  type RetryContext,
} from './httpClient';

export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const BACKUP_DIR_NAME = 'aph-backup/';
export const FILE_PREFIX = 'aph-';
export const FILE_SUFFIX = '.aphdav';

export function buildBasicAuthHeader(
  username: string,
  password: string,
): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

export function normalizeWebDavDirUrl(dirUrl: string): string {
  /* URL 解析 + 补尾斜杠；非法 URL 抛 notFound */
}
export function needsInsecureConfirm(dirUrl: string): boolean {
  /* https→false；http+localhost→false；http 其他→true；其他协议抛 notFound */
}
export function mapWebDavStatus(
  status: number,
  message: string,
): CloudSyncError {
  /* 规格 §4.3 全表 */
}

export class WebDavAdapter implements FileStorageAdapter {
  readonly provider = 'webdav' as const;
  // constructor(init: { dirUrl, credentials, options? })
  // backupDirUrl = normalizeWebDavDirUrl(dirUrl) + BACKUP_DIR_NAME
  // authHeader(): bearerToken 非空 → Bearer；否则 Basic
  // private async request(method, url, body?, depth?): 复用 requestWithRetry，
  //   shouldRetry = isTransientStatus；!response.ok → mapWebDavStatus 抛出；返回 response
  // testConnection(): PROPFIND backupDirUrl Depth 0；404 时降级 PROPFIND dirUrl Depth 0 并提示目录将自动创建
  // ensureDirectory(): MKCOL backupDirUrl；201/405 成功；其余经 request 抛错
  // listFiles(): PROPFIND Depth 1 → response.text() → DOMParser 解析：
  //   按 localName 取 response/href/propstat/prop/resourcetype/getcontentlength；
  //   含 collection 的跳过；href 取 basename（最后一个 / 之后）→ decodeURIComponent（失败用原值）；
  //   仅保留 aph- 前缀 + .aphdav 后缀；url 用 backupDirUrl + encodeURIComponent(name) 重建（不信任 href 绝对性）
  // putFile(name, content): PUT fileUrl，body=content，Content-Type: application/octet-stream
  // getFile(url, expectedSize?): expectedSize 超限先抛 tooLarge；GET → text()；文本长度超限再抛 tooLarge
  // deleteFile(url): DELETE；404 视为成功（request 需支持 okStatuses 白名单）
}
```

- [ ] **步骤 4.5：运行验证通过**

运行：`pnpm exec vitest run tests/utils/cloudSync.webdav.test.ts`
预期：PASS

- [ ] **步骤 4.6：检查点**（typecheck + lint + prettier --check 新文件）

---

### 任务 5：runContext 提取（纯搬迁）

**文件：**

- 创建：`utils/cloudSync/runContext.ts`
- 修改：`utils/cloudSync/syncEngine.ts`（删除三个函数定义，改为 import）
- 测试：既有 `tests/utils/cloudSync.syncEngine.test.ts`（不改，作行为等价守卫）

- [ ] **步骤 5.1：搬迁**

把 `syncEngine.ts` 的 `emptyStats()`（L78-80）、`loadReadyContext()`（L144-160）、`buildReport()`（L529-560）**原样剪切**到 `runContext.ts` 并导出；`syncEngine.ts` 改为 `import { buildReport, emptyStats, loadReadyContext } from './runContext'`。`loadReadyContext` 依赖的 `getCloudSyncConfig`/`getDocKey`/`loadCredentials`/`CloudSyncError` import 一并搬过去。

- [ ] **步骤 5.2：验证行为等价**

运行：`pnpm typecheck` → 0 错误
运行：`pnpm exec vitest run tests/utils/cloudSync.syncEngine.test.ts` → 31 测试全绿（零改动通过即证明等价）

- [ ] **步骤 5.3：检查点**

---

### 任务 6：webdavSync 编排

**文件：**

- 创建：`utils/cloudSync/webdavSync.ts`
- 测试：`tests/utils/cloudSync.webdavSync.test.ts`（创建）

- [ ] **步骤 6.1：编写失败测试（核心用例，完整清单见规格 §9 第三行）**

mock 面：`./adapters/webdav`（`WebDavAdapter` 类）、`@/utils/storage/passwordCrud`、`./credentialStore`、`./taskLock`、`./auditLog`（仅 `appendAuditLog`，`makeAuditEntry` 用真实）；`configStore`/`snapshotStore`/`cryptoSnapshot`/`runContext` 用真实实现（fakeBrowser 提供 storage）。测试骨架沿用 `cloudSync.syncEngine.test.ts` 的 `vi.hoisted` + FakeAdapter 模式：

```ts
// tests/utils/cloudSync.webdavSync.test.ts（骨架）
const h = vi.hoisted(() => {
  const state = {
    files: [] as { name: string; url: string; size: number }[],
    putCalls: [] as { name: string; content: string }[],
    deleted: [] as string[],
    putError: null as unknown,
    ensureError: null as unknown,
  };
  class FakeWebDavAdapter {
    provider = 'webdav' as const;
    constructor(init: { dirUrl: string }) {
      state.lastDirUrl = init.dirUrl;
    }
    async testConnection() {}
    async ensureDirectory() {
      if (state.ensureError) throw state.ensureError;
    }
    async listFiles() {
      return state.files;
    }
    async putFile(name: string, content: string) {
      if (state.putError) throw state.putError;
      state.putCalls.push({ name, content });
    }
    async getFile(url: string) {
      const file = state.files.find(f => f.url === url);
      const put = state.putCalls.find(
        p => state.backupDirUrl + encodeURIComponent(p.name) === url,
      );
      if (put) return put.content;
      throw Object.assign(new Error('not found'), { kind: 'notFound' });
    }
    async deleteFile(url: string) {
      state.deleted.push(url);
      state.files = state.files.filter(f => f.url !== url);
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
vi.mock('@/utils/cloudSync/adapters/webdav', async importOriginal => ({
  ...(await importOriginal<object>()),
  WebDavAdapter: h.FakeWebDavAdapter,
}));
// ……其余 mock 同 syncEngine 测试模式

describe('runWebDavBackup', () => {
  it('成功：PUT 单文件 + 写 meta + stats.created=1 + 释放锁', async () => {
    /* 断言 meta.snapshotGroupId === putCalls[0].name */
  });
  it('超保留数清理：keepVersions=3 时 5 版删 2（删最旧）', async () => {
    /* 预置 4 旧文件 + 本次 1 新文件 */
  });
  it('清理失败不回滚备份：deleteFile 抛错 → 报告 failures 含该条，meta 已写', async () => {});
  it('allowInsecure → 报告含 insecureTransport 警告', async () => {});
  it('锁占用 → writeConflict 且不释放他人锁', async () => {});
  it('凭证四态 empty/locked/corrupted → invalidCredential', async () => {});
  it('取消（signal.aborted）→ cancelled=true 仍释放锁', async () => {});
  it('审计失败 → auditLogFailed 警告', async () => {});
});

describe('runWebDavRestore', () => {
  it('增量合并三分支：本地无→added；云端新→updated；本地新→skipped；绝不删除本地', async () => {});
  it('versionName 指定版本恢复；不存在 → notFound', async () => {});
  it('未指定时 meta 文件名匹配优先；meta 缺失取最新', async () => {});
  it('列表为空 → notFound', async () => {});
  it('校验失败（篡改）→ schema 错误', async () => {});
});

describe('prepareWebDavTarget', () => {
  it('http 内网未确认 → 抛错；已确认 → target.allowInsecure=true 回写配置', async () => {});
  it('成功：MKCOL + 回写 configured/backupDirUrl + 审计 prepareTarget', async () => {});
});

describe('listWebDavVersions', () => {
  it('按文件名时间戳解析 exportedAt 并降序；解析失败回退 0', async () => {});
});
```

- [ ] **步骤 6.2：运行验证失败**

运行：`pnpm exec vitest run tests/utils/cloudSync.webdavSync.test.ts`
预期：FAIL（模块不存在）

- [ ] **步骤 6.3：实现 `webdavSync.ts`（按规格 §6.2-§6.5 流程逐条实现）**

导出：`prepareWebDavTarget`/`runWebDavBackup`/`runWebDavRestore`/`clearOldWebDavVersions`/`listWebDavVersions`（签名见规格 §6.2）。关键实现约束：

1. 文件名生成：`aph-${utcCompactTimestamp()}-${randomSuffix(6)}.aphdav`（`utcCompactTimestamp` = `toISOString()` 去符号取 14 位；随机后缀 `Math.random().toString(36).slice(2, 8)`，不足 6 位补齐）
2. `listWebDavVersions` 的 `exportedAt` 从文件名正则 `/^aph-(\d{14})-/` 解析为 `Date.UTC(...)` 毫秒；解析失败为 0；按 `exportedAt` 降序、同值按文件名降序
3. 备份流程严格按规格 §6.3 的 14 步；恢复按 §6.4 的 9 步（版本选择优先级：versionName → meta.snapshotGroupId 匹配 → 最新）
4. `prepareWebDavTarget` 内部独立重算 `needsInsecureConfirm(dirUrl)`，为 true 且 `options.allowInsecure !== true` 时抛 `CloudSyncError('notFound', 'insecure transport requires explicit confirmation')`
5. 所有 run 函数 `finally` 释放锁；`isAbortError` → `cancelled: true` 不抛
6. 日志与审计绝不出现凭证/密码/blob 内容

- [ ] **步骤 6.4：运行验证通过**

运行：`pnpm exec vitest run tests/utils/cloudSync.webdavSync.test.ts`
预期：PASS

- [ ] **步骤 6.5：检查点**（typecheck + lint）

---

### 任务 7：i18n 文案（中英同步）

**文件：**

- 修改：`utils/i18n/locales/zh-CN/cloudSync.json`
- 修改：`utils/i18n/locales/en/cloudSync.json`
- 测试：既有 `tests/utils/i18nBundles.test.ts`（key 对齐守卫）

- [ ] **步骤 7.1：zh-CN 新增 key（插入到对应分组位置）**

```json
"cloudSync.provider.webdav": "WebDAV 网盘",
"cloudSync.webdav.dirUrl": "远程目录",
"cloudSync.webdav.dirUrlPlaceholder": "如 https://dav.jianguoyun.com/dav/ 或 Nextcloud 的 /remote.php/dav/files/<用户名>/",
"cloudSync.webdav.dirUrlTip": "填写 WebDAV 服务的目录地址，扩展会在其下自动创建 aph-backup 子目录存放加密备份。坚果云需使用「应用密码」，非账号登录密码。",
"cloudSync.webdav.username": "用户名",
"cloudSync.webdav.usernamePlaceholder": "WebDAV 登录用户名",
"cloudSync.webdav.password": "密码",
"cloudSync.webdav.passwordPlaceholder": "WebDAV 密码或应用密码",
"cloudSync.webdav.passwordTip": "坚果云请使用安全设置中生成的「应用密码」。",
"cloudSync.webdav.bearerToken": "Bearer Token（可选）",
"cloudSync.webdav.bearerTokenPlaceholder": "填写后优先于用户名/密码",
"cloudSync.webdav.bearerTokenTip": "仅当你的 WebDAV 网关使用 Token 鉴权时填写。",
"cloudSync.webdav.advanced": "高级",
"cloudSync.webdav.encryptedOnly": "WebDAV 仅支持密文备份：整库加密为单个不可读文件上传，云端无法查看或编辑条目内容。",
"cloudSync.webdav.allowInsecure": "我了解该地址不使用加密传输，凭证与密文将以明文经过网络",
"cloudSync.webdav.versionSelect": "恢复版本",
"cloudSync.webdav.versionLatest": "最新（{time}）",
"cloudSync.webdav.versionSize": "{size}",
"cloudSync.webdav.directoryReady": "备份目录已就绪。",
"cloudSync.webdav.directoryCreated": "已创建备份目录并完成配置。",
"cloudSync.warning.insecureTransport": "当前 WebDAV 地址未使用 HTTPS，凭证与密文以明文经过网络，建议改用加密传输。"
```

- [ ] **步骤 7.2：en 新增同 key 集（英文文案，逐条对应翻译）**

```json
"cloudSync.provider.webdav": "WebDAV",
"cloudSync.webdav.dirUrl": "Remote directory",
"cloudSync.webdav.dirUrlPlaceholder": "e.g. https://dav.example.com/dav/ or Nextcloud /remote.php/dav/files/<user>/",
"cloudSync.webdav.dirUrlTip": "Enter the WebDAV directory URL. The extension creates an aph-backup subdirectory for encrypted backups. For Jianguoyun, use an app password instead of your account password.",
"cloudSync.webdav.username": "Username",
"cloudSync.webdav.usernamePlaceholder": "WebDAV username",
"cloudSync.webdav.password": "Password",
"cloudSync.webdav.passwordPlaceholder": "WebDAV password or app password",
"cloudSync.webdav.passwordTip": "For Jianguoyun, use an app password generated in security settings.",
"cloudSync.webdav.bearerToken": "Bearer Token (optional)",
"cloudSync.webdav.bearerTokenPlaceholder": "Takes precedence over username/password when set",
"cloudSync.webdav.bearerTokenTip": "Only for WebDAV gateways that use token auth.",
"cloudSync.webdav.advanced": "Advanced",
"cloudSync.webdav.encryptedOnly": "WebDAV supports encrypted backup only: the vault is encrypted into a single unreadable file. The cloud cannot view or edit entries.",
"cloudSync.webdav.allowInsecure": "I understand this address uses no encryption; credentials and ciphertext travel the network in plaintext",
"cloudSync.webdav.versionSelect": "Restore version",
"cloudSync.webdav.versionLatest": "Latest ({time})",
"cloudSync.webdav.versionSize": "{size}",
"cloudSync.webdav.directoryReady": "Backup directory is ready.",
"cloudSync.webdav.directoryCreated": "Backup directory created and configured.",
"cloudSync.warning.insecureTransport": "The WebDAV address does not use HTTPS; credentials and ciphertext travel in plaintext. Switch to encrypted transport if possible."
```

- [ ] **步骤 7.3：验证**

运行：`pnpm exec vitest run tests/utils/i18nBundles.test.ts`
预期：PASS（zh/en key 集对齐）
运行：`pnpm exec prettier --check utils/i18n/locales/zh-CN/cloudSync.json utils/i18n/locales/en/cloudSync.json`
预期：通过

- [ ] **步骤 7.4：检查点**

---

### 任务 8：CloudSyncDialog 第三页签

**文件：**

- 修改：`components/options/CloudSyncDialog.vue`

- [ ] **步骤 8.1：模板改动**

1. `el-tabs` 加 `<el-tab-pane :label="t('cloudSync.provider.webdav')" name="webdav" />`
2. 模式选择 `el-form-item` 加 `v-if="activeProvider !== 'webdav'"`；webdav 时显示 `cloudSync.webdav.encryptedOnly` 说明块
3. 凭证区加 `v-else-if="activeProvider === 'webdav'"` 分支：dirUrl（复用 `targetUrl` 输入框，placeholder 换 `cloudSync.webdav.dirUrlPlaceholder`）、username、password（`show-password` + `autocomplete="new-password"`）、折叠「高级」区（`el-collapse`）内 bearerToken
4. `allowInsecure` 勾选框：`v-if="activeProvider === 'webdav' && webdavNeedsInsecure"`，未勾选时测试连接/备份按钮 `disabled`
5. 恢复按钮点击流程：webdav 时先 `listWebDavVersions()` 填充 `el-select` 版本下拉（默认最新），确认弹窗带下拉选择
6. 状态区目标显示：webdav 显示 `backupDirUrl`

- [ ] **步骤 8.2：脚本改动（全部穷尽 switch，规格 §7.4）**

1. `providerForms` 加 webdav 默认项（TS 强制）
2. 新增 `webdavCredentials = reactive({ username: '', password: '', bearerToken: '' })`
3. `currentCredentials()`/`loadCredentialState()`/`loadConfig()` 改穷尽 switch 加 webdav 分支
4. `credentialsComplete()`：webdav 规则 = `bearerToken` 非空 或 (`username` 且 `password`)
5. 新增 `webdavNeedsInsecure = computed(...)` 调用 `needsInsecureConfirm`（try/catch，非法 URL 返回 false 由后端校验兜底）
6. `handleTestConnection()`：webdav 分支调 `prepareWebDavTarget(currentCredentials(), targetUrl, { allowInsecure })`，成功提示 `directoryReady`/`directoryCreated`
7. `runWithMasterPassword()`：webdav 时 backup → `runWebDavBackup`、restore → `runWebDavRestore({ versionName: selectedVersion })`；rebuild/sync 对 webdav 不可达（按钮已隐藏）
8. `handleClearVersions()`：webdav 分支调 `clearOldWebDavVersions`
9. 新增 `webdavVersions` ref + `selectedVersion` ref + `handleRestore` webdav 分支（先拉版本列表）

- [ ] **步骤 8.3：验证**

运行：`pnpm typecheck` → 0 错误
运行：`pnpm lint` → 0 问题
运行：`pnpm lint:style` → 0 问题
运行：`pnpm exec vitest run` → 全绿
运行：`pnpm build` → 成功，`CloudSyncDialog` chunk 体积增量合理（预期 +10~20 kB）

- [ ] **步骤 8.4：检查点**

---

### 任务 9：文档同步

**文件：**

- 修改：`README.md` / `README.en.md`（云同步功能段补 WebDAV：支持的服务商示例、坚果云应用密码、HTTP 风险、仅密文备份）
- 修改：`docs/ARCHITECTURE.md` / `.en.md`（「功能实现详解 → 云文档同步」补：`FileStorageAdapter` 与 `TableAdapter` 并列关系图、单文件快照格式、恢复校验链、传输安全策略、runContext 共享基元）
- 修改：`privacy.html` / `privacy.en.html`（「可选云文档同步」段补 WebDAV：目标服务器由用户自选、默认关闭、仅上传密文单文件、凭证以会话密钥加密存储、HTTP 模式明文传输风险）
- 修改：`docs/CWS_FILL_CONTENT.md`（隐私口径补 WebDAV；权限无变化说明）
- 修改：`docs/superpowers/specs/2026-09-23-cloud-doc-sync-design.md`（§3 末尾加一行：「§3.4 WebDAV：见 `2026-09-24-webdav-sync-design.md`」）

- [ ] **步骤 9.1：逐文件更新（中英文表达同一事实）**
- [ ] **步骤 9.2：验证**

运行：`pnpm exec prettier --check README.md README.en.md docs/ARCHITECTURE.md docs/ARCHITECTURE.en.md docs/CWS_FILL_CONTENT.md docs/superpowers/specs/2026-09-23-cloud-doc-sync-design.md`
预期：通过（privacy.html 非 prettier 目标则跳过）

- [ ] **步骤 9.3：检查点**

---

### 任务 10：全量验证矩阵

- [ ] **步骤 10.1：** `pnpm typecheck` → 0 错误
- [ ] **步骤 10.2：** `pnpm lint` → 0 问题（--max-warnings 0）
- [ ] **步骤 10.3：** `pnpm lint:style` → 0 问题
- [ ] **步骤 10.4：** `pnpm exec vitest run` → 全绿（预期 80 文件 / 约 1010+ 测试）
- [ ] **步骤 10.5：** `pnpm build` → 成功；确认 webdav 模块只出现在 Options 相关 chunk，**不出现在 `background.js`**（用 `findstr /C:"webdav" .output\chrome-mv3\background.js` 验证为空）
- [ ] **步骤 10.6：** 改动文件 `pnpm exec prettier --check`
- [ ] **步骤 10.7：** 交付说明：改了什么、关键设计原因、验证结果、残余风险（真实 WebDAV 服务器联调未做，PROPFIND 兼容性以规格 §11.6 缓解措施为准）

---

## 自检记录

1. **规格覆盖度**：§2→任务1；§3→任务2；§4→任务4；§5→任务3；§6→任务5/6；§7→任务8；§8→任务7；§9→各任务测试步骤+任务10；§10→任务9；§11→实现约束内嵌各任务；§12 实施顺序与任务序一致。无遗漏。
2. **占位符扫描**：任务 4/6 的实现步骤给出结构骨架+关键约束而非逐行代码（webdav.ts 约 350 行、webdavSync.ts 约 300 行，逐行代码在实现时按规格 §4/§6 编写）；测试步骤给出完整核心用例。无 TODO/待定。
3. **类型一致性**：`RemoteFile`/`FileStorageAdapter`/`SingleFileSnapshot`/`WebDavTarget`/`WebDavCredentials`/`PrepareWebDavResult` 命名跨任务一致；`listWebDavVersions` 返回结构在任务 6 定义、任务 8 消费一致；`needsInsecureConfirm`/`buildBasicAuthHeader`/`normalizeWebDavDirUrl`/`mapWebDavStatus` 在任务 4 导出、任务 6/8 引用一致。
