# CWS 商店填写素材 — 复制粘贴用

> ✅ **已上架**：https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli
>
> 按 Developer Console 的页面顺序整理，逐项复制粘贴即可。后续版本更新时仅需重新上传 zip 包。

---

## 第一步：上传 zip 包

在 Dashboard 点击「新建商品」(New Item)，上传以下文件：

```
.output/account-password-helper-3.4.0-chrome.zip
```

文件位置：`/Users/liaolongdong/code/chrome-plugins/account-password-helper/.output/account-password-helper-3.4.0-chrome.zip`

> 💡 zip 文件名中的版本号跟随 `package.json`（release-please 自动维护），上传时以 `.output/` 目录中最新构建产物为准。

---

## 第二步：商店商品详情 (Store Listing)

### 名称 (Name) — 最多 45 字符

```
Account Password Helper
```

### 摘要 (Summary) — 最多 132 字符

```
为开发者与测试人员而生的本地加密密码管理器：AES-256-GCM 加密，零联网，快捷键一键登录，内置 TOTP 两步验证与安全体检，支持从 Chrome/Bitwarden/1Password 一键导入，无需注册。
```

> ⚠️ 摘要必须与 `public/_locales/zh_CN/messages.json` 的 `extensionDescription` 保持完全一致（manifest 描述受 132 字符硬限制）。英文摘要同步 `en/messages.json`：`Password manager for dev & QA: AES-256-GCM encryption, hotkey autofill, TOTP 2FA & security audit. No sign-up, zero network traffic.`

### 说明 (Description) — 最多 16,000 字符

```

一款完全免费、数据纯本地的浏览器密码管理工具，为开发者、测试人员和追求效率的你提供多环境账号管理能力。

【为什么选择它】
◆ 快捷键一键登录（不只是填充）：按下 Ctrl+Shift+F，自动填充账号 → 自动勾选协议 → 自动点击登录按钮——其他工具只填表单，登录按钮还得自己点
◆ 多环境账号隔离：精确域名匹配区分 dev/test/staging/prod，同一站点的不同环境账号互不混淆，开发者刚需
◆ 内置 TOTP + 两步登录接力：验证码和密码在一起，GitHub 式两步登录自动衔接活码胶囊，告别手机验证器，不用切 App
◆ 纯本地 AES-256-GCM，零云端：无云端、无账号、无订阅，数据全部加密在你的浏览器里，即使服务器被攻破也拿不到你的密码

【安全架构】
· 主密码经 PBKDF2（600,000 次迭代）派生 256-bit 密钥，基于 Web Crypto API 原生实现
· AES-256-GCM 认证加密，会话过期自动加密回密文
· 多种自动锁定触发：闲置超时 / 系统锁屏 / 浏览器重启（可选）
· 复制密码后剪贴板定时自动清除（默认 30 秒，可配置）
· 密码安全体检全程本地计算，不联网、不上传任何数据

【功能全览】
· 三种填充方式：快捷键一键登录（Ctrl+Shift+F）/ 侧边栏 / 内联迷你面板，自动勾选"同意条款"，可自动触发登录
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

选择：**Chinese (Simplified) - 中文（简体）**

> 💡 建议在 Store listing → Languages 中新增 **English (United States)**，填写英文标题、摘要和详细描述（见下方英文版），以覆盖英文搜索用户。

### 说明 (Description) — 英文版（English Detailed Description）

```

A 100% free, fully offline password manager built for developers, QA engineers and anyone who juggles multiple accounts across environments.

WHY DEVELOPERS LOVE IT
◆ One-keystroke login, not just fill: press Ctrl+Shift+F — the account is autofilled, "I agree" is ticked, and the login button is clicked. Other tools only fill the form; you still have to click login yourself.
◆ Multi-environment isolation: exact-domain matching separates dev / test / staging / prod credentials of the same site — same site, different environments, zero mix-ups. A must-have for developers.
◆ Built-in TOTP + 2FA handoff: verification codes live with your passwords; on GitHub-style two-step logins, the live code capsule auto-anchors beside the input — no phone authenticator app needed.
◆ Local AES-256-GCM, zero cloud: no cloud, no account, no subscription. Everything is encrypted in your browser — even if the server were breached, your passwords stay safe.

SECURITY ARCHITECTURE
· Master password → PBKDF2 (600,000 iterations) → 256-bit key, built on the native Web Crypto API
· AES-256-GCM authenticated encryption; sensitive fields re-encrypt automatically on session expiry
· Multiple auto-lock triggers: idle timeout / system lock / browser restart (optional)
· Clipboard auto-wipe after copying passwords (default 30s, configurable)
· Security audit runs 100% offline — no data leaves your machine

FULL FEATURE SET
· 3 autofill modes: one-keystroke shortcut (Ctrl+Shift+F) / side panel / inline mini-panel; auto-ticks "I agree" checkboxes; optional auto-login trigger
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

### 小幅推广图片 (Small Promo Tile) — 440×280（可选）

可暂时跳过。

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

## 检查清单

上传前确认：

- [ ] zip 包已上传
- [ ] 名称、摘要、说明已填写
- [ ] 分类选择 Productivity
- [ ] 商店图标已上传（128×128）
- [ ] 至少 1 张截图已上传
- [ ] 隐私政策 URL 已填写
- [ ] 数据使用声明已选择「不收集」
- [ ] 所有权限的合理性说明已填写
- [ ] 可见性选择 Public
- [ ] 点击「提交审核」
