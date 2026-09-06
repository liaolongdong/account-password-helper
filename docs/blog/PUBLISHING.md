# 博客投稿指南 / Publishing Guide

本目录文章（`zh/` 中文、`en/` 英文）采用 **本地仓库为唯一事实来源** 的策略：

- 仓库内 Markdown → CI 生成 GitHub Pages 博客页（`scripts/build-blog-pages.mjs`）
- 各平台投稿时附 **原文链接（canonical）**，把权重导回官网域名
- 每次修改文章后运行 `pnpm gen:blog` 重新生成静态页

## 文章与资源速查

| #   | 中文标题                                                                  | 英文标题                                                                                    | 封面图                                        | 信息图/流程图                                                                |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| 01  | 零云端、开源、为开发者而生：我从零做了一款浏览器密码管理器                | Zero Cloud, Open Source, Built for Developers: Why I Built Another Browser Password Manager | `imgs/blog-cover-01-local-first.png`          | `imgs/01-infographic-core-value.png`、`imgs/03-infographic-dev-features.png` |
| 02  | 让 Chrome 侧边栏 1 秒内打开：MV3 Service Worker 保活与预热实战            | Opening the Chrome Side Panel in Under One Second                                           | `imgs/blog-cover-02-sub-second-sidepanel.png` | —                                                                            |
| 03  | 用 Web Crypto 实现密码管理器级加密：PBKDF2 60 万次迭代 + AES-256-GCM 实战 | Password-Manager-Grade Encryption with Web Crypto                                           | `imgs/blog-cover-03-webcrypto.png`            | `imgs/02-flowchart-security-pipeline.png`                                    |
| 04  | 四个新功能，四段实现笔记：右键填充、全站搜索、快速添加与只读详情          | Four New Features, Four Implementation Notes                                                | `imgs/blog-cover-04-login-flow-details.png`   | —                                                                            |

发布后的规范链接（canonical）：

- 中文：`https://liaolongdong.github.io/account-password-helper/blog/<slug>.html`
- 英文：`https://liaolongdong.github.io/account-password-helper/blog/<slug>.en.html`

> **先部署、后投稿**：先把改动推送到 `main` 触发 GitHub Pages 部署，确认线上页面可访问后再投稿，否则 canonical 链接是 404。

## 平台操作要点

### 掘金（中文四篇）

1. 登录后「创作者中心 → 写文章」，把 Markdown 正文粘贴（掘金支持 Markdown 导入）。
2. **图片必须重新上传**：掘金不允许外链图床，把文中 `imgs/*.png` 逐张上传本地文件（`imgs/` 目录下均有），上传后替换文中链接。
3. 分类与标签（每篇选 1 分类 + 3-5 标签）：
   - 01：前端 / 开源、浏览器扩展、密码管理器
   - 02：前端 / Chrome 扩展、性能优化、Manifest V3
   - 03：前端 / 安全、Web Crypto、加密
   - 04：前端 / Chrome 扩展、交互设计、密码管理器
4. 文末统一追加引流段：
   > 项目完全开源（GPL-3.0）：[GitHub](https://github.com/liaolongdong/account-password-helper) · [Chrome 应用商店](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli) · [官网与英文博客](https://liaolongdong.github.io/account-password-helper/)
5. 投稿后把掘金链接回填到本文档下方「已发布」表。

### 知乎（中文四篇，发"文章"非"回答"）

1. 「写文章」粘贴正文；知乎对外链图片会自动转存，但建议直接上传本地图保证清晰度。
2. 话题标签：浏览器插件、密码管理、前端开发、信息安全、开源项目。
3. 知乎对引流外链较宽容但反感硬广，引流段放在文末并注明"开源免费、无付费推广"。
4. 可顺手在相关问题下发摘要回答并引用文章，如「有哪些好用的开源密码管理器？」。

### Dev.to（英文四篇）

1. 新建文章，粘贴 `en/*.md` 正文（Dev.to 使用带 front matter 的 Markdown，可直接复用，`canonical_url` 必填）：
   ```yaml
   ---
   title: <英文标题>
   published: true
   tags: chromeextension, security, webdev, javascript
   canonical_url: https://liaolongdong.github.io/account-password-helper/blog/<slug>.en.html
   cover_image: <上传后的封面 URL>
   description: <frontmatter 里的 description>
   ---
   ```
2. 封面图通过编辑器上传后填入 `cover_image`。
3. tags 上限 4 个，建议组合：`chromeextension` + `security` + `performance` / `webcrypto` / `opensource` 按篇选取。
4. 文末同样追加 GitHub / CWS 链接。

### 可选追加渠道

| 渠道                        | 语言 | 说明                                                                                                                                                                                               |
| --------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hacker News（Show HN）      | 英文 | 选周二至周四太平洋时间上午 8-10 点，标题用 `Show HN: Account Password Helper – a local-first, open-source password manager Chrome extension`，正文首条评论自述动机；三篇英文博客可作为评论佐证链接 |
| r/SideProject、r/opensource | 英文 | 允许自荐，配封面图 + GitHub 链接                                                                                                                                                                   |
| 微信公众号                  | 中文 | 通过 `baoyu-post-to-wechat` 技能或公众号后台排版发布（代码块需转截图或用 mdnice 排版）                                                                                                             |
| 少数派                      | 中文 | 适合 01 产品故事篇，投稿矩阵/邮件                                                                                                                                                                  |

## 发布节奏建议（Stacked Launch）

1. **D0**：推送 `main`，确认 GitHub Pages 博客上线、sitemap 提交到 Google Search Console。
2. **D1（周二~周四）**：上午掘金 + 知乎发布中文四篇（间隔 1-2 小时避免被判批量）。
3. **D1 晚**：Dev.to 发布英文四篇。
4. **D2**：Show HN + r/SideProject；Blog 入口已就绪——GitHub README（中英「核心特性」末尾）与官网页脚均已链接 `/blog/`。
5. **D3+**：微信公众号同步中文四篇；把各平台链接回填到下方表格。

## 已发布链接登记

| 文章 | 掘金 | 知乎 | Dev.to | 公众号 | 其他 |
| ---- | ---- | ---- | ------ | ------ | ---- |
| 01   | —    | —    | —      | —      | —    |
| 02   | —    | —    | —      | —      | —    |
| 03   | —    | —    | —      | —      | —    |
| 04   | —    | —    | —      | —      | —    |
