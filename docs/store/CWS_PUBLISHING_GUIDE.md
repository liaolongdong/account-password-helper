# Chrome Web Store 上架指南

本文档记录 Account Password Helper 上架 Chrome Web Store 的完整流程。

> 📌 **2026-10-09 起，第三步是服务账号路线。** 旧的「OAuth 桌面客户端 + OOB 授权码换 refresh token」已经不可用，
> 且 Chrome Web Store API v1.1 于 2026-10-15 停止支持——改动原因与逐条依据见 3.1 开头的批注。

**目录**

| 章节                | 内容                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 第一步 / 第二步     | 注册开发者账号、在 Dashboard 建商品与填文案                                                                                                 |
| 第三步              | 配自动提审：3.1 建服务账号 / 3.2 绑到开发者账号 / 3.3 Secrets / 3.4 本地验凭据 / 3.5 两条 workflow 与闸门 / 3.6 四档执行深度 / 3.7 预检判据 |
| 第四步              | 审核与发布、批准后的三项核对、常见拒绝原因                                                                                                  |
| 第五步              | 事实一致性校验（每次发版必做）：核心事实清单、快速校验命令、其他同步约定                                                                    |
| 常见问题解答（FAQ） | A 闸门与人工批准 / B 凭据与 token / C 上传与提审 / D 流水线本身（共 33 条）                                                                 |
| 附录                | 商店描述模板、隐私政策 URL、CI/CD 配置说明                                                                                                  |

## 前置条件

- Google 账号（已有）
- 双币/全币种信用卡或借记卡（用于支付 $5 注册费）
- 稳定的网络代理（访问 Google 服务）
- 走第三步还需要：一个 Google Cloud 项目（能创建服务账号与下载 JSON key）、该开发者账号下「添加服务账号邮箱」的权限、以及 GitHub 仓库 **Settings → Secrets and variables** 的管理权限。三者都属于 `liaolongdong` 账号，外部贡献者不需要——fork 只跑到 `preflight` 档。

---

## 第一步：注册 Chrome Web Store 开发者账号

1. 打开 Chrome Web Store Developer Dashboard：
   https://chrome.google.com/webstore/devconsole

2. 使用 Google 账号登录

3. 接受开发者协议

4. 支付 $5 美元一次性注册费（使用双币/全币种卡）

5. 注册成功后，记录下 Dashboard 的访问地址（后续配置 CI/CD 时需要）

> **提示**：注册过程中需要访问 Google 服务，建议选择网络稳定的时段操作。

---

## 第二步：创建扩展商品

在 Developer Dashboard 中：

1. 点击 **"新建商品"** (New Item)

2. 上传扩展 zip 包：`.output/account-password-helper-{version}-chrome.zip`

3. 填写商店信息（Store Listing）：

   **基本信息**：
   - **名称**：中文 `账号密码管理助手 - 本地加密密码管理器与自动填充及两步验证`（30 / 45 字符）/ 英文 `Account Password Helper - Password Manager`（42 / 45 字符）（须与 `public/_locales/*/messages.json` 的 `extensionName` 逐字一致）
   - **摘要**（132字符硬限制，中英各一条）：
     - 权威来源是 `public/_locales/zh_CN/messages.json` 与 `en/messages.json` 的 `extensionDescription`（manifest 通过 `__MSG_extensionDescription__` 引用）。商店列表必须粘贴**同一句话**——两份副本逐字一致，否则审核会判定描述与 manifest 不符。可直接粘贴的当前文案见 `CWS_FILL_CONTENT.md`「第二步 → 摘要」。
     - ✅ 口径已订正：旧文案中的「零联网」/「100% offline」并不成立（扩展每 6 小时发起一次不携带用户数据的匿名版本检查），两份 `_locales` 的 `extensionDescription` 已改为限定口径。
     - 🚫 **2026-09-09 关键字堆砌驳回后的现行口径（2026-09-10 二 / 三 / 四次修订，2026-09-11 五次修订，2026-09-12 六次修订）**：中文 **131 字符** / 英文 **130 字符**（上限 132，不留白）——句式必须是**读得通的完整句子**，功能项挂在谓语（中文「含……」/ 英文 `with …`）下面，而不是逗号裸串；品类词「密码管理器 / password manager」只出现一次，**不含任何竞品品牌名（Chrome / LastPass / Bitwarden / 1Password）**。`AES-256-GCM` 按用户要求写回摘要（准确的算法名，此前正文里不完整的「AES-256」已一并更正），`PBKDF2` 迭代次数这类参数仍只放在详细说明的【安全架构】。摘要按用户要求覆盖两步验证（TOTP/2FA）/ 密码强度检测 / 迁移导入，英文额度更紧，「密码可见性切换」只写在说明的 FEATURE SET。详细描述四次修订后为中文 **2380** / 英文 **6961** 字符，五次修订（SEO/ASO 复核）再回填六处已验证事实（密文只写入 local 与 session、改主密码原子重加密、生成器可排除易混淆字符、TOTP 可自定义算法与位数、主密码框大写锁定提示、换设备用 .aph 备份还原）、把「多环境账号隔离」「保存密码」写回正文，并驳回三处与实现不符的候选表述（快捷键自动登录 / EFF 助记词 / 五维检测）；六次修订（曝光与口径复核）追加中文 Name 的「与自动填充」（20 → 25 字符，英文 Name 不变），回填九处代码里确有而说明漏写的事实（悬浮填充按钮、侧边栏键盘全流程、Popup 操作中枢、锁定时可用的右键生成强密码、剪贴板清理档位、会话 9 档与两个锁定开关、标签 / 收藏 / 历史快照上限、TOTP 位数离散 6/7/8），并把三处无法自证的绝对表述改为可核对写法（泄露字典「近千条」、侧边栏「按 1 秒内出界面优化」、版本门槛写 **Chromium 114** 以避开品牌名 `Chrome`）——逐条代码依据见 `CWS_FILL_CONTENT.md`「第二步 → 摘要」的六次修订批注。现为中文 **5122** / 英文 **12549** 字符（Python `len()` 码点口径；上限 16,000，英文侧余量 3,451；2026-09-29 十四修订按用户反馈**重构了说明的层级并为每行加前导语义图标**，旧七节改为「🌟 为什么选它 → 📋 功能全览（六个分组）→ 🔒 安全架构 → 🚀 四步上手 → 👥 适合谁 → ❓ 常见问题 → 💡 温馨提示」，本段里提到的【安全架构】与 FEATURE SET 即现在的【🔒 安全架构】与 📋 FEATURE SET，若审核把图标判为 excessive metadata 只删前导 emoji、不改结构）：回填方式是**机制归【📋 功能全览】与【🔒 安全架构】、价值归【🌟 为什么选它】、问答只讲本节独有事实**，跨节不留重复句。3.8.0 草稿正是被 `Chrome, LastPass, Bitwarden, and 1Password (CSV/JSON formats` 判为 keyword stuffing，旧草稿已关闭，须在**已有商品**里上传新包生成新草稿重新提交（不要点「新建商品」）。
     - **剩余动作（2026-09-29 更新）**：旧版这里写的是「`pnpm build` 后重新上传商店包，线上摘要才会与新文案一致」——**已完成**：商店在架包已到 **v3.13.0**，`_locales` 里那份 131 / 130 字符的摘要与 30 / 42 字符的名称（上限 45）自 v3.11 起的每个包都带着它。**仍未确认的是列表正文**：本机 curl 打不开 `chromewebstore.google.com`（恒 `000`，属已知限制），无法核对 Dashboard 里粘贴的说明是否与「第二步」一致。因此每次改完商店文案后的收口动作是：**在 Dashboard 的中英两个语言标签页各整段替换一次说明并提交审核**，改完在下方「第五步」的粘贴自检通过才算闭环（本轮十四修订即处于「文档已改、待你粘贴提交」状态）。⚠️ 仓库侧此刻已在 **3.13.1**（release-please 于 2026-09-29 发布，本地 `pnpm build` 产物为 `.output/account-password-helper-3.13.1-chrome.zip`），与在架 v3.13.0 差一个 patch；本轮**只改说明、不传包**（用户 2026-09-29 决定），下次动到名称／摘要／权限时再一并带上。
   - **详细描述**：参见下方"商店描述模板"
   - **分类**：Productivity
   - **语言**：中文（简体）和 English

   **图形素材**：
   - **商店图标**：128×128 px（可使用 `public/icon/128.png`）
   - **截图**：至少 1 张、**每语言页最多 5 张**，尺寸只能 **1280×800 或 640×400**，格式 JPEG / 24 位 PNG（**带 alpha 的 PNG 会被判无效**）。直接取 `assets/cws-store/upload/*-1280x800.png`（母版是 2560×1600 RGBA，不能上传；重截母版后跑 `node scripts/store-shots/export-upload.mjs` 重新派生）。中文页与 English 页槽位互不继承，**两套各传 5 张**，详见 `CWS_FILL_CONTENT.md`「屏幕截图」。
   - **小幅推广图片**（可选）：440×280 px

   **隐私**：
   - **隐私政策 URL**：`https://liaolongdong.github.io/account-password-helper/privacy.html`
   - **数据使用声明**：
     - 不收集任何用户数据
     - 不将任何用户数据传给第三方，也不做用户画像或广告用途
     - 不使用任何分析工具
     - 说明：扩展确有一个出站请求——每 6 小时一次的匿名版本检查（探测 Chrome 商店可达性，不可达时改读 GitHub Releases 版本号），不携带账号、密码、标识符或任何用户数据。它不属于「数据收集」，但填写时不要写成「扩展不发起任何网络请求」，那与 manifest 行为不符。

