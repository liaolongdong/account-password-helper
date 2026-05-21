# 自动合并 Main 分支脚本

## 功能说明

该脚本用于在 main 分支完成合并后，自动将 main 分支的变更合并到其他所有本地分支。

**核心特性**：

- 智能区分远程分支和纯本地分支
- 远程分支：合并成功后自动推送到远程
- 本地分支：仅执行合并操作，不推送

## 文件结构

```
scripts/
  ├── auto-merge-main.js          # Node.js 主脚本（推荐使用）
  ├── auto-merge-main.sh          # Shell 脚本版本（已废弃）
  └── README-auto-merge.md        # 说明文档
.git/hooks/
  └── post-merge                  # Git Hook（自动触发）
```

## 使用方法

### 方式一：自动触发（推荐）

1. 在 main 分支执行合并操作：

   ```bash
   git checkout main
   git merge <some-branch>
   ```

2. 合并完成后，`post-merge` hook 会自动触发，将 main 合并到其他分支

### 方式二：手动执行

```bash
# 确保当前在 main 分支
git checkout main

# 运行脚本
node scripts/auto-merge-main.js
```

## 脚本功能

1. **安全检查**：确保当前在 main 分支
2. **工作区检查**：检测是否有未提交的变更
3. **分支扫描**：自动发现所有本地分支（排除 main）
4. **远程检测**：智能识别哪些分支有对应的远程分支
5. **逐个合并**：将 main 分支合并到每个分支
6. **智能推送**：
   - 远程分支：合并成功后自动推送到远程仓库
   - 本地分支：仅执行合并操作，不推送
7. **冲突处理**：遇到冲突时自动中止合并，避免破坏工作区
8. **结果报告**：显示成功/失败的分支列表，区分已推送和仅本地合并

## 输出示例

```
=== 自动合并 main 分支到其他分支 ===
找到 4 个需要合并的分支:
  - Feature-ai-tip (远程分支)
  - Feature-pa (远程分支)
  - feature-fixbug (本地分支)
  - feature-opt (远程分支)

正在处理分支: Feature-ai-tip
  切换到分支 Feature-ai-tip...
  拉取最新代码...
  合并 main 分支...
  ✓ 成功: main 已合并到 Feature-ai-tip
  推送合并结果到远程...
  ✓ 成功: Feature-ai-tip 已推送到远程

正在处理分支: feature-fixbug
  切换到分支 feature-fixbug...
  合并 main 分支...
  ✓ 成功: main 已合并到 feature-fixbug
  ℹ 本地分支，跳过推送

...

=== 合并完成 ===
成功: 4 个分支
  - 已推送到远程: 3 个
  - 仅本地合并: 1 个
失败: 0 个分支
```

## 注意事项

1. **冲突处理**：如果合并时出现冲突，脚本会：
   - 显示错误信息
   - 自动执行 `git merge --abort` 取消合并
   - 记录失败分支并在最后汇总报告
   - 您需要手动解决冲突

2. **智能推送**：
   - **远程分支**：脚本会先拉取最新代码，合并成功后自动推送到远程仓库
   - **本地分支**：仅执行合并操作，不会尝试推送（避免错误）
   - 如果推送失败会显示警告但继续处理其他分支

3. **分支状态**：脚本会切换分支，请确保工作区是干净的（没有未提交的变更）

4. **环境要求**：需要 Node.js 环境（项目已具备）

## 自定义配置

### 排除特定分支

编辑 `scripts/auto-merge-main.js`，在 `getLocalBranches()` 函数中添加过滤逻辑：

```javascript
function getLocalBranches() {
  const output = exec('git branch --format="%(refname:short)"');
  return output
    .split('\n')
    .map(branch => branch.trim())
    .filter(branch => branch && branch !== 'main')
    .filter(branch => !branch.startsWith('experimental-')); // 排除特定前缀的分支
}
```

### 禁用工作区检查

如果您希望在有未提交变更时仍然执行合并，可以注释掉工作区检查：

```javascript
// 2. 检查工作区
// checkWorkingTree();
```

## 故障排查

### 脚本没有自动执行

1. 检查 hook 文件是否存在：

   ```bash
   ls -la .git/hooks/post-merge
   ```

2. 手动测试 hook：

   ```bash
   bash .git/hooks/post-merge
   ```

3. 检查 Node.js 是否可用：
   ```bash
   node --version
   ```

### 合并失败

1. 检查是否有未提交的变更：

   ```bash
   git status
   ```

2. 手动合并失败分支：
   ```bash
   git checkout <branch-name>
   git merge main
   # 解决冲突后
   git add .
   git commit
   ```

### 推送失败

1. 检查远程分支是否存在：

   ```bash
   git branch -r | grep <branch-name>
   ```

2. 手动推送：
   ```bash
   git checkout <branch-name>
   git push origin <branch-name>
   ```

## 安全建议

1. 在首次使用前，建议先在测试分支验证脚本功能
2. 重要分支建议先备份或使用保护分支策略
3. 定期检查合并结果，确保没有意外覆盖
