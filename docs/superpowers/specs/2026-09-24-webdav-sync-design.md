# WebDAV 密文备份同步设计规格

- 日期：2026-09-24
- 版本：V1.0
- 状态：待用户审查
- 范围：在既有「云文档同步」（飞书多维表格 / 腾讯智能表）体系中新增 **WebDAV** 平台，仅支持**密文快照备份 + 手动恢复**
- 前置规格：`docs/superpowers/specs/2026-09-23-cloud-doc-sync-design.md`（V1.2，本规格复用其基础设施与约定）

## 1. 背景与目标

现有云同步把密码条目同步到飞书/腾讯的**在线表格**，定位是「云端可查看编辑」。用户还需要一种「备份到自建/私有云」的能力——WebDAV 是密码管理器领域的事实标准协议（KeePass、Bitwarden 均支持），国内坚果云、自建 Nextcloud/ownCloud、群晖 WebDAV Server 都提供该服务。

WebDAV 是**文件协议**（PUT/GET/PROPFIND/MKCOL/DELETE）而非表格 API，因此本功能定位为：

> 整库加密为**单个不可读文件**上传到用户自选的 WebDAV 服务器，支持多版本保留与手动恢复。

与飞书/腾讯形成互补：后者是「云端表格」，前者是「私有云加密备份」。

### 1.1 已确认固化决策

| 决策点     | 结论                                                                                    |
| ---------- | --------------------------------------------------------------------------------------- |
| 同步模式   | **仅密文快照备份 + 手动恢复**；不做明文、不做行级双向 diff                              |
| 版本保留   | 保留最近 N 版（复用全局 `keepVersions`，默认 3，可选 1/3/5/10）                         |
| 恢复粒度   | **可选择任意保留版本恢复**（默认最新），非仅最新版                                      |
| 认证方式   | Basic 为主 + 可选 Bearer Token（二选一，Bearer 优先）                                   |
| 架构归属   | 作为**第三个 provider** 并入现有云同步体系，复用凭证/锁/审计/报告/加密校验链            |
| 适配器抽象 | 新增 `FileStorageAdapter`，与 `TableAdapter` **并列**（不硬套表格语义）                 |
| 分片       | **不分片**（文件系统无单元格上限）；保留 `snapshotHash` 完整性校验                      |
| 传输安全   | 要求 HTTPS；HTTP 需用户**显式勾选确认**且每次备份报告常驻警告（不硬阻断，兼顾内网 NAS） |
| 权限       | **无新增 Chrome 权限**（`host_permissions: ['<all_urls>']` 已覆盖）                     |
| 依赖       | **零新增依赖**（`fetch` + `DOMParser` + `btoa` 均为原生）                               |
| 触发方式   | 仅手动（云文档同步弹窗 → WebDAV 页签），无定时/后台同步                                 |

### 1.2 多设备约束

沿用前置规格 §1.2 的立场：**不原生支持多设备并发**。文件名含 6 位随机后缀，仅保证多设备同秒备份不互相覆盖，不做冲突合并。恢复为纯增量合并，绝不删除本地条目。

## 2. 前置结构加固：消除 provider 二元分支（P0）

> ⚠️ **这是本功能的先决条件，不是可选优化。**

现有代码广泛使用 `provider === 'feishu' ? A : B` 形式的二元判断。引入第三个 provider 后，`'webdav'` 会**静默落入 tencent 分支**，造成配置写错位置、凭证校验恒失败、审计日志记错平台等**无报错的数据错误**。

### 2.1 必须改造的分支清单

| 文件                                     | 位置                                           | 现状                                   | 未改造的后果                                              |
| ---------------------------------------- | ---------------------------------------------- | -------------------------------------- | --------------------------------------------------------- |
| `utils/cloudSync/configStore.ts`         | `defaultProviderConfig`                        | `if feishu … return tencent`           | webdav 拿到腾讯 target 结构                               |
| `utils/cloudSync/configStore.ts`         | `normalizeConfig`                              | 仅归一化 feishu/tencent                | webdav 配置丢失，每次读回默认值                           |
| `utils/cloudSync/configStore.ts`         | `patchProviderConfig`                          | `if feishu … else tencent`             | **webdav 配置写入 tencent 名下**                          |
| `utils/cloudSync/configStore.ts`         | `getDocKey`                                    | `if feishu … else tencent`             | 读 `fileId/sheetId` 恒 `null` → 永远「未配置」            |
| `utils/cloudSync/credentialStore.ts`     | `isValidCredentials`                           | `feishu ? … : isValidTencent`          | 用腾讯 schema 校验 → 凭证恒 `empty`                       |
| `utils/cloudSync/auditLog.ts`            | `sanitizeEntry`                                | `=== 'tencent' ? 'tencent' : 'feishu'` | **审计日志把 webdav 记为 feishu**                         |
| `utils/cloudSync/urlParse.ts`            | `parseCloudUrl`                                | `feishu ? … : parseTencentUrl`         | webdav 误入腾讯解析（本设计不走此函数，仍需穷尽化防误用） |
| `utils/cloudSync/syncEngine.ts`          | `createAdapter` / `applySubKey` / `readSubKey` | `if feishu … else tencent`             | webdav 误建 TencentAdapter                                |
| `components/options/CloudSyncDialog.vue` | `currentCredentials`                           | `feishu ? … : {tencent}`               | **把腾讯凭证当 webdav 凭证保存**                          |
| `components/options/CloudSyncDialog.vue` | `loadCredentialState`                          | `if feishu … else tencent`             | webdav 凭证回填到腾讯输入框                               |
| `components/options/CloudSyncDialog.vue` | `loadConfig`                                   | 仅赋值 feishu/tencent                  | webdav 表单读不到已存配置                                 |

