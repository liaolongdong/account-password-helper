# feature-dev 分支深度代码评审与安全评审报告（2026-10-26）

- **评审日期**：2026-10-26
- **评审范围**：`main...feature-dev`（merge-base `9d70fab`）——**38 个提交 / 170 文件 / +11,082 −1,031**，固定点钉在 `32c1f64`
- **排除项**：并行会话当时未提交的 24 文件（主色/图标配色回退）不计入本轮；该批改动在评审期间（00:39）被对方提交为 `34f572b`。`34f572b` **未触及本报告任何 P0/P1 引用的源文件**，但改写了 `assets/theme/tokens.css` 与 `tests/architecture/themeContrast.test.ts`，因此「对比度守卫覆盖面」相关表述一律以 `32c1f64` 为准
- **评审方式**：6 轴并行子代理深读（安全与密码学 / spec 一致性 / 规范与 code smell / 并发与静默失败 / 性能与包体 / UX·样式·i18n·文档）+ **全部 P0/P1 由主代理回源逐行验证**
- **证据标记**：✅ = 主代理回源验证（行号可点跳）；◐ = 子代理给出行号证据、主代理未逐条复验

---

## 验证结果

| 检查项      | 命令                      | 结果                                                                                                                                                                                                                                              |
| ----------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型检查    | `pnpm typecheck`          | ✅ 通过（exit 0）                                                                                                                                                                                                                                 |
| 单测全量    | `pnpm test:run`           | ✅ **300 文件 / 4,499 例通过**；⚠️ 3 例红（`themeContrast` ×2、`motionTokenWiring` ×1）→ 报错内容指向 `--aph-primary-strong`，该令牌在 `32c1f64` 与 `34f572b` 均不存在，判定为并行会话编辑中间态，**不属本窗口**；稳定态单跑这两个文件 26/26 通过 |
| Lint        | `pnpm lint`               | ⏸ 未执行——主树含并行会话改动且挂了 4 个活动 worktree，整仓 lint 会被无关面拖红（已知陷阱），交由提交前 lint-staged 兜                                                                                                                             |
| 样式检查    | `pnpm lint:style`         | ⏸ 未执行，同上                                                                                                                                                                                                                                    |
| 构建        | `pnpm build`              | ⏸ 未执行——`.output` 为并行会话产物，主树构建结论不可信（见记忆「真机验证须在隔离 worktree 跑」）；包体判据取自既有产物的静态分析（见性能专章）                                                                                                    |
| i18n key 集 | 六档 locale 逐档比对      | ◐ `recovery` 68/68、`options` 566/566、`auth` 40/40、`common` 37/37、`help` 107/107、`identity` 154/154，双向差集为空，占位符一致（**唯 `en/help.json` 一处参数未传 → P2-9，已随 `478dce6` 修正**）                                               |
| 真机目测    | 侧边栏/管理页各场景与断点 | ⏸ 未执行——工作树归并行会话；需目测项单列在「未验证项与限制」                                                                                                                                                                                      |

---

## 变更概览（8 条主线）

1. **离线恢复密钥**（本分支主功能）：`utils/recoveryCrypto.ts`（216 行，HKDF-SHA256 域分离 + AES-256-GCM 包裹数据密钥）、`utils/storage/recovery.ts` / `recoveryState.ts`、`components/options/Recovery{SettingsDialog,ResetDialog,KeyInput,KitSaveStep,SkipConsent}.vue`、`e2e/offline-recovery.spec.ts`。
2. **主密码提示语与忘记密码找回向导**：`ForgotPasswordDialog.vue`、`MasterPasswordSetupView.vue`、`PasswordVerifyView.vue`、`utils/storage/masterPassword.ts` 的 hint 读写。
3. **备份状态体系**：备份徽标上移到头部（`HeaderBar.vue` +313）、`BackupNudgeBanner.vue`、`BackupCheckPanel.vue`（只读自检）、`utils/backup/changeDetection.ts`（195 行）、`composables/useBackupChip.ts`。
4. **换钥与写锁重构**：新增 `utils/storage/vaultWriteLock.ts`，`changeMasterPassword.ts` 重写为「五域整批 + 逐字节复验 + 单次原子 `set`」，会话发布拆成 `prepareSessionRekey` / `publishSessionRekey`。
5. **不可解记录的知情门**：恢复流程允许携带坏记录（`RECOVERY_INCOMPLETE` / `tolerateUndecryptable`），并补 `RecoverySkipConsent.vue`。
6. **主密码强度门槛下沉到存储层**（`normalizeNewMasterPassword`），错误码改判别联合（`utils/recoveryTypes.ts`）。
7. **a11y 与主题令牌收口**：中性文字三档按最暗浅底定值、`--aph-*-strong` 强档、54 处硬编码灰阶并回令牌，并新增 `tests/architecture/themeContrast.test.ts` 守卫（后被 `34f572b` 收缩）。
8. **对外口径与包体**：README/ARCHITECTURE/privacy/CWS/llms/站点页回灌「默认无法找回；登记过恢复码除外」；`036c45a` 把错误码登记表从 popup eager 图里摘掉。

---

## 🔴 P0（合并 main 前必须处理）

### P0-1【安全｜✅】显式锁定会被换钥（rekey）复活成 24 小时有效会话

- 位置：`utils/storage/changeMasterPassword.ts:233-239`（基线读取时机）、`:258`（漂移判据）、`:293`（会话材料落盘）、`utils/sessionManager-storage.ts:786-799`（`publishSessionRekey`）
- 机制：`sessionBefore` 是在**整轮全库重加密之后**才取的，而 `:234-237` 的注释把守卫意图写成「从准备到原子写之间隔着整轮加解密（2000 条量级为秒级）」——恰好是这个顺序让守卫失效：
  ```ts
  const sessionBefore = await chrome.storage.local.get(sessionGuardKeys); // :239，重加密之后
  ...
  const sessionMoved = sessionGuardKeys.some(key => sessionBefore[key] !== sessionAfter[key]); // :258
  ```
  锁定路径 `_doClearSession` 确实从 `storage.local` 删除了 `WRAPPED_DATA_KEY` / `PASSWORD_EXPIRY` / `VALIDITY_HOURS`（`sessionManager-storage.ts:921-926`，`WRAP_KEY` 刻意保留）。于是「重加密期间发生锁定」时两侧读数同为空 → `sessionMoved === false` → `:293` 照样把 `prepareSessionRekey` 备好的新 `WRAP_KEY`/`WRAPPED_DATA_KEY`/`expiry = now + 24h` 写入；`publishSessionRekey` 的复核 `stored[WRAPPED_DATA_KEY] !== wrapped`（`:789-790`）因这批键正是自己刚写进去的而必然通过 → 写 `storage.session` 的 `DATA_KEY` 与 `SESSION_LOCK_STATE {locked:false}`，并经 `adoptRekeyedSession` 扩散到各上下文。本上下文的 `sessionEpoch` 在这次调用里没变，代际守卫挡不住别处的锁定。
- 后果：用户点了「立即锁定」（或闲置自动锁定触发），界面显示已锁，实际整库在 24 小时内可被侧边栏直接读出明文列表。**这是本轮唯一会让「锁」这个安全动作说谎的缺陷**，且被 `:234-237` 的注释明确声明为要防的场景。
- 触发条件：改主密码（`mode === 'password-change'`）的数秒窗口内，从弹窗 / 侧边栏 / 快捷键 / 闲置计时器任一入口完成一次锁定。2000 条库重加密越久，窗口越大。
- 修复方向：会话材料的准备与提交都以「基线里确实存在未过期会话键」为前提——`sessionBefore` 缺 `WRAPPED_DATA_KEY` 或 `PASSWORD_EXPIRY <= now` 即视为已锁，`sessionKeysToWrite` 保持 `{}`，跳过 `publishSessionRekey`，让改密后停在锁定态（用户重输一次新密码即可，语义与 `relock-required` 一致）。

