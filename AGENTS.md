# Account Password Helper 项目规则

## 适用范围与优先级

- 本文件适用于整个仓库。
- 这是一个本地优先的密码管理器浏览器扩展。处理改动时按以下顺序权衡：安全与隐私、功能正确性、数据与行为兼容性、可维护性、性能、代码风格。
- 开始修改前先阅读相关实现、测试及 `docs/ARCHITECTURE.md`；不要仅凭文件名或猜测改变行为。
- 只做满足当前需求所需的最小完整改动。保留工作区中的用户改动，不覆盖、不回退、不顺手格式化或重构无关文件。
- 未经用户明确要求，不改变既有功能、交互、默认值、存储结构、加密格式或浏览器权限；确有必要时，先说明影响并询问确认。
- 未经用户明确要求，不提交、推送、发布代码，也不升级依赖或改写 lockfile。

## 快速参考

### 常用命令

| 用途     | 命令                                                 |
| -------- | ---------------------------------------------------- |
| 开发     | `pnpm dev`（端口 8899）                              |
| 构建     | `pnpm build`（Firefox: `pnpm build:firefox`）        |
| 类型检查 | `pnpm typecheck`                                     |
| Lint     | `pnpm lint`（修复: `pnpm lint:fix`）                 |
| 样式检查 | `pnpm lint:style`（修复: `pnpm lint:style:fix`）     |
| 格式检查 | `pnpm format:check`                                  |
| 测试     | `pnpm test:run`（单文件: `pnpm test:run -- <file>`） |
| 图标构建 | `pnpm icons:build`                                   |
| 包分析   | `pnpm analyze`                                       |

### 关键文件速查

| 职责             | 文件                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| 公共类型定义     | `utils/types.ts`                                                         |
| Storage 键名     | `utils/storageKeys.ts`（`STORAGE_KEYS` + `SESSION_MEMORY_KEYS`）         |
| 存储门面         | `utils/storage.ts` → `utils/storage/` 子模块                             |
| 加密核心         | `utils/encryption.ts`（PBKDF2 + AES-256-GCM）                            |
| 会话管理         | `utils/sessionManager.ts` + `utils/sessionManager-storage.ts`            |
| 消息路由         | `entrypoints/background/messageRouter.ts`                                |
| 侧边栏管理       | `entrypoints/background/sidePanelManager.ts`                             |
| SW 保活与闹钟    | `entrypoints/background/backgroundServices.ts`                           |
| Vue i18n（完整） | `utils/i18n/`（Options/SidePanel/Popup）                                 |
| 轻量 i18n        | `utils/i18n-lite.ts`（Content/Background，`tl()` 函数）                  |
| 主题令牌         | `assets/theme/tokens.css`（`--aph-*` 变量，6 套色彩方案）                |
| WXT 配置         | `wxt.config.ts`（路径别名、Element Plus 按需引入、非阻塞 CSS）           |
| 测试配置         | `vitest.config.ts`（`WxtVitest()` 插件，Node 环境，Web Crypto 原生支持） |

## 代码改动与优化边界

### 修改功能或修复问题时

- 修改既有代码时，同时检查本次触及范围内是否存在明显的大文件职责混杂、重复逻辑、超大组件、散落类型、重复常量或可独立测试的公共方法；在能证明行为等价且风险可控时，可以随当前改动一并做局部优化。
- 顺带优化必须服务于当前任务，只限直接相关模块，不扩展成全仓库重构，不借机改名、换风格、替换技术方案或调整无关交互。
- 功能改动与结构优化应尽量分成清晰、可审查的步骤：先建立或确认当前行为，再完成结构调整，最后实现需求；避免在一个大改动中同时混合行为变化和大规模搬迁。
- 修复 bug 时先用测试或可复现步骤固定预期行为。若在修改中发现当前任务之外的 bug、体验问题或产品改进点，先记录并说明，不顺手改变行为。
- 对触及代码做必要清理，但不要为了形式上的“抽象”增加层级。只有当抽取后职责更清晰、能减少真实重复或能独立测试时才创建新组件、composable、类型或工具方法。

