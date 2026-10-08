# 文档地图（Documentation Index）

本文件是仓库文档的落点索引：先查这张表，再决定新文档写在哪里。判断标准只有一条——**这份内容是给仓库 outside 的人看的，还是给我们自己看的**。前者入库、按目录归类；后者留在本地，由 `.gitignore` 兜住。

> 根目录不放文档。GitHub Pages 从 `main` 分支根目录发布，所以根目录的 `.html` / `.txt` / `llms.txt` / `pricing.md` 全是**已发布的对外地址**，不是随手放置；`test-page.html` 已于 2026-09-28 移入 `docs/fixtures/`。新增文档一律进 `docs/`。

## 目录职责

| 路径                         | 放什么                                                                                                         | 入库    | 主要引用方                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `ARCHITECTURE.md` / `.en.md` | 架构、数据流、安全设计、逐文件注释的项目结构树、「功能实现详解」                                               | ✅ 必须 | `README*`、`product-site/index.html`（GitHub blob 外链）、issue 模板                      |
| `CONTRIBUTING.md`            | 开发规范、常用命令、提交范围、PR 自检清单（中英同文件）                                                        | ✅ 必须 | `README*`、`product-site/index.html`、PR 模板                                             |
| `THIRD-PARTY-NOTICES.md`     | 第三方许可证声明                                                                                               | ✅ 必须 | `README*`                                                                                 |
| `PR_WORKFLOW_GUIDE.md`       | 分支模型、发版闸门、GitHub 网页端人工设置清单                                                                  | ✅ 必须 | `.github/CODEOWNERS`、`.github/workflows/*` 注释、`docs/store/` 两份                      |
| `store/`                     | Chrome 商店上架内容与发布流程：`CWS_FILL_CONTENT.md`（粘贴用正文）、`CWS_PUBLISHING_GUIDE.md`（流程与红线）    | ✅ 必须 | `AGENTS.md` / `CLAUDE.md` 文档同步条款、`.github/*`、`scripts/render-store-creatives.mjs` |
| `operations/`                | 对外运营与 SEO：曝光提升执行手册、`exposure-status.md` 进度台账、公众号 / 微博 / reddit 文案、`promo/` 草稿    | ✅ 必须 | 本目录内部互引、`README*` 配图口径、`scripts/store-shots/`                                |
| `reports/`                   | 内部评估报告与设计稿：`PERF_*`、`*_EVALUATION.md`、`*_DESIGN.md`、`LANDING_MOTION_PROPOSAL.md`                 | ✅ 必须 | `utils/`、`components/`、`composables/`、`benchmarks/`、`e2e/`、`tests/` 注释             |
| `media/`                     | README 与推广文档直接引用的演示素材（`demo-login.*`、`demo-totp.*`）；由 `scripts/store-shots/record.mjs` 产出 | ✅ 必须 | `README*`、`docs/store/`、`docs/operations/`                                              |
| `fixtures/`                  | 手工回归夹具：`test-page.html`（表单检测与自动填充验证页）                                                     | ✅ 必须 | `docs/ARCHITECTURE*.md`                                                                   |
| `blog/`                      | 博客**源文件**（`zh/`、`en/` 各 5 篇 md）与 `PUBLISHING.md`；产物是根目录 `blog/*.html`                        | ✅ 必须 | `pnpm gen:blog`                                                                           |
| `prototypes/`                | 提案的配套实物页（`landing-motion-lab.html`）                                                                  | ✅ 必须 | `docs/reports/LANDING_MOTION_PROPOSAL.md`                                                 |
| `docs/code-review-*.md`      | 一次性代码评审报告（可落在本目录或任一子目录）                                                                 | ❌ 忽略 | 无：结论应回写进提交说明与对应文档                                                        |
| `docs/pricing.md`            | 根目录 `pricing.md` 的历史副本，全仓零引用                                                                     | ❌ 忽略 | 无：定价表只认根目录那一份                                                                |

## 新增文档该放哪

1. **给用户 / 商店 / 搜索与 AI 引擎看** → `operations/`（文案与投放）或 `store/`（商店正文与流程），并保持中英同事实。
2. **给未来的自己看的技术判断依据**（评估、测算、设计稿）→ `reports/`。这类文档会被源码注释按路径引用，**必须入库**；写完在引用处写全 `docs/reports/<file>.md`，别只写文件名。
3. **会话工作稿、评审报告、跑批原始数据、机器绑定状态** → 留在本地，落进 `.gitignore` 已覆盖的位置（`docs/**/code-review-*.md`、`.qoder/plans/`、`benchmarks/results/`、`*.qoder.site`）。要新增一类，先在 `.gitignore` 末尾补规则并同步 `docs/CONTRIBUTING.md`「提交范围」。
4. **演示图片 / 动图** → `media/`，用 `scripts/store-shots/` 录制，不要手塞进 `assets/`。

## 反查工具

- 死链自检：仓库内所有 `docs/**` 路径引用都应指向真实文件。改动文档位置后，至少跑 `git grep -n 'docs/'` 逐条确认命中文件存在。
- 忽略规则自检：`git check-ignore -v <path>` 逐条验证；对已跟踪文件必须带 `--no-index`，否则 `check-ignore` 会跳过它们、给出假阴性。
- 完整入库口径见 `docs/CONTRIBUTING.md`「提交范围」。