4. 填写 **"权限合理性说明"**（Justification）：

   完整、可直接粘贴的中英文说明以 `CWS_FILL_CONTENT.md`「第五步 → 权限合理性说明」为准（覆盖 storage / activeTab / scripting / sidePanel / alarms / notifications / idle / clipboardWrite / clipboardRead / webNavigation / contextMenus / favicon / `<all_urls>`）。以下是三个最容易被问到的：

   - `<all_urls>`：需要在任意网站上检测登录表单并提供自动填充功能，这是密码管理扩展的核心功能。
   - `clipboardRead`：仅在「复制密码后自动清除剪贴板」前读取一次，用于校验剪贴板内容是否已被用户替换，避免误清你新复制的内容；不用于导入，也不上传读取结果。
   - `clipboardWrite`：复制密码到剪贴板，并在可配置的时间后自动清除。

5. 点击 **"提交审核"** (Submit for Review)

---

## 第三步：配置自动提审（服务账号 + 人工批准闸门）

### 3.1 建服务账号（Google Cloud Console）

> ⚠️ **本小节 2026-10-09 整体重写。** 旧版教的是「OAuth 桌面客户端 + `redirect_uri=urn:ietf:wg:oauth:2.0:oob` 取授权码换 refresh token」，
> 那条路已经彻底走不通：Google 自 2022-02-28 起不再允许新建客户端使用 OOB、2022-10-03 对存量客户端废止、2023-01-31 全面终止，
> 那个授权 URL 现在只会返回错误页；即便改走 loopback 授权，同意屏幕处于「Testing」模式时签出的 refresh token **7 天就过期**——
> 这正是本项目历史上 `invalid_grant` 的根因。
> 另一个必须换的理由：Chrome Web Store API **v1.1 于 2026-10-15 停止支持**
> （Google 原文：“We plan to support the old API until 15th October 2026, at which point you will need to move to the V2 API to continue making requests.”），
> 而服务账号是 **v2 才支持**的凭据形态。本项目因此改用「服务账号 + 自写 v2 REST 调用」（`scripts/cwsPublish.mjs`），不再依赖第三方 action。

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，创建或选择一个项目（只用来签凭据，不装任何工作负载）。

2. 「APIs & Services → Library」搜索 **Chrome Web Store API** → Enable。
   漏掉这一步时所有 v2 调用都是 `403 accessNotConfigured`，错误体会写明该 API 在此项目上从未被启用。

3. 「IAM & Admin → Service Accounts」→ Create Service Account：
   - 名称随意（例如 `cws-publisher`），**不需要**给它任何角色或权限。
     Google 文档原文：“You don't need to add any permissions to the service account at this stage.”——真正的授权在 3.2 由 Developer Dashboard 完成。
   - 「Grant users access to this service account」一栏留空，直接创建。

4. 点开这个服务账号 → 「Keys」→ 「Add key」→ 「Create new key」→ **JSON** → 下载。
   那份 JSON 里要用到两个字段：`client_email`（3.3 的 `CWS_SA_EMAIL`）与 `private_key`（3.3 的 `CWS_SA_PRIVATE_KEY`，整段 PEM，含 `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` 和中间换行）。

5. 记下 `client_email`，形如 `cws-publisher@<project-id>.iam.gserviceaccount.com`。JSON 文件本身不要提交进仓库，验证完放本地。

> ℹ️ 换票方式：用私钥签一个 RS256 JWT（`scope=https://www.googleapis.com/auth/chromewebstore`），
> POST 到 `https://oauth2.googleapis.com/token` 且 `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`。
> 不走 `gcloud auth print-access-token`——runner 上没有 gcloud 凭据链，而私钥本来就必须落 Secret，两者等价且少一个外部依赖。

### 3.2 把服务账号绑到开发者账号

1. 打开 Developer Dashboard：https://chrome.google.com/webstore/devconsole
2. 进入账户设置里的 **Service account permissions**（Google 文档路径：Add a service account to your developer profile）。
3. 粘贴 3.1 的 `client_email` → 保存。到这里凭据链才算通，没做这一步时写接口一律 `403 permissionDenied`。

两条约束：

- Google 文档原文：“At this time, you can only add one service account to your publisher.”——一个 publisher 只能绑**一个**服务账号；
  要换新邮箱，必须先把旧的那条移除。
- 私钥疑似泄漏时两步都要做：Cloud Console 删掉那把 key，**并且**在这页移除服务账号邮箱。只删 key 时 Dashboard 里那行仍然挂着，容易被误认为还可用。

### 3.3 配置 GitHub Secrets

打开仓库 https://github.com/liaolongdong/account-password-helper → **Settings** → **Secrets and variables** → **Actions** → 在 **Repository secrets** 里新增四条（缺一不可，`submit` job 的严格预检会当场判红）：

| Secret 名称          | 值                                                                 | 从哪来                                            |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| `CWS_EXTENSION_ID`   | `fgimkdodpjfkddmildjieojpfakpanli`                                 | 商店商品 URL 里那 32 位（也等于包 manifest 派生） |
| `CWS_PUBLISHER_ID`   | Dashboard 账户页里的纯数字 Publisher ID                            | 拼成请求路径 `publishers/{id}/items/{extId}`      |
| `CWS_SA_EMAIL`       | 3.1 的 `client_email`                                              | 服务账号 JSON 的 `client_email`                   |
| `CWS_SA_PRIVATE_KEY` | 服务账号 JSON 的 `private_key`（**整段 PEM，含头尾行和真实换行**） | 下载的那份 JSON                                   |

可选的第五条 `CWS_REQUIRED_PERMISSIONS`（逗号分隔的权限名，如 `storage,activeTab,scripting`）只用于「包内权限没越出清单」这项漂移告警；不配则该检查直接判过。CI 目前不注入它，本地排查权限漂移时可以临时导出。

> ⚠️ `CWS_SA_PRIVATE_KEY` 最常见的两个粘贴坑：一是把 `\n` 当**字面量**存了进去（GitHub 的输入框支持多行，要粘贴真实换行）；
> 二是只粘贴了中间那段 base64 而丢掉 PEM 头尾——Node 的 `createPrivateKey` 靠这两行判格式。
> 症状都是 `pnpm cws:token` 直接失败；CLI 会跟着打印私钥的**结构形状**（字符数 / 行数 / 有无 PEM 首尾标记 / 是否含字面量 `\n`）和对应的修法，但**任何输出都不含私钥与 access token**。

