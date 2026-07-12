# Chrome Web Store 上架指南

本文档记录 Account Password Helper 上架 Chrome Web Store 的完整流程。

## 前置条件

- Google 账号（已有）
- 双币/全币种信用卡或借记卡（用于支付 $5 注册费）
- 稳定的网络代理（访问 Google 服务）

---

## 第一步：注册 Chrome Web Store 开发者账号

1. 打开 Chrome Web Store Developer Dashboard：
   https://chrome.google.com/webstore/devconsole

2. 使用 Google 账号登录

3. 接受开发者协议

4. 支付 $5 美元一次性注册费（使用双币/全币种卡）

5. 注册成功后，记录下 Dashboard 的访问地址（后续配置 CI/CD 时需要）

> **提示**：注册过程中需要访问 Google 服务，建议选择网络稳定的时段操作。

---

## 第二步：创建扩展商品

在 Developer Dashboard 中：

1. 点击 **"新建商品"** (New Item)

2. 上传扩展 zip 包：`.output/account-password-helper-{version}-chrome.zip`

3. 填写商店信息（Store Listing）：

   **基本信息**：
   - **名称**：Account Password Helper
   - **摘要**（132字符以内）：
     - 中文：安全、便捷的本地密码管理工具。AES-256 加密，数据不出浏览器。
     - 英文：Secure local password manager with AES-256 encryption. Your data never leaves your browser.
   - **详细描述**：参见下方"商店描述模板"
   - **分类**：Productivity
   - **语言**：中文（简体）和 English

   **图形素材**：
   - **商店图标**：128×128 px（可使用 `public/icon/128.png`）
   - **截图**：至少 1 张，1280×800 或 640×400（使用已有素材）
   - **小幅推广图片**（可选）：440×280 px

   **隐私**：
   - **隐私政策 URL**：`https://liaolongdong.github.io/account-password-helper/privacy.html`
   - **数据使用声明**：
     - 不收集任何用户数据
     - 不传输任何数据到远程服务器
     - 不使用任何分析工具

4. 填写 **"权限合理性说明"**（Justification）：

   - `<all_urls>`：需要在任意网站上检测登录表单并提供自动填充功能，这是密码管理扩展的核心功能。
   - `clipboardRead`：支持从剪贴板粘贴导入密码数据。
   - `clipboardWrite`：复制密码到剪贴板，并在指定时间后自动清除。

5. 点击 **"提交审核"** (Submit for Review)

---

## 第三步：配置 CI/CD 自动化发布

### 3.1 获取 OAuth 凭据

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)

2. 创建新项目（或选择已有项目）

3. 启用 **Chrome Web Store API**：
   - 搜索 "Chrome Web Store API"
   - 点击 "启用"

4. 创建 OAuth 2.0 凭据：
   - 进入 "API 和服务" → "凭据"
   - 点击 "创建凭据" → "OAuth 客户端 ID"
   - 应用类型选择 **"桌面应用"**
   - 记录下 **Client ID** 和 **Client Secret**

5. 生成 Refresh Token：

   在浏览器中打开以下 URL（替换 YOUR_CLIENT_ID）：

   ```
   https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=YOUR_CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob
   ```

   - 授权后会得到一个 **授权码 (Code)**
   - 使用以下命令换取 Refresh Token（替换 YOUR_CLIENT_ID 和 YOUR_CLIENT_SECRET 和 AUTH_CODE）：

   ```bash
   curl -X POST https://accounts.google.com/o/oauth2/token \
     -d "code=AUTH_CODE" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "grant_type=authorization_code" \
     -d "redirect_uri=urn:ietf:wg:oauth:2.0:oob"
   ```

   - 从返回的 JSON 中提取 **refresh_token**

### 3.2 配置 GitHub Secrets

1. 打开 GitHub 仓库页面：https://github.com/liaolongdong/account-password-helper

2. 进入 **Settings** → **Secrets and variables** → **Actions**

3. 添加以下 4 个 Secrets：

   | Secret 名称         | 值                                            |
   | ------------------- | --------------------------------------------- |
   | `CWS_EXTENSION_ID`  | 扩展 ID（从 CWS Dashboard 的商品 URL 中获取） |
   | `CWS_CLIENT_ID`     | Google Cloud OAuth Client ID                  |
   | `CWS_CLIENT_SECRET` | Google Cloud OAuth Client Secret              |
   | `CWS_REFRESH_TOKEN` | OAuth Refresh Token                           |

4. 保存所有 Secrets

### 3.3 验证自动化

下次发布新版本时（通过 release-please 创建 Release），CI/CD 会自动：

1. 构建扩展 zip 包
2. 上传到 GitHub Releases
3. 上传到 Chrome Web Store 并提交审核

---

## 第四步：审核与发布

- **首次审核**：通常需要 1-3 个工作日，密码管理类扩展可能更久
- **后续更新**：通常 24 小时内完成审核
- **审核被拒**：根据拒绝理由修改后重新提交

### 审核常见拒绝原因

1. **权限说明不充分**：确保在 Justification 中清晰解释每项权限的用途
2. **隐私政策不完整**：确保隐私政策覆盖了所有数据收集和处理行为
3. **功能不完整**：确保测试账号包含示例数据，审核人员能体验核心功能

---

## 附录：商店描述模板

### 中文描述

```
一款专为开发者和测试人员设计的本地密码管理工具，让多账号登录更安全、更高效。

🔒 安全特性：
• AES-256-GCM 军事级加密
• PBKDF2 密钥派生（600,000 次迭代）
• 数据全部存储在本地，零网络传输
• 主密码加盐哈希保护
• 会话超时自动锁定

⚡ 便捷功能：
• 智能表单检测，一键自动填充
• 侧边栏快捷管理密码
• 自动保存新登录凭据
• CSV/JSON 导入导出
• 加密备份与恢复

🎯 适用场景：
• 开发测试多账号切换
• 日常网站密码管理
• 团队共享密码库（通过加密文件）

完全开源，代码可审计：https://github.com/liaolongdong/account-password-helper
```

### English Description

```
A local password manager designed for developers and testers, making multi-account login safer and more efficient.

🔒 Security Features:
• AES-256-GCM military-grade encryption
• PBKDF2 key derivation (600,000 iterations)
• All data stored locally, zero network transmission
• Master password protected with salted hash
• Auto-lock on session timeout

⚡ Convenience Features:
• Smart form detection with one-click auto-fill
• Side panel for quick password management
• Auto-save new login credentials
• CSV/JSON import/export
• Encrypted backup & restore

🎯 Use Cases:
• Multi-account switching for dev/testing
• Daily website password management
• Team shared password vault (via encrypted files)

Fully open-source, code auditable: https://github.com/liaolongdong/account-password-helper
```

---

## 附录：隐私政策 URL

部署后地址：`https://liaolongdong.github.io/account-password-helper/privacy.html`

隐私政策页面已创建在项目根目录 `privacy.html`，推送到 main 分支后会自动部署到 GitHub Pages。

---

## 附录：CI/CD 配置说明

GitHub Actions workflow `.github/workflows/release-please.yml` 已配置自动发布功能。

当 release-please 创建新 Release 时，会自动：

1. 构建扩展 zip 包
2. 上传到 GitHub Releases（作为 Release Asset）
3. 上传到 Chrome Web Store 并提交审核

如果 Secrets 未配置，步骤 3 会自动跳过，不影响其他流程。
