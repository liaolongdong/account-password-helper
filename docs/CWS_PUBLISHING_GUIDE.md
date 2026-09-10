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
   - **名称**：中文 `账号密码管理助手 - 本地加密密码管理器` / 英文 `Account Password Helper - Password Manager`（须与 `public/_locales/*/messages.json` 的 `extensionName` 逐字一致）
   - **摘要**（132字符硬限制，中英各一条）：
     - 权威来源是 `public/_locales/zh_CN/messages.json` 与 `en/messages.json` 的 `extensionDescription`（manifest 通过 `__MSG_extensionDescription__` 引用）。商店列表必须粘贴**同一句话**——两份副本逐字一致，否则审核会判定描述与 manifest 不符。可直接粘贴的当前文案见 `CWS_FILL_CONTENT.md`「第二步 → 摘要」。
     - ✅ 口径已订正：旧文案中的「零联网」/「100% offline」并不成立（扩展每 6 小时发起一次不携带用户数据的匿名版本检查），两份 `_locales` 的 `extensionDescription` 已改为限定口径。
     - 🚫 **2026-09-09 关键字堆砌驳回后的现行口径（2026-09-10 二 / 三 / 四次修订）**：中文 **131 字符** / 英文 **130 字符**（上限 132，不留白）——句式必须是**读得通的完整句子**，功能项挂在谓语（中文「含……」/ 英文 `with …`）下面，而不是逗号裸串；品类词「密码管理器 / password manager」只出现一次，**不含任何竞品品牌名（Chrome / LastPass / Bitwarden / 1Password）**。`AES-256-GCM` 按用户要求写回摘要（准确的算法名，此前正文里不完整的「AES-256」已一并更正），`PBKDF2` 迭代次数这类参数仍只放在详细说明的【安全架构】。摘要按用户要求覆盖两步验证（TOTP/2FA）/ 密码强度检测 / 迁移导入，英文额度更紧，「密码可见性切换」只写在说明的 FEATURE SET。详细描述同日四次修订后为中文 **2380** / 英文 **6961** 字符（上限 16,000）：评审回填了「选中导出」「两步验证（TOTP）独立条目」「真的完全免费吗 / 能从其他密码管理器导入吗」三条，回填方式是**机制归【功能全览】、价值归【为什么选择它】、问答只讲本节独有事实**，跨节不留重复句。3.8.0 草稿正是被 `Chrome, LastPass, Bitwarden, and 1Password (CSV/JSON formats` 判为 keyword stuffing，旧草稿已关闭，须在**已有商品**里上传新包生成新草稿重新提交（不要点「新建商品」）。
     - **剩余动作**：`pnpm build` 后重新上传商店包，线上摘要才会与新文案一致。
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
     - 不将任何用户数据传给第三方，也不做用户画像或广告用途
     - 不使用任何分析工具
     - 说明：扩展确有一个出站请求——每 6 小时一次的匿名版本检查（探测 Chrome 商店可达性，不可达时改读 GitHub Releases 版本号），不携带账号、密码、标识符或任何用户数据。它不属于「数据收集」，但填写时不要写成「扩展不发起任何网络请求」，那与 manifest 行为不符。

4. 填写 **"权限合理性说明"**（Justification）：

   完整、可直接粘贴的中英文说明以 `CWS_FILL_CONTENT.md`「第五步 → 权限合理性说明」为准（覆盖 storage / activeTab / scripting / sidePanel / alarms / notifications / idle / clipboardWrite / clipboardRead / webNavigation / contextMenus / favicon / `<all_urls>`）。以下是三个最容易被问到的：

   - `<all_urls>`：需要在任意网站上检测登录表单并提供自动填充功能，这是密码管理扩展的核心功能。
   - `clipboardRead`：仅在「复制密码后自动清除剪贴板」前读取一次，用于校验剪贴板内容是否已被用户替换，避免误清你新复制的内容；不用于导入，也不上传读取结果。
   - `clipboardWrite`：复制密码到剪贴板，并在可配置的时间后自动清除。

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

   | Secret 名称         | 值                                                             |
   | ------------------- | -------------------------------------------------------------- |
   | `CWS_EXTENSION_ID`  | `fgimkdodpjfkddmildjieojpfakpanli`（商店商品 URL 中即为该 ID） |
   | `CWS_CLIENT_ID`     | Google Cloud OAuth Client ID                                   |
   | `CWS_CLIENT_SECRET` | Google Cloud OAuth Client Secret                               |
   | `CWS_REFRESH_TOKEN` | OAuth Refresh Token                                            |

   > ℹ️ `release-please.yml` 的发布步骤带 `if: env.CWS_EXTENSION_ID != ''`：该 Secret 留空时 CI 只构建并上传 GitHub Release 产物，**跳过**自动提交商店审核，需回到 Dashboard 手动上传 zip。
   >
   > ⚠️ 发布前有一个校验步骤会确认 `CWS_EXTENSION_ID` 是 32 位 `a-p` 小写字母；从 URL 复制时带入空格或换行会直接失败并打印实际长度，此时在 Secrets 中重新粘贴纯净 ID 即可。

