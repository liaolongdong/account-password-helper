# 云文档同步（腾讯智能表 + 飞书多维表格）设计规格

- 日期：2026-09-23
- 版本：V1.3（V1.2 基础上：明文表新增「分组」列，密文快照携带分组树，联动 Options 树形分组功能）
- 状态：待用户审查
- 范围：密码管理器扩展，将密码条目同步至腾讯文档智能表 / 飞书多维表格，支持【密文快照备份 + 恢复】与【明文行级双向同步】两种模式

## V1.3 修订说明

1. **明文表新增「分组」列**（8 → 9 字段，位于「TOTP」之后、「本地更新时间」之前，text 类型）：值为分组全路径（`/` 拼接，如 `工作/项目A`），未分组为空串。联动 `docs/superpowers/specs/2026-09-23-options-group-tree-design.md`（Options 树形分组）。
2. **`SYNCED_TEXT_FIELDS` 哈希口径加入 `groupPath`**：分组归属变更参与 LWW diff 与冲突判定。
3. **`LocalSyncEntry` 新增 `groupPath` 字段**：云端以路径为分组交换格式（云端表无本地 code 概念）；推送方向由 syncEngine 用 `getGroupPath(entry.groupId, groups)` 组装，拉取方向用 `ensureGroupByPath` 逐级建组后写回条目 `groupId`。
4. **密文模式携带完整分组树**：整库 JSON 快照与 `.aph` v2 同构，包含顶层 `groups` + 条目 `groupId`，表结构仍为 9 个分片字段；恢复时按同名同级复用合并分组树，并把远端 `groupId` 重映射到本地 code。
5. **兼容性**：既有 8 字段云端表在 `checkTableSchema` 中将判定「缺失字段：分组」，按 §11 终止同步并引导用户删除云端表由系统重建（不自动改表结构）；旧密文快照没有 `groups` 时按空数组兼容。

## V1.2 修订说明

1. **订正平台 API 事实**（V1.1 第 4/5 节大面积错误，已按官方文档重写）：
   - 腾讯智能表域名为 `https://docs.qq.com`（非 `api.lark.qq.com`）；无 `getAccessToken` 接口、无 `spaceId` 概念；增删改查共用同一 POST 路径，靠 body 键区分；鉴权为 `Access-Token`/`Client-Id`/`Open-Id` 三个独立 Header；文本字段值为 `[{"type":"text","text":"..."}]` 数组；错误码为 10302/10303/10313/37019；scope 仅 `scope.smartsheet`。
   - 飞书字段类型枚举订正为 1=多行文本、2=数字、5=日期、1001=创建时间、1002=最后修改时间（V1.1 的 4/5 映射错误）；**`is_unique` 参数不存在**，已移除相关设计；错误码为 `1254xxx` 系列；scope 为 `bitable:app` / `bitable:app:readonly` / `base:field:create`。
2. **简化：取消"最后编辑时间"表字段**。腾讯 record 自带 `updateTime`（字符串毫秒），飞书 record 加 `automatic_fields=true` 返回 `last_modified_time`（int 毫秒），LWW 直接读 record 元数据，无需建系统字段，也规避了"系统字段只读不可写"的坑。
3. **修正 ID 列隐藏方案**：飞书索引列（`is_primary`）不可隐藏且仅支持 type 1/2/5/13/15/20/22，故首列改为"用户名"（type=1，`is_primary:true`），ID 列置于末位并设 `is_hidden:true`。
4. **吸收 V1.1 的 P0/P1 改进**：密文分片 + 双层哈希完整性校验、同步任务互斥锁、批量部分成功处理、审计日志字段白名单、文本清洗规则、表结构运行时篡改检测、结构化同步报告、外部依赖风险项。
5. **修正 V1.1 的存储介质选择**：统一使用 `chrome.storage.local`（项目既有基线，异步、容量大），**不使用 localStorage**。因此 V1.1 的"容量探测 + 预留 512KB + 写满终止"整套补偿逻辑简化为"写入异常捕获 + 失败终止"。
6. **修正 V1.1 的任务锁实现**：内存 `Map` 锁无法跨 Options 页面实例（多 tab）生效，改为 `chrome.storage.session` 锁 + 心跳时间戳防死锁。
7. **补回 V1.1 丢失的 10 项已批准决策**：删除传播语义与回收站联动、url+username 回退判重、凭证加密存储、哈希计算范围、密文 rekey 边界、密文恢复合并策略、不同步字段清单、i18n/文档/测试矩阵、UI 接入点、执行位置与权限边界。

## 1. 背景与目标

项目是本地优先的密码管理器扩展。用户希望增加"同步到腾讯文档、飞书文档"能力，用于云端备份与跨端查看/编辑。本功能是经用户明确确认的数据外传功能（符合 `AGENTS.md`"新增网络请求或任何用户数据外传前必须获得用户明确确认"要求），默认保持安全形态，明文外传必须由用户主动开启并二次确认。

### 1.1 已确认固化决策

| 决策点     | 结论                                                                          |
| ---------- | ----------------------------------------------------------------------------- |
| 明文/密文  | 用户可选；**默认密文**；明文需每次同步时主密码二次验证 + 醒目风险警告         |
| 同步方向   | 密文 = 本地→云端单向备份 + 手动"从云端恢复"；明文 = 行级双向同步              |
| 触发方式   | **仅手动**（数据管理菜单 → 云同步），无定时/后台自动同步                      |
| 匹配主键   | 业务 ID（`PasswordEntry.id`）为主键；云端 `recordId` 为平台内部行标识         |
| 回退判重   | 云端新增行无业务 ID 时，回退 `url + username` 判重                            |
| 删除语义   | 本地删 → 删云端行；云端删 → 本条目进**回收站**（可恢复，复用 `trashManager`） |
| 冲突策略   | LWW 时间戳（本地 `updateTime` vs 云端 record 修改时间），新者胜；冲突行进报告 |
| 腾讯载体   | 智能表 Smartsheet OpenAPI v2（`/openapi/smartbook/v2/...`），**非在线表格**   |
| 飞书载体   | 多维表格 Bitable V1                                                           |
| 凭证存储   | 会话数据密钥 AES-256-GCM 加密后存 `chrome.storage.local`                      |
| 本地持久化 | `chrome.storage.local`（快照、审计日志、配置），**不使用 localStorage**       |
| 不同步字段 | `favorite` / `favoriteUsedAt` / `lastUsedAt` / `order`（本地 UX 状态）        |

