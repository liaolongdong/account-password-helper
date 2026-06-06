<template>
  <el-dialog
    v-model="dialogVisible"
    title="密码验证"
    width="100vw"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    :modal="true"
    :lock-scroll="true"
    :destroy-on-close="true"
    class="fast-password-verify-dialog full-width-dialog"
    :fullscreen="true"
  >
    <div class="form-container">
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="80px"
      >
        <el-alert
          title="请输入主密码以继续"
          type="warning"
          :closable="false"
          show-icon
          style="margin-bottom: 20px"
        />

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
          label="主密码"
          prop="password"
        >
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入主密码"
            show-password
            :disabled="loading"
            autocomplete="current-password"
            @keyup.enter="handleVerify"
            @input="errorMessage = ''"
          />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <div
        style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
          text-align: left;
        "
      >
        <div>
          <el-button
            v-if="isDev"
            size="small"
            type="info"
            link
            @click="debugPassword"
          >
            🔍 调试信息
          </el-button>
          <el-button
            size="small"
            type="danger"
            link
            @click="resetMasterPassword"
          >
            忘记密码？重置所有数据
          </el-button>
        </div>
      </div>
      <div style="text-align: center">
        <el-button
          type="primary"
          :loading="loading"
          @click="handleVerify"
        >
          验证
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { FormRules, FormInstance } from 'element-plus';
import { StorageUtils } from '../utils/storage';
import { isDev } from '../utils/env';
import { logger } from '../utils/logger';

interface Props {
  modelValue: boolean;
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void;
  (e: 'verified'): void;
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
});

const rules: FormRules = {
  password: [{ required: true, message: '请输入主密码', trigger: 'blur' }],
};

// 监听弹窗显示状态，重置表单
watch(dialogVisible, visible => {
  if (visible) {
    form.value.password = '';
    errorMessage.value = ''; // 清除错误消息
    // 清除之前的验证状态
    if (formRef.value) {
      formRef.value.clearValidate();
    }
    // 弹窗打开后聚焦到输入框
    nextTick(() => {
      const passwordInput = document.querySelector('.fast-password-verify-dialog .el-input__inner') as HTMLInputElement;
      if (passwordInput) {
        passwordInput.focus();
      }
    });
  }
});

// 处理验证
const handleVerify = async () => {
  if (!formRef.value) return;

  try {
    // 表单验证
    await formRef.value.validate();

    if (!form.value.password.trim()) {
      errorMessage.value = '请输入主密码';
      return;
    }

    loading.value = true;
    errorMessage.value = ''; // 清除之前的错误消息

    const isValid = await StorageUtils.verifyMasterPassword(form.value.password.trim());

    if (isValid) {
      ElMessage.success('验证成功');

      // 立即关闭弹窗
      dialogVisible.value = false;

      // 然后触发事件
      emit('verified');
    } else {
      // 在当前弹窗中显示错误，不要关闭弹窗
      errorMessage.value = '密码错误，请重新输入';
      // 清空输入框
      form.value.password = '';
      // 立即重新聚焦到输入框
      nextTick(() => {
        const passwordInput = document.querySelector(
          '.fast-password-verify-dialog .el-input__inner',
        ) as HTMLInputElement;
        if (passwordInput) {
          passwordInput.focus();
          passwordInput.select(); // 选中所有文本（如果有的话）
        }
      });
    }
  } catch (error) {
    logger.error('密码验证过程出错:', error);
    errorMessage.value = '验证过程出现错误，请重试';
    form.value.password = '';
  } finally {
    loading.value = false;
  }
};

// 重置主密码
const resetMasterPassword = async () => {
  try {
    await ElMessageBox.confirm('此操作将清空所有已保存的密码数据，确定继续吗？', '确认重置', {
      confirmButtonText: '确定重置',
      cancelButtonText: '取消',
      type: 'warning',
      dangerouslyUseHTMLString: true,
    });

    await StorageUtils.clearAllData();
    ElMessage.success('数据已清空，请重新设置主密码');

    // 重新加载页面
    window.location.reload();
  } catch (error) {
    if (error !== 'cancel') {
      logger.error('重置失败:', error);
      ElMessage.error('重置失败');
    }
  }
};

// 调试密码
const debugPassword = async () => {
  try {
    const debugInfo = await StorageUtils.debugMasterPassword();

    let message = '主密码配置信息:\n';
    message += `配置存在: ${debugInfo.hasConfig ? '是' : '否'}\n`;
    message += `盐值存在: ${debugInfo.hasSalt ? '是' : '否'}\n`;
    message += `哈希存在: ${debugInfo.hasHashedPassword ? '是' : '否'}\n`;
    message += `盐值长度: ${debugInfo.saltLength}\n`;
    message += `哈希长度: ${debugInfo.hashLength}\n`;
    message += `盐值预览: ${debugInfo.saltPreview}\n`;
    message += `哈希预览: ${debugInfo.hashPreview}`;

    await ElMessageBox.alert(message, '调试信息', {
      confirmButtonText: '关闭',
    });
  } catch (error) {
    logger.error('获取调试信息失败:', error);
    ElMessage.error('获取调试信息失败');
  }
};
</script>

<style scoped>
@import url('../styles/dialog-full-width.css');

/* PasswordVerifyDialog 特有样式 */
:deep(.full-width-dialog .el-alert--warning) {
  color: #e6a23c;
  background: #fdf6ec;
}

/* 链接按钮优化 */
:deep(.full-width-dialog .el-button--info.is-link) {
  font-weight: 400;
  color: #409eff;
  transition: all 0.2s ease;
}

:deep(.full-width-dialog .el-button--info.is-link:hover) {
  color: #66b3ff;
}

:deep(.full-width-dialog .el-button--danger.is-link) {
  font-weight: 400;
  color: #f56c6c;
  transition: all 0.2s ease;
}

:deep(.full-width-dialog .el-button--danger.is-link:hover) {
  color: #f78989;
}
</style>