### 明确进行代码优化或重构时

- 优化代码的默认目标是内部结构改善，必须保持外部可观察行为不变，包括功能结果、异常与降级路径、UI 布局和文案、操作步骤、焦点与键盘行为、动画与滚动、事件时序、消息协议、存储数据、默认值、加密格式、权限和网络行为。
- 优化前先阅读调用方和现有测试，明确被优化模块的职责、入口、输出、副作用和兼容边界；必要时先补充特征测试或回归测试，再移动或重写代码。
- 大文件拆分应按稳定职责和数据流划分，保持原入口为薄的编排层。拆分后避免循环依赖、双向状态同步和跨层访问，不以文件行数作为唯一拆分依据。
- 重复代码抽离前确认各处语义、错误处理、生命周期和未来变化方向一致；看起来相似但业务约束不同的代码不得强行合并。
- Vue 组件抽离应有明确的 UI 职责和类型化 props/emits 契约。不得因为抽离改变 DOM 结构、样式作用域、焦点顺序、事件传播、挂载时机或响应式更新时序。
- composable 抽离负责响应式状态与生命周期副作用；纯函数和无状态算法放入 `utils/`。抽离后应保持状态所有权单一，并确保 listener、observer、timer 和 watcher 的注册及清理次数不变。
- TypeScript 类型放在最接近其所有者的位置；只有被多个模块稳定共享时才上移到公共类型文件。抽离类型不得弱化约束、扩大联合类型或用可选字段掩盖不合法状态。
- 公共方法应围绕单一业务能力设计，参数和返回值明确，优先纯函数。不要创建笼统的 `helpers`、`common` 或万能工具类，也不要为了减少少量行数隐藏关键业务语义。
- 变量或常量提取应表达业务含义、消除魔法值或避免重复计算；一次性且语义清晰的表达式不机械提取。共享常量放在所属领域附近，真正跨领域时才放入 `utils/constants.ts`。
- 迁移、重命名或抽取后及时删除已被替代的死代码并更新所有引用、测试和必要文档，但不改动无关文件。
- 优化完成后使用与优化前相同的场景和测试验证行为等价，并针对新边界补充测试。性能优化还需提供前后使用同一方法获得的数据，不以主观感受判断。

### 必须暂停并询问确认的情况

- 如果优化需要或可能改变任何功能、业务规则、用户交互、视觉呈现、默认值、数据格式、兼容性、权限、隐私边界或性能取舍，立即停止实现，先向用户说明当前行为、拟议变化、原因、影响范围和可选方案，获得明确确认后再继续。
- 如果无法可靠判断重构是否行为等价，视为可能影响功能或交互，必须先询问确认，不能以“应该没有影响”作为继续依据。
- 如果保持兼容需要明显增加复杂度，或者发现原行为存在缺陷但修正会改变用户体验，也必须让用户在“保持原行为”和“接受行为调整”之间做决定。
- 纯内部、范围明确、已有验证覆盖且可证明行为等价的重构可以直接执行；交付时仍须列出优化内容和验证证据。

## 技术栈与包管理

- 使用 WXT、Manifest V3、Vue 3、TypeScript、Element Plus、Vite、Vitest。
- 使用 `pnpm`，以 `package.json` 的 `packageManager` 和 `pnpm-lock.yaml` 为准；不要混用 npm 或 yarn。
- 优先复用现有依赖与 Web/Chrome 原生 API。新增或升级依赖前，先证明必要性并评估包体积、安全、权限和兼容性影响。
- Element Plus 继续通过现有 resolver 按需引入，禁止整包导入。
- 保持 TypeScript strict 模式，不降低 `tsconfig.json`、ESLint、Stylelint 或测试规则来绕过问题。

## 仓库架构约定

