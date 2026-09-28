# 内联下拉列表 vs 侧边栏：排序一致性核实与功能对齐评估

> 状态：**A / B（含前置内核拆分）/ C / D / E（安全半）/ F / G 已于 2026-09-22 实施并回归通过，见第九节**；第一至第七节保留评估时的原始判断
> 日期：2026-09-22
> 范围：`entrypoints/content/inlineDropdown/InlineFillDropdown.ts`、`entrypoints/background/passwordCache.ts`、`utils/passwordSort.ts`、`utils/passwordFilter.ts`、`utils/searchMatch.ts`、`utils/domain.ts`、`utils/favicon.ts`、`entrypoints/sidepanel/App.vue`、`components/sidepanel/*.vue`、`entrypoints/content/FormDetector.ts`、`wxt.config.ts` 与 `.output/chrome-mv3/manifest.json`

---

## 一、三个问题的直接回答

**1. 内联下拉的排序规则和侧边栏一致吗？—— 一致，而且是结构性一致，不是"碰巧一致"。**

两者拿到的是同一个函数的输出：内联列表来自 `getMatchingAccounts()`（`entrypoints/background/passwordCache.ts:535`），它调 `sortMatchesForDomain()`（同文件 `:496`），后者读**同一份侧边栏排序配置** `getSidepanelSortConfig()`（`utils/storage/configManager.ts:151`，存储键 `sidepanel_sort_config`）+ **同一个档位** + **同一个** `filterAndSortEntriesForDomain()`（`utils/passwordSort.ts`）——而侧边栏的 `filteredPasswords` 走的也是 `sortPasswordEntries` 这条链。侧边栏改排序时写回的也是同一个键（`entrypoints/sidepanel/App.vue:565` → `saveSidepanelSortConfig`），并且 `backgroundServices.ts:655-706` 监听该键失效 SW 缓存。所以：只要用户在侧边栏点一下"最近更新"，下一次内联面板打开就是那个顺序。**这一项不需要任何改造，也不应该再加第三套排序实现。**

内联本地那一层二次过滤（`applyFilter`，`InlineFillDropdown.ts:1178`）用的是 `Array.prototype.filter`，保序，不会破坏上面这条链的结果。

**2. 需要和侧边栏功能保持一致吗（标签过滤、拼音搜索等）？—— 逐项不同，但总原则是：不追求"功能集合相同"，只消除"同一事实两处不同答案"。**

内联下拉的产品定位是「就在这一个输入框旁边，把对的账号最快填进去」，侧边栏是「浏览和管理整个库」。按这个定位逐项看，结论是：

- **拼音搜索：需要对齐**（同一批用户、同一个搜索框语义，现在内联搜"张三"的 `zs` 搜得到、`zhangsan` 搜得到，在内联里搜不出来）。但**不该把 `pinyin-match` 搬进 content**——见 §四方案 B。
- **标签点选过滤：不需要**（标签已经渲染、也已经参与关键词匹配，缺的是"点选收窄"这个动作，而内联面板窄、列表本来就短，收益低于成本）。
- **只看收藏：不需要**（收藏条目已置顶且行内已有星标）。
- **排序切换下拉：明确不要**（内联没有"换个角度浏览"的意图，而且它一写就写全局 `sidepanel_sort_config`，会反向改掉侧边栏的排序；不写全局就得再造一套排序状态，破坏 §一的单点结构）。
- **搜索范围（本站 / 全站）：不需要照搬**，但**空态缺一个出口**需要补——内联点不了外站条目（列表本来就只含本站），所以正确的形态不是把外站条目塞进内联，而是把用户送到能浏览全库的地方。

同时核实到一个**大家常以为会不一致、其实完全一致**的点：全局「自动触发登录」对内联和侧边栏的作用方式相同（`FormDetector.ts:1474`：`if (data.autoLogin || this.floatingButtonConfig.autoTriggerLogin)`，内联 `FILL_BY_ID` 不带 `autoLogin`，因此两侧都只由这个全局开关决定）。这一项不用动。

真正的分歧只出现在**过滤内核**上：侧边栏 `applyListFilters`（`utils/passwordFilter.ts:101`）= 子串 + 拼音 + 标签集 + 只看收藏；内联 `applyFilter`（`InlineFillDropdown.ts:1178`）= 只子串。两边检索的**字段集完全相同**（`[username, tag, remark, url]`），差的是匹配器和三个交互开关。

**3. 有没有更好的优化方案？—— 有，而且最有价值的不是"对齐功能"，是"补输入效率与安全边界"。**

按我的判断排出来的最高性价比组合是：A（统一过滤内核、消除未来漂移）+ B（SW 侧拼音兜底）+ C（默认选中首条，回车即等于快捷键的一键填充）+ D（输入法组合输入保护）+ E（payload 与 favicon 瘦身）。这五项里 C 和 D 改变交互，需要你拍板；A、B、E 可以做到用户可见行为只在"本该有更多结果"的场合变多。

---

## 二、证据链：现状对照

### 2.1 数据与排序（一致）

