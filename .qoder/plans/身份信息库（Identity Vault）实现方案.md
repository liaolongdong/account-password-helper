# 身份信息库（Identity Vault）实现方案 v3

> v2 说明：v2 基于对仓库的逐条核实重写了 v1。v1 有 16 处代码假设与现状不符（详见附录 A），v2 起所有 `file:line` 均已核实为当前真实引用。架构主干（平行数据域 + 整块加密 + 共用数据密钥 + Options-only）经核实后保留，因为替代方案更差（附录 B）。
>
> v3 说明（第二轮深度分析，7 处实质改动）：① **校验从一级硬阻止改为两级**——校验位类（mod 11 / Luhn）降为非阻塞警告，否则护照号、港澳台通行证、社保卡、门禁卡这些合法数据根本存不进去（§五）；② `MAX_FIELD_VALUE_LEN` 500 → 200，最坏单条从 ~20KB 压到 ~15KB（§二改动 4）；③ **`.aphid` 必须保留 `id`**——`.aph` 主动剥掉 id，身份库照抄会让重复导入同一份备份变成 60 条无法肉眼去重的 PII；导入还须显式报告「新增/更新/跳过」（§4.6）；④ 备份模块移到 `utils/identity/backup.ts`（它不碰 storage），重复行核实为 **25 行**而非 35 行（决策 6）；⑤ `category` 从「字段笼子」改为「默认字段集 + 更多字段折叠区」，切换类别不清空已填值（§6.5）；⑥ **独立性从「评审逐行看 diff」升级为 CI 可执行**——新增 `tests/build/sidepanelClosure.test.ts` 断言 sidepanel 首屏 `modulepreload` 闭包不含 identity chunk（§九-5 产物层）；⑦ R8（纯身份用户永不被提醒备份）确认为**独立性约束造成的唯一真实用户损害**，与回收站并列 Phase 2 首项（§七）。附录 B 新增 4 个否决方案：IndexedDB（致命，`clearAllData()` 清不掉）/ 逐条 storage key + 索引 / 按需解密 / 合并 `.aph`+`.aphid`。

## Context

插件目前只有「账号密码」一种条目类型：`utils/types.ts:14-71` 的 `PasswordEntry` 是唯一形状，其派生类型（`PasswordEntryWithUI:76-79`、`EncryptedPasswordEntry:84-87`、`TrashedPasswordEntry:825-828`）都只是扩展字段，全仓无 `kind`/`customFields`/`identity` 判别概念（已核实：对 `customFields|entryKind|IdentityVault|personal_identity` 全仓 grep 零命中）。

用户要新增个人信息收藏夹（姓名、身份证号、手机号、邮箱、住址、银行卡号/发卡行/持卡人/有效期/CVV + 自定义字段），要求**尽量独立、少耦合、不影响既有功能与交互体验**。

不做成第二个扩展：不同扩展各有独立 `storage.local`，拆开意味着两套主密码、两套会话、两份备份、两次 CWS 审核，且加密/会话/i18n/主题这套最贵的基建要重写一遍，用户还要记两个主密码。

### 已拍板边界（8 条）

前 4 条沿用 v1，后 4 条为本轮新增决策。

1. 备份走**独立 `.aphid` 容器 + `kind` 校验**，现有 `.aph` 字节格式与导入路径不变。
2. 身份库**与密码库共用数据密钥**，锁定/闲置锁定/会话过期/换主密码语义全部继承，不新增会话代码。
3. 一期**只做复制，不做页面自动填充**：`entrypoints/content/**` 与 `entrypoints/background/**` 功能代码零改动。
4. 侧边栏 `HelpDialog`/`help.json` **不动**（豁免 `agents.md` 规则 10 的「新增可见功能须同步侧边栏帮助」，理由：本功能无侧边栏界面，侧边栏帮助只讲填充）。文档落 Options / README / ARCHITECTURE / CWS 长文说明 / privacy。
5. **入口只在 Options 弹窗**，不加侧边栏/popup 入口。代价：网页填表时需先开 Options 页才能复制手机号或卡号（约 5 步）。收益：`entrypoints/sidepanel/**` 零改动，秒开 SLA（<1s、无白屏）零风险，独立性可硬验证。
6. **`utils/backupExport.ts` 零改动**。`utils/identity/backup.ts` 自带容器实现（约 **25 行**与 `.aph` 同参数的重复：`backupExport.ts:6-13` 四个常量 = 8 行 + `deriveKey:26-42` = 17 行；该文件全长 152 行）。理由见附录 A-1：该文件并没有可「原样搬出」的容器函数，抽取等于重构最关键的备份/恢复路径。
7. **掩码不自动回掩**。与密码显隐行为一致（`PasswordTable.vue:43-48`、`PasswordDetailDrawer.vue:70-77` 均无定时器），改为在弹窗 `@closed` 与会话失效时复位。不引入全仓没有的新交互范式。
8. **掩码统一 `'*'.repeat(8)`**，不显示后 4 位。与既有三处惯例一致，掩码态零信息外泄。已知代价见 R11。

### 独立性硬约束（交付标准）

`git diff --name-only` 与下列**禁改清单**的交集必须为空：

```
entrypoints/sidepanel/**          entrypoints/popup/**
entrypoints/content/**            entrypoints/background/**
utils/i18n/bundles/sidepanel.ts   utils/i18n/bundles/popup.ts
utils/i18n/bundles/help.ts        utils/i18n-lite.ts
utils/backupExport.ts             utils/types.ts
utils/storage/passwordCrud.ts     utils/storage/trashManager.ts
utils/storage/passwordHistory.ts  wxt.config.ts
public/_locales/**
```

`public/_locales/**` 入禁改清单的理由见 R10：manifest 描述已写满（zh 131/132 码点、en 130/132），加不进去，也不该加。

**允许改动的既有文件只有 8 个**（改动表 7 行，其中 `auth.json` 中英各一份，故 `git diff` 会列出 8 个路径；见「三、文件清单」），其中 `tests/utils/i18nBundles.test.ts` 是守卫测试逼出来的必需改动（附录 A-5），`utils/i18n/locales/*/auth.json` 是修既有文案缺陷（见改动表末）。

sidepanel 与 popup 的产物**文件清单**与首屏 `modulepreload` 闭包必须不变（字节 hash 会变，见 R6）。

---

## 一、架构：一条新的平行数据域

```
                     ┌─ 复用，不修改 ──────────────────────────────┐
components/options/  │ utils/encryption.ts  encryptData:149        │
  IdentityVaultDialog │                      decryptData:167        │
  IdentityFormDialog  │ utils/storage/facades.ts getSessionDataKey  │
        │             │                      generateId:13         │
composables/          │ utils/clipboard.ts   copySecretToClipboard  │
  useIdentityVault    │                      copyTextToClipboard    │
        │             │ utils/searchMatch.ts matchesKeyword:129     │
        ▼             │                      highlightSegments:153  │
utils/storage/        │ components/SearchHighlight.vue             │
  identityCrud.ts ────│ assets/theme/tokens.css  --aph-*           │
        │             └────────────────────────────────────────────┘
        ▼
  STORAGE_KEYS.IDENTITY（新增键，storage.local）

utils/identity/backup.ts（自带 .aphid 容器，不 import backupExport）
utils/identity/{types,constants,validators,formRules}.ts
```

依赖方向单向：identity 只依赖既有底层能力，**既有模块不 import identity**。唯一例外是 `utils/storage/changeMasterPassword.ts` 必须纳入身份数据（否则换主密码后 PII 永久不可解），这是刻意的、可控的 1 处反向依赖，且压缩到约 6 行（见 4.3）。

### 与既有加密惯例的差异（刻意偏离，有理由）

密码库采用**就地字段加密**：`passwordCrud.ts:23` 的 `SENSITIVE_FIELDS = ['username','password','url','remark','totp']` 逐字段加密，配合 `types.ts:84-87` 的 `encrypted?: boolean` 标记。

身份库改用**整块加密**（一个 `encryptedPayload` blob），因为：

- 身份字段几乎全部敏感（姓名、证件号、手机号、住址、卡号），逐字段加密等于 10 次 AES 调用 + 一份必须随字段增删维护的 `SENSITIVE_FIELDS` 清单；
- 整块加密让「新增字段」永远不需要改加密层；
- 少一处与密码库共享的可变假设。

代价：`sessionManager-storage.ts:376-443` 的 `ensurePasswordsEncryptedAtRest` 与 `backgroundServices.ts:697-702` 的残留检测网结构上无法覆盖身份库。但已核实**它们本来也只覆盖 `PASSWORDS`**，连 `TRASH`/`PASSWORD_HISTORY` 都不覆盖——本仓的真实不变量一直是「恒加密由写路径保证」。身份库沿用同一不变量，并额外加读路径不变量作为补偿（见 R9）。

---

## 二、数据模型与静态格式

