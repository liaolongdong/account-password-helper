# Account Password Helper — 贡献指南

你好！感谢你对 **Account Password Helper** 感兴趣。在提交贡献之前，请先阅读以下指南，以确保你的贡献能够被顺利接受。

## 项目简介

Account Password Helper 是一款基于 Chrome 扩展的账号密码管理工具，支持密码加密存储、自动填充、自动登录、Excel 导入导出、主密码保护等功能。

## 技术栈

| 类别      | 技术                          |
| --------- | ----------------------------- |
| 框架      | [WXT](https://wxt.dev/)       |
| UI 框架   | Vue 3 (Composition API)       |
| 语言      | TypeScript                    |
| UI 组件库 | Element Plus（按需引入）      |
| 构建工具  | Vite（由 WXT 内置管理）       |
| 代码规范  | ESLint + Prettier + Stylelint |
| Git Hooks | Husky + lint-staged           |

## 仓库搭建

1. Fork 本仓库并 clone 到本地。

2. 安装依赖（要求 Node.js >= 18）：

   ```sh
   npm install
   ```

3. 启动开发模式（Chrome）：

   ```sh
   npm run dev
   ```

4. 在 Chrome 中加载 `dist` 目录生成的扩展。

### Windows 用户提示

如果在 Windows 上遇到符号链接相关问题，建议[启用开发者模式](https://docs.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development)。

## 项目结构

```
.
├── entrypoints/        # 扩展入口
│   ├── background.ts   # Service Worker（后台脚本）
│   ├── content.ts      # Content Script（内容脚本）
│   ├── popup/          # Popup 弹窗页
│   ├── options/        # 设置页（密码管理主界面）
│   └── sidepanel/      # 侧边栏
├── components/         # 公共 Vue 组件
├── composables/        # Vue 组合式函数（业务逻辑复用）
├── utils/              # 工具函数（加密、存储、日志等）
├── styles/             # 全局样式
├── types/              # 全局 TypeScript 类型声明
└── scripts/            # 构建/辅助脚本
```

## 开发规范

### 代码风格

- 使用 ESLint 进行静态代码分析，使用 Prettier 进行代码格式化。
- CSS/样式代码使用 Stylelint 检查，并遵循属性排序规范（recess-order）。
- 新增代码必须通过以下命令检查：

  ```sh
  npm run lint:all
  ```

### 日志规范

- **禁止**直接使用 `console.log` / `console.warn` / `console.error`。
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

### Git Hooks

项目已配置 `husky` + `lint-staged`，每次 `git commit` 前会自动对变更文件执行：

- `eslint --fix` + `prettier --write`（TypeScript / Vue / JS 文件）
- `stylelint --fix`（CSS / SCSS / Vue 样式文件）
- `prettier --write`（JSON / Markdown 文件）

请确保提交前所有检查通过。

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
