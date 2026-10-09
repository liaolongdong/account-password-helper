# 贡献者 PR 管理与发版流程手册

> 本文件是给**维护者**看的操作手册：记录这个仓库的 PR/发版流程约定，以及需要在 GitHub 网页端逐项点开、人工设置的部分。
> 代码与配置文件部分（workflow、CODEOWNERS、dependabot、文档）已随 2026-09-28 这一波落进仓库；
> **本文件第 1 节的设置不做，闸门就不成立**——这是全篇最重要的一句。
>
> 贡献者视角的规则写在 `docs/CONTRIBUTING.md`「分支模型与发版流程」，本文件不重复它，只解释它背后的开关。

---

## 0. 全貌：一次改动怎么走到用户机器上

```
贡献者 fork → topic 分支 → PR（标题必须约定式提交）
        │
        ├─ CI 门禁：Conventional PR title / Type check and lint / Unit tests / Build extension
        ├─ Code owners 门禁：加密·会话·存储·权限·content·CI 配置
        ▼
   维护者批准合入 main ──────────────── 〔第一道闸门：代码进主干〕
        │
        ▼
 release-please 只更新自动发布 PR（不打 tag、不提审）
        │
        ▼
 维护者合并那条 release PR ─────────── 〔第二道闸门：决定发哪一版〕
        │
        ▼
 release-please.yml：打 tag → 建 GitHub Release → pnpm build → zip 挂成 Release 附件
        │
        ▼（release: published 事件对接）
 publish.yml 的 prepare job：pnpm build → 离线预检 → 把这个字节包存成 artifact
        │
        ▼
 submit job 停在 Waiting for approval
        │
        ▼
 维护者点 Approve（production 环境）── 〔第三道闸门：不可即时撤回的商店提审〕
        │
        ▼
 fetchStatus → 传包 → 轮询上传落定 → 提审 → Google 人工审核 1-3 天
```

三道闸门各自挡住的错误类型不同：第一道挡「代码没审」，第二道挡「版本号和 CHANGELOG 不是你要发的那一版」，第三道挡「商店包一旦提审就进入 Google 队列，只能撤回（每个 publisher 每天上限 6 次）或等它审完」。

**为什么第三道闸门在 `publish.yml` 而不是 `release-please.yml`**：2026-10-09 之前它在 release-please 那条 workflow 里，而 workflow 级并发组只有一个且 `cancel-in-progress: false`。
2026-09-29 合入 v3.13.1 的 release PR 后，那条 run 停在 `waiting` 十天，把并发组占死——期间每次合入 `main` 产生的 run 全程 0 个 job，并在下一次合并的瞬间被自动取消，Release 也因此没有 zip 附件。
拆开后 `publish.yml` 的并发组**按 tag 分组**，一条等审批的发布链只占住它自己那个 tag。完整时序与故障证据见 `docs/store/CWS_PUBLISHING_GUIDE.md` 3.5。

**为什么不需要一个单独的「PR 分支」**：release-please 已经替你维护了那条分支（`release-please--branches--main--components--account-password-helper`），贡献者合进 `main` 不会发版。再手工加一层 `develop`/`pr` 分支，只会多出一次合并冲突，闸门数量不变。所以本方案是 **GitHub Flow（单主干）+ 三道闸门**，不是 Git Flow。

---

## 1. GitHub 网页端手动设置（按顺序做）

以下都在 `https://github.com/liaolongdong/account-password-helper` → **Settings** 里。建议按 1.1 → 1.7 的顺序，因为后面的验证依赖前面的开关存在。

### 1.1 创建 `production` 环境并配审批人（最关键）

`.github/workflows/publish.yml` 的 `submit` job 带 `environment: production`（2026-10-09 起闸门从 `release-please.yml` 搬到了这里，job 名也从 `build-and-upload` 变成 `submit`）。