| 环节               | 侧边栏                                  | 内联下拉                                 | 是否同源                              |
| ------------------ | --------------------------------------- | ---------------------------------------- | ------------------------------------- |
| 档位 / 可见性判据  | `resolveMatchTier`（`utils/domain.ts`） | 同一个（在 SW 内算，结果以 `tier` 下发） | ✅ 单点                               |
| 排序配置           | `getSidepanelSortConfig()`              | 同一个（`getCachedSortConfig`）          | ✅ 单点                               |
| 排序实现           | `sortPasswordEntries`                   | `filterAndSortEntriesForDomain`          | ✅ 同一实现（收藏置顶 → 层级 → prop） |
| 本地开发端口过滤   | `matchesPortForLocalDev`                | 同（SW 内 `sortMatchesForDomain`）       | ✅                                    |
| 跨子域空态提示计数 | `countSameMainDomainCandidates`         | 同一个（`passwordCache.ts:590`）         | ✅ 但触发条件不同，见 2.3             |

### 2.2 过滤与匹配（不一致，已漂移）

```
侧边栏  utils/passwordFilter.ts:101  applyListFilters
        keyword → matchesKeyword([username, tag, remark, url])   ← 子串优先，拼音模块就绪后补齐全拼/首字母
        tags    → parseTags + 选中集
        favoriteOnly

内  联  InlineFillDropdown.ts:1178  applyFilter
        kw → asText(username|tag|remark|url).toLowerCase().includes(kw)   ← 只有子串
        无 tags / 无 favoriteOnly / 无 scope
```

字段集相同，匹配器不同。这是"同一条数据在两个界面能不能被搜到"级别的分歧，不是功能多寡的分歧——所以它属于该修的那一类。

顺带两处同源问题的分支：

- 高亮：内联 `highlightHtml`（`:1802`）用 `while` 循环高亮**所有**子串出现位置；侧边栏 `SearchHighlight` / `highlightSegments`（`utils/searchMatch.ts:188`）只高亮**一个**区间（可能是拼音命中区间）。同一关键词两处高亮范围不同，且内联无法表达拼音命中。
- 空态跨子域提示：侧边栏在"过滤后为空"时提示（含搜索词导致的空）；内联门限写的是 `this.accounts.length === 0`（`:1209`），即"本站一条都没有"才提示——本站有账号但关键词打不到时，内联不给放宽提示。修它需要 SW 在列表非空时也算一次 `crossDomainCount`（现在是刻意不遍历全库省开销），属于有代价的小分歧。

### 2.3 列表可见信息（基本对齐，一处刻意不同）

内联行已经渲染：网站图标 / 星形收藏 / 用户名 / 标签 chips（与侧边栏同一套 `parseTags` + `getTagColor` HSL 配色）/ 跨子域来源 chip / 2FA 徽标或活码。刻意不同的是补充槽 `remark || url` 二选一（`:1245`，注释说明备注优先、URL 兜底，截断全文由行级 title 承接），侧边栏则标签 + URL + 备注三样都给。**不建议为对齐而把三样塞进内联行**——行高和可读性会先付出代价。

另有一处**死字段**：SW 每条都算 `title`（`passwordCache.ts:577`，取 tag||url||username||untitled），内联渲染器全程不读它（`InlineFillDropdown.ts` 里没有任何 `.title` 引用）。它只增加消息体积。

### 2.4 键盘与可达性（内联明显弱，且不只是"少功能"）

| 项             | 侧边栏                                                          | 内联                                                     | 备注                                                                                                                                                                               |
| -------------- | --------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 打开后默认选中 | `activeIndex` 从 0 开始                                         | `-1`（`:595/:1077/:1195`）→ 直接按回车无反应             | 内联搜索框打开即自动聚焦（`:1089` → `focusSearch()`），用户"打开→回车"的最短路径是断的                                                                                             |
| 输入法组合输入 | 无 `isComposing` 保护                                           | 同样无（全仓 `isComposing` / `compositionstart` 零命中） | 面板级 `document` 捕获监听（`:1714`）会看到 IME 确认键；`ArrowDown` 还被 `preventDefault`。**这条我判定为高概率真实缺陷但需要真机验证**（macOS Chrome + 微软拼音），不写成既成事实 |
| Esc 语义       | 关面板                                                          | 一律 `hide()`（`:1731`），关键词一并丢弃                 | 有词时先清词更合下拉框直觉                                                                                                                                                         |
| ARIA / 焦点    | 行 `role="button" tabindex="0"`、`aria-label`、focus-visible 环 | 行只有 `data-index`，无 role、不可 Tab 到达              | 内联的 2FA 触发器是 `<button>`（可聚焦），行本体不可聚焦                                                                                                                           |
| 大列表渲染     | 首帧 30 条 + rAF 每帧 +60（`SidepanelAuthView.vue`）+ `v-memo`  | 全量 `innerHTML` 重建（`:1226`）                         | 见 §五 P2                                                                                                                                                                          |

### 2.5 拼音进 content 的可行性 —— 已实测排除

