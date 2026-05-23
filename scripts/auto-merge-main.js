#!/usr/bin/env node

/**
 * 自动合并 main 分支到其他分支的脚本
 * 使用方法：在 main 分支完成合并后运行此脚本
 *
 * 功能：
 * 1. 仅在 main 分支执行
 * 2. 自动发现所有本地分支（排除 main）
 * 3. 区分远程分支和纯本地分支
 * 4. 远程分支：合并成功后自动推送
 * 5. 本地分支：仅执行合并操作
 * 6. 冲突时自动中止并记录
 */

const { execSync } = require('child_process');
const path = require('path');

// 颜色定义
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function exec(command, options = {}) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    }).trim();
  } catch (error) {
    if (options.ignoreError) {
      return null;
    }
    throw error;
  }
}

/**
 * 获取所有本地分支（排除 main）
 */
function getLocalBranches() {
  const output = exec('git branch --format="%(refname:short)"');
  return output
    .split('\n')
    .map(branch => branch.trim())
    .filter(branch => branch && branch !== 'main');
}

/**
 * 获取所有远程分支
 */
function getRemoteBranches() {
  const output = exec('git branch -r --format="%(refname:short)"', { ignoreError: true });
  if (!output) return [];

  return output
    .split('\n')
    .map(branch => branch.trim())
    .filter(branch => branch && !branch.includes('HEAD'))
    .map(branch => branch.replace('origin/', ''));
}

/**
 * 检查分支是否有对应的远程分支
 */
function hasRemoteBranch(branchName, remoteBranches) {
  return remoteBranches.includes(branchName);
}

/**
 * 检查当前是否在 main 分支
 */
function checkCurrentBranch() {
  const currentBranch = exec('git branch --show-current');
  if (currentBranch !== 'main') {
    log(`错误: 当前不在 main 分支上（当前在 ${currentBranch}）`, 'red');
    process.exit(1);
  }
}

/**
 * 检查工作区是否干净
 */
function checkWorkingTree() {
  const status = exec('git status --porcelain');
  if (status) {
    log('警告: 工作区有未提交的变更，建议先提交或暂存', 'yellow');
    return false;
  }
  return true;
}

/**
 * 合并 main 到指定分支
 */
function mergeToBranch(branchName, hasRemote) {
  log(`\n${colors.cyan}正在处理分支: ${branchName}${colors.reset}`);

  // 切换到目标分支
  log(`  切换到分支 ${branchName}...`);
  try {
    exec(`git checkout "${branchName}"`);
  } catch (error) {
    log(`  错误: 无法切换到分支 ${branchName}`, 'red');
    return { success: false, reason: '切换失败' };
  }

  // 如果是远程分支，先拉取最新代码
  if (hasRemote) {
    log(`  拉取最新代码...`);
    try {
      exec(`git pull origin "${branchName}"`, { ignoreError: true });
    } catch (error) {
      log(`  警告: 拉取 ${branchName} 失败，继续合并`, 'yellow');
    }
  }

  // 执行合并
  log(`  合并 main 分支...`);
  try {
    exec(`git merge main --no-edit`);
    log(`  ✓ 成功: main 已合并到 ${branchName}`, 'green');

    // 只有远程分支才推送
    if (hasRemote) {
      log(`  推送合并结果到远程...`);
      try {
        exec(`git push origin "${branchName}"`);
        log(`  ✓ 成功: ${branchName} 已推送到远程`, 'green');
      } catch (error) {
        log(`  ⚠ 警告: 推送 ${branchName} 失败`, 'yellow');
        return { success: true, pushed: false, reason: '推送失败' };
      }
    } else {
      log(`  ℹ 本地分支，跳过推送`, 'cyan');
    }

    return { success: true, pushed: hasRemote };
  } catch (error) {
    log(`  ✗ 错误: 合并 main 到 ${branchName} 失败（可能存在冲突）`, 'red');
    log(`  请手动解决冲突后继续`, 'yellow');

    // 取消合并
    exec('git merge --abort', { ignoreError: true });

    return { success: false, reason: '合并冲突' };
  }
}

/**
 * 主函数
 */
async function main() {
  log('=== 自动合并 main 分支到其他分支 ===', 'green');
  console.log('');

  // 1. 检查当前分支
  checkCurrentBranch();

  // 2. 检查工作区
  checkWorkingTree();

  // 3. 获取分支列表
  const localBranches = getLocalBranches();
  const remoteBranches = getRemoteBranches();

  if (localBranches.length === 0) {
    log('没有找到需要合并的其他分支', 'yellow');
    return;
  }

  log(`找到 ${localBranches.length} 个需要合并的分支:`, 'green');
  localBranches.forEach(branch => {
    const hasRemote = hasRemoteBranch(branch, remoteBranches);
    log(`  - ${branch} ${hasRemote ? '(远程分支)' : '(本地分支)'}`, 'cyan');
  });
  console.log('');

  // 4. 遍历合并
  const results = {
    success: 0,
    successWithPush: 0,
    successLocalOnly: 0,
    failed: 0,
    failedBranches: [],
  };

  for (const branch of localBranches) {
    const hasRemote = hasRemoteBranch(branch, remoteBranches);
    const result = mergeToBranch(branch, hasRemote);

    if (result.success) {
      results.success++;
      if (result.pushed) {
        results.successWithPush++;
      } else {
        results.successLocalOnly++;
      }
    } else {
      results.failed++;
      results.failedBranches.push({ branch, reason: result.reason });
    }
  }

  // 5. 切换回 main 分支
  log('\n切换回 main 分支...', 'yellow');
  exec('git checkout main');

  // 6. 输出汇总报告
  console.log('');
  log('=== 合并完成 ===', 'green');
  log(`成功: ${results.success} 个分支`, 'green');
  log(`  - 已推送到远程: ${results.successWithPush} 个`, 'green');
  log(`  - 仅本地合并: ${results.successLocalOnly} 个`, 'cyan');
  log(`失败: ${results.failed} 个分支`, results.failed > 0 ? 'red' : 'green');

  if (results.failed > 0) {
    log('\n失败的分支:', 'red');
    results.failedBranches.forEach(({ branch, reason }) => {
      log(`  - ${branch} (${reason})`, 'red');
    });
    console.log('');
    log('提示: 请手动处理失败分支的合并', 'yellow');
  }
}

// 运行主函数
main().catch(error => {
  log(`\n发生错误: ${error.message}`, 'red');
  process.exit(1);
});