---

## 🟠 P1（应本轮修复）

### P1-1【数据完整性｜✅】普通写入租约是 `shared` 模式：写者与写者零互斥，整包覆写仍会静默丢记录

- 位置：`utils/storage/vaultWriteLock.ts:30`、`utils/storage/passwordCrud.ts:204 → :213 → :249`
- 机制：`withVaultMutation` 用 `{ mode: 'shared', ifAvailable: true }`——它只保证「有独占换钥在跑时不让我进」，**不保证两个写者不同时进**。而 `updatePasswordInternal` 是典型的 read-modify-write：`:213` 读整数组快照 → 中间跨三个 await（`:238` 解密、`:242` 历史快照、`:247` 再加密）→ `:249` 用 `[...passwords]` 整包覆写。
- 后果：网页自动保存（`utils/storage/autoSaveManager.ts`）与 Options 页编辑、或两个管理页标签交错时，后写者带着自己的旧快照覆盖前写者 → 一条新记录或一次编辑静默消失，且两侧都收到成功回执。
- 与既有测试的关系：`tests/utils/vaultMutationIsolation.test.ts` 只断言「写者 vs 独占换钥」这一对，**没有「写者 vs 写者」用例**；逐字节复验只存在于 `changeMasterPassword` 的 rekey 路径。新锁给了互斥的错觉，这是本轮最容易误判的一处。
- 与上一轮的关系：`CODE_REVIEW_2026-10-23_FEATURE_DEV.md` 的 P0-1（复验之后整包回卷）已被本分支的独占租约 + 复验堵住；P1-3（跨上下文 RMW 无协调）在**扩展上下文之间**由这把锁部分收敛，但写者-写者这一维仍裸露。
- 修复方向：五域 RMW 走同一锁名的串行队列（把普通写也排进 `navigator.locks` 的同名请求链），或提交前复验数组指纹（`id + updateTime + 密文长度`）不匹配即重放。

### P1-2【安全｜✅】内容脚本的旧会话迁移不在换钥互斥的 origin 内，却能覆写主密码校验配置并回发旧数据密钥

- 位置：`utils/storage/vaultWriteLock.ts:24-27`（注释自陈作用域缺口）、`utils/sessionManager-storage.ts:485-505`、`utils/storage/masterPassword.ts:147`
- 机制：模块头注已诚实写明「内容脚本（`isSessionValid` 的旧版会话迁移路径）用的是**宿主页面**的 lock space，它的共享租约挡不住扩展侧的独占换钥」，但迁移写路径没因此关掉：
  ```ts
  if (!masterPassword || !(await verifyMasterPassword(masterPassword)))
    return false; // :488
  sessionWrappedDataKey = await persistWrappedDataKey(
    dataKey,
    undefined,
    epoch,
  ); // :505
  ```
  `verifyMasterPassword` 命中 legacy（无 `kdf` 的单轮 SHA-256）配置时会**无条件整对象覆写** `MASTER_PASSWORD`（`masterPassword.ts:147`），而 `commitVaultRekey` 的复验键集只有 4 个会话键 + 5 个数据域（`:233-238`、`:247-256`），**不含 `master_password_config`**；`sessionEpoch` 又是每上下文各自持有的，跨上下文失效。
- 后果：仍存 `session_master_password` 的存量用户，在管理页换钥期间于任意网站聚焦登录框触发迁移 → 旧口令的校验哈希盖掉 `newMasterConfig`，此后旧密码「验得过」但派生的是 DK1，而整库已是 DK2 密文；同时新建恢复套件的 AAD 绑的是被覆盖掉的那份 verifier → **整库与恢复密钥同时永久解不开**。
- 触发条件：低频但条件苛刻且后果不可逆——只打 legacy 数据形态，而这类用户恰是本功能承诺要救的人群。
- 修复方向：① `_migrateLegacySession` 在非扩展上下文直接返回 false（迁移统一改走后台消息路由）；② 把 `STORAGE_KEYS.MASTER_PASSWORD` 纳入换钥复验键集，或改为「写后复验自己的键」。这与记忆中「hint 只写一次、禁整对象覆写」是同一条纪律的第二处违例。

### P1-3【对外口径｜✅】设计稿点名的 15 个对外文件只改了 8 个，已发布页面仍在说反话；找回向导里没有恢复密钥这条路径

- 位置：`docs/blog/{zh,en}/01,03,06`、`author.html`、`author.en.html`、`compare.html`、`product-site/index.html`、`.github/SECURITY.md`（`git grep` 在 `32c1f64` 逐字命中「无法找回 / cannot be recovered」共 11 处）；`components/options/ForgotPasswordDialog.vue:19-52`
- 机制：`docs/reports/SECURITY_RECOVERY_KEY_DESIGN.md` §九.1 写明「15 个手写文件写着『主密码遗忘无法找回』，改判后必须逐处收成『默认无法找回；登记过恢复码的用户除外』」，实际 blog 六个 md、生成的 blog HTML、`compare.html`、`product-site/index.html`、`.github/SECURITY.md` 全部未动，且 §〇 的 8 条偏离表也没登记这条。仓库根目录就是 Pages 发布源，这些都是**已上线的对外地址**。
- 另一半：`ForgotPasswordDialog.vue` 只列「回想提示语 / 加密备份 / CSV / 重置」四条，`options.forgot.*` 里根本没有恢复密钥相关 key；`recoveryAvailable` 时唯一入口在向导外的 `PasswordVerifyView.vue:97-107`。用户读完四条就面对页脚红色「重置全部数据」——本分支最大的救命出口在最该出现的地方缺席，而 `lead` 还承诺「按代价从小到大排列」。
- 修复方向：blog 三篇 ×2 语言 + `author*` + `compare` + `product-site` + `SECURITY.md` 一次回灌并重跑 `pnpm gen:blog`；向导在 `recoveryAvailable` 时插入首条 `<li>` 接到既有 `openRecovery`。

### P1-4【性能｜✅】解锁多付一次 PBKDF2：约 +433 ms（≈ +50%）

- 位置：`composables/useAuthFlow.ts:259` 与 `utils/sessionManager-storage.ts:702`
- 机制：UI 先 `StorageUtils.verifyMasterPassword(...)`，`createSession` 内部**又**验一次（`:702`，注释说明是为「外部 UI 的验证可能早于另一上下文换钥」），随后才 `deriveEncryptionKey`（`:710`）。单次 600k 迭代在 `docs/reports/PERF_ISSUE89_DATA_LAYER_EVALUATION.md:148` 实测 433 ms，即解锁从 2 次派生变 3 次。
- 命中 SLA：Options「解锁 → 列表填充」的会话失效形态（`wallMs`）与 `useSessionTimer` 续期；**不碰侧边栏打开链**（见性能专章）。
- 修复方向：去掉 UI 预检，让 `createSession` 按已备好的 `WRONG_PASSWORD` 码分流呈现，回到 2 次派生；保留跨上下文复验的安全收益（`:702` 那次不动）。

### P1-5【spec｜◐】设计承诺的「设置主密码当页显式跳过恢复码登记」这道门完全没做

- `FEATURE_MP_RECOVERY_EVALUATION.md` §二 表第二行要求「设置主密码当页就把『抄一次恢复码』摆在面前（可跳过，但必须显式跳过）」；实际 `MasterPasswordSetupView.vue` 本轮只加了提示语字段，恢复的唯一入口是安全设置菜单与命令面板（`entrypoints/options/App.vue:328-330`、`:1735-1740`），无 consent、无跳过、无当页提示。设计点名要救的「从没导出过备份的用户」在最高频那一步碰不到本功能。且这条不在 8 条偏离表里。

---

## 🟡 P2

### 正确性与数据一致性