- `.output/chrome-mv3/manifest.json` 顶层键里**没有** `web_accessible_resources`（实测读出 `null`），content script 产物是单文件 `content-scripts/content.js`，`pinyin-match` 在 `chunks/` 里独立成块。
- content 世界要 `import()` 扩展自身 chunk，必须把该资源声明为 web-accessible。这等于给任意网页一个「该扩展是否安装」的探针和一个可拉取的扩展资源路径。
- 仓库在完全同构的问题上已经做过一次相反的选择并写下理由：`utils/favicon.ts:66-71` 明确说「网页环境无法直接加载 `chrome-extension://` 的 `_favicon/`（需暴露 WAR，会引入网页探测浏览历史的隐私风险）」，改为 SW 读本地缓存转 dataURL 随元数据下发。

**结论：把拼音搬进 content 与项目既有隐私边界冲突，否决。** 要做拼音，方向是让拼音留在它已经在的地方（SW / 扩展页面），把"匹配"这件事搬到 SW 去做。

---

## 三、功能对齐判定表（问题 2 的完整回答）

| 侧边栏能力                                                            | 内联是否需要         | 判定理由                                                                                                                       | 若做的代价                                        |
| --------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 拼音 / 全拼搜索                                                       | **需要**             | 同一搜索框语义、中文用户名与备注是主战场；现状内联搜不到而侧边栏搜得到，属"同一事实两处不同答案"                               | 搬包体 → 否；SW 侧过滤 → 可行（方案 B）           |
| 标签点选过滤（chip 行）                                               | 不需要               | 标签已可见、已参与匹配；内联场景是"选一个填"，不是"筛一批看"                                                                   | 面板高度 + 一套选中态 + 与关键词的交互叠加        |
| 只看收藏                                                              | 不需要               | 收藏已置顶且已带星标                                                                                                           | 一个开关位 + 状态                                 |
| 排序字段切换                                                          | **明确不要**         | 无浏览意图；写全局键会反向改侧边栏排序，不写则造出第二套排序状态、破坏 §一的单点结构                                           | 高（架构一致性）                                  |
| 本站 / 全站范围切换                                                   | 不需要照搬           | 外站条目在内联点了填不进当前页，只会产生"点了没反应"                                                                           | 需重定义整行语义                                  |
| 空态「到全库找」的出口                                                | **需要（换个形态）** | 现状内联空态只有"添加此网站账号"+（受限的）放宽提示，没有"我库里到底有没有这个账号"的答案                                      | 一行文案 + 一个跳转，成本极低                     |
| 行级动作（复制账号 / 复制密码 / 分享 / 编辑 / 填充并登录 / 打开站点） | 大部分不需要         | 侧边栏的动作是"管理"动作；内联的动作是"填进去"。复制密码、分享卡片、编辑放到页面浮层里会诱导出在网页上下文中处理明文的更多路径 | 需要焦点管理、tooltip、剪贴板定时器协同，复杂度高 |
| 自动触发登录                                                          | 已经一致             | `FormDetector.ts:1474` 共用同一全局开关，两侧行为同构                                                                          | —                                                 |
| 大列表窗口化 / 分片渲染                                               | 暂时不需要，条件触发 | 本站范围条目通常个位数；只有"大量无 URL 通用条目"（tier 4 在任何档位都进列表）才会撞                                           | 见 §五 P2                                         |
| 键盘 / ARIA 同等可达                                                  | **需要**             | 这是可用性下限，不是功能对齐                                                                                                   | 低                                                |

---

## 四、核心方案（按推荐度）

### A. 把"过滤"收成内核单一职责，切断再次漂移（推荐，风险最低）

现在的形状是：`applyListFilters`（侧边栏专用）里硬编了 `matchesKeyword`，内联另写了一份 `.includes`。把匹配器变成入参即可：

- `applyListFilters(entries, { keyword, tags, favoriteOnly, match })`，`match` 缺省为 `matchesKeyword`；
- 侧边栏不变；内联传入自己的子串匹配器（或后续按 B 换掉）。

关键约束（这是 §2.5 的推论）：content 侧任何共用的模块**都不能出现会被执行的 `import('pinyin-match')`**。`utils/searchMatch.ts:59` 的动态 import 只在函数体内，靠"不调用即不加载"来保证——但 content 世界即使调用了也不会成功（无 WAR），只会走 `.catch` 静默降级。所以正确做法是**依赖注入**（内联永远不给它触发拼音加载的机会），而不是给共享模块加一个 `{ usePinyin: false }` 开关去赌那条路径不被执行。

产出：内联和侧边栏的字段集、大小写、trim 口径从此由同一处定义；高亮也可顺带统一（`highlightSegments` 是纯函数，可给 content 用，只要不走拼音分支）。

### B. 拼音：让 SW 帮忙搜，不把包体搬进页面（推荐）

在 `GET_MATCHING_ACCOUNTS` 增加一个可选 `keyword`，SW 在 `sortMatchesForDomain` 之后用**同一个** `matchesKeyword` 收一层（保序），把"排序后 + 已过滤"的列表回给内联。内联侧保留本地子串过滤作为乐观首屏，去抖约 120ms 后再发一次带关键词的请求覆盖结果——这样正常打字零额外往返、停顿一次才走 SW。已有 `requestSeq` 竞态守卫（`:1052-1065`）可直接复用。

