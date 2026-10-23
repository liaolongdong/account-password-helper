# feature-dev 分支深度代码评审与安全评审报告（2026-10-23）

- **评审日期**：2026-10-23
- **评审范围**：`main...feature-dev`（merge-base `cc13f01`，2026-10-14）——**219 个提交 / 393 文件 / +45,856 −2,381**；工作区仅 `.e2e-visual/` 未跟踪（并行会话产物），无未提交代码改动
- **增量重点**：上一轮评审（`CODE_REVIEW_2026-10-15_FEATURE_DEV.md`，33 提交）之后新增 **168 个提交**；其中 `43c424e` 之后的 **16 个提交（28 源文件、+1,120 −358）自 10-22 09:36 起未过 CI/E2E**，本轮已本地补齐验证（见「验证结果」）
- **排除项**：并行会话 `feat/localdev-env-binding`（`.aph-wt-localdev-scope`，停在 `f2c6ea0`）的代码不计入本轮评审
- **评审方式**：6 路领域子代理深读（站点匹配 / content 填充与选择器 / PII 与身份提示 / background 消息与会话 / 数据层与依赖 CI / Options UI 与 i18n）+ **全部 P0/P1 与关键 P2 由主代理回源验证（非转述）** + 自动化验证 + 同窗口配对真机计时
- **证据标记**：✅ = 主代理回源验证；◐ = 子代理给出行号证据、主代理未逐条复验

---

## 验证结果

| 检查项                     | 命令                                                                        | 结果                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型检查                   | `pnpm typecheck`                                                            | ✅ 通过                                                                                                                                        |
| Lint（`--max-warnings 0`） | `pnpm lint`                                                                 | ✅ 通过                                                                                                                                        |
| 样式检查                   | `pnpm lint:style`                                                           | ✅ 通过                                                                                                                                        |
| 单测全量                   | `pnpm test:run`                                                             | ✅ **274 文件 / 4,021 例全绿**（190.4s）                                                                                                       |
| 构建                       | `pnpm build`                                                                | ✅ 通过（`.output/chrome-mv3` 2.8 MB）                                                                                                         |
| i18n key 差集              | 自写脚本展平 `utils/i18n/locales/{zh-CN,en}` 比对                           | ✅ **zh 1,174 / en 1,174，双向差集为空**                                                                                                       |
| CI（HEAD 前 16 提交）      | `gh run list --branch feature-dev`                                          | ⚠️ 最新绿为 `43c424e`（10-22 09:36），其后 16 提交未跑；本轮以本地等价命令补齐                                                                 |
| E2E（139 条）              | 隔离 worktree 内跑覆盖未验证提交的 11 个 spec（44 条）                      | ⚠️ **39 绿 / 5 红**；单跑复核后 4 条为负载假红、**1 条为真实红灯（P1-4）**。主树 `.output` 被并行会话改写，任何主树 e2e 结论均不可信（见补记） |
| 侧边栏秒开配对复测         | `node benchmarks/measure-sidepanel-open.mjs`（HEAD→main→HEAD 同窗口 A/B/A） | ✅ 完成，读数见「性能专章」                                                                                                                    |

**上一轮 P1 复核（回归确认）**：

- ✅ `messageRouter.ts:959` 的 FILL_BY_ID catch 分支已改为 `showPageNotice(tabId, tl('bg.router.fillFailed'))`，异常原文不再进页面提示条；`tests/background/fillByIdFailureFeedback.test.ts` 转绿。
- ✅ `FormDetector.ts:2010-2049` 的 `fillMobileCode` 回执已改为跟随 `ackField`（`success = ackField !== null`、文案 `cs.fd.fillDone` / `cs.fd.fillIncomplete`），不再无条件谎报成功；`CONTEXT_MENU_FILL`（`:1491-1498`）也接上了 `pickFillAckKind(result.outcome)`。

---

## 变更概览（7 条主线）

1. **站点匹配与端口隔离**：`utils/domain.ts` +493 行，环回三写法折叠为同一主体、本地端点补回主机门、新增 `:*` 端口通配；列表排序改按「与当前站点的关联度」（`siteRankOf`），档位只管可见性；侧边栏新增端口芯片与空态引导。
2. **个人信息字段提示（PII）**：新增 `piiClassifier.ts`（1,778 行）+ `IdentityHint.ts`（619 行）+ `hintRoles.ts`，聚焦字段时浮出「这格要什么」的角色提示与到管理页取值深链，默认开启（`configManager.ts:231`）。
3. **个人信息库与回收站**：`identityTrashManager.ts`（387 行）、`trashRetention.ts`、`IdentityTrashDialog.vue`、`UndoDeleteToast.vue`；库上限 30→100。
4. **选择器录制**：`selectorPicker.ts`（499 行）+ `selectorPickerHandler.ts`，站点规则支持录制自定义选择器。
5. **Options 头部与命令面板**：工具条按「做事/配置/查找」重排、一键锁定、命令面板分组镜像头部（28 条命令）、⌘K、评价引导改弹窗且按「首次成功填充后 7 天」触发。
6. **数据层写结构**：rekey 覆盖域从 3 个扩到 5 个（含身份回收站）并新增步骤 10.5 快照复验；元数据写入改 1.5s 防抖批量落盘 + SW 侧就地修补。
7. **依赖与守卫**：vitest 4.1.12、`pnpm.overrides` 把 vite 钉到 `~8.2.4`；新增多条架构守卫与 26 个 e2e spec（143 条用例）。

