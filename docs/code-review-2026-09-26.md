# 存量代码深度评审与安全评审报告

- 评审日期：2026-09-26
- 评审对象：`feature-opt` @ `d596fb4`（工作树含其他并发会话未提交改动，本次全程只读，未改动任何源码）
- 评审范围：`entrypoints/` `components/` `composables/` `utils/` 全部运行时源码（约 5.6 万行），加测试、构建配置、发布与隐私文档
- 本次交付：仅报告，不改代码
- **处置回写**：2026-09-27 追加 §9.1–§9.4 与 §10.1，记录报告之后 17 个提交（`ca33c83..43f867f`）对每条问题的实际处置与验证状态；§1–§8、§9 的 16 条建议原文、§10 原有五条限制说明均保持评审当时的状态，不做追改

---

## 0. 一句话结论

存量代码整体质量高，六道门禁全绿，加密集与会话边界的实现属于同类项目里的上游水平；**但侧边栏秒开 SLA 存在一条明确的错误态退化路径，2000 条上限在侧边栏（不是 Options 管理页）确实会卡**，安全面集中在"明文离开加密边界的三条出口与默认值"，而非密码学本身。

## 1. 客观门禁（本机实跑，非引用文档）

| 命令                                            | 结果                                      |
| ----------------------------------------------- | ----------------------------------------- |
| `pnpm typecheck`                                | exit 0                                    |
| `pnpm lint`（`--max-warnings 0`）               | exit 0                                    |
| `pnpm lint:style`                               | exit 0                                    |
| `pnpm test:run`                                 | **142 个文件 / 1563 例全绿**，125.31s     |
| `pnpm build`                                    | exit 0，产物 2.4 MB，zip 703.14 kB，19.2s |
| `pnpm exec prettier --check`（对外文档 + 配置） | exit 0                                    |

结论：**没有编译期、Lint 期或测试期的显性缺陷**。下面的高优问题全部是"门禁测不到"的那一类——运行时时序、规模效应、默认值取向、以及测试自身的盲区。

## 2. 问题计数（已按本报告复核结果调整）

| 级别        | 数量 | 含义                                         |
| ----------- | ---- | -------------------------------------------- |
| P0 立即处理 | 4    | 正确性错误或默认值直接把明文送出加密边界     |
| P1 尽快处理 | 15   | 规模性能瓶颈、信任边界误判、关键路径零测试   |
| P2 建议处理 | 20+  | 一致性、可访问性、样式与作用域纪律、发布口径 |
| 已推翻/下调 | 4    | 见 §8，子智能体报的"强主张"经复核不成立      |

---

## 3. 专项一：侧边栏秒开

### 3.1 结构性结论：SLA 的"快"是真的，"所有场景"不是

先说被验证为**没有问题**的部分，这些是刻意的设计取舍且实现自洽：

- **手势链零 await**：SW 侧四个入口（内容脚本 `SHOW_SIDEPANEL`、悬浮按钮 `TOGGLE_SIDEPANEL`、右键菜单、快捷键）到 `chrome.sidePanel.open()` 之间无任何 await，tabId 走 `getTabIdSync`（`sidePanelManager.ts:132-134`），符合 AGENTS.md 的硬约束。
- **结构上不存在纯白屏**：`sidepanel/index.html` 的内联骨架屏是 `#app` 的**兄弟节点**而非子节点，`main.ts` 同步把 `media="print"` 改回 `all`，i18n 用 50ms `Promise.race` 兜底后 mount。失败形态是"骨架屏 → 一张错误的卡片"，不是白屏。
- **三路竞速的并发结构是严密的**：null/reject 归一化为 null，`firstUsableCandidate` 永不 reject，代际 + 最新序号双守卫覆盖所有写回点（`:386-387`、`:1013`、`:1036`、`:1053`），rekey 与快速开关下不会把旧结果写回 UI。
- **预热清单与真实构建产物一致**：实测轻量层 61 文件 / 501KB、全量层 74 文件 / 585KB，**被提取的 href 全部存在于磁盘（0 缺失）**。"预热漏文件导致白屏"这条风险不成立。
- 保活闹钟 0.5min（MV3 下限被守住）注册幂等，SW 每次启动由 `syncSwKeepaliveAlarm` 重建。

### 3.2 [P0-1] 3 秒竞速超时把「有效会话」渲染成「会话已失效」，且对唤醒手势粘滞

`composables/useSidepanelData.ts:71` `LOCAL_PATH_TIMEOUT_MS = 3000`

```ts
// :1011-1018
if (!winner) {
  logger.warn(`SidePanel: 所有初始化路径在 ${LOCAL_PATH_TIMEOUT_MS}ms 内均未返回可用结果，安全降级锁定态`);
  if (isCurrentGeneration()) {
    _sessionKnownExpired = true;   // ← 粘滞位
    isAuthenticated.value = false; passwords.value = []; loading.value = false;
  }
```

一旦置位，两条唤醒路径都被同步守卫短路：

```ts
// handleVisibilityChange :717-727 —— 切走标签页再切回来
await loadCurrentTab();
if (_sessionKnownExpired) return;   // 跳过会话复查
// handleSessionChange :468-474 —— 会话变更广播
if (_sessionKnownExpired) { ...; return; }
```

- **触发条件**：三路在 3s 内都没产出可用结果。最现实的组合是浏览器冷启动 + 开启「重启后重锁」（`storage.session` 已清零，快照路径必不命中）+ 三条路径都要等最长 1.5s 的启动屏障（`browserStartupRelock.ts:29-30`）+ Windows 慢盘或杀软扫描。
- **后果**：会话实际有效，用户看到的却是「会话已失效」并被引导去重新输入主密码；切 Tab 回来不恢复。唯一自救是关闭再重开面板（新文档重跑初始化），或者慢路结果迟到并通过 `:1021-1032` 的复核。
- **定性**：这不是"慢"，是**错态**。AGENTS.md 的承诺是"所有场景秒开、无白屏"，这条路径既超 1s 又给出错误状态。
- **修复方向**（不改行为语义的最小方案）：超时后区分"无结果"与"确定失效"——只有当某条路径**明确返回** `sessionValid: false` 时才置 `_sessionKnownExpired`；纯超时只应落到"仍在加载/骨架屏续期"态，并把迟到复核（`:1021`）作为唯一能置"失效"的入口。

### 3.3 其余侧边栏启动问题

| 级别 | 问题                                                                                                                                                                                                                                                                           | 位置                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| P2   | `popup` 在 `sidePanel.open()` **之前** `await chrome.tabs.query(...)`，偏离本仓自述的"open 前禁止 await"不变量（transient activation 约 5s，单次 IPC 通常够用，风险未证实）                                                                                                    | `entrypoints/popup/App.vue:426` → `:437`        |
| P2   | READY 握手三条 `return` 均未把 port 归入 window 表，该面板收不到广播；**但** `useStorageWatcher.ts:64` / `useSidepanelData.ts:555` 直接监听 `session_wrapped_data_key` 变化并清认证态，构成实际兜底 ⇒ 从子智能体报的 Major 下调为 Minor                                        | `sidePanelManager.ts:106-112`                   |
| P2   | 关闭侧边栏失败被应答成 `{success:true, '已处理 (fallback)'}`，用户感知为"按了没反应"且无反馈                                                                                                                                                                                   | `sidePanelManager.ts:188-196`                   |
| P2   | `if (!tabId)` 用真值判断，`tab.id === 0` 会被当缺失（是否真出现 0 号 tab **未证实**，需真机确认）                                                                                                                                                                              | `messageRouter.ts:382,398`、`popup/App.vue:427` |
| P2   | 资源预热在 `fetch` **之前**就消耗 5 分钟节流窗口，随后抛错则该窗口内不再重试                                                                                                                                                                                                   | `warmSidePanelResources.ts:385-393`             |
| Info | 轻量预热白名单只递归一层静态依赖，认证视图的二级依赖（约 10 文件 / 26KB，含 el-dialog 的 focus-trap 链）未预热 ⇒ 首次打开弹窗冷读                                                                                                                                              | `warmSidePanelResources.ts:183-204`             |
| Info | 生产构建 `esbuild.drop:['console']` 把 logger 全部剥成 no-op（产物 `.output/chrome-mv3/chunks/logger-*.js` 中 `warn(s,...e){}`），所有降级路径现场零输出。**这是已知取舍**——`utils/perfMetrics.ts:4-9` 明说改用 User Timing + `storage.local` 环形缓冲承载归因，但排障时容易踩 | `wxt.config.ts:40`                              |

---

## 4. 专项二：2000 条上限会不会卡

### 4.1 先给分面结论

