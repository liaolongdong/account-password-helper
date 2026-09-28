<template>
  <!-- 外层 span 承担无障碍名：kbd 在 HTML-AAM 中映射为 generic，不支持 aria-label，
       故用 role="img" 把整串按键作为一个具名整体朗读；无 label 时退化为纯文本 kbd -->
  <span
    class="shortcut-keycap"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
  >
    <kbd
      class="shortcut-keycap__key"
      :class="{ 'shortcut-keycap__key--muted': muted }"
      :aria-hidden="label ? 'true' : undefined"
      >{{ text }}</kbd
    >
  </span>
</template>

<script setup lang="ts">
/**
 * 快捷键键帽展示组件
 *
 * 供 Options 快捷键弹窗与侧边栏帮助弹窗共用，视觉沿用 Popup 既有键帽语言
 * （等宽字体 + 1px 边框 + 底部 1px 投影），颜色改走 `--aph-*` 令牌以跟随 6 套主题。
 *
 * 本组件刻意不引入 i18n：`tests/utils/i18nBundles.test.ts` 的 `HELP_DIALOG_FILES`
 * 只扫描 `HelpDialog.vue`，组件内调用 `t()` 会绕过 key 覆盖率校验，
 * 并在侧边栏懒加载 chunk 中渲染出原始 key。所有文案由调用方翻译后经 props 传入。
 */
defineProps<{
  /** 已格式化的按键文本，如 `Ctrl⇧F` */
  text: string;
  /** 未生效态：降低视觉权重（灰字 + 虚线边框），状态语义由 label 承载 */
  muted?: boolean;
  /** 无障碍名，由调用方传入已翻译文案，如「快速填充，快捷键 Ctrl Shift F，已生效」 */
  label?: string;
}>();
</script>

<style scoped>
.shortcut-keycap {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
}

.shortcut-keycap__key {
  padding: 3px 6px;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--aph-text-secondary);
  white-space: nowrap;
  background: var(--aph-bg-hover);
  border: 1px solid var(--aph-border-light);
  border-radius: 4px;
  box-shadow: 0 1px 0 rgb(0 0 0 / 12%);
}

/* 未生效态不只靠颜色表达：同步改为虚线边框，色觉障碍用户亦可区分 */
.shortcut-keycap__key--muted {
  color: var(--aph-text-muted);
  background: transparent;
  border-style: dashed;
  box-shadow: none;
}
</style>