---

## 🔴 P0（合并 main 前必须处理）

### P0-1【数据完整性｜✅】rekey 与并发元数据写：复验之后的整包回写会把全库打回旧钥密文，且无自愈路径

- 位置：`utils/storage/changeMasterPassword.ts:191-242`、`utils/storage/passwordCrud.ts:336-379`
- 机制：步骤 10.5 的快照复验是**点位检查**（读一次盘比对 `id:updateTime`），不是写锁。元数据 flush 是「`getAllPasswordsRaw()` 读整包 → 改一格 → `set` 写整包」（`passwordCrud.ts:349/369`），读到的仍是**旧钥密文**。只要它的读落在 rekey 步骤 11 之前、写落在其后，`PASSWORDS` 就整体回卷为旧钥密文，而同一次 `set` 里的校验哈希与会话密钥已是新钥。
- 后果：解锁能通过（校验哈希匹配新密码），但全库逐条解密失败；`changeMasterPassword` 步骤 4 单条解密失败即抛出（`:104-108`），用户也无法「再改一次密码」自救（旧密码过不了新校验哈希）。除事先导出过 `.aph` 备份外无恢复路径。
- 触发条件（如实标注概率）：2000 条库改主密码需数秒重加密，期间在另一窗口/侧边栏完成一次填充即可能命中；防抖 1.5s 反而让读-写窗口横跨重加密末尾。低频但后果不可逆。
- 与既有注释的关系：`isSnapshotStale` 的头注（`:191-197` 上方 JSDoc）已诚实写明「这套键只抓得到一部分并发写」，但它讨论的是**复验之前**的写入会被抹掉（丢一条收藏/一次恢复），**未覆盖复验之后的写入导致整库回卷**这一更坏方向。
- 修复方向（二选一，均不必改加密格式）：① 在 `storage.session` 放 rekey 世代号，`flushMetadataUpdates` 与所有整数组覆写在 `set` 前读一次世代、不匹配即放弃本次写；② 步骤 11 之后追加一次「盘上密文指纹」复核，不一致即回滚到 `reEncryptedPasswords` 重写。

---

## 🟠 P1（应本轮修复）

### P1-1【安全｜✅】站点规则选择器无元素类型收窄：密码被写成页面可读属性，且回执谎报「已填充」

- 位置：`entrypoints/content/FormDetector.ts:822-831`（`pick()` 只 `filter(isElementVisible)`，返回类型 `HTMLInputElement` 是 TS 断言而非运行时判定）→ `entrypoints/content/InputFiller.ts:134-137`（native setter 对非 input 抛错后走 `input.value = value`）→ `:46-65`（`verified` 判据就是 `input.value === value`）
- 复现：站点规则里把密码选择器写成 `#app` 或任意 `div` → 侧边栏填充 → 值成为该元素上的 JS 自有属性，宿主页面脚本 `document.querySelector('#app').value` 即可读到明文，同时回执胶囊显示「已填充 · 站点规则」。
- 说明：拾取器侧 `isPickableField` 有类型守卫，**缺的是消费侧**；`SiteRulesDialog.vue` 只校验选择器语法。触发需要用户自己写错规则，但产品承诺恰是「规则落点确定」。
- 修复：`pick()` 命中后加 `instanceof HTMLInputElement || instanceof HTMLTextAreaElement` 过滤，与拾取器同口径。

### P1-2【规范违背 + 主线程｜✅】DOM 属性未限长即进 PII 分类热路径

- 位置：`entrypoints/content/piiClassifier.ts:1265-1315`（`aria-label` / `title` / `placeholder` / `value` 原样取用，仅兄弟文本回退走 `withinLabelBudget`）；`:1251-1258`（`aria-labelledby` 先对**全部** refId 做 `getElementById` 再 `.slice(0, 3)`）
- 违背：`agents.md`「把网页 DOM…视为不可信输入：在边界处校验类型、**长度**、格式和来源」。
- 复现：控制台给任一 input 写 10 MB 的 `aria-label` 后聚焦 → 单次 `focusin` 触发 `squeeze` 全量拷贝 + 约 250 条模式在该串上 `includes`/正则扫描，主线程秒级阻塞；且该字段提示**默认开启**（`utils/storage/configManager.ts:231`），全站所有页面都走这条路径。
- 影响面：阻塞发生在该标签页自己的主线程（扩展 content script 与页面同线程），不构成跨站泄漏或提权，但会拖慢同页的填充/预热路径。
- 修复：`collectPiiSignals` 出口对 label/placeholder/value 统一 `slice(0, 256)`；`labelFromAssociation` 改为先 `slice(0, 3)` 再解析。

