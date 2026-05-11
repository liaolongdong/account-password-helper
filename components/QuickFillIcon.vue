<template>
  <svg
    class="quick-fill-icon"
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect
      x="3"
      y="3"
      width="18"
      height="18"
      rx="2"
      ry="2"
    />
    <line
      x1="9"
      y1="3"
      x2="9"
      y2="21"
    />
    <polyline points="14 9 17 12 14 15" />
  </svg>
</template>

<script setup lang="ts">
/**
 * 快速填充图标（侧边栏展开视觉）
 * 与 entrypoints/content/floatingButtons/icons.ts 的 sidebarOpenIcon 保持一致，修改请同步。
 * 颜色通过 currentColor 跟随父级 CSS color 控制。
 */
withDefaults(
  defineProps<{
    /** 图标尺寸，支持数字（px）或 CSS 尺寸字符串，默认 1em 跟随字号 */
    size?: string | number;
  }>(),
  { size: '1em' },
);
</script>

<style scoped>
.quick-fill-icon {
  display: inline-block;
  vertical-align: middle;
}
</style>