- **Options 管理页：不卡。** `useVaultListPagination` 提供 50/100/200 档（默认 100，刻意无"全部"），仓库自有 DOM 探针显示 600/1200/2000 条下 `domNodes 6948 / tableRows 100 / tableCells 1000` **恒定**——历史那条"2000 行全表挂载 180s"的路径已不存在。渲染层已与总条数解耦。
- **侧边栏：会卡。** 既无分页也无虚拟滚动，且搜索链路无防抖。
- **首屏慢与交互卡是两笔独立的账**：首屏的红档在数据层（本仓实测：全量解密 410.6ms、读-改-写 263.1ms、`onChanged` 整包投递 211–245ms，**分页一分不减**）；交互卡的红档在侧边栏的纯 JS 检索链 + 行重渲染。不要因为一档红去改另一档。

AGENTS.md 三档 SLA 的现状照抄文档即为：`preRowMs` 1.0–2.4s 未达标、`blockingMs` 0.88–2.0s 未达标、`wallMs` 1.7–3.3s 临界。

### 4.2 [P1] 侧边栏每敲一个字符走一遍全量重算 + 全量重渲染

三个事实叠成一条瓶颈链（均已核验代码）：

1. **侧边栏没有防抖。** `utils/keywordMatch.ts:33` 的 `KEYWORD_DEBOUNCE_MS = 200` 只有两个消费者：`usePasswordManagement.ts:210`（Options 表）与 `TrashDialog.vue:245`（回收站）。侧边栏 `entrypoints/sidepanel/App.vue:329` 直接吃 `searchKeyword`。
2. **`searchKeyword` 被写进行级 `v-memo`。** `components/sidepanel/SidepanelAuthView.vue:606-616`：
   ```
   v-memo="[activeIndex === index, password.favorite, password.tag,
            password.updateTime, autoTriggerLogin, searchKeyword,
            pinyinRenderMemoDependency, canFill(password), isCrossDomain(password)]"
   ```
   ⇒ 关键词一变，**所有已渲染行全部失效重渲染**，每行内含 4 个高亮子组件。
3. **`renderCount` 只增不减**（`:204-215`，注释自陈设计意图是"完整放开后维持上限不再收缩，避免二次分片闪烁"）。⇒ 一旦 2000 行铺开，此后每一次按键的重渲染面积是 2000 行，不是 30 行。

三者合起来 = **"首屏后越打越卡"的机制**。注意 (2)(3) 单独看都是**有意的取舍**，问题是它们组合在无防抖的前提下互相放大。

### 4.3 [P1] 拼音记忆缓存的上限恰好等于条数上限

```ts
// utils/searchMatch/core.ts:180-213
const PINYIN_RANGE_CACHE_MAX = 2000;
...
if (pinyinRangeCache.size >= PINYIN_RANGE_CACHE_MAX) {   // FIFO 淘汰最旧
  const oldest = pinyinRangeCache.keys().next();
  if (!oldest.done) pinyinRangeCache.delete(oldest.value);
}
```

同文件 167-178 行的注释写明了这层缓存的存在理由："过滤与高亮两条路径反复询问同一条目，**真正省掉 DP 的正是这一层复用**"。而缓存键是"待匹配文本"，2000 条 × 多字段的**不同文本数天然超过 2000** ⇒ 上限正好卡在临界点上，复用被系统性打掉。

这条是**结构事实**，不依赖机器，比任何毫秒数都可信：夹具测量得到进入 DP 的字段调用 4333 次、去重后不同文本 2119 个，2119 / 2000 = **1.06 > 1** ⇒ 必然抖动；同一代际第二遍（本该命中缓存）在 500/1000/2000 条上分别是 3.13 / 2.71 / **45.25 ms**，1000→2000 是 18 倍跳变而非线性增长，正是临界点被跨过的形状。

**性价比最高的一处改动**：把上限抬到高于"不同文本数上界"（或改 LRU / 键带关键词），让"过滤 + 高亮两遍"退化成"一遍 DP"。

### 4.4 [P1/P2] 其余规模成本（按贡献排序）

| 级别 | 问题                                                                                                                                                                                                                                      | 位置                                          | 性质                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| P1   | `resolveMatchTier` 对每个条目都重新归一化一次"当前主机"（`normalizeToHostname` = trim + `new URL()` + 通配标记恢复），2000 次/键是纯浪费；`countSameMainDomainCandidates` 对同一条目连调两次；`MAIN_DOMAIN_CACHE_MAX = 2000` 同样卡在临界 | `utils/domain.ts:425-451`、`:485-498`、`:380` | 一处 hoist 可消大半                                          |
| P1   | 空域名（新标签页 / `chrome://`）⇒ `if (!ctx.domain) return true` **放行整库**，把最重的 2000 条全量喂进下游检索与渲染                                                                                                                     | `utils/passwordFilter.ts:68`                  | 文档化的有意取舍，但与 §4.2 叠加后让"最普通场景"撞上最重路径 |
| P2   | `crossDomainIds` 与 `offSiteIds` 各自重算一遍全库 `ReadonlySet`，与主检索链是叠加而非共享                                                                                                                                                 | `sidepanel/App.vue:497,518`                   | 每键两遍全库                                                 |
| P2   | `batchEditTags` 里两处 `passwords.value.find(...)` ⇒ O(k·n)：全选 2000 时实测 832ms（单处）/ 1640ms（两处），对照"一次 Map 索引 + k 次 get"只要 22ms                                                                                      | `usePasswordManagement.ts:937-948`            | 一次性点击冻结，非帧成本                                     |
| P2   | 首帧后 idle 预热拼音模块，使检索从"子串短路"切到"逐条 DP"，四种输入形状**全部**变贵（含纯 ASCII，因为不命中条目仍落到中文/带空格字段的 DP 分支）                                                                                          | `sidepanel/App.vue:952-965`                   | 阶跃而非边际成本，与 §4.2 同向                               |
| Info | 健康度扫描挂在 `passwords` 的 `immediate` watch 上，改一条重扫整库；但 2000 条只要 5.6–7.6ms，**不构成瓶颈**，属口径问题                                                                                                                  | `options/App.vue:798-804`                     | —                                                            |

### 4.5 数字的可信度声明（重要）

本轮所有毫秒数产自并行 6 个评审 agent 同机跑出的 vitest 测量，期间 load average 从 9.4 漂到 106，**同一脚本绝对值摆动 2–6 倍**。因此：

- **采信**：结构性事实（缓存键数 > 上限、每键触达全量的次数、DOM 行数恒定、O(k·n) 的存在）与同一批内成对比较的相对差。
- **不采信**：跨机绝对毫秒。本机上一次性的"30–62ms/键"只能读作"量级在几十毫秒、不是几毫秒"。
- **完全未测**：侧边栏 2000 行的真实 DOM 节点数与挂载/重渲染耗时（jsdom + Element Plus 按需解析器探针不可用）；`chrome.storage.local` IO 与 AES-GCM 真实解密耗时（沿用仓库自测值）；Windows 慢盘与低端机；真实浏览器的 `blockingMs` / INP 分布。

测量脚手架保留在 `.review-tmp/b-list/`（10 个文件，仓库 vitest 未误采，已核验），可复跑或删。

---

## 5. 安全评审

### 5.1 密码学本身：达标，且下列"强主张"经逐条证伪后**不成立**

- **PBKDF2-SHA256 600,000 次 + AES-256-GCM + 逐字段加密 + 每次随机 IV**，参数在三处（数据密钥 / 校验值 / 备份）全部硬编码、不可被用户配置削弱、无静默旧格式降级（`utils/encryption.ts:111,131,173-211`）。
- **不存在固定 IV 或 key+iv 复用**：全仓只有 `encryption.ts:176-184` 一处 `subtle.encrypt`，IV 每次 `crypto.getRandomValues(new Uint8Array(12))` 现场生成；`.aph` / `.aphid` 每次导出另换新盐新 IV。
- **不存在"锁定可被绕过 / 锁与保存竞态把密钥写回"**：`sessionEpoch` 代际守卫覆盖 `getSessionDataKey` 的全部 await 回填点，跨上下文 `resetSessionMemoryState()` 纠镜像。
- **不存在内容脚本读到明文列表**：`isTrustedInternalSender` + `resolveTrustedContentUrl` + `isFrameFillable` 三重门控；页面侧拿到的元数据白名单不含 password/totp；`storage.session` 默认 TRUSTED 且由 `tests/architecture/sessionAccessLevel.test.ts` 静态禁止 `setAccessLevel`。
- **不存在遥测或数据外传**：全仓无 `XMLHttpRequest` / `axios` / `WebSocket` / `sendBeacon`；`fetch` 只有 `updateChecker.ts`（CWS HEAD + GitHub Releases）与 `favicon.ts`（`_favicon/` 本地端点）。
- **解密全面 fail-closed**：非 Base64、长度 ≤12 字节、认证失败一律抛错，绝无"解密失败返回原值"。

`tests/utils/encryption.test.ts` 用 Node 的 `pbkdf2Sync` / `hkdfSync` 做**独立实现交叉校验**，KDF 参数一改就红——这是全仓最强的安全测试。

### 5.2 [P0-2] 邮箱备份默认档是「不加密」

