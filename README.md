## Account Password Helper - 账号密码管理助手

一个现代化的 Chrome 浏览器扩展，提供安全便捷的账号密码管理与自动填充功能。采用军工级加密技术（PBKDF2 + AES-256-CBC），支持 Excel 导入导出，具备智能表单识别和多策略自动填充能力。

> **免责声明**：本插件的所有数据均保存在本地，仅用于开发和测试环境使用，严禁保存办公和个人敏感密码，如发生密码泄露，后果自负！

<p align="center">
  <img src="./assets/icons/icon.svg" alt="插件图标" width="120" />
</p>

## 核心特性

- **军工级安全**：PBKDF2 密钥派生（10000 次迭代）+ AES-256-CBC 随机 IV 加密，主密码保护
- **智能识别**：MutationObserver 动态检测登录表单，支持用户名+密码、手机号+验证码等多种场景
- **一键填充**：侧边栏快速填充，三重策略（Native Setter / execCommand / 模拟输入）兼容各类前端框架
- **数据管理**：Excel 导入导出（.xlsx），标签分类，多字段排序，搜索过滤
- **灵活配置**：1-24 小时会话有效期，悬浮按钮位置/透明度/自动展示侧边栏可自定义
- **Shadow DOM 隔离**：悬浮按钮使用 Closed Shadow DOM，完全隔离页面样式

## 主要功能

### 安全保护

- **加密体系**：PBKDF2 从主密码派生 256-bit 密钥，AES-256-CBC 随机 IV 加密敏感字段（username/password/url/remark）
- **主密码保护**：MD5 哈希 + 随机盐值存储，支持 1-24 小时会话有效期
- **会话管理**：会话创建时自动解密所有密码为明文缓存，会话失效时自动加密回密文
- **数据一致性**：会话恢复后自动检测并修复加密状态不一致的数据
- **本地存储**：所有数据存储在 Chrome Local Storage，零网络传输

### 智能表单识别

- **动态检测**：通过 MutationObserver 监听 DOM 变化，实时检测登录表单字段
- **多字段支持**：自动识别用户名、密码、手机号、验证码输入框
- **启发式分析**：LoginFormAnalyzer 通过表单元素、容器关键词、弹窗角色、定位方式等多种规则判断登录表单
- **复选框处理**：自动检测并勾选"记住密码"、"同意条款"等复选框
- **WeakMap 缓存**：字段类型判断使用 WeakMap/WeakSet 缓存，避免内存泄漏

### 多策略自动填充

- **Native Setter**：通过原生 value setter 设置值，兼容 React/Vue 等框架的受控组件
- **execCommand**：使用 `document.execCommand('insertText')` 触发输入事件
- **模拟输入**：模拟键盘事件（keydown/keypress/input/keyup）逐字符输入
- **自动降级**：三种策略依次尝试，确保在各种网站上都能正确填充

### 数据管理

- **Excel 导入导出**：支持 .xlsx 格式，中英文列名自动映射
- **标签分类**：支持自定义标签，根据标签内容自动生成一致的颜色
- **多字段排序**：支持按用户名、URL、标签、备注、创建时间、更新时间排序
- **搜索过滤**：支持用户名、标签、备注、URL 多字段模糊搜索
- **域名优先**：侧边栏自动将当前域名匹配的密码排在前面

### 快速操作

- **侧边栏填充**：点击密码条目一键填充，填充后自动关闭侧边栏
- **快捷键支持**：
  - `Ctrl+Shift+P`（Mac: `Cmd+Shift+P`）：打开密码管理页面
  - `Ctrl+Shift+L`（Mac: `Cmd+Shift+L`）：切换侧边栏
- **悬浮按钮**：支持打开侧边栏、打开管理页面、设置面板，可拖拽/配置位置和透明度
- **缓存加速**：Background 维护密码缓存，侧边栏优先使用缓存数据，后台异步验证

## 技术栈

