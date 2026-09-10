# Account Password Helper · 账号密码管理助手

**中文** | [English](./README.en.md)

[![Star on GitHub](https://img.shields.io/badge/%E2%AD%90_Star_on_GitHub-24292f?logo=github&logoColor=white)](https://github.com/liaolongdong/account-password-helper/stargazers)
[![WXT](https://img.shields.io/badge/WXT-v0.20.27-4E88FF)](https://wxt.dev/)
[![Vue](https://img.shields.io/badge/Vue-v3.5.41-42b883)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v6.0.3-3178c6)](https://www.typescriptlang.org/)
[![Element Plus](https://img.shields.io/badge/Element%20Plus-v2.14.4-409EFF)](https://element-plus.org/)
[![Manifest V3](https://img.shields.io/badge/Chrome-MV3-4285F4)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](#许可证)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/fgimkdodpjfkddmildjieojpfakpanli?label=CWS&logo=googlechrome&logoColor=white&color=4285F4)](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)
[![Chrome Web Store Users](https://img.shields.io/chrome-web-store/users/fgimkdodpjfkddmildjieojpfakpanli?label=Users&logo=googlechrome&logoColor=white&color=4285F4)](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)
[![Chrome Web Store Rating](https://img.shields.io/chrome-web-store/rating/fgimkdodpjfkddmildjieojpfakpanli?label=Rating&color=4285F4)](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)
[![Release](https://img.shields.io/github/v/release/liaolongdong/account-password-helper?label=Release&logo=github&color=24292f)](https://github.com/liaolongdong/account-password-helper/releases/latest)
[![Last Commit](https://img.shields.io/github/last-commit/liaolongdong/account-password-helper?logo=github&logoColor=white&label=Last%20Commit)](https://github.com/liaolongdong/account-password-helper/commits/main)

> **开源免费的本地优先密码管理器** · 一键登录（填充 → 勾选 → 点击） · 本地 AES-256-GCM 零云端 · TOTP 两步验证 · 安全体检 · 多环境账号隔离 · 从 Chrome / Bitwarden / 1Password 一键迁移 · 为开发者与测试人员量身打造

一款**开源免费**的本地加密 Chrome 密码管理扩展，为开发者与测试人员量身打造：**一键登录**（自动填充 + 勾选「记住我 / 同意条款」+ 点击登录，不只是填充）、精确域名匹配隔离 dev/test/staging/prod 多环境账号、内置 **TOTP 两步验证**、安全体检与**密码生成器**。采用 **PBKDF2（600,000 次迭代）+ AES-256-GCM** 加密体系，侧边栏全场景秒开（SLA <1s；缓存快路径 **20-50ms** 拿到数据），密码数据不出本机，无需注册账号。

> **安全声明**：账号密码管理助手为开发、测试与日常登录场景而生：所有数据仅保存在浏览器本地，敏感字段经 AES-256-GCM 逐字段加密，密码数据永不经过网络传输——扩展唯一的出站行为是每 6 小时一次的版本更新检查（匿名读取 Chrome 商店可达性与 GitHub Releases 版本号，不携带任何账号数据），详见[权限与数据流向](#-权限与数据流向)。为保障您的资产安全，建议不要在任何浏览器扩展中存放银行、支付等高敏感凭证。
>
> 🌐 **在线演示**: https://liaolongdong.github.io/account-password-helper/
>
> 📊 **技术亮点**: PBKDF2 600K 迭代 · AES-256-GCM 认证加密 · 侧边栏全场景秒开（缓存快路径 20-50ms 拿到数据）· 6 款主题 · 中英文双语 · 核心功能离线可用 · 632 项自动化测试

**目录**：[功能界面](#-功能界面截图密码列表--侧边栏--totp--安全体检) · [为什么选择它](#-为什么选择它) · [核心特性](#核心特性) · [权限与数据流向](#-权限与数据流向) · [快速开始](#快速开始) · [使用指南](#使用指南) · [常见问题](#常见问题) · [许可证](#许可证)

<p align="center">
  <img src="./assets/icons/icon.svg" alt="插件图标" width="120" />
</p>

<p align="center">
  <img src="./docs/demo-login.webp" alt="一键登录演示" width="100%" />
  <br/>
  <sub>Ctrl+Shift+F → 自动填充 → 勾选「记住我 / 同意条款」→（开启「自动触发登录」后）自动点击登录 → 2FA 两步验证活码接力，1 秒完成</sub>
</p>

## 🖥️ 功能界面截图（密码列表 / 侧边栏 / TOTP / 安全体检）

<p align="center">
  <img src="./assets/screenshots/02-password-list.png" alt="密码列表与管理" width="100%" />
  <br/>
  <sub>密码列表管理 — 智能搜索、标签分类、收藏置顶、一键去重</sub>
</p>

<p align="center">
  <img src="./assets/screenshots/06-sidepanel-fill.png" alt="侧边栏快速填充" width="100%" />
  <br/>
  <sub>侧边栏快速填充 — 拼音首字母搜索，命中高亮，秒级响应</sub>
</p>

<p align="center">
  <img src="./assets/screenshots/09-totp-code.png" alt="TOTP 两步验证" width="100%" />
  <br/>
  <sub>TOTP 两步验证 — 验证码和密码在一起，告别手机验证器</sub>
</p>

<p align="center">
  <img src="./assets/screenshots/10-health-check.png" alt="安全体检仪表盘" width="100%" />
  <br/>
  <sub>安全体检仪表盘 — 四维加权评分，全程本地计算</sub>
</p>

<p align="center">
  <img src="./assets/screenshots/11-inline-fill.png" alt="内联填充迷你面板" width="100%" />
  <br/>
  <sub>内联填充迷你面板 — 输入框钥匙图标，点击即填</sub>
</p>

<p align="center">
  <img src="./assets/screenshots/12-theme-skin.png" alt="主题换肤与双语界面" width="100%" />
  <br/>
  <sub>6 款色彩主题 + 中英文双语界面，即时切换</sub>
</p>

## ✨ 为什么选择它

| 特性                              | 与其他密码管理器的区别                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ⚡ **一键登录，不只是填充**       | 快捷键 `Ctrl+Shift+F` 一次走完「填充账号 → 勾选记住我/同意」，打开「自动触发登录」或用侧边栏「填充并登录」即可连登录按钮一起点掉。其他工具只填充，**登录按钮还得自己点** |
| 🎯 **多环境账号隔离**             | 精确域名匹配区分 dev/test/staging/prod——**同一站点的不同环境账号互不混淆**，开发者刚需                                                                                   |
| 🔑 **内置 TOTP + 两步登录接力**   | 验证码和密码在一起；GitHub 式两步登录自动衔接活码胶囊，**告别手机验证器，不用切 App**                                                                                    |
| 🔒 **纯本地 AES-256-GCM，零云端** | 无云端、无账号、无订阅，**也就没有可供攻破的服务器**。用户名/密码/网址/备注/TOTP 五个敏感字段逐字段密文存储，标签与时间戳等非敏感元数据保持明文用于列表展示              |
| 📊 **离线安全体检**               | 一键 0-100 评分，四维加权：密码复用 35 / 弱密码 25 / 命中离线泄露字典 20 / 长期未更新 20（未开 2FA 仅提示、不扣分），**全程离线计算**                                    |
| 📦 **一键迁移，零门槛**           | 自动识别 Chrome / LastPass / Bitwarden / 1Password 导出格式，CSV/JSON 双格式，**30 秒搬家**                                                                              |

## 适合谁

- **开发者** — 精确域名匹配隔离 dev / test / staging / prod 多环境账号，同一站点不同环境凭证互不混淆
- **测试工程师** — 快速切换测试账号，`Ctrl+Shift+F` 一键填充，开启「自动触发登录」后连登录按钮一起点掉，跨环境效率翻倍
- **隐私敏感用户** — 纯本地 AES-256-GCM 加密，密码数据不出本机（仅每 6 小时一次匿名版本检查，见[权限与数据流向](#-权限与数据流向)），无需注册账号，无需云端同步
- **日常用户** — 告别记忆密码，内置 TOTP 两步验证，密码生成器一键创建强密码

## 与其他密码管理器的对比

| 功能                           | Account Password Helper |        Bitwarden         |        1Password         |          Chrome 自带           |
| ------------------------------ | :---------------------: | :----------------------: | :----------------------: | :----------------------------: |
| 价格                           |        完全免费         | 免费 / 高级版约 $10/年起 | $2.99/月起（以官网为准） |              免费              |
| 数据存储                       |         纯本地          |           云端           |           云端           | 本地 + Google 账号同步（可选） |
| 需要注册账号                   |           否            |            是            |            是            |               否               |
| 一键登录（填充 + 勾选 + 点击） |       是，零配置        |    需额外设置/仅填充     |    需额外设置/仅填充     |             仅填充             |
| 多环境账号隔离                 |           是            |            否            |            否            |               否               |
| TOTP 验证器                    |    内置（同一扩展）     |  独立免费 App / 高级版   |     所有订阅方案均含     |               否               |
| 离线安全体检（0-100 评分）     |           是            |            否            |    托管式 Watchtower     |     有泄露密码检查，无评分     |
| 开源（GPL-3.0）                |           是            |            是            |            否            |               否               |

> 竞品信息（价格、功能边界）截至 2026-09，各厂商调整频繁，请以官网为准。

## 核心特性

### 🔐 安全防护

- **浏览器原生强加密**：基于 Web Crypto API，主密码经 PBKDF2-SHA256（600,000 次迭代）派生密钥，敏感字段（用户名/密码/URL/备注/TOTP）逐字段以 AES-256-GCM 加密（密文格式 `Base64(IV ‖ 密文 ‖ 认证标签)`，每次加密使用新的随机 IV）；标签、时间戳等非敏感元数据保持明文以支撑列表展示。密码数据不经网络传输，唯一的外联是每 6 小时一次的匿名版本检查（见[权限与数据流向](#-权限与数据流向)）
- **灵活的会话管理**：有效期 1 小时\~7 天可选（默认 24 小时）；闲置自动锁定与浏览器重启锁定均可单独开启，默认关闭；Popup 提供一键锁定；剩余时间在管理页/侧边栏/Popup 常驻展示（≤10 分钟变琥珀色、≤1 分钟变红色），点击徽标打开有效期对话框续期
- **离线安全体检**：一键 0\~100 综合评分，四维加权检测（密码复用 35 / 弱密码 25 / 命中离线泄露字典 20 / 长期未更新 20），未开启 2FA 单独列出但不扣分；泄露字典为内置离线 Top 1000 词表，全程离线计算
- **TOTP 两步验证**：验证码本地生成（RFC 6238），列表/侧边栏实时活码与倒计时；支持扫描网页二维码或上传图片一键添加密钥；GitHub 式两步登录自动衔接活码胶囊，一键填入

### ⚡ 智能填充

- **一键登录，不只是填充**：`Ctrl+Shift+F`（Mac `Cmd+Shift+F`）先把当前站点最匹配的账号填入，并自动勾选「记住我 / 已阅读并同意 / 接受条款」一类协议复选框；在偏好设置中开启「自动触发登录」（或使用侧边栏条目的「填充并登录」图标），即可一步走完填充 → 勾选 → 点击登录，GitHub 式两步登录还会自动衔接 TOTP 活码胶囊
- **四重填充策略**：内联填充（输入框钥匙图标，默认）、侧边栏一键填充、右键填充（输入框上右键→「填充账号密码」→ 填充用户名/密码/两步验证码，或「生成并填充强密码」——后者不读取任何已存凭证，会话锁定时同样可用；页面空白处右键→「账号密码管理助手」→ 打开侧边栏/打开密码管理页）、快捷键一键填充，覆盖从「精确点选」到「闭眼一键」的不同习惯；填充失败经页面内提示 + 桌面通知 + 工具栏角标多层反馈，会话失效时就地弹出解锁引导
- **精确域名匹配**：仅展示与当前 host 完全一致的条目，dev/test/staging/prod 账号互不混淆；`localhost` 默认匹配全部
- **自动保存凭证**：Chrome 式登录捕获与保存确认，智能去重（相同凭证不重复提示、密码变化弹「更新」确认）、域名黑白名单、「不再提示」一键屏蔽；保存弹窗会内联提示弱密码与密码复用风险（只提醒，不影响保存流程）
- **侧边栏快速添加**：侧边栏顶栏「+」随时就地添加账号（当前站点无账号时显示添加邀请），网址自动预填当前域名；TOTP 等完整字段可经「到密码管理中完整添加」录入
- **侧边栏全站搜索**：搜索框右侧图标一键切换「本站 / 全站」范围——默认只看当前域名匹配的账号，全站模式放开为全部条目（换到不同站点的标签页自动回到本站）；全站命中的外站账号仍可复制账号/密码/验证码、收藏与编辑，点击整行即在新标签页打开该站点；本站无结果而全库有命中时，空态直接给出「在全部条目中查找（N 条）」入口
- **广泛兼容**：动态检测登录表单（含跨 iframe），兼容 React/Vue 等主流框架，支持用户名+密码、手机号+验证码等多种场景
- **密码可见性切换**：为页面密码框注入显隐切换按钮（悬浮按钮偏好设置中开启），填充后一键确认输入内容，无需专门安装额外扩展

### 📦 数据管理

- **导入导出**：CSV / JSON 双格式（导入仅接收 `.csv`、`.json`，Excel 请先另存为 CSV），自动识别 Chrome、LastPass、Bitwarden、1Password 导出格式，中英文列名自动映射
- **多重备份**：加密备份（.aph）导出/导入（支持解密预览）、邮箱备份（本机组好内容后经 `mailto:` 交由你的邮件客户端发送，加密/不加密可选）、定时备份提醒（到期发桌面通知提醒你去备份，不会自动发信）
- **高效组织**：标签多选与筛选、收藏置顶（默认上限 10 条，可配 1\~50，超出按 LRU 淘汰）、多字段智能搜索（拼音/首字母缩写，命中高亮）、一键去重、批量删除/编辑标签/导出选中；条目可「查看详情」只读浏览备注全文与密码历史，不必进入编辑态
- **防误操作**：回收站 30 天软删除（后台每日闹钟清理过期条目）、密码修改历史（默认保留 3 份加密快照，可配 1\~10，可恢复）、修改主密码原子换钥不丢数据

### 🎨 体验

- **主题与语言**：6 款色彩主题 + 中英文双语界面，即时切换无需刷新，扩展页与页面内注入 UI 同步生效
- **网站图标展示**：密码列表、侧边栏与内联下拉面板展示对应网站图标（读取 Chrome 本地图标缓存，零外部请求；取不到时回退默认图标），长列表辨识更高效
- **密码生成器**：随机密码（默认 16 位，长度 6\~50 可选，字符集与易混淆字符排除可配）与助记词组（沿用 Diceware 思路，内置 3080 词英文词库，3\~8 词并可追加数字）双模式
- **大写锁定提示**：主密码输入（设置/解锁/验证弹窗/改密/备份导入）时实时检测 Caps Lock 状态并展示警示，避免大小写输入错误导致「密码错误」假象
- **秒开体验**：所有场景侧边栏秒开无白屏；会话有效时走缓存快路径，数据在 20-50ms 内返回

> 🛠 技术栈、架构设计与项目结构见 [贡献指南](./docs/CONTRIBUTING.md)。
>
> 📖 各功能的实现细节（源码路径、策略说明、参数约束）见 [docs/ARCHITECTURE.md — 功能实现详解](./docs/ARCHITECTURE.md#功能实现详解)。
>
> 📝 产品动机、侧边栏秒开、加密体系与登录链路功能的技术复盘，见 [技术博客](https://liaolongdong.github.io/account-password-helper/blog/)（中英双语）。

## 🧭 权限与数据流向

### 权限清单与用途

| 权限             | 实际用途                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`        | 保存密文条目、配置与会话密钥材料。仅使用 `chrome.storage.local`（持久密文）与 `chrome.storage.session`（内存态密钥/快照），**不使用** `sync` 或 `managed` |
| `activeTab`      | 用户主动触发（快捷键、扩展图标、右键菜单、悬浮按钮）时，取得当前标签页地址与句柄以定位要填充的表单                                                        |
| `scripting`      | 向登录页下发填充脚本（设置输入值、派发框架可识别的 input/change 事件）                                                                                    |
| `sidePanel`      | 侧边栏快速填充面板                                                                                                                                        |
| `alarms`         | 定时任务：会话过期检查、回收站清理（每 24 小时）、备份提醒（每 12 小时）、版本检查（每 6 小时）、Service Worker 保活复活                                  |
| `notifications`  | 桌面通知：填充失败提示、备份提醒、新版本提示                                                                                                              |
| `idle`           | 闲置自动锁定（该功能默认关闭，开启后才生效）                                                                                                              |
| `clipboardWrite` | 复制用户名 / 密码 / 两步验证码到剪贴板                                                                                                                    |
| `clipboardRead`  | 剪贴板自动清除前的校验：确认剪贴板内容仍是当初复制的那条密码，避免误删用户新复制的内容                                                                    |
| `webNavigation`  | 仅调用 `getAllFrames` 枚举页面框架，以便把凭证精确下发到顶层或同主域名的 frame（跨 iframe 登录表单）                                                      |
| `contextMenus`   | 输入框右键「填充账号密码」与页面右键「打开侧边栏 / 打开密码管理页」菜单                                                                                   |
| `favicon`        | 读取 Chrome **本地**图标缓存（`_favicon/` 扩展内部端点）以在列表展示网站图标，不请求任何图标服务                                                          |
| `<all_urls>`     | 登录页表单分布于任意站点，需在这些页面注入脚本完成检测与填充                                                                                              |

### 明确不做的事

- 不读取 `cookies`、`history`、`downloads` 等未声明权限，不使用 `storage.sync` / `storage.managed`；
- 无遥测、分析、广告、崩溃上报 SDK，不收集设备指纹或使用统计；
- 主密码任何形态（原文、可逆密文）都不落盘，仅保存 PBKDF2 派生的校验值；
- 敏感字段在磁盘上永远是密文（at-rest 不变量），解锁只是拿到密钥，不会把整库明文写回 `storage.local`。

### 唯一的对外请求

版本更新检查每 6 小时发起一次：商店安装版向 Chrome 应用商店条目页发送一个不透明的 HEAD 请求，手动安装版请求 GitHub Releases API 的公开版本信息。两者都是匿名请求，**不携带任何密码库内容、账号、标识符或可推导信息**；关闭网络时该检查静默失败，不影响任何核心功能。除此之外，本扩展不发起任何外部网络请求，网站图标也来自 Chrome 本地缓存。

## 快速开始

### 从 Chrome 应用商店安装（推荐）

直接访问 [Chrome Web Store 页面](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)，点击「添加至 Chrome」即可一键安装，后续版本更新由商店自动推送。

### 从 GitHub Releases 下载（无法访问 Google 的用户）

如果你无法访问 Chrome 应用商店（如中国大陆地区用户），可从 [GitHub Releases](https://github.com/liaolongdong/account-password-helper/releases/latest) 下载最新版安装包（zip），手动安装：

1. 下载 zip 并解压到任意目录（请妥善保留该目录，后续更新时需覆盖此目录）
2. 打开 `chrome://extensions/`，开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择解压后的目录
4. 首次使用需设置主密码（至少 8 位，含字母+数字+特殊字符）

> 💡 手动加载的扩展不会自动更新，但插件会通过 GitHub Releases API 每 6 小时检测新版本，并在 Popup 弹窗中展示更新提示。收到提示后下载新包，将文件覆盖到原安装目录即可。

### 安装与构建（开发者）

```bash
# 安装依赖（项目以 pnpm 管理，版本由 package.json 的 packageManager 固定为 10.12.1）
pnpm install

# 开发模式（HMR 热更新，产物在 .output/chrome-mv3-dev/）
pnpm dev

# 生产构建（自动串联 prebuild 生成图标 + postbuild 打 zip，无需单独调用）
pnpm build
```

构建产物在 `.output/chrome-mv3/`，在 `chrome://extensions/` 开启「开发者模式」→「加载已解压的扩展程序」选择该目录即可。

常用校验与开发命令：

| 命令                 | 作用                                     |
| -------------------- | ---------------------------------------- |
| `pnpm typecheck`     | TypeScript 类型检查                      |
| `pnpm lint`          | ESLint（`--max-warnings 0`，警告即失败） |
| `pnpm lint:style`    | Stylelint（含 CSS 属性排序）             |
| `pnpm test:run`      | 运行全量 Vitest 用例（632 项）           |
| `pnpm lint:all`      | lint + stylelint + 格式检查一次性跑完    |
| `pnpm build:firefox` | Firefox 构建（见下方说明）               |
| `pnpm gen:blog`      | 由 `docs/blog/**` 重新生成 `blog/*.html` |

环境要求：Node 22（与 CI 一致）。

> ⚠️ Firefox 构建目前产出的是 `manifest_version: 2`（`.output/firefox-mv2/`），属实验性质；本文关于 MV3、Side Panel API 与 Chrome 图标缓存的描述仅适用于 Chrome/Edge 等 Chromium 浏览器。

> 📖 更多开发命令与环境要求见 [贡献指南](./docs/CONTRIBUTING.md)。

### 更新版本

- **Chrome 应用商店用户**：版本更新由商店自动推送，无需手动操作。
- **手动加载用户（GitHub Releases 下载 / 开发者）**：只需将压缩包内的文件**直接覆盖**原有安装目录下的文件即可，**切勿**重新选择其他目录加载扩展。Chrome 扩展的本地数据（包括密码数据、配置等）存储在浏览器内部存储空间中，只要扩展 ID 不变，覆盖文件更新不会影响已有数据。如果更换了加载目录，Chrome 会将其视为全新安装，**原有的密码数据将无法访问**。

> 💡 **如何查看当前安装目录**：打开 `chrome://extensions/`，找到「账号密码管理助手」的卡片，点击"详情"，在扩展详情页下方可以看到「来源：/path/to/your/directory」，冒号后面的路径即为当前安装目录。

## 使用指南

1. **初始设置**：安装后点击扩展图标打开 Popup——它是操作中枢，提供管理密码、侧边栏快速填充、直接填充、展开内联下拉四个动作，以及手动锁定按钮、会话倒计时胶囊与新版本卡片；首次进入管理页需设置主密码并选择会话有效期（默认 24 小时）。「偏好设置」中可配置主题、语言、悬浮按钮、填充方式等
2. **密码管理**：选项页提供完整 CRUD、批量导入导出（导出需验证主密码）、多字段智能搜索（拼音/首字母 + 命中高亮）与排序、标签与收藏；点击条目「查看详情」可只读一屏查看完整备注、密码历史等全部字段（密码默认掩码，复制密码后按剪贴板设置自动清除），无需进入编辑态
3. **快速填充**：全新安装默认使用内联填充——登录框获焦后显示钥匙图标，点击选择账号即填；可在「偏好设置」切换为「侧边栏」（获焦自动弹出）或「仅手动」。升级用户沿用升级前的侧边栏自动弹出行为，不会被静默改为内联。也可使用快捷键或在输入框上右键填充
4. **快捷键**：四组高频操作均有默认快捷键（Mac 为 `Cmd`），详见下方速查表

### 快捷键速查

| 功能（命令 ID）                     | Windows / Linux | macOS         | 默认行为                                                                  |
| ----------------------------------- | --------------- | ------------- | ------------------------------------------------------------------------- |
| 打开密码管理页 `open_options`       | `Ctrl+Shift+P`  | `Cmd+Shift+P` | 打开选项页                                                                |
| 开关侧边栏 `toggle_sidepanel`       | `Ctrl+Shift+L`  | `Cmd+Shift+L` | 开/关侧边栏                                                               |
| 快速填充 `quick_fill`               | `Ctrl+Shift+F`  | `Cmd+Shift+F` | 填充当前站点最匹配账号 + 勾选协议；开启「自动触发登录」后连登录按钮一起点 |
| 展开内联下拉 `open_inline_dropdown` | `Ctrl+Shift+K`  | `Cmd+Shift+K` | 在聚焦的输入框上展开账号下拉列表                                          |

> 快捷键无法在插件内改键：Chrome 未提供 `commands.update()` API，且 4 个命令槽已全部占用。管理页「安全设置 → 快捷键」与侧边栏「帮助」中的一览均为只读，会标注当前未生效的按键（多因被系统或其他扩展占用），并提供跳转到 `chrome://extensions/shortcuts` 的按钮，改键只能在浏览器该页面完成。

> 📖 完整的操作指引与功能演示见[在线演示页面](https://liaolongdong.github.io/account-password-helper/)（含双语 FAQ），或侧边栏内的「帮助」入口。

## 常见问题

**Q：我的密码会被上传到云端吗？**

A：不会。密码数据只保存在浏览器本地空间（`chrome.storage.local`），敏感字段逐字段经 AES-256-GCM 加密后落盘，从不作为明文离开本机。唯一的外联是每 6 小时一次的匿名版本检查，不携带任何密码库内容或标识符，详见[权限与数据流向](#-权限与数据流向)。

**Q：忘记主密码怎么办？**

A：主密码无法找回，只能通过「重置」功能清空数据后重新设置。建议定期通过数据导出或加密备份（.aph 文件）功能备份，避免数据丢失。

**Q：会话有效期到了会发生什么？**

A：会话过期只会清除密钥材料与内存缓存——磁盘上的敏感字段本来就是密文（at-rest 不变量），不存在「过期时批量重新加密」这一步，因此过期瞬间不会卡顿。下次使用时重新验证主密码即可恢复访问，账号数据不会丢失。

**Q：侧边栏不显示？**

A：侧边栏依赖 Chrome 的 Side Panel API（需 Chrome >= 114；本扩展的 manifest 未声明 `minimum_chrome_version`，所以旧版本上不会硬拦，但侧边栏相关功能不可用）。也可点击插件图标（快捷键 `Ctrl+Shift+L` / `Cmd+Shift+L`），或通过悬浮按钮中的「快速填充」手动打开。

**Q：密码填充不生效？**

A：等待页面完全加载后重试，填充器会依次尝试三种策略（Native Setter / execCommand / 模拟键盘事件）；仍不生效请刷新页面。

**Q：如何自定义快捷键？**

A：在地址栏输入 `chrome://extensions/shortcuts`，找到「Account Password Helper」，点击对应命令右侧的快捷键输入框，按下新的组合键即可修改。也可以从密码管理页「安全设置 → 快捷键」打开一览弹窗，其中「前往修改」按钮直达该页面；弹窗会同时标注哪些按键当前未生效（多因被系统或其他扩展占用，或更新后新增的命令未自动绑定），侧边栏「帮助」弹窗同样提供该一览与入口。

**Q：支持从其他密码管理器导入吗？**

A：支持。在导入弹窗中上传 CSV 或 JSON 文件，插件会自动识别 Chrome、LastPass、Bitwarden、1Password 的导出格式并映射字段。

**Q：删除的密码能找回吗？**

A：能。删除的密码会先移入回收站保留 30 天，在「数据管理」→「回收站」中可恢复或彻底删除；改错密码也可通过条目的「密码修改历史」一键恢复。

**Q：如何开启自动保存登录密码？**

A：在密码管理页「自动保存设置」中开启开关，可选配置域名匹配规则（精确域名/正则）。登录时会弹出确认卡片（保存/暂不保存/不再提示），并可编辑标签和备注。若待保存的密码强度较弱，或已被其它账号共用，卡片会在密码行下方给出内联风险提示；提示仅告知风险，不会拦住保存，也不需二次确认。

**Q：如何切换主题或界面语言？**

A：通过密码管理页「偏好设置」按钮、悬浮按钮齿轮图标或侧边栏齿轮图标进入偏好设置面板，可切换 6 款色彩主题与中文 / English 界面语言，即时生效无需刷新。

**Q：Windows 首次打开侧边栏较慢怎么办？**

A：Windows Defender 会在扩展文件首次加载时逐文件扫描，导致冷启动延迟增加 1-2 秒。建议将 Chrome 扩展目录加入 Defender 排除列表以跳过扫描：打开「Windows 安全中心」→「病毒和威胁防护」→「管理设置」→「排除项」→「添加排除项」→选择「文件夹」→粘贴路径 `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Extensions`。加入后冷启动可从 2-3 秒降至 1 秒以内。Mac 用户无需此操作。

**Q：复制密码后剪贴板会自动清理吗？**

A：会。默认在复制 30 秒后自动清除（时长可配置），并且清除前会先读取剪贴板确认内容仍是当初复制的那条密码，避免误删你随后复制的内容。两步验证码是例外——它 30 秒后自身失效，因此不挂自动清除定时器。

**Q：密码过期了会提醒我吗？**

A：会。条目可设置过期提醒（7/30/90 天），后台闹钟每 12 小时检查一次，到期发送桌面通知；管理页与侧边栏也会标注到期条目。

> 📖 更多问题（TOTP 使用与排查、邮箱备份、加密备份、收藏上限、性能表现等）见[在线演示页面](https://liaolongdong.github.io/account-password-helper/)的完整 FAQ，或 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) 中对应功能的实现说明。

## 立即体验

🔗 [Chrome 应用商店安装](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)（一键安装，自动更新） · [GitHub Releases 下载](https://github.com/liaolongdong/account-password-helper/releases/latest)（无法访问 Google 的用户） · [在线演示](https://liaolongdong.github.io/account-password-helper/)

如果本项目对您有帮助，请帮忙点个 ⭐️、写个商店评价——这是对开源贡献者最大的支持！欢迎提交 Issue 和 Pull Request，完整变更记录见 [CHANGELOG.md](./CHANGELOG.md)。

## 安全提醒

- 账号密码管理助手为开发、测试与日常登录场景而生，建议不要在任何浏览器扩展中存放银行、支付等高敏感凭证；
- 主密码遗忘**无法恢复**，请务必牢记并妥善保管；
- 敏感字段本地 AES-256-GCM 逐字段加密存储，密码数据从不作为明文离开本机（唯一外联为匿名版本检查，见[权限与数据流向](#-权限与数据流向)）；
- 建议定期通过加密备份功能（.aph 文件）导出备份；
- 建议开启剪贴板自动清除与闲置自动锁定；对安全性要求较高时，建议开启「浏览器重启锁定」。

## 许可证

本项目采用 GNU GPL-3.0 开源协议（仅 v3 版本，不含"或更高版本"）。

- 允许自由使用、修改与分发（含商用），但**衍生作品必须以 GPL-3.0 同等开源**，禁止闭源分发。
- 插件名称 "Account Password Helper（账号密码管理助手）"、logo 及品牌素材为作者商标，不在协议授权范围内，详见 [THIRD-PARTY-NOTICES.md](./docs/THIRD-PARTY-NOTICES.md)。
- 本项目打包了第三方依赖（含 Apache-2.0 协议的 jsQR），归属声明见 [THIRD-PARTY-NOTICES.md](./docs/THIRD-PARTY-NOTICES.md)。
- 本仓库已发布的历史版本仍按当时的 MIT 协议存续，GPL-3.0 自切换后的新版本起生效。

## 联系方式

邮箱：[924902324@qq.com](mailto:924902324@qq.com?subject=账号密码管理助手反馈)

**微信交流群**：扫描下方二维码添加作者微信（微信号：`lld_1025`），备注「aph」邀你加入插件交流群，反馈问题、交流使用心得。

<img src="./assets/wx-qrcode/wechat-qrcode.jpg" alt="微信群二维码" width="160" />

---

> 📅 文档最后更新：2026-09 · 功能对应最新已发布版本，见 [Releases](https://github.com/liaolongdong/account-password-helper/releases/latest)