```ts
// components/options/EmailBackupDialog.vue:176
const backupType = ref<BackupType>('unencrypted'); // 默认弱档
```

`utils/emailBackup.ts:28-44` 直接把 `ExcelUtils.exportToCSV(passwords, 'passwords_<时间戳>.csv')` 写进下载目录，`utils/excelExport.ts:67-76` 逐行落 `username, password, ..., totp` 明文，随后 `window.open(mailtoUrl)` 引导用户把它作为附件发出去。门控只有主密码复验，**没有风险二次确认**；而警告 alert 只在选中"加密档"时才出现（`EmailBackupDialog.vue:40-49`）——文案与安全强度反了。

对一个密码管理器而言，默认值应该是强度最高的那一档。修复方向：默认 `'encrypted'`；不加密档复用身份库已有的"复验 + 风险二次确认"双闸，文案明示"文件为明文、将离开本机"。

### 5.3 [P0-3] 复制密码历史项绕过了本仓自己的剪贴板清除封装

`components/options/PasswordFormDialog.vue:480`

```ts
await navigator.clipboard.writeText(plain);   // 不走 copySecretToClipboard ⇒ 不会自动清空
ElMessage.success(t('options.form.historyCopied'));
} finally { historyList.value[index].loading = false; }   // 无 catch：解密失败即未处理拒绝
```

同仓 `PasswordDetailDrawer.vue:383` 与 `IdentityVaultDialog.vue:380-385` 用的都是 `await copySecretToClipboard(plain, notifyClipboardCleared)`。⇒ **明文历史密码长期滞留剪贴板**，与 README / privacy 里"剪贴板自动清除默认已开启"的承诺不一致。属回归缺陷。

### 5.4 [P1] 解锁期内磁盘可独立还原数据密钥，而隐私文档未披露

`utils/sessionManager-storage.ts:330-343, 381-382`：`WRAP_KEY` 与 `WRAPPED_DATA_KEY` **都在 `chrome.storage.local`**（落盘），`getSessionDataKey()` 直接从磁盘读回两半并解包。配合默认 `relockOnBrowserRestart: false` 与最长 168h 有效期，即"关浏览器再开仍自动登录"。

- 前置条件：能读到扩展的 `Local Extension Settings` leveldb（本机恶意进程 / 取证 / 磁盘镜像 / 备份还原），**不需要主密码**即可离线解出全库含 TOTP secret。
- 定性：这是"重启保持登录"的既有实现依赖（项目记忆已确认，移走会废掉 `restartTip` 承诺并造成"会话有效但空列表"），**不判漏洞**；锁定后 `:801-804` 刻意删 `WRAPPED_DATA_KEY` 保 `WRAP_KEY`，实现自洽。
- 真正的问题是披露：`privacy.html:416` 只说"主密码不以明文保存，磁盘上只留 PBKDF2 校验值"，README:54 说"锁定或过期即刻销毁密钥材料"——用户会读成"没锁的时候也不落盘"。建议在 privacy §3/§7 与"自动锁定设置"UI 各加一句对等披露（"保持登录 = 磁盘可解，公共电脑请开启重启锁定"）。

### 5.5 [P1] `getMainDomain` 无 PSL，共享托管后缀被判定为"同一主域名"

`utils/domain.ts:117-145` 取末两段 + 一张内置 ccTLD 表，没有 Public Suffix List。⇒ `evil.github.io` 与 `victim.github.io` 主域名同为 `github.io`。该判定同时是三处的信任边界：`sameMainDomain` 匹配档（默认 `off`，需用户主动开）、`isFrameFillable` 的 iframe 回填门控、`resolveTrustedContentUrl` 的自动保存归属。

攻击形状：攻击者在免费托管（github.io / vercel.app / workers.dev / appspot）开一个 HTTPS 登录页，用户点内联钥匙图标 ⇒ `GET_MATCHING_ACCOUNTS` 以另一租户条目按 tier 3 泄出用户名/标签/备注，点选即 `FILL_BY_ID` 下发明文；同一判定也可用于凭证归属投毒（自动保存写进别人租户的域名）。仓库与文档中未见这条取舍的任何记录。

修复方向：引入 `tldts` 或维护一张多租户后缀拒绝表，对不可证的二级后缀退回"完整 hostname 相等"。**这条会改变现有跨子域档位行为，属需要拍板的功能性调整，不是纯修 bug。**

### 5.6 [P1] 任意页面脚本可伪造"扩展品牌"通知

`entrypoints/content.ts:113-122` 的 `window.message` 监听**刻意不做同主域名校验**（注释写明理由：跨域 iframe 也要能发保存通知）：

```ts
if (event.data?.type === PostMessageType.SHOW_NOTIFICATION) {
  if (!rawMessage || !canShowDelegatedNotification()) return;
  showNativeNotification(rawMessage.slice(0, NOTICE_MAX_LENGTH), type);
```

枚举值是 `'APH_SHOW_NOTIFICATION'`（`utils/domain.ts:94`），扩展包是公开可得的，页面 JS 一次 `window.postMessage({type:'APH_SHOW_NOTIFICATION', data:{message:'会话异常，请点击下方按钮解锁', type:'warning'}})` 就能在页面右上角（`z-index:2147483647`、扩展配色、`NativeNotification.ts:69`）渲染 200 字符任意文案、以扩展口吻说话。现只有 5 次/10 秒限流和长度收口，不足以区分真伪。

修复方向：iframe 委托改走已存在且经 `isFrameFillable` / 顶层门控的 `SHOW_PAGE_NOTICE` 由 background 转发；或校验 `event.origin` 与顶层同主域，并在提示条上标注来源域名。

### 5.7 P1/P2 其余安全项

| 级别 | 问题                                                                                                                                                                                                                                                                                                                      | 位置                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| P1   | CSV 导出未防电子表格**公式注入**（只转义引号，`=` `+` `-` `@` TAB CR 原样写入）。攻击形状：自动保存抓来的表单用户名 / 导入的第三方 CSV / URL 字段 → 用户导出 → 在 Excel/WPS 打开并启用外部内容 → 打开即求值，形成一条突破"零外传"承诺的第三方执行路径                                                                     | `utils/excelExport.ts:38-40`                                                             |
| P2   | 到期提醒表把**用户名明文**冗余写入 `storage.local`（注释已自陈理由，码点截断后落盘），与 `privacy.html:410`"敏感数据（用户名、密码、URL、备注、TOTP secret）逐字段加密"的字面表述不一致；额外泄露"哪个账号将在何时到期"                                                                                                   | `utils/storage/reminderManager.ts:19-38,76`                                              |
| P2   | 对话框关闭后**保留解密出的 PII 行**（注释明写"重置视图态但保留 rows"），是全仓唯一"无上限"的一类驻留                                                                                                                                                                                                                      | `components/options/IdentityVaultDialog.vue:400-403`                                     |
| P2   | 锁定页"调试信息"弹窗用整段**硬编码中文**输出 `盐值预览` / `哈希预览`（40bit 校验值前缀，不降低 600k 爆破成本，但属"敏感派生物片段出现在可截屏 UI"的口径违规，且英文用户看到中文）                                                                                                                                         | `composables/useAuthFlow.ts:289-303`                                                     |
| P2   | 跨上下文用**中文文案做匹配**：`rawMsg.includes('未检测到登录表单')`、`msg.includes('验证失败')`——对端改英文即静默失效，应改判 `code`                                                                                                                                                                                      | `composables/useSidepanelFill.ts:368`、`ChangeMasterPasswordDialog.vue:246`              |
| P2   | 导入入口缺输入字节上限：`:limit="1"` 只是文件个数，`file.raw.arrayBuffer()` 前无 size 判定，条目数上限在整文件解码 + 逐行 parse 之后才生效；同仓 `SiteRulesDialog.vue:468` 已有 `SITE_RULES_IMPORT_MAX_INPUT_BYTES` 可沿用                                                                                                | `components/options/ImportDialog.vue:68-69,305`、`utils/backup/parseBackupEntries.ts:85` |
| P2   | 路由侧 sender 校验不一致：`SHOW/HIDE/TOGGLE_SIDEPANEL`、`OPEN_OPTIONS_*`、`SIDEPANEL_PRELOAD` 无 `isTrustedInternalSender`。当前不可被页面利用（网页 JS 拿不到 `chrome.runtime`），但安全性依赖"只有自家 content script 能发"这条未写进代码的事实；`editId` 在路由处也未做类型/长度收口                                   | `messageRouter.ts:360-477`                                                               |
| P2   | 密码显隐按钮**没走 Shadow DOM**：`document.head.appendChild(style)` + 宿主页面 light DOM 兄弟节点 + `input.dataset.aphPassword`，同时违反 AGENTS.md"不污染宿主页面全局样式"与"Closed Shadow DOM 完全隔离"两条约定（五处注入 UI 里唯一例外）；宿主页面可用 `!important` 覆写、隐藏或挪动这枚按钮，干扰用户判断密码是否可见 | `entrypoints/content/PasswordVisibilityToggle.ts:194,229,248`                            |
| P2   | 扩展安装可被网页一行 `querySelector` 指纹识别（`aph-inline-fill-root` / `aph-totp-handoff-root` / `[data-aph]` / `input[data-aph-password]` / `.native-form-detector-notification`），与 §5.6 组合放大钓鱼成功率                                                                                                          | 同上 + `InlineFillDropdown.ts`                                                           |
| P2   | 死路由与漂移：`CHECK_UPDATE` 有实现但**全仓无发送方**（任何人触发即一次 GitHub/CWS 外联探测）；`FILL_MOBILE_CODE` 已实现但无发送方；`SESSION_EXPIRED / CLOSE_SIDEPANEL / SIDEPANEL_READY` 声明在 `RuntimeMessage` 联合里却只走 port/广播，经 `sendMessage` 送达会落 `default`                                             | `messageRouter.ts:648`、`FormDetector.ts:1185`、`utils/types.ts`                         |
| Info | `GET_MATCHING_ACCOUNTS` 在 `sender.tab.url` 解析失败时回退用自报 `data.domain`（当前无调用方传值，属潜在口子）；桌面通知正文含 `username - url`（锁屏/手机通知栏可见）；五处注入 UI 同为 `z-index:2147483647`，互斥靠各自显隐时序                                                                                         | `messageRouter.ts:678-688`、`autoSaveHandler.ts:88-95`                                   |

