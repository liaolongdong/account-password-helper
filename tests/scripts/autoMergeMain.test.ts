/**
 * main → 其他分支自动同步脚本的守卫测试（临时仓库 + 子进程）。
 *
 * 口径与 `cwsPublishCli.test.ts` 一致：守卫不 import 被守卫的模块（`scripts/**` 不在
 * tsconfig 的 include 里），全部走「起子进程跑脚本 + 用 git 命令读回真实状态」。
 *
 * 钉住的是五件会出事的事：
 * 1. 接线：`.husky/post-merge` 在 main 上合并后真的把脚本跑起来——旧版整条链是死的
 *    （`core.hooksPath` 指向 `.husky/_`，`.git/hooks/*` 永不执行），而它死得毫无声响。
 * 2. 干净合并确实推进了目标分支，且临时 worktree 收尾摘干净——残留会让之后每一次
 *    占用判断和 `git worktree` 操作一起失真。
 * 3. 冲突时分支指针一格没动、仓库不留在合并中间态。脚本跑在 post-merge 钩子里，
 *    把人吓到的不是红字，是回来发现仓库处于 MERGING。
 * 4. 禁推清单与「无上游不推」：`Feature-pa` / `feature-blog` 含内网域名、且是仓库里
 *    唯一的副本，一旦 `--push` 推到公开远端就收不回来。
 * 5. 占用中的分支只跳过不抢占——抢走别人正在用的工作区是旧版脚本的真实行为。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts', 'auto-merge-main.js');

/** 本文件创建过的所有目录（含 bare 远端与临时 worktree），afterAll 逐个删 */
const created: string[] = [];

/**
 * 在指定仓库跑 git。
 *
 * @param repo 仓库路径
 * @param args git 参数
 * @returns stdout（已去尾换行）
 */
function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/**
 * 跑 git，命令以非 0 退出时返回 null（用于 `rev-parse --verify` 这类存在性探测）。
 *
 * @param repo 仓库路径
 * @param args git 参数
 */
function gitMaybe(repo: string, args: string[]): string | null {
  try {
    return git(repo, args);
  } catch {
    return null;
  }
}

/**
 * 跑同步脚本并捕获退出码与输出（脚本冲突时按约定返回 1）。
 *
 * @param repo 仓库路径
 * @param args 传给脚本的参数
 */
function runScript(repo: string, args: string[] = []): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0, stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

interface RepoOptions {
  /** 目标分支名，默认 feature-x */
  branch?: string;
  /** true 时让分支与 main 改同一行，制造必然冲突 */
  conflict?: boolean;
  /** true 时挂一个本地 bare 远端并推 main */
  withRemote?: boolean;
  /** 配合 withRemote：把该分支推上去并设上游（用于验禁推清单） */
  upstreamBranch?: string;
}

/**
 * 建一套最小仓库：main 改过 shared.txt 并新增 from-main.txt，目标分支另走一条线。
 *
 * @param options 见 {@link RepoOptions}
 * @returns 仓库路径
 */
function makeRepo(options: RepoOptions = {}): string {
  const branch = options.branch ?? 'feature-x';
  const repo = mkdtempSync(path.join(os.tmpdir(), 'aph-automerge-'));
  created.push(repo);

  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'guard-test']);
  git(repo, ['config', 'user.email', 'guard-test@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);

  writeFileSync(path.join(repo, 'shared.txt'), 'base\n');
  git(repo, ['add', 'shared.txt']);
  git(repo, ['commit', '-q', '-m', 'init']);

  git(repo, ['checkout', '-q', '-b', branch]);
  if (options.conflict) {
    writeFileSync(path.join(repo, 'shared.txt'), 'from branch\n');
    git(repo, ['commit', '-q', '-am', 'branch edits the same line']);
  } else {
    writeFileSync(path.join(repo, 'branch-only.txt'), 'mine\n');
    // 新文件不在 `-a` 的范围内，必须显式 add
    git(repo, ['add', 'branch-only.txt']);
    git(repo, ['commit', '-q', '-m', 'branch adds its own file']);
  }
  git(repo, ['checkout', '-q', 'main']);

  writeFileSync(path.join(repo, 'shared.txt'), 'from main\n');
  git(repo, ['commit', '-q', '-am', 'main edits']);
  writeFileSync(path.join(repo, 'from-main.txt'), 'new on main\n');
  git(repo, ['add', 'from-main.txt']);
  git(repo, ['commit', '-q', '-am', 'main adds a file']);

  if (options.withRemote) {
    const bare = mkdtempSync(path.join(os.tmpdir(), 'aph-automerge-remote-'));
    created.push(bare);
    git(bare, ['init', '-q', '--bare']);
    git(repo, ['remote', 'add', 'origin', bare]);
    git(repo, ['push', '-q', 'origin', 'main']);
    if (options.upstreamBranch) {
      git(repo, ['push', '-q', '-u', 'origin', options.upstreamBranch]);
    }
  }

  return repo;
}

/** 远端上某个分支指向的 sha，不存在返回 null */
function remoteSha(repo: string, branch: string): string | null {
  const line = gitMaybe(repo, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]);
  return line ? line.split('\t')[0] : null;
}