```ts
// utils/identity/types.ts
export type IdentityCategory = 'person' | 'id_card' | 'bank_card' | 'address';

export interface IdentityCustomField {
  id: string;      // generateId()
  label: string;   // ≤30 字符，textContent 渲染，禁止 v-html
  value: string;   // ≤200 字符（见改动 4）
  secret: boolean; // true → 掩码 + 走 copySecretToClipboard
}

export interface IdentityPayload {
  pv: 1;                                  // payload 版本
  category: IdentityCategory;             // ★ 进密文，不明文落盘
  name?: string;                          // 兼作列表标题（见 displayTitle）
  idNumber?: string;
  phone?: string;
  email?: string;
  address?: string;
  cardNo?: string;
  cardBank?: string;
  cardHolder?: string;
  cardExpiry?: string;                    // MM/YY
  cardCvv?: string;
  remark?: string;                        // ≤1000，与 PasswordEntry.remark 同上限
  customFields?: IdentityCustomField[];   // ≤10 个
}

/** 落盘形状：只有 4 个明文键，全部不可识别 */
export interface IdentityRecord {
  id: string;
  encryptedPayload: string;  // encryptData(JSON.stringify(payload), dataKey)
  createTime: number;
  updateTime: number;        // 兼作并发令牌
}

/** 解密后的内存形状（仅在 Options 上下文，会话失效即销毁） */
export interface IdentityEntry extends IdentityRecord {
  payload: IdentityPayload;
}
```

### 相对 v1 的四处模型改动

1. **`category` 移入密文**（v1 让它明文落盘）。列表渲染本来就要全量解密（`getAllIdentity` 一次 AES/条），加密 `category` **零功能成本**，却把明文键从 6 个降到 4 个。v1 的理由「与 tag/favorite 同级」在事实上也站不住：密码库把 `url`/`username` 都算进 `SENSITIVE_FIELDS` 加密了，「知道用户存了一张银行卡」的敏感度不低于 tag。
2. **删掉 `order` 字段**。一期没有拖拽排序需求，按 `updateTime` 倒序即可。字段越少越不容易出错；将来要排序，靠 `pv` + 未知键保留机制平滑加上（见下）。
3. **删掉 `MAX_PAYLOAD_BYTES`**。v1 同时规定了 `MAX_CUSTOM_FIELDS=10 × MAX_FIELD_VALUE_LEN=500` 与 `MAX_PAYLOAD_BYTES=16_000`，但 10×(30+500)+1000+基础字段 ≈ 6500 字符，CJK 按 UTF-8 三字节最坏可达 ~19.5KB —— **字节上限会拒绝一个完全合法的满额输入**，是自相矛盾的缺陷。字段级长度上限已经确定性地界定了体积，冗余的字节上限只会制造 bug。改为在测试里断言最坏情况总体积 < 1MB。
4. **`MAX_FIELD_VALUE_LEN` 500 → 200**。没有任何真实个人信息（住址、单位、保单号、备注性字段）需要单字段 500 字符；真需要长文本时 `remark`（1000）已在。把上限压到 200 后，满额单条 ≈ 10×(30+200)+1000+基础字段 ≈ 3500 字符 → CJK 最坏 ~10.5KB → AES+Base64 膨胀 ~1.37× ≈ **15KB/条**，30 条 ≈ **450KB**，远离 `storage.local` 的 10MB 配额（对比：v1 的 500 上限最坏 ~20KB/条、600KB 总量）。收益是把「体积失控」这条风险从需要论证降到不需要论证。

### 前向兼容（v1 只写了口号，这里给实现）

「读时忽略未知键、写时原样保留」要求编辑时不要把 payload 整体替换成 typed 对象。实现为单行展开合并：

```ts
const nextPayload = { ...existingPayload, ...formValues, pv: 1 } as IdentityPayload;
```

这样未来版本新增的键在旧版本编辑后仍然存活。`category` 由表单显式写出，不受合并影响。

### 密文自描述

`encryption.ts:149-162` 的 `encryptData` 已产出 `Base64(IV[12] ‖ ciphertext ‖ GCM tag)`，随机 IV，无需新格式；`decryptData:167-190` 按 12 字节切 IV。

---

## 三、文件清单

### 新增（11 个实现文件 + 5 个测试文件）

| 文件 | 单一职责 |
| --- | --- |
| `utils/identity/types.ts` | 上述 4 个类型；不含逻辑 |
| `utils/identity/constants.ts` | `IDENTITY_STORAGE_KEY` 引用的键名、`MAX_IDENTITIES=30`、`MAX_CUSTOM_FIELDS=10`、`MAX_LABEL_LEN=30`、`MAX_FIELD_VALUE_LEN=200`、`MAX_REMARK_LEN=1000`、`CATEGORY_ORDER`、`APHID_KIND='aphid'`、`APHID_VERSION=1` |
| `utils/identity/validators.ts` | 纯函数、**零 i18n / 零 Vue 依赖**（照 `utils/passwordStrengthCore.ts:1-16` 明写的下沉口径）：`validateIdNumber`、`validateCardNumber`、`validateCardExpiry`、`validatePhone`、`validateEmail`、`validateCvv`；返回 `{ level, messageKey }` 而非布尔（见 5.3） |
| `utils/identity/formRules.ts` | `createIdentityFormRules(t)` → Element Plus `FormRules`；与 validators 分文件，保住 validators 的零 i18n 可测性（对标 `utils/formValidators.ts:75` 的 `createPasswordFormRules(t)`） |
| `utils/storage/identityCrud.ts` | 见下方 API 表 |
| `utils/identity/backup.ts` | `.aphid` 导出/导入，**自带容器**，不 import `backupExport` |
| `composables/useIdentityVault.ts` | 响应式状态与生命周期：`rows`/`loading`/`error`/`revealedIds`/`keyword`/`categoryFilter`/`load()`/`teardown()`/`displayTitle()`/复制 |
| `components/options/IdentityVaultDialog.vue` | 列表 + 过滤 + 搜索 + 字段行 + 掩码/复制 + 删除 + 备份出入口 |
| `components/options/IdentityFormDialog.vue` | 新增/编辑表单；`category` 决定**默认展开的字段集**，「更多字段」`el-collapse` 暴露其余全部字段（见 6.5） |
| `utils/i18n/locales/{zh-CN,en}/identity.json` | 前缀 `identity.*`，中英 key 集严格一致（第 18 个命名空间） |
| 测试 | `tests/utils/identityCrud.test.ts`、`tests/utils/identityValidators.test.ts`、`tests/utils/identityBackup.test.ts`、`tests/utils/identityRekey.test.ts`、`tests/build/sidepanelClosure.test.ts`（构建产物守卫，对标 `tests/docs/faqSchemaParity.test.ts` 这类非单元测试；见 §九-5 产物层） |

**v1 的 `components/identity/IdentityFieldRow.vue` 已删除**：`PasswordDetailDrawer.vue:50-86` 已有现成的只读字段行范式（`el-descriptions :column="1" border` + `.detail-value` = 文本 + `link` 图标按钮），直接照抄，新组件从 3 个降到 2 个。

**目录选择**：放在 `components/options/` 而非新建 `components/identity/`。16 个既有 Options 弹窗全部平铺在 `components/options/`，独立性由依赖方向保证，不靠文件夹。

**目录选择（utils 侧）**：备份模块放 `utils/identity/backup.ts` 而非 `utils/storage/identityBackup.ts`——它像 `backupExport.ts` 一样**以 entries 为入参、自身不碰 `chrome.storage`**，所以 `agents.md`「`utils/storage/` 是存储访问边界」这条约束不适用于它；真正需要留在 `utils/storage/` 的只有 `identityCrud.ts`。`utils/identity/` 是本仓第 4 个 utils 子目录（现有 `data/`、`i18n/`、`storage/`），用来收拢 identity 域的非存储纯逻辑，避免在已有 54 个文件的 `utils/` 根目录再摊 5 个。测试仍按现有惯例**平铺**在 `tests/utils/`（该目录无子目录）。

#### `identityCrud.ts` API

| 函数 | 约定与对标 |
| --- | --- |
| `getAllIdentityRaw()` | 读失败**上抛**，绝不返回 `[]`——镜像 `passwordCrud.ts:53-61`（理由注释在 `:46-52`：静默空数组会让 read-modify-write 覆盖真实全量） |
| `getAllIdentity(masterPassword?)` | `Promise.allSettled` 并行解密（镜像 `passwordCrud.ts:453-460`）；不可解密记录按 id 跳过且**不回写**，`logger.warn` 只带 id（镜像 `:468`）；返回 `{ entries, skippedIds }` |
| `saveIdentity(payload)` | 无数据密钥则**抛错**，绝不退回明文 |
| `updateIdentity(id, patch, expectedUpdateTime)` | read-modify-write；`expectedUpdateTime` 不匹配则拒绝并提示刷新 |
| `deleteIdentities(ids)` | 硬删除（一期无回收站，见 R7） |
| `reencryptAll(raw, oldKey, newKey)` | 重加密循环**放在这里**，让 `changeMasterPassword.ts` 只调用不实现（见 4.3） |
| `replaceAllIdentityRaw(records)` | 供导入合并使用；对标既有 `getAllTrashRaw`/`replaceAllTrash`（`trashManager.ts:260,269`）命名惯例 |
| `resolveDataKey()`（私有，约 6 行） | `getSessionDataKey()` 或 `deriveEncryptionKey`；**刻意不复用** `passwordCrud` 的私有实现，避免跨数据域耦合 |