1. Settings → **Environments** → **New environment**，名称**必须逐字写** `production`（大小写敏感，写错等于没闸门）。
2. 在 **Protection rules** 里勾选 **Required reviewers**，输入自己的账号 `liaolongdong`。
3. **Deployment protection rules** 里的 wait timer 保持 0（不需要延时）。
4. Save。

> ⚠️ **不建这个环境不会报错**。GitHub 找不到同名环境时会静默自建一个无保护规则的环境，job 直接放行——你会以为闸门在，其实一直是开的。这是本方案唯一会「静默失效」的点。
>
> 建议同时勾选 **Environment visibility: Public**，这样商店提审历史在 Actions 页可见，便于事后追溯哪一版是谁批准的。

**验证生效**：不用等真实发版。在 Settings → Environments 里能看到 `production` 且列出 Required reviewers = 你自己，即为生效。下次合入 release PR 时，Actions run 应停在 `Waiting for approval`，页面顶部出现 **Review deployments** 按钮。

### 1.2 给 `main` 加分支保护（推荐用 Ruleset）

GitHub 现在有两处入口，效果重叠，**只选一处**，否则将来排查会两头找：

- 推荐：Settings → **Rules** → **Rulesets** → New ruleset，Target branches = `main`。
- 或旧版：Settings → **Branches** → **Branch protection rules** → Add rule，Branch name pattern = `main`。

要开的项（Ruleset 名称与旧版略有差异，按语义对齐）：

| 设置项                                                           | 取值               | 挡住什么                                                     |
| ---------------------------------------------------------------- | ------------------ | ------------------------------------------------------------ |
| Restrict who can push to matching branches                       | 只勾自己           | 直推 `main`（直推会绕过 PR 评审且会立刻惊动 release-please） |
| Require a pull request before merging                            | 1 approval         | 无评审落地                                                   |
| Require deploy status checks to pass                             | 见下三条           | 红 CI 合入                                                   |
| Dismiss stale pull request approvals when new commits are pushed | 开                 | 「批完又改代码」                                             |
| Require branches to be up to date before merging                 | 开                 | 合入时才暴露的跨 PR 冲突/回归                                |
| Do not allow bypassing the above settings                        | **先别开**（见下） | —                                                            |

需要设为 required 的状态检查，按**显示名**搜索（不是 job id）：

```
Type check and lint        ← ci.yml 的 static
Unit tests                 ← ci.yml 的 test
Build extension            ← ci.yml 的 build
Conventional PR title      ← pr-title.yml
```

`Playwright extension E2E` **暂时不要设为 required**：它带着 `continue-on-error: true` 处于观察期，红灯不算失败，设为 required 会永远等不到绿色信号（转正条件见 `e2e/README.md`）。

> ⚠️ **关于「Do not allow bypassing」**：这条是给多人团队准备的。你自己是单人维护者 + 唯一 code owner，全开之后**你无法批准自己的 PR**（GitHub 不允许作者自审，code owner 也不能是自己）。所以：
>
> - 现阶段保持 **不开** 该选项，你自己保留一条合法通道：改动走 PR，用管理员权限点 **Merge pull request (Admin override)**，或临时把 required approval 数降到 0；
> - 等出现第二个可信维护者，再回来打开它，并把 1.3 的兜底 owner 改掉。
>
> 「Require a pull request before merging」本身**要开**——它挡的是别人直推，与你能不能自合无关。

### 1.3 打开 Code owners 强制审批

`.github/CODEOWNERS` 已经在仓库里，但**没开这个开关它就只是注释**。

- Ruleset：勾选 **Require review from Code Owners**。
- 旧版分支保护：同一名称的复选框。

规则文件覆盖的范围（逐条对应一条安全边界，不是风格问题）：`utils/encryption.ts`、`utils/crypto-light.ts`、`utils/sessionManager*.ts`、`utils/storage.ts` 与 `utils/storage/`、`utils/types.ts`、`wxt.config.ts`、`public/_locales/`、`entrypoints/content/`、`entrypoints/background/`、`.github/`、`package.json`、`pnpm-lock.yaml`、`scripts/`、`release-please-config.json`、`.release-please-manifest.json`、`CHANGELOG.md`，加一条 `* @liaolongdong` 兜底。