1. **P2-1｜恢复也是一次 rekey，却被记成「内容变更」，凭空制造待备份（✅）**：`changeMasterPassword.ts:273` 恢复分支先 `await lockSession()` 且不准备 `sessionKeysToWrite`，那批五域整库重加密里**没有** `session_wrapped_data_key`；`utils/backup/changeDetection.ts:130-132` 的 `isKeyRotationBatch` 只认 `newValue !== undefined`（锁定是删除，`newValue` 恰为 `undefined`）→ `entrypoints/background/backgroundServices.ts:362` 的短路不触发 → 五域逐字段比对必然判「变了」→ 刷新 `setLastPasswordChangeAt(now)`。后果：每成功恢复一次，头部徽标转 urgent、桌面通知称「备份后有变更」，而 `.aph` 内容与主密码无关并未变化。`17b673c` 给改密修掉的误报在恢复路径复活，与 `docs/ARCHITECTURE.md` §5「修改主密码（rekey）同样不算变更」正相反。`tests/utils/backupChangeDetection.test.ts:157-174` 没测这批形态。
2. **P2-2｜改密静默携带不可解记录却报成功（✅）**：`changeMasterPassword.ts:217` 把身份两域交给 `reencryptAll(..., countCarriedIdentity)`，单条失败原样携带（仍是旧钥密文，新钥永久读不出），`:267-271` 只 `logger.warn` 条数，返回值类型仅 `'relock-required' | void`（`:108`），计数不外传；`ChangeMasterPasswordDialog.vue` 的 `finish(outcome, allowSkip.value)` 只在用户勾过知情门时才补 partial 文案。身份库 PII 与历史条目不在 `undecryptableCount` 告警覆盖内。为「旧密码疑似泄露」而改密的人拿不到完整密钥轮换。
3. **P2-3｜元数据回队后 Promise 提前 resolve（◐）**：`passwordCrud.ts:390-424/446/480`——取租约前已 `_pendingMetadataUpdates.clear()`，`VAULT_BUSY` 分支 `requeueMetadataUpdates(batch) + scheduleMetadataRetry()`，但同批 `_metadataFlushResolvers` 已在 `:480` resolve，与 `updatePasswordInSession` 文档「数据实际写入后 resolve」相反；SW 在这 1.5 s 被回收或再次 BUSY，收藏/使用痕迹静默丢失且 UI 已报成功。修法：resolvers 随 batch 回队，落盘成功才 resolve。
4. **P2-4｜提示语被两条换钥链路无条件继承，而全站没有编辑入口（◐）**：`utils/storage/recoveryState.ts:110-122` `buildChangedMasterConfig(..., preserveHint = true)`，唯一写入点是首次设置页。恢复成功即意味着旧主密码已被遗忘，而那条明文 hint 描述的正是它：此后每次解锁连错 3 次就把一条指向作废口令的提示摊在屏幕上，想删除只能清空整库。修法：恢复链路 `preserveHint` 传 false，或恢复成功后强制引导重设。
5. **P2-5｜`lockSession()` 不校验后台回执（◐）**：`utils/sessionLock.ts:27` 丢弃 `sendMessage` 返回值，而 `messageRouter.ts:811` 会回 `{success:false, error:'SESSION_CLEAR_FAILED'}`；`changeMasterPassword.ts:273` 在恢复分支照常提交。SW 侧清理失败时其它上下文短时仍持旧 DK。
6. **P2-6｜未知 `version` 的恢复 blob 会被改密静默删除（◐）**：`recoveryCrypto.ts:15-29` 只认 v1 → `recoveryState.ts:35-39` 记 `'corrupted'` → `changeMasterPassword.ts:274-294` 用新 config 覆写同键。今天无影响，抬版本后会连根删掉用户尚未换发的新套件且只报「改密成功」。

### 体验、样式与无障碍

7. **P2-7｜新备份徽标是全仓最低对比度的必读文字（◐）**：`HeaderBar.vue:628-634` 文字 `rgb(255 255 255/90%)` 叠 `rgb(255 255 255/15%)` + 主色渐变，六套主题下 12px 为 **1.67–1.97:1**（`--urgent` 2.16–2.26、`--critical` 2.77–2.95），远低于 WCAG 1.4.3 的 4.5:1；`:focus-visible` 白描边约 1.5:1。`32c1f64` 的 `themeContrast.test.ts` 用 `WHITE_EXEMPT` / `LIGHT_SURFACES_IN_USE` 白名单，**不含渐变底**，测不到这一处（注：该守卫已被 `34f572b` 改写，结论需在稳定态复评）。
8. **P2-8｜新代码把已废弃的 EP 灰用回必读小字（◐）**：`RecoveryKeyInput.vue:171/189`、`RecoverySettingsDialog.vue:282`、`PasswordVerifyView.vue:402`（提示语本体，最该读清的一行）均用 `var(--el-text-color-secondary)` = #909399，白底 3.08 / 最差浅底 2.50:1；守卫只匹配字面 hex，`var()` 形式全部漏网。另 `RecoverySettingsDialog.vue:306` 裸 `background:#67c23a`（白底 2.24:1），`background:` 不在扫描面内。
9. **P2-9｜英文帮助出现字面占位符（◐）**：`utils/i18n/locales/en/help.json:62`（`help.gd.12`）用了 `{days}`，而 `HelpDialog.vue:283` 走 `t(key)` 不传参（`utils/i18n/index.ts` 自定义实现原样返回）→ 英文帮助显示 `Backed up {days}d ago`；zh 同条写死「N 天」。
10. **P2-10｜破坏性时刻的事实错误（◐）**：`options.forgot.resetBody` 称「下方按钮仍需两次确认」，实际 `useAuthFlow.ts:369-380` 只有 1 处 `ElMessageBox.confirm`；`auth.json:37` 的清空清单漏掉「密码修改历史」，与向导正文自相矛盾。
11. **P2-11｜套件步骤静默丢弃（◐）**：`RecoveryKitSaveStep.vue:100-120` 允许先下载再隐藏原码；此时 Esc / 取消即令草稿失效（`utils/storage/recovery.ts:44-62` 仅在 activate 落盘），用户手里留下一份永远无效的文件且零提示。建议 draft 态关掉 Esc/X 或加确认。
12. **P2-12｜锁定页的「验证备份」是一个离线口令判定 oracle（◐）**：`ForgotPasswordDialog.vue:38` → `verifyBackupFile.ts:16-36` 在库锁定时接受任意文件 + 任意口令，回显「共 N 条」，无失败计数/冷却，也不需要当前主密码。持 `.aph` 的人可在受害者锁定页以 600k/次反复验证备份口令猜测。
13. **P2-13｜骨架与真实头部不一致（◐）**：`entrypoints/options/index.html:262/296` 的 `.sk-backup`/`.sk-session` 高 28px，真实 chip 本分支统一钉到 32px（`HeaderBar.vue:624/846`）；`.sk-backup` 固定 124px，英文态更宽，淡出瞬间仍会位移。`optionsSkeletonView.test.ts:117-127` 只断存在与顺序，不量尺寸。
14. **P2-14｜`--critical` 的无限呼吸动画常开（◐）**：`HeaderBar.vue` 新增 `backup-chip-breathe` 叠在两枚 `backdrop-filter: blur(10px)` 徽标上，而 critical 恰是存量默认档（有数据但从未导出已验证备份）→ 管理页常开常重绘，只靠 reduced-motion 兜（WCAG 2.2.2 无暂停控件）。改一次性/`opacity`+`transform` 动画。

### 性能（细节见性能专章）