### P1-3【数据一致性｜✅】回收站与提醒表跨上下文 read-modify-write 无协调

- 位置：`utils/storage/identityTrashManager.ts:38-56`、`utils/storage/trashManager.ts:11-24`、`utils/storage/reminderManager.ts:107/140/176`
- 机制：单写队列只串行化**同一上下文**；两张管理页标签各持整数组快照时，后写者整包覆盖前写者——已彻底删除的 PII 可能复活（打掉 30 天清理承诺），`paused` 标记可能丢失（撤销删除后提醒永久沉默）。
- 与既有注释的关系：`identityTrashManager.ts:44-45` 已写明「跨上下文（Options / Background）仍需在写入前依赖 storage 事件与容量守卫，队列只解决同上下文交错」——即这是**已知边界**，但边界另一侧的协调目前没人做（`storage.onChanged` 只失效缓存，不做写前合并）。
- 与 P0-1 同源：都是「整数组覆写 + 无写前版本校验」。建议合并成一次改造（按 id 增量合并，或 `storage.session` 版本号做乐观并发），两条一起收。
- 复现限制（项目记忆已记录）：e2e 里侧边栏以标签页形态打开、`sender.tab` 有值会被 `isTrustedInternalSender` 拒掉，元数据 flush 在 e2e 中**不会落盘**，所以 P0-1 与本条都只能用「在真实 `flushMetadataUpdates` 上打桩 storage」的单测复现，不要指望 e2e 判红。

### P1-4【测试门禁｜✅】快捷键一览的 e2e 断言与新加的 ⌘K 行不一致，下一次 push 必红

- 位置：`e2e/utils.spec.ts:201-215`（硬编码 4 条 manifest 命令并 `await expect(items).toHaveCount(commands.length)`）vs `components/options/ShortcutSettingDialog.vue:13-41` 与 `:50-54`
- 根因：`ed67838` 给该弹窗加了第二组「应用内快捷键」（⌘K 命令面板），而第二组的 `<li>` **同样带 `class="shortcut-item"`** → `dialog.locator('.shortcut-item')` 数到 4 + 1 = 5，测试期望 4。
- 证据：隔离 worktree 内单跑复现（`1 failed (utils.spec.ts:193)`，同批另外 4 条单跑全绿 → 排除负载因素）；报错为 `Expected: 4 / Received: 5`。该 spec 在这 16 个提交里只改了菜单归属 key（`SECURITY_MENU`→`HELP_MENU`），没跟着改条数。
- 影响：这是「16 个提交未跑 CI」直接掩盖掉的真实红灯（`e2e.yml` 是 push/PR 门禁）。合并前必须修，否则 CI 必红。
- 修复方向：把定位器收到第一组 `.shortcut-list` 内（或按 `4 + IN_APP_SHORTCUTS.length` 断言，并逐条校验第二组不给「已生效/未生效」状态——那正是 `:43-46` 注释的承诺）。

### P1-5【流程｜✅】最新 16 个提交未经 CI/E2E

- `gh run list` 显示分支最新绿为 `43c424e`（10-22 09:36）；其后 16 个提交（端口隔离、匹配口径、头部工具条、命令面板、几何守卫）未跑过任何 workflow。
- 本轮已以本地全量单测/类型/lint/style/构建补齐（全绿），并在隔离 worktree 内跑了覆盖这 16 个提交的 11 个 spec 子集（44 条）：**39 绿 / 5 红，其中 4 条经单跑证明是负载假红，1 条即 P1-4 的真实红灯**。
- 结论：合并前仍需推一次让 CI/E2E 在 runner 上正式过一遍（本机 CfT 153 与 CI 的 Playwright Chromium 不是同一引擎，本机绿证明不了 CI 绿）。

---

## 🟡 P2

### 正确性与一致性

