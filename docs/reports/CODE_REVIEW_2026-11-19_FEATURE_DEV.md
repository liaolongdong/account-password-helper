# 代码评审与安全评审报告（main..HEAD，pathScope 特性批次）

- 评审日期：2026-11-19
- 评审范围：`main..HEAD` 共 8 个提交（`f74c5fb..6d1bf64`），103 个文件；重点为运行时代码（源码 17 个文件），文档/素材类改动按"文案是否与实现一致"抽查
- 评审方式：只读评审 + 本机实跑门禁；过程中未修改任何源码（临时探针测试已删除）
- 本次交付：报告本身；**未改动业务代码**

---

## 0. 一句话结论

`pathScope` 的纯函数层（归一化 / 匹配 / 排序权重）设计干净、向后兼容口径明确、测试密度够；**但它没有真正走完「敏感字段」的既有全链路**——`SENSITIVE_FIELDS` 白名单、一键去重指纹、侧边栏排序、导入边界校验四处都没有跟着改，其中前两处分别构成"at-rest 密文不变量被打破"与"删除真实账号"的实际风险。**结论：不建议直接合并，需先修 2 个 Critical + 4 个 Important。**

---

## 1. 客观门禁（本机实跑）

| 命令                                            | 结果                                                        |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `pnpm typecheck`                                | exit 0                                                      |
| `pnpm lint`（`--max-warnings 0`）               | exit 0                                                      |
| `pnpm lint:style`                               | exit 0                                                      |
| `pnpm test:run`                                 | **366 文件 / 5388 例全绿**，208.00s                         |
| `pnpm build`                                    | exit 0，产物 2.68 MB，zip 934.33 kB，15.1s                  |
| `pnpm exec prettier --check <本次改动文本文件>` | exit 0（`llms*.txt` / `sitemap.xml` 无 parser，属既有情形） |

结论：**没有编译期、Lint 期、测试期的显性缺陷**。下面的高优问题全部落在白名单/指纹/边界校验这类"门禁测不到"的位置——测试之所以全绿，恰恰是因为断言集合没有跟着扩。

---

## 2. 改动概览

| 提交      | 内容                                                     | 评审关注点                                 |
| --------- | -------------------------------------------------------- | ------------------------------------------ |
| `f74c5fb` | 最近搜索展示面收口到管理页 + 去重键归一化                | 侧边栏只记录不展示，接线守卫测试           |
| `cbcea3e` | CSV 导入格式文案扩面到 Firefox / KeePassXC / Edge        | 文案与 `excelFormatMap` 实际能力是否一致   |
| `692c5f0` | 删除含真实凭据的退役截图与旧录屏                         | 是否留下悬空引用、文档是否仍写着明文凭据   |
| `ee3957b` | hero-hint 悬停反馈 + 出口卡文字对比度收口                | 对比度数据、悬停反馈是否仍有可感知反馈     |
| `33c0a59` | 装饰性特性图标补 `aria-hidden`                           | 被隐藏的 SVG 是否均属纯装饰                |
| `8199cc6` | pathScope 核心：domain 纯函数 + 四处入口透传 + .aph 链路 | **本次主要风险面**                         |
| `4ea41dc` | options 表单增加「限定路径」折叠区                       | 无校验、静默归一、折叠区样式与提交说明不符 |
| `6d1bf64` | 同步受影响的备份/检索测试                                | 断言集合是否覆盖新字段                     |

---

## 3. Critical（必须修）

### C1 `pathScope` 未纳入 `SENSITIVE_FIELDS`：at-rest 密文不变量有一处缺口

