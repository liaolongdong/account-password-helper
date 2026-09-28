<template>
  <div
    v-if="hidden > 0"
    class="health-show-more"
  >
    <button
      type="button"
      class="health-show-more__btn"
      @click="$emit('more')"
    >
      <el-icon class="health-show-more__icon"><ArrowDownBold /></el-icon>
      {{ t('health.showMore', { count: hidden }) }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ArrowDownBold } from '@element-plus/icons-vue';
import { useI18n } from '@/utils/i18n';

/**
 * 健康明细面板的「继续展开」读数按钮
 *
 * 只做一件事：把「这一屏还有多少行没渲染」说清楚，并把用户的展开意图交给父组件。
 * 预算状态仍由 `PasswordHealthDialog` 持有，因此它不持有任何响应式状态。
 *
 * 为什么用裸 `button` 而不是 `el-button link`：管理页全局样式给所有
 * `.el-button--primary` 强加了实心主色背景，link 型按钮必须在**每个**弹窗里逐层
 * `:deep()` 抵消才可见（见 `PasswordHealthDialog` 里的同类修正）。这里自带一处
 * scoped 样式即可，不必再依赖父组件的 `:deep()` 恰好覆盖到子组件内部的节点。
 */
defineProps<{
  /** 预算之外尚未渲染的行数；`<= 0` 时整个组件不渲染 */
  hidden: number;
}>();

defineEmits<{
  /** 请求再展开一档 */
  more: [];
}>();

const { t } = useI18n();
</script>

<style scoped>
.health-show-more {
  display: flex;
  justify-content: center;
  padding-top: 2px;
}

.health-show-more__btn {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  padding: 4px 6px;
  font-size: 13px;
  color: var(--aph-primary);
  cursor: pointer;
  background: none;
  border: none;
  border-radius: 4px;
}

.health-show-more__btn:hover {
  text-decoration: underline;
}

.health-show-more__btn:focus-visible {
  outline: 2px solid var(--aph-primary);
  outline-offset: 1px;
}

.health-show-more__icon {
  font-size: 12px;
}
</style>
