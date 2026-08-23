# CWS 商店填写素材 — 复制粘贴用

> ✅ **已上架**：https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli
>
> 按 Developer Console 的页面顺序整理，逐项复制粘贴即可。后续版本更新时仅需重新上传 zip 包。

---

## 第一步：上传 zip 包

在 Dashboard 点击「新建商品」(New Item)，上传以下文件：

```
.output/account-password-helper-3.5.0-chrome.zip
```

> 💡 zip 文件名中的版本号跟随 `package.json`（release-please 自动维护），上传时以 `.output/` 目录中最新构建产物为准。当前版本：**3.5.0**。

---

## 第二步：商店商品详情 (Store Listing)

### 名称 (Name) — 最多 45 字符

```
账号密码管理助手 - 本地加密密码管理器
```

### 摘要 (Summary) — 最多 132 字符

```
为开发者与测试人员而生的本地加密密码管理器：AES-256-GCM 加密，零联网，快捷键一键登录，内置 TOTP 两步验证与安全体检，支持从 Chrome/Bitwarden/1Password 一键导入，无需注册。
```

> ⚠️ 摘要必须与 `public/_locales/zh_CN/messages.json` 的 `extensionDescription` 保持完全一致（manifest 描述受 132 字符硬限制）。英文摘要同步 `en/messages.json`：`Password manager for dev & QA: AES-256-GCM encryption, hotkey autofill, TOTP 2FA & security audit. No sign-up, zero network traffic.`

### 说明 (Description) — 最多 16,000 字符

```

一款开源免费、数据纯本地的浏览器密码管理器——快捷键一键登录（自动填充 → 勾选协议 → 点击登录，不只是填表），精确域名匹配隔离 dev/test/staging/prod 多环境账号，为开发者和测试人员量身打造。无云端、无账号、无订阅，AES-256-GCM 全加密，数据只留在你的浏览器里。

【为什么选择它】
◆ 快捷键一键登录（不只是填充）：按下 Ctrl+Shift+F，自动填充账号 → 自动勾选协议 → 自动点击登录按钮——其他工具只填表单，登录按钮还得自己点
◆ 多环境账号隔离：精确域名匹配区分 dev/test/staging/prod，同一站点的不同环境账号互不混淆，开发者刚需
◆ 内置 TOTP + 两步登录接力：验证码和密码在一起，GitHub 式两步登录自动衔接活码胶囊，告别手机验证器，不用切 App
◆ 纯本地 AES-256-GCM，零云端：无云端、无账号、无订阅，数据全部加密在你的浏览器里，即使服务器被攻破也拿不到你的密码
◆ 密码可见性切换：为页面密码框注入显隐切换按钮（偏好设置中开启），填充后一键确认输入内容，无需另装独立扩展

【安全架构】
· 主密码经 PBKDF2（600,000 次迭代）派生 256-bit 密钥，基于 Web Crypto API 原生实现
· AES-256-GCM 认证加密，会话过期自动加密回密文
· 多种自动锁定触发：闲置超时 / 系统锁屏 / 浏览器重启（可选）
· 复制密码后剪贴板定时自动清除（默认 30 秒，可配置）
· 密码安全体检全程本地计算，不联网、不上传任何数据

【功能全览】
· 三种填充方式：快捷键一键登录（Ctrl+Shift+F）/ 侧边栏 / 内联迷你面板，自动勾选"同意条款"，可自动触发登录
· 密码可见性切换：为页面密码框注入显隐切换按钮（偏好设置中开启），填充后一键确认输入内容，无需另装扩展
· TOTP 两步验证：扫描网页二维码或上传图片一键添加密钥，验证码按 RFC 6238 本地生成，GitHub 式两步登录自动衔接活码胶囊
· 密码安全体检：一键生成 0-100 综合评分，五维检测——弱密码 / 密码复用 / 常见泄露密码（离线字典）/ 长期未更新 / 未开两步验证，支持到期提醒
· 自动保存凭证：登录即弹窗确认，凭证指纹智能去重，支持域名白名单/黑名单、「不再提示」一键屏蔽
· 导入导出：CSV / JSON 双格式，自动识别 Chrome、LastPass、Bitwarden、1Password 导出格式；.aph 加密备份、邮箱备份提醒
· 密码生成器：随机密码 + EFF 助记词组双模式，Web Crypto 密码学安全随机
· 回收站与修改历史：删除条目保留 30 天可恢复，每条密码保留 5 份加密快照，改错可回滚
· 智能搜索：拼音 / 首字母缩写搜索、标签分类、收藏置顶、一键去重、批量管理
· 6 款色彩主题（晴空蓝/青竹绿/桃花粉/樱粉紫/落霞橙/雾墨灰）、中英文双语界面即时切换

【温馨提示】
本插件为开发、测试与日常登录场景设计，建议不要在任何浏览器扩展中存放银行、支付等高敏感凭证。

反馈邮箱：924902324@qq.com
官网与使用教程：https://liaolongdong.github.io/account-password-helper/
开源地址：https://github.com/liaolongdong/account-password-helper

```

