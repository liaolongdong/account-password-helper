<template>
  <el-select
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    v-bind="$attrs"
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

/** 有效期选项配置 */
interface ValidityOption {
  /** 显示标签 */
  label: string;
  /** 小时数 */
  value: number;
}

/** 有效期选项列表（小时数：天 * 24） */
const VALIDITY_OPTIONS: ValidityOption[] = [
  { label: '1小时', value: 1 },
  { label: '2小时', value: 2 },
  { label: '4小时', value: 4 },
  { label: '8小时', value: 8 },
  { label: '12小时', value: 12 },
  { label: '24小时（推荐）', value: 24 },
  { label: '3天', value: 72 },
  { label: '5天', value: 120 },
  { label: '7天', value: 168 },
];

defineProps<{
  /** 当前选中的有效期小时数 */
  modelValue: number;
}>();

defineEmits<{
  /** 有效期变更事件 */
  (e: 'update:modelValue', value: number): void;
}>();
</script>
