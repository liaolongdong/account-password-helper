# 深度代码评审与安全评审 · feature-dev @ ec7117b（2026-11-02）

## 0. 范围与基线

- 评审范围：`main...HEAD`（merge-base `e75f25d`，30 个提交，231 文件 / +4873 −715；其中源码 33 文件 / +1161 −189）。
- 工作区另有并行任务未提交的改动（44 改 + 4 新文件），**不在本次评审范围**。所有行号引自已提交态的干净副本 worktree。
- 覆盖提交：v3.19.0 / v3.20.0 两次发布、身份库右键召唤与一键回到原网页（8ef2ab9）、写入串行化与同 id 回卷（397ed1c）、回收站与身份库整包写跨上下文锁（077e6f2）、备份轻提醒修复（fcfefea）、FormDetector 观察器下沉判定（1c1cf51）、引导「留退路」步登记恢复密钥（d88fcc4）、商店文案与截图、外部站点文档与运营口径修订。

### 门禁取证（均在已提交态执行）

| 门禁                   | 结果                                        | 备注                                                                                                                               |
| ---------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`       | exit 0                                      | **须先 `pnpm exec wxt prepare`**；否则 41 个 `#imports` / `ElMessage` / `import.meta.env.BROWSER` 报错全是缺失生成物，不是代码缺陷 |
| `pnpm lint`            | exit 0                                      | `--max-warnings 0`                                                                                                                 |
| `pnpm lint:style`      | exit 0                                      | recess-order 属性排序通过                                                                                                          |
| `pnpm test:run`        | exit 0，321 文件 / 4652 passed / 10 skipped | 128.96s                                                                                                                            |
| `pnpm build`           | exit 0，2.62 MB / zip 916.6 kB              | Firefox 未跑                                                                                                                       |
| e2e / Options 首屏实测 | **未执行**                                  | 本机 `top -l 2` load 6.1、idle 57%，按 agents.md「跨批次绝对值不采信」的口径不开跑，避免假红与污染                                 |

**门禁全绿，但下列 6 条 Major 全部真实存在。** 四条有明确的「门禁为什么看不见」解释，集中在本次新引入的判据盲区（§4）。

---

## 1. 问题清单

### S1 · Blocker｜会话过期广播不再清空已输入的主密码，明文留在输入框

