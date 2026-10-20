<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.growth.review.title')"
    width="min(460px, 92vw)"
    align-center
    append-to-body
    destroy-on-close
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="review-prompt__body">
      <span
        class="review-prompt__icon"
        aria-hidden="true"
      >
        <svg
          width="20"
          height="20"
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
      <p class="review-prompt__desc">{{ t('options.growth.review.desc') }}</p>
    </div>

    <template #footer>
      <div class="review-prompt__actions">
        <el-button
          text
          @click="$emit('dismiss')"
        >
          {{ t('options.growth.review.dismiss') }}
        </el-button>
        <el-button @click="$emit('snooze')">
          {{ t('options.growth.review.snooze') }}
        </el-button>
        <el-button
          type="primary"
          @click="$emit('cta')"
        >
          {{ t('options.growth.review.cta') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { useI18n } from '@/utils/i18n';

/**
 * 一次性评价引导弹窗
 *
 * 纯展示组件：只负责渲染与发出 cta / snooze / dismiss，不读存储、不打开外链。
 * 是否展示、延后多久与永久关闭都由 Options 页面决定。形态与「本次更新」弹窗
 * （WhatsNewDialog）一致：`el-dialog` + 三个动作按钮，不再占用列表上方空间。
 * ESC / 点遮罩关闭经 `update:modelValue` 上抛，由页面按「稍后再说」处理，
 * 避免误触造成永久关闭。
 */
const { t } = useI18n();

defineProps<{
  modelValue: boolean;
}>();

defineEmits<{
  'update:modelValue': [boolean];
  cta: [];
  snooze: [];
  dismiss: [];
}>();
</script>

<style scoped>
.review-prompt__body {
  display: flex;
  gap: 12px;
  align-items: flex-start;
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

.review-prompt__desc {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.review-prompt__actions {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
}
</style>
