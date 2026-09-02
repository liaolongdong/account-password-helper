# Account Password Helper 功能深度分析与机会清单

## Context

项目当前处于 v3.7.0，核心功能（一键登录、三重填充、TOTP 接力、加密备份、安全体检、回收站、导入导出）已完整稳定；近期版本重心在国际化和官网出海，进入"维护打磨期"。本分析基于对三个入口（sidepanel/popup/options）、content script、background 的全量盘点，目标是发掘**特别实用的新增功能**与**值得优化的交互体验**，并给出优先级与实施要点。

以下结论均已对照代码核验，非推测。

---

## 一、现状快照（已具备的能力）

| 维度 | 已具备 |
|---|---|
| 填充 | 侧边栏 / 内联钥匙图标 / 快捷键三路；自动登录；密码可见性切换 |
| TOTP | 本地生成、两步登录接力胶囊、图标填充 |
| 捕获 | Chrome 式自动保存提示、智能去重、域名黑名单 |
| 组织 | 扁平多标签、收藏置顶（LRU）、拼音搜索、批量操作、一键去重 |
| 安全 | AES-256-GCM + PBKDF2 60 万次、闲置/启动重锁、剪贴板定时清除、五维安全体检、密码历史快照、回收站 |
| 备份 | CSV/JSON 导入（识别 Chrome/Bitwarden/1Password/LastPass）、.aph 加密备份、邮箱备份、定时提醒 |
| 快捷键 | `Ctrl/⌘+Shift+P/L/F/K` 四组（固定，不可应用内改键）；popup、密码管理页「安全设置 → 快捷键」、侧边栏帮助弹窗三处均提供一览与生效状态 |

**确认不存在的能力**（代码级核验）：生物识别快捷解锁、自定义字段、文件夹层级、跟随系统主题、侧边栏全局搜索、拖拽排序、应用内改键（Chrome `commands` API 无 `update()`，只能引导至浏览器管理页）。

> **修订记录**：初版曾把「右键菜单」列入不存在能力，实际已于 `4ac3467 feat(context-menu)` 落地（`entrypoints/background/contextMenuManager.ts` + `entrypoints/content/contextMenuTarget.ts` + `contextMenus` 权限）；初版的「快捷键自定义」应表述为「应用内改键」——只读一览与未生效预警已由 P0-2 实现，但受 Chrome API 限制无法在扩展内改键。

---

## 二、新增功能机会（按优先级）

### P0 — 高价值、低风险、契合本地优先定位

#### 1. 右键上下文菜单 ✅ 已落地（`4ac3467`）
- **实施前缺口**：全工程无 `chrome.contextMenus`。三种填充方式都需要先唤起面板。
- **已实现**：`entrypoints/background/contextMenuManager.ts`（菜单创建与点击路由）+ `entrypoints/content/contextMenuTarget.ts`（页面侧目标识别），`wxt.config.ts:105` 已声明 `contextMenus` 权限，配套 `tests/background/contextMenuManager.test.ts`。
- **原方案**（保留作背景）：在输入框右键提供「填充用户名 / 填充密码 / 填充 TOTP / 生成并填充强密码」；在页面空白处右键提供「打开侧边栏 / 打开管理页」。
- **原实施要点**：菜单项按当前域名匹配条目动态启用（`onShown` + `refresh`，或简化为固定菜单 + 填充时再匹配）；复用 `messageRouter` 现有 `FILL_BY_ID` / 密码生成器。
- **成本**：低。**价值**：高频入口，对长表单中途补填场景尤其有用。