### 1.2 多设备业务约束（评审必看）

> ⚠️ 本设计**不原生支持多台设备共用同一张云端目标表**。推荐每台设备使用独立专属云端表。
>
> 原因：快照基线仅存于本机，无法区分"另一台设备的合法变更"与"用户在文档里的手工变更"；且飞书明确返回 `1254291 Write conflict`——**同一数据表不支持并发调用写接口**，多设备同时同步会硬失败。
>
> 用户强行共用场景：系统不阻断，但每次同步前置弹出警告；检测到的外部变更（云端存在本设备快照与本地均无的 recordId）标记为**人工冲突，不自动合并**，需用户在预览中逐条选择保留本地/云端。
>
> 后续若需原生多设备支持，需每次同步全量拉取云端重建基线，显著增加 API 配额消耗，当前版本不实现。

## 2. 总体架构

```
components/options/CloudSyncDialog.vue     设置与同步 UI（defineAsyncComponent 挂载）
utils/cloudSync/
  ├── types.ts            配置/凭证/快照/同步计划/报告的判别联合类型
  ├── credentialStore.ts  凭证加密存取（getSessionDataKey + encryptData/decryptData）
  ├── snapshotStore.ts    本地快照读写（chrome.storage.local，按 provider+docKey 隔离）
  ├── syncEngine.ts       同步编排（取数 → diff → 批量执行 → 更新快照 → 报告）
  ├── diff.ts             纯函数三方 diff（无网络无 IO，可独立测试）
  ├── cryptoSnapshot.ts   密文模式：整库加密 + 分片 + 双层哈希 + 恢复校验链
  ├── auditLog.ts         审计日志（字段白名单 + FIFO 100 条）
  ├── sanitize.ts         文本清洗（控制字符/零宽字符过滤、超长截断）
  ├── taskLock.ts         同步任务互斥锁（storage.session + 心跳）
  └── adapters/
      ├── types.ts        TableAdapter 统一抽象接口
      ├── feishu.ts       飞书 Bitable V1
      └── tencent.ts      腾讯智能表 OpenAPI v2
```

- **执行位置**：Options 页面内直接 `fetch`。页面存续期长，适合多秒批量请求；`host_permissions: ['<all_urls>']` 已覆盖两平台域名，**不新增任何 Chrome 权限**。不走 Background 消息路由（非跨入口通信）。
- **UI 接入点**：`components/options/HeaderBar.vue` 数据管理下拉新增 `command="cloudSync"`；`entrypoints/options/App.vue` 的 `handleDataCommand` 增加分支打开 `CloudSyncDialog`。
- **加密**：仅复用 `utils/encryption.ts` 现有封装（`deriveEncryptionKey` / `encryptData` / `decryptData`），不自创算法、不用固定 IV、不弱化 PBKDF2 参数。加密模块按项目既有 `lazyImport` 模式惰性加载。
- **日志**：统一 `utils/logger.ts`，仅记录错误码/消息，绝不记录 token、密码、TOTP、条目内容。

### 2.1 统一适配器抽象接口

```ts
interface TableAdapter {
  testConnection(): Promise<ConnResult>;
  listTables(): Promise<TableMeta[]>;
  createTable(spec: TableSpec): Promise<TableMeta>;
  checkTableSchema(): Promise<SchemaCheckResult>;
  getRows(): Promise<CloudRow[]>; // 内部分页遍历
  batchUpsert(rows: CloudRow[]): Promise<BatchResult>; // 内部按平台上限分批
  batchDelete(recordIds: string[]): Promise<BatchResult>;
  deleteByFilter?(pred: (r: CloudRow) => boolean): Promise<BatchResult>; // 密文版本清理
}

interface CloudRow {
  recordId: string;
  fields: Record<string, string | number>; // 已归一化为扁平键值，屏蔽平台值格式差异
  cloudModifiedAt: number; // 毫秒；腾讯 record.updateTime / 飞书 last_modified_time
}

interface BatchResult {
  succeeded: { recordId: string; businessId: string }[];
  failed: { businessId: string; code: string | number; message: string }[];
}
```

适配器负责屏蔽平台差异（值格式、分页、批量上限、错误码），`diff.ts` 与 `syncEngine.ts` 只面向 `CloudRow` / `BatchResult` 编程。

### 2.2 同步任务互斥锁

目的：防止用户连续点击、多个 Options 页面实例并行触发同一张表同步，造成分片污染、快照错乱，以及触发飞书 `1254291 Write conflict`。

1. 锁存储于 `chrome.storage.session`（仅内存、跨扩展页面共享、浏览器关闭即清），键 `cloud_sync_lock`，值 `{ [targetKey]: { acquiredAt, heartbeatAt, pageId } }`，`targetKey = ${provider}:${docKey}`。
2. 获取锁前置检查：
   - 目标 `targetKey` 已上锁且 `heartbeatAt` 距今 < 30s → 拒绝启动，提示"同步任务正在运行，请等待当前任务结束后重试"。
   - `heartbeatAt` 距今 ≥ 30s → 判定为**残留死锁**（页面崩溃/刷新未释放），强制抢占并记录审计日志。
   - 获取成功 → 同步按钮置灰，每 10s 刷新 `heartbeatAt`。
3. 释放规则：无论成功、业务失败、网络异常、手动取消，`finally` 强制删除锁条目并停止心跳定时器。
4. 已知局限：非分布式锁，无法阻止其他电脑/浏览器操作同一张云端表（见 1.2）。

## 3. 平台 API 规格（按官方文档核实）

### 3.1 腾讯智能表 OpenAPI v2

**基础信息**

- 域名：`https://docs.qq.com`
- 鉴权：三个独立 HTTP Header —— `Access-Token`、`Client-Id`、`Open-Id`（**不是** `Authorization: Bearer`）
- 凭证来源：用户在腾讯文档开放平台（已完成个人资质认证）页面手动生成并粘贴；**无 `getAccessToken` 类接口**，扩展不做 OAuth 流程
- scope：`scope.smartsheet`
- 配额：普通用户 2000 次/天（限免）；超级会员 20000 次/天

**接口清单**（增删改查共用同一 POST 路径，靠 body 顶层键区分）