- `entrypoints/`：WXT 扩展入口。入口文件只负责初始化、依赖装配和生命周期连接，复杂逻辑下沉到对应模块。
- `entrypoints/background/`：后台 Service Worker、消息路由和扩展生命周期逻辑。
- `entrypoints/content/`：页面识别、填充和注入式 UI；避免阻塞页面主线程，不污染宿主页面全局样式或变量。
- `components/`：Vue 展示与交互组件；`composables/`：可复用的响应式状态和副作用；`utils/`：与 Vue 生命周期无关的领域逻辑和纯工具。
- `utils/storage.ts` 与 `utils/storage/` 是存储访问边界；`utils/encryption.ts`、`utils/crypto-light.ts` 和既有会话模块是密码学与会话边界。不要在 UI 或入口中复制这些逻辑。
- 跨入口消息应由后台路由统一处理，并使用 `utils/types.ts` 或就近的类型文件定义判别联合和响应类型。新增消息必须处理未知类型、失败响应和异步通道生命周期。
- Background Service Worker 随时可能被回收。不得把全局内存当作持久事实来源；短期缓存必须可重建、可失效，并以合适的 `chrome.storage` 数据为准。长期任务使用 `chrome.alarms` 等 MV3 机制。
- 注册事件、Port、observer、timer 或 DOM 监听器时，保证幂等初始化并在生命周期结束时清理，防止重复监听和泄漏。

## 安全与隐私基线

- 不记录、上传或暴露主密码、账号、密码、TOTP secret、解密后的条目、恢复数据、剪贴板内容、加密密钥或可推导这些信息的完整对象。
- 运行时代码统一使用 `utils/logger.ts`；禁止直接调用 `console`。日志参数也不得包含敏感数据。构建脚本等工具代码可按现有约定使用 `console`。
- 不扩大明文数据的存活时间、存储位置或可访问上下文。敏感数据只通过既有存储、加密和会话 API 流转，并在锁定、过期和异常路径中执行既有清理逻辑。
- 密码学使用 Web Crypto 和项目现有封装。禁止自创加密算法、固定 IV、弱化 PBKDF2 参数或静默改变密文/备份格式。
- 修改加密、主密码、会话、备份、导入导出或存储结构时，必须保留旧数据兼容性，设计失败回滚路径，并补充成功、失败、旧格式和边界条件测试。
- 把网页 DOM、导入文件、runtime message、storage 数据和外部响应都视为不可信输入：在边界处校验类型、长度、格式和来源，失败时安全降级。
- 禁止对不可信内容使用 `v-html`、`innerHTML`、`eval`、`new Function` 或内联脚本。需要渲染文本时使用转义后的文本节点；确需 HTML 时必须先采用经过审查的净化方案。
- 新增网络请求、遥测、分析、远程资源或任何用户数据外传前必须获得用户明确确认，并同步更新隐私说明。默认保持本地优先、离线可用。
- Chrome 权限遵循最小权限原则。修改 `permissions`、`host_permissions`、CSP 或 content script 匹配范围时，说明必要性并更新相应发布/隐私文档。
- 不把密钥、令牌、真实账号密码或私人数据写入源码、测试夹具、截图、日志、文档或提交记录。

## TypeScript 与通用代码规范

- 优先显式、可读、可测试的实现，避免不必要的设计模式、过度抽象和过早优化。
- 新增代码不使用 `any`；对不可信数据使用 `unknown` 并通过类型守卫收窄。公共数据结构和消息协议使用明确类型或判别联合。
- 同目录文件使用 `./`；其他本地模块使用已配置的 `@/` 别名。类型导入使用 `import type`。
- 公共或复杂 API、关键安全假设和非显然算法使用简洁 JSDoc。不要为直观代码添加复述式注释；注释应解释“为什么”和约束，而不是逐行解释“做什么”。
- 重复逻辑只有在形成稳定职责边界后才抽取。纯逻辑放在 `utils/`，依赖 Vue 响应式或生命周期的逻辑放在 `composables/`，可复用界面放在 `components/`。
- 所有异步边界都应有明确错误处理；面向用户的错误提供可理解反馈，内部错误通过不含敏感数据的日志记录。
- 禁止使用宽泛的 `eslint-disable`、`@ts-ignore` 或降低规则规避问题。确需例外时限制到最小行范围，并说明原因；`utils/logger.ts` 的底层 console 封装属于已知例外。
- TypeScript 类型定义（`interface`、`type` 等）应抽离到独立的 `type.ts` 文件或复用已有接口定义，避免与业务代码耦合。项目级公共类型集中在 `utils/types.ts`，Content Script 类型在 `entrypoints/content/types.ts`。