### 2.2 改造原则

1. **穷尽式 `switch` + `never` 兜底**：所有按 provider 分派处改为 `switch (provider)`，`default` 分支写 `const _exhaustive: never = provider; throw new Error(...)`。这样未来再加 provider 时 **TypeScript 编译期即报错**，而非运行时静默走错分支。
2. **`auditLog.sanitizeEntry` 改为白名单校验**：`provider` 必须 ∈ `{'feishu','tencent','webdav'}`，非法值回退 `'feishu'` 的行为保留（安全默认），但合法值不再被二元判断吞掉。
3. **`syncEngine` 的表格专用函数加显式守卫**：`createAdapter` 等收到 `'webdav'` 时抛 `CloudSyncError('unknown', 'webdav uses FileStorageAdapter')`，防止误调用产生难以排查的行为。
4. **改造与新增分离提交**：先完成穷尽化改造并跑通全部既有测试（行为等价，937 个测试全绿），再新增 webdav 功能。避免在一个大改动中混合重构与新增。
5. **已有的编译期护栏**：`providerForms` 声明为 `Record<CloudProvider, CloudSyncProviderConfig>`，扩展联合类型后 TS 强制要求补 webdav 键——此类护栏保留并依赖。

## 3. 类型与配置扩展

### 3.1 `utils/cloudSync/types.ts`

```ts
export type CloudProvider = 'feishu' | 'tencent' | 'webdav';

/** WebDAV 目标：用户自选服务器上的备份目录 */
export interface WebDavTarget {
  /** 用户填写的远程目录 URL（原样保存，便于回显与重新校验） */
  dirUrl: string | null;
  /** 实际备份子目录 URL（= 归一化 dirUrl + 'aph-backup/'），快照隔离键与锁 targetKey 组成部分 */
  backupDirUrl: string | null;
  /**
   * 用户已显式确认允许 HTTP 明文传输（见 §4.4）
   *
   * 仅当 dirUrl 为 http 且 host 非 localhost 时可为 true。持久化此标记是为了
   * 让「每次备份都带警告」成为可能，而非仅配置时提示一次。
   */
  allowInsecure: boolean;
}

/** WebDAV 凭证：Basic 为主，Bearer 可选（非空则优先） */
export interface WebDavCredentials {
  username: string;
  password: string;
  /** 可选；非空时使用 `Authorization: Bearer`，忽略 username/password */
  bearerToken?: string;
}

export interface ProviderTargetMap {
  feishu: FeishuTarget;
  tencent: TencentTarget;
  webdav: WebDavTarget;
}

export interface ProviderCredentialMap {
  feishu: FeishuCredentials;
  tencent: TencentCredentials;
  webdav: WebDavCredentials;
}
```

`CloudSyncConfig.providers` 增加 `webdav: CloudSyncProviderConfig<'webdav'>`。

### 3.2 WebDAV 的模式与字段语义

- **`mode` 恒为 `'encrypted'`**：`normalizeProvider` 对 webdav 强制回写 `'encrypted'`，UI 隐藏模式选择。若存储中被篡改为 `'plaintext'`，归一化时纠正。
- **`chunkSize` 保留但不参与逻辑**：保持 `CloudSyncProviderConfig` 结构统一，避免为 webdav 单独造一套配置类型。
- **`configured`**：`prepareWebDavTarget` 成功后置 `true`。
- **`lastSyncAt`**：每次备份/恢复成功后更新。

### 3.3 `getDocKey` 的 webdav 分支

返回 `backupDirUrl`（已含目录路径，天然唯一）。`dirUrl` 或 `backupDirUrl` 为空 → 返回 `null`（判定「尚未就绪」）。

### 3.4 存储键

**无新增存储键**。复用：

- `STORAGE_KEYS.CLOUD_SYNC_CONFIG`（配置，含 webdav 分支）
- `STORAGE_KEYS.CLOUD_SYNC_CREDENTIALS`（凭证密文聚合对象，增加 `webdav` 键）
- `STORAGE_KEYS.CLOUD_SYNC_AUDIT_LOG`（审计日志）
- `SESSION_MEMORY_KEYS.CLOUD_SYNC_LOCK`（任务锁，`targetKey = webdav:<backupDirUrl>`）
- `cloud_sync_encrypted_meta_webdav_<backupDirUrl>`（密文元数据，复用 `snapshotStore`）

`EncryptedSnapshotMeta` 结构复用：`snapshotGroupId` 存**文件名**，`totalParts` 恒为 `1`，`snapshotHash`/`exportedAt` 语义不变。无需改类型。

## 4. 文件存储适配器