### 分类 (Category)

选择：**Productivity**（效率工具）

### 语言 (Language)

默认语言选择：**Chinese (Simplified) - 中文（简体）**

> ⚠️ **Featured 硬性要求：必须支持英文。** 在 Store listing → Languages 中点击「Add language」，新增 **English (United States)**，填写以下三个字段：

#### English (United States) 语言标签页字段

**Name（名称）— 最多 45 字符**

```
Account Password Helper – Password Manager
```

**Summary（摘要）— 最多 132 字符**

```
Password manager for dev & QA: AES-256-GCM encryption, hotkey autofill, TOTP 2FA & security audit. No sign-up, zero network traffic.
```

> ⚠️ 英文摘要必须与 `public/_locales/en/messages.json` 的 `extensionDescription` 保持完全一致。

**Description（说明）— 最多 16,000 字符**

```

A 100% free, fully offline password manager built for developers, QA engineers and anyone who juggles multiple accounts across environments.

WHY DEVELOPERS LOVE IT
◆ One-keystroke login, not just fill: press Ctrl+Shift+F — the account is autofilled, "I agree" is ticked, and the login button is clicked. Other tools only fill the form; you still have to click login yourself.
◆ Multi-environment isolation: exact-domain matching separates dev / test / staging / prod credentials of the same site — same site, different environments, zero mix-ups. A must-have for developers.
◆ Built-in TOTP + 2FA handoff: verification codes live with your passwords; on GitHub-style two-step logins, the live code capsule auto-anchors beside the input — no phone authenticator app needed.
◆ Local AES-256-GCM, zero cloud: no cloud, no account, no subscription. Everything is encrypted in your browser — even if the server were breached, your passwords stay safe.
◆ Password visibility toggle: injects a show/hide button into page password fields (enable in preferences) — verify filled content with one click, no separate extension needed.

SECURITY ARCHITECTURE
· Master password → PBKDF2 (600,000 iterations) → 256-bit key, built on the native Web Crypto API
· AES-256-GCM authenticated encryption; sensitive fields re-encrypt automatically on session expiry
· Multiple auto-lock triggers: idle timeout / system lock / browser restart (optional)
· Clipboard auto-wipe after copying passwords (default 30s, configurable)
· Security audit runs 100% offline — no data leaves your machine

FULL FEATURE SET
· 3 autofill modes: one-keystroke shortcut (Ctrl+Shift+F) / side panel / inline mini-panel; auto-ticks "I agree" checkboxes; optional auto-login trigger
· Password visibility toggle: injects a show/hide button into page password fields (enable in preferences) — verify filled content with one click, no separate extension needed
· Built-in TOTP 2FA: scan on-page QR codes or upload images to add keys; codes generated locally (RFC 6238); auto-anchors a live code capsule on GitHub-style two-step login pages
· Security audit: 0–100 score with five checks — weak / reused / commonly leaked (offline dictionary) / stale / missing 2FA; expiry reminders included
· Auto-capture credentials on login with smart dedup and domain allow/block lists; one-click "Never for this site"
· Import / export: CSV & JSON; auto-detects exports from Chrome, LastPass, Bitwarden, 1Password; .aph encrypted backup + email backup reminders
· Password generator: random & EFF diceware passphrase modes, Web Crypto CSPRNG
· Trash bin (30 days) + 5 encrypted snapshots per entry — roll back any mistake
· Fuzzy search with pinyin / initials, tags, favorites, one-tap dedupe, batch operations
· 6 color themes, Chinese / English bilingual UI with instant switching

A friendly note: the extension is designed for development, testing and everyday sign-in scenarios. We recommend not storing highly sensitive credentials (banking, payment, etc.) in any browser extension.

Feedback: 924902324@qq.com
Docs & demo: https://liaolongdong.github.io/account-password-helper/
Source code: https://github.com/liaolongdong/account-password-helper

```