## Vue 3 与界面规范

- 新增 Vue 代码默认使用 Composition API 和 `<script setup lang="ts">`；SFC 顺序保持 `<script>`、`<template>`、`<style>`。
- 保持单一事实来源：源状态尽量少，派生值使用纯 `computed`，watcher 只承担副作用并正确清理异步任务。
- Props 只读、事件向上。组件边界使用类型化的 `defineProps`、`defineEmits`；只有真正的双向组件契约才使用 `defineModel`。
- 根入口组件保持为组合与装配层。组件同时承担多块 UI、状态编排和副作用时，按职责拆为子组件与 composable；小而单一的实现不为“复用”强行拆分。
- 模板保持声明式；列表使用稳定 primitive key，避免在同一元素混用 `v-if` 与 `v-for`，避免在模板中执行昂贵过滤或排序。
- 组件样式默认 `scoped`，优先 class selector。复用 `assets/theme/tokens.css` 的 `--aph-*` 设计令牌，避免硬编码重复颜色；`:deep()` 仅用于必要的第三方组件覆盖。
- Element Plus 组件与命令式 API 保持按需加载。新增重型或低频功能时评估动态导入，避免扩大 popup、sidepanel 和 content script 的首屏包体积。
- 保持键盘操作、焦点管理、可读标签、对比度和 reduced-motion 等可访问性；不要只用颜色表达状态。

## Chrome 扩展约定

- 只使用 Manifest V3 API；不引入 Manifest V2 API、远程执行代码、内联事件处理器或违反扩展 CSP 的实现。
- 调用 `chrome.*` API 前确认当前上下文可用；Background、content script、popup、options 和 sidepanel 的能力边界不可混用。
- 修改消息处理时验证消息结构和 sender，异步 `sendResponse` 路径必须正确保持通道并保证每条路径都有响应或明确终止。
- Content script 的 DOM 扫描和批量更新应限流、分批或复用缓存；MutationObserver 必须缩小观察范围并支持清理。
- 通过 sidepanel 发起的标签页操作不能假设 `activeTab` 授权；权限与 host access 必须符合实际触发方式。
- 引用扩展图标或资源前确认文件真实存在。图标继续以 `assets/icons/icon.svg` 为源，通过现有脚本生成 `public/icon/` 多尺寸 PNG。
- 用户可见操作失败时给出反馈；不得静默吞掉保存、填充、复制、导入导出、锁定或权限错误。

## 国际化与文档

- 所有新增或修改的用户可见文案同时提供简体中文和英文，不在 Vue/TypeScript 中硬编码可见字符串。
- Vue UI 文案更新 `utils/i18n/locales/zh-CN/` 与 `utils/i18n/locales/en/` 的对应 namespace，并确认相关 `utils/i18n/bundles/` 已注册；manifest 文案更新 `public/_locales/zh_CN/messages.json` 与 `public/_locales/en/messages.json`。
- 新增、删除或重命名 i18n key 时保持中英文 key 集一致，并运行 i18n bundle 测试。
- 文档按影响范围更新，而不是每次机械修改所有文件：
  - 用户功能、安装或用法变化：`README.md` 与 `README.en.md`。
  - 架构、数据流或安全设计变化：`docs/ARCHITECTURE.md` 与 `docs/ARCHITECTURE.en.md`。
  - SidePanel 帮助内容变化：`components/sidepanel/HelpDialog.vue` 及其语言包。
  - 官网展示变化：`index.html`。
  - 商店文案、权限、隐私或发布流程变化：`docs/CWS_FILL_CONTENT.md`、`docs/CWS_PUBLISHING_GUIDE.md`、`privacy.html` 中受影响的部分。
  - manifest 描述、权限、命令或配置变化：`wxt.config.ts` 及对应 locale 文案。
