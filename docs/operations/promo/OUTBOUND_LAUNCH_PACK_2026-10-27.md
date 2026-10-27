# 站外导流发布包（2026-10-27）

面向「北极星 = Chrome 应用商店安装量」。这份文件把 [账号密码管理助手曝光提升执行手册.md](../账号密码管理助手曝光提升执行手册.md) 第五节与各平台散稿收口成**可以直接复制粘贴的定稿**：标题、正文、首评、时间窗、守帖清单。缺的不是文案，是「发出去 + 守住帖」。

**发之前先核对的四条事实**（全部以当前开发分支实现为准，线上版本号请复核一次再发）：

| 事实     | 当前值                                      | 出处                                                  |
| -------- | ------------------------------------------- | ----------------------------------------------------- |
| 在架版本 | v3.18.0（GitHub Releases 与商店同步）       | `img.shields.io/chrome-web-store/v/…` 实测 2026-10-27 |
| 商店评分 | 5 / 5，但**只有 3 条评价**                  | `…/rating-count/…` 实测同日                           |
| 用户量   | 约 14,000（商店后台读数，shields 已不公开） | 作者 2026-10-24 报告                                  |
| 仓库     | 14 stars / 1 fork / 20 topics               | `api.github.com` 实测 2026-10-27                      |

**链接一律带来源标记**（`?ref=<渠道>`，登记表见执行手册第六节；商店不解析 `utm_*`）：

```
安装：https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli?ref=<渠道>
评价：https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli/reviews?ref=<渠道>
官网：https://liaolongdong.github.io/account-password-helper/
源码：https://github.com/liaolongdong/account-password-helper
```

渠道值照下表填：`hn`、`ph`、`reddit`、`v2ex`、`juejin`、`zhihu`、`wechat`、`weibo`、`awesome`、`weekly`。

---

## 一、Show HN（英文，最高优先）

**为什么排第一**：HN 是本项目英文区唯一能一次带来四位数访客的入口，且它同时抬 star 与商店安装；2026 年此前从未真正发过。

### 标题（HN 上限 80 字符，本条实测 71）

```
Show HN: a local-first password manager for dev / staging / prod logins
```

### 正文（贴进 text 栏，纯文本，不用 markdown）

```
I wrote this because Chrome's built-in password manager can't tell qa.example.com from
example.com, and every cloud manager I tried either syncs by default or buries TOTP behind
a phone app.

It's a Manifest V3 Chrome extension, GPL-3.0, no account, no server of its own. Username,
password, URL, note and TOTP secret are encrypted field by field with AES-256-GCM (PBKDF2,
600k iterations) using the browser's native Web Crypto API, and everything is written only
to chrome.storage.local. The master password is never stored.

Three things I'd point at specifically:

1. Environment isolation. Entries match the exact hostname by default, so dev / test /
   staging / prod credentials for one app stay apart. Two widenable tiers (wildcard
   entries, same main domain) and a separate port-isolation switch handle the cases where
   you genuinely want them to line up.
2. A built-in TOTP authenticator. Codes are generated locally and live on the same entry
   as the password, so mid-login there's no phone to reach for.
3. Sub-second side panel on MV3, where the service worker dies whenever it feels like it.
   That one took more work than the encryption.

It also autofills and can click the login button, saves credentials on login, keeps a
30-day trash and password history, does an offline security audit, and stores personal
info (ID numbers, bank cards) in a separate encrypted vault.

Store: <安装链接 ?ref=hn>
Source: <源码链接>

The extension does make one outbound request: an anonymous update check every six hours
that probes the store, and GitHub Releases as fallback. It carries no user data. Happy to
answer questions about the MV3 side-panel cold-start work.
```

**为什么把版本检查主动写出来**：商店审核与 HN 评论都会去抓这种差异；先说自己做了什么，比被人翻出来再解释便宜得多。README/隐私页早已同口径披露，这条不许在帖子里省略。

### 首评（发帖后立刻自己补一条，这是 HN 的技术信任位）