- 位置：`utils/storage/passwordCrud.ts:35`（`SENSITIVE_FIELDS`）、`:42`（`PRESERVED_METADATA_FIELDS`）、`:316`（仅元数据分支）、`:413-419`（字段级回填）、`:484`（`METADATA_FIELDS`）
- 现状：`encryption.ts:278/311` 明确把 `pathScope` 当敏感字段逐字段加密/解密，提交说明也写"与 url 同级敏感度"；但 at-rest 的单一事实源 `SENSITIVE_FIELDS` 仍是五字段 `username/password/url/remark/totp`，`pathScope` **既不在敏感集合、也不在元数据集合**，`SENSITIVE_FIELDS + METADATA_FIELDS = 全字段` 这条既有不变量被打破。
- 后果（两条，均可在无告警下发生）：
  1. `updatePassword(id, { pathScope })`（只改路径、不碰其它字段）会命中 `:316` 的"仅元数据"快路径，把**明文** `pathScope` 写进 `encrypted: true` 的行。此后 `decryptPasswordEntry` 对 `pathScope` 解密失败，而 `decryptFieldSafely`（`encryption.ts:255-259`）刻意让错误上抛 → **该条目整条解密失败**，进而影响整表加载、改主密码、恢复等链路。
  2. 敏感分支的字段级对账（`:413-419`）只回填 `SENSITIVE_FIELDS` 与 `PRESERVED_METADATA_FIELDS`，`pathScope` 取自提交锁**外**那份可能过期的明文快照，并发编辑会用旧值回卷对方的路径修改——正是 2026-11-02 评审 Q1 修过的那类回卷。
- 现状可达性：本次唯一写 `pathScope` 的调用方是表单保存（同时带 `password` 等敏感字段），因此当前**尚未触发**；一旦后续出现"只改路径"的入口（自动保存、右键、批量操作）即刻踩响。
- 修法：`SENSITIVE_FIELDS` 追加 `'pathScope'`；`tests/utils/passwordCrudLegacyPlaintext.test.ts:105`「落盘的行五个敏感字段全是密文」扩为六字段断言；补一条"仅更新 pathScope 仍走重加密分支"的回归测试。

### C2 一键去重会把「同域不同路径」的两个真实账号判为重复并删除

- 位置：`composables/usePasswordManagement.ts:1332-1351`
- 现状：去重指纹是 `[entry.username, entry.url].join('|')`，不含 `pathScope`。而 `pathScope` 的目标场景正是**同 URL（同域同路径前缀之外）、不同路由的两套账号**，两条条目的 username+url 往往刻意相同。
- 后果：用户点「一键去重」→ 分组命中 → 确认框只报"共 N 组 M 条"→ 删掉其中一条（进入 30 天回收站，尚可恢复，但用户不会知道那是一条独立账号）。新特性刚建立的数据被自家去重功能主动清掉。
- 修法：指纹追加 `normalizePathScope(pathScope)`；同步 `dedupeConfirm` 文案口径（中英）。

---

## 4. Important（应修）

### I1 侧边栏与内联下拉/一键填充的"首条"不再一致

- 位置：`entrypoints/sidepanel/App.vue:711-715`（`domainPriorityOf` 只有 `siteRankWithEnv`）；对照 `utils/passwordSort.ts:194`（`siteRankWithEnv * 2 + pathScopePriority`）
- 事实：`quickFillHandler.ts:301-303` 与 `passwordSort.ts` 的注释都写明"首条即侧边栏列表第一条"，这是既有产品不变量。
- 已复现（临时探针，跑完即删）：通用条目 `lastUsedAt=100`、路径条目 `pathScope='/#/desktop'`、`lastUsedAt=1`，页面在 `/#/desktop` 时
  - `filterAndSortEntriesForDomain` → `['desktop', 'general']`
  - 侧边栏 `filterEntriesByScope` + `sortPasswordEntries` → `['general', 'desktop']`
- 后果：侧边栏第一行与快捷键"填第一条"指向不同账号，用户按快捷键会填到通用账号。
- 修法：侧边栏也叠加 `pathScopePriority`（同一处权重表达式最好抽成 `passwordSort.ts` 导出的 `domainPriorityOf(entry, ctx)`，两入口共用，避免第三次漂移）。

