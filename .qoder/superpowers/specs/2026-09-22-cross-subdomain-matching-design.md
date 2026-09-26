# 同主域名跨子域匹配 · 设计文档

日期：2026-09-22
状态：待用户复核
来源：会话需求（issue #89 讨论中并行提出）

## 1. 问题与目标

用户在 `qq.com` 下有一条账号，打开 `mail.qq.com` / `music.qq.com` 时看不到它，需要手动切到「全站」范围再找。期望：先出当前域名的账号，当前域名没有则出主域名（`qq.com`）的账号，再没有则出同主域下其他子域的账号。

同时必须守住 2026-07 定下的口径：多测试环境账号严格隔离（`fat.example.com` 页面不得展示 `uat.example.com` 的条目）。这两个诉求是冲突的，本设计的解法是**把「跨子域」变成用户显式选择的档位，而不是修改默认匹配口径**。

目标：

1. 默认行为与今天逐字节等价（档位缺省 `off`）。
2. 内联下拉、一键/自动填充、侧边栏、右键菜单、Popup 计数共用同一份匹配分层，不允许出现「下拉里有、一键填的是另一条」。
3. 不新增权限、不新增网络请求、不改存储结构与加密格式、不迁移数据。

非目标：每域名级白名单、通配符正则全集、`all` 搜索范围语义调整、保存判重放宽。

## 2. 已锁定决策

| #   | 决策                           | 取值                                                                                        |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| D1  | 护栏层级                       | 全局三档设置，默认 `off`                                                                    |
| D2  | 自动/一键填充能否用非精确条目  | 能，按优先级取排序后首条                                                                    |
| D3  | 保存（含自动保存）判重         | **完全不改动** `findMatchingEntry` 的既有口径（同名 + host 相等或父子域包含，取最精确一条） |
| D4  | 实现形状                       | 单一分层匹配纯函数，两个真源共用                                                            |
| D5  | 判重未命中但同主域已有同名账号 | 保存弹窗加一行**只读提示**（已确认）                                                        |

## 3. 匹配分层

### 3.1 唯一真源

`utils/domain.ts` 新增：

```ts
/** 跨子域匹配档位 */
export type DomainMatchMode = 'off' | 'wildcard' | 'sameMainDomain';

/** 匹配层级：数字即排序权重，越小越靠前；-1 表示不匹配 */
export type MatchTier = 0 | 1 | 2 | 3 | 4;

export function resolveMatchTier(
  currentHost: string,
  storedUrl: string | undefined,
  mode: DomainMatchMode,
): MatchTier | -1;
```

### 3.2 层级表

以当前页 `mail.qq.com` 为例：

| tier | 语义                  | 命中条目示例      | 生效档位       | 所需 mode        |
| ---- | --------------------- | ----------------- | -------------- | ---------------- |
| 0    | 精确 host 相等        | `mail.qq.com`     | 全部           | `off`            |
| 1    | 通配条目命中          | `*.qq.com`        | 显式声明跨子域 | `wildcard`       |
| 2    | 主域名（裸 apex）条目 | `qq.com`          | 主域名兜底     | `sameMainDomain` |
| 3    | 同主域其他子域        | `music.qq.com`    | 兄弟子域兜底   | `sameMainDomain` |
| 4    | URL 为空的通用条目    | `''`              | 不限站点       | `off`            |
| −1   | 不匹配                | `uat.example.com` | —              | —                |

档位是包含关系：`sameMainDomain` ⊃ `wildcard` ⊃ `off`。`off` 档下只可能返回 0 或 4。

排序理由：

1. tier 1 排在 apex 之前——`*.qq.com` 是用户逐条写下的显式意图，强度高于「库里恰好有一条 `qq.com`」；且它是唯一不破坏测试环境隔离的放宽方式。
2. tier 4 保持今天的相对位置（现状：空 URL 条目纳入但优先级落 `1`，即排在精确条目之后）。新分层里它仍是末位。
3. `off` 档下 tier→priority 映射回 `{0, 1}`，与今天的二值优先级完全一致。

### 3.3 通配命中的安全边界

`*.qq.com` **不**用 `hostname.endsWith('.qq.com')` 判定（`evil-qq.com` 类可绕过，且 `xxqq.com` 前缀碰撞）。改为复用既有可信边界：

```
storedUrl 规范化后以 `*.` 开头
→ base = 去掉 `*.` 前缀
→ 命中 ⟺ getMainDomain(currentHost) === getMainDomain(base)
```

由此自动继承 `getMainDomain` 的全部规则：两段式 ccTLD 白名单（`com.cn` / `co.uk` 等取三段）、未收录 ccTLD 的启发式（`com.br` 等）、IP 与 `localhost` 原样返回。不新增第二套主域名口径。

