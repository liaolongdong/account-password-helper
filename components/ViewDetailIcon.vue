<template>
  <!--
    外框 + 标题栏 + 一行内容：一张「条目详情卡」。
    描边宽度与 Element Plus 线性图标同档（24 网格上 2 单位 ≈ 12px 下 1px），
    颜色走 currentColor，因此悬浮变色、换肤、禁用态都跟随按钮，无需额外样式。
  -->
  <svg
    class="view-detail-icon"
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect
      x="2.5"
      y="3.5"
      width="19"
      height="17"
      rx="2.5"
    />
    <path d="M2.5 8.5h19" />
    <path d="M6 14.5h9" />
  </svg>
</template>

<script setup lang="ts">
/**
 * 「查看详情」图标（密码列表行操作列）
 *
 * 为什么不用现成图标，见 `tests/architecture/viewDetailIconSemantics.test.ts` 与
 * `docs/ARCHITECTURE.md` 第 23 节：眼睛在本产品里恒为「显示 / 隐藏机密」，
 * `Document` 已表示「文件」且与右边的 `CopyDocument` 近乎同形，
 * 而圆圈 i（`InfoFilled`）读起来是「提示」而不是「查看详情」，且实心圆盘比同排四颗线性图标重。
 *
 * 图形本身受 Material `detail_view` 启发：带标题栏的面板 + 内容行，
 * 对应的正是点击后展开的那只只读详情抽屉。
 */
</script>

<style scoped>
.view-detail-icon {
  display: inline-block;
  vertical-align: middle;
}
</style>
