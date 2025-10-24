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
import { ElMessage } from 'element-plus';
import type { FormRules, FormInstance } from 'element-plus';
import { StorageUtils } from '../utils/storage';

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
  set: value => emit('update:modelValue', value)
});

const formRef = ref<FormInstance>();
const loading = ref(false);
const errorMessage = ref(''); // 添加错误消息状态
const form = ref({
  password: '',
  confirmPassword: ''
});

// 表单验证规则
const rules = computed<FormRules>(() => {
  const baseRules = {
    password: [
      { required: true, message: '请输入密码', trigger: 'blur' },
      { min: 6, message: '密码长度至少6个字符', trigger: 'blur' }
    ]
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
          trigger: 'blur'
        }
      ]
    };
  }

  return baseRules;
});

// 监听弹窗显示状态，重置表单
watch(dialogVisible, visible => {
  if (visible) {
    form.value = {
      password: '',
      confirmPassword: ''
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
            '.fast-master-password-dialog .el-input__inner'
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
    console.error('密码操作失败:', error);
    errorMessage.value = '操作失败，请重试';
    form.value.password = '';
    form.value.confirmPassword = '';
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.tip {
  margin-bottom: 20px;
}

/* 全屏宽度浅蓝色弹窗样式 */
:deep(.full-width-dialog) {
  --el-dialog-margin-top: 0;
}

:deep(.full-width-dialog .el-dialog) {
  width: 100vw !important;
  max-width: none;
  height: 100vh !important;
  margin: 0 !important;
  border: none;
  border-radius: 0;
  box-shadow: none;
  transform: none !important;
  transition: none !important;
  animation: none !important;
}

:deep(.full-width-dialog .el-overlay) {
  background-color: #f8fbff;
  transition: none !important;
  animation: none !important;
}

/* 弹窗内容区域优化 */
:deep(.full-width-dialog .el-dialog__body) {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 160px);
  padding: 5vh 10vw;
  background: #f8fbff;
}

/* 弹窗头部优化 */
:deep(.full-width-dialog .el-dialog__header) {
  position: sticky;
  top: 0;
  z-index: 100;
  padding: 24px 10vw;
  color: white;
  background: #409eff;
  border-bottom: none;
  border-radius: 0;
}

:deep(.full-width-dialog .el-dialog__title) {
  font-size: 20px;
  font-weight: 500;
  text-align: left;
}

/* 弹窗底部优化 */
:deep(.full-width-dialog .el-dialog__footer) {
  position: sticky;
  bottom: 0;
  z-index: 100;
  padding: 24px 10vw;
  text-align: center;
  background: #fff;
  border-top: 1px solid #e3f2fd;
}

/* 表单容器优化 */
.form-container {
  width: 100%;
  max-width: 500px;
  padding: 40px;
  background: white;
  border: 1px solid #e3f2fd;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgb(64 158 255 / 10%);
}

/* 输入框美化 */
:deep(.full-width-dialog .el-input__wrapper) {
  padding: 12px 16px;
  border: 1px solid #d9ecff;
  border-radius: 6px;
  box-shadow: none;
  transition: all 0.2s ease;
}

:deep(.full-width-dialog .el-input__wrapper:hover) {
  border-color: #409eff;
}

:deep(.full-width-dialog .el-input__wrapper.is-focus) {
  border-color: #409eff;
  box-shadow: 0 0 0 2px rgb(64 158 255 / 10%);
}

:deep(.full-width-dialog .el-input__inner) {
  font-size: 16px;
  line-height: 1.5;
}

/* 按钮优化 */
:deep(.full-width-dialog .el-button--primary) {
  padding: 12px 32px;
  font-size: 16px;
  font-weight: 400;
  background: #409eff;
  border: 1px solid #409eff;
  border-radius: 6px;
  transition: all 0.2s ease;
}

:deep(.full-width-dialog .el-button--primary:hover) {
  background: #66b3ff;
  border-color: #66b3ff;
  box-shadow: 0 4px 12px rgb(64 158 255 / 30%);
  transform: translateY(-1px);
}

/* alert 组件优化 */
:deep(.full-width-dialog .el-alert) {
  margin-bottom: 24px;
  border: none;
  border-radius: 6px;
}

:deep(.full-width-dialog .el-alert--info) {
  color: #2c3e50;
  background: #e8f4fd;
}

:deep(.full-width-dialog .el-alert--error) {
  color: #f56c6c;
  background: #fef0f0;
}

/* 表单标签优化 */
:deep(.full-width-dialog .el-form-item__label) {
  margin-bottom: 8px;
  font-size: 16px;
  font-weight: 500;
  color: #2c3e50;
}

:deep(.full-width-dialog .el-form-item) {
  margin-bottom: 24px;
}

/* 错误状态下的输入框样式 */
:deep(.el-input.is-error .el-input__inner) {
  animation: shake 0.3s ease-in-out;
}

@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }

  10%,
  30%,
  50%,
  70%,
  90% {
    transform: translateX(-2px);
  }

  20%,
  40%,
  60%,
  80% {
    transform: translateX(2px);
  }
}

/* 加载状态下的按钮动效 */
:deep(.el-button.is-loading) {
  transition: all 0.2s ease;
}

/* 输入框聚焦效果 */
:deep(.el-input__inner:focus) {
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

/* 响应式设计 */
@media (width <= 768px) {
  :deep(.full-width-dialog .el-dialog__body) {
    padding: 5vh 5vw;
  }

  :deep(.full-width-dialog .el-dialog__header) {
    padding: 20px 5vw;
  }

  :deep(.full-width-dialog .el-dialog__footer) {
    padding: 20px 5vw;
  }

  .form-container {
    padding: 24px;
  }
}
</style>