### I2 被路径门挡掉的条目完全静默，且现有提示数字会虚高

- 位置：`utils/domain.ts:1190`（`countSameMainDomainCandidates`）、`:1225`（`countPortHiddenCandidates`）都不感知 `pathScope`
- 后果：
  - 端口芯片 / 跨子域提示把"其实还被路径门挡着"的条目计进去，出现"芯片说有 3 条，放宽后一条也不出来"的自相矛盾（这正是 2026-10 端口芯片那轮修过的同类体验缺陷）。
  - 侧边栏没有等价于端口芯片的"因路径作用域未显示"出口，用户只能靠"全站搜索"偶然发现，容易判定为数据丢失。
- 修法：两个计数函数接收 `path` 并复用 `matchesPathScope`；侧边栏补一条与端口芯片同形的提示（或至少在表单里把路径写进列表行，让用户能看出差异）。

### I3 `.aph` 导入未归一化 `pathScope`（不可信输入直接落库）

- 位置：`utils/backup/parseBackupEntries.ts:139`（`readBoundedText` 只做长度/类型收窄）
- 事实：`matchesPathScope` 对任何非空 `scope` 都是**硬过滤**。若备份里是 `desktop`、`#/desktop` 或完整 URL（旧版本/hand-edit/第三方生成），该条目在所有填充入口**永久隐身**且无任何提示。
- 修法：导入边界统一 `normalizePathScope`，归一为空串即视为通用条目（并可选地在导入结果里提示"N 条路径作用域无法识别已按通用处理"）。这是 AGENTS.md「把导入文件视为不可信输入，在边界处校验」的既有要求。

### I4 表单对 `pathScope` 零校验，且三种常见输入会静默变成"硬过滤"

- 位置：`components/options/PasswordFormDialog.vue:189-210`（无 rule、只有 maxlength）、`utils/domain.ts:1286-1306`
- 具体表现：
  - 粘 `https://a.com`（无路径）→ 归一成 `/`，语义从"这个站点"变成"只匹配根路径"，`/desktop`、`/#/x` 全部不命中（`matchesPathScope` 对 `/` 只做精确或 `//` 前缀）。
  - 粘 `https://a.com/desktop/`（尾斜杠）→ 保留尾斜杠，`:1324` 的 `${scope}/` 变成 `//`，除完全等于 `/desktop/` 外一律不命中。根路径以外都建议 strip 尾斜杠。
  - 完全无法解析（如 `https://`）→ `normalizePathScope` 返回 `''`，**静默**保存为"不限路径"，用户以为限定了，实际放开了。
- 修法：保存时把归一化结果回填输入框并给出可见提示；无法解析时阻止保存并给出错误文案；`normalizePathScope` 统一 strip 尾斜杠（保留 `/`）；对 `/` 单独说明其"仅根路径"语义。

### I5 新增用户可见功能缺三处文档/帮助同步

- 事实：`grep 路径作用域` 在 `utils/i18n/locales/*/help.json`、`docs/ARCHITECTURE.md`、`README.md` 均为 0 命中；只有 `options.json:256-259` 四条表单文案。
- 依据：AGENTS.md「新增用户可见功能」要求同步 `docs/ARCHITECTURE.md`「功能实现详解」+ 侧边栏 `help.json` 词条（需提升 `helpItems('help.gx', N)`）+ 必要时 `utils/i18n-lite.ts`。
- 影响：帮助页没有这条能力说明，用户只能靠表单里那行 tip 猜测语义（而该 tip 恰好没解释"路径前缀/尾斜杠/根路径"）。

### I6 JSON/CSV 自导出再导入会丢 `pathScope`（`.aph` 链路是正确的）

