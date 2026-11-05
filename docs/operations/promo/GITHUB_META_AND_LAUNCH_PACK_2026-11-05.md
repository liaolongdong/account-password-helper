# GitHub 元数据替换与站外投递包（2026-11-05）

**这份文件里的一切都是「待你执行」的文本与命令**——按本轮约定，我不做 GitHub 侧外部写，不改仓库设置，不向任何第三方仓库提 PR。

执行前先看一眼：`gh` 已装且能读到本仓库（本轮实测 `gh api repos/liaolongdong/account-password-helper` 正常返回）。若你的网络下 `git`/`gh` 直连 github.com 超时而 `api.github.com` 通，就换成本文最后的 curl 版命令。

---

## 一、【最高优先】GitHub About 必须换掉

线上 `description` 实测 **346 UTF-16 / 345 码点**（`gh api repos/liaolongdong/account-password-helper --jq '.description'` 原样可读）。里面有**两处**与已收口口径冲突的写法：一处是关于「云端」的绝对化说法，另一处是关于密码「永不出浏览器」的英文承诺——后者正是 `tests/docs/seoSurface.test.ts` 里 `BANNED_PHRASES` 表中的原句。**本文刻意不复述它**：那份表才是唯一真源，在这里抄一遍只会让这份文件自己被守卫判红。

两个问题叠在同一行上：

1. **它命中了本仓库自己列出的禁用表述**：`tests/docs/seoSurface.test.ts` 的 `BANNED_PHRASES` 里就有这一族的英文原句。那条守卫扫的是仓库内的表面（站页 / README / llms / llms-full / 语言包 / 商店 `_locales` / 封面与宣传图矢量源 / `docs/operations/promo/*.md`），**GitHub About 不是文件，任何门禁都看不见它**。也就是说：全仓已经收口过的那族表述，在线上唯一残留的位置就是这个仓库描述。
2. 它与已核实的产品行为冲突：扩展每 6 小时会发一次匿名请求（先 no-cors HEAD 探测商店可达性，不可达才回退 GitHub Releases 取版本号，不携带任何用户数据，见 `utils/updateChecker.ts`）。那句「永不出浏览器」式的承诺是**无法自证**的。

结尾的 `本地账号密码管理助手` 也只出现中文名，与 2026-10-27 收口的站外双名口径 `账号密码管理助手 Account Password Helper` 不一致。

### 推荐文本（332 UTF-16，距 350 上限余 18）

```text
🔐 账号密码管理助手 Account Password Helper — open-source local-first password manager Chrome extension (MV3, GPL-3.0): one-click autofill that ticks consent & signs in, 3 cross-subdomain tiers, built-in TOTP, encrypted personal-info vault, offline security audit, per-field AES-256-GCM in chrome.storage.local — no account, no sync server.
```

逐句对代码的核验（沿用 exposure-status 第 6 项那轮，本轮只改一处术语）：

| 片段                                               | 代码依据                                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `one-click autofill that ticks consent & signs in` | `entrypoints/content/CheckboxHandler.ts` + `FormDetector.ts` 的 `autoLogin` 路径（侧边栏「填充并登录」；快捷键默认仍只填充不提交） |
| `3 cross-subdomain tiers`                          | `utils/domain.ts` 的 `DomainMatchMode = 'off' \| 'wildcard' \| 'sameMainDomain'`，默认 `off` 精确匹配                              |
| `built-in TOTP`                                    | `utils/totp.ts`（RFC 6238，6/7/8 位，SHA1，30s）                                                                                   |
| `encrypted personal-info vault`                    | `utils/identity/` + `components/options/IdentityVaultDialog.vue`，独立加密、`.aphid` 备份                                          |
| `offline security audit`                           | `utils/passwordHealth.ts` 的 `HEALTH_WEIGHTS`（复用 35 / 弱 25 / 泄露 20 / 久未更新 20，0–100 分）                                 |
| `per-field AES-256-GCM in chrome.storage.local`    | `utils/encryption.ts` 与存储层（从不用 `storage.sync`）                                                                            |
| `no account, no sync server`                       | 取代旧的绝对化说法：无账号体系、无同步服务器，但**不**否认那次匿名版本检查                                                         |