4. 保存所有 Secrets

### 3.3 验证自动化

下次发布新版本时（通过 release-please 创建 Release），CI/CD 会自动：

1. 构建扩展 zip 包（`pnpm build`，Node 22 + pnpm 缓存）
2. 上传到 GitHub Releases（`.output/*-chrome.zip` 作为 Release Asset）
3. 解析出实际 zip 路径后上传到 Chrome Web Store 并提交审核

发布前还有三道预检，失败会直接终止发布并给出明确原因，而不是抛出一个不透明的 400/404：

- **解析 zip 路径**：`mnao305/chrome-extension-upload` 的 `file-path` 不接受 glob，故先 `ls -t .output/*-chrome.zip | head -n1` 取最新产物
- **验证 OAuth 凭据**：用 refresh token 交换 access token（只打印错误体，绝不打印 token）。`invalid_grant` 多为 token 过期或 OAuth 应用仍处于 Testing 模式
- **验证扩展 ID 格式**：必须是 32 位 `a-p` 小写字母，混入空格/换行会在此拦下

---

## 第四步：审核与发布

- **首次审核**：通常需要 1-3 个工作日，密码管理类扩展可能更久
- **后续更新**：通常 24 小时内完成审核
- **审核被拒**：根据拒绝理由修改文案或代码后**新建草稿**重新提交——被拒的草稿本身已关闭，不能在其上继续编辑

### 审核常见拒绝原因

