<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    title="验证有效期设置"
    width="500px"
    :close-on-click-modal="false"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="100px"
      size="large"
    >
      <el-alert
        title="有效期设置"
        description="设置主密码验证后的会话缓存时间，在有效期内无需重新输入主密码"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 24px"
      />

      <el-form-item
        label="当前会话状态"
        v-if="sessionInfo.expiryTime"
      >
        <div class="session-info">
          <div class="session-status">
            <el-tag
              type="success"
              size="small"
              >会话有效</el-tag
            >
          </div>
          <div class="session-expiry">剩余时间: {{ sessionInfo.remainingTime }}</div>
          <div
            class="session-actions"
            style="margin-top: 8px"
          >
            <el-button
              type="danger"
              size="small"
              :icon="Delete"
              @click="$emit('clearSession')"
              :loading="clearSessionLoading"
            >
              清除当前会话
            </el-button>
          </div>
        </div>
      </el-form-item>

      <el-form-item
        label="验证有效期"
        prop="validityHours"
      >
        <ValidityHoursSelect
          v-model="form.validityHours"
          placeholder="选择验证有效期"
          size="large"
          :disabled="loading"
          style="width: 100%"
        />
        <div class="form-tip">当前设置将影响会话缓存时间</div>
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="dialog-footer">
        <el-button
          size="large"
          @click="$emit('update:modelValue', false)"
        >
          取消
        </el-button>
        <el-button
          type="primary"
          size="large"
          :loading="loading"
          @click="$emit('save')"
        >
          保存设置
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { Delete } from '@element-plus/icons-vue';
import type { FormInstance, FormRules } from 'element-plus';
import ValidityHoursSelect from './ValidityHoursSelect.vue';

/**
 * 有效期设置对话框组件
 * 展示当前会话状态，支持修改有效期和清除会话
 */

/** 会话信息 */
interface SessionInfo {
  /** 过期时间戳 */
  expiryTime: number | null;
  /** 剩余时间文本 */
  remainingTime: string;
}

defineProps<{
  /** 控制对话框显示/隐藏 */
  modelValue: boolean;
  /** 有效期表单数据 */
  form: { validityHours: number };
  /** 表单验证规则 */
  rules: FormRules;
  /** 表单引用 */
  formRef?: FormInstance;
  /** 保存加载状态 */
  loading: boolean;
  /** 清除会话加载状态 */
  clearSessionLoading: boolean;
  /** 会话状态信息 */
  sessionInfo: SessionInfo;
}>();

defineEmits<{
  /** 对话框显示状态变更 */
  (e: 'update:modelValue', value: boolean): void;
  /** 保存有效期设置 */
  (e: 'save'): void;
  /** 清除当前会话 */
  (e: 'clearSession'): void;
}>();
</script>