| 用途         | Method | 路径                                                    | body 顶层键     | 限制                                               |
| ------------ | ------ | ------------------------------------------------------- | --------------- | -------------------------------------------------- |
| 查询子表列表 | GET    | `/openapi/smartbook/v2/files/{fileID}/sheets`           | —               | 分页                                               |
| 添加子表     | POST   | `/openapi/smartbook/v2/files/{fileID}/sheets`           | `addSheet`      | 配额受控                                           |
| 查询字段     | POST   | `/openapi/smartbook/v2/files/{fileID}/sheets/{sheetID}` | `getFields`     | —                                                  |
| 添加字段     | POST   | 同上                                                    | `addFields`     | —                                                  |
| 查询记录     | POST   | 同上                                                    | `getRecords`    | `{offset, limit}`，响应含 `hasMore`/`next`/`total` |
| 添加记录     | POST   | 同上                                                    | `addRecords`    | 单次建议 ≤500 行                                   |
| 更新记录     | POST   | 同上                                                    | `updateRecords` | 单次建议 ≤500 行                                   |
| 删除记录     | POST   | 同上                                                    | `deleteRecords` | 单次建议 ≤500 个 recordID                          |

**值格式**（关键差异，适配器必须处理）

- 文本字段：`{"字段名": [{"type": "text", "text": "内容"}]}` —— **数组包对象**，非纯字符串
- 数字字段：`{"字段名": 1234567890}` —— 直接数字
- 响应 record 结构：`{recordID, createTime, updateTime, values}`，其中 `createTime`/`updateTime` 为**字符串形式毫秒时间戳**，适配器需 `Number()` 转换
- **系统字段只读**：官方明确"不能通过添加记录接口给创建时间、最后编辑时间、创建人和最后编辑人四种类型的字段添加记录"

**错误码映射**

| 错误码 | 含义                  | 处理策略                                     |
| ------ | --------------------- | -------------------------------------------- |
| 10313  | Access-Token 为空     | 提示凭证未配置，引导录入                     |
| 10302  | Client-Id 错误/不匹配 | 提示凭证失效，重新录入                       |
| 10303  | Open-Id 错误/不匹配   | 提示凭证失效，重新录入                       |
| 37019  | Token 校验失败/过期   | 提示"凭证已失效，请到开放平台重新生成 token" |
| 429    | 请求限流              | 读 `Retry-After`，指数退避重试 ≤2 次         |
| 5xx    | 平台服务异常          | 重试 ≤2 次，失败终止本轮同步                 |

> 腾讯无原生唯一约束；业务 ID 唯一性由适配器**写入前做前置重复校验**（先 `getRows` 建 ID 索引，重复则转 update）。

### 3.2 飞书多维表格 Bitable V1

**基础信息**

- 域名：`https://open.feishu.cn`
- 鉴权：`Authorization: Bearer ${tenant_access_token}`，自建应用凭证（`app_id` + `app_secret`）换取，**不使用 user_access_token**
- Token 接口：`POST /open-apis/auth/v3/tenant_access_token/internal`，body `{app_id, app_secret}`，返回 `{tenant_access_token, expire}`
- Token 缓存：内存缓存，**过期前 30s 预刷新**；页面销毁即清空，**不持久化 token**
- scope：`bitable:app`（读写）或 `bitable:app:readonly`（只读）；创建字段另需 `base:field:create`
- 限流：多数接口 10~20 QPS

**接口清单**

| 用途              | Method | 路径                                                               | 限制                                                                                                         |
| ----------------- | ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 获取 tenant token | POST   | `/open-apis/auth/v3/tenant_access_token/internal`                  | 低频                                                                                                         |
| 查询数据表列表    | GET    | `/open-apis/bitable/v1/apps/{app_token}/tables`                    | 分页                                                                                                         |
| 创建数据表        | POST   | `/open-apis/bitable/v1/apps/{app_token}/tables`                    | 单 Base 上限 300 表（`1254100`）                                                                             |
| 创建字段          | POST   | `/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields`  | 10 QPS；**单字段单次**，需循环创建                                                                           |
| 查询字段          | GET    | 同上                                                               | —                                                                                                            |
| 列出记录          | GET    | `/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records` | `page_size` 默认 20、**最大 500**；`page_token` 分页；需 `automatic_fields=true` 才返回 `last_modified_time` |
| 批量新增记录      | POST   | `.../records/batch_create`                                         | 单次 ≤500（`1254104`）；单表 ≤20000 条（`1254103`）                                                          |
| 批量更新记录      | POST   | `.../records/batch_update`                                         | 单次 ≤500                                                                                                    |
| 批量删除记录      | POST   | `.../records/batch_delete`                                         | 单次 ≤500 个 record_id                                                                                       |

> 官方标注"列出记录"为历史接口、推荐改用 `POST .../records/search`。实施时优先验证 `search`，若字段/分页语义一致则采用，否则回退 `list`；两者差异记入实施笔记。

**字段类型枚举**（官方核实，V1.1 的映射有误）

| type | 含义         | 本设计用途                                            |
| ---- | ------------ | ----------------------------------------------------- |
| 1    | 多行文本     | ID / 用户名 / 密码 / 网址 / 标签 / 备注 / TOTP        |
| 2    | 数字         | `updateTime`（毫秒时间戳）                            |
| 5    | 日期         | 不使用                                                |
| 1001 | 创建时间     | 不使用（record 元数据已提供）                         |
| 1002 | 最后修改时间 | **不使用**（改用 record 元数据 `last_modified_time`） |

**关键约束**

- **`is_unique` 参数不存在**：创建字段 API 仅有 `field_name`/`type`/`property`/`ui_type`/`is_primary`/`is_hidden`/`description`。业务 ID 唯一性由适配器写入前前置校验保证（同腾讯）。
- **索引列不可隐藏**：官方明确"索引列不能删除、移动或隐藏"，且 `is_primary` 仅支持 type 1/2/5/13/15/20/22。故**首列设为"用户名"（type=1, `is_primary:true`）**，ID 列置于末位并设 `is_hidden:true`。
- 幂等：创建字段/记录接口支持 `client_token`（uuidv4）做幂等更新，重试时复用同一 `client_token` 避免重复写入。

**错误码映射**