> ⚠️ **本轮相对 exposure-status 那版定稿的唯一改动**：`encrypted identity vault` → `encrypted personal-info vault`。术语在 2026-10-18 已统一（`identity.title` 现值：中文「个人信息库」/ 英文 `Personal Info Vault`），旧写法既不符合现术语，也会在 GitHub 搜索里指向一个界面上不存在的名字。长度从 343 变成 332 是因为同时收紧了 `matching`/`clicks` 两处冗词。

### 备选（348 UTF-16，余 2，只改术语不动冗词）

```text
🔐 账号密码管理助手 Account Password Helper — open-source, local-first password manager Chrome extension (MV3, GPL-3.0): one-click autofill that ticks consent & clicks sign in, 3 cross-subdomain matching tiers, built-in TOTP, encrypted personal-info vault, offline security audit, per-field AES-256-GCM in chrome.storage.local — no account, no sync server.
```

两版表达的是同一组事实，**别在 GitHub About 里再补新能力**——350 上限按 UTF-16 码元计（`🔐` 占 2、每个汉字占 1），复算命令：`node -e 'console.log(s.length)'`。

### 执行（gh 版，二选一）

```bash
gh api -X PATCH repos/liaolongdong/account-password-helper \
  --field 'description=🔐 账号密码管理助手 Account Password Helper — open-source local-first password manager Chrome extension (MV3, GPL-3.0): one-click autofill that ticks consent & signs in, 3 cross-subdomain tiers, built-in TOTP, encrypted personal-info vault, offline security audit, per-field AES-256-GCM in chrome.storage.local — no account, no sync server.'
```

### 复测（改完必须跑这一条）

```bash
gh api repos/liaolongdong/account-password-helper \
  --jq '.description' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{s=s.replace(/\n$/,'');console.log('UTF-16 '+s.length);console.log(s);})"
```

期望 **332**。⚠️ 这条读请求历史上不稳定（出现过 `exit 28` / `http=000` 空响应）——**不要把空响应读成「已经改好」**，必须拿到内容并核对长度。

---

## 二、Topics 四换（20 / 20 已满，PATCH 是整体替换）

线上实测 20 个，与记录逐字相同：`2factor-authentication, aes-256-gcm-encryption, authenticator, auto-login, autofill-passwords, bitwarden, browser-extensions, chrome-extensions, credential-manager, developer-tools, local-first-auth, manifest-v3-chrome, offline, password-generator-web, password-managers, password-vault, password-visibility, privacy, totp-generator, multi-environment`。

| 删                       | 为什么删                       | 加                   | 为什么加                                    |
| ------------------------ | ------------------------------ | -------------------- | ------------------------------------------- |
| `developer-tools`        | 超大桶，进来的人不要密码管理器 | `open-source`        | 高流量，且与 GPL-3.0 定位一致               |
| `browser-extensions`     | 复数形，订阅量远低于单数       | `browser-extension`  | 同义的主流写法                              |
| `password-generator-web` | 非标准 slug，几乎无人搜        | `password-generator` | 标准 slug，功能真实存在（默认 16 位、6~50） |
| `password-visibility`    | 近零检索量                     | `autofill`           | 覆盖核心卖点的高流量通用词                  |

`bitwarden` **保留**：商店四个字段禁竞品品牌名，GitHub 侧正是承接这批词的落点（`compare.html` 有逐项对照表，属相关而非蹭词）。

```bash
gh api -X PUT repos/liaolongdong/account-password-helper/topics \
  -H 'Accept: application/vnd.github.mercy-preview+json' \
  --input - <<'JSON'
{"names":["2factor-authentication","aes-256-gcm-encryption","authenticator","auto-login","autofill","autofill-passwords","bitwarden","browser-extension","chrome-extensions","credential-manager","local-first-auth","manifest-v3-chrome","multi-environment","offline","open-source","password-generator","password-managers","password-vault","privacy","totp-generator"]}
JSON
```

复测：

```bash
gh api repos/liaolongdong/account-password-helper/topics --jq '.names | length, (join(", "))'
```

期望 **20**，且四个新词在列、四个旧词不在。

---

## 三、站外投递包（awesome 列表与中文周刊）

手册 §4.5 那张表是**目标清单**，投递前逐个仓库读它自己的 `CONTRIBUTING`——这类仓库的收录门槛会变，别假设还按老规则收。每个 PR 只写一件事：这个项目是什么、为什么符合它的主题。

