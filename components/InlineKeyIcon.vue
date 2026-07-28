<template>
  <svg
    class="inline-key-icon"
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
    <circle
      cx="7.5"
      cy="15.5"
      r="4.5"
    />
    <path d="M10.7 12.3 21 2" />
    <path d="m16 7 3 3" />
  </svg>
</template>

<script setup lang="ts">
/**
 * 内联填充钥匙图标（登录框内钥匙触发视觉）
 * 与 entrypoints/content/inlineDropdown/InlineFillDropdown.ts 的 KEY_ICON 保持一致，修改请同步。
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
.inline-key-icon {
  display: inline-block;
  vertical-align: middle;
}
</style>
