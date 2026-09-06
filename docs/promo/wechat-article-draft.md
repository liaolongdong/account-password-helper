# 【微信公众号 · 待发布草稿】

> ⚠️ 这是**待发稿件，尚未自动发布**。请审阅后用微信编辑器或 `/baoyu-post-to-wechat` 手动发布。
> 建议用 `/baoyu-article-illustrator` 为标注 🖼 的位置生成/复用配图；现有截图位于 `assets/screenshots/`。

---

**标题（主）**：我做了个「只在你浏览器里」的密码管理器：一键登录、多环境账号不填错

**备选标题**：

- 告别云端焦虑：一个纯本地、免注册的开源密码管理 Chrome 扩展
- 开发者的多环境账号救星：精确域名隔离 + Ctrl+Shift+F 一键登录

**摘要（digest，120 字内）**：
一款开源免费、数据纯本地的 Chrome 密码管理扩展。PBKDF2+AES-256-GCM 本地加密，零网络传输、免注册；快捷键一键登录（填充+勾选协议+点击登录），精确域名隔离 dev/test/staging/prod，内置 TOTP 与安全体检。

**作者/账号**：（发布时填写公众号作者名）

---

## 正文

![封面图 🖼 建议用 assets/cws-store/marquee-1400x560.png]

先说清它是什么：**账号密码管理助手（Account Password Helper）**，一款**开源免费、数据 100% 留在你浏览器里**的 Chrome 密码管理扩展。没有云端、没有账号、没有订阅，也不需要注册任何东西。

### 为什么又做一个密码管理器？

因为我自己的痛点很具体——作为开发者/测试，同一个网站我手里有开发、测试、预发、生产**四套环境、十几个账号**，长得很像。普通密码管理器只会填表单，**环境一多就填错**，登录还得自己勾协议、自己点登录按钮。

于是我把这些"刚需"做进了一个扩展里。

### 它能帮你做什么

**1. 一键登录，不只是填充**
按下 `Ctrl+Shift+F`：自动填账号密码 → 自动勾选"同意条款" → 自动点击登录按钮，1 秒完成。别的工具只填表，登录按钮还得你自己点。

🖼 配图建议：`assets/screenshots/06-sidepanel-fill.png` 或一键登录 GIF（`docs/demo-login.gif`）

**2. 精确域名多环境隔离**
dev / test / staging / prod 的账号按域名精确匹配，同一站点不同环境互不混淆——这条对开发者几乎是决定性功能。

**3. 内置 TOTP 两步验证**
验证码和密码住在一起，按 RFC 6238 本地生成。GitHub 式两步登录时，活码胶囊自动锚定在输入框旁，一键填入，不用再掏手机。

🖼 配图建议：`assets/screenshots/09-totp-code.png`

**4. 离线安全体检**
一键给出 0–100 评分，五维检测：弱密码 / 密码复用 / 常见泄露密码 / 长期未更新 / 未开两步验证，**全程本地计算，不联网**。

🖼 配图建议：`assets/screenshots/10-health-check.png`

**5. 纯本地加密，零网络传输**
主密码经 **PBKDF2（600,000 次迭代）** 派生密钥，敏感字段用 **AES-256-GCM** 认证加密，数据全部加密存在浏览器本地，永不出机器。

### 和 Bitwarden / 1Password / Chrome 自带怎么选？

一句话：**需要跨设备云同步、移动端 App、团队协作 → 选 Bitwarden / 1Password；只想要免注册、数据绝不出浏览器、还能一键登录 → 选这个。** 它完全免费开源（GPL-3.0），内置 TOTP 与安全体检都免费；取舍是**没有云同步、没有移动端 App**。

完整八维度对比我放在官网页：https://liaolongdong.github.io/account-password-helper/compare.html

### 从别的工具搬家？30 秒搞定

支持 CSV / JSON 导入，自动识别 **Chrome、LastPass、Bitwarden、1Password** 导出格式，列名自动映射；导出同样方便，数据随时能带走，绝不锁定。

🖼 配图建议：`assets/screenshots/03-excel-import.png`

### 还想再多嘴一句安全

它是为**开发、测试和日常登录**场景而生的。和任何浏览器扩展一样，**不建议在里面存放银行、支付等高敏感凭证**。忘记主密码无法找回，请定期用加密备份（.aph）导出。

### 去哪拿

- Chrome 应用商店（推荐，自动更新）：搜「账号密码管理助手」，或直接安装 👉 https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli
- 官网演示 + 完整 FAQ：https://liaolongdong.github.io/account-password-helper/
- 开源地址：https://github.com/liaolongdong/account-password-helper
- 无法访问 Google 的用户：可从 GitHub Releases 下载 zip 手动安装

> 觉得有用的话，帮忙点个 **赞 / 在看 / 转发**，或到 Chrome 应用商店留个五星——这是对独立开发者最大的支持 🙏

---

_（文末可放微信交流群二维码：`assets/wx-qrcode/`，备注 aph 进群）_