---

# Documentation Index (English)

This file is the placement index for repository docs: check the table before deciding where a new document goes. There is only one test — **is this read by people outside the repo, or only by us**. The former is tracked and filed by category; the latter stays local and is covered by `.gitignore`.

> No docs in the repo root. GitHub Pages is served from the root of the `main` branch, so the root-level `.html` files, `robots.txt`, `sitemap.xml`, `llms.txt` and `pricing.md` are **published addresses**, not casual placements; `test-page.html` moved to `docs/fixtures/` on 2026-09-28. Everything new goes under `docs/`.

## Directory responsibilities

| Path                         | What belongs here                                                                                                                  | Tracked     | Main consumers                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `ARCHITECTURE.md` / `.en.md` | Architecture, data flow, security design, annotated project tree, feature implementation details                                   | ✅ Required | `README*`, `product-site/index.html` (GitHub blob links), issue templates                   |
| `CONTRIBUTING.md`            | Development rules, commands, commit scope, PR checklist (both languages in one file)                                               | ✅ Required | `README*`, `product-site/index.html`, PR template                                           |
| `THIRD-PARTY-NOTICES.md`     | Third-party licence notices                                                                                                        | ✅ Required | `README*`                                                                                   |
| `PR_WORKFLOW_GUIDE.md`       | Branch model, release gating, manual GitHub settings checklist                                                                     | ✅ Required | `.github/CODEOWNERS`, `.github/workflows/*` comments, `docs/store/`                         |
| `store/`                     | Chrome Web Store listing content and publishing flow (`CWS_FILL_CONTENT.md`, `CWS_PUBLISHING_GUIDE.md`)                            | ✅ Required | `AGENTS.md` / `CLAUDE.md` doc-sync rules, `.github/*`, `scripts/render-store-creatives.mjs` |
| `operations/`                | External operations and SEO: exposure handbook, `exposure-status.md` progress log, WeChat / Weibo / Reddit copy, `promo/` drafts   | ✅ Required | Cross-links inside this folder, `README*` imagery, `scripts/store-shots/`                   |
| `reports/`                   | Internal evaluations and design drafts: `PERF_*`, `*_EVALUATION.md`, `*_DESIGN.md`, `LANDING_MOTION_PROPOSAL.md`                   | ✅ Required | Comments in `utils/`, `components/`, `composables/`, `benchmarks/`, `e2e/`, `tests/`        |
| `media/`                     | Demo imagery referenced by README and promotion docs (`demo-login.*`, `demo-totp.*`), produced by `scripts/store-shots/record.mjs` | ✅ Required | `README*`, `docs/store/`, `docs/operations/`                                                |
| `fixtures/`                  | Manual regression fixtures: `test-page.html` (form detection / autofill verification page)                                         | ✅ Required | `docs/ARCHITECTURE*.md`                                                                     |
| `blog/`                      | Blog **source** (`zh/` and `en/`, five md each) plus `PUBLISHING.md`; output is the root `blog/*.html`                             | ✅ Required | `pnpm gen:blog`                                                                             |
| `prototypes/`                | Companion artefact pages for proposals (`landing-motion-lab.html`)                                                                 | ✅ Required | `docs/reports/LANDING_MOTION_PROPOSAL.md`                                                   |
| `docs/code-review-*.md`      | One-off code review reports (in this folder or any subfolder)                                                                      | ❌ Ignored  | None: findings belong in commit messages and the relevant docs                              |
| `docs/pricing.md`            | Historical copy of the root `pricing.md`, referenced nowhere                                                                       | ❌ Ignored  | None: the root copy is the only pricing sheet                                               |

## Where a new document goes

1. **Read by users / the store / search and AI engines** → `operations/` (copy and placements) or `store/` (listing content and flow), keeping both languages stating the same facts.
2. **Technical rationale for our future selves** (evaluations, measurements, design drafts) → `reports/`. These are cited by path from source comments, so they **must stay tracked**; write the full `docs/reports/<file>.md`, never the bare filename.
3. **Session drafts, review reports, raw benchmark data, machine-bound state** → keep local, inside locations `.gitignore` already covers (`docs/**/code-review-*.md`, `.qoder/plans/`, `benchmarks/results/`, `*.qoder.site`). Adding a new category means updating `.gitignore` and `docs/CONTRIBUTING.md` "Commit scope" in the same change.
4. **Demo images and GIFs** → `media/`, recorded with `scripts/store-shots/`; do not drop them into `assets/` by hand.

## Self-checks

- Dead-link sweep: every `docs/**` path reference in the repo must resolve to a real file. After moving docs, at least run `git grep -n 'docs/'` and confirm each hit exists.
- Ignore-rule sweep: verify paths one by one with `git check-ignore -v <path>`; for tracked paths add `--no-index`, otherwise `check-ignore` skips them and reports a false negative.
- Full commit-scope policy: `docs/CONTRIBUTING.md` "Commit scope".
