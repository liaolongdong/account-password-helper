<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.validity.title')"
    width="500px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="100px"
      size="large"
    >
      <el-alert
        :title="t('options.validity.alertTitle')"
        :description="t('options.validity.alertDesc')"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 24px"
      />

      <el-form-item
        v-if="sessionInfo.expiryTime"
        :label="t('options.validity.sessionStatus')"
      >
        <div class="session-info">
          <div class="session-status">
            <el-tag
              type="success"
              size="small"
              >{{ t('options.validity.sessionActive') }}</el-tag
            >
          </div>
          <div class="session-expiry">{{ t('options.validity.remaining', { time: sessionInfo.remainingTime }) }}</div>
          <div
            class="session-actions"
            style="margin-top: 8px"
          >
            <el-button
              type="danger"
              size="small"
              :icon="Delete"
              :loading="clearSessionLoading"
              @click="$emit('clearSession')"
            >
              {{ t('options.validity.clearSession') }}
            </el-button>
          </div>
        </div>
      </el-form-item>

      <el-form-item
        :label="t('auth.validityLabel')"
        prop="validityHours"
      >
        <ValidityHoursSelect
          v-model="localValidityHours"
          :placeholder="t('auth.validityPlaceholder')"
          size="large"
          :disabled="loading"
          style="width: 100%"
        />
        <div class="form-tip">{{ t('options.validity.tip') }}</div>
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="dialog-footer">
        <el-button
          size="large"
          @click="$emit('update:modelValue', false)"
        >
          {{ t('common.cancel') }}
        </el-button>
        <el-button
          type="primary"
          size="large"
          :loading="loading"
          @click="handleSaveClick"
        >
          {{ t('common.saveSettings') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Delete } from '@element-plus/icons-vue';
import type { FormInstance, FormRules } from 'element-plus';
import ValidityHoursSelect from './ValidityHoursSelect.vue';
import { useI18n } from '@/utils/i18n';

/**
 * 有效期设置对话框组件
 * 展示当前会话状态，支持修改有效期和清除会话
 */

const { t } = useI18n();

/** 会话信息 */
interface SessionInfo {
  /** 过期时间戳 */
  expiryTime: number | null;
  /** 剩余时间文本 */
  remainingTime: string;
}

const props = defineProps<{
  /** 控制对话框显示/隐藏 */
  modelValue: boolean;
  /** 有效期表单数据 */
  form: { validityHours: number };
  /** 表单验证规则 */
  rules: FormRules;
  /** 保存加载状态 */
  loading: boolean;
  /** 清除会话加载状态 */
  clearSessionLoading: boolean;
  /** 会话状态信息 */
  sessionInfo: SessionInfo;
}>();

/** 本地计算属性，避免直接 mutate props */
const localValidityHours = computed({
  get: () => props.form.validityHours,
  set: (val: number) => {
    // eslint-disable-next-line vue/no-mutating-props
    props.form.validityHours = val;
  },
});

const emit = defineEmits<{
  /** 对话框显示状态变更 */
  (e: 'update:modelValue', value: boolean): void;
  /** 保存有效期设置 */
  (e: 'save'): void;
  /** 清除当前会话 */
  (e: 'clearSession'): void;
}>();

/** 表单引用，供父组件通过 defineExpose 访问（如需直接 validate） */
const formRef = ref<FormInstance>();

/**
 * 点击保存按钮：先在组件内完成表单校验，校验通过才向父组件 emit save
 * 避免父组件依赖未接线的 formRef 导致保存按钮无响应
 */
const handleSaveClick = async () => {
  if (!formRef.value) {
    emit('save');
    return;
  }
  try {
    await formRef.value.validate();
    emit('save');
  } catch {
    // 校验失败由 el-form 内部给出红字提示，无需额外处理
  }
};

defineExpose({ formRef });
</script>