1. **【✅】空态端口提示计数不过关键词**：`entrypoints/sidepanel/App.vue:579-583` 用整库 `passwords.value` 计数，而文案 `utils/i18n/locales/zh-CN/sidepanel.json:17`「同域名其他端口还有 {count} 条账号，点击显示」出现在**关键词筛到空**的状态下。场景：`localhost:3000` 页、库里有 `:4000/:5173/:8080` 三条、关键词只命中其中 1 条 → 提示说 3、点开是 1。与 `docs/reports/SITE_MATCH_RULES_REFERENCE.md` 的口径承诺冲突。
2. **【✅】端口芯片判据重复全库扫描**：`App.vue:579-583` 与 `:594-597` 是同一表达式（后者少两个守卫），空态那一帧付两次 `countPortHiddenCandidates`。`portHiddenHintCount` 应直接由 `portHiddenTotal` 派生。
3. **【✅】拾取对旧版 content script 误判成功**：`entrypoints/background/selectorPickerHandler.ts:65-84` 只捕获 reject；MV3 下只要目标帧存在任意 `onMessage` 监听（升级后未刷新的旧 CS 必有），Promise 以 `undefined` resolve → 返回 `{success:true}` → 页面切到前台却没有覆盖层，用户干等 `SiteRulesDialog.vue` 的 120s 超时。修复：校验 `response?.success === true`。
4. **【✅】FILL_BY_ID / GET_INLINE_TOTP 未校验条目归属**：`entrypoints/background/messageRouter.ts:170-214` 只过 `isFrameFillable`，`data.id` 可为任意条目。子代理提出「与内联下拉 `innerHTML` 行渲染叠加成越权取明文链」——**该链不成立**：`InlineFillDropdown.ts:2196-2226` 的 `escapeHtml` 覆盖 `& < > " '`，`highlightHtml` 逐段转义后才包 `<mark>`，用户名/标签/备注/网址/favicon 全部经转义，未发现注入点。因此本条按**纵深防御缺口**保留（页面无法直接 `chrome.runtime.sendMessage` 本扩展，缺 `externally_connectable`）。
5. **【✅】拾取回包全上下文广播**：`messageRouter.ts:629-643` 用 `runtime.sendMessage` 回传，实际会送达所有标签页的 content script（选择器串 + 域名随之进入任意站点上下文），且后台不持有 requestId 签发态。改为定向 Options 标签页。
6. **【✅】`*.localhost` 与 127/8 其余地址不走本地端点口径（覆盖面问题，不是违背既定口径）**：`utils/domain.ts:271` 的 `LOOPBACK_HOSTS` 只列 `localhost / 127.0.0.1 / [::1] / ::1`，而 `matchesSiteEndpoint`（`:1141-1144`）只在 `isLoopbackHost && portScope === 'loose'` 时才走 `matchesPortForLocalDev`。因此 `api.localhost:4000` 这类**同机虚拟主机**（多项目本地开发的常见写法）在缺省 `loose` 档下按公网口径处理——不比端口，同主机其他端口的条目直接进列表并可填充；`127.0.0.2` 同理。
   - 这**不违背** 2026-10-20 拍定的四条端口口径：`loose` 下与功能引入前逐字一致（那时根本没有端口轴），`strict` 下这些主机照样走 `matchesPortScope` 收窄。
   - 但用户新开的「按端口隔离」恰好在最需要它的多项目 vhost 写法上不生效，且与 `localhost` 的行为不一致，容易被读成「隔离时灵时不灵」。
   - **⚠️ 修复需先确认**：把 `*.localhost` / 127/8 全段纳入环回判定会**收窄** `loose` 档下这些主机的可见集（从「不比端口」变成「比端口」），属用户可见行为变化，按 `agents.md`「必须暂停并询问确认」的口径应由使用者拍板，不宜作为缺陷顺手改。
   - 顺带确认：端口芯片计数与「其他端口」徽章同源于 `isHiddenByPortOnly`（`:1159-1168` 委托 `matchesSiteEndpoint`），不会出现「提示 3 条、点开 2 条」的判据分叉——但 P2-1 那条关键词问题仍在这条链之外。

### 性能与包体

7. **【✅】eager 首屏守卫只数文件、不核字节**：`tests/architecture/sidepanelClosure.test.ts:304` 的断言是 `length <= total`（`bases` 值是按基名计的文件数配额，非字节）。**同一 node_modules、同一工具链**下 HEAD vs main 配对构建实测：

   | 入口            | main（`cc13f01`）   | feature-dev（`8e8fffc`） | 差值                   |
   | --------------- | ------------------- | ------------------------ | ---------------------- |
   | sidepanel eager | 32 文件 / 280,246 B | 32 文件 / 290,109 B      | **+9,863 B (+3.5%)**   |
   | popup eager     | 43 文件 / 297,031 B | 43 文件 / 310,415 B      | **+13,384 B (+4.5%)**  |
   | options eager   | 88 文件 / 996,403 B | 90 文件 / 1,086,837 B    | **+90,434 B (+9.1%)**  |
   | content.js      | 234,447 B           | 302,495 B                | **+68,048 B (+29.0%)** |

   sidepanel/popup 文件数未变 → 守卫全绿而字节变厚。content.js 增幅最大且 `<all_urls>` + `all_frames:true` 意味着**每帧各付一次解析**，主因是 `piiClassifier.ts`（源码 80 KB）静态进入 content 单文件。建议：给守卫加一条字节预算（同基名 ±2%），并把 classifier 与词表改动态 `import()`。

