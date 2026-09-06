# 曝光现状核对 & 待执行清单（2026-09-06）

> 本文件是对 `账号密码管理助手曝光提升执行手册.md` 的**现状批注**：手册里哪些已经真正落地、哪些还差最后一步。所有"已完成"项都经过线上/本地实测核对。
> 目标：GitHub 曝光（当前 8 star）。核心结论——**信息内容层面已到顶，卡点在"分发执行"和"线上是否落后于本地"。**

## ✅ 已核实完成（无需再做）

| 项                    | 证据                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub Description    | 线上 About 已含完整关键词 + emoji + 中文别名                                                                                                           |
| GitHub Website        | 已指向 `liaolongdong.github.io/account-password-helper/`                                                                                               |
| GitHub Topics         | **已设满 20 个**（password-managers / chrome-extensions / totp-generator / aes-256-gcm-encryption / local-first-auth …）                               |
| GitHub Social Preview | 已上传（og:image 指向 `repository-images.githubusercontent.com/…`）                                                                                    |
| GitHub License 识别   | GPL-3.0-only 正确识别                                                                                                                                  |
| README 双语           | `README.md` / `README.en.md` 内容完整、徽章齐全，超出手册模板                                                                                          |
| Chrome 商店 ASO 文案  | `docs/CWS_FILL_CONTENT.md` 已对齐 v3.7.0（四种填充、contextMenus/favicon 权限、只读详情、GPL-3.0 表述正确）                                            |
| AI-SEO / 机器可读层   | `llms.txt`（v3.7.0/632 测试）、`pricing.md`、`robots.txt`（放行全部 AI 爬虫）、`sitemap.xml`、`index.html` 内 SoftwareApplication 等 JSON-LD + 完整 OG |
| 内容资产              | `blog/` 4 篇双语技术文、`imgs/` 信息图、`docs/reddit-post.md`、Show HN / Product Hunt / V2EX / 掘金 文案（见执行手册第五章）                           |
| 公众号 + 微博文案     | `docs/公众号-账号密码管理助手.md`、`docs/微博-账号密码管理助手.md`（**仓库既有草稿**，含配图清单与发布节奏；目前为未跟踪状态，需随其它改动一并提交）   |

## 🔴 待你执行（我未擅自操作，原因见括号）

### 1. 【最高优先】把优化内容上线到公开 `main`

线上 `main` 仍是 **v3.6.0 旧版**（README 显示 364 测试 / 三重填充 / 无第 4 篇博客），而 v3.7.0 的全部优化压在 `feature-opt` 分支（ahead 10）+ 未提交工作区。**不合并推送，对外曝光 = 0。**

- （git 合并/推送 main 不可逆且触发 Pages 发布，按惯例需你明确授权，我不擅自执行）
- 建议：`feature-opt` → 走 PR/合并到 `main` → push；确认 Pages workflow 重新构建部署。
- 一并提交当前未跟踪的 `docs/` 新文件（`公众号-…md`、`微博-…md`、`exposure-status.md`）。

### 2. 博客导流文的事实修正（已改，待提交发布）

当前博客仓库 `_posts/2026-05-25-account-password-helper.md`、`_posts/2026-06-28-account-password-helper-new.md` 已把 **MIT → GPL-3.0**、旧"严禁/后果自负"安全声明 → 正向表述、"Google 应用商店后续待支持" → 已上架 Chrome 商店，**需提交并推送博客仓库**才会在线上生效。

### 3. 对比信息图仍写着 "MIT"（P1，需决策）

`assets/img/account-password-helper/02-comparison-tools.png` 图片里烧了 "MIT 开源·可审查"（`公众号-…md` 配图清单也已标注此坑）。文字表格已改，但**图片未改**。

- 选项 A：从原设计源（Figma/生成 prompt）重新导出，把 MIT 改成 GPL-3.0（推荐，保真）。
- 选项 B：用 ImageGen 重绘——但中文信息图 AI 重绘易糊字，风险较高，需你确认再动手。

### 4. Chrome 应用商店后台 & Featured 提名（网页端手动）

- 若商店列表尚未按 `CWS_FILL_CONTENT.md` 全量更新：登录 Developer Console 粘贴中/英文案、传 5 图 + marquee + 小推广图、填权限说明与隐私。
- Featured 提名：`docs/CWS_FILL_CONTENT.md` 第七步 + 手册第三章文案，One Stop Support 表单提交（**每 6 个月一次**，务必商店列表 100% 就绪后再提）。

### 5. 站外分发"实际发出去"（导流主力，决定 star 增长）

文案已齐，缺的是**发布 + 守帖**：

- 中文：V2EX 分享创造、掘金/CSDN、知乎、**公众号**（`docs/公众号-账号密码管理助手.md`）、**微博**（`docs/微博-账号密码管理助手.md`）。
- 英文：Show HN（周二~周四 北京 21:00-23:00）、Product Hunt、Reddit（r/privacy、r/SideProject、r/chrome_extensions，先读版规）。
- awesome 列表 PR：awesome-chrome-extensions、awesome-privacy、awesome-security + 阮一峰周刊/HelloGitHub/GitHubDaily 投稿（PR 描述见手册 4.5）。

### 6. 运营动作

- 拆 3-5 个 `good first issue`（新手主题色/翻译/文档校对/兼容性反馈），配 Issue 模板。
- 商店评论 & GitHub Issue 48h 内回复；双周小版本维持"最近更新"活跃信号。
- 外部链接统一带 UTM（`?utm_source=xxx` / `?ref=xxx`），在 CWS Analytics 与 GitHub Insights 归因。

## 📉 现状基线

- GitHub star：**8**（本次核对时）。发布/合并后建议用 star-history.com 建立增长曲线，每月复盘（手册第八章）。