| 错误码                    | 含义                           | 处理策略                                             |
| ------------------------- | ------------------------------ | ---------------------------------------------------- |
| 99991663 / 99991661       | token 无效或过期               | 刷新 `tenant_access_token` 后重试 1 次               |
| 1254003                   | AppToken 错误                  | 文档链接无效，提示核对                               |
| 1254040                   | Base 不存在                    | 文档已删除或无权限                                   |
| 1254041                   | Table 不存在                   | 目标表被删除，引导重建                               |
| 1254045                   | 字段名不存在                   | **表结构被外部篡改**，终止同步并告警（见 §11）       |
| 1254015 / 1254060~1254069 | 字段类型/值转换失败            | 表结构被篡改或值格式错误，终止并告警                 |
| 1254103                   | 记录数超上限（20000）          | 提示云端表已满，引导清理或换表                       |
| 1254104                   | 单次新增超上限（500）          | 适配器分批缺陷，内部修正后重试                       |
| 1254130                   | 单元格内容过大（TooLargeCell） | 密文分片**动态减半重试**（见 §5.2）                  |
| 1254290                   | 请求过快（TooManyRequest）     | 指数退避重试 ≤2 次                                   |
| 1254291                   | **写冲突（同表不支持并发写）** | 退避重试 ≤2 次；仍失败则终止并提示"请勿多端同时同步" |
| 1254302                   | 权限不足                       | 引导在飞书后台给应用分配 Bitable 权限                |
| 1254607                   | 数据未就绪                     | 可重试，退避 ≤2 次                                   |
| 1255040                   | 请求超时                       | 重试 ≤2 次                                           |
| 5xx                       | 平台异常                       | 重试 ≤2 次，失败终止                                 |

### 3.3 适配器统一错误处理边界

- 单请求超时：15s（`AbortController`）
- 网络层重试：≤2 次，仅针对 5xx / 超时 / 429 / `1254290` / `1254291` / `1254607`；429 读 `Retry-After`，其余 2s 起指数退避
- 不可重试：4xx 与业务错误码直接失败并映射为上表策略
- 配额计数：**内存计数器仅预估预警，不硬阻断**；页面刷新清零；以平台服务端计数为准。腾讯达当日 80%、飞书达窗口 80% 时 UI 预警，文案明确"配额仅本地估算，以平台实际计费为准"

### 3.4 WebDAV

WebDAV 为文件协议（非表格 API），其平台规格、单文件密文快照格式、传输安全门与编排流程见独立规格 `2026-09-24-webdav-sync-design.md`。

## 4. 表结构与建表

### 4.1 明文模式表结构

表名约定：`APH-Sync-Plaintext`

| 序  | 字段名       | 飞书 type              | 腾讯类型 | 说明                                          |
| --- | ------------ | ---------------------- | -------- | --------------------------------------------- |
| 1   | 用户名       | 1（`is_primary:true`） | text     | **首列/索引列**，用户可见有意义；不可隐藏     |
| 2   | 密码         | 1                      | text     | 明文密码                                      |
| 3   | 网址         | 1                      | text     |                                               |
| 4   | 标签         | 1                      | text     | 英文逗号拼接，同本地                          |
| 5   | 备注         | 1                      | text     |                                               |
| 6   | TOTP         | 1                      | text     | `otpauth://` URI 或裸 Base32                  |
| 7   | 分组         | 1                      | text     | 分组全路径（`/` 拼接），未分组为空串          |
| 8   | 本地更新时间 | 2（数字）              | number   | 本地 `updateTime` 毫秒值，供人查看与 LWW 参考 |
| 9   | ID           | 1（`is_hidden:true`）  | text     | 业务主键 `PasswordEntry.id`；**末位 + 隐藏**  |

- 云端修改时间**不建字段**，从 record 元数据读取（腾讯 `record.updateTime` / 飞书 `last_modified_time`）。
- 腾讯侧若不支持字段隐藏（官方文档未明确），ID 列保持可见但置于末位，实施时验证并记入笔记。

### 4.2 密文模式表结构

表名约定：`APH-Sync-Encrypted`

| 序  | 字段名          | 飞书 type              | 腾讯类型 | 说明                                                              |
| --- | --------------- | ---------------------- | -------- | ----------------------------------------------------------------- |
| 1   | partKey         | 1（`is_primary:true`） | text     | **首列/索引列**，格式 `{snapshotGroupId}#{partIndex}`，保证行唯一 |
| 2   | snapshotGroupId | 1                      | text     | UUID，单次快照全局唯一分组 ID，同组所有分片共用                   |
| 3   | partIndex       | 2                      | number   | 分片序号，从 0 开始                                               |
| 4   | totalParts      | 2                      | number   | 本次快照总分片数                                                  |
| 5   | snapshotHash    | 1                      | text     | 完整密文 Blob 的 SHA-256（顶层全局哈希）                          |
| 6   | partHash        | 1                      | text     | 当前分片 Base64 串的 SHA-256                                      |
| 7   | payload         | 1                      | text     | Base64 分片内容                                                   |
| 8   | version         | 1                      | text     | 快照格式版本号                                                    |
| 9   | exportedAt      | 2                      | number   | 本地导出时间戳（毫秒），用于排序取最新与保留策略                  |

> `partKey` 与 `snapshotGroupId` 必须分离：索引列要求行级唯一，而分组 ID 在同组所有分片间重复。分组、清理、恢复均按 `snapshotGroupId` 聚合，`partKey` 仅用于满足平台索引列唯一性。

### 4.3 首次建表流程

用户粘贴文档 URL 后：

1. 解析 URL 提取文件标识（飞书 `app_token`；腾讯 `fileID`），调用 `listTables()` 列出该文件下的表。
2. 按表名约定 `APH-Sync-{Encrypted|Plaintext}` 查找既有同步表。
3. 找到 → 调用 `checkTableSchema()` 校验结构匹配：
   - 明文表：≥9 字段，且存在 `ID`/`用户名`/`密码`/`分组` 等关键字段名，类型与 §4.1 一致
   - 密文表：≥9 字段，且存在 `partKey`/`snapshotGroupId`/`payload`/`partHash`/`snapshotHash`
   - 匹配 → 复用；**不匹配 → 终止并提示**"已存在同名但结构不符的表，请手动删除或指定其他文档"，**不自动修改云端表结构**（防误删用户自定义字段）
4. 未找到 → 自动创建：
   - 飞书：`POST .../tables` 建表（含首列索引字段）→ 循环 `POST .../fields` 逐个创建剩余字段（10 QPS，需节流）
   - 腾讯：`POST .../sheets`（`addSheet`）建子表 → `addFields` 创建字段