> ℹ️ 与旧版的对应关系：旧链路一共四项商店 Secret，其中**废弃三项**——`CWS_CLIENT_ID`、`CWS_CLIENT_SECRET`、`CWS_REFRESH_TOKEN`
> 这套 OAuth 2.0 桌面客户端凭据整体失去用途（服务账号改用 `private_key` 自签 JWT，不再有 refresh token 过期这回事），
> 换成 `CWS_PUBLISHER_ID`、`CWS_SA_EMAIL`、`CWS_SA_PRIVATE_KEY`；**`CWS_EXTENSION_ID` 是唯一沿用的一项**，新旧两侧同值。
> 合计仍是四项，一增一减是因为那三项整体退场。旧的那三项可以在 Settings 里删掉——
> 留着不会让流水线失败（`preflight` 段根本不读它们），但会让人误以为还在走 OAuth 路线。
> 另：`RELEASE_PLEASE_TOKEN` 不属于商店凭据（它供 release-please 打 tag 与挂 Release 附件），不在废弃范围。

> ⚠️ 发布前的校验会确认 `CWS_EXTENSION_ID` 是 32 位 `a-p` 小写字母；从 URL 复制时带入空格或换行会直接判红并打印实际长度，重新粘贴纯净 ID 即可。

### 3.4 本地先把凭据验通（不必在 CI 上试错）

三条命令按深度递增，都能在本地跑完再动流水线：

```bash
# ① 纯离线：不联网，只看产物、包内版本、标识符形状（缺三项标识符只告警，不判红）
pnpm cws:preflight

# ② 只验凭据链：私钥签 JWT → 换 access token，打印类型与有效期，绝不打印 token 本身
pnpm cws:token

# ③ 只读商品状态：证明「服务账号 → token → v2 端点」整条通，一个字节都不写商店
pnpm cws:status
```

②③ 需要在当前 shell 导出 3.3 那四项（`export CWS_SA_EMAIL=...` 等）。**先跑通 ③ 再让 CI 提审**——
它把「Secret 里是旧 key」「服务账号没绑进 Dashboard」这类问题在没排队进人工审核之前暴露掉。
`pnpm cws:publish` 也存在，但**别在本地打**——它绕过 `production` 那道人工闸门，而那道闸门存在的理由（提审不可即时撤回）在本地同样成立；
`pnpm cws:cancel` 相反，它是应急手段，CI 里没有撤审步骤，本地跑就是它的正确用法（FAQ C.15）。

### 3.5 发版链：两条 workflow、一道人工闸门

2026-10-09 起，「打 tag」和「提审商店」拆成两个文件，中间靠 GitHub Releases 的 `published` 事件对接：

| Workflow                    | 文件                                   | 触发                                | 做什么                                                                  | 要不要人批准                                      |
| --------------------------- | -------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| Release Please              | `.github/workflows/release-please.yml` | 合入 `main`                         | 算版本 → 打 tag → 建 GitHub Release → 构建并挂上 `.output/*-chrome.zip` | 否                                                |
| Publish to Chrome Web Store | `.github/workflows/publish.yml`        | `release: published`、手动 dispatch | 构建 → 离线预检 → 传包 → 提审（或只传包）                               | **是**：`submit` job 挂 `environment: production` |

**为什么要拆**——这是 2026-09-29 真实发生过的故障，不是假想的整洁性问题：
原来两段在同一条 workflow 里，而 workflow 级并发组是唯一的 `release-please-${{ github.ref }}` 且 `cancel-in-progress: false`。
合入 v3.13.1 的 release PR 后，那条 run 停在 `production` 的 `waiting` 状态**十天**，把这个唯一并发组占死——
期间每次合入 `main` 产生的新 run 全程 0 个 job，并在下一次合并的瞬间被自动取消（run 36556089630 / 37735256974 的 `created_at` 与 `updated_at` 逐条对得上），
v3.13.1 的 Release 因此 `assets: []`。拆开后 publish.yml 的并发组**按 tag 分组**（`cws-publish-<tag>`），
一条等审批的发布链只占住它自己那个 tag，主干发版与别的版本提审互不阻塞。

完整时序（合并 release PR 之后会发生什么）：

1. 贡献者的功能 PR 合入 `main` → release-please 只更新那条自动发布 PR，**不打 tag、不提审**。
2. 合并 release PR → release-please job 打 tag、建 Release；`build-and-attach` job 构建并把 zip 挂成 Release 附件。这一段无人值守。
3. `release: published` 触发 publish.yml 的 `prepare` job：Node 22 + `pnpm install --frozen-lockfile` + `pnpm run build`，
   取 `.output/*-chrome.zip` 跑离线预检，再把**这一个字节包**存成 artifact——下游 `submit` 提审的就是它，本 workflow 内不再重新构建。
   （注意第 2 步的 Release 附件来自另一次构建，两者是同一提交下的两次独立构建，边界见 FAQ D.24。）
4. `submit` job 停在 `Waiting for approval`，维护者在 Actions run 页面点 **Review deployments → Approve**。
5. 批准后执行严格预检（这次不带 `--ids-optional`，缺任何一项凭据判红）→ `fetchStatus` → `upload` → 轮询 `lastAsyncUploadState` 落定 → `publish` → `fetchStatus`，结果写进 job summary。

> ⚠️ 第 4 步的前置是 `production` 环境**已创建并配了 Required reviewers**。环境不存在时 GitHub 会静默自建一个无保护规则的环境，job 直接放行——
> 也就是「以为加了闸门，其实没加」。创建与验证方法见 `docs/PR_WORKFLOW_GUIDE.md` 第 1 节。

> ℹ️ 仓库里还留着一个孤儿环境 `CWS_EXTENSION_ID`（2026-07-12 建的，无任何保护规则，现已无 workflow 引用它）。
> 它既不放行也不拦截任何东西，可在 Settings → Environments 删掉，避免误以为它是第二道闸门。

### 3.6 手动触发：四档执行深度

Actions → “Publish to Chrome Web Store” → Run workflow，`mode` 决定跑到哪一档（默认 `preflight`）：

| mode          | 跑到哪                                                     | 需要哪些 Secret                                 | 需要人批准 | 什么时候用                                                             |
| ------------- | ---------------------------------------------------------- | ----------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| `preflight`   | 只有 `prepare`：构建 + 离线预检（零凭据、零网络写）        | 可以全空（走 `--ids-optional`，标识符降为告警） | 否         | fork、服务账号还没建出来的分支、只想证明产物本身是绿的                 |
| `status`      | 只有 `inspect`：一次只读 `fetchStatus`，**免构建、免 tag** | 四项齐全（`inspect` job 不挂 environment）      | 否         | 验证服务账号那条链通、看当前在架与在审版本——想在 CI 上验凭据就用这一档 |
| `publish-dry` | 加 `submit`：传包但**不提审**（CLI 的 `--no-submit`）      | 四项齐全                                        | **是**     | 只改商店文案那一轮——包先进去，说明在 Dashboard 里手改后由人工点提审    |
| `publish`     | 加 `submit`：传包并提审                                    | 四项齐全                                        | **是**     | 正式发版（`release` 事件走的就是这一档）                               |

`tag` 输入留空时可跑 `preflight` 与 `status`；`publish-dry` 与 `publish` 必须填 tag——那两档要靠它做「包内版本 == 发布 tag」的对账，没给 tag 会在 `prepare` 的 `Resolve tag / version / mode` 步骤 `exit 1` 并说明原因。

### 3.7 预检到底在验什么

`node scripts/cwsPublish.mjs preflight` 逐行打印 `✓` / `!` / `✗`，任一 `✗` 即终止（退出码非零、包不会上传）。
它存在的意义是把问题**挡在排队进人工审核之前**，而不是抛出一个不透明的 400/404：

| 判据                       | 判红（`✗`）条件                                                  | 说明                                                                             |
| -------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `zip 产物存在`             | `.output/` 下找不到对应版本的 `*-chrome.zip`                     | 给了 `--expect-version` 时只认文件名里带该版本的包，避免把旧版本包提审上去       |
| `标识符形状`               | ID 不是 32 位 `a-p` 小写、Publisher ID 含非法字符、SA 邮箱不成形 | 三项**全空**且带 `--ids-optional` 时降为 `!`；只空其中一项仍判红                 |
| `包内 manifest 可读`       | `unzip -p 包 manifest.json` 失败或不是合法 JSON                  | 顺带打印 `manifest_version`                                                      |
| `包内版本 == package.json` | 两者不等                                                         | 防「改了版本号没重新构建」这一类混编事故                                         |
| `包内版本 == 发布 tag`     | 两者不等                                                         | 只在传了 `--expect-version` 时出现（CI 里就是 release tag）                      |
| `权限集合符合预期`         | 不判红，只 `!`                                                   | 需要 `CWS_REQUIRED_PERMISSIONS` 才有实质内容，缺项时告警列出名字                 |
| `仓库 manifest 与包内一致` | 不判红，只 `!`                                                   | 比对**集合差异**而不是数量——数量相等但换了一项权限，正是「产物来自旧提交」的形状 |