### 4.1 接口（`utils/cloudSync/adapters/fileStorage.ts`）

```ts
/** 远程文件元信息（由 PROPFIND 解析） */
export interface RemoteFile {
  /** 文件名（已从 href 取 basename 并 decodeURIComponent） */
  name: string;
  /** 可直接用于 GET/DELETE 的绝对 URL */
  url: string;
  /** 字节数；服务器未返回时为 0 */
  size: number;
}

/**
 * 文件存储适配器（与 TableAdapter 并列）
 *
 * 文件协议不该硬套表格语义：无 recordId、无字段、无单元格上限，
 * 因此独立抽象，由 webdavSync 编排，diff/schema/sanitize 均不参与。
 */
export interface FileStorageAdapter {
  readonly provider: 'webdav';
  /** 探活 + 鉴权校验（PROPFIND depth 0） */
  testConnection(): Promise<void>;
  /** 确保备份子目录存在（MKCOL，405 视为已存在） */
  ensureDirectory(): Promise<void>;
  /** 列出备份目录下的快照文件（PROPFIND depth 1） */
  listFiles(): Promise<RemoteFile[]>;
  /** 上传文件（PUT，整体覆盖） */
  putFile(name: string, content: string): Promise<void>;
  /** 下载文件内容（GET，带响应体大小上限） */
  getFile(url: string, expectedSize?: number): Promise<string>;
  /** 删除文件（DELETE，404 视为业务成功） */
  deleteFile(url: string): Promise<void>;
}
```

### 4.2 WebDAV 实现（`utils/cloudSync/adapters/webdav.ts`）

**认证头构造**

```
bearerToken 非空 → Authorization: Bearer <token>
否则            → Authorization: Basic <base64(username:password)>
```

`base64` 用 `btoa(unescape(encodeURIComponent(...)))` 等价的安全写法（`TextEncoder` + 逐字节 `String.fromCharCode`），避免非 ASCII 用户名抛错。

**URL 归一化与拼接**

1. `dirUrl` 解析为 `URL` 对象；协议校验见 §4.4
2. 目录 URL 补尾斜杠
3. 备份子目录 = 目录 URL + `aph-backup/`
4. 文件 URL = 备份子目录 + `encodeURIComponent(fileName)`
5. **不对已有路径段二次编码**（用户填的 `/remote.php/dav/files/张三/` 必须原样保留）

**PROPFIND 请求**

```
PROPFIND <url>
Depth: 0（探活）| 1（列目录）
Content-Type: application/xml; charset=utf-8

<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:resourcetype/><d:getcontentlength/></d:prop>
</d:propfind>
```

**XML 解析（`DOMParser`）稳健性要求**

- **按 `localName` 匹配**，不依赖命名空间前缀：各服务器返回 `D:response` / `d:response` / 默认命名空间 `response` 均有实测差异
- **过滤集合自身**：`resourcetype` 含 `collection` 子节点的项是目录，跳过
- **不依赖 `href` 与文件名精确匹配**：取 `href` 的 basename → `decodeURIComponent`（失败则用原始值）→ **仅保留 `aph-` 开头且 `.aphdav` 结尾**的项。这同时解决三件事：绕开各服务器 href 绝对/相对/编码差异、天然排除用户目录里的其他文件、避免误删非本扩展文件
- 解析失败（非 XML、空响应）→ 抛 `CloudSyncError('unknown', 'unparsable PROPFIND response')`

**MKCOL 幂等**

`MKCOL <backupDirUrl>` 返回 `201`（已创建）或 `405`（已存在）均视为成功；`409`（父目录不存在）→ `notFound` 并提示核对目录 URL；其余按 §4.3 映射。

**`ensureDirectory` 调用时机**

- **测试连接时执行**：让用户在配置阶段就发现目录不可写，而非等到首次备份
- **每次备份前仍调用**（幂等）：防用户手动删除目录

**`getFile` 响应体上限**

云端文件是**不可信输入**。先用 `PROPFIND` 得到的 `size` 判断，超过 `MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024`（50MB）直接拒绝并抛 `tooLarge`，防止恶意/损坏文件吃光内存。`size` 为 0（服务器未返回）时改为读取后按字符串长度二次校验。

**复用 `httpClient.requestWithRetry`（但需独立的响应封装）**

15s 超时、≤2 次重试、429/5xx 指数退避、`Retry-After` 优先、`onApiCall` 配额计数、`signal` 取消——全部复用，不重写。`shouldRetry` 判定：`isTransientStatus(status, networkError)`（网络异常 / 429 / 5xx）。**423 Locked 不重试**（WebDAV 锁需人工介入，重试无意义）。

`requestWithRetry` 支持任意 `method`（PROPFIND/MKCOL/PUT/DELETE 均非 fetch 的 forbidden method），且内部 `response.clone().json()` 不消费原始 body，故适配器仍可对返回的 `response` 调用 `.text()` 读取 XML。