- 位置：`utils/excelExport.ts:14-22`（CSV 表头）、`:67-76`（CSV 行）、`:120-131`（JSON entries）；`utils/excelJson.ts:70-76`（JSON 导入映射）
- 后果：JSON 导出→导入后条目从"只在某路径出现"变成"全路径出现"，匹配面被静默放宽；CSV 同理（无该列）。
- 说明：`.aph` 的导出/解析/自检三处已同步，`batchSavePasswords` 是整条展开，故加密备份链路无损——这条只针对 CSV/JSON。
- 修法：JSON 导出 + `parsePasswordJSON` 映射加 `pathScope`；CSV 列如不加，请在导入说明里明确"CSV 不含路径作用域"。

---

## 5. Minor（可选）

1. **测试数与文件数已过期**：实际 5,388 例 / 366 文件；本次把 `5,360` 改成 `5,367` 落到 README、`index.html:4776`、`product-site/index.html`、十余篇 docs/blog 与 `llms-full.txt`，但与实跑值差 21 例、1 个文件。建议由一个脚本/test 单一来源生成。
2. **提交说明与实现不符**：`4ea41dc` 写"折叠区去边框弱化为轻量章节标题"，但该文件无任何样式改动，`el-collapse` 仍是 Element Plus 默认带边框样式。要么补样式（与表单既有 `.form-tip` 排版对齐），要么改提交说明。
3. **公开文档仍写着已删除截图里的真实凭据**：`docs/operations/exposure-status.md:1158` 含明文口令与邮箱；Pages 从 `main` 根目录发布，该 md 可直接按 URL 取到。本轮删图是正确方向，文字也应同批脱敏（改为"含明文口令/邮箱，已删除"的抽象描述）。
4. **`maxlength` 借用了 url 的上限**：`PasswordFormDialog.vue:203` 用 `PASSWORD_FIELD_LIMITS.url`（100），导入侧用 `MAX_URL_LEN`（2048）。深层 hash 路由超过 100 会被静默截断。建议独立常量（如 200）并两侧共用。
5. **位置参数越插越深**：`getMatchingAccounts(domain, page, path, keyword)`（`passwordCache.ts:688`）与 `filterAndSortEntriesForDomain(..., envHost, path)`（`passwordSort.ts:170`）把 `keyword`/`path` 插到中间，历史调用方传错位置不会被类型系统拦住（本次已同步全部调用点与测试，暂无实际错误）。后续如需再加轴，建议改 options 对象。
6. **`useSearchHistory` 的展示 API 只剩一个消费者**：侧边栏已不展示，仍导出 `historyPanelOpen/openHistoryPanel/closeHistoryPanel/selectHistory/clearSearchHistory`；不影响运行，但可考虑收紧导出面，避免下次又接回去。
7. **`pagePathOf` 只剥 `?`**：`#/r?q=1` 的剥除正确；但 pathname 与 hash 拼接后统一 `split('?')[0]`，若未来引入 `;` 矩阵参数或 `#` 内的次级 `#`，需要重新确认口径（当前无影响，仅记录）。

---

## 6. 做得好的地方