8. **【✅】PII 分类抢在 SW 预热之前**：`entrypoints/content.ts:27` 先 `new FormDetector()`（构造 → `init()` → `FormDetector.ts:1001` 注册 document `focusin` 捕获监听），`:62-75` 的 `preWarmServiceWorker()` 监听注册更晚 → 每次聚焦先跑一遍分类再预热 SW，削弱「预唤醒消除冷启动」这一秒开机制。修复：把预热监听注册提前，或在 `handleIdentityHintOnFocus` 首行做 `identityHintEnabled` 之外的廉价早退。
9. **【◐】每次 SW 启动重放 actionIcon**：`backgroundServices.ts:691` + `actionIcon.ts:113-120` 在 0.5min 复活闹钟后每次启动都做一次 `isSessionValid` 存储读 + 4 档 `setIcon`，Windows 慢盘下与侧边栏首屏争抢 IO。
10. **【◐】Options 侧新增静态导入**：`composables/usePasswordManagement.ts:34` 静态引入 `trashManager`、`entrypoints/options/App.vue` 静态引入 `ActivationChecklist`，且清单卡片在 `markOptionsReady` 之后异步插入会造成表格下推（CLS）；Options 的 eager 集合没有 sidepanel 那样的守卫。

### 体验与规范

11. **【✅】`⌘K` 在未认证/引导态被静默吞掉**：`composables/useCommandPalette.ts:128-131` 先 `preventDefault()` 再 `toggle()`，而 `canOpen` 为假时 `open()` 直接 return（设计如此，见 `:25-26` 注释）→ 验证页/设置页/引导页按 ⌘K 既没面板也没反馈。建议 `canOpen` 为假时不拦截，或给一条说明性提示。
12. **【✅】清单首步两枚按钮净间距 20px**：`components/options/ActivationChecklist.vue:255-260` 写了 `gap: 8px` 却没接管 EP 的 `.el-button + .el-button { margin-left: 12px }`（`:67-75` v-for 渲染两颗）——与项目既有「写了容器 gap 就必须接管 EP 相邻边距」的口径相悖；`dialogFooterDensityWiring.test.ts` 只覆盖弹窗 footer，未覆盖本组件。
13. **【◐】动效令牌收口只做了一半**：`ActivationChecklist.vue:210`（`width 0.25s`）、`HeaderBar.vue:673/774/790/810/845`（`all 0.2s`）、`CommandPalette.vue:265`（`0.12s`）、`UndoDeleteToast.vue:249`（`0.18s`）绕开 `assets/theme/tokens.css` 的三档令牌，而同轮的 `PasswordTable.vue`/`PasswordListItem.vue` 已改用 `--aph-duration-*`。
14. **【◐】删除回执读屏大概率不播报**：`components/options/UndoDeleteToast.vue:2-13` 把 `role="status" aria-live="polite"` 挂在 `<Transition>` 内的 `v-if` 根节点上，live region 与文本同帧插入，AT 通常不念。建议外层常驻空容器。
15. **【◐】EN 头部按钮违反 WCAG 2.5.3**：`HeaderBar.vue:285-296` 无障碍名含 `Open the command palette`，可见文字 `Commands` 不是其子串（中文侧成立），而 `:452-453` 注释断言已满足。
16. **【◐】回收站空态把唯一「关闭」推到左侧**：`IdentityTrashDialog.vue:148-161` + `:404-408` 的 `space-between` 在「清空回收站」被 `v-if` 摘掉后左偏（`TrashDialog.vue:130-143` 同病），与其他弹窗右对齐 footer 不一致。
17. **【◐】「立即锁定」一套动作三副措辞**：`HeaderBar.vue:53`「立即锁定」→ 确认框「确认清除会话」→ toast「主密码会话已清除」。
18. **【◐】回收站剩余天数在 30.0～30.99 天区间显示「剩余 0 天」但条目仍可恢复**：`utils/storage/trashRetention.ts:52/70`，读数与行为差一天。
19. **【◐】文档双语同错**：`docs/ARCHITECTURE.md:667` 与 `.en.md:492` 仍称评价引导是「主内容区卡片」，本轮已改 `el-dialog`。
20. **【✅】`.e2e-visual/` 未纳入忽略**：`e2e/domain-match-radio-alignment.spec.ts:78` 与 `e2e/identity-vault-selectbar-density.spec.ts:123` 把截图写进 `.e2e-visual/`，而 `.gitignore` 无该条目（`git check-ignore -v .e2e-visual` 无输出；同类的 `test-results/` 已在 `.gitignore:135`）。评审中该目录曾以 2.9 MB 未跟踪状态出现在 `git status`，之后被并行会话清掉——**只要跑一次 e2e 它就会再回来**，与 `docs/README.md` 的「本地产物」口径不一致。抽查截图内容为合成夹具，无真实凭据。

