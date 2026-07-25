import { ref, computed, nextTick } from 'vue';
import type { FormRules, FormInstance } from 'element-plus';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import { t } from '@/utils/i18n';

/** 输入框抖动动画持续时间（毫秒） */
export const SHAKE_DURATION_MS = 400;

/**
 * 认证流程 Composable
 * 管理主密码设置、验证、会话过期等认证相关逻辑
 */
export function useAuthFlow(options: {
  loadPasswords: () => Promise<void>;
  /** 会话过期时的额外清理回调（如清除密码列表），在状态切换前调用 */
  onSessionExpired?: () => void;
}) {
  const { loadPasswords } = options;

  // 页面状态
  const isAuthenticated = ref(false);
  const showMasterPasswordSetup = ref(false);
  const showPasswordVerify = ref(false);
  let isAuthenticating = false;

  /** 防护标志：当广播导致会话过期时为 true，阻止 checkAuth 覆盖已过期状态 */
  const sessionExpiredByBroadcast = ref(false);

  // 表单引用
  const setupFormRef = ref<FormInstance>();
  const verifyFormRef = ref<FormInstance>();

  // 加载状态
  const setupLoading = ref(false);
  const verifyLoading = ref(false);
  const verifyError = ref('');
  const verifyShake = ref(false);

  // 设置表单
  const setupForm = ref({
    password: '',
    confirmPassword: '',
    validityHours: 24,
  });

  /** 设置表单校验规则（computed 保证语言切换后错误提示同步更新） */
  const setupRules = computed<FormRules>(() => ({
    password: [
      { required: true, message: t('auth.rulePasswordRequired'), trigger: 'blur' },
      { min: 8, message: t('auth.ruleMinLength'), trigger: 'blur' },
      {
        validator: (_rule: any, value: string, callback: (error?: Error) => void) => {
          if (!value) {
            callback();
            return;
          }

          const hasLetter = /[a-zA-Z]/.test(value);
          const hasNumber = /[0-9]/.test(value);
          const hasSpecialChar = /[!@#$%^&*()_+\-={}[\];':"\\|,.<>/?~`]/.test(value);

          if (!hasLetter) {
            callback(new Error(t('auth.ruleNeedLetter')));
            return;
          }
          if (!hasNumber) {
            callback(new Error(t('auth.ruleNeedNumber')));
            return;
          }
          if (!hasSpecialChar) {
            callback(new Error(t('auth.ruleNeedSymbol')));
            return;
          }

          callback();
        },
        trigger: 'blur',
      },
    ],
    confirmPassword: [
      { required: true, message: t('auth.ruleConfirmRequired'), trigger: 'blur' },
      {
        validator: (_rule: any, value: string, callback: (error?: Error) => void) => {
          if (value !== setupForm.value.password) {
            callback(new Error(t('options.changePwd.mismatch')));
          } else {
            callback();
          }
        },
        trigger: 'blur',
      },
    ],
  }));

  // 验证表单
  const verifyForm = ref({
    password: '',
    validityHours: 24,
  });

  const verifyRules: FormRules = {
    password: [],
  };

  // 检查认证状态
  const checkAuth = async () => {
    if (isAuthenticating) return;
    try {
      const hasMaster = await StorageUtils.hasMasterPassword();

      if (!hasMaster) {
        // 主密码配置不存在：强制重置为设置页，避免残留的已认证/验证页状态串台
        logger.debug('Options: 主密码未设置，显示设置主密码页面');
        showPasswordVerify.value = false;
        isAuthenticated.value = false;
        showMasterPasswordSetup.value = true;

        const validityHours = await StorageUtils.getMasterPasswordValidityHours();
        setupForm.value.validityHours = validityHours;

        nextTick(() => {
          const passwordInput = document.querySelector('.setup-form .el-input__inner') as HTMLInputElement;
          if (passwordInput) {
            passwordInput.focus();
          }
        });
      } else {
        const isSessionValid = await StorageUtils.isSessionValid();
        if (isSessionValid) {
          // 竞态防护：如果会话已被广播标记为过期，不覆盖状态，避免显示加密乱码
          if (sessionExpiredByBroadcast.value) {
            logger.debug('Auth: checkAuth 跳过（会话已被广播标记为过期）');
            return;
          }
          // 命中已认证：若先前已是已认证态，避免抖动；否则切换并加载
          const wasAuthenticated = isAuthenticated.value;
          showMasterPasswordSetup.value = false;
          showPasswordVerify.value = false;

          if (!wasAuthenticated) {
            await loadPasswords();
          }
          isAuthenticated.value = true;
        } else {
          showMasterPasswordSetup.value = false;
          isAuthenticated.value = false;
          showPasswordVerify.value = true;

          const validityHours = await StorageUtils.getMasterPasswordValidityHours();
          verifyForm.value.validityHours = validityHours;

          nextTick(() => {
            const passwordInput = document.querySelector('.verify-form .el-input__inner') as HTMLInputElement;
            if (passwordInput) {
              passwordInput.focus();
            }
          });
        }
      }
    } catch (error) {
      logger.error('Options: 检查认证状态失败:', error);
      showMasterPasswordSetup.value = false;
      showPasswordVerify.value = true;
      isAuthenticated.value = false;
    }
  };

  // 处理设置主密码（表单验证由 MasterPasswordSetupView 组件处理）
  const handleSetupSubmit = async () => {
    try {
      setupLoading.value = true;
      isAuthenticating = true;

      await StorageUtils.setMasterPassword(setupForm.value.password.trim());
      await StorageUtils.setMasterPasswordValidityHours(setupForm.value.validityHours);
      await StorageUtils.createSession(setupForm.value.password.trim(), setupForm.value.validityHours);
      await StorageUtils.migrateUnencryptedEntries(setupForm.value.password.trim());

      ElMessage.success(t('auth.setupSuccess'));

      sessionExpiredByBroadcast.value = false;
      showMasterPasswordSetup.value = false;
      showPasswordVerify.value = false;

      await loadPasswords();
      isAuthenticated.value = true;
    } catch (error) {
      logger.error('设置主密码失败:', error);
      ElMessage.error(t('auth.setupFailed'));
    } finally {
      setupLoading.value = false;
      isAuthenticating = false;
    }
  };

  // 处理密码验证（表单验证由 PasswordVerifyView 组件处理）
  const handleVerifySubmit = async () => {
    try {
      if (!verifyForm.value.password.trim()) {
        verifyError.value = t('auth.verifyPasswordPlaceholder');
        return;
      }

      verifyLoading.value = true;
      verifyError.value = '';

      const isValid = await StorageUtils.verifyMasterPassword(verifyForm.value.password.trim());

      if (isValid) {
        ElMessage.success(t('auth.verifySuccess'));

        sessionExpiredByBroadcast.value = false;
        isAuthenticating = true;
        await StorageUtils.setMasterPasswordValidityHours(verifyForm.value.validityHours);
        await StorageUtils.createSession(verifyForm.value.password.trim(), verifyForm.value.validityHours);
        await StorageUtils.migrateUnencryptedEntries(verifyForm.value.password.trim());

        showPasswordVerify.value = false;
        showMasterPasswordSetup.value = false;

        await loadPasswords();
        isAuthenticated.value = true;
        isAuthenticating = false;
      } else {
        verifyError.value = t('auth.wrongPassword');
        verifyForm.value.password = '';
        verifyShake.value = true;
        setTimeout(() => {
          verifyShake.value = false;
        }, SHAKE_DURATION_MS);
        nextTick(() => {
          const passwordInput = document.querySelector('.verify-form .el-input__inner') as HTMLInputElement;
          if (passwordInput) {
            passwordInput.focus();
            passwordInput.select();
          }
        });
      }
    } catch (error) {
      logger.error('验证失败:', error);
      verifyError.value = t('auth.verifyError');
      verifyForm.value.password = '';
      verifyShake.value = true;
      setTimeout(() => {
        verifyShake.value = false;
      }, SHAKE_DURATION_MS);
    } finally {
      verifyLoading.value = false;
    }
  };

  // 处理会话过期事件
  const handleSessionExpired = async () => {
    // 设置竞态防护标志，阻止后续的 checkAuth 覆盖状态
    sessionExpiredByBroadcast.value = true;

    // 调用外部清理回调（如清除密码列表，防止加密数据残留显示）
    options.onSessionExpired?.();

    const hasMaster = await StorageUtils.hasMasterPassword();
    if (!hasMaster) {
      // 主密码未设置，保持/回到设置页面，避免误切换到验证页面
      logger.debug('Auth: 会话过期事件触发但主密码未设置，保持设置页面');
      showPasswordVerify.value = false;
      isAuthenticated.value = false;
      showMasterPasswordSetup.value = true;
      return;
    }

    showMasterPasswordSetup.value = false;
    showPasswordVerify.value = true;
    isAuthenticated.value = false;

    StorageUtils.getMasterPasswordValidityHours().then(validityHours => {
      verifyForm.value.password = '';
      verifyForm.value.validityHours = validityHours;
    });

    nextTick(() => {
      const passwordInput = document.querySelector('.verify-form .el-input__inner') as HTMLInputElement;
      if (passwordInput) {
        passwordInput.focus();
      }
    });
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

      await ElMessageBox.alert(message, t('auth.debugInfo'), {
        confirmButtonText: t('common.close'),
      });
    } catch (error) {
      logger.error('获取调试信息失败:', error);
      ElMessage.error(t('auth.debugFailed'));
    }
  };

  // 重置主密码
  const resetMasterPassword = async () => {
    try {
      await ElMessageBox.confirm(t('auth.resetConfirm'), t('auth.resetConfirmTitle'), {
        confirmButtonText: t('auth.resetConfirmBtn'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      });

      await StorageUtils.clearAllData();
      ElMessage.success(t('auth.resetDone'));

      await checkAuth();
    } catch (error) {
      if (error !== 'cancel') {
        logger.error('重置失败:', error);
        ElMessage.error(t('auth.resetFailed'));
      }
    }
  };

  return {
    // 状态
    isAuthenticated,
    showMasterPasswordSetup,
    showPasswordVerify,
    setupFormRef,
    verifyFormRef,
    setupLoading,
    verifyLoading,
    verifyError,
    verifyShake,
    setupForm,
    setupRules,
    verifyForm,
    verifyRules,
    // 方法
    checkAuth,
    handleSetupSubmit,
    handleVerifySubmit,
    handleSessionExpired,
    debugPassword,
    resetMasterPassword,
  };
}