**读路径不变量（补偿缺失的残留扫描网）**：读到的记录若 `encryptedPayload` 不是非空字符串，视为无效 → 跳过 + `logger.warn`（只带 id）。写路径无密钥抛错 + 读路径拒绝明文，两端夹住「恒加密」。

### 改动（7 行 / 8 个既有文件，合计约 40 行净增）

> 计数口径与新增表一致：`auth.json` 中英各一份，故 7 行 = 8 个文件。

| 文件 | 改什么 | 规模 |
| --- | --- | --- |
| `utils/storageKeys.ts` | `STORAGE_KEYS` 增 `IDENTITY: 'personal_identity_infos'` + JSDoc 注释（照 `TRASH`/`PASSWORD_HISTORY` 的写法） | +3 |
| `utils/storage/changeMasterPassword.ts` | 见 4.3；重加密循环在 `identityCrud.reencryptAll` 里，本文件只做「读 raw → 调用 → 键入原子 set」 | +~6 |
| `utils/i18n/bundles/options.ts` | 追加 `zhIdentity`/`enIdentity` 两行 import 与两处 `registerMessages` 参数（**只进 options bundle**） | +4 |
| `tests/utils/i18nBundles.test.ts` | `BUNDLE_NAMESPACES`（`:25-29`）加入 `'identity'`——该测试会静态扫描 `t('...')` 调用并与清单比对，不改必红 | +1 |
| `entrypoints/options/App.vue` | ① `:244-265` 的 `defineAsyncComponent` 块 +2；② `showIdentityVaultDialog` ref +1；③ `openIdentityVaultWithVerify()` +8（镜像 `:432-439` 的 `openTrashWithVerify()`，见 6.1）；④ `handleDataCommand`（`:445-475`）加 `case 'identityVault'` +2；⑤ 会话失效**两个汇聚点**各 +1（见 4.4）；⑥ 模板挂载弹窗 +2；⑦ `useIdentityVault()` 实例化 +1 | +~18 |
| `components/options/HeaderBar.vue` | 数据管理下拉（`:69-136`）追加一项 `el-dropdown-item command="identityVault"`，带图标与 `divided`，位置靠近回收站（`:128-133`） | +~6 |
| `utils/i18n/locales/{zh-CN,en}/auth.json` | 改 `auth.resetConfirm`（**已核实**，见下） | 改 1 key ×2（净增 0 行） |

**`auth.resetConfirm` 已核实为必须修改，且属修既有缺陷**：`utils/storage/masterPassword.ts:151-158` 的 `clearAllData()` 确实是 `chrome.storage.local.clear()`（`:153`，v1 行号准确），调用方 `composables/useAuthFlow.ts:318`。而现有文案是：

- zh：`此操作将清空所有已保存的密码数据，确定继续吗？`
- en：`This will erase all saved password data. Continue?`

`storage.local.clear()` 清的是**全部**数据——回收站、密码历史、主题、各项偏好设置同样会丢，所以这条文案**今天就已不准确**，并非身份库引入的新问题。加了身份库后，用户会误以为身份证/银行卡信息能留存，误导显著加重。

拟改为「清空所有数据（含密码、身份信息、回收站与全部设置）」。这属**用户可见文案变更**，按 `agents.md` 须先说明影响再改：本项只改文案措辞、不改任何行为，且是让文案与既有行为对齐。`auth.resetConfirmTitle`/`Btn`/`Done`/`Failed` 四个 key 不动。

**v1 计划改 `utils/backupExport.ts`（−45/+12），本版取消**（决策 6）。R3 回归风险因此归零。

---

## 四、关键流程

### 4.1 读取与显示

弹窗打开 → `watch(() => props.modelValue)` 触发 `load()`（对标 `TrashDialog.vue:286-293`）→ `getAllIdentity()`（会话内走 `getSessionDataKey()`，无 PBKDF2）→ 按 `category` 过滤 + `updateTime` 倒序渲染，全部机密字段默认掩码。

N ≤ 30 且一次 AES/条，冷路径成本可忽略。**禁止**把身份库放进任何 `warm*`、保活心跳、闹钟 tick 或资源预热循环——`backgroundServices.ts` 零改动是硬约束。

搜索**不加防抖**：既有惯例是 200ms 防抖（`usePasswordManagement.ts:111-125`，`onScopeDispose` 清理），但那是为上百条密码设计的；30 条以内即时过滤更简单，属有意偏离，代码里注一行原因。

### 4.2 写入

`saveIdentity`/`updateIdentity` 先校验（条数上限、字段长度、校验位），再 `encryptData` 落盘。`getAllIdentityRaw()` 抛错时**整次写入放弃**，绝不写「只含新条目的数组」覆盖全量（同 `passwordCrud.ts:46-52` 的理由）。

`updateIdentity` 携带读取时的 `updateTime` 作为并发令牌，不匹配则拒绝并提示刷新——`entrypoints/background/optionsPageManager.ts:80-88` 明确容忍多个 Options 标签页并存（注释原文「多个 options 标签页并存（用户手动打开）」），所以并发是真实场景。

### 4.3 换主密码（唯一的高危改动）

已核实 `changeMasterPassword.ts` 是**硬编码 12 步流程**，无扩展点：步骤 3 读三块密文（`:58`）、步骤 4/5/6 分别解密 passwords/trash/history（`:63,74,85`）、步骤 8 重加密（`:100`）、步骤 11 单次原子 `set`（`:137-151`，含 `PASSWORDS`/`TRASH`/`PASSWORD_HISTORY`/`MASTER_PASSWORD` + 展开的 `...sessionKeysToWrite`）。步骤 9 刻意**保留原 salt**（`:120-123`）。

身份库作为**第 4 个加密域**织入，改动只有三处：

1. 步骤 3 附近加 `const identityRaw = await getAllIdentityRaw();`
2. 步骤 8 附近加 `const reEncryptedIdentity = await reencryptAll(identityRaw, oldKey, newKey);`
3. 步骤 11 的**同一次原子 `set`**（`:141-151`）里加 `[STORAGE_KEYS.IDENTITY]: reEncryptedIdentity`

**必须并入同一次原子写**，不能事后补一次 `set`：若密码已切新钥而身份库写入失败，PII 会永久不可解。

**不变量（必须有测试）**：`getAllIdentityRaw()` 抛错时，整次 rekey 在任何写入发生**之前**中止。因为读取被安排在步骤 3，这个性质由代码顺序天然保证，测试负责把它钉死。

解密失败的单条记录**原样携带**（不清空、不丢弃），计入返回告警数——与 `passwordCrud.ts:468` 跳过但不回写的口径一致。

### 4.4 锁定与会话失效（2 个汇聚点，不是 v1 说的 3 个）

已核实三条失效通道最终汇聚到**两个**函数：

- `handleSessionExpired` ← window `'sessionExpired'` 自定义事件（`App.vue:744`，移除于 `:766`）+ runtime `SESSION_EXPIRED` 广播（`useRuntimeMessageHandler.ts:44-46`，经 `App.vue:731-738` 注入；广播方在 `backgroundServices.ts:728`，另见 `:557,835`）
- `checkAuth` 的会话失效分支 ← `useStorageWatcher` 的 `onAuthChange`（`App.vue:724-728`；`adoptRekeyedSession` 在 `useStorageWatcher.ts:55-59`，由 `:53-54` 的 wrappedKey 变更守卫）

在这两个函数里各加一行 `identityVault.teardown()`，即覆盖全部三条通道。`teardown()` 做四件事：清空 `rows`、清 `revealedIds`、关闭两个弹窗、拒绝未重载前的保存动作。会话密钥更新后用新密钥重载列表。

**实现时须现场确认** `checkAuth` 的失效分支位置——本轮核实只确认了调用链，没逐行读 `checkAuth` 内部。

### 4.5 复制与自动清除

- 机密字段（`idNumber`/`cardNo`/`cardCvv`/`secret` 自定义字段）→ **必须** `utils/clipboard.ts:122-133` 的 `copySecretToClipboard(text, onCleared)`。自动清除时长是**用户可配**的（`getClipboardConfig()` `:96-113`，默认 30s，配置入口 `ClipboardSettingDialog.vue:95`），不要写死 30s。清除前校验在 `clearClipboard:37-50`（内容被替换则跳过，失焦时尽力而为）。
- 非机密字段（`name`/`email`/`address`）→ `copyTextToClipboard:143-153`。
- **一期不提供「复制整条」**。因为 `copyTextToClipboard:147` 会调 `cancelPendingClipboardClear()`，混合复制机密+非机密字段时顺序错了就会削弱机密清除（v1 已识别此陷阱）。逐字段复制不存在该问题，直接砍掉整块复制比写顺序规则更安全。列为 Phase 2（R12）。
- 反馈复用既有 key，不新增文案：成功 `ElMessage.success(t('options.detail.copied'))`（`options.json:46`）、失败 `ElMessage.error(t('message.copyFailed'))`、自动清除回调 `ElMessage.info(t('fill.clipboardCleared'))` / `ElMessage.warning(t('fill.clipboardClearFailed'))`——完全照 `PasswordDetailDrawer.vue:303-338`。
- **不发桌面通知**（`chrome.notifications` 文本会滞留系统通知中心）。既有复制反馈也一律用 `ElMessage`，无图标替换、无行内文案。

