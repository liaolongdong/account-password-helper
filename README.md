# Account Password Helper - 账号密码管理助手

一个现代化的Chrome浏览器扩展，提供安全便捷的账号密码管理与自动填充功能。采用军工级加密技术，支持Excel导入导出，具备智能表单识别能力。

<p align="center">
  <img src="./assets/icons/icon.svg" alt="插件图标" width="120" />
</p>

## 🌟 核心特性

- 🔐 **军工级安全**：PBKDF2 + AES-256-CBC加密，主密码保护
- 🤖 **智能识别**：自动检测登录表单，支持多种输入场景
- ⚡ **一键填充**：侧边栏快速填充，支持复选框自动勾选
- 📊 **数据管理**：Excel导入导出，拖拽排序，标签分类
- 🎛️ **灵活配置**：会话有效期管理，悬浮按钮自定义

## 🚀 主要功能

### 🔐 安全保护
- PBKDF2 + AES-256-CBC双重加密
- 主密码保护，支持1-24小时会话有效期
- 本地存储，零网络传输

### 🤖 智能识别
- 自动检测登录表单（用户名+密码、手机号+验证码）
- 智能匹配URL，支持通配符
- 复选框自动勾选（记住我等）

### 📊 数据管理
- Excel导入导出（.xlsx格式）
- 标签分类管理
- 拖拽排序
- 搜索过滤

### ⚡ 快速操作
- 侧边栏一键填充
- 快捷键支持（Ctrl+Shift+P/L）
- 悬浮按钮自定义
- 批量操作支持

## 🛠️ 技术栈

- **框架**: [WXT](https://wxt.dev/) + Vue 3 + TypeScript
- **UI库**: Element Plus
- **加密**: crypto-js (AES-256-CBC + MD5)
- **数据处理**: xlsx (Excel导入导出)
- **构建工具**: Vite

## 📦 安装部署

### 开发环境

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 生产构建
npm run build
```

### Chrome安装
1. 构建：`npm run build`
2. Chrome扩展页面开启开发者模式
3. 加载 `.output/chrome-mv3` 目录
4. 首次使用需设置主密码

## 🎯 使用指南

### 🔐 初始设置
1. 首次使用需设置主密码（至少8位，包含大小写字母、数字、特殊字符）
2. 设置会话有效期（1-24小时）
3. 可配置悬浮按钮显示和位置

### 📝 密码管理
- **添加密码**：选项页面手动添加或Excel批量导入
- **编辑密码**：点击条目编辑按钮修改信息
- **搜索过滤**：支持用户名、标签、备注、URL多字段搜索
- **批量操作**：支持多选删除、标签批量修改

### ⚡ 快速填充
1. 在登录页面输入框聚焦时自动显示侧边栏
2. 选择对应密码条目一键填充
3. 自动勾选"记住我"等复选框
4. 支持快捷键操作（Ctrl+Shift+L）

### 📊 数据导入导出
- **Excel导入**：支持.xlsx格式，提供标准模板
- **Excel导出**：包含完整字段信息和时间戳
- **字段映射**：支持中英文列名（用户名/username、密码/password等）

## 📊 Excel格式支持

### 支持列名
| 中文列名 | 英文列名 | 必填 | 说明 |
|---------|---------|------|------|
| 用户名 | username | ✓ | 账号/邮箱/手机号 |
| 密码 | password | ✓ | 登录密码 |
| URL | url | ✗ | 网站地址 |
| 标签 | tag | ✗ | 分类标签 |
| 备注 | remark | ✗ | 说明信息 |

### 模板示例
```
用户名(必填)    密码(必填)   URL(选填)          标签  备注
user@email.com  password123  https://example.com  工作  示例账号
```

## 🧪 开发调试

### 测试页面
项目包含 `test-page.html` 用于功能验证

### 调试命令
```bash
npm run dev        # 开发模式
npm run build      # 生产构建
npm run typecheck  # 类型检查
npm run lint       # 代码检查
```

## ⚠️ 安全提醒

- 🔐 主密码遗忘无法恢复，请务必妥善保管
- 🛡️ 所有数据本地AES-256加密存储
- 📅 建议定期导出Excel备份数据
- ⚠️ 会话过期后需重新验证主密码

## 👨‍💻 开发说明

### 环境要求
- Node.js ≥ 16.0.0
- Chrome ≥ 114 (支持SidePanel API)

### 项目结构
```
entrypoints/     # 扩展入口点
├── background.ts # 后台脚本
├── content.ts   # 内容脚本
├── popup/       # 弹窗界面
├── options/     # 密码管理页面
└── sidepanel/   # 侧边栏填充界面

utils/           # 核心工具
├── storage.ts   # 加密存储管理
├── excel.ts     # Excel处理
└── types.ts     # TypeScript类型
```

## 📄 许可证

本项目采用 MIT License 开源协议

## 🙏 致谢

- [WXT](https://wxt.dev/) - Chrome扩展开发框架
- [Vue 3](https://vuejs.org/) - 前端框架
- [Element Plus](https://element-plus.org/) - UI组件库
- [crypto-js](https://github.com/brix/crypto-js) - 加密库
- [xlsx](https://github.com/SheetJS/sheetjs) - Excel处理库

## ❓ 常见问题

**Q: 忘记主密码怎么办？**
A: 主密码无法找回，只能清空重置。建议定期备份数据。

**Q: 侧边栏不显示？**
A: 确认Chrome版本≥114，检查页面是否包含登录表单。

**Q: Excel导入失败？**
A: 使用标准模板，确保必填字段不为空，避免特殊字符。

**Q: 密码填充不生效？**
A: 等待页面加载完成，或手动点击输入框触发检测。

## 📮 联系方式

📧 邮箱：[924902324@qq.com](mailto:924902324@qq.com)

欢迎提交 Issue 和 Pull Request！