---

## 🟢 P3（择机）

- **【✅】** 根 `node_modules/vite` 是 4 月遗留的 7.1.7 实体目录（非符号链接）；`pnpm-lock.yaml` 与 `pnpm why vite` 全量为 8.2.4，且全仓无 `import ... from 'vite'`，故当前无害——但它是「override 已生效」的错觉来源，建议清一次 `node_modules` 重装。
- **【✅】** `pnpm.overrides` 用 `~8.2.4` 钉 vite：8.2.x 补丁仍可流入，但 8.3+ 被挡住；提交信息声称「消掉 3 条 Dependabot 告警」，需在下个 vite 安全公告时人工复核。
- **【◐】** `utils/domain.ts:242` 未剥根点：`getMainDomain('paypal.com.')` 与 `('a.evil.com.')` 同返回 `'com.'`，`sameMainDomain` 档下 `a.evil.com.` 会命中 `paypal.com.`（尾点主机在真实页面极罕见，且需用户自己录入带尾点的条目）。
- **【◐】** `SITE_MATCH_RULES_REFERENCE.md:125` 声称条目 `::1:3000` → tier 0，实测 `normalizeToHostname('::1:3000')` 走回退支（`domain.ts:497`）恒不匹配；§12 行号已漂（`parsePagePortContext` 实为 `:872`）。
- **【◐】** `public/icon/locked/96.png`（1,496 B）未被 `actionIcon.ts:30-38` 引用，属包内死重。
- **【◐】** `benchmarks/sidepanel-p0.bench.ts:282-294` 仍复刻旧的 `domainPriorityOf`，未跟进生产侧的 `siteRankOf` → 新排序成本不可证伪；`@ sameMainDomain` 用例因早退测出 4.17M ops/s，读数无信息量。
- **【◐】** 新增 e2e（`port-isolation.spec.ts` / `local-dev-site-scope.spec.ts`）夹具仅 3 条，侧边栏侧仍无自动判红的秒开阈值断言（只有需真机有量的 `measure-sidepanel-open.mjs`）。
- **【◐】** `MAX_IDENTITIES` 30→100 会让旧版本解析新备份按条数上限直接拒绝，降级/换回旧版时 `.aphid` 恢复会失败，建议在发布说明标注。
- **【◐】** `CommandPalette.vue:84-89` 空态 `div` 落在 `role="listbox"` 内（合法子元素只有 option/group）。

---

## 既有风险（非本轮引入，但落在本轮重写的模块内）

1. **【✅】多租户公共后缀塌缩 → 同主域 iframe 门控会放行跨租户帧**：`utils/domain.ts:337-345` 的 `isSameMainDomain` 依赖 `registrableScope`，普通域名取末两段，故 `evil-store.myshopify.com` 与 `real-store.myshopify.com` 主域同为 `myshopify.com`；`utils/frameFill.ts:37` 正是用它决定「哪些 frame 可接收明文」。同类会塌缩的还有 `r2.dev`、`squarespace.com`、`readthedocs.io`、`is-a.dev`、`000webhostapp.com` 等。**与 `main` 逐字相同**（`git diff main...HEAD -- utils/frameFill.ts` 为空，`isSameMainDomain` 与 `registrableScope` 均未改动），因此不属本轮回归；但本轮新增的 `SITE_MATCH_RULES_REFERENCE.md` 把 `isSameMainDomain` 写成安全边界，会让读者误以为它后缀感知。建议补共享托管后缀表并在表注写清「漏收 = 默认放宽」。
2. **【✅】2000 条大库侧边栏 >1 s 为旧账**：`main` 基线同样复现（见性能专章），`docs/reports/GUIDE_ONBOARDING_VAULT_SORT_DESIGN.md:231` 自 10-01 起已如实记录为未达标、不放宽阈值。

---

## 性能专章：侧边栏秒开与 2000 条列表

### 方法

同一串行窗口内按 **HEAD → main → HEAD** 顺序 A/B/A 跑 `benchmarks/measure-sidepanel-open.mjs`（有头 Chrome for Testing、真实停靠面板、三样本、`--rows 2000 --mid-rows 200`），两次构建共用同一 `node_modules`（工具链一致，差值只归因源码）。`fcpUnder1000ms` 的口径是**每个有效样本都 <1 s**（脚本 `:1021`），不是中位数。

### 读数（FCP 中位 / 列表铺满中位，单位 ms）