**关键区别**：飞书/腾讯适配器共用 `call<T>()` 私有封装，假设响应是 `{code, msg, data}` JSON 外壳并直接返回 `data`。WebDAV 响应是 XML（PROPFIND）或空体（PUT/DELETE/MKCOL），**不能复用 `call<T>`**。WebDAV 适配器需自己的私有 `request()` 封装：调用 `requestWithRetry` → 检查 `response.ok`（非 2xx 经 `mapWebDavStatus` 抛错）→ 按方法返回 `response`（供 `.text()`）或 `void`。

**运行上下文约束（安全边界）**：`DOMParser` 是 Window API，**Service Worker 上下文不存在**。WebDAV 适配器与 `webdavSync` 仅可在 **Options 页面**使用（云同步的执行位置，见前置规格 §2），**严禁被 background/content 入口 import**。`CloudSyncDialog.vue` 经 `defineAsyncComponent` 懒加载，webdav 相关模块自然只落入 Options 页面 chunk，不进 SW 产物。此约束须在 `webdav.ts` 文件头注释中显式声明。

### 4.3 HTTP 状态码 → 领域错误映射

WebDAV 无业务错误码，全部依据 HTTP 状态码。新增导出函数 `mapWebDavStatus(status: number, message: string): CloudSyncError`：

| 状态     | kind                | 说明与 UI 提示方向                                       |
| -------- | ------------------- | -------------------------------------------------------- |
| 401      | `invalidCredential` | 用户名/密码/应用密码错误                                 |
| 403      | `permission`        | 有凭证但无该目录权限                                     |
| 404      | `notFound`          | 目录或文件不存在，核对 URL                               |
| 405      | `unknown`           | 方法不被允许（MKCOL 场景单独处理为成功）                 |
| 407      | `permission`        | 代理认证失败                                             |
| 409      | `notFound`          | 父目录不存在（MKCOL）                                    |
| 413      | `tooLarge`          | 请求体过大，常见于 nginx `client_max_body_size` 默认 1MB |
| 423      | `writeConflict`     | Locked，WebDAV 锁被占用                                  |
| 429      | `rateLimit`         | 限流（重试耗尽后）                                       |
| 507      | `quota`             | Insufficient Storage，服务器容量不足                     |
| 5xx      | `network`           | 服务器异常（重试耗尽后）                                 |
| 其他 4xx | `unknown`           | 保留状态码于 `code` 供排查                               |

### 4.4 传输安全校验

```
协议为 https:            → 通过
协议为 http: 且 host ∈ {localhost, 127.0.0.1, [::1]} → 通过（本地开发）
协议为 http: 且 host 为其他 → 需用户显式确认（见下）
其他协议（ftp/file/…）    → 拒绝，抛 notFound
```

**HTTP 非 localhost 的处理**：不硬阻断（内网 NAS 是真实场景，硬阻断的后果是用户放弃功能或寻找绕过手段，更糟）。改为：

1. UI 表单出现「我了解该地址不使用加密传输，凭证与密文将以明文经过网络」勾选框，**未勾选不可保存/测试连接**
2. 确认状态持久化到 `WebDavTarget.allowInsecure: boolean`（新增字段）
3. **每次备份/恢复的报告都带 `cloudSync.warning.insecureTransport` 警告**，不是一次性提示

与项目既有「明文模式需二次确认 + 醒目警告」的心智一致：不替用户做决定，但确保决定是知情的、且每次都被提醒。

## 5. 单文件密文快照

### 5.1 格式（`utils/cloudSync/cryptoSnapshot.ts` 新增）

```ts
/** WebDAV 单文件快照格式（不分片） */
export interface SingleFileSnapshot {
  /** 格式版本，当前恒为 1；不兼容旧版本时递增并明确拒绝 */
  version: 1;
  /** 导出时间戳（epoch 毫秒） */
  exportedAt: number;
  /** 条目数（供 UI 展示与快速校验，不作为完整性依据） */
  count: number;
  /** `blob` 的 SHA-256（hex），完整性校验 */
  snapshotHash: string;
  /** Base64(IV[12] + AES-256-GCM 密文)，即 encryptData 的输出 */
  blob: string;
}

export async function encryptToSingleFile(
  entries: PasswordEntry[],
  masterPassword: string,
  exportedAt?: number,
): Promise<SingleFileSnapshot>;

export async function verifyAndDecryptSingleFile(
  raw: unknown,
  masterPassword: string,
): Promise<RestoreResult>;
```

**复用既有构件**：`SNAPSHOT_FORMAT_VERSION`、`buildSnapshotPayload`（剔除 `order`）、`parseSnapshotPayload`（不可信载荷逐条校验）、`sha256Hex`、`RestoreResult` / `RestoreRejectReason`。

**加密路径不变**：`deriveEncryptionKey`（PBKDF2-SHA256 600k）+ `encryptData`（随机 12 字节 IV + AES-256-GCM）。**不自创算法、不用固定 IV、不弱化 PBKDF2 参数**。

### 5.2 恢复校验链（串行，任一失败即拒绝）