### 5.8 权限对账（`wxt.config.ts:93-108` 共 12 项 + `<all_urls>`）

`storage` / `sidePanel` / `alarms` / `contextMenus` / `notifications` / `idle` / `clipboardWrite` / `clipboardRead` / `webNavigation` / `scripting` / `favicon` 均能对上具体用途；`favicon` 走 `_favicon/` 本地端点，零外网；CSP 显式收紧为 `script-src 'self'; object-src 'self'`；`web_accessible_resources` 产物中为空（营销页 `index.html` / `en.html` / `compare*.html` / `pricing*.html` / `product-site/` 均不在 `public/` 下，实测 `.output/chrome-mv3/` 不含它们，与扩展运行时无关）。

可收窄项：**`activeTab` 在已有 `<all_urls>` 时冗余**（移除需回归侧边栏填充）；`scripting` 可降为按需；`clipboardRead` 仅为"清空前校验内容仍是自己写的那条"，若改写入即清空可去掉；`options_ui` 未设 `open_in_tab`（产物 `false`），从 chrome://extensions 入口时主密码页会以内嵌弹窗呈现（应用内路径都走 `tabs.create`，不受影响）；`storage.session` 写敏感快照处未显式声明 `accessLevel`，依赖默认 `TRUSTED_CONTEXTS`——项目规则要求"确认"，建议显式写死并由测试守卫。

---

## 6. 组件质量、样式与可访问性

### 6.1 先说没问题的部分（这点很重要）

监听器 / Port / 定时器层面**没有系统性泄漏**：`useChromeListeners.ts` 是集中注册表 + `onUnmounted` 卸载且每个 `removeListener` 包 try/catch；`useTotp.ts` 用模块级 refcount 维持单实例 1s 时钟；`useSessionCountdown.ts` 幂等 start/stop + `onScopeDispose` + `disposed` 位；`useSharedHoverTooltip.ts` 有 `getCurrentScope()` 守卫；侧边栏 Port 在 `onDisconnect` 与 `onUnmounted` 双向清理。零 prop 直接赋值、零 `v-model="props.*"`、零 `reactive` 解构丢响应性、零 `v-if` + `v-for` 同元素。

性能上也有真实的功夫：`PasswordTable.vue:368-390` 把每页约 1100 次 `t()` 提到 `rowLabels` computed；`:287-305,449-535` 用一个 `virtual-triggering` tooltip 替掉约 3000 个行内实例；`SidepanelAuthView.vue:134-148` 让 `canFill/isCrossDomain` 返回布尔以保住 `v-memo` 命中。

### 6.2 [P1] 对话框层的异步竞态是这一层的主要风险

| 级别 | 问题                                                                                                                                                                                                                                                                                                                                    | 位置       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| P1   | `PasswordFormDialog.vue:507-521` 的 `watch(() => props.modelValue, async visible => { … await getPasswordHistoryConfig(); if (…) loadHistory(props.editingId) })` 无代际守卫 ⇒ 快速开关时旧 await 回来仍会覆盖 `historyConfig` 并对**新的 editingId** 发请求；`:507` 这条还缺 try/catch（同构的 `PasswordDetailDrawer.vue:409-424` 有） | 已核验结构 |
| P1   | `PasswordFormDialog.vue:332-341` 用**非 deep** watcher 镜像父端表单，而父端 `usePasswordManagement.ts:309` 是 `Object.assign(passwordForm.value, ownedFields)` 原地改 ⇒ 深字段变化不被察觉，弹窗复开残留上一账号字段；同仓 `PasswordVerifyView.vue` 用的是 `{deep:true}`，同一契约两处实现不一致                                        | —          |
| P1   | `SiteRulesDialog.vue:506-510`：`loadRules()` 期间对话框被关闭，完成后仍把已关闭的对话框推进表单态                                                                                                                                                                                                                                       | —          |
| P1   | 不稳定 key：`PasswordFormDialog.vue:197-198`、`PasswordDetailDrawer.vue:185`（历史列表 `:key="index"`）、`PasswordHealthDialog.vue:134-135`（`:key="gi"`）——配合上面 `historyList.value[index].loading` 的写法，行重排后 loading/成功态会贴到另一条记录上                                                                               | —          |
| P2   | `BackupImportDialog.vue:356` `ElMessage.error(error.message)` 直出原始异常文本：既未 i18n，也可能把内部信息暴露给用户                                                                                                                                                                                                                   | —          |
| P2   | `PasswordGeneratorPopover.vue` 的 `regenerate()` 被 4 个 watcher（`:294/:305/:316/:323`）各自触发，模式切换会重复生成一次。**注意**：子智能体把它报成 Critical 的"并发异步生成乱序 ⇒ 显示的口令与实际参数不符、确认时写进表单"，经复核**不成立**——见 §8                                                                                 | —          |

### 6.3 [P1] 泄漏类（按一次泄漏的成本排序）

| 级别 | 问题                                                                                                                                                                                                                                                                             | 位置                                                     | 成本                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------- |
| P1   | 关闭对话框保留解密后 PII 行                                                                                                                                                                                                                                                      | `IdentityVaultDialog.vue:400-403`                        | 无上限驻留（同 §5.7） |
| P1   | `nextTick` + `requestAnimationFrame` 句柄未保存、`onUnmounted` 未取消 ⇒ 反复开关每轮留一个绑到已销毁 DOM 的回调；`loadReminderStates()` 是 watcher 里的浮动 promise，无 await 无 catch；`:591-592` 用全局 `document.querySelector('.health-panel-'+key)`，同页多个同名节点会选错 | `PasswordHealthDialog.vue:655-661,591`                   | 每次开关累积          |
| P2   | 150ms 裸 `setTimeout` + 全局选择器 `.import-dialog .dialog-body-scroll`，`behavior:'smooth'` 无 reduced-motion 判断                                                                                                                                                              | `ImportDialog.vue:324`、`BackupImportDialog.vue:314,349` | 每次导入 1 个 timer   |
| Info | 侧边栏 `App.vue:945,965,1008` 的 3 个 timer 不在 `onUnmounted` 清理——但侧边栏是独立文档、关闭即整体销毁，属有界成本，**不是累积泄漏**（子智能体初判 Major 已据此下调）                                                                                                           | —                                                        | 每次打开 ≤3           |

### 6.4 样式与主题

| 级别 | 问题                                                                                                                                                                                                                                                                                                                                                                                    | 位置                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| P1   | **Shadow DOM 主题令牌死链**：`utils/theme.ts:63-74` 的 `THEME_SHADOW_TOKENS` 每主题只镜像 10 个 brand 令牌，而内联下拉的 shadow CSS 用了 `var(--aph-text-muted, #94a3b8)` 与 `var(--aph-border-light, rgba(148,163,184,.35))` ——这两个变量在 closed shadow 内**永远不会被写入**，恒走 fallback ⇒ 换肤后注入下拉的正文与边框颜色不跟随。已核验：全仓变量使用集 vs 镜像集，缺的正是这两个 | `InlineFillDropdown.ts:301,303` |
| P1   | `SidepanelAuthView.vue:984-1046` 整段**未 scoped** 且含两处 `!important`，硬编码 `#374151/#9ca3af/#1f2937/#6b7280/#f5f7fa`，注入全局作用域可影响同页其他组件                                                                                                                                                                                                                            | —                               |
| P2   | 硬编码色未走 `--aph-*`（旁边就有正确用法）：`PasswordFormDialog.vue:554,562,589,595,601`（`:571` 已用 `var(--aph-text-muted)`）、`PasswordTable.vue:677,704-706`、`PasswordGeneratorPopover.vue:332,356,366`、`PasswordHealthDialog.vue:674,701,709,729`、`sidepanel/App.vue:1050-1059,1140-1200`                                                                                       | —                               |
| Info | 疑似死 CSS 只列"疑似"：`HelpDialog.vue` 约 `:639` 被注释掉的 `scrollbar-width/scrollbar-color`。按本仓教训（消费者常在别的文件、keyframes 反向漏杀），删除前必须跨文件交叉验证                                                                                                                                                                                                          | —                               |