- 位置：[composables/useAuthFlow.ts:346,365-368](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/composables/useAuthFlow.ts#L365)（`handleSessionExpired`）、[components/options/PasswordVerifyView.vue:372-388](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/components/options/PasswordVerifyView.vue#L372)、[entrypoints/options/App.vue:42](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/entrypoints/options/App.vue#L42)
- 证据：本次把 `.then()` 里那条**无条件**的 `verifyForm.value.password = ''` 删掉，换成同步的条件清空 `if (!wasVerifyVisible) verifyForm.value.password = ''`；同一次提交把子组件的 deep watch 拆成分字段 watch（[PasswordVerifyView.vue:372-376](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/components/options/PasswordVerifyView.vue#L372)），并由 `watch(formModel) → emit('update:verifyForm')` + App.vue `Object.assign(verifyForm, $event)` 双向同步。
- 后果：用户已停在解锁页并输入口令时收到锁定/过期广播（`wasVerifyVisible === true`）→ 父级不清空 → 子组件 watch 也收不到变化 → 主密码**继续显示在输入框里**，并同时驻留两级响应式状态。`handleSessionExpired` 是会话**终止**事件，不是重复 `checkAuth`，与那两处保留输入的 UX 修复不同源。
- 违反：agents.md「不扩大明文数据的存活时间……并在锁定、过期和异常路径中执行既有清理逻辑」。
- 修法：`handleSessionExpired` 恢复无条件清空 `verifyForm.value.password`；`wasVerifyVisible` 那套只留在 `checkAuth` 的两个分支（[:217](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/composables/useAuthFlow.ts#L217)、[:243](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/composables/useAuthFlow.ts#L243)，那里「重复 checkAuth 不抹掉用户输入」是合理修复，应保留）。补断言：`tests/composables/useAuthFlow.*` 增加「解锁页已输入口令 → 收到过期广播 → 输入框与 `verifyForm.password` 同时为空」。
- 现状：工作区并行改动**未修**（该行仍在）。

### S2 · Major｜新增排队独占租约把回收站写入切成半提交，被彻底删除条目的历史密文永久残留

- 位置：[utils/storage/vaultWriteLock.ts:63-65](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/vaultWriteLock.ts#L63)（新增 `withVaultKeyTransitionQueued`，刻意不带 `ifAvailable`）、[utils/storage/masterPassword.ts:245,261](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/masterPassword.ts#L245)、[utils/storage/trashManager.ts:22](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/trashManager.ts#L22) → [:212](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/trashManager.ts#L212) / [:234](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/trashManager.ts#L234) / [:277](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/trashManager.ts#L277) → [utils/storage/passwordHistory.ts:131](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/passwordHistory.ts#L131)
- 链条：`enqueueTrashMutation` 的 `run = () => withVaultMutation(() => withVaultCommit(task))` 全程持 shared 租约；任务内在 `writeTrash(remainingTrash)` **之后**调公开的 `deleteHistoryByEntryIds`，它自己又取一次 `withVaultMutation`。`withVaultMutation` 用 `ifAvailable: true`（[vaultWriteLock.ts:40](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/vaultWriteLock.ts#L40)），而 Web Locks 的写者优先使**排队中的独占**会挡住新的 shared 请求 → 嵌套那次当场 `VAULT_BUSY`。
- 为什么现在才成立：嵌套在 main 上就有，但改动前所有独占都带 `ifAvailable`，永不排队，嵌套 shared 必即判即得。本次把 `resetMasterPassword` / `clearAllData` 换成排队独占，第一次让「parked exclusive」成为可达状态。
- 后果：条目**已离开回收站**而历史清理没跑 → 被彻底删除条目的旧口令密文留在 `PASSWORD_HISTORY`，再无人回收；`cleanExpiredTrashInternal` 的 `catch` 只记日志并 `return`，下一轮 `expired.length === 0` 直接退出，等于静默放弃。`permanentDeleteFromTrash` / `emptyTrash` 则是**已删成功却回「彻底删除失败」**。
- 触发条件（诚实交代）：需要重置/清空数据与回收站写入并发（例如用户在另一页点重置，同时 SW 闹钟 `cleanExpiredTrash` 在跑）。窗口窄，但后果不可逆且面向隐私。
- 修法：照本 diff 已给身份域做过的正解处理——[utils/storage/identityCrud.ts:386](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/identityCrud.ts#L386) 改调 `replaceAllIdentityRawInternal`。回收站同理：在**已持有的租约内**直接调 `deleteHistoryByEntryIdsInternal`（[passwordHistory.ts:134](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/passwordHistory.ts#L134) 已存在）；并把历史清理移到 `writeTrash` 之前，或失败时不摘回收站条目、留待下次重试。同族待查：[utils/storage/recovery.ts:53,67,104](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/recovery.ts#L53)、`utils/storage/autoSaveManager.ts`（这两处失败即拒，属可接受失败，但应同批收掉）。
- 现状：工作区并行改动**未修**。

### F1 · Major｜FormDetector 去抖可被无关抖动无限推后（本次性能提交顺带引入的功能面倒退）

- 位置：[entrypoints/content/FormDetector.ts:399-403](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/entrypoints/content/FormDetector.ts#L399)、[:424-432](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/entrypoints/content/FormDetector.ts#L424)、[:471-477](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/entrypoints/content/FormDetector.ts#L471)
- 证据：改造前 `shouldRedetect` 只在记录**读到登录相关文本**时才置真，只有那时才排去抖计时器；改造后**任意** `attributes` 记录、**任意**新增 `button`/`[role=button]` 都置 `hasMutationSignal = true`，而 `scheduleMutationDetection()` 每次都 `clearTimeout` + 重排 `shortDelayTime`（500ms）。
- 后果：轮播 / 骨架屏 / 虚拟列表等持续抖 `class`/`style` 的页面，去抖一路被无关变更推后，`runMutationDetection` 可长期不执行。且 `pendingMutationForceDetect`（新出现密码框这条**必然**要重扫的路径）排在同一个去抖后面，也一起被饿着——比改造前更差。聚焦新框不触发 `detectForms`（`focusin` 不调它），只有右键/快捷键路径被动补检。
- 修法：只在「本轮真的登记了新候选或 forceDetect」时重置计时器；或记 `firstPendingAt`，超过上界（如 2s）强制执行一次，把纯 debounce 改成 debounce + maxWait。

### F2 · Major｜文本候选溢出丢最新，且两份 JSDoc 互相矛盾

- 位置：[entrypoints/content/FormDetector.ts:461-464](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/entrypoints/content/FormDetector.ts#L461)（`if (bucket.size >= MUTATION_TEXT_TARGET_CAP) return;`，上限 32）、[:453-460](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/entrypoints/content/FormDetector.ts#L453)（写「超出上限即丢弃后续候选」）、[:479-484](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/entrypoints/content/FormDetector.ts#L479)（写「溢出时不再逐个读文本、**直接重检测**」）
- 后果：实现里既无溢出标志也不重检。集合只在到期任务里清空，与 F1 叠加后饥饿期恒钉在 32 个陈旧节点，此后真正含「密码登录」的元素被永久丢弃 → 漏检。上限本身是有意的（防持有 DOM 引用与判定次数无界），方向没错，缺的是溢出时的兜底触发。
- 修法：溢出走 FIFO 淘汰最旧（`bucket.delete(bucket.values().next().value)`）保留最新，或按 `:479` 的原意置 `overflow` 标志并直接 `detectForms()`；二选一后把另一处注释改成同一口径。

### P1 · Major｜提交锁跨库共用一把，身份域把 PBKDF2 派生与逐条加密整段放进临界区

- 位置：[utils/storage/vaultWriteLock.ts:19](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/vaultWriteLock.ts#L19)、[:72-74](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/vaultWriteLock.ts#L72)（`aph-vault-commit` 全局唯一 exclusive）；[utils/storage/identityCrud.ts:169](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/identityCrud.ts#L169)、[:223](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/identityCrud.ts#L223)、[:360](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/identityCrud.ts#L360) → [:367-386](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/identityCrud.ts#L367)；对照 [utils/storage/passwordCrud.ts:104-113](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/passwordCrud.ts#L104)
- 证据：`resolveDataKey(masterPassword, true)` 在锁内做 `verifyMasterPassword` + `deriveEncryptionKey`（两次 600k 迭代 PBKDF2），`replaceAllIdentityInternal` 在锁内 `for` 循环逐条 `encryptData`（≤100 条）。密码域刻意相反：`commitPasswordRows` 锁内只有「重读 → 合并 → 单次 set」。
- 后果：锁定态保存一条身份即独占全局提交锁约 1 秒量级（Windows 慢盘更久），期间 SW / Options / 侧边栏 / Popup 对**密码库**的整包写全部无声排队——两库键位（`IDENTITY_*` vs `PASSWORDS`）互不冲突，却被同一把锁串起。`navigator.locks` 等待无超时，用户只看到保存转圈、没有失败反馈。
- 与 2000 条上限的关系（回答本次提问）：2000 条的卡顿大头在数据层（全库解密 + 整包 IO），本次**未新增**全库解密路径，`commitPasswordRows` 在 main 上本就写前重读整包，读/写次数未变；风险不是渲染卡顿，而是**跨库写锁交叉阻塞**。侧边栏秒开的读路径不受影响（见 §3）。
- 修法：解密 / 派生 / 加密移到锁外，锁内只做 `getAllIdentityRaw` → 合并 → `set`（沿用密码域口径）；或按数据域拆 `aph-vault-commit-password` / `aph-vault-commit-identity`；并给 `withVaultCommit` 加有界等待 + 超时用户反馈。

### U1 · Major｜减弱动效档撤销按钮上浮的两条覆写是死规则（源序被后来者压过）

- 位置：[entrypoints/options/styles.css:80-83](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/entrypoints/options/styles.css#L80)（`transform: none`）被同文件 [:157-162](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/entrypoints/options/styles.css#L157) 与 [:190-192](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/entrypoints/options/styles.css#L190)（`transform: translateY(-1px)`）压过
- 证据：两条选择器**字面完全相同**，媒体查询不增加特异性 → 同特异性源序后者胜。减弱档用户 hover 按钮仍然上浮。
- 三层验证全部漏过（详见 §4）：守卫只做存在性判断、stylelint 不管层叠顺序、e2e 减动效用例只量横幅壳。而本次还删掉了 `styles.css` 在 `INTERACTION_EXCEPTIONS` 的豁免登记（[tests/architecture/reducedMotionCoverage.test.ts:104-107](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/tests/architecture/reducedMotionCoverage.test.ts#L104)），删除理由正建立在「这条已生效」这个不成立的前提上。
- 修法：把两条覆写移到 `:190` 之后（文件末尾），或提高特异性；`RETURN_PULSE_MS` 之类既有锚点不动。
- 现状：工作区并行改动**未修**（`@media` 仍在 68 行、`transform: none` 仍在 82 行）。

### 7 · Minor｜`loadActivationState` 无 finally，抛出即本次会话备份轻提醒永久不出声

- [entrypoints/options/App.vue:1388-1393](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/entrypoints/options/App.vue#L1388)，`:2187` 以 `void` 调用（异常被吞），而它是 `backupNudgeInputsReady`（[:1347](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/entrypoints/options/App.vue#L1347)）三路输入之一。这是 fcfefea 那次修复唯一能把自己「修死」的路径。修法：`try { … } finally { activationStateReady.value = true; }`。

### 8 · Minor｜管理页未认证态静默丢弃右键指令

- [composables/useRuntimeMessageHandler.ts:138-140](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/composables/useRuntimeMessageHandler.ts#L138)：`waitForPasswords().then(() => { if (!isAuthenticated.value) return; ... })`，后台已判定会话有效并回 `success: true`，管理页仍处未认证 / `checkAuth` 未完成态时直接吞掉，且该 Promise 无 `catch`。用户点了右键「什么都没发生」，而 8ef2ab9 把这条既有缝隙的暴露面显著放大。修法：失败分支给一次可理解提示，复用既有 `notifyContextMenuFailure` 口径。

### 9 · Minor｜`aria-controls` 指向折叠态不存在的节点

- [components/options/PasswordVerifyView.vue:86-97](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/components/options/PasswordVerifyView.vue#L86)：`id="verify-hint-text"` 挂在 `v-if="!hintCollapsed"` 的 span 上，按钮的 `aria-controls` 是静态的 → 折叠态指向缺失 id，axe `aria-valid-attr-value` 判违规。修法：span 改 `v-show`，或条件绑定 `:aria-controls="hintCollapsed ? undefined : 'verify-hint-text'"`。

### 10 · Minor｜注释与实现相反 + 元数据打标位置前移

- [utils/storage/passwordCrud.ts:98-100](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/passwordCrud.ts#L98) 仍写「`flushMetadataUpdates` ……不套用本函数」，而 [:499](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/passwordCrud.ts#L499) 已改成正好调用 `commitPasswordRows`。这段注释是给下一个改这把锁的人看的。
- [:497](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/passwordCrud.ts#L497) 的 `METADATA_FLUSH_AT` 打标被提到取提交锁**之前**，`consumeMetadataFlushMarker` 消费即删且带 3s TTL → 无关变更可在真正 flush 前吃掉标记，元数据落盘退化为一次全量缓存失效（只影响侧边栏快路径，不影响正确性）；「先打标再写数据」那句注释已不成立。修法：注释对齐实现，打标放回 `commitPasswordRows` 内 `set` 之前一行。

### 11 · Minor｜窄屏修复顺带改了宽屏气泡位置

- [components/options/PasswordStrengthPopover.vue:8](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/components/options/PasswordStrengthPopover.vue#L8)：`placement` 从 `right` 无条件改成 `bottom-start`。宽屏 1440 下气泡从输入框右侧改到下方，可能盖住其下的确认密码框。属超出「窄屏修复」必要范围的行为变化，**需实测**；若确有遮挡再按视口条件化。

### 12 · Minor｜两段 320px 布局守卫只钉住单一语言态

- [e2e/auth-screen-layout.spec.ts:163-180](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/e2e/auth-screen-layout.spec.ts#L163)（强度气泡横向溢出）与 [:281-303](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/e2e/auth-screen-layout.spec.ts#L281)（找回向导收口）都在语言循环之外——中英双态循环只在 [:408](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/e2e/auth-screen-layout.spec.ts#L408) 覆盖引导卡片。项目已知陷阱：`el-form-item__content` 是 flex-wrap，并排挤行撞不撞取决于文案长度，英文态永远看不出来。修法：这两段对 zh/en 各跑一次。

---

## 2. 需用户拍板的开放问题

- **Q1 敏感字段之间的丢更新仍在。** [utils/storage/passwordCrud.ts:272](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/passwordCrud.ts#L272) 事务开头读旧行 → [:306](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/passwordCrud.ts#L306) 用旧行解密 → [:317-331](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/passwordCrud.ts#L317) 落盘时只回填 5 个非敏感元数据字段。两个标签分别改同一条的 `remark` 与 `password` 时，后写者仍会用自己的旧明文快照整行重加密覆盖前者的另一字段——整行密文决定了这无法靠字段回填解决。397ed1c「修复同 id 回卷」覆盖的是元数据回卷与非敏感路径（那两条已确认修好，[tests/utils/passwordCrudWriterInterleave.test.ts:156-180](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/tests/utils/passwordCrudWriterInterleave.test.ts#L156) 有守卫）。选项：(a) 像身份域那样引入 `expectedUpdateTime` 令牌（口径见 [identityCrud.ts:241](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/identityCrud.ts#L241)）；(b) 把「重读 + 解密 + 重加密」整段放进提交锁（语义完整但更慢）；(c) 接受并在文档里写明边界。
- **Q2 仍有整包写者不在提交锁内。** `utils/sessionManager-storage.ts` 的 at-rest 迁移在「shared 租约内、commit 锁外」整包写 `PASSWORDS` / `TRASH`（自带 updateTime 漂移检测）。它不在本次 diff 内、窗口也窄，但「所有整包写都进提交锁」这句话目前不成立。要不要一并纳入。

---

## 3. 专门验过、确认没有问题的维度

（列出以免下一轮重复劳动）

1. **跨标签页回程不搬运任何凭据。** [composables/useVaultReturn.ts:87-102](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/composables/useVaultReturn.ts#L87) 只有 `tabs.get` + `tabs.update({active:true})` + `windows.update({focused:true})`；[utils/sourceTab.ts](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/sourceTab.ts) 全文无 `tabs.sendMessage` / `executeScript`（grep 零命中）。值仍由用户在库里经既有剪贴板通道复制，机密字段与整卡走限时自动清除。
2. **tabId 不可被页面左右。** [entrypoints/background/messageRouter.ts:45](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/entrypoints/background/messageRouter.ts#L45) 引入 `resolveSourceTabId`，来源恒取自 `sender.tab`（右键路径取 `onClicked` 递交的 tab），页面自报的 `data.sourceTabId` 由 [sourceTab.ts:33](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/sourceTab.ts#L33) 的 `Number.isSafeInteger` + `>= 0` 再收一次；`tests/background/senderValidation.test.ts` 对 5 个伪造值、`chrome://`/`chrome-extension://`/`about:blank` 三种协议、无 `sender.tab` 三种情形都断言转发载荷恒等于 `sender.tab.id`。
3. **降级方向是收口而非放大。** URL 缺失 / 协议不在白名单 / `tabs.get` 抛错 → `forget()` 且出口不显示（[sourceTab.ts:48-52,69-70](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/sourceTab.ts#L69)、[useVaultReturn.ts:51-68,94](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/composables/useVaultReturn.ts#L51)），不存在「拿不到就切当前活动标签」；切换前二次复核协议白名单与浏览器盖章 URL 的主机名；意图只活在一个弹窗的 ref 里，不落 storage，关窗即清。
4. **不存在永久死锁 / AB-BA。** 取锁顺序恒为 shared(`aph-vault-key-transition`) → commit(`aph-vault-commit`)；无任何路径持 commit 后再取独占 transition，也无 transition 取 commit。`identityCrud.ts:386` 已把会二次取 commit 的公开 `replaceAllIdentityRaw` 换成 internal，消除自锁。`navigator.locks` 在回调 settle 或上下文销毁时自动释放，提前 return / throw / reject 均不漏 release。
5. **换钥与写者互斥成立。** `changeMasterPassword.ts` 五域原子写不取 commit 锁，但必须在所有 shared 租约释放后取到独占，而每个 commit 都在 shared 之内，不存在「重置与整包写交错」；会话 / 校验配置漂移守卫按值比对，失败与拒绝采纳路径都 `clearSession()` 回滚。
6. **权限面与网络面零改动。** `git diff main...HEAD -- wxt.config.ts public/` 为空——`permissions`、`host_permissions`、`content_scripts`、CSP、manifest 描述、`_locales` 均未动；新右键项复用既有 `contextMenus` + `chrome.tabs`；全 diff 无新增 `fetch` / 远程资源 / 遥测。
7. **凭据生命周期未被延长。** d88fcc4 只是把「离线恢复密钥」入口搬进引导卡，先 `tour.skip()` 再开既有弹窗，`refreshRecoveryEnrolledForTour` 只读一个布尔；无新密钥落盘、无新派生路径。[masterPassword.ts:97-101](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/utils/storage/masterPassword.ts#L97) 新增的强度闸门唯一调用方是首次设置，导入 / 恢复 / 备份链路不经过它，不构成旧数据兼容或格式变化。
8. **日志与存储无敏感泄漏。** 新增 / 改动运行时代码零直接 `console`；[useVaultReturn.ts:67](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/composables/useVaultReturn.ts#L67) 只记 error 对象、`sourceTab.ts` 无日志；[useRuntimeMessageHandler.ts:133](file:///Users/liaolongdong/code/chrome-plugins/account-password-helper/composables/useRuntimeMessageHandler.ts#L133) 明确「词的内容可能是姓名，属 PII：只记指令本身，不回显取值」；新键 `backup_nudge_dismissed` 是单布尔、写 `chrome.storage.session`（默认 `TRUSTED_CONTEXTS`，内容脚本读不到）。
9. **备份轻提醒的关闭态真的活过刷新与 SW 重启**（`storage.session` 浏览器级内存，非全局变量），另两路输入各有 `finally` / 内部 catch 兜底置 ready——唯一自锁路径见 §1-7。
10. **侧边栏秒开链路未被本次提交触及。** `sidePanelManager` / `backgroundServices` / `passwordCache` / `quickFillHandler` / `useSidepanelData` 均不在 `main...HEAD` diff 内（这些文件的改动全部在工作区未提交）；提交 diff 中 `sidePanel.open` 出现 0 次，`getTabIdSync` 路径未变；`resolveSourceTabId` 是纯函数，无 IO、无 storage 读、无跨入口往返。新增的 `contextMenuManager` 只有 2 个菜单项声明（幂等重建）与点击时一次性 `tabs.get`，无新 Port / `chrome.*` 事件监听常驻。
11. **首屏包体零风险。** `useRuntimeMessageHandler` 仅被 `entrypoints/options/App.vue` 引用（grep 确认），`sourceTab` / `useVaultReturn` / `IdentityVaultDialog` / `OnboardingTour` 全落 Options chunk，popup / sidepanel / content 的 eager 体积零增量；`wxt.config.ts` 零改动，Element Plus 按需引入与 `ElMessage` AutoImport 照旧；`pinyin-match`（`utils/searchMatch/core.ts:78`）、`jsqr`（`utils/qrScanner.ts:89`）仍动态 import；994e022 只动 `pnpm.overrides`（fast-uri / undici），运行时源码零引用，不进 bundle。
12. **观察范围未放宽、清理完整。** `FormDetector.ts:442-447` 的 `observe(document.body, {childList,subtree,attributes,attributeFilter:['class','style','placeholder']})` 与 main 相同；`destroy()` 清计时器 + 清两个候选 Set + `disconnect()`。
13. **i18n 与四处文档同步。** 脚本比对 22 个 namespace 中英文 key 无差集；`cm.identityPick` / `Locked` / `PickFailed` 双语齐（`utils/i18n-lite.ts`）；HelpDialog 8 组计数 12/18/12/6/9/9/7/13 与 `help.json` 条目数一致且连续；README / README.en / index.html / en.html / help.json / `docs/store/CWS_FILL_CONTENT.md` / privacy(.en) 都写了右键入口与「回到原网页」。
14. **规范面抽查通过。** 无 `eslint-disable`、无新增运行时 `any`、无直接 `console`、导入别名合规（同目录 `./`、跨目录 `@/`、类型用 `import type`）、SFC 块顺序未被重排、无同元素混用 `v-if`/`v-for`、props/emits 类型化、新增样式全部使用 `--aph-*` 令牌、`RETURN_PULSE_MS = 200` 与 `--aph-duration-mid` 同源且有注释锚定、`file://` 走不点名文案。
15. **回程提示条与空态 CTA。** `identity.empty` 文案指引下一步动作、与新增按钮同分支闭环、DOM + e2e 双守卫；`RecoveryKitSaveStep.vue:5` 的 `tabindex="-1"` + `focusRecoveryKitStep` 解决提交按钮被 `v-if` 摘除后的焦点悬空；`confirmDiscardRecoveryDraft` 走 ElMessageBox（自带 `role=alert`）未重复包层。

---

## 4. 为什么门禁全绿却留着这些缺陷（判据盲区）

| 缺陷                           | 看不见它的那道门禁                                                                                                                                                                                              | 盲区性质                                                             | 建议加的刀                                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 过期不清明文                | 单测 4652 例全绿                                                                                                                                                                                                | 没有一条用例断言「过期广播时输入框已清空」                           | `useAuthFlow` 补断言（§1-S1）                                                                                                                                  |
| S2 排队独占 → 嵌套 shared 失败 | `tests/utils/vaultWriteLock.test.ts` 存在但全仓 **0 个**测试引用 `withVaultKeyTransitionQueued`；`tests/utils/passwordCrudWriterInterleave.test.ts:83-88` 用透传桩 `request: (_n,_o,cb) => cb()`                | 桩不建模写者优先与独占排队，恰好抹掉本缺陷的唯一触发条件             | 用真 `navigator.locks`（或能表达排队的桩）加一条「parked exclusive + 嵌套 shared」回归                                                                         |
| F1/F2 去抖饥饿与溢出丢最新     | `tests/content/formDetector.mutationCost.test.ts`（308 行）结构性断言是好的（回调阶段 `textReads === 0`、bucket ≤ 32、destroy 清空、disposed 门），但**全部用例都是单次投递 + 直接 `advanceTimersByTime(500)`** | 测了「判定不再在回调里跑」，没测「去抖到不了期」和「溢出后的关键词」 | 补两条：每 200ms 投一条无关属性变更 + 一条含「密码登录」的变更，断言 2s 内 `detectForms` 至少触发一次；先投 32 条无关候选再投 1 条关键词元素，断言仍触发       |
| P1 跨库共用一把提交锁          | 无任何用例在身份库持锁期间发起密码库写入                                                                                                                                                                        | 两库各自测试，交叉阻塞无人断言                                       | 加一条「锁持有期间另一域写入被阻塞且能给出反馈」的观测用例                                                                                                     |
| U1 减弱档覆写失效              | `tests/architecture/reducedMotionCoverage.test.ts:147` = `有交互位移选择器 && 文件里有 @media (prefers-reduced-motion` → 纯存在性；stylelint 不管层叠顺序；e2e 减动效用例只量横幅壳                             | 「写了减弱档」被当成「减弱档生效」                                   | 守卫升级为配对性：每个交互位移选择器必须有一条 `transform: none` **排在它之后**；e2e 在 `emulateMedia({reducedMotion:'reduce'})` 下读按钮 computed `transform` |

共同形状：这四类都在验证「声明存在」，而不是「按层叠 / 按并发顺序真的成立」。本次新增的两把锁与新的减弱档块，恰好都落在「形状对、语义错」的那一侧。

---

## 5. 建议处置顺序

1. 合并前必修：**S1**（一行清空 + 断言）、**S2**（改调 `...Internal` + 清理前置）、**U1**（两条规则移到文件末尾 + 守卫换刀）。三者改动面都很小，收益分别是明文驻留、不可逆隐私残留、可访问性承诺虚假。
2. 合并前应修：**F1 + F2**（同一个函数内，去抖改成 debounce+maxWait + 溢出 FIFO 或兜底重检），并补上表那两条能证伪的测试。这是本次性能提交自带的功能面倒退，不宜留成已知问题。
3. 可排下一轮：**P1**（身份域锁收窄，或按域拆锁 + 有界等待）、§1-7/8/9/10/12（各自一行改动）。
4. 需产品/用户拍板：§2 Q1、Q2、以及 §1-11 宽屏气泡位置。
5. 必须真浏览器实测才能定性的点：减弱档下 Options 任意主按钮 hover 的 computed `transform`；1440×900 与 320×700 中英各开一次强度气泡看是否遮相邻输入框 / 出横向滚动条；找回密码弹窗 320/375/640px 英文态按钮与关闭 X 可达性；身份库回程提示条英文长主机名在 620px 弹窗宽下的换行，以及 `color-mix` 浅闪在 6 套主题最浅底色上 `--aph-text-secondary` 对最暗浅底的 AA 对比度；新手引导 retreat 步「现在登记」的 Esc/Tab 焦点链。

---

## 6. 方法与限制

四路并行评审（安全与数据一致性 / 功能正确性与回归 / 性能 / UI 与规范），逐条回源码证实或证伪后才入册；未采纳的推测未写入本文。限制：未跑 e2e、Firefox 构建与 Options 首屏实测（见 §0 表），§1-11 与 §5-5 的视觉结论均为静态推断，需按清单真机复验。

---

## 7. 处置结论（同一日落地，分支 `fix/review-2026-11-02`）

本轮按 §5 的顺序执行；每条修复都先写能证伪的回归测试、看它红，再改实现。修复后的门禁：`typecheck` / `lint` / `lint:style` / `test:run`（**327 文件 4691 例全绿**，基线 321 文件 4652 例）/ `build`（zip 916.48 kB）全部通过；e2e 与 Options 首屏实测仍未跑（本机负载不符合 §0 的口径）。

| 编号        | 结论                    | 落点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1          | 已修                    | `handleSessionExpired` 恢复无条件清空，且清空点提到 `onSessionExpired` 回调之前；`checkAuth` 两处条件清空按分析保留。新增 `tests/composables/useAuthFlow.sessionExpired.dom.test.ts`（4 例，其中 2 例修复前必红、2 例锁住「重复 checkAuth 不抹掉输入」这半边）                                                                                                                                                                                                                          |
| S2          | 已修，且比原建议更彻底  | ①`trashManager` 三处改调新增的租约内版本 `deleteHistoryByEntryIdsWithinLease`；②`deleteHistoryByEntryIdsInternal` 不再吞写盘失败（上抛）；③历史清理**排在摘条目之前**，失败时条目仍留在回收站可重试。第 ②③ 点是独立评审补出来的：只做 ① 时「半提交」在真实 IO 失败（Windows 慢盘 / 杀软扫描）下依然存在，而我上一轮的措辞把它说成已消除，属于过度宣称。新增 `tests/utils/trashPermanentDeleteLockHazard.test.ts`（5 例，含用真 `navigator.locks` 建模「排队独占卡在临界区中途」的交错） |
| F1          | 已修                    | 去抖加等待上界 `MUTATION_DETECT_MAX_WAIT_MS = 1000`（预算耗尽时按剩余时间排定），持续抖动页最迟 1s 结算一次判定；归零点覆盖到期任务、判定入口、`destroy()` 三处。                                                                                                                                                                                                                                                                                                                       |
| F2          | 已修                    | 溢出改淘汰最旧（原来丢最新），且重复登记时把候选移到队尾（否则「一直在抖自己 class」的登录元素恒处队首、被后来的动画容器先挤掉）。两份矛盾的 JSDoc 与实现对齐。`tests/content/formDetector.mutationCost.test.ts` 从 8 例扩到 11 例，三条新增都在修复前必红                                                                                                                                                                                                                              |
| P1          | 已修（按 §1 的 a 方案） | `identityCrud` 新增 `commitIdentityRows`（锁内只做重读 + 合并 + 单次 set，与密码域同口径）；`saveIdentity` / `updateIdentity` / `replaceAllIdentity` 三条路径的 PBKDF2 派生与批量加密全部移出 `aph-vault-commit`。**密钥派生仍在 shared 租约内、提交锁外**，因此 `vaultWriteLock.ts` 那条「不能拿换钥前校验过的主密码写新数据」的安全前提不受影响。错误优先级用一次锁外预读保住（`NOT_FOUND` / `UPDATE_CONFLICT` / `LIMIT_REACHED` 三条各有断言）                                       |
| U1          | 已修 + 守卫换刀         | `styles.css` 的减弱档块移到文件末尾并写明「不得挪回上面」；`reducedMotionCoverage` 的 interaction 轴从「文件里有 `@media`」升级为「撤销声明不得被同选择器的后来者压过」，含选择器组按顶层逗号拆分、注释抹成等长空格以保持字节偏移，并配一条人造反例证明判据有牙                                                                                                                                                                                                                         |
| Minor 8     | 已修                    | 门禁留在原处（锁定态开库只会得到空列表），只补被挡下时的可读反馈：新增可选回调 `notifyIdentityNeedUnlock` → `App.vue` 接 `ElMessage.info(t('identity.needUnlock'))`，中英文案同步入 `identity.json`。既有 `identityReturnWiring.test.ts` 的断言更新到新形状并**加**了接线断言（加强，非放宽）                                                                                                                                                                                           |
| Minor 9     | 已修                    | 提示语 span 改 `v-show`，`aria-controls` 不再悬空；新守卫按通用规则扫全组件模板的静态 `aria-controls`                                                                                                                                                                                                                                                                                                                                                                                   |
| Minor 10    | 已修                    | `commitPasswordRows` 加 `beforeWrite` 钩子，打标落进提交锁内、`set` 之前；空批次根本不打标；与实现相反的那句注释已改正                                                                                                                                                                                                                                                                                                                                                                  |
| **Minor 7** | **证伪，不修**          | `getActivationChecklistState` 与 `readHealthHistory` 都自带 catch 返回默认值，`loadActivationState` 实际不可能 reject。按 agents.md「不为不可能发生的场景加错误处理」不动 `App.vue`；我先前为它写的那条守卫测试也已删除（它同时依赖一个脆弱的源码切片启发式）                                                                                                                                                                                                                           |

### 独立评审又挖出来的同源问题（本轮一并修的）

- `passwordCrud.ts` 的 `updatePasswordInternal` 在已持租约时调公开版 `snapshotPasswordHistory`，外面还挂着 `.catch(() => {})`——与 S2 同一形状，重置排队时旧口令历史快照会静默丢失。改调新增的 `snapshotPasswordHistoryWithinLease`，并把兜底 catch 改成记日志。
- `removeReminders(...).catch(() => {})`（回收站三处）提醒表里存着 username，永久删除后清理失败零信号 → 改成 `logger.error`。

### 仍然留下的（有意不在本轮动）

| 项                                                                                                      | 为什么不在这轮动                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2 Q1（敏感字段整行丢更新）、Q2（`sessionManager-storage.ts` 的 at-rest 迁移仍在 commit 锁外）          | 需要你拍板：Q1 要选「`expectedUpdateTime` 令牌 / 重加密整段入锁 / 接受并写明边界」之一，Q2 会扩到另一个模块的数据格式                                                   |
| `recovery.ts:39-44`、`autoSaveManager.ts:343/351`、`sessionManager-storage.ts:488-491` 的同类嵌套取租约 | 失败会向用户报 busy（不是静默），但同属一类；这三个文件正被并行会话改写，本轮去动只会制造冲突面。建议下一轮统一提供 `...WithinLease` 版本并把两条锁守卫的扫描面扩到它们 |
| §1-11 宽屏强度气泡落点                                                                                  | 视觉取舍，需要真浏览器实测后由你定；我没有擅自改成按视口条件化                                                                                                          |
| `passwordCrud.ts` 元数据 flush 的非 `VAULT_BUSY` 失败仍结算为「已落盘」                                 | 那是 fcfefea 之前就在的**文档化取舍**（「真·写盘失败不重试，下次填充会再次触发」），改它等于改既有语义，不属于「修本轮发现的回归」                                      |
| 孤儿历史密文的清扫器                                                                                    | 上面 ②③ 已经把「产生孤儿」的路径关掉（要么成功、要么可重试）；再加一层清扫属于新功能，需要单独设计与测试                                                                |