> 兜底那条 `*` 的副作用：所有 PR 都需要 owner 审。单人阶段这等于「都归我」，无害；招人后**先删 `*`**，否则新维护者的文档 PR 也要老维护者点头，会把你变成瓶颈。

**为什么 `.github/` 必须在内**：工作流文件若能被静默改动，攻击者可以让一个 PR 在带 `CWS_SA_PRIVATE_KEY` 的 job（`publish.yml` 的 `inspect` / `submit`）里跑任意命令，等于直接拿到商店发布权。这条是这套方案里唯一防「评审过了但 CI 被改写」的规则。

### 1.4 统一合并方式为 Squash merge

仓库首页 Settings → **General** → Pull Requests：

- ✅ Allow squash merging（**默认合并信息 = PR 标题**，勾 "Pull request title"）
- ❌ Allow merge commits
- ❌ Allow rebase merging

> **现状与文档不一致，需要你确认**：本仓库历史用的是 merge commit——`git log --merges` 里 `333d1cb`、`d79e3bb` 都有两个父提交，PR #82 一次带入 3 个提交。而 `.github/PULL_REQUEST_TEMPLATE.md` 和标题门禁的假设是 squash：**一条 PR 一个提交，提交信息 = 标题**。
>
> 差别不是洁癖：merge commit 会把贡献者的中间提交（`wip`、`temp fix`、`fix typo`）原样带上 `main`，release-please 会读到它们，于是 CHANGELOG 里出现垃圾条目、版本号可能被一个 `wip: fix` 意外推高。squash 之后**标题是唯一输入**，标题门禁才真正等于发版门禁。
>
> 两种口径都可用，但必须选一种。选 squash 的话，`docs/CONTRIBUTING.md` 已经按这个前提写了；选保留 merge commit 的话，要把「PR 内每个提交都得是约定式提交」补进贡献指南。

### 1.5 Fork PR 的工作流审批

Settings → **Actions** → **General** → 拉到 **Fork pull request workflows in private repositories / in public repositories**：

- Approves and runs workflow jobs… → 选 **Require approval for first-time contributors**（首次贡献者需人工放行）。
- 可选再开 **Require approval for all outside collaborators**。

同时确认同页的 **Read repository contents and packages permissions** 为默认只读（本仓库五个 workflow 都显式写了 `permissions:`，`ci.yml`/`pr-title.yml`/`e2e.yml`/`publish.yml` 均为 `contents: read`，只有 `release-please.yml` 拿 `contents: write` + `pull-requests: write`——这是刻意最小化，勿在别的 workflow 上加权限。`publish.yml` 尤其不要加：它虽然能写商店，但写商店靠的是 `CWS_*` Secret 里的服务账号凭据，`GITHUB_TOKEN` 在这条链上一个写操作都不需要）。

挡的是「PR 里塞一个挖矿脚本白嫖 Actions 分钟数」。注意：fork PR 本来就读不到 Secrets，且 `release-please.yml` 与 `publish.yml` 都不由 PR 事件触发（后者只接 `release: published` 和手动 dispatch，`submit` 还额外要求 `github.repository` 等于本仓库），所以凭据外泄这条路已经封死；此项只补算力滥用。

### 1.6 打开 Dependabot

`.github/dependabot.yml` 已写好（pnpm 每周 3 个 PR 上限、只 `increase-if-necessary`、不自动 major；Actions 每月 2 个）。配置文件不会自己生效：

Settings → **Security** → **Code security and analysis**：

- ✅ **Dependabot version updates**（读 `.github/dependabot.yml`）
- ✅ **Dependabot alerts**
- ✅ **Dependabot security updates**