| 场景                | HEAD-a      | main        | HEAD-b    | 判读                                   |
| ------------------- | ----------- | ----------- | --------- | -------------------------------------- |
| s1 会话有效（空库） | 424 / 457   | 444 / 462   | 256 / 241 | 三批全部 <1 s，无差异                  |
| s7 中规模库（200）  | 2640 / 1213 | 380 / 376   | 348 / 372 | HEAD-b 与 main 同量级；HEAD-a 整批异常 |
| s6 大库（2000）     | 2036 / 1306 | 2004 / 1042 | 936 / 575 | 三批互相穿插，无稳定差                 |

### 结论

1. **未发现本分支引入的秒开回归。** main 的读数始终落在两批 HEAD 之间，s1 三批 241–462 ms 全部达标。
2. **量具噪声地板很大，必须如实标注**：同一份 HEAD 字节在 s7 上测出 2,640 ms 与 348 ms 两批中位数（单样本跨度 1,340–2,720 ms）。评审期间存在并行会话的 e2e 浏览器进程（`ps` 实测到 `.aph-wt-localdev-scope` 的 `--load-extension` 实例）争抢 CPU，且本机 load 长期 10+。**因此本组数据只能排除「百毫秒级以上的大回归」，不能排除 100–300 ms 量级的劣化**；结合 eager 字节 +3.5%（sidepanel）这一确定性证据，小量级变厚是可能存在的。
3. **2000 条（以及 200 条的坏批次）确实会越过 1 s 线**，但这是 main 也复现的既有成本，归属数据层（全库解密 + 整包 IO）与每页 100 行渲染，与 `AGENTS.md` 的既有判断一致；本轮没有让它变坏，也没有修好它。
4. **渲染窗口与三路竞速未被本轮改动破坏**（◐ 子代理核对：`useSidepanelData` 仅端口上下文派生化并带 `isSamePagePort` 同值守卫、`void loadSitePolicy()` 不阻塞首屏、`v-memo` 依赖新增 `isPortMismatch` 但空集常量化、站点策略变更只复位 SW 镜像不进缓存失效键）。
5. **`sidePanel.open()` 前无新增 `await`**（◐ 子代理核对 `messageRouter.ts:454-511` 同步分支未变、`sidePanelManager.ts` 本轮零 diff、tabId 仍走 `getTabIdSync`、快捷键与点击/悬浮/右键路径等价）。
6. **2000 条列表的卡顿风险点**集中在两处新增热路径重复解析：P2-1/P2-2 的端口计数（空态两次全库扫描）与 P2-7/P2-8 的包体与监听顺序；`utils/domain.ts` 的当前主机归一一格记忆、`MAIN_DOMAIN_CACHE_MAX = 4000`（= 条目上限 × 2）、`sortPasswordEntries` 的优先级预计算（避免 O(N log N) 内重复解析）三处已有的性能卫生措施经复核有效（✅ `domain.ts:530-558/620-640`、`passwordSort.ts:99-130`）。

---

## 建议处理顺序

1. P1-4（快捷键一览 e2e 条数断言）→ 一行定位器改动，**合并前必修**，否则下一次 push 的 E2E 门禁必红。
2. P0-1（rekey 世代号或写后复核）→ 配一条「复验之后落盘」的回归用例（现有 `tests/utils/changeMasterPasswordConcurrentWrite.test.ts` 只覆盖复验能抓到的那一半）；注意这条不能用 e2e 复现（项目记忆：e2e 里侧边栏是标签页形态，元数据 flush 不落盘）。
3. P1-1（`pick()` 类型守卫）、P1-2（DOM 输入限长）→ 都是一行级收口，且各自能被一条新用例钉住。
4. P2-1/P2-2（端口计数派生 + 过关键词）、P2-3（拾取响应判定）→ 与本轮新功能直接相关，用户可感知。
5. P2-7（eager 守卫加字节预算）+ P2-8（预热监听提前）→ 把「秒开不退化」变成可判定的守卫，而不是靠人工复测。
6. P1-3、P1-5 与其余 P2/P3 按上表分派；既有风险 1 建议单独立项（补共享托管后缀表）。P2-6 的环回判定扩张属用户可见行为变化，动手前先确认。

---

## 未验证项与限制

- **Windows 慢磁盘 / 杀软扫描路径**本机无法验证；`sidePanel.open()` 浏览器 UI 侧那一段延迟仍不在量具覆盖内（量具走内容脚本触发路径）。
- **本地 e2e 只能给出「仅本机」结论**：本机 Chrome for Testing 153 与 CI 的 Playwright Chromium 不是同一引擎（项目记忆已记录字体度量与滚轮链两类差异），且评审期间主树 `.output` 被并行会话改写。P1-4 那条真实红灯需要下一次 push 由 CI 复认；4 条假红同理不能当成「CI 也会红」。
- **配对复测受并行会话与本机 load 干扰**，只采信「排除大回归」这一条结论；若需要百毫秒级判定，请在空闲机器上关掉其他会话重跑 A/B/A。
- 标注 ◐ 的条目由子代理给出文件:行号证据，主代理未逐条回源；采信其定位，但据此动手前请再核一次当前代码。
- 未跑 `pnpm build:firefox`、`pnpm analyze`、`pnpm format:check` 全仓（本轮未改 manifest/权限，构建已按 Chrome 口径验证）。

