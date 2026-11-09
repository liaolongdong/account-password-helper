# 对外表面与 SEO 增长设计（2026-11-07）

## 0. 这份文档的定位

本文件是 2026-11-07 这一轮的**设计与判据**，不是状态账本。状态账本仍是 [`docs/operations/exposure-status.md`](../operations/exposure-status.md)，执行手册仍是 [`docs/operations/账号密码管理助手曝光提升执行手册.md`](../operations/账号密码管理助手曝光提升执行手册.md)。本文件只回答三件事：这一轮动哪些面、每一项凭什么算完成、哪一项在什么条件下作废。

已获授权范围（用户 2026-11-07 明确选择）：

- 重心：**执行轴与技术/内容 SEO 轴都做，分批铺开**；
- 外部写：GitHub 元数据 PATCH、`git push`、PR 合入 `main`、**向第三方 awesome 列表提 PR**；
- origin 根缺口：**允许向 `liaolongdong.github.io` 根 Pages 仓库增量发布**；
- 隐私 P0：**本轮只记录不动**；
- 完成后自动代码评审、自测、提交，不再逐项确认。

不在授权内、本轮不做：商店 Dashboard 点击、社媒发帖与守帖（本质上只能本人做）、历史改写与强推、Featured 提名、主题色、依赖与 lockfile。

## 1. 起点：信息内容已到顶，卡点在分发与尺子

`exposure-status.md` 头部结论是「信息内容层面已到顶，卡点在分发执行」。本轮勘查补了两条它没记的事实：

1. **有一把尺子是坏的。** `pnpm gen:pricing-en` 的生成器 [`scripts/build-pricing-en-page.mjs`](../../scripts/build-pricing-en-page.mjs) 只替换 head meta 与链接，**从不碰 JSON-LD**；而 `pricing.html` 的品牌名是中文优先，`pricing.en.html` 已提交产物是英文优先。跑一次生成器必然让 `tests/docs/structuredData.test.ts` 判红。也就是说：**这个产物不可复现**，11-05 那轮只能手改一行 href 绕过。
2. **有一处预算无人看守。** 商店说明长度只由 `CWS_PUBLISHING_GUIDE.md` 里的 python heredoc 看守，没有 vitest 门禁。账本记的中文值 **6744**，实测 **6821**——11-06 的功能文案让它静默漂了 **+77**，没有任何门禁发现。

这两条决定了顺序：**先修尺子，再动表面**。后面每一波都要踩生成链与 48 处同步链，尺子坏了会产生假红与静默漂移。

## 2. 波次划分

### 波次 A｜先修尺子（零外部写、零行为变更）

| 动作                                                                    | 判据                                                                 | 刀（怎么证明判据有牙）                                           |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 生成器补 JSON-LD 品牌名按目标语言排序                                   | `pnpm gen:pricing-en` 后 `git diff --exit-code pricing.en.html` 为空 | 把品牌顺序改回中文优先 → diff 非空且 `structuredData.test.ts` 红 |
| 新增商店说明 vitest 门禁：码点预算 + 跨小节重复行 + `_locales` 逐字一致 | 门禁绿，且账本中文值订正为实测值                                     | 向英文块注入 88 码点 → 必须红（英文余量只有 87）                 |
| `docs/README.md` 英文博客行「eight md each」→ 10                        | 与 `docs/blog/{zh,en}/` 实际文件数一致                               | 数文件：两语言各 10                                              |
| 建立全量门禁基线并记录真实测试数                                        | 记录 `pnpm test:run` 的文件数/用例数，供波次 C 的 48 处同步链使用    | 基线必须是实跑输出，不是从文档抄                                 |

码点口径钉死：**商店长度只认 python `len()`（Unicode 码点）**，node 的 `String.length` 会因 emoji 偏高，历史上就是靠它误判过余量。GitHub About 反过来只认 **UTF-16 码元**（`node -e 'console.log(s.length)'`）。两把尺子不能互换。

### 波次 B｜技术 SEO

| 动作                                                                      | 判据                                                  | 刀                                                       |
| ------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| `sitemap.xml` 补 `xmlns:xhtml` + `xhtml:link` 三档 hreflang               | 与 HTML 侧 hreflang 互证一致                          | 删掉一条回指 → 必须红                                    |
| 补 `og:image:alt` / `og:image:width` / `og:image:height` / `twitter:site` | `siteMeta.test.ts` 的「恰好 1 个」约束不被破坏        | 重复插入一个 → 必须红                                    |
| `index.html:5882` 首帧图 LCP                                              | **先量后改**：同法 3 样本取中位数，前后对比有改善才改 | 无改善 → **整项作废**，不放宽阈值、不动 `loading="lazy"` |
| origin 根发布 robots.txt 的 Sitemap/AI 白名单与 llms.txt 索引             | `curl` 根路径 200                                     | 根仓库 diff **只增不改**（它同时服务用户的其他项目）     |