> 已知情况：security updates 此前反复失败，而本仓库用 npmmirror，`pnpm audit` 在这台机器上不可用。查某个告警该升到哪版，改走 `https://api.github.com/advisories`（公开接口，无需 token），不要退到 `pnpm audit`。
>
> 修告警的既有口径：**按「是否越下游 semver 范围」分级**，不强升主版本，override 用 `~` 而不是 `>=`，误报走行内抑制而不是把整个目录排除掉。
>
> `.github/dependabot.yml` 里的 `commit-message.prefix: chore` 是**硬要求不是美化**：Dependabot 默认标题 `Bump x from 1 to 2` 过不了 `Conventional PR title` 检查（见 1.2），也会被 release-please 归错小节。加了前缀变成 `chore(deps): Bump ...`，而 chore 类型不触发版本跳档。

### 1.7 核对发版用 PAT

`release-please.yml` 用的是 `secrets.RELEASE_PLEASE_TOKEN`（不是内置 `GITHUB_TOKEN`），因为它要创建 release PR 并在合并后识别发布。

Settings → **Secrets and variables** → **Actions** → 确认：

- 该 PAT 是 **Fine-grained**、只作用于此仓库、权限仅 `Contents: Read and write` + `Pull requests: Read and write`；classic + `repo` full scope 属于过宽。
- 设置**过期时间**并记入日历轮换；过期当晚的发版会红，报错通常落在 `release-please` job 而不是发布 job。
- 仓库级 Secrets 页应当**只有** `RELEASE_PLEASE_TOKEN` 与 `CWS_*` 这组商店凭据两类；两类的权限面不同（一个能写主干，一个能发商店），任何一类出现在别的 workflow 的 `env:` 里都应当能被解释。
- `release-please.yml` 现在完全不引用任何 `CWS_*`（2026-10-09 起商店凭据只在 `publish.yml` 里用），所以「打 tag 的那段被改写」不再等于「拿到商店发布权」。

### 1.8（可选加固）把商店私钥限定到 `production` 环境

做法：1.1 建好环境后，在 Secrets 页按 Environment 作用域存凭据——把 `CWS_SA_PRIVATE_KEY` 存成 `production` 环境的 Secret，而不是仓库级（另外三项标识符 `CWS_EXTENSION_ID` / `CWS_PUBLISHER_ID` / `CWS_SA_EMAIL` 留在仓库级，它们不含秘密，`prepare` 的离线预检要读）。

收益：私钥只出现在跑于 `production` 环境**且已获人工批准**的 job 里；仓库里别的 workflow 被改写、或某个 run 被恶意触发，都拿不到发布凭据。

**代价（这条必须先看，否则会把自己锁在门外）**：`publish.yml` 的 `inspect` job **没有**挂 `environment`（只读段不需要人工放行，见上架指南 3.6），环境级 Secret 对它不可见——于是 `status` 档会当场失败。
两条路选一：

- **接受代价**：把 `inspect` 也挂上 `environment: production`，代价是连一次只读的 `fetchStatus` 都要人工点 Approve。
- **保持现状（本仓库当前做法）**：四项都存仓库级，把防线放在 1.3 的 `.github/` CODEOWNERS 上——能改 workflow 文件的人本来就能改 `env:`，环境作用域在这里并没有多挡住什么。

两种失效方向要分开记，别混成一条。一是**凭据随环境消失**：只有选了「环境级 Secret」这条路才成立——环境被改名或删除，挂在它上面的私钥一起没了，`submit` 在预检的「标识符形状」处当场判红（上架指南 FAQ 第 3 条）。二是**闸门静默失效**：与 Secret 存在哪一级无关，环境从未创建（或被删掉）时 GitHub 直接放行，`Waiting for approval` 根本不出现（FAQ 第 4 条）。本仓库当前做法是四项存仓库级，只吃第二种亏，所以 §6 自检里「Environments 里有 `production` 且列着 Required reviewers」是闸门成立与否的唯一判据。

