# CWS 商店填写素材 — 复制粘贴用

> ✅ **已上架**：https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli
>
> 按 Developer Console 的页面顺序整理，逐项复制粘贴即可。后续版本更新时仅需重新上传 zip 包。

---

## 第一步：上传 zip 包

在 Dashboard 打开**已有商品** → 「商品包 / Package」→ **上传新的 ZIP 生成新草稿**（被拒的旧草稿已关闭，无法在原草稿上编辑）。上传以下文件：

```
.output/account-password-helper-3.8.0-chrome.zip
```

> 💡 zip 文件名中的版本号跟随 `package.json`（release-please 自动维护），上传时以 `.output/` 目录中最新构建产物为准。
>
> ⚠️ **2026-09-09：3.8.0 草稿被拒**，违规类型为 [Spam 政策 - 关键字堆砌](https://developer.chrome.com/webstore/program_policies#spam)，被点名的文本是 `Chrome, LastPass, Bitwarden, and 1Password (CSV/JSON formats`。**旧草稿已关闭，只能在 Dashboard 新建草稿重新提交**，不能在原草稿上改。
>
> 🚫 修正口径：**名称、摘要、说明、权限合理性说明、宣传图与 Featured 提名文案一律不得出现竞品品牌名**（Chrome / LastPass / Bitwarden / 1Password），一律改用「常见密码管理器的导出格式」这类描述性说法。下方第二步、第七步已据此改写，并在 `docs/CWS_PUBLISHING_GUIDE.md` 的提交前扫描中加入品牌名与重复度检查。
>
> 🔢 3.8.0 从未发布过（线上仍是 3.7.0），版本号可继续用 3.8.0 重新上传；若 Dashboard 拒绝同版本号，再到 `main` 上让 release-please 升到 3.8.1 后重新构建。
>
> ⚠️ 实测坑（2026-09-10）：本地工作区 `package.json` 仍是 **3.7.0**，`pnpm build` 出来的是 `account-password-helper-3.7.0-chrome.zip`——**与商店线上已发布的版本号相同，Dashboard 会直接拒绝上传**。必须先把分支同步到 `main`（`package.json` 跟随到 3.8.0）再 `pnpm build`，用新产物上传。

---

## 第二步：商店商品详情 (Store Listing)

### 名称 (Name) — 最多 45 字符

```
账号密码管理助手 - 本地加密密码管理器
```

### 摘要 (Summary) — 最多 132 字符

```
开源免费的本地密码管理器：账号、密码与两步验证（TOTP/2FA）动态码以 AES-256-GCM 加密保存在你的浏览器里，不上传云端、无需注册；自动填充并一键登录，含密码强度检测、安全体检、密码生成器、显隐切换、多环境账号隔离、主流密码管理器迁移导入、中英双语
```

> ⚠️ 摘要必须与 `public/_locales/zh_CN/messages.json` 的 `extensionDescription` 逐字一致（当前 **131 字符**，manifest 描述受 132 字符硬限制，超限会导致 zip 上传失败）。英文摘要同步 `public/_locales/en/messages.json`（**130 字符**），见下方英文语言标签页字段。**改摘要必须同时改这两处粘贴块与两个 `_locales` 文件**，否则商店列表与包内 manifest 不一致。
>
> 🔄 「零联网 / 100% offline」的说法已替换为可核对的「不上传云端」——扩展每 6 小时会发起一次不携带用户数据的匿名版本检查（商店安装可访问时探测 Chrome 应用商店，否则回退 GitHub Releases API），旧表述并不成立。两个 `_locales` 文件已随本次改动更新，仍需 `pnpm build` 后重新上传商店包，线上商店列表才会与本地文档一致。
>
> 🚫 **2026-09-09 驳回修正（现行口径）**：旧摘要把「本地加密密码管理器 / AES-256-GCM / 一键登录（填充+勾选+点击）/ TOTP 两步验证 / 安全体检 / Chrome·Bitwarden·1Password 导入 / 密码生成器 / 无需注册」八组关键词用逗号串成一句，其中竞品品牌名被审核直接点名。新摘要**信息密度不降、句式变了**：主语谓语齐全，功能项挂在「含……」这个谓语下面而不是裸挂在句号后，品类词「密码管理器」按产品口径出现、竞品名零出现。`AES-256-GCM` 按用户要求写回摘要（准确的算法名，此前正文里不完整的「AES-256」已一并更正），`PBKDF2` 迭代次数这类参数仍只出现在【安全架构】正文。✅ 两步验证按用户要求写成 **「两步验证（TOTP/2FA）」**：中文侧真实检索词是「两步验证」，两个英文缩写各有搜索量，一份括号全装下，摘要 131 字符仍在 132 上限内。
> 🔻 **若因摘要再次被判堆砌，第一个要砍的就是结尾这串功能清单**：中文按「密码强度检测 → 安全体检 → 密码生成器 → 显隐切换 → 多环境账号隔离 → 迁移导入 → 中英双语」的逆序删，保留前 3～4 项即可回到 80 字符左右；说明正文里的对应条目不受影响，删摘要不丢覆盖。
>
> ✂️ **删减只针对违规本身，不针对篇幅（2026-09-10 二次修订）**：上一轮为过审把【为什么选择它】【适合谁】【安全架构】【常见问题】整体删掉，属于收缩过度——商店说明的上限是 16,000 字符，**篇幅本身不是违规项，同一句话在不同小节里抄两遍才是**。本轮按原结构全部恢复并逐条去重，每个卖点只在其归属小节展开一次：一键登录与多环境隔离归【为什么选择它】，会话有效期与自动锁定归【适合谁】，加密参数归【安全架构】，强度检测 / 显隐切换 / 导入兼容性归【功能全览】，联网 / 性能 / 权限等前文未覆盖的信息归【常见问题】。竞品品牌名仍然零出现，迁移能力统一写「主流密码管理器导出表格 / common password-manager exports」。
>
> 📌 **评审回填三条（2026-09-10 四次修订）**：① 【功能全览】的「导入与导出」补 **「也可勾选条目批量导出选中项」**（代码依据 `composables/usePasswordManagement.ts` 的 `batchExportSelected()`：按 `selectedIds` 过滤后走同一条导出路径——主密码校验 + 带日期后缀的 CSV 文件名）；② **「两步验证（TOTP）」回到【功能全览】独立成条**（扫码 / 上传图片添加密钥、RFC 6238 本地计算、不联网、活码就位可一键填入——依据 `utils/totp.ts`、`utils/qrScanner.ts`、`entrypoints/content/inlineDropdown/TotpHandoffCapsule.ts`），【为什么选择它】的对应条目同步瘦身为纯价值句（不必摸手机、不必切验证器、密码与动态码同条目），机制与价值分属两节、句子不重复；③ 【常见问题】回填 **「真的完全免费吗？」**（只讲付费相关事实：没有高级版、没有内购、没有升级弹窗，GPL-3.0 / 源码可审计仍只归【为什么选择它】）与 **「能从其他密码管理器导入吗？」**（只讲操作路径：原应用导出 CSV / JSON → 导入页上传，字段自动识别归【功能全览】、「整库一次导入」归【适合谁】）。说明长度随之变为中文 **2380** / 英文 **6961** 字符，仍在 16,000 上限内。

### 说明 (Description) — 最多 16,000 字符

```

账号密码管理助手是一款本地优先的密码管理器：账号、密码和两步验证码加密保存在你自己的浏览器里，不需要注册账号，也没有云端同步。打开登录页时，它可以自动填充账号和密码、勾选「记住我」，并按你的设置自动点击登录按钮。

【为什么选择它】
◆ 不只填表，还替你完成登录：在侧边栏选中条目点「填充并登录」，或在偏好设置中开启「自动触发登录」后自动提交；快捷键 Ctrl+Shift+F 有意只做填充与勾选、不提交表单，避免误发
◆ 同一站点多套账号互不串：条目按精确域名匹配，开发、测试、预发、生产各留各的凭证——同时跑多环境的人最需要这条
◆ 验证码和密码存在同一处：不用在登录途中去摸手机、切换验证器应用——一个条目里既有密码也有动态码
◆ 免费、开源、无订阅：GPL-3.0 协议，源码可审计，全部功能不设付费墙

【适合谁】
· 开发者：本地、测试、预发、生产域名分开管理，凭据按站点精确命中，不用再靠备注区分环境
· 测试工程师：批量导入用例账号，跨环境切换时一次按键完成登录，误删可回收，改错的密码能回滚
· 隐私敏感用户：会话有效期从 1 小时到 7 天可自定义，支持闲置超时、系统锁屏与浏览器重启自动锁定
· 日常登录用户：登录时自动保存新账号，需要时一键生成强密码，长期未更新的密码会有到期提醒
· 正在搬家的人：从其他密码管理器换过来时整库一次导入，不用逐条手动录入

【怎么使用】
1. 安装后点击工具栏图标，打开侧边栏
2. 首次使用设置一个主密码（至少 8 位，需同时包含字母、数字和符号），全部数据都以它加密
3. 在登录页让扩展捕捉账号，或到密码管理页手动添加、批量导入
4. 之后在任意登录页用侧边栏、输入框钥匙图标、右键菜单或快捷键完成填充

【安全架构】
· 主密码经 PBKDF2（600,000 次迭代）派生 256-bit 密钥，全部密码学运算使用浏览器原生 Web Crypto API
· 账号、密码、网址、备注和两步验证码五类敏感内容以 AES-256-GCM 认证加密后才写入本地存储，会话过期即回到密文状态
· 闲置超时、系统锁屏或浏览器重启（可选）后自动锁定，需要重新输入主密码；主密码本身不会被保存，遗忘后无法找回
· 复制密码后按设定的秒数自动清理剪贴板（默认 30 秒），清理前会先比对内容，不会误清你随后复制的内容
· 安全体检、密码生成器与泄露密码字典比对全部在设备端完成，不读取网络

【功能全览】
· 四种填充入口：输入框获得焦点后出现的钥匙图标、侧边栏、输入框右键菜单、快捷键；登录框位于页面框架内时同样可以填充
· 登录时自动保存：提交登录时弹窗确认，自动去重，可设置域名黑白名单与「不再提示」；密码偏弱或已被多个账号使用时，会在同一弹窗中提醒
· 密码安全体检：给出 0 到 100 分的综合评分，检查密码复用、弱密码、常见泄露密码和长期未更新，并列出未开启两步验证的条目
· 密码生成器：随机密码与助记词组两种模式，可自定义长度、字符集或词数
· 密码强度检测：按长度、字母、数字、符号四条规则评为弱 / 中 / 强，在添加、编辑和登录保存时同步给出
· 密码可见性切换：在页面密码框内加入显示或隐藏按钮（默认关闭，在偏好设置中开启），填充后一眼确认输入内容
· 两步验证（TOTP 2FA）：扫描网页二维码或上传图片即可添加密钥，动态码在你的设备上按 RFC 6238 算法生成，不联网、不上传；登录走到第二步时活码就近显示，可一键填入
· 导入与导出：支持 CSV 和 JSON，可整库导出，也可勾选条目批量导出选中项；自动识别主流密码管理器导出表格的字段（含两步验证密钥列），另有 .aph 加密备份与邮箱备份提醒
· 回收站与修改历史：删除的条目保留 30 天可恢复，每条密码可保留多份历史快照以便回滚
· 侧边栏快速添加与只读详情：顶栏「+」就地添加当前站点并预填网址；每行「查看详情」以抽屉展示完整备注、活码与修改历史，无需进入编辑态
· 智能搜索与整理：支持拼音与首字母的模糊搜索、侧边栏「本站 / 全站」范围切换、标签分类、收藏置顶、一键去重、批量管理
· 界面与快捷键：6 款色彩主题、中英文界面即时切换，Ctrl+Shift+P 管理 / L 侧边栏 / F 快速填充 / K 内联均可在扩展的快捷键页自定义

【常见问题】
· 真的完全免费吗？是。没有高级版、没有内购，也不会有劝你升级的弹窗
· 密码会被上传到云端吗？不会。扩展没有服务器，唯一主动发起的联网是每 6 小时一次的匿名版本检查，只读取扩展自身的版本号，不携带任何用户数据；其余功能离线可用
· 忘记主密码怎么办？无法找回，也没有任何人能替你重置。请定期用加密备份导出，避免数据丢失
· 能从其他密码管理器导入吗？可以：在原来用的应用里导出 CSV 或 JSON，再到扩展的导入页上传即可
· 会拖慢网页或侧边栏吗？不会。侧边栏在冷启动、会话失效、快速重启等场景下都保持 1 秒内打开（缓存快路径约 20-50ms）；注入页面的浮层使用隔离的 Shadow DOM，不改变宿主页面样式
· 有没有广告、统计或埋点？没有。权限也只围绕这几件事：检测并填充登录表单、复制密码、读取浏览器本地缓存的网站图标

【温馨提示】
本扩展面向开发者、测试人员与日常登录场景设计，建议不要在任何浏览器扩展中存放银行、支付等高敏感凭证。

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
Account Password Helper - Password Manager
```

> ⚠️ 商店 Name 必须与 `public/_locales/en/messages.json` 的 `extensionName` 逐字一致（半角连字符，不是 en-dash），否则会被判定列表与 manifest 不符。

**Summary（摘要）— 最多 132 字符**

```
Free open-source password manager: an AES-256-GCM local vault with autofill sign-in, TOTP 2FA, strength checks and easy migration.
```

> ⚠️ 英文摘要必须与 `public/_locales/en/messages.json` 的 `extensionDescription` 保持完全一致（**130 字符**，上限 132）。
>
> 🚫 **2026-09-09 驳回修正**：旧英文摘要 `Open-source local password manager: one-click login, per-field AES-256-GCM, TOTP 2FA, audit, generator. No uploads, no sign-up.` 是 6 个关键词用逗号串起来的清单，正是 keyword-spam 判定形态。新摘要仍是完整句子，功能项挂在 **with** 之后（`with autofill sign-in, TOTP 2FA, strength checks and easy migration`），竞品品牌名零出现；`AES-256-GCM` 按用户要求写回（准确的算法名），`PBKDF2` 迭代次数仍只出现在 SECURITY ARCHITECTURE 正文。
> 🔻 **英文 132 额度装不下中文那串清单**（拉丁字母的信息密度约为中文的一半），因此「密码可见性切换 / show or hide」只写在 FEATURE SET，不进摘要；强度检测在摘要里写作 `strength checks` 而不是 `strength audit`，因为 `audit` 已被【功能全览】里 0–100 分的安全体检占用，同词会让审核以为是同一个卖点写两遍。若二次驳回，先砍 `strength checks and easy migration` 回到 100 字符左右。

**Description（说明）— 最多 16,000 字符**

```

Account Password Helper is a local-first password manager: usernames, passwords and two-factor codes are encrypted and kept in your own browser — there is no account to register and no cloud sync. When you reach a login page it can auto-fill your username and password, tick the remember-me box and, if you allow it, click the sign-in button.

WHY YOU'LL LIKE IT
◆ It finishes the sign-in, not just the form: pick an entry in the side panel and tap "Fill and sign in", or turn on "Auto-submit login" in preferences. The Ctrl+Shift+F shortcut deliberately only fills and ticks, so nothing is ever submitted by surprise.
◆ Several accounts per site, never mixed up: entries match the exact host name, so development, test, staging and production credentials for the same app stay separate — the thing multi-environment work needs most.
◆ Codes live with the passwords: no phone to reach for and no authenticator app to switch to mid-login — one entry holds both secrets.
◆ Free, open-source, no subscription: GPL-3.0, auditable source, every feature unlocked.

WHO IT'S FOR
· Developers: local / test / staging / production host names are managed apart and matched exactly, so you no longer tell environments apart by their notes.
· Test engineers: import a batch of case accounts, sign in across environments with one keystroke, recover what you deleted, roll back a changed password.
· Privacy-conscious users: session validity is yours to choose between 1 hour and 7 days, with auto-lock on idle, system lock or browser restart.
· Everyday sign-ins: new accounts are offered for saving as you sign in, strong passwords are one tap away, and long-unchanged passwords come with expiry reminders.
· Anyone moving house: switch from another password manager with the whole vault imported at once, instead of typing every entry by hand.

HOW TO USE
1. Click the toolbar icon to open the side panel.
2. On first run, set a master password (at least 8 characters, containing letters, numbers and symbols). All of your data is encrypted with it.
3. Let the extension capture an account when you sign in, or add and import entries on the management page.
4. From then on, fill any login page from the side panel, the key icon, the right-click menu or the keyboard shortcut.

SECURITY ARCHITECTURE
· The master password is stretched with PBKDF2 (600,000 iterations) into a 256-bit key; every cryptographic operation runs on the browser's native Web Crypto API.
· The five sensitive fields (username, password, website, note and two-factor key) reach local storage only after AES-256-GCM authenticated encryption, and fall back to ciphertext when the session expires.
· The vault locks on idle timeout, system lock or browser restart (optional) and asks for the master password again. The master password itself is never stored, so it cannot be recovered if forgotten.
· After you copy a password, the clipboard is cleared on a timer (30 seconds by default) and is compared before clearing, so your most recent copy is never destroyed.
· The security audit, the password generator and the leaked-password dictionary all run on the device, without a network request.

FEATURE SET
· Four ways to fill: the key icon that appears when a field takes focus, the side panel, the right-click menu on an input, and the keyboard shortcut. Forms inside page frames can be filled as well.
· Save as you sign in: the extension asks before storing anything, de-duplicates what it catches, and lets you allow or block domains or say "never for this site". Weak or shared passwords are pointed out in the same prompt.
· Password check-up: a security audit scored from 0 to 100 that looks at reused, weak, commonly leaked and long-unchanged passwords, and lists the entries with no two-factor key set up.
· Password generator: random passwords or memorable word passphrases, with the length, character set or number of words you choose.
· Password strength check: four rules — length, letters, numbers, symbols — rate every password weak, medium or strong while you add, edit or save it.
· Show or hide passwords: adds a visibility control inside password fields on the page (off by default; turn it on in preferences) so you can check what was filled.
· Two-factor codes (TOTP): add a key by scanning the QR code on a page or uploading an image, and the code is generated on your device per RFC 6238, with no network request and nothing uploaded; when the login asks for a code, the live one sits next to the field and fills in one click.
· Import and export: CSV and JSON, either the whole vault or just the entries you tick; the columns of common password-manager exports are detected automatically, two-factor keys included; plus encrypted .aph backups and email backup reminders.
· Trash and history: deleted entries stay recoverable for 30 days, and each password keeps earlier snapshots you can roll back to.
· Quick add and read-only details: the "+" in the panel header saves an account for the current site with its domain pre-filled, and "View details" opens a drawer with the full note, the live code and the change history without entering edit mode.
· Search and tidy-up: fuzzy search that understands pinyin and initials, "this site / all entries" scoping in the side panel, tags, favorites, one-tap duplicate cleanup and batch actions.
· Interface: 6 color themes, an instant Chinese/English switch, and customizable shortcuts (Ctrl+Shift+P manage / L side panel / F quick fill / K inline).

QUESTIONS
· Is it really free? Yes — no premium tier, no in-app purchase, and no upgrade prompt.
· Are my passwords uploaded anywhere? No. The extension has no server; the only request it starts is an anonymous version check every 6 hours, which reads its own version number and carries no user data. Everything else works offline.
· What if I forget the master password? Nothing can recover or reset it. Export an encrypted backup regularly, so a forgotten password never costs you the vault.
· Can I import from another password manager? Yes — export a CSV or JSON from the app you use now, then upload it on the import page.
· Will it slow down pages or the side panel? No. The panel opens within a second even on a cold start, an expired session or a quick browser restart (about 20-50ms on the cached path), and the overlays injected into pages use an isolated Shadow DOM that leaves host styles alone.
· Any ads, analytics or telemetry? None. The permissions cover exactly what the feature needs: finding and filling login forms, copying passwords, and reading site icons from the browser's local cache.

A friendly note: the extension is designed for developers, testers and everyday sign-in scenarios. We recommend not storing highly sensitive credentials (banking, payment, etc.) in any browser extension.

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

### 屏幕截图 (Screenshots) — 至少 1 张，官方规格 1280×800 或 640×400

> ✅ **2026-09-10 重制（推荐上传这一组）**：`assets/cws-store/screen-*.png`，**中英各 6 张**，**2560×1600（即 1280×800 @2x，正好是官方规格的 2 倍）**。每张顶部为品牌渐变标题带（`#0A1A38 → #123E77`，与 Marquee / 小推广图同源；左侧一条品牌色竖条做视觉锚点），下方为界面演示，全部使用占位演示数据（`example.com` / `*.example.com`，**不含任何真实账号、真实邮箱或第三方品牌**）。
>
> 🌐 **两套都要传**：Dashboard 上中文页与 English (United States) 页的截图槽位互相独立、不会继承。**英文版文件名带 `-en` 后缀**，而且不只是标题带翻译——界面本身也切到英文（含标签 `Dev/Staging/Prod/QA/Ops/Design/Docs/Sandbox` 与英文备注），所以英文跑批必须用全新 profile 重新 seed。
>
> 生成方式：脚本化截取（本地起 Chrome 加载 `.output/chrome-mv3` 构建 + 演示数据 + 演示登录页），不是人工截图。演示数据与复现步骤见下方「生成方式」。
>
> | 序号 | 文件（英文加 `-en`）            | 卖点           | 标题带文案                                               |
> | ---- | ------------------------------- | -------------- | -------------------------------------------------------- |
> | 1    | `screen-1-one-click-login.png`  | 一键登录       | 一键登录：填充 → 勾选「记住我」→ 自动点击登录            |
> | 2    | `screen-2-totp.png`             | TOTP 两步验证  | TOTP 两步验证：验证码和密码住在一起，不用摸手机          |
> | 3    | `screen-3-multi-env.png`        | 多环境账号管理 | 多环境账号管理：同一站点，开发 / 测试 / 生产分得清清楚楚 |
> | 4    | `screen-4-security-audit.png`   | 离线安全体检   | 离线安全体检：0-100 分给密码健康打分，全程本机计算       |
> | 5    | `screen-5-preferences.png`      | 主题与双语     | 6 款主题 + 中英文双语界面，即时切换无需刷新              |
> | 6    | `screen-6-local-encryption.png` | 本地加密       | 本地加密：密码只存在你的浏览器里，加密后落盘             |
>
> ⚠️ **每个语言页的截图上限是 5 张**，上表有 6 张候选，上传时按需取舍：**若要砍一张，先砍第 6 张**（本地加密画面最朴素，且该主张在摘要与说明里已有文字承载）。
>
> ⚠️ **标题带文案的合规约束与商店文案完全一致**：零竞品品牌名、零绝对化表述（不写「零联网 / 100% offline / 数据不出浏览器」——扩展每 6 小时有一次不携带用户数据的匿名版本检查）。改文案后必须重新跑一遍本节「生成方式」的脚本。
>
> 🚫 **旧的 `01-*.png` ~ `12-*.png` 不要再上传商店**：那 12 张拍摄于 2026-07-29 的 **v2.12.0**，界面版本徽章过期，其中 `01-master-password.png` 还带着已删除的「严禁……后果自负」旧声明，且含真实账号邮箱。它们若仍出现在 README 等位置，需另行重截（见 `docs/exposure-status.md` 残留待办）。

### 生成方式（可复现）

截图由脚本生成，**改完商店文案或功能后重跑即可**，不要手改 PNG：

```bash
# 1) 构建（截图里的版本徽章取自 manifest.version）
pnpm build

# 2) 起本地静态服务托管演示登录页，并带 host 映射启动 Chrome
#    （把 admin.example.com / console.example.com 指到 127.0.0.1，让侧边栏能命中演示账号）

# 3) 按语言各跑一批：seed（设主密码 + 导入占位账号）→ seeded → prefs
#    再换全新 profile 跑 firstrun（本地加密需要「还没设主密码」的首启状态）
node scripts/store-shots/seed.mjs    "$PWD/.output/chrome-mv3" zh
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" seeded zh
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" prefs  zh
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" firstrun zh
# 英文同上，第二个参数换成 en（演示标签也是英文，必须换全新 profile 重新 seed）
```

> 演示账号（8 条占位）内联在 `scripts/store-shots/seed.mjs` 的 `DEMO_CSV_ZH` / `DEMO_CSV_EN`；演示登录页 / 2FA 页为同目录的 `demo-login.html`、`demo-2fa.html`；截图与合成脚本也在该目录，完整用法（含 Chrome 启动参数）见其 `README.md`。
>
> 💡 版本徽章：脚本读取构建产物里的 `manifest.version`，所以**务必先让分支版本与即将提交的包一致**（当前应为 3.8.0）再截，否则又会出现「截图版本与商店版本不符」。

> 📐 **尺寸对照**：新一组是官方规格的精确 2 倍（1280×800 @2x = 2560×1600），不会触发尺寸校验。`assets/screenshots/` 里的旧 12 张是 2880×1598~1610（约 16:9），既非官方比例、版本也已过期。
>
> ⚠️ `assets/cws-store/` 除新的 12 张（6 中文 + 6 英文）外，仍有旧素材：`01-*.png` ~ `08-*.png`（v2.12.0，**含真实账号邮箱，勿再上传**）、`store-icon-128x128.png`、四张推广图（`marquee-1400x560.png` / `marquee-en-1400x560.png` / `small-promo-440x280.png` / `small-promo-en-440x280.png`）。上传截图时只取 `screen-*.png`。

### 小幅推广图片 (Small Promo Tile) — 440×280

> 🌐 **每个语言标签页有各自独立的图形资产槽位**：中文商品页传中文版，English (United States) 页传英文版，两张同尺寸但文字不同。

使用项目中的文件：

```
assets/cws-store/small-promo-440x280.png       # 中文语言页
assets/cws-store/small-promo-en-440x280.png    # English (United States) 语言页
```

> 💡 Featured 提名建议上传此图，完善商店展示素材完整度。

### Marquee 宣传图片 (Marquee) — 1400×560

```
assets/cws-store/marquee-1400x560.png          # 中文语言页
assets/cws-store/marquee-en-1400x560.png       # English (United States) 语言页
```

> 🔁 **2026-09-10 重绘**：旧图烧着「数据零网络传输，密码不出浏览器」与「开源免费 · MIT License」——前者是与匿名版本检查矛盾的绝对化隐私承诺，后者许可证写错，两者都属于商店元数据里的误导表述。新图文案：主标题「账号密码管理助手 / Account Password Helper」，副标题「本地加密 · 密码不上传」，四张卖点卡（逐字段本地加密 / 一键填充并登录 / 两步验证码 + 安全体检 / 免费开源 · 无订阅），角标「开源免费 · GPL-3.0 协议」，右侧为侧边栏界面示意（`demo.example.com` 等占位数据，不含真实账号）。
>
> 🎨 中英文四张图共用同一版式；图标语义统一为加密=盾牌、填充登录=闪电、动态码=计时器、开源=尖括号（此前「开源」卡误用挂锁与眼睛，与加密卡语义重复）；英文侧卡片加宽到 482px 并按 19 / 13.5px 字号重排，避免文字压到卡片描边。
>
> 🛠 四张推广图都有矢量源，改文案后重新渲染，不要再手改 PNG：
>
> ```bash
> # 源文件：imgs/store-creatives/{marquee,marquee-en,small-promo,small-promo-en}-*.svg
> pnpm store-creatives:render        # 渲染全部 → assets/cws-store/*.png
> pnpm store-creatives:render 440    # 只渲染文件名含 440 的那两张
> ```
>
> 脚本按文件名里的 `宽x高` 校验 SVG 画布，尺寸不符直接非零退出——商店对这两类图是硬尺寸要求。

### 演示 GIF（Demo GIF）— Featured 加分项

> 非必须，但官方推荐提供演示视频/GIF 展示核心功能，能显著提升审核印象。

**GIF 1：一键登录演示（必做）**

| 项目     | 要求                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 内容脚本 | 打开登录页 → 侧边栏选中条目点「填充并登录」（或在偏好设置中开启「自动触发登录」后按 `Ctrl+Shift+F` 只填充、再手动点击）→ 账号密码自动填充 → 「记住我 / 同意条款」自动勾选 → 登录按钮自动点击 → 登录成功 |
| 时长     | 10–15 秒                                                                                                                                                                                                |
| 宽度     | 800–1000px                                                                                                                                                                                              |
| 文件大小 | ≤ 5MB（可用 [ezgif.com](https://ezgif.com) 或 `ffmpeg` 压缩）                                                                                                                                           |
| 存放位置 | `docs/demo-login.gif`（README 首屏引用）                                                                                                                                                                |
| 录制工具 | 推荐 macOS 自带屏幕录制 / LICEcap / ScreenToGif                                                                                                                                                         |
| 压缩命令 | `ffmpeg -i input.mp4 -vf "fps=15,scale=900:-1" -loop 0 demo-login.gif`                                                                                                                                  |

**GIF 2：TOTP 两步验证接力（加分）**

| 项目     | 要求                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| 内容脚本 | GitHub 登录 → 密码自动填充 → 跳转验证码页 → 活码胶囊自动锚定 → 一键填入验证码 → 登录成功 |
| 时长     | 15–20 秒                                                                                 |
| 规格     | 同上                                                                                     |
| 存放位置 | `docs/demo-totp.gif`（推广文章配图用；**尚未录制**，`docs/demo-login.gif` 已存在）       |

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
提供浏览器侧边栏面板，在当前页就地列出匹配的账号：搜索（支持拼音与「本站 / 全站」范围切换）、一键填充或「填充并登录」、复制用户名与两步验证码、收藏置顶，以及通过顶栏「+」快速添加当前站点条目。编辑与删除仍在密码管理页完成，侧边栏不承载这些操作。
```

**alarms**

```
定时执行版本更新检查（每 6 小时）、自动备份提醒和 Service Worker 保活（全平台常驻，后台约每 30 秒唤醒一次以保证侧边栏秒开），通过 chrome.alarms API 实现。
```

**notifications**

```
向用户发送桌面通知：自动保存成功、定期备份提醒、版本更新提示、条目密码到期提醒、快捷键填充结果反馈，以及会话失效时的「需要解锁」提示（点击可直达主密码验证页）。通知仅在用户已启用的功能触发时产生，不含任何密码内容。
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
仅调用 chrome.webNavigation.getAllFrames 枚举当前标签页的框架（iframe）列表，以便把凭据填充到位于 iframe 内的登录表单。扩展不监听任何导航事件，也不读取页面内容或URL历史，查询结果只用于定位可填充框架。
```

**contextMenus**

```
在网页右键菜单中提供填充入口：在输入框上右键可填充当前站点匹配的用户名/密码/两步验证码或生成并填充强密码，在页面空白处右键可打开侧边栏或密码管理页。菜单仅在用户主动右键时展示，不读取页面内容。
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

| #   | 检查项           | 要求                                | 现状                                                                                                                     |
| --- | ---------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Manifest V3      | 硬性要求                            | ✅ 已满足                                                                                                                |
| 2   | 数据安全         | 用户数据不得明文传输                | ✅ 已满足（不传输任何用户数据；唯一出站请求是不含用户数据的匿名版本检查）                                                |
| 3   | 隐私政策         | 有公开 URL，与商店 Privacy 标签一致 | ✅ 已满足                                                                                                                |
| 4   | Marquee 宣传图   | 1400×560，每个语言页各一张          | ✅ 素材就绪（`marquee-1400x560.png` + `marquee-en-1400x560.png`，2026-09-10 按新口径重绘，源见 `imgs/store-creatives/`） |
| 5   | 权限最小化       | 只申请必要权限并解释用途            | ✅ 已满足                                                                                                                |
| 6   | 单一用途         | 用途清晰单一                        | ✅ 已满足（密码管理）                                                                                                    |
| 7   | 核心功能无付费墙 | 核心功能免费                        | ✅ 已满足（完全免费）                                                                                                    |
| 8   | 无未解决违规     | 无政策违规记录                      | ⚠️ 2026-09-09 有一条 keyword stuffing 驳回（3.8.0 草稿，未上架）——须新建草稿通过审核后再提名                             |
| 9   | 性能             | 高效运行、不滥用资源                | ✅ 已满足（侧边栏全场景秒开，SLA <1s；缓存快路径 20-50ms 拿到数据）                                                      |
| 10  | 商店列表质量     | 标题/描述/截图完整高质量            | 🔄 文案已按驳回重写待审；截图仍是 v2.12.0 旧版，需按第三步「🔁 截图已过期」重截                                          |

### 7.2 提名表单文案 — 英文（直接粘贴）

**What is the purpose of your extension? Describe the value it provides to Chrome users.（扩展程序的用途是什么？说明它为 Chrome 用户带来的价值。）**

```
Account Password Helper is a free, open-source, local-first password manager — one-click login (autofill → tick the remember-me / "I agree" box → click login, not just form fill), exact-domain matching to isolate dev/test/staging/prod accounts, built for developers and QA engineers. No cloud sync, no account, no subscription. AES-256-GCM encrypted, all credential data stays in your browser.

Key differentiators:
• One-click login: the side panel's "Fill and sign in" action (or the opt-in "Auto-submit login" preference) autofills credentials, ticks the consent box, and clicks login — complete sign-in in under 1 second. The Ctrl+Shift+F shortcut deliberately only fills and ticks, so it never submits a form by surprise.
• Multi-environment isolation: exact-domain matching separates dev/test/staging/prod accounts for the same site
• Built-in TOTP authenticator: RFC 6238 codes generated locally, auto-anchors on GitHub-style 2FA pages
• Offline security audit: 0–100 score weighted across 4 dimensions (reuse 35 / weak 25 / commonly leaked 20 / stale 20), all computed on-device
• Zero-cost migration: CSV and JSON import, with the export formats of common password managers detected automatically

Completely free, no paywall, no subscription, no data collection. Open source (GPL-3.0).
```

**How do users use your extension? Provide examples of primary use cases.（应如何使用您的扩展程序？请提供主要使用情形示例。）**

```
SETUP (one-time): Install → set master password → add accounts manually or bulk-import from CSV/JSON.

1) One-click login: A QA engineer opens the side panel on a staging login page and taps "Fill and sign in" — account autofilled, consent ticked, login clicked — under 1 second. With "Auto-submit login" enabled in preferences the same result follows a single keystroke.

2) Multi-environment management: A developer manages dev/staging/prod accounts for the same site. Exact-domain matching keeps credentials separated.

3) TOTP handoff: User signs into GitHub. After password autofill, a live TOTP capsule auto-anchors beside the 2FA input — one-click entry, no phone needed.

4) Inline autofill: Login form detected → key icon → compact dropdown with matching accounts → select to fill (Ctrl+Shift+K).

5) Offline security audit: Monthly scan generates a 0–100 score weighted across four dimensions (reuse 35 / weak 25 / commonly leaked 20 / stale 20; "no 2FA set up" is listed but unscored). All computed locally.

6) Auto-save: New login detected → prompt to save. Smart dedup + domain allow/block lists, plus a non-blocking inline warning when the password is weak or shared with other accounts.

Shortcuts: Ctrl+Shift+P (manage) / L (panel) / F (quick fill — fills and ticks, login only via "Fill and sign in" or "Auto-submit login") / K (inline). All customizable at chrome://extensions/shortcuts — the manager page ("Security Settings → Keyboard Shortcuts") and the side panel Help dialog both list all four bindings with their live status, flag any key that is currently inactive, and link straight to that page. Right-click an input to fill username/password/2FA code or generate a strong password.
```

**Indicate any other products, platforms, or restricted websites (e.g., Netflix account, Adobe Creative Suite account, banking, intranet domains, etc.) that your extension requires access to in order to fulfill its purpose.（指明您的扩展程序为实现其用途而需要访问的其他产品、平台或受限网站。）**

```
Account Password Helper does NOT require access to any third-party products, platforms, or restricted websites. It stores and processes everything locally and never sends user data anywhere.

Local by design:
• All data encrypted and stored in chrome.storage.local
• Cryptography uses the browser's native Web Crypto API (PBKDF2 + AES-256-GCM)
• No telemetry, no analytics, no crash reporting, no cloud sync, no remote code or remote resources
• TOTP codes, the security audit, the password generator and the breached-password dictionary check all run entirely on-device

The extension's only outbound network call is an automatic version check, run once every 6 hours:
• It first sends a `no-cors` HEAD request to https://chromewebstore.google.com/ purely to probe reachability (an opaque response is discarded; the result is cached for 24 hours and a 3-second timeout aborts it).
• Only when the Chrome Web Store is unreachable (e.g. blocked networks) does it then call the public GitHub Releases API to read the newest version number, so the user can still be told an update exists.
• Both requests are anonymous: they carry no credentials, no vault contents, no identifiers and no analytics payload, and the responses only supply a version string and a release URL.
• The user-facing website and repository links are opened in a normal browser tab only when the user clicks them.

<all_urls> host permission is used solely to:
• Detect login forms on any webpage via Content Scripts
• Provide autofill on any website the user visits
• Read website favicons from Chrome's local cache (no external icon requests)

No specific website accounts are required. The extension treats all websites uniformly as autofill targets.
```

### 7.3 提名表单文案 — 中文（参考对照）

**扩展程序的用途是什么？说明它为 Chrome 用户带来的价值。**

```
账号密码管理助手是一款免费、开源、本地优先的密码管理器，专为开发者、测试工程师和注重隐私的用户打造。所有凭证使用 PBKDF2（600,000 次迭代）+ AES-256-GCM 在本地加密，密码数据不经过网络——无云端同步、无账号、无订阅。

核心差异化价值：
• 一键登录：侧边栏「填充并登录」（或在偏好设置中开启「自动触发登录」）自动填充账号、勾选「记住我 / 同意条款」、点击登录按钮，1 秒内完成登录；`Ctrl+Shift+F` 有意只做填充与勾选，不会替你提交表单
• 多环境账号隔离：精确域名匹配区分同一站点的 dev/test/staging/prod 账号
• 内置 TOTP 验证器：RFC 6238 验证码本地生成，GitHub 式两步登录自动锚定活码胶囊
• 离线安全体检：0–100 评分，四个计分维度按权重合计（复用 35 / 弱密码 25 / 常见泄露 20 / 长期未更新 20），「未开启两步验证」仅列示不计分，全程本地计算
• 零成本迁移：支持 CSV / JSON 导入，自动识别常见密码管理器的导出格式

完全免费，无付费墙、无订阅、无数据收集。开源（GPL-3.0）。
```

**应如何使用您的扩展程序？请提供主要使用情形示例。**

```
初始设置（一次性）：安装 → 设置主密码 → 手动添加或从 CSV/JSON 批量导入账号。

1) 一键登录：测试工程师在 staging 登录页打开侧边栏，点选条目的「填充并登录」——账号自动填充、协议自动勾选、登录按钮自动点击，1 秒内完成；在偏好设置中开启「自动触发登录」后，一次按键即可得到同样结果。

2) 多环境凭证管理：开发者管理同一应用 dev/staging/prod 的账号，精确域名匹配确保各环境凭证互不混淆。

3) TOTP 两步验证接力：登录 GitHub，密码填充后下一页要求验证码，扩展自动锚定活码胶囊，一键填入，无需手机验证器。

4) 内联填充：检测到登录表单 → 钥匙图标出现 → 点击展开匹配账号下拉面板 → 选择即填充（Ctrl+Shift+K）。

5) 离线安全体检：每月扫描生成 0–100 评分，四个计分维度按权重合计（复用 35 / 弱密码 25 / 常见泄露 20 / 长期未更新 20；「未开启两步验证」仅列示不计分），全程本地计算。

6) 自动保存：检测到新登录 → 弹窗确认保存，智能去重 + 域名白名单/黑名单；密码较弱或与其它账号共用时弹窗内联预警，只提醒不拦截。

快捷键：Ctrl+Shift+P（管理）/ L（侧边栏）/ F（快速填充，只填充与勾选，登录需「填充并登录」或开启「自动触发登录」）/ K（内联），均可在 chrome://extensions/shortcuts 自定义——密码管理页「安全设置 → 快捷键」与侧边栏「帮助」弹窗均列出四组按键及其当前生效状态，会标注未生效的按键并可一键直达该页。输入框上右键可直接填充用户名/密码/两步验证码或生成强密码。
```

**指明您的扩展程序为实现其用途而需要访问的其他产品、平台或受限网站。**

```
账号密码管理助手不需要访问任何第三方产品、平台或受限网站；所有数据在本地存储与处理，任何用户数据都不会被发送出去。

本地优先设计：
• 所有数据加密后存储在 chrome.storage.local
• 密码学操作使用浏览器原生 Web Crypto API（PBKDF2 + AES-256-GCM）
• 无遥测、无分析、无崩溃上报、无云端同步、无远程代码与远程资源
• TOTP 验证码、安全体检、密码生成器与弱密码字典比对全部在设备端完成

扩展唯一的出站网络请求是每 6 小时一次的自动版本检查：
• 先向 https://chromewebstore.google.com/ 发起一次 `no-cors` 的 HEAD 请求，仅用于探测网络可达性（返回的不透明响应会被丢弃，结果缓存 24 小时，并由 3 秒超时中止）。
• 仅当 Chrome 商店不可达（例如网络被屏蔽的环境）时，才改调 GitHub Releases 公开 API 读取最新版本号，以便仍能提醒用户有新版本。
• 两类请求都是匿名的：不携带凭据、密码库内容、设备标识或任何统计信息；响应只提供版本字符串与发布页地址。
• 官网与仓库链接只在用户主动点击时于普通浏览器标签页中打开。

<all_urls> 主机权限仅用于：
• 通过 Content Script 检测任意网页的登录表单
• 在任意网站提供自动填充功能
• 从 Chrome 本地缓存读取网站图标（不发起任何外部图标请求）

不需要访问任何特定网站账号，扩展对所有网站一视同仁，统一视为自动填充目标。
```

### 7.4 注意事项

- **竞品品牌名一律不写**：2026-09-09 的 3.8.0 草稿就是被 `Chrome, LastPass, Bitwarden, and 1Password (CSV/JSON formats` 这句判为 keyword stuffing（[spam 政策](https://developer.chrome.com/webstore/program_policies#spam)）。商店的名称、摘要、说明、宣传图与提名文案只写「常见密码管理器的导出格式」；扩展**内**的导入向导 UI 可以保留具体格式名，因为那是功能说明而非商店元数据。
- **卖点只在一处展开，不靠删篇幅**：2026-09-10 二次修订后，中文说明恢复为【为什么选择它】【适合谁】【怎么使用】【安全架构】【功能全览】【常见问题】六个小节，去重方式是**让每个卖点只有一个归属小节**（一键登录与多环境隔离只在【为什么选择它】、会话有效期与自动锁定只在【适合谁】、算法与参数只在【安全架构】、入口与清单只在【功能全览】、联网/性能/权限口径只在【常见问题】），而不是把小节整体砍掉。提交前用 `docs/CWS_PUBLISHING_GUIDE.md` 的重复度扫描过一遍。
- **用户量不是门槛**：即使不到 100 个用户，只要符合质量标准也能获批。
- **徽章可被撤销**：获批后若质量下降、出现违规或性能问题，Google 会移除徽章。
- **不能购买**：Featured 完全基于质量评估，没有任何付费通道。
- **获批后动作**：截图留存展示数据变化，同步在社交媒体官宣。
- **审核周期**：约 10 天（实际从几天到一个月不等），通过后邮件通知，徽章自动展示。

---

## 检查清单

### 商店上传前确认

- [ ] zip 包已上传（3.8.0 草稿已被关闭 → 在**已有商品**里上传新包生成新草稿；**不要点「新建商品」**，那会创建第二个重复商品）
- [ ] 名称、摘要、说明已填写（中英文）
- [ ] **文案零竞品品牌名**：`grep` 检查名称/摘要/说明/提名文案中不含 LastPass、Bitwarden、1Password（以及作为竞品词出现的 Chrome）
- [ ] **摘要与 manifest 逐字一致**且 ≤132 字符（当前中文 131 / 英文 130，超限 zip 上传失败）
- [ ] 说明无重复卖点：每个卖点只有一个归属小节，同一句话不在两个小节里抄两遍
- [ ] 商店 Name 与 `public/_locales/*/messages.json` 的 `extensionName` 逐字一致（中英文均是）
- [ ] 分类选择 Productivity
- [ ] 商店图标已上传（128×128）
- [ ] 截图已上传（**中文页与 English (United States) 页各 5 张**，取自 `assets/cws-store/screen-*.png` 与其 `-en` 版；**不要再用旧的 `01-*.png` ~ `12-*.png`**）
- [ ] Marquee 宣传图（1400×560）已上传
- [ ] Small Promo Tile（440×280）已上传
- [ ] 隐私政策 URL 已填写
- [ ] 数据使用声明已选择「不收集」
- [ ] 所有权限的合理性说明已填写
- [ ] 可见性选择 Public
- [ ] 点击「提交审核」

### 英文语言支持（Featured 硬性要求）

- [ ] Store listing → Languages 已新增 English (United States)
- [ ] 英文 Name 已填写（Account Password Helper - Password Manager）
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