> ⚠️ v2 特有的一个坑，值得单独钉在这里：`upload` 可能返回 `uploadState=IN_PROGRESS`（Google 侧还在异步解析包）。
> 此时若立刻 `publish`，提审拿到的是**上一个已解析的版本**。`publish` 子命令因此固定轮询 `fetchStatus.lastAsyncUploadState`
> 到落定（最多 10 次、间隔 2 秒），并在 `FAILED` 时终止且不提审。手工调 API 时这一步容易被省略。

`publish` 还留了一个逃生阀 `--skip-preflight`：跳过上表这整套离线判据，但「zip 找得到」和「文件名带对版本」这两条仍然生效——
它们发生在定位包的那一步，不归预检管。只在排查产物本身的问题时用；日常发版不要加，CI 的 `submit` 段也没带它。

---

## 第四步：审核与发布

- **首次审核**：通常需要 1-3 个工作日，密码管理类扩展可能更久
- **后续更新**：通常 24 小时内完成审核
- **审核被拒**：根据拒绝理由修改文案或代码后**新建草稿**重新提交——被拒的草稿本身已关闭，不能在其上继续编辑
- **撤回正在排队的提交**：`node scripts/cwsPublish.mjs cancel`（等价于 `pnpm cws:cancel`）。Google 的限制是「每个 publisher 每天最多撤回 6 次」，用尽之后只能等审核自然结束。

### 批准之后，先在 Dashboard 核对三件事

CLI 只做「传包 + 提审」——可见性档位、图文详情、隐私问答这些字段它一律不碰，仍要在 Dashboard 人工确认。点完 Approve 后核对：

1. 商品状态进入 `In review`（对应 `fetchStatus` 的 `submittedItemRevisionStatus.state = PENDING_REVIEW`）
2. 提交版本指向**这一版**而不是上一版（命令行等价读法：`pnpm cws:status` 的 `submitted=` 字段，取自 `submittedItemRevisionStatus.distributionChannels[0].crxVersion`）。显示成上一版通常意味着异步上传没落定就提审了，见 FAQ C.14
3. 中英两个语言标签页里的说明正文与 `CWS_FILL_CONTENT.md` 一致（只改文案那一轮用 `publish-dry`，见 3.6）

第 1、2 项不必进 Dashboard 也能读：`pnpm cws:status` 或 CI 的 `status` 档会打印 `state=` / `submitted=` / `published=` 三个值。

### 审核常见拒绝原因