`getMainDomain` 结果按 hostname 做 `Map` 记忆化（单次查询内复用，避免 O(N) 重复 URL 解析；600 条量级下这是新增的热点）。

### 3.4 不变的特殊路径

- `localhost` / `127.0.0.1`：仍走 `matchesPortForLocalDev` 端口过滤，档位完全不参与判定（本地多项目场景档位无意义）。
- 当前页无域名（新标签页）：仍放行全部条目。
- 跨域 iframe 的 `isFrameFillable` / `isSameMainDomain` 闸门：不动。
- `utils/storage/passwordCrud.ts:515 getPasswordsByUrl` 与 `configManager.ts:97 applySavedSortConfig`：**明确不放宽**（无生产调用方，保持精确语义），在函数 JSDoc 补一行「不走跨子域档位」防止后来者误用。

## 4. 三档设置

### 4.1 存储与读取

- 新键 `STORAGE_KEYS.DOMAIN_MATCH_CONFIG = 'domain_match_config'`，值 `{ mode: DomainMatchMode }`。
- `utils/storage/configManager.ts` 按既有三件套补：`getDefaultDomainMatchConfig()` / `getDomainMatchConfig()` / `saveDomainMatchConfig(partial)`。
- 只存档位枚举，不含域名或账号信息 → 明文 `storage.local`，不进加密快照、不参与备份格式。
- 缺键、读失败、值非法（含 `null`、非字符串、未知枚举）一律回落 `off`。
- 热路径读法照 `getCachedSortConfig()`：`entrypoints/background/passwordCache.ts` 增加 SW 内存镜像 `getCachedDomainMatchMode()`，由 `storage.onChanged` 与既有失效入口复位。SidePanel / Options 各自直接 `getDomainMatchConfig()`（非热路径）。
- **档位变更不触发缓存重建**：过滤发生在解密之后，改档位只影响下一次查询。此不变量用测试固定（改档位后 `warmPasswordCache` 调用次数为 0）。

### 4.2 设置对话框

`components/options/DomainMatchSettingDialog.vue`，`defineAsyncComponent` 异步加载，挂 `HeaderBar` 设置指令菜单 + `App.vue` 命令面板（照 `showFavoriteLimitDialog` 链路）。

| 档位             | 标题（zh）          | 说明要点                                                                       |
| ---------------- | ------------------- | ------------------------------------------------------------------------------ |
| `off`            | 仅精确匹配          | 只显示当前域名完全一致的账号（含网址为空的通用账号）。多测试环境账号严格隔离。 |
| `wildcard`       | 精确匹配 + 通配条目 | 额外纳入网址写成 `*.qq.com` 的账号，由你逐条决定哪些可以跨子域。               |
| `sameMainDomain` | 同主域名（更宽松）  | 当前域名没有账号时，依次带出主域名条目与同主域其他子域条目。                   |

选中 `sameMainDomain` 时，单选组下方展开一行只读警示：`fat.example.com` 与 `uat.example.com` 同属 `example.com`，测试环境账号会一并出现；如需隔离请改用通配条目档。

### 4.3 发现性入口（只读，不改可见集）

档位只在 Options 落地一份，侧边栏与内联下拉**不加重复开关**。为避免能力被埋没，补两处深链：

1. 侧边栏：只在**既有的空态引导分支**里出现（`SidepanelAuthView.vue:545` 那条「全站有 N 条」的同一槽位，条件 `searchScope === 'site' && globalMatchCount > 0` 不变），追加一行「同主域还有 N 条账号，可开启跨子域匹配」。刻意不扩到「有结果时也提示」：那样每次搜索都要遍历全量算 N，与侧边栏秒开 SLA 冲突，且用户已经在看到列表了。计数在这一分支内惰性算一次。
2. 内联下拉：同条件下，列表尾部提示区显示同一句文案。

两处点击发新消息 `OPEN_OPTIONS_AND_DOMAIN_MATCH`（照 `OPEN_OPTIONS_AND_SITE_RULES` 模式：判别联合加一条、`optionsPageManager.openOptionsAndSendMessage` 复用、Options 侧 `useRuntimeMessageHandler` 分发打开对话框）。域名自报值不作为参数传递，避免 senderValidation 需要新增收口分支。

## 5. 通配条目（`*.qq.com`）

### 5.1 语法与录入