### 4.6 备份与恢复（独立容器，零改动既有路径）

`utils/identity/backup.ts` 自带容器，参数与 `.aph` 对齐但实现独立：`SALT_LENGTH=16`、`IV_LENGTH=12`、`PBKDF2_ITERATIONS=600_000`（SHA-256）、布局 `salt ‖ iv ‖ ciphertext`（对标 `backupExport.ts:6-13` 常量与 `:80-84` 拼装）。

- **导出**：`exportIdentityBackup(entries, masterPassword)` → 下载 `identity_backup_<dateStr>.aphid`（命名对标 `backupExport.ts:92` 的 `backup_${dateStr}.aph`），明文 JSON 含 `{ kind:'aphid', version:1, exportedAt, count, records }`，随机 salt/IV。
- **`records` 必须保留 `id`——这是与 `.aph` 的一处刻意差异**。已核实 `backupExport.ts:16-21` 的 `BackupData.entries` 类型是 `Omit<PasswordEntry, 'id' | 'order'>[]`，即 `.aph` **主动剥掉 id**，每次导入都生成新 id。密码库能这么做是因为它有 `removeDuplicates`（`App.vue` 的 `case 'removeDuplicates'`）兜底，且导入场景通常是跨设备/跨浏览器迁移，本来就该视为新条目。身份库两条都不成立：一期无去重工具，且最可能的场景是**同一个用户重复导入同一份备份**（换机、误操作、验证备份可用性）——若剥掉 id，30 条 PII 会变成 60 条重复记录，且因为 `category` 与所有字段都在密文里，用户**无法用肉眼去重**。故 `.aphid` 保留 `id` 作为跨备份的稳定身份，导入时按 `id` 合并。
- **导入**：弹窗内导入入口 → `el-upload drag accept=".aphid"` + 代码内二次校验扩展名（照 `BackupImportDialog.vue:34,272-279`）→ 解密 → 校验 `kind === 'aphid'` → **预览条数与类别分布，不预览明文值** → 确认后按 `id` 合并（同 id 取较新 `updateTime`，其余追加）→ **必须显式报告「新增 N 条 / 更新 M 条 / 跳过 K 条（较旧）」**，不得静默合并。静默合并会让用户无法判断这次导入到底改了什么，而身份库没有历史版本可回看。
- **交叉防护（单向精确，如实记录）**：
  - `.aph` 喂给身份导入 → 我们控制这一侧，`kind` 缺失/为 `'aph'` 时给精确文案「这是密码备份，不是身份信息备份」。
  - `.aphid` 喂给密码导入 → 走 `backupExport.ts:136` 既有的 `!backupData.version || !Array.isArray(backupData.entries)` 兜底，报**通用**错误。**安全但不精确**，这是决策 6（零改动）的自觉代价。`BackupData`（`:16-21`）本来就没有 `kind` 字段，加精确文案必须改它。

---

## 五、校验规则（`utils/identity/validators.ts`，纯函数 + 单测）

### 5.1 两级严格度（v2 原为一级硬阻止，是设计缺陷，本版修正）

校验分两类，**不可混为一谈**：

- **格式类**（长度/字符集明显非法）→ **阻止保存**
- **校验位类**（mod 11、Luhn）→ **非阻塞警告，允许保存**

理由：真实用户会存**护照号、港澳台通行证、外籍证件号**（没有 GB11643 校验位），以及**社保卡、公交卡、门禁卡**（不过 Luhn）。硬阻止等于这些人根本存不进去。**误杀合法数据的代价 > 放过一个用户自己看得见的错字**，而校验位提示仍保留防错价值。

警告用表单内联 warning 文案或 `el-alert`，**不弹模态确认**（全仓无此先例，且每次保存都弹摩擦过高）。

### 5.2 规则表

| 字段 | 规则 | 级别 | 失败处理 |
| --- | --- | --- | --- |
| 证件号码 | `^\d{17}[\dXx]$` → 权重 `[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2]` 加权和 mod 11 → 校验码表 `"10X98765432"`；出生段须为合法日期；地区码段非 `0000` | **校验位类** | **警告**，允许保存 |
| 证件号码 | 长度/字符集明显不符（如含字母于非末位） | 格式类 | 阻止保存 |
| 银行卡号 | 13–19 位数字 + Luhn（右起偶位翻倍、>9 减 9） | **校验位类** | **警告**，允许保存；不做 IIN/BIN 前缀归属校验（易误报） |
| 有效期 | `^(0[1-9]|1[0-2])\/\d{2}$` | 格式类 | 格式错阻止；已过期只**告警**不阻止 |
| 手机号 | 宽松 `^\+?[\d\s-]{6,20}$` | 格式类 | 阻止保存 |
| 邮箱 | `^[^\s@]+@[^\s@]+\.[^\s@]+$` | 格式类 | 阻止保存 |
| CVV | 3–4 位数字 | 格式类 | 阻止保存 |

**字段标签用「证件号码」，不用「身份证号」**：`category: 'id_card'` 的语义本就是「证件」，标签写死「身份证号」会把非中国身份证用户挡在门外。helper text：「中国大陆居民身份证会做校验位检查；护照、通行证等可忽略警告」。

### 5.3 实现约束

**邮箱校验就地写，不 import**：已核实 `utils/formValidators.ts` **没有** email 校验器（只导出 `PASSWORD_FIELD_MAX_LENGTH:17`、`createUrlValidator:28`、`createPasswordFormRules:75`），该正则实际在 `utils/emailBackup.ts:69-72`。反向依赖备份模块会制造跨域耦合，故在 `validators.ts` 内写同一正则并注明来源。

`validators.ts` 保持零 i18n / 零 Vue，错误消息由 `formRules.ts` 的 `createIdentityFormRules(t)` 负责翻译——这样 validators 可脱离 i18n 单测，对标 `passwordStrengthCore.ts:1-16` 明写的口径。

**返回值须能区分两级**：validator 返回 `{ level: 'error' | 'warning', messageKey: string }` 而非布尔，`formRules.ts` 据此决定是阻止还是仅提示。

**CVV 的处理**：保留字段，但在表单内用常驻 `el-alert`（`el-alert` 已在 options 使用）说明「CVV 属高敏信息，存储会扩大单点泄露后果」。若决定不存 CVV，删 1 个可选字段即可，见开放问题 Q1。

---

## 六、UI 与交互规格（全部对齐已核实的真实惯例）

### 6.1 入口

`HeaderBar.vue` 的**数据管理下拉**（`:69-136`，`el-dropdown trigger="click"`，emit `dataCommand`）追加：

```
<el-dropdown-item command="identityVault" :icon="..." divided>
```

位置靠近回收站项（`:128-133`）。`App.vue:445-475` 的 `handleDataCommand` switch 加 `case 'identityVault'`。

**必须走主密码复验门槛**：镜像 `App.vue:432-439` 的 `openTrashWithVerify()`——它调用 `utils/masterPasswordVerify.ts` 的 `promptAndVerifyMasterPassword(title, prompt)`，拿到主密码后**刻意不使用**，只用来判定「是否放行」，是一道**纯门槛**；验证通过才 `showTrashDialog.value = true`。对比 `handleEncryptedBackupExport`（`App.vue:410-427`）用同一个 helper 但**确实需要**那个密码去派生备份密钥。身份库照抄纯门槛形态：

```ts
const openIdentityVaultWithVerify = async (): Promise<void> => {
  const masterPassword = await promptAndVerifyMasterPassword(
    t('identity.verifyTitle'),
    t('identity.verifyPrompt'),
  );
  if (!masterPassword) return;
  showIdentityVaultDialog.value = true;
};
```

`MasterPasswordVerifyDialog` 已挂载于 `App.vue:225`，无需新增挂载点。这是本产品对敏感数据视图的既有约定，v1 完全遗漏。

**威胁模型要说清楚**：Options 页本身已在 `App.vue:33` 的认证守卫之后，能走到下拉菜单说明会话已解锁。所以这道门槛**不是**防未认证攻击者，而是防「浏览器已解锁但用户离开座位」——旁人可以打开 Options 看到密码列表（需逐条点眼睛），但不该能一次性看到全部身份证与银行卡。摩擦可接受：证件号/卡号查询是低频动作（填表、办业务时），不像密码填充那样每天多次。

> 修正 v1：HeaderBar 自身**没有** `v-if="isAuthenticated"`，守卫在 `App.vue:33`（包裹 `<HeaderBar>` 于 `:37`）；「安全体检」是顶层按钮（`:55-68`），而**回收站是下拉项**，不是按钮。所以身份库做下拉项，不做顶层按钮。

### 6.2 弹窗骨架

`IdentityVaultDialog.vue`，照 `TrashDialog.vue` 契约：

```ts
const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
```
（逐字对标 `TrashDialog.vue:139-147`）

