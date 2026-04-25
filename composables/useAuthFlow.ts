import { ref, nextTick } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormRules, FormInstance } from 'element-plus';
import { StorageUtils } from '../utils/storage';
import { logger } from '../utils/logger';

/**
 * 认证流程 Composable
 * 管理主密码设置、验证、会话过期等认证相关逻辑
 */
export function useAuthFlow(options: { loadPasswords: () => Promise<void> }) {
  const { loadPasswords } = options;

  // 页面状态
  const isAuthenticated = ref(false);
  const showMasterPasswordSetup = ref(false);
  const showPasswordVerify = ref(false);

  // 表单引用
  const setupFormRef = ref<FormInstance>();
  const verifyFormRef = ref<FormInstance>();

  // 加载状态
  const setupLoading = ref(false);
  const verifyLoading = ref(false);
  const verifyError = ref('');

  // 设置表单
  const setupForm = ref({
    password: '',
    confirmPassword: '',
    validityHours: 24,
  });

  const setupRules: FormRules = {
    password: [
      { required: true, message: '请输入密码', trigger: 'blur' },
      { min: 8, message: '密码长度至少8个字符', trigger: 'blur' },
      {
        validator: (rule: any, value: string, callback: Function) => {
          if (!value) {
            callback();
            return;
          }

          const hasLetter = /[a-zA-Z]/.test(value);
          const hasNumber = /[0-9]/.test(value);
          const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(value);

          if (!hasLetter) {
            callback(new Error('密码必须包含字母'));
            return;
          }
          if (!hasNumber) {
            callback(new Error('密码必须包含数字'));
            return;
          }
          if (!hasSpecialChar) {
            callback(new Error('密码必须包含特殊字符'));
            return;
          }

          callback();
        },
        trigger: 'blur',
      },
    ],
    confirmPassword: [
      { required: true, message: '请确认密码', trigger: 'blur' },
      {
        validator: (rule: any, value: string, callback: Function) => {
          if (value !== setupForm.value.password) {
            callback(new Error('两次输入的密码不一致'));
          } else {
            callback();
          }
        },
        trigger: 'blur',
      },
    ],
  };

  // 验证表单
  const verifyForm = ref({
    password: '',
    validityHours: 24,
  });

  const verifyRules: FormRules = {
    password: [{ required: true, message: '请输入主密码', trigger: 'blur' }],
  };

  // 检查认证状态
  const checkAuth = async () => {
    try {
      const hasMaster = await StorageUtils.hasMasterPassword();

      if (!hasMaster) {
        logger.debug('Options: 首次使用，显示设置主密码页面');
        showMasterPasswordSetup.value = true;
        showPasswordVerify.value = false;
        isAuthenticated.value = false;

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
          showMasterPasswordSetup.value = false;
          showPasswordVerify.value = false;
          isAuthenticated.value = true;

          await loadPasswords();
        } else {
          showMasterPasswordSetup.value = false;
          showPasswordVerify.value = true;
          isAuthenticated.value = false;

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

  // 处理设置主密码
  const handleSetupSubmit = async () => {
    if (!setupFormRef.value) return;

    try {
      await setupFormRef.value.validate();

      setupLoading.value = true;

      await StorageUtils.setMasterPassword(setupForm.value.password.trim());
      await StorageUtils.setMasterPasswordValidityHours(setupForm.value.validityHours);
      await StorageUtils.createSession(setupForm.value.password.trim(), setupForm.value.validityHours);
      await StorageUtils.migrateUnencryptedEntries(setupForm.value.password.trim());

      ElMessage.success('主密码设置成功，欢迎使用');

      showMasterPasswordSetup.value = false;
      showPasswordVerify.value = false;
      isAuthenticated.value = true;

      await loadPasswords();
    } catch (error) {
      logger.error('设置主密码失败:', error);
      ElMessage.error('设置失败，请重试');
    } finally {
      setupLoading.value = false;
    }
  };

  // 处理密码验证
  const handleVerifySubmit = async () => {
    if (!verifyFormRef.value) return;

    try {
      await verifyFormRef.value.validate();

      if (!verifyForm.value.password.trim()) {
        verifyError.value = '请输入主密码';
        return;
      }

      verifyLoading.value = true;
      verifyError.value = '';

      const isValid = await StorageUtils.verifyMasterPassword(verifyForm.value.password.trim());

      if (isValid) {
        ElMessage.success('验证成功，欢迎使用');

        await StorageUtils.setMasterPasswordValidityHours(verifyForm.value.validityHours);
        await StorageUtils.createSession(verifyForm.value.password.trim(), verifyForm.value.validityHours);
        await StorageUtils.migrateUnencryptedEntries(verifyForm.value.password.trim());

        showPasswordVerify.value = false;
        showMasterPasswordSetup.value = false;
        isAuthenticated.value = true;

        await loadPasswords();
      } else {
        verifyError.value = '密码错误，请重新输入';
        verifyForm.value.password = '';
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
      verifyError.value = '验证过程出现错误，请重试';
      verifyForm.value.password = '';
    } finally {
      verifyLoading.value = false;
    }
  };

  // 处理会话过期事件
  const handleSessionExpired = () => {
    showMasterPasswordSetup.value = false;
    showPasswordVerify.value = true;
    isAuthenticated.value = false;

    StorageUtils.getMasterPasswordValidityHours().then(validityHours => {
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

      await ElMessageBox.alert(message, '调试信息', {
        confirmButtonText: '关闭',
      });
    } catch (error) {
      logger.error('获取调试信息失败:', error);
      ElMessage.error('获取调试信息失败');
    }
  };

  // 重置主密码
  const resetMasterPassword = async () => {
    try {
      await ElMessageBox.confirm('此操作将清空所有已保存的密码数据，确定继续吗？', '确认重置', {
        confirmButtonText: '确定重置',
        cancelButtonText: '取消',
        type: 'warning',
      });

      await StorageUtils.clearAllData();
      ElMessage.success('数据已清空，请重新设置主密码');

      await checkAuth();
    } catch (error) {
      if (error !== 'cancel') {
        logger.error('重置失败:', error);
        ElMessage.error('重置失败');
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