需要注意的三件事，都属于必须先设计的：

1. **不做日志**：关键词可能含账号名片段，`utils/logger.ts` 的参数里不能进（安全基线）。
2. **边界校验**：keyword 是网页上下文可影响的输入（虽然只由本扩展 UI 写入），SW 侧要按不可信输入处理——限长度（如 ≤64）、非字符串即忽略。
3. **SW 侧拼音就绪**：`pinyin-match` 目前只被侧边栏/Options/Popup 引用，`warmPinyinMatcher()` 的调用点在 `entrypoints/sidepanel/App.vue:956` 与 `composables/usePasswordManagement.ts:60`。要在 SW 首次真正需要时懒加载一次；代价是 background 多一个 chunk 的按需加载，不进首屏关键路径，也不进 content。

**替代形态 B'**（更省但更不"对齐"）：只在"本地子串零结果且关键词含非 ASCII"时发一次兜底请求。代价是内联可能在子串已有结果时少显示拼音命中的行——即刻意保留一处可解释的分歧。我倾向 B 而不是 B'，理由是"同一关键词两侧结果不同"本身就是这次评估要找出来东西。

### C. 默认选中首条：让内联的 Enter 等于快捷键的"一键填充"（改变交互，需拍板）

`quickFillHandler` 填的是排序首条，内联列表首条就是同一条。把 `activeIndex` 初值从 `-1` 改成 `0`（`aria-activedescendant` 指向首行），"打开面板 → 回车"就是与 `Ctrl+Shift+K` 完全等价的填充，↑/↓ 才用来逐个浏览。这把内联最有价值的那条路径从 2 次操作压到 1 次，也和侧边栏的键盘起点一致。

风险要说明：首条被误按的概率上升（原来必须显式按一次 ↓ 才会选中）。考虑到填充对象是登录表单、且面板打开是用户主动动作，我判断收益大于风险，但**这条属于改变交互，不动，等你确认**。

### D. 输入法组合输入保护（需真机验证，倾向直接修）

`handlePanelKeydown`（`:1728`）在 `e.isComposing` 为真时应直接返回，不 `preventDefault`、不做 Enter 填充。全仓当前零处 `isComposing` 判断，所以侧边栏也有同类问题；但内联的影响更重：它的搜索框在打开时**必然自动聚焦**（`:1089`），且 Enter 的默认后果是"把某个账号的凭据填进密码框"，错触发比侧边栏"多填一次"更难撤回。

诚实标注：这条我只做到了代码事实（无保护 + 自动聚焦 + Enter 语义），**没有真机验证 IME 场景的实际事件序列**（Chrome 在不同平台上对组合键的 `keydown` 派发有差异）。实施前应在 macOS Chrome + 微软拼音 / 搜狗两侧各跑一次。

### E. Payload 与 favicon 瘦身（低风险、纯优化）

1. **favicon 按 origin 去重**：`fetchFaviconDataUrl` 的缓存键是「归一化 URL + size」（`utils/favicon.ts:81`），带不同 path 的条目会各自 fetch + 各自 base64 一份**同一个**站点图标。同站多账号正是内联的主场景（例如 `example.com/login` 与 `example.com/admin`），一份 dataURL 约 1–4KB，全量随消息进页面。改按 origin 做键（Chrome 的 favicon 服务本就按站点返回），消息里同图标只出现一次。
2. **删掉或用上 `title`**：现在它每条都算、没人读。二选一：从 `MatchingAccountMeta` 去掉（减体积），或让内联行在用户名为空时以它兜底。**我倾向前者**（后者是新的展示语义）。
3. 这两条都不改变可见行为，属于"顺带清理"，不单独开波。

### F. 空态补一个"到全库找"的出口（建议，成本极低）

内联空态目前是 `emptyNoAccounts` / `emptyNoMatch` + 「添加此网站账号」+（仅本站确实无账号时的）跨子域放宽提示。缺的是"我库里明明有，但不在本站"这一类的去处。建议加一行文字入口：打开侧边栏（或 Options 列表）并带上当前关键词——而不是把外站条目塞进内联列表（那会产生"点了填不进当前页"的死路，侧边栏为此专门设计了 `offSiteIds` + 整行改为"打开站点"，内联没有那套语义）。

### G. ARIA 与焦点（建议，配合 C/D 一起做）

面板补 `role="combobox"` + 列表 `role="listbox"` + 行 `role="option"` + `aria-selected`，用 `aria-activedescendant` 表达当前项；行本体不进 Tab 序列是可接受的（下拉框惯例），但 2FA 徽标这类真实按钮要能被 Tab 到。与侧边栏已有的 `role="button"` / focus-visible 环属同一水准要求。

---

## 五、优先级与实施波次建议（等你选定后再动手）

