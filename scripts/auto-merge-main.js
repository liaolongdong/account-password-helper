#!/usr/bin/env node

/**
 * 把 main 同步合并到其他分支。
 *
 * 用法：`pnpm auto-merge [选项]`，或作为 `.husky/post-merge` 在 main 合并后自动触发。
 *
 * 与 2025-06 那版脚本的三点关键差别（都在本仓库实测过）：
 * 1. 不再 `git checkout` 切分支，而是每个目标开一个临时 worktree。旧版会把调用者
 *    正在用的工作区搬走，且无法处理「目标分支已在别处检出」。
 * 2. 所有 git 调用走 execFileSync 的参数数组，分支名不进 shell 字符串。
 * 3. 合并提交必须 `--no-verify`：一次同步会暂存上百个文件，pre-commit 的 lint-staged
 *    会对它们跑 `eslint --fix` / `prettier --write`，把 main 自己没格式化的文件
 *    （例如 package.json）顺手改写，于是分支和 main 之间凭空多出一处永久差异，
 *    下一轮同步再撞一次冲突。同步合并本身不引入新写的代码，跳过钩子不绕过任何门禁。
 *
 * 冲突一律「探测 → 记录 → abort」，绝不把任何分支留在合并中间态。
 */

import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

/** 同步来源分支 */
const SOURCE_BRANCH = 'main';

/**
 * 永不作为同步目标的分支名（前缀匹配）。
 * release-please 自己会把 main 合进去并改版本号，反向灌 main 会和它抢提交。
 */
const TARGET_EXCLUDE_PREFIXES = ['release-please--'];

/**
 * 禁止推送的分支：内容含内网域名与唯一份提交，仓库是公开的，一旦推上去收不回来。
 * 「没有上游就不推」已经挡住了当前的情况，这张表是防止将来有人 `git push -u` 之后失控。
 */
const NEVER_PUSH = ['Feature-pa', 'feature-blog'];

const colors = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };

/**
 * @param {string} message
 * @param {keyof typeof colors} [color]
 */
function log(message, color = 'reset') {
  console.log(`${colors[color] ?? ''}${message}${colors.reset}`);
}

/**
 * 执行 git 命令；参数用数组传递，避免分支名拼进 shell 字符串。
 *
 * @param {string[]} args git 参数序列
 * @param {{cwd?: string, ignoreError?: boolean}} [options]
 * @returns {string|null} stdout（已去尾换行）；ignoreError 且失败时返回 null
 */