15. **P2-15｜备份徽标为「有没有身份数据」这一位信息拉整包 `IDENTITY` 进首屏窗口（◐）**：`useBackupChip.ts:87-96` 批量 get 含 `STORAGE_KEYS.IDENTITY`，而身份库本是按需加载（`App.vue:1477` 才 `identityVault.load()`）；`utils/identity/constants.ts:17,26-27` 口径下最坏 300–450 KB、典型 40–120 KB。Windows 慢盘 + 杀毒扫描下与全库解密抢同一窗口，命中 `wallMs`/`blockingMs`。
16. **P2-16｜每次保存串入历史数组整包读写 + 强制回源解包（✅）**：`passwordCrud.ts:242` 把 `snapshotPasswordHistory` 从 fire-and-forget 改成租约内 `await`（`get` + `set` 两次整包 IO，历史默认 3 档 × 2000 条 ≈ 6000 记录）；同批写入还因 `resolveDataKey(..., true)` → `getSessionDataKey(true)`（`sessionManager-storage.ts:298-310/357-368`）多 1 次 local get + 1 次 `navigator.locks` 往返。网页自动保存走同一链，会挤占侧边栏 `GET_INITIAL_DATA` 快路径。
17. **P2-17｜锁定首屏为一个布尔拉回整条 rekey 依赖（◐）**：`PasswordVerifyView.vue:219-227` onMounted `import('@/utils/storage/recovery')` → `recovery` 2,852 B + `recoveryCrypto` 4,295 B + `changeMasterPassword` 7,448 B ≈ 20 KB，落在锁定形态的 `preRowMs` 窗口。只读 `RECOVERY_CONFIG.enabled` 即可。

### 规范与架构契合（Standards 轴硬违规）

18. **P2-18｜存储层硬编中文错误文案，与 i18n 映射表构成两份事实来源**：`utils/storage/recoveryState.ts:25-29` `RECOVERY_ERROR_MESSAGE` vs `utils/recoveryUi.ts:25-40`；现存唯一消费者是测试（`recoveryFlow.dom.test.ts`、`changeMasterPasswordWriteFailure.test.ts`）。违背 wxt-rules #10 与 agents.md「不在 TS 中硬编码可见字符串」「按码分流、不匹配文案」——改断 `code` 后整表删除。
19. **P2-19｜入口组件承担业务规则**：`entrypoints/options/App.vue:1264-1310` 的 `backupNudge` / `backupNudgeOtherVault` / `handleBackupNudgeAction` 把「哪一档出声、欠哪份备份、送到哪个出口」写在入口，而同域判据全在 `utils/backup/changeDetection.ts`；该文件现 2192 行，本分支又 +142。违背 agents.md「入口文件只负责初始化、装配与生命周期」。
20. **P2-20｜manifest 文案未同步三项新能力**：`public/_locales/{zh_CN,en}/messages.json` 的 `extensionDescription`（逐项枚举能力）与 `wxt.config.ts` 均未改，而 README/index.html/HelpDialog/CWS 已全部同步（wxt-rules #10）。注意既有约束：中英短描述均已满（131/130），走详细文案需用户拍板。
21. **P2-21｜`verifyMasterPassword` 进锁后由「永不抛」变为可 reject，而调用方并进通用 catch**：`masterPassword.ts:105` 包进 fail-fast 的 `withVaultMutation`，唯一租约外调用方 `useAuthFlow.ts:259` 把 `VAULT_BUSY` 显示成通用「验证失败」并清空输入抖动——用户看不出「正在换钥匙，稍后重试」。`recoveryUi.ts` 已登记该码文案但这两条路径没走它。
22. **P2-22｜设计 §4 的承诺「找回向导是纯展示组件，不 import 存储与加密模块」已成假话，且守卫被放宽放行**：`ForgotPasswordDialog.vue:68` → `BackupCheckPanel.vue:111` → `verifyBackupFile.ts:3-4` → `backupExport.ts:8`（`@/utils/storage/configManager`），而 `PasswordVerifyView.vue:163` 静态导入向导、`App.vue:442` 静态导入视图，整条链进管理页 eager 图；`tests/architecture/backupCheckWiring.test.ts:20-26` 只正则扫本文件的 `@/utils/storage`，把「不依赖存储」悄悄缩成「不直接引用存储」。文档不改，下一个 contributor 会照旧假设去改它。

---

## 🟢 P3（择机）

- **同分支两套口径**：`recoveryUi.ts:19-24` 刚论证「switch 会静默走 default，故改用 Record 让漏项编译失败」，`HeaderBar.vue:531-545` 与 `verifyBackupFile.ts:40-50` 又用 switch + default，新增 `BackupVaultVerdict` 档会静默落进 `backupChipEmpty`。
- **重复代码**：文件选择区两套几乎一致（`RecoveryKeyInput.vue:32-70/108-137/164-190` vs `BackupCheckPanel.vue:24-53/148-158/218-241`）→ 抽 `useFilePicker()`；`RecoverySettingsDialog.vue:213-219` 与 `RecoveryResetDialog.vue:257-263` 的 `loadStatus` 逐字相同（两文件各 349 行、流程同构）；`VAULT_BUSY`/`WRONG_PASSWORD` 字符串镜像手抄 4 份（`vaultWriteLock.ts:8`、`sessionManager-storage.ts:6-7`、`autoSaveManager.ts:22-27`、`passwordCrud.ts:7-12`，理由是为守 popup eager 体积，可理解，但应收进一个薄模块）；11 处同构 `X()/X_Internal()` 租约包装可用一个 `protectedByWriteLease` 收敛。
- **「设新主密码」三处各自表述**：`ChangeMasterPasswordDialog.vue:279-285` 同步 `passwordStrength.allPassed` vs `RecoveryResetDialog.vue:276-281` 异步版 vs `MasterPasswordSetupView`；存储层已统一到 `normalizeNewMasterPassword`，UI 侧没跟上。
- **类型掩盖非法态**：`prepareSessionRekey`/`publishSessionRekey` 用 `Record<string, unknown>` 交接、读回 `as string`/`as number`，缺键静默 `return`（`sessionManager-storage.ts:774-798`）；`useBackupChip.ts:97` 对 storage 数据用 `as` 而非 `unknown` + 守卫；`recoveryUi.ts:64` `as VaultErrorCode` 索引；`changeMasterPassword.ts:137-143/186` `entry as PasswordEntry`。
- **Speculative Generality**：对已声明为 `string`/`RecoveryDraft` 的参数再做运行时类型判断（`recoveryCrypto.ts:86,95`、`recoveryState.ts:63,87,144`、`recovery.ts:136`、`changeMasterPassword.ts:66-67`）；`changeDetection.ts:257/346/369` 的 `worstLastBackupAt` 全仓只写不读。
- **Flag Argument / 命名**：`getSessionDataKey(forceFresh)`、`resolveDataKey(mp, forMutation)`、`getAllPasswordsDetailed(mp, forceFreshKey)` 同一个布尔在不同位置意为两件事；`resolveDataKey` 在两个模块逐字重复；`utils/recoveryTypes.ts` 与 `utils/storage/recoveryTypes.ts` 同名异目录，且前者实际是全库错误码登记表（名字只说 recovery）；`utils/backup/type.ts` 单数与全仓惯例不一致。
- **utils 与 UI 耦合**：`recoveryUi.ts:1` 引 Vue 版 i18n、`:69-73` 直接查 DOM；`verifyBackupFile.ts:7` 同。
- **对话框细节**：`ForgotPasswordDialog.vue:8` `width="620px"`（同分支新弹窗用 `min(520px, calc(100vw-24px))`）；四个新弹窗都没用仓库 15 处既有的 `.dialog-footer` 约定；`ChangeMasterPasswordDialog.vue:7` 未随 loading 设 `:show-close`，X 在 rekey 期间可点却被 `requestClose` 静默吞掉；`BackupCheckPanel.vue:59` 验备份密码框缺 `CapsLockHint`，而 `help.gs.11` 正在列举该提示的出现位置；`HeaderBar.vue:575` `.backup-chip` 的 `title` 与 `aria-label` 同串，读屏与鼠标各念一遍两库全量状态。
- **文案**：`backupChipAria` zh「激活后可导出加密备份」是 "Activate to" 直译且 aria-label 整体覆盖可见文字；`backupNudge.never`「唯一能把数据取回来的东西」与 README/llms.txt「明文 CSV/JSON 也是数据来源」冲突；`changePwd.weakPassword` 未提 8 位下限，与 `recovery.error.weakPassword` 两套口径；`backupNudge.otherOwed` 向用户描述横幅自身状态机。
- **spec 自身两处不实**：§〇 D1 指名的函数是 `deriveWrapKey`，代码为 `deriveWrappingKey`（`recoveryCrypto.ts:59`）；「8 处有意偏离」实际至少还漏了当页跳过门、验密前置改重输主密码、文案门禁半成品三条。§七 两项测试承诺（开启「浏览器重启锁定」后恢复码仍可用；恢复解锁后立刻锁定且 `K_old` 不残留）无对应用例。