| 级别 | 内容                                       | 用户可见变化                                  | 改动面                                                   | 是否需你拍板                            |
| ---- | ------------------------------------------ | --------------------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| P0   | A 统一过滤内核（含高亮口径）               | 无（口径收束，防未来漂移）                    | `utils/passwordFilter.ts`、内联 `applyFilter` + 测试     | 否（可证行为等价）                      |
| P0   | D 输入法组合保护                           | 有（中文输入时不再误填/吞键），但是"修错"方向 | 内联 1 处 + 侧边栏键盘入口 1 处                          | **是**（交互）                          |
| P1   | B SW 侧拼音过滤                            | 内联可搜到拼音命中的条目（与侧边栏一致）      | `messageRouter` 消息入参、`passwordCache`、内联去抖      | **是**（新增 IPC 往返 + SW 懒加载拼音） |
| P1   | C 默认选中首条                             | 打开即回车=一键填充                           | 内联初值 + `updateActive` + 测试                         | **是**（交互）                          |
| P1   | E favicon 按 origin 去重 + 删死字段        | 无                                            | `utils/favicon.ts`、`passwordCache.ts`、`utils/types.ts` | 否                                      |
| P2   | F 空态全库出口                             | 多一行可点文字                                | 内联空态 + `i18n-lite` 中英文                            | 建议做，文案需你过一眼                  |
| P2   | G ARIA 语义                                | 读屏体验                                      | 内联模板                                                 | 否                                      |
| P2   | 长列表窗口化 / `crossDomainCount` 非空也算 | 无（只在 ≥50 条或关键词打空时体现）           | 内联渲染 + SW 每次开面板多一次全库计数                   | 否，但先量再改                          |

**C 与 D 必须同波**（见 §7.2）：`activeIndex` 从 -1 改 0 会把"IME 确认键误触"从无害的无反应升级为误填首条凭据，只上 C 是净负收益。若只批一条，批 D。

**明确否决**：把 `pinyin-match` 塞进 content（需 WAR，破既有隐私边界）；照搬侧边栏组件树或引入 Element Plus 到内联（Closed Shadow DOM + `all: initial` + 内联 `--aph-*` 令牌的隔离前提会被打穿，且直接冲击 content 包体）；给内联加排序切换（写全局键会反向改侧边栏，不写就造第二套排序状态）；把外站条目带进内联列表（内联没有 `offSiteIds` 那套"整行改为打开站点"的语义）。

---

## 六、如果只挑一件事

选 **A + B**（先 A 后 B）。理由：用户问的是"要不要和侧边栏一致"，而当前唯一真正的**不一致**就是过滤内核（字段集相同、匹配器不同、拼音单边失效）——这不是功能多寡，是同一个搜索框在两个地方给出不同答案。C/D/E 都值得做，但它们不在"一致性"这个命题上。

---

## 七、三个追问的补充结论（同日补充）

### 7.1 方案 B 是否依赖侧边栏打开？—— 不依赖，但要先把匹配内核从 Vue 里拆出来

拼音的**执行体在 SW**，`import('pinyin-match')` 在扩展自身上下文（Service Worker）加载自身 chunk 是合法的，不需要 WAR。侧边栏开着、关着、还是这台机器上从没打开过，结果都一样。

反过来要澄清一个更容易踩的点：**"侧边栏已经预热过"这件事对 SW 没有任何复用价值**。`pinyinMatcherReady` 是模块级、进程内的响应式标志（`utils/searchMatch.ts:26`），温热状态只存在于侧边栏那个进程的内存里；SW 必须自己 load 一次。所以既不能指望它，也不需要它。

但 B 有一个我在上一版没写足的前置条件——**`utils/searchMatch.ts` 现在不能直接给 background 用**：

```
实测 .output/chrome-mv3/chunks/searchMatch-C62pDdSg.js 首行：
  import{$r as h}from"./i18n-Dv8Qgm9R.js"     ← 该共享 chunk 131KB（Vue + vue-i18n）
而 .output/chrome-mv3/background.js 里 Vue 痕迹为 0（grep reactive/effectScope 未命中）
```

因为 `searchMatch.ts:1` 就是 `import { shallowRef } from 'vue'`。把 `matchesKeyword` 原样搬进 SW，等于给 background 依赖图加上这条 131KB 的边，而 `GET_MATCHING_ACCOUNTS` 正走在内联面板的关键路径上（SW 冷启动时它就在秒开链路上）。所以 B 的第一步是**拆内核**：无 Vue 依赖的匹配核心（模块缓存 + `matchesKeyword` / `findMatchRange`）+ 一个 `onReady(cb)` 订阅，把 `shallowRef` 那一层响应式壳留在 Vue 侧。这与方案 A 的"依赖注入"是同一件事的两面。

第二个代价要说在前面：**SW 会被回收**，回收后第一次拼音匹配要付一次 chunk 加载（Windows 冷盘更明显）。两个取舍：

- 接受首键降级为子串（和侧边栏"预热完成前=子串"完全同构，不引入新的概率类别）；
- 或在 SW 空闲时预热一次（代价是保活期内常驻约 27KB）。

建议先按前者实现 + 真机量一次，再决定要不要预热。

