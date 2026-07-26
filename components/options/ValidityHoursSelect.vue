<template>
  <el-select
    :model-value="modelValue"
    v-bind="$attrs"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <el-option
      v-for="option in VALIDITY_OPTIONS"
      :key="option.value"
      :label="option.label"
      :value="option.value"
    />
  </el-select>
</template>

<script setup lang="ts">
/**
 * 验证有效期选择器组件
 * 提供统一的有效期时间选项（1/2/4/8/12/24小时 及 3/5/7天），支持 v-model 双向绑定
 */
import { computed } from 'vue';
import { useI18n } from '@/utils/i18n';

/** 有效期选项配置 */
interface ValidityOption {
  /** 显示标签 */
  label: string;
  /** 小时数 */
  value: number;
}

const { t } = useI18n();

/** 有效期选项列表（小时数：天 * 24；label 随语言实时切换） */
const VALIDITY_OPTIONS = computed<ValidityOption[]>(() => [
  /** todo 测试过期时间 别删除 start */
  // { label: '6分钟', value: 0.1 },
  /** todo 测试过期时间 别删除 end */
  { label: t('validity.h1'), value: 1 },
  { label: t('validity.h2'), value: 2 },
  { label: t('validity.h4'), value: 4 },
  { label: t('validity.h8'), value: 8 },
  { label: t('validity.h12'), value: 12 },
  { label: t('validity.h24'), value: 24 },
  { label: t('validity.d3'), value: 72 },
  { label: t('validity.d5'), value: 120 },
  { label: t('validity.d7'), value: 168 },
]);

defineProps<{
  /** 当前选中的有效期小时数 */
  modelValue: number;
}>();

defineEmits<{
  /** 有效期变更事件 */
  (e: 'update:modelValue', value: number): void;
}>();
</script>