- **纯函数分层干净**：`pagePathOf / normalizePathScope / matchesPathScope / pathScopePriority / pagePathFromUrl` 全部无 Vue、无存储依赖，四个填充入口统一走同一个解析器，没有各自 `new URL` 再拼。
- **向后兼容口径写在类型与注释里**：`pathScope` 可选、空值恒命中、取不到页面路径恒放行，与端口轴的既定口径一致，存量数据无需迁移。
- **`.aph` 链路是完整的**：导出、解析、自检（`backupExport.ts:157` 逐字段比对）三处同步，自检覆盖"归一化导致的字段漂移"这类历史缺陷。
- **测试质量**：`tests/utils/pathScope.test.ts` 覆盖归一化/边界（`/desktopx` 不误配）/硬过滤/排序，且明确钉住"不传 path 的旧调用方行为不变"；`tests/architecture/searchHistorySurface.test.ts` 用源码形状守卫"侧边栏只记录不展示"，正是断掉也不会变红的那类接线。
- **`GET_MATCHING_ACCOUNTS` 的路径来自 `sender.tab.url` 而非 message 载荷**，页面侧无法伪造路径来探测其它路由的账号——这是本次安全面上的关键正确决定。
- **i18n 中英成对**，`options.json` 四个 key 齐备，bundle 测试通过。
- **素材清理方向正确**：`692c5f0` 删掉含真实凭据的截图与旧录屏，并把退役原因写进 `assets/screenshots/README.md`；`33c0a59` 的 `aria-hidden` 只加在卡片装饰图标上（外层有标题文本），没有把可访问名一起抹掉；`ee3957b` 的对比度改动带量化依据（4.48:1 → 9.75）。
- **文案与实现一致**：CSV 扩面文案（Chrome/Edge、Firefox、KeePassXC）与 `excelFormatMap.ts:3/59/68` 的实际支持逐项对得上，不是空口宣传。

---

## 7. 建议的修复顺序

1. **C1**（`SENSITIVE_FIELDS` + 六字段测试）——一行改动，堵住 at-rest 缺口与并发回卷。
2. **C2**（去重指纹加 `pathScope`）——一行改动 + 文案。
3. **I1**（侧边栏共享同一份 `domainPriorityOf`）——恢复"首条一致"不变量。
4. **I3 + I4**（导入归一 + 表单校验/回填/尾斜杠）——同属"输入边界收口"，一起做最省事。
5. **I2**（提示计数感知 path / 补路径提示）与 **I5/I6**（文档、JSON 往返）——可放同一批。

---

## 8. 未覆盖与限制

- 未做真机 UI 走查（Options 对话框折叠区、侧边栏列表在 6 套主题下的实际视觉），仅做静态样式与结构评审；`el-collapse` 在 `.el-form` 内的垂直节奏建议实际截图确认。
- 未在真实 SPA（hash 路由）站点上验证端到端填充；路径提取依赖 `tab.url` 的 `pathname + hash`，已在单测层覆盖，但"内容脚本所在框架的 URL 与顶层 tab URL 不一致"的场景未实测。
- 未做性能量化对比：本次新增判定是每条一次字符串比较，量级可忽略；未跑 `benchmarks/sidepanel-p0.bench.ts` 复测。
- 未复核 `assets/` 下被删文件的 git 历史（真实凭据仍在历史提交中可被 `raw.githubusercontent.com` 取到），彻底清除需 `git filter-repo` 强推，属另一项决策。

---

## 9. 修复记录（2026-11-19 同批次落地）

本轮把上文 2 个 Critical、6 个 Important 与 4 个 Minor 全部处理完，改动集中在 `pathScope` 全链路与文案一致性，未触碰其它功能与默认值。