最后一点语义差别的坦白：侧边栏是"内存里过滤"（0 次 IPC），B 是"跨进程过滤"（每个停顿 1 次往返）。所以对齐的结果是**内联结果集 ⊇ 侧边栏本站结果集**，而不是两边逐字节相同——真正防止两边再次分叉的锁是方案 A，B 只负责把拼音这一项补上。

### 7.2 默认选中首条后，搜索框还自动聚焦吗？—— 会，两者正交

焦点和"选中"本来就是两件事：`openPanel` 在定位成功后调 `focusSearch()`（`:1089` → `:1327` `searchInput.focus()`）把焦点放进搜索框；`activeIndex` 只表示"哪一行高亮 + 回车填谁"，它的处理器挂在 `document` 捕获阶段（`:1714`），**与焦点在哪个元素无关**。这正是原生 combobox 的 `aria-activedescendant` 模型：焦点始终不离开输入框，高亮跑在选项上。所以 C 不影响打字、不影响自动聚焦。

但要连带改三处，否则等于没做：

1. `applyFilter` 末尾的 `activeIndex = -1`（`:1195`）→ 过滤后重置为 0（过滤结果为空时才保持 -1）。不改这里的话，用户一打字首条就不再高亮，"打开即回车"只在不打字时成立。
2. `openPanel` 里的 `-1`（`:1077`）与另一处 `:1102` 同步核对初值口径。
3. `updateActive()` 在首帧就要把高亮画到第 0 行（现状是"无高亮"起步）。

**必须与 D 同波实施**，这条是本次补充里最重要的结论：现在 `activeIndex = -1`，IME 确认键的 Enter 落到 `if (this.activeIndex >= 0)`（`:1750`）判空、什么都不做；改成 0 之后，同一击会直接 `select(0)` —— 把首条凭据填进密码框并关掉面板。也就是说 **C 会把 D 的缺陷从"按了没反应"升级成"填错账号"**。只上 C 是净负收益。

附带一个交互细节需要定：`ArrowUp` 下界 clamp 到 0（`:1747`），改了初值之后就没有"取消选中"的键盘出口了。要不要留一个（例如首行再按一次 Up 取消高亮），实施前定。

### 7.3 Esc 怎么设计体验最好

先摆现状事实（`handlePanelKeydown :1728-1756` + `closePanel :736`）：Escape 是函数里第一个分支，先于 `locked` 判断，一律 `preventDefault()` + `hide()`；`hide()` 只摘掉 `visible` class、重置 `activeIndex`、清活码 DOM，**既没有"先清关键词"这一级，也没有把焦点还给原输入框**；关键词要到下一次 `openPanel` 才被清（`:1076`）。

推荐四层，按优先级：

1. **组合输入中不拦**：`if (e.isComposing) return;` 放在函数最前面。否则中文用户想"取消候选词"按 Esc，得到的是整个面板消失——这是 Esc 路径上唯一"帮倒忙"的一档，下面两层只是让它更好用。
2. **分级退出**：有搜索词时第一次 Esc 清空关键词、恢复本站完整列表（焦点留在输入框、面板不关、`activeIndex` 回 0、列表滚回顶部）；无词时 Esc 才关面板。这是 Spotlight / VS Code 命令面板 / `el-select` 的通行口径——给用户一个"往回退一级"的台阶，而不是"全有或全无"。
3. **关面板时归还焦点**：`this.currentInput?.focus()`（该引用已存在，`:578`）。安全性已核实：`handleFieldBlur`（`:1013`）在面板开着时只延时隐藏图标，不会因重新聚焦而重开面板——重开需要点图标或走快捷键（`:634` / `:675` 都有"同一输入框已打开则短路"的守卫）。省掉用户"Esc 之后再点一次输入框"这一步。
4. **锁定态维持现状**：Esc 排在 `locked` 判断之前是对的，锁着也能关，别顺手改这个顺序。

两个"不建议"：

- 不建议做"跨次记住关键词"。关闭即重置（现状）比记忆更安全——把上次的窄结果悄悄留着，用户下次打开会先困惑于"怎么只剩两三条"。
- 不建议给两段式 Esc 加视觉提示（× 变灰、"再按一次关闭"）。多一个状态、多一处要双语的文案，收益不抵成本。

顺带一条零交互变化的收尾项：`closePanel` 不销毁列表 DOM，用户名 / URL / 备注会以不可见状态留在 closed shadow root 里（页面 JS 取不到 closed root，也不含密码，敏感度低）。若要把边界收得更紧，在 `closePanel` 里加一句 `listEl.innerHTML = ''` 即可。

---

## 八、本报告未覆盖 / 待验证