- 唯一形态：`*.` 前缀 + 域名（可带端口/路径，如 `*.qq.com/login`）。不接受 `*.mail.qq.com` 之外的多级通配段（`*.*.qq.com`、`mail.*.qq.com` 拒绝），不做正则全集。
- 存储：仍写在 `PasswordEntry.url`，**不新增字段**（零加密格式/备份结构变更）。
- 校验：`utils/formValidators.ts` 的 `createUrlValidator` 无协议分支域名正则当前**不接受** `*`（实测 `*.qq.com` 报「格式不正确」）。补一个可选的 `*\.` 前缀分组，并只允许出现在最左、只允许一次。
- 引导：`PasswordFormDialog` / `QuickAddDialog` 网址字段补 placeholder 与一行 hint（`form.urlWildcardHint`），文案双语。
- 自动保存与快速添加通道：允许（沿用 `PASSWORD_FIELD_LIMITS.url = 100`），但自动保存采集到的永远是真实 host，不会自动产出通配条目——通配条目只来自用户手写。

### 5.2 下游连带点（必须同步处理，否则出现「能匹配但点不开」）

| 位置                         | 今天行为                                                    | 处理                                                         |
| ---------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| `toNavigableUrl('*.qq.com')` | 实测返回 `https://*.qq.com/`，导航到无效主机                | 剥掉最左 `*.` 后按 `qq.com` 组装，仍是 http/https 白名单边界 |
| `normalizeUrlForFavicon`     | `_favicon/?pageUrl=https://*.qq.com` 取不到图标，降级钥匙图 | 同一剥前缀逻辑，取 apex 图标                                 |
| `normalizeToHostAndPort`     | 保留 `*.qq.com`                                             | 不动（它是匹配键的规范化，通配符必须存活）                   |
| `matchesKeyword` 搜索        | `*.qq.com` 作为子串可搜                                     | 不动                                                         |
| 内联下拉/侧边栏 URL 展示     | 原样文本                                                    | 不动（原样显示才是「我声明的适用范围」）                     |

剥前缀只影响导航与图标两条派生路径，用 `stripWildcardPrefix` 单一辅助函数实现。

## 6. 两条填充路径的呈现

### 6.1 内联下拉

- 数据链：`GET_MATCHING_ACCOUNTS` → `getMatchingAccounts(domain, port)` → `sortMatchesForDomain` → `filterAndSortEntriesForDomain(…, mode)`。
- `MatchingAccountMeta` 新增 `tier: MatchTier`（纯元数据，不含敏感字段）。content script 据此决定呈现，**不再自行做域名判断**（保持「content 只收结论」的既有边界）。
- 呈现：tier ≥ 1 的行在副信息槽补一个「跨子域」chip，文案双语（`cs.inline.scopeCrossSubdomain`）。今天副槽是「备注优先、URL 兜底」且注释写着「列表已按域名过滤，URL 区分度趋近于零」——该前提在放宽后不再成立，chip 正是用来回答「这条为什么出现在这里」。
- 填充：点击任意行都走既有填充流程（D2）。跨子域条目填进当前页的输入框，成功即成功、失败走既有 `FillFailurePrompt`。
- 顶部计数、「查看全部」、键盘导航、Shadow DOM 隔离方式全部不变。

### 6.2 侧边栏

- `ScopeContext` 增加 `mode`；`matchesSiteScope` / `filterEntriesByScope` 改按 `tier >= 0` 判定，`site` 范围的可见集即 tier 集合。
- `canFill`（= `!offSiteIds.has(id)`）随之自然放宽：`sameMainDomain` 档下同主域条目变成本站可填充条目，`offSiteIds` 只在真正外站时命中。
- `getDomainPriority`（`useSidepanelData.ts:323` 与 `App.vue` 侧）改为直接返回 tier，排序与内联下拉同源。
- 列表行（`PasswordListItem.vue`）：tier ≥ 1 的行在 `.details` 内加同款 `el-tag` 风格小徽章，复用已抽出的 `buildTagPresentationRecords` 模式避免每行新增组件实例。
- 首屏 SLA：新增成本只有「一次 `getDomainMatchConfig()` 读」（打开时读一次并驻留）+ tier 查表。`off` 档下 `resolveMatchTier` 必须短路在精确比较分支内（不额外解析主域名），由 `benchmarks/sidepanel-p0.bench.ts` 守住。
- Popup 不做列表、不做徽章：`usePopupInit.ts:41` 的 `domainMatchCount` 只把精确比较换成 `resolveMatchTier(...) >= 0`，继续排除空 URL 条目（它表达的是「此站已有账号数」，不是侧边栏可见集），不新增 UI。

### 6.3 右键菜单 / 一键填充

`contextMenuManager.ts:297`、`quickFillHandler.ts:283` 共用 `sortMatchesForDomain`，透传档位后自动获得同一顺序，首条即结果首项（D2）。