5. 建表/复用成功后，将 `fileID + sheetID`（或 `app_token + table_id`）回写 `cloudSyncStore.providers[x].target`，后续同步直接使用，不再探测。
6. 探测/建表失败（权限不足、配额超限、链接无效）给出可理解错误，不静默。

## 5. 密文备份模式（分片 + 双层哈希）

> 本地把全部条目打包、AES-256-GCM 加密得到完整 Blob；Base64 编码后按安全阈值切分为多行分片存入云端表。**单向备份 + 手动恢复**，不做行级 diff。

### 5.1 备份（推送）流程

1. 会话有效性检查（`isSessionValid()`）；无效则引导解锁。
2. 获取任务锁（§2.2）。
3. `getAllPasswords()` 取全量明文条目，并读取 `password_groups` 分组树 → 序列化为版本化 JSON `{version:1, exportedAt, count, entries, groups}`（`entries` 为 `Omit<PasswordEntry,'order'>[]`，与既有 `.aph` 备份的 `BackupData` 结构对齐）。
4. 用**当前主密码**（经 `promptAndVerifyMasterPassword` 验证通过；**不允许用户自定义口令**，避免记错导致云端 Blob 永久无法恢复）PBKDF2-SHA256 600k 派生密钥，随机 12 字节 IV，AES-256-GCM 加密。
5. 计算完整 Blob 的 SHA-256 → `snapshotHash`。
6. Blob 转 Base64，按 **48000 字符**安全阈值切分（预留平台单元格上限余量）；每片计算 Base64 串 SHA-256 → `partHash`；分配 `partIndex`/`totalParts`/统一 `snapshotGroupId`（UUID），并生成行级唯一索引 `partKey = {snapshotGroupId}#{partIndex}`。
7. 文本清洗（§5.5）后批量写入云端全部分片。
8. **全部分片写入成功才标记该版本快照生效**；任一分片失败 → 该 `snapshotGroupId` 全部分片标记无效，同步结束时**自动清理该分组已写入的分片**（按 `snapshotGroupId` 批量删除），报告失败原因。
9. 成功后更新本地快照元数据（仅记录 `snapshotGroupId`/`snapshotHash`/`exportedAt`/`totalParts`，**不记录 Blob 内容**）并写审计日志。
10. 版本保留策略：保留最近 N 版本（默认 N=3，可配），超出则按 `snapshotGroupId` 批量删除全部分片。
11. 兜底清理：每次备份前置扫描，自动清理 `exportedAt` 超过 7 天且不在保留列表内的**残缺孤儿分组**（分片数 ≠ `totalParts`）。

### 5.2 分片大小动态降级

平台单元格上限官方未给确切数字（飞书仅返回 `1254130 TooLargeCell`）。策略：

- 初始阈值 48000 字符
- 捕获 `1254130`（飞书）或腾讯对应字符校验错误 → 阈值减半（48000 → 24000 → 12000 → 6000），**重新分片整组重试**（同一 `snapshotGroupId` 先清理已写分片再重写）
- 降至 6000 仍失败 → 终止并报告"平台不支持当前内容长度"
- 成功阈值写入本地配置，下次直接使用，避免重复试探

### 5.3 恢复校验链（串行，任一校验失败即拒绝恢复 + 告警）

1. 查询云端全部分片记录，按 `exportedAt` 降序取最新完整分组（或用户在 UI 选择历史版本）。
2. 校验分片数量 == `totalParts`；不匹配 → "快照残缺"，终止恢复。
3. 按 `partIndex` 升序排序；逐片校验 `partHash`；不匹配 → "分片损坏或被篡改"，终止恢复。
4. 拼接 `payload` → Base64 解码得到完整密文 Blob。
5. 计算 Blob SHA-256 对比 `snapshotHash`；不匹配 → "整体快照损坏"，拒绝恢复。
6. 全部校验通过 → 输入主密码 AES-GCM 解密（GCM authTag 校验失败即拒绝，不落敏感日志）。
7. 解密结果视为**不可信导入数据**：逐条类型/长度/格式校验，非法条目跳过并计数。
8. 按 ID 增量合并：本地无 → 新增；本地有且云端 `updateTime` 更新 → 更新（本地旧值进密码历史）；本地有且本地更新 → 跳过。
9. **恢复不删除本地任何条目**（纯增量合并），报告列出新增/更新/跳过数。

### 5.4 密文恢复的 rekey 边界

密文 Blob 由"推送时"的主密码派生密钥加密。若期间用户修改过主密码（rekey），恢复时用新主密码解密会失败（GCM auth 失败）——**这是预期行为**，界面提示"该备份由修改主密码前生成，无法用当前主密码解密"，不尝试其他口令、不暴力重试。用户仍可依赖本地数据或更早的本地 `.aph` 加密备份。

### 5.5 文本清洗规则（提交云端前统一执行）

1. 过滤不可打印 ASCII 控制字符 `0x00~0x1F`、`0x7F`，**保留 `\r\n`**（备注字段可能含换行）
2. 移除零宽字符（U+200B 零宽空格、U+200C/200D 连接符、U+FEFF BOM 等）
3. 超长文本按平台单元格上限提前截断，同步报告记录**截断事件**（字段名 + 原长度 + 截断后长度），**绝不记录原始内容或脏字符**
4. 清洗仅作用于提交云端的数据副本，**不修改本地存储的原始条目**

## 6. 明文双向同步模式

前置：每次同步强制 `promptAndVerifyMasterPassword` + 弹窗内红字警告"明文密码将上传到第三方云端"。

### 6.1 本地快照

存储：`chrome.storage.local`，键 `cloud_sync_snapshot_{provider}_{docKey}`

```ts
interface SyncSnapshot {
  provider: 'feishu' | 'tencent';
  docKey: string; // 飞书 `${app_token}:${table_id}`；腾讯 `${fileID}:${sheetID}`
  entries: Record<
    string, // 业务 ID
    { hash: string; recordId: string; syncedAt: number }
  >;
}
```

- **多文档隔离**：不同 provider / 不同文档键名不同，飞书与腾讯各自独立，切换不互相覆盖。同 provider 换目标文档视为全新同步链路，旧快照保留不自动迁移（提供手动清理入口）。
- `hash` = **仅 7 个同步字段**（username/password/url/tag/remark/totp/groupPath）按固定顺序拼接后的 SHA-256。**明确不含 ID、`updateTime`、云端修改时间**——扩展自身推送会刷新云端 record 修改时间，若混入会导致哈希恒 ≠ 快照，把"刚推完的行"误判为"云端侧变更"。
- 快照属**可重建缓存**：丢失/损坏时降级为"全量比对 + 时间戳 LWW"，不致命；提供 UI 入口【全量拉取云端重建本地快照】用于修复不一致。