1. **内联在超大库下的真实耗时**：内联是 `innerHTML` 全量重建 + 消息反序列化跑在宿主页面主线程，理论上有风险，但我**没有做真机测量**，只确认了触发条件（tier 4 无 URL 条目在任何档位都进列表）。P2 那条要求"先量再改"。
2. **IME 事件序列**：代码事实清楚（无保护 + 自动聚焦 + Enter 即填充），平台差异未实测。
3. **跨子域 chip 与内联引导的真机回归**仍未做过（沿用上一波次的记录：清单第 5/6/7 项与内联 chip 缺真机验证），本报告对这些路径的判断基于代码与既有单测（`tests/content/inlineFillDropdown.filter.test.ts`、`inlineFillDropdown.crossDomain.test.ts`）。
4. 评估当时为纯阅读分析：未运行测试、未构建、未改任何文件（除本 markdown）。**该条已被第九节推翻**——同日按推荐方案实施了 A / B / C / D / E（安全半）/ F / G，其余三项（超大库真机耗时、IME 平台差异、跨子域 chip 真机回归）仍未做。

---

## 九、实施记录（2026-09-22，同日）

按「A →（B 前置：拆内核）→ D → B → C+G → E 安全半 → F」的顺序落地，外部可观察行为中除**刻意拍板**的 C（默认选中首条）与 F（空态新增入口）外，其余全部保持不变。

### 9.1 各波次落点

| 波次           | 落点                                                                                                                                                                                                                                                                                                                                                     | 锚定测试                                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A 过滤内核收口 | 新增 `utils/keywordMatch.ts`：`keywordFieldsOf` 固定 username / tag / remark / url 四字段顺序，`normalizeSearchKeyword` 收口页面带来的关键词（非字符串即弃、先 trim 再截 64 字符），`filterByKeyword` 保序过滤、matcher 由调用方注入。`utils/passwordFilter.ts`、后台 `passwordCache.ts`、`InlineFillDropdown.ts` 三处改为共用它                         | `tests/utils/keywordMatch.test.ts`                                                                                                                                               |
| B 前置 拆内核  | `utils/searchMatchCore.ts`（零 Vue，持有拼音模块单例、就绪订阅与 `(text, keyword)` 记忆缓存）+ `utils/searchMatch.ts` 退为响应式外壳；`tests/architecture/vueFreeMatchKernel.test.ts` 递归展开内核 import 闭包，禁止 `vue` / `vue-i18n` 运行时导入                                                                                                       | 同左                                                                                                                                                                             |
| D IME 放行     | 内联面板 `handlePanelKeydown` 与侧边栏 `App.vue` 的 `handleKeydown` 在**任何按键分支之前** `if (e.isComposing) return;`                                                                                                                                                                                                                                  | `tests/architecture/imeKeyGuard.test.ts`（按"守卫位置"断言，不是按行为断言——真机输入法仍待验）                                                                                   |
| B 拼音进 SW    | `getMatchingAccounts(domain, port, keyword)` 在后台用无 Vue 内核做拼音过滤；内联侧 120ms 防抖后**先本地子串渲染**再等回包替换，回包受"序号过期 / 面板已关 / 关键词已改"三重丢弃保护，失败保留本地结果                                                                                                                                                    | `tests/background/passwordCache.test.ts`、`tests/content/inlineFillDropdown.serverFilter.test.ts`                                                                                |
| C+G            | 打开与每次筛选后 `activeIndex = 0`（空列表为 -1、回车空操作）；搜索框 `role="combobox"` + `aria-expanded/controls/autocomplete`，列表 `.aph-options` 为 `role="listbox"`、行 `role="option"`，高亮经 `aria-activedescendant` + `aria-selected` 同步；空态文案移到 `.aph-empty-slot`（listbox 之外）。DOM 结构改为"列表 + 空态槽"两块，视觉与滚动行为不变 | `tests/content/inlineFillDropdown.combobox.test.ts`、`tests/content/inlineFillDropdown.keyboard.test.ts`                                                                         |
| E 安全半       | 删掉 `MatchingAccountMeta` 里无人消费的 `title` 字段（后台曾为每条账号预拼「标签 / 网址 / 用户名」择优标题，多留一份可推导文本、每次下发白算），展示择优仍由前端各自做；`closePanel` 调 `clearRenderedAccounts()`：清空 `.aph-options`、空态槽与输入框 value，凭据元数据不再以 `display:none` 的文本留在 closed shadow root 里                           | `inlineFillDropdown.serverFilter.test.ts` 的"关闭面板即清空渲染"用例                                                                                                             |
| F 全库出口     | 新增消息 `OPEN_OPTIONS_AND_SEARCH`（`data.keyword` 可选）：后台经 `normalizeSearchKeyword` 收口后 `openOptionsAndSendMessage`，选项页 `applySearchKeyword` 写关键词并清掉「只看收藏」与标签筛选；空态第三颗按钮「到全部账号中搜索「关键词」」（关键词超 24 字符省略）                                                                                    | `tests/content/inlineFillDropdown.searchAll.test.ts`、`tests/composables/useRuntimeMessageHandler.searchKeyword.test.ts`、`tests/background/senderValidation.test.ts` 的收口分组 |

顺带修掉两个自查中发现的既有缺陷（都不改变正常路径行为）：`buildPanel` 重建面板时未回填 `searchKeyword`，切换语言会让输入框显示为空而过滤仍按旧词生效；`closePanel` 后页面 DOM 里仍留着上一批账号文本。

### 9.2 验证

