<template>
  <section
    class="growth"
    :class="`growth--${mode}`"
    :aria-labelledby="titleId"
  >
    <span
      class="growth__icon"
      aria-hidden="true"
    >
      <svg
        v-if="mode === 'whats-new'"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
        <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
      </svg>
      <svg
        v-else
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polygon
          points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
        />
      </svg>
    </span>

    <div class="growth__body">
      <h3
        :id="titleId"
        class="growth__title"
      >
        {{ title }}
      </h3>
      <p class="growth__desc">{{ description }}</p>
      <ul
        v-if="mode === 'whats-new'"
        class="growth__list"
      >
        <li
          v-for="item in items"
          :key="item"
        >
          {{ item }}
        </li>
      </ul>
    </div>

    <div class="growth__actions">
      <button
        type="button"
        class="growth__cta"
        @click="$emit('cta')"
      >
        {{ ctaLabel }}
      </button>
      <button
        type="button"
        class="growth__dismiss"
        @click="$emit('dismiss')"
      >
        {{ dismissLabel }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/utils/i18n';

/**
 * 更新提示 / 一次性评价引导
 *
 * 纯展示组件：只负责渲染当前模式与发出 cta / dismiss 事件，不读存储、不打开外链。
 * 展示条件与「只展示一次」的持久化由 Options 页面统一决定，避免组件各自维护一套状态。
 *
 * What's New 的三条亮点是版本相关文案，发版时同步修改 `options.growth.whatsNew.item1..3`。
 */
const props = defineProps<{
  mode: 'whats-new' | 'review';
  /** 当前扩展版本号，用于更新卡片文案 */
  version: string;
}>();

defineEmits<{
  cta: [];
  dismiss: [];
}>();

const { t } = useI18n();
const titleId = 'growth-prompt-title';
const keyPrefix = computed(() => (props.mode === 'whats-new' ? 'options.growth.whatsNew' : 'options.growth.review'));
const title = computed(() => t(`${keyPrefix.value}.title`));
const description = computed(() => t(`${keyPrefix.value}.desc`, { version: props.version }));
const ctaLabel = computed(() => t(`${keyPrefix.value}.cta`));
const dismissLabel = computed(() => t(`${keyPrefix.value}.dismiss`));
const items = computed(() => [
  t('options.growth.whatsNew.item1'),
  t('options.growth.whatsNew.item2'),
  t('options.growth.whatsNew.item3'),
]);
</script>

<style scoped>
.growth {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 16px 18px;
  margin: 0 0 16px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.growth--review {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-7);
}

.growth__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 34px;
  height: 34px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-radius: 9px;
}

.growth--review .growth__icon {
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}

.growth__body {
  flex: 1;
  min-width: 0;
}

.growth__title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.growth__desc {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.growth__list {
  padding-left: 18px;
  margin: 8px 0 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--el-text-color-regular);
}

.growth__actions {
  display: flex;
  flex: none;
  gap: 8px;
  align-items: center;
  padding-top: 2px;
}

.growth__cta {
  padding: 6px 12px;
  font-size: 12.5px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  background: var(--el-color-primary);
  border: none;
  border-radius: 6px;
}

.growth__cta:hover {
  background: var(--el-color-primary-dark-2);
}

.growth__dismiss {
  padding: 6px 8px;
  font-size: 12.5px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 6px;
}

.growth__dismiss:hover {
  color: var(--el-color-primary);
  background: var(--el-fill-color-light);
}

.growth__cta:focus-visible,
.growth__dismiss:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

@media (width <= 720px) {
  .growth {
    flex-wrap: wrap;
  }

  .growth__actions {
    justify-content: flex-end;
    width: 100%;
  }
}
</style>
