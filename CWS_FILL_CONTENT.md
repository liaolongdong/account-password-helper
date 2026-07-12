# CWS 商店填写素材 — 复制粘贴用

> 按 Developer Console 的页面顺序整理，逐项复制粘贴即可。

---

## 第一步：上传 zip 包

在 Dashboard 点击「新建商品」(New Item)，上传以下文件：

```
.output/account-password-helper-2.9.0-chrome.zip
```

文件位置：`/Users/liaolongdong/code/chrome-plugins/account-password-helper/.output/account-password-helper-2.9.0-chrome.zip`

---

## 第二步：商店商品详情 (Store Listing)

### 名称 (Name) — 最多 45 字符

```
Account Password Helper
```

### 摘要 (Summary) — 最多 132 字符

```
安全、便捷的本地密码管理工具。AES-256 加密，数据不出浏览器。支持智能表单检测、一键填充、自动保存、导入导出。
```

### 说明 (Description) — 最多 16,000 字符

```
一款专为开发者和测试人员设计的本地密码管理工具，让多账号登录更安全、更高效。

🔒 安全特性
• AES-256-GCM 军事级加密
• PBKDF2 密钥派生（600,000 次迭代）
• 数据全部存储在本地，零网络传输
• 主密码加盐哈希保护
• 会话超时自动锁定

⚡ 便捷功能
• 智能表单检测，一键自动填充
• 侧边栏快捷管理密码
• 自动保存新登录凭据
• CSV / JSON / 加密备份导入导出
• 随机密码生成器
• 剪贴板自动清除

🎯 适用场景
• 开发测试多账号切换
• 日常网站密码管理
• 团队共享密码库（通过加密文件）

📦 数据管理
• CSV / JSON 导入导出
• 加密备份文件（.aph 格式）
• 邮件备份提醒
• 密码收藏夹

⚙️ 高度可定制
• 可配置会话超时时间
• 浮动按钮位置、透明度可调
• 自动保存行为可开关
• 排序方式自定义

完全开源，代码可审计：https://github.com/liaolongdong/account-password-helper
```

### 分类 (Category)

选择：**Productivity**（效率工具）

### 语言 (Language)

选择：**Chinese (Simplified) - 中文（简体）**

---

## 第三步：图形资产 (Graphic Assets)

### 商店图标 (Store Icon) — 128×128 PNG

使用项目中的文件：

```
public/icon/128.png
```

### 屏幕截图 (Screenshots) — 至少 1 张，1280×800 或 640×400

使用 `assets/screenshots/` 目录中的截图文件。

### 小幅推广图片 (Small Promo Tile) — 440×280（可选）

可暂时跳过。

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
提供浏览器侧边栏面板，用于集中管理、搜索、编辑所有已保存的密码条目。
```

**alarms**

```
定时执行版本更新检查（每 6 小时）和自动备份提醒，通过 chrome.alarms API 实现。
```

**downloads**

```
支持将密码数据导出为 CSV、JSON 文件或加密备份文件（.aph 格式）到本地。
```

**notifications**

```
向用户发送桌面通知，包括版本更新提示和定期备份提醒。
```

**idle**

```
检测用户空闲状态，在超过设定的超时时间后自动锁定扩展，保护密码安全。
```

**clipboardWrite**

```
支持将密码复制到系统剪贴板，并在可配置的时间后自动清除剪贴板内容。
```

**clipboardRead**

```
支持从剪贴板粘贴数据以实现批量导入功能。
```

**webNavigation**

```
监听页面导航事件（页面加载完成），优化表单检测时机，确保在页面渲染完成后及时检测登录表单。
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

## 检查清单

上传前确认：

- [ ] zip 包已上传
- [ ] 名称、摘要、说明已填写
- [ ] 分类选择 Productivity
- [ ] 商店图标已上传（128×128）
- [ ] 至少 1 张截图已上传
- [ ] 隐私政策 URL 已填写
- [ ] 数据使用声明已选择「不收集」
- [ ] 所有权限的合理性说明已填写
- [ ] 可见性选择 Public
- [ ] 点击「提交审核」
