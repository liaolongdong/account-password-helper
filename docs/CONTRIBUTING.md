# Account Password Helper — 贡献指南

**中文** | [English](#account-password-helper--contributing-guide)

你好！感谢你对 **Account Password Helper** 感兴趣。在提交贡献之前，请先阅读以下指南，以确保你的贡献能够被顺利接受。

## 项目简介

Account Password Helper 是一款基于 Chrome 扩展的本地加密账号密码管理工具，面向开发者与测试人员：精确域名匹配区分多环境账号、一键登录（自动填充 → 自动勾选「记住我 / 同意条款」→ 自动点击登录；其中 `Ctrl+Shift+F` 只做填充与勾选，点击登录由侧边栏「填充并登录」或可选的「自动触发登录」偏好（默认关闭）触发）、内置 TOTP 两步验证与安全体检。采用 PBKDF2 + AES-256-GCM 加密体系，密码数据不出本机（唯一外发请求是每 6 小时一次的匿名版本检查，不携带任何用户数据），无需注册账号。项目基于 [GPL-3.0-only](../LICENSE) 开源协议。

> 📖 面向用户的安装与使用说明请见 [README](../README.md)。

## 技术栈

| 类别      | 技术                                                                              | 版本 / 说明                                                                                   |
| --------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 扩展框架  | [WXT](https://wxt.dev/)                                                           | v0.20.27，基于 Manifest V3                                                                    |
| 前端框架  | [Vue 3](https://vuejs.org/) + TypeScript                                          | v3.5.41，Composition API + `<script setup>`                                                   |
| UI 组件库 | [Element Plus](https://element-plus.org/)                                         | v2.14.4，按需引入（unplugin-vue-components + unplugin-auto-import，均用 ElementPlusResolver） |
| 加密      | [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) | PBKDF2 + AES-256-GCM + SHA-256，浏览器原生                                                    |
| 拼音搜索  | [pinyin-match](https://github.com/xmflswood/pinyin-match)                         | v1.2.10，拼音首字母模糊匹配                                                                   |
| 构建工具  | [Vite](https://vitejs.dev/)                                                       | v8.2.1（Rolldown 内核），由 WXT 驱动，HMR 热更新                                              |
| 测试框架  | [Vitest](https://vitest.dev/)                                                     | v4.1.11，Node 环境 + Web Crypto 原生支持                                                      |
| 代码规范  | ESLint + Prettier + Stylelint                                                     | TS v6，完整质量工具链                                                                         |

## 架构概览

### 扩展入口点

| 入口点             | 职责                                                                 |
| ------------------ | -------------------------------------------------------------------- |
| **Background**     | Service Worker：消息路由、密码缓存、侧边栏状态追踪、快捷键处理       |
| **Content Script** | 注入所有页面，初始化表单检测与悬浮按钮                               |
| **Popup**          | 扩展图标弹窗，提供「管理密码」和「快速填充」快捷入口                 |
| **Options**        | 密码管理主页面，完整 CRUD、导入导出、会话/有效期管理                 |
| **SidePanel**      | 侧边栏快速填充，支持拼音智能搜索与命中高亮、排序、域名匹配、缓存加速 |

### 消息与数据流

```mermaid
graph LR
    CS[Content Script] -->|sendMessage| BG[Background]
    SP[SidePanel] -->|Port connect| BG
    Popup -->|sendMessage| BG
    Options -->|sendMessage| BG
    BG --> Storage[StorageUtils]
    BG --> Session[SessionManager]
    BG --> Encryption[Encryption]
```

- Background 作为消息路由中心，处理跨组件通信
- SidePanel 通过 `chrome.runtime.connect()` 建立 Port，用于可靠状态追踪
- Content Script 通过 `chrome.runtime.sendMessage()` 发送消息

### 加密机制核心

```
主密码 + 盐值(16 随机字节) → PBKDF2-SHA256 (600,000 次迭代) → 256-bit 密钥
明文 + 密钥 + 每次新随机的 12 字节 IV → AES-256-GCM → Base64(IV ‖ 密文 ‖ 16 字节认证标签)
```

> 📖 完整架构设计（会话生命周期、加密细节、消息流说明）与逐文件注释的项目结构树见 [docs/ARCHITECTURE.md](./ARCHITECTURE.md)。

## 项目结构

```
.
├── entrypoints/        # WXT 扩展入口点
│   ├── background/     # Service Worker 子模块（消息路由/缓存/侧边栏管理/自动保存/后台服务）
│   ├── content/        # Content Script（表单检测/悬浮按钮/内联填充）
│   ├── popup/          # Popup 弹窗页
│   ├── options/        # 设置页（密码管理主界面）
│   └── sidepanel/      # 侧边栏快速填充
├── components/         # Vue 组件
│   ├── options/        # Options 页面组件（表格/弹窗/设置对话框等）
│   └── sidepanel/      # SidePanel 侧边栏组件
├── composables/        # Vue 组合函数（认证、会话、侧边栏、TOTP、快捷键等）
├── utils/              # 核心工具库
│   ├── storage/        # 存储访问子模块
│   ├── i18n/           # 完整 i18n（Vue UI：Options/SidePanel/Popup）
│   ├── i18n-lite.ts    # 轻量 i18n（Content/Background，tl() 函数）
│   ├── encryption.ts   # 加密核心（PBKDF2 + AES-256-GCM）
│   ├── sessionManager.ts # 会话管理
│   └── ...             # 其他工具（备份、安全体检、域名匹配、密码生成等）
├── assets/             # 源 SVG 图标与主题 CSS Design Tokens
├── public/icon/        # 构建期 PNG 产物（WXT 自动注入 manifest）
├── types/              # 全局 TypeScript 类型声明
├── scripts/            # 图标生成与仓库自动化脚本
├── tests/              # 测试用例
└── wxt.config.ts       # WXT 配置（路径别名、Element Plus 按需引入、非阻塞 CSS）
```

> 📖 完整的逐文件注释结构树见 [docs/ARCHITECTURE.md — 项目结构](./ARCHITECTURE.md#项目结构)。

## 环境要求

- **Node.js**：`package.json` 未声明 `engines` 字段，实际下限由工具链决定 —— WXT 要求 `>=20.12.0`，Vitest 接受 `^20 || ^22 || >=24`，**Vite 8.2.1 要求 `^20.19.0 || >=22.12.0`（这是最高、也就是真正生效的下限）**。换言之 Node 20.11.x 一类的早期 20.x 会直接跑不起来。CI 固定使用 **Node 22**，建议本地与其一致。
- **包管理器**：`pnpm@10.12.1`（`package.json` 的 `packageManager` 字段，配合 corepack 自动切换），请勿混用 npm / yarn。
- **Chrome**：manifest 未声明 `minimum_chrome_version`（该配置当前被注释掉），代码按 Chrome 114+（SidePanel API）、116+（`runtime.getContexts`）、129+（`sidePanel.close`，含降级路径）编写。

## 仓库搭建

1. Fork 本仓库并 clone 到本地。

2. 安装依赖：

   ```sh
   pnpm install
   ```

3. 启动开发模式（Chrome）：

   ```sh
   pnpm dev
   ```

4. 在 Chrome 中加载 `.output/chrome-mv3-dev/` 目录（开发模式产物；`pnpm build` 的产物在 `.output/chrome-mv3/`）。

### Windows 用户提示

如果在 Windows 上遇到符号链接相关问题，建议[启用开发者模式](https://docs.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development)。

## 常用命令

| 命令                                                | 说明                                                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                          | 开发模式（HMR 热更新，端口 8899，产物 `.output/chrome-mv3-dev/`）                                                 |
| `pnpm dev:firefox`                                  | Firefox 开发模式                                                                                                  |
| `pnpm build`                                        | 生产构建（产物 `.output/chrome-mv3/`）                                                                            |
| `pnpm prebuild` / `pnpm postbuild`                  | 构建前自动渲染图标 / 构建后自动 `wxt zip` 产出 `.output/account-password-helper-<ver>-chrome.zip`（无需手动调用） |
| `pnpm build:firefox`                                | Firefox 生产构建（产物 `.output/firefox-mv2/`，MV2）                                                              |
| `pnpm analyze` / `pnpm analyze:firefox`             | 构建并可视化分析打包体积（Chrome / Firefox，输出 `dist/stats.html`）                                              |
| `pnpm icons:build`                                  | SVG 图标渲染为多尺寸 PNG（`public/icon/`）                                                                        |
| `pnpm gen:en` / `gen:privacy-en` / `gen:pricing-en` | 由中文源页面生成 `en.html` / `privacy.en.html` / `pricing.en.html`                                                |
| `pnpm gen:blog`                                     | 由 `docs/blog/{zh,en}/*.md` 生成 `blog/*.html`                                                                    |
| `pnpm covers:render`                                | 渲染博客封面图                                                                                                    |
| `pnpm typecheck`                                    | TypeScript 类型检查                                                                                               |
| `pnpm lint` / `pnpm lint:fix`                       | ESLint 检查 / 自动修复                                                                                            |
| `pnpm lint:style` / `pnpm lint:style:fix`           | Stylelint 样式检查 / 自动修复                                                                                     |
| `pnpm format:check` / `pnpm format`                 | Prettier 格式检查 / 格式化                                                                                        |
| `pnpm lint:all` / `pnpm fix:all`                    | 运行所有检查（lint + stylelint + format） / 全部自动修复                                                          |
| `pnpm test` / `pnpm test:run`                       | 运行测试（watch 模式） / 单次运行全部测试                                                                         |
| `pnpm test:run -- <file>`                           | 运行单个测试文件                                                                                                  |
| `pnpm coverage`                                     | 运行测试并生成覆盖率报告                                                                                          |
| `pnpm auto-merge`                                   | 将 `main` 的改动自动合并回当前分支（脚本 `scripts/auto-merge-main.js`）                                           |
| `pnpm prepare`                                      | 安装 husky Git hooks（`pnpm install` 时由 npm 自动触发）                                                          |

> ⚠️ `blog/*.html`、`en.html`、`privacy.en.html`、`pricing.en.html`、封面图与 `public/icon/*.png` 都是**生成产物**，禁止手改；请修改其 Markdown / SVG 源文件后执行对应 `gen:*` / `icons:build` / `covers:render` 重新生成。

> 📖 图标工作流、测试页面、性能设计等开发细节见 [docs/ARCHITECTURE.md — 开发补充](./ARCHITECTURE.md#开发补充)。

## Chrome 权限说明

| 权限             | 用途                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`        | 保存密文条目、配置与会话密钥材料。仅使用 `chrome.storage.local`（持久密文）与 `chrome.storage.session`（内存态密钥 / 快照），不使用 `storage.sync` 或 `storage.managed` |
| `activeTab`      | 用户主动触发（快捷键、扩展图标、右键菜单、悬浮按钮）时取得当前标签页地址与句柄，用于定位要填充的登录表单                                                                |
| `scripting`      | 内容脚本未就绪时按 frame 补注入（`utils/contentScriptReadiness.ts` 的 `chrome.scripting.executeScript`）                                                                |
| `sidePanel`      | 侧边栏快速填充功能                                                                                                                                                      |
| `alarms`         | 5 类定时任务：SW 保活复活（0.5min）、版本检查（360min）、密码到期提醒检查（12h）、回收站清理（24h）、自动备份提醒（按用户设定天数）                                     |
| `notifications`  | 桌面通知：自动保存、自动备份提醒、版本更新、密码到期提醒、快速填充结果反馈、「需要解锁」（点击直达主密码验证页）                                                        |
| `idle`           | 主动闲置锁定检测（OS 锁屏 / 屏保 / 空闲）；该功能默认关闭，开启后生效                                                                                                   |
| `clipboardWrite` | 写入剪贴板（复制密码 / TOTP）                                                                                                                                           |
| `clipboardRead`  | 读取剪贴板（清除前比对内容，避免误清用户新复制的内容）                                                                                                                  |
| `webNavigation`  | 通过 `chrome.webNavigation.getAllFrames` 枚举框架，实现跨 iframe 填充（仅查询，不监听导航事件）                                                                         |
| `contextMenus`   | 右键菜单：可编辑字段的「填充用户名 / 填充密码 / 填充两步验证码 / 生成并填充强密码」与页面级「打开侧边栏 / 打开密码管理页」                                              |
| `favicon`        | 读取 Chrome 本地缓存的网站图标，零外部网络请求                                                                                                                          |
| `<all_urls>`     | Content Script 匹配所有页面（host_permission）                                                                                                                          |

## CSV / JSON 字段格式

| 中文列名            | 英文列名                | 必填 | 说明                             |
| ------------------- | ----------------------- | ---- | -------------------------------- |
| 用户名 / 账号       | username / Username     | 是   | 账号/邮箱/手机号                 |
| 密码                | password / Password     | 否   | 登录密码                         |
| URL / 网址 / 链接   | url                     | 否   | 网站地址                         |
| 标签 / 分类         | tag / Tag               | 否   | 分类标签                         |
| 备注 / 说明         | remark / Remark         | 否   | 说明信息                         |
| 两步验证            | TOTP                    | 否   | TOTP 密钥（otpauth:// URI 格式） |
| 创建时间            | createTime / CreateTime | 否   | 自动填充                         |
| 更新时间 / 修改时间 | updateTime / modifyTime | 否   | 自动填充                         |

> 「下载模板」会生成标准 CSV 文件（BOM UTF-8，Excel / Numbers 可直接打开），表头跟随界面语言，中英文表头均可被导入自动识别。JSON 导出为 `{ version, exportedAt, count, entries }` 包裹结构，导入时同时兼容扁平数组格式；导入导出文件名格式为 `passwords_YYYYMMDD_HHmmss.csv/.json`。

## 开发规范

### 代码风格

- 使用 ESLint 进行静态代码分析，使用 Prettier 进行代码格式化。
- CSS/样式代码使用 Stylelint 检查，并遵循属性排序规范（recess-order）。
- 新增代码必须通过以下命令检查：

  ```sh
  pnpm lint:all
  ```

### 日志规范

- ESLint 规则为 `no-console: ['warn', { allow: ['warn', 'error'] }]`，且 `pnpm lint` 带 `--max-warnings 0`，因此运行时代码中的 `console.log` 会直接导致检查失败；`console.warn` / `console.error` 虽被规则放行，项目约定仍要求统一走 `utils/logger.ts`（该文件自身有最小范围的豁免注释）。构建脚本等工具代码可直接使用 `console`。
- 必须使用 `utils/logger.ts` 封装的日志方法，例如：

  ```ts
  import { logger } from '@/utils/logger';

  logger.info('这条消息会打印');
  logger.warn('这条警告会打印');
  logger.error('这条错误会打印');
  ```

### 路径别名

- 同级目录文件使用 `./` 相对路径引入。
- 其他目录的文件统一使用 `@/` 路径别名引入：

  ```ts
  import { StorageUtils } from '@/utils/storage';
  ```

### 组件规范

- Vue 组件使用 Composition API（`<script setup lang="ts">`）。
- Element Plus 组件按需引入，新增组件请确认已在自动导入配置中。
- 所有公共组件放在 `components/` 目录下。

### 国际化

- 所有新增或修改的用户可见文案同时提供简体中文和英文。
- Vue UI 文案更新 `utils/i18n/locales/zh-CN/` 与 `en/` 的对应 namespace。
- Content Script 和 Background 文案更新 `utils/i18n-lite.ts` 对应条目。
- 新增、删除或重命名 i18n key 时保持中英文 key 集一致。

### Git Hooks

项目已配置 `husky` + `lint-staged`，每次 `git commit` 前会自动对变更文件执行：

- `eslint --fix` + `prettier --write`（TypeScript / Vue / JS 文件）
- `stylelint --fix`（CSS / SCSS / Vue 样式文件）
- `prettier --write`（JSON / Markdown 文件）

请确保提交前所有检查通过。

### 测试规范

- 使用 Vitest 进行单元测试，测试文件放在 `tests/` 目录下，与源码目录结构对应。
- 修复 Bug 时优先添加回归测试（修复前失败、修复后通过）。
- 新增逻辑需覆盖成功、失败和关键边界条件。
- 修改代码前先检查现有测试，确保不破坏已有测试。
- 提交前根据改动范围运行相关测试：

  ```sh
  pnpm test:run                       # 运行全部测试
  pnpm test:run -- tests/utils/xxx.ts # 运行单个测试文件
  ```

- 不得为通过测试而弱化断言、删除测试或跳过测试。
- 需要 DOM 的用例（如注入式叠加 UI 的布局跟随 / 位置还原生命周期）不改全局环境，在文件首行加 `/** @vitest-environment jsdom */` 逐文件启用；`vitest.config.ts` 的默认环境始终是 `node`，以免拖慢常态纯逻辑用例。
- jsdom 不提供真实布局（`getBoundingClientRect()` 恒为 0、`offsetWidth/offsetHeight` 恒为 0、`getComputedStyle()` 对未声明属性返回空串），此类量测由 `tests/helpers/domLayout.ts` 的 `installDomLayout()` 装置接管，并提供可手动推进的 rAF 队列与跨读写有序日志（可断言「是否排帧」与「先全读后全写」）；装置自带自检用例，新增量测必须回带校验字段，防止样式未命中时产出看似合理实则全错的数字。
- `.vue` 组件挂载渲染测试暂不支持：`@vitejs/plugin-vue`（v6.0.8，随 `@wxt-dev/module-vue` 引入）已可用，但未安装 `@vue/test-utils`，因此 Vue 侧交互链路只覆盖到状态所有者（composable / 纯函数）为止。`.vue` 文件本身仍以文本方式被 `tests/utils/i18nBundles.test.ts` 静态扫描（校验各依赖图只使用其已注册命名空间的 `t()` key），并非完全无测试触达。

### 快捷键

扩展注册了以下快捷键（可在 `chrome://extensions/shortcuts` 中自定义）：

| 快捷键（Windows/Linux） | 快捷键（Mac）     | 功能             |
| ----------------------- | ----------------- | ---------------- |
| `Ctrl+Shift+P`          | `Command+Shift+P` | 打开选项页       |
| `Ctrl+Shift+L`          | `Command+Shift+L` | 切换侧边栏       |
| `Ctrl+Shift+F`          | `Command+Shift+F` | 一键填充         |
| `Ctrl+Shift+K`          | `Command+Shift+K` | 打开内联下拉面板 |

> `quick_fill` 在 `quickFillHandler.ts` 中硬编码 `autoLogin: false`，因此 `Ctrl+Shift+F` 只做「填充 + 勾选」，不会点击登录按钮；点击登录仅来自侧边栏「填充并登录」或可选的「自动触发登录」偏好（默认关闭）。
> Chrome 未提供 `chrome.commands.update()`，且 4 个命令槽位已用满配额，因此应用内的快捷键列表为**只读**，仅提供跳转 `chrome://extensions/shortcuts` 的入口；新增快捷键需要先腾出命令槽，不能指望应用内改键。

### 安全与隐私

本项目是密码管理器，安全是最高优先级。贡献代码时请务必遵守以下原则：

- **禁止**在源码、测试、日志、文档或提交记录中包含真实密码、密钥、令牌等敏感数据。
- **禁止**使用 `v-html`、`innerHTML`、`eval` 或内联脚本处理不可信内容。
- 运行时代码统一使用 `utils/logger.ts`，日志参数不得包含敏感数据。
- 不得扩大明文敏感数据的存活时间、存储位置或可访问上下文。
- 不得自创加密算法或修改现有加密参数（PBKDF2 迭代次数、AES 模式、IV 生成等）。
- 新增网络请求、遥测或远程资源加载前必须获得用户明确确认，默认保持本地优先、离线可用。当前唯一已获批的出站行为是 `utils/updateChecker.ts` 的匿名版本检查（不携带任何用户数据），它属于既有例外，不是待修的问题。
- Chrome 权限遵循最小权限原则，新增权限需说明必要性。

## Pull Request 指南

> 你不需要事先征求许可就可以开始处理一个公开的 Issue。如果有人先提交了修复，你仍然可以通过代码 Review 或验证来参与。

- 从 `main` 分支切出一个 topic branch 进行开发，完成后合并回 `main`。

- **新增功能：**
  - 附带适当的测试或用例说明。
  - 提供清晰的功能描述和使用场景。建议先开一个 Issue 进行讨论，获得认可后再开发。

- **修复 Bug：**
  - 在 PR 标题中标注对应的 Issue 编号，例如：`fix: 修复侧边栏关闭失败 (fix #123)`。
  - 在 PR 描述中详细说明问题原因和复现步骤。
  - 提供修复的测试覆盖，如不适用请在描述中说明原因。

- **代码重构 / 文案修改：**
  - 多处拼写或注释修正请合并到同一个 PR。
  - 不鼓励纯粹为了代码风格的重构提交。代码重构需有明确的性能改善或可维护性提升理由。

- PR 中可以包含多个小提交，GitHub 会在合并时自动 squash。

- PR 标题需遵循 [约定式提交（Conventional Commits）](https://www.conventionalcommits.org/) 规范：

  ```
  feat: 新增自动登录开关功能
  fix: 修复密码导出文件名缺少日期后缀
  refactor: 重构表单检测逻辑
  docs: 更新 README 使用说明
  chore: 升级 WXT 版本
  ```

- **提交前检查清单：**

  ```sh
  pnpm typecheck          # TypeScript 类型检查
  pnpm lint               # ESLint 检查
  pnpm lint:style         # Stylelint 样式检查
  pnpm format:check       # Prettier 格式检查
  pnpm test:run           # 运行全部测试（或按需运行相关测试文件）
  pnpm build              # 生产构建验证
  ```

> ⚠️ **CI 现状**：`.github/workflows/release-please.yml` 只执行 `pnpm install` + `pnpm run build`，`static.yml` 只构建 Pages 站点——**云端不跑测试、lint、typecheck**。上述检查只由本地 `husky` + `lint-staged` 钩子对变更文件执行，因此跳过本地检查的 PR 不会被 CI 拦下。
>
> 版本号与 `CHANGELOG.md` 由 release-please 自动管理，PR 中请勿手改这两个文件。

## Issue 指南

- 提交 Issue 前请先搜索是否已有相同问题的讨论。
- Bug 报告请提供：
  - Chrome 版本和操作系统版本。
  - 插件版本号。
  - 复现步骤（越详细越好）。
  - 期望行为与实际行为的对比。
  - 截图或录屏（如适用）。
- 功能建议请说明：
  - 使用场景和背景。
  - 期望的交互方式。
  - 是否有类似功能的参考实现。

## 行为准则

- 保持友善、尊重和包容的沟通氛围。
- 专注于技术讨论，避免无关的争论。
- 欢迎各种水平的贡献者参与。

感谢你的贡献！

---

# Account Password Helper — Contributing Guide

**[中文](#account-password-helper--贡献指南)** | English

Hello! Thank you for your interest in **Account Password Helper**. Please read the following guidelines before contributing to ensure your contribution can be accepted smoothly.

## About the Project

Account Password Helper is a local-first Chrome extension for managing account credentials, built for developers and QA engineers: exact-domain matching for multi-environment accounts, one-click login (autofill → auto-tick remember-me/consent → auto-click login; `Ctrl+Shift+F` only fills and ticks, while the click comes from the side panel's "Fill and sign in" action or the opt-in "Auto-submit login" preference (off by default)), built-in TOTP 2FA and security audit. PBKDF2 + AES-256-GCM encryption keeps credential data on the device — the only outbound call is an anonymous version check that carries no user data — and no account is needed. Licensed under [GPL-3.0-only](../LICENSE).

> 📖 For user-facing installation and usage instructions, see [README](../README.en.md).

## Tech Stack

| Category      | Technology                                                                        | Version / Notes                                                                                   |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Framework     | [WXT](https://wxt.dev/)                                                           | v0.20.27, Manifest V3                                                                             |
| Frontend      | [Vue 3](https://vuejs.org/) + TypeScript                                          | v3.5.41, Composition API + `<script setup>`                                                       |
| UI library    | [Element Plus](https://element-plus.org/)                                         | v2.14.4, on-demand (unplugin-vue-components + unplugin-auto-import, both via ElementPlusResolver) |
| Encryption    | [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) | PBKDF2 + AES-256-GCM + SHA-256, native                                                            |
| Pinyin search | [pinyin-match](https://github.com/xmflswood/pinyin-match)                         | v1.2.10, pinyin initial fuzzy matching                                                            |
| Build         | [Vite](https://vitejs.dev/)                                                       | v8.2.1 (Rolldown core), driven by WXT, HMR                                                        |
| Testing       | [Vitest](https://vitest.dev/)                                                     | v4.1.11, Node env + Web Crypto native                                                             |
| Code quality  | ESLint + Prettier + Stylelint                                                     | TS v6, full quality toolchain                                                                     |

## Architecture Overview

### Entrypoints

| Entrypoint         | Responsibility                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Background**     | Service worker: message routing, password cache, side panel state, shortcuts                                   |
| **Content Script** | Injected into all pages; initializes form detection and the floating button                                    |
| **Popup**          | Extension icon popup with "Manage Passwords" and "Quick Fill" entries                                          |
| **Options**        | Main manager page: full CRUD, import/export, session/validity management                                       |
| **SidePanel**      | Quick fill panel with pinyin smart search and match highlighting, sorting, domain matching, cache acceleration |

### Message & Data Flow

```mermaid
graph LR
    CS[Content Script] -->|sendMessage| BG[Background]
    SP[SidePanel] -->|Port connect| BG
    Popup -->|sendMessage| BG
    Options -->|sendMessage| BG
    BG --> Storage[StorageUtils]
    BG --> Session[SessionManager]
    BG --> Encryption[Encryption]
```

- Background acts as the message routing center for cross-component communication
- SidePanel establishes a Port via `chrome.runtime.connect()` for reliable state tracking
- Content Script sends messages via `chrome.runtime.sendMessage()`

### Encryption Core

```
Master password + salt (16 random bytes) → PBKDF2-SHA256 (600,000 iterations) → 256-bit key
Plaintext + key + a fresh random 12-byte IV per call → AES-256-GCM → Base64(IV ‖ ciphertext ‖ 16-byte auth tag)
```

> 📖 Full architecture design (session lifecycle, encryption details, messaging notes) and the fully annotated project structure tree live in [docs/ARCHITECTURE.en.md](./ARCHITECTURE.en.md).

## Project Structure

```
.
├── entrypoints/        # WXT extension entrypoints
│   ├── background/     # Service Worker sub-modules (routing/cache/sidebar/autosave/services)
│   ├── content/        # Content Script (form detection/floating buttons/inline fill)
│   ├── popup/          # Popup page
│   ├── options/        # Options page (password manager main UI)
│   └── sidepanel/      # Side panel quick fill
├── components/         # Vue components
│   ├── options/        # Options page components (tables/dialogs/settings)
│   └── sidepanel/      # SidePanel components
├── composables/        # Vue composables (auth, session, side panel, TOTP, shortcuts...)
├── utils/              # Core library
│   ├── storage/        # Storage access sub-modules
│   ├── i18n/           # Full i18n (Vue UI: Options/SidePanel/Popup)
│   ├── i18n-lite.ts    # Lightweight i18n (Content/Background, tl() function)
│   ├── encryption.ts   # Encryption core (PBKDF2 + AES-256-GCM)
│   ├── sessionManager.ts # Session management
│   └── ...             # Other utilities (backup, health check, domain, password gen...)
├── assets/             # Source SVG icons and CSS design tokens
├── public/icon/        # Build-time PNG icons (auto-injected into the manifest by WXT)
├── types/              # Global TypeScript type declarations
├── scripts/            # Icon generation and repo automation scripts
├── tests/              # Test cases
└── wxt.config.ts       # WXT configuration (aliases, Element Plus on-demand, non-blocking CSS)
```

> 📖 See [docs/ARCHITECTURE.en.md — Project Structure](./ARCHITECTURE.en.md#project-structure) for the fully annotated tree.

## Requirements

- **Node.js**: `package.json` declares no `engines` field; the real floor comes from the toolchain — WXT requires `>=20.12.0`, Vitest accepts `^20 || ^22 || >=24`, Vite accepts `^20.19.0 || >=22.12.0`. CI pins **Node 22**, so matching it locally is recommended.
- **Package manager**: `pnpm@10.12.1` (the `packageManager` field, works with corepack). Do not mix npm / yarn.
- **Chrome**: the manifest declares no `minimum_chrome_version` (that key is currently commented out). The code targets Chrome 114+ (SidePanel API), 116+ (`runtime.getContexts`) and 129+ (`sidePanel.close`, with a fallback path).

## Getting Started

1. Fork this repository and clone it locally.

2. Install dependencies:

   ```sh
   pnpm install
   ```

3. Start dev mode (Chrome):

   ```sh
   pnpm dev
   ```

4. Load the `.output/chrome-mv3-dev/` directory as an unpacked extension in Chrome (`pnpm build` outputs to `.output/chrome-mv3/`).

### Windows Tips

If you encounter symlink issues on Windows, consider [enabling Developer Mode](https://docs.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development).

## Common Commands

| Command                                             | Description                                                                                                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                          | Dev mode (HMR, port 8899, output `.output/chrome-mv3-dev/`)                                                                                     |
| `pnpm dev:firefox`                                  | Firefox dev mode                                                                                                                                |
| `pnpm build`                                        | Production build (output `.output/chrome-mv3/`)                                                                                                 |
| `pnpm prebuild` / `pnpm postbuild`                  | Renders icons before the build / runs `wxt zip` after it, producing `.output/account-password-helper-<ver>-chrome.zip` (both run automatically) |
| `pnpm build:firefox`                                | Firefox production build (output `.output/firefox-mv2/`, MV2)                                                                                   |
| `pnpm analyze` / `pnpm analyze:firefox`             | Build with bundle size visualization (Chrome / Firefox, `dist/stats.html`)                                                                      |
| `pnpm icons:build`                                  | Render the SVG icon to multi-size PNGs (`public/icon/`)                                                                                         |
| `pnpm gen:en` / `gen:privacy-en` / `gen:pricing-en` | Generate `en.html` / `privacy.en.html` / `pricing.en.html` from the Chinese source pages                                                        |
| `pnpm gen:blog`                                     | Generate `blog/*.html` from `docs/blog/{zh,en}/*.md`                                                                                            |
| `pnpm covers:render`                                | Render the blog cover images                                                                                                                    |
| `pnpm typecheck`                                    | TypeScript type checking                                                                                                                        |
| `pnpm lint` / `pnpm lint:fix`                       | ESLint check / auto-fix                                                                                                                         |
| `pnpm lint:style` / `pnpm lint:style:fix`           | Stylelint check / auto-fix                                                                                                                      |
| `pnpm format:check` / `pnpm format`                 | Prettier format check / format                                                                                                                  |
| `pnpm lint:all` / `pnpm fix:all`                    | Run all checks (lint + stylelint + format) / all auto-fixes                                                                                     |
| `pnpm test` / `pnpm test:run`                       | Run tests (watch mode) / single run all tests                                                                                                   |
| `pnpm test:run -- <file>`                           | Run a single test file                                                                                                                          |
| `pnpm coverage`                                     | Run tests with coverage report                                                                                                                  |
| `pnpm auto-merge`                                   | Merge `main` back into the current branch (`scripts/auto-merge-main.js`)                                                                        |
| `pnpm prepare`                                      | Install the husky Git hooks (triggered automatically by `pnpm install`)                                                                         |

> ⚠️ `blog/*.html`, `en.html`, `privacy.en.html`, `pricing.en.html`, the cover images and `public/icon/*.png` are **generated artifacts** and must never be hand-edited. Change their Markdown / SVG sources, then re-run the matching `gen:*` / `icons:build` / `covers:render` script.

> 📖 Icon workflow, test page, and performance design details live in [docs/ARCHITECTURE.en.md — Development Extras](./ARCHITECTURE.en.md#development-extras).

## Chrome Permissions

| Permission       | Purpose                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`        | Stores ciphertext entries, settings and session key material. Only `chrome.storage.local` (persistent ciphertext) and `chrome.storage.session` (in-memory key / snapshot) — never `storage.sync` or `storage.managed` |
| `activeTab`      | Reads the current tab's URL and handle — only when you act (shortcut, toolbar icon, right-click menu, floating button) — so the right login form is targeted                                                          |
| `scripting`      | Re-injects the content script per frame when it is missing (`chrome.scripting.executeScript` in `utils/contentScriptReadiness.ts`)                                                                                    |
| `sidePanel`      | Side panel quick fill                                                                                                                                                                                                 |
| `alarms`         | Five scheduled jobs: SW keep-alive revival (0.5min), update check (360min), password expiry reminder check (12h), trash cleanup (24h), auto-backup reminder (user-configured days)                                    |
| `notifications`  | Desktop notifications: auto-save, backup reminder, version update, password expiry, quick-fill feedback, and a clickable "unlock required" notice                                                                     |
| `idle`           | Auto idle lock detection (OS lock / screensaver / idle); the feature is off by default and only active once enabled                                                                                                   |
| `clipboardWrite` | Writing to the clipboard (copy password / TOTP)                                                                                                                                                                       |
| `clipboardRead`  | Reading the clipboard (compare before clearing so fresh user copies are never destroyed)                                                                                                                              |
| `webNavigation`  | Enumerate frames via `chrome.webNavigation.getAllFrames` for cross-iframe filling (query only — no navigation listeners)                                                                                              |
| `contextMenus`   | Right-click menu: in editable fields "Fill username / Fill password / Fill 2FA code / Generate & fill a strong password"; on pages "Open side panel / Open password manager"                                          |
| `favicon`        | Read Chrome's locally cached website favicons, zero external requests                                                                                                                                                 |
| `<all_urls>`     | Content script matches all pages (host_permission)                                                                                                                                                                    |

## CSV / JSON Field Formats

| Chinese column      | English column          | Required | Notes                               |
| ------------------- | ----------------------- | -------- | ----------------------------------- |
| 用户名 / 账号       | username / Username     | Yes      | Account/email/phone                 |
| 密码                | password / Password     | No       | Login password                      |
| URL / 网址 / 链接   | url                     | No       | Site address                        |
| 标签 / 分类         | tag / Tag               | No       | Category tag                        |
| 备注 / 说明         | remark / Remark         | No       | Notes                               |
| 两步验证            | TOTP                    | No       | TOTP secret (otpauth:// URI format) |
| 创建时间            | createTime / CreateTime | No       | Auto-filled                         |
| 更新时间 / 修改时间 | updateTime / modifyTime | No       | Auto-filled                         |

> "Download Template" produces a standard CSV (BOM UTF-8, opens directly in Excel / Numbers); headers follow the interface language and both header languages are auto-detected on import. JSON exports use the `{ version, exportedAt, count, entries }` wrapper; imports also accept a flat array. Export filenames follow `passwords_YYYYMMDD_HHmmss.csv/.json`.

## Development Standards

### Code Style

- Use ESLint for static analysis and Prettier for formatting.
- CSS/style code uses Stylelint with recess-order property sorting.
- New code must pass:

  ```sh
  pnpm lint:all
  ```

### Logging

- The ESLint rule is `no-console: ['warn', { allow: ['warn', 'error'] }]`, and `pnpm lint` runs with `--max-warnings 0`, so any `console.log` in runtime code fails the check. `console.warn` / `console.error` are permitted by the rule, but the project convention still routes all runtime logging through `utils/logger.ts` (which carries a minimal, file-scoped exemption). Build and other tooling scripts may use `console` directly.
- Always use the logger from `utils/logger.ts`:

  ```ts
  import { logger } from '@/utils/logger';

  logger.info('This message will be logged');
  logger.warn('This warning will be logged');
  logger.error('This error will be logged');
  ```

### Path Aliases

- Use `./` for files in the same directory.
- Use `@/` for all other local imports:

  ```ts
  import { StorageUtils } from '@/utils/storage';
  ```

### Component Standards

- Vue components use the Composition API (`<script setup lang="ts">`).
- Element Plus components are imported on demand; verify new components are registered in the auto-import config.
- All shared components go in the `components/` directory.

### Internationalization

- All new or modified user-visible strings must be provided in both Simplified Chinese and English.
- Vue UI strings: update the corresponding namespace in `utils/i18n/locales/zh-CN/` and `en/`.
- Content Script and Background strings: update the corresponding entries in `utils/i18n-lite.ts`.
- When adding, deleting, or renaming i18n keys, keep the Chinese and English key sets in sync.

### Git Hooks

The project is configured with `husky` + `lint-staged`. On every `git commit`, the following checks run automatically on changed files:

- `eslint --fix` + `prettier --write` (TypeScript / Vue / JS files)
- `stylelint --fix` (CSS / SCSS / Vue style files)
- `prettier --write` (JSON / Markdown files)

Please ensure all checks pass before committing.

### Testing

- Use Vitest for unit tests. Test files go in the `tests/` directory, mirroring the source structure.
- When fixing a bug, prefer adding a regression test (fails before the fix, passes after).
- New logic should cover success, failure, and key boundary conditions.
- Check existing tests before modifying code to ensure nothing breaks.
- Run relevant tests before submitting based on the scope of changes:

  ```sh
  pnpm test:run                       # Run all tests
  pnpm test:run -- tests/utils/xxx.ts # Run a single test file
  ```

- Never weaken assertions, delete tests, or skip tests to make them pass.
- Cases that need a DOM (layout-following injected overlays, restore-position lifecycles) must not switch the global environment: enable jsdom per file with a leading `/** @vitest-environment jsdom */` comment. The default environment in `vitest.config.ts` always stays `node` so ordinary pure-logic suites do not slow down.
- jsdom provides no real layout (`getBoundingClientRect()` always returns zeros, `offsetWidth` / `offsetHeight` are always 0, and `getComputedStyle()` returns an empty string for undeclared properties). Those measurements are handled by `installDomLayout()` in `tests/helpers/domLayout.ts`, which supplies a manually advanced rAF queue and an ordered read/write log (so you can assert "was a frame scheduled" and "all reads before all writes"). The harness ships its own self-check cases; any new measurement must return a verification field, so a missed selector cannot produce a plausible-but-wrong number.
- Mount-based rendering tests for `.vue` components are not supported yet: `@vitejs/plugin-vue` (v6.0.8, pulled in by `@wxt-dev/module-vue`) is available, but `@vue/test-utils` is not installed, so Vue interaction coverage stops at the state owner (composable / pure function). `.vue` files are still reached statically — `tests/utils/i18nBundles.test.ts` reads them as text to verify each dependency graph only uses `t()` keys from its registered namespaces.

### Keyboard Shortcuts

The extension registers the following shortcuts (customizable in `chrome://extensions/shortcuts`):

| Shortcut (Windows/Linux) | Shortcut (Mac)    | Function             |
| ------------------------ | ----------------- | -------------------- |
| `Ctrl+Shift+P`           | `Command+Shift+P` | Open options page    |
| `Ctrl+Shift+L`           | `Command+Shift+L` | Toggle side panel    |
| `Ctrl+Shift+F`           | `Command+Shift+F` | Quick fill           |
| `Ctrl+Shift+K`           | `Command+Shift+K` | Open inline dropdown |

> `quick_fill` hardcodes `autoLogin: false`, so `Ctrl+Shift+F` fills the credentials and ticks the checkbox but never clicks the login button; the click only happens through the side panel's "Fill and sign in" action or the opt-in "Auto-submit login" preference (off by default).
> Chrome exposes no `chrome.commands.update()` and all 4 command slots are already used, so the in-app shortcut list is **read-only** and only links out to `chrome://extensions/shortcuts`. Adding a shortcut means freeing a command slot first — in-app rebinding is not an option.

### Security & Privacy

This is a password manager — security is the top priority. Please follow these principles when contributing:

- **Never** include real passwords, keys, tokens, or other sensitive data in source code, tests, logs, docs, or commit messages.
- **Never** use `v-html`, `innerHTML`, `eval`, or inline scripts to process untrusted content.
- Runtime code must use `utils/logger.ts` exclusively; log parameters must not contain sensitive data.
- Do not expand the lifetime, storage location, or accessible context of plaintext sensitive data.
- Do not invent new encryption algorithms or modify existing encryption parameters (PBKDF2 iterations, AES mode, IV generation, etc.).
- New network requests, telemetry, or remote resource loading must require explicit user confirmation; default to local-first, offline-capable. The one already-approved outbound call is the anonymous version check in `utils/updateChecker.ts` (it carries no user data); it is an existing exception, not a defect to "fix".
- Chrome permissions follow the principle of least privilege; new permissions must be justified.

## Pull Request Guidelines

> You don't need to ask permission before starting work on an open Issue. If someone else submits a fix first, you can still contribute through code Review or verification.

- Create a topic branch from `main` for development, then merge back to `main`.

- **New features:**
  - Include appropriate tests or use-case documentation.
  - Provide a clear feature description and use cases. Consider opening an Issue first for discussion.

- **Bug fixes:**
  - Reference the corresponding Issue number in the PR title, e.g., `fix: resolve sidebar close failure (fix #123)`.
  - Include detailed problem description and reproduction steps.
  - Provide test coverage for the fix; explain if not applicable.

- **Code refactoring / typo fixes:**
  - Batch multiple spelling or comment corrections into a single PR.
  - Pure style refactoring is discouraged unless it clearly improves performance or maintainability.

- PRs may contain multiple small commits; GitHub will squash them on merge.

- PR titles should follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

  ```
  feat: add auto-login toggle
  fix: resolve missing date suffix in export filename
  refactor: rework form detection logic
  docs: update README usage instructions
  chore: upgrade WXT version
  ```

- **Pre-submission checklist:**

  ```sh
  pnpm typecheck          # TypeScript type checking
  pnpm lint               # ESLint check
  pnpm lint:style         # Stylelint check
  pnpm format:check       # Prettier format check
  pnpm test:run           # Run all tests (or relevant test files)
  pnpm build              # Production build verification
  ```

> ⚠️ **What CI actually does**: `.github/workflows/release-please.yml` runs only `pnpm install` + `pnpm run build`, and `static.yml` only builds the Pages site — **the cloud never runs tests, lint, or typecheck**. The checks above are enforced only locally, by the `husky` + `lint-staged` hook on changed files, so a PR that skips them locally will not be caught by CI.
>
> Version numbers and `CHANGELOG.md` are managed automatically by release-please; do not edit those two files by hand in a PR.

## Issue Guidelines

- Search for existing discussions before opening a new Issue.
- Bug reports should include:
  - Chrome version and OS version.
  - Extension version.
  - Reproduction steps (as detailed as possible).
  - Expected vs. actual behavior.
  - Screenshots or screen recordings (if applicable).
- Feature requests should include:
  - Use case and context.
  - Desired interaction.
  - Reference implementations of similar features, if any.

## Code of Conduct

- Maintain a friendly, respectful, and inclusive communication atmosphere.
- Focus on technical discussions; avoid unrelated arguments.
- Contributors of all skill levels are welcome.

Thank you for contributing!
