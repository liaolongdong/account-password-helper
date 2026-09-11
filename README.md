# Account Password Helper · 账号密码管理助手（开源免费本地密码管理器）

**中文** | [English](./README.en.md)

[![Star this repo](https://img.shields.io/github/stars/liaolongdong/account-password-helper?style=for-the-badge&logo=github&label=%E2%AD%90%20Star%20this%20repo&color=yellow)](https://github.com/liaolongdong/account-password-helper/stargazers)

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/fgimkdodpjfkddmildjieojpfakpanli?style=for-the-badge&label=CWS&logo=googlechrome&logoColor=white&color=4285F4)](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)
[![Users](https://img.shields.io/chrome-web-store/users/fgimkdodpjfkddmildjieojpfakpanli?style=for-the-badge&label=Users&logo=googlechrome&logoColor=white&color=4285F4)](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)
[![Rating](https://img.shields.io/chrome-web-store/rating/fgimkdodpjfkddmildjieojpfakpanli?style=for-the-badge&label=Rating&color=4285F4)](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)
[![Release](https://img.shields.io/github/v/release/liaolongdong/account-password-helper?style=for-the-badge&label=Release&logo=github&color=24292f)](https://github.com/liaolongdong/account-password-helper/releases/latest)
[![Manifest V3](https://img.shields.io/badge/Chrome-MV3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License](https://img.shields.io/badge/License-GPL--3.0-blue?style=for-the-badge)](#许可证)
[![Last Commit](https://img.shields.io/github/last-commit/liaolongdong/account-password-helper?style=for-the-badge&label=Last%20Commit&logo=github&logoColor=white)](https://github.com/liaolongdong/account-password-helper/commits/main)

> **开源免费的本地优先密码管理器** · 一键登录（填充 → 勾选 → 点击） · 本地 AES-256-GCM 零云端 · TOTP 两步验证 · 安全体检 · 多环境账号隔离 · 从 Chrome / Bitwarden / 1Password 一键迁移 · 为开发者与测试人员量身打造

一款**开源免费**的本地加密 Chrome 密码管理扩展：**一键登录**连登录按钮一起点、精确域名匹配隔离 dev/test/staging/prod 账号、内置 **TOTP 两步验证**与**离线安全体检**。**PBKDF2（600,000 次迭代）+ AES-256-GCM** 本地加密，侧边栏全场景秒开，密码数据不出本机、无需注册账号。

> **安全声明**：所有数据仅保存在浏览器本地，敏感字段经 AES-256-GCM 逐字段加密，密码数据永不经过网络传输——扩展唯一的出站行为是每 6 小时一次的版本更新检查（匿名读取 Chrome 商店可达性与 GitHub Releases 版本号，不携带任何账号数据），详见[权限与数据流向](#-权限与数据流向)。建议不要在任何浏览器扩展中存放银行、支付等高敏感凭证。
>
> 🌐 **在线演示**：https://liaolongdong.github.io/account-password-helper/ ｜ 📊 **技术亮点**：PBKDF2 600K 迭代 · AES-256-GCM 认证加密 · 侧边栏全场景秒开（缓存快路径 20-50ms）· 6 款主题 · 中英文双语 · 核心功能离线可用 · 632 项自动化测试

**目录**：[核心优势](#-核心优势) · [功能演示](#-功能演示) · [横向对比](#横向对比) · [核心特性](#核心特性) · [权限与数据流向](#-权限与数据流向) · [快速开始](#快速开始) · [常见问题](#常见问题) · [许可证](#许可证)

<p align="center">
  <img src="./assets/icons/icon.svg" alt="账号密码管理助手扩展图标" width="120" />
  <br/>
  <img src="./docs/demo-login.webp" alt="一键登录演示：快捷键触发自动填充、勾选同意条款并点击登录" width="100%" />
  <br/>
  <sub>Ctrl+Shift+F → 自动填充 → 勾选「记住我 / 同意条款」→（开启「自动触发登录」后）自动点击登录 → 2FA 活码接力，1 秒完成</sub>
</p>

## ✨ 核心优势

| 优势                              | 与其他工具的差异                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ⚡ **一键登录，不只是填充**       | 快捷键 `Ctrl+Shift+F` 一次走完「填充账号 → 勾选记住我/同意」，打开「自动触发登录」或用侧边栏「填充并登录」即可连登录按钮一起点掉。其他工具只填充，**登录按钮还得自己点** |
| 🎯 **多环境账号隔离**             | 精确域名匹配区分 dev/test/staging/prod——**同一站点的不同环境账号互不混淆**，开发者刚需                                                                                   |
| 🔑 **内置 TOTP + 两步登录接力**   | 验证码和密码在一起；GitHub 式两步登录自动衔接活码胶囊，**告别手机验证器，不用切 App**                                                                                    |
| 🔒 **纯本地 AES-256-GCM，零云端** | 无云端、无账号、无订阅，**也就没有可供攻破的服务器**。用户名/密码/网址/备注/TOTP 五个敏感字段逐字段密文存储，标签与时间戳等非敏感元数据保持明文用于列表展示              |
| 📊 **离线安全体检**               | 一键 0-100 评分，四维加权：密码复用 35 / 弱密码 25 / 命中离线泄露字典 20 / 长期未更新 20（未开 2FA 仅提示、不扣分），**全程离线计算**                                    |
| 📦 **一键迁移，零门槛**           | 自动识别 Chrome / LastPass / Bitwarden / 1Password 导出格式，CSV/JSON 双格式，**30 秒搬家**                                                                              |

**适合谁**：**开发者** — 隔离多环境账号；**测试工程师** — 一键填充 + 自动触发登录，跨环境效率翻倍；**隐私敏感用户** — 纯本地加密、不出本机、无需注册与云端同步；**日常用户** — 告别记忆密码，内置 TOTP 与密码生成器。

## 🖥️ 功能演示

<table>
  <tr>
    <td width="50%" align="center">
      <img src="./assets/screenshots/09-totp-code.png" alt="编辑密码弹窗中的两步验证字段：密钥、实时验证码与 30 秒倒计时" width="100%" /><br />
      <sub><b>内置 TOTP</b> — 密钥与 30 秒活码同屏，支持扫码或上传图片添加</sub>
    </td>
    <td width="50%" align="center">
      <img src="./assets/screenshots/10-health-check.png" alt="安全体检面板：71 分综合评分与密码复用、弱密码、常见泄露密码、长期未更新四维检测结果" width="100%" /><br />
      <sub><b>离线安全体检</b> — 0-100 四维加权评分，未开 2FA 单独列示</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="./assets/screenshots/02-password-list.png" alt="密码列表：站点图标、标签、收藏置顶、更新时间与批量操作" width="100%" /><br />
      <sub><b>列表与管理</b> — 标签筛选、收藏置顶、拼音搜索、一键去重</sub>
    </td>
    <td width="50%" align="center">
      <img src="./assets/screenshots/11-inline-fill.png" alt="登录页内联填充迷你面板：搜索框与匹配当前站点的账号列表" width="100%" /><br />
      <sub><b>内联填充</b> — 登录框内钥匙图标展开迷你面板，键盘可全程操作</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="./assets/screenshots/06-sidepanel-fill.png" alt="自动保存账号密码确认卡：账号、密码、标签、备注与保存或暂不保存选项" width="100%" /><br />
      <sub><b>自动保存凭证</b> — 登录后弹出保存确认卡，可编辑标签备注、智能去重</sub>
    </td>
    <td width="50%" align="center">
      <img src="./assets/screenshots/12-theme-skin.png" alt="偏好设置面板：6 款色彩主题色块与中英文语言切换" width="100%" /><br />
      <sub><b>主题与双语</b> — 6 款色彩主题 + 中英文界面即时切换</sub>
    </td>
  </tr>
</table>

> 📸 一键登录的完整动作（填充 → 勾选 → 点击）见上方演示动图；悬浮按钮、会话有效期、CSV 导入导出等更多界面见[在线演示页面](https://liaolongdong.github.io/account-password-helper/)。

## 横向对比

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

> 竞品信息（价格、功能边界）截至 2026-09，各厂商调整频繁，请以官网为准。完整对比见[替代方案对比页](https://liaolongdong.github.io/account-password-helper/compare.html)。

## 核心特性

### 🔐 安全防护

- **浏览器原生强加密**：主密码经 PBKDF2-SHA256（600,000 次迭代）派生密钥，用户名/密码/URL/备注/TOTP 五个敏感字段逐字段 AES-256-GCM 加密（每次使用新的随机 IV），标签与时间戳等非敏感元数据保持明文以支撑列表展示；密码数据不经网络传输
- **灵活的会话管理**：有效期 1 小时\~7 天可选（默认 24 小时）；闲置自动锁定与浏览器重启锁定可单独开启（默认关闭）；Popup 一键锁定，剩余时间在管理页/侧边栏/Popup 常驻展示并在临近过期时变色预警，点击徽标即可续期
- **离线安全体检**：一键 0\~100 综合评分，四维加权（密码复用 35 / 弱密码 25 / 命中离线泄露字典 20 / 长期未更新 20），未开启 2FA 单独列出但不扣分；泄露字典为内置 Top 1000 离线词表，全程不联网
- **TOTP 两步验证**：验证码本地生成（RFC 6238），列表与侧边栏实时活码与倒计时；支持扫描网页二维码或上传图片一键添加密钥；GitHub 式两步登录自动衔接活码胶囊

### ⚡ 智能填充

- **一键登录，不只是填充**：`Ctrl+Shift+F`（Mac `Cmd+Shift+F`）先把当前站点最匹配的账号填入，并自动勾选「记住我 / 已阅读并同意 / 接受条款」一类协议复选框；在偏好设置中开启「自动触发登录」（或使用侧边栏条目的「填充并登录」图标），即可一步走完填充 → 勾选 → 点击登录
- **四重填充策略**：内联填充（输入框钥匙图标，默认）、侧边栏一键填充、右键填充（输入框右键「填充账号密码」，或「生成并填充强密码」——后者不读取任何已存凭证，会话锁定时同样可用）、快捷键一键填充；动态检测登录表单（含跨 iframe），兼容 React/Vue 等主流框架与用户名+密码、手机号+验证码等场景；填充失败经页面内提示 + 桌面通知 + 工具栏角标多层反馈，会话失效时就地弹出解锁引导
- **自动保存凭证**：Chrome 式登录捕获与保存确认，智能去重（相同凭证不重复提示、密码变化弹「更新」确认）、域名黑白名单、「不再提示」一键屏蔽；保存弹窗内联提示弱密码与密码复用风险（只提醒，不影响保存流程）
- **精确域名匹配**：所有填充入口与列表均只展示与当前 host 完全一致的条目，dev/test/staging/prod 账号互不混淆（`localhost` 除外，默认匹配全部）
- **侧边栏快速添加与全站搜索**：顶栏「+」就地添加账号（网址自动预填当前域名）；搜索框右侧图标一键切换「本站 / 全站」范围，全站命中的外站账号仍可复制账号/密码/验证码、收藏与编辑，点击整行在新标签页打开

### 📦 数据管理

- **导入导出**：CSV / JSON 双格式（导入仅接收 `.csv`、`.json`），自动识别 Chrome、LastPass、Bitwarden、1Password 导出格式，中英文列名自动映射
- **多重备份**：加密备份（.aph）导出/导入（支持解密预览）、邮箱备份（本机组好内容后经 `mailto:` 交由你的邮件客户端发送）、定时备份提醒（到期发桌面通知，不会自动发信）
- **高效组织**：标签多选与筛选、收藏置顶（默认上限 10 条，可配 1\~50，超出按 LRU 淘汰）、多字段智能搜索（拼音/首字母缩写，命中高亮）、一键去重、批量删除/编辑标签/导出选中；条目可「查看详情」只读浏览备注全文与密码历史
- **防误操作**：回收站 30 天软删除（后台每日闹钟清理）、密码修改历史（默认保留 3 份加密快照，可配 1\~10，可恢复）、修改主密码原子换钥不丢数据

### 🎨 体验

- **主题与语言**：6 款色彩主题 + 中英文双语界面，即时切换无需刷新，扩展页与页面内注入 UI 同步生效
- **秒开体验**：所有场景侧边栏秒开无白屏；会话有效时走缓存快路径，数据在 20-50ms 内返回
- **密码生成器**：随机密码（默认 16 位，长度 6\~50 可选，字符集与易混淆字符排除可配）与助记词组（内置 3080 词英文词库，3\~8 词并可追加数字）双模式
- **细节体验**：网站图标展示（读取 Chrome 本地图标缓存，零外部请求）、主密码输入实时大写锁定（Caps Lock）警示、页面密码框显隐切换按钮，均在偏好设置中可配置

> 🛠 技术栈、架构设计与项目结构见[贡献指南](./docs/CONTRIBUTING.md)；各功能的实现细节（源码路径、策略说明、参数约束）见 [ARCHITECTURE.md — 功能实现详解](./docs/ARCHITECTURE.md#功能实现详解)；产品动机与加密/性能技术复盘见[技术博客](https://liaolongdong.github.io/account-password-helper/blog/)（中英双语）。

## 🧭 权限与数据流向

### 权限清单与用途

| 权限                             | 实际用途                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                        | 保存密文条目、配置与会话密钥材料。仅使用 `chrome.storage.local`（持久密文）与 `chrome.storage.session`（内存态密钥/快照），**不使用** `sync` 或 `managed` |
| `activeTab`                      | 用户主动触发（快捷键、扩展图标、右键菜单、悬浮按钮）时，取得当前标签页地址与句柄以定位要填充的表单                                                        |
| `scripting`                      | 向登录页下发填充脚本（设置输入值、派发框架可识别的 input/change 事件）                                                                                    |
| `sidePanel`                      | 侧边栏快速填充面板                                                                                                                                        |
| `alarms`                         | 定时任务：会话过期检查、回收站清理（每 24 小时）、备份提醒（每 12 小时）、版本检查（每 6 小时）、Service Worker 保活复活                                  |
| `notifications`                  | 桌面通知：填充失败提示、备份提醒、新版本提示                                                                                                              |
| `idle`                           | 闲置自动锁定（该功能默认关闭，开启后才生效）                                                                                                              |
| `clipboardWrite` `clipboardRead` | 复制用户名 / 密码 / 两步验证码到剪贴板；自动清除前校验剪贴板内容仍是当初复制的那条密码，避免误删用户新复制的内容                                          |
| `webNavigation`                  | 仅调用 `getAllFrames` 枚举页面框架，以便把凭证精确下发到顶层或同主域名的 frame（跨 iframe 登录表单）                                                      |
| `contextMenus`                   | 输入框右键「填充账号密码」与页面右键「打开侧边栏 / 打开密码管理页」菜单                                                                                   |
| `favicon`                        | 读取 Chrome **本地**图标缓存（`_favicon/` 扩展内部端点）以在列表展示网站图标，不请求任何图标服务                                                          |
| `<all_urls>`                     | 登录页表单分布于任意站点，需在这些页面注入脚本完成检测与填充                                                                                              |

### 明确不做的事

- 不读取 `cookies`、`history`、`downloads` 等未声明权限，不使用 `storage.sync` / `storage.managed`；
- 无遥测、分析、广告、崩溃上报 SDK，不收集设备指纹或使用统计；
- 主密码任何形态（原文、可逆密文）都不落盘，仅保存 PBKDF2 派生的校验值；敏感字段在磁盘上永远是密文（at-rest 不变量），解锁只是拿到密钥，不会把整库明文写回 `storage.local`。

### 唯一的对外请求

版本更新检查每 6 小时发起一次：商店安装版向 Chrome 应用商店条目页发送一个不透明的 HEAD 请求，手动安装版请求 GitHub Releases API 的公开版本信息。两者都是匿名请求，**不携带任何密码库内容、账号、标识符或可推导信息**；关闭网络时该检查静默失败，不影响任何核心功能。除此之外，本扩展不发起任何外部网络请求，网站图标也来自 Chrome 本地缓存。

## 快速开始

### 从 Chrome 应用商店安装（推荐）

访问 [Chrome Web Store 页面](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)，点击「添加至 Chrome」一键安装，后续版本更新由商店自动推送。

### 从 GitHub Releases 下载（无法访问 Google 的用户）

从 [GitHub Releases](https://github.com/liaolongdong/account-password-helper/releases/latest) 下载最新版 zip 并解压到**固定目录**，然后在 `chrome://extensions/` 开启「开发者模式」→「加载已解压的扩展程序」选择该目录；首次使用需设置主密码（至少 8 位，含字母+数字+特殊字符）。

> 💡 手动加载不会自动更新，但插件每 6 小时经 GitHub Releases API 检测新版本并在 Popup 提示；更新时把新包**直接覆盖**原安装目录即可，**切勿换目录**——Chrome 会视为全新安装，原有密码数据将无法访问。

### 安装与构建（开发者）

```bash
pnpm install   # 安装依赖（pnpm 版本由 packageManager 固定为 10.12.1）
pnpm dev       # 开发模式（HMR 热更新，产物在 .output/chrome-mv3-dev/）
pnpm build     # 生产构建（自动串联生成图标 + 打包 zip）
```

构建产物在 `.output/chrome-mv3/`，在 `chrome://extensions/` 开启「开发者模式」→「加载已解压的扩展程序」选择该目录即可。环境要求 Node 22（与 CI 一致）。

> 📖 完整开发命令（`typecheck` / `lint` / `test:run` / `build:firefox` / `gen:*` 等）、生成产物说明与 Firefox 构建限制见[贡献指南 — 常用命令](./docs/CONTRIBUTING.md#常用命令)。

## 使用指南

1. **初始设置**：安装后点击扩展图标打开 Popup（操作中枢，含管理密码、侧边栏快速填充、直接填充、展开内联下拉、一键锁定与会话倒计时）；首次进入管理页需设置主密码并选择会话有效期（默认 24 小时），「偏好设置」中可配置主题、语言、悬浮按钮、填充方式
2. **密码管理**：选项页提供完整 CRUD、批量导入导出（导出需验证主密码）、拼音/首字母智能搜索与排序、标签与收藏；点击条目「查看详情」可只读一屏查看全部字段
3. **快速填充**：全新安装默认内联填充——登录框获焦后显示钥匙图标，点击选择账号即填；可在「偏好设置」切换为「侧边栏」（获焦自动弹出）或「仅手动」。升级用户沿用升级前的侧边栏行为，不会被静默改为内联。也可使用快捷键或在输入框上右键填充
4. **快捷键**：四组高频操作均有默认快捷键（Mac 为 `Cmd`），详见下方速查表

### 快捷键速查

| 功能（命令 ID）                     | Windows / Linux | macOS         | 默认行为                                                                  |
| ----------------------------------- | --------------- | ------------- | ------------------------------------------------------------------------- |
| 打开密码管理页 `open_options`       | `Ctrl+Shift+P`  | `Cmd+Shift+P` | 打开选项页                                                                |
| 开关侧边栏 `toggle_sidepanel`       | `Ctrl+Shift+L`  | `Cmd+Shift+L` | 开/关侧边栏                                                               |
| 快速填充 `quick_fill`               | `Ctrl+Shift+F`  | `Cmd+Shift+F` | 填充当前站点最匹配账号 + 勾选协议；开启「自动触发登录」后连登录按钮一起点 |
| 展开内联下拉 `open_inline_dropdown` | `Ctrl+Shift+K`  | `Cmd+Shift+K` | 在聚焦的输入框上展开账号下拉列表                                          |

> 快捷键无法在插件内改键：Chrome 未提供 `commands.update()` API，且 4 个命令槽已全部占用。管理页「安全设置 → 快捷键」与侧边栏「帮助」均提供只读一览，会标注当前未生效的按键，并可跳转到 `chrome://extensions/shortcuts` 改键。

## 常见问题

**Q：我的密码会被上传到云端吗？**

A：不会。密码数据只保存在浏览器本地空间（`chrome.storage.local`），敏感字段逐字段经 AES-256-GCM 加密后落盘，从不作为明文离开本机。唯一的外联是每 6 小时一次的匿名版本检查，详见[权限与数据流向](#-权限与数据流向)。

**Q：忘记主密码怎么办？**

A：主密码无法找回，只能通过「重置」功能清空数据后重新设置。建议定期通过数据导出或加密备份（.aph 文件）功能备份，避免数据丢失。

**Q：会话有效期到了会发生什么？**

A：会话过期只会清除密钥材料与内存缓存——磁盘上的敏感字段本来就是密文（at-rest 不变量），不存在「过期时批量重新加密」这一步，因此过期瞬间不会卡顿。下次使用时重新验证主密码即可恢复访问，账号数据不会丢失。

**Q：支持从其他密码管理器导入吗？**

A：支持。在导入弹窗中上传 CSV 或 JSON 文件，插件会自动识别 Chrome、LastPass、Bitwarden、1Password 的导出格式并映射字段，30 秒完成搬家。

**Q：删除的密码能找回吗？**

A：能。删除的密码会先移入回收站保留 30 天，在「数据管理」→「回收站」中可恢复或彻底删除；改错密码也可通过条目的「密码修改历史」一键恢复。

**Q：侧边栏不显示，或首次打开较慢？**

A：侧边栏依赖 Chrome 的 Side Panel API（需 Chrome >= 114），也可点击插件图标或快捷键 `Ctrl+Shift+L` / `Cmd+Shift+L` 打开。Windows 上首次冷启动可能因 Defender 逐文件扫描延迟 1-2 秒，将 `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Extensions` 加入排除列表即可降到 1 秒以内（Mac 无需操作）。

> 📖 更多问题（TOTP 使用与排查、填充失败排查、邮箱备份、加密备份、收藏上限等）见[在线演示页面](https://liaolongdong.github.io/account-password-helper/)的完整 FAQ，或 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) 中对应功能的实现说明。

## 立即体验

🔗 [Chrome 应用商店安装](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)（一键安装，自动更新） · [GitHub Releases 下载](https://github.com/liaolongdong/account-password-helper/releases/latest)（无法访问 Google 的用户） · [在线演示](https://liaolongdong.github.io/account-password-helper/)

如果本项目对您有帮助，请帮忙点个 ⭐️、写个商店评价——这是对开源贡献者最大的支持！欢迎提交 Issue 和 Pull Request，完整变更记录见 [CHANGELOG.md](./CHANGELOG.md)。

## 安全提醒

- 本插件为开发、测试与日常登录场景而生，建议不要在任何浏览器扩展中存放银行、支付等高敏感凭证；
- 主密码遗忘**无法恢复**，请务必牢记并妥善保管；
- 敏感字段本地 AES-256-GCM 逐字段加密存储，密码数据从不作为明文离开本机（唯一外联为匿名版本检查）；
- 建议定期通过加密备份功能（.aph 文件）导出备份，并开启剪贴板自动清除与闲置自动锁定；对安全性要求较高时开启「浏览器重启锁定」。

## 许可证

本项目采用 GNU GPL-3.0 开源协议（仅 v3 版本，不含"或更高版本"）。

- 允许自由使用、修改与分发（含商用），但**衍生作品必须以 GPL-3.0 同等开源**，禁止闭源分发；
- 插件名称 "Account Password Helper（账号密码管理助手）"、logo 及品牌素材为作者商标，不在协议授权范围内；
- 本项目打包了第三方依赖（含 Apache-2.0 协议的 jsQR），归属声明见 [THIRD-PARTY-NOTICES.md](./docs/THIRD-PARTY-NOTICES.md)；
- 本仓库已发布的历史版本仍按当时的 MIT 协议存续，GPL-3.0 自切换后的新版本起生效。

## 联系方式

邮箱：[924902324@qq.com](mailto:924902324@qq.com?subject=账号密码管理助手反馈)

**微信交流群**：扫描下方二维码添加作者微信（微信号：`lld_1025`），备注「aph」邀你加入插件交流群，反馈问题、交流使用心得。

<img src="./assets/wx-qrcode/wechat-qrcode.jpg" alt="微信群二维码" width="160" />

---

> 📅 文档最后更新：2026-09 · 功能对应最新已发布版本，见 [Releases](https://github.com/liaolongdong/account-password-helper/releases/latest)