1. **权限说明不充分**：确保在 Justification 中清晰解释每项权限的用途
2. **隐私政策不完整**：确保隐私政策覆盖了所有数据收集和处理行为
3. **功能不完整**：确保测试账号包含示例数据，审核人员能体验核心功能
4. **关键字堆砌（Spam 政策）**：本项目 2026-09-09 的 3.8.0 草稿即被判 `产品说明中有过多关键字`，被点名文本为 `Chrome, LastPass, Bitwarden, and 1Password (CSV/JSON formats`（[政策](https://developer.chrome.com/webstore/program_policies#spam) / [排查](https://developer.chrome.com/docs/webstore/troubleshooting/#keyword-stuffing)）。三个触发点：**竞品品牌名当关键词用**、**同一卖点在「为什么选它 / 适合谁 / 功能全览 / 常见问题」四节里各写一遍**、**摘要用逗号串起 6~8 个关键词**。修法见 `CWS_FILL_CONTENT.md`「第二步」与「7.4 注意事项」，提交前用下方扫描命令自检。

---

## 第五步：事实一致性校验（每次发版必做）

商店详情、README、官网与 AI 引擎引用的**事实**必须完全一致（事实变了处处改；文案表达各表面可自由优化）。发版前按下表逐项校验：

### 核心事实清单（单一事实来源）

| 事实项          | 权威口径                                                                                                                                                                                                                                                                                                                                                                                                                          | 出现位置                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 开源协议        | GPL-3.0-only                                                                                                                                                                                                                                                                                                                                                                                                                      | README、index.html（hero 徽章）、llms.txt、CWS_FILL_CONTENT.md                                                                                               |
| PBKDF2 迭代次数 | 600,000 次（短标签可用 600K，禁止无千分位的 600000）                                                                                                                                                                                                                                                                                                                                                                              | README、index.html、llms.txt、CWS_FILL_CONTENT.md、CONTRIBUTING.md                                                                                           |
| 加密算法        | AES-256-GCM（Web Crypto API 原生实现）                                                                                                                                                                                                                                                                                                                                                                                            | 全部表面                                                                                                                                                     |
| 加密粒度        | 逐字段加密 5 个敏感字段（用户名 / 密码 / 网址 / 备注 / 两步验证密钥），锁定或会话过期只销毁密钥材料与解密快照，**不做整库重新加密**                                                                                                                                                                                                                                                                                               | README、ARCHITECTURE、CONTRIBUTING、CWS_FILL_CONTENT.md、privacy.html、llms.txt                                                                              |
| 一键登录口径    | 完整登录来自侧边栏「填充并登录」或偏好设置「自动触发登录」；`Ctrl+Shift+F` 有意只填充与勾选、不点击登录按钮。禁止把「一键登录」归因于该快捷键                                                                                                                                                                                                                                                                                     | 全部表面（含 `quickFillHandler.ts` 的 `autoLogin: false` 实现）                                                                                              |
| 安全体检计分    | 0–100 综合评分，**四个**计分维度按权重合计：复用 35 / 弱密码 25 / 常见泄露 20 / 长期未更新 20；「未开启两步验证」仅列示不计分。禁止写「五维检测」                                                                                                                                                                                                                                                                                 | README、ARCHITECTURE、CWS_FILL_CONTENT.md、index.html、llms.txt、help.json（已订正，随下一次 `pnpm build` 生效）                                             |
| 助记词词库      | 内置 **3080** 词词库（≈46 bit），表述为「思路参考 EFF Diceware」。禁止写「EFF 2048 词」                                                                                                                                                                                                                                                                                                                                           | CONTRIBUTING、CWS_FILL_CONTENT.md、llms.txt、help.json、passphraseGenerator.ts（均已订正为 3080 / ≈46 bit）                                                  |
| 密码历史        | 每条可配 1~10 份加密快照，**默认 3 份**（`DEFAULT_MAX_HISTORY_PER_ENTRY = 3`）。禁止写默认 5 份                                                                                                                                                                                                                                                                                                                                   | README、ARCHITECTURE、index.html、pricing.md、llms.txt                                                                                                       |
| 导入导出格式    | CSV / JSON 双格式，自动识别 Chrome / LastPass / Bitwarden / 1Password 导出；**不解析 .xlsx**（Excel 只体现为「导出的 CSV 可直接双击打开、中文不乱码」）。**分表面**：README / 官网 / 扩展内导入向导可列具体品牌名；**Chrome 商店的名称、摘要、说明、权限说明与 Featured 提名文案一律不写品牌名**，统一说「常见密码管理器的导出格式 / the export formats of common password managers」（2026-09-09 因品牌名被判 keyword stuffing） | README、ARCHITECTURE、index.html、pricing.md、compare.html；`CWS_FILL_CONTENT.md` 仅出现在说明性批注中，粘贴块内为零                                         |
| 侧边栏性能      | 秒开（SLA <1s）；缓存快路径 20-50ms。禁止无限定词的裸「20-50ms 秒开」；英文正文用 en-dash（20–50ms），机器可读文件 llms.txt 用连字符（20-50ms）                                                                                                                                                                                                                                                                                   | README、README.en.md、index.html、llms.txt、CWS_FILL_CONTENT.md、docs/reddit-post.md                                                                         |
| 版本号          | 与 package.json 的 version 一致                                                                                                                                                                                                                                                                                                                                                                                                   | index.html（footer.updated 中英两处 + JSON-LD softwareVersion）、llms.txt（Last updated）、CWS 后台                                                          |
| 测试数量        | tests/ 实际执行的用例数与测试文件数（见下方校验命令）                                                                                                                                                                                                                                                                                                                                                                             | README、README.en.md（用例数）、llms.txt（用例数 + 文件数）                                                                                                  |
| 免费口径        | 完全免费、无订阅、无账号、无云端                                                                                                                                                                                                                                                                                                                                                                                                  | 全部表面 + pricing.md                                                                                                                                        |
| 隐私承诺        | 不收集、不上传任何用户数据；无遥测与分析；数据仅存本地。**唯一出站请求是每 6 小时一次的匿名版本检查，不携带用户数据**——禁止再写「零网络传输 / 数据不出浏览器 / 100% offline」                                                                                                                                                                                                                                                     | 全部表面 + privacy.html（须与商店 Privacy 标签一致）；`public/_locales/*/messages.json` 摘要已改为限定口径，仍需 `pnpm build` + 重新上传商店包才会在线上一致 |
| 联系方式        | 邮箱 924902324@qq.com / 微信 lld_1025                                                                                                                                                                                                                                                                                                                                                                                             | README、index.html、CWS_FILL_CONTENT.md                                                                                                                      |
| 文档更新时间    | 与发版月份一致（格式 `YYYY-MM`），版本号同步更新。隐私页使用精确日期（仅隐私政策实际变更时更新）                                                                                                                                                                                                                                                                                                                                  | README.md、README.en.md（末尾行）、index.html（footer.updated 中英）、en.html（footer.updated 中英）、llms.txt（Last updated）                               |

### 快速校验命令

````bash
# 性能口径：所有命中均应带「缓存快路径 / warm path」限定词
rg -n "20-50|20–50" README.md README.en.md index.html llms.txt docs/CWS_FILL_CONTENT.md docs/reddit-post.md

# PBKDF2 千分位：不应出现无千分位的 600000
rg -n "600000" README.md README.en.md index.html llms.txt docs/CWS_FILL_CONTENT.md docs/CONTRIBUTING.md

# 版本号：三处应与 package.json 的 version 一致
rg -n "softwareVersion|footer.updated" index.html

# 文档更新时间：7 处年月应一致且与发版月份匹配（下方「其他同步约定」列出的完整清单）
rg -n "最后更新\|Last updated\|文档最后更新" README.md README.en.md index.html en.html llms.txt

# 测试数量：以 vitest 实际执行结果为准，取 Test Files / Tests 两行汇总
# 勿用静态 grep 计数 `it(` / `test(`：循环与 it.each 生成的用例统计不到，会得出偏小的数字
pnpm test:run 2>&1 | grep -E "Test Files|Tests"

# 已废止口径：命中处只应是本指南与文档里标注待办的那几行 ⚠️，出现新命中即为口径回退
rg -n "零网络传输|零联网|数据不出浏览器|100% offline|军事级|2048|五维|默认 5 份|Excel 导入" README.md README.en.md index.html en.html llms.txt privacy.html privacy.en.html pricing.html docs/

# 商店元数据自检（提交前必跑）：只扫描 CWS_FILL_CONTENT.md「第二步」里会被复制粘贴的代码块
# 1) 竞品品牌名与已废止的绝对化表述必须为零（AES-256-GCM / PBKDF2 已按 2026-09-10 决定允许出现）
# 2) 中英 extensionName、extensionDescription 与粘贴块逐字一致
# 3) 跨小节重复行扫描：同一句话在小节里抄第二遍是 keyword-stuffing 判定的结构特征
python3 - <<'PY'
import json, re
doc = open('docs/CWS_FILL_CONTENT.md', encoding='utf-8').read()
seg = doc.split('## 第二步')[1].split('## 第三步')[0]
blocks = re.findall(r'```\n(.*?)```', seg, re.S)
banned = ('LastPass', 'Bitwarden', '1Password', 'Chrome', '零联网', '零网络传输', '100% offline', '数据不出浏览器', '军事级', '五维')
bad = {i: [k for k in banned if k in b] for i, b in enumerate(blocks) if any(k in b for k in banned)}
print('paste blocks:', len(blocks), '| banned hits:', bad or 'none')
for idx, lang in ((2, 'zh'), (5, 'en')):
    ls = [l.strip() for l in blocks[idx].splitlines() if len(l.strip()) > 20]
    dup = {l: ls.count(l) for l in set(ls) if ls.count(l) > 1}
    print(f'duplicate lines in {lang} description:', dup or 'none')
for path in ('public/_locales/zh_CN/messages.json', 'public/_locales/en/messages.json'):
    d = json.load(open(path, encoding='utf-8'))
    for key in ('extensionName', 'extensionDescription'):
        m = d[key]['message']
        print(path.split('/')[1], key, len(m), 'chars | matches a paste block:', any(m == b.strip() for b in blocks))
PY
````

### 其他同步约定

- **文档更新时间**：每次发版或重大文档变更时，须同步更新以下 7 处的「最后更新」时间戳——README.md 末尾行、README.en.md 末尾行、index.html `footer.updated` 中英两处、en.html `footer.updated` 中英两处、llms.txt `Last updated` 行；隐私页（privacy.html / privacy.en.html）仅在隐私政策实际变更时更新精确日期，不随版本号联动

- **FAQ 权威版本**为 index.html 可见文案（i18n 字典）；README 与 llms.txt 的 FAQ 发版时对照校对，避免多副本漂移
- **测试数量**：以 `pnpm test:run` 输出的 `Test Files` / `Tests` 汇总行为唯一事实来源，新增或删除用例后须同步 README.md 与 README.en.md 的「技术亮点 / Technical highlights」行、llms.txt 的 `Quality` 行（该行同时声明测试文件数），以及 `docs/blog/**` 正文与页脚提到的测试数量（改完跑 `pnpm gen:blog` 重生 `blog/*.html`）。旧的「博客数字锁定为发文快照」口径已于 2026-09 废止：博客修订时数字一并回改，避免与 README / llms.txt 长期背离
- **功能口径**：新增用户可见功能时，实际需要同步的是 **6 处表面 + 架构文档**，`.qoder/rules/wxt-rules.md` 第 10 条只列了 4 处（README / index.html / HelpDialog / CWS），按它执行会漏项。完整清单：

  1. `README.md`（功能速览按编号顺延，中英文各一节）
  2. `README.en.md`（英译镜像，最易遗漏）
  3. `index.html` 可见文案（FAQS / 功能数组，中英两处）与 `en.html` 对应内容——`en.html` 由 `scripts/build-en-page.mjs` 从中文源生成，改中文源后跑 `pnpm gen:en`
  4. 侧边栏 `components/sidepanel/HelpDialog.vue` 对应的 `utils/i18n/locales/{zh-CN,en}/help.json` 词条（数字序号驱动，新增条目须同步提升 `helpItems('help.gx', N)` 的 N，由 `tests/utils/i18nBundles.test.ts` 守卫）
  5. `docs/CWS_FILL_CONTENT.md` 商店文案 **与** `wxt.config.ts` 的 manifest 描述（manifest 走 `__MSG_extensionDescription__`，实际文案在 `public/_locales/*/messages.json`）
  6. content / background 侧可见文案走 `utils/i18n-lite.ts` 的 `tl()`，与 Vue 的完整 i18n 是两套独立词表，必须各写一份中英文
  7. `docs/ARCHITECTURE.md` 与 `docs/ARCHITECTURE.en.md` 的「功能实现详解」

  博客正文若涉及该功能，修订后跑 `pnpm gen:blog` 重生 `blog/*.html`。

- **商店摘要（132 字符硬限制）**：修改后须同步 `public/_locales/zh_CN/messages.json` 与 `en/messages.json` 的 `extensionDescription` 并重新构建，且与 CWS_FILL_CONTENT.md 的「摘要」保持一致

---

## 附录：商店描述模板

> 📌 商店正文的权威文案（含逐字符数校验、中英双语、截图与权限说明）在 `CWS_FILL_CONTENT.md`「第二步」。本附录只保留一份精简兜底模板，两者冲突时以 `CWS_FILL_CONTENT.md` 为准。

### 中文描述

```
一款专为开发者和测试人员设计的本地密码管理工具，让多账号登录更安全、更高效。

🔒 安全特性：
• 用户名 / 密码 / 网址 / 备注 / 两步验证密钥逐个加密后只存本地，内容被篡改时能够检出
• 主密码本身不会保存，只保留用于比对的校验值
• 不收集、不上传任何用户数据，无遥测与分析
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
• 通过加密备份文件（.aph）在个人设备之间迁移数据

完全开源，代码可审计：https://github.com/liaolongdong/account-password-helper
```

### English Description

```
A local password manager designed for developers and testers, making multi-account login safer and more efficient.

🔒 Security Features:
• Username, password, URL, remark and 2FA secret are encrypted one field at a time and stored only in your browser, and tampering is detected
• The master password itself is never stored — only a value used to check it
• No data collection, no uploads, no telemetry or analytics
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
• Moving your vault between your own devices via an encrypted .aph backup file

Fully open-source, code auditable: https://github.com/liaolongdong/account-password-helper
```

---

## 附录：隐私政策 URL

部署后地址：`https://liaolongdong.github.io/account-password-helper/privacy.html`

隐私政策页面已创建在项目根目录 `privacy.html`，推送到 main 分支后会自动部署到 GitHub Pages。

---

## 附录：CI/CD 配置说明

发布流程的权威说明见本文「第三步：配置 CI/CD 自动化发布」（含三道预检）。

补充两点：

- 跳过条件只看 `CWS_EXTENSION_ID`：**它为空**时步骤 3 整体跳过，Release 仍会正常构建并挂到 GitHub Releases；**它有值但 OAuth 三项 Secret 缺失或过期**时，凭据预检会让作业失败（不是跳过），需按错误提示更新那一套 Secret。
- `.github/workflows/static.yml` 在 push 到 `main` 时把仓库根目录整体作为 Pages 产物上传，并在部署前用 `scripts/build-*-page.mjs` 重新生成 `en.html`、`pricing.en.html`、`privacy.en.html` 与 `blog/*.html`——因此新增对外页面只要提交中文源文件即可上线英文版，但也意味着**入库即公开**，不要把内部文档放进仓库根目录。