| 序  | 校验                                     | 失败原因                                          |
| --- | ---------------------------------------- | ------------------------------------------------- |
| 1   | `JSON.parse` 成功且为对象                | `invalidPayload`                                  |
| 2   | `version === SNAPSHOT_FORMAT_VERSION`    | `invalidPayload`（旧/新版本格式明确拒绝，不猜测） |
| 3   | `blob` 为非空字符串                      | `invalidPayload`                                  |
| 4   | `exportedAt` 为有限数字                  | `invalidPayload`                                  |
| 5   | `sha256Hex(blob) === snapshotHash`       | `snapshotHashMismatch`（篡改或传输损坏）          |
| 6   | `decryptData(blob, key)` GCM 认证通过    | `decryptFailed`（含 rekey 后旧备份不可解）        |
| 7   | `parseSnapshotPayload` 逐条类型/长度校验 | 非法条目**跳过并计数**，不整体拒绝                |

**rekey 边界**（沿用前置规格 §5.4）：备份由「推送时」的主密码派生密钥加密。修改主密码后恢复会 GCM 认证失败——**这是预期行为**，UI 提示「该备份由修改主密码前生成，无法用当前主密码解密」，不尝试其他口令、不暴力重试。

### 5.3 文件命名

```
aph-<yyyyMMddHHmmss(UTC)>-<6位随机 base36>.aphdav
例：aph-20260924101530-k3n9x2.aphdav
```

- **时间戳内嵌文件名** → `listFiles` 结果按文件名**字典序排序即得时间序**，不依赖 `getlastmodified`（各服务器该字段时区行为不一致，实测有 UTC/本地时间混用）
- **随机后缀** → 防多设备同秒备份互相覆盖
- **固定前后缀** → PROPFIND 过滤依据（§4.2），避免误列/误删用户其他文件
- 时间戳用 UTC，避免跨时区设备排序错乱；UI 展示时转本地时间

### 5.4 版本保留与清理

备份成功后：`listFiles()` → 按文件名字典序**降序**（新→旧）→ 保留前 `keepVersions` 个 → 其余逐个 `deleteFile`。

清理失败**不回滚已成功的备份**，仅在报告 `failures` 中逐条列出（符合「不静默吞掉错误」）。

`clearOldWebDavVersions` 提供手动清理入口，逻辑同上，不动本地数据。

## 6. 同步编排

### 6.1 共享基础设施提取（`utils/cloudSync/runContext.ts`）

从 `syncEngine.ts` **纯搬迁**三个无状态函数，供 `syncEngine` 与 `webdavSync` 共用：

```ts
export function emptyStats(): SyncStats;
export function buildReport(...): SyncReport;              // 签名与实现不变
export async function loadReadyContext(provider): Promise<{ // 签名与实现不变
  config; providerConfig; credentials; docKey;
}>;
```

搬迁理由：`webdavSync` 同样需要「读配置 → 凭证四态检查 → 算 docKey」前置校验与报告组装。复制粘贴这类逻辑是真正会随时间漂移的重复。搬迁为零行为变化，由既有 937 个测试守卫。

### 6.2 `utils/cloudSync/webdavSync.ts`

```ts
export interface PrepareWebDavResult {
  provider: 'webdav';
  /** 备份目录 URL（UI 展示用） */
  backupDirUrl: string;
  /** 目录是否为本次新建（MKCOL 返回 201）；已存在（405）为 false */
  created: boolean;
  target: WebDavTarget;
}

/**
 * 校验凭证、探测目录、按需创建备份子目录，并回写配置
 *
 * `allowInsecure` 由 UI 依据「URL 为 http 且非 localhost 且用户已勾选确认」传入；
 * 函数内部**独立重算**该条件并与入参交叉校验——若 URL 需要确认而 `allowInsecure`
 * 为 false，抛 `CloudSyncError('notFound', 'insecure transport requires explicit confirmation')`。
 * 不信任 UI 单侧判断，避免绕过安全门。
 */
export async function prepareWebDavTarget(
  credentials: WebDavCredentials,
  dirUrl: string,
  options?: AdapterOptions & { allowInsecure?: boolean },
): Promise<PrepareWebDavResult>;

export async function runWebDavBackup(
  masterPassword: string,
  options?: SyncRunOptions,
): Promise<SyncReport>;

export async function runWebDavRestore(
  masterPassword: string,
  /** `versionName` 指定恢复某个历史版本；省略则按 §6.4 的优先级自动选择 */
  options?: SyncRunOptions & { versionName?: string },
): Promise<SyncReport>;

export async function clearOldWebDavVersions(
  options?: SyncRunOptions,
): Promise<SyncReport>;

/**
 * 列出可恢复的历史版本（UI 版本下拉数据源）
 *
 * `exportedAt` 由**文件名时间戳解析**得到（非 PROPFIND 的 getlastmodified，
 * 后者各服务器时区行为不一致）；解析失败时为 0，UI 展示回退为文件名本身。
 * 返回值按 `exportedAt` 降序（新→旧）。
 */
export async function listWebDavVersions(): Promise<
  { name: string; size: number; exportedAt: number }[]
>;
```

**复用**：`taskLock`（`targetKey = webdav:<backupDirUrl>`）、`credentialStore`、`configStore`、`auditLog`（action 复用 `prepareTarget`/`backup`/`restore`/`clearVersions`）、`snapshotStore.saveEncryptedMeta`/`loadEncryptedMeta`、`errors`、`runContext`。

**不参与**：`diff.ts`、`schema.ts`、`sanitize.ts`、`snapshotStore` 的明文快照函数、`TableAdapter` 及其两个实现。