### 6.5 [P1] 可访问性

| 级别 | 问题                                                                                                                                                                                                                                                                                                                                                                      | 位置                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| P1   | 命令面板声明了 `role="dialog" aria-modal="true"` 却**没有焦点陷阱**（只在打开时 `inputRef.focus()`），Esc/Tab 行为不封闭；↑↓ 移动无 `aria-activedescendant`，激活项永不播报；`role="listbox"` 的直接子节点里混有分组标题 `div`（非法子元素）                                                                                                                              | `CommandPalette.vue:35-40,118-124`       |
| P1   | 同一工具栏 aria 标签不一致：scope 按钮有 `:aria-label` + `:aria-pressed`，紧邻的"只看收藏"与"排序"两者皆无 ⇒ 屏幕阅读器只读出"按钮"，且收藏状态**仅由 `type='warning'` 的颜色表达**                                                                                                                                                                                       | `SidepanelAuthView.vue`（收藏/排序按钮） |
| P2   | 仅颜色表达状态：`PasswordTable.vue:704-706` 的 `background:#e04040` 徽标                                                                                                                                                                                                                                                                                                  | —                                        |
| P2   | 缺 `prefers-reduced-motion` 的动效：`PasswordVerifyView.vue:298`（shake）、`PasswordTable.vue:592-627`（行 fade-in / `transition:all` / hover `translateY(-2px)`）、`ImportDialog`/`BackupImportDialog` 的 `behavior:'smooth'`、`sidepanel/App.vue:634-641`。同仓已有正确样板可照抄：`CommandPalette.vue:222-224`、`SidepanelAuthView.vue:185-199`（还用了 `CSS.escape`） | —                                        |

### 6.6 i18n：完整性零缺陷，问题全在"绕过"

实际比对结果（非估算）：

| 比对对象                                   | zh 键数 | en 键数 | 差异 | 重复 |
| ------------------------------------------ | ------- | ------- | ---- | ---- |
| `utils/i18n/locales/**`（18 命名空间）     | 913     | 913     | 0    | 0    |
| `utils/i18n-lite.ts`                       | 124     | 124     | 0    | 0    |
| `public/_locales/{zh_CN,en}/messages.json` | 6       | 6       | 0    | 0    |

命名空间逐对相等（auth 36 / backup 6 / common 33 / excel 11 / fill 24 / form 48 / health 44 / help 100 / identity 103 / message 15 / options 360 / popup 29 / session 15 / sidepanel 66 / strength 8 / totp 3 / validity 9 / verify 3）；`HelpDialog.vue` 的 8 组 `helpItems(prefix, N)` 计数全部吻合（gs 11 / gb 13 / gd 11 / gc 6 / fs 9 / fb 9 / fd 7 / fc 13）；`wxt.config.ts` 的 name/description 与 4 条 command 全走 `__MSG_*__`，`default_locale: 'zh_CN'` 正确。这套对等性由 `i18nBundles.test.ts` + `i18nLiteParity.test.ts` 固化成回归，是零漂移的根本原因。

绕过项见 §5.7 的 P2（debugPassword 硬编码中文、跨上下文中文文案匹配）与下面的 P2：`HelpDialog.vue` 有 8 处 `v-html` 被 `<!-- eslint-disable vue/no-v-html -->` 包裹，与 AGENTS.md"禁止 eslint-disable 规避规则"冲突。内容当前来自打包内 i18n、**无实际 XSS**，但规则偏离应显式记录或改走富文本渲染。

---

## 7. 测试有效性与发布口径

### 7.1 数量很足，但存在结构性缺口

`tests/` 142 个 `*.test.ts` / 25,659 行 / 1,516 个 `it(`。被测最重：`domain`(60) / `autoSaveManager`(56) / `identityBackup`(41) / `senderValidation`(37)。

**已核验的零测试触及源码（按风险排序）**：

| 文件                                                                                                                                                                                          | 风险                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `utils/totp.ts`（234 行，RFC 6238 三算法 + 截位）                                                                                                                                             | **P1**：`tests/` 与 `e2e/` 里 `utils/totp` / `generateTOTP` / `parseOtpauth` 命中数为 **0**（已实跑 grep 核验），所有引用它的测试都把 `getInlineTotpCode` 整体 mock。而 `docs/CWS_FILL_CONTENT.md:161` 逐条承诺了 SHA1/256/512、6/7/8 位、周期回落、HOTP 不支持——**商店文案承诺的实现没有任何测试** |
| `utils/passwordGenerator.ts`                                                                                                                                                                  | P1：只有 `passphraseGenerator` 有测试，随机密码生成器无专属单测（长度钳制、每类字符至少一个、排除易混淆后字符集非空、全禁用抛错）                                                                                                                                                                   |
| `utils/emailBackup.ts`、`utils/updateChecker.ts`                                                                                                                                              | P1：仅有的两条出网/mailto 路径无测试                                                                                                                                                                                                                                                                |
| `utils/masterPasswordVerify.ts` + `Controller.ts`                                                                                                                                             | P1：登录门禁入口零测试                                                                                                                                                                                                                                                                              |
| `composables/` 中 9 个（`useTotp`/`useSidepanelFill`/`usePopupInit`/`useSessionLock`/`useSessionTimer`/`useVersionUpdate`/`usePasswordHistory`/`useIdleLockSettings`/`useSidepanelSettings`） | P1：零 import                                                                                                                                                                                                                                                                                       |
| 全部 5 个入口 `App.vue` + `components/` 50 个 Vue 组件                                                                                                                                        | 结构性缺口：组件层只有 1 个测试文件（`elTableReserveSelection.probe.test.ts`）                                                                                                                                                                                                                      |

**弱断言样本**（`文件:行号`）：`tests/utils/encryption.test.ts:145,153,208` 的 `rejects.toBeTruthy()`（只证"抛了东西"，不证是 GCM 认证失败；同文件 131/139/271 已有 `getDecryptErrorCode` 收口，这三处没收口）；`tests/utils/identityCrud.test.ts:258` 的 `JSON.parse(dec(...)).toBeTruthy()`（解出任何东西都算过）；`tests/utils/sessionManager.test.ts:20-27` 把整个 `StorageUtils` mock 掉、`clearSession` 是桩 ⇒ README:54"过期即销毁密钥材料"这条承诺在本文件**不可证**，而 `:107,138` 的事件顺序断言是典型实现快照。

**13 个 `tests/architecture/` 守卫共 30+ 处 `expect(matched).toBeTruthy()`** 全部是对 Vue/TS 源码做正则截取（`optionsRenderIdentity.test.ts`、`sidepanelRowMemoFields.test.ts:49,51,68`、`vaultPageSizeWiring.test.ts:60,75,83`、`trashSearchWiring.test.ts:56,89` 等）。它们的价值是"防静默失效"，等价重构必红、运行时真坏必绿，**不能计入行为覆盖**。

**skip 面很干净（正面）**：全仓 0 处 `it.skip` / `it.todo` / 注释掉的用例块；只有 `e2e/session-management.spec.ts:130` 一条 `test.skip`（`chrome.idle` 无时钟控制，明确指向 `tests/background/idleLock.test.ts`）和 `tests/architecture/sidepanelClosure.test.ts:119` 的 `describe.skipIf(!hasOutput)`。本仓那条已知教训（`describe.skipIf` 仍执行收集期回调）在工作树里**已被修好**：`readEntryHtml/computeClosure` 已从 describe 回调体挪进 `analyzeEntry()` 只在 `it` 内调用，且判据自检不依赖产物。

### 7.2 [P1] e2e 覆盖面好于项目记忆，但不是门禁、也没测秒开

实际是 **10 个 spec / 62 条 `test(`**（项目记忆里"只有站点规则 6 例"已过时），断言形态强：264 处 `await expect`、填充结果以 `toHaveValue` 落在真实页面输入框、设置类以 `readStoredConfig` 对 `storage.local` 事实收尾。**加密往返、rekey、备份回环有端到端保护。**

四个缺口：① `.github/workflows/e2e.yml:68` 仍是 `continue-on-error: true` 观察期 ⇒ **e2e 不是合并门禁**（已核验）；② 侧边栏以**标签页形态**而非停靠面板被测（spec 末尾自陈 3 处差异），`sidePanel.close` 与 >30 条大列表首屏未覆盖；③ **侧边栏秒开 SLA 在全部 e2e 里零计时断言**——唯一阈值是 `operation-tooltip.spec.ts:174` 的 tooltip<1500ms，`benchmarks/sidepanel-p0.bench.ts` 不进 CI 且只量 JS 取数层、不含 mount/渲染链；④ `e2e/README.md` 现状表仍写"8 个 spec 共 44 条"，漂移 18 条。