---

## 第三步：图形资产 (Graphic Assets)

### 商店图标 (Store Icon) — 128×128 PNG

使用项目中的文件：

```
public/icon/128.png
```

### 屏幕截图 (Screenshots) — 至少 1 张，1280×800 或 640×400

使用 `assets/screenshots/` 目录中的截图文件（共 12 张，按功能编号命名）：

```
01-master-password.png    # 设置主密码
02-password-list.png      # 密码列表与管理
03-excel-import.png       # CSV 批量导入
04-excel-export.png       # 数据批量导出
05-add-account.png        # 添加新账号
06-sidepanel-fill.png     # 侧边栏一键填充
07-floating-button.png    # 悬浮按钮快捷入口
08-session-validity.png   # 灵活的会话有效期
09-totp-code.png          # TOTP 两步验证
10-health-check.png       # 安全体检仪表盘
11-inline-fill.png        # 内联填充迷你面板
12-theme-skin.png         # 主题换肤与双语界面
```

### 小幅推广图片 (Small Promo Tile) — 440×280

使用项目中的文件：

```
assets/cws-store/small-promo-440x280.png
```

> 💡 Featured 提名建议上传此图，完善商店展示素材完整度。

### 演示 GIF（Demo GIF）— Featured 加分项

> 非必须，但官方推荐提供演示视频/GIF 展示核心功能，能显著提升审核印象。

**GIF 1：一键登录演示（必做）**

