# main 分支自动同步脚本

把 `main` 合并到其他所有本地分支，用于「PR 合进 main 之后，让各分支跟上最新代码」。

```bash
pnpm auto-merge              # 同步全部目标分支（仅本地合并，不推送）
pnpm auto-merge --dry-run    # 只报告会做什么，不移动任何分支
pnpm auto-merge --only feature-dev,Feature-pa
pnpm auto-merge --fetch      # 先 fetch --prune origin
pnpm auto-merge --push       # 合并成功后推到上游（禁推清单与无上游的分支仍不推）
```

## 触发方式

`.husky/post-merge` 在**当前分支是 main** 时调用本脚本，即「在 main 上执行完一次合并」之后自动跑。
PR 在 GitHub 上合进 main、本地 `git checkout main && git pull` 也覆盖到了：fast-forward 的 pull 同样触发
post-merge（2026-10-13 在本机 git 2.23 实测）。

> ⚠️ 旧版文档写的 `.git/hooks/post-merge` 触发链在本仓库**不生效**：`core.hooksPath` 指向
> `.husky/_`，git 只执行该目录里的钩子，`.git/hooks/*` 一律被忽略。新增钩子请写在 `.husky/` 下。
> 另：`git pull --rebase` 更新 main 时没有 merge 发生，钩子不触发，这种流程下手动跑 `pnpm auto-merge`。

## 逐个分支的处理流程

1. `main` 已是该分支的祖先 → 报「已包含 main」，不动。
2. 否则在 `$TMPDIR/aph-auto-merge/<分支>-<时间戳>` 开一个**临时 worktree**，在其中 `git merge main`。
3. 有冲突 → 记下冲突文件列表、`git merge --abort`、**分支指针一格没动**，本分支记为失败。
4. 无冲突 → 合并提交落在分支 ref 上；按推送规则决定是否 `git push`。
5. 摘掉临时 worktree（`worktree remove --force` + 删目录）。

主工作区始终不参与：不 `checkout`、不碰未提交改动（脏工作区只给一句黄色提示）。

## 安全护栏

| 护栏                                   | 为什么                                                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目标分支被其他 worktree 检出 → 只跳过  | 抢走别人正在用的工作区是旧版的真实行为                                                                                                                                          |
| `Feature-pa` / `feature-blog` 永不推送 | 含内网域名，且是仓库里唯一的副本；公开远端推上去收不回来                                                                                                                        |
| 没有上游分支 → 不推送                  | 不替分支创建远端分支，避免把本地唯一份意外公开                                                                                                                                  |
| 无远端副本的分支合并前留备份 ref       | `refs/backup/auto-merge/<日期>/<分支>`，合坏了能指回去                                                                                                                          |
| `release-please--` 前缀不作为目标      | 它自己会把 main 合进去并改版本号，反向灌 main 会和它抢提交                                                                                                                      |
| 主工作区有未解决的冲突 → 拒绝运行      | 卡在冲突时不该再动别的分支。判据是**未解决冲突**而非 `MERGE_HEAD` 是否存在：git 跑 post-merge 时 `MERGE_HEAD` 还没删（2026-10-13 实测），按后者拦会把唯一的自动触发路径整个挡掉 |
| 游离 HEAD → 拒绝运行                   | 此时没有可靠的分支上下文，同步结果无法预期                                                                                                                                      |
| 合并提交带 `--no-verify`               | 见下一节                                                                                                                                                                        |
| 冲突一律 abort，绝不留中间态           | 脚本跑在 post-merge 钩子里，回来发现仓库处于 MERGING 状态是最糟的失败形态                                                                                                       |

### 为什么合并提交必须 `--no-verify`

一次同步会暂存上百个文件，pre-commit 的 lint-staged 会对它们跑 `eslint --fix` / `prettier --write`，
把 main 自己没格式化的文件（例如 `package.json`）顺手改写。于是分支和 main 之间凭空多出一处永久差异，
下一轮同步再撞一次同样的冲突。同步合并本身不引入新写的代码，跳过钩子不绕过任何真实门禁。

## 退出码

- `0`：全部目标分支要么已最新、要么合并成功。
- `1`：至少一个分支冲突或失败，或前置检查未通过（游离 HEAD、主工作区有未解决冲突、本地没有 main）。

## 冲突怎么收口

脚本不会替你解决冲突，也不会把分支留在中间态。确认后手工处理：

```bash
git checkout <分支> && git merge main      # 解决后 git add && git commit
```

## 验证

- 守卫测试：`tests/scripts/autoMergeMain.test.ts`（9 例，临时仓库 + 子进程 + 真实 git 状态），钉住：
  钩子接线（在 main 上合并后真的同步了别的分支）、守卫仍有牙（卡在未解决冲突时拒绝且不动任何分支）、
  干净合并、冲突不动指针、已包含、`--dry-run`、禁推清单优先于 `--push`、无上游不推、占用分支与机器分支跳过。
  测试不起 import 本模块（`scripts/**` 不在 tsconfig 的 include 里）。

```bash
pnpm exec vitest run tests/scripts/autoMergeMain.test.ts
```

## 故障排查

| 现象                                   | 处理                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------- |
| 所有分支都报「已在其他 worktree 检出」 | 残留的临时 worktree：`git worktree list` 查看，`git worktree prune` 清理  |
| 提示本地没有 main                      | `git fetch --prune origin` 后确认 `main` 存在                             |
| 想回退某次同步                         | `git reset --hard <备份 ref>`（有远端副本的分支用 `git log -1@{1}` 找回） |
| 推送失败但本地已合并                   | 合并本身有效，网络恢复后单独 `git push <remote> <分支>`                   |