### 7.3 [P2] 高危修复的回归保护对账（55 个 fix/perf 提交逐个 `git show --name-only`）

有保护：c917d16 密钥移出页面存储、b1332f2 锁定后会话残留 + 回收站 at-rest、05b04ff rekey 保留旧钥不可解历史、d00c108 会话迁移代际守卫、aad474c 通配标记活过 URL 解析、7c3da6b 编辑超容量、53021d3 导入超限、578ae8c 存量缺陷收口等，各配 2–8 个测试文件。

**无保护**：f44880a `chrome.idle` API 存在性（只有编排层测试，e2e 那条被 skip）、206a8e0 / b240bd1 FormDetector 失焦与焦点检测（无对应用例）、f9d831b 内联面板事件冒泡/焦点泄漏（现有用例未断言冒泡）、7f5021d 加密模块懒加载与超时。**安全默认值无锚定**：`backupType` 默认 `'unencrypted'`、剪贴板清除开、重启锁定关——没有任何断言，默认值回退不会被 CI 拦下（这直接导致 §5.2 那条能长期存在）。

### 7.4 文档与发布口径：绝大多数承诺可核对且成立

| 承诺                                                                                                                 | 实现                                                                                                                                                            | 判定                                                     |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| PBKDF2-SHA256 600,000 + AES-256-GCM + 逐字段随机 IV + 主密码只存派生校验值（README:149 / privacy:411-416 / CWS:140） | `encryption.ts:111,131,173-211`，并被 `encryption.test.ts:64-101` 用 Node 独立实现交叉钉死                                                                      | **成立**                                                 |
| "校验值推不出解密密钥""常量时间比对"（CWS:141）                                                                      | `'aph-verify\|' + salt` 域分离 + `timingSafeEqual`（`masterPassword.ts:92`）                                                                                    | **成立**                                                 |
| "不读 cookies/history/downloads、无遥测、数据不上传"（README:214 / privacy）                                         | 12 项权限无上述三项；全仓 `fetch` 只有匿名版本检查与本地 `_favicon`；`emailBackup.ts` 全文件是 `mailto:` 无 fetch。文档已把"零联网"改成"不上传云端"，口径可核对 | **成立**                                                 |
| "rekey 原子、不留半加密数据"（CWS:144）                                                                              | 单次 `storage.local.set`，**读**失败即中止（有测试）；**写**失败只靠 `clearSession` 回滚，无测试                                                                | 机制成立，**写失败路径未证**                             |
| "CSV/JSON 导出文件为明文"（privacy:528-529）                                                                         | 与实现一致                                                                                                                                                      | **成立**（披露充分）                                     |
| "邮件备份…均为本地操作"（privacy:442）                                                                               | 扩展确实不发信，但明文附件由用户手工寄出                                                                                                                        | 技术上成立，**实际风险未披露**（见 §5.2）                |
| "敏感数据（用户名…）逐字段加密"（privacy:410）                                                                       | 提醒表存用户名明文                                                                                                                                              | **不完全一致**（§5.7 P2）                                |
| "磁盘始终密文、锁定或过期即刻销毁密钥材料"（README:54 / ARCHITECTURE:80）                                            | 条目为密文、锁定清理自洽；但解锁期磁盘含可解的 wrap 对                                                                                                          | 机制一致，**面向用户的披露不足**（§5.4）                 |
| TOTP"密钥始终留在扩展后台上下文"（CWS:147）                                                                          | 接力路径成立；侧边栏列表是在 SidePanel 上下文本地算码（`useTotp.ts` / `PasswordListItem.vue:238`）                                                              | 表述偏窄，仍在扩展可信上下文内，建议改"扩展自己的上下文" |
| manifest 名称/摘要/4 条命令 ↔ `public/_locales` ↔ CWS 文案                                                           | 中英摘要与 `_locales` 逐字一致，zh 131 / en 130 ≤ 132，4 命令一一对应，并由 `manifestLocaleBudget.test.ts` 钉预算与引用完整性                                   | **一致**                                                 |

**发布口径（已核验并下调子智能体的初判）**：`package.json` 是 3.9.0、`CHANGELOG.md` 最新条目 3.9.0，而 `origin/main` 是 3.12.0 且 v3.10/3.11/3.12 已发布。逐条 diff 后确认：本分支与 merge-base 到 main 之间**源码零差异**（`utils/entrypoints/components/composables` 命中 0 个文件），main 只多了 `.release-please-manifest.json`、`CHANGELOG.md`（65 行）与 `package.json` 版本位。⇒ 这是 release-please 在 main 上 bump 而本地分支未同步的**发布卫生问题（Minor）**，不是"代码落后三个版本"。影响仍然是实的：在此分支构建产物的 manifest 版本号低于线上，合入 main 前需确认 release-please 能正常接续，CHANGELOG 缺 3.10–3.12 三段。`llms.txt:16` 写 v3.12.0 与本分支 package.json 自相矛盾。

### 7.5 [P0-4] 隐私遗留（已知、用户此前有决策，仍需处置确认）

`git ls-files` 确认这些**仍在仓库**且随 Pages（根目录发布）可被直接下载：`assets/screenshots/01..12.png`（4.5MB，其中 `01-master-password.png`、`06-sidepanel-fill.png` 等含真实 GitHub 用户名、`9249023xx@qq.com`、活码与明文密码 `123456qwerty`，口径见 `docs/exposure-status.md:288-290`）、以及 `docs/demo-login.mp4` / `docs/demo-login.gif`（880KB）。

现状核对：README / README.en / index.html / en.html 的**可见引用已收口**（改取 `assets/cws-store/screen-*.png` 与 `docs/demo-*.webp`，全部占位数据，`docs/CWS_FILL_CONTENT.md:323` 有记录；`index.html:5906` 仅剩注释）。残留风险是**文件本身仍可达**，以及 `docs/CWS_FILL_CONTENT.md:359` 提到"线上商店列表当前仍挂这批旧图"。

本仓此前已决策"只重截商店/README 图，仓库旧图与历史不动"，所以这条不是新发现，而是**该决策的暴露面仍然存续**。`.github/workflows/e2e.yml:35,47` 仍把 `assets/screenshots/**` 列为触发路径。

### 7.6 仓库卫生

`dist/ .output/ playwright-report/ test-results/ .wxt/` 均已被 `.gitignore` 覆盖，无泄漏产物。根目录并存 `index/en/compare/pricing/privacy.html` + `llms.txt` + `sitemap.xml` + `wrangler.jsonc`（Pages/CF 双部署资产，有意）。

**并发会话未提交改动（本次未触碰）**：`eslint.config.js`（新增 `product-site/**/*.js` 浏览器全局块，范围隔离，不影响扩展源码解析）、`tests/architecture/sidepanelClosure.test.ts`（已 stage，即 §7.1 那条 skipIf 修复）、`product-site/`（5,340 行新增未提交，含 2,533 行 CSS + 2,028 行 HTML，其中 15 张 webp 截图**需按 §7.5 同一隐私口径复核是否为占位数据**）。风险：`product-site/` 与 landing/README 改动混在同一工作树，任何 `git add -A` 会把三者捆进同一提交。

本次评审自己产生的文件：`.review-tmp/`（门禁日志 + `b-list/` 10 个测量脚本）。已核验仓库 `pnpm test:run` **未误采**这些脚本（tests 日志里 `review-tmp` 命中 0 次）；但该目录未被 `.gitignore` 覆盖，清理命令见 §10。

---

## 8. 复核后推翻或下调的结论

六路子智能体的事实大多站得住，但四条"强主张"经我复核后不成立，列出来避免按错误结论去改代码：

1. **"密码生成器 async 竞态会显示与参数不符的口令，确认时把错口令写进表单"（原报 Critical）⇒ 降到 P2。** 核验 `utils/passphraseGenerator.ts:163-190`：函数只有**一个前置 `await loadWordList()`**，其后选词、大小写、拼接、追加数字全是同步代码；`loadWordList`（`:88-106`）首次之后命中 `_wordList` 模块缓存。⇒ 同一会话内的并发调用微任务跳数一致、按调用顺序完成，后发覆盖先发是正确行为。真实缺陷只有"4 个 watcher 让模式切换重复生成一次"（浪费熵源与 CPU，不错值）。
2. **"feature-opt 落后线上三个版本 = Critical"⇒ 降到 P2 发布卫生。** 见 §7.4：源码零差异，只有版本位与 CHANGELOG。
3. **"READY 握手 port 注册缺口 ⇒ 锁定后该面板仍显示已解锁列表（安全可见性）"⇒ 从 Major 降到 P2。** 该面板确实收不到广播，但 `useStorageWatcher.ts:64` 与 `useSidepanelData.ts:555` 直接监听 `session_wrapped_data_key` 的 `storage.onChanged` 并清认证态，构成独立兜底路径。仍是真缺陷（广播链路不完整），但不是"锁不掉的明文列表"。
4. **"预热清单与构建产物可能漏文件导致白屏"⇒ 风险不成立。** 实测 61/74 文件全部存在、0 缺失（这也正是子智能体自己给出的反证，我采纳）。

