<template>
  <!-- 安全盾牌图标 - 用于安全声明场景 -->
  <svg
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
    <path
      d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
    />
    <path d="m9 12 2 2 4-4" />
  </svg>
</template>

<script setup lang="ts">
/**
 * 安全盾牌图标 - 用于安全声明场景
 * 颜色通过 currentColor 继承；尺寸由 props 控制
 */
withDefaults(defineProps<{ size?: number }>(), { size: 18 });
</script>