```
The bit that surprised me most: keeping the side panel opening in under a second, in every
state — cold start, expired session, quick browser restart.

MV3 kills the service worker, so a "warm cache" is a lie unless you keep something alive.
Two layers do it here: a ~20s heartbeat from the worker itself plus a 0.5-minute revival
alarm (Chrome's minimum period) to bring it back when the heartbeat dies. Then, on window
focus / tab activate / after the panel opens, the extension pre-warms the files the panel
will read from disk — the full set on Windows (slow disks and AV scans are real there), a
whitelist on macOS. Data arrival then races three paths in parallel: an encrypted snapshot
in chrome.storage.session, a GET_INITIAL_DATA message to the background, and the panel's
own local read. Whichever wins first wins; none of them can block the others.

Numbers on my machine: roughly 20-50ms to data on the warm path. That's the cached case —
I don't want to sell it as a guarantee, because a cold Windows box with an antivirus scan
in the middle is a different machine, and I'd rather say "we target under a second" than
promise a floor.

Crypto is deliberately boring: PBKDF2-SHA256 at 600,000 iterations to stretch the master
password, AES-256-GCM per field, a fresh 12-byte IV on every save, and two separate
derivation paths so the stored verifier can't be turned back into the data key. No crypto
library, just Web Crypto. Changing the master password decrypts and re-encrypts five
domains (passwords, password trash, history, personal info, personal info trash) and
refuses to half-apply.
```

### 发布节奏

- **窗口**：周二到周四，北京 21:00–23:00（美东 9:00–11:00，HN 流量峰值前落地）。
- **一次只发一个链接**：用官网 `https://liaolongdong.github.io/account-password-helper/` 作 URL（商店链接常被 HN 判定为促销域而掉权重），商店链接放正文与首评。
- **守帖**：发帖后 4 小时内每条提问都回；不刷票、不找同事投票、不改标题追热度（HN 会降权）。
- **失败预案**：如果 12 小时内掉出首页，把同一素材改写成 `r/chrome_extensions` 的「我做了个 X」帖，成本为零。

---

## 二、Product Hunt

| 字段                                    | 定稿                                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Tagline（PH 上限 60 字符，本条实测 60） | `Local-first passwords, TOTP, autofill — no account, no cloud`                                                                          |
| 正文（300 字符内）                      | 首句给「谁的痛」：多环境账号在浏览器自带管理器里互相串号；第二句给四重入口与内置 TOTP；第三句给开源与 GPL-3.0；末句诚实交代匿名版本检查 |
| Topics                                  | Productivity / Developer tools / Security / Web App                                                                                     |
| 首图                                    | 复用 `assets/cws-store/marquee-en-1400x560.png`（合规重绘版，无绝对化隐私承诺）                                                         |
| Gallery                                 | 用 `assets/cws-store/screen-*.png`，顺序见本文第五节                                                                                    |

- 上线当天需要 3–5 个真实用户在前两小时留言，**不买票、不互换 upvote**（PH 会封号，也污染口碑）。
- Maker comment 用 Show HN 首评的删减版（去掉 HN 特有的口语），末尾放商店链接 `?ref=ph`。

---

## 三、Reddit（三个子版各一版，先读各版版规再发）

> 共性红线：Reddit 对自我推广极敏感。**先以「我做了个东西来解决 X」的第一人称技术叙事发帖，把链接放在正文末尾**；同一帖不要跨版同时发（会被判 spam）；每版间隔 ≥ 3 天。

### `r/chrome_extensions`（最容易过，受众最准）

```
Title: I built a local-first password manager extension (MV3, open source) because Chrome's
built-in one can't separate dev / staging / prod accounts

Body: 讲述三件事：1) 精确域名 + 端口两轴隔离怎么做到的；2) 为什么侧边栏秒开在 MV3 下需要双层
保活 + 分级预热；3) 逐字段加密与主密码换钥的五域原子性。附 store / source 链接，欢迎提兼容性
反馈（特别是 Windows + 杀软环境下是否还秒开）。
```

### `r/privacy`（重点全在「不出网」的诚实边界）

```
Title: Local-only password manager: per-field AES-256-GCM, no account, no sync — and one
anonymous update check I'm upfront about

Body: 先把「没有服务器、数据只进本地存储、主密码不落盘」的实现讲清楚；再主动交代每 6 小时的
匿名可达性探测与 GitHub Releases 回退、以及它不带任何用户数据；说明为什么不做云同步（也就不用
交代第三方托管）；给出源码可审计路径与 GPL-3.0。
```

### `r/SideProject`（可以稍微讲增长，但仍要讲实现）

```
Title: Side project: an open-source Chrome password manager with a built-in TOTP authenticator

Body: 讲动机（QA 一人跑四套环境）、讲最难的一个 feature（侧边栏冷启动白屏）、讲 14k 用户里
最常见的三条反馈如何变成产品决定（站点规则、跨子域三档、个人信息库右键召唤）。
```

三版正文里都留一句 `If you try it, a store review genuinely helps a solo open-source author`，配 `?ref=reddit` 评价链接——**只求真实用户评，不做任何激励换评**（商店政策红线）。

---

## 四、awesome 列表与中文周刊（长尾安装与 star 的稳定来源）

