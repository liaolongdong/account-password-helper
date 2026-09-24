# CWS 商店填写素材 — 复制粘贴用

> ✅ **已上架**：https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli
>
> 按 Developer Console 的页面顺序整理，逐项复制粘贴即可。后续版本更新时仅需重新上传 zip 包。

---

## 第一步：上传 zip 包

在 Dashboard 打开**已有商品** → 「商品包 / Package」→ **上传新的 ZIP 生成新草稿**（被拒的旧草稿已关闭，无法在原草稿上编辑）。上传以下文件：

```
.output/account-password-helper-3.9.0-chrome.zip
```

> 💡 zip 文件名中的版本号跟随 `package.json`（release-please 自动维护），上传时以 `.output/` 目录中最新构建产物为准。
>
> ⚠️ **2026-09-09：3.8.0 草稿被拒**，违规类型为 [Spam 政策 - 关键字堆砌](https://developer.chrome.com/webstore/program_policies#spam)，被点名的文本是 `Chrome, LastPass, Bitwarden, and 1Password (CSV/JSON formats`。**旧草稿已关闭，只能在 Dashboard 新建草稿重新提交**，不能在原草稿上改。
>
> 🚫 修正口径：**名称、摘要、说明、权限合理性说明、宣传图与 Featured 提名文案一律不得出现竞品品牌名**（Chrome / LastPass / Bitwarden / 1Password），一律改用「常见密码管理器的导出格式」这类描述性说法。下方第二步、第七步已据此改写，并在 `docs/CWS_PUBLISHING_GUIDE.md` 的提交前扫描中加入品牌名与重复度检查。
>
> 🔢 3.8.0 从未上架（线上仍是 3.7.0），但 `main` 已经 release-please 连续打过 v3.8.0、v3.9.0 两个标签，当前 `main` 的 `package.json` 是 **3.9.0**。要上传的包必须比线上版本号更高：把发布分支同步到 `main` 后 `pnpm build`，产物即 `account-password-helper-3.9.0-chrome.zip`。
>
> ⚠️ 实测坑（2026-09-10 记录，2026-09-12 复核仍成立）：本地工作区 `package.json` 停在 **3.7.0**，`pnpm build` 出来的是 `account-password-helper-3.7.0-chrome.zip`——**与商店线上已发布的版本号相同，Dashboard 会直接拒绝上传**。必须先把分支同步到 `main`（`package.json` 跟随到 3.9.0）再 `pnpm build`，用新产物上传。若 Dashboard 后续拒绝与已上传草稿同版本号，再到 `main` 上让 release-please 升一个 patch 版本后重新构建。

---

## 第二步：商店商品详情 (Store Listing)

### 名称 (Name) — 最多 45 字符

```
账号密码管理助手 - 本地加密密码管理器与自动填充及两步验证
```

> 📏 当前 **30 / 45 字符**。名称是商店搜索权重最高的字段，2026-09-12 之前的值只用了 20 字符，白丢 25 个字符额度。
>
> ➕ **2026-09-12 变更口径**：只在已多次过审的完整后缀「本地加密密码管理器」**后面追加一个高意图品类词「自动填充」**，不重排、不改写既有子串，商店对该短语已积累的精确匹配权重因此不受影响，新增词是唯一变量。仍是「品牌 - 描述」结构，**没有用逗号或顿号串关键词**（那才是摘要被判堆砌的形态）。
>
> ➕ **2026-09-12 七次修订**：按同一方式再追加第二个词「两步验证」，25 → 30 字符。选它的理由：这是与「自动填充」同量级的高意图检索词，且是本扩展相对自带密码管理器真正的分水岭（内置 TOTP + 登录第二步活码接力）。连接方式仍是**连词（与…及…）而不是顿号串**，读起来是一句完整的「本地加密密码管理器 + 带自动填充和两步验证」，不是清单。
>
> 🚧 **为什么停在 30、不把 45 用满**：再加第三个词（例如「…及两步验证和密码生成」，35 字符）在**结构上就已经变成四项并列的关键词串**——那正是摘要被判 keyword stuffing 的形态，而 Name 是权重最高、一旦被拒损失最大的字段。剩余 15 字符是**故意留的安全余量**，不是遗漏；若确要用满，见下方 🔻 的第二档回退路径（先进 35 字符版，被拒再退 30）。
>
> 🇬🇧 **英文 Name 补不到 45**：英文值是 `Account Password Helper - Password Manager`（42 / 45），只剩 **3 个字符**，任何有意义的品类词（`Autofill` 需 9、`& TOTP` 需 6）都放不进去；唯一能填满的做法是丢掉品类词「Password Manager」换成「Autofill」，等于用最高权重的品类词去换一个次级词，**不划算，故英文 Name 保持 42 / 45 不变**。
>
> ⚠️ 商店 Name 必须与 `public/_locales/zh_CN/messages.json` 的 `extensionName` 逐字一致——改一处必改另一处并 `pnpm build`，否则列表与包内 manifest 不符。
>
> 🔗 连带影响：`entrypoints/background/contextMenuManager.ts` 显式注册自己的右键菜单父项，正是因为扩展全名带副标题时直接用作父级会把二级菜单顶出屏幕（见 `docs/ARCHITECTURE.md`）。名称再长也不会退回那个坑——父项标题始终由我们自己控制。
>
> 🔻 **若名称本身被判堆砌，按两档逐级回退**：第一档删掉本次追加的「及两步验证」（含连接词），回到 `账号密码管理助手 - 本地加密密码管理器与自动填充`（25 字符）；若仍被拒，第二档再删「与自动填充」（含连接词），回到 `账号密码管理助手 - 本地加密密码管理器`（20 字符）——该值自 v3.6.0 起多次过审。每档只动一个词，保留已验证安全的部分，同时把「新增词」始终控制成唯一变量。

### 摘要 (Summary) — 最多 132 字符

```
开源免费的本地密码管理器：账号、密码与两步验证（TOTP 2FA）动态码以 AES-256-GCM 加密保存在你的浏览器里，不上传云端、无需注册；自动填充并一键登录，含密码强度检测、安全体检、密码生成器、显隐切换、多环境账号隔离、主流密码管理器迁移导入、中英双语
```

> ⚠️ 摘要必须与 `public/_locales/zh_CN/messages.json` 的 `extensionDescription` 逐字一致（当前 **131 字符**，manifest 描述受 132 字符硬限制，超限会导致 zip 上传失败）。英文摘要同步 `public/_locales/en/messages.json`（**130 字符**），见下方英文语言标签页字段。**改摘要必须同时改这两处粘贴块与两个 `_locales` 文件**，否则商店列表与包内 manifest 不一致。
>
> 🔄 「零联网 / 100% offline」的说法已替换为可核对的「不上传云端」——扩展每 6 小时会发起一次不携带用户数据的匿名版本检查（商店安装可访问时探测 Chrome 应用商店，否则回退 GitHub Releases API），旧表述并不成立。两个 `_locales` 文件已随本次改动更新，仍需 `pnpm build` 后重新上传商店包，线上商店列表才会与本地文档一致。
>
> 🚫 **2026-09-09 驳回修正（现行口径）**：旧摘要把「本地加密密码管理器 / AES-256-GCM / 一键登录（填充+勾选+点击）/ TOTP 两步验证 / 安全体检 / Chrome·Bitwarden·1Password 导入 / 密码生成器 / 无需注册」八组关键词用逗号串成一句，其中竞品品牌名被审核直接点名。新摘要**信息密度不降、句式变了**：主语谓语齐全，功能项挂在「含……」这个谓语下面而不是裸挂在句号后，品类词「密码管理器」按产品口径出现、竞品名零出现。`AES-256-GCM` 按用户要求写回摘要（准确的算法名，此前正文里不完整的「AES-256」已一并更正），`PBKDF2` 迭代次数这类参数仍只出现在【安全架构】正文。✅ 两步验证按用户要求写成 **「两步验证（TOTP 2FA）」**：中文侧真实检索词是「两步验证」，两个英文缩写各有搜索量，一份括号全装下，摘要 131 字符仍在 132 上限内。
> 🔻 **若因摘要再次被判堆砌，第一个要砍的就是结尾这串功能清单**：中文按「密码强度检测 → 安全体检 → 密码生成器 → 显隐切换 → 多环境账号隔离 → 迁移导入 → 中英双语」的逆序删，保留前 3～4 项即可回到 80 字符左右；说明正文里的对应条目不受影响，删摘要不丢覆盖。
>
> ✂️ **删减只针对违规本身，不针对篇幅（2026-09-10 二次修订）**：上一轮为过审把【为什么选择它】【适合谁】【安全架构】【常见问题】整体删掉，属于收缩过度——商店说明的上限是 16,000 字符，**篇幅本身不是违规项，同一句话在不同小节里抄两遍才是**。本轮按原结构全部恢复并逐条去重，每个卖点只在其归属小节展开一次：一键登录与多环境隔离归【为什么选择它】，会话有效期与自动锁定归【适合谁】，加密参数归【安全架构】，强度检测 / 显隐切换 / 导入兼容性归【功能全览】，联网 / 性能 / 权限等前文未覆盖的信息归【常见问题】。竞品品牌名仍然零出现，迁移能力统一写「主流密码管理器导出表格 / common password-manager exports」。
>
> 📌 **评审回填三条（2026-09-10 四次修订）**：① 【功能全览】的「导入与导出」补 **「也可勾选条目批量导出选中项」**（代码依据 `composables/usePasswordManagement.ts` 的 `batchExportSelected()`：按 `selectedIds` 过滤后走同一条导出路径——主密码校验 + 带日期后缀的 CSV 文件名）；② **「两步验证（TOTP）」回到【功能全览】独立成条**（扫码 / 上传图片添加密钥、RFC 6238 本地计算、不联网、活码就位可一键填入——依据 `utils/totp.ts`、`utils/qrScanner.ts`、`entrypoints/content/inlineDropdown/TotpHandoffCapsule.ts`），【为什么选择它】的对应条目同步瘦身为纯价值句（不必摸手机、不必切验证器、密码与动态码同条目），机制与价值分属两节、句子不重复；③ 【常见问题】回填 **「真的完全免费吗？」**（只讲付费相关事实：没有高级版、没有内购、没有升级弹窗，GPL-3.0 / 源码可审计仍只归【为什么选择它】）与 **「能从其他密码管理器导入吗？」**（只讲操作路径：原应用导出 CSV / JSON → 导入页上传，字段自动识别归【功能全览】、「整库一次导入」归【适合谁】）。说明长度随之变为中文 **2380** / 英文 **6961** 字符，仍在 16,000 上限内。

> 📌 **五次修订（2026-09-11，SEO/ASO 复核）**：① 逐条核对候选文案后**驳回三处与实现不符或不适用的表述**——「Ctrl+Shift+F 自动点击登录」（`entrypoints/background/quickFillHandler.ts` 的 `quick_fill` 硬编码 `autoLogin: false`，快捷键只做填充与勾选，点击登录由侧边栏「填充并登录」或偏好设置「自动触发登录」触发）、「EFF 助记词组」（内置词库为 `utils/data/passphrase-words.json` 的 3,080 词，`docs/THIRD-PARTY-NOTICES.md` 记录上游来源未记录，**并非 EFF 词表**）、「五维检测」（自检脚本禁词；实现是 4 个计分维度 +「未开启两步验证」只列示不计分）；【适合谁】的「一次按键完成登录」同步改为不指定触发方式的「一键完成登录」。② **回填六处代码里确有、商店说明漏写的事实**——【安全架构】补「密文只写入 local / session、从不使用会随浏览器账号同步的 sync 存储」与「更改主密码时原子重加密，不留半加密数据」（依据 `README.md` 的 storage 权限说明与「re-keys atomically without data loss」）；【功能全览】补「密码生成器可排除易混淆字符」「TOTP 支持自定义算法（SHA1/256/512）与位数（6~8）」「主密码输入框实时提示大写锁定」（依据 `utils/passphraseGenerator.ts`、`docs/ARCHITECTURE.md` 的 TOTP 章节、`composables/useCapsLockDetection.ts`）；【常见问题】补「换电脑或重装浏览器后数据还在吗」（只讲 .aph 备份还原路径，与【安全架构】的存储 API 口径不重复）。③ 检索词层面把「多环境账号隔离」「保存密码」写回正文（原为口语化表述）。竞品品牌名、绝对化表述、跨小节重复三项按自检脚本仍为零。说明长度变为中文 **2634** / 英文 **7743** 字符。

> 📌 **六次修订（2026-09-12，曝光与口径复核）**：① **中文 Name 补满额度**：追加「与自动填充」，20 → 25 字符（上限 45），英文 Name 不动；回退方法见「名称」小节。② **修掉最后一处快捷键过度声称**：【为什么选择它】首条原写「快捷键 `Ctrl+Shift+F` 有意只做填充与勾选」，暗示永不提交——`entrypoints/content/FormDetector.ts` 的判断是 `data.autoLogin || floatingButtonConfig.autoTriggerLogin`，也就是**开着「自动触发登录」时 `Ctrl+Shift+F` 确实会连登录一起点**，故改为「默认只做填充与勾选，只有开启该偏好后它才代为提交」的条件式表述（说明开头那句「并按你的设置自动点击登录按钮」本已是条件式，未改）；【第七步】Featured 提名中英文同条一并订正，演示 GIF 的分镜同步改掉「再手动点击」。③ **三处无法自证的绝对表述改为可核对写法**：泄露字典不写整数「1000」而写「近千条」（`utils/data/top1000.json` 实测 989 条去重明文）；侧边栏速度不再承诺「都保持 1 秒内打开」，改写为「按 1 秒内出界面来优化」并保留缓存快路径 20-50ms 限定词（该限定词是口径表硬性要求，英文侧用 en-dash）；浏览器版本一问用 **Chromium 114** 指代 Side Panel API 门槛，避开品牌名禁词表里的 `Chrome`。④ **回填九处代码里确有、说明漏写的事实**，全部只归一个 owning 小节：【功能全览】新增「页面悬浮填充按钮」（可拖拽 + 边缘吸附 + 透明度 10%~~100%，依据 `entrypoints/content/floatingButtons/DragHandler.ts` 的 `snapToEdge()` 与 `settingsPanelView.ts`）、「键盘完成全流程」（↑/↓ + Enter + Ctrl+C 复制账号 + Esc，依据 `entrypoints/sidepanel/App.vue` 的 `handleKeydown`；注意 **没有** Ctrl+Shift+C 复制密码，那行代码是注释掉的占位）、「工具栏 Popup 操作中枢」（剩余时间常驻 + 临期变色，依据 `entrypoints/popup/App.vue` 与 `composables/useSessionCountdown.ts`）；【功能全览】既有条目补数值——右键「生成并填充强密码」不读凭证因此锁定时可用（`contextMenuManager.ts` 的 `action !== 'generate'` 门控豁免）、历史快照默认 3 份可调 1~~10（`utils/storage/passwordHistory.ts`）、标签每条最多 3 个（`usePasswordManagement.ts` 的 `MAX_TAG_COUNT` / `MAX_TAG_LENGTH`）、收藏上限默认 10 可调 1~~50 且按 LRU 让位（`autoSaveManager.ts` 的 `evictLRUFavoriteIfNeeded`）、TOTP 位数改为离散值 6 / 7 / 8（`utils/totp.ts:110` 只认这三个值，旧的「6~~8」暗示区间连续，不准确）；【安全架构】补剪贴板清理可选 10 / 15 / 60 / 120 秒（`ClipboardSettingDialog.vue`），【适合谁】的会话口径改为「9 档可选」并只保留**两个**独立开关（`idleLockMinutes`、`relockOnBrowserRestart`；系统锁屏跟随闲置检测同一条路径触发，不是第三个开关，初稿写「逐项开合」已更正）。⑤ 【常见问题】补两条排障问答：浏览器版本要求、以及「填充没生效请先刷新标签页」（`quickFillHandler.ts` 的 `PING` 探活与 `bg.quickFill.pageNotReady`，跨域 frame 不下发凭证）。自检结果：`paste blocks: 6 | banned hits: none`、中英说明 `duplicate lines: none`、四个 `_locales` 值与粘贴块逐字一致；说明长度变为中文 **3293** / 英文 **9504** 字符（上限 16,000）。
>
> 📌 **七次修订（2026-09-12，额度补满 + 事实回填）**：本轮先做**减法核验**（把说明里每一句对回代码）再做**加法回填**（只补代码里确有、说明漏写、且归属小节尚无同义句的事实），中英文同步改写。
>
> ➕ **① 中文 Name 再补一个词**：追加「及两步验证」，25 → 30 字符（上限 45），依旧只用连词（与…及…）接在已获批后缀之后，不重排、不改写既有子串、不用顿号串。**停在 30 而不冲 45** 是刻意的：第三个并列词在结构上就成了关键词串，而 Name 是被判堆砌时损失最大的字段；剩余 15 字符是安全余量，两档回退路径见「名称」小节。**英文 Name 未动**：42 / 45 只剩 3 个字符，`Autofill`（9）/ `& TOTP`（6）都放不进，唯一能填满的写法是丢掉品类词 `Password Manager`，得不偿失。
>
> ✏️ **② 修掉三处与代码不符的表述（这是本轮真正的过审风险点，全部在商店元数据里）**：(a)【功能全览】原写四个快捷键「均可在扩展的快捷键页自定义」——**本扩展没有改键页**：`components/options/ShortcutSettingDialog.vue:80-86` 是只读的「快捷键一览」弹窗，文件注释明确 Chrome 的 `commands` API 只提供 `getAll()` / `onCommand`，不存在 `commands.update()`（那是 Firefox 的 `browser.commands.update()`，见 `utils/shortcutCommands.ts:8-10`），四个命令槽在 `wxt.config.ts:118` 已全部占用；`README.md:201` 与 `utils/i18n/locales/zh-CN/options.json` 的口径都是「无法在插件内改键」——商店文案与产品内文案自相矛盾，故改为「改键请到浏览器的『扩展程序快捷键』设置页操作」，英文侧同条 `customizable shortcuts` 一并订正（【第七步】Featured 提名文案的 `chrome://extensions/shortcuts` 写法本来就是对的，无需动）。(b)【常见问题】原写版本检查「只读取扩展自身的版本号」——**低估了自己的联网面**：`utils/updateChecker.ts:71-98` 先向商店首页发 `no-cors` 的 `HEAD` 探测可达性并把结果缓存 24 小时（`CWS_CACHE_TTL_MS` 在 `:27`），不可达时才 `fetch` GitHub Releases API，读取 `tag_name` 与**最多 200 字的 `body`**（截断在 `:135`）；自身版本号来自 `chrome.runtime.getManifest().version`（`:172`），根本不需要联网。改为按实际两步行为描述，并补「断网时静默失败」。(c)【常见问题】原写权限「只围绕这几件事：检测并填充登录表单、复制密码、读取本地缓存图标」——与 manifest 声明的 12 项权限（`wxt.config.ts:93-108`）+ `host_permissions: ['<all_urls>']`（`:109`）明显不对齐，且**回避了审核最盯的那一项**；改为把「访问所有网站」摆到台面并说明必要性，其余按职责分组（含 `alarms` 的会话检查 / 回收站清理 / 备份提醒）。
>
> 🔍 **③ 两处偏强表述按代码改为可核对口径**：(a)【功能全览】TOTP 原写 otpauth 的参数「会被一并识别」——`utils/totp.ts:113`（`digitsRaw === 7 || digitsRaw === 8 ? digitsRaw : DEFAULT_DIGITS`）、`:116`（周期非正数即回落 30）、`normalizeAlgorithm`（`:78-88`，非 SHA256/SHA512 一律按 SHA-1）实际是**静默回落**，且 `:107` 的 `url.host !== 'totp'` 直接 `return null` 说明**计数器型 HOTP 不支持**，而这正是用户会踩的预期差；改写为「认哪些值 / 没写时按什么处理 / HOTP 不在范围内」。(b)【安全架构】原写「闲置超时、系统锁屏或浏览器重启（可选）后自动锁定」读起来像出厂即锁——`utils/storage/configManager.ts:287-291` 默认 `idleLockMinutes: 0`、`relockOnBrowserRestart: false`，`components/options/IdleLockSetting.vue:21-39` 第一档就是「不启用」；现补上四档时长（5 / 10 / 30 / 60 分钟）与**两个开关默认都关**，并保留系统锁屏走同一条闲置检测路径的口径。另把【常见问题】「忘记主密码」补上界面上那个「重置」入口到底做什么（`composables/useAuthFlow.ts:310-328` → `clearAllData()`，清空全部数据而非找回密码），避免审核拿按钮对撞文案。
>
> ➕ **④ 回填十四处代码里确有、说明漏写的事实**，每条只落一个 owning 小节：【安全架构】新增「校验值与解密密钥两条派生路径 + 盐值域分离 + 恒定时间比对」（`utils/encryption.ts:107-116` 的 `'aph-verify|' + salt` 前缀与 `deriveBits(256)`，比对走 `utils/crypto-light.ts:46` 的 `timingSafeEqual`，调用点 `utils/storage/masterPassword.ts:92`）、把「五类敏感内容加密」升级为**逐字段、每次保存都新生成 12 字节随机 IV、同明文两次密文不同**（`utils/encryption.ts:149-157`）、新增「.aph 每次导出换随机盐与 IV」（`utils/backupExport.ts:10-13,71,80-84`，`SALT_LENGTH = 16`）、新增「第二步接力只交当次码与有效期、密钥留在后台上下文、标记同站点 3 分钟失效」（`entrypoints/background/passwordCache.ts:596` 的 `PENDING_TOTP_TTL_MS` 与 `:688` 的 `pending.hostname !== hostname` 判断）；【功能全览】给自动保存补「密码已变→自动转『更新』并沿用原标签备注、库内已同一份凭据则完全静默」（`entrypoints/content/LoginAutoSave.ts:505-524`）、新增「只勾得分最高的那一个复选框、订阅/推送/通知/广告/营销字样降权」（`entrypoints/content/CheckboxHandler.ts:34-36` 只取一个 + `:81-90` 正向 +50 / 负向 −30 + `formSelectors.ts:309-323` 负向词表；措辞停在**降权**，代码没有排除阈值，写「绝不勾营销框」就是下一次驳回）、体检补**四维按占比扣分的权重 35/25/20/20 与 90/180/365 天三档**（`utils/passwordHealth.ts:26,34`，`computeSecurityScore` 见 `:236-243`）、生成器补**6~50 位默认 16、每种启用字符集至少各一次再 Fisher-Yates 打乱**与**助记词 3~~8 词 / 追加 1~~4 位数字 / 五种分隔符 / 3,080 词库**（`utils/passwordGenerator.ts:26,50-53,112-128`、`utils/passphraseGenerator.ts:34-61,72`）、新增「密码更换提醒 7 / 30 / 90 天、每 12 小时核对、每条只通知一次」（`components/options/PasswordHealthDialog.vue:304-310`、`utils/storage/reminderManager.ts:56-69`、`backgroundServices.ts:62` 的 `12 * 60`）、导入补 **UTF-8 无结果自动回落 GBK**（`utils/excelCsv.ts:23-41`）、回收站补**彻底删除连带清掉历史快照与到期提醒**（`utils/storage/trashManager.ts:147-162`）、搜索补**同时匹配用户名/标签/备注/网址并高亮命中片段**（`utils/passwordFilter.ts:105`）；【常见问题】新增「更新不会改动存量安装的填充默认值」（`entrypoints/background.ts:42-44` 仅在 `reason === 'update'` 调 `freezeLegacyFillDefaults()`，实现见 `utils/storage/configManager.ts:200-214`）与「邮箱备份只下载到本机、只唤起你自己的邮件客户端、扩展不具备发信能力，提醒周期 1 / 3 / 7 / 14 / 30 天」（`utils/emailBackup.ts:28-44` 全文件无 `fetch`、`components/options/EmailBackupDialog.vue:143-149`、`backgroundServices.ts:285`）。
>
> ✂️ **⑤ 为守住「一个卖点只归一个小节」而做的两处改写（不是删内容）**：锁机制归【安全架构】、更换提醒机制归【功能全览】之后，【适合谁】的「隐私敏感用户」与「日常登录用户」两条原句是在**复述**这两处的事实，已改成本节独有的受众视角（会话 9 档＝你愿意多久重输一次主密码；生成器＝不必为每个站点想一套还记得住的记法）；中英文同改。
>
> 🔎 **⑥ 明确避开三个查证后判定不适用的写法**：待确认登录凭据寄存在 `sessionStorage` 的实现是 **XOR + base64 密文**（`utils/pendingCredentialCodec.ts`；内容脚本在 `http://` 页面拿不到 `crypto.subtle`，因此不是 AES），因此**不写**「待确认凭据以加密形式暂存」；`utils/passwordGenerator.ts:72-76` 的 `secureRandomInt` 取模未做 rejection sampling，**不写**「无偏」；词库出处只到「内置 3,080 词英文词库」，**不写** EFF / Diceware 词表。
>
> ➕ **2026-09-14 证据变更（结论不变）**：本条原引 `entrypoints/content/LoginAutoSave.ts:37-58`「密钥与密文同处」作为不写「加密暂存」的理由之一；v3.10 已把密钥收进 `chrome.storage.session`（后台按 tab + origin 签发，页面与内容脚本均不可读），旧引用连同那段实现一并移除。结论仍然成立，但依据换成**页面侧仍只有 XOR 密文**这一点——「暂存」这件事本身已不可被页面脚本一步还原，但 XOR 也不足以支撑「加密」这个词，所以商店文案照旧不写。
>
> 另在本轮顺手校正了 **4 处与代码不符的旧表述**（落在 `docs/` 与 `README` / 侧边栏帮助词条 / `llms.txt` 等对外表面，属**事实纠错而非文案扩写**，**未据此回填任何商店文案**）：
>
> - **本地开发域名**：`docs/ARCHITECTURE.md:369`（含 `ARCHITECTURE.en.md:208`）、`README.md:113` / `README.en.md:113`、`utils/i18n/locales/{zh-CN,en}/help.json` 的 `help.gb.4`、`llms.txt` 「Multi-environment isolation」条、`utils/domain.ts` `isLocalDevDomain` 的 JSDoc 一致写着「localhost / 127.0.0.1 默认匹配全部」，实际按 `matchesPortForLocalDev`（`utils/domain.ts:237-245`，`tests/utils/passwordFilter.test.ts:43-52` 守卫）**过端口**——页面不带端口时才放开全部。
> - **会话检查器**：`docs/ARCHITECTURE.md:281`（含 `ARCHITECTURE.en.md:120`）写「每分钟检查 + 可见性变化触发」，60 秒定时器确实存在（`utils/sessionManager.ts:37,48`），但只在 **Options 页**启动、只在「有效 → 无效」跳变时触发，可见性重检属于 `composables/useStorageWatcher.ts:76-80` 而非 SessionManager；本文「会话生命周期」:77 一直是准确的，:281 现与其一致。
> - **匹配规则旧注释**：`entrypoints/background/passwordCache.ts:493` 仍描述 2026-07 之前的「域名与 url 双向包含」模糊匹配，与同函数 25 行下的准确注释矛盾，已改为精确 host + 本地按端口。
> - **Chrome 版本门槛**：`entrypoints/background/optionsPageManager.ts:62` 注释称「manifest 已声明 minimum_chrome_version，Chrome < 116 理论不可达」，实际 `wxt.config.ts:92` 该行是**注释掉的**（`docs/CONTRIBUTING.md:99` 记录的是正确口径），该降级分支是可达的兜底路径。
> - **未改动**：`docs/blog/**`、`blog/*.html`、`docs/公众号-*.md`、`docs/微博-*.md` 里同样的「localhost 放行全部」写法属**已发布内容**，改动需重发并回改 `pnpm gen:blog` 相关计数，留待单独决策，不在本轮范围内。
>
> ✅ **自检结果（本轮）**：`paste blocks: 6 | banned hits: none`；中英说明**跨小节近似重复句为零**（difflib 阈值 0.72 全对扫描）；四个 `_locales` 值与粘贴块逐字一致。说明长度中文 **3293 → 4638** / 英文 **9504 → 13870** 字符（上限 16,000；**英文侧余量已收窄到约 2,100 字符**，后续再回填须优先动中文或先删已有内容）。**注意**：中文说明里 3,080 词、GBK 回落等新增事实目前只在商店文案，若要让 README / 官网与之一致，另按 `docs/CWS_PUBLISHING_GUIDE.md`「其他同步约定」评估范围。

> 🪪 **八次修订（2026-09-16，身份信息库上线）**：新增「身份信息库」功能后，在【安全架构】【功能全览】【常见问题】与「storage」权限说明各补一句**事实描述**（整块 AES-256-GCM 加密、默认掩码、主密码复验、.aphid 加密备份、不随浏览器账号同步），中英文同步——**只陈述事实，不新增任何营销卖点**，身份库也不改变「本地优先 / 不收集用户数据」的既有口径。名称与摘要**未动**（新能力不进 45 字符名称与 132 字符摘要，避免又踩 keyword stuffing）。说明长度中文 **4638 → 4895** / 英文 **13870 → 14636** 字符（上限 16,000，英文侧余量约 1,400 字符）。

> 🪪 **九次修订（2026-09-17，身份库导出增强）**：身份库新增「勾选导出子集」与「可选明文 .json 导出/导入（未加密、读写均需主密码复验 + 风险二次确认；导入按 `id` 合并、与加密备份复用同一份结构校验）」。仅改写【功能全览】的身份库一行（中英同步），如实标注明文文件为未加密、可再导入，加密备份（.aphid）仍为长期留存的首选路径。**不新增营销卖点**；明文导出/导入与已获批的密码明文 CSV/JSON 导出同类（均为本地读写、不上传），**Data Safety 口径不变**（仍无任何用户数据传输，FAQ「不离开设备 / 不上传」表述依旧成立）。名称与摘要**未动**。说明长度 中文 **4895 → 4951** / 英文 **14636 → 14830** 字符（英文侧余量约 1,170 字符，后续回填须优先动中文）。

> 🧩 **十次修订（2026-09-22，三项已上线能力回灌说明正文）**：把「跨子域名匹配三档」「站点规则（自定义填充选择器 + Shadow DOM 穿透）」写进【为什么选择它】与【功能全览】，把「管理页 `Ctrl/Cmd+K` 命令面板（23 条命令）」并入既有「界面与快捷键」一行——三处**只陈述已实现的事实**，每个卖点仍只有一个小节承载，未新增任何营销口号，也未重复【安全架构】里的既有口径。名称与摘要**未动**（45 / 132 字符额度是 3.8.0 keyword stuffing 驳回后的既定预算，新能力一律不进）。说明长度 中文 **4951 → 5315** / 英文 **14830 → 15622** 字符（上限 16,000）。⚠️ **英文侧余量只剩约 378 字符**：英文三项新增已按「预算优先」压缩过（站点规则一条从 700 字符砍到 434、跨子域只留一句从句），下一次回填**只能动中文**，或先删英文已有内容。自检：`paste blocks: 6 | banned hits: none`，中英说明跨小节重复行均为零。

> 🧭 **十一修订（2026-09-22，内联下拉与侧边栏口径对齐）**：把「页内迷你面板与侧边栏同一套键盘流程、打开即默认选中首条、回车即填」并入【功能全览】既有的「键盘完成全流程」一行，把「面板搜索与管理页 / 侧边栏同一口径（账号 / 标签 / 备注 / 网址，认拼音全拼与首字母）」与「本站无匹配时把关键词交给管理页做全库搜索」并入【第七步】使用情形示例第 4 条——两处都挂在已有小节的已有行上，不新增卖点、不新增条目、不与【智能搜索与整理】重复成句。输入法合成期不接管按键这一实现细节**不写进商店说明**（属防御性行为而非检索词，见 `docs/ARCHITECTURE.md` 第 17 节与侧边栏帮助词条）。名称与摘要**未动**。说明长度 中文 **5315 → 5344** / 英文 **15622 → 15739** 字符（上限 16,000）。⚠️ 承接十次修订的预算提醒：本轮英文仍不得不 +117，**英文侧余量只剩约 261 字符**，下一次回填英文前须先删英文已有内容。自检：`paste blocks: 6 | banned hits: none`，中英说明跨小节重复行均为零。

> 🏗️ **十二修订（2026-09-24，容量上限与列表分页回灌中文说明）**：本轮**只动中文**，两处新增都挂在已有小节的已有行上，不新增小节、不加营销口号。① 【功能全览】的「智能搜索与整理」末尾并入**管理页分页**（每页 50 / 100 / 200 条、默认 100 条，一次只画当前这一页；搜索 / 排序 / 导出作用的仍是全部命中条目，跨页勾选保留）——依据 `utils/vaultPagination.ts` 的 `PAGE_SIZE_OPTIONS` / `DEFAULT_PAGE_SIZE` 与 `tests/utils/vaultPagination.test.ts`；刻意**不写**「表头全选只勾当前页」这类操作手册级细节（由 README 常见问题与侧边栏帮助词条承载），商店说明只承担「分页不会让你少处理任何一条」这个卖点。② 【常见问题】新增一条**条目总量上限 2000 条**的问答，逐项列明被拒绝的五个写入口（新增 / 创建副本 / 导入 / 网页自动保存 / 回收站恢复）与「不会静默覆盖或删除已保存数据」，并写明导入超量时预览页的「还能导入多少条 / 将被忽略多少条」口径——依据 `utils/storage/vaultCapacity.ts` 的 `MAX_PASSWORD_ENTRIES`、`assertWithinCapacity()` 在 `passwordCrud.ts` / `trashManager.ts` 写路径之前的调用、五处 `options.capacity.*Blocked` 与 `bg.autoSave.capacityReached` 文案。**回收站不占额度**按 `passwordCrud.ts` 的实际计数来源（列表长度）如实写明，这条同时是「删除即释放额度」的可执行提示。上限本身是既有事实、此前只在 README 与 `docs/ARCHITECTURE.md`，商店侧为首次披露。名称与摘要**未动**（45 / 132 字符额度是 3.8.0 keyword stuffing 驳回后的既定预算）。说明长度 中文 **5344 → 5560** / 英文 **15739（未动）** 字符（上限 16,000）。⚠️ **英文本轮未回填**：按十一修订的记录，英文侧余量只剩约 261 字符，而这两条中文新增（+216 字符）翻成同等信息量的英文按字符密度估算约需 450~520 字符，**放不进去**；下一轮若要动英文，必须先删英文已有内容，否则就是拿中英说明口径不一致去换预算。自检：`paste blocks: 6 | banned hits: none`，中英说明跨小节重复行均为零；四个 `_locales` 值与粘贴块逐字一致。

### 说明 (Description) — 最多 16,000 字符

```

账号密码管理助手是一款本地优先的密码管理器：账号、密码和两步验证码加密保存在你自己的浏览器里，不需要注册账号，也没有云端同步。打开登录页时，它可以自动填充账号和密码、勾选「记住我」，并按你的设置自动点击登录按钮。

【为什么选择它】
◆ 不只填充，还替你完成登录：在侧边栏选中条目点「填充并登录」即可一步走完填充、勾选与提交；快捷键 Ctrl+Shift+F 默认只做填充与勾选，只有你在偏好设置中开启「自动触发登录」后它才代为提交表单，不会背着你按下登录
◆ 多环境账号隔离：条目默认按精确域名匹配，开发、测试、预发、生产各留各的凭证——同时跑多环境的人最需要这条；一个账号确实要覆盖整站子域时，可在管理页头部切成「精确 + 通配条目」或「同主域名」两档按需放宽
◆ 验证码和密码存在同一处：不用在登录途中去摸手机、切换验证器应用——一个条目里既有密码也有动态码
◆ 免费、开源、无订阅：GPL-3.0 协议，源码可审计，全部功能不设付费墙

【适合谁】
· 开发者：本地、测试、预发、生产域名分开管理，凭据默认按站点精确命中，不用再靠备注区分环境
· 测试工程师：批量导入用例账号，跨环境切换时一键完成登录，误删可回收，改错的密码能回滚
· 隐私敏感用户：会话有效期从 1 小时到 7 天共 9 档，按你愿意多久重输一次主密码来定
· 日常登录用户：登录时自动保存新账号，需要新密码时一键生成，不必再为每个站点想一套还记得住的记法
· 正在搬家的人：从其他密码管理器换过来时整库一次导入，不用逐条手动录入

【怎么使用】
1. 安装后点击工具栏图标，打开侧边栏
2. 首次使用设置一个主密码（至少 8 位，需同时包含字母、数字和符号），全部数据都以它加密
3. 在登录页让扩展捕捉账号，或到密码管理页手动添加、批量导入
4. 之后在任意登录页用侧边栏、输入框钥匙图标、右键菜单或快捷键完成填充

【安全架构】
· 主密码经 PBKDF2（600,000 次迭代）派生 256-bit 密钥，全部密码学运算使用浏览器原生 Web Crypto API
· 派生解密密钥与派生解锁校验值走两条相互独立的路径（校验值派生前对盐值做了域分离），存在本机的校验值推不出解密密钥；解锁时的比对是常量时间比较，不会因为逐个字符比对而提前返回
· 账号、密码、网址、备注和两步验证码五类敏感内容分别以 AES-256-GCM 认证加密后才写入本地存储，每个字段、每次保存都现场生成新的随机初始化向量，因此同一条密码两次加密得到的密文并不相同；会话过期即回到密文状态
· 密文只写入浏览器本地存储（持久化的 local 与仅内存的 session），不使用会随浏览器账号同步的 sync 存储，数据不会因为你登录了浏览器账号而离开这台设备
· 更改主密码时对全部条目原子重加密：要么整体完成，要么保持原状，不会留下半加密的数据
· 加密备份文件（.aph）每次导出都换用新的随机盐与新的初始化向量，两个备份之间不共用密钥材料
· 身份信息（姓名、证件号、手机号、邮箱、住址、银行卡信息与自定义字段）单独成库，整块以 AES-256-GCM 认证加密后写入本地存储，默认掩码显示，查看与复制都需再次验证主密码
· 登录第二步的动态码接力只把当次验证码和它的有效期交给页面，生成验证码所需的密钥始终留在扩展自己的后台上下文中；这份接力标记只对同一站点有效，三分钟后自动失效
· 闲置达到设定时长（5 / 10 / 30 / 60 分钟四档）时自动锁定，系统锁屏走同一条闲置检测路径；浏览器重启后锁定是另一个独立开关。两者默认都不启用，需要你主动打开——锁定后要重新输入主密码，而主密码本身不会被保存，遗忘后无法找回
· 复制密码后按设定的秒数自动清理剪贴板（默认 30 秒，另有 10 / 15 / 60 / 120 秒可选），清理前会先比对内容，不会误清你随后复制的内容；万一页面失去焦点读不到剪贴板，就直接覆写——宁可误清一次，也不把密码留在剪贴板上
· 安全体检、密码生成器与泄露密码字典比对全部在设备端完成，不读取网络

【功能全览】
· 四种填充入口：输入框获得焦点后出现的钥匙图标、侧边栏、输入框右键菜单、快捷键；登录框位于页面框架内时同样可以填充
· 填不进的页面有兜底：登录框渲染在自定义组件里、自动检测取不到输入框时，可在管理页「站点规则」为该域名手写账号框与密码框的 CSS 选择器（规则域名需与登录页域名完全一致，不支持通配）；每条规则自带「Shadow DOM 穿透」开关，默认开启、只作用于开放的影子根（封闭的影子根任何扩展都读不到），关掉则只在主文档内匹配。规则可导出为 JSON 文件备份或分享给团队，导入时按域名合并并回报新增、更新与忽略的条数，上限 500 条规则、单文件 2 MiB——文件里只有域名与选择器，不含账号与密码
· 登录时自动保存密码：提交登录时弹窗确认，自动去重，可设置域名黑白名单与「不再提示」；密码偏弱或已被多个账号使用时，会在同一弹窗中提醒；同一账号再次登录而密码已经改过时，弹窗自动转为「更新」并沿用这条记录原有的标签与备注，库里本来就是同一份凭据时则完全不再打扰
· 只勾该勾的那一个复选框：页面上往往有好几个复选框，它按标签文字和复选框到账号/密码框的距离打分，只选中得分最高的那一个，标签里带「订阅 / 推送 / 通知 / 广告 / 营销」字样的会被降权
· 密码安全体检：给出 0 到 100 分的综合评分，四类问题按受影响条目占比扣分——密码复用 35、弱密码 25、命中内置近千条常见泄露密码 20、长期未更新 20，其中长期未更新再按 90 / 180 / 365 天分三档；未开启两步验证的条目会单独列出来，但不计入扣分
· 密码生成器：随机密码长度 6~50 位可选（默认 16 位），启用的每种字符集保证至少各出现一次再整体打乱，并可排除 0/O、1/l 一类易混淆字符；助记词模式取 3~8 个单词（词库是内置的 3,080 个英文单词），可追加 1~4 位数字，分隔符有五种选择、也可以不加；也能在输入框右键直接「生成并填充强密码」，这一步不读取任何已存凭证，会话锁定时同样可用
· 密码强度检测：按长度、字母、数字、符号四条规则评为弱 / 中 / 强，在添加、编辑和登录保存时同步给出
· 密码可见性切换：在页面密码框内加入显示或隐藏按钮（默认关闭，在偏好设置中开启），填充后一眼确认输入内容
· 两步验证（TOTP 2FA）：扫描网页二维码或上传图片即可添加密钥，动态码按 RFC 6238 在你设备上生成，不联网、不上传；标准 otpauth:// 链接里带的参数会被读出来——算法认 SHA1 / SHA256 / SHA512，位数认 6 / 7 / 8，周期认自定义秒数，链接里没写的按 6 位 / SHA1 / 30 秒处理，只支持按时间滚动的动态码（计数器型 HOTP 不在范围内）；列表与侧边栏同屏显示活码和倒计时环，登录走到第二步时活码就近出现，可一键填入
· 密码更换提醒：单个条目可设 7 / 30 / 90 天之后提醒，后台每 12 小时核对一次到期项并发桌面通知，同一条到期只会通知一次
· 导入与导出：支持 CSV 和 JSON，可整库导出，也可勾选条目批量导出选中项；自动识别主流密码管理器导出表格的字段（含两步验证密钥列）；CSV 按 UTF-8 读不出内容时会自动改用 GBK 再试一次，兼容中文表格软件导出的文件；另有 .aph 加密备份与邮箱备份提醒
· 回收站与修改历史：删除的条目进回收站保留 30 天可恢复，每条密码默认留存 3 份加密历史快照（可调 1~10 份）以便回滚；在回收站里彻底删除某条时，它名下的历史快照与到期提醒会一并清掉
· 侧边栏快速添加与只读详情：顶栏「+」就地添加当前站点并预填网址，主密码输入框实时提示大写锁定；每行「查看详情」以抽屉展示完整备注、活码与修改历史，无需进入编辑态
· 页面悬浮填充按钮：出现在登录页上，可拖到任意位置并自动吸附屏幕边缘，透明度 10%~100% 可调；浮层自带设置面板，不用切回管理页就能就地调整
· 键盘完成全流程：侧边栏内上下键选条目、回车填充、Ctrl+C 复制账号、Esc 收起，手不离键盘也能登录；页内迷你面板同一套键盘流程，打开即默认选中首条、回车即填
· 工具栏 Popup 操作中枢：管理页、侧边栏、直接填充、锁定会话都在同一屏，剩余有效时间常驻显示并在临近过期时变色提醒
· 智能搜索与整理：模糊搜索同时匹配用户名、标签、备注和网址，认拼音全拼与首字母，命中片段高亮显示；另有侧边栏「本站 / 全站」范围切换、每条最多 3 个标签的分类与筛选、收藏置顶（上限默认 10 个、可调 1~50，超出时按最少使用自动让位）、一键去重、批量管理；管理页列表按页呈现（每页 50 / 100 / 200 条、默认 100 条），搜索、排序与导出作用的仍是全部命中条目，跨页勾选也会被保留
· 身份信息库：独立的个人信息收藏夹，存放姓名、证件号、手机号、邮箱、住址、银行卡信息与自定义字段，默认掩码、查看需主密码复验；支持加密备份（.aphid）导出导入与勾选导出子集，并可按需导出/导入未加密的明文 .json（需主密码复验与风险确认，导入按 id 合并）；不参与自动备份，请定期手动导出加密备份
· 界面与快捷键：6 款色彩主题、中英文界面即时切换；四个默认按键为 Ctrl+Shift+P 管理页 / L 侧边栏 / F 快速填充 / K 内联下拉，改键请到浏览器的「扩展程序快捷键」设置页操作；管理页另有 Ctrl/Cmd+K 唤起的命令面板，用中文、拼音或首字母检索并直达 23 条常用命令，主密码未验证时不响应按键

【常见问题】
· 真的完全免费吗？是。没有高级版、没有内购，也不会有劝你升级的弹窗
· 密码会被上传到云端吗？不会。扩展没有自己的服务器。唯一主动发起的联网是每 6 小时一次的更新检查：先向商店探测一次网络可达性（结果在本机缓存 24 小时），探测不到时才去公开的发布接口读取最新版本号与不超过 200 字的更新说明；这两类请求都不携带任何账号、标识符或库内数据，断网时检查静默失败，其余功能照常可用
· 身份信息（证件号、银行卡号等）会被上传或同步吗？不会。它们和密码一样只加密保存在本机，不随浏览器账号同步，也不会离开这台设备
· 忘记主密码怎么办？找不回来，也没有任何人能替你把它还原成可读的形式。应用内确实有一个「重置」入口，但它做的是清空全部数据、把扩展恢复到刚装好的样子，旧密码不会因此出现。请定期用加密备份导出，别让一次遗忘赔上整个库
· 能从其他密码管理器导入吗？可以：在原来用的应用里导出 CSV 或 JSON，再到扩展的导入页上传即可
· 密码库能存多少条？上限 2000 条，按列表条目数计数，回收站里的条目不占额度。达到上限后新增、创建副本、导入、网页自动保存与回收站恢复都会明确提示被拒绝，不会静默覆盖或删除已经保存的数据；导入量超出剩余额度时，预览页会先写明还能导入多少条、将被忽略多少条，由你选择只导入前若干条或取消
· 更新到新版本会改掉我调好的设置吗？不会。新版本调整过的默认值只作用在新安装上，已经在用的安装会冻结住它当前的填充方式，不会被静默改动
· 会自动往我的邮箱发东西吗？不会。所谓邮箱备份只是把表格下载到你自己这台电脑，然后唤起你已装好的邮件客户端、由你决定发不发；扩展自身不发邮件，也不具备发邮件的能力。备份提醒的周期可设 1 / 3 / 7 / 14 / 30 天，到点只发一条桌面通知
· 换电脑或重装浏览器后数据还在吗？不会自动跟过去。请在原设备用加密备份导出 .aph 文件，到新设备的导入页还原
· 会拖慢网页或加载页面吗？侧边栏的打开速度是本项目长期盯住的调优目标：冷启动、会话失效、浏览器快速重启等场景都按 1 秒内出界面来优化，会话有效时走缓存快路径，数据在约 20-50ms 内返回；注入页面的浮层使用隔离的 Shadow DOM，不改变宿主页面样式
· 对浏览器版本有要求吗？侧边栏用到 Chromium 114 及以上的 Side Panel API；扩展没有声明最低版本限制，因此更旧的内核浏览器同样能安装使用管理页、Popup、右键填充与密码生成器，只是没有侧边栏
· 填充没生效怎么办？扩展更新或重新加载后，此前已打开的标签页需要刷新一次才能收到填充脚本，这种情况下页面内会有提示、同时发出桌面通知；出于安全限制，只有与页面同主域名的框架会被下发凭证
· 有没有广告、统计或埋点？没有，也不读你的浏览记录。为了让它能出现在你打开的任意登录页上，扩展声明了「访问所有网站」这一项主机权限；其余权限各自只对应一件具体的事：识别并填充表单、写入与清理剪贴板、读取浏览器本地缓存的网站图标，以及定时执行会话检查、回收站清理与备份提醒

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
◆ It finishes the sign-in, not just the form: pick an entry in the side panel and tap "Fill and sign in" to run all three steps at once. Ctrl+Shift+F fills and ticks by default, and submits the form only after you turn on "Auto-submit login" in preferences — it never clicks sign-in behind your back.
◆ Multi-environment isolation: entries match the exact host name, so development, test, staging and production credentials for the same app stay separate — the thing multi-environment work needs most, with two opt-in tiers to widen matching across subdomains when one account serves a whole domain family.
◆ Codes live with the passwords: no phone to reach for and no authenticator app to switch to mid-login — one entry holds both secrets.
◆ Free, open-source, no subscription: GPL-3.0, auditable source, every feature unlocked.

WHO IT'S FOR
· Developers: local / test / staging / production host names are managed apart and matched exactly, so you no longer tell environments apart by their notes.
· Test engineers: import a batch of case accounts, sign in across environments in one action, recover what you deleted, roll back a changed password.
· Privacy-conscious users: session validity comes in nine steps between 1 hour and 7 days, so you decide how often you are willing to type the master password again.
· Everyday sign-ins: new accounts are offered for saving as you sign in, and a fresh password is one tap away instead of something you have to invent and still remember.
· Anyone moving house: switch from another password manager with the whole vault imported at once, instead of typing every entry by hand.

HOW TO USE
1. Click the toolbar icon to open the side panel.
2. On first run, set a master password (at least 8 characters, containing letters, numbers and symbols). All of your data is encrypted with it.
3. Let the extension capture an account when you sign in, or add and import entries on the management page.
4. From then on, fill any login page from the side panel, the key icon, the right-click menu or the keyboard shortcut.

SECURITY ARCHITECTURE
· The master password is stretched with PBKDF2 (600,000 iterations) into a 256-bit key; every cryptographic operation runs on the browser's native Web Crypto API.
· The key that decrypts your vault and the value used to verify your password are derived on two separate paths (the salt is domain-separated before the check value is derived), so the stored check value cannot be turned back into the decryption key; unlocking compares the two in constant time instead of bailing out at the first differing character.
· The five sensitive fields (username, password, website, note and two-factor key) reach local storage only after AES-256-GCM authenticated encryption — each field, on each save, with a freshly generated random initialization vector, so encrypting the same password twice never produces the same ciphertext. Everything falls back to ciphertext when the session expires.
· Ciphertext goes only into the browser's local stores (persistent local and in-memory session). The account-syncing sync store is never used, so signing into a browser account does not carry your vault off this machine.
· Changing the master password re-encrypts every entry atomically: it either completes as a whole or leaves the previous state untouched, never a half-encrypted vault.
· Every .aph backup file is exported with its own random salt and its own initialization vector, so two backups never share key material.
· The identity vault (name, ID number, phone, email, address, bank card details and custom fields) is a separate store: it reaches local storage only as one AES-256-GCM encrypted blob, is masked by default, and viewing or copying it asks for the master password again.
· Mid two-step sign-in, the page is handed only the current code and when it expires; the key that generates it stays inside the extension's own background context, and the handoff marker is valid for one site only and dies after three minutes.
· The vault locks once you have been idle for the length you pick (5, 10, 30 or 60 minutes), with a system lock handled through that same idle path; locking after a browser restart is a second, independent switch. Both are off until you turn them on. Once locked it asks for the master password again — and that password is never stored, so it cannot be recovered if forgotten.
· After you copy a password, the clipboard is cleared on a timer (30 seconds by default; 10, 15, 60 or 120 also available) and is read back and compared first, so your most recent copy is never destroyed. If the page has lost focus and the clipboard cannot be read, it is overwritten anyway — better one mistaken clear than a password left behind.
· The security audit, the password generator and the leaked-password dictionary all run on the device, without a network request.

FEATURE SET
· Four ways to fill: the key icon that appears when a field takes focus, the side panel, the right-click menu on an input, and the keyboard shortcut. Forms inside page frames can be filled as well.
· A fallback when nothing fills: when a form is rendered by custom components and detection cannot reach the inputs, pin CSS selectors for that domain's username and password fields under "Site rules" (the rule domain must equal the login page domain exactly). Each rule has a "Shadow DOM penetration" switch, on by default, that reaches open shadow roots only. Rules export as JSON for backup or team sharing and merge-import by domain, reporting added / updated / skipped — the file holds domains and selectors, never credentials.
· Save passwords as you sign in: the extension asks before storing anything, de-duplicates what it catches, and lets you allow or block domains or say "never for this site". Weak or shared passwords are pointed out in the same prompt. Sign in to the same account again with a changed password and the prompt switches to update mode on its own, carrying over that entry's existing tags and note; when the vault already holds exactly that pair, you are not asked at all.
· Only the box you meant: login pages often offer several checkboxes, so each one is scored by its label and by how far it sits from the username and password fields, and only the single best match gets ticked. Anything labelled subscribe, push, notification, advertising or marketing is scored down.
· Password check-up: a security audit scored from 0 to 100, where each of four findings costs in proportion to how many entries it touches — reused passwords 35, weak 25, a hit in the built-in list of nearly a thousand commonly leaked ones 20, and long-unchanged 20, that last one split into 90, 180 and 365 day bands. Entries with no two-factor key set up are listed separately and cost nothing.
· Password generator: random passwords run from 6 to 50 characters (16 by default), every enabled character set is guaranteed to appear at least once before the result is shuffled, and ambiguous characters (0/O, 1/l) can be left out. Passphrase mode draws 3-8 words from the bundled 3,080-word English list, can append 1-4 digits, and offers five separator choices including none. The right-click menu can also generate and fill a strong password on the spot — that step reads nothing from your vault, so it works even while the session is locked.
· Password strength check: four rules — length, letters, numbers, symbols — rate every password weak, medium or strong while you add, edit or save it.
· Show or hide passwords: adds a visibility control inside password fields on the page (off by default; turn it on in preferences) so you can check what was filled.
· Two-factor codes (TOTP 2FA): add a key by scanning the QR code on a page or uploading an image, and the code is generated on your device per RFC 6238, with no network request and nothing uploaded. Parameters carried in a standard otpauth:// link are read out — algorithm SHA1 / SHA256 / SHA512, 6, 7 or 8 digits, a custom period — and whatever the link leaves out falls back to 6 digits, SHA1 and 30 seconds; only time-based codes are supported, so counter-based HOTP links are out of scope. The live code and its countdown ring sit in the list and the side panel, and when a login reaches its second step the code appears next to the field, ready to fill in one click.
· Change reminders: any single entry can be set to nag you after 7, 30 or 90 days; the extension checks what is due every 12 hours and raises a desktop notification, and each reminder fires only once.
· Import and export: CSV and JSON, either the whole vault or just the entries you tick; the columns of common password-manager exports are detected automatically, two-factor keys included; a CSV that yields nothing under UTF-8 is decoded again as GBK, which covers spreadsheets exported by Chinese office suites; plus encrypted .aph backups and email backup reminders.
· Trash and history: deleted entries stay recoverable for 30 days, and each password keeps 3 encrypted snapshots you can roll back to (configurable between 1 and 10). Purging an entry from the trash takes its snapshots and its pending reminders with it.
· Quick add and read-only details: the "+" in the panel header saves an account for the current site with its domain pre-filled, and a live Caps Lock hint sits under every master-password field; "View details" opens a drawer with the full note, the live code and the change history without entering edit mode.
· Floating fill button: a draggable button on the login page that snaps to the screen edge, with opacity adjustable from 10% to 100% and its own settings panel inside the overlay, so you can adjust it without leaving the page.
· Keyboard all the way: in the side panel, arrow keys move between accounts, Enter fills, Ctrl+C copies the username and Esc closes the panel. The in-page mini panel follows the same flow — the first account is selected as soon as it opens, so Enter fills it.
· Toolbar popup as the hub: management, side panel, direct fill and locking sit on one screen, with the remaining session time always visible and turning colour as expiry approaches.
· Search and tidy-up: the fuzzy search looks across username, tags, notes and web address at once, understands pinyin written out and by its initials, and highlights what matched; then there is "this site / all entries" scoping in the side panel, up to 3 tags per entry, favorites pinned to the top (10 by default, adjustable 1-50, with the least used making way), one-tap duplicate cleanup and batch actions.
· Identity vault: a separate locker for personal details — name, ID number, phone, email, address, bank card info and custom fields — masked by default and gated by a master-password re-check. It supports encrypted .aphid export/import and exporting only the entries you tick, plus an optional unencrypted plaintext .json export/import (master-password re-check and risk confirmation; import merges by id); it is not covered by automatic backups, so export an encrypted backup regularly.
· Interface: 6 color themes and an instant Chinese/English switch. The four default shortcuts are Ctrl+Shift+P for management, L for the side panel, F for quick fill and K for the inline dropdown — to rebind them, use the browser's own extensions-shortcuts page. The manager page also has a command palette on Ctrl/Cmd+K — search 23 commands by Chinese, pinyin or initials, inert until the master password is verified.

QUESTIONS
· Is it really free? Yes — no premium tier, no in-app purchase, and no upgrade prompt.
· Are my passwords uploaded anywhere? No — the extension runs no server of its own. The one thing it reaches out for is an update check every 6 hours: it first probes whether the store is reachable (the answer is cached on your machine for 24 hours), and only when that fails does it read the public releases endpoint for the newest version number and up to 200 characters of release notes. Neither request carries an account, an identifier, or anything from your vault; with the network off the check simply fails quietly and everything else keeps working.
· Are my personal details (ID numbers, bank cards) uploaded or synced? No — like passwords, they stay encrypted on this machine, are never synced with your browser account, and never leave the device.
· What if I forget the master password? Nothing can recover it, and nobody can hand you back something readable. There is a reset action in the app, but what it does is erase all data and return the extension to its just-installed state — your old password does not come back from that. Export an encrypted backup regularly, so a forgotten password never costs you the vault.
· Can I import from another password manager? Yes — export a CSV or JSON from the app you use now, then upload it on the import page.
· Will an update change settings I have already tuned? No. Defaults that a new version brings in apply to fresh installs only; an install you have been using keeps the fill behaviour it already had.
· Does it mail anything to my inbox on its own? No. Email backup only downloads a spreadsheet to your own machine and then opens the mail client you already have installed, leaving the decision to you — the extension neither sends mail nor has the ability to. The reminder interval can be set to 1, 3, 7, 14 or 30 days, and when one is due all you get is a desktop notification.
· What happens to my vault if I move to a new computer or reinstall the browser? It does not travel on its own. Export an encrypted .aph backup on the old machine, then restore it from the import page on the new one.
· Will it slow down pages? Side-panel open time is a number this project tunes deliberately: cold start, an expired session and a quick browser restart are all optimized against a sub-second target, and about 20–50ms on the cached path when your session is still valid. The overlays injected into pages use an isolated Shadow DOM that leaves host styles alone.
· Which browser do I need? The side panel uses the Side Panel API, available from Chromium 114. No minimum version is declared, so older Chromium-based browsers still install and give you the management page, the popup, right-click filling and the generator — just not the side panel.
· A fill didn't land, what now? After the extension updates or reloads, a tab that was already open needs one refresh before it can receive the fill script; when that happens you get an in-page message and a desktop notification rather than silence. For security, credentials are only delivered to frames on the page's own main domain.
· Any ads, analytics or telemetry? None, and it never reads your browsing history. To be able to show up on whichever login page you open, the extension declares host access to all sites; every remaining permission maps to one concrete job — finding and filling forms, writing and clearing the clipboard, reading site icons from the browser's local cache, and running scheduled session checks, trash cleanup and backup reminders.

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

> ✅ **2026-09-13 重制（推荐上传这一组）**：`assets/cws-store/screen-*.png`，**中英各 14 张**，**2560×1600（即 1280×800 @2x，正好是官方规格的 2 倍）**。每张顶部为品牌渐变标题带（`#0A1A38 → #123E77`，与 Marquee / 小推广图同源；左侧一条品牌色竖条做视觉锚点），下方为界面演示，全部使用占位演示数据（`example.com` / `*.example.com`，**不含任何真实账号、真实邮箱或第三方品牌**）。
>
> ⬆️ **上传请取 `assets/cws-store/upload/*-1280x800.png`，不要传母版**：Dashboard 的截图槽只接受 **1280×800 或 640×400** 的 JPEG / 24 位 PNG，**带 alpha 通道的 PNG 会被判尺寸/格式无效**，而 2560×1600 的母版既是超规格、又是 RGBA 四通道。上传图由 `node scripts/store-shots/export-upload.mjs` 从母版派生（2:1 整数倍降采样 + 白底压平 alpha），中英各 14 张、单张 ≤300KB（商店单文件上限 5MB）；**母版重截后必须复跑这一步**。
>
> 🌐 **两套都要传**：Dashboard 上中文页与 English (United States) 页的截图槽位互相独立、不会继承。**英文版文件名带 `-en` 后缀**，而且不只是标题带翻译——界面本身也切到英文（含标签 `Dev/Staging/Prod/QA/Ops/Design/Docs/Sandbox` 与英文备注），所以英文跑批必须用全新 profile 重新 seed。
>
> 生成方式：脚本化截取（本地 HTTPS 演示站 + Chrome 加载 `.output/chrome-mv3` 构建 + 占位演示数据），不是人工截图。演示数据与复现步骤见下方「生成方式」。
>
> | 序号 | 文件（英文加 `-en`）            | 卖点           | 标题带文案                                               |
> | ---- | ------------------------------- | -------------- | -------------------------------------------------------- |
> | 1    | `screen-1-one-click-login.png`  | 一键登录       | 一键登录：填充 → 勾选「记住我」→ 自动点击登录            |
> | 2    | `screen-2-totp.png`             | TOTP 两步验证  | TOTP 两步验证：验证码和密码住在一起，不用摸手机          |
> | 3    | `screen-3-multi-env.png`        | 多环境账号管理 | 多环境账号管理：同一站点，开发 / 测试 / 生产分得清清楚楚 |
> | 4    | `screen-4-security-audit.png`   | 离线安全体检   | 离线安全体检：0-100 分给密码健康打分，全程本机计算       |
> | 5    | `screen-5-preferences.png`      | 主题与双语     | 6 款主题 + 中英文双语界面，即时切换无需刷新              |
> | 6    | `screen-6-local-encryption.png` | 本地加密       | 本地加密：密码只存在你的浏览器里，加密后落盘             |
> | 7    | `screen-7-favorites.png`        | 收藏置顶与筛选 | 收藏常用账号：星标置顶，再一键只看收藏                   |
> | 8    | `screen-8-detail-drawer.png`    | 条目详情       | 条目详情：备注、两步验证活码、修改历史一屏看全           |
> | 9    | `screen-9-inline-fill.png`      | 页内填充面板   | 页内填充面板：在输入框旁边直接挑账号                     |
> | 10   | `screen-10-floating-button.png` | 页面悬浮按钮   | 页面悬浮按钮：登录页随手唤起填充面板                     |
> | 11   | `screen-11-auto-save.png`       | 自动保存凭证   | 自动保存登录凭证：提交时弹窗确认，自动去重               |
> | 12   | `screen-12-import-backup.png`   | 导入导出与备份 | 导入导出与加密备份：数据随时能带走                       |
> | 13   | `screen-13-generator.png`       | 密码生成器     | 密码生成器双模式：随机字符或助记词组                     |
> | 14   | `screen-14-trash.png`           | 回收站         | 回收站与修改历史：误删可恢复，改错能回滚                 |
>
> 📐 **第 12 张刻意只拍「数据管理」下拉，不拍导入弹窗**：导入弹窗的格式单选里有「Chrome 密码」这一项，属商店图片文字禁用的竞品品牌名；下拉里的九个入口（导入 / 下载模板 / 导出 / 导出 JSON / 加密备份导出 / 加密备份导入 / 备份到邮箱 / 一键去重 / 回收站）不含品牌名，且一屏覆盖导出与备份两个能力。
>
> ⚠️ **每个语言页的截图上限是 5 张**，上表有 14 张候选，**最终选哪 5 张由上传时定**。脚本侧建议取 `1 / 2 / 3 / 4 / 9`（前四张各占一个独立卖点，第 9、10 张是仅有的两张展示**页内**体验的构图，与其余「侧边栏 / 管理页」互补）；要换就换 `7`（收藏 + 标签 + 网站图标）、`8`（信息密度最高的详情抽屉）或 `13`（生成器面板）。**若要砍一张，先砍第 6 张**（本地加密画面最朴素，且该主张在摘要与说明里已有文字承载）。
>
> 📤 按上面建议上传时，中文页取这 5 个文件（English 页把 `screen-` 后同名换成 `-en-1280x800.png`）：
> `upload/screen-1-one-click-login-1280x800.png`、`upload/screen-2-totp-1280x800.png`、`upload/screen-3-multi-env-1280x800.png`、`upload/screen-4-security-audit-1280x800.png`、`upload/screen-9-inline-fill-1280x800.png`。
>
> 📌 第 7、8 张依赖 `seed.mjs` 的**收藏**与**改密**步骤（详情抽屉的「密码修改历史」小节只在有条目被改过密码后才渲染），第 14 张依赖**移入回收站**步骤，只跑导入是拍不出来的。
>
> ⚠️ **标题带文案的合规约束与商店文案完全一致**：零竞品品牌名、零绝对化表述（不写「零联网 / 100% offline / 数据不出浏览器」——扩展每 6 小时有一次不携带用户数据的匿名版本检查）。改文案后必须重新跑一遍本节「生成方式」的脚本。
>
> 🚫 **旧的 `01-*.png` ~ `12-*.png` 不要再上传商店**：那 12 张拍摄于 2026-07-29 的 **v2.12.0**，界面版本徽章过期，其中 `01-master-password.png` 还带着已删除的「严禁……后果自负」旧声明，且含真实账号邮箱。**README 与 README.en.md 已于 2026-09-11 改用新的 `assets/cws-store/screen-*.png`（中英各 14 张，英文页取 `-en` 版），不再引用这批旧图**；它们若仍出现在其他文档或页面，需另行重截（见 `docs/exposure-status.md` 残留待办）。

### 生成方式（可复现）

截图由脚本生成，**改完商店文案或功能后重跑即可**，不要手改 PNG：

```bash
# 1) 构建（截图里的版本徽章取自 manifest.version）
pnpm build

# 2) 起本地 HTTPS 演示站（托管演示登录页 / 2FA 页，并按 Host 合成站点图标供 favicon 缓存命中）
node scripts/store-shots/demo-server.mjs &

#    再带 host 映射启动 Chrome（把 *.example.com 指到 127.0.0.1:8443，让侧边栏命中演示账号
#    且地址栏保持干净的 https://<host>）；完整参数见 scripts/store-shots/README.md

# 3) 按语言各跑一批：seed（设主密码 + 导入 10 条 + 收藏 2 条 + 改 1 条密码造历史）
#    → seeded → prefs，再换全新 profile 跑 firstrun（本地加密需要「还没设主密码」的首启状态）
node scripts/store-shots/seed.mjs    "$PWD/.output/chrome-mv3" zh
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" seeded zh
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" prefs  zh
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" firstrun zh
# 英文同上，第二个参数换成 en（演示标签也是英文，必须换全新 profile 重新 seed）

# 4) 由母版派生商店真正收的尺寸（1280×800、无 alpha）→ assets/cws-store/upload/
node scripts/store-shots/export-upload.mjs
```

> 演示账号（中英各 **10 条**占位）内联在 `scripts/store-shots/seed.mjs` 的 `DEMO_CSV_ZH` / `DEMO_CSV_EN`，`seed.mjs` 还会收藏 2 条、把 1 条密码改两次（图 7、图 8 依赖这两步）；演示登录页 / 2FA 页为同目录的 `demo-login.html`、`demo-2fa.html`；截图与合成脚本也在该目录，完整用法（含 Chrome 启动参数、favicon 预热、自备 CSV）见其 `README.md`。
>
> 💡 版本徽章：脚本读取构建产物里的 `manifest.version`，所以**务必先让分支版本与即将提交的包一致**（同步到 `main` 后应为 3.9.0）再截，否则又会出现「截图版本与商店版本不符」。
> ✅ 版本徽章已核验（2026-09-13 复核）：当前母版是合并 `main`（`package.json` 3.9.0）之后重截的一批，管理页截图里的徽章实测为 **v3.9.0**，与 `package.json` / `.output/chrome-mv3/manifest.json` 一致，可直接提交 3.9.0。图 6 是首启「设置主密码」页，**该页面本身不渲染版本徽章**，不存在徽章核对项。今后 `package.json` 再升版本，必须 `pnpm build` → 重跑 `capture.mjs` → 重跑 `export-upload.mjs`，否则又会出现「截图版本与商店版本不符」。

> 📐 **尺寸对照**：新一组母版是官方规格的精确 2 倍（1280×800 @2x = 2560×1600），`export-upload.mjs` 按 2:1 降采样即得官方尺寸；母版本身仍用于 `index.html` 与 README（高清显示更锐利），**商店截图槽取 `upload/` 里的 1280×800 版**。`assets/screenshots/` 里的旧 12 张是 2880×1598~1610（约 16:9），既非官方比例、版本也已过期。
>
> ⚠️ `assets/cws-store/` 除新的 28 张母版（14 中文 + 14 英文）与 `upload/` 下对应的 28 张上传图外，仍有旧素材：`01-*.png` ~ `08-*.png`（v2.12.0，**含真实账号邮箱，勿再上传**）、`store-icon-128x128.png`、四张推广图（`marquee-1400x560.png` / `marquee-en-1400x560.png` / `small-promo-440x280.png` / `small-promo-en-440x280.png`）。上传截图时只取 `upload/*-1280x800.png`。

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
>
> ⚠️ **旧素材已退役**：仓库里早期的 `docs/demo-login.*` 是真机录屏，画面含作者的真实
> GitHub 用户名、实时 TOTP 活码和已登录的业务面板，属于凭据泄露素材。
> **2026-09-13 已重录**：`docs/demo-login.webp` / `demo-login-en.webp` / `demo-login.gif`
> 现由 `scripts/store-shots/record.mjs` 从占位演示页生成（`example.com` 数据），
> README 首屏已换回动图；同一天补录了两步验证接力动图
> `docs/demo-totp.webp` / `demo-totp-en.webp` / `demo-totp.gif`，同样全部是占位数据。
> **唯独 `docs/demo-login.mp4` 仍是旧真机录屏，不得引用。**
> **今后任何截图与录屏一律基于 `scripts/store-shots/` 的占位演示页**
> （`demo-login.html` / `demo-2fa.html` + `example.com` 数据），不要录制真实账号画面。

**GIF 1：一键登录演示（必做）**

| 项目     | 要求                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 内容脚本 | 打开登录页 → 侧边栏选中条目点「填充并登录」（或在偏好设置中开启「自动触发登录」后按 `Ctrl+Shift+F`，两条路径结果相同）→ 账号密码自动填充 → 「记住我 / 同意条款」自动勾选 → 登录按钮自动点击 → 登录成功 |
| 时长     | 7–15 秒（当前实现为 4 个关键帧、1.4/1.2/2/2.4 秒，一轮约 7 秒）                                                                                                                                        |
| 宽度     | 800–1000px                                                                                                                                                                                             |
| 文件大小 | ≤ 5MB（可用 [ezgif.com](https://ezgif.com) 或 `ffmpeg` 压缩）                                                                                                                                          |
| 存放位置 | `docs/demo-login.gif`（900px 宽，推广文档引用）+ `docs/demo-login.webp` / `docs/demo-login-en.webp`（1152×720，README 功能演示动画位）                                                                 |
| 录制工具 | `node scripts/store-shots/record.mjs "$PWD/.output/chrome-mv3" zh\|en login`——CDP 驱动本地 Chrome 走扩展真实填充链路取关键帧，再合成品牌标题带                                                         |
| 压缩命令 | 由 `record.mjs` 内部调用 `ffmpeg` 完成（webp：`-fps_mode passthrough -c:v libwebp -quality 72`；gif：`palettegen=stats_mode=diff` + `paletteuse`）                                                     |

**GIF 2：TOTP 两步验证接力（加分）**

| 项目     | 要求                                                                                                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 内容脚本 | 登录页唤起**页内填充面板** → 方向键 + 回车选中条目（账号密码自动填充、「记住我」自动勾选）→ 点登录进入受理中 → **同一标签页**跳验证码页 → 活码胶囊自动锚定到输入框右内缘 → 点「填入页面验证码输入框」→ 动态码进框 → 点 Verify 验证成功 |
| 时长     | 6 个关键帧、1.5/1.4/1.3/2.2/1.6/2.1 秒，一轮约 10 秒                                                                                                                                                                                   |
| 宽度     | 800–1000px（当前产出 900px 宽 gif）                                                                                                                                                                                                    |
| 文件大小 | ≤ 5MB（当前 `docs/demo-totp.gif` 约 160KB）                                                                                                                                                                                            |
| 存放位置 | `docs/demo-totp.gif`（推广文章配图）+ `docs/demo-totp.webp` / `docs/demo-totp-en.webp`（1152×720，README 首屏）                                                                                                                        |
| 录制工具 | `node scripts/store-shots/record.mjs "$PWD/.output/chrome-mv3" zh\|en totp`——与 GIF 1 同一套流水线，只是换了场景参数                                                                                                                   |
| 画面口径 | 站点 `console.example.com`、条目 `ops@example.com`（占位 TOTP 密钥），全部 `example.com` 数据，不含真实凭据                                                                                                                            |

> **为什么第一阶段的填充走页内面板而不是侧边栏**：接力标记 `SET_PENDING_TOTP` 受
> `isTrustedInternalSender` 门控（要求 `sender.tab === undefined`），真侧边栏满足，但自动化
> 流水线只能把 `sidepanel.html` 开成标签页，消息会被判为未授权来源。页内面板走
> `FILL_BY_ID`，由内容脚本发起、不经该门控，同样会记录接力标记，因此整条链路都是扩展自身
> 的真实行为，没有为拍图伪造任何状态。

**录制注意事项**

1. 使用干净的 Chrome Profile（无多余扩展/书签干扰）
2. 隐藏地址栏和标签栏（Chrome 菜单 → 查看 → 始终显示书签栏 → 取消勾选）
3. 填充前稍作停顿 1 秒，让观看者看清页面
4. 确保快捷键操作可见（可在录制前用按键可视化工具如 keycastr 显示按键）
5. 录制页面使用 `scripts/store-shots/demo-login.html` / `demo-2fa.html`（经本地演示站以域名访问，数据全部是 `example.com` 占位账号），**不要录制真实站点或真实账号**

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
用于在浏览器本地存储加密后的密码数据、身份信息（证件号、银行卡号等）和用户偏好设置，所有敏感数据使用 AES-256-GCM 加密。
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
| 10  | 商店列表质量     | 标题/描述/截图完整高质量            | 🔄 文案已按驳回重写待审；截图已于 2026-09-13 用 `scripts/store-shots/` 重制（中英各 14 张候选），**徽章已是 v3.9.0**     |

### 7.2 提名表单文案 — 英文（直接粘贴）

**What is the purpose of your extension? Describe the value it provides to Chrome users.（扩展程序的用途是什么？说明它为 Chrome 用户带来的价值。）**

```
Account Password Helper is a free, open-source, local-first password manager — one-click login (autofill → tick the remember-me / "I agree" box → click login, not just form fill), exact-domain matching to isolate dev/test/staging/prod accounts, built for developers and QA engineers. No cloud sync, no account, no subscription. AES-256-GCM encrypted, all credential data stays in your browser.

Key differentiators:
• One-click login: the side panel's "Fill and sign in" action chains autofill, consent-box tick and the login click into one step. Ctrl+Shift+F fills and ticks by default, and submits the form only after you opt in to "Auto-submit login".
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

2) Multi-environment management: A developer manages dev/staging/prod accounts for the same site. Exact-domain matching (the default tier) keeps credentials separated.

3) TOTP handoff: User signs into GitHub. After password autofill, a live TOTP capsule auto-anchors beside the 2FA input — one-click entry, no phone needed.

4) Inline autofill: Login form detected → key icon → compact dropdown with matching accounts → select to fill (Ctrl+Shift+K). The dropdown searches by the same rules as the manager page and the side panel (username, tag, remark and URL, with full pinyin and initialisms), the first match is selected as soon as it opens so Enter fills it, and when the site has no account its empty state hands your keyword to the manager page for a whole-vault search.

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
• 一键登录：侧边栏「填充并登录」把填充、勾选「记住我 / 同意条款」、点击登录按钮连成一步；`Ctrl+Shift+F` 默认只做填充与勾选，只有在偏好设置中开启「自动触发登录」后才会代为提交表单
• 多环境账号隔离：默认的精确域名匹配区分同一站点的 dev/test/staging/prod 账号
• 内置 TOTP 验证器：RFC 6238 验证码本地生成，GitHub 式两步登录自动锚定活码胶囊
• 离线安全体检：0–100 评分，四个计分维度按权重合计（复用 35 / 弱密码 25 / 常见泄露 20 / 长期未更新 20），「未开启两步验证」仅列示不计分，全程本地计算
• 零成本迁移：支持 CSV / JSON 导入，自动识别常见密码管理器的导出格式

完全免费，无付费墙、无订阅、无数据收集。开源（GPL-3.0）。
```

**应如何使用您的扩展程序？请提供主要使用情形示例。**

```
初始设置（一次性）：安装 → 设置主密码 → 手动添加或从 CSV/JSON 批量导入账号。

1) 一键登录：测试工程师在 staging 登录页打开侧边栏，点选条目的「填充并登录」——账号自动填充、协议自动勾选、登录按钮自动点击，1 秒内完成；在偏好设置中开启「自动触发登录」后，一次按键即可得到同样结果。

2) 多环境凭证管理：开发者管理同一应用 dev/staging/prod 的账号，默认的精确域名匹配确保各环境凭证互不混淆（需要跨子域时在设置里显式放宽）。

3) TOTP 两步验证接力：登录 GitHub，密码填充后下一页要求验证码，扩展自动锚定活码胶囊，一键填入，无需手机验证器。

4) 内联填充：检测到登录表单 → 钥匙图标出现 → 点击展开匹配账号下拉面板 → 选择即填充（Ctrl+Shift+K）。面板搜索与管理页、侧边栏同一套口径（账号 / 标签 / 备注 / 网址，认拼音全拼与首字母），打开即默认选中首条、回车即填；本站无匹配账号时可带着关键词到管理页做全库搜索。

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
- [ ] 截图已上传（**中文页与 English (United States) 页各 5 张**，从 `assets/cws-store/upload/*-1280x800.png` 的 14 张候选里选，英文页取 `-en-` 那一套；**不要传 2560×1600 母版、也不要再用旧的 `01-*.png` ~ `12-*.png`**）
- [ ] 截图版本徽章与提交包一致（**当前批次徽章为 v3.9.0**，与 `package.json` / `manifest` 同源；改版本后必须 `pnpm build` 并重跑 `scripts/store-shots/`）
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
- [x] 演示 GIF 已制作（`docs/demo-login.gif` + `docs/demo-login{,-en}.webp`，以及两步验证接力 `docs/demo-totp.gif` + `docs/demo-totp{,-en}.webp`，2026-09-13 由 `record.mjs` 从占位演示页录制，不含真实凭据）
- [ ] 7.2 英文提名文案已逐字段粘贴到 One Stop Support 表单
- [ ] 插件 ID（`fgimkdodpjfkddmildjieojpfakpanli`）与联系邮箱已填写
- [ ] 提交后记录日期（6 个月内不可重复提名）
