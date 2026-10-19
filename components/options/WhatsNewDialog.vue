<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.growth.whatsNew.title')"
    width="min(520px, 92vw)"
    align-center
    append-to-body
    destroy-on-close
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <p class="whats-new__lead">{{ t('options.growth.whatsNew.desc', { version }) }}</p>
    <ul class="whats-new__list">
      <li
        v-for="item in items"
        :key="item"
      >
        <span
          class="whats-new__dot"
          aria-hidden="true"
        ></span>
        {{ item }}
      </li>
    </ul>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">
        {{ t('options.growth.whatsNew.dismiss') }}
      </el-button>
      <el-button
        type="primary"
        @click="$emit('cta')"
      >
        {{ t('options.growth.whatsNew.cta') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/utils/i18n';

/**
 * 一次性版本更新弹窗
 *
 * 只在已有密码库的用户升级后打开一次；首次安装由页面直接记为已读，不弹窗。
 * 组件不读存储、不打开外链，关闭/CTA 由 Options 页面统一处理并写回已读版本。
 * 三条亮点是版本相关文案，发版时同步修改 `options.growth.whatsNew.item1..3`。
 */
defineProps<{
  modelValue: boolean;
  version: string;
}>();

defineEmits<{
  'update:modelValue': [boolean];
  cta: [];
}>();

const { t } = useI18n();
const items = computed(() => [
  t('options.growth.whatsNew.item1'),
  t('options.growth.whatsNew.item2'),
  t('options.growth.whatsNew.item3'),
]);
</script>

<style scoped>
.whats-new__lead {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.whats-new__list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.whats-new__list li {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  padding: 7px 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.whats-new__dot {
  flex: none;
  width: 6px;
  height: 6px;
  margin-top: 8px;
  background: var(--el-color-primary);
  border-radius: 50%;
}
</style>