另有两条被明确标注为"未证实、需真机测量"而没有写成缺陷：`tab.id === 0` 的真值判断（D4）、`await tabPromise` 在慢盘下的串行等待点（R1）。

---

## 9. 建议处理次序与处置回写（主文为评审当时的方案，交付时未动代码）

**第一批（正确性 + 明文出口，改动面都很小）**

1. §5.3 历史复制改走 `copySecretToClipboard`，并补 `catch`。
2. §5.2 邮箱备份默认档改 `'encrypted'`，不加密档加风险二次确认 + 文案明示"明文、将离开本机"（属默认值变更，需你拍板）。
3. §3.2 竞速超时与 `_sessionKnownExpired` 解耦：纯超时不再断言"会话失效"，只保留骨架屏续期，把置位权交给明确返回失效或迟到复核。
4. §7.3 给三条安全默认值加断言，防止默认值再被无声回退。

**第二批（2000 条交互卡顿，热路径单点，无重构）**

5. §4.3 `PINYIN_RANGE_CACHE_MAX` 抬到"不同文本数上界"之上，或改 LRU / 键带关键词。
6. §4.2 侧边栏搜索接入既有 `KEYWORD_DEBOUNCE_MS`（同仓已有常量与两个消费者，不新增机制）。
7. §4.2 行 `v-memo` 里的 `searchKeyword` 换成"命中区间数组/命中标志"这类稳定派生值；并给 `renderCount` 设上限或加窗口化（这条会改变已文档化的取舍，需你拍板）。
8. §4.4 `resolveMatchTier` 外提一次 `normalizeToHostname(currentHost)`；`offSiteIds`/`crossDomainIds` 与主链合并为一遍。
9. §4.4 `batchEditTags` 改一次性 Map 索引（832/1640ms ⇒ 约 22ms）。

**第三批（信任边界，涉及行为需拍板）**

10. §5.5 `getMainDomain` 引入 PSL 或多租户后缀拒绝表。
11. §5.6 iframe 通知委托改走 `SHOW_PAGE_NOTICE` 经 background 转发，或校验 origin。
12. §5.4 privacy / 自动锁定 UI 增加"保持登录 = 磁盘可解"对等披露。
13. §5.7 CSV 公式注入防护、导入字节上限、显隐按钮入 Shadow DOM、路由 sender 校验补齐。

**第四批（测试与门禁）**

14. §7.1 `utils/totp.ts`（RFC 6238 官方向量 + 三算法 + 位数 + Base32 非法字符）、`utils/passwordGenerator.ts`、`utils/emailBackup.ts`、`utils/masterPasswordVerify.ts` 补单测。
15. §7.2 侧边栏秒开加一条可进 CI 的计时断言（哪怕先只用 `perfMetrics` 环形缓冲的阈值告警），并评估 e2e 从 `continue-on-error` 转正。
16. §7.4 同步 `package.json` / `CHANGELOG` 与 main 的 release-please 链路；§7.5 复核 `product-site/` 的 15 张新截图。

### 9.1 上面 16 条的实际处置（2026-09-27）

区间 `ca33c83..43f867f`，17 个提交、104 个文件、+6405 / −588。逐条对账，**"未改"和"暂缓"的每一条都保持评审当时的原状**，没有被悄悄放宽或删条目。

| #   | 对应问题                                    | 处置                                                                                                                                          | 提交                          |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1   | §5.3 历史复制绕过剪贴板清除通道             | 已改                                                                                                                                          | `d499257`                     |
| 2   | §5.2 邮箱备份默认档                         | 已改，默认值变更为 `'encrypted'`，明文档加风险二次确认（授权范围内拍板）                                                                      | `56319dc`                     |
| 3   | §3.2 竞速超时假报"会话已失效"               | 已改，纯超时不再置 `_sessionKnownExpired`，置位权交给明确失效与迟到复核                                                                       | `212f21c`                     |
| 4   | §7.3 默认值无断言                           | 已改，钉为五条（剪贴板清除 / 重启锁定 / 邮箱备份双闸 / 裸写点白名单 / PBKDF2 轮数）                                                           | `e06b451`                     |
| 5   | §4.3 拼音记忆缓存上限                       | 已改，上限取 `MAX_PASSWORD_ENTRIES × 4`，另加当前主机归一记忆                                                                                 | `45948e9`                     |
| 6   | §4.2 侧边栏搜索无防抖                       | 已改，三处列表共用 `useKeywordDebounce`，键盘导航先 `flush`                                                                                   | `43827fb`                     |
| 7   | §4.2 `v-memo` 关键词 / `renderCount` 窗口化 | **未改**，见 §9.3                                                                                                                             | —                             |
| 8   | §4.4 域名归一重复构造                       | 已改，`resolveMatchTier` / `isExactHostMatch` 各加一格同输入复用                                                                              | `45948e9`                     |
| 9   | §4.4 `batchEditTags` 逐条回查               | 已改，实测 2856.57 ms → 5.95 ms                                                                                                               | `43827fb`                     |
| 10  | §5.5 `getMainDomain` 无 PSL                 | 已改，`registrableScope` + 精选共享后缀拒绝表；未收录后缀逐字退回原口径                                                                       | `643f9c3`                     |
| 11  | §5.6 任意页面伪造扩展通知                   | 已改，改发 `DELEGATE_PAGE_NOTICE` 由后台校验 sender 后回投                                                                                    | `643f9c3`                     |
| 12  | §5.4 "保持登录 = 磁盘可解"未披露            | 已改，privacy / 管理页提示 / 侧边栏帮助 / 官网 FAQ / README / ARCHITECTURE 六处口径同步，代码行为不动                                         | `4dc6bb2`                     |
| 13  | §5.7 四项                                   | 已改，CSV 公式中和 + 往返还原、导入字节闸门、显隐按钮入 closed Shadow DOM、路由 sender 闸门与 `editId` 收口                                   | `5f97a88` `e46a03a` `4b0b63b` |
| 14  | §7.1 零覆盖模块                             | 已改，totp（RFC 6238 官方向量对拍独立 oracle）/ `emailBackup` / `masterPasswordVerify` / 口令弹窗 / rekey 写失败；另修掉生成器 `NaN` 长度缺陷 | `90bf2c5` `95b5e5b`           |
| 15  | §7.2 秒开计时断言进 CI、e2e 转正            | **未做**，见 §9.3                                                                                                                             | —                             |
| 16  | §7.4 release-please 对账、§7.5 截图复核     | **未做**，属发布链路与人工视觉审查，需单独确认                                                                                                | —                             |

### 9.2 未编进 16 条、但报告点过的问题