/** 当前登记的 worktree 条数（脚本应当一条都不留） */
const worktreeCount = (repo: string) => git(repo, ['worktree', 'list']).split('\n').filter(Boolean).length;

/**
 * a 是否已经是 b 的祖先（用退出码判定，`--is-ancestor` 成功时无输出）。
 *
 * @param repo 仓库路径
 * @param a 候选祖先
 * @param b 候选后代
 */
function isAncestor(repo: string, a: string, b: string): boolean {
  try {
    git(repo, ['merge-base', '--is-ancestor', a, b]);
    return true;
  } catch {
    return false;
  }
}

/**
 * 带 `HUSKY=1` 跑 git，保证钩子真的被执行（CI 里常见 HUSKY=0 全局关掉）。
 *
 * @param repo 仓库路径
 * @param args git 参数
 */
function gitWithHooks(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HUSKY: '1' },
  }).trim();
}

beforeAll(() => {
  created.length = 0;
});

afterAll(() => {
  created.forEach(dir => rmSync(dir, { recursive: true, force: true }));
});

describe('scripts/auto-merge-main.js', () => {
  it('干净合并：目标分支拿到 main 的内容，HEAD 与临时 worktree 都不受影响', () => {
    const repo = makeRepo();
    const before = git(repo, ['rev-parse', 'feature-x']);

    const result = runScript(repo);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain('feature-x');

    const after = git(repo, ['rev-parse', 'feature-x']);
    expect(after).not.toBe(before);
    // main 的两个提交都进来了：改过的 shared.txt、新增的 from-main.txt，分支自己的文件也在
    expect(git(repo, ['show', `${after}:shared.txt`])).toBe('from main');
    git(repo, ['cat-file', '-e', `${after}:branch-only.txt`]);
    git(repo, ['cat-file', '-e', `${after}:from-main.txt`]);
    // 脚本不 checkout：主工作区还在 main
    expect(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
    expect(worktreeCount(repo)).toBe(1);
  });

  it('冲突：分支指针一格没动、不留合并中间态，并把冲突文件名报出来', () => {
    const repo = makeRepo({ conflict: true });
    const before = git(repo, ['rev-parse', 'feature-x']);

    const result = runScript(repo);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('shared.txt');
    expect(result.stdout).toContain('abort');

    expect(git(repo, ['rev-parse', 'feature-x'])).toBe(before);
    expect(gitMaybe(repo, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).toBeNull();
    expect(git(repo, ['status', '--porcelain'])).toBe('');
    expect(worktreeCount(repo)).toBe(1);
  });

  it('已包含 main 的分支不产生提交，第二次运行只报「已包含」', () => {
    const repo = makeRepo();
    runScript(repo);
    const sha = git(repo, ['rev-parse', 'feature-x']);
    const count = worktreeCount(repo);

    const result = runScript(repo);
    expect(result.stdout).toContain('已包含 main');
    expect(git(repo, ['rev-parse', 'feature-x'])).toBe(sha);
    expect(worktreeCount(repo)).toBe(count);
  });

  it('--dry-run 只报告，不移动任何分支', () => {
    const repo = makeRepo();
    const before = git(repo, ['rev-parse', 'feature-x']);

    const result = runScript(repo, ['--dry-run']);
    expect(result.stdout).toContain('待合并 main');
    expect(git(repo, ['rev-parse', 'feature-x'])).toBe(before);
    expect(worktreeCount(repo)).toBe(1);
  });

  it('禁推清单优先于 --push：Feature-pa 即便有上游也不推', () => {
    const repo = makeRepo({ branch: 'Feature-pa', withRemote: true, upstreamBranch: 'Feature-pa' });
    const remoteBefore = remoteSha(repo, 'Feature-pa');
    expect(remoteBefore).toBeTruthy();

    const result = runScript(repo, ['--push']);
    expect(result.stdout).toContain('禁推清单');
    // 本地合并照常发生，远端一格没动
    expect(git(repo, ['rev-parse', 'Feature-pa'])).not.toBe(remoteBefore);
    expect(remoteSha(repo, 'Feature-pa')).toBe(remoteBefore);
  });

  it('无上游的分支不会被推送，也不会被顺手创建远端分支', () => {
    const repo = makeRepo({ withRemote: true });

    const result = runScript(repo, ['--push']);
    expect(result.stdout).toContain('没有上游分支');
    expect(remoteSha(repo, 'main')).toBeTruthy();
    expect(remoteSha(repo, 'feature-x')).toBeNull();
  });

  it('release-please 分支不作为目标；被其他 worktree 占用的分支只跳过', () => {
    const repo = makeRepo();
    const machine = 'release-please--branches--main--components--account-password-helper';
    git(repo, ['branch', machine]);
    const before = git(repo, ['rev-parse', 'feature-x']);
    const wtRoot = mkdtempSync(path.join(os.tmpdir(), 'aph-automerge-wt-'));
    created.push(wtRoot);
    // worktree add 要求目标目录不存在，所以在临时根目录下开一个子路径
    const occupiedDir = path.join(wtRoot, 'wt');
    git(repo, ['worktree', 'add', occupiedDir, 'feature-x']);

    const stdout = runScript(repo, ['--only', `feature-x,${machine}`]).stdout;
    expect(stdout).toContain('已在其他 worktree 检出');
    expect(stdout).toContain('机器分支');
    expect(stdout).toContain('跳过 release-please');
    expect(git(repo, ['rev-parse', 'feature-x'])).toBe(before);
    expect(git(repo, ['rev-parse', machine])).toBe(git(repo, ['rev-parse', 'main']));
  });

  it('接线：在 main 上完成合并后，husky 的 post-merge 自动把 main 同步给其他分支', () => {
    // 20s 预算：这条用例是嵌套的（merge → 钩子 → 脚本 → 每个分支再开 worktree 合并），
    // 单跑 3.2s，全量并行时实测 5.3s 会撞默认 5s 上限（与 PBKDF2 那批用例同一类问题）。
    // 真源核对：钩子必须同时具备「只在 main 上跑」的门和调用脚本，缺一条整条链就是死的
    // （旧版正是死在这里——`.git/hooks/post-merge` 写得没问题，但 core.hooksPath 让它永不执行）。
    const hook = readFileSync(path.join(ROOT, '.husky', 'post-merge'), 'utf8');
    expect(hook).toContain('= "main"');
    expect(hook).toContain('scripts/auto-merge-main.js');

    const repo = makeRepo();
    expect(isAncestor(repo, 'main', 'feature-x')).toBe(false);

    // 复刻 husky v9 的分发：core.hooksPath 指向 .husky/_，其中可执行的 shim 再 `sh -e` 跑入库的 .husky/post-merge
    mkdirSync(path.join(repo, '.husky', '_'), { recursive: true });
    mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    copyFileSync(SCRIPT, path.join(repo, 'scripts', 'auto-merge-main.js'));
    writeFileSync(path.join(repo, '.husky', 'post-merge'), hook);
    writeFileSync(path.join(repo, '.husky', '_', 'post-merge'), '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n');
    writeFileSync(
      path.join(repo, '.husky', '_', 'h'),
      [
        '#!/usr/bin/env sh',
        'n=$(basename "$0")',
        's=$(dirname "$(dirname "$0")")/$n',
        '[ ! -f "$s" ] && exit 0',
        '[ "${HUSKY-}" = "0" ] && exit 0',
        'sh -e "$s" "$@"',
        'exit $?',
        '',
      ].join('\n'),
    );
    chmodSync(path.join(repo, '.husky', '_', 'post-merge'), 0o755);
    git(repo, ['config', 'core.hooksPath', '.husky/_']);
    // 钩子跑的是 `node scripts/auto-merge-main.js`，cwd 为仓库根 —— node 必须在这条 PATH 上
    const nodeDir = path.dirname(process.execPath);
    process.env.PATH = `${nodeDir}:${process.env.PATH ?? ''}`;

    // 在 main 上造一次真实的合并提交：--no-ff 保证产生 merge commit，post-merge 才会触发
    git(repo, ['checkout', '-q', '-b', 'side']);
    writeFileSync(path.join(repo, 'side.txt'), 'side\n');
    git(repo, ['add', 'side.txt']);
    git(repo, ['commit', '-q', '-m', 'side commit']);
    git(repo, ['checkout', '-q', 'main']);
    const mergeOut = gitWithHooks(repo, ['merge', '--no-ff', '-q', '-m', 'merge side into main', 'side']);

    // 钩子驱动的同步确实发生了：feature-x 现在包含 main
    expect(isAncestor(repo, 'main', 'feature-x'), mergeOut).toBe(true);
    // 且同步没有把主工作区搬走，也没有留下临时 worktree
    expect(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
    expect(worktreeCount(repo)).toBe(1);
  }, 20_000);

  it('门仍有牙：主工作区正卡在未解决的冲突里时拒绝同步（合并完成后的 MERGE_HEAD 不算）', () => {
    const repo = makeRepo({ conflict: true });
    // 再造一条「落后但能干净合并」的分支：守卫一旦失效它会先被同步掉，下面那条断言才有牙
    git(repo, ['branch', 'feature-y', 'main~2']);
    git(repo, ['checkout', '-q', 'feature-x']);
    try {
      git(repo, ['merge', '--no-ff', '-q', 'main']);
    } catch {
      /* 必然非 0 退出：人正卡在冲突里 */
    }
    expect(git(repo, ['diff', '--name-only', '--diff-filter=U'])).toContain('shared.txt');

    const result = runScript(repo);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('未解决的冲突');
    expect(isAncestor(repo, 'main', 'feature-y')).toBe(false);
  });
});
