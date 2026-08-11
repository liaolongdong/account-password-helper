import { ref, computed, watch, nextTick, type Ref } from 'vue';
import type { FormRules } from 'element-plus';
import { StorageUtils } from '@/utils/storage';
import type { PasswordEntry } from '@/utils/types';
import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';
import { t } from '@/utils/i18n';
import { promptAndVerifyMasterPassword } from '@/utils/masterPasswordVerify';
import { formatSessionRemaining } from '@/composables/useSessionCountdown';

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
  /** 清除会话后向其他上下文广播会话过期通知的回调（保持与 Chrome API 解耦） */
  broadcastSessionExpired?: () => void;
}) {
  const { isAuthenticated, showPasswordVerify, showMasterPasswordSetup, passwords, verifyForm } = options;

  // 状态
  const showValiditySetting = ref(false);
  const validityLoading = ref(false);
  const clearSessionLoading = ref(false);

  // 有效期设置表单
  const validityForm = ref({
    validityHours: 24,
  });

  // 校验规则需响应语言切换，故用 computed 包裹（与 useAuthFlow/usePasswordManagement 保持一致）
  const validityRules = computed<FormRules>(() => ({
    validityHours: [{ required: true, message: t('common.validityRequired'), trigger: 'change' }],
  }));

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
        sessionInfo.value.remainingTime = t('session.none');
      }
    } catch (error) {
      logger.error('获取会话信息失败:', error);
      sessionInfo.value.expiryTime = null;
      sessionInfo.value.remainingTime = t('session.fetchFailed');
    }
  };

  // 更新剩余时间显示（格式化逻辑复用 formatSessionRemaining，与一级界面倒计时保持一致）
  const updateRemainingTime = (expiryTime: number) => {
    sessionInfo.value.remainingTime = formatSessionRemaining(expiryTime);
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
    try {
      const masterPassword = await promptAndVerifyMasterPassword(t('session.verifyTitle'), t('session.verifyPrompt'));
      if (!masterPassword) return;

      validityLoading.value = true;

      await StorageUtils.setMasterPasswordValidityHours(validityForm.value.validityHours);
      await StorageUtils.createSession(masterPassword, validityForm.value.validityHours);

      // 保存成功后刷新会话信息，保证剩余时间按新有效期重算
      await updateSessionInfo();

      ElMessage.success(t('session.validitySaved'));
      showValiditySetting.value = false;
    } catch (error) {
      // 用户点击取消时静默返回，不弹错误提示
      if (error === 'cancel' || error === 'close') {
        return;
      }
      logger.error('保存有效期设置失败:', error);
      ElMessage.error(t('message.saveFailed'));
    } finally {
      validityLoading.value = false;
    }
  };

  // 处理清除会话
  const handleClearSession = async () => {
    try {
      await ElMessageBox.confirm(t('session.clearConfirm'), t('session.clearConfirmTitle'), {
        confirmButtonText: t('session.clearConfirmBtn'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      });

      clearSessionLoading.value = true;

      await StorageUtils.clearSession();

      // 通知 background 使密码缓存和 session 缓存失效，
      // 防止 background 的 _sessionValidCache（5s TTL）返回过期 true，
      // 导致后续 GET_INITIAL_DATA 返回错误的已认证状态
      try {
        await chrome.runtime.sendMessage({ type: MessageType.INVALIDATE_PASSWORD_CACHE });
      } catch {
        // background 可能未就绪，忽略
      }

      // 广播会话过期到其他上下文（sidepanel、popup 等）
      options.broadcastSessionExpired?.();

      await updateSessionInfo();
      stopSessionTimer();

      showValiditySetting.value = false;

      isAuthenticated.value = false;
      passwords.value = [];

      showPasswordVerify.value = true;
      showMasterPasswordSetup.value = false;

      const validityHours = await StorageUtils.getMasterPasswordValidityHours();
      verifyForm.value.password = '';
      verifyForm.value.validityHours = validityHours;

      nextTick(() => {
        const passwordInput = document.querySelector('.verify-form .el-input__inner') as HTMLInputElement;
        if (passwordInput) {
          passwordInput.focus();
        }
      });

      ElMessage.success(t('session.cleared'));
    } catch (error) {
      if (error !== 'cancel') {
        logger.error('清除主密码会话失败:', error);
        ElMessage.error(t('session.clearFailed'));
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
