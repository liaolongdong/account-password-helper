# 曝光现状核对 & 待执行清单（2026-09-06 建立，2026-09-09 复核，2026-09-10 / 09-12 / 09-22 更新）

> 本文件是对 `账号密码管理助手曝光提升执行手册.md` 的**现状批注**：手册里哪些已经真正落地、哪些还差最后一步。所有"已完成"项都经过线上/本地实测核对。
> 目标：GitHub 曝光（2026-09-22 实测 11 star）。核心结论——**信息内容层面已到顶，卡点在"分发执行"**。
>
> 🔄 **2026-09-09 复核**：9-06 判定的第二个卡点「线上落后于本地」已消除——`feature-opt` 经 PR #81 合入 `main`，release-please 已发布 **v3.8.0**。剩下的只有「把内容真正发出去」。本次复核同时把各文档的**事实口径**对齐了代码实测值（详见下表最后一行）。
>
> 🔴 **2026-09-10 更新（CWS 驳回）**：Chrome 应用商店于 2026-09-09 判定 **3.8.0 草稿违反 Spam 政策——「产品说明中有过多关键字」（keyword stuffing）**，被点名文本 `Chrome, LastPass, Bitwarden, and 1Password (CSV/JSON formats`；旧草稿已关闭，**必须新建草稿重新提交**，线上仍是 3.7.0。本轮已把商店四个字段（中/英 Name、Summary、Description）全部按政策重写，并顺带清掉了执行手册里导致驳回的错误 ASO 建议。详见「🟡 商店驳回与修正」一节。
>
> 🟢 **2026-09-22 更新（本轮：文档与 SEO 表面刷新）**：用户批准四个批次（A 事实纠错 + 时效刷新、B 缺失功能回灌、C compare / pricing 矩阵补齐、D GitHub 仓库元数据），并追加「商店只扩说明正文，摘要与 Name 不动」「博客新增一篇 + 刷新旧文时效」。落地内容见「🆕 2026-09-22 文档刷新波次」一节；**全部改动只落在文档与官网表面，未提交、未推送、未发布**。

## ✅ 已核实完成（无需再做）

