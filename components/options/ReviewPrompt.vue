<template>
  <section
    class="review-prompt"
    aria-labelledby="review-prompt-title"
  >
    <span
      class="review-prompt__icon"
      aria-hidden="true"
    >
      <svg
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

    <div class="review-prompt__body">
      <h3
        id="review-prompt-title"
        class="review-prompt__title"
      >
        {{ t('options.growth.review.title') }}
      </h3>
      <p class="review-prompt__desc">{{ t('options.growth.review.desc') }}</p>
    </div>

    <div class="review-prompt__actions">
      <button
        type="button"
        class="review-prompt__cta"
        @click="$emit('cta')"
      >
        {{ t('options.growth.review.cta') }}
      </button>
      <button
        type="button"
        class="review-prompt__snooze"
        @click="$emit('snooze')"
      >
        {{ t('options.growth.review.snooze') }}
      </button>
      <button
        type="button"
        class="review-prompt__dismiss"
        @click="$emit('dismiss')"
      >
        {{ t('options.growth.review.dismiss') }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from '@/utils/i18n';

/**
 * 一次性评价引导
 *
 * 纯展示组件：只负责渲染与发出 cta / snooze / dismiss，不读存储、不打开外链。
 * 是否展示、延后多久与永久关闭都由 Options 页面决定。
 */
const { t } = useI18n();

defineEmits<{
  cta: [];
  snooze: [];
  dismiss: [];
}>();
</script>

<style scoped>
.review-prompt {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 16px 18px;
  margin: 0 0 16px;
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 10px;
}

.review-prompt__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 34px;
  height: 34px;
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
  border-radius: 9px;
}

.review-prompt__body {
  flex: 1;
  min-width: 0;
}

.review-prompt__title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.review-prompt__desc {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.review-prompt__actions {
  display: flex;
  flex: none;
  gap: 8px;
  align-items: center;
  padding-top: 2px;
}

.review-prompt__cta {
  padding: 6px 12px;
  font-size: 12.5px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  background: var(--el-color-primary);
  border: none;
  border-radius: 6px;
}

.review-prompt__cta:hover {
  background: var(--el-color-primary-dark-2);
}

.review-prompt__snooze,
.review-prompt__dismiss {
  padding: 6px 8px;
  font-size: 12.5px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 6px;
}

.review-prompt__snooze:hover,
.review-prompt__dismiss:hover {
  color: var(--el-color-primary);
  background: var(--el-fill-color-light);
}

.review-prompt__cta:focus-visible,
.review-prompt__snooze:focus-visible,
.review-prompt__dismiss:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

@media (width <= 720px) {
  .review-prompt {
    flex-wrap: wrap;
  }

  .review-prompt__actions {
    justify-content: flex-end;
    width: 100%;
  }
}
</style>