---

## 已核实为正确实现的安全承诺（覆盖可见性）

HKDF-SHA256 域分离 + 每套件随机 16B id 作 salt + 一次一 12B IV + AES-256-GCM，唯一正确性判据是 GCM 标签、校验和只随用户副本不落盘（`recoveryCrypto.ts:59-83/139-148`）；恢复码 32B CSPRNG 全熵，无低熵/固定盐/ECB/口令 stretching 误用；密钥比较全走 `timingSafeEqual`；主密码强度门槛落在存储层且在验旧密之前调用；新套件与五域密文、verifier 在**单次** `local.set()` 同批提交（`changeMasterPassword.ts:285-294`），写失败保留旧钥与旧套件、无半状态；空/弱主密码与「同密码换钥」均拒；恢复不落 `storage.session`、不建会话、结束后保持锁定；`wxt.config.ts` 未新增 `permissions`/`host_permissions`、无新增网络出口；新代码零 `console.*`、无 `v-html`/`innerHTML`/`eval`，错误文案只按登记码翻译不回显输入；测试与 e2e 夹具全为合成值。i18n 六档 key 集与 bundles 注册全对齐，`help.gx` 计数 12/12 无孤儿。

---

## 性能专章：侧边栏秒开与 2000 条列表

**侧边栏各场景（会话有效 / 失效 / 间隔一段时间 / 快捷键 / 按钮点击 / 自动触发）——本分支零回归。** 依据：`entrypoints/sidepanel/App.vue` 仅 6 处 CSS 令牌替换；`messageRouter.ts` 的 `SHOW_SIDEPANEL` 与 `sidePanel.open()` 同步路径 0 改动（没有新增 `await` 在用户手势链上）；`utils/storageKeys.ts` 新增的 `RECOVERY_CONFIG`、`DATA_KEY_WRAPPED` 都不在打开链上；`useSidepanelData.ts:198-203` 仍是 2 次并发 IPC，未被新读拖长。唯一相关的是 P1-4 的解锁成本（会话失效态下用户重新解锁时多 ~433 ms），那是认证路径而不是打开路径。

**2000 条卡顿这一题，头条嫌疑不成立**：`utils/backup/changeDetection.ts` 的全数组比对只由 `storage.onChanged` 落盘驱动，不解密、不读写；`node -e` 复现 2000 条 × 全 ignorable 字段差异的最坏全扫 = **0.03–0.05 ms/次**，且该函数在 `main` 上已存在。本分支新增的 `isKeyRotationBatch` 反而把 rekey 批次的 2000 条逐字段比对整个短路掉（净减少工作量）。窗口聚焦 / Tab 激活 / 保活闹钟 tick 上没有任何扫描或加密。

**首屏与包体：懒加载边界守住了。** 三个入口的 eager HTML 引用与首屏闭包中 `VAULT_ERROR_CODES`、`unwrapRecoveryDataKey` 命中数均为 **0**；恢复/备份对话框全部走 `defineAsyncComponent` 或动态 `import()`（`RecoveryResetDialog` 11.4 KB、`RecoverySettingsDialog` 11.0 KB 均为懒 chunk）；`036c45a` 的 popup eager 修复成立且未被回退（四处一致采用 `import type` + 具名字面量常量）；唯一 eager 新增是 `vaultWriteLock-*.js` **627 B**。内容脚本面零改动（`entrypoints/content*`、`floatingButtons`、`inlineDropdown` 均不在 diff 内）。

**真正的叠加成本在数据层**（P2-15/16/17）：整包 `IDENTITY` 进首屏窗口 + 每次保存串入历史数组整包读写 + 每写多 1 次 local get 与 1 次锁往返，命中 `wallMs` 与 `blockingMs`——按 agents.md 的提醒，这两档的大头本就在全库解密与整包 IO，**不要因此去改渲染层代码**。

**备份自检的成本上限可接受**：`verifyBackupFile.ts:31-35` 的「验证」实际跑完整导入解析 + 解密（@2000 约 1.2 s + 433 ms 派生），但由按钮触发、`canVerify` 防重入、watch 只作废结果不重跑（`BackupCheckPanel.vue:158-180`），不构成击键级 jank。

---

## 建议处理顺序

1. **P0-1**（锁定复活）——唯一让「锁」说谎的缺陷，改动局限在 `commitVaultRekey` 的准备/提交条件，可加一条「基线无会话键即不写会话材料」的回归用例（`tests/utils/sessionRekeyPublication.test.ts` 是天然落点）。
2. **P1-2 + P1-1** 一起收：迁移限定扩展上下文 + `MASTER_PASSWORD` 进复验键集；写者-写者串行化或写前指纹复验。二者与上一轮 P1-3 同族，合并成一笔「五域写结构加固」最省审查成本，并补「写者 vs 写者」用例。
3. **P1-3**（对外口径 + 向导缺恢复入口）：这是用户看得见的自相矛盾，10 个文件一次回灌 + 向导补一条 `<li>`，与 `pnpm gen:blog` 同批。
4. **P1-4 + P2-15/16/17**（性能）：先做 P1-4（纯删 UI 预检，收益 433 ms 且无风险），再收徽标整包读与历史快照串行；改完在同一串行窗口跑一次 `node benchmarks/measure-options-perf.mjs --fresh --only mount`（2000 条夹具、每页 100、3 样本取中位）留档。
5. **P2-1**（恢复误报待备份）与 **P2-2**（携带不可解记录谎报成功）：都属「UI 说的和盘上发生的不一致」，可一并修，`isKeyRotationBatch` 改为认「同批出现 5 域整批变化且无用户数据字段变化」或直接给恢复路径挂独立标记。
6. 其余 P2/P3 按面收：a11y 三处（P2-7/8/14）等 `34f572b` 落定后复评，规范类（P2-18/19/20/22）建议独立小提交，避免与行为改动混在一个 diff。

---

## 未验证项与限制

