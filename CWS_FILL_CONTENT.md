# CWS 商店填写素材 — 复制粘贴用

> ✅ **已上架**：https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli
>
> 按 Developer Console 的页面顺序整理，逐项复制粘贴即可。后续版本更新时仅需重新上传 zip 包。

---

## 第一步：上传 zip 包

在 Dashboard 点击「新建商品」(New Item)，上传以下文件：

```
.output/account-password-helper-2.11.0-chrome.zip
```

文件位置：`/Users/liaolongdong/code/chrome-plugins/account-password-helper/.output/account-password-helper-2.11.0-chrome.zip`

---

## 第二步：商店商品详情 (Store Listing)

### 名称 (Name) — 最多 45 字符

```
Account Password Helper
```

### 摘要 (Summary) — 最多 132 字符

```
本地密码管理工具，AES-256-GCM 加密、零网络传输。智能识别登录表单、一键填充自动登录、自动保存、导入导出、加密备份、TOTP 两步验证、安全体检、到期提醒、弱口令检测、回收站、密码历史、修改主密码、中英双语，开源免费。
```

### 说明 (Description) — 最多 16,000 字符

```
一款专为开发、测试、产品以及普通人员设计的本地账号密码管理工具，让多账号、多系统登录更安全、更高效、更便捷。

🔒 安全特性
• AES-256-GCM 军事级加密
• PBKDF2 密钥派生（600,000 次迭代）
• 数据全部存储在本地，零网络传输
• 主密码加盐哈希保护
• 支持修改主密码（全部数据原子换钥重加密，不丢数据、无需重新登录）
• 会话超时自动锁定
• 支持配置闲置自动锁定
• 浏览器重启锁定（可选）
• 跨 iframe 表单检测与填充

⚡ 便捷功能
• 智能表单检测，一键自动填充
• 一键填充快捷键（Ctrl+Shift+F，无需打开侧边栏直接填充，通知 + 角标双通道反馈）
• 侧边栏快捷管理密码（毫秒级响应）
• 内联填充模式（登录框内钥匙图标，点击即填充）
• 自动保存新登录凭据
• CSV / JSON / 加密备份导入导出（表头跟随界面语言，中英文表头均可自动识别）
• 邮箱备份（支持加密/不加密两种方式）
• 密码生成器（随机密码 + 助记词组两种模式，助记词组既安全又易记）
• 剪贴板自动清除
• TOTP 两步验证码（本地 RFC 6238 动态码，零网络）
• 6 款色彩主题（晴空蓝/青竹绿/桃花粉/樱粉紫/落霞橙/雾墨灰）
• Service Worker 保活，确保持续可用

🔍 安全体检
• 一键扫描密码库健康状况（0~100 分综合评分）
• 检测弱密码、密码复用、常见泄露密码（离线 top-1000 字典）、长时间未更新（90/180/365 天分级预警）
• 提示未开启两步验证的账号
• 密码到期提醒：为每条密码设置 N 天后提醒更换，到期自动桌面通知
• 全程本地计算，不联网、不上传任何数据

🌐 国际化
• 支持中文 / English 双语界面
• 语言入口位于「偏好设置」面板（管理页 / 悬浮按钮 / 侧边栏三入口可达）
• 运行时切换，无需重启扩展，所有页面实时同步
• 覆盖网页内提示（保存弹窗 / 内联填充 / 页面通知）与桌面通知

🎯 适用场景
• 开发测试多账号切换
• 日常网站密码管理
• 团队共享密码库（通过加密文件）

📦 数据管理
• CSV / JSON 导入导出
• 加密备份文件（.aph 格式）
• 邮件备份提醒（支持加密备份）
• 密码收藏夹
• 回收站：删除的密码保留 30 天，可随时恢复、彻底删除或清空，超期自动清理
• 密码修改历史：自动快照旧密码（加密存储，每条保留 5 条），编辑弹窗中可复制或恢复

⚙️ 高度可定制
• 6 款色彩主题，一键换肤
• 可配置会话超时时间
• 浏览器重启锁定开关
• 浮动按钮位置、透明度可调
• 自动保存行为可开关
• 排序方式自定义

插件操作指引和演示地址：https://liaolongdong.github.io/account-password-helper/
完全开源，代码可审计，github地址：https://github.com/liaolongdong/account-password-helper

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
定时执行版本更新检查（每 6 小时）、自动备份提醒和 Service Worker 保活（会话期间每 1 分钟），通过 chrome.alarms API 实现。
```

**notifications**

```
向用户发送桌面通知，包括版本更新提示和定期备份提醒。
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