- `el-dialog width="760px" align-center :close-on-click-modal="false"`（`:close-on-click-modal="false"` 在 16 个 options 弹窗里是**普遍**约定；`align-center` 见 `TrashDialog.vue:5`、`PasswordFormDialog.vue:2-10`）
- **宽度用固定 px，不用 `min(760px, 92vw)`**——已核实全仓 options 弹窗无一处 `vw`（920/720/600/500）
- body 包裹全局类 `.dialog-body-scroll`（非 scoped 定义于 `App.vue:793-812`，max-height:70vh + 4px 细滚动条）
- `@closed` 复位：`revealedIds`、`keyword`、`categoryFilter`（对标 `PasswordDetailDrawer.vue:400-403,413` 的 `passwordVisible` 复位）
- footer 用 `<template #footer>` + `.dialog-footer`，`space-between`：左侧导出/导入，右侧关闭（对标 `TrashDialog.vue:103-115` 的「危险动作左 / 关闭右」）
- 经 `defineAsyncComponent` 加载（`App.vue:244-265` 已有 16 个）→ 首屏零成本

### 6.3 布局

单栏，**不做左右双栏**（options 弹窗无此先例）：

1. 顶部一行：`el-radio-group` + `el-radio-button` 类别过滤（全部 / 个人 / 证件 / 银行卡 / 地址）。**不用 `el-tabs`/`el-segmented`**——已核实二者全仓未使用，会引入新 EP 组件与新视觉；`el-radio-group`/`el-radio-button` 已在 `PasswordFormDialog` 用过。
2. 同排或次排：`el-input` 搜索框，`:prefix-icon="Search"` + `clearable`（对标 `SearchFilterBar.vue:3-9`）。
3. 主体：条目卡片列表。卡片样式照抄 `PasswordTable.vue:375-382`：`background:white; border:1px solid var(--aph-surface-line); border-radius:8px; box-shadow:0 1px 4px rgb(var(--aph-primary-rgb)/8%)`；hover `translateY(-2px)` + 0.2–0.3s ease（`:392-399`）。
4. 卡片展开为字段行：`el-descriptions :column="1" border` + `.detail-value`（照 `PasswordDetailDrawer.vue:50-86`）。

**加载/空/错三态**（照 `TrashDialog`）：`v-loading` 于列表容器（`:27-33`）；空态用居中 `el-empty` + min-height 200px（`:12-17`），**不复用 `components/options/EmptyGuide.vue`**——已核实它绑死密码 onboarding（`App.vue:83-88` 把 `import`→ImportDialog、`restore`→BackupImportDialog）；错误用 `logger.error` + `ElMessage.error`（`:214-216`）。

**备份提醒条**（缓解 R8）：列表上方常驻一条 `el-alert type="info" :closable="false"`——「身份信息不会自动备份，请定期导出」。**仅在 `rows.length > 0` 时渲染**，空库不啰嗦（空态已有引导）。不设关闭按钮，因为关闭状态需要持久化，见 R8。

### 6.4 掩码与显隐

- 掩码统一 `'*'.repeat(8)`（`PasswordTable.vue:43`、`PasswordDetailDrawer.vue:70`、`BackupImportDialog.vue:132` 三处一致）。
- 眼睛图标沿用全仓逐字重复的约定：掩码态显示 `View`（点击展开），明文态显示 `Hide`（点击隐藏）——`PasswordTable.vue:45-51`、`PasswordDetailDrawer.vue:72-78`。
- `:aria-label` 随状态切换，对标 `PasswordTable.vue:48` 的 `:aria-label="row.showPassword ? t('common.hidePassword') : t('common.showPassword')"`；身份库用 `identity.hide`/`identity.show`（`common.*Password` 文案含「密码」，不适用）。
- **无自动回掩定时器**（决策 7）。复位时机：弹窗 `@closed` + `teardown()`。
- 显隐状态放 `revealedIds: Set<string>`（composable 内），不进 payload、不落盘。

### 6.5 表单弹窗

`IdentityFormDialog.vue`，照 `PasswordFormDialog.vue`：

- `el-dialog width="600px" align-center` + `@closed="$emit('closed')"`（`:2-10`）
- `el-form :model :rules label-width="100px" size="large"`；`el-input` 带 `clearable` + `maxlength` + `show-word-limit`；备注用 `type="textarea"`；自定义字段 `secret` 用 `el-switch`
- **`category` 是「默认字段集」，不是「笼子」**。默认展开：person → name/phone/email/address；id_card → name/idNumber/phone/address；bank_card → cardHolder/cardNo/cardBank/cardExpiry/cardCvv；address → name/address/phone。其余字段收进一个 **「更多字段」`el-collapse`**（先例：`PasswordHealthDialog.vue:118-327`，`v-model="activePanels"`），展开后**所有类别都能看到全部字段**。理由：真实记录天然跨类别——一张银行卡也有预留手机号与账单地址，一条证件记录也可能要记卡号；若按类别硬裁字段，用户只能拆成两条记录或把信息塞进 `remark`（`remark` 不参与字段级掩码与复制）。
- **切换 `category` 绝不清空已填字段**。所有字段在所有类别下都是可选且始终存在于 `form` model 中，只是渲染位置不同（默认区 vs 折叠区）。这条要写进测试：填 bank_card 的 phone → 切到 person → 切回 bank_card，phone 仍在。
- `remark` 与自定义字段对所有类别恒定可见，不进折叠区。
- 校验：`await formRef.validate()` 内联 EP 字段错误（对标 `usePasswordManagement.ts:407-411`），提交异常落 catch → `ElMessage.error`（`:461-463`），成功 → `ElMessage.success` 后关闭
- footer 右对齐，**取消在左、主按钮在右**（`:221-238`）
- `defineExpose({ formRef })`（`:519`）
- `name` 字段下加 helper text「用作列表标题」（缓解 R11）

### 6.6 删除

`ElMessageBox.confirm` + `type:'warning'` + `error !== 'cancel'` 守卫（逐字对标 `TrashDialog.vue:250-263`）。文案必须明说**不可恢复**（一期无回收站）。

> 废弃 v1 的「输入条目标题前 4 字符」：`IdentityPayload.name` 可选，银行卡/地址条目可能无标题，该交互**无法实现**；且全仓无此先例，破坏性操作一律 `ElMessageBox.confirm`。

### 6.7 搜索与高亮

- 复用 `utils/searchMatch.ts` 的 `matchesKeyword:129` 与 `highlightSegments:153`，渲染经 `components/SearchHighlight.vue`（props `{ text, keyword }`，`:14-19`；纯文本插值，**无 v-html**，无转义风险；命中样式 `:39-42`）。
- **拼音匹配白得**：`searchMatch.ts` 自身已内含 `warmPinyinMatcher:56` 的动态 `import()` 与 `pinyinMatcherReady:26`（module-level `shallowRef`，options 首帧后已预热）。复用即获得拼音全拼/首字母匹配，**不新增 chunk 关系**。v1 的「一期不引 pinyin-match」属过度保守。
- 身份库**不得**自行调用 `warmPinyinMatcher`（options 已在 `onMounted` 预热）。
- 机密字段参与匹配但**不高亮**（不在 DOM 留部分明文）：对 `secret` 字段跳过 `SearchHighlight`，只做布尔命中判断。

### 6.8 样式与主题

- 全部取 `assets/theme/tokens.css` 的 `--aph-*`；`scoped`；属性序符合 Stylelint `recess-order`。
- **令牌只有颜色类**（已核实：全仓无 `--aph-radius/shadow/space/font/motion`）。圆角/阴影/间距按各组件硬值，这是本仓真实惯例：6px chip / 8px card / 10–12px panel / 999px pill；页面左右 `margin: 0 32px`；字号 11–16px（12px 提示、13px 次要）；过渡 0.2–0.3s ease。
- 6 套配色：默认晴空蓝在 `:root`，`green/pink/mauve/orange/slate` 经 `:root[data-theme='x']`（`tokens.css:48,71,94,117,140`），由 `utils/theme.ts:148-153` 的 `root.dataset.theme` 应用。新组件只用令牌即自动跟随换肤。
- **无 danger 令牌**：危险色用 Element Plus `type="danger"`（`HeaderBar.vue:288` 用 `#f56c6c`）。
- `prefers-reduced-motion` 降级照 `HeaderBar.vue:491-497`。

### 6.9 可访问性（对齐真实基线，不是理想基线）

- 每个纯图标 `el-button` 都有 `:aria-label`，眼睛按钮的 label 随状态变（`PasswordTable.vue:48,204,218,232,246,260`）。
- 装饰性图标 `aria-hidden="true"`（`HeaderBar.vue:38`、`SiteFavicon.vue:45`）。
- `:focus-visible` 轮廓（`HeaderBar.vue:345-348,414-417`）。
- 焦点陷阱、Esc 关闭交给 Element Plus dialog（本仓既有做法，不自建）。
- 复制反馈用 `ElMessage`（EP 自带 live region），与全仓一致，不额外加 `role="status"`。
- 不只用颜色区分机密/普通字段：机密字段带掩码文本 + 眼睛按钮，本身就是非颜色线索。

### 6.10 Element Plus

