import { ref, watch, type Ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormRules, FormInstance } from 'element-plus';
import { StorageUtils } from '../utils/storage';
import type { PasswordEntry } from '../utils/types';
import { logger } from '../utils/logger';

/**
 * 会话定时器 Composable
 * 管理会话有效期设置、倒计时显示、清除会话等逻辑
 */
export function useSessionTimer(options: {
  isAuthenticated: Ref<boolean>;
  showPasswordVerify: Ref<boolean>;
  showMasterPasswordSetup: Ref<boolean>;
  passwords: Ref<PasswordEntry[]>;
  verifyForm: Ref<{ password: string; validityHours: number }>;
  loadPasswords: () => Promise<void>;
}) {
  const {
    isAuthenticated,
    showPasswordVerify,
    showMasterPasswordSetup,
    passwords,
    verifyForm,
    loadPasswords: _loadPasswords,
  } = options;

  // 状态
  const showValiditySetting = ref(false);
  const validityLoading = ref(false);
  const clearSessionLoading = ref(false);

  // 有效期设置表单
  const validityFormRef = ref<FormInstance>();
  const validityForm = ref({
    validityHours: 24,
  });

  const validityRules: FormRules = {
    validityHours: [{ required: true, message: '请选择有效期', trigger: 'change' }],
  };

  // 会话信息
  const sessionInfo = ref({
    expiryTime: null as number | null,
    remainingTime: '',
  });

  // 会话定时器
  let sessionTimer: number | null = null;

  // 更新会话信息显示
  const updateSessionInfo = async () => {
    try {
      const expiryTime = await StorageUtils.getSessionExpiryTime();
      if (expiryTime) {
        sessionInfo.value.expiryTime = expiryTime;
        updateRemainingTime(expiryTime);
      } else {
        sessionInfo.value.expiryTime = null;
        sessionInfo.value.remainingTime = '无会话';
      }
    } catch (error) {
      logger.error('获取会话信息失败:', error);
      sessionInfo.value.expiryTime = null;
      sessionInfo.value.remainingTime = '获取失败';
    }
  };

  // 更新剩余时间显示
  const updateRemainingTime = (expiryTime: number) => {
    const now = Date.now();
    const remaining = expiryTime - now;

    if (remaining <= 0) {
      sessionInfo.value.remainingTime = '已过期';
      return;
    }

    const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
    const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

    if (days > 0) {
      sessionInfo.value.remainingTime = `${days}天${hours}小时`;
    } else if (hours > 0) {
      sessionInfo.value.remainingTime = `${hours}小时${minutes}分钟`;
    } else if (minutes > 0) {
      sessionInfo.value.remainingTime = `${minutes}分钟${seconds}秒`;
    } else {
      sessionInfo.value.remainingTime = `${seconds}秒`;
    }
  };

  // 启动会话定时器
  const startSessionTimer = () => {
    if (sessionTimer) {
      clearInterval(sessionTimer);
    }

    sessionTimer = window.setInterval(() => {
      if (sessionInfo.value.expiryTime) {
        updateRemainingTime(sessionInfo.value.expiryTime);
      }
    }, 1000);
  };

  // 停止会话定时器
  const stopSessionTimer = () => {
    if (sessionTimer) {
      clearInterval(sessionTimer);
      sessionTimer = null;
    }
  };

  // 打开有效期设置弹窗
  const openValiditySetting = async () => {
    showValiditySetting.value = true;

    const validityHours = await StorageUtils.getMasterPasswordValidityHours();
    validityForm.value.validityHours = validityHours;

    await updateSessionInfo();
    startSessionTimer();
  };

  // 处理有效期设置保存
  const handleValiditySave = async () => {
    if (!validityFormRef.value) return;

    try {
      await validityFormRef.value.validate();
      validityLoading.value = true;

      await StorageUtils.setMasterPasswordValidityHours(validityForm.value.validityHours);

      const currentMasterPassword = await StorageUtils.getSessionMasterPasswordDecrypted();
      if (currentMasterPassword) {
        await StorageUtils.createSession(currentMasterPassword, validityForm.value.validityHours);
      }

      ElMessage.success('有效期设置保存成功');
      showValiditySetting.value = false;
    } catch (error) {
      logger.error('保存有效期设置失败:', error);
      ElMessage.error('保存失败');
    } finally {
      validityLoading.value = false;
    }
  };

  // 处理清除会话
  const handleClearSession = async () => {
    try {
      await ElMessageBox.confirm(
        '确定要清除当前主密码会话吗？清除后需要重新输入主密码才能访问密码列表。',
        '确认清除会话',
        {
          confirmButtonText: '确定清除',
          cancelButtonText: '取消',
          type: 'warning',
          confirmButtonClass: 'el-button--danger',
        },
      );

      clearSessionLoading.value = true;

      await StorageUtils.clearSession();
      await updateSessionInfo();
      stopSessionTimer();

      showValiditySetting.value = false;

      isAuthenticated.value = false;
      passwords.value = [];

      showPasswordVerify.value = true;
      showMasterPasswordSetup.value = false;

      const validityHours = await StorageUtils.getMasterPasswordValidityHours();
      verifyForm.value.validityHours = validityHours;

      import('vue').then(({ nextTick }) => {
        nextTick(() => {
          const passwordInput = document.querySelector('.verify-form .el-input__inner') as HTMLInputElement;
          if (passwordInput) {
            passwordInput.focus();
          }
        });
      });

      ElMessage.success('主密码会话已清除');
    } catch (error) {
      if (error !== 'cancel') {
        logger.error('清除主密码会话失败:', error);
        ElMessage.error('清除主密码会话失败');
      }
    } finally {
      clearSessionLoading.value = false;
    }
  };

  // 监听弹窗关闭事件
  watch(showValiditySetting, newVal => {
    if (!newVal) {
      stopSessionTimer();
    }
  });

  return {
    showValiditySetting,
    validityFormRef,
    validityForm,
    validityRules,
    validityLoading,
    clearSessionLoading,
    sessionInfo,
    updateSessionInfo,
    startSessionTimer,
    stopSessionTimer,
    openValiditySetting,
    handleValiditySave,
    handleClearSession,
  };
}
