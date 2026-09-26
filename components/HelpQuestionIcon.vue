<template>
  <!-- 问号图标（outline 风格） -->
  <svg
    viewBox="1.715 1.715 20.57 20.57"
    :width="size"
    :height="size"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="9"
    />
    <path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.24c-.7.34-1.1.95-1.1 1.76V14" />
    <circle
      cx="12"
      cy="17"
      r="0.6"
      fill="currentColor"
      stroke="none"
    />
  </svg>
</template>

<script setup lang="ts">
/**
 * 帮助问号图标（侧边栏头部「使用帮助」按钮）
 *
 * 与 {@link GithubIcon} 同一口径：构建期静态 SVG 走模板，不再运行时 `v-html` 注入。
 * 视觉权重与 GitHub / Setting 图标一致，颜色由 `currentColor` 继承。
 */
withDefaults(defineProps<{ size?: number }>(), { size: 18 });
</script>