LCP 那一项有个已知约束：`tests/docs/landingNoJsSurface.test.ts:112` 的正则**硬要求** `loading="lazy"`。所以它不是一个可以直接改的缺陷，而是一个待测假设——只有在实测有改善时才连带更新那条守卫的意图。

**2026-11-07 实测结论：整项作废。** 用 Chrome DevTools 性能轨迹对线上中文首页 reload 三次（CPU 1x、无网络节流），LCP 分别 469 / 574 / 691 ms，中位数 **574 ms**，三次 LCP 元素都是首屏 `H1` 标题文本（nodeId 32/33/34，非网络资源），LCP 拆解里 render delay 占 99.5%、TTFB 仅 2–6 ms、**没有 resource load delay 这一档**，CLS 恒 0.00。也就是说首帧图根本不是 LCP 元素：`#showcase` 的 webp 截图在折叠线以下，`loading="lazy"` 是正确行为；首屏视觉是文本 + 内联 SVG，不发起图片请求。把 `loading="lazy"` 改成 eager 对 LCP 零增益（estimated savings: none），故按判据作废该项——不放宽阈值、不动 `loading="lazy"`、不改那条守卫。574 ms 已远优于 2.5 s 的 good 线，无 LCP 问题可修。

**OG 三条已落地（commit 979461f），`twitter:site` 刻意不加。** `og:image:alt` / `:width` / `:height` 铺到全站 32 页，尺寸取 PNG 头真实值，守卫独立解析比对。表里列的 `twitter:site` 没有可核实的官方账号——填一个就是凭空捏造归属，故省略；其余三条不影响该决定。

**2026-11-07 origin 根：前提变了，按用户拍板新建根仓库。** 实测根域名 `liaolongdong.github.io/` 返回 **404**，原根 Pages 仓库已被改名为 `better-blog`（现服务 `/better-blog/`，是个人博客），REST 确认名下已无 `*.github.io` 仓库——「向已有根仓库增量写入」无从执行。经询问，用户选择「建根仓库 + 极简落地页」。于是新建公开用户站仓库 `liaolongdong/liaolongdong.github.io`（`main` 分支），放三件：`robots.txt`（`* Allow:/` + 密码助手与 better-blog 两条 Sitemap）、`llms.txt`（指向项目 llms.txt/llms-full.txt 的索引）、`index.html`（极简中英落地，链向密码助手与博客，无 JS/无外链/无统计）。Pages 自动启用、构建 `built`，`/`、`/robots.txt`、`/llms.txt` 均 `curl` 200（早先 404 是 CDN 负缓存，已消散），落地页浅色/深色 + 移动端实测渲染正常。**纯新增仓库，不触碰 better-blog 与其他项目**，满足「只增不改」的刀；日后可整仓删除回退。

### 波次 C｜送上线 + GitHub 元数据（顺序不可换）

1. 刷新 48 处测试数（`testCountCopy.test.ts` 定义 = 35 处用例数 + 13 处文件数）、7 处时间戳、版本号；
2. 重拍 32 张商店母版，让画面徽章与在架版本一致——**图片里的文字同属商店元数据**，版本不符是已知驳回点；
3. PR 合入 `main`（`main` 受保护禁直推，走 merge commit）→ release-please 发版 → Pages 重建；
4. **只有到这一步之后**才由本人点商店 zip 上传与说明粘贴；
5. GitHub About PATCH 到 332 UTF-16 文本 + topics 四换——与发版解耦，可先做，但必须复测。

第 4 步的顺序不是形式主义：`CWS_FILL_CONTENT.md` 现在已经在宣传**手机号+短信验证码自动保存**与**导入逐条跳过原因**，这两项都晚于在架 v3.22.0。先粘说明就是在宣传线上跑不到的功能。

About 的刀：改完复测必须是 **332 UTF-16**；把同一条检查跑在旧的 346 字文本上必须命中禁词表。⚠️ 那条读请求历史上出现过 `exit 28` / `http=000`，**空响应不能读成「已经改好」**。