- ~~未跑 `pnpm lint` / `lint:style` / `build`~~（2026-10-26 落地轮已解除）：`pnpm lint`、`pnpm lint:style`、`pnpm typecheck`、`pnpm build` 与 `pnpm test:run` 均已在 `feature-dev` 的当前状态跑过并通过。报告成文时之所以列为不可信，是当时主树混着并行会话的未完成改动；本批提交（`3e784e8`…`3ccbf58`）之后重跑，结论未变。**新发现的格式类问题**：`styles.css` 那份 `.dialog-footer` / `.form-tip` 对 teleport 出去的弹窗内容不生效（见执行记录 `806013f`）。
- **未做真机与浏览器验证**：需目测的三项——① 管理页 480/640px、英文、徽标 `critical` + 个人信息标签下 `.header-status`（`flex-shrink:0` 且无 wrap）是否横向溢出；② ~~六套主题下头部徽标静止/hover/focus-visible 的实测对比度与焦点环可见性~~——已用 Chrome for Testing 158 截图取像素实测（方法见下方「实测对比度矩阵」）；③ ~~侧边栏「帮助 → 数据与安全」第 12 条英文态 `{days}` 是否原样上屏~~——已由源数据核销：`utils/i18n/locales/{en,zh-CN}/help.json` 里唯一的占位符只剩 `help.versionLabel` 的 `{version}`，两个调用点（`GuideView.vue:36`、`HelpDialog.vue:28`）都传了 `{ version }`，`{days}` 在 P2-9 那笔已改掉。本机现已备好可复现路径：`E2E_EXECUTABLE_PATH` 指向 Chrome for Testing（本次用的是 npmmirror 的 158.0.8123.0，`~/.cache/aph-e2e/chrome-mac-x64/`）+ `E2E_SKIP_BUILD=1`，`pnpm exec playwright test e2e/…` 即可跑；上面那套取像素探针是一次性的，用完已删（断言只有「键盘能走焦到徽标」是有价值的，对比度本身是读数不是断言）。`e2e/` 用的是持久化上下文 + `--load-extension`，本机缺 Chrome for Testing（品牌版 Chrome ≥135 忽略该开关），本轮尝试下载 CfT 156.0.8078.47 超时未成（curl exit 28）。补做路径已存在：`E2E_EXECUTABLE_PATH` 指向 CfT 后 `pnpm test:e2e`，且该套件已是 PR 门禁，CI 会跑。若要做，须按既有结论在**隔离 worktree** 内跑（CfT + 端口隔离），主树测的是别人的包。
- **性能绝对值不可跨批次采信**：P1-4 的 433 ms 取自 `PERF_ISSUE89` 报告的本机实测；P2-15/16/17 的 KB 与 ms 为按 `utils/identity/constants.ts` 上限与既有 rmw 口径的推算；包体数字来自既有 `.output/chrome-mv3`（时间戳 10-26 00:36，是并行会话产物，结构判据可采信、绝对字节只作相对参考）。
- **`34f572b` 的影响面**：该提交回退了主色/图标配色并收缩了 `themeContrast.test.ts` 的守卫（−233 行）。本报告 P2-7/8/14 关于「守卫测不到渐变底 / `var()` 形式」的表述基于 `32c1f64`，需在稳定态重扫一遍再决定是否仍成立。
- **◐ 标记项**：行号由子代理给出、主代理未逐条复验，动手前请再 `git show 32c1f64:<file>` 对一次。

---

## 执行记录（2026-10-26 · `best-auto-action` 按本报告建议顺序落地）

| 提交      | 对应条目            | 内容                                                                                                                                                                                                                                                                                                                                                                                                |
| --------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a6e9f70` | P0-1 + P1-2         | 换钥只在基线存在包裹密钥时准备/发布会话材料；`authGuardKeys` 补进 `master_password_config`；新增 `utils/runtimeContext.ts` 的 `isWebPageContext`，把宿主页面上下文的两处认证材料覆写（旧版会话迁移、校验哈希透明升级）整体挡掉                                                                                                                                                                      |
| `01896ef` | P1-4 + P2-21        | 解锁去掉多余的一次 PBKDF2 预检（约 −430 ms），`VAULT_BUSY` 单独走 `recovery.error.busy`，不再冒充「密码错误」也不推高提示语门槛                                                                                                                                                                                                                                                                     |
| `b25c2fa` | P2-1 + P2-5         | `isKeyRotationBatch` 补第二条信号，离线恢复不再凭空报「待备份」；`lockSession` 开始看后台回执并有限重试；ARCHITECTURE 中英同步                                                                                                                                                                                                                                                                      |
| `478dce6` | P1-3 + P2-9 + P2-10 | 找回向导补「用离线恢复密钥取回」条目并接线复用恢复弹窗；blog 六篇 + `author*` + `compare*` + `product-site` + `SECURITY.md` 口径回灌并重跑 gen:blog；`{days}` 占位符、两次确认的谎报、清空清单漏项一并修正                                                                                                                                                                                          |
| `634d279` | P1-1                | `commitPasswordRows`（落盘前重读并按 id 合并）+ `queuePasswordWrite`（同上下文写队列），写者之间不再互相抹行                                                                                                                                                                                                                                                                                        |
| `b5eb667` | P2-2                | 换钥结果改为 `VaultRekeyResult{relockRequired, carriedUndecryptable}`，改密收尾按条数点名被携带的坏记录                                                                                                                                                                                                                                                                                             |
| `0e3070b` | P2-3                | 元数据被换钥挡下时保持 pending，只在落盘成功/失败/预算耗尽三种时刻结算；回队重试加 3 次预算                                                                                                                                                                                                                                                                                                         |
| `40e915a` | Standards #3        | 删除存储层自带的中文错误文案表，`recoveryError(code)` 只带机器码，i18n 映射表成为唯一事实来源                                                                                                                                                                                                                                                                                                       |
| 本次      | P2-13               | 骨架徽标占位高度 28px → 32px 与真实 `.backup-chip` / `.session-chip` 对齐，并把「尺寸一致性」补成可判红的断言                                                                                                                                                                                                                                                                                       |
| `dc36ae9` | P2-17               | 锁定首屏不再为一个布尔位动态 `import` `recovery.ts`（那条链静态挂着换钥与加密图，≈20 KB + 一次盘读）；新增 `recoveryState.isRecoveryEnrolled()`，存在性口径与 `enabled` 一致                                                                                                                                                                                                                        |
| `1152b5b` | P2-20               | 按「只进长描述」的决定：商店中英文说明各补一条备份状态徽标；Summary 131/130 字符保持不动                                                                                                                                                                                                                                                                                                            |
| `0b5ee43` | dc36ae9 的漏测      | 补回锁定页读取路径改动漏掉的 `recoveryFlow.dom.test.ts` 两条用例——那笔提交当时带着红灯进仓，见下方「一处如实更正」                                                                                                                                                                                                                                                                                  |
| `400da87` | **P2-4**            | 提示语可在「安全设置 → 主密码提示语」随时修改或清除：`updateMasterPasswordHint` 只改 `hint`、逐字保留 `salt`/`hashedPassword`/`kdf`（不动恢复套件绑定的校验配置），清除按省略字段落盘，落盘前重读合并；14 份对外文档写死的命令条数随真源 29 → 30                                                                                                                                                    |
| `e8de51a` | **P2-12**           | 只读验证备份连续失败 3 次进入 30 秒冷却：锁定页也能用这块区域且它只要「导出时的口令」，此前可无限次离线磨口令，每次还白付一次 600k PBKDF2                                                                                                                                                                                                                                                           |
| `d3cc635` | P3 批次             | 备份口令输入补 Caps Lock 提示（帮助清单同步）；改密弹窗内联样式挪进 scoped；删掉只写不读的 `worstLastBackupAt`                                                                                                                                                                                                                                                                                      |
| `27cb218` | **P2-19**           | `backupNudge` / `backupNudgeOtherVault` 的判据从 `App.vue` 迁进 `changeDetection.decideBackupNudge`，入口只留装配与 UI 出口分派；判据侧统一用 `isVerdictOwedNow` 决定「下一份」点不点名                                                                                                                                                                                                             |
| `806013f` | P3 批次 + Standards | 恢复/找回/提示语四处页脚的 `.dialog-footer` 补齐**各组件自己的**声明——`styles.css` 那份经 App.vue 的 scoped `@import` 编译、对 teleport 出去的弹窗内容不生效，只加类名等于加了个装饰（渲染逐像素不变，判据反向可红并登记一处例外）；「已启用」状态点的裸 `#67c23a` 改走仓库从未覆写的 `var(--el-color-success)`（同值，非换色）                                                                     |
| `ff024a2` | e8de51a 的漏测      | 冷却用例此前**静默半程**：`vm` 沙箱没有 `setInterval`，`startCooldown` 设完剩余秒数即抛（vitest 记一条 unhandled rejection 并警告可能是假通过），「到期→解禁→计数归零」从未执行过而 13 条照样绿。补注入 `setInterval/clearInterval` 与延迟取用的 `Date.now`，用例改钉完整闭环（30→20→解禁→第四次真解密）                                                                                            |
| `3ccbf58` | P3 批次             | 两个恢复弹窗逐字相同的 `loadStatus` 收成 `loadRecoveryStatus(run, target)`：合并的不是排版，而是 `await import()` **前后各一次** `isCurrent()` 这道双闸（丢一道不会立刻出错，只在「弹窗在等待期间被关掉/重开」这条时序上显形，而 `enabled`/`corrupted` 决定入口按钮的文案与去向）；新增 4 条单测把它钉住——摘掉任一道闸分别验红 1 条 / 2 条，此前 `recoveryFlow.dom.test.ts` 28 条对摘掉后者毫无反应 |
| `e53aecb` | P3 批次             | `prepareSessionRekey` → `publishSessionRekey` 的会话材料交接改为具名类型 `PreparedSessionRekey`（`SESSION_STORAGE_KEYS` 加 `as const` 才让计算键成立），取值侧四处 `as` 随之消失；「没有会话材料」如实写成 `null` 而不是空对象冒充。删掉产物里任一项 → `typecheck` 报 TS2741                                                                                                                        |
| `5012dc0` | P3 批次             | `utils/backup/type.ts` → `types.ts`，与 `utils/types.ts` / `utils/identity/types.ts` / `entrypoints/content/types.ts` 的复数惯例对齐（内容未动，三处引用改路径）                                                                                                                                                                                                                                    |
| `7ea784e` | 外部评审            | 页脚死类名判据不再被注释蒙过（只认 `<style>` 块内、剥注释后的声明，把声明搬进注释即可验红）；修掉两处会腐烂/说错的注释（写死的「15 处」与实际 19 用 18 声明不符）                                                                                                                                                                                                                                   |
| `ee4b9c2` | 外部评审            | 元数据快重试预算耗尽后排一次**有界长退避**：此前只回队不排程、resolvers 已结算，用户不再操作而 SW 被回收就静默丢收藏；顺带修掉「已排程被读成预算耗尽」的提前结算                                                                                                                                                                                                                                    |
| `3957d4f` | 外部评审            | `about:srcdoc` 框架不再被判成扩展上下文（MV3 按父页面规则注入内容脚本，而它的 protocol 是 `about:`，不在协议清单里）；补 8 条判定面矩阵，删掉那一行即验红                                                                                                                                                                                                                                           |
| `fb25c6b` | **P0（新发现）**    | 换钥漂移守卫按引用比对 `master_password_config`——真机每次 `storage.local.get` 都反序列化出新对象，于是 `sessionMoved` 恒真、**每一次正常改密都被自己判成并发写而中止**。改为按值比（JSON 串，与五域密文同一口径），并把存储桩从「返回同一实例」换成 `structuredClone` 才能测到                                                                                                                      |
| `e1619cd` | e8de51a 的文档缺口  | 只读验证的「3 次失败 / 30 秒冷却」补进 README 中英与 CWS 商店长描述中英——此前只有 ARCHITECTURE 记了，而用户看到的是按钮灰掉 30 秒                                                                                                                                                                                                                                                                   |
| `d686046` | 未验证项 ①          | 新增 `e2e/options-header-narrow-overflow.spec.ts`：480/640px × 中英实测无横向溢出、徽标文字未被裁、走焦可达；顺手量到 320/360px 的真实越界（371/419px 且不给滚动条），改法属窄屏布局变更，等拍板                                                                                                                                                                                                    |
| `aec72ac` | P2-7/8/14 取证      | 配色数字从推算升级为 Chrome for Testing 截图取像素实测（critical 2.80–3.01 / urgent 2.18–2.29 / ok 1.88–2.24），并记下一枚焦点环 1.57–2.22:1 的可见性缺口                                                                                                                                                                                                                                           |