### 6.3 备份流程

```
1. loadReadyContext('webdav')  → 凭证四态检查（empty/locked/corrupted 各抛 invalidCredential）
2. acquireTaskLock(`webdav:${backupDirUrl}`)；!ok → writeConflict
3. onProgress('cloudSync.progress.fetchLocal') → getAllPasswords(masterPassword)
4. adapter.ensureDirectory()（幂等）
5. onProgress('cloudSync.progress.encrypt') → encryptToSingleFile(entries, masterPassword)
6. onProgress('cloudSync.progress.upload') → putFile(fileName, JSON.stringify(snapshot))
7. saveEncryptedMeta({ provider:'webdav', docKey, snapshotGroupId: fileName,
                       snapshotHash, exportedAt, totalParts: 1 })
8. patchProviderConfig('webdav', { lastSyncAt: Date.now() })
9. 版本保留：listFiles → 降序 → 删除超出 keepVersions 的旧文件
10. audit(makeAuditEntry('webdav','encrypted','backup', docKey, { stats }))
    审计失败 → warnings.push({ key:'cloudSync.warning.auditLogFailed' })
11. target.allowInsecure → warnings.push({ key:'cloudSync.warning.insecureTransport' })
12. catch：isAbortError → cancelled=true；否则 toCloudSyncError → 记 failures + logger.error + rethrow
13. finally：lock.handle.release()
14. return buildReport(...)  // stats.created = 1（一个快照文件）
```

**写入失败语义**：`putFile` 失败即整体失败，**不产生半成品**（单文件 PUT 是原子的，不存在分片场景的「部分成功」问题）。这是不分片带来的额外可靠性收益。

### 6.4 恢复流程

```
1. loadReadyContext('webdav') → 取锁
2. onProgress('cloudSync.progress.download') → listWebDavVersions()
3. 选目标版本（listWebDavVersions 已按 exportedAt 降序）：
   - options.versionName 指定 → 用该文件名对应的版本；列表中不存在则抛 notFound
   - 未指定 → loadEncryptedMeta 的 snapshotGroupId（即文件名，见 §3.4）在列表中匹配者优先
     （本机最近推送的版本；按文件名匹配无需下载即可定位，不用 snapshotHash）
   - meta 缺失或其文件名已不在列表（被清理/他端删除）→ 取列表首个（最新）
   - 列表为空 → 抛 notFound('no snapshot found')
4. onProgress('cloudSync.progress.verify') → getFile(url, size) → JSON.parse
   → verifyAndDecryptSingleFile(raw, masterPassword)
   !ok → 抛 CloudSyncError('schema', `snapshot verification failed: ${reason}`, reason)
5. getAllPasswords → localById Map；遍历 payload.entries（每项检查 signal.aborted → break）：
   - 本地无该 id            → savePassword  → added++
   - remote.updateTime 更新 → updatePassword → updated++
   - 否则                   → skipped++（不覆盖本地新值）
6. stats.pulled = added + updated; stats.skipped = skipped
7. patchProviderConfig({ lastSyncAt }) → audit('restore')
8. report.restore = { added, updated, skipped, rejected }
9. finally 释放锁
```

**恢复绝不删除本地任何条目**（纯增量合并），与前置规格 §5.3 第 9 条一致。

### 6.5 取消机制

`options.signal` 透传给适配器（`httpClient` 内 `AbortController` 组合）；条目合并循环内轮询 `signal.aborted`；`isAbortError` → `cancelled: true` 且不抛错；`finally` 释放锁。已完成的操作保留。

## 7. UI（`CloudSyncDialog.vue` 第三页签）

### 7.1 结构变更

- `el-tabs` 增加 `webdav` 页签（`t('cloudSync.provider.webdav')`）
- `providerForms` 增加 webdav 默认项（`Record<CloudProvider, …>` 类型强制）
- **模式选择区加 `v-if="activeProvider !== 'webdav'"`**，webdav 改为常驻说明文案「WebDAV 仅支持密文备份」
- 状态区（`el-descriptions`）目标显示 `backupDirUrl`

### 7.2 WebDAV 表单

| 字段                 | 类型     | 说明                                                                                                                |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| 远程目录             | text     | placeholder 提示坚果云 `https://dav.jianguoyun.com/dav/`、Nextcloud `https://<host>/remote.php/dav/files/<用户名>/` |
| 用户名               | text     | `autocomplete="off"`                                                                                                |
| 密码                 | password | `show-password` + `autocomplete="new-password"`；提示「坚果云需使用**应用密码**，非账号登录密码」                   |
| Bearer Token（可选） | password | 折叠于「高级」区；填写后优先于用户名/密码                                                                           |
| 允许 HTTP 明文传输   | checkbox | **仅当 URL 为 http 且非 localhost 时出现**；未勾选则测试连接/备份按钮 disabled                                      |

### 7.3 操作按钮