- 中英文文档应表达同一事实；不要只更新一种语言。

## 测试与验证

- 修改前先找到现有测试。修复 bug 时优先添加能在修复前失败、修复后通过的回归测试；新增逻辑覆盖成功、失败和关键边界。
- 开发过程中运行最小相关测试；交付前根据改动范围执行：
  - TypeScript/Vue/运行时代码：`pnpm typecheck`、`pnpm lint`、相关 `pnpm test:run -- <test-file>`。
  - 通用逻辑、存储、加密、会话、消息路由或跨入口改动：`pnpm test:run`。
  - Vue/CSS/SCSS 样式：`pnpm lint:style`。
  - 入口、manifest、WXT/Vite 配置、依赖或打包行为：`pnpm build`；涉及 Firefox 时同时运行 `pnpm build:firefox`。
  - 文档、JSON 和其他格式改动：对本次修改文件运行 `pnpm exec prettier --check <files...>`。
- 不使用会改写整个仓库的 `pnpm format` 或 `pnpm fix:all` 处理局部任务；需要自动修复时只作用于本次修改文件。
- 不为通过测试而弱化断言、删除测试、跳过测试或隐藏错误。若命令因既有问题、环境限制或时间成本无法运行，交付时准确说明未验证项和原因。

## 项目特有约定

### 双重 i18n 体系

- **完整 i18n**（`utils/i18n/`）：用于 Vue UI（Options、SidePanel、Popup），支持响应式语言切换，文案写在 `utils/i18n/locales/zh-CN/` 与 `en/` 的 namespace 文件中。
- **轻量 i18n**（`utils/i18n-lite.ts`）：用于 Content Script 和 Background，提供 `tl()` 函数，体积极小，不拉入 Vue 响应式开销。
- 两套体系的文案 key 独立维护，新增可见文案时必须同时更新两套体系的中英文。

### Content Script Shadow DOM 隔离

- 悬浮按钮（`floatingButtons/`）和内联填充（`inlineDropdown/`）使用 **Closed Shadow DOM** 完全隔离宿主页面样式。
- Shadow DOM 内部使用 `all: initial` 重置 + 内联写入 `--aph-*` 主题令牌，确保跟随整体换肤。
- 不得将 Shadow DOM 内部的引用暴露给宿主页面，也不得在 Shadow DOM 内依赖外部全局样式。

### ESLint 已知例外

- `@typescript-eslint/no-explicit-any` 已关闭（表单验证器等场景广泛使用）。
- `vue/multi-word-component-names` 已关闭。
- `no-console` 设为 warn，仅允许 `console.warn` 和 `console.error`；运行时代码仍应使用 `utils/logger.ts`。
- `lint-staged` 在提交前自动对变更文件执行 ESLint + Prettier + Stylelint 检查。

## 常见陷阱

### Service Worker

- **禁止把全局内存当持久状态**：SW 随时被回收，重启后全局变量丢失。短期缓存必须可重建、可失效，以 `chrome.storage` 为事实来源。
- **异步 `sendResponse` 必须返回 `true`**：否则 Chrome 会立即关闭消息通道，响应丢失。
- **`chrome.alarms` 最小间隔**：MV3 限制 alarms 最小间隔为 1 分钟，不要期望秒级精度。

### Storage

- **`storage.session` vs `storage.local`**：前者仅内存（浏览器关闭即清，Content Script 不可访问），后者持久化。混淆两者会导致数据丢失或安全泄露。
- **`storage.session` 的 `accessLevel`**：写入敏感数据时确认 `accessLevel` 为 `TRUSTED_CONTEXTS`（默认值），防止 Content Script 读取。
- **Windows 慢磁盘**：`storage.local` 大对象写入在 Windows 上可能触发杀毒软件扫描导致数百毫秒延迟，避免在热路径上频繁读写大对象。

### Content Script