**验证口径**：每轮改动跑 `pnpm typecheck` + 相关用例 + 改动文件的 `eslint/prettier/stylelint`；最终全量 `pnpm test:run` 315 文件 / 4582 例全绿，整仓 `pnpm lint`（`--max-warnings 0`）、`pnpm lint:style`、`pnpm typecheck` 与 `pnpm build` 均通过（exit 0、零输出）。新写的每条判据都做过反向取证——把被修的东西改回去，判据必须变红（P0-1、P1-1、P2-1、P2-3、P2-12、P2-13 均已验证；`ff024a2` 的倒计时断言用「秒数公式 +1」验红；`3ccbf58` 的两道闸分别摘掉验红 1 / 2 条）。

**一处如实更正**：`dc36ae9`（P2-17）当时只跑了恢复相关的存储用例与构建，没重跑 `tests/components`，因此它是带着一盏红灯进的仓（`recoveryFlow.dom.test.ts` 两条依赖旧读取路径的用例），由 `0b5ee43` 补平。教训：改了被 dom 测试挂载的组件，最小验证集必须含 `tests/components`，不能只看同域的存储用例。

**e2e 归因与一条 P0 的来路（2026-10-26 · 本机 Chrome for Testing 158）**：全量 e2e 在主树跑完是 144 passed / 1 skipped / 4 failed，但主树的 `.output` 与源码会被并行会话实时改写，这个数字不可归因。于是把两份产物各自建在隔离 worktree 里对比：`9d70fab`（与 `main` 的 merge-base）与 `9174703`。结果 `security.spec.ts:72` 在 base **通过**、在 HEAD **失败**，`dialog-scroll-isolation.spec.ts:410` 两边都失败（与本分支无关），`utils.spec.ts:111` 在隔离环境通过（负载假红）。对 `security:72` 在 84 个提交上做手动二分（不动 `git bisect`，它的状态在共享 `$GIT_DIR` 里，会踩到并行会话）定位到 `a6e9f70`：漂移守卫用 `!==` 比对象形态的校验配置，真机每次读都是新实例 → 恒判「并发写」→ 本分支的主密码修改在真机上是坏的，`fb25c6b` 修复后 `security.spec.ts` 与 `offline-recovery.spec.ts` 共 8 条在同一个隔离 worktree 全绿。**为什么 4597 条单测全绿却漏过**：仓库的 `chrome.storage.local.get` 桩返回的是 `storageData[key]` 这同一个对象引用，恰好抹掉了「每次读都反序列化」这一真实语义。教训入册：**凡按值比较存储读数的判据，桩必须按真机语义给新实例**（`structuredClone`），否则这类守卫测的是桩的引用相等，不是产品的值相等。

**对外镜像一致性复核（2026-10-26 · SEO 侧）**：`e1619cd` 往 README 中英与 CWS 商店长描述中英补了冷却口径，随后核了三件事——
① `llms-full.txt` / `llms.txt` 由 `scripts/build-blog-pages.mjs:1146` 从「`llms.txt` 摘要 + 中英博客正文」生成，**不含 README 正文**
（`grep -c "只读验证" llms-full.txt` = 0），所以这次文案改动不会让它们过期，无需重跑 `pnpm gen:blog`；
② `index.html` 的 FAQ 三处镜像（JSON-LD、可见 FAQ、内嵌 i18n 对象）没加冷却说明，理由是那三段讲的是「恢复路径能不能救数据」，
一句 30 秒的按钮节流不改变其中任何一条事实——不是漏更；③ `tests/docs`（含 `seoSurface.test.ts` 与 `blogDiscovery.test.ts`）
在改动之后跑过，20 文件 / 737 例全绿。