- **测试连接**：保存凭证 → `prepareWebDavTarget`（含 `ensureDirectory`）→ 回写 target → 提示「目录已就绪」/「已创建备份目录」
- **立即备份**：验证主密码 → `runWebDavBackup`
- **从云端恢复**：先 `listWebDavVersions()` 填充**版本下拉**（默认最新，展示文件名 + 大小 + 本地化时间）→ 确认弹窗 → `runWebDavRestore({ versionName })`
- **清理旧版本**：确认弹窗 → `clearOldWebDavVersions`（无需主密码，只删云端历史文件）
- **清空审计日志**：复用现有实现

进度条、取消按钮、报告区、告警渲染全部复用。`t(warning.key, warning.params)` 已支持带参警告，`insecureTransport` 无需改渲染逻辑。

### 7.4 分派逻辑

`currentCredentials()` / `credentialsComplete()` / `loadCredentialState()` / `loadConfig()` / `handleTestConnection()` / `runWithMasterPassword()` / `handleClearVersions()` 全部改为**穷尽式 `switch (activeProvider)`**（§2.2 原则）。

`credentialsComplete()` 的 webdav 规则特殊：`bearerToken` 非空 **或** (`username` 且 `password` 非空)。不能沿用「所有字段非空」的通用判断（`bearerToken` 可选）。

## 8. i18n

`utils/i18n/locales/{zh-CN,en}/cloudSync.json` 新增 key（**中英 key 集必须完全一致**，由 `tests/utils/i18nBundles.test.ts` 守卫）：

```
cloudSync.provider.webdav
cloudSync.webdav.dirUrl / dirUrlPlaceholder / dirUrlTip
cloudSync.webdav.username / usernamePlaceholder
cloudSync.webdav.password / passwordPlaceholder / passwordTip
cloudSync.webdav.bearerToken / bearerTokenPlaceholder / bearerTokenTip
cloudSync.webdav.advanced
cloudSync.webdav.encryptedOnly
cloudSync.webdav.allowInsecure
cloudSync.webdav.versionSelect / versionLatest / versionSize
cloudSync.webdav.directoryReady / directoryCreated
cloudSync.warning.insecureTransport
```

- 不新增 i18n-lite 文案（无 content/background 可见文案）
- `utils/i18n/bundles/options.ts` 已注册 `cloudSync` namespace，**无需改动**
- 现有 `cloudSync.error.*` 文案已覆盖全部 `CloudErrorKind`，**无需新增错误文案**

## 9. 测试

| 文件                                               | 覆盖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/utils/cloudSync.webdav.test.ts`             | Basic/Bearer 头选择与优先级、非 ASCII 用户名 base64、URL 归一化（补尾斜杠、不二次编码路径段、`encodeURIComponent` 文件名）、MKCOL 201/405 幂等、MKCOL 409→notFound、PROPFIND 多命名空间前缀解析（`D:`/`d:`/默认）、集合自身过滤、basename+前后缀过滤、href 相对/绝对/编码差异、`DOMParser` 解析失败、PUT/GET/DELETE、DELETE 404 视为成功、`getFile` 50MB 上限、状态码映射全表（401/403/404/407/409/413/423/429/507/5xx/其他 4xx）、http 非 localhost 需确认、https 通过、localhost http 通过、ftp 拒绝 |
| `tests/utils/cloudSync.fileSnapshot.test.ts`       | 加密解密往返、`snapshotHash` 篡改拒绝、`version` 不符拒绝、`blob` 空/非字符串拒绝、`exportedAt` 非有限数拒绝、GCM 认证失败（错误主密码 / rekey）、非法条目跳过并计数、`order` 字段被剔除、`count` 与实际条目数一致                                                                                                                                                                                                                                                                                     |
| `tests/utils/cloudSync.webdavSync.test.ts`         | 备份成功写 meta + `stats.created=1`、超保留数清理（keepVersions=3 时 5 版删 2）、清理失败不回滚备份仅记 failures、恢复增量合并三分支（新增/更新/跳过）、恢复不删本地、指定 `versionName` 恢复、meta 匹配优先、列表为空抛 notFound、校验失败抛 schema、锁占用抛 writeConflict、凭证四态各抛 invalidCredential、取消 → cancelled、审计失败 → warning、`allowInsecure` → warning、`finally` 必释放锁                                                                                                      |
| `tests/utils/cloudSync.providerExhaustive.test.ts` | **穷尽化改造回归守卫**：三个 provider 分别调用 `getDocKey`/`patchProviderConfig`/`defaultProviderConfig`/`isValidCredentials`/`sanitizeEntry`，断言 webdav 不落入 tencent 分支（配置写对位置、审计记对平台、凭证校验用对 schema）                                                                                                                                                                                                                                                                      |
| 既有测试                                           | `cloudSync.*.test.ts` 全部保持通过（穷尽化改造为零行为变化）                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**测试环境**：`DOMParser` 相关测试用文件级 docblock `// @vitest-environment jsdom`（项目已有 5 个测试文件采用此模式，`jsdom` 已在 devDependencies，**无需改 `vitest.config.ts`**）。其余保持 `node` 环境。

**mock 策略**：`vi.stubGlobal('fetch', …)` 按调用顺序返回预设响应（沿用 `cloudSync.feishu.test.ts` 的 `stubFetchSequence` 模式）；`webdavSync` 测试 mock `WebDavAdapter` 类与 `passwordCrud`/`trashManager`，`cryptoSnapshot`/`runContext`/`taskLock` 用真实实现（Node 原生 Web Crypto）。

