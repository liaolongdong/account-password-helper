<template>
  <svg
    class="brand-logo"
    viewBox="0 0 128 128"
    :width="size"
    :height="size"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <!-- 钥匙头：圆环（evenodd 形成透明钥匙孔） -->
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M64 26a20 20 0 1 0 0 40 20 20 0 0 0 0-40Zm0 12a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z"
    />
    <!-- 钥匙杆 -->
    <rect
      x="59"
      y="62"
      width="10"
      height="48"
      rx="4"
    />
    <!-- 短齿 -->
    <rect
      x="69"
      y="86"
      width="8"
      height="6"
      rx="1.5"
    />
    <!-- 长齿（最底） -->
    <rect
      x="69"
      y="98"
      width="11"
      height="6"
      rx="1.5"
    />
  </svg>
</template>

<script setup lang="ts">
/**
 * 品牌 Logo：纯钥匙主视觉（与 assets/icons/variants/01-key-pure.svg 同骨架，
 * 去掉蓝色圆角底），颜色通过 currentColor 跟随父级 CSS color 控制。
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
.brand-logo {
  display: inline-block;
  vertical-align: middle;
}
</style>