---

## 2. 日常操作流程

### 2.1 贡献者（详见 `docs/CONTRIBUTING.md`，此处只列要点）

fork → 从 `main` 切 topic 分支 → 改动 → 本地跑门禁 → 提 PR，标题 `<type>(<scope>): <subject>`。
不要手改 `package.json` 的 version 与 `CHANGELOG.md`（release-please 会覆盖，且 `.github/CODEOWNERS` 认领了这两个文件）。

### 2.2 维护者评审

1. 看 CI 四道检查是否全绿，红的不审。
2. 看 PR 模板的「影响面」勾选：勾了「改变功能/交互/默认值/存储结构/加密格式/权限」的，先确认 issue 里讨论过，未讨论直接打回。
3. 本项目按顺序权衡：安全与隐私 → 功能正确性 → 数据与行为兼容性 → 可维护性 → 性能 → 风格。凭据泄露类问题一律阻塞合并，不当「后续优化」。
4. 触及 `.github/`、`utils/encryption.ts`、`utils/storage/`、`entrypoints/content/` 时，CODEOWNERS 会要求你显式批准——这是设计如此，不是 bug。

### 2.3 发版（每个版本一次）

```sh
# 1) 看一眼这班车都收了什么（只读）
git fetch origin
git log --oneline origin/main -20
```

1. 打开 release-please 自动生成的那条 PR（标题 `chore(main): release X.Y.Z`），核对 CHANGELOG 与版本号：`docs:`/`chore:` 的条目**不该**让版本号动；若某条贡献者的标题被写歪导致跳档判断错了，在这里改掉标题或要求作者改，比发出去再撤便宜得多。
2. 合并它 → `release-please.yml` 打 tag、建 GitHub Release，`build-and-attach` job 构建并把 zip 挂成 Release 附件。**这一段没有人工闸门**，它只写 GitHub Releases。
3. Release 生成会触发**另一条 run**——Actions 里它的名字是 **Publish to Chrome Web Store**，不是 release-please 那条：`prepare` 构建 + 离线预检，`submit` 停在 `Waiting for approval`。点开那条 run → **Review deployments** → 勾选 `production` → **Approve**。
   （别在 release-please 的 run 页面找审批按钮，2026-10-09 起它没有闸门，也不该有。）
4. 批准后 `submit` 依次跑：严格预检 → `fetchStatus` → 传包 → 轮询上传落定 → 提审 → 回读状态。确认三件事：
   Release 页面挂上了 `account-password-helper-X.Y.Z-chrome.zip`；`Offline preflight` 逐行里没有 `✗`；`Publish to Chrome Web Store` 步骤末尾打印 `已提交审核：state=…`，job summary 出现「Chrome Web Store：已提交审核」。