### 6.2 Diff 匹配优先级

1. 优先按云端 `recordId` 匹配快照条目；命中 → 直接比对内容哈希。
2. `recordId` 未命中但**业务 ID 完全一致** → 判定为 `recordId 迁移`（平台重建行/用户复制行），本地快照替换为新 `recordId`，**不标记冲突**，继续正常比对。
3. 云端行的业务 ID 与快照记录不一致（同一 recordId 但 ID 变了）→ 判定为**用户手动修改主键**，标记人工冲突，**禁止自动覆盖**，等待用户在预览中确认。
4. 云端行无业务 ID（用户在文档手工新增）→ 回退 `url + username` 判重：与本地已有条目重复 → 跳过并报告；无重复 → 视为云端新增，导入时分配新业务 ID。

### 6.3 Diff 规则（三方比对：本地 / 云端 / 快照）

| #   | 本地 | 云端 | 快照 | 判定与动作                                                                                                                                          |
| --- | ---- | ---- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 变   | 未变 | 有   | **推送更新**（本地哈希 ≠ 快照，云端哈希 = 快照）                                                                                                    |
| 2   | 未变 | 变   | 有   | **拉取更新**（云端修改时间 > 快照 `syncedAt` 且云端哈希 ≠ 快照，本地哈希 = 快照）                                                                   |
| 3   | 变   | 变   | 有   | **冲突 → LWW**：本地 `updateTime` vs 云端 record 修改时间，新者胜；败方数据不丢弃（本地败 → 旧值进密码历史；云端败 → 覆盖回推）；冲突行进报告与预览 |
| 4   | 有   | 无   | 有   | **云端侧删除** → 本条目进回收站（复用 `trashManager`，可恢复）                                                                                      |
| 5   | 无   | 有   | 无   | **云端新增** → 导入本地（`url+username` 与本地重复时跳过并报告）                                                                                    |
| 6   | 无   | 有   | 有   | **本地删除** → 删除云端行（本地已无、云端仍在、快照证明上次同步存在）                                                                               |
| 7   | 有   | 无   | 无   | **本地新增** → 推送（写入业务 ID）                                                                                                                  |
| 8   | —    | —    | —    | **导入前校验**：云端行按不可信输入处理，校验字段长度上限、类型、非法字符；非法行跳过并报告，绝不写入执行性内容                                      |

- 云端修改时间**只做快速过滤**，最终判定以快照哈希比对为准（推送成功后把推送后的云端哈希与新 `recordId` 写回快照）。
- 外部变更（云端存在快照与本地均无的 recordId 且带业务 ID）→ 按 §1.2 标记人工冲突，不自动合并。
- **modify/delete 冲突**（规则 4 的子情形）：本地有、云端无、快照有，且**本地哈希 ≠ 快照**（本地在云端删除后又改过）→ 不直接进回收站，标记人工冲突，预览中让用户选择「保留本地修改（重新推送）」或「确认删除（进回收站）」。仅当本地未变（本地哈希 = 快照）时才按规则 4 静默进回收站。
- 双方均无、仅快照有（本地与云端都已删除）→ 清理该快照条目，无其他动作。

### 6.4 批量执行与部分成功处理

适用于 `batchUpsert` / `batchDelete`，两平台适配器统一逻辑：

1. 按平台上限分批（飞书 ≤500/请求；腾讯 ≤500/请求），**批间串行**（规避飞书 `1254291` 写冲突）。
2. 适配器解析响应，分离 `succeeded`（含云端返回的 `recordId`）与 `failed`（含子错误码、消息）。
3. **禁止整批重试**，仅对失败条目生成子批次重试，最多 2 次。
4. `batchDelete` 特殊规则：
   - 子项 `recordId` 不存在（飞书 `1254043`）视为**业务成功**，不重复删除
   - 仅重试"存在但删除失败"的条目
   - 腾讯兼容分支：若腾讯 `deleteRecords` 一条失败即整批返回失败且无成功子集，适配器自动降级拆分更小批次，最低降级至单条删除
5. **快照增量更新**：每批云端操作成功返回后，**立即增量更新**本地快照的 `recordId` 映射、业务 ID、数据哈希（而非全部完成后一次性写入），降低中途失败导致的不一致窗口。
6. 风险兜底：本地快照写入失败（存储异常/页面崩溃）→ 终止本轮同步，报告告警"云端写入成功但本地快照保存失败，存在数据不一致风险"，引导用户执行【全量拉取云端重建本地快照】。

### 6.5 同步按钮防重与取消

- 同步期间按钮 disabled + 文案"同步中…"，配合 §2.2 任务锁双重防护。
- 提供【取消】按钮：`AbortController.abort()` 所有进行中请求，已完成批次的快照更新保留，`finally` 释放锁，报告标注"用户取消，部分完成"。
- 组件卸载/弹窗关闭时自动 abort 并释放锁。

## 7. 配置与凭证

### 7.1 配置（非敏感，`cloudSyncStore` 走 `createConfigStore` 工厂）

```jsonc
{
  "enabled": true,
  "keepVersions": 3,
  "providers": {
    "feishu": {
      "configured": false,
      "mode": "encrypted", // 'encrypted' | 'plaintext'
      "target": { "appToken": null, "tableId": null, "fileUrl": null },
      "chunkSize": 48000, // 分片阈值，动态降级后回写
    },
    "tencent": {
      "configured": false,
      "mode": "encrypted",
      "target": { "fileId": null, "sheetId": null, "fileUrl": null },
      "chunkSize": 48000,
    },
  },
}
```

- 飞书与腾讯**配置完全独立**：各自凭证、目标、快照互不影响。UI 内切换 Tab 不清除另一边数据。
- 同一 provider 换目标文档 → 视为全新同步链路，旧快照保留不动（可手动清）。
- 存储键新增至 `utils/storageKeys.ts` 的 `STORAGE_KEYS`：`CLOUD_SYNC_CONFIG`、`CLOUD_SYNC_CREDENTIALS`、`CLOUD_SYNC_AUDIT_LOG`；快照键按 §6.1 动态拼接；锁键置于 `SESSION_MEMORY_KEYS`。