#### 2. 统一快捷键一览 + 未生效预警 ✅ 已落地
- **实施前缺口**：四组快捷键写死在 `wxt.config.ts` commands，`⌘+Shift+F/K` 与部分系统/应用键冲突；引导只在 popup，侧边栏/帮助里查不到；按键被占用或更新后未自动绑定时 `getAll()` 返回空值，用户只感受到「按了没反应」。
- **方案**（事实修正）：Chrome `commands` API 仅提供 `getAll()` 与 `onCommand`，**不存在** `chrome.commands.update()`（该方法属 Firefox 的 `browser.commands.update()`），扩展内无法改键；因此方案调整为只读一览 + 未生效预警 + 跳转 `chrome://extensions/shortcuts`（Firefox 无此页，降级为文案提示），入口覆盖 popup、密码管理页「安全设置 → 快捷键」与侧边栏帮助弹窗。
- **已实现**：`utils/shortcutCommands.ts`（命令清单单一事实来源 + `openShortcutsPage()`）、`components/ShortcutKeyCap.vue`（键帽，外层 `span[role=img][aria-label]` 包内层 `kbd[aria-hidden]`）、`components/options/ShortcutSettingDialog.vue`、`components/sidepanel/HelpDialog.vue` 快捷键分组、`composables/useShortcuts.ts`（`entries` 派生真实绑定态）。兜底按键按平台取 manifest `suggested_key` 的 `default` / `mac` 分支（`utils/platform.ts` 的 `isMacPlatform()`），避免 macOS 上未绑定行显示与 manifest 声明不符的 `Ctrl⇧`。侧边栏的 `loadShortcuts()` 挂在 `watch(modelValue)` 而非 setup，不侵入首屏关键路径（实测挂载期 `getAll()` 调用 0 次）。
- **成本**：低，零权限变更（不改 `wxt.config.ts` 的 `commands` / `permissions`，不新增消息类型）。**价值**：不调整默认键位，但直接消除「按键未生效却无从得知」的投诉，并提升功能可发现性。

#### 3. 侧边栏全局搜索模式 ⭐ 推荐首批
- **现状缺口**：侧边栏搜索只作用于"当前域名 + 空 URL 条目"（`entrypoints/sidepanel/App.vue:319-327` 中 `filteredPasswords` 基于 `domainFilteredPasswords`）。想找其它站点的账号必须打开 options 页。
- **方案**：搜索框旁增加「全站」切换（或检测到当前域名无结果时自动提示"搜索全部条目"），命中条目支持复制/编辑/跳转。
- **实施要点**：数据已在 `useSidepanelData` 缓存中，仅放宽过滤范围 + 空态引导，改动收敛在 `App.vue`。
- **成本**：低。**价值**：侧边栏从"当前站工具"升级为"全库入口"，使用频率显著提升。

#### 4. 生物识别 / PIN 快捷解锁
- **现状缺口**：每次会话过期都需输入主密码（已核验无任何 WebAuthn 代码）。解锁是全产品最高频痛点。
- **方案**：用 WebAuthn platform authenticator（Touch ID / Windows Hello）作为解锁验证因子：主密码仍用于换钥、导出、重置等敏感操作；日常解锁走生物识别。主流管理器（1Password/Bitwarden）均以此为核心卖点。
- **风险与设计约束**：需认真设计密钥封装方式（不可把解密密钥明文落盘，生物识别仅作访问守卫）；涉及 `sessionManager` 核心路径，必须保留降级路径与完整测试。
- **成本**：中-高（建议先出安全设计方案，经确认后再实施）。**价值**：极大。

### P1 — 中等价值，数据模型或交互改动较大

#### 5. 条目自定义字段 / 身份信息
- 现状：`PasswordEntry`（`utils/types.ts`）仅固定字段，无法存银行卡号、身份证、安全问题等。
- 方案：增加 `customFields: {label, value, secret?}[]`，表单/列表/复制/导入导出全链路支持；`secret` 类型默认掩码。
- 注意：存储结构变更需旧数据兼容 + 导入导出兼容 + 备份格式版本化，属 agents.md 中"必须谨慎"类别。成本中-高。

#### 6. 站点级填充/捕获规则
- 现状：自动保存黑名单是全局域名级；无法按站点指定填充模式、禁用悬浮按钮、调整匹配策略。
- 方案：设置中增加「站点规则」列表（域名 → 行为开关），复用现有黑名单数据结构扩展。

#### 7. 保存时弱密码 / 重复内联预警
- 现状：`SavePasswordPrompt` 捕获时不提示质量；安全体检只在 options 主动打开。
- 方案：捕获弹窗内复用 `utils/passwordHealth.ts` 评分，对弱密码/与已有条目重复给出内联警示（可忽略），把体检能力前置到行为发生点。成本低-中。