## 10. 文档同步

| 文件                                                         | 更新内容                                                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `README.md` / `README.en.md`                                 | 云同步功能说明补 WebDAV；**坚果云需「应用密码」**；HTTP 风险提示                                                                   |
| `docs/ARCHITECTURE.md` / `.en.md`                            | 「功能实现详解 → 云文档同步」补 WebDAV 架构、`FileStorageAdapter` 与 `TableAdapter` 并列关系、数据流、单文件快照格式、传输安全策略 |
| `privacy.html` / `privacy.en.html`                           | 「可选云文档同步」补 WebDAV：目标服务器由用户自选、默认关闭、仅上传密文、凭证加密存储、HTTP 模式风险                               |
| `docs/CWS_FILL_CONTENT.md`                                   | 隐私与权限口径更新（**权限无变化**，需说明 `<all_urls>` 已覆盖用户自选服务器）                                                     |
| `docs/superpowers/specs/2026-09-23-cloud-doc-sync-design.md` | §3 平台规格补 WebDAV 章节引用；§12 外部依赖风险项补 WebDAV 相关项                                                                  |
| `wxt.config.ts`                                              | **无改动**（无权限变化，manifest 描述不变）                                                                                        |
| 侧边栏 `help.json` / `HelpDialog.vue`                        | **不改动**（本功能仅在 Options 提供，避免 `help.gx` 序号联动）                                                                     |

## 11. 安全边界与已知风险

1. **凭证以会话数据密钥 AES-256-GCM 加密后存 `chrome.storage.local`**：锁定后不可解，与密码条目同等 at-rest 保护，不引入新的明文存活面。rekey 后旧凭证不可解 → 返回 `corrupted`，UI 提示重新录入，不清除目标配置。
2. **HTTP 明文传输**：Basic 凭证与密文经网络明文传输。缓解：需显式勾选确认 + 每次报告常驻警告。**无法根除**，已在隐私说明如实告知。
3. **Bearer Token 与密码同等敏感**：输入框 `type="password"`，日志与审计**绝不记录**原文。
4. **云端文件是不可信输入**：`JSON.parse` + 结构校验 + `snapshotHash` + GCM 认证 + `parseSnapshotPayload` 逐条校验，五层防护；50MB 下载上限防内存耗尽；禁止 `v-html`/`innerHTML`/`eval`。
5. **PROPFIND 过滤严格**：仅操作 `aph-*.aphdav`，**绝不误删用户目录下的其他文件**。
6. **服务器兼容性差异**：各 WebDAV 实现对 PROPFIND 响应格式、`href` 编码、`MKCOL` 状态码、命名空间前缀的处理不一致。缓解：按 `localName` 解析、basename 提取、405/201 双接受。**残余风险**：极端非标准实现可能仍不兼容，联调时以真实服务器为准，发现偏差回改本规格。
7. **配额计数为本地估算**：`onApiCall` 累加，仅预警不阻断，以服务器实际限制为准。
8. **单文件大小限制**：部分服务器（nginx 默认 `client_max_body_size` 1MB）会拒绝大备份。413 → `tooLarge` 并给出明确排查提示，**不做自动分片降级**（YAGNI，且分片会重新引入多文件清理复杂度）。

## 12. 实施顺序

1. **P0 穷尽化改造**（§2）：二元分支 → `switch` + `never`；补 `cloudSync.providerExhaustive.test.ts`；跑通全部既有测试（行为等价）
2. **类型与配置**（§3）：`types.ts` / `configStore.ts` / `credentialStore.ts` / `auditLog.ts` 的 webdav 分支
3. **适配器**（§4）：`fileStorage.ts` 接口 + `webdav.ts` 实现 + `mapWebDavStatus` + 测试
4. **单文件快照**（§5）：`cryptoSnapshot.ts` 新增两函数 + 测试
5. **编排**（§6）：提取 `runContext.ts` + `webdavSync.ts` + 测试
6. **UI 与 i18n**（§7、§8）：第三页签、表单、版本下拉、中英 key 同步
7. **文档**（§10）
8. **验证矩阵**：`pnpm typecheck`、`pnpm lint`、`pnpm lint:style`、`pnpm test:run`、`pnpm build`、改动文件 `pnpm exec prettier --check`

每步完成后跑最小相关测试；步骤 1 必须独立验证行为等价后再进入步骤 2。

## 13. 范围外（YAGNI）

- 不做明文同步、不做行级双向 diff、不做云端→本地自动冲突合并
- 不做定时/自动同步、不做多设备并发协调（随机后缀仅防覆盖）
- 不做分片与自动分片降级
- 不主动使用 WebDAV 锁（`LOCK`/`UNLOCK`）；423 仅映射为 `writeConflict` 提示用户
- 不支持自定义请求头（避免「用户可注入任意头」的边界问题）
- 不支持除 WebDAV 外的其他文件协议（S3/SFTP/FTP/WebDAV 之外的网盘 API）
- 不做服务器端增量/差量上传（每次全量 PUT）
- 不做备份文件本地缓存
