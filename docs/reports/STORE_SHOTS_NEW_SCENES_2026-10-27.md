# 商店截图待补场景工单（2026-10-27 建立 → **同日已落地**）

> ✅ **2026-10-27 结案**：两张新图（`screen-15-identity-vault` / `screen-16-onboarding-recovery`，中英共 4 张母版）已随**整批重拍**一起产出，中英各 16 张、徽章统一 v3.20.0，第五节那条 A/B 走的是 **A**（整批按新版本重拍，不留混版）。下面「为什么没做」保留原样，它是这份工单当时的事实；三条硬缺口的实际处置见文末「落地记录」。

北极星是商店安装量，而 listing 首屏的截图是点击率的主变量。本轮要把两条已上线的新能力补进商店素材：

1. **个人信息库**——它已在文案里（中英说明各一处），但 14 张图里一张都没有，读图的人看不到第四类数据域。
2. **新手引导「留退路」→ 登记离线恢复密钥**——引导已在文案与【功能全览】里，同样无图。

本轮**没有实现这两张图**，原因是产线有两个硬缺口（都在下面「为什么没做」里给了可核对的证据）。这份工单把改动点写到位，下一次接手可以一次跑完并当场验证。

## 为什么没做（不是不想做，是这样做会留下没人验过的东西）

