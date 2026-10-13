<template>
  <span
    class="help-group-icon"
    :class="kind"
    aria-hidden="true"
  >
    <svg
      v-if="kind === 'security'"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
    <svg
      v-else-if="kind === 'basic'"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
    <svg
      v-else-if="kind === 'data'"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <ellipse
        cx="12"
        cy="5"
        rx="9"
        ry="3"
      />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
    <svg
      v-else
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle
        cx="12"
        cy="12"
        r="3"
      />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
      />
    </svg>
  </span>
</template>

<script setup lang="ts">
/**
 * 帮助分组标题前的小图标
 *
 * 侧边栏帮助弹窗与 Options「使用指引」页共用同一套四色图形，保证两处视觉一致。
 * 图标为纯装饰，分组语义由旁边的标题文本承载，故整块 `aria-hidden`。
 *
 * 样式随本组件自带：Vue 只把父组件的 scoped 标识加到子组件根节点，
 * 放在调用方会随抽离而静默失效，因此颜色与尺寸的责任边界在这里。
 * 本组件刻意不引入 i18n（同 `ShortcutKeyCap.vue`），文案一律由调用方传入。
 */
defineProps<{
  /** 分组类别，决定配色与图形 */
  kind: 'security' | 'basic' | 'data' | 'config';
}>();
</script>

<style scoped>
.help-group-icon {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
}

.help-group-icon.security {
  color: #059669;
  background: rgb(16 185 129 / 10%);
}

.help-group-icon.basic {
  color: #4e88ff;
  background: rgb(78 136 255 / 10%);
}

.help-group-icon.data {
  color: #7c3aed;
  background: rgb(139 92 246 / 10%);
}

.help-group-icon.config {
  color: #d97706;
  background: rgb(245 158 11 / 10%);
}
</style>