- `pnpm test:run`：**119 个测试文件 / 1337 例全绿**（本波次新增 5 个测试文件 / 42 例，另有拼音命中与关键词收口的用例补进既有的 `passwordCache` 与 `senderValidation` 测试）。
- `pnpm typecheck`、`pnpm lint`（`--max-warnings 0`）、`pnpm lint:style`、`pnpm build`、`pnpm build:firefox` 全部通过。
- 打包产物复核（"内联零包体"与"SW 零 Vue"两条不变量）：`content-scripts/content.js` 220,656 B，**不含** pinyin-match 字典、不含 Vue 运行时；`background.js` 147,352 B，不含 Vue 运行时、不引用 131KB 的 `i18n-*.js` 共享 chunk，拼音字典因 IIFE 产物无法代码分割而随内核内联进去（SW 侧拼音可用，代价是 SW 体积）；侧边栏 / 管理页一侧仍只有 1.4KB 的响应式外壳进 `modulepreload` 闭包，拼音字典 `chunks/main-*.js`（28,155 B）依旧是搜到才动态加载——秒开首屏未受影响。
- 文档按 `docs/CWS_PUBLISHING_GUIDE.md`「其他同步约定」的 6 处表面 + 架构文档回灌：README / README.en、index.html（FAQS + JSON-LD，`pnpm gen:faq`）与 en.html（`pnpm gen:en`）、侧边栏 `help.json` 中英（改既有词条，未增条目故 `helpItems` 计数不动）、`CWS_FILL_CONTENT.md`（含十一修订记录与新的英文预算告警）、`utils/i18n-lite.ts`（`cs.inline.listboxLabel` / `cs.inline.searchAllHint` 中英）、ARCHITECTURE 中英第 17 节与检索口径；测试数量基线同步到 README、llms.txt 与 `docs/blog/**`（`pnpm gen:blog` 重生 12 个博客页），博客封面矢量源里的 `1292 项自动化测试` 一并改为 1337 并经 `pnpm covers:render 04 05`（sharp / libvips，无需浏览器）重栅格化两张 PNG，已目视复核新数字渲染正确。manifest 的 `extensionDescription`（`public/_locales/*/messages.json`，须与商店 132 字符摘要逐字一致，现为中文 131 / 英文 130）**未动**：那是 3.8.0 keyword-stuffing 驳回后定下的额度，本轮属既有能力的口径收紧而非新能力。

### 9.3 刻意未做 / 待拍板

1. **另两处 IME 同类入口**：`composables/useCommandPalette.ts` 的全局 `keydown`（合成态 Enter 会直接执行高亮命令）与 `entrypoints/content/LoginAutoSave.ts:322` 的 `handleKeyDown`（密码 / 文本框里为选候选词按 Enter 会触发凭证捕获）都**没有** `isComposing` 守卫。它们不在本次批准的范围内，属同一缺陷类，修法一致（早退放在最前面）——要不要一并修，等一句话。
2. **E 的另外半（favicon 来源去重）** 与**「本站无匹配但同主域还有条目」的 `crossDomainCount` 计算**未动，前者是独立优化、后者会改变引导出现的时机。
3. **未做真机验证**：超大库下内联的渲染耗时、不同平台输入法事件序列、以及上一波次遗留的跨子域 chip 真机回归。
4. 商店文案的**英文说明余量已从约 378 字符降到约 261 字符**（上限 16,000），下一次回填英文前须先删已有内容，详见 `docs/CWS_FILL_CONTENT.md` 十一修订记录。

### 9.4 评审追认（2026-09-24）：两处行为变化确认保留

四轴评审（规范 / 规格 / 安全 / 性能）复核本波次时点名了两处"改变了外部可观察行为"的改动，
均已由用户追认为**保留**。记在这里，避免后续评审再把它们当未决问题翻案。

1. **D 波次的 IME 组合态守卫**——内联面板 `handlePanelKeydown` 与侧边栏 `App.vue` 的 `handleKeydown`
   在任何按键分支之前 `if (e.isComposing) return;`。评审关注的是"这改了合成态按 Enter 的行为"，
   而结论是：**合成态的 Enter 属于选词，本就不该被当成确认填充**，那条行为是缺陷不是特性。
   守卫位置由 `tests/architecture/imeKeyGuard.test.ts` 按"必须早于任何按键分支"断言；
   真机上各平台输入法的真实事件序列仍未验证（§9.3 第 3 条继续有效）。
2. **`entrypoints/options/App.vue` 的 `openAddDialogWithActiveTab` 两次 `tabs.query` 并发**
   （属大 Vault 波次而非本波次，一并追认）。管理页自身即活动标签页，回退查询每次都会命中，
   串行等于把两次 IPC 延迟叠加到"点新增 → 弹窗出现"这条可感知路径上；并发后决策逻辑与单次语义不变，
   回退结果只在需要时被取用。代价是多一次无条件发起的 `query({})`，因此它单独 `.catch(() => [])`——
   否则一次回退查询失败会把本来可用的活动标签页 URL 连带降级成空预填。理由写在该函数 JSDoc。