- **宿主页面污染**：Content Script 与宿主页面共享 DOM 但不共享 JS 全局变量。避免依赖页面全局函数或变量。
- **Shadow DOM 样式泄漏**：Closed Shadow DOM 内部使用 `all: initial` 重置，主题令牌必须内联写入，不能依赖外部 CSS 类。
- **MutationObserver 范围**：必须缩小 `observe` 范围（指定 `subtree`、`childList` 等），并在组件销毁时 `disconnect()`。

### Element Plus

- **禁止整包导入**：必须通过 `unplugin-vue-components` + `ElementPlusResolver` 按需引入。
- **命令式 API 需显式声明**：`ElMessage`、`ElMessageBox` 等需在 `wxt.config.ts` 的 `AutoImport` 配置中显式列出。
- **样式格式**：使用 CSS（非 SCSS），由 resolver 自动导入。

### 国际化

- **中英文 key 必须一致**：新增、删除或重命名 i18n key 时，`zh-CN/` 和 `en/` 必须同步更新。
- **双重体系同步**：Vue UI 文案更新 `utils/i18n/locales/`，Content/Background 文案更新 `utils/i18n-lite.ts` 对应条目。

### 跨入口消息

- **Background 是路由中心**：所有跨入口通信必须经 Background 转发，不要尝试直接从一个入口向另一个入口 `sendMessage`。
- **SidePanel 使用 Port**：SidePanel 通过 `chrome.runtime.connect()` 建立 Port 连接（非 `sendMessage`），Background 按窗口维护 Port 集合。
- **新增消息类型**：必须处理未知类型降级、失败响应和异步通道生命周期，使用判别联合类型定义消息结构。

## 性能约束

### 侧边栏秒开 SLA

- 侧边栏在所有场景（会话有效/失效/浏览器冷启动/快速重启）必须秒开（<1s、无白屏），这是跨平台硬性目标。
- `sidePanel.open()` 之前禁止 `await`，保持用户手势链完整；tabId 经 `getTabIdSync` 同步获取。

### 首屏体积

- 首屏 chunk 保持精简，重型依赖（如 `pinyin-match`、`jsqr`）通过动态 `import()` 拆分为独立 chunk，首帧后空闲预热。
- Element Plus 通过 resolver 按需引入，禁止整包导入。

### Service Worker 保活

- 统一常驻策略：20s 心跳 + 0.5min 复活闹钟，会话失效后也不停止。这是消除冷启动白屏的主动设计取舍。
- 保活业务价值：会话有效期内保持密码缓存常驻，侧边栏走缓存快路径（约 20-50ms）。

### 资源预热

- 平台差异化预热：Windows 全量（~25 文件）/ Mac 轻量白名单（~15 文件），共用 5min 节流。
- 预热触发时机：窗口聚焦 / Tab 激活 / 保活闹钟 tick / 侧边栏打开后延时 5s。
- 浏览器首启与扩展安装/更新时经 `ignorePlatformGate` 跨平台全量预热。

### 数据加载

- 三路竞速：`storage.session` 加密快照 + Background `GET_INITIAL_DATA` + SidePanel 本地 storage 并行，任一路失败不终止其他路径。
- 所有异步提交受会话代际/最新请求序号保护，避免锁定或 rekey 后旧结果写回 UI。

### 白屏排查指南

- **会话失效态白屏**：源于 SW 冷启动 + storage 读取延迟，检查保活和预热是否正常工作。
- **B 类白屏**（渲染进程已创建但 UI 未渲染）：检查 CSS 是否阻塞（sidepanel 非阻塞 CSS 加载机制）或 chunk 加载失败。
- **Windows 白屏**：与杀毒软件扫描和慢磁盘相关，确保全量预热 + 常驻保活正常工作。

## 完成标准

- 需求已满足，既有功能、交互、数据和安全边界未发生未经确认的变化。
- 已自查 diff，确认没有敏感数据、调试代码、无关改动、重复实现或未处理的异常路径。
- 相关测试、类型检查、lint、stylelint、格式和构建按上述矩阵通过，或已明确报告限制。
- 交付说明包含：改了什么、关键设计原因、执行了哪些验证、仍存在什么风险或未验证项。