| 项目     | 要求                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------ |
| 内容脚本 | 打开登录页 → 按下 `Ctrl+Shift+F` → 账号密码自动填充 → "同意协议"自动勾选 → 登录按钮自动点击 → 登录成功 |
| 时长     | 10–15 秒                                                                                               |
| 宽度     | 800–1000px                                                                                             |
| 文件大小 | ≤ 5MB（可用 [ezgif.com](https://ezgif.com) 或 `ffmpeg` 压缩）                                          |
| 存放位置 | `docs/demo-login.gif`（README 首屏引用）                                                               |
| 录制工具 | 推荐 macOS 自带屏幕录制 / LICEcap / ScreenToGif                                                        |
| 压缩命令 | `ffmpeg -i input.mp4 -vf "fps=15,scale=900:-1" -loop 0 demo-login.gif`                                 |

**GIF 2：TOTP 两步验证接力（加分）**

| 项目     | 要求                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| 内容脚本 | GitHub 登录 → 密码自动填充 → 跳转验证码页 → 活码胶囊自动锚定 → 一键填入验证码 → 登录成功 |
| 时长     | 15–20 秒                                                                                 |
| 规格     | 同上                                                                                     |
| 存放位置 | `docs/demo-totp.gif`（推广文章配图用）                                                   |

**录制注意事项**

1. 使用干净的 Chrome Profile（无多余扩展/书签干扰）
2. 隐藏地址栏和标签栏（Chrome 菜单 → 查看 → 始终显示书签栏 → 取消勾选）
3. 填充前稍作停顿 1 秒，让观看者看清页面
4. 确保快捷键操作可见（可在录制前用按键可视化工具如 keycastr 显示按键）

---

## 第四步：其他字段 (Additional Fields)

### 官方网站 (Official Website)

```
https://liaolongdong.github.io/account-password-helper/
```

### 支持页面 (Support Page)

```
https://github.com/liaolongdong/account-password-helper/issues
```

### 主页 (Homepage) — 可选

```
https://github.com/liaolongdong/account-password-helper
```

---

## 第五步：隐私惯例 (Privacy Practices)

### 隐私政策 URL (Privacy Policy URL)

```
https://liaolongdong.github.io/account-password-helper/privacy.html
```

### 数据使用声明

在以下选项中，全部选择「不收集」/「None」：

- 数据类型：**不收集任何用户数据**
- 远程代码：**不使用远程代码**
- 分析工具：**不使用分析工具**

### 权限合理性说明 (Permission Justifications)

每项权限的说明文本：

**storage**

```
用于在浏览器本地存储加密后的密码数据和用户偏好设置，所有敏感数据使用 AES-256-GCM 加密。
```

**activeTab**

```
在当前活动标签页中检测登录表单（用户名和密码输入框），并提供自动填充功能。
```

**scripting**

```
向网页注入表单检测脚本和自动填充脚本，实现智能识别登录表单并一键填充凭据。
```

**sidePanel**

```
提供浏览器侧边栏面板，用于集中管理、搜索、编辑所有已保存的密码条目。
```

**alarms**

```
定时执行版本更新检查（每 6 小时）、自动备份提醒和 Service Worker 保活（全平台常驻，后台约每 30 秒唤醒一次以保证侧边栏秒开），通过 chrome.alarms API 实现。
```

**notifications**

```
向用户发送桌面通知，包括版本更新提示和定期备份提醒。
```

**idle**

```
检测用户空闲状态，在超过设定的超时时间后自动锁定扩展；同时支持浏览器重启锁定功能，在浏览器重新启动时检测是否需要重新验证主密码，保护密码安全。
```

**clipboardWrite**

```
支持将密码复制到系统剪贴板，并在可配置的时间后自动清除剪贴板内容。
```

**clipboardRead**

```
读取剪贴板内容，用于在自动清除剪贴板前验证内容未被用户替换，确保密码清除的安全性和准确性。
```

**webNavigation**

```
监听页面导航事件（页面加载完成），优化表单检测时机，确保在页面渲染完成后及时检测登录表单。
```

**favicon**

```
读取 Chrome 本地缓存的网站图标（_favicon/ 端点），在密码列表和侧边栏展示条目对应网站的图标，提升长列表的视觉辨识效率。图标完全来自浏览器本地缓存，不向任何外部服务器发起请求。
```

**Host permissions: <all_urls>**

```
需要在任意网站上检测登录表单并提供自动填充功能。这是密码管理扩展的核心功能需求——用户可能在任何网站登录账号，扩展需要能够在所有网站上工作。扩展不会向任何外部服务器传输数据，所有操作均在本地完成。
```

---

## 第六步：分发 (Distribution)

### 可见性 (Visibility)

选择：**公开 (Public)**

### 发布方式

首次上传需手动提交审核。后续版本可通过 CI/CD 自动发布。

---

## 第七步：Featured 精选徽章提名 (Featured Badge Nomination)

> ⏰ **每 6 个月只能提名一次**，提交前确保商店列表（第二步~第六步）已 100% 打磨完成。
>
> 🔑 **插件 ID**：`fgimkdodpjfkddmildjieojpfakpanli`
>
> 📧 **联系邮箱**：924902324@qq.com

### 入口地址

| 名称                     | 链接                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **提名表单（直接入口）** | https://support.google.com/chrome_webstore/contact/one_stop_support                                           |
| Chrome 开发者官方文档    | https://developer.chrome.com/docs/webstore/discovery                                                          |
| Google 官方博客公告      | https://blog.google/products-and-platforms/products/chrome/find-great-extensions-new-chrome-web-store-badges/ |

### 操作步骤（图文指引）

**Step 1** — 打开 Chrome Web Store One Stop Support 页面

访问上方「提名表单」链接，或从以下路径进入：

> Chrome 应用商店开发者后台 → 页面底部「联系我们」/「Need help?」 → Chrome Web Store One Stop Support

**Step 2** — 选择问题类型

在下拉菜单中选择：

> **My item (extensions, app, or theme)**

**Step 3** — 选择提名选项

在后续选项中选择：

> **I want to nominate my extension to receive a Featured badge and be eligible for merchandising**

**Step 4** — 登录开发者账号

使用你发布扩展时所用的 Google 账号登录（必须与 Chrome Web Store Developer Console 一致）。

**Step 5** — 填写提名表单

表单会要求填写以下信息：

- **Extension ID**：填入 `fgimkdodpjfkddmildjieojpfakpanli`
- **Contact email**：填入 `924902324@qq.com`
- **正文区域**：按下方 7.2 的三段英文文案逐字段粘贴

**Step 6** — 提交并等待审核

提交后等待人工审核，周期约 **10 天**（实际从几天到一个月不等），审核结果通过邮件通知，徽章自动展示在商店页面。

### 7.1 提名前自查清单

| #   | 检查项           | 要求                                | 现状                                               |
| --- | ---------------- | ----------------------------------- | -------------------------------------------------- |
| 1   | Manifest V3      | 硬性要求                            | ✅ 已满足                                          |
| 2   | 数据安全         | 用户数据不得明文传输                | ✅ 已满足（零网络传输）                            |
| 3   | 隐私政策         | 有公开 URL，与商店 Privacy 标签一致 | ✅ 已满足                                          |
| 4   | Marquee 宣传图   | 1400×560                            | ✅ 已上传（assets/cws-store/marquee-1400x560.png） |
| 5   | 权限最小化       | 只申请必要权限并解释用途            | ✅ 已满足                                          |
| 6   | 单一用途         | 用途清晰单一                        | ✅ 已满足（密码管理）                              |
| 7   | 核心功能无付费墙 | 核心功能免费                        | ✅ 已满足（完全免费）                              |
| 8   | 无未解决违规     | 无政策违规记录                      | ✅ 已满足                                          |
| 9   | 性能             | 高效运行、不滥用资源                | ✅ 已满足（侧边栏 20-50ms）                        |
| 10  | 商店列表质量     | 标题/描述/截图完整高质量            | ✅ 按第二步~第六步完成                             |

### 7.2 提名表单文案 — 英文（直接粘贴）

**What is the purpose of your extension? Describe the value it provides to Chrome users.（扩展程序的用途是什么？说明它为 Chrome 用户带来的价值。）**

```
Account Password Helper is a free, open-source, 100% offline password manager — one-keystroke login (autofill → tick "I agree" → click login, not just form fill), exact-domain matching to isolate dev/test/staging/prod accounts, built for developers and QA engineers. No cloud, no account, no subscription. AES-256-GCM encrypted, all data stays in your browser.

Key differentiators:
• One-keystroke login (Ctrl+Shift+F): autofills credentials, ticks "I agree", clicks login — complete sign-in in under 1 second
• Multi-environment isolation: exact-domain matching separates dev/test/staging/prod accounts for the same site
• Built-in TOTP authenticator: RFC 6238 codes generated locally, auto-anchors on GitHub-style 2FA pages
• Offline security audit: 0–100 score across 5 dimensions (weak/reused/leaked/stale/missing 2FA), all computed on-device
• Zero-cost migration: one-click import from Chrome, LastPass, Bitwarden, 1Password (CSV/JSON)

Completely free, no paywall, no subscription, no data collection. Open source (GPL-3.0).
```

**How do users use your extension? Provide examples of primary use cases.（应如何使用您的扩展程序？请提供主要使用情形示例。）**

```
SETUP (one-time): Install → set master password → add accounts manually or bulk-import from CSV/JSON.

1) One-keystroke login: A QA engineer presses Ctrl+Shift+F on a staging login page — account autofilled, agreement ticked, login clicked — under 1 second.

2) Multi-environment management: A developer manages dev/staging/prod accounts for the same site. Exact-domain matching keeps credentials separated.

3) TOTP handoff: User signs into GitHub. After password autofill, a live TOTP capsule auto-anchors beside the 2FA input — one-click entry, no phone needed.

4) Inline autofill: Login form detected → key icon → compact dropdown with matching accounts → select to fill (Ctrl+Shift+K).

5) Offline security audit: Monthly scan generates a 0–100 score (weak/reused/leaked/stale/missing 2FA). All computed locally.

6) Auto-save: New login detected → prompt to save. Smart dedup + domain allow/block lists.

Shortcuts: Ctrl+Shift+P (manage) / L (panel) / F (login) / K (inline). All customizable.
```

**Indicate any other products, platforms, or restricted websites (e.g., Netflix account, Adobe Creative Suite account, banking, intranet domains, etc.) that your extension requires access to in order to fulfill its purpose.（指明您的扩展程序为实现其用途而需要访问的其他产品、平台或受限网站。）**

```
Account Password Helper does NOT require access to any third-party products, platforms, or restricted websites. It does not connect to, depend on, or interact with any external service.

The extension works entirely offline:
• All data encrypted and stored in chrome.storage.local
• Cryptography uses the browser's native Web Crypto API (PBKDF2 + AES-256-GCM)
• No network requests — no telemetry, analytics, cloud sync, or remote resources

The only optional network access: a version-update check (every 6h) via GitHub's public API (api.github.com). No user data is sent — only the latest version number is received.

<all_urls> host permission is used solely to:
• Detect login forms on any webpage via Content Scripts
• Provide autofill on any website the user visits
• Read website favicons from Chrome's local cache

No specific website accounts are required. The extension treats all websites uniformly as autofill targets.
```

### 7.3 提名表单文案 — 中文（参考对照）

**扩展程序的用途是什么？说明它为 Chrome 用户带来的价值。**

```
账号密码管理助手是一款免费、100% 离线的密码管理器，专为开发者、测试工程师和注重隐私的用户打造。所有凭证使用 PBKDF2（600,000 次迭代）+ AES-256-GCM 本地加密，数据永不离开浏览器——无服务器、无账号、无网络传输。

核心差异化价值：
• 快捷键一键登录（Ctrl+Shift+F）：自动填充账号、勾选"同意协议"、点击登录按钮，1 秒内完成登录
• 多环境账号隔离：精确域名匹配区分同一站点的 dev/test/staging/prod 账号
• 内置 TOTP 验证器：RFC 6238 验证码本地生成，GitHub 式两步登录自动锚定活码胶囊
• 离线安全体检：0–100 评分，五维检测（弱密码/复用/泄露/过期/未开 2FA），全程本地计算
• 零成本迁移：一键导入 Chrome/LastPass/Bitwarden/1Password 导出文件（CSV/JSON）

完全免费，无付费墙、无订阅、无数据收集。开源（GPL-3.0）。
```

**应如何使用您的扩展程序？请提供主要使用情形示例。**

```
初始设置（一次性）：安装 → 设置主密码 → 手动添加或从 CSV/JSON 批量导入账号。

1) 快捷键一键登录：测试工程师在 staging 登录页按 Ctrl+Shift+F——账号自动填充、协议自动勾选、登录按钮自动点击，1 秒内完成。

2) 多环境凭证管理：开发者管理同一应用 dev/staging/prod 的账号，精确域名匹配确保各环境凭证互不混淆。

3) TOTP 两步验证接力：登录 GitHub，密码填充后下一页要求验证码，扩展自动锚定活码胶囊，一键填入，无需手机验证器。

4) 内联填充：检测到登录表单 → 钥匙图标出现 → 点击展开匹配账号下拉面板 → 选择即填充（Ctrl+Shift+K）。

5) 离线安全体检：每月扫描生成 0–100 评分（弱密码/复用/泄露/过期/未开 2FA），全程本地计算。

6) 自动保存：检测到新登录 → 弹窗确认保存，智能去重 + 域名白名单/黑名单。

快捷键：Ctrl+Shift+P（管理）/ L（侧边栏）/ F（登录）/ K（内联），均可自定义。
```

**指明您的扩展程序为实现其用途而需要访问的其他产品、平台或受限网站。**

```
账号密码管理助手不需要访问任何第三方产品、平台或受限网站，不连接、不依赖任何外部服务。

本扩展完全离线运行：
• 所有数据加密存储在 chrome.storage.local
• 密码学操作使用浏览器原生 Web Crypto API（PBKDF2 + AES-256-GCM）
• 无网络请求——无遥测、无分析、无云端同步、无远程资源

唯一可选网络请求：每 6 小时通过 GitHub 公开 API（api.github.com）检测版本更新，不发送任何用户数据。

<all_urls> 主机权限仅用于：
• 通过 Content Script 检测任意网页的登录表单
• 在任意网站提供自动填充功能
• 从 Chrome 本地缓存读取网站图标

不需要特殊访问任何特定网站账号，扩展对所有网站一视同仁。
```

### 7.4 注意事项

- **先申请 Featured，再埋竞品词**：有开发者反馈商店列表埋竞品词后反而影响 Featured 审核。
- **用户量不是门槛**：即使不到 100 个用户，只要符合质量标准也能获批。
- **徽章可被撤销**：获批后若质量下降、出现违规或性能问题，Google 会移除徽章。
- **不能购买**：Featured 完全基于质量评估，没有任何付费通道。
- **获批后动作**：截图留存展示数据变化，同步在社交媒体官宣。
- **审核周期**：约 10 天（实际从几天到一个月不等），通过后邮件通知，徽章自动展示。

---

## 检查清单

### 商店上传前确认

- [ ] zip 包已上传
- [ ] 名称、摘要、说明已填写（中英文）
- [ ] 分类选择 Productivity
- [ ] 商店图标已上传（128×128）
- [ ] 至少 1 张截图已上传（建议 5 张以上精选截图）
- [ ] Marquee 宣传图（1400×560）已上传
- [ ] Small Promo Tile（440×280）已上传
- [ ] 隐私政策 URL 已填写
- [ ] 数据使用声明已选择「不收集」
- [ ] 所有权限的合理性说明已填写
- [ ] 可见性选择 Public
- [ ] 点击「提交审核」

### 英文语言支持（Featured 硬性要求）

- [ ] Store listing → Languages 已新增 English (United States)
- [ ] 英文 Name 已填写（Account Password Helper）
- [ ] 英文 Summary 已填写（与 `public/_locales/en/messages.json` 一致）
- [ ] 英文 Description 已填写（完整版英文描述）

### Featured 徽章提名

- [ ] 商店列表 100% 打磨完成（第二步~第六步全部就绪）
- [ ] 英文语言版本已添加（Languages → English）
- [ ] Marquee 宣传图（1400×560）已在商店上传
- [ ] Small Promo Tile（440×280）已在商店上传
- [ ] 演示 GIF 已制作（`docs/demo-login.gif`，可选但推荐）
- [ ] 7.2 英文提名文案已逐字段粘贴到 One Stop Support 表单
- [ ] 插件 ID（`fgimkdodpjfkddmildjieojpfakpanli`）与联系邮箱已填写
- [ ] 提交后记录日期（6 个月内不可重复提名）