仅按需，由 `ElementPlusResolver` 自动引入，**禁整包**。用到的都已在 options 验证过：`el-dialog/el-form/el-form-item/el-input/el-button/el-icon/el-select/el-option/el-radio-group/el-radio-button/el-switch/el-tooltip/el-tag/el-empty/el-alert/el-descriptions/el-descriptions-item/el-divider/el-upload/el-collapse/el-collapse-item`（最后两个见 `PasswordHealthDialog.vue:118-327`）。`ElMessage`/`ElMessageBox` 全局自动导入。**不引入** `el-tabs`/`el-segmented`/`el-tree`/`el-timeline`（全仓未用）。

---

## 七、一期明确不做（Phase 2 候选）

页面对接（自动填充/字段识别）、侧边栏/popup/右键/快捷键入口、变更历史、安全体检纳入、去重/批量标签/拖拽排序（`order` 字段）、复制整条、CSV/JSON 明文导出、独立恢复码、`PASSWORD_CACHE_SNAPSHOT`（**永不做**——那会把 PII 明文放进 SW 热路径的会话快照）。

**Phase 2 并列首项（两项）**：

1. **回收站与软删除**（缓解 R7：一期误删即真删）。
2. **自动备份提醒纳入身份库**（缓解 R8）。这是**独立性约束唯一造成真实用户损害**的地方：`backgroundServices.ts:336-344` 的提醒只统计 `PASSWORDS`，`:340-343` 在 count 为 0 时直接 return，`utils/emailBackup.ts` 的邮箱备份同样只覆盖密码——于是一个只存身份信息、不存密码的用户**永远不会被提醒备份**，而 PII 恰恰是最难重建的数据（密码可以改，身份证号不能）。修法只需在该处把身份库计数并进去，约 3 行。它被推迟的原因是边界 3（`entrypoints/background/**` 功能代码零改动）而非难度，因此一旦独立性验收通过就应优先补上。

---

## 八、风险登记

| # | 风险 | 缓解 |
| --- | --- | --- |
| R1 | 换主密码漏掉身份库 → PII 永久不可解 | `identityRekey.test.ts` 断言：旧钥解密失败、新钥成功、原子 `set` 含 `IDENTITY`、`getAllIdentityRaw` 抛错时无任何写入。评审死盯 `changeMasterPassword.ts:141-151` |
| R2 | 锁定后解密 PII 残留 Options 内存 | 2 个汇聚点 `teardown()` + 弹窗 `@closed` 复位；逐通道测试 |
| ~~R3~~ | ~~备份容器抽取引入回归~~ | **已消除**：决策 6 零改动 `backupExport.ts`，无抽取即无回归面 |
| R4 | 两标签页并发改写互相覆盖 | `updateTime` 并发令牌 + 拒绝并提示刷新（`optionsPageManager.ts:80-88` 证实多标签是真实场景） |
| R5 | 一把数据密钥同时守密码与 PII | 已选定取舍。隐私说明须如实描述，并说明会话数据密钥的既有落盘机制（WRAP_KEY 持久化以支持浏览器重启保持登录）同样覆盖身份库 |
| R6 | `storageKeys.ts` 在 sidepanel 依赖图里（`useSidepanelData.ts:12` 引用、`:202` 使用某键），加常量会让共享 chunk 字节 hash 变化 | 属内容变化非行为变化。以「产物文件清单 + `modulepreload` 闭包 + bench 基线」三项验证。先例：回收站提交同样加了 2 个键（+4 行）。不为此破坏注册表单一事实来源 |
| R7 | 一期无回收站，误删即真删 | 复用 `trashManager.ts` 不可行（与 `PasswordEntry` 深度耦合：直接读写 `STORAGE_KEYS.PASSWORDS`，牵连 `passwordHistory`/`reminderManager`）。缓解：`ElMessageBox.confirm` 文案明说不可恢复；回收站列 **Phase 2 并列首项**（§七） |
| R8 | 自动备份提醒只统计 `PASSWORDS`（`backgroundServices.ts:336-344`，count 0 时 `:340-343` 直接跳过），纯身份用户永不被提醒；邮箱备份（`utils/emailBackup.ts`）同样只覆盖密码 | **独立性约束造成的唯一真实用户损害**（PII 不可重建，密码可以改）。一期缓解：弹窗内常驻一条 `el-alert`（有 ≥1 条记录时显示）「身份信息不会自动备份，请定期导出」+ 导出入口放 footer 常驻可见；README/ARCHITECTURE 如实说明现状。**刻意不做「首次保存后一次性提示」**——那需要持久化「已提示过」状态（新增 storage 键或写进 config，都是额外耦合），零状态的常驻提示更便宜也更可靠。根治列 **Phase 2 并列首项**（§七，约 3 行） |
| R9 | 无明文残留扫描网覆盖 `IDENTITY` | 已核实 `sessionManager-storage.ts:376-443` 只覆盖 `PASSWORDS`（连 TRASH/HISTORY 都不覆盖），本仓真实不变量是「写路径保证恒加密」。身份库沿用并加强：写路径无密钥抛错、读路径遇非字符串 `encryptedPayload` 跳过 + `logger.warn` |
| R10 | manifest 描述已写满，无法宣告新能力 | zh **131/132** 码点、en **130/132**（文案在 `public/_locales/*/messages.json`，`wxt.config.ts:88` 只是 `__MSG_extensionDescription__`，`:87` 有 132 上限注释）。叠加 CWS keyword-stuffing 驳回史，**不动 manifest 描述**。新能力只落 README / ARCHITECTURE / CWS 长文说明（余量充足）/ privacy.html |
| R11 | 统一掩码（决策 8）导致两张无姓名的银行卡在列表里无法区分 | `displayTitle` 回退链：`name ?? cardHolder ?? email ?? phone ?? t('identity.category.'+category)`；表单 `name` 字段加 helper text「用作列表标题」。若后续需要，可加**仅显示态**的后 4 位（不落盘、不参与搜索高亮），属独立决策 |
| R12 | 砍掉「复制整条」损失便利 | 规避 `copyTextToClipboard:147` 的 `cancelPendingClipboardClear()` 顺序陷阱，比写顺序规则更安全。Phase 2 若要恢复，必须先复制非机密再复制机密 |
| R13 | CVV 落盘扩大单点泄露后果 | 表单常驻 `el-alert` 警示；`secret` 语义使其默认掩码且走 `copySecretToClipboard`。是否保留该字段见开放问题 Q1 |

---

## 九、验证矩阵（对应 `agents.md`）

1. **S0 基线冻结（动工前）**：`pnpm build` 后记录 `.output/chrome-mv3/` 中 sidepanel/popup/content 的**文件清单与大小**；`pnpm exec vitest run benchmarks/sidepanel-p0.bench.ts`（已核实该文件存在，`benchmarks/` 下仅此一个）记录基线。
   > v1 写的 `pnpm diff` **不存在**（`package.json` 无此脚本）。产物对比改为手工比对文件清单 + `pnpm analyze`。
2. **单测**：`pnpm test:run` 全量（涉存储/会话/rekey 跨入口边界）。新用例须覆盖：
   - 成功路径；失败路径（`getAllIdentityRaw` 抛错则放弃写、无密钥拒绝保存）
   - 旧数据兼容（无 `IDENTITY` 键 → 空列表；`pv` 未知键经编辑后保留）
   - 读路径不变量（`encryptedPayload` 非字符串 → 跳过 + 不回写）
   - 边界（条数上限、字段长度上限 `MAX_FIELD_VALUE_LEN=200`、最坏情况总体积 < 1MB、有效期过期只告警）
   - **两级校验**：校验位类失败只返回 `level:'warning'` 且**仍能保存**——必须有用例覆盖「护照号/港澳台通行证（无 GB11643 校验位）」与「社保卡/门禁卡（不过 Luhn）」两类合法数据；格式类失败返回 `level:'error'` 并阻止保存
   - `.aphid` 往返 + 拒绝 `.aph`；`.aph` 导入遇 `.aphid` 走既有兜底不崩
   - **`id` 稳定性**：同一份 `.aphid` 连续导入两次 → 条数不变（不产生 60 条重复 PII）；导入结果计数 `{ added, updated, skipped }` 正确
   - rekey 全链路（含 R1 的四条断言）
   - 并发令牌（`updateTime` 不匹配被拒）
3. **静态检查**：`pnpm typecheck`、`pnpm lint`（`--max-warnings 0`）、`pnpm lint:style`、对改动的 JSON/文档跑 `pnpm exec prettier --check <files>`。**不用**全仓 `pnpm format`/`pnpm fix:all`。
4. **构建**：`pnpm build` + `pnpm build:firefox`；`pnpm analyze` 确认 `components/options/Identity*.vue`、`composables/useIdentityVault.ts`、`utils/identity/**`（含 `backup.ts`）**只出现在 options chunk**。
5. **独立性硬检查**（两层：源码 + 产物）：
   - **源码层**：`git diff --name-only` 与「禁改清单」求交集 = ∅；改动文件集 ⊆ 「允许改动的 8 个既有文件 + 新增文件」。
   - **产物层**：新增 `tests/build/sidepanelClosure.test.ts`——读 `.output/chrome-mv3/sidepanel.html` 的全部 `<link rel="modulepreload">`，递归展开每个 chunk 的 import 闭包，断言其中**不含任何 identity 相关 chunk**；`.output` 不存在时整文件 `describe.skip`（该测试依赖先跑过 `pnpm build`）。这把独立性保证从「靠评审逐行看 diff」升级为「CI 可执行」，也是 R6 的唯一可靠验证手段：`storageKeys.ts` 所在共享 chunk 的**字节 hash 变了不可怕，闭包成员变了才是事故**。