### 7.2 凭证（敏感，AES-256-GCM 加密后存 `chrome.storage.local`）

```ts
interface CloudSyncCredentials {
  feishu: { appId: string; appSecret: string };
  tencent: { clientId: string; openId: string; accessToken: string };
}
```

- 加密密钥：`getSessionDataKey()`（会话数据密钥）。锁定后会话密钥销毁 → 凭证不可解，符合项目 at-rest 加密不变量。
- 同步本就要求解锁会话，无体验损失。
- **飞书 `tenant_access_token` 不持久化**：由 `appId`/`appSecret` 运行时换取，内存缓存 + 过期前 30s 预刷新，页面销毁即清空。
- **腾讯 `accessToken` 需持久化**（用户手动生成，无换取接口）：加密存储；API 返回 37019/10302/10303 时提示"凭证已失效，请到腾讯文档开放平台重新生成并粘贴"，**不清除其他配置**。
- **rekey 兼容**：修改主密码会更换会话数据密钥，旧密文凭证解密失败（GCM auth 失败）。处理方式与 token 过期一致：提示"凭证需重新录入"，引导在弹窗中重填，不清除目标表配置与快照。
- 凭证输入框统一 `type="password"`；日志与审计日志**绝不记录** token/secret 原文。

## 8. 审计日志

持久化于 `chrome.storage.local`（独立键，与业务快照分离），用于同步操作追溯。

1. **字段白名单**（安全硬约束）：
   - 允许：时间戳、provider、模式、操作类型（backup/restore/sync/rebuild/clearVersions/clearLog）、条目业务 ID、数据哈希、云端 recordId、同步结果统计、冲突标记、异常简要信息（错误码 + 平台消息）
   - **禁止**：明文密码、TOTP 密钥、用户名、网址、备注、完整 payload、token/secret
2. 滚动策略：最多保留最近 **100 条**，FIFO 淘汰最早记录。
3. UI 提供【手动清空审计日志】按钮；导出审计日志时不含任何可还原明文的内容。
4. 写入失败不阻断同步主流程，仅在报告中提示"审计日志写入失败"。

## 9. 同步报告输出规范

每次同步结束生成结构化报告（UI 展示 + 审计日志摘要）：

1. **基本信息**：平台、目标表、同步模式、起止时间、耗时
2. **操作统计**：新增 / 更新 / 删除 / 冲突 / 跳过 条目数
3. **冲突明细**：逐行列出（用户名 + 网址，**不含密码**）+ 胜出方 + 败方数据去向
4. **分片完整性告警**（密文模式）：分片缺失 / `partHash` 损坏 / `snapshotHash` 不匹配 / 动态降级次数
5. **批量操作明细**：成功条目数、失败条目 + 错误码 + 原因
6. **配额与存储**：本次预估消耗 API 次数、当日累计预估、本地快照占用提示
7. **警告项**：多设备共用警告、表结构篡改告警、快照保存失败、文本截断事件、用户取消

失败请求逐条列出，**不静默吞掉**任何错误（符合 `AGENTS.md`"用户可见操作失败时给出反馈"）。

## 10. UI（CloudSyncDialog.vue）

单弹窗，飞书/腾讯通过 **Tab 切换**（配置互相独立，切 Tab 不清另一边数据）：

1. **模式选择**：密文（默认，标注"推荐，云端内容不可读"）/ 明文（标注风险，切换需二次确认）。
2. **凭证与目标**：按当前 provider 动态表单；凭证输入框 password 型；粘贴文档 URL 自动解析；【测试连接】按钮（验证凭证有效 → 探测目标表 → 无则按 §4.3 自动建表 → 成功后回写 target 并提示"表已就绪"）。
3. **同步操作区**：
   - 显示上次同步时间、当前模式、目标表名
   - 【立即同步】（同步中置灰 + 进度条 + 【取消】按钮）
   - 【从云端恢复】（仅密文模式显示）
   - 【清理旧版本】（仅密文模式显示，按保留策略删除云端旧分组，不动本地）
   - 【全量拉取云端重建本地快照】（仅明文模式显示，修复快照不一致）
   - 【清空审计日志】
4. **结果报告区**：按 §9 结构渲染。
5. **告警弹窗**：本地存储写入失败、配额预警、快照损坏、表结构异常、多设备共用警告、凭证失效。
6. **首次开启引导**：密文模式弹窗说明备份原理与恢复校验机制；明文模式**强风险确认弹窗**（需勾选"我已理解明文密码将上传至第三方服务器"才可继续）。
7. 模式切换（密文 ↔ 明文）提示：将使用不同表结构，需重新指定/新建目标表，旧表数据不自动迁移。

## 11. 异常处理：云端表结构被外部篡改

1. **前置校验**：每次同步启动执行 `checkTableSchema()` 全量校验字段名与类型，失败直接终止同步。
2. **运行时捕获**：API 返回字段不存在/类型不匹配（飞书 `1254045`/`1254015`/`125406x`；腾讯对应错误）→ 立即停止本轮同步；**已成功写入云端的数据保留，不自动回滚**；报告告警"目标数据表结构被外部修改"，引导用户删除云端表由系统重建。
3. **绝不自动修改/修复云端表结构**，防止误删用户自定义字段。

## 12. 外部依赖风险项（纳入测试计划，不修改规格）

### E1 腾讯智能表 batchDelete 部分失败返回结构不确定

- 风险：官方文档未明确部分删除成功场景的返回体；最坏情况一条失败即整批返回失败且无成功子集。
- 方案：联调专项测试抓包确认真实报文；适配器预留两套逻辑分支（正常解析 / 降级拆分小批次至单条删除）；测试用例覆盖"混合有效 + 无效 recordId 批量删除"。

### E2 长 Base64 分片与特殊字符的平台隐性校验差异

- 风险：飞书/腾讯对超长连续 Base64、emoji、特殊 Unicode 的校验存在隐性限制，纸面无法穷举（飞书仅返回 `1254130 TooLargeCell`，无确切字符数）。
- 方案：分片预留安全阈值（48000）+ §5.2 动态减半降级；构建字符测试用例集做双平台冒烟测试；捕获字符校验报错后报告"平台不支持该内容"并动态减小分片重试。

### E3 飞书"列出记录"为历史接口