### 英文一句话（放 PR 描述开头）

```text
Add Account Password Helper — an open-source, local-first password manager Chrome extension (MV3) with one-click autofill and built-in TOTP. Sensitive fields are encrypted individually with AES-256-GCM in chrome.storage.local; there is no account and no sync server.
```

> ⚠️ 这句里**不要**放 `BANNED_PHRASES` 那一族里的任何一条（那张表是唯一真源，别在可直接粘贴的对外文案里复述它）。要强调网络行为就说「no account, no sync server」——这是可核对的。

### 中文一句话（周刊投稿用）

```text
账号密码管理助手：开源、本地优先的密码管理 Chrome 扩展（MV3）。逐字段 AES-256-GCM 加密只写本机存储，无账号、无同步服务器；一键填充并登录、内置 TOTP 两步验证、离线安全体检，同一站点的开发/测试/生产账号默认按精确域名隔离。
```

### 目标与理由

| 目标类型        | 仓库/渠道                                             | 一句话理由                                                     |
| --------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| Chrome 扩展合集 | `awesome-chrome-extensions`、`awesome-web-extensions` | 功能完整、MV3、有 CI 与 e2e，符合「可维护的扩展」这一栏        |
| 隐私工具合集    | `awesome-privacy`、`privacy-respecting`               | 本地优先、无账号、开源可审计，且隐私政策逐条列了仅有的两类外联 |
| 安全工具合集    | `awesome-security`、`awesome-security-tools`          | PBKDF2 60 万次 + AES-256-GCM 逐字段 + 离线泄露字典体检         |
| 中文渠道        | 阮一峰《科技爱好者周刊》、HelloGitHub、GitHubDaily    | 有完整中文文档、双语博客与在线演示                             |

### 投递前自查（三条不过就别发）

- [ ] 商店列表当前没有未处理的违规记录；
- [ ] 仓库首页截图/演示素材里没有真实账号（`assets/screenshots/` 那批旧图**不能用**，见第五节）；
- [ ] README 与落地页的版本口径与在架一致（本轮已刷到 v3.22.0）。

---

## 四、`?ref=` 归因：本轮新增与仍待自证的缺口

手册 §8.1 的登记表是唯一真源。本轮变化：

| ref                                                                                                           | 本轮状态                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blog`                                                                                                        | 此前 8 篇里只有 01/04/05 带商店链接；**02/03/06/07/08 完全没有商店入口，新增的 09/10 也一律带上** → 现在 10 篇 × 2 语言 = 20 个产物页全部至少有 1 处带归因的商店链接 |
| `ghreadme` / `aphsite` / `llms` / `psite` / `aphcmp` / `aphprice` / `aphauth` / `wechat` / `weibo` / `reddit` | 未改动                                                                                                                                                               |

🔴 **仍未自证的一件事**：`?ref=` 到底会不会出现在 Dashboard 的「安装来源」里。本轮仍无后台权限。**执行方法**：下一次提交审核后 24 小时内看「项目指标 → 安装来源」有没有对应 ref 值。后台不认就整族回退，别留着无效参数当已验证。这件事不解，「哪个渠道值得加码」永远是猜。

---

## 五、仍挂着的 P0（本轮按决定不动，只再记一次）

`assets/screenshots/01..12-*.png` 与 `assets/cws-store/0[1-8]-*.png` 含**真实账号、邮箱、当时的 TOTP 活码，其中一张含明文密码**。仓库是公开的，Pages 直接服务 `main` 根目录，所以这些文件即使没有任何页面引用，也能按 URL 直接取到。本轮引用面已全部收口到占位素材（唯一命中是 `index.html` 里一句说明退役原因的注释），**文件本身与全部历史提交仍在**。

处理强度三档（最小 / 推荐 `git filter-repo` 改写历史 + 强推 + GitHub 清缓存 / 只重录 README 素材）记录在 [exposure-status.md 第 7 项](../exposure-status.md)。改写历史与强推不可逆，需要单独授权。

---

## 六、如果只做三件事

1. 换 GitHub About（第一节的 332 字版本）——**这是唯一一处仍在线上的自我虚假隐私承诺**；
2. Topics 四换（第二节）；
3. 把 09/10 两篇发出去并守帖 48 小时（第四节依赖的数据只有发了才会有）。