6. **浏览器实测**（Windows 慢盘路径可用 DevTools 限速复现）：
   - **主密码复验门槛**：下拉项点开 → 弹 `MasterPasswordVerifyDialog`；取消 → 身份库弹窗**不得**打开；验证通过 → 打开
   - 新增/编辑/删除/类别过滤/搜索（含拼音）/掩码/眼睛显隐
   - **「更多字段」折叠区**：展开后跨类别字段可见可填；**切换 `category` 后已填值不丢**（填 bank_card 的 phone → 切 person → 切回，phone 仍在）
   - 单字段复制 → 到配置的清除时长后自动清除提示出现；中途复制别的内容则不误清
   - `.aph` 老备份导入不受影响；`.aphid` 导出 → 改主密码 → 导入可解；**同一份 `.aphid` 导入两次不产生重复条目**，且导入后能看到「新增/更新/跳过」计数
   - 弹窗打开时经 **4 种触发场景**（popup 手动锁 / 闲置锁定 / 会话过期 / 另一标签页改密，对应 §4.4 的 3 条通道与 2 个汇聚点）触发锁定 → 列表不得残留任何明文
   - 中英切换后标签、校验文案（含两级：error 与 warning）、aria-label 完整
   - 有身份数据时侧边栏冷启动与快速重启仍 <1s 无白屏
   - 6 套配色下卡片边框/阴影/文字对比度正常（令牌只有颜色，须逐套看）
7. **交付说明**须含：改了什么、为何是这 8 个既有文件改动、执行的验证、仍存风险（R7/R8/R11/R12/R13 与 Phase 2 未做项）、HelpDialog 豁免的理由、Q1–Q4 各自的最终取舍，以及 `auth.resetConfirm` 属**用户可见文案变更**（已获确认后才改）。

---

## 十、实施顺序（每步可独立审查）

| 步 | 内容 | 可验证产物 |
| --- | --- | --- |
| **S0** | 基线冻结：产物清单 + bench；**同时写好 `tests/build/sidepanelClosure.test.ts`** | 一份基线记录；闭包测试在**尚无任何 identity 代码**时就应通过（先证明测试本身有效，再让它去守后续步骤） |
| **S1** | 数据层：`utils/identity/{types,constants,validators}.ts` + `utils/storage/identityCrud.ts` + `storageKeys.ts` 加键 + 单测 | 无 UI 即可全绿 |
| **S2** | `utils/identity/backup.ts`（自带容器）+ 单测 | **不触碰 `backupExport.ts`**，`.aph` 行为零变化 |
| **S3** | rekey 织入（约 6 行）+ `identityRekey.test.ts` + `auth.resetConfirm*` 文案（先核实 `clearAllData()`） | 全量测试绿 |
| **S4** | UI：`formRules.ts` + `useIdentityVault.ts` + 两个组件 + `identity.json`×2 + `bundles/options.ts` + `BUNDLE_NAMESPACES` + HeaderBar 下拉项 + App.vue（async component / case / 复验门槛 / 2 处 teardown） | 浏览器实测 |
| **S5** | 全量验证（含重跑 `sidepanelClosure.test.ts` 做独立性硬检查）+ 文档（§十一）+ 交付说明 | 独立性硬检查通过 |

S1→S2→S3 全程无 UI，可在纯测试环境验证；S4 才开始触碰既有文件（除 S1 的 `storageKeys.ts` 与 S3 的 `changeMasterPassword.ts`）。**整条链路不重构任何既有安全关键代码**，这是 v2 相对 v1 最大的风险面收缩。

---

## 十·补、基线记录（S0 产出，2026-09-16）

> 用途：S5 独立性硬检查的对比基准。hash 会随任何上游改动变化，**只有 module name（`-hash` 前缀）与文件数才是有效对比项**。

**构建**：`pnpm build` → 版本 3.9.0，总产物 1.78MB，zip 610.25kB。入口 HTML：`sidepanel.html` 7324 B / `popup.html` 3533 B / `options.html` 7741 B。

**sidepanel 入口闭包**（1 entry + 25 modulepreload = 26 chunk，按 module name）：

```
rolldown-runtime · logger · storageKeys · i18n · lazyImport · preload-helper
_plugin-vue_export-helper · tokens · css · dist · typescript · message · css
types · browserStartupRelock · configManager · css · a11y · crypto-light
tagUtils · searchMatch · useLocalOperationGuard · totp · preWarmSw · shareCard
```

**popup 入口闭包**（1 entry + 34 modulepreload = 35 chunk，按 module name）：

```
rolldown-runtime · logger · storageKeys · i18n · lazyImport · preload-helper
_plugin-vue_export-helper · tokens · css · dist · typescript · message · tag · css
types · configManager · crypto-light · browserStartupRelock · sessionManager-storage
facades · masterPassword · passwordHistory · reminderManager · trashManager
passwordCrud · passwordStrengthCore · autoSaveManager · storage · css · css
urls · verify · preWarmSw · useShortcuts
```

**bench**（生产 `sortPasswordEntries`，桌面端）：100 条 7,745.60 ops/s（0.1196 ms/op）· 500 条 1,422.71 ops/s（0.6456 ms/op）· 2000 条 346.52 ops/s（2.6583 ms/op）。

**守卫测试**：`tests/build/sidepanelClosure.test.ts` 新建并通过（6 用例）。此刻仓库**无任何 identity 代码**，测试绿 = 测试本身有效；S5 重跑时若变红即证明独立性被破坏。

---

## 十一、文档同步（按 `agents.md` 影响范围口径）

| 文件 | 改什么 |
| --- | --- |
| `README.md` / `README.en.md` | 在 `### 📦 数据管理`（当前 `:137-142`，4 条）追加一条「🪪 身份信息库」。README 是**分类小节**而非编号清单（已核实当前无 `### N.` 形式），故不涉及编号顺延。须守 README 落地页口径：只写产品价值不写技术细节（细节下沉 ARCHITECTURE/CONTRIBUTING）、数值区间用 en-dash 不用 `~`（GFM 会渲染成删除线） |
| `docs/ARCHITECTURE.md` / `.en.md` | 「功能实现详解」新增 **`### 27. 身份信息库`**（本轮复核：当前最后一节确为 `### 26. 双语界面与两套 i18n`，在 `:520`） |
| `docs/CWS_FILL_CONTENT.md` | 长文说明与隐私问答补 PII 类别，**只改事实描述，不加营销卖点**（keyword-stuffing 驳回教训）。注意该文件工作区已有一处未提交的 staged 改动（「不只填表」→「不只填充」），不要覆盖 |
| `privacy.html` | 补身份信息存储与本地优先说明；改完跑 `pnpm gen:privacy-en` 同步英文页 |
| `index.html` | 官网是否展示新能力 → 开放问题 Q2 |

**不改**：`wxt.config.ts`（无新权限、无新命令；描述已迁 `_locales`）、`public/_locales/**`（R10）、`components/sidepanel/HelpDialog.vue` 与 `utils/i18n/locales/*/help.json`（边界 4）。

> 已核实权限清单无需变动：`permissions` = storage/activeTab/scripting/sidePanel/alarms/notifications/idle/clipboardWrite/clipboardRead/webNavigation/contextMenus/favicon（`wxt.config.ts:93-108`），`host_permissions` = `<all_urls>`（`:109`），`commands` 4 条（`:118-147`）。身份库不需要任何新权限，故 CWS 权限理由无需更新，但**隐私披露须新增 PII 类别**。

---

## 十二、已拍板决策（2026-09-16 用户确认「按推荐方案执行」）

| # | 问题 | 决策 |
| --- | --- | --- |
| Q1 | CVV 是否保留？ | **保留** + 表单常驻 `el-alert` 警示（R13） |
| Q2 | `index.html` 官网是否展示身份库？ | **展示**；同步 `pnpm gen:en` 等生成脚本产物并提交（Pages 由 main 分支根目录发布） |
| Q3 | `MAX_IDENTITIES=30` 是否合适？ | **30**。家庭场景通常 <20，提高上限只影响一次解密批大小 |
| Q4 | 自定义字段是否需要「字段类型」？ | **一期只做 `secret: boolean`**，类型化留 Phase 2 |

> 原 Q5（`clearAllData()` 是否为 `storage.local.clear()`）已核实为**是**，转入改动表的确定项。
>
> `auth.resetConfirm` 文案修改（「清空所有数据（含密码、身份信息、回收站与全部设置）」）已获用户明确同意，随 S3 一并落地。

---

## 附录 A：v1 被证据推翻的 16 处假设