同一类盲区还有第二笔，只是它更隐蔽：`e8de51a`（P2-12 冷却）的用例是**绿的**，却因 `vm` 沙箱没有 `setInterval` 而在 `startCooldown()` 中途抛错，只执行到「显示 30 秒」那一行——vitest 已把这条 unhandled rejection 和「可能是假通过」的警告打在报告里，被当成噪声放过了。判据是：跑测试时 `Errors` 一栏非零，与红灯同级对待。由 `ff024a2` 补运行时至真跑完整闭环。

**未落地项与原因**：

- **配色三项仍在等逐项批复**（P2-7 / P2-8 / P2-14）：改主题色按仓库纪律不构成可擅自执行的动作。已批复并完成的是 P2-4（加编辑入口）与 P2-20（只进长描述）。

  **实测对比度矩阵（2026-10-26 补，Chrome for Testing 158 headless + 截图取像素）**：徽标底是「半透明白 + 主题渐变 + `backdrop-filter: blur(10px)`」，推算只能取渐变端点，因此这里改读屏幕上的实际像素——白字取文字盒内最亮 0.3% 分位，底取文字盒下方那条内边距带（无字形无图标），WCAG 相对亮度按 2.4 次幂公式算。全新 profile 落一条条目并分别把 `last_verified_backup_at` / `last_identity_backup_at` 置为「无 / 45 天前 / 刚刚」三态，逐套主题切 `data-theme` 后取图：

  | 档位（实测类名）        | 实测底色的范围            | 白字实测      | 换成 `--aph-text-primary` #1f2937 后 |
  | ----------------------- | ------------------------- | ------------- | ------------------------------------ |
  | `backup-chip--critical` | 221–242, 113–121, 110–130 | **2.80–3.01** | 4.88–5.24                            |
  | `backup-chip--urgent`   | 209–230, 159–167, 69–89   | **2.18–2.29** | 6.41–6.72                            |
  | `backup-chip--ok`       | 114–235, 159–201, 142–255 | **1.88–2.24** | 6.55–7.83                            |

  三点结论：① 三档白字全部低于 12px 正文要求的 4.5:1，`critical` 只压着 3:1 这条图形/大字号线；② 本报告的 P2-7/8/14 原先给 `critical` 的推算值 2.16–2.26 偏悲观，实测是 2.80–3.01（`urgent` 与 `ok` 的推算与实测吻合）；③ 换成现有深色令牌后三档全部 ≥4.88，不需新造颜色。

  **焦点环（键盘 Tab 走焦实测）**：三档都亮起 `outline: solid 2px rgba(255,255,255,0.7)`，`critical` 档另有一层 `rgba(245,108,108,…)` 的呼吸光晕（截图时处于动画中途，alpha 读数 0.055–0.31 不等，不作判据）。按同一实测底色算，这枚白环与它所环绕的徽标底色之间只有 **1.57–2.22:1**，低于 WCAG 2.4.11 / 1.4.11 对焦点指示器要求的 3:1；环的外半落在头部渐变上，那一侧的相邻色本次未单独取样，要判「完全不可见」还差这一步。
  - 基础徽标（白 15% 玻璃底 + 白 90% 文字，取各主题渐变较亮一端）：default 1.85 / green 1.67 / pink 1.84 / mauve 1.86 / orange 1.71 / slate 1.97；纯白文字也只有 1.76–2.09。文字改用现有 `--aph-text-primary #1f2937` → 6.22–8.33。底色压深色玻璃到黑 18% 仍只有 2.90–3.53，要到 4.5 得压到约 40%，玻璃感尽失。ok 档状态灯 `#86efac` 在该底上 1.26–1.49，够不到 3:1 的图形线。`urgent/critical` 白字 2.16–2.26 / 2.77–2.95 → 换现有 `--aph-warning-strong` / `--aph-danger-strong` 作底色为 5.61 / 5.64。小字 `#909399` 白底 3.08、最暗浅底 2.87 → 现有 `--aph-text-secondary #565d6b` 为 6.62 / 6.17。裸 `#67c23a` 白底 2.24 → `--aph-success-strong` 5.63。

- **P2-15（徽标为读「有没有个人信息」这一位而整包读 `IDENTITY`）需要一次取舍**：不新增持久化计数键，就得把这部分结论推迟到首帧之后（改变可见时序，属需确认项）；新增写侧计数则要动 `identityCrud` / 回收站 / 导入多条写路径。本轮按纪律不动，等指令。
- **P2-6 已核销，无需改动**（2026-10-26 复查）：「未来的 `version` 会不会被乐观放行」这条已经有代码和三处用例双重钉住——`parseBackupContainer` 按 `MAX_BACKUP_VERSION = 1` 判上界（`utils/backup/parseBackupEntries.ts:142`），`.aph` 侧 `tests/utils/backupImport.test.ts:163`「version 高于上界抛 INVALID_STRUCTURE」与 `tests/utils/backupImportFailures.test.ts:223`「前向兼容不做乐观放行」，`.aphid` 侧 `tests/utils/identityBackup.test.ts:216`「version 高于当前 → INVALID_STRUCTURE」，恢复套件侧 `utils/recoveryCrypto.ts:18/102` 走的是严格相等（`version === RECOVERY_FORMAT.version`），`tests/utils/recoveryCrypto.test.ts:234/315` 各钉一条。今天只有 v1 不代表将来 v2 会被误读：真要加 v2，第一步就得把上界抬上去，而那会同时让这几条用例的作者面对「拒收还是兼容」这个决定——正是它该有的样子。
- **未动（P3 择机）**：P3 剩余项（`ForgotPasswordDialog` 的 `width="620px"` 与同分支新弹窗不同、`HeaderBar` 徽标 `title` 与 `aria-label` 同串、重复的文件选择器（**本轮判断为不合并**：两处的业务约束不同——一处要粘套件码 + 显隐切换 + 分组格式校验，一处要大小/条数上限与只读回执，按「看起来相似但约束不同不得强行合并」保留两份）、11 处同构租约包装（**本轮判断为不合并**：核到的形态是 `export async function X(...) { return withVaultMutation(() => XInternal(...)); }` ——一行委托，重复的正是「这个导出会取写租约」这条边界事实本身；换成 `protectedByWriteLease(XInternal)` 后，取租约这件事从对外签名上消失，泛型 `(...args: A)` 还会丢掉每个参数的具名与 JSDoc。按「不为形式上的抽象增加层级」保留原样），`utils/recoveryTypes.ts` 与 `utils/storage/recoveryTypes.ts` 同名异目录）。已落地的是 `prepareSessionRekey` 的类型交接（`e53aecb`）与 `utils/backup/type.ts` 的单复数（`5012dc0`）；**`utils/recoveryTypes.ts` 与 `utils/storage/recoveryTypes.ts` 同名异目录本轮仍不动**，并给出理由：改名要动 18 个文件、其中 5 个是加密/存储模块与 4 处「为守 popup eager 体积而刻意 `import type`」的注释锚点，收益只有可读性，与本分支合入 `main` 的冲突面不成比例；要做应在独立分支一次做完（含把「全库错误码登记表」从 recovery 命名的文件里分出去）。
- **`ValiditySettingDialog` 的两处死类名（新发现，需拍板）**：该文件连 `<style>` 块都没有，模板上的 `.form-tip` 与 `.dialog-footer` 都落在 `styles.css` 那份不生效的声明上——提示文字因此走的是默认 14px 正文色，而非同族设置弹窗的 12px 柔和色。补声明会把可见文字变小变淡，属视觉变化，按「不许未经确认改呈现」的纪律先登记：`dialogFooterDensityWiring` 把它作为唯一例外收进登记表（修好却不删条目即红），`.form-tip` 是否统一等用户批复一并处理。
- **刻意不回退**：P2-16 的历史快照串行化是本分支自己的正确性修复（防止换钥完成后迟到写回旧钥密文），只保留「可与本次写入合并为单次 set」的优化思路，未在本轮执行。