function git(args, options = {}) {
  try {
    return execFileSync('git', args, { cwd: options.cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
      .toString()
      .trim();
  } catch (error) {
    if (options.ignoreError) return null;
    const stderr = error.stderr?.toString().trim() || error.message;
    throw new Error(`git ${args.join(' ')} 失败：${stderr}`);
  }
}

/**
 * 目标分支的筛选口径：本地分支、排除来源分支与被排除前缀。
 *
 * @param {string[]} localBranches 本地分支名
 * @param {string[]} occupied 已在其他 worktree 检出的分支名
 * @param {string[]|null} only 显式指定的分支白名单（--only），null 表示全量
 * @returns {{targets: string[], skipped: {branch: string, reason: string}[]}}
 */
function selectTargets(localBranches, occupied, only = null) {
  const skipped = [];
  let candidates = localBranches.filter(branch => branch !== SOURCE_BRANCH);

  if (only) {
    const missing = only.filter(branch => !localBranches.includes(branch));
    missing.forEach(branch => skipped.push({ branch, reason: '本地不存在该分支' }));
    candidates = candidates.filter(branch => only.includes(branch));
  }

  const targets = [];
  for (const branch of candidates) {
    if (TARGET_EXCLUDE_PREFIXES.some(prefix => branch.startsWith(prefix))) {
      skipped.push({ branch, reason: '机器分支（release-please 自己会合入 main）' });
      continue;
    }
    if (occupied.includes(branch)) {
      skipped.push({ branch, reason: `已在其他 worktree 检出，请在该分支上手动 git merge ${SOURCE_BRANCH}` });
      continue;
    }
    targets.push(branch);
  }
  return { targets, skipped };
}

/**
 * 推送许可判定：只有配了上游、且不在禁推表里的分支才允许推。
 *
 * @param {string} branch 分支名
 * @param {string|null} upstream `<remote>/<branch>` 形式的上游，无上游为 null
 * @returns {{allowed: boolean, reason: string}}
 */
function pushDecision(branch, upstream) {
  if (NEVER_PUSH.includes(branch)) {
    return { allowed: false, reason: '在禁推清单内（内网定制 / 无远端副本的唯一份）' };
  }
  if (!upstream) {
    return { allowed: false, reason: '没有上游分支，不予推送（也不会替它创建远端分支）' };
  }
  return { allowed: true, reason: `推送到 ${upstream.split('/')[0]}` };
}

/** 本地分支名列表 */
function listLocalBranches() {
  return git(['branch', '--format=%(refname:short)'])
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

/** 已被某个 worktree 检出的分支名列表（含当前工作区） */
function listOccupiedBranches() {
  const porcelain = git(['worktree', 'list', '--porcelain']);
  return porcelain
    .split('\n')
    .filter(line => line.startsWith('branch '))
    .map(line => line.slice('branch refs/heads/'.length));
}

/**
 * 分支的上游，没有则 null。
 *
 * @param {string} branch
 * @returns {string|null}
 */
function upstreamOf(branch) {
  return git(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { ignoreError: true });
}

/**
 * 给没有远端副本的分支留一个备份 ref，合坏了还能指回去。
 *
 * @param {string} branch
 * @param {string} sha 合并前的分支指向
 * @returns {string} 备份 ref 名
 */
function backupRef(branch, sha) {
  const stamp = new Date().toISOString().slice(0, 10);
  const ref = `refs/backup/auto-merge/${stamp}/${branch}`;
  git(['update-ref', ref, sha]);
  return ref;
}

/**
 * 摘掉一个临时 worktree。每条返回路径都要调用它——残留的 worktree 会让下一轮
 * 把目标分支判成「已在其他 worktree 检出」，静默地什么都不做。
 *
 * @param {string} worktreePath
 */
function removeWorktree(worktreePath) {
  git(['worktree', 'remove', '--force', worktreePath], { ignoreError: true });
  fs.rmSync(worktreePath, { recursive: true, force: true });
}

/**
 * 合并 main 到单个分支：全程在临时 worktree 里，主工作区不动。
 *
 * @param {string} branch 目标分支
 * @param {{dryRun: boolean, push: boolean}} options
 * @returns {{branch: string, status: 'merged'|'up-to-date'|'conflict'|'dry-run'|'failed', detail: string, pushed: string}}
 */
function syncBranch(branch, options) {
  const before = git(['rev-parse', branch]);

  if (git(['merge-base', '--is-ancestor', SOURCE_BRANCH, branch], { ignoreError: true }) !== null) {
    return { branch, status: 'up-to-date', detail: '已包含 ' + SOURCE_BRANCH, pushed: '' };
  }

  if (options.dryRun) {
    return { branch, status: 'dry-run', detail: `${before.slice(0, 8)} → 待合并 ${SOURCE_BRANCH}`, pushed: '' };
  }

  const upstream = upstreamOf(branch);
  // 没有远端副本的分支合坏了无处可寻，先留一个备份 ref
  const backup = upstream ? '' : backupRef(branch, before);

  const dir = path.join(os.tmpdir(), 'aph-auto-merge', `${branch}-${Date.now()}`.replace(/[^A-Za-z0-9._-]/g, '-'));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });

  // worktree 必须逐个摘掉：残留的临时 worktree 会让下一轮把目标分支判成
  // 「已在其他 worktree 检出」，于是所有分支都同步不动，而且不报任何错。
  // 下面的 return 都在 try 内，finally 一定先执行。
  try {
    git(['worktree', 'add', '--quiet', dir, branch]);

    // --no-verify 的理由见文件头第 3 条
    try {
      git(
        ['merge', '--no-verify', '--no-edit', '-m', `Merge branch '${SOURCE_BRANCH}' into ${branch}`, SOURCE_BRANCH],
        { cwd: dir, ignoreError: true },
      );
    } catch (error) {
      git(['merge', '--abort'], { cwd: dir, ignoreError: true });
      return { branch, status: 'failed', detail: error.message, pushed: '' };
    }

    const conflicted = git(['diff', '--name-only', '--diff-filter=U'], { cwd: dir });
    if (conflicted) {
      const files = conflicted.split('\n').filter(Boolean);
      git(['merge', '--abort'], { cwd: dir, ignoreError: true });
      return {
        branch,
        status: 'conflict',
        detail: `${files.length} 个文件冲突，已 abort，分支未移动：${files.join(', ')}`,
        pushed: backup ? `备份 ref：${backup}` : '',
      };
    }

    const after = git(['rev-parse', 'HEAD'], { cwd: dir });
    if (after === before) {
      return { branch, status: 'up-to-date', detail: '合并未产生提交', pushed: '' };
    }

    const decision = options.push
      ? pushDecision(branch, upstream)
      : { allowed: false, reason: '未加 --push，仅本地合并' };
    let pushed = '';
    if (decision.allowed) {
      const remote = upstream.split('/')[0];
      const result = git(['push', remote, branch], { cwd: dir, ignoreError: true });
      pushed = result === null ? `✗ 推送失败：${remote}/${branch}` : `已推送 ${remote}/${branch}`;
    } else {
      pushed = decision.reason;
    }

    return {
      branch,
      status: 'merged',
      detail: `${before.slice(0, 8)} → ${after.slice(0, 8)}`,
      pushed: backup ? `${pushed}（备份 ref：${backup}）` : pushed,
    };
  } finally {
    removeWorktree(dir);
  }
}

/**
 * 解析命令行参数。
 *
 * @param {string[]} argv
 * @returns {{dryRun: boolean, push: boolean, fetch: boolean, only: string[]|null}}
 */
function parseArgs(argv) {
  const options = { dryRun: false, push: false, fetch: false, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run' || arg === '-n') options.dryRun = true;
    else if (arg === '--push') options.push = true;
    else if (arg === '--fetch') options.fetch = true;
    else if (arg === '--only' || arg === '--branches') {
      const value = argv[i + 1];
      if (!value) throw new Error(`${arg} 需要一个逗号分隔的分支列表`);
      options.only = value
        .split(',')
        .map(name => name.trim())
        .filter(Boolean);
      i += 1;
    } else throw new Error(`未知参数：${arg}`);
  }
  // --push 隐含 --dry-run 失效：两者同时给出时以 --push 为准
  if (options.push) options.dryRun = false;
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  const currentBranch = git(['branch', '--show-current'], { ignoreError: true });
  if (!currentBranch) {
    log('当前处于游离 HEAD，先切回某个分支再运行。', 'red');
    process.exitCode = 1;
    return;
  }

  // 判据是「有没有未解决的冲突」，不是 MERGE_HEAD 存在与否：git 跑 post-merge 时
  // MERGE_HEAD 还没被删（2026-10-13 实测），按后者拦会把本脚本唯一的自动触发路径整个挡掉。
  const unmerged = git(['diff', '--name-only', '--diff-filter=U'], { ignoreError: true });
  if (unmerged) {
    log(`主工作区有未解决的冲突，先完成或 abort 那次合并：${unmerged.split('\n').join(', ')}`, 'red');
    process.exitCode = 1;
    return;
  }

  if (git(['status', '--porcelain'], { ignoreError: true })) {
    log('工作区有未提交改动。同步在临时 worktree 里进行，不会碰到它们，但为免混淆建议先提交。', 'yellow');
  }

  if (options.fetch) {
    git(['fetch', '--prune', 'origin'], { ignoreError: true });
  }

  const sourceSha = git(['rev-parse', SOURCE_BRANCH], { ignoreError: true });
  if (!sourceSha) {
    log(`本地没有 ${SOURCE_BRANCH} 分支。`, 'red');
    process.exitCode = 1;
    return;
  }

  const { targets, skipped } = selectTargets(listLocalBranches(), listOccupiedBranches(), options.only);

  log(`=== 同步 ${SOURCE_BRANCH}（${sourceSha.slice(0, 8)}）到其他分支 ===`, 'green');
  if (targets.length === 0) log('没有需要同步的分支。', 'yellow');
  skipped.forEach(item => log(`  跳过 ${item.branch}：${item.reason}`, 'cyan'));
  console.log('');

  const results = targets.map(branch => {
    const result = syncBranch(branch, options);
    const color =
      result.status === 'merged' || result.status === 'up-to-date'
        ? 'green'
        : result.status === 'conflict' || result.status === 'failed'
          ? 'red'
          : 'cyan';
    log(`  ${result.branch}：${result.detail}`, color);
    if (result.pushed) log(`      ${result.pushed}`, 'cyan');
    return result;
  });

  const bad = results.filter(r => r.status === 'conflict' || r.status === 'failed');
  git(['worktree', 'prune'], { ignoreError: true });

  console.log('');
  log(
    `完成：合并 ${results.filter(r => r.status === 'merged').length} · 已最新 ${results.filter(r => r.status === 'up-to-date').length} · 待合并 ${results.filter(r => r.status === 'dry-run').length} · 冲突/失败 ${bad.length}`,
    bad.length ? 'red' : 'green',
  );

  if (bad.length) {
    log('\n冲突处理：分支没有被移动，按下面顺序手工收口：', 'yellow');
    bad.forEach(item =>
      log(`  git checkout ${item.branch} && git merge ${SOURCE_BRANCH}   # 解决后 git commit`, 'yellow'),
    );
    process.exitCode = 1;
  }
}

// 守卫测试走「起子进程 + 比对 git 状态」，不 import 本模块（仓库既有口径：
// 守卫不能依赖被守卫的模块，且 scripts/** 不在 tsconfig 的 include 里）。
try {
  main();
} catch (error) {
  log(`发生错误: ${error.message}`, 'red');
  process.exitCode = 1;
}