| 项                             | 证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Description             | 线上 About 已含完整关键词 + emoji + 中文别名，但**仍是带 `passwords never leave your browser` 的旧版**（346 字符，2026-09-22 复测），替换文本已定稿待执行，见「🔴 待你执行」第 6 项                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| GitHub Website                 | 已指向 `liaolongdong.github.io/account-password-helper/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| GitHub Topics                  | **已设满 20 个**（password-managers / chrome-extensions / totp-generator / aes-256-gcm-encryption / local-first-auth …）；2026-09-22 拟好「四换」待执行，见「🔴 待你执行」第 6 项                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| GitHub Social Preview          | 已上传（og:image 指向 `repository-images.githubusercontent.com/…`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| GitHub License 识别            | GPL-3.0-only 正确识别                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| README 双语                    | `README.md` / `README.en.md` 内容完整、徽章齐全，超出手册模板                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Chrome 商店 ASO 文案           | `docs/store/CWS_FILL_CONTENT.md`「第二步」是商店文案的**唯一事实来源**（手册不再复制正文），已按 v3.7.0（本地 `package.json`）校对代码实测口径：逐字段加密 5 个敏感字段、体检 4 个计分维度、助记词 3080 词、密码历史默认 3 份、`Ctrl+Shift+F` 默认只填充与勾选（是否代为提交取决于「自动触发登录」偏好开关）、匿名版本检查、选中导出（CSV、主密码校验）。**2026-09-10 按 keyword stuffing 驳回重写，同日二 / 三 / 四次修订，2026-09-12 五 / 六 / 七次修订**：中/英 Summary 用满 132 额度（**131 / 130 字符**，含 AES-256-GCM、两步验证（TOTP）、密码强度检测、显隐切换、主流密码管理器迁移导入），中文 Name **30 / 45**、英文 Name **42 / 45**（英文只剩 3 字符，补不满），四个字段零竞品品牌名、零绝对化表述；说明（**2026-09-24 十二修订后**中文 **5560** / 英文 **15739** 字符，英文侧距 16,000 上限只剩约 261，**下一轮回填英文前必须先删英文已有内容**）的小节结构（为什么选择它 / 适合谁 / 怎么使用 / 安全架构 / 功能全览 / 常见问题）全部保留，去重方式是**一个卖点只有一组归属句**（机制归【功能全览】、价值归【为什么选择它】、问答只讲本节独有事实），而不是砍篇幅。NAME / 摘要 / 说明的权威文本以该文件为准 |
| AI-SEO / 机器可读层            | `robots.txt`（放行全部 AI 爬虫）、`sitemap.xml`、`index.html` 内 SoftwareApplication 等 JSON-LD + 完整 OG 均已就位；`llms.txt` 的 `Quality` 行与 README / 博客的测试数量同源同值（2026-09-22 复测为 **1292 用例 / 114 文件**，属易漂移字段，发布前须按 `CWS_PUBLISHING_GUIDE.md`「其他同步约定」复跑 `pnpm test:run` 再刷新），且已把旧的「100% offline / zero network transfer」改为「密码数据不上传 + 披露匿名版本检查」；`en.html` / `pricing.en.html` / `privacy.en.html` / `blog/*.html` 均由脚本生成，hreflang 与 canonical 已补全                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 结构化数据与 OG 补全（09-12）  | `index.html` / `en.html` 新增 `@graph`（`Organization#org` + `WebSite#website`，与 SoftwareApplication 的 `author` / `publisher` 通过 `@id` 互指）、`robots` 补 `max-image-preview:large`、`softwareVersion` / `dateModified` / 页脚版本对齐 v3.9.0、`screenshot` 改指 `assets/cws-store/screen-{1..6}-*.png`；`pricing.html` / `privacy.html` 补齐缺失的 `og:url` / `og:locale` / `twitter:*`（privacy 另补 `og:image`）；`compare.en.html` 的 `x-default` 归位到中文页（此前与 `compare.html` 互抢）；`sitemap.xml` 的 `lastmod` 按 git 实测日期逐条刷新，博客条目对齐 frontmatter 的 `modified`。英文页由生成器产出，因此 `scripts/build-pricing-en-page.mjs` / `build-privacy-en-page.mjs` 同步改写这些字段，`build-en-page.mjs` 另加 `featureList` 条数守卫（中文源增删条目而英文未同步时直接报错，避免 `en.html` 漏中文）                                                                                                                                                                                                                                                                                        |
| GitHub 协作与 CI 资产（09-12） | 新增 `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.yml` + `config.yml`（引导到私密安全渠道）、`.github/PULL_REQUEST_TEMPLATE.md`、`.github/CODE_OF_CONDUCT.md`、`.github/workflows/ci.yml`（`typecheck` / `lint` / `lint:style` / `test:run` / Chrome+Firefox 双构建，`permissions: contents: read`，同分支并发取消旧任务；**刻意不含 `format:check`**，因为仓库存在历史未格式化文件，接入即常红）。README 中英各加 CI 徽章与「参与贡献 / Contributing」一节，两份 README 的功能演示截图换成占位数据的商店新图，并在贡献一节指向 `llms.txt`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 内容资产                       | `blog/` 5 篇双语技术文（第 5 篇《同一站点的账号该出现在哪些子域》2026-09-22 新增）、`assets/illustrations/` 信息图、`docs/operations/reddit-post.md`、Show HN / Product Hunt / V2EX / 掘金 文案（见执行手册第五章）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 公众号 + 微博文案              | `docs/operations/公众号-账号密码管理助手.md`、`docs/operations/微博-账号密码管理助手.md`（含配图清单与发布节奏；**已随 PR #81 入库**，不再是未跟踪状态）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 测试基线                       | `pnpm test:run`（2026-09-22 21:35 复跑）→ **114 个测试文件 / 1292 个用例全部通过**。⚠️ 该树与并行的性能波次共用：114 个文件里有 7 个是对方**尚未提交**的测试（HEAD 只有 107 个），本轮中途 `tests/content/inlineFillDropdown.keyboard.test.ts` 曾因 jsdom 缺 `Element.scrollIntoView` 红过一次、最终一轮全绿。发布前须在干净树上按 `CWS_PUBLISHING_GUIDE.md`「其他同步约定」复测再定稿各处数字                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 文档事实审计（2026-09-09）     | README / ARCHITECTURE / CONTRIBUTING / THIRD-PARTY-NOTICES / CWS 两份 / 博客 4 篇的中英文均已按源码逐项校正；残留的代码侧错误口径见本文「🟡 需你决策」末节                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 测试基线（2026-09-28 复跑）    | `pnpm test:run` → **167 个测试文件 / 1941 个用例全部通过，exit 0**。本表上一行的 114 / 1292（2026-09-22）与该行原有的 142 / 1563（2026-09-25）都是当时的快照，保留作记录；对外表面已于 2026-09-27 统一改标 **1941 项 / 167 文件**（README ×2、`llms.txt`、`index.html` 数据带 + JSON-LD `dateModified`、`en.html`、`product-site/index.html`、`docs/blog/**` 10 篇与 `blog/*.html` 12 页、封面 04/05 的 SVG 与 PNG、公众号 / 微博文案），`sitemap.xml` 12 条 `lastmod` 随博客 `modified` 同步；仍是易漂移字段，发布前按 `CWS_PUBLISHING_GUIDE.md`「其他同步约定」复跑再刷新。**同日「落地页体验波次」复跑实测 167 / 1953**（+12 全在 `tests/docs/landingFaqDom.test.ts`，50 → 62 例），对外 21 个手工维护文件已于 2026-09-28 统一刷到 1953 / 167                                                                                                                                                                                                                                                                                                                                                                       |

## 🆕 2026-09-28 文档归类：`docs/` 分层 + 两类本地内容停止入库（已提交 `docs(structure)` + 本提交，未推送）

用户口径「把不需要放到项目根目录的文档内容新加文件夹进行归类，还有一些本地以及非 SEO 运营相关的内容加入 git 忽略规则」，四问拍板后执行：**完整归类**（`docs/` 下建 `store/` `reports/` `operations/` `media/` `fixtures/` 五个目录）、内部评估报告**保持跟踪只搬位置**、忽略规则**只加两条**、**补一份文档导航**。

- **22 个文件 `git mv`**：`store/` ← CWS 两份；`reports/` ← `PERF_*` 三份 + `INLINE_DROPDOWN_PARITY_EVALUATION` + `LANDING_MOTION_PROPOSAL`；`operations/` ← 本文件、执行手册、`公众号-*` / `微博-*` / `reddit-post` 与整个 `promo/`；`media/` ← `demo-login.*` / `demo-totp.*` 七个动图与视频；`fixtures/` ← 根目录 `test-page.html`。46 个文件内容随之改写（34 个纯改引用 + 12 个「搬迁 + 改引用」），新增 1 个 `docs/README.md`。
- **搬动有硬约束，不是全仓一刀切**。GitHub Pages 的 Source 是「Deploy from a branch / main 根目录」，所以根目录的 `index.html` / `en.html` / `pricing.html` / `privacy.html` / `compare*.html` / `llms.txt` / `robots.txt` / `sitemap.xml` / `blog/` / `imgs/` / `pricing.md` / `CHANGELOG.md` 全部原位不动——搬走就是改公开 URL；`ARCHITECTURE*` / `CONTRIBUTING` / `THIRD-PARTY-NOTICES` 留在 `docs/` 平铺层，因为 `product-site/index.html` 与 `.github/` 里挂着指向这两个路径的 GitHub blob 外链。真正「不该在根目录」的只有 `test-page.html` 一份，已进 `fixtures/`。
- **`166` 处旧路径引用清零**（HEAD 实测：`docs/CWS_*` 49、`docs/demo-*` 50、`docs/PERF_*` 24、其余 43），改写后新路径引用 `183` 处，`docs/store/` 52 / `docs/media/` 57 / `docs/reports/` 36 / `docs/operations/` 35 / `docs/fixtures/` 3。消费面覆盖源码 JSDoc（`utils/encryption.ts`、`utils/concurrency.ts`、`utils/vaultPageSize.ts`、`utils/storage/vaultCapacity.ts`）、Vue 与 composable 注释、`benchmarks/` 4 份、`e2e/operation-tooltip.spec.ts`、`tests/architecture/` 2 份、`AGENTS.md` / `CLAUDE.md`、`.github/{CODEOWNERS,PULL_REQUEST_TEMPLATE,SECURITY}.md`、README 中英、`index.html` / `en.html` 的注释、`scripts/render-store-creatives.mjs` 与 `scripts/store-shots/{README.md,record.mjs}`、`imgs/outline.md`。
- **产物路径跟着改的只有一处**：`scripts/store-shots/record.mjs` 的输出目录常量由 `docs/` 改为 `docs/media/`，改名 `MEDIA_DIR`，两处 `join()` 使用点同步。⚠️ 这一处是本轮唯一的「搬文档会改运行行为」风险：常量改名而使用点没跟着改，脚本会在编码环节 `ReferenceError`，且单看 diff 定义行发现不了。
- **忽略规则净新增两条**（按用户勾选，未扩范围）：`.baoyu-skills/` 由只忽略 `.env` 升为整目录（个人公众号 / 微信发布流程与配图软链属机器绑定状态，AppSecret 本就在 `.env`）；`docs/pricing.md`（根目录对外那份的零引用落后副本）。两者同步 `git rm --cached` 取消跟踪，**磁盘文件未删**。顺带把 `docs/code-review-*.md` 拓宽为 `docs/**/code-review-*.md`，否则归类后评审报告落进子目录就漏。
- **`.gitignore` 补了反向清单**（第 166–175 行一段）：`docs/operations/**`、`docs/store/**`、`docs/media/**`、`docs/reports/**`、`docs/fixtures/test-page.html` 等 12 条列明「刻意保持跟踪，勿顺手忽略」——搬完之后的死链风险从「一个文件名」变成「一整个目录」，只写正向忽略不够。`docs/README.md` 是这套口径的入口：中英各一张 13 行的目录职责表 + 「新增文档该放哪」四条判定 + 反查命令。
- **历史记述不改写**。本文 §2026-09-27 的「26 条该留的路径」仍写「根目录 `pricing.md` 与 `test-page.html`」——那是当时快照，只机械更新会被链接检查判死的路径；读到这里时 `test-page.html` 已在 `docs/fixtures/`，根目录 `pricing.md` 确实没动。
- **刻意没做**：`docs/media/demo-login.mp4`（用户未勾选，保持跟踪）、`imgs/` 出图工作稿（同）、`.qoder/{rules,skills,commands}`（团队配置）、`CHANGELOG.md` 与 `docs/blog/**`（Pages 与对外口径）。
- **落点**：分两个提交——`docs(structure)`（22 个重命名 + 46 个引用改写 + 新增 `docs/README.md`）与紧随的 `chore(repo)`（`.gitignore` 全部改动 + 三处取消跟踪）。两个提交落在从 `chore-deps-adm-zip` 切出的 `docs-structure` 分支上——当时那个分支的工作树正被并行的依赖波次占用，直接切走会把 `package.json` / lockfile 退回旧版本，所以没有切回 `main`。**未推送、未发布**。

### 验证

- **死链**：自制链接检查器扫全仓 Markdown 链接目标（不只 `](./`，也捕裸相对路径），剩 11 条命中全是既存假阳性——`.qoder/skills/` 模板占位 `./main.ts`、商店演示页的绝对路径 `/favicon.png`、`docs/operations/exposure-status.md` 里 code span 中的「原图」。旧路径残留扫描 6 条（`assets/icons/brands/README.md`、本文与 `公众号-*` 里的兄弟仓 `assets/img/...`、`LANDING_MOTION_PROPOSAL` 的假设文件名 `assets/landing.css`）逐条 `git grep <path> HEAD` 证实**均为 HEAD 既存**，非本轮引入。
- **忽略规则双向自检**：必须忽略的 6 条（两份 `EXTEND.md`、`docs/pricing.md`、平铺与子目录两种落点的 `code-review-*.md`、`.qoder/plans/`、`.qoder/repowiki/`）全部命中且规则行号可追溯；必须跟踪的 12 条（五个新目录的代表文件 + `docs/README.md`、`ARCHITECTURE.md`、根 `README.md` / `pricing.md` / `index.html` / `llms.txt`、`.qoder/rules/wxt-rules.md`）用 `git check-ignore --no-index` 全为「未忽略」，0 误伤。不带 `--no-index` 时 `check-ignore` 会跳过已跟踪路径，这类自检必须显式加该参数。
- **门禁**：`pnpm typecheck` / `pnpm lint`（`--max-warnings 0`）/ `pnpm lint:style` / `pnpm format:check` 均 exit 0——全仓 `prettier --check .` 曾红在 `docs/PR_WORKFLOW_GUIDE.md`（路径变长触发重排），定向 `--write` 该文件后转绿；`pnpm test:run` → **167 文件 / 1953 用例全绿**，与 09-28 早上刷新的对外基线同值（本轮零新增用例）；`pnpm build` exit 0，zip **708,164 bytes**，`find .output -path '*docs*' -o -name 'test-page*'` 为 0 条——文档与夹具确实不在扩展构建闭包内，产物字节数不受归类影响。
- **表格重排核对**：7 个文件因路径变长导致 Markdown 表格整表重排，逐个 `--write` 后核对 diff 行数（62 / 28 / 26 / 10 / 38 / 5），确认只动空白、未改单元格内容。

## 🆕 2026-09-27 落地页体验波次：页头减负 + 水波纹 / 脉冲 + 出口卡（已提交 12a0f61）

用户一次给七条指令（附三张兄弟站截图）：① 撤页头的「应用商店 / GitHub 下载」两枚外链；② 参考 `cross-origin-proxy/#features` 给模块图标加 hover 水波纹；③ 导航字体太小颜色太浅、进度条太细且无渐变；④ 分类直达右栏缺「没找到答案」卡；⑤ 作者其他插件卡没有品牌图标；⑥ 在合适的模块补脉冲动效；⑦（中途追加）首屏主按钮「下载插件」改「添加到 Chrome」。仍然只动 `index.html`（`en.html` 由 `pnpm gen:en` 产出）+ FAQ DOM 生成器与其守卫测试，扩展运行时与产物零改动。

- **页头从 12 项回到 10 项锚点**：两枚外链与首屏 CTA 完全重复，且是 12 项挤在一行的根因。删的是 `<a>` 与 `I18N` 的 `nav.cws` / `nav.github` 两个 key（中英各一处），**出口一条没少**——`chromewebstore.google.com` 在两页各仍有 11 处（首屏两枚按钮、移动端抽屉、页脚、FAQ、compare 等）。滚动高亮的锚点表与 `.nav-links` 因此严格同集。
- **导航可读性**：字号 14 → 15px、字色并入新令牌 `--text-strong: #334155`（对白底约 10.4:1）、项间距 12 → 16px。1152px 容器内宽实测整行英文 1018px（品牌 222 + 锚点 696 + 右侧控件 101）、中文 784px，英文档余 134px；对照撤链前的 12 项 / 14px / 12px 那档是 1107px、只剩 45px。
- **阅读进度条**：2px → 3px，纯色 → `linear-gradient(90deg, var(--primary), var(--accent))`，`@supports (animation-timeline: scroll())` 与 JS `--scroll-p` 两条路径同步改，只动一条会在 Chrome / Safari 之间呈现粗细与颜色不一致。
- **右栏出口卡**：`.faq-rail` 由一格变两格（分类直达 + 「没找到答案？」）。文案的单一真源是 `I18N` 字典的 `faqRail.helpTitle` / `faqRail.help`，生成器经 `extractI18nEntry` 读同一份、运行时 `applyLang()` 写的也是这一串，**没有第三个写入点**；原先「生成块内不得出现 data-i18n」的守卫改成两个标记的精确白名单 + 变异测试（改 `id="contact"` 会让它变红）。`gen:en` 覆盖度 229/229 与 15/15、`FAQ DOM 41` 三项计数均未因这一格变化。
- **两枚品牌图标（先自绘、后换真图标）**：第一版给的是自绘描边图形（`--taf` 琥珀 `#f59e0b` 双向箭头 / `--cop` 青 `#00b8d9` 节点连线）。用户当场质疑「为什么不用自带的」——这枚图形的唯一职责是品牌识别，而两个产品的真实主色都是蓝（COP `#409EFF`、TAF 渐变 `#3B82F6`→`#1D4ED8`），琥珀与青哪个都不属于它们，自绘等于用「与特性卡统一」的样式便利替换掉了图标存在的理由。终版改为直接引用对方扩展的官方图标本体：`assets/icons/brands/brand-{transfer-any-file,cross-origin-proxy}.svg`，从兄弟仓库 `cp` 而来、图形部分与源文件 md5 逐字节一致，出处 commit 与 MIT 署名写进文件头和该目录的 `README.md`（同作者作品，MIT → 本仓库 GPL-3.0 兼容）。两枚都是 `<img loading="lazy" alt="" width="48" height="48">` 而非内联：TAF 源图带 `<linearGradient id="bg">`，内联进页面会和宿主 id 撞车；`alt=""` + 包装层 `aria-hidden="true"`，装饰性图形不进无障碍树。
- **水波纹 `aph-halo`**：环是 `inset: -1px` + `border: 1px solid currentcolor` 的绝对定位伪元素，两层错开 0.14s、各 0.62s 向外扩到 `scale(1.34)` 淡出；基准态 `opacity: 0` 就等于动画终态，所以降级只需 `animation: none`。触发只写在 `@media (hover: hover) and (pointer: fine)` 里，触屏没有 hover 态可依赖，不会点一下留残影。14 张特性卡与 2 张互链卡共用同一条 keyframes，环色随各卡自身的 `currentColor`。换真图标后互链卡这层的宿主必须还是包装 `<div>`：`<img>` 是替换元素、不生成 `::before`/`::after`；`border-radius: inherit` 又只认父级声明值，所以每张卡在包装层上各给 `--tile-radius`（源图 rx=16 / rx=28 落在 128 viewBox，缩到 48px 档即 6px / 10.5px）和品牌 `color`，两枚写同一个值时环会在方角那枚上明显外鼓。
- **首屏 CTA 一次性脉冲 `aph-cta-pulse`**：`1.1s × 2`，主按钮 0.9s 起跳、次按钮 1.45s，两圈环出发时刻错开但允许半拍重叠；`.btn-ghost` 自带 1px 描边，环贴着画会读成「边框变粗」，所以次按钮的基准位再外挪到 `inset: -3px`。跑完停在透明，不做无限循环。挂在 `html.js` 下，脚本缺席时这层根本不存在。顺带补了 `.hero-eyebrow .dot` 的呼吸——它此前漏在降级块之外，而 `scale(1.4)` + `infinite` 正是那一档要撤掉的东西。
- **禁 JS 兜底跟着抬**：`<noscript>` 里 `scroll-padding-top` 212 → 224px。字号 14 → 15px 把 ≤520 折行页头从 212px 抬到实测 217px，不补这一段则点锚点会把小标题压在页头底下。
- **测试数漂移（已在本轮末尾收口）**：本轮守卫测试 50 → 62 例，实测 `167 文件 / 1953 用例`，而对外表面一度仍写 **1941 / 167**。这 21 个文件的基线刷新没有混进落地页 diff，而是按下一节「对外测试数基线刷新到实测 1953」单独走了一遍，顺序与守卫要求照本文既有的刷新规程执行。

### 验证

- **门禁**：`pnpm typecheck` / `pnpm lint`（`eslint . --max-warnings 0`）/ `pnpm lint:style` 均 exit 0；`pnpm exec prettier --check` 覆盖本轮变更的 17 个 md/ts 文件全绿；`pnpm test:run` → **167 文件 / 1953 用例全绿**，exit 0。`pnpm build` 同样跑过并 exit 0，zip **708.15 kB**、与上一波基线提交（`5bcb9fc`）记的同值，`find .output -name 'brand-*.svg' -o -name index.html` 为空——落地页与两枚品牌图标确实不在扩展构建闭包内（`wxt.config.ts` 不引用根 `index.html`，`assets/` 只有被 `import` 时才进包，扩展图标取的是 `public/icon/`）。
- **真浏览器实测**（系统 Chrome + Playwright，headless，`file://` 直开两页）：`console` / `pageerror` 0 条；`.nav-links` 恰 10 条锚点、`15px` / `rgb(51, 65, 85)`；右栏 `railCards: 2`，出口卡标题中文「没找到答案？」/ 英文 "Didn't find your answer?"；两张互链卡各带一枚 `<img>` 品牌图标；首屏主按钮中文「添加到 Chrome」/ 英文 "Add to Chrome"。
- **动效不是「写了就算」**：静止态两层环 computed `opacity` 为 `0` 且 `animationName: none`（不留常驻细环）；悬停中读到 `aph-halo` 在跑、两层分别 0.45 / 0.09 的衰减；悬停 1.2s（动画早已落定）再量，两条仍回 `0`。CTA 脉冲环在载入约 2.1s 时读到 0.41 / 0.01，即第二圈正在扩散。
- **换真图标后的复测**：两枚 `<img>` 均 `complete && naturalWidth > 0`（`file://` 下 `requestfailed` 与 ≥400 响应 0 条）、渲染盒恒为 48×48；包装层与 `::after` 的 `border-radius` 分别为 `10.5px` / `6px`（继承生效）、环色 `rgb(59,130,246)` / `rgb(64,158,255)`（即各自品牌色经 `currentColor` 传出）；悬停中 `animationName: aph-halo`、第二层 `animationDelay: 0.14s`，移开后两层各自回到 `none` / `0`。中英两页 `.more-grid` 截图目视核对，图标与文字间距、底板圆角与环的贴合均无异常。
- **禁 JS 档**：320 宽关脚本 → 页头 217px ≤ `scroll-padding-top` 224px、`.nav-links` 右边界 296px、右栏两卡都在且出口卡可见，中英两页同值。
- **两条既有残留（不是本轮引入，HEAD 同值，故只记录未改）**：① 320 一档整页仍有 38px 横向滚动，来自 `#faqList` 的 334px 最小内容宽，与页头无关；② 禁脚本且视口 521–767px 时页头高 81–125px，高于基准 `scroll-padding-top` 84px，点锚点最多把 41px 内容压在页头下。两处口径都写进了 `index.html` 的 `<noscript>` 注释。

## 🆕 2026-09-28 对外测试数基线刷新到实测 1953 / 167（本轮，已提交）

紧接上一节的落地页波次：守卫测试 50 → 62 例让实测值走到 **1953 / 167**，而对外表面仍写 1941。本轮只改数字与日期，不动任何主张措辞、运行时代码与扩展产物——口径与 `5bcb9fc`（1563 → 1941 那一刷）完全一致。

- **24 处数字位 / 21 个手工维护文件**：README ×2 首屏徽章行、`llms.txt` 的 `Quality` 行与 `Last updated`、`index.html` 数据带 `<b>` 与 JSON-LD `dateModified`、`product-site/index.html` 的统计卡与页脚 mono 行、`docs/operations/公众号-*` / `docs/operations/微博-*` 各 2 处、`docs/blog/{zh,en}/**` 共 10 篇正文、`imgs/blog-covers/` 的 04 / 05 两张 SVG 与 `outline.md` 两处。另 11 处（`en.html` ×1 + `blog/*.html` ×10）由生成链带出，合计 35 行数字变化。
- **⚠️ 两种数字写法**：`product-site/index.html` 用千分位 `1,941`（统计卡 `<b>1,941 项</b>` + 页脚 `1,941 tests`），其余表面是 `1941`。**只 grep `1941` 会整份漏掉这两处**——上一刷能抓全是因为当时按 `1,563`→`1,941` 单独列过。刷新前先把 `1941` 与 `1,941` 两种形式各扫一遍。
- **日期随行走**：博客 10 篇 `modified: 2026-09-27` → `2026-09-28`、`llms.txt` 的 `Last updated`、`index.html` 的 `dateModified`、`sitemap.xml` 的 12 条 `lastmod`（`/` + `en.html` + 10 篇文章页）。pricing ×2 / compare ×2 / 博客索引 ×2 保持 09-25、privacy ×2 保持 09-22——本轮这些页面一个字没动。
- **刻意不动**：README 的「📅 文档最后更新：2026-09-25」与页脚月粒度时间（`5bcb9fc` 同样未动，属另一套更新节奏）；公众号 / 微博文案里的 `v3.9.0` 事实基线（那是发布版本口径，不是开发分支的测试数口径）；`docs/reports/INLINE_DROPDOWN_PARITY_EVALUATION.md` 等评审文档里「119 文件 / 1337 例」的记述（那是那一波的现场快照，改掉等于伪造历史）；`CHANGELOG.md` 里 `0aa80d9…19412…` 那条 commit 哈希（子串巧合，不是计数）。
- **顺序**：`pnpm covers:render 04 05` → `pnpm gen:blog`（12 页）→ **最后** `pnpm gen:en`。`en.html` 的数字与 `dateModified` 全部继承自 `index.html`，先跑 `gen:en` 再改中文页会让英文页停在旧值。
- **批量替换带守卫**：21 个文件的一次性替换脚本对每一条 `from → to` 都断言「预期命中次数」（例如 `sitemap.xml` 的 `>2026-09-27<` 必须恰好 12 次、`docs/operations/公众号-*` 的 `1941 项` 必须恰好 2 次），任一条不符即整个文件不落盘、脚本 exit 1。用裸 `sed -i` 或全局 replace 会让 `1941` 这种短串顺手吃掉别处的东西。

### 验证

- **零残留**：全仓（排除 `node_modules` / `.output` / `.git` / `.wxt` / `dist` / `playwright-report`）扫 `1941` 与 `1,941`，命中只剩 `CHANGELOG.md` 的 commit 哈希与本文档的历史记述两处刻意保留项；`1953` / `1,953` 落在 35 处，与 24 手工 + 11 生成的账面吻合。
- **生成物没被手改**：`covers:render` + `gen:blog` + `gen:en` 连跑两遍，`en.html`、12 份 `blog/*.html`、两张封面 PNG 共 15 个产物的 md5 二次全等。
- **封面目视复核**：两张重出的 PNG 里「1953 项自动化测试」都完整落在胶囊内、无溢出（1941 → 1953 位数不变，宽度天然安全，但按规程仍读一次）。
- **门禁**：`pnpm test:run` → **167 文件 / 1953 例全绿**（与刚刷新的对外数字同一实测来源）；`pnpm typecheck` / `pnpm lint` / `pnpm lint:style` exit 0；`pnpm exec prettier --check` 覆盖 17 个变更的 md/ts 文件全绿；`pnpm build` exit 0，zip **708.15 kB** 与 `5bcb9fc` 同值，扩展产物零增长。

## 🆕 2026-09-27 页头右侧控件成组右对齐（本轮，已提交）

用户圈出产品页页头的「中/EN」与右上角 GitHub 图标问「为什么距离那么远」，要求按 UX/UI 最佳实践优化。**根因不是漏写间距，而是间距被 `space-between` 吃掉了**：`.nav-inner` 是 `display:flex; justify-content:space-between`，而语言键、GitHub 图标各自是它的**独立 flex item**，剩余空间会均分进每一道缝隙——`margin-left: 16px` 只是下限，实测语言键与图标之间 ≥1200px 档 100px、1199px 档 297px、1024px 档 239px、768px 档 154px。两枚不同族的控件被摊成页头里的两个孤点，且这个距离随视口每变一档就变一次。

- **收组**：新增 `.nav-actions`（`display:flex; align-items:center; gap:12px; flex-shrink:0`）包住语言键 / GitHub 图标 / 汉堡三枚控件。`.nav-inner` 的 item 数从 4 降到 3，剩余空间只落在「品牌↔锚点条」和「锚点条↔控件组」两道缝上，组内间距从此**只由 `gap` 决定、不再随视口漂移**。
- **统一形态**：两枚控件共用一条规则——36px 等高、`var(--radius-sm)`（10px）同圆角、`var(--bg-soft)` 同底色、`1px solid var(--border)` 同描边、同一条 `transition`。语言键此前是 28px 高的胶囊（`border-radius:999px`、`padding:5px 12px`），图标此前无描边；两者挨在一起时读作一组控件而不是两个恰好并排的部件。语言键的**触控靶从 44.2×28 抬到 44.2×36**。
- **统一反馈**：GitHub 图标的 hover 从「反白成深色块」（`color:white; background:var(--text)`）改成与语言键同一套主色浅底（`--primary` 文字 + `--primary-soft` 底 + 主色描边 + `translateY(-1px)`）。相邻两枚控件给两种相反的悬停语言，是「不是一组」最直接的信号；`focus-visible` 也合并为同一条 2px 主色环。
- **减弱档**：`.lang-toggle:hover, .nav-github:hover { transform: none }` 进 `prefers-reduced-motion` 块——位移本身就是这条动效，撤掉抬升但保留转色与描边，悬停仍有反馈。
- **保留的既有阀门**：`html.js .nav-toggle` 的特指度（0,2,0）高于新的 `.nav-toggle{display:none}`，窄屏抽屉照常开启，源码顺序调整不影响；≤480 撤 GitHub 图标、≤520 禁 JS 换行两道既有保护原样保留。
- **拍板过程中否决的三项**：① 把「中 / EN」升级成分段控件（`中|EN` 二选一胶囊）——用户选「等高同圆角」方案，不改控件形态；② 移除重复的 GitHub 出口（导航文字链 vs 右上角图标）——用户选「两者都留」，导航链服务「找下载」、图标服务「看源码」，意图不同；③ 给汉堡也加底框以凑齐三个盒子——汉堡是**不同族**的导航开关，且在 ≤480 是唯一留在原地的控件，给它加框会让窄屏页头变重，属未获授权的视觉扩张。

### 验证

- **间距**（裸 CDP + headless Chrome 144，`Emulation.setDeviceMetricsOverride` 逐档，改后共测 15 个宽度：320/360/375/414/420/480/600/768/900/1024/1199/1200/1280/1440/1600）：语言键↔图标在图标可见的每一档**恒为 12px**（1600/1440/1280/1200/1199/1024/900/768/600），汉堡↔前一枚同为 12px；改前同档实测为 100px（≥1200）/ 297px（1199）/ 239px（1024）/ 154px（768），图标撤除的窄屏档则是 8.9px（320）/ 28.9px（360）/ 55.9px（414）→ 统一为 12px。
- **盒子**：`langBox {w:44.2,h:36,r:"10px"}`、`ghBox {w:36,h:36,marginLeft:"0px"}`，全档位一致；`.nav-inner` 的 `justify` 仍是 `space-between`（未改页头整体骨架）。
- **320px 的横向溢出是既有事实、不是本轮引入**：把 `git show HEAD:index.html` 落成仓内临时副本同法测量，基线在 320 同样 `overflow:true`（且语言键只有 28px 高）；测完即删该副本，工作树只剩两份落地页。
- **交互态**（`Input.dispatchMouseEvent` / `dispatchKeyEvent` 真事件）：两枚控件 hover 计算样式逐项相同（`rgb(78,136,255)` / `rgb(234,241,255)` / 主色描边 / `matrix(1,0,0,1,0,-1)`）；reduce 档 hover 为 `transform:none` + 主色浅底；Tab 序 14=`langToggle`、15=`navGithub`，焦点环均 `2px solid rgb(78,136,255)` / offset 2px。
- **降级路径**：1199 抽屉展开后组内间距仍 12px；480 图标撤除后语言键↔汉堡仍 12px；禁 JS 副本 520 换行后仍 12px 且无溢出；点语言键后 `docLang` 翻到 `en`、标签转「中文」（就地切换，非跳转）。截图留在 `/tmp/aphref/shots/`（1440 中英 / 1199 / 480 / 375 / 禁 JS 520·420），按既有口径不入仓。
- **生成链**：改完中文页再 `pnpm gen:en` → `data-i18n 230/230, data-i18n-html 14/14, FAQ DOM 41`，`en.html` 的 hunk 与 `index.html` 逐段对称；**再跑一次 `gen:en`，`en.html` md5 逐字节不变** → 英文页无手改。
- **门禁**：`pnpm typecheck` / `pnpm lint`（`--max-warnings 0`）/ `pnpm lint:style` / `pnpm exec prettier --check index.html en.html` 全绿；`pnpm test:run` → **167 files / 1941 tests passed**，exit 0（118.06 s）；`pnpm build` exit 0，zip **708.15 kB** / Σ **2.01 MB**，与上一波同值 → 扩展运行时产物零改动（落地页不进构建闭包）。
- **已知未改**：`en.html` 的静态字节里语言键仍写「EN」，要等主脚本把它改成「中文」——英文页首帧标签指向的是当前语言而非目标语言。这是收组前就存在的行为，用户已选择保留胶囊形态，本轮不动。

## 🆕 2026-09-27 对外测试数基线刷新到实测值（本轮，已提交）

用户选中上一波收口汇报里那条「本轮范围外的漂移」（对外表面仍写 **1563 项 / 142 文件**，实测已是 **1941 / 167**）说「这个帮我更新」。本轮只改数字与日期，不改任何主张措辞、不动运行时代码与扩展产物。

- **24 处数字位**（`1563`→`1941`、`1,563`→`1,941`、`142`→`167`）改在 **20 个手工维护文件**上，分布在下列对外表面：README ×2 首屏徽章行、`llms.txt` 的 `Quality` 行与 `Last updated`、`index.html` 数据带 `<b>`、`product-site/index.html` 的统计卡与页脚 mono 行、`docs/operations/公众号-*` / `docs/operations/微博-*` 各 2 处、`docs/blog/{zh,en}/**` 共 10 篇正文、`imgs/blog-covers/` 的 04 / 05 两张 SVG 与 `outline.md` 两处；另有 11 处（`en.html` ×1 + `blog/*.html` ×10）由生成链自动带出，合计 35 行数字变化。
- **生成链重跑**：`pnpm gen:blog`（12 页，其中两份博客索引页字节未变）、`pnpm gen:en`（data-i18n 230/230、data-i18n-html 14/14、FAQ DOM 41）、`pnpm covers:render 04 05`（sharp / libvips，无浏览器依赖）。顺序必须是**先改 `index.html`、后跑 `gen:en`**——`en.html` 的 `1941` 与 `dateModified` 都从中文页继承，反过来跑英文页就是旧值。
- **JSON-LD 与地图新鲜度**：`index.html` 的 `SoftwareApplication.dateModified` → 2026-09-27；`sitemap.xml` **12 条** `lastmod` → 2026-09-27（首页、`en.html`、10 篇博客条目），`pricing` ×2 / `compare` ×2 / 博客索引 ×2 本轮内容未变保持 2026-09-25，`privacy` ×2 保持 2026-09-22。
- **博客 frontmatter**：10 篇全部补 / 改 `modified: 2026-09-27`，`build-blog-pages.mjs` 据此填 `BlogPosting.dateModified`、`article:modified_time` 与可见的「更新于」。第 5 篇中英两份原本没有 `modified` 键，批量脚本用 `^date: …$` → `$1\nmodified: …` 替换时把 `date:` 这个**键名一起吃掉了**，`pnpm gen:blog` 立刻报 `frontmatter 缺少 date`（exit 1）；手工补回 `date: 2026-09-22` 后重跑才过——批量正则必须保留键名，且「预期命中次数」断言拦不住另一个循环里的错。
- **刻意不动**：页脚 `footer.updated` 是月粒度（「最后更新：2026-09 · v3.12.0」）；`docs/operations/公众号-*` / `docs/operations/微博-*` 的「事实基线 v3.9.0」行保持 v3.9.0（2026-09-25 定的口径：整篇主张未逐条重审，不单独抬版本号）；`llms.txt` 的 `Latest release: v3.12.0 (2026-09-25)` 是 GitHub release 实测日期；本文件下方四处**过去波次**的验证记述（1563 / 142）保留原值，属历史快照不是当前基线。
- **残留扫描**：`git grep` 不带 `--include` 过滤扫 `1563`，全仓命中只剩本文件四处**过去波次**的验证记述（无 JS 数字带 `[1563,…]`、W1 版式对齐的六卡说明、09-25 波次的新鲜度与门禁段落）加上本轮这一节自己；`docs/reports/INLINE_DROPDOWN_PARITY_EVALUATION.md` 里的 `1292 / 1337` 是更早的波次转述，不含 `1563`；`tests/` 没有任何守卫写死旧数字（改数不会让测试变红），数字位也不在 `tests/docs/*` 的断言范围内。

### 验证

- **数字来源就是实测**：`pnpm test:run` 无管道直跑 → `Test Files 167 passed (167)` / `Tests 1941 passed (1941)`，exit 0，208.9 s。对外各处写的正是这一对值。
- **生成链**：`pnpm gen:blog`（12 files）、`pnpm gen:en`（data-i18n 230/230、data-i18n-html 14/14、FAQ DOM 41）、`pnpm covers:render 04 05` 全部 exit 0；随后**再跑一次** `gen:en` + `gen:blog`，`en.html` 与 12 份 `blog/*.html` 的 md5 逐字节不变 → 生成物没有手改。
- **封面目视复核**：两张重出的 PNG 里「1941 项自动化测试」渲染正确，05 的胶囊未溢出、04 的关键字行未折行。
- **门禁**：`pnpm typecheck` / `pnpm lint`（`--max-warnings 0`）/ `pnpm lint:style` 均 exit 0；`pnpm exec prettier --check` 覆盖本轮 16 份人类维护 `.md`（README ×2、`docs/blog/{zh,en}/**` ×10、公众号 / 微博文案、`imgs/blog-covers/outline.md`、本文件）全绿（本文件表格补白后通过）；`pnpm build` exit 0，`.output/account-password-helper-3.9.0-chrome.zip` **708.15 kB**、Σ **2.01 MB**，与上一波同值 → 运行时代码与扩展产物零改动。
- **未做的核验**：本轮没再开真浏览器渲染 `index.html` / `en.html`——改动只有一处静态数字文本与 JSON-LD 的日期，无 CSS/JS 变化，且 `index.html` 内联脚本的可解析性由守卫测试覆盖（套件全绿）。`sitemap.xml` / `llms.txt` / `.svg` 无 prettier parser，按既有口径不在门禁内。

## 🆕 2026-09-27 本地产物与非 SEO 文档停止入库（本轮，已提交）

用户指令「把一些没必要提交到远程代码仓库的文档添加到 .gitignore」，追问后定的口径是**对外博文与 SEO 内容不加忽略规则，本地产物与非 SEO 运营文档加**。本轮只动 `.gitignore`、`docs/CONTRIBUTING.md` 与一处注释，运行时代码与产物零改动。

- **新增 7 条规则，分三块**（`.gitignore` 末尾 +25 行）：① AI 会话工作稿与工具跑批产物 `.qoder/plans/`、`.qoder/superpowers/`、`.qoder/better-harness/`、`.qoder/better-harness-runs/`、`.qoder/repowiki/`；② 一次性评审报告 `docs/code-review-*.md`；③ Qoder Sites 本地描述符 `*.qoder.site`（文件名带站点标题、内容含 siteId 与整页 base64 快照，属机器绑定状态，此前那份 `product-site/.账号密码管理助手 · 产品页.qoder.site` 一直没被忽略）。**`.qoder/` 整体不忽略**——`rules/`、`skills/`、`commands/` 是团队协作配置，原样保留跟踪。
- **反向清单写进文件注释**：`docs/ARCHITECTURE*.md`、`docs/blog/**`、`docs/operations/promo/**`、`docs/operations/{公众号,微博,reddit}*.md`、`docs/operations/exposure-status.md`、曝光提升执行手册属对外与 SEO 内容；`docs/reports/PERF_*.md`、`docs/reports/INLINE_DROPDOWN_PARITY_EVALUATION.md`、`docs/reports/LANDING_MOTION_PROPOSAL.md`（含配套实物 `docs/prototypes/landing-motion-lab.html`）**被源码注释按路径引用**——这几份在 `utils/`、`composables/`、`tests/`、`benchmarks/`、`e2e/` 的注释里被点名 16 次（13 个文件），忽略了就是把仓库里的引用变成死链，所以列成「勿顺手加进来」而不是留在脑子里。口径同步写进 `docs/CONTRIBUTING.md`「提交范围 / What Belongs in the Repo」中英各一节。
- **14 个已跟踪文件 `git rm --cached`**（磁盘文件一份没删）：`better-harness`(4) + `better-harness-runs`(2) + `plans`(3) + `repowiki`(2) + `superpowers`(2) + 评审报告(1)。远端现状分两类——`.qoder/plans`、`better-harness`、`better-harness-runs`、`repowiki` 此前已推送，推上去时表现为删除；`docs/code-review-2026-09-26.md` 与 `.qoder/superpowers/` 只在未推送的提交里出现过。
- **顺带清掉一处死引用**：`tests/architecture/sidepanelClosure.test.ts` 的文件头注释原引 `.qoder/plans/身份信息库（Identity Vault）实现方案.md`「独立性硬约束」，并用了只在方案稿里定义的「风险 R6」编号。方案稿不再入库后改引 `docs/ARCHITECTURE.md`「27. 身份信息库」的「定位与独立性」（该小节确实写了「不改 `utils/types.ts` / `passwordCrud.ts` / sidepanel / popup / content 任何既有路径」），R6 编号删掉、句子语义不变。
- **⚠️ 一条要说清的限制**：忽略规则只管工作树，**不改历史**。`docs/code-review-2026-09-26.md` 与 `.qoder/superpowers/` 是在未推送的 `ca33c83` 进入历史的，本提交只让分支**顶端树**不再包含它们——按现状 push，这两个 blob 仍会上传到远端，只是 `main`/页面上看不到。要彻底不上传必须改写这 27 个提交的历史，本轮没做，也不建议做。

### 验证

- `git ls-files -i -c --exclude-standard` 输出为空 → 没有任何**仍被跟踪**的文件撞上 7 条新规则；`check-ignore --no-index` 逐条命中六个目标路径，并确认 `.qoder/better-harness/` 不会误吞 `.qoder/better-harness-runs/`（两条规则各自命中自己那条），`*.qoder.site` 对以点开头的 `product-site/.账号….qoder.site` 也照样生效。
- 死引用扫描：提交后对全仓跟踪文件 `git grep` 六个被停跟踪路径与 `qoder.site`，命中只剩 `.gitignore` 自身；`风险 R` 编号在代码与文档里只剩本节这段事后记述，源码注释中归零。反向确认：**26 条该留的路径逐条 `check-ignore` 全为「未忽略」**（`ARCHITECTURE` 中英、`CONTRIBUTING`、`CWS_*` 两份、四份 `PERF_*` / 口径报告、`prototypes/landing-motion-lab.html`、本文件、执行手册、`reddit-post` / `promo/*` / `公众号-*` / `微博-*`、`docs/blog/**` 抽样、根目录 `pricing.md` 与 `test-page.html`、`.qoder/{rules,skills,commands}`），0 条误伤。其中 `docs/reports/INLINE_DROPDOWN_PARITY_EVALUATION.md` 被本文件按 §9.4 引用、`test-page.html` 被 `docs/ARCHITECTURE.md` / `.en.md` 链接，忽略它们会立刻造出两处死链。
- 门禁：`pnpm typecheck` exit 0、`pnpm lint`（`eslint . --max-warnings 0`）exit 0、`pnpm exec prettier --check docs/CONTRIBUTING.md tests/architecture/sidepanelClosure.test.ts` 全绿（`.gitignore` 无 prettier parser，不在门禁内）、`pnpm test:run` **167 文件 / 1941 用例全绿**（exit 0，跑在两次注释改动之后）。
- 提交 `e5456df`（17 文件 / +49 / −6952），husky + lint-staged 通过；提交后 `git status --porcelain -uall` 为空。

## 🆕 2026-09-27 FAQ 平铺内容区 + 分类直达右栏（本轮，已提交）

用户指令「常见问题模块是否要平铺整个内容区域，目前左右都还有空白」，追问后指定**参考 cross-origin-proxy 的 `#faq-basics`，在右边加「分类直达」快速导航**。落地的判断是：**不把问答列拉满 1152，而把右侧空白变成导航**。问答列原本 820px 居中，容器内宽 1152 → 左右各 166px 空白；41 条收起态就有约 3700px 高（1440 宽实测 3658px），拉宽只会让行长更难读，而右侧那条空白正好能放一节导航。仍然只动 `index.html`（经 `pnpm gen:en` 出 `en.html`），扩展产物零改动。

- **网格挂在本节容器上**：`#faq` 的 `.container` 加一个 `faq-wrap` 类，基准档单列（右栏落在问答之后，锚点照旧能点、禁 JS 也一样读），`@media (min-width: 1080px)` 才拆成 `minmax(0,1fr) 320px` + 40px 栏距（1152 = 792 + 40 + 320，正好铺满）。`.section-head` 用 `grid-column: 1 / -1` 横跨，标题与问答之间那道 40px 与拆分前逐字一致。`align-items: start` 是 sticky 的前提——默认 stretch 会把右栏拉成问答列那么高，它自己就是那一格，再没有可移动的空间。
- **右栏属于生成区，不手写**：分类标题、每组条数、锚点 id 三样都只能从 `FAQS` 算出来，手写必然与左列漂移；而它必须与列表同一语言，所以 `renderFaqDom(faqs, lang)` 一次产出两格（`#faqList` 与 `<aside class="faq-rail">`），页内 `renderFaqRail()` 在切语言时按同一规则重建。生成区因此从一道 `prettier-ignore` 变两道——它的作用域只有紧随其后的那一个节点，漏了右栏那道，prettier 就会把 `<li>` 拆成多行，`gen:*` 与 `pnpm format` 互相回改。
- **锚点用 `iconClass` 而不是序号**：`#faq-cat-security` 而非 `#faq-cat-1`——下标会在插删分类时整体位移，把已经发出去的深链指到别的分类上。`extractFaqs` 因此新增三条构建期校验：`iconClass` 必须是合法 slug、全页唯一、且问答不得出现在任何分类之前（否则右栏无法归组）。落位不需要 `scroll-margin-top`：全局 `html { scroll-padding-top: 84px }` 已经管住，且它与 sticky 的 `top: 84px` 同值，由测试钉住。
- **不加 `html.js` 门控**：右栏不是「隐形初始态」，它是返回字节里就存在的可见内容；目录标签用 `textContent` 写入，分类标题是文案、不该被当标记解析。顺手改掉一处失效注释：`section:target` 那段原写「FAQ 条目无 id（静态 DOM 与脚本重渲染都不带）」，现在分类节点带 id 了，判据口径改成「问答条目不带 id；分类节点的 id 是右栏落点，且它是 div 不是 section，撞不进那条规则」。
- **验证时抓到的一处真缺陷**：单列档右栏实测只有 **126px** 宽——网格项两边都是 `auto` 边距时不再 `stretch`，只按内容收缩，卡片缩成窄条（≥1080px 那档被 320px 那一格遮住，看不出问题）。补 `width: 100%` 后 1079 / 768 档实测 420px、375 档 327px。这条也进了守卫，并附一条变异自检；写这条变异时先踩了个坑：`width: 100%;` + `max-width: 420px;` 这一对在 `.hero-visual` 里也有，`replace` 打不中右栏却照样「改变了页面」，定位串必须带上 `margin-inline: auto` 才唯一。
- **守卫扩到 50 例**（原 22 例，`tests/docs/landingFaqDom.test.ts`）：右栏与 `FAQS` 推导的分组逐字一致、条数总和 = 41、每条 `href` 都能落到真实 id 且 id 全页唯一、锚点前缀与页内 `faqCatAnchor` 及生成模块同式、右栏标题与页内 `FAQ_RAIL_TITLE` 双向钉死、中英两栏样式块逐字同源、两栏/sticky 只在 ≥1080px 那一档（按大括号扫描判嵌套，不按缩进猜）、`renderFaqs` 尾部必须重建右栏、右栏必须是 `#faqList` 的兄弟（否则切语言时被 `innerHTML = ''` 清掉）。变异自检 8 条，全部要求「改坏了必须变红」。

### 验证

- 真机（headless Chrome，裸 CDP，注入 15px 经典滚动条）9 个形态 × 每形态 4 个滚动位：1440 / 1200 / 1080 档 `grid-template-columns: 792px 320px`（1080 为 672 + 320）、`align-items: start`、右栏 `position: sticky` / `top: 84px`；1079 / 768 / 375 档单列、右栏 `static` 落在问答之后。**六个宽度全部 `scrollWidth == clientWidth`，无横向溢出**。
- 点右栏第 3 条（数据管理）：`location.hash = #faq-cat-data`，目标分类 `top = 84`、页头底边 65、间隙 19px、完整可见——中英两页、reduce 档、禁 JS 副本、各断点共 9 次点击全部一致（滚动 `scroll-behavior: smooth`，取样前轮询到 `scrollY` 稳定才读）。sticky 到本节末尾自然让位：滚到最后一条问答时右栏底边 70 ≤ 本节底边 142，没有压到页脚。
- 语言往返（中文页点 `#langToggle`）：标题 `分类直达 → Browse by category → 分类直达`，四条分类名同步往返，切完 `catIds` / `hrefs` 仍逐一对应、41 条问答不丢、右栏仍是 `.container.faq-wrap` 的第三个子节点（没被列表重建带走）。`en.html` 首屏即 `Browse by category`，禁 JS 副本首屏 `分类直达` + 4 条目录。截图目视 1440 sticky 中态 / 1440 段尾 / 860 单列 / 375 英文单列四张。
- 生成链 `gen:faq-dom`（41 问答 / 4 分类）→ `gen:en`（data-i18n 230/230、html 14/14、FAQ DOM 41）；`gen → prettier → gen` 已证为不动点（两文件 md5 前后一致），`prettier --check index.html en.html` 通过。门禁：`typecheck` / `lint --max-warnings 0` / `lint:style` / `pnpm test:run`（167 文件 / 1941 例）/ `pnpm build`（8.2s，708 kB zip）全绿。

## 🆕 2026-09-27 落地页阅读进度条（本轮，已提交）

用户指令「参考 transfer-any-file 产品页，给本页增加页面进度条动效」。参考页的做法是一条跟随阅读进度的细线，这里把它接到**已有的 sticky 页头下边缘**，不新增 DOM 节点。仍然只动 `index.html`（经 `pnpm gen:en` 出 `en.html`），运行时代码与扩展产物零改动。

- **三条路径成套**：① 主路径 `@supports (animation-timeline: scroll()) { .nav::after { … animation-timeline: scroll(root block) } }`，进度由 CSS 滚动时间线驱动，`transform: scaleX(0 → 1)`，JS 与页面主线程无关；② 兜底路径 `@supports not (...)` 消费脚本写入的 `--scroll-p`（Safari / 旧 Firefox）；③ `prefers-reduced-motion: reduce` 档整条 `content: none` 撤除——滚动时间线动画没有「时长」可塌，缩短等于没意义，只能撤，滚动位置信息仍由浏览器滚动条提供。两档 `@supports` 互斥，不会同时出现两条线。
- **为什么挂在 `.nav::after` 而不是新开 fixed 元素**：页头是 `position: sticky`，绝对定位的伪元素天然以它为包含块；窄屏锚点条换行成两行时页头自己变高，这条线照样贴着底边（`bottom: -1px`，正好压在 `border-bottom` 那行），不需要脚本来猜页头高度。`pointer-events: none`，不挡任何点击。
- **刻意不做 `html.js` 门控**：进度条不是「隐形初始态」，脚本解析失败与否都不该让它消失——这与 `landingScripts.test.ts` 守的那套「隐形初始态必挂兜底」是相反的情形，写在 CSS 注释里说明。
- **顺带的一处等价重构**：`onScroll` 里原本两处各读一次 `document.documentElement.scrollHeight`（导轨触底判定 + 新增的进度），现合并成一个 `max` 变量。判据代数等价：`scrollY + innerHeight >= scrollHeight - 80` ⇔ `scrollY >= max - 80`，不改变原有隐藏「回到顶部 / 滚动到底部」的时机。
- **新守卫** `tests/docs/landingProgressRail.test.ts`（10 例）：中英两页三件套齐备、`.nav` 仍是 sticky（否则线落到文档顶端）、中英实现逐字同源（`en.html` 是生成物，不许各写一套），外加 5 个变异自检——抽掉 `@keyframes` 名字、抽掉 reduce 档规则、把兜底档写成无门控、抽掉脚本侧判据门、抽掉主路径时间线绑定，每个都必须变红；另有一条「未变异的原文不误伤」。写这条守卫时踩到自己挖的坑：`.nav::after` 的三处规则不能一律要求 `@supports` 门控，reduce 档那处**应当**在 `@media` 里，判据已改成「门控 / 在 reduce 档 / 无归属」三分，只有第三类才算违规。

### 验证

- 真机（headless Chrome 1440 / 1080 / 768 + 中英两页，裸 CDP）：`.nav::after` 计算样式为 `content: ""` / `height: 2px` / `animation-timeline: scroll(root)`，`scaleX` 在 0% / 50% / 100% 三档取样实测 `0 / 0.5 / 1`，线的位置恒为 `y = 页头底边 - 1`、横向 `0 → 视口宽`。**取像素复核「真的画出来了」**（伪元素无法命中测试，只能看像素）：页面自身 `drawImage` 解截图后取样，0% 时线位两端的像素都是页头 `border-bottom` 的 `235,239,244`；50% 时左端 `61,112,223`（渐变起点 `--primary-dark`）、右端仍是 `235,239,244`；100% 时左 `60,110,220`、右 `76,134,252`（渐变终点 `--primary`）；线上下各 6px 处是纯白，说明没有溢出到 hero。
- 两条降级路径各自单独验：`prefers-reduced-motion: reduce` 下计算样式 `content: none`（盒子不生成）；摘掉全部 `<script>` 的副本仍走主路径、三档取样与原文一致；把两档 `@supports` 判据同时改写成不可能成立的属性 + 把 `CSS.supports` 钉成 `false` 的「老引擎」副本里，线改由 `--scroll-p` 驱动，脚本写入 `0 / 0.5 / 1`、`scaleX` 同步 `0 / 0.5 / 1`。测量口径备注：页面有 `scroll-behavior: smooth`，第一版取样脚本用默认 `scrollTo` 量到的是「飞行途中」的值（bottom 档只走到 0.41），改 `behavior: 'instant'` 后才拿到底。
- `pnpm gen:en` 连跑两次 md5 一致（`8073eb5c…`），生成物未手改；`typecheck` 通过；`tests/docs` 4 文件 / 48 例全绿；新增测试文件 `prettier --write` 后 `--check` 通过、`eslint --max-warnings 0` 0 报错。

## 🆕 2026-09-27 同作者插件中文名同步（已提交）

用户指令「把产品说明页和 README 的中文版，同作者插件『文件转换』的名称同步更新」，追问后选定**全站一起同步**。名称的事实来源是兄弟仓自身：`transfer-any-file` 的 `public/_locales/zh_CN/messages.json`（扩展名 `文件格式任意转换助手 — 离线转换无上传`）与 `utils/i18n/zh.ts` 的 `appName`，英文名仍是 `Transfer Any File`。此前中文面一律写英文名，与同卡片里「跨域代理助手」的中文命名口径不一致。

- **中文面 5 个源**：`index.html`（`#more` 卡片静态文案 + I18N 字典 `more.taf.name` 的 zh）、`compare.html` 页脚互推行、`pricing.html`（静态 + 字典 zh 两处）、`scripts/build-blog-pages.mjs` 的两条 zh `footerNote`（文章页与博客首页）、`product-site/index.html` 页脚「社区与同作者作品」列表项（`Transfer Any File · 离线文件转换` → `文件格式任意转换助手 · 离线文件转换`）。
- **英文面一律不动**：`README.en.md`、`llms.txt`、`compare.en.html`、`blog/*.en.html` 保持 `Transfer Any File`。`en.html` 与 `pricing.en.html` 各变 1 行，且只落在页内 I18N 字典的 **zh** 字段（供语言切回中文时使用），英文默认可见文案实测仍是 `Transfer Any File`。
- **README.md 无改动**：`git diff` 为空，HEAD 早已写作「文件格式任意转换助手」——本轮第一次 grep 曾把它读成英文名，以 git 为准。
- **生成链**：`gen:en`（data-i18n 230/230、data-i18n-html 14/14、FAQ DOM 41）→ `gen:pricing-en`（107/107、12/12）→ `gen:blog`（12 文件），生成物未手改。
- **验证**：`typecheck` / `lint` 通过；`prettier --check` 改动文件 0 报错；`pnpm exec vitest run tests/docs` 38 例全绿（`landingFaqDom` / `faqSchemaParity` 会读 `index.html`）。改动面 13 文件 × 每文件 1–2 行，无越界改动。

## 🆕 2026-09-26 落地页缺陷修复与评审波次（本轮，已提交；推送状态以 `git log origin/feature-opt..HEAD` 为准）

用户指令「从最佳的用户体验、实用性和性能考虑按最优方案执行，完成后代码评审 + 自测，无问题自动提交」，随后追加「深度代码评审与安全评审，确保存量功能可用，然后提交并推送」。**仍然只动 `index.html`（经 `pnpm gen:en` 出 `en.html`）、两份 README 与本审计文档，运行时代码与扩展产物零改动。**

### 改了什么

- **R2 两个反馈**：① `.more-grid`（同作者互链卡）在 `@media (max-width:768px)` 收成 `1fr`——原先漏这条，768 以下每格 176px、长描述挤成 14-24 行、卡高 590-862px，收单列后 372px / 5 行 / 203px；② README 功能演示从 4 行 × 2 列 `<table>` 改回**一行一张**（`<p align="center">` + `<a href="原图">`，8 段），并订正引言口径为「首图 1152×720 操作动图，其余七张 2560×1600 的 2 倍屏截图」——原句把两类尺寸混为一谈是假事实。代价实测：单列比两列高约 3.7×，图片载荷约 4.9 MB，用户已确认接受。
- **R3 缺陷轮（`d596fb4`，八处）**：窄屏页头三道阀门（品牌名可缩略 / ≤480 撤源码图标 / 禁 JS ≤520 换行 + 同档补 `scroll-padding-top: 212px`）；`.slide-shot` 画幅 `16/9` → `16/10`（母版是 16:10，旧值上下各切 23.75px 自带标题带）；`.compare-table` 死令牌 `--bg-subtle` / `--text-secondary` 换回 `--bg-soft` / `--text` / `--text-muted`，行列 hover 整组收进 `@media (hover:hover) and (pointer:fine)`；**跑动数据包 `.flow-packet` 抬 `z-index: 3` 并加白描边**（`.flow-step` 是 `z-index:auto` 不建层叠上下文，数字伪元素 z1 / 对勾 z2 直接参加卡片排序，auto 定位元素排在正 z 之后）；滚动高亮 `sections` 表补齐 10 条页内锚点（原 7 条）；轮播仅当前屏截图保留 `tabindex="0"`（离屏 13 个隐形停留点归零）；灯箱说明 `figcaption` → `div.lightbox-cap`（父元素不是 `<figure>`，语义不成立）。
- **本轮双轴评审 + 安全评审后的四处修复**：① 灯箱**焦点陷阱**——`lbClose` 是对话框内唯一可聚焦控件，不拦 Tab 就会按文档顺序跑到遮罩背后（body 末尾之后先出浏览器界面，绕回来是页头品牌链），而背景此刻滚动锁死且整片被盖；② **方向键归位**——轮播的 `document` 级 `ArrowLeft/Right` 此前无条件翻页，灯箱开着时背后照样换屏，现在开着即 `return`；③ **开着就不空转**——`autoPlayAllowed()` 增第 4 道门 `!lightboxOpen`，`openLightbox` 置位 + `stop()`、`closeLightbox` 复位 + `start()`，与 hover 暂停走同一条路（不复用 `lightbox.hidden` 作判据：`start()` 在 6611 行初始化时就会跑，而 `const lightbox` 在文末，直接引用是 TDZ 崩溃）；④ 删 `.reveal-delay-5`（全仓仅定义无消费者，同族 1-4 都有引用）。
- **安全评审结论（无需改动项也已列明）**：`innerHTML` 只吃文件内 `SLIDES` / `FAQS` / `I18N` 常量，`lang` 经 `'zh'|'en'` 白名单收窄，URL / `localStorage` / postMessage 无可注入面，灯箱说明走 `textContent`；新增远端资源 0（无外部 `<script>` / `<link>` / 字体 / 统计），`target="_blank"` 中文页 28/28、英文页 26/26 全带 `rel="noopener noreferrer"`；轮播图统一取 `assets/cws-store/screen-*.png` 占位套件，`assets/screenshots/` 旧 PII 图仅存于注释、无引用；`PBKDF2 600000`、五字段逐字段加密、`UPDATE_CHECK_INTERVAL_MINUTES=360`、13 项权限、23 条命令面板逐项对代码复算通过。

### 评审提出但刻意未做

- `docs/` 与 `compare.html` 的「十个维度」是 `compare.html` 自述口径（`e8d3d1e` 即如此，正文表体实有 11 行，第 11 行「跨设备云同步 / 移动端 App」是刻意保留的短板披露行）；`llms.txt` 只是跟随该口径，不在本轮改。
- `index.html` 的 `dateModified`、`sitemap.xml`、`llms.txt`、README 更新时间仍是 2026-09-25：`CWS_PUBLISHING_GUIDE.md` 只要求年月一致，逐个改成 09-26 会把 18 条 `lastmod` 与四处日期一并搅动，收益为零。
- 魔法色值（`.flow-step i{background:#b9d2ff}`、`.copied{color:#6ee7b7}`、灯箱 `#cbd5e1`）与 `.compare-cross{color:#ccc}` 低对比度：存量写法，`lint:style` 的 glob 不含 `.html`，本轮不扩范围。
- `scripts/build-en-page.mjs:152` 的 `replaceEvery` 是全文件 `replaceAll`：当前只命中 2 处且未命中即 `throw`，但若 `#more` 文案将来改成 `data-i18n-html`，字典里的 **zh** 值会被一起改写。`pricing` 生成器用「字典里同时放 zh/en 两值」规避了同一风险——两套实现并存，统一它属独立任务。

### 验证

真机（headless Chrome 1440×900 + 裸 CDP，中英两页各跑一遍）：`{opened, focusOnOpen:"lightbox-close", pausedWhileOpen, trapped, arrowBlockedWhileOpen, closed, focusReturned, lockReleased, resumed, arrowWorksAfterClose, tabbableCount:1, deadDelay5:false}` 全绿；其中 Tab 陷阱**另在 `index.html` 上用真实 `Input.dispatchKeyEvent` 复测过一次**（合成事件证明不了原生焦点移动；`en.html` 侧靠 JS 与中文页逐字同源 + 合成事件覆盖）。评审前既有测量：数据包落格 38 采样点遮挡 23 → 0；离屏可 Tab 13 → 0；滚动高亮 10 锚点 × 中英全对。三条降级保险复测：无 JS 320/420/768/1024/1440 五档 0 溢出、12/12 锚点可见、0 reveal 卡隐；reduce 39/39 落终态；删 `IntersectionObserver` 39/39 可见、数字带 `[1563,5,3,6,23,0]`。`pnpm gen:en` 连跑两次 md5 一致（**data-i18n 230/230、data-i18n-html 14/14**）、生成物未手改；`typecheck` / `lint` / `lint:style` / `prettier --check` 0 报错；`pnpm test:run` **142 文件 / 1563 例全绿**（`tests/docs/faqSchemaParity.test.ts` 会读 `index.html`，故落地页改动在测试覆盖内）。口径备注：这一轮串行门禁脚本里 test 那步接了 `| tee`，退出码被 `tee` 吞成 0，而进程实际在半路收到 SIGTERM（日志末尾 `exit code 143`、无 `Test Files` 汇总行）；改为无管道重跑后先遇 1 例 `savePasswordPrompt.labelWidth` 的 5 s 争用超时（单跑通过），再跑一次得到上述全绿——**认的是日志里套件自己的汇总行，不是哨兵。**

## 🆕 2026-09-25 落地页与 README 版式对齐波次（已提交）

参照同作者另两个产品页（`cross-origin-proxy` / `transfer-any-file`）的版式与动效，把本插件的产品说明页与两份 README 对齐。**只动 `index.html`（经 `pnpm gen:en` 出 `en.html`）与两份 README，运行时代码与扩展产物零改动。**

### 改了什么

- **W0 动效令牌与落位反馈**：新增 `--dur-slow: 0.6s` 作为「滚动揭示 + 进场」那一档的单一来源（取值与收敛前逐字等价，不是新的时间承诺），hover / 按压两档仍是各处字面量；`--dur-fast` / `--dur-mid` 全仓 0 处引用，已删（快照：`82dc6f3` 时确实为 0；`d596fb4` 起两令牌各 3 处引用——灯箱入场、`aph-confirm` 落位反馈、追光过渡，别再照本句判断）。新增 `:target` 落位提示（`aph-found` 1.2s），reduce 用户改走本文件既有的 `aph-fade` 0.2s 约定而不是彻底静默。`html { scroll-behavior: smooth; scroll-padding-top: 84px; }`。
- **W1 版式对齐**：① 数据带 `.metrics` 六卡（1563 用例 / 5 个逐字段加密字段 / 3 档跨子域名匹配 / 6 款主题 / 23 条命令面板命令 / 0 个云端账号与同步服务器，逐一可对代码复算；测试文件数 142 只出现在 README 与 `llms.txt`，落地页刻意不展示）；② 工作原理带 `.hiw` 四步，编号与 README「工作原理」四步、`docs/ARCHITECTURE.md` 功能实现详解同一口径；③ 隐私带 `.priv` 四条，措辞逐字取自 `privacy.html` 的权限表与既有隐私口径；④ 导航补 `#how` / `#privacy` 锚点并把 scroll-spy 列表扩到 7 项（快照：`d596fb4` 起是 10 项——本轮新增的痛点 / 场景 / 安装三节必须一并列进表，否则滚到那一节高亮还停在上一节）；⑤ 对比表「本插件列」整列 hover wash 用 `:has()` 实现（该列本来就有 `.highlight` class，不必加 `data-col` 脚本）。
- **W2 README**：新增 `## 🧭 工作原理` 四步（目录同步加锚点）；功能演示从 8 段纵向 `<p align="center">` 改成 4 行 × 2 列 `<table>`（图片路径 / alt / 说明文字一字未改，只换排布）（快照：该排布已被 R2 撤回，HEAD 现状是一行一张 + 点看原图，见上一节）；快捷键速查表收进 `<details>`。中英文两份表达同一事实，非逐字互译。

### 没做什么（以及为什么）

- **不抄两个参考页的 `<span lang>` 双语同屏写法**：本仓 `index.html` 是 `en.html` 的唯一事实来源，`apply-i18n.mjs` 只替换 `data-i18n` 节点内容并 `escapeHtml`，`assertI18nCoverage` 缺英文即抛错——把中文写进属性或让一个节点同时挂两种语言会直接打断生成链。
- **不写「0 网络请求」**：Transfer Any File 可以说，本扩展有每 6 小时一次的匿名版本检查（`UPDATE_CHECK_INTERVAL_MINUTES = 360`），只能用「无账号、无同步服务器」/「密码数据不出本机」。
- **不把图标移到 H1 之上**：GitHub 移动端的 SEO 与首屏都以 H1 优先，参考页是无 H1 语义要求的纯静态页。
- **只收纳快捷键表**：功能全览 / FAQ / 许可证是决策内容不是次要细节，保持可见。

### 口径变更：落地页允许使用 JS

用户 2026-09-25 明确「只要不影响 SEO 效果的地方都可以用 JS，比如增加动效」。核验过 Google 官方 JavaScript SEO 文档：「Google 使用 Chromium 运行 JavaScript」「并非所有漫游器都能运行 JavaScript。」「依然建议您采取服务器端渲染或预渲染」——所以用 JS **不会**被扣排名，此前把「零 JS」当硬约束是过强的前提。新口径是：**动效与计数器可以用 JS**，但三条降级不许撤——隐藏初始态挂 `html.js`、可见正文留一条无 JS 可读路径（静态 HTML 或 `<noscript>`；FAQ 列表自 2026-09-27 起改为构建期从 `FAQS` 注入静态 DOM、脚本只绑交互，原先手工维护的 9 条 `<noscript>` 节选随之删除）、缺 `IntersectionObserver` 落终态。唯一仍然禁止的方向是把正文从静态 HTML 挪进 JS。据此给数据带六个数字加了滚动（`countUp`，900ms cubic ease-out，由既有 reveal 观察器触发、`reduce` 下不滚、终值取节点自身写死的数，不新增第二处魔法值）。

### 顺带修掉的既有缺陷

- 数据带的破折号动画选择器写成 `html.js .metric.visible i::after`，而 `.reveal` 挂在 `.metrics-inner` 上——该状态永不可达，破折号在任何有 JS 的访问里都是 `scaleX(0)`（看不见）。已改为父子形式。
- 工作原理带 4 张卡放进 3 列网格导致孤行，且注释写「六步」、留着两条永不匹配的 `nth-child(5)/(6)`；一并修正为 4 列并删死规则。
- 我本轮先写的两条死 CSS（`section:target > .container > h2` 只有 `<noscript>` 段能命中、`.faq-item:target` 那 41 个注入项根本无 `id`）在实测后删除而不是上线。
- 新带 CSS 原先写在 `@media` Responsive 之后，同特异性下把全仓响应式覆盖都吃掉了（390px 仍是 6 列）；整块 211 行移到 Responsive 之前，实测 390 → 2/1/1、900 → 3/2/1。
- `en.html` 在 390px 有 42px 横向溢出，元凶是我自己新写的隐私带 `P.more-links > A`（对比表的 `overflow-x:auto` 溢出是 HEAD 就有的合法行为）；`.more-links` 改 `flex-wrap: wrap` 后溢出为 0。
- 文案合规漂移：静态兜底文本写「数据不出本机」，词库写「密码数据不出本机」——统一为后者，并建了 zh→en→zh 回环漂移检测（156 节点，0 漂移）。

## 🆕 2026-09-25 站外双名 + 同作者互推 + 新鲜度收口（未提交）

用户批准口径四条：**① 同作者插件链接只进产品页与 README，商店六个粘贴块一字不动；② 插件名（manifest / 商店中英文 Name）不动，只统一站外双名口径；③ 版本口径 GitHub 写 3.12.0、商店写 3.11.0；④ GitHub 仓库元数据只更新文档候选，写操作由用户自己执行。**运行时代码与扩展产物零改动，只动官网静态页、生成脚本与文档表面。

### 改了什么

- **双名口径收口**：站外实体名统一为 `账号密码管理助手 Account Password Helper`。`index.html` 的 `og:site_name` / `WebSite.name` 用双名串，`SoftwareApplication` 改为 `name` = 本页语言主名 + `alternateName` = 另一语言名，`scripts/build-en-page.mjs` 里做镜像对调（英文页 `name` = Account Password Helper）。`llms.txt` H1 补中文名，`README.en.md` H1 补中文名。
- **SERP 长度**：`meta.title.en` 65 → **60** 单位、`meta.description.en` 168 → **155**、中文描述 95 字（宽 ≈170）→ **86 字（宽 ≈154）**；中文 title 保持不动（36 字 / 宽 ≈59，再扩词会在搜索结果里被截断，这条是对上一轮建议的修正）。
- **同作者互推**：`index.html` 的 `#more` 区块给跨域代理助手补上商店链接、网格下加「作者的其余开源作品」→ `github.com/liaolongdong`，footer 新增「作者的其他插件」锚点；`compare.html` / `compare.en.html`（手维护两份）、`pricing.html`（→ `gen:pricing-en`）、博客 12 页模板（→ `gen:blog`）、`llms.txt` 新增 `## More by this author`、两份 README 补作者主页链接。**英文面的跨域代理助手指 `/en.html`，Transfer Any File 一律指基础 URL——它的英文页实测 404**，`build-en-page.mjs` 里为此加了一条 `replaceEvery`。
- **新鲜度**：测试数 1337 / 119 → **1563 / 142**（2026-09-25 `pnpm test:run` 实测，README ×2、`llms.txt`、博客 6 处正文、`imgs/blog-covers/` 大纲与 04 / 05 两张 SVG，并已 `pnpm covers:render 04 05` 重出 PNG）；`llms.txt` 的「八维度 / 8 dimensions」→ **十维度 / 10 dimensions**（`compare.html` 自述口径）；`index.html` JSON-LD `softwareVersion` 3.9.0 → **3.12.0**、`dateModified` → **2026-09-25**、页脚版本串同步；`sitemap.xml` 18 条 `lastmod` → 2026-09-25（`privacy.html` / `privacy.en.html` 本轮未改，保持 2026-09-22）；`docs/store/CWS_FILL_CONTENT.md` 第一步的 zip 版本与「商店线上 3.11.0」状态段（旧段落里的 3.7.0 / 3.9.0 已标注为驳回史快照）。
- **GitHub 仓库元数据**：见下面「🔴 待你执行」§6 的最终候选与两条 curl——三版候选作废，改为单一 343 UTF-16 版本，并把长度口径钉死为 UTF-16 code unit。

### 没做什么（以及为什么）

- 商店六个粘贴块（Name / 摘要 / 中英说明 / 权限说明 / Featured）与 FAQ 文案一字未动：FAQ 与页面可见内容受 `tests/docs/faqSchemaParity.test.ts` 逐字约束，商店字段是第七次修订后的过审版本。
- `privacy.html` 不加互推（法务页），`docs/operations/公众号-*` / `docs/operations/微博-*` 正文只刷新测试数、不改写卖点（这两份的「事实基线 v3.9.0」行仍标 v3.9.0：**整篇主张未逐条重审，单独把版本号抬到 3.12.0 会变成未经核验的承诺**；需要发布时先整篇过一遍再改基线）。
- `blog/*.html`、`en.html`、`pricing.en.html` 全部走脚本重生成，未手改生成物。
- 博客 frontmatter 的 `author: liaolongdong` 与站内署名口径（廖小新 / Better）仍不一致，留作待你拍板项。

### 验证

`pnpm gen:en`（data-i18n 125/125、data-i18n-html 5/5；快照：`d596fb4` 起是 **230/230 与 14/14**，本轮新增板块带去了 105 个 `data-i18n` 节点与 9 个 `data-i18n-html` 节点）、`pnpm gen:pricing-en`（107/107、12/12）、`pnpm gen:blog`（12 files）、`pnpm covers:render 04 05` 均成功；`pnpm exec prettier --check` 覆盖本轮改动的人类维护文件全绿（生成物与 `.txt` / `.xml` 无 parser，按既有口径排除）；`pnpm test:run` 1563 例全绿。

## 🆕 2026-09-22 文档刷新波次（本轮，未提交）

用户批准的四个批次：**A 事实纠错 + 时效刷新**、**B 缺失功能回灌**、**C compare / pricing 矩阵补齐**、**D GitHub 仓库元数据**；商店侧追加「只扩说明正文，摘要与 Name 不动」，博客侧追加「新增一篇 + 刷新旧文时效」。**只动文档与官网表面，运行时代码零改动。**

### 统一事实库（逐条对代码核验后，所有表面共用同一份）

| 事实                                                                                                                                | 出处                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 跨子域名匹配三档（`off` / `wildcard` / `sameMainDomain`），默认 `off`；侧边栏与内联下拉共用 `resolveMatchTier` 的分层判据与同一排序 | `utils/domain.ts`、`utils/storage/configManager.ts:416`、`utils/passwordFilter.ts`                                                                        |
| **自动保存的判重口径不随档位放宽**（不是「按精确主机判重」，而是与档位无关的既有规则：同用户名 + 相同域名或父子域）                 | `entrypoints/background/passwordCache.ts` 的 `findMatchingEntry`、`utils/storage/passwordCrud.ts:516-523`、`entrypoints/content/SavePasswordPrompt.ts:93` |
| 命令面板 23 条命令、仅 Options 页、`isAuthenticated` 之后才响应                                                                     | `composables/useCommandPalette.ts`、`entrypoints/options/App.vue:953-1115`                                                                                |
| 站点规则上限 500 条 / 单文件 2 MiB，明文 JSON 只含域名与选择器，导入按域名合并并回报新增·更新·忽略，只穿透开放 Shadow DOM           | `utils/siteRulesTransfer.ts`                                                                                                                              |
| 泄露词库 `top1000.json` 实测 999 条 / 去重后 989 条                                                                                 | `utils/data/top1000.json`                                                                                                                                 |
| 后台保活心跳约 20 秒 + 0.5 分钟复活闹钟                                                                                             | `entrypoints/background/backgroundServices.ts`                                                                                                            |
| manifest 权限 12 项 + `<all_urls>`                                                                                                  | `wxt.config.ts`                                                                                                                                           |
| 自动化测试 **1292 用例 / 114 文件**（2026-09-22 21:35 `pnpm test:run`，全绿）                                                       | 见「测试基线」行                                                                                                                                          |

### 改了哪些表面

- **A 时效与纠错**：`llms.txt`（`Last updated` 2026-09-22、`Latest release` v3.11.0 / 2026-09-15、`Quality` 行、FAQ 判重口径）、`README.md` / `README.en.md`（末尾时间戳行改为「以当前开发分支的最新实现为准」，此前那句「功能对应最新已发布版本」在本地分支上不成立）、`sitemap.xml` 8 条非博客条目 `lastmod`、`index.html` `dateModified`、`privacy.html` 保活口径（每 20 秒）与「最后更新」日期。
- **B 功能回灌**：身份信息库、站点规则、跨子域三档、命令面板四项在 README / `index.html`（功能卡 `f13` `f14`、FAQ 两条、`featureList`、compare 行）/ `privacy.html`（站点规则导出条目，中英各一条）/ `docs/CONTRIBUTING.md`（命令面板说明）/ `llms.txt` / `docs/store/CWS_FILL_CONTENT.md` 六处对齐；侧边栏 `help.json` 词条已由跨子域波次落地（`help.gb.12` / `help.gb.13` / `help.gc.6` / `help.gd.9`），本轮只做口径核对。
- **C 矩阵**：`compare.html` / `compare.en.html` 各 3 处、`pricing.html` 中英各补站点规则一行，判重口径同步更正。
- **D GitHub 元数据**：见「🔴 待你执行」第 6 项，线上 About 与 topics 已按 2026-09-22 实测值重拟。
- **商店说明（十次修订）**：`docs/store/CWS_FILL_CONTENT.md` 中文 **4951 → 5315**、英文 **14830 → 15622** 字符，三处中文 / 三处英文回填（跨子域档位进【为什么选择它】、站点规则进【功能全览】、命令面板进【界面与快捷键】）；**Name 30 / 42、摘要 131 / 130 逐字未动**；自检 `paste blocks: 6 | banned hits: none`、中英重复行均为零。**英文侧只剩 378 字符余量**，后续再回填必须先减英文或改中文。
- **博客**：新增第 5 篇《同一站点的账号该出现在哪些子域》（中英 `docs/blog/{zh,en}/05-*.md` + `pnpm gen:blog` 生成的 `blog/05-*.html` + `imgs/blog-cover-05-*.png`），旧四篇按 2026-09-22 口径刷新时效与测试数量并重跑 `pnpm gen:blog`；封面 04 的「632 项自动化测试」是历史遗留，本轮随 `pnpm covers:render 04 05` 一并更正。
- **生成产物**：`en.html`（`pnpm gen:en`）、`privacy.en.html`（`pnpm gen:privacy-en`）、`pricing.en.html`、`blog/*.html`、FAQ JSON-LD（`pnpm gen:faq`）全部由脚本重生成，未手改。

### 本轮刻意没做

- `docs/ARCHITECTURE.md` 与 `.en.md` **未动**：与本仓库并行的性能波次正在改这两个文件，避免互相覆盖；「功能实现详解」一节的四项回补留给该波次合并后单独执行。
- 商店文案**没有粘贴进 Dashboard**，也没有提交、推送、发布（需用户授权）。
- `tests/content/inlineFillDropdown.keyboard.test.ts` 等 7 个**并行波次尚未提交的测试**未做任何修改：本轮中途它因 jsdom 缺 `Element.scrollIntoView` 红过一次（属对方在飞的文件），最终一轮 `pnpm test:run` 已 114 文件 / 1292 用例全绿；越界改动只会与对方冲突。

## 🆕 2026-09-22 / 09-24 商店说明两次追加修订

- **十一修订（2026-09-22，内联下拉与侧边栏口径对齐）**：中文 **5315 → 5344**、英文 **15622 → 15739** 字符，两处都挂在已有小节的已有行上；输入法合成期不接管按键**不写进商店说明**。逐条依据见 `docs/store/CWS_FILL_CONTENT.md`「第二步 → 摘要」的十一修订批注，口径背景见 `docs/reports/INLINE_DROPDOWN_PARITY_EVALUATION.md` §9.4。
- **十二修订（2026-09-24，容量上限与列表分页）**：中文 **5344 → 5560** 字符，**英文逐字未动**。分页并入【功能全览】既有的「智能搜索与整理」一行，条目总量上限 2000 条在【常见问题】单列一条问答（含被拒绝的五个写入口与「回收站不占额度」）——这是商店侧**首次披露该上限**，此前只存在于 README 与 `docs/ARCHITECTURE.md`。Name 30 / 42、摘要 131 / 130 逐字未动。自检 `paste blocks: 6 | banned hits: none`、中英说明跨小节重复行均为零。
- ⚠️ **英文侧预算已耗尽**：余量从十次的 378 收窄到十一轮的 **约 261 字符**，本轮中文 +216 若同口径翻成英文约需 450~520 字符，**放不进**。因此中英说明目前**故意不一致**（英文缺分页与容量上限两条），下一轮要么先删英文已有内容，要么接受继续在中文侧扩写。这不是遗漏，不要在复核时当成口径漂移"顺手补齐"。

## 🟡 商店驳回与修正（2026-09-10）

**驳回事实**：2026-09-09，3.8.0 草稿被判 Spam 政策「产品说明中有过多关键字」（keyword stuffing），被点名文本 `Chrome, LastPass, Bitwarden, and 1Password (CSV/JSON formats`。旧草稿已关闭 → 只能在 Developer Dashboard **新建草稿**重新提交；线上商店仍为 **3.7.0**。

**诊断出的三处叠加缺陷**（不是单一句话的问题，逐条都已修）：

| #   | 缺陷                                                                                                                                                                                     | 修法                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 竞品品牌名当关键词用：Summary（随 manifest 打包）1 处、中/英 Description 各 3 处                                                                                                         | 商店四个字段（Name / 摘要 / 说明 / 权限说明）品牌名清零，改说「自动识别主流密码管理器导出表格的字段」；扩展内导入向导 UI 保留品牌名（用户需要知道能导什么）                                                                                                                                                                         |
| 2   | 同一个卖点在【为什么选择它】【适合谁】【安全架构】【功能全览】【常见问题】之间互相复制，是「堆砌」的结构特征                                                                             | **小节结构保留，改为「一个卖点只有一个归属小节」**：一键登录与多环境隔离只在【为什么选择它】、会话有效期与自动锁定只在【适合谁】、算法与参数只在【安全架构】、入口清单与强度检测 / 显隐切换 / 迁移导入只在【功能全览】、联网/性能/权限口径只在【常见问题】；英文侧同结构。砍掉整节不是修法（2026-09-10 二次修订，见下）             |
| 3   | 摘要用逗号串 6–8 个关键词（`Open-source local password manager: one-click login, per-field AES-256-GCM, TOTP 2FA, audit, generator. No uploads, no sign-up.`），且含无法核实的绝对化表述 | 句式改为**完整句子、功能项挂在谓语下**（中文「含……」/ 英文 `with …`），132 额度用到**中 131 / 英 130 字符**；品类词只出现一次、竞品名零次；`AES-256-GCM` 按用户要求写回摘要（正文里不完整的「AES-256」一并更正），`PBKDF2` 迭代次数仍只出现在【安全架构】；同日第三次修订把 TOTP / 密码强度检测 / 迁移导入 / 显隐切换补进摘要与说明 |

**删除量与商店搜索影响（2026-09-10 逐词复核，同日二次 / 三 / 四次修订）**：上一轮把说明压到中文 1434 / 英文 4214 字符（原始 2783 / 6651，上限 16000），用户判定收缩过度。逐词 diff 的结论是**该删的是违规与重复，不该删的是覆盖**：

| 事实                                                                                     | 对 CWS 排序的影响                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name 在前四次修订逐字未动**（中/英各一个）                                             | 商店排名的第一权重位在 Name；前四轮都没有碰它，避免动摇已积累的检索权重。六次修订仅在**已获批后缀之后**追加「自动填充」（中文 20 → **25 / 45** 字符），品类词与既有结构不变，英文 Name 维持 42 / 45                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 减量主体是同一卖点在 4 个段落之间的复制                                                  | 检索按词命中，同一词写 4 遍不会排 4 次；重复只构成堆砌判定的证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 真正消失的只有被点名的竞品品牌名（各表面共 7 处）                                        | 政策硬性禁止，属必须删；已迁移到 README / `compare.html` / 博客 / GitHub Topics 等商店之外的表面继续取词                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 只出现一次的功能词，diff 出的 12 个中文、18 个英文                                       | 逐个回填到对应功能条目，每词全篇只出现一次（详见 `CWS_FILL_CONTENT.md` 第二步「✂️ 删减只针对违规本身」）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 二次修订：【为什么选择它】【适合谁】【安全架构】【常见问题】四节全部恢复                 | 说明回到中文 **2156** / 英文 **6300** 字符（上限 16000，仍有大量余量），长尾词面随之恢复；去重靠小节归属而非删篇幅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 三次修订：补「两步验证（TOTP）/ 密码强度检测 / 密码可见性切换 / 主流密码管理器迁移导入」 | 说明再增至中文 **2226** / 英文 **6530** 字符；四项按代码事实写实（TOTP 列随导入表头自动识别、四条强度规则评为弱中强、可见性开关默认关闭、`detectFormat()` 识别导出表格字段），品牌名仍为零                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 四次修订（评审回填三项）：选中导出 / TOTP 独立条目 / 免费与迁移问答                      | 说明增至中文 **2380** / 英文 **6961** 字符；机制与价值分节——扫码 / RFC 6238 / 活码归【功能全览】，不必摸手机 / 不切验证器归【为什么选择它】；免费问答只谈付费事实、迁移问答只谈操作路径，与【为什么选择它】【功能全览】【适合谁】零重复句                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 五次修订（2026-09-11，SEO/ASO 复核）                                                     | 说明变为中文 **2634** / 英文 **7743** 字符。驳回三处与实现不符的候选表述（快捷键自动登录 / EFF 助记词 / 五维检测），回填六处已验证事实（存储只用 local 与 session、改主密码原子重加密、生成器可排除易混淆字符、TOTP 可自定义算法与位数、主密码框大写锁定提示、换设备用 .aph 备份还原），并把「多环境账号隔离」「保存密码」两个检索词写回正文；自检 `banned hits: none`、重复行扫描为零                                                                                                                                                                                                                                                                                                                                                                                    |
| 六次修订（2026-09-12，深度优化 + 曝光复核）                                              | 说明增至中文 **3293** / 英文 **9504** 字符；中文 Name 追加「自动填充」（25 / 45），`extensionName` 同步以保证构建产物与商店逐字一致。更正最后一处过度表述：快捷键是否提交表单取决于「自动触发登录」开关（`entrypoints/content/FormDetector.ts` 判定 `data.autoLogin \|\| autoTriggerLogin`）；三处不可证伪的绝对化表述改为可核实口径（泄露词表「近千条」、侧边栏速度改为「按 1 秒内出界面调优」、浏览器要求写 Chromium 114 的 Side Panel API）；回填九处此前未覆盖的真实能力（页面悬浮填充按钮及其吸附与透明度调节、键盘全流程、工具栏 Popup 操作中枢、生成器右键「生成并填充」、标签与收藏置顶上限、回收站 30 天、历史快照 1~10 份、TOTP 6/7/8 位、剪贴板 5 档时长），并新增「浏览器版本要求」「填充没生效怎么办」两条问答；自检仍为 `banned hits: none`、跨小节重复行零 |

摘要字段同步扩写：中文 **57 → 121 → 127 → 131 字符**、英文 **129 → 130 → 129 → 130 字符**（上限 132；末跳把 `strength audit` 换成不与安全体检撞词的 `strength checks`），把自动填充并一键登录、两步验证（TOTP）、密码强度检测、安全体检、密码生成器、显隐切换、多环境账号隔离、主流密码管理器迁移导入、中英双语、AES-256-GCM 一次排进一句读得通的话；英文密度低、装不下「show or hide」，该特性由说明的 FEATURE SET 承担。`public/_locales/{zh_CN,en}/messages.json` 的 `extensionDescription` 与商店摘要保持逐字一致。

**本轮改动的文件**：
`public/_locales/{zh_CN,en}/messages.json`（新的 `extensionDescription`）；`docs/store/CWS_FILL_CONTENT.md`（第一步驳回说明与「新建草稿 / 版本同号会被拒」两个坑、第二/三步四个字段全部重写、第三步图形资产口径、7.2/7.3 提名文案去品牌、7.4 新增两条口径、上传前检查清单新增四项）；`docs/store/CWS_PUBLISHING_GUIDE.md`（第二步口径与字符数、第四步「新建草稿」+ 第 4 条驳回原因、事实口径表按表面拆分、附录兜底模板去术语化、**新增粘贴前自检脚本**）；`docs/operations/账号密码管理助手曝光提升执行手册.md`（第二章删去 71 行重复正文与 6 处品牌名、§2.5 关键词策略改口、§2.6 修正 `webNavigation` 说明、§2.7 截图与宣传图口径、§2.8 八步操作、§3.1 状态行）。

**同日二次修订（用户判定收缩过度）**：`public/_locales/{zh_CN,en}/messages.json` 摘要扩写至 121 / 130 字符并按用户要求写回 `AES-256-GCM`；`docs/store/CWS_FILL_CONTENT.md` 恢复【为什么选择它】【适合谁】【安全架构】【常见问题】四节（说明 1434 → 2156 中文字符、4214 → 6300 英文字符），🚫 / ✂️ 两条口径与上传前检查清单随之改写；`docs/store/CWS_PUBLISHING_GUIDE.md` 自检脚本的禁词表移出 `AES-256-GCM` / `PBKDF2`、新增**说明内重复行扫描**；`docs/operations/账号密码管理助手曝光提升执行手册.md` §2.2 / §2.3-2.4 / §2.7 / §2.8 同步；`imgs/store-creatives/small-promo{-en,}-440x280.svg` 与两张 PNG 重排为单栏四行（用户判定旧版「太拥挤」）。

**同日三次修订（用户要求补齐核心优势覆盖）**：`public/_locales/{zh_CN,en}/messages.json` 摘要再增至 131 / 130 字符，覆盖两步验证（TOTP/2FA）、密码强度检测、显隐切换、主流密码管理器迁移导入；`docs/store/CWS_FILL_CONTENT.md` 在【功能全览】新增「密码强度检测」条目（`utils/passwordStrengthCore.ts` 的四条规则评为弱 / 中 / 强），「密码显隐切换」改用产品设置里的正式名称「密码可见性切换」并注明默认关闭，导入条目写实为「自动识别主流密码管理器导出表格的字段（含两步验证密钥列）」（`utils/excelFormatMap.ts` 的 4 套列映射 + `detectFormat()`），并把导入兼容性从【适合谁】移交给【功能全览】唯一展开；英文侧同结构，且英文摘要用 `strength checks` 而不是 `strength audit`，避开【功能全览】安全体检已占用的 `audit`。`docs/operations/账号密码管理助手曝光提升执行手册.md` §2.2 / §2.5 同步，竞品词禁令收窄为「品牌名本身与品牌名 + alternative / migrate from 的组合」，不含品牌名的 `migration` / `迁移导入` 明确允许。顺带修掉 `CWS_FILL_CONTENT.md` 检查清单里「被拒后必须新建商品」的错误指引（正确做法是在已有商品上传新包生成新草稿，新建商品会产生第二个重复商品）。

**同日评审微调（两处）**：① 中文摘要的两步验证按评审意见写作 **「两步验证（TOTP/2FA）」**（131 字符，上限 132；「两步验证」是中文侧真实检索词，故保留而非替换成裸的 `TOTP 2FA`）；② 评审追问【适合谁】「正在搬家的人」为何被缩短——去重该删的只是与【功能全览】重复的「自动识别导出格式」表述，**「从其他密码管理器换过来 / switch from another password manager」不含品牌名且是高意图长尾词，已回填**，说明随之为中文 **2226** / 英文 **6530** 字符。教训与二次修订同源：跨小节去重只删重复的那半句，带检索价值的通用词必须留在自己那半句里。

**同日四次修订（三项评审意见回填）**：评审在说明上留了三处批注，逐条落实且不越过违规边界——① **「增加 支持选中导出」**→ 【功能全览】「导入与导出」写入「可整库导出，也可勾选条目批量导出选中项」，依据 `composables/usePasswordManagement.ts` 的 `batchExportSelected()`（按 `selectedIds` 过滤后复用主密码校验 + 带日期后缀文件名的同一条导出路径；选中导出只有 CSV，故句子只说"选中项"不写格式，格式枚举仍由前面半句承担）；② **「TOTP 两步验证为什么不保留？」**→ 把 TOTP 从【为什么选择它】的复合句里拆成两处：「两步验证（TOTP）」回【功能全览】独立成条，承载全部机制（扫码 / 上传图片添加密钥、RFC 6238 本地计算、不联网不上传、活码可就近一键填入；依据 `utils/totp.ts`、`utils/qrScanner.ts`、`entrypoints/content/inlineDropdown/TotpHandoffCapsule.ts` 的"点胶囊复制 / 点填入落值"），【为什么选择它】只留价值句（不必摸手机、不必切验证器、一个条目两样都齐）；③ **「这条特别关键的核心卖点为什么不保留？」**→ 【常见问题】回填「真的完全免费吗？」与「能从其他密码管理器导入吗？」两条，句形与各节错开：免费只讲付费相关事实（没有高级版、没有内购、没有升级弹窗），GPL-3.0 与源码可审计仍只归【为什么选择它】；迁移只讲操作路径（原应用导出 CSV 或 JSON → 导入页上传），字段自动识别仍只归【功能全览】、「整库一次导入」仍只归【适合谁】。说明长度中文 **2226 → 2380**、英文 **6530 → 6961**（上限 16000），自检脚本实测 `banned hits: none`、重复行扫描为零、摘要（131 / 130）与 Name 均未动。三次评审意见的共同指向是**覆盖优先于精简**：合规只禁止表达方式（品牌名、同句重复），不禁止事实本身，被点名的卖点必须换个句形回填而不是删掉。

**同日七次修订（额度补满 + 事实回填）**：中文 Name 追加「及两步验证」，**25 → 30 / 45 字符**；英文 Name 经实测**无法补到 45**（42 / 45 只剩 3 字符，`Autofill` 需 9、`& TOTP` 需 6，唯一填满方式是丢掉品类词 `Password Manager`，用最高权重词换一个次级词不划算），保持 42。说明按小节归属继续扩写：中文 **3293 → 4638**、英文 **9504 → 13870** 字符（上限 16,000，英文侧余量已收窄至约 2,100）。本轮真正的过审风险修复是**商店元数据里的三处不实表述**：① 声称存在「扩展内改键页」（实际 `ShortcutSettingDialog.vue` 是只读一览，`commands` API 无 `update()`）；② 把版本检查写成「只读自身版本号」（实际先发 `no-cors` HEAD 探测商店可达性、缓存 24 小时，不可达才 `fetch` GitHub Releases 并读最多 200 字 `body`）；③ 权限问答与 manifest 的 12 项权限 + `<all_urls>` 不对齐、回避了审核最盯的那一项。随之在本轮一并校正四处与代码不符的旧口径（**事实纠错，未回填商店文案**）：`localhost` 是**按端口过滤**而非「默认匹配全部」（`docs/ARCHITECTURE{,.en}.md`、`README{,.en}.md`、`help.gb.4` 中英文、`llms.txt`、`utils/domain.ts` JSDoc）、SessionManager 的 60 秒轮询只在 Options 页且只在有效→无效跳变触发（可见性重检属 `useStorageWatcher`）、`passwordCache.ts` 残留 2026-07 之前的双向包含匹配注释、`optionsPageManager.ts` 误称 manifest 已声明 `minimum_chrome_version`（该项在 `wxt.config.ts:92` 是注释掉的）。`docs/blog/**`、`blog/*.html`、`docs/operations/公众号-*.md`、`docs/operations/微博-*.md` 里同样的「localhost 放行全部」写法属已发布内容，**有意未动**，需重发才改。五、六次的逐条账见 `docs/store/CWS_FILL_CONTENT.md` 的 📌 块。

**商店图片（图片里的文字同属商店元数据）**：`assets/cws-store/` 的 Marquee 与小推广图已重绘为**中英文各一张、共四张**（`marquee-1400x560.png` / `marquee-en-1400x560.png` / `small-promo-440x280.png` / `small-promo-en-440x280.png`）——Dashboard 的图形资产槽位按语言标签页独立，English (United States) 页不会继承中文页的图。旧图烧着「数据零网络传输，密码不出浏览器」（与每 6 小时一次的匿名版本检查矛盾）和「开源免费 · MIT License」（许可证写错，实为 GPL-3.0）；本轮同时修正图标语义（开源卡此前误用挂锁 / 眼睛，现为尖括号，与加密卡不再重复）。现在四张图都有矢量源 `imgs/store-creatives/*.svg` + `scripts/render-store-creatives.mjs`（`pnpm store-creatives:render`，按文件名校验像素尺寸）。顺带把 `imgs/blog-covers/blog-cover-01-local-first.svg` 的「数据不出浏览器」限定为「密码数据不出浏览器」并重渲染。

**刻意保留、未改动的部分**：

- 英文商店 **Name 保持原样**（42 / 45，只剩 3 字符，见上）；中/英**摘要**自三次修订起未再动过（131 / 130，上限 132）。中文 Name 的两次追加（六次「与自动填充」、七次「及两步验证」）走的是「只接已获批后缀、不重排不改写」的低风险路径，`git log` 显示带副标题的名称自 v3.6.0 起多次通过审核。
- 类别 Productivity、默认语言中文 + 追加 English (United States)、隐私政策 URL、公开分发 —— 均未变。
- 事实口径未缩水：逐字段加密 5 个字段、4 个计分维度、`Ctrl+Shift+F` 默认只填充与勾选（是否代为点击登录取决于「自动触发登录」偏好）、匿名版本检查（每 6 小时）等仍如实披露，去掉的只有绝对化表述与竞品品牌名，用户可核对的加密事实（AES-256-GCM、PBKDF2 600,000 次迭代）按小节归属保留。5 个字段还从笼统的「敏感内容」改成了按名列出（账号、密码、网址、备注、两步验证码，与 `utils/storage/passwordCrud.ts` 的 `SENSITIVE_FIELDS` 一致）。

**残留风险与对策**：说明正文的长尾词面已按上表回填恢复，残留收窄只剩两处——① 摘要按政策要求写成**一句读得通的话**而不是关键词列表，132 额度已用满（131 / 130），但「过多关键字」的最终裁量在人工审核，若二次驳回需继续缩减功能枚举——削减顺序（中文逆序、英文先砍 `with` 后的清单尾巴）已写在 `CWS_FILL_CONTENT.md`「第二步 → 摘要」的 🔻 条目，砍下的词说明里都已有归属小节，不丢覆盖；② 竞品品牌词在商店四个字段里清零。对策是把品牌词与长尾词放到商店之外的表面（README、`compare.html`、博客、GitHub Topics、Show HN / Reddit，手册 §2.5 已列明），并靠 `CWS_PUBLISHING_GUIDE.md`「快速校验命令」里的自检脚本（实测 `paste blocks: 6 | banned hits: none`、`duplicate lines in zh/en description: none`，且中/英 Name、摘要与 manifest 逐字一致）防止后续再飘回品牌名或跨节抄写。图片侧仍有两处待办：① **12 张产品截图是 v2.12.0 旧版**，`01-master-password.png` 还带着已删除的「严禁……后果自负」声明，需用当前构建重截；② **博客仓库的对比信息图 `assets/img/account-password-helper/02-comparison-tools.png` 仍写着 MIT**（本扩展仓库没有 `assets/img/` 目录，见下文第 3 项）。

## 🔴 待你执行（我未擅自操作，原因见括号）

### 1. 【最高优先】把本轮文档修正送上线（旧的「main 落后」问题已解决）

✅ 9-06 记录的阻塞已不存在，且 `origin/main` 又往前走了两个版本：release-please 已连发 **v3.8.0 → v3.11.0**（**v3.11.0 发布于 2026-09-15，是线上最新**；v3.10.0 = 2026-09-13）。2026-09-22 实测 `git fetch origin && git rev-list --left-right --count origin/main...HEAD` = **`6 / 42`**——`main` 有 6 个提交本地没有，`feature-opt` 有 42 个提交未合入。

🔴 现在真正卡住曝光的是**本轮文档修正（连同 09-16 之后的功能波次）仍未提交**：`README*.md`、`docs/*`、`index.html` / `en.html` / `pricing*.html` / `privacy*.html` / `compare*.html`、`sitemap.xml`、`llms.txt`、`blog/*`、`imgs/blog-covers/*` 与生成脚本的改动全部躺在 `feature-opt` 工作区。⚠️ **同一个工作区还混着并行的性能波次**（`benchmarks/`、`components/options/PasswordTable.vue`、`composables/*`、`utils/searchMatch.ts`、`utils/tagUtils.ts`、`docs/ARCHITECTURE.md(.en.md)`、6 个未跟踪测试文件等），提交时必须**按文件挑选**，不能 `git add -A`。

- （提交 / 合并 / 推送 `main` 不可逆且会触发 Pages 与商店自动发布，按惯例需你明确授权，我不擅自执行）
- 建议：先把 `feature-opt` 同步到 `main`（`pnpm auto-merge` 或 rebase，本地 `package.json` 会跟随到 3.11.x）→ 分两批提交（文档波次 / 性能波次各一批）→ 走 PR 合并 → 确认 Pages workflow 重新构建部署。
- ⚠️ 同步后按 `CWS_PUBLISHING_GUIDE.md`「其他同步约定」刷新版本与时间戳：本轮 `llms.txt` 的 `Latest release` 已按线上写 **v3.11.0（2026-09-15）**，而 `index.html` / `en.html` 的 `softwareVersion` 与页脚版本仍随本地 `package.json` = **3.9.0**（该字段的既定事实来源是 `package.json`，分支未同步前不该写更高的号）；合并后两者自然对齐，届时把 `README*.md` 末尾「以当前开发分支的最新实现为准」改回「对应最新已发布版本」。
- ⚠️ 身份信息库、站点规则、跨子域三档、命令面板**全部只存在于未发布的 `feature-opt`**：商店说明（十次修订）与官网新写的这些能力，在合入并发版之前**不要粘贴进 Dashboard**，否则商店描述会宣传线上跑不到的功能。

### 2. 博客导流文的事实修正（已改，待提交发布）

当前博客仓库 `_posts/2026-05-25-account-password-helper.md`、`_posts/2026-06-28-account-password-helper-new.md` 已把 **MIT → GPL-3.0**、旧"严禁/后果自负"安全声明 → 正向表述、"Google 应用商店后续待支持" → 已上架 Chrome 商店，**需提交并推送博客仓库**才会在线上生效。

### 3. 对比信息图仍写着 "MIT"（P1，需决策）

`assets/img/account-password-helper/02-comparison-tools.png` 图片里烧了 "MIT 开源·可审查"（`公众号-…md` 配图清单也已标注此坑）。⚠️ 该路径在**博客仓库**（`docs/公众号-…md` 第 10 行说明配图取自「博客 `assets/img/account-password-helper/`」），**本扩展仓库没有 `assets/img/` 目录**——本地只有 `assets/illustrations/`、`assets/screenshots/`、`assets/cws-store/`。文字表格已改，但**图片未改**。

- 选项 A：从原设计源（Figma/生成 prompt）重新导出，把 MIT 改成 GPL-3.0（推荐，保真）。
- 选项 B：用 ImageGen 重绘——但中文信息图 AI 重绘易糊字，风险较高，需你确认再动手。

### 4. 【商店最高优先】重新提交草稿（被拒草稿已关闭，只能新建）

按顺序执行（下面命令由你在本地跑，我不代为提交或发布）：

1. **先同步分支、再构建**（顺序不能颠倒：本地 `package.json` 仍是 3.7.0，实测 `pnpm build` 出的是 `account-password-helper-3.7.0-chrome.zip`，与商店线上已发布版本同号，Dashboard 会拒绝上传）：
   ```bash
   git fetch origin && git rebase origin/main     # 或 git merge origin/main；origin/main 已由 release-please 发到 v3.9.0
   pnpm build                                     # 期望产物：.output/account-password-helper-3.9.0-chrome.zip
   ```
2. **粘贴前先跑自检**（`docs/store/CWS_PUBLISHING_GUIDE.md`「快速校验命令」末尾的脚本）：期望 `paste blocks: 6 | banned hits: none`，且中英 `extensionName` / `extensionDescription` 与「第二步」的粘贴块逐字一致、长度 ≤132。
3. 登录 [Developer Dashboard](https://chrome.google.com/webstore/devconsole) → 该扩展 → **新建草稿**，上传第 1 步的 zip（版本号取同步后的 **3.9.0**——只要大于线上 3.7.0 即可；若 Dashboard 拒绝该版本号，再到 `main` 上让 release-please 升一版）。
4. _store listing_ 文本一律从 `docs/store/CWS_FILL_CONTENT.md`「第二步」整段复制：中文 Name / 摘要 / 说明 + 英文 Name / 摘要 / 说明（该文件是唯一事实来源，**不要再从手册复制**）。
5. 图片：marquee 与小推广图**已重绘为合规版本**（`assets/cws-store/`，源在 `imgs/store-creatives/`），直接上传即可。**产品截图候选已扩到 14 张（`screen-1..14`）**，由 `scripts/store-shots/` 从占位演示页生成，画面全部是 `example.com` 数据、不含任何真实账号；英文页同一批 `capture` 换 `en` 参数跑，产出带 `-en` 后缀的同名文件。旧的 `assets/screenshots/01..12` 与 `assets/cws-store/01..08`（v2.12.0 真机图、含真实凭据）不再作为上传素材。
   ⚠️ **上传前逐张核对版本徽章**：徽章取自构建产物的 `manifest.version`。分支已同步 `origin/main`（`package.json` = **3.9.0**），**28 张（14 × 中英）于 2026-09-13 全新 profile 整批重截**，徽章统一为 **`v3.9.0`**——「截图版本与商店版本不符」是已知的驳回与信任风险点（图片里的文字同属商店元数据）。商店每语言页上限 5 张，按卖点排序取舍即可。
6. 隐私标签页：权限逐项说明（用「第二步 → 权限说明」原文，其中 `webNavigation` 的说法已按实测改为「仅枚举当前标签页框架，不监听导航」）、隐私政策 URL 与官网一致。
7. 提交审核，并在日历上记一次复盘：若再次被拒，把驳回文本原样补进 `CWS_PUBLISHING_GUIDE.md`「第四步 → 常见驳回原因」。

⏸️ Featured 提名（`CWS_FILL_CONTENT.md` 第七步 + 手册 3.3）请**推迟到本次草稿通过审核后**再做——表单每 6 个月只有一次机会，列表处于被拒状态时提交没有意义。

### 5. 站外分发"实际发出去"（导流主力，决定 star 增长）

文案已齐，缺的是**发布 + 守帖**：

- 中文：V2EX 分享创造、掘金/CSDN、知乎、**公众号**（`docs/operations/公众号-账号密码管理助手.md`）、**微博**（`docs/operations/微博-账号密码管理助手.md`）。
- 英文：Show HN（周二~周四 北京 21:00-23:00）、Product Hunt、Reddit（r/privacy、r/SideProject、r/chrome_extensions，先读版规）。
- awesome 列表 PR：awesome-chrome-extensions、awesome-privacy、awesome-security + 阮一峰周刊/HelloGitHub/GitHubDaily 投稿（PR 描述见手册 4.5）。

### 6. 运营动作

- 拆 3-5 个 `good first issue`（新手主题色/翻译/文档校对/兼容性反馈），配 Issue 模板。
- 商店评论 & GitHub Issue 48h 内回复；双周小版本维持"最近更新"活跃信号。
- 外部链接统一带 UTM（`?utm_source=xxx` / `?ref=xxx`），在 CWS Analytics 与 GitHub Insights 归因。
- **GitHub About（仓库描述）待替换**：2026-09-25 用 `curl --http1.1 https://api.github.com/repos/liaolongdong/account-password-helper` 复测，线上仍是旧版——2026-09-22 拟好的三版候选**从未执行**。旧版第二段写着 `zero cloud - passwords never leave your browser`，与商店文案 / `llms.txt` 已收口的口径冲突（扩展每 6 小时会发一次不携带用户数据的匿名版本检查，`utils/updateChecker.ts:71-98`，"never leave" 属无法自证的绝对化表述）；旧版结尾的 `本地账号密码管理助手` 也只出现中文名单独一项，与本波次收口的**站外双名口径 `账号密码管理助手 Account Password Helper`** 不一致。
  ⚠️ **长度口径先钉死，避免再算错**：GitHub 的 350 上限按 **UTF-16 code unit** 计（`🔐` 占 2、汉字各占 1），复算命令是 `node -e 'console.log(s.length)'`；本文更早版本标注的 343 / 341 是 **UTF-8 字节数**、345 是 **Unicode 码点数**，两者都不能与 350 直接比。线上旧版实测 **346 UTF-16 / 345 码点 / 368 字节**。

  **最终候选（343 UTF-16，距上限余 7）**——双名占开头 35 个 UTF-16 单位（`🔐 账号密码管理助手 Account Password Helper`），让中文检索与英文检索都命中，前 160 字符覆盖 Google 与 GitHub 搜索结果的可见摘要：

  ```text
  🔐 账号密码管理助手 Account Password Helper — open-source, local-first password manager Chrome extension (MV3, GPL-3.0): one-click autofill that ticks consent & clicks sign in, 3 cross-subdomain matching tiers, built-in TOTP, encrypted identity vault, offline security audit, per-field AES-256-GCM in chrome.storage.local — no account, no sync server.
  ```

  逐句对代码核验：`one-click autofill that ... clicks sign in` = `entrypoints/content/CheckboxHandler.ts` + `FormDetector.ts` 的 `autoLogin` 路径；`3 cross-subdomain matching tiers` = `utils/domain.ts` 的 `resolveMatchTier`（默认档仍是精确匹配）；`built-in TOTP` = `utils/totp.ts`；`encrypted identity vault` = `utils/identity/` + `components/options/IdentityVaultDialog.vue`（整库独立加密、仅 Options 可达、不进侧边栏）；`offline security audit` = 体检的 0-100 四维加权评分；`per-field AES-256-GCM in chrome.storage.local` = `utils/encryption.ts` 与存储层（从不用 `storage.sync`）；`no account, no sync server` 取代原来的绝对化说法；`GPL-3.0` 与 `package.json` 的 `license` 一致。**被挤掉的两项**（站点规则自定义选择器、命令面板）由 README / 官网 / `llms.txt` 承担；此前三个候选 A / B / C 作废——A 缺身份库与体检、B 缺跨子域三档、C 缺离线体检，且三版都只把中文名放在句尾。

  执行（`gh` 未安装，用 curl；把 `$GITHUB_TOKEN` 换成你的 PAT，需 `repo` 写权限）：

  ```bash
  curl -sS -X PATCH \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    https://api.github.com/repos/liaolongdong/account-password-helper \
    --data '{"description":"🔐 账号密码管理助手 Account Password Helper — open-source, local-first password manager Chrome extension (MV3, GPL-3.0): one-click autofill that ticks consent & clicks sign in, 3 cross-subdomain matching tiers, built-in TOTP, encrypted identity vault, offline security audit, per-field AES-256-GCM in chrome.storage.local — no account, no sync server."}'
  ```

  **topics：20 / 20 已满，换词必须先删一个**（2026-09-25 复测线上值与 2026-09-22 记录逐字相同：`2factor-authentication, aes-256-gcm-encryption, authenticator, auto-login, autofill-passwords, bitwarden, browser-extensions, chrome-extensions, credential-manager, developer-tools, local-first-auth, manifest-v3-chrome, multi-environment, offline, password-generator-web, password-managers, password-vault, password-visibility, privacy, totp-generator`）。建议做**四换**（四个新 slug 均已确认在 GitHub 上存在）：

  | 删                       | 理由                                           | 加                   | 理由                        |
  | ------------------------ | ---------------------------------------------- | -------------------- | --------------------------- |
  | `developer-tools`        | 与定位无关的超大桶，进来的流量不会要密码管理器 | `open-source`        | 高流量且与 GPL-3.0 定位一致 |
  | `browser-extensions`     | 复数形，订阅量远低于单数                       | `browser-extension`  | 同义但主流写法，直接换形    |
  | `password-generator-web` | 非标准词，几乎无人搜                           | `password-generator` | 标准 slug，功能真实存在     |
  | `password-visibility`    | 近零检索量                                     | `autofill`           | 覆盖核心卖点的高流量通用词  |

  `bitwarden` **保留**：商店四个字段禁竞品品牌名，GitHub 侧正是承接这批词的落点（`compare.html` 有对照表，属相关而非蹭词）。执行（PATCH topics 是**整体替换**，必须把最终 20 个一起发）：

  ```bash
  curl -sS -X PATCH \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    https://api.github.com/repos/liaolongdong/account-password-helper/topics \
    --data '{"names":["2factor-authentication","aes-256-gcm-encryption","authenticator","auto-login","autofill","autofill-passwords","bitwarden","browser-extension","chrome-extensions","credential-manager","local-first-auth","manifest-v3-chrome","multi-environment","offline","open-source","password-generator","password-managers","password-vault","privacy","totp-generator"]}'
  ```

  改完复核（一行同时给出 topics 数量与描述的 UTF-16 长度，口径与上面「长度口径」段一致）：

  ```bash
  curl -sS --http1.1 https://api.github.com/repos/liaolongdong/account-password-helper \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log(r.topics.length+' topics · desc UTF-16 '+r.description.length);console.log(r.description);})"
  ```

  `homepage` 已指向 GitHub Pages、Social Preview 已上传，均无需改。

### 7. 🔴【隐私 · 最高优先】仓库仍在公开含真实凭据的旧截图（需你决策，我不擅自删）

本轮把 README / 官网截图换成占位素材时逐张核对了旧素材，确认**两批历史截图与首屏 GIF 含真实账号数据**：

| 素材                                                  | 抽样所见（2026-09-12 逐张查看）                                                                                                                                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets/screenshots/01..12-*.png`（12 张）            | 真实 GitHub 用户名 `liaolongdong`、`924902324@qq.com` / `924902325@qq.com`、当时的 TOTP 活码、DeepSeek 登录页与微信登录二维码、开发态扩展 ID、`v2.12.0` / `v2.15.0` 旧版本角标                                 |
| `assets/cws-store/01..08-*.png`（8 张旧商店图）       | 与上表同源的真实演示库：`02-password-list.png` 首行即 `liaolongdong` + github.com 的 TOTP 活码 `970676`；`06-sidepanel-fill.png` 的自动保存弹窗里**密码以明文出现**（`123456qwerty`，账号 `924902325@qq.com`） |
| `docs/media/demo-login.{webp,gif,mp4}`（README 首屏） | 真实用户名输入在 `github.com/login` 页面上，并出现 TOTP 活码 `548365`。**2026-09-13：`.webp` / `.gif` 已被占位演示页重录覆盖，仅 `.mp4` 仍是旧真机录屏（未引用）**                                             |

**为什么算"公开"**：仓库本身是公开仓库，且 Pages 直接服务 `main` 分支根目录（Source = `Deploy from a branch`），因此这些图片即使没有任何页面引用，也能按 URL 直接取到并被爬虫/图床缓存；而线上商店列表当前挂的产品截图正是这批 v2.12.0 旧图（见本文「🟡 商店驳回与修正」的残留待办 ①、手册 §2.7「仍待处理」），同一批真实账号画面在 Chrome 应用商店也是公开的。README 与 `index.html` / `en.html` 的可见引用本轮已改到占位素材，但**文件本身仍在仓库与全部历史提交里**。

**风险定级**：TOTP 活码 30 秒滚动，单独不构成可用凭据；真正的问题是**把 GitHub 账号、邮箱、账号命名习惯与"该账号启用了两步验证"这一事实长期绑定公开**，以及那张明文密码截图（若 `123456qwerty` 仍是任何真实站点在用密码，应立即改密）。

**待你选择的处理强度**（都涉及不可逆的历史改写与线上素材替换，我不擅自执行）：

1. **最小**：只删工作区文件 + 从 README / 官网彻底摘链（历史提交与 Pages 旧构建仍可取到，风险残留）。
2. **推荐**：在 1 之上用 `git filter-repo` 改写历史并强推，随后请 GitHub 侧清理缓存的 commit 对象（需开 ticket）；Chrome 商店旧截图随下一次提交换成 `screen-{1..9}` 占位图。
3. 顺带把 `docs/media/demo-login.*` 用 `scripts/store-shots/` 的占位演示页（`demo-login.html`，`example.com` 数据）重录一版，README 首屏动图不缩水。✅ **2026-09-13 已完成**。

**本轮进度（2026-09-12）**：README 首屏（`README.md:29` / `README.en.md:29`）已从 `docs/media/demo-login.webp` 换成 `assets/cws-store/screen-1-one-click-login.png`；`docs/store/CWS_FILL_CONTENT.md`、`docs/operations/账号密码管理助手曝光提升执行手册.md`、`docs/operations/promo/wechat-article-draft.md`、`docs/operations/promo/weibo-drafts.md` 里所有把 `docs/media/demo-login.gif` 或 `assets/screenshots/` 当作**推荐配图**的指针已收口到 `scripts/store-shots/` 占位素材，并逐一标注旧素材退役原因。按「只重截商店与 README 用的图，仓库旧图不动」的决策，**文件本身与历史提交未做任何删改**。

**进度（2026-09-13）**：新增 `scripts/store-shots/record.mjs`，四个关键帧全部走扩展自身的真实填充链路（脚本不代填任何字段），README 首屏换回动图——`README.md:29` → `docs/media/demo-login.webp`、`README.en.md:29` → `docs/media/demo-login-en.webp`（此前中英共用一张，英文画面里是中文标签），`docs/media/demo-login.gif` 同步重录供推广文档引用。画面里的账号全部是 `demo-admin@example.com` 等 `example.com` 占位数据。`docs/media/demo-login.mp4` 按「仓库旧文件不动」的决策保留在原处，没有任何文档引用它；若要彻底断掉 Pages 可取性，需走上面第 1／2 项。

需要执行的命令我在对话里给出，**不由我代为运行**（参见 [[feedback-give-commands]] 口径：改写历史与强推属不可逆操作）。

## 🟡 残留：仍需你决策的代码/配置项

本轮把文档改成代码实测值后，逐项核对代码内的旧口径。**已随本轮直接改正**的部分见下节；下表三项**没有动**，因为改动会波及构建产物或项目规则文件，需要你确认：

| #   | 位置                                                         | 现状（错误）                       | 实测正确值                                                                                                                                                                 | 改动影响面                                                                                       |
| --- | ------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | `AGENTS.md:196` 与 `CLAUDE.md:196`「chrome.alarms 最小间隔」 | MV3 限制为 1 分钟                  | 最小 `periodInMinutes = 0.5`（30 秒）——`entrypoints/background/backgroundServices.ts:96` 已写明，保活闹钟正是 0.5min，`tests/background/swKeepalive.test.ts:92` 断言 `0.5` | **项目规则文件**（会改变后续 AI/协作者的判断），不涉运行时；改一处需同步另一处                   |
| 2   | `utils/data/top1000.json`                                    | 文件名与各处文档口径为「top-1000」 | 实际 **999** 条                                                                                                                                                            | 改名会波及引用与 `THIRD-PARTY-NOTICES`；建议文档改口为「近千条」（本轮已如此处理）或补第 1000 条 |
| 3   | `utils/data/passphrase-words.json`                           | 无上游出处 / 许可证记录            | 需在 `docs/THIRD-PARTY-NOTICES.md` 补来源与授权，或换用有明确许可的词表                                                                                                    | 合规风险（已上架扩展附带数据文件），本轮已在 NOTICES 中显式声明「出处未记录」                    |

### 本轮已一并改正的代码内旧口径（无需决策）

- `utils/i18n/locales/{zh-CN,en}/help.json`：`help.fc.8` 词库 2048 → **3080**；`help.fs.6` 「五维/five checks」→ **4 个计分维度 + 两步验证仅列示不计分**；`help.fc.12` 历史条数默认 5 → **3**；`help.fs.1`/`help.fs.3` 去掉「零网络传输」与「过期后全量重加密」两处错误表述；`help.fb.5` 版本检测改为「先探测商店可达性、不可达才查 GitHub Releases」；`help.fc.10` 把「零网络传输」限定到 TOTP 计算本身。
- `public/_locales/{zh_CN,en}/messages.json` 的 `extensionDescription`：五跳修正——① 2026-09-09 把「零联网」/「100% offline, no sign-up.」改为「密码数据不上传」+ 逐字段加密口径（中文 117 / 英文 127 字符）；② 2026-09-10 因该版本仍属关键词堆砌（逗号串关键词、含竞品品牌名）随驳回一并重写为完整句子（中文 57 / 英文 129 字符）；③ 同日二次修订，按用户「别浪费字符、加密方式是 AES-256-GCM」的要求把核心功能排满 132 额度（中文 121 / 英文 130 字符）；④ 同日三次修订，按用户「TOTP 2FA、迁移导入、密码强度检测、密码可见性切换等核心优势尽量覆盖」的要求把这四项一并排进句子（中文 127 / 英文 130 字符；英文密度低装不下 `show or hide`，该特性由说明的 FEATURE SET 承担；强度检测写作 `strength checks` 而非 `strength audit`，避免与【功能全览】里 0–100 分的安全体检撞词）；⑤ 同日评审微调，按「这里改为 TOTP 2FA」的意见把中文写成**「两步验证（TOTP/2FA）」**（**中文 131 / 英文 130 字符**；「两步验证」是中文侧真实检索词，所以保留而不是换成裸的 `TOTP 2FA`）。五跳的每版中文与英文都与 `docs/store/CWS_FILL_CONTENT.md`「第二步 → 摘要」逐字一致。
- `utils/i18n/locales/{zh-CN,en}/options.json` 的 `options.disclaimer.desc`：去掉绝对化的「零网络传输」，改为「密码数据仅存本地、逐字段 AES-256-GCM 加密、不上传任何服务器」，并保留银行/支付高敏感凭证不建议存放的提示。
- `utils/passphraseGenerator.ts` JSDoc：3080 词、单词 ≈11.6 bit、4 词 ≈46 bit。
- `composables/useSidepanelData.ts:762` 注释：alarm 最小间隔 60s → **0.5min（30s）**。
- `entrypoints/background/backgroundServices.ts:814` 注释：锁定不再「加密全部密码」，只销毁会话密钥材料与解密快照。

⚠️ 上面 help.json、`_locales` 摘要、`options.disclaimer.desc` 三组都是**已上架扩展的用户可见文案**，必须 `pnpm build` 后随商店包重新提交才会真正生效；在此之前线上帮助弹窗、商店列表摘要与选项页安全声明仍显示旧口径。商店侧的生效路径见本文「🔴 待你执行」第 4 项——**被拒草稿不会自动带上新文案，必须新建草稿并粘贴 `CWS_FILL_CONTENT.md`「第二步」的最新内容**。

## 📉 现状基线

- GitHub star：**11**（2026-09-22 由 `api.github.com` 读取；本文首次记录的基线为 8，2026-09-12 为 9）。fork 1。发布/合并后建议用 star-history.com 建立增长曲线，每月复盘（手册第八章）。