**2026-11-07 第 5 步已执行并复测（与发版解耦，先做）。** GitHub About `description` 从 346 UTF-16 换成推荐文本，独立复读实测 **332 UTF-16 / 331 码点**，`never leave your browser` 与 `zero cloud` 均已不在其中；刀先在本地跑过——从 `seoSurface.test.ts` 真源抽出 9 条禁词，旧 346 文本命中 `never leave your browser`（刀有牙），新 332 文本零命中。Topics 整体 PUT 为 20 个，独立复读确认四新词（`autofill` / `browser-extension` / `open-source` / `password-generator`）全在、四旧词（`developer-tools` / `browser-extensions` / `password-generator-web` / `password-visibility`）全无、`bitwarden` 保留。这是线上唯一残留的自我虚假隐私承诺，至此收口。第 1–4 步仍待波次 E 内容落定后按序执行（E 会改测试数与页数，先刷数会白刷一遍）。

### 波次 D｜分发执行（北极星主杠杆）

awesome PR 已授权，但**逐个读目标仓库自己的 `CONTRIBUTING`**——收录门槛会变，不能按老规则假设。中文周刊投稿包与站外定稿准备好，发帖与 48h 守帖由本人做。

判据：`docs/blog/PUBLISHING.md` 的分发登记表现在**整列是 `—`**，意味着两个月来一篇都没真发出去。本轮结束时每一行要么是 `curl` 200 的真实 URL + 日期，要么写明为什么没发。

归因自证：发版次日核对 Dashboard「安装来源」有无 `ghreadme` / `aphsite` / `blog` / `llms` 这些 ref 值。**后台不认就整族回退 `?ref=`，并记一句结论**，不留着无效参数当已验证。

### 波次 E｜内容补缺（只做最高意图的）

- 博客生成器补文章目录 + 阅读时长 + 可见标签 chip（派生 20 页）；
- 新增 2 对中英文章：①「浏览器存密码安全吗 / 本地密码管理器安全吗」大众科普 ②「密码生成器与强度」专题；
- 刷新 `compare.html` 的「截至 2026-09」；
- 重构 README 数百码点长 bullet，提升移动端可扫读性。

**本轮不做**：自吹 listicle（第三方引用里 69% 推荐的是竞品，自吹清单会反噬）、Passkey 科普（功能已判不可行，写成科普会被读成承诺）、独立替代品评测（`compare.html` + 第 10 篇已覆盖）。这三项等波次 D 的归因数据回来再议。

## 3. 明确不动的面

| 面                               | 为什么不动                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `index.html` 的 526KB 单文件形态 | 127KB 内联 CSS + 196KB 内联 JS 是**有守卫的刻意取舍**（无 JS 可读 + 单文件自足），不是遗漏 |
| 商店 Name / Summary / 权限说明   | 排序第一权重且历史被拒点在堆砌；摘要中英各只剩 1–2 码点；动它要重传 zip                    |
| 28 个含真实凭据的旧素材文件      | 用户决定本轮只记录不动；引用面已收口到占位素材，**这批永远不得上传商店或用作推广配图**     |
| Featured 提名                    | 每 6 个月一次机会，且要求列表先无违规记录                                                  |
| 主题色 / 依赖 / lockfile         | 不在授权内                                                                                 |

## 4. 全局红线（每一波都适用）

- **禁词表是唯一真源**：`tests/docs/seoSurface.test.ts` 的 `BANNED_PHRASES`。对外文案里**不要复述它**——11-05 就是因为抄了一遍让那份 promo 文件自己判红。
- **一个卖点只在一节展开**。跨小节重复正是 3.8.0 草稿被判 keyword stuffing 的签名。
- 四个商店字段 + 权限说明 + Featured 表单：**零竞品品牌名、零绝对化承诺**。GitHub 侧是竞品词的合法落点（`compare.html` 有逐项对照表）。
- 数字纪律：商店公开「用户数」是**周活不是装机**，禁止写成「N 人装了」；历史峰值 15,190 是批量装载实例，禁止当增长引用。徽章可以显示，但**不作判据**。
- 一键登录不能写成默认提交、也不能写成永不提交——**提交取决于「自动触发登录」偏好**，快捷键默认只填充。
- 侧边栏性能声明必须带「缓存快路径 20–50ms」限定；每 6 小时那次匿名版本检查必须披露。
- 未发布能力不得出现在商店表面。
- 不 weakening 断言、不删测试、不跳测试来换绿；`pnpm format` / `fix:all` 不用于局部任务。
- 对外日期按 **UTC 今天**写。

## 5. 完成定义

每一波的完成 = 判据绿 + 刀能红 + 相关门禁实跑通过 + 已提交。任何一项「判据没达成」都不能记成完成，只能记成作废或待办，并写清原因。本轮结束时在 `exposure-status.md` 追加一节，记波次结果、实测数字、以及仍未自证的缺口（`?ref=` 归因、Cloudflare Workers 主机名与部署状态）。