| 目标                      | 提交条目文本（一行，英文）                                                                                                                                                                      | 注意                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| awesome-chrome-extensions | ``[Account Password Helper](安装链接 + ?ref=awesome)` - Local-first password manager (MV3) with per-field AES-256-GCM, built-in TOTP and dev/staging/prod host isolation. GPL-3.0.`             | 按 repo 的 alphabetical / category 位置放；PR 标题写 `Add Account Password Helper` |
| awesome-privacy           | `Self-hosted-everything style: no account, no sync server, per-field AES-256-GCM in local storage; one anonymous update check every 6h (documented).`                                           | privacy 列表要求声明数据流向，**必须保留后半句**                                   |
| awesome-security          | `- `[Account Password Helper](源码链接 + ?ref=awesome)` - open-source browser password manager; PBKDF2(600k) + AES-256-GCM per field, atomic master-password re-key across five local domains.` | 强调可审计与算法参数；绝对化词一律不写（禁词表见执行手册与商店指南）               |
| 阮一峰 `weekly`           | 中文一句介绍 + GitHub 链接 + 商店链接                                                                                                                                                           | 走 `Pull Requests` 提 `issues/` 里的周刊征集，按模板格式                           |
| HelloGitHub / GitHubDaily | 中文投稿：动机 + 5 个特性点 + 截图 3 张（走各自投稿表单）                                                                                                                                       | 需要 cover 图，复用 `assets/cws-store/og-1200x630.png`                             |

---

## 五、首图与截图顺序（商店与所有帖子共用一套）

商店 listing 的第一张图就是搜索结果里的缩略图，帖子分享卡同理。建议顺序（母版 2026-10-13 整批重拍，徽章 v3.15.2；本轮 §2 要补的两张见下）：

1. `screen-1-one-click-login` —— 一眼看懂「填完还替你点登录」
2. `screen-3-multi-env` —— 同一站点 dev/test/staging/prod 各留各的账号（最差异化的画面）
3. `screen-2-totp` —— 内置动态码（搜索词命中）
4. `screen-9-inline-fill` —— 页内迷你面板（第四条入口，视觉上区别于普通表单填充）
5. **新增** `screen-identity-vault`（个人信息库 + 右键召唤后的「回到原网页」提示条）
6. `screen-4-security-audit` 或 `screen-12-import-backup`
7. **新增** `screen-onboarding-recovery`（新手引导「留退路」→ 登记离线恢复密钥）

现存 14 张（双语共 28 张母版，2026-10-13 整批重拍、徽章 v3.15.2）里没有「站点规则」和「侧边栏列表」这两张独立图——`screen-6-local-encryption` 讲的是加密字段、`screen-8-detail-drawer` 是详情抽屉，不要把它们当侧边栏图用。原则不变：第 1、2 张必须「不看文字就懂」；算法参数与隐私声明这类要读的文字不进图。

---

## 六、发布排期与守帖清单

| 日            | 动作                                           | 渠道值             |
| ------------- | ---------------------------------------------- | ------------------ |
| D0 周二 21:00 | Show HN（官网作 URL，商店链接进正文与首评）    | `hn`               |
| D0 +2h        | `r/chrome_extensions`                          | `reddit`           |
| D1            | 公众号定稿（`promo/wechat-article-draft.md`）  | `wechat`           |
| D2 周四       | Product Hunt（00:01 PST）                      | `ph`               |
| D3            | 微博（`promo/weibo-drafts.md`）+ V2EX 分享创造 | `weibo` / `v2ex`   |
| D5            | awesome-* 三个 PR 同时提                       | `awesome`          |
| D7            | `r/privacy`（错开同帖跨版）                    | `reddit`           |
| D10           | 阮一峰周刊 / HelloGitHub / GitHubDaily         | `weekly`           |
| D14           | `r/SideProject` + 掘金/知乎长文                | `juejin` / `zhihu` |

**守帖硬规则**

1. 每条提问 48 小时内必回；HN 首 4 小时逐条回。
2. 不刷票、不买评论、不用码/礼品换评——这是商店与 PH 的双红线。
3. 每个渠道记一行日志（发帖时间、链接、首小时访问、当日安装差值），写进本文档末尾的「发布记录」。
4. 复盘口径：D+7 在 CWS Dashboard「项目指标 → 安装来源」核对 ref 是否出现；出现即按渠道追加投入，不出现则回退 `?ref=` 写法并在执行手册第六节记结论（那一节已写明这一步未验证）。

---

## 七、发布记录（发一条补一行）

| 日期 | 渠道 | 链接 | 首小时访客 | 当日安装差值 | 备注 |
| ---- | ---- | ---- | ---------- | ------------ | ---- |
| —    | —    | —    | —          | —            | 待发 |