## 7. 保存判重与提示（D3 + D5）

**先纠正一个事实**：自动保存判重今天就不是精确匹配。`utils/storage/autoSaveManager.ts` 的 `findMatchingEntry` 走的是 `hostMatchScore`——同名 + 「host 相等（2 分）」或「任一方为另一方父域（1 分）」，多条命中取最精确一条。也就是说在 `mail.qq.com` 上保存同名账号，今天就已经会更新库里 `qq.com` 的那条，而不是新增。本设计**不动这个口径**（D3），但必须把它显式说出来，因为它决定了提示的两种形态。

两条只读提示，都渲染在 `SavePasswordPrompt` 备注行下方，均为纯文本、不提供按钮：

| 情形                       | 判据                                                          | 文案                                                | 档位门禁                     |
| -------------------------- | ------------------------------------------------------------- | --------------------------------------------------- | ---------------------------- |
| 更新目标属于别的 host      | `status === 'password_changed'` 且命中条目 host ≠ 当前页 host | 「将更新 <entry.url> 的同名账号」                   | 无（今天就在更新，只是没说） |
| 同主域已有同名但未判重命中 | `status === 'new'` 且存在「同主域 + 同名」条目（tier 3 场景） | 「库中已有 <entry.url> 的同名账号，本次将新增一条」 | 仅非 `off` 档                |

第一行是本功能顺带补上的既有盲点：父子域判重（1 分）静默改写另一站条目，弹窗标题只说「检测到密码有更新」，用户无从知道更新的是哪一条。

实现约束：

- 预检 `checkCredentialStatus` 的响应新增可选 `targetNote?: { kind: 'updateOtherHost' | 'willCreate'; url: string }`，`url` 取条目原样字符串（不含用户名/密码/备注），沿用既有 `existing.tag / remark` 已达内容脚本的同一暴露级别。
- 判据计算复用 `utils/domain.ts` 的 tier 函数，不新写第三套域名判断。
- 提示不提供「改为新增」或「改为更新」的入口——那等于从后门把判重放宽或收紧。
- 不写入日志（`logger.debug` 只记 kind，不记 url）。
- Options 手动新增/编辑与侧边栏快速添加不经过 `findMatchingEntry`，行为不变。

## 8. 错误与降级

| 场景                                            | 行为                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| 档位读失败 / 值非法                             | 回落 `off`（精确匹配），`logger.warn` 一次，不打扰用户                   |
| `getMainDomain` 解析异常输入（含空格、超长串）  | `resolveMatchTier` 返回 `-1`（不匹配），不抛异常                         |
| 用户写了 `*.` 但后面域名非法                    | 表单校验拒绝，错误文案沿用 `form.invalidUrlExample` 并补示例             |
| 存储里存在畸形历史条目（`*.` 开头但 host 为空） | 视为不匹配；不进 tier 1                                                  |
| 通配条目在当前档位不生效                        | 条目本身不消失（`all` 范围仍可见），只是不进 `site` 可见集、不可一键填充 |
| 档位切换后 SW 镜像未更新                        | `storage.onChanged` 是唯一复位源；SidePanel 每次打开重新读取一次兜底     |

## 9. 数据、权限、隐私影响

- 无新增 `permissions` / `host_permissions`，无新增网络请求，离线可用不变。
- 无存储结构变更、无迁移脚本；`url` 字段容量不变（100）。
- 通配条目文本会随条目一起参与既有加密、备份、导入导出、健康报告——不新增明文落盘面。
- 唯一新增暴露面：`MatchingAccountMeta.tier`（数字）与保存提示里的单个 URL 字符串，均已在 §7 约束。
- 降级风险：`sameMainDomain` 档下自动填充可能填错子域账号（用户已接受，靠排序 + 徽章 + 警示文案缓解）。

## 10. 测试矩阵

单元测试（Vitest）：

