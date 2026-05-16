# Account Password Helper · 账号密码管理助手

[![WXT](https://img.shields.io/badge/WXT-v0.20-4E88FF)](https://wxt.dev/)
[![Vue](https://img.shields.io/badge/Vue-v3.5-42b883)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v6-3178c6)](https://www.typescriptlang.org/)
[![Element Plus](https://img.shields.io/badge/Element%20Plus-v2.13-409EFF)](https://element-plus.org/)
[![Manifest V3](https://img.shields.io/badge/Chrome-MV3-4285F4)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](#许可证)

一个现代化的 Chrome 浏览器扩展，提供安全、便捷的账号密码管理与自动填充能力。采用 **PBKDF2 + AES-256-CBC** 加密体系，支持 Excel 导入导出、智能表单识别和多策略自动填充。

> **免责声明**：本插件的所有数据均保存在本地（敏感信息加密保存），仅用于开发和测试环境使用，严禁保存办公和个人敏感密码，如发生密码泄露，后果自负！
>
> 🌐 **在线演示**: https://liaolongdong.github.io/account-password-helper/

<p align="center">
  <img src="./assets/icons/icon.svg" alt="插件图标" width="120" />
</p>

## 核心特性

- **加密安全**：PBKDF2（10000 次迭代）派生 256-bit 密钥 + AES-256-CBC 随机 IV；主密码 MD5 + 盐值存储；敏感字段（username/password/url/remark）加密。
- **智能识别**：MutationObserver 动态检测登录表单，支持用户名+密码、手机号+验证码等多种场景；LoginFormAnalyzer 通过表单/容器/弹窗/按钮多维启发式判断。
- **一键填充**：侧边栏点击即填充，三重策略（Native Setter / execCommand / 模拟输入）兼容 React/Vue 等主流框架；可选自动触发登录。
- **数据管理**：Excel 导入导出（.xlsx），中英文列名映射；标签多选 + 自定义 + 颜色一致；多字段搜索与排序。
- **会话可控**：1/2/4/8/12/24 小时和3/5/7天会话有效期；会话失效后敏感字段自动加密回密文。
- **Shadow DOM 隔离**：悬浮按钮使用 Closed Shadow DOM，完全隔离页面样式。
- **零网络传输**：所有数据存储在 Chrome Local Storage，不走任何网络。

## 功能速览

### 1. 安全保护

- 主密码至少 8 位，必须包含字母、数字和特殊字符。
- 会话创建后，密码从密文解密为明文缓存；会话失效时自动加密回密文。
- 会话恢复后自动检测并修复加密状态不一致的数据。
- SessionManager 每分钟检查会话有效性，页面可见性变化时也会触发检查。

### 2. 表单识别与填充

- 识别用户名、密码、手机号、验证码字段；自动勾选"记住密码"、"同意条款"等复选框。
- WeakMap / WeakSet 缓存字段判断结果，避免内存泄漏。
- 填充策略自动降级：**Native Setter → execCommand → 模拟键盘事件**。
- 悬浮按钮可配置「自动触发登录」开关：填充完成后自动点击表单内的登录按钮（见 [SettingsPanel.ts](./entrypoints/content/floatingButtons/SettingsPanel.ts) / [FormDetector.ts](./entrypoints/content/FormDetector.ts)）。

### 3. 数据管理

- Excel 导入导出（.xlsx/.xls），提供标准模板下载。
- 标签下拉多选 + 自定义新增；相同标签颜色稳定一致（见 [utils/tagUtils.ts](./utils/tagUtils.ts)）。
- 密码列表与侧边栏默认按更新时间倒序；支持按用户名、URL、标签、备注、创建/更新时间切换排序。
- 支持用户名、标签、备注、URL 的多字段模糊搜索。

### 4. 快速填充

- 侧边栏自动将与当前域名匹配的密码排在前面。
- **本地开发友好**：当域名为 `localhost` 或 `127.0.0.1` 时，默认匹配所有密码（见 [sidepanel/App.vue](./entrypoints/sidepanel/App.vue)）。
- 点击条目一键填充并自动关闭侧边栏；若无登录表单，给出「当前页面未检测到登录表单」提示。
- 快捷键：
  - `Ctrl+Shift+P` / `Cmd+Shift+P`：打开密码管理页面
  <!-- - `Ctrl+Shift+L` / `Cmd+Shift+L`：切换侧边栏 -->
- Background 维护密码缓存，侧边栏优先读取缓存，后台异步验证。

## 技术栈

| 类别        | 技术                                                                  | 版本 / 说明                              |
| ----------- | --------------------------------------------------------------------- | ---------------------------------------- |
| 扩展框架    | [WXT](https://wxt.dev/)                                               | v0.20，基于 Manifest V3                  |
| 前端框架    | [Vue 3](https://vuejs.org/) + TypeScript                              | v3.5，Composition API + `<script setup>` |
| UI 组件库   | [Element Plus](https://element-plus.org/)                             | v2.13，全局注册                          |
| 加密        | [crypto-js](https://github.com/brix/crypto-js)                        | v4.2，PBKDF2 + AES-256-CBC + MD5         |
| 表格处理    | [xlsx](https://github.com/SheetJS/sheetjs)                            | v0.18，Excel 导入导出                    |
| 构建工具    | Vite                                                                  | WXT 内置，HMR 热更新                     |
| 图标生成    | [sharp](https://github.com/lovell/sharp)                              | v0.33，SVG → 多尺寸 PNG                  |
| 日志 / 环境 | [utils/logger.ts](./utils/logger.ts) + [utils/env.ts](./utils/env.ts) | 生产构建 tree-shake 掉调试日志           |
| 代码规范    | ESLint + Prettier + Stylelint                                         | TS v6，完整质量工具链                    |

## 快速开始

### 环境要求

- Node.js >= 16
- Chrome >= 114（支持 SidePanel API，>= 129 支持 `sidePanel.close`）

### 安装与构建

```bash
# 安装依赖
npm install

# 开发模式（HMR 热更新）
npm run dev

# 生产构建（会先跑 prebuild → 生成图标 PNG）
npm run build

# 构建并打包为 zip
npm run postbuild

# Firefox 支持
npm run dev:firefox
npm run build:firefox
```

### 加载到 Chrome

1. `npm run build` 产出 `.output/chrome-mv3/`
2. 打开 `chrome://extensions/`，开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `.output/chrome-mv3`
4. 首次使用需设置主密码（至少 8 位，含字母+数字+特殊字符）

## 使用指南

### 在线演示

访问 [在线演示页面](https://liaolongdong.github.io/account-password-helper/) 查看功能演示效果。

> 注意：在线演示仅用于展示功能界面，不涉及真实的密码管理功能。完整功能请安装 Chrome 扩展体验。

### 初始设置

1. 安装后点击扩展图标进入密码管理页面
2. 设置主密码并选择会话有效期（1/2/4/8/12/24 小时和3/5/7天，默认 24 小时）
3. 在选项页可配置悬浮按钮显示、位置、透明度、是否自动触发登录

### 密码管理

- **新增 / 编辑 / 复制 / 删除**：选项页提供完整 CRUD
- **批量导入导出**：Excel 模板导入，提供「下载模板」，导出密码需验证主密码
- **搜索 / 排序**：多字段模糊搜索，点击表头切换升降序
- **标签**：下拉多选，可自定义添加，颜色稳定一致

### 快速填充

1. 登录页输入框获得焦点时自动展示侧边栏（需开启配置）
2. 侧边栏列表按当前域名优先排序
3. 点击条目一键填充，自动关闭侧边栏；可配置点击自动触发登录
4. 也可通过点击插件图标或悬浮按钮中的“快速填充”手动切换

### Excel 字段支持

| 中文列名            | 英文列名                | 必填 | 说明             |
| ------------------- | ----------------------- | ---- | ---------------- |
| 用户名 / 账号       | username / Username     | 是   | 账号/邮箱/手机号 |
| 密码                | password / Password     | 否   | 登录密码         |
| URL / 网址 / 链接   | url                     | 否   | 网站地址         |
| 标签 / 分类         | tag / Tag               | 否   | 分类标签         |
| 备注 / 说明         | remark / Remark         | 否   | 说明信息         |
| 创建时间            | createTime / CreateTime | 否   | 自动填充         |
| 更新时间 / 修改时间 | updateTime / modifyTime | 否   | 自动填充         |

示例：

```
用户名(必填)     密码          URL                   标签   备注
user@email.com  password123   https://example.com   工作   示例账号
```

## 架构设计

### 扩展入口点

| 入口点             | 职责                                                       |
| ------------------ | ---------------------------------------------------------- |
| **Background**     | Service Worker，消息路由、密码缓存、侧边栏状态、快捷键处理 |
| **Content Script** | 注入所有页面，初始化表单检测与悬浮按钮                     |
| **Popup**          | 扩展图标弹窗，提供「管理密码」和「快速填充」快捷入口       |
| **Options**        | 密码管理主页面，完整 CRUD、导入导出、会话/有效期管理       |
| **SidePanel**      | 侧边栏快速填充，支持搜索、排序、域名匹配、缓存加速         |

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
    CS --> FD[FormDetector]
    CS --> IF[InputFiller]
    CS --> FB[FloatingButtons]
```

- Background 作为消息路由中心，处理跨组件通信
- SidePanel 通过 `chrome.runtime.connect()` 建立 Port，用于可靠状态追踪
- Content Script 通过 `chrome.runtime.sendMessage()` 发送消息

### 会话生命周期

```mermaid
graph TB
    A[设置/验证主密码] --> B[创建会话]
    B --> C[密码批量解密为明文存储]
    C --> D[SessionManager 每分钟检查]
    D -->|未过期| D
    D -->|过期| E[触发 sessionExpired 事件]
    E --> F[密码批量加密回密文]
    F --> G[清空密码缓存 / UI 层关闭侧边栏]
    G --> A
```

### 加密机制

```
主密码 + 盐值 → PBKDF2 (10000次迭代) → 256-bit 密钥
明文 + 密钥 + 随机IV → AES-256-CBC → Base64(IV + 密文)
```

- 敏感字段加密：`username`、`password`、`url`、`remark`
- 空字段不参与加密（写空字符串）；解密失败安全降级返回原始数据
- 内存中的主密码副本使用 MD5(盐值 + 常量) 截取 32 字符作为会话密钥，通过 AES-256-CBC 二次加密后再存入 chrome.storage.local

## 项目结构

```
├── entrypoints/                    # WXT 扩展入口点
│   ├── background.ts               # Background Service Worker
│   ├── content.ts                  # Content Script 入口
│   ├── content/                    # Content Script 模块
│   │   ├── FormDetector.ts         # 表单检测编排器
│   │   ├── InputFiller.ts          # 多策略输入填充
│   │   ├── LoginFormAnalyzer.ts    # 登录表单启发式分析
│   │   ├── CheckboxHandler.ts      # 复选框自动勾选
│   │   ├── NativeNotification.ts   # 原生浏览器通知
│   │   ├── formSelectors.ts        # 选择器与关键词常量
│   │   └── floatingButtons/        # 悬浮按钮系统（Closed Shadow DOM）
│   ├── popup/                      # 扩展图标弹窗
│   ├── options/                    # 密码管理主页面
│   └── sidepanel/                  # 侧边栏快速填充
├── components/                     # 共享 Vue 组件
│   ├── BrandLogo.vue               # 钥匙主题品牌 Logo
│   ├── DisclaimerInfo.vue          # 免责声明
│   ├── ImportDialog.vue            # Excel 导入对话框
│   ├── MasterPasswordDialog.vue    # 主密码设置/验证
│   ├── PasswordFormDialog.vue      # 密码表单编辑
│   ├── PasswordVerifyDialog.vue    # 密码查看验证
│   ├── ValidityHoursSelect.vue     # 有效期选择器
│   └── ValiditySettingDialog.vue   # 有效期设置对话框
├── composables/                    # Vue 组合函数
│   ├── useAuthFlow.ts              # 认证流程
│   ├── usePasswordManagement.ts    # 密码 CRUD + 搜索排序
│   ├── useSessionTimer.ts          # 会话定时器
│   └── useChromeListeners.ts       # Chrome API 监听器自动清理
├── utils/                          # 核心工具库
│   ├── storage.ts                  # 存储门面
│   ├── encryption.ts               # PBKDF2 + AES-256-CBC
│   ├── sessionManager.ts           # 全局会话检查单例
│   ├── sessionManager-storage.ts   # 会话持久化与加解密转换
│   ├── excel.ts                    # Excel 导入导出
│   ├── tagUtils.ts                 # 标签颜色生成
│   ├── logger.ts                   # 环境感知日志
│   ├── env.ts                      # isDev / isProd 常量
│   ├── createVueApp.ts             # Vue 应用工厂
│   ├── shadowDomStyles.ts          # Shadow DOM 样式注入
│   └── types.ts                    # 公共类型定义
├── assets/icons/                   # 源 SVG 图标
│   ├── icon.svg                    # 当前生效图标
│   └── variants/                   # 4 款钥匙主题候选图标
├── public/icon/                    # 构建期 PNG 产物（WXT 自动注入 manifest）
├── scripts/generate-icons.mjs      # SVG → 多尺寸 PNG 生成脚本
├── styles/dialog-full-width.css    # 共享对话框全屏样式
├── types/global.d.ts               # 全局类型补充
├── wxt.config.ts                   # WXT 配置
└── package.json
```

## 开发调试

### 常用命令

| 命令                       | 说明                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run dev`              | 开发模式（HMR 热更新）                                                                         |
| `npm run build`            | 生产构建（先执行 `prebuild` → 自动生成图标 PNG）                                               |
| `npm run postbuild`        | 构建后产出 zip 包                                                                              |
| `npm run icons:build`      | 将 [assets/icons/icon.svg](./assets/icons/icon.svg) 渲染为 `public/icon/{16,32,48,96,128}.png` |
| `npm run typecheck`        | TypeScript 类型检查                                                                            |
| `npm run lint` / `:fix`    | ESLint 检查 / 自动修复                                                                         |
| `npm run lint:style(:fix)` | Stylelint 检查 / 自动修复                                                                      |
| `npm run format(:check)`   | Prettier 格式化 / 检查                                                                         |
| `npm run lint:all`         | 运行所有检查                                                                                   |
| `npm run fix:all`          | 运行所有自动修复                                                                               |

### 图标工作流

1. 编辑或替换 [assets/icons/icon.svg](./assets/icons/icon.svg)（可从 [variants](./assets/icons/variants) 挑选一款覆盖）
2. 运行 `npm run icons:build` 生成 `public/icon/{16,32,48,96,128}.png`
3. WXT 会自动识别为 `manifest.icons` 和 `action.default_icon`，无需在 [wxt.config.ts](./wxt.config.ts) 显式声明

### 测试页面

项目包含 [test-page.html](./test-page.html) 用于表单检测与自动填充的回归验证。

### Chrome 权限说明

| 权限         | 用途                           |
| ------------ | ------------------------------ |
| `storage`    | 本地存储密码数据和配置         |
| `activeTab`  | 获取当前标签页信息用于域名匹配 |
| `scripting`  | 动态注入 Content Script        |
| `sidePanel`  | 侧边栏快速填充功能             |
| `<all_urls>` | Content Script 匹配所有页面    |

## 安全提醒

- 主密码遗忘**无法恢复**，请务必妥善保管。
- 所有数据本地 AES-256-CBC 加密存储，不经过任何网络传输。
- 建议定期通过 Excel 导出功能备份数据。
- 会话过期后需重新验证主密码，届时所有密码自动加密。
- 本插件仅用于开发和测试环境，**严禁保存生产环境或个人敏感密码**。

## 常见问题

**Q：忘记主密码怎么办？**

A：主密码无法找回，只能通过「重置」功能清空数据后重新设置。建议定期通过 Excel 导出备份。

**Q：侧边栏不显示？**

A：确认 Chrome >= 114，检查页面是否包含登录表单；也可用点击插件图标或悬浮按钮，点击“快速填充”手动打开。

**Q：Excel 导入失败？**

A：点击「下载模板」获取标准模板，确保用户名列不为空；支持 `.xlsx` 与 `.xls`。

**Q：密码填充不生效？**

A：等待页面完全加载后重试，填充器会依次尝试三种策略；仍不生效请刷新页面。

**Q：悬浮按钮被页面样式影响？**

A：悬浮按钮使用 Closed Shadow DOM 完全隔离，不受页面样式影响。

**Q：会话有效期修改何时生效？**

A：修改后立即创建新会话，新有效期即时生效。

**Q：如何切换扩展图标？**

A：从 [assets/icons/variants](./assets/icons/variants) 选一款覆盖到 [assets/icons/icon.svg](./assets/icons/icon.svg)，然后运行 `npm run icons:build` 重新生成 PNG。

**Q：为什么本地开发时侧边栏匹配这么宽松？**

A：当域名为 `localhost` 或 `127.0.0.1` 时，侧边栏默认展示所有密码，方便本地调试多项目时快速填充。

**Q：侧边栏会自动点击登录按钮吗？**

A：仅在悬浮按钮设置面板中开启「自动触发登录」时，且账号密码字段均已成功填充，FormDetector 才会自动点击表单内的登录按钮。默认关闭。

## 许可证

本项目采用 MIT License 开源协议。

## 致谢

- [WXT](https://wxt.dev/) — 现代化 Chrome 扩展开发框架
- [Vue 3](https://vuejs.org/) — 渐进式 JavaScript 框架
- [Element Plus](https://element-plus.org/) — Vue 3 UI 组件库
- [crypto-js](https://github.com/brix/crypto-js) — JavaScript 加密库
- [xlsx](https://github.com/SheetJS/sheetjs) — Excel 文件处理库
- [sharp](https://github.com/lovell/sharp) — 高性能图像处理

## 联系方式

邮箱：[924902324@qq.com](mailto:924902324@qq.com?subject=账号密码管理助手反馈)

如果本项目对您有帮助，请帮忙点个⭐️，谢谢！

欢迎提交 Issue 和 Pull Request！
