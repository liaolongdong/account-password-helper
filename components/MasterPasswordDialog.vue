<template>
  <el-dialog
    v-model="dialogVisible"
    :title="isFirstTime ? '设置主密码' : '验证主密码'"
    width="100vw"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    :modal="true"
    :lock-scroll="true"
    :destroy-on-close="true"
    class="fast-master-password-dialog full-width-dialog"
    :fullscreen="true"
  >
    <div class="form-container">
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="80px"
      >
        <div
          v-if="isFirstTime"
          class="tip"
        >
          <el-alert
            title="首次使用需要设置主密码"
            description="主密码用于保护您的所有账号信息，请妥善保管"
            type="info"
            :closable="false"
            show-icon
          />
        </div>

        <!-- 错误消息显示区域 -->
        <el-alert
          v-if="errorMessage"
          :title="errorMessage"
          type="error"
          :closable="false"
          show-icon
          style="margin-bottom: 20px"
        />

        <el-form-item
          label="密码"
          prop="password"
        >
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入主密码"
            show-password
            @keyup.enter="handleSubmit"
            @input="errorMessage = ''"
            :disabled="loading"
            autocomplete="new-password"
          />
        </el-form-item>

        <el-form-item
          v-if="isFirstTime"
          label="确认密码"
          prop="confirmPassword"
        >
          <el-input
            v-model="form.confirmPassword"
            type="password"
            placeholder="请再次输入主密码"
            show-password
            @keyup.enter="handleSubmit"
            @input="errorMessage = ''"
            :disabled="loading"
            autocomplete="new-password"
          />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <el-button
        type="primary"
        :loading="loading"
        @click="handleSubmit"
      >
        {{ isFirstTime ? '设置密码' : '验证密码' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { FormRules, FormInstance } from 'element-plus';
import { StorageUtils } from '../utils/storage';
import { logger } from '../utils/logger';

interface Props {
  modelValue: boolean;
  isFirstTime: boolean;
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void;
  (e: 'passwordSet'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const dialogVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
});

const formRef = ref<FormInstance>();
const loading = ref(false);
const errorMessage = ref(''); // 添加错误消息状态
const form = ref({
  password: '',
  confirmPassword: '',
});

// 表单验证规则
const rules = computed<FormRules>(() => {
  const baseRules = {
    password: [
      { required: true, message: '请输入密码', trigger: 'blur' },
      { min: 6, message: '密码长度至少6个字符', trigger: 'blur' },
    ],
  };

  if (props.isFirstTime) {
    return {
      ...baseRules,
      confirmPassword: [
        { required: true, message: '请确认密码', trigger: 'blur' },
        {
          validator: (_rule: any, value: string, callback: Function) => {
            if (value !== form.value.password) {
              callback(new Error('两次输入的密码不一致'));
            } else {
              callback();
            }
          },
          trigger: 'blur',
        },
      ],
    };
  }

  return baseRules;
});

// 监听弹窗显示状态，重置表单
watch(dialogVisible, visible => {
  if (visible) {
    form.value = {
      password: '',
      confirmPassword: '',
    };
    errorMessage.value = ''; // 清除错误消息
    // 清除之前的验证状态
    if (formRef.value) {
      formRef.value.clearValidate();
    }
    // 弹窗打开后聚焦到输入框
    nextTick(() => {
      const passwordInput = document.querySelector('.fast-master-password-dialog .el-input__inner') as HTMLInputElement;
      if (passwordInput) {
        passwordInput.focus();
      }
    });
  }
});

// 处理提交
const handleSubmit = async () => {
  if (!formRef.value) return;

  try {
    await formRef.value.validate();

    if (!form.value.password.trim()) {
      errorMessage.value = '请输入密码';
      return;
    }

    loading.value = true;
    errorMessage.value = ''; // 清除之前的错误消息

    if (props.isFirstTime) {
      // 设置主密码
      await StorageUtils.setMasterPassword(form.value.password.trim());
      ElMessage.success('主密码设置成功');

      // 立即关闭弹窗并触发事件
      dialogVisible.value = false;
      emit('passwordSet');
    } else {
      // 验证主密码
      const isValid = await StorageUtils.verifyMasterPassword(form.value.password.trim());
      if (isValid) {
        ElMessage.success('密码验证成功');

        // 立即关闭弹窗并触发事件
        dialogVisible.value = false;
        emit('passwordSet');
      } else {
        // 在当前弹窗中显示错误，不要关闭弹窗
        errorMessage.value = '密码错误，请重新输入';
        // 清空输入框
        form.value.password = '';
        form.value.confirmPassword = '';
        // 立即重新聚焦到输入框
        nextTick(() => {
          const passwordInput = document.querySelector(
            '.fast-master-password-dialog .el-input__inner',
          ) as HTMLInputElement;
          if (passwordInput) {
            passwordInput.focus();
            passwordInput.select();
          }
        });
        loading.value = false;
        return;
      }
    }
  } catch (error) {
    logger.error('密码操作失败:', error);
    errorMessage.value = '操作失败，请重试';
    form.value.password = '';
    form.value.confirmPassword = '';
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
@import url('../styles/dialog-full-width.css');

.tip {
  margin-bottom: 20px;
}
</style>