1. `resolveMatchTier` 全表：5 个 tier × 3 档 × {普通域名、两段式 ccTLD（`example.com.cn`）、启发式 ccTLD（`example.com.br`）、`localhost`、IP、空 host、空 URL、非法串}。
2. **等价性守卫**：同一份多环境夹具（`fat/uat/prod.example.com` + apex + 空 URL + 通配），`off` 档下 `filterAndSortEntriesForDomain` 与 `matchesSiteScope` 的结果（集合 + 顺序）与现实现逐 id 一致。
3. 档位包含关系：`wildcard` ⊃ `off`、`sameMainDomain` ⊃ `wildcard`，且 `off` 档结果不含任何 tier ≥ 1 条目。
4. 跨真源一致性：同一份条目集 + 同一档位下，侧边栏可见集与 `getMatchingAccounts` 返回集合同序同集合（含结果首条 == 一键填充取用条目）。
5. `configManager`：缺省 / 非法 / `save` 局部合并 / 回落 `off`。
6. `passwordCache`：档位镜像随 `storage.onChanged` 更新；改档位后不解密重算（`warmPasswordCache` 未被调用）。
7. `formValidators`：`*.qq.com` 通过、`*.*.qq.com` / `mail.*.qq.com` / `*.` 拒绝、`https://*.qq.com/login` 通过。
8. `toNavigableUrl` / `normalizeUrlForFavicon` 的 `*.` 剥离；`javascript:*.qq.com` 仍拒绝。
9. `autoSaveManager`：判重口径逐条断言「不变」（同名 + host 相等 → 更新；同名 + 父子域 → 更新且取最精确；同名 + 兄弟子域 → 新增），再断言两种 `targetNote` 的产出条件与档位门禁。
10. `messageRouter`：`OPEN_OPTIONS_AND_DOMAIN_MATCH` 未知字段/无 data 降级、`GET_MATCHING_ACCOUNTS` 锁定态仍不回账号与 tier。
11. `tests/architecture/sidepanelRowMemoFields.test.ts` 扩充：徽章所需字段必须留在 `v-memo` 依赖里。
12. i18n：`tests/utils/i18nBundles.test.ts` 通过（中英文 key 集一致）。

E2E（Playwright，真机扩展）：新增 `e2e/cross-subdomain.spec.ts`——站点规则同款夹具风格，覆盖「`off` 档内联下拉只有精确条目」→「切 `wildcard` + 建 `*.qq.com` 条目 → 出现在下拉且带 chip → 点击能填充」。

验证命令：`pnpm typecheck`、`pnpm lint`、`pnpm lint:style`、`pnpm test:run`、`pnpm build`，改动过的文档 `pnpm exec prettier --check`。

## 11. 文案与文档同步

- Vue 侧：`utils/i18n/locales/{zh-CN,en}/options.json`（设置对话框）、`form.json`（通配 hint）、`sidepanel.json`（深链提示、徽章）。
- 轻量侧：`utils/i18n-lite.ts` 补 `cs.inline.scopeCrossSubdomain`、`cs.save.noteUpdateOtherHost`、`cs.save.noteWillCreate` 三条（中英各一）。
- 侧边栏帮助：`utils/i18n/locales/{zh-CN,en}/help.json` 新增条目，并把 `HelpDialog.vue` 的 `helpItems('help.gx', N)` 的 N 提升 1（由 i18n bundle 测试守卫）。
- `README.md` / `README.en.md`、`docs/ARCHITECTURE.md` / `.en.md`（功能实现详解 + 域名匹配章节写明三档与 `isExactHostMatch` 的共存关系）。
- `index.html`（含 `pnpm gen:en`）、`wxt.config.ts` 描述、`docs/CWS_FILL_CONTENT.md`：仅在有对应功能句式时增补一句，不改动权限表述。

## 12. 实施顺序

1. `utils/domain.ts`：`DomainMatchMode` / `MatchTier` / `resolveMatchTier` / `stripWildcardPrefix` + `getMainDomain` 记忆化 + 单测（含等价性守卫基线）。
2. 两个真源接入：`utils/passwordSort.ts`、`utils/passwordFilter.ts`（新增 `mode` 入参，默认 `off`）。
3. 档位配置：`utils/storageKeys.ts` + `configManager.ts` + `passwordCache` 镜像 + 消息路由透传。
4. UI 消费方：`entrypoints/sidepanel/App.vue`、`useSidepanelData.ts`、`usePopupInit.ts`、`PasswordListItem.vue`、`SidepanelAuthView.vue`、`InlineFillDropdown.ts`、`MatchingAccountMeta.tier`。
5. 通配条目录入：`formValidators.ts` + 两个表单 hint + `toNavigableUrl` / favicon 剥离。
6. 设置对话框 + 深链消息（`DomainMatchSettingDialog.vue`、`HeaderBar.vue`、`messageRouter.ts`、`useRuntimeMessageHandler.ts`、`types.ts`）。
7. 自动保存只读提示（`autoSaveManager.ts`、`SavePasswordPrompt.ts`、`autoSaveHandler` 透传）。
8. i18n 全量词条 + 文档 + `pnpm gen:en`。
9. 测试补齐（§10）→ 全量验证 → 代码评审。

每一步单独可验证，禁止跨步混改（尤其第 4 步的 UI 改动不得顺带重排 SFC 块顺序）。