| 类别      | 技术                                                | 说明                                        |
| --------- | --------------------------------------------------- | ------------------------------------------- |
| 扩展框架  | [WXT](https://wxt.dev/) v0.19                       | Chrome Extension 开发框架，基于 Manifest V3 |
| 前端框架  | [Vue 3](https://vuejs.org/) v3.3 + TypeScript       | Composition API + `<script setup>` 语法     |
| UI 组件库 | [Element Plus](https://element-plus.org/) v2.4      | 完整组件库，全局注册                        |
| 加密      | [crypto-js](https://github.com/brix/crypto-js) v4.2 | PBKDF2 + AES-256-CBC + MD5                  |
| 数据处理  | [xlsx](https://github.com/SheetJS/sheetjs) v0.18    | Excel 导入导出                              |
| 构建工具  | Vite                                                | WXT 内置，支持 HMR 热更新                   |
| 代码规范  | ESLint + Prettier + Stylelint                       | 完整的代码质量工具链                        |

## 安装部署

### 环境要求

- Node.js >= 16.0.0
- Chrome >= 114（支持 SidePanel API）
- Chrome >= 129（支持 sidePanel.close API，可选）

### 开发环境

```bash
# 安装依赖
npm install

# 开发模式（支持 HMR 热更新）
npm run dev

# 生产构建
npm run build

# 构建并打包为 zip
npm run postbuild
```

### Chrome 安装

1. 运行 `npm run build` 构建项目
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择 `.output/chrome-mv3` 目录
5. 首次使用需设置主密码

### Firefox 支持

```bash
# Firefox 开发模式
npm run dev:firefox

# Firefox 生产构建
npm run build:firefox
```

## 使用指南

### 初始设置

1. 安装扩展后点击图标，进入密码管理页面
2. 首次使用需设置主密码（至少 8 位，必须包含字母、数字和特殊字符）
3. 设置会话有效期（1/2/4/8/12/24 小时可选，默认 24 小时）
4. 可在选项页面配置悬浮按钮的显示、位置和透明度

### 密码管理

- **添加密码**：选项页面点击「添加密码」手动添加，或通过「导入 Excel」批量导入
- **编辑密码**：点击条目编辑按钮修改用户名、密码、URL、标签、备注
- **搜索过滤**：支持用户名、标签、备注、URL 多字段模糊搜索
- **排序**：点击表头可按各字段升序/降序排列
- **删除**：支持单条删除

### 快速填充

1. 在登录页面，输入框获得焦点时可自动展示侧边栏（需开启配置）
2. 侧边栏显示与当前域名匹配的密码列表，匹配项排在前面
3. 点击密码条目一键填充用户名和密码
4. 自动勾选"记住密码"等复选框
5. 填充成功后侧边栏自动关闭
6. 也可使用快捷键 `Ctrl+Shift+L` 切换侧边栏

### 数据导入导出

- **Excel 导入**：支持 .xlsx/.xls 格式，提供标准模板下载
- **Excel 导出**：包含用户名、密码、URL、标签、备注、创建时间、更新时间
- **字段映射**：支持中英文列名自动识别

## Excel 格式支持

### 支持列名

| 中文列名            | 英文列名                | 必填 | 说明             |
| ------------------- | ----------------------- | ---- | ---------------- |
| 用户名 / 账号       | username / Username     | 是   | 账号/邮箱/手机号 |
| 密码                | password / Password     | 否   | 登录密码         |
| URL / 网址 / 链接   | url                     | 否   | 网站地址         |
| 标签 / 分类         | tag / Tag               | 否   | 分类标签         |
| 备注 / 说明         | remark / Remark         | 否   | 说明信息         |
| 创建时间            | createTime / CreateTime | 否   | 自动填充         |
| 更新时间 / 修改时间 | updateTime / modifyTime | 否   | 自动填充         |

### 模板示例

```
用户名(必填)     密码          URL                   标签   备注
user@email.com  password123   https://example.com   工作   示例账号
```

## 架构设计

### 扩展入口点

| 入口点             | 说明                                                                                |
| ------------------ | ----------------------------------------------------------------------------------- |
| **Background**     | Service Worker，管理侧边栏状态、消息路由、密码缓存、快捷键处理                      |
| **Content Script** | 注入到每个网页，初始化 FormDetector（表单检测）和 FloatingButtonManager（悬浮按钮） |
| **Popup**          | 扩展图标弹窗，提供「管理密码」和「快速填充」快捷入口                                |
| **Options**        | 密码管理主页面，完整的 CRUD、导入导出、会话管理、有效期设置                         |
| **SidePanel**      | 侧边栏快速填充界面，支持搜索、排序、域名匹配、缓存加速                              |

### 消息通信

```
Content Script ←→ Background ←→ SidePanel / Popup / Options
     ↕                                    ↕
  FormDetector                      StorageUtils
  InputFiller                       SessionManager
  FloatingButtons                   Encryption
```

- Background 作为消息路由中心，处理所有跨组件通信
- SidePanel 通过 `chrome.runtime.connect()` 建立 Port 连接，用于可靠的状态追踪
- Content Script 通过 `chrome.runtime.sendMessage()` 发送消息

### 会话生命周期

1. 用户设置/验证主密码 → 创建会话（加密主密码副本 + 过期时间戳存入 Local Storage）
2. 会话创建后 → 所有密码自动从加密状态解密为明文存储（便于快速读取）
3. SessionManager 每分钟检查会话有效性
4. 会话过期 → 触发 `sessionExpired` 自定义事件 → 所有密码自动加密回密文
5. 页面可见性变化时自动检查会话状态

### 加密机制

```
主密码 + 盐值 → PBKDF2 (10000次迭代) → 256-bit 密钥
明文 + 密钥 + 随机IV → AES-256-CBC → Base64(IV + 密文)
```

- 敏感字段加密：username、password、url、remark
- 空字段不加密，保持原值
- 解密失败时安全降级，返回原始数据
- 会话密钥：使用盐值派生的 32 字符密钥加密内存中的主密码副本

## 项目结构

```
├── entrypoints/                # 扩展入口点
│   ├── background.ts           # Background Service Worker
│   ├── content.ts              # Content Script 入口
│   ├── content/                # Content Script 模块
│   │   ├── FormDetector.ts     # 表单检测器（核心编排器）
│   │   ├── InputFiller.ts      # 多策略输入填充器
│   │   ├── LoginFormAnalyzer.ts # 登录表单启发式分析器
│   │   ├── CheckboxHandler.ts  # 复选框自动勾选处理器
│   │   ├── NativeNotification.ts # 原生浏览器通知
│   │   ├── formSelectors.ts    # CSS 选择器和关键词常量
│   │   └── floatingButtons/    # 悬浮按钮系统
│   │       ├── FloatingButtonManager.ts  # 生命周期管理
│   │       ├── AnimationController.ts    # 淡入淡出动画
│   │       ├── DragHandler.ts            # 拖拽和位置保存
│   │       ├── SettingsPanel.ts          # 设置面板
│   │       ├── icons.ts                  # SVG 图标
│   │       └── styles.ts                 # CSS 样式
│   ├── popup/                  # Popup 弹窗
│   │   ├── App.vue             # 弹窗 UI（管理密码 + 快速填充）
│   │   └── main.ts             # 入口
│   ├── options/                # Options 选项页
│   │   ├── App.vue             # 密码管理主界面
│   │   ├── main.ts             # 入口
│   │   └── styles.css          # 页面样式
│   └── sidepanel/              # SidePanel 侧边栏
│       ├── App.vue             # 快速填充界面
│       └── main.ts             # 入口
├── components/                 # 共享 Vue 组件
│   ├── DisclaimerInfo.vue      # 免责声明
│   ├── ImportDialog.vue        # Excel 导入对话框
│   ├── MasterPasswordDialog.vue # 主密码设置/验证对话框
│   ├── PasswordFormDialog.vue  # 密码表单编辑对话框
│   ├── PasswordVerifyDialog.vue # 密码验证对话框
│   ├── ValidityHoursSelect.vue # 有效期选择器
│   └── ValiditySettingDialog.vue # 有效期设置对话框
├── composables/                # Vue 组合函数
│   ├── useAuthFlow.ts          # 认证流程（设置/验证/会话过期）
│   ├── usePasswordManagement.ts # 密码 CRUD、搜索、排序、导入导出
│   ├── useSessionTimer.ts      # 会话定时器和有效期管理
│   └── useChromeListeners.ts   # Chrome API 事件自动清理
├── utils/                      # 核心工具库
│   ├── storage.ts              # 统一存储门面类
│   ├── encryption.ts           # PBKDF2 + AES-256-CBC 加解密
│   ├── sessionManager-storage.ts # 会话持久化和密码加解密转换
│   ├── sessionManager.ts       # 全局会话检查定时器（单例）
│   ├── excel.ts                # Excel 导入导出
│   ├── types.ts                # TypeScript 类型定义
│   ├── logger.ts               # 环境感知日志工具
│   ├── tagUtils.ts             # 标签颜色生成
│   ├── createVueApp.ts         # Vue 应用工厂函数
│   └── shadowDomStyles.ts      # Shadow DOM 样式注入
├── types/                      # 全局类型声明
│   └── global.d.ts             # Vue SFC、CSS Module、Chrome API 补充
├── styles/                     # 共享样式
│   └── dialog-full-width.css   # 全屏对话框样式
├── assets/icons/               # 静态资源
│   └── icon.svg                # 扩展图标
├── wxt.config.ts               # WXT 框架配置
├── tsconfig.json               # TypeScript 配置
├── eslint.config.js            # ESLint 配置
├── .prettierrc.json            # Prettier 配置
└── .stylelintrc.json           # Stylelint 配置
```

## 开发调试

### 开发命令

```bash
npm run dev             # 开发模式（HMR 热更新）
npm run build           # 生产构建
npm run typecheck       # TypeScript 类型检查
npm run lint            # ESLint 代码检查
npm run lint:fix        # ESLint 自动修复
npm run lint:style      # Stylelint 样式检查
npm run lint:style:fix  # Stylelint 自动修复
npm run format          # Prettier 格式化
npm run format:check    # Prettier 格式检查
npm run lint:all        # 运行所有检查
npm run fix:all         # 运行所有自动修复
```

### 测试页面

项目包含 `test-page.html` 用于表单检测和密码填充功能验证。

### Chrome 权限说明

| 权限         | 用途                           |
| ------------ | ------------------------------ |
| `storage`    | 本地存储密码数据和配置         |
| `activeTab`  | 获取当前标签页信息用于域名匹配 |
| `scripting`  | 动态注入 Content Script        |
| `sidePanel`  | 侧边栏快速填充功能             |
| `<all_urls>` | Content Script 匹配所有页面    |

## 安全提醒

- 主密码遗忘**无法恢复**，请务必妥善保管
- 所有数据本地 AES-256-CBC 加密存储，不经过任何网络传输
- 建议定期通过 Excel 导出功能备份数据
- 会话过期后需重新验证主密码，所有密码自动加密
- 本插件仅用于开发和测试环境，**严禁保存生产环境或个人敏感密码**

## 常见问题

**Q: 忘记主密码怎么办？**
A: 主密码无法找回，只能通过「重置」功能清空所有数据后重新设置。建议定期通过 Excel 导出备份。

**Q: 侧边栏不显示？**
A: 确认 Chrome 版本 >= 114，检查页面是否包含登录表单。也可使用快捷键 `Ctrl+Shift+L` 手动打开。

**Q: Excel 导入失败？**
A: 点击「下载模板」获取标准模板，确保用户名列不为空。支持 .xlsx 和 .xls 格式。

**Q: 密码填充不生效？**
A: 等待页面完全加载后重试。填充器会依次尝试三种策略（Native/execCommand/模拟输入），如仍不生效请刷新页面。

**Q: 悬浮按钮被页面样式影响？**
A: 悬浮按钮使用 Closed Shadow DOM 完全隔离，不受页面样式影响。如有异常请反馈。

**Q: 会话有效期设置后何时生效？**
A: 修改有效期后会立即创建新会话，新的有效期即时生效。

## 许可证

本项目采用 MIT License 开源协议。

## 致谢

- [WXT](https://wxt.dev/) - 现代化 Chrome 扩展开发框架
- [Vue 3](https://vuejs.org/) - 渐进式 JavaScript 框架
- [Element Plus](https://element-plus.org/) - Vue 3 UI 组件库
- [crypto-js](https://github.com/brix/crypto-js) - JavaScript 加密库
- [xlsx](https://github.com/SheetJS/sheetjs) - Excel 文件处理库

## 联系方式

邮箱：[924902324@qq.com](mailto:924902324@qq.com?subject=账号密码管理助手反馈)

欢迎提交 Issue 和 Pull Request！