| 编号 | 修复内容                                                                                                             | 关键文件                                                                                                                             | 守卫测试                                                                               |
| ---- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| C1   | `pathScope` 登记进 `SENSITIVE_FIELDS`，只改路径也走重加密分支；字段级回填同步覆盖它                                  | `utils/storage/passwordCrud.ts`                                                                                                      | `tests/utils/passwordCrudLegacyPlaintext.test.ts`（新增「只改 pathScope 也走重加密」） |
| C2   | 去重指纹改为 `username + url + 归一化 pathScope`，纯函数下沉为可单测模块                                             | `utils/passwordDedupe.ts`（新）、`composables/usePasswordManagement.ts`                                                              | `tests/utils/passwordDedupe.test.ts`（4 例，含同域不同路由不被合并）                   |
| I1   | 排序权重抽成 `domainPriorityWithPath` 单点导出，侧边栏与下拉/一键填充共用                                            | `utils/passwordSort.ts`、`entrypoints/sidepanel/App.vue`                                                                             | `pathScope.test.ts`「两入口给出相同顺序」+ 两处架构守卫改判共享函数                    |
| I2   | 端口芯片/跨子域计数感知路径门，消除「说有 N 条、放宽后一条不出」                                                     | `utils/domain.ts`（`countSameMainDomainCandidates` / `countPortHiddenCandidates` + `ScopedEntryRef`）、`App.vue`、`passwordCache.ts` | `tests/utils/domain.test.ts`（两条计数用例）                                           |
| I3   | 加密备份导入在边界归一化 `pathScope`，不可解析值退化为「不限路径」                                                   | `utils/backup/parseBackupEntries.ts`、`utils/backupExport.ts`（自检同口径）                                                          | `tests/utils/excel.test.ts` + 既有 `.aph` 往返用例                                     |
| I4   | 表单失焦归一 + 提交校验（不可解析拦截）+ 尾斜杠折叠（`/#/` 例外）+ 独立长度常量                                      | `utils/domain.ts`、`utils/formValidators.ts`、`components/options/PasswordFormDialog.vue`、`utils/constants.ts`                      | `pathScope.test.ts`、`formValidators.test.ts`（新增校验器 describe）                   |
| I5   | 帮助页与管理页使用指引各加一条 pathScope 说明（`helpItems` 21 → 22），ARCHITECTURE 中英各加一节，README 中英各加一条 | `help.json`×2、`HelpDialog.vue`、`GuideView.vue`、`docs/ARCHITECTURE(.en).md`、`README(.en).md`                                      | `i18nBundles.test.ts`（序号 1..N 齐全且无多余）                                        |
| I6   | JSON 导出/导入保留并归一化 `pathScope`（CSV 列格式不动，已在代码注释说明）                                           | `utils/excelExport.ts`、`utils/excelJson.ts`                                                                                         | `excel.test.ts`（JSON 往返 + 边界归一化）                                              |
| m1   | 测试数同步为实测值：5,403 例 / 367 文件（含博客修订日期与 `gen:blog` 重出）                                          | 31 个对外文案文件                                                                                                                    | `pnpm gen:blog` 幂等                                                                   |
| m2   | 折叠区补「轻量章节标题」样式，使实现与提交说明一致                                                                   | `components/options/PasswordFormDialog.vue`                                                                                          | `lint:style`                                                                           |
| m3   | 公开文档中的明文口令脱敏（`exposure-status.md`、历史评审）                                                           | `docs/operations/exposure-status.md`、`docs/code-review-2026-09-26.md`                                                               | 人工复核                                                                               |
| m4   | 意图参数改 options 对象、`useSearchHistory` 收紧导出面：**未修**（收益低于回归风险，留作独立任务）                   | —                                                                                                                                    | —                                                                                      |

### 复验（同一工作区实跑）

| 命令                             | 结果                                                     |
| -------------------------------- | -------------------------------------------------------- |
| `pnpm typecheck`                 | exit 0                                                   |
| `pnpm lint`                      | exit 0                                                   |
| `pnpm lint:style`                | exit 0                                                   |
| `./node_modules/.bin/vitest run` | **367 文件 / 5403 例全部通过**，exit 0                   |
| `pnpm build`                     | exit 0，zip 935.79 kB（+1.4 kB，新增去重模块与帮助文案） |
| `pnpm gen:blog`                  | 28 页 + `llms-full.txt` 幂等重出，diff 仅数量与修订日期  |

### 仍未处理（需后续决策）

- 存量条目中「带尾斜杠 / 裸片段」的 `pathScope` 不会被自动改写：新写入与导入都会归一化，但本次修复前已落库的特殊写法仍不会命中。若线上已有此类数据，需要一条一次性迁移（读取→`normalizePathScope`→回写），属数据迁移决策，本次未擅自执行。
- 真实凭据仍在 git 历史中可被 `raw.githubusercontent.com` 取到，彻底清除需 `git filter-repo` + 强推。