| 缺口                                                 | 证据                                                                                                                                                                                                          | 后果                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 种子数据不含个人信息                                 | [seed.mjs](../../scripts/store-shots/seed.mjs) 全文只写 `PASSWORDS` 相关状态，`STORAGE_KEYS.IDENTITY`（`personal_identity_infos`，见 [storageKeys.ts:58](../../utils/storageKeys.ts#L58)）从未出现在种子里    | 直接拍只会得到**空库态**，等于给商店素材放一张空白页，比不放更伤点击率                                                        |
| 个人信息是**第 4 个加密域**，整块 `encryptedPayload` | [identityCrud.ts](../../utils/storage/identityCrud.ts) 的写路径要求会话数据密钥，且 `saveIdentity` 现在排在提交锁内（见 [docs/ARCHITECTURE.md §3、§27](../ARCHITECTURE.en.md)）                               | 种子必须走**加密写**（用演示主密码派生的数据钥），不能 `storage.local.set` 明文数组——明文塞进去会被读侧当坏数据，弹出复验失败 |
| 输出目录硬编码                                       | [capture.mjs:41](../../scripts/store-shots/capture.mjs#L41) `const OUT_DIR = resolve(HERE, '../../assets/cws-store')`                                                                                         | 任何一次试跑都会**覆写 28 张已提交母版**（中英各 14），把「试一下」变成整批二进制变更                                         |
| 引导图需要全新 profile                               | [README](../../scripts/store-shots/README.md) 写明 `firstrun` 必须换全新 profile；引导只在首次设置主密码后自动播放，`retreat` 在剧本里排第 7 项（首启态下被 `pickSteps` 过滤后实测是 **06/09**，不是第 4 步） | 不能复用 seeded profile，需要「首启 → 设主密码 → 走到第 4 步停下」的独立编排                                                  |

## 改动点（按这个顺序做，每步都能单独验）

### 1. 给种子加个人信息演示数据 —— `scripts/store-shots/seed.mjs`

- 新增常量 `DEMO_IDENTITIES`：3–4 条，字段全部用 `example.com` 体系的占位值，**不含任何真实姓名/证件号/卡号**（例如「张三 / 11010119900307XXXX / 6222 0200 XXXX XXXX」这类明显占位形态，卡号需过 Luhn 才不会触发校验告警气泡，可用文档里既有的示例卡号）。
- 写入方式必须走**扩展自己的加密写**：在演示页上下文里调用已注入的存储层（或复用 `seed.mjs` 现有「在扩展页面里 eval 一段脚本」的路子），逐条调 `saveIdentity()`，确保落盘形状是 `id / encryptedPayload / createTime / updateTime` 四键；不要手写 `chrome.storage.local.set({ personal_identity_infos: [...] })`。
- 复验策略先设成 `followValidity`（`identity_vault_access_config`），否则截图会被「输入主密码」的弹窗挡下来。截完必须还原成默认 `perSession`——**别把这个默认值改动提交上去**，它是有安全语义的默认档（见 [ARCHITECTURE §27](../ARCHITECTURE.md)）。

### 2. 新增两个场景 —— `scripts/store-shots/capture.mjs`

复用现成的 `captureOptions(ctx, fileName, onReady)`（同文件 :325），它已经处理「开管理页 → 解锁 → 切语言 → 截图 → 合标题带」。

- `screen-15-identity-vault`：`onReady` 里点管理页头部的「个人信息库」入口（按 label 走 `clickByLabel`，标签文案取 `UI[LANG]`），等 `IdentityVaultDialog` 出现并留出动画时间，截图。画面要落在**默认掩码态**（机密字段带掩码 + 一张展开、一张折叠），这才对得上文案里的「默认掩码」。
- `screen-16-onboarding-recovery`：走全新 profile 的 `firstrun` 分支——设完主密码后引导自动播放，用键盘 `ArrowRight` × 3 走到 `retreat` 那一步再截。**刻意不要把恢复设置弹窗一起截进来**：那一屏的焦点应该在「留退路」这句话本身。
- 两种语言各跑一遍（文件名后缀由 `C.suffix` 负责，见 :61）。

### 3. 标题带文案 —— `scripts/store-shots/copy.mjs`

按现有 `login / totp / env / audit / trash` 的形状加 `identity` 与 `tour` 两组（中英各一份）。红线与商店文案同源：**零竞品品牌名、零绝对化表述**（禁词表以 [CWS_PUBLISHING_GUIDE.md](../../store/CWS_PUBLISHING_GUIDE.md)「快速校验命令」里的 `banned` 为唯一真源，不要自己另列一份），图片里的文字同属商店元数据，会被同一套 `banned hits` 扫描判。

- 建议中文：`个人信息库：证件号、银行卡单独成库，默认掩码` / `新手引导：第一步就把退路留下——离线恢复密钥当场登记`
- 建议英文：`Personal info vault: IDs and cards in their own encrypted store, masked by default` / `The first-run tour leaves a way out — enrol an offline recovery key on the spot`

### 4. 跑起来（照 README 的三条前置）

```bash
pnpm build                      # 截图右上角徽章取自构建产物的 manifest.version，必须与要提交的包一致
node scripts/store-shots/demo-server.mjs &
# 起带 CDP 的 Chrome（--enable-unsafe-extension-debugging，关代理，全新 profile 留给 firstrun）
node scripts/store-shots/capture.mjs .output/chrome-mv3 seeded  zh
node scripts/store-shots/capture.mjs .output/chrome-mv3 seeded  en
node scripts/store-shots/capture.mjs .output/chrome-mv3 firstrun zh
node scripts/store-shots/capture.mjs .output/chrome-mv3 firstrun en
node scripts/store-shots/export-upload.mjs   # 派生商店真正收的 1280×800 无 alpha 版
```

**跑之前先做一件事**：把 `assets/cws-store/` 整目录复制一份到临时位置或先 `git stash` 当前图片改动，确认只新增 4 张（`screen-15/16` × 中英）而**没有改动既有 28 张**。若试跑把好图覆盖了，用 `git checkout -- assets/cws-store/` 复原（这条命令只在这批文件没有你自己的未提交改动时才安全）。

### 5. 版本徽章这条时间账

现存母版是 2026-10-13 整批重拍的，徽章写着 **v3.15.2**，与当时在架版本一致；今天在架是 **v3.18.0**。补拍的两张会带新徽章，于是出现**同一 listing 里两种版本号**——这正是手册里点名的「截图版本与商店版本不符」翻车形态。处置只有两条，必须选一条并记在这里：

- A：同批把 14 张全部按新版本重拍（干净，但工作量大）。
- B：先只上新两张，接受短期混版，在下一次整批重拍时统一（快，但要在提交商店前确认审核不会因混版提问）。

## 首图顺序（与导流包共用一套）

见 [导流发布包第五节](../operations/promo/OUTBOUND_LAUNCH_PACK_2026-10-27.md)：`screen-1-one-click-login` → `screen-3-multi-env` → `screen-2-totp` → `screen-9-inline-fill` → 新增的 `screen-15-identity-vault` → `screen-4-security-audit` / `screen-12-import-backup` → 新增的 `screen-16-onboarding-recovery`。

Dashboard 的中文页与 English 页截图槽**互相独立、不继承**，所以两套都要传，文件名带 `-en` 后缀。

## 落地记录（2026-10-27）

| 改动             | 落点                                                                                    | 关键取舍                                                                                                                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 个人信息演示数据 | `seed.mjs` 的 `DEMO_IDENTITIES` + `seedIdentities()`                                    | 没有直写 `chrome.storage.local`，而是**走库弹窗自己的 `.json` 明文导入链**（开库 → 复验主密码 → 挂文件 → 再复验 → 合并确认），落盘实测 4 条且 `encryptedPayload` 全为字符串。复验策略保持默认 `perSession`，靠脚本点掉复验框，不动那个有安全语义的默认档 |
| 图 15            | `capture.mjs` seeded 批最后一屏（`clickByTitle` + `confirmMasterPasswordWhereVisible`） | 入口按 `title` 定位而不是按文案：头部那颗按钮的可见文案与备份徽标里的「个人信息库」标签完全同字。挑弹窗按「谁有可见密码框」，`.pop()` 在多轮开合后不再稳定                                                                                               |
| 图 16            | `capture.mjs` firstrun 批，排在图 6 之后                                                | 两屏共用「还没设主密码」这一状态，设完就回不去，必须同批同 profile 顺序拍。跳步骤用**进度点的 aria-label 匹配步骤标题**，不写下标——`pickSteps` 会按锚点在不在场过滤剧本，写死下标等于埋一个「哪天静默截到别的步骤」的坑                                  |
| 标题带文案       | `copy.mjs` 的 `identity` / `tour` 两组（中英各一份）                                    | 与商店四个字段同一套禁词口径：零竞品品牌名、零绝对化表述                                                                                                                                                                                                 |
| 产线两个开关     | `SHOT_CDP_PORT`（`cdp.mjs` / `shot.mjs`）、`SHOT_OUT_DIR`（`capture.mjs`）              | 前者治同机并行跑批互相抢 9333 的挂死（实测两批都在 `Runtime.evaluate` 超时上死过）；后者让新场景试跑不落进母版目录。默认值都不变                                                                                                                         |

**画廊一并补上了**：`index.html` / `en.html` 的 SLIDES 从 14 屏加到 16 屏（引导屏排在「本地加密与主密码」之后，个人信息库排在「回收站」之后），STEP 序号按数组顺序重排；`tests/scripts/buildWebAssets.test.ts` 那条数量守卫同步改成 16（它本来就写着「数量变了请同步本守卫」），WebP 由 `pnpm assets:webp` 推导、`pnpm gen:en` 重出英文页。浏览器实测中英各翻到新增那一屏，图与标题带都对。