- 风险：官方标注不再推荐使用，建议改用 `POST .../records/search`，未来可能下线。
- 方案：实施时优先验证 `search` 的字段语义与分页行为，一致则采用；适配器内部封装分页，切换接口不影响上层。

### E4 腾讯智能表字段隐藏能力未明确

- 风险：官方文档未说明是否支持字段隐藏，ID 列可能必须可见。
- 方案：实施时验证；不支持则 ID 列可见但置末位，UI 文案相应调整（不影响功能正确性）。

## 13. i18n 与文档同步

- 新增 namespace `cloudSync`：`utils/i18n/locales/zh-CN/cloudSync.json` + `utils/i18n/locales/en/cloudSync.json`，**key 集必须一致**；在 `utils/i18n/bundles/options.ts` 注册；跑 `tests/utils/i18nBundles.test.ts`。
- 仅 Options 侧使用，**不新增 i18n-lite 文案**（无 content/background 可见文案）。
- 文档同步更新（中英文表达同一事实）：
  - `README.md` / `README.en.md`：功能说明 + 明文模式风险告知
  - `docs/ARCHITECTURE.md` / `.en.md`：「功能实现详解」新增"云文档同步"节（架构、数据流、安全设计）
  - `privacy.html` / `privacy.en.html`：新增"可选云文档同步"数据外传说明（外传内容、目的、平台、默认关闭、明文模式风险）
  - `docs/CWS_FILL_CONTENT.md` / `docs/CWS_PUBLISHING_GUIDE.md`：隐私与发布口径更新
  - 侧边栏 `help.json` / `HelpDialog.vue`：本功能仅在 Options 提供，**不进侧边栏帮助**（避免 `help.gx` 数字序号联动与测试改动）
  - `wxt.config.ts`：**无权限变化**（`host_permissions: ['<all_urls>']` 已覆盖），manifest 描述不变

## 14. 测试

| 模块               | 测试用例                                                                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `diff.ts`          | 纯函数单测：§6.3 八条规则各正反用例、§6.2 四级匹配优先级、recordId 迁移、主键被改判人工冲突、url+username 回退、非法行跳过、快照缺失降级、幂等重跑、**modify/delete 冲突（本地改+云端删）判人工冲突而非静默进回收站**、**双方均删仅清快照**、**哈希不含 ID/updateTime/云端时间的验证** |
| `cryptoSnapshot`   | 分片切分与重组往返、`partHash` 篡改拒绝、`snapshotHash` 不匹配拒绝、分片缺失拒绝、GCM auth 失败、旧版本格式、rekey 后解密失败路径、动态降级重试、**`partKey` 行级唯一性（同组多分片不冲突）**、**按 `snapshotGroupId` 聚合恢复**                                                       |
| `credentialStore`  | 加密存取往返、锁定后不可读、错误密钥解密失败、rekey 后解密失败降级                                                                                                                                                                                                                     |
| `snapshotStore`    | 多 provider/多文档键隔离、增量更新、写入失败终止、全量重建                                                                                                                                                                                                                             |
| `taskLock`         | 获取/释放、心跳续期、死锁抢占（≥30s）、并发拒绝、异常路径 `finally` 释放                                                                                                                                                                                                               |
| `sanitize`         | 控制字符过滤（保留 `\r\n`）、零宽字符移除、超长截断与事件记录、**不修改本地原始数据**                                                                                                                                                                                                  |
| `auditLog`         | 字段白名单（断言不含密码/TOTP/用户名）、FIFO 100 条淘汰、写入失败不阻断主流程                                                                                                                                                                                                          |
| `schema`（分组列） | 明文表 9 字段、分组列位置与类型、`entryToFields`/`fieldsToEntry` 路径往返、`SYNCED_TEXT_FIELDS` 含 groupPath、密文表不含分组列                                                                                                                                                         |
| `adapters/feishu`  | mock fetch：token 换取与过期前刷新、`page_size=500` 分页遍历、`automatic_fields` 解析、批量 ≤500 分批、部分成功解析、`1254291` 退避、`1254130` 降级、`1254045` 结构篡改终止、超时/重试                                                                                                 |
| `adapters/tencent` | mock fetch：三 Header 鉴权、文本值数组格式双向转换、`record.updateTime` 字符串转数字、`offset/limit` 分页、≤500 分批、部分成功解析、37019 凭证失效、429 退避、E1 降级分支                                                                                                              |
| 回收站联动         | 云端删除 → 条目进回收站 → 可恢复                                                                                                                                                                                                                                                       |
| 建表/探测          | 首次建表、结构匹配判定、结构不符终止、模式冲突提示、URL 解析                                                                                                                                                                                                                           |
| i18n               | bundle parity 测试通过（zh-CN / en key 集一致）                                                                                                                                                                                                                                        |

**验证矩阵**：`pnpm typecheck`、`pnpm lint`、`pnpm test:run`、`pnpm build`；文档与 JSON 改动跑 `pnpm exec prettier --check <files>`。

## 15. 安全边界与已知风险（如实记录）

1. **明文模式下密码以可读文本存在于第三方服务器**；文档链接/账号泄露 = 密码泄露。缓解：默认密文、强风险确认弹窗、每次同步主密码二次验证。**无法根除**，已在 `privacy.html` 与 README 如实告知。
2. 凭证加密依赖会话数据密钥；会话有效期内若本机存储被读取，凭证与密码条目同等暴露（**不劣于现状**）。
3. 云端数据是**不可信输入**：导入边界校验类型/长度/格式；禁止 `v-html`/`innerHTML`/`eval`；TOTP/URL 字段仅按文本处理，不解析执行。
4. 密文模式历史版本累积占用云端空间，由保留策略（默认 3 版）+ 7 天孤儿分片清理控制。
5. 配额计数为本地估算，可能与平台实际计费不一致；429 由 API 捕获兜底。
6. 平台 API 细节（腾讯字段隐藏、腾讯 batchDelete 部分失败返回体、飞书 search vs list、单元格确切上限）以实施时真实调用为准，发现偏差**回改本规格**（见 §12 E1~E4）。

## 16. 范围外（YAGNI）

- 不做定时/自动同步；不做多设备原生并发同步（快照仅存于本机）；不做回收站双向同步；不做收藏/排序/使用频次同步；不做 SidePanel 入口；不做除飞书/腾讯外的平台；不做云端→本地的自动冲突合并（人工冲突需用户确认）；不自动修改云端表结构。