| 报告小节  | 问题                                                                               | 处置                                                                                                                                                                                                                                                   | 提交      |
| --------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| §6.2      | 密码历史配置读取无代际守卫、缺 `try/catch`                                         | 已改，代际收在唯一持有者 `usePasswordHistory`（新增 `resetHistory`），两处消费端各自再持开关序号                                                                                                                                                       | `f060afd` |
| §6.2      | `SiteRulesDialog` 关闭后仍把结果推进表单                                           | 已改，关闭即刻推进打开代际；列表重载最新者胜                                                                                                                                                                                                           | `f060afd` |
| §6.2 / P2 | `BackupImportDialog` 直出原始异常文本                                              | 已改，新增 `BackupImportUserError` 把"这条 message 已是面向用户文案"变成类型事实，其余异常退到 i18n 通用文案                                                                                                                                           | `43f867f` |
| §6.3      | 身份库关闭后保留解密 PII 行                                                        | 已改，`@closed` 走 `teardown()`；管理页在快照为空时先按存储真值补加载，判重不因刚释放而静默放行（授权范围内拍板）                                                                                                                                      | `f060afd` |
| §6.3      | 健康度弹窗 rAF 句柄未取消、浮动 promise 无 catch、全局 `document.querySelector`    | 已改，句柄登记可取消（关闭 / 重开 / 销毁三处收口）、提醒状态受代际保护并补失败兜底、面板定位限定在组件根节点                                                                                                                                           | `f060afd` |
| §6.4      | Shadow DOM 主题令牌死链                                                            | 已改，镜像表补 `SHADOW_NEUTRAL_TOKENS` 通道，芯片描边改用 `--aph-primary-border`，新增 `shadowTokenCoverage` 闭包守卫盯住这类死链                                                                                                                      | `ed447a9` |
| §6.4      | `SidepanelAuthView` 全局样式段硬编码中性色                                         | 部分已改，三处中性色改走 `--aph-*`（视觉零变化），`!important` 与"必须全局"的理由写进注释，删掉一条挂在不存在的 `is-active-sort` 类上的死规则（全仓无消费者，`is-active` 是另一条仍在用的类）；`#f5f7fa` 与滚动条 `#a8a8a8` 等 EP 无对应令牌的保持原样 | `5a41bfd` |
| §6.5      | 减弱动效只在 CSS 层、命令式滚动不看脸色                                            | 已改，`utils/a11y.ts` 的 `prefersReducedMotion` / `scrollBehavior()` 成唯一判据，6 处命令式滚动收口，4 个组件补 reduce 分支，守卫同时反向要求 `scrollBehavior()` 至少 5 个消费者                                                                       | `5a41bfd` |
| §6.5      | 命令面板 `aria-modal` 无焦点陷阱、`listbox` 混非法子节点、↑↓ 无 `activedescendant` | 已改，抽 `useFocusTrap`（Tab 回环 + 焦点归还），分组改 `role="group"`，输入框走 combobox 模式                                                                                                                                                          | `5a41bfd` |
| §6.5      | 侧边栏"只看收藏 / 排序"按钮缺 `aria-label`、收藏态仅由颜色表达                     | 部分已改，两个按钮补齐 `aria-label`（收藏另有 `aria-pressed`），读屏不再只读出"按钮"；**视觉呈现保持原样**，收藏态在纯视觉上仍由 `type='warning'` 表达——改配色属于需要真机比对的视觉变更，未在本波次做                                                 | `5a41bfd` |
| §6.6      | `HelpDialog` 8 处 `v-html` + 目录式 `eslint-disable`                               | 已改口径，图标改 SFC 消除两处 `v-html`；富文本 8 处保留但逐条写理由，新增 `lintBypassInventory` 把所有绕过项登记成带理由清单（新增 / 删除 / 漏配 `enable` 一律变红）                                                                                   | `5a41bfd` |
| §7.1      | 守卫"判据没牙"（正则漂移导致静默空跑）                                             | 已改，本波次新增的每个扫描型守卫都带扫描规模下限 + 负向对照（删掉守卫行必变红）                                                                                                                                                                        | 多提交    |

### 9.3 明确留在原地的部分

- **§4.2 的 `v-memo` 与 `renderCount`**：报告写这条时就标注了"会改变已文档化的取舍，需拍板"。防抖落地后每键一次的整库重算已经消失，剩下的重渲染成本要用真实 2000 行 DOM 才能定量，而本仓库至今没有这个测量（见 §10）。窗口化 / 上限会改变"当前页全部进 DOM"的既有承诺，因此不做。
- **`:key="index"`（§6.2）**：历史列表在一次加载内不重排，代际守卫又关闭了"跨条目结果覆盖"这条路，报告里担心的主要串扰路径已不可达。残留是"解密在飞时整表被替换"这一窄场景，改成稳定 key 需要为历史记录造唯一标识（`changedAt` 同毫秒可撞），属独立小改造，未顺手做。
- **`PasswordGeneratorPopover` 的 4 个 watcher（§6.2 P2）**：报告已把子智能体的 Critical 判定为不成立（§8），实际后果只是切模式多生成一次，未改。
- **`entrypoints/content/floatingButtons/styles.ts` 的动画**：该处 `@keyframes` 属注入式悬浮按钮的既有观感，`reducedMotionCoverage` 里登记为带理由的例外（"spin 是悬浮按钮唯一的加载反馈，取消动画会丢状态提示"），不是漏网也不是被 `eslint-disable` 式绕过。
- **§6.4 的 P2 硬编码色**（`PasswordFormDialog` `:554/562/589/595/601`、`PasswordTable` `:677/704-706`、`PasswordGeneratorPopover`、`PasswordHealthDialog`、`sidepanel/App.vue`）：全部未改，逐条替换需要真机比对换肤后的视觉，本波次没有该验证条件。
- **§3.3 / §7.2 / §7.4 / §7.5 的其余项**：`tab.id === 0`、`popup` 的 `await tabs.query` 是否丢手势，报告当时就标为"需要真机才能判"，仍未判。

### 9.4 实施时追加推翻的一条

- **§6.2 第二行"`PasswordFormDialog` 用非 deep watcher 镜像父端表单 ⇒ 深字段变化不被察觉、弹窗复开残留上一账号字段"——经核验不成立，未改。** 两条理由：其一，被镜像的 `username / password / url / remark / totp` 全是 `PasswordForm` 上的扁平字符串字段，本就没有"深"层可漏；其二，报告引用的父端原地改（`usePasswordManagement.ts:296` 的 `Object.assign`）是 `applyPasswordFormPatch`，即**子组件回写给自己**的那条通道，值与 `localForm` 同源；而三条整体换新路径（`:498` 带预填的新增 / `:512` 编辑 / `:528` `resetPasswordForm`）都是 `passwordForm.value = { ... }` 换新对象，前两处紧接着才置 `showPasswordDialog.value = true`，`props.form` 引用必然变化，非 deep watcher 必定触发。同仓 `PasswordVerifyView.vue` 用 `{ deep: true }` 是它镜像的对象形状不同，不构成"同一契约两处实现不一致"。

---

## 10. 未验证项与限制

- **所有绝对毫秒数字不可跨机引用**：测量在 6 agent 并发下产生，load 9.4→106，同脚本摆动 2–6×。结构事实（缓存键数 > 上限、每键触达全量、Options DOM 恒定）不受此影响。
- **完全未测**：侧边栏 2000 行真实 DOM 规模与挂载/重渲染耗时；`chrome.storage.local` IO 与真实 AES-GCM 解密耗时（沿用仓库自测值）；Windows 慢盘/低端机；真实浏览器 `blockingMs` / INP。
- **需要真机才能判**：`tab.id === 0` 是否出现；`popup` 的 `await tabs.query` 是否真的丢手势；§3.2 的假锁定在你的真实库规模 + Windows 冷启动下会稳定复现还是偶发。
- **未跑**：`pnpm test:e2e`（本机 chromium/ffmpeg 二进制有缺失史，且 e2e 非门禁）、`pnpm build:firefox`、`pnpm analyze`。
- **本次零改动**：未修改、未删除、未格式化任何仓库源码；新增文件只有本报告与 `.review-tmp/`。清理评审脚手架：`rm -rf /Users/liaolongdong/code/chrome-plugins/account-password-helper/.review-tmp`（要保留测量脚本就先只删日志）。

### 10.1 处置波次（`ca33c83..43f867f`）的验证状态

上面四条限制**没有一条因为改了代码而自动解除**。本波次实际做到的验证：

- 六道门禁在最终 HEAD 上重跑并逐条取真实退出码：`typecheck` 0、`lint`（`--max-warnings 0`）0、`lint:style` 0、`test:run` **165 文件 / 1903 例全绿**（评审时 142 / 1563，净增 23 文件 340 例）、`build` + `build:firefox` 均 0、`prettier --check` 全仓通过（`.review-tmp/` 已删）。
- 新增用例不是"跑过就行"：关键断言逐条做过变异校验（退掉 clamp、删掉代际守卫、摘掉 sender 闸门、去掉前缀 / 去掉还原 / 去掉字节闸门、把 `scrollBehavior()` 的消费者删到阈值下等），对应案例必须变红；改完以 md5 比对确认实现已还原。
- 侧边栏首屏闭包按 SLA 要求复查：`.vue` 图标内联进入口 chunk（不新增 chunk、不多一跳 preload），`sidepanelClosure.test.ts` 9 例对着新鲜产物跑而非跳过；`43827fb` 那笔让首屏闭包多了一个 534 B 的 composable chunk，属已记录的取舍。
- 注入式按钮的 Shadow DOM 迁移做过 headless Chromium 新旧 A/B：图标矩形、计算样式、hover / `:active`、真实点击送达、淡入曲线逐项比对。

仍未验证到位的（交付时按此口径，不要当成已确认）：

- **无真机人工验证**：焦点陷阱与 combobox 读屏播报、健康度弹窗关闭重开、身份库释放后重建、CSV 导出后在 Excel / WPS 里打开的实际求值行为，都只有单测与源码守卫，没有装进真浏览器的操作回归。
- `pnpm test:e2e` 与 `pnpm analyze` 未跑（本机 chromium / ffmpeg 二进制有缺失史，且 e2e 非门禁；`analyze` 结论沿用波次内的闭包检查）。
- Options 的 `preRowMs` / `blockingMs` 两档**仍未达标**，本波次没有改这两段的责任代码（改动集中在侧边栏与对话框层），也没有重新测量。
- 本报告所有绝对毫秒数字的可信度声明（§4.5）同样适用于 §9.1 里引用的 `2856.57 ms → 5.95 ms`：同一串行窗口内的相对差，不是跨机承诺。
- **未 push**：17 个提交全部留在本地 `feature-opt`，推送、发布、上架需另行确认。
