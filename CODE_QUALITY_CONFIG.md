# 代码质量和格式化配置文档

## 📋 概述

本项目已集成 ESLint、Prettier、Stylelint 三大代码质量和格式化工具，采用前端最佳实践配置，支持 Vue3 + TypeScript + Chrome 扩展开发环境。

## 🛠️ 工具配置

### ESLint 配置

- **配置文件**: `eslint.config.js` (ESLint 9.x 新格式)
- **支持语言**: JavaScript, TypeScript, Vue
- **主要规则**:
  - Vue3 Composition API 最佳实践
  - TypeScript 类型检查
  - Chrome 扩展开发环境支持
  - 与 Prettier 集成

### Prettier 配置

- **配置文件**: `.prettierrc.json`
- **格式化规则**:
  - 单引号: `true`
  - 分号: `true`
  - 行宽: `120`
  - 缩进: `2空格`
  - Vue 单文件组件支持

### Stylelint 配置

- **配置文件**: `.stylelintrc.json`
- **支持格式**: CSS, SCSS, Vue 单文件组件
- **配置特点**:
  - 标准 CSS 规则
  - 属性排序优化
  - 与 Prettier 兼容

## 📝 VSCode 集成

### 自动保存格式化

项目包含 `.vscode/settings.json` 配置，启用:

- 保存时自动格式化
- ESLint 自动修复
- Stylelint 自动修复

### 推荐扩展

项目包含 `.vscode/extensions.json`，推荐安装:

- Prettier - Code formatter
- ESLint
- Stylelint
- Vue Language Features (Volar)
- TypeScript Vue Plugin

## 🚀 使用命令

### Lint 相关命令

```bash
# ESLint 检查
npm run lint

# ESLint 自动修复
npm run lint:fix

# Stylelint 检查
npm run lint:style

# Stylelint 自动修复
npm run lint:style:fix

# 检查所有规则
npm run lint:all
```

### 格式化命令

```bash
# Prettier 格式化
npm run format

# 检查格式化
npm run format:check

# 修复所有问题
npm run fix:all
```

## 🔧 配置特点

### ESLint 特点

- 支持 Vue3 Composition API
- TypeScript 严格模式
- Chrome 扩展 API 全局变量
- 允许 console.log 在开发环境
- 灵活的未使用变量规则

### Prettier 特点

- 120 字符行宽
- 单引号风格
- 尾随逗号处理
- Vue 单文件组件优化
- Markdown 文档格式化

### Stylelint 特点

- CSS 属性自动排序
- 现代 CSS 语法支持
- Vue 样式块处理
- 与其他工具无冲突

## 📁 相关文件

```
project/
├── .eslintrc.cjs                 # ESLint 配置
├── .prettierrc.json             # Prettier 配置
├── .prettierignore              # Prettier 忽略文件
├── .stylelintrc.json            # Stylelint 配置
├── .vscode/
│   ├── settings.json            # VSCode 设置
│   └── extensions.json          # 推荐扩展
└── package.json                 # 脚本命令
```

## 🎯 最佳实践

### 开发流程

1. 编写代码时，VSCode 会实时提示规则违反
2. 保存文件时自动格式化和修复
3. 提交前运行 `npm run lint:all` 检查
4. 使用 `npm run fix:all` 批量修复问题

### Git 工作流建议

```bash
# 开发前
npm install

# 开发中 (VSCode 自动处理)
# 保存时自动格式化

# 提交前
npm run lint:all
npm run build

# 如有问题，批量修复
npm run fix:all
```

## ⚙️ 自定义配置

### 修改 ESLint 规则

编辑 `eslint.config.js`:

```javascript
rules: {
  'vue/max-attributes-per-line': ['error', { singleline: 3 }],
  // 添加自定义规则
}
```

### 修改 Prettier 格式

编辑 `.prettierrc.json`:

```json
{
  "printWidth": 100,
  "singleQuote": false
}
```

### 忽略特定文件

- ESLint: 修改 `eslint.config.js` 中的 `ignores` 数组
- Prettier: 编辑 `.prettierignore` 文件
- Stylelint: 修改 `.stylelintrc.json` 中的 `ignoreFiles` 数组

## 🚨 常见问题

### 1. ESLint 和 Prettier 冲突

项目已配置 `eslint-config-prettier` 解决冲突。

### 2. Vue 文件格式化问题

确保安装了 Vue Volar 扩展并启用。

### 3. TypeScript 类型检查

运行 `npm run typecheck` 进行独立的类型检查。

### 4. Chrome 扩展 API 未定义

项目已在 ESLint 中添加 `chrome` 等全局变量。

## 🎉 总结

本配置提供了完整的代码质量保障体系，支持:

- ✅ 自动代码格式化
- ✅ 实时错误检查
- ✅ Git 提交前验证
- ✅ 团队协作统一标准
- ✅ Chrome 扩展开发优化

配置已针对项目技术栈优化，开箱即用！