1. **权限说明不充分**：确保在 Justification 中清晰解释每项权限的用途
2. **隐私政策不完整**：确保隐私政策覆盖了所有数据收集和处理行为
3. **功能不完整**：确保测试账号包含示例数据，审核人员能体验核心功能
4. **关键字堆砌（Spam 政策）**：本项目 2026-09-09 的 3.8.0 草稿即被判 `产品说明中有过多关键字`，被点名文本为 `Chrome, LastPass, Bitwarden, and 1Password (CSV/JSON formats`（[政策](https://developer.chrome.com/webstore/program_policies#spam) / [排查](https://developer.chrome.com/docs/webstore/troubleshooting/#keyword-stuffing)）。三个触发点：**竞品品牌名当关键词用**、**同一卖点在「为什么选它 / 适合谁 / 功能全览 / 常见问题」四节里各写一遍**、**摘要用逗号串起 6~8 个关键词**。修法见 `CWS_FILL_CONTENT.md`「第二步」与「7.4 注意事项」，提交前用下方扫描命令自检。

---

## 第五步：事实一致性校验（每次发版必做）

商店详情、README、官网与 AI 引擎引用的**事实**必须完全一致（事实变了处处改；文案表达各表面可自由优化）。发版前按下表逐项校验：

### 核心事实清单（单一事实来源）

| 事实项          | 权威口径                                                                                                                                                                                                                                                                                                                                                                                                                          | 出现位置                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 开源协议        | GPL-3.0-only                                                                                                                                                                                                                                                                                                                                                                                                                      | README、index.html（hero 徽章）、llms.txt、CWS_FILL_CONTENT.md                                                                                               |
| PBKDF2 迭代次数 | 600,000 次（短标签可用 600K，禁止无千分位的 600000）                                                                                                                                                                                                                                                                                                                                                                              | README、index.html、llms.txt、CWS_FILL_CONTENT.md、CONTRIBUTING.md                                                                                           |
| 加密算法        | AES-256-GCM（Web Crypto API 原生实现）                                                                                                                                                                                                                                                                                                                                                                                            | 全部表面                                                                                                                                                     |
| 加密粒度        | 逐字段加密 5 个敏感字段（用户名 / 密码 / 网址 / 备注 / 两步验证密钥），锁定或会话过期只销毁密钥材料与解密快照，**不做整库重新加密**                                                                                                                                                                                                                                                                                               | README、ARCHITECTURE、CONTRIBUTING、CWS_FILL_CONTENT.md、privacy.html、llms.txt                                                                              |
| 一键登录口径    | 完整登录来自侧边栏「填充并登录」，或用户自行开启偏好设置「自动触发登录」；`Ctrl+Shift+F` 自身始终只发填充与勾选（`autoLogin: false`），提交与否取决于该偏好开关（`entrypoints/content/FormDetector.ts` 判定 `data.autoLogin                                                                                                                                                                                                       |                                                                                                                                                              | autoTriggerLogin`）。禁止写成默认即点击登录，也禁止写成「绝不会提交表单」 | 全部表面（含 `quickFillHandler.ts` 的 `autoLogin: false` 实现） |
| 安全体检计分    | 0–100 综合评分，**四个**计分维度按权重合计：复用 35 / 弱密码 25 / 常见泄露 20 / 长期未更新 20；「未开启两步验证」仅列示不计分。禁止写「五维检测」                                                                                                                                                                                                                                                                                 | README、ARCHITECTURE、CWS_FILL_CONTENT.md、index.html、llms.txt、help.json（已订正，随下一次 `pnpm build` 生效）                                             |
| 助记词词库      | 内置 **3080** 词词库（≈46 bit），表述为「思路参考 EFF Diceware」。禁止写「EFF 2048 词」                                                                                                                                                                                                                                                                                                                                           | CONTRIBUTING、CWS_FILL_CONTENT.md、llms.txt、help.json、passphraseGenerator.ts（均已订正为 3080 / ≈46 bit）                                                  |
| 密码历史        | 每条可配 1~10 份加密快照，**默认 3 份**（`DEFAULT_MAX_HISTORY_PER_ENTRY = 3`）。禁止写默认 5 份                                                                                                                                                                                                                                                                                                                                   | README、ARCHITECTURE、index.html、pricing.md、llms.txt                                                                                                       |
| 导入导出格式    | CSV / JSON 双格式，自动识别 Chrome / LastPass / Bitwarden / 1Password 导出；**不解析 .xlsx**（Excel 只体现为「导出的 CSV 可直接双击打开、中文不乱码」）。**分表面**：README / 官网 / 扩展内导入向导可列具体品牌名；**Chrome 商店的名称、摘要、说明、权限说明与 Featured 提名文案一律不写品牌名**，统一说「常见密码管理器的导出格式 / the export formats of common password managers」（2026-09-09 因品牌名被判 keyword stuffing） | README、ARCHITECTURE、index.html、pricing.md、compare.html；`CWS_FILL_CONTENT.md` 仅出现在说明性批注中，粘贴块内为零                                         |
| 侧边栏性能      | 秒开（SLA <1s）；缓存快路径 20-50ms。禁止无限定词的裸「20-50ms 秒开」；英文正文用 en-dash（20–50ms），机器可读文件 llms.txt 用连字符（20-50ms）                                                                                                                                                                                                                                                                                   | README、README.en.md、index.html、llms.txt、CWS_FILL_CONTENT.md、docs/operations/reddit-post.md                                                              |
| 版本号          | 与 package.json 的 version 一致                                                                                                                                                                                                                                                                                                                                                                                                   | index.html（footer.updated 中英两处 + JSON-LD softwareVersion）、llms.txt（Last updated）、CWS 后台                                                          |
| 测试数量        | tests/ 实际执行的用例数与测试文件数（见下方校验命令）                                                                                                                                                                                                                                                                                                                                                                             | README、README.en.md（用例数）、llms.txt（用例数 + 文件数）、index.html / en.html 数据带首卡（仅用例数，落地页不展示文件数）                                 |
| 免费口径        | 完全免费、无订阅、无账号、无云端                                                                                                                                                                                                                                                                                                                                                                                                  | 全部表面 + pricing.md                                                                                                                                        |
| 隐私承诺        | 不收集、不上传任何用户数据；无遥测与分析；数据仅存本地。**唯一出站请求是每 6 小时一次的匿名版本检查，不携带用户数据**——禁止再写「零网络传输 / 数据不出浏览器 / 100% offline」                                                                                                                                                                                                                                                     | 全部表面 + privacy.html（须与商店 Privacy 标签一致）；`public/_locales/*/messages.json` 摘要已改为限定口径，仍需 `pnpm build` + 重新上传商店包才会在线上一致 |
| 联系方式        | 邮箱 924902324@qq.com / 微信 lld_1025                                                                                                                                                                                                                                                                                                                                                                                             | README、index.html、CWS_FILL_CONTENT.md                                                                                                                      |
| 文档更新时间    | 与发版月份一致（格式 `YYYY-MM`），版本号同步更新。隐私页使用精确日期（仅隐私政策实际变更时更新）                                                                                                                                                                                                                                                                                                                                  | README.md、README.en.md（末尾行）、index.html（footer.updated 中英）、en.html（footer.updated 中英）、llms.txt（Last updated）                               |

### 快速校验命令

> ⚠️ **字符数只认下面这段 python 的 `len()`（Unicode 码点）**。用 `node` 的 `String.length` 复算是 **UTF-16 code unit** 口径，说明里每个 emoji / 补充平面字符多算 1——2026-09-29 十四修订实测中英各差 64 / 63 个单位（当时轮末值 5040 ↔ 5104、12283 ↔ 12346），同日十五修订（补一行新手引导）为中英各差 65 / 64（5122 ↔ 5187、12549 ↔ 12613）。批注、本指南与 `exposure-status.md` 记录的一律是码点数。

````bash
# 性能口径：所有命中均应带「缓存快路径 / warm path」限定词
rg -n "20-50|20–50" README.md README.en.md index.html llms.txt docs/store/CWS_FILL_CONTENT.md docs/operations/reddit-post.md

# PBKDF2 千分位：不应出现无千分位的 600000
# （源码里的 `iterations: 600000` 是合法字面量，不在本命令的扫描面内）
rg -n "600000" README.md README.en.md index.html llms.txt docs/store/CWS_FILL_CONTENT.md docs/CONTRIBUTING.md docs/ARCHITECTURE.md docs/ARCHITECTURE.en.md

# 版本号：三处应与 package.json 的 version 一致
rg -n "softwareVersion|footer.updated" index.html

# 文档更新时间：7 处年月应一致且与发版月份匹配（下方「其他同步约定」列出的完整清单）
rg -n "最后更新\|Last updated\|文档最后更新" README.md README.en.md index.html en.html llms.txt

# 测试数量：以 vitest 实际执行结果为准，取 Test Files / Tests 两行汇总
# 勿用静态 grep 计数 `it(` / `test(`：循环与 it.each 生成的用例统计不到，会得出偏小的数字
pnpm test:run 2>&1 | grep -E "Test Files|Tests"

# 已废止口径：命中处只应是本指南与文档里标注待办的那几行 ⚠️，出现新命中即为口径回退
rg -n "零网络传输|零联网|数据不出浏览器|100% offline|军事级|2048|五维|默认 5 份|Excel 导入" README.md README.en.md index.html en.html llms.txt privacy.html privacy.en.html pricing.html docs/

# 商店元数据自检（提交前必跑）：只扫描 CWS_FILL_CONTENT.md「第二步」里会被复制粘贴的代码块
# 1) 竞品品牌名与已废止的绝对化表述必须为零（AES-256-GCM / PBKDF2 已按 2026-09-10 决定允许出现）
# 2) 中英 extensionName、extensionDescription 与粘贴块逐字一致
# 3) 跨小节重复行扫描：同一句话在小节里抄第二遍是 keyword-stuffing 判定的结构特征
python3 - <<'PY'
import json, re
doc = open('docs/store/CWS_FILL_CONTENT.md', encoding='utf-8').read()
seg = doc.split('## 第二步')[1].split('## 第三步')[0]
blocks = re.findall(r'```\n(.*?)```', seg, re.S)
banned = ('LastPass', 'Bitwarden', '1Password', 'Chrome', '零联网', '零网络传输', '100% offline', '数据不出浏览器', '军事级', '五维')
bad = {i: [k for k in banned if k in b] for i, b in enumerate(blocks) if any(k in b for k in banned)}
print('paste blocks:', len(blocks), '| banned hits:', bad or 'none')
for idx, lang in ((2, 'zh'), (5, 'en')):
    ls = [l.strip() for l in blocks[idx].splitlines() if len(l.strip()) > 20]
    dup = {l: ls.count(l) for l in set(ls) if ls.count(l) > 1}
    print(f'duplicate lines in {lang} description:', dup or 'none')
    # 历轮批注里的「说明长度」用的就是这个数（去掉首尾空行后的字符数），复述时别再换成别的口径
    print(f'{lang} description chars (strip 后，批注记录的就是它):', len(blocks[idx].strip()))
for path in ('public/_locales/zh_CN/messages.json', 'public/_locales/en/messages.json'):
    d = json.load(open(path, encoding='utf-8'))
    for key in ('extensionName', 'extensionDescription'):
        m = d[key]['message']
        print(path.split('/')[1], key, len(m), 'chars | matches a paste block:', any(m == b.strip() for b in blocks))
PY
````

### 其他同步约定

- **文档更新时间**：每次发版或重大文档变更时，须同步更新以下 7 处的「最后更新」时间戳——README.md 末尾行、README.en.md 末尾行、index.html `footer.updated` 中英两处、en.html `footer.updated` 中英两处、llms.txt `Last updated` 行；隐私页（privacy.html / privacy.en.html）仅在隐私政策实际变更时更新精确日期，不随版本号联动

- **FAQ 权威版本**为 index.html 的 `FAQS` 数组（可见问答与 FAQPage 结构化数据的单一真源）；README 与 llms.txt 的 FAQ 发版时对照校对，避免多副本漂移。页面里那份 FAQ 静态 DOM 是它的生成产物，见下条
- **FAQ 生成链**：改 `FAQS` 后依次跑 `pnpm gen:faq`（中文 FAQPage JSON-LD）→ `pnpm gen:faq-dom`（`index.html` 的中文可见 FAQ 静态 DOM）→ `pnpm gen:en`（英文页静态 DOM 与英文 JSON-LD 一并产出）。三份产物任一滞后都会由 `tests/docs/faqSchemaParity.test.ts` 与 `tests/docs/landingFaqDom.test.ts` 判红
- **测试数量**：以 `pnpm test:run` 输出的 `Test Files` / `Tests` 汇总行为唯一事实来源，新增或删除用例后须同步 README.md 与 README.en.md「核心特性」末尾的技术指针行（原「技术亮点 / Technical highlights」行已于 2026-09-11 的 README 重构中合并至此）、llms.txt 的 `Quality` 行（该行同时声明测试文件数）、`index.html` 数据带首卡的用例数（改完跑 `pnpm gen:en` 重生 `en.html`；数据带只展示用例数，不展示测试文件数），以及 `docs/blog/**` 正文与页脚提到的测试数量（改完跑 `pnpm gen:blog` 重生 `blog/*.html`）。旧的「博客数字锁定为发文快照」口径已于 2026-09 废止：博客修订时数字一并回改，避免与 README / llms.txt 长期背离
- **功能口径**：新增用户可见功能时，实际需要同步的是 **6 处表面 + 架构文档**，`.qoder/rules/wxt-rules.md` 第 10 条只列了 4 处（README / index.html / HelpDialog / CWS），按它执行会漏项。完整清单：

  1. `README.md`（功能速览按编号顺延，中英文各一节）
  2. `README.en.md`（英译镜像，最易遗漏）
  3. `index.html` 可见文案（FAQS / 功能数组，中英两处）与 `en.html` 对应内容——`en.html` 由 `scripts/build-en-page.mjs` 从中文源生成，改中文源后跑 `pnpm gen:en`；改的是 `FAQS` 时还要按上面的 **FAQ 生成链** 补齐 JSON-LD 与两侧的 FAQ 静态 DOM
  4. 侧边栏 `components/sidepanel/HelpDialog.vue` 对应的 `utils/i18n/locales/{zh-CN,en}/help.json` 词条（数字序号驱动，新增条目须同步提升 `helpItems('help.gx', N)` 的 N，由 `tests/utils/i18nBundles.test.ts` 守卫）
  5. `docs/store/CWS_FILL_CONTENT.md` 商店文案 **与** `wxt.config.ts` 的 manifest 描述（manifest 走 `__MSG_extensionDescription__`，实际文案在 `public/_locales/*/messages.json`）
  6. content / background 侧可见文案走 `utils/i18n-lite.ts` 的 `tl()`，与 Vue 的完整 i18n 是两套独立词表，必须各写一份中英文
  7. `docs/ARCHITECTURE.md` 与 `docs/ARCHITECTURE.en.md` 的「功能实现详解」

  博客正文若涉及该功能，修订后跑 `pnpm gen:blog` 重生 `blog/*.html`。

- **商店摘要（132 字符硬限制）**：修改后须同步 `public/_locales/zh_CN/messages.json` 与 `en/messages.json` 的 `extensionDescription` 并重新构建，且与 CWS_FILL_CONTENT.md 的「摘要」保持一致

---

## 常见问题解答（FAQ）

按「闸门 → 凭据 → 上传与提审 → 流水线本身」四类排查。每条都给出**现象、根因、可执行的处置**，命令均可直接复制。

### A. 闸门与人工批准

1. **run 停在 `Waiting for approval`，是不是流水线坏了？**
   不是，这是刻意设计的一道闸。批准路径：Actions → 点开该 run → job 列表里的 **Submit to Chrome Web Store (needs approval)** → 右上角 **Review deployments** → 勾选 `production` → **Approve**。
   当前环境配置是 `prevent_self_review: false`，所以审批人可以是触发这次发版的那个人——这一点不必额外去改。

2. **一直没人点 Approve 会怎样？**
   不会超时放行、不会自动批准，商店侧什么都没有发生。因为 `publish.yml` 的并发组**按 tag 分组**，这条 `waiting` 的 run 只占住它自己那个 tag，主干上的发版与别的版本的提审都不受影响。
   （拆成两条 workflow 之前不是这样：2026-09-29 那次它占死了唯一的并发组，之后每次合 `main` 的 run 全程 0 个 job，见 3.5。）

3. **点了 Approve，`submit` 立刻红，报 `✗ 标识符形状`。**
   `submit` 里的预检**不带** `--ids-optional`（严格模式），`CWS_EXTENSION_ID` / `CWS_PUBLISHER_ID` / `CWS_SA_EMAIL` 缺任何一项都会在这里判红。
   好消息是它发生在联网之前——商店侧什么都没发生。补好 Secret 后 **Re-run jobs** 只重跑 `submit` 即可，`prepare` 上传的 artifact 在保留期（7 天）内还在。

4. **合了 release PR，`submit` 直接就绿了，从来没见过 `Waiting for approval`。**
   这说明闸门**不成立**：GitHub 对未创建的 environment 会静默自建一个「无保护规则」的环境并直接放行，也就是「以为加了闸门，其实没加」。
   处置：Settings → Environments → New environment，名字必须逐字符是 `production`（与 `publish.yml` 里 `environment:` 的值一致），加上 Required reviewers，再合一次 release PR 验证是否出现 `Review deployments` 按钮。

5. **Environments 列表里那个 `CWS_EXTENSION_ID` 环境是干什么的？**
   它是 2026-07-12 留下的孤儿：没有任何保护规则，现在也没有任何 workflow 引用它。它既不放行也不拦截任何东西，可以在该页删掉，避免误认为它是第二道闸门。真正的闸门只有一个，名字叫 `production`。

### B. 凭据与 token

6. **还在报 `invalid_grant`？**
   那是旧 OAuth refresh token 路线的专属错误码（同意屏幕处于 Testing 模式时 token 7 天过期）。新路线用服务账号签 JWT，不会产生这个响应。
   如果你仍在日志里看到它，说明跑的是拆改之前的旧 job 定义，而不是 `publish.yml`。

7. **`401`。**
   CLI 的提示原文是「凭据被拒：确认服务账号邮箱与私钥成套，且 access token 未过期」。两种形状：换了新 key 但 Dashboard 里挂的还是旧邮箱（不成套），或者 token 超过 1 小时有效期（本项目每次调用现签，通常是前者）。

8. **`403 accessNotConfigured`。**
   Cloud 项目没启用 Chrome Web Store API：APIs & Services → Library → 搜 “Chrome Web Store API” → Enable。见 3.1 第 2 步。

9. **`403 permissionDenied`。**
   服务账号邮箱没加进 Developer Dashboard → Account。见 3.2。注意 Google 的限制是**一个 publisher 只能绑一个服务账号**（“At this time, you can only add one service account to your publisher.”），换邮箱要先把旧的移除。

10. **本地 `pnpm cws:status` 通，CI 的 `status` 档却失败。**
    大概率是 Secret 存错了**作用域**：`inspect` job 不挂 `environment`（只读段不需要人工放行），所以它读不到 environment-scoped 的 Secret。
    3.3 明确要求这四项存成 **Repository secrets**；若历史上存成 `production` 环境的，请在仓库级重建一份。

11. **私钥明明贴进去了，`pnpm cws:token` 仍说解析失败。**
    两个坑（3.3 有详述）：把 `\n` 当**字面量**存了进去（GitHub 输入框支持多行，要粘真实换行），或者丢了 `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` 这两行——Node 的 `createPrivateKey` 靠它们判格式。
    本地验证时可以先用 `node -e "require('crypto').createPrivateKey(process.env.CWS_SA_PRIVATE_KEY)"` 自证，报错即 Secret 内容本身有问题。
    CI 里这一格的症状是同一句 `error:1E08010C:DECODER routines::unsupported`（2026-10-09 实测 run 37962114514 就红在这里），CLI 会跟着打印私钥的形状（字符数 / 行数 / 有无 PEM 首尾标记 / 是否含字面量 `\n`）——只报结构事实，不回显密钥。

12. **fork 的贡献者 PR 会不会误提审我的商品？**
    不会，三重保险：`publish.yml` 只在 `release: published` 与手动 dispatch 时触发（PR 事件根本不触发它）；`submit` 带 `if: github.repository == 'liaolongdong/account-password-helper'`；GitHub 本身不会把仓库 Secrets 暴露给 fork 的 run。
    fork 上想验证产物是否合规，跑 `preflight` 档即可——它设计上就是零凭据、零网络写。

### C. 上传与提审

13. **`包在商店侧解析失败`（`uploadState=FAILED`）。**
    CLI 在这种情况下**不提审**并终止。常见根因：manifest 缺必需字段、体积超限、或者 zip 结构不对——必须是「解包后根目录直接是 `manifest.json`」，而不是把 `.output/chrome-mv3/` 整目录压进去。
    `wxt zip`（本项目 `postbuild`）的产物结构是对的；手搓 zip 常错在这一条。先用 `unzip -l 包名.zip | head` 自证。

14. **提审之后发现商店拿到的是上一版。**
    v2 的 `upload` 可能返回 `uploadState=IN_PROGRESS`（Google 侧还在异步解析包），此时立刻 `publish` 拿到的就是**上一个已解析的版本**。
    本项目的 `publish` 子命令固定轮询 `fetchStatus.lastAsyncUploadState` 到落定（最多 10 次、间隔 2 秒）才提审，不会踩这条；**自己手搓 curl 调 API 时这一步最容易被省略**。

15. **`400 FAILED_PRECONDITION`——「商品状态不允许再次提审」。**
    上一版还在审核中。先 `node scripts/cwsPublish.mjs cancel` 撤回当前提交（**每天每 publisher 上限 6 次**），或者等审核自然结束。
    CLI 在 publish 之前会先读一次 `submittedItemRevisionStatus.state`，是 `PENDING_REVIEW` 且没带 `--no-submit` 时**在本地就终止**，不会把注定被拒的请求打出去。

16. **`400`——「多为包内 manifest 版本与已发布版本相同」。**
    版本号没涨。两个来源：release-please 没打 tag（贡献者的功能 PR 合 `main` 只会更新那条自动发布 PR，不产生 Release），或者本地 `pnpm build` 用的是旧 `package.json`。
    预检里的「包内版本 == package.json」与「包内版本 == 发布 tag」两项就是拦这个的。

17. **`404 item not found`。**
    先核对 `CWS_PUBLISHER_ID` 与 `CWS_EXTENSION_ID` 拼出的 `publishers/{id}/items/{extId}`。
    另一个可能：商品从没建过——**v2 API 不能新建商品**，第一次上架必须在 Dashboard 点「新建商品」上传 zip 才拿得到 ID。

18. **`429`。**
    触发配额限制，稍后重试。注意撤回审核的请求单独计数，每天最多 6 次。

19. **只改商店文案 / 截图，要不要走流水线？**
    文案与图形素材这些字段本 CLI 一个都不写（`publish` 的请求体只有 `publishType`、`skipReview`、`blockOnWarnings` 三项），所以改文案的正确路径是在 Dashboard 里改完由人工点提审。
    如果那一轮**同时**有新包但暂时不想提审，用 `publish-dry` 档把包先传上去（`--no-submit`），商店侧停在「已上传、等人工提审」的状态。

20. **`skipReview` / `blockOnWarnings` 能不能打开？**
    本项目恒传 `false`，两条理由不同。`skipReview` 是 Google 给 **Declarative Net Request 类扩展**的免审通道，密码管理器不属于该豁免，打开也不会生效。
    `blockOnWarnings` 沿用 v2 默认值 `false`；它的效果是「商品带任何一条**商店侧**告警就不放行」（对应 `fetchStatus` 的 `warned` 字段），和 3.7 里本 CLI 打的 `!` 不是一回事。
    要收紧这道闸，先用 `pnpm cws:status` 看一眼当前商品的 `warned=` 读数，确认自己能在 Dashboard 里定位到告警明细，再把 `publishItem` 的这个默认值改成 `true`。

21. **能不能「审核通过后先挂起，我自己控制放量」？**
    可以：CLI 的 `--staged` 会把 `publishType` 换成 `STAGED_PUBLISH`，审核通过后商品处于 `STAGED` 状态，由开发者手动放行。
    但两点限制：① 按 Google 文档，`setPublishedDeployPercentage` 这个端点的调用前提是该商品**7 日活跃用户超过 10,000**，量级不足时请求被拒，只能在 Dashboard 手动操作；
    ② 本项目 CLI **没有实现**该端点（只有 preflight / token / status / publish / cancel 五个子命令），所以放量这一步当前必须去 Dashboard 做，`--staged` 只负责把「审过即上架」改成「审过先挂起」。

22. **能用 API 把商品改成 unlisted 或 trusted testers 吗？**
    不能。v2 的 `PublishType` 只有 `DEFAULT_PUBLISH` 与 `STAGED_PUBLISH`，且 Google 明确写道 “we no longer support changing the visibility of an item using the API”。可见性一律在 Dashboard 改。

### D. 流水线本身

23. **`prepare` job 为什么不注入 `CWS_SA_PRIVATE_KEY`？**
    离线预检不需要凭据；而 `prepare` 不挂 `environment`（审批只设在 `submit` 上），把私钥注入一个无审批的构建 job 只会扩大暴露面。
    注入私钥的只有两处：`inspect`（只读，靠它证明凭据链通）与 `submit`（挂 `production`，批准后执行）。

24. **提审的包和预检的包是同一个吗？**
    是。`prepare` 把构建出的 zip 用 `upload-artifact` 存下来，`submit` 用 `download-artifact` 取回后提审——**预检过的那个字节包**，不会出现「预检绿了但提审的是另一份」。
    一个需要知道的边界：GitHub Release 的 zip 附件由 `release-please.yml` 的 `build-and-attach` 单独构建，与 `prepare` 是**两次独立构建**（同一 tag、同一 `pnpm-lock.yaml`）。
    旧版是同一个 job 里一次构建同时供两处，所以这一点是拆分带来的变化；两者内容应当一致，但如果你在排查「Release 附件与商店包字节不同」，这是原因，不是被篡改。

25. **想重跑 `submit`，需要重新构建吗？**
    不一定要。Re-run jobs 时 `prepare` 的 artifact 在保留期（`retention-days: 7`）内仍然可下载，直接复用；超过 7 天就得整个 run 重跑。

26. **手动 dispatch 忘了填 `tag`。**
    `preflight` 与 `status` 都照跑：前者只验产物本身，后者根本不进 `prepare`。`publish-dry` 与 `publish` 会在 `Resolve tag / version / mode` 步骤 `exit 1` 并打印原因，而不是拿当前分支的产物闷头提审——那两档要靠 tag 做「包内版本 == 发布 tag」的对账。
    还有一个更早的坎：`workflow_dispatch` 只对**默认分支上已存在**的 workflow 生效。`publish.yml` 合进 `main` 之前，Actions 页面里没有它的「Run workflow」按钮，API 也回 404（`GET /repos/{owner}/{repo}/actions/workflows/publish.yml` 同样 404，而 `main` 上只列得出 ci / e2e / pr-title / release-please 四个）。这不是配错了，是 GitHub 的注册时机——第一次手动 dispatch 只能在合入之后。

27. **`concurrency.cancel-in-progress` 为什么必须是 `false`？**
    一个正在等人工审批、或者正在往商店传包的 run 被后来的 run 取消，等于一次半途而废的发版，而且商店侧可能已经收到包但没提审。宁可排队，不要中断。

28. **2026-10-15 之后 `mnao305/chrome-extension-upload@v6.0.0` 还能用吗？**
    不能——它走的是 v1.1。该 action 的 v7.0.0 已改走 v2，同时把 `publisher-id` 变成必填、删掉 `publish-target`、runtime 升到 node24。
    本项目 2026-10-09 起两者都不用，改为自写 `scripts/cwsPublish.mjs` + 服务账号：零第三方依赖、端点与请求体可被单测逐字钉住（`tests/scripts/cwsPublishCli.test.ts` 用本地假商店断言整条请求序列），且支持 `STAGED_PUBLISH` 与撤回审核这些 action 没覆盖的操作。

29. **怎么验证这条链本身没被改坏？**

    ```bash
    pnpm exec vitest run tests/scripts/cwsPublishCli.test.ts   # 22 例，含请求序列、验签与私钥形状提示
    pnpm cws:preflight                                          # 拿真产物跑离线预检
    ```

    两条都不会碰真实商店：单测把 CLI 的端点指向进程内的假商店（`CWS_API_ROOT` / `CWS_OAUTH_TOKEN_URI` 两个环境变量只服务于这个场景，生产不设），`preflight` 则是纯离线。任何分支上都能跑。

30. **点了 Approve，`submit` 为什么过一会儿才动？**
    因为 `production` 上除了 Required reviewers 还配了 `wait_timer: 10`（分钟）。两条是 **AND** 而不是「谁先到谁放行」——证据：run 36556089630 的 `pending_deployments` 里 `wait_timer_started_at = 2026-09-29T10:31:46Z`，十分钟早已走完，job 却在没有批准的情况下停在 `waiting` 十天。
    所以净效果是「批准 **且** 进入 waiting 满 10 分钟」才执行：合完 release PR 就立刻点批准，会看到按钮已经点掉但 job 还在 waiting，那是在等 timer 补齐，不是坏了。等满 10 分钟之后再批准则不必再等（这一半是按 AND 语义推的，本轮没有实测批准后的耗时——那次批准我们始终没点）。
    要即点即走就把 wait timer 设 0。它的价值是给自动化一个反悔窗口，对单人维护的项目收益有限，留着或清零都算合理配置。

31. **怎么只读核验凭据配在哪一级、闸门到底有没有牙？**
    四条 GET，全部不需要写权限，也读不到任何 Secret 的值（只返回名字与 `updated_at`）：

    ```bash
    R=https://api.github.com/repos/liaolongdong/account-password-helper
    curl -s -H "Authorization: Bearer $PAT" "$R/actions/secrets"                       # 四项 CWS_* 应在此列
    curl -s -H "Authorization: Bearer $PAT" "$R/environments/production"               # protection_rules 里要有 required_reviewers
    curl -s -H "Authorization: Bearer $PAT" "$R/environments/production/secrets"       # 这一条必须为空
    curl -s -H "Authorization: Bearer $PAT" "$R/actions/runs/<run_id>/pending_deployments"  # 非空 = 真有 job 停在等你批准
    ```

    第三条最关键：四项**必须配在仓库级**。若哪天把 `CWS_SA_PRIVATE_KEY` 等配成了 `production` 环境级，`inspect` job（不挂 environment）就看不见它们，`status` 档会以「凭据缺失」失败——这正是 FAQ B.10「本地通、CI 失败」的一种成因，也是 `submit` 判红前最容易漏查的一层。
    第二条顺带能读出 `prevent_self_review` 和 `wait_timer`（见第 1 条与第 30 条）。

32. **`production` 环境没有分支限制，要不要收紧？**
    实测读数：它的 `protection_rules` 只有 `required_reviewers` 与 `wait_timer`，**没有 `branch_policy`**——而同仓库的 `github-pages` 环境里 `branch_policy` 是存在的，所以这不是没读出来。
    含义是任何分支上的 run（包括未来从 feature 分支手动 dispatch `publish`）只要过了那道人工批准，就能进 `submit` 并读到四项凭据。要收窄：Settings → Environments → `production` → Deployment branches 选「Available for select branches」并只放 `main`。
    这属于防自己误操作的加固，不是漏洞：真实提审仍需人工批准。是否收紧由维护者定，定了记得回到第 31 条那四条 curl 的第二条（`/environments/production`），确认 `protection_rules` 里多出 `branch_policy`。

33. **对一个比 CLI 更早的 tag 跑 `publish-dry` / `publish` 会怎样？**
    会在 `prepare` 的 `Offline preflight` 步骤报 `Cannot find module '…/scripts/cwsPublish.mjs'`（`MODULE_NOT_FOUND`）。
    原因是 `prepare` 按 `github.event.release.tag_name || inputs.tag` 检出，也就是**那个 tag 的树**，而 `scripts/cwsPublish.mjs` 是 2026-10-09 才合进 `main` 的——`v3.13.1` 及更早的 tag 上根本没有这个文件。
    这不是凭据问题：它失败在 `prepare`，还没走到任何联网的步骤。坐实的方法是一条只读命令：`git ls-tree <tag> scripts/cwsPublish.mjs`，输出为空即该 tag 没有 CLI。
    结论是 `publish-dry` / `publish` 只对本次要发布的那个 tag（即合并了 CLI 之后打出的 tag）有意义；**只想验凭据链就用 `status` 档**——它不检出 tag，`tag` 输入直接留空即可。

---

## 附录：商店描述模板

> 📌 商店正文的权威文案（含逐字符数校验、中英双语、截图与权限说明）在 `CWS_FILL_CONTENT.md`「第二步」。本附录只保留一份精简兜底模板，两者冲突时以 `CWS_FILL_CONTENT.md` 为准。

### 中文描述

```
一款专为开发者和测试人员设计的本地密码管理工具，让多账号登录更安全、更高效。

🔒 安全特性：
• 用户名 / 密码 / 网址 / 备注 / 两步验证密钥逐个加密后只存本地，内容被篡改时能够检出
• 主密码本身不会保存，只保留用于比对的校验值
• 不收集、不上传任何用户数据，无遥测与分析
• 会话超时自动锁定

⚡ 便捷功能：
• 智能表单检测，一键自动填充
• 侧边栏快捷管理密码
• 自动保存新登录凭据
• CSV/JSON 导入导出
• 加密备份与恢复

🎯 适用场景：
• 开发测试多账号切换
• 日常网站密码管理
• 通过加密备份文件（.aph）在个人设备之间迁移数据

完全开源，代码可审计：https://github.com/liaolongdong/account-password-helper
```

### English Description

```
A local password manager designed for developers and testers, making multi-account login safer and more efficient.

🔒 Security Features:
• Username, password, URL, remark and 2FA secret are encrypted one field at a time and stored only in your browser, and tampering is detected
• The master password itself is never stored — only a value used to check it
• No data collection, no uploads, no telemetry or analytics
• Auto-lock on session timeout

⚡ Convenience Features:
• Smart form detection with one-click auto-fill
• Side panel for quick password management
• Auto-save new login credentials
• CSV/JSON import/export
• Encrypted backup & restore

🎯 Use Cases:
• Multi-account switching for dev/testing
• Daily website password management
• Moving your vault between your own devices via an encrypted .aph backup file

Fully open-source, code auditable: https://github.com/liaolongdong/account-password-helper
```

---

## 附录：隐私政策 URL

部署后地址：`https://liaolongdong.github.io/account-password-helper/privacy.html`

隐私政策页面已创建在项目根目录 `privacy.html`，推送到 main 分支后会自动部署到 GitHub Pages。

---

## 附录：CI/CD 配置说明

发布流程的权威说明见本文「第三步：配置自动提审（服务账号 + 人工批准闸门）」（含 3.7 的七项预检判据）与「常见问题解答（FAQ）」。

补充三点：

- **没有「跳过提审」这回事了**。旧版靠 `if: env.CWS_EXTENSION_ID != ''` 让整段发布静默跳过，代价是「Secret 忘了配」和「这轮刻意不提审」两种状态在日志里长得一模一样。
  现在的口径是：`release` 事件一定进入 `submit`，**由 `production` 环境的人工批准决定要不要真的提审**——不点 Approve 就等于跳过，且留下 `waiting` 这个可见的状态。
  三项标识符缺失时在联网之前判红（`✗ 标识符形状`），不再静默跳过。只有 `preflight` 档允许凭据为空（`--ids-optional`，降级为 `!`），因为它设计上就不碰商店。
- **旧四项商店 Secret 里废弃三项**：`CWS_CLIENT_ID` / `CWS_CLIENT_SECRET` / `CWS_REFRESH_TOKEN` 这套 OAuth 桌面客户端凭据整体退场，换成 `CWS_PUBLISHER_ID` / `CWS_SA_EMAIL` / `CWS_SA_PRIVATE_KEY`；**`CWS_EXTENSION_ID` 沿用、新旧同值**，所以总数一增一减仍是四项。`RELEASE_PLEASE_TOKEN` 不是商店凭据，不在废弃范围。见 3.3。留着旧的不会让流水线失败，但会让人误判凭据形态。
- Pages 由仓库设置里的 `Deploy from a branch`（`main` / 根目录）发布，CI 不参与生成站点——`en.html`、`pricing.en.html`、`privacy.en.html` 与 `blog/*.html` 需本地跑 `pnpm gen:en` / `gen:pricing-en` / `gen:privacy-en` / `gen:blog` 后提交；只改中文源而不重跑生成，线上英文版会滞后于中文版。站点直接服务 `main` 根目录，意味着**入库即公开**，不要把内部文档放进仓库根目录。
- 同一条口径也适用于 `index.html` 内部的生成产物：FAQPage JSON-LD 与 FAQ 静态 DOM 由 `FAQS` 生成（`pnpm gen:faq` / `gen:faq-dom`），改 `FAQS` 后不重跑就等于线上可见 FAQ 与真源脱节，且禁用 JS 的抓取端读到的是滞后的那份。