## 补记：本地 E2E 的真实状态

| 尝试                    | 命令                                                                          | 结果                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1（评审者失误）         | `E2E_SKIP_BUILD=1 pnpm test:e2e`（未设 `E2E_EXECUTABLE_PATH`）                | 5 条 `backup-restore` 全红、各约 32 s。根因是项目已知坑：品牌版 Google Chrome ≥135 **忽略 `--load-extension`** → 扩展 SW 从未注册，不是代码缺陷                                                                                                                                                                                                             |
| 2（正确通道）           | `E2E_EXECUTABLE_PATH=<Chrome for Testing 153> E2E_SKIP_BUILD=1 pnpm test:e2e` | 前 13 条：**11 ✓ / 2 ✘**，两条失败全在 `e2e/cross-subdomain.spec.ts:94/:107`（1.4 min / 2.4 min）；因本机负载（Qoder 自身 + 并行会话 + 50 个 Chrome 进程）导致单条约 40 s，全量需 ~90 min，中途改单文件复跑。对照：这两条在 CI 上于 `43c424e`（10-22）分别用 **18.3 s / 19.4 s** 通过（`gh run view 39756718956 --log`），且该 spec 自 `43c424e` 后未被改动 |
| 3（单文件复跑，主树）   | `pnpm exec playwright test e2e/cross-subdomain.spec.ts`                       | 3 条全红，报错是 harness 级 **「面板首屏没等到站点域名 uat.cross-subdomain.e2e.test」**（不是断言不符）→ 说明加载的产物根本不是 HEAD                                                                                                                                                                                                                        |
| 4（隔离 worktree 复跑） | 在 `.aph-wt-review-head`（`8e8fffc` 自建产物）内跑同一 spec                   | ✅ **3 passed (2.3 min)**                                                                                                                                                                                                                                                                                                                                   |

**假红的根因（已定位，非代码缺陷）**：主树的 `.output/chrome-mv3` 在评审期间被并行会话反复重建——实测 14:33 之后该目录被改写，入口 chunk 由 `sidepanel-DtSysXo9.js` 变成 `sidepanel-BCHpV1QG.js`、sidepanel eager 由 290,109 B 变 299,693 B、content.js 由 302,495 B 变 303,367 B。`e2e/global-setup.ts:16` 把产物路径**硬编码**为 `<repoRoot>/.output/chrome-mv3`，因此主树里任何一次 e2e 跑的都是「当时谁最后构建就是谁的包」。

**因此得到一条对本仓所有真机验证都成立的纪律**：并行会话存在时，e2e 与 `benchmarks/measure-sidepanel-open.mjs` 必须在独立 worktree 内跑（建 `.aph-wt-*` + 软链 `node_modules` + 各自 `.output`），否则红绿无意义。本轮的配对计时（14:12/14:15/14:16 三批）早于 14:33 的改写，且所用产物与隔离 worktree 重建结果**逐字节一致**（sidepanel 290,109 B / popup 310,415 B / options 1,086,837 B / content.js 302,495 B），故计时与包体读数不受此污染影响。

**已知抖动与形态限制（判红绿前先对照，来自项目记忆）**：`dialog-scroll-isolation.spec.ts:274` 本机常翻红（CI 绿）；e2e 里侧边栏是标签页形态 → `sender.tab` 有值被 `isTrustedInternalSender` 拒 → 元数据 flush 不落盘；CDP 按键触发不了浏览器级 `chrome.commands`；首装会自开 `options.html` 干扰「新标签页」类断言。

- 覆盖那 16 个未验证提交的 spec 子集（`command-palette` / `domain-match-radio-alignment` / `identity-hint` / `identity-lookup-from-detail` / `identity-vault-card-toggle` / `identity-vault-selectbar-density` / `local-dev-site-scope` / `local-env-binding` / `site-filter` / `utils` / `port-isolation`，共 11 个文件）在隔离 worktree 内：**39 passed / 5 failed（17.5 min）**。
- 5 条失败逐条单跑复核（同 worktree、无并发负载，1.2 min）：`identity-hint.spec.ts:101`、`local-dev-site-scope.spec.ts:49`、`local-dev-site-scope.spec.ts:118`、`port-isolation.spec.ts:168` **4 条转绿**（批次内报错全是「面板首屏没等到站点域名 / header 未出现 / 点击 20 s 超时」这类渲染等待，非断言不符）→ 判为负载假红；`utils.spec.ts:193` **稳定复现**（`Expected: 4 / Received: 5`）→ 即 **P1-4**。
