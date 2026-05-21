#!/bin/bash

# 自动合并 main 分支到其他分支的脚本
# 使用方法：在 main 分支完成合并后运行此脚本

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== 自动合并 main 分支到其他分支 ===${NC}"

# 获取当前分支
CURRENT_BRANCH=$(git branch --show-current)

# 确保当前在 main 分支
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${RED}错误: 当前不在 main 分支上${NC}"
    exit 1
fi

# 获取所有本地分支（排除 main 和当前分支）
BRANCHES=$(git branch --format='%(refname:short)' | grep -v "^main$")

if [ -z "$BRANCHES" ]; then
    echo -e "${YELLOW}没有找到需要合并的其他分支${NC}"
    exit 0
fi

echo -e "${GREEN}找到以下需要合并的分支:${NC}"
echo "$BRANCHES" | while read branch; do
    echo "  - $branch"
done
echo ""

# 记录合并结果
SUCCESS_COUNT=0
FAIL_COUNT=0
FAILED_BRANCHES=()

# 遍历每个分支进行合并
for BRANCH in $BRANCHES; do
    echo -e "${YELLOW}正在处理分支: $BRANCH${NC}"
    
    # 切换到目标分支
    if ! git checkout "$BRANCH" 2>/dev/null; then
        echo -e "${RED}  错误: 无法切换到分支 $BRANCH${NC}"
        FAIL_COUNT=$((FAIL_COUNT + 1))
        FAILED_BRANCHES+=("$BRANCH")
        continue
    fi
    
    # 拉取最新代码（可选）
    echo "  拉取最新代码..."
    if ! git pull origin "$BRANCH" 2>/dev/null; then
        echo -e "${YELLOW}  警告: 拉取 $BRANCH 失败，继续合并${NC}"
    fi
    
    # 执行合并
    echo "  合并 main 分支..."
    if git merge main --no-edit; then
        echo -e "${GREEN}  成功: main 已合并到 $BRANCH${NC}"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        
        # 推送合并结果（可选）
        echo "  推送合并结果..."
        if git push origin "$BRANCH" 2>/dev/null; then
            echo -e "${GREEN}  成功: $BRANCH 已推送到远程${NC}"
        else
            echo -e "${YELLOW}  警告: 推送 $BRANCH 失败${NC}"
        fi
    else
        echo -e "${RED}  错误: 合并 main 到 $BRANCH 失败（可能存在冲突）${NC}"
        echo -e "${YELLOW}  请手动解决冲突后继续${NC}"
        FAIL_COUNT=$((FAIL_COUNT + 1))
        FAILED_BRANCHES+=("$BRANCH")
        
        # 取消合并
        git merge --abort 2>/dev/null || true
    fi
    
    echo ""
done

# 切换回 main 分支
echo -e "${YELLOW}切换回 main 分支...${NC}"
git checkout main

# 输出汇总报告
echo ""
echo -e "${GREEN}=== 合并完成 ===${NC}"
echo -e "成功: ${GREEN}$SUCCESS_COUNT${NC} 个分支"
echo -e "失败: ${RED}$FAIL_COUNT${NC} 个分支"

if [ $FAIL_COUNT -gt 0 ]; then
    echo -e "${RED}失败的分支:${NC}"
    for branch in "${FAILED_BRANCHES[@]}"; do
        echo "  - $branch"
    done
    echo ""
    echo -e "${YELLOW}提示: 请手动处理失败分支的合并${NC}"
fi