| # | v1 的说法 | 核实结果 |
| --- | --- | --- |
| A-1 | `backupExport.ts` 有 `writeContainer`/`readContainer` 可「原样搬出、行为等价搬家」 | **假**。只有常量（`:6-13`）与 `deriveKey`（`:26-42`）是具名函数；容器拼装内联在 `exportEncryptedBackup:48-103`（`:80-84` 拼接），解析内联在 `importEncryptedBackup:109-152`（`:121-124` 切分）。`BackupData:16-21` **无 `kind` 字段**。抽取 = 真重构，故改为决策 6 |
| A-2 | 弹窗宽 `min(760px, 92vw)`，与 TrashDialog 等同惯例 | **假**。16 个 options 弹窗全部固定 px（920/720/600/500），**无一处 `vw`** |
| A-3 | manifest 描述不枚举细粒度能力，故 `wxt.config.ts` 不改 | **结论对、理由错**。`wxt.config.ts:88` 是 `__MSG_extensionDescription__`，枚举在 `_locales`，且 zh 131/132、en 130/132 **已满**。见 R10 |
| A-4 | 入口在 `v-if="isAuthenticated"` 区，与「安全体检」「回收站」同级按钮 | **假**。HeaderBar 无该守卫（在 `App.vue:33`）；安全体检是顶层按钮（`:55-68`），**回收站是数据管理下拉项**（`:128-133`）。且 v1 完全遗漏 `MasterPasswordVerifyDialog` 复验门槛（`App.vue:432`） |
| A-5 | i18n 只需改 `bundles/options.ts` | **不完整**。`tests/utils/i18nBundles.test.ts:25-29` 的 `BUNDLE_NAMESPACES` + 静态 `t('...')` 扫描必须同步，否则测试红。该测试还守卫 zh/en 命名空间文件清单一致（`:110`）与逐命名空间 key 集相等（`:113-117`） |
| A-6 | 删除二次确认「输入条目标题前 4 字符」 | **无法实现**。`name` 可选；全仓破坏性操作一律 `ElMessageBox.confirm`（`TrashDialog.vue:250-263`） |
| A-7 | 邮箱校验复用 `utils/formValidators.ts` 既有模式 | **假**。该文件无 email 校验器；正则在 `utils/emailBackup.ts:69-72`。改为就地写 |
| A-8 | S0/S5 用 `pnpm diff` 对比产物 | **该脚本不存在**（`package.json` 无）。改为手工比对 + `pnpm analyze` |
| A-9 | `utils/optionsPageManager.ts:80-88` | 路径错，实为 **`entrypoints/background/optionsPageManager.ts:80-88`** |
| A-10 | 「一期不引 `pinyin-match` 到该路径，避免新 chunk 关系」 | **过度保守**。`searchMatch.ts` 自身已含 `warmPinyinMatcher:56` 的动态 import 与 `pinyinMatcherReady:26`，options 已在用。复用即白得拼音匹配，零新 chunk 关系 |
| A-11 | 眼睛点开 30s 后自动回掩 | **全仓无任何自动回掩定时器**（唯一自动隐藏常量 `HINT_AUTO_HIDE_MS=5000` 属 content script 提示胶囊，`InlineFillDropdown.ts:518`）。改为决策 7 |
| A-12 | 掩码 `••••` + 末 4 位 | 主流惯例是 `'*'.repeat(8)`（3 处）；`••••••••` 仅 1 处（`PasswordDetailDrawer.vue:189` 历史行）。改为决策 8 |
| A-13 | `copySecretToClipboard` 30s 自动清除 | **不准确**。时长由 `getClipboardConfig()`（`:96-113`）驱动、用户可配（`ClipboardSettingDialog.vue:95`），默认 30s |
| A-14 | 3 处会话失效处理点各加 `teardown()` | 实为 **2 个汇聚点**（`handleSessionExpired` + `checkAuth` 失效分支），三条通道最终收敛于此 |
| A-15 | `MAX_PAYLOAD_BYTES=16_000` 与字段长度上限并存 | **自相矛盾**：满额合法输入最坏 ~19.5KB（CJK UTF-8），会被 16KB 上限拒绝。删掉字节上限 |
| A-16 | 左侧类别分段 + `IdentityFieldRow.vue` | `el-tabs`/`el-segmented` 全仓未用；双栏无先例；字段行已有 `el-descriptions` 范式（`PasswordDetailDrawer.vue:50-86`）。改为顶部 `el-radio-button` + 删掉该组件 |

**v1 中被核实为正确并保留的判断**：一期不做回收站（`trashManager.ts:1` 导入 `PasswordEntry`/`EncryptedPasswordEntry`/`TrashedPasswordEntry`，`:45-48` 直接读 `STORAGE_KEYS.PASSWORDS`，`:4-5` 牵连 `passwordHistory`/`reminderManager`）；不复用 `EmptyGuide.vue`；整块加密优于逐字段；并入 `changeMasterPassword.ts:141-151` 同一次原子 `set`；`storageKeys.ts` 加键（R6 只是 hash 变化，回收站提交有先例）；`getAllIdentityRaw` 抛错约定与 `Promise.allSettled` 跳过不回写（`passwordCrud.ts:53-61`、`:433-479` 逐行核实为真）；`encryptData` 密文自描述（`encryption.ts:149-162`）；不发桌面通知。

## 附录 B：已评估并否决的替代方案

| 方案 | 否决理由 |
| --- | --- |
| 做成第二个扩展 | 各自独立 `storage.local` → 两套主密码/会话/备份/审核，加密+会话+i18n+主题基建重写，用户需记两个主密码 |
| 把身份信息做成 `PasswordEntry` 的第二种 `kind` + `customFields` | 表面最省事（白得 CRUD/rekey/回收站/历史/备份/搜索/表格 UI），但要改 `utils/types.ts`（全仓最共享类型）与 `passwordCrud.ts`（`SENSITIVE_FIELDS`、所有读路径、过滤逻辑），且 sidepanel/popup/content 三处消费方都得加过滤，备份格式与既有测试全受影响 —— **正好摧毁独立性这一首要需求** |
| 为身份库派生独立数据密钥（域分离） | 安全收益为零（同一主密码 → 同一攻击者），成本极高：会话缓存（`getSessionDataKey`）、rekey、WRAP_KEY 落盘全按单数据密钥设计，加第二把要新增会话代码，与「不新增会话代码」的边界 2 冲突。注：`encryption.ts:111` 的 `'aph-verify|'+salt` 是本仓已有的域分离惯用法，将来真需要时可参照 |
| 抽取 `backupContainer.ts` 消除重复 | 见 A-1：无可搬出的函数，属真重构最关键备份路径。若将来仍要消除这 **25 行**重复，必须作为**独立可回滚提交** + `.aph` 黄金向量测试，绝不与功能改动混在一起 |
| 一期就上侧边栏入口 | 可用性收益大，但必须触碰 `entrypoints/sidepanel/**` 与 sidepanel i18n bundle，需重验首屏 `modulepreload` 闭包与 <1s 秒开基线，独立性硬约束作废。留 Phase 2，且届时 HelpDialog/help.json 豁免（边界 4）自动失效 |
| 用 IndexedDB 存身份库（避开 `storage.local` 大对象与共享 chunk） | **致命**。`utils/storage/masterPassword.ts:153` 的 `clearAllData()` 就是 `chrome.storage.local.clear()`——它**清不掉 IndexedDB**，于是用户「重置主密码」后 PII 会静默存活，既违背用户预期又违背 `auth.resetConfirm` 的承诺；要修就得改 `clearAllData()`（触碰认证核心路径）。另外 IndexedDB 在 MV3 service worker 中可用性不稳定，且全仓无一处 IndexedDB 先例，引入即新增一套异步存储范式 |
| 每条记录一个 storage key + 单独索引（`identity_index` + `identity_<id>`） | 结构上消灭 R4（并发写不再互相覆盖）且写入 O(1)，但代价更大：枚举要两次往返，或用 `get(null)`——那会**把整个密码数组一起读进来**，反而更慢也更危险；索引与实际键可能失配产生孤儿记录（需额外一致性修复代码）；且偏离本仓「一个数据域一个数组键」的统一惯例（`PASSWORDS`/`TRASH`/`PASSWORD_HISTORY` 全是数组）。**量化后判定不值**：30 条 × ~15KB ≈ 450KB 最坏、现实约 15KB（多数条目只填 3~5 个短字段），且写入只发生在用户手动编辑 Options 时，**不在任何热路径**——`agents.md` 的「Windows 大对象写入触发杀软扫描」顾虑不适用于此 |
| 按需解密（列表只显示标题，展开某条才解密该条） | 看似能缩短明文驻留时间，但**搜索功能使其不成立**：机密字段（证件号、卡号）必须参与匹配才有用（用户常只记得卡号后几位），而匹配就要先解密。要么砍掉对机密字段的搜索，要么全量解密——一期选择全量解密 + `teardown()` 严格清理（R2），把复杂度放在生命周期而不是加解密时机上 |
| 把 `.aph` 与 `.aphid` 合并成一个容器（一个文件同时装密码与身份） | 这确实能**根治 R8**（备份提醒天然覆盖），也少一套容器实现。但直接违背边界 1（`.aph` 字节格式与导入路径不变）与决策 6（`backupExport.ts` 零改动），且会让「只想备份身份信息」的用户被迫导出全部密码——对一个把明文导出面收窄到「无」的产品是倒退。R8 改用 Phase 2 补 3 行提醒逻辑来解 |