5. 去 [Developer Dashboard](https://chrome.google.com/webstore/devconsole) 确认草稿已变成「在审核中」（等价的命令行读法：`pnpm cws:status`，本地需先导出那四项 `CWS_*`，见上架指南 3.4），再按上架指南第四步「批准之后，先在 Dashboard 核对三件事」与第五步做事实一致性校验。

### 2.4 热修（线上版本有安全问题）

不要为了「等下一班车」而推迟修。

```sh
git fetch origin && git checkout -b hotfix-x-y-z origin/main
# 改动，标题用 fix:，本地跑 pnpm typecheck && pnpm lint && pnpm test:run && pnpm build
```

提 PR → 合入 → release-please 会把 patch 版本追加进**已存在**的 release PR；若没有开着的 release PR，它会新建一条。然后走 2.3 的第 2 步起。

### 2.5 撤版 / 回滚

分两种情况，别混为一谈：

- **还在排队（`PENDING_REVIEW`）**：可以撤回这次提交——`node scripts/cwsPublish.mjs cancel`（等价 `pnpm cws:cancel`）。Google 的限制是**每个 publisher 每天最多撤回 6 次**，用尽之后只能等审核自然结束。撤下来的商品回到草稿状态，改完再走一遍 `publish.yml`。
- **已经上架**：没有「撤回某个已发布版本」这个操作。只能 Dashboard 里把该商品设为未发布（用户端会失去更新，影响比继续放出去更差），或者再发一版更高的版本号盖上去。

所以：

- 批准前一定要看一眼 GitHub Release 的 CHANGELOG（2.3 第 1 步）——第 3 道闸门的定位是「挡住不该进队列的版本」，不是「给发错留的后门」。
- 真发错了，回滚提交用 `revert:` 类型，让 release-please 在下一班车里带上 Reverts 小节。
- 删 tag 会让 release-please 的状态与 `.release-please-manifest.json` 打架，**不要删已发布的 tag**；往前修，不往后退。

---

## 3. 开放贡献前的仓库卫生（2026-09-28 实测）

本方案的前提是「`main` 是唯一真源」。当前本地状态不满足，先处理这一节，否则贡献者会对着落后三个版本的代码提 PR。

| 本地分支         | 领先 `origin/main` | 落后 | 独有内容（相对 merge-base）                                                                | 判断                                                |
| ---------------- | ------------------ | ---- | ------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `feature-opt`    | 37                 | 9    | 落地中的工作                                                                               | **先走 PR 合进 main**                               |
| `main`           | 0                  | 106  | 无                                                                                         | 本地 `main` 已陈旧，`git checkout main && git pull` |
| `feature-dev`    | 0                  | 106  | 无（已被包含）                                                                             | 可删                                                |
| `feature-fixbug` | 8                  | 106  | diff 为空（内容等价已在 main）                                                             | 可删                                                |
| `Feature-ai-tip` | 8                  | 106  | diff 为空（内容等价已在 main）                                                             | 可删                                                |
| `feature-blog`   | 65                 | 106  | 根目录 `blog.md` 239 行独有                                                                | 待你确认是否废弃                                    |
| `Feature-pa`     | 77                 | 106  | 10 文件 379+/50-，含 `README-pa.md`、`HelpDialog.vue`、`FormDetector.ts`、`utils/types.ts` | 待你确认，别凭名字删                                |

> 分支最后提交都停在 2026-08-27，标题清一色 `Merge branch 'main' into <分支>`——这是 `pnpm auto-merge` 留下的印记，见下。

先复核再删（`-D` 是破坏性操作，逐条确认输出为空再动手）：

```sh
git log --oneline origin/main..feature-fixbug          # 应只有 merge 提交
git diff --stat $(git merge-base origin/main feature-fixbug) feature-fixbug   # 应为空
git branch -d feature-dev                              # -d 而非 -D，它拒绝删未合并分支
git branch -D feature-fixbug Feature-ai-tip            # 仅当上面 diff 为空
```

**关于 `pnpm auto-merge`（`scripts/auto-merge-main.js`）**：它的行为是在 `main` 上把 main 扇出合并进**所有**本地分支并推送远程分支。这正是上表那张「每分支落后 106」表格的成因，也和 GitHub Flow 冲突——长期分支越多，`main` 越不像真源。

建议：**停用**该脚本（改用「短分支 + 需要时 `git rebase origin/main` 或 `git merge origin/main`」），但**文件先留着不删**——它是可执行代码，删除属行为变更，等你明确点头。真要退役，我把它移进 `docs/` 注释或加一句 deprecation 提示。

---

## 4. 本波已落进仓库的东西

| 文件                                   | 作用                                                                                                                                                                   | 状态 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `.github/workflows/release-please.yml` | 加 workflow 级 `concurrency`，`cancel-in-progress: false`；当初把 `environment: production` 挂在它的发布 job 上，**2026-10-09 那道闸门已搬进 `publish.yml`**（见 4.1） | 改   |
| `.github/workflows/pr-title.yml`       | 约定式提交标题门禁；`pull_request` 触发、`contents: read`、不检出 PR 代码、标题经 env 传参不拼 shell                                                                   | 新增 |
| `.github/CODEOWNERS`                   | 认领加密/会话/存储/类型契约/权限与 manifest/content/background/CI/依赖/脚本                                                                                            | 新增 |
| `.github/dependabot.yml`               | pnpm 每周限量 + `increase-if-necessary`；Actions 每月限量；`prefix: chore`                                                                                             | 新增 |
| `.github/PULL_REQUEST_TEMPLATE.md`     | 顶部说明标题即版本输入、合 PR ≠ 发布                                                                                                                                   | 改   |
| `docs/CONTRIBUTING.md`                 | 中英两半新增「分支模型与发版流程」，并修正「GitHub 会自动 squash」这句与历史不符的表述                                                                                 | 改   |
| `docs/store/CWS_PUBLISHING_GUIDE.md`   | 第三步补 `production` 审批环节与「环境没建就等于没闸门」的警告                                                                                                         | 改   |

`pr-title.yml` 的内联校验逻辑已在本地按 GitHub Actions 相同方式（`bash -c` + env 注入）跑过 14 个用例：4 类合法标题通过；`Update readme`、中文冒号 `feat：`、`wip:`、空标题、`feat!:` 全部被拦；机器人账号放行；含 `$(reboot)` 与反引号的标题只被判格式不合法、未被执行。带 `BREAKING CHANGE` 的 PR 描述出警告不出红灯。

### 4.1 2026-10-09 增补：商店发布链改造（v1.1 停服 + 解开发版堵塞）

| 文件                                  | 作用                                                                                                                                                                            | 状态 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `.github/workflows/publish.yml`       | 新增。接 `release: published` 与手动 dispatch；`prepare`（构建 + 离线预检 + 存 artifact）/ `inspect`（只读 `fetchStatus`）/ `submit`（挂 `production` 审批）；并发组按 tag 分组 | 新增 |
| `scripts/cwsPublish.mjs`              | 新增 CLI：`preflight` / `token` / `status` / `publish` / `cancel` 五个子命令，走 Chrome Web Store API **v2** + 服务账号，替掉第三方 action 的 v1.1 调用路径                     | 新增 |
| `scripts/lib/cwsPublish.mjs`          | 新增 v2 薄客户端与离线预检判据（JWT 签票、upload、轮询 `lastAsyncUploadState`、publish、cancelSubmission、错误码解释）                                                          | 新增 |
| `tests/scripts/cwsPublishCli.test.ts` | 新增 22 例：本地假商店逐字钉住请求序列、请求体、`content-type`、错误提示与「输出不含 token 与私钥」；端点靠 env 覆盖指向假服务                                                  | 新增 |
| `package.json`                        | 新增 `cws:preflight` / `cws:token` / `cws:status` / `cws:publish` / `cws:cancel` 五个脚本                                                                                       | 改   |
| `.github/workflows/e2e.yml`           | 两处 `paths-ignore` 加上 `publish.yml`（改发布链不该触发一次真浏览器 E2E）                                                                                                      | 改   |
| `docs/store/CWS_PUBLISHING_GUIDE.md`  | 第三步整体重写为服务账号路线（3.1–3.7），第四步补「批准后核对三件事」，新增 FAQ 四组 33 条，附录改写                                                                            | 改   |

三处改动动机与硬伤，按证据列在这里，便于将来回溯为什么长这样：

1. **发版链自 2026-09-29 停摆**：v3.13.1 的 run 停在 `production` 的 `waiting` 十天，占死唯一的并发组，后续每次合 `main` 的 run 全程 0 个 job 并被下一次合并自动取消（run 36556089630 / 37735256974），v3.13.1 的 Release `assets: []`。
2. **发布通道 6 天后失效**：Chrome Web Store API v1.1 于 **2026-10-15** 停止支持，旧 job 用的 `mnao305/chrome-extension-upload@v6.0.0` 走的正是 v1.1。
3. **教程里的取 token 段落已死**：OOB 授权 2023-01-31 全面终止，而 Testing 同意屏幕签出的 refresh token 7 天过期——就是历史 `invalid_grant` 的根因。

> ⚠️ 本波**只改流水线与文档，没有真的提审过任何版本**。商店侧的实际验证走 `publish.yml` 的 `preflight` 档（零凭据、零网络写），
> 而 `status` / `publish-dry` / `publish` 三档需要先在 Cloud Console 建出服务账号并完成 3.2 的绑定——**这一步目前还没做**，是发版前的硬前置。

---

## 5. 待你拍板

1. **合并方式**（1.4）：squash 还是继续 merge commit？文档目前按 squash 的假设写。
2. **`feature-blog` / `Feature-pa`**（第 3 节）：废弃还是捡回来？
3. **`pnpm auto-merge`**（第 3 节）：停用还是保留长期分支模式？
4. **1.8 环境级 Secrets**：做还是不做？做完这条有一个确定代价——`inspect` job 不挂 `environment`，`status` 档会读不到私钥（两个走法见 1.8）。
5. 出现第二个维护者后，回头删 CODEOWNERS 的 `*` 兜底、并打开「Do not allow bypassing」。
6. **服务账号（3.1–3.2）**：由谁在 Cloud Console 建、绑到哪个 publisher。这一步不在仓库里，本波无法替你完成；**没做之前 `publish.yml` 的 `status` / `publish` 两档必然失败**，只有 `preflight` 档是绿的。
7. **孤儿环境 `CWS_EXTENSION_ID`** 与**旧三项 Secret**（`CWS_CLIENT_ID` / `CWS_CLIENT_SECRET` / `CWS_REFRESH_TOKEN`）删不删。留着都不影响流水线，但会误导下一个人以为凭据形态还是 OAuth。
8. **`--staged` 要不要成为默认**：现在 `publish` 走 `DEFAULT_PUBLISH`（审核通过即上架）。改成挂起放行需要每次带上 `STAGED_PUBLISH`，而放量百分比的 API 调用有「7 日活跃用户 > 10,000」的门槛（FAQ C.21）。

## 6. 快速自检

- [ ] Settings → Environments 里有 `production` 且列着 Required reviewers
- [ ] `main` 有 ruleset/分支保护，required checks 是那四条，`Playwright extension E2E` 不在其中
- [ ] Require review from Code Owners 已开
- [ ] 合并方式已选定并写回本节 1.4
- [ ] Dependabot 三个开关都开着
- [ ] PAT 是 fine-grained、有到期日
- [ ] 本地 `main` 已 `git pull`，僵尸分支按第 3 节处理过
- [ ] 服务账号已建、Chrome Web Store API 已在该 Cloud 项目启用、邮箱已加进 Dashboard → Account（上架指南 3.1–3.2）
- [ ] 仓库级 `CWS_EXTENSION_ID` / `CWS_PUBLISHER_ID` / `CWS_SA_EMAIL` / `CWS_SA_PRIVATE_KEY` 四项就位，且 `pnpm cws:token` 与 `pnpm cws:status` 本地都通（3.3–3.4）
- [ ] 旧的 `CWS_CLIENT_ID` / `CWS_CLIENT_SECRET` / `CWS_REFRESH_TOKEN` 已删或已标注废弃
- [ ] 孤儿环境 `CWS_EXTENSION_ID` 已删（它不是闸门）
- [ ] 下一次真实发版跑通四段：tag + Release 附件 → **另一条 run**（Publish to Chrome Web Store）的 `prepare` 预检无 `✗` → `submit` 停在 Waiting for approval → Approve 后 Dashboard 出现「在审核中」