#### 8. 跟随系统主题自动切换
- 现状：6 套手动主题，全工程无 `prefers-color-scheme` 用法（已复核）。锁屏视图 `components/sidepanel/SidepanelAuthView.vue:133` 用的是 `prefers-reduced-motion`（动效降级），与配色无关——初版此处将两者记混，已修正。
- 方案：主题设置增加「跟随系统」选项，监听 `matchMedia('(prefers-color-scheme: dark)')` 切换明暗两套令牌。成本中（需梳理 6 主题的明暗对应关系）。

### P2 — 需权衡或长期方向（不建议近期动）

| 机会 | 不建议原因 |
|---|---|
| HIBP 泄露检测 | 与"零网络传输"核心卖点冲突；若做必须 opt-in + 隐私文档重写，先问用户意愿 |
| 文件夹/层级分组 | 标签体系基本够用，层级会增加认知负担 |
| Passkey 凭据管理 | 行业方向但工程复杂度极大，属下一个大版本议题 |
| 云端/跨设备同步 | 违背本地优先定位，除非用户明确想要 |

---

## 三、交互体验优化清单

| # | 优化点 | 说明 | 成本 |
|---|---|---|---|
| 1 | 快捷键一览可发现性 | ✅ 已随 P0-2 落地（popup / 密码管理页 / 侧边栏帮助三处入口） | 低 |
| 2 | 清理遗留调试代码 | `components/options/ValidityHoursSelect.vue:36-38` 有 `/** todo 测试过期时间 别删除 start */` 与 `end */` 包裹的注释掉的 6 分钟选项，确认无用后清理 | 极低 |
| 3 | 条目拖拽排序 | 数据已有 `order` 字段但无拖拽 UI；需求强度待确认，可用排序兜底 | 中 |
| 4 | Options 条目详情抽屉 | 当前只有表格 + 编辑弹窗，缺少"只读预览"，查看备注/历史需进入编辑态 | 中 |
| 5 | 侧边栏搜索历史/最近使用 | 与 P0-3 全局搜索配套，显示最近使用条目 | 低 |
| 6 | 新手引导增强 | `EmptyGuide` 已有；可考虑首次安装后的 3 步交互引导（导入/添加/填充） | 中 |
| 7 | 填充失败反馈闭环核查 | 确认所有填充失败路径都有 `NativeNotification` 反馈、无静默失败 | 低 |

---

## 四、建议实施批次

**第一批（低风险高频速赢）**：~~P0-1 右键菜单~~ ✅ 已落地（`4ac3467`）、~~P0-2 快捷键统一一览与未生效预警~~ ✅ 已落地、**P0-3 侧边栏全局搜索（待实施）** + 优化清单 #2（调试代码清理，待实施）。四者互不耦合，可分独立提交，各自带测试与文档更新。

**第二批（确认后启动）**：P0-4 生物识别解锁 —— 先产出安全设计方案供确认。

**按需挑选**：P1 各项与交互优化清单。

## 五、验证方式（每批通用，遵循 agents.md 矩阵）

1. `pnpm typecheck` + `pnpm lint` + 相关 `pnpm test:run -- <file>`（跨入口改动跑全量）
2. `pnpm build`（涉及 manifest/权限时必须）
3. 浏览器实测：加载未打包扩展，实测新功能黄金路径 + 锁屏/会话过期/冷启动边界（UI 改动必须截图+实测证据）
4. 文档同步：README/README.en、HelpDialog、CWS 文档、`wxt.config.ts` 描述、中英 i18n key 一致性（含 `utils/i18n-lite.ts`）

## 六、关键文件索引

- `wxt.config.ts` — permissions / commands 定义
- `entrypoints/background/messageRouter.ts` — 消息路由（新功能消息接入点）
- `entrypoints/sidepanel/App.vue:319` — 侧边栏过滤/搜索逻辑（P0-3 改动点）
- `utils/types.ts` — `PasswordEntry` 数据模型（自定义字段改动点）
- `utils/passwordHealth.ts` — 体检评分（保存时预警复用）
- `components/options/ValidityHoursSelect.vue:36-38` — 遗留调试标记