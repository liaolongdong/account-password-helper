import { ref, computed, nextTick } from 'vue';
import type { FormRules, FormInstance } from 'element-plus';
import { StorageUtils } from '@/utils/storage';
import { lockSession } from '@/utils/sessionLock';
import { logger } from '@/utils/logger';
import { t } from '@/utils/i18n';
import { evaluateStrengthRules, type StrengthRuleId } from '@/utils/passwordStrengthCore';
import type { OptionsFirstView } from '@/utils/optionsFirstView';
import type { VaultErrorCode } from '@/utils/recoveryTypes';

// 刻意不值导入 `VAULT_ERROR_CODES`：本 composable 在侧边栏 eager 依赖图里，为一个常量引入值依赖
// 会让 Rollup 把 `recoveryTypes` 切成独立 chunk 挂进 modulepreload（`tests/architecture/sidepanelClosure.test.ts`
// 的预算守卫会挡下）。类型导入编译期擦除、零运行时成本，而下面两个字面量仍要求它是登记表成员，
// 登记表里改名或拼错照样编译失败——与 `sessionManager-storage.ts`、`vaultWriteLock.ts` 同一取舍。
const WRONG_PASSWORD: VaultErrorCode = 'WRONG_PASSWORD';
const VAULT_BUSY: VaultErrorCode = 'VAULT_BUSY';

/** 输入框抖动动画持续时间（毫秒） */
export const SHAKE_DURATION_MS = 400;

/**
 * 连续输错多少次后才亮出「忘记密码」相关的辅助信息
 *
 * 解锁页的提示语区块与敏感操作复验弹窗共用这一档位：第一次输错就甩出退路，
 * 反而诱导用户放弃回想；阈值以下只报「密码错误」。
 */
export const MAX_FAIL_BEFORE_HINT = 3;

/**
 * 认证流程 Composable
 * 管理主密码设置、验证、会话过期等认证相关逻辑
 */
export function useAuthFlow(options: {
  loadPasswords: () => Promise<void>;
  /** 会话过期时的额外清理回调（如清除密码列表），在状态切换前调用 */
  onSessionExpired?: () => void;
  /**
   * 首个真实视图判定完成（在列表解密前回调，且只回调一次）
   *
   * 骨架屏靠它在「锁定 / 首次安装」时及时切走表格形态，不必等列表加载完。
   */
  onFirstViewResolved?: (view: OptionsFirstView) => void;
}) {
  const { loadPasswords } = options;

  /** 首视图只上报一次：后续 checkAuth / 会话往返不应把骨架再切回去 */
  let firstViewReported = false;
  const reportFirstView = (view: OptionsFirstView): void => {
    if (firstViewReported) return;
    firstViewReported = true;
    options.onFirstViewResolved?.(view);
  };

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
    /** 主密码提示语（可选，明文存于本机 `master_password_config.hint`） */
    hint: '',
  });

  /** 解锁页展示的提示语；空串表示用户未设置，视图据此隐藏区块 */
  const masterPasswordHint = ref('');
  /** 本次解锁会话内连续输错的次数，决定提示语与找回入口是否亮出 */
  const verifyFailCount = ref(0);

  /** 设置表单校验规则（computed 保证语言切换后错误提示同步更新） */
  /**
   * 强度规则标识 → 失败文案
   *
   * 判定谓词住在 `utils/passwordStrengthCore.ts`，这里只负责贴 i18n 文案。
   * 刻意写成函数而不是常量表：`setupRules` 是 computed，语言切换后要能拿到新文案。
   */
  const strengthRuleMessage = (id: StrengthRuleId): string => {
    switch (id) {
      case 'minLength':
        return t('auth.ruleMinLength');
      case 'hasLetter':
        return t('auth.ruleNeedLetter');
      case 'hasNumber':
        return t('auth.ruleNeedNumber');
      case 'hasSymbol':
        return t('auth.ruleNeedSymbol');
    }
  };

  const setupRules = computed<FormRules>(() => ({
    password: [
      { required: true, message: t('auth.rulePasswordRequired'), trigger: 'blur' },
      {
        validator: (_rule: any, value: string, callback: (error?: Error) => void) => {
          if (!value) {
            callback();
            return;
          }
          // 四条规则全部走 `evaluateStrengthRules`，不再本地抄一份正则：
          // 改密弹窗与恢复链路都按这套判定的「全通过」收口，创建侧若各自表述，
          // 就会漂出「创建时不允许的强度，改密时能设进去」这类口径差。
          // 首尾空白在存储层会被剥除；这里先 trim 再判，避免「看着够长、落盘后被拒」。
          const candidate = String(value ?? '').trim();
          if (!candidate) {
            callback(new Error(t('auth.rulePasswordRequired')));
            return;
          }
          // 返回顺序固定为 长度→字母→数字→符号，首条失败即报，与原行为一致。
          const failed = evaluateStrengthRules(candidate).find(rule => !rule.passed);
          if (failed) {
            callback(new Error(strengthRuleMessage(failed.id)));
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
            callback(new Error(t('common.pwdMismatch')));
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
        reportFirstView('setup');

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
            reportFirstView('verify');
            return;
          }
          // 命中已认证：若先前已是已认证态，避免抖动；否则切换并加载
          const wasAuthenticated = isAuthenticated.value;
          showMasterPasswordSetup.value = false;
          showPasswordVerify.value = false;
          // 列表解密可能耗时较长：先让骨架切到表格形态，再开始加载
          reportFirstView('vault');

          if (!wasAuthenticated) {
            await loadPasswords();
          }
          isAuthenticated.value = true;
        } else {
          const wasVerifyVisible = showPasswordVerify.value;
          showMasterPasswordSetup.value = false;
          isAuthenticated.value = false;
          // 只在进入解锁视图时同步清空；重复的 checkAuth 不能抹掉用户已经输入的内容。
          if (!wasVerifyVisible) verifyForm.value.password = '';
          showPasswordVerify.value = true;
          reportFirstView('verify');

          const [validityHours, hint] = await Promise.all([
            StorageUtils.getMasterPasswordValidityHours(),
            StorageUtils.getMasterPasswordHint(),
          ]);
          verifyForm.value.validityHours = validityHours;
          masterPasswordHint.value = hint;

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
      const wasVerifyVisible = showPasswordVerify.value;
      showMasterPasswordSetup.value = false;
      if (!wasVerifyVisible) verifyForm.value.password = '';
      showPasswordVerify.value = true;
      isAuthenticated.value = false;
      reportFirstView('verify');
    }
  };

  // 处理设置主密码（表单验证由 MasterPasswordSetupView 组件处理）
  const handleSetupSubmit = async () => {
    try {
      setupLoading.value = true;
      isAuthenticating = true;

      await StorageUtils.setMasterPassword(setupForm.value.password.trim(), setupForm.value.hint);
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

  /**
   * 解锁失败的统一呈现：清空输入、亮出错文案并抖动。
   * @param refocus 密码写错时把焦点送回输入框并全选，用户可直接重输
   */
  const reportVerifyFailure = (message: string, refocus: boolean): void => {
    verifyError.value = message;
    verifyForm.value.password = '';
    verifyShake.value = true;
    setTimeout(() => {
      verifyShake.value = false;
    }, SHAKE_DURATION_MS);
    if (refocus) {
      nextTick(() => {
        const passwordInput = document.querySelector('.verify-form .el-input__inner') as HTMLInputElement;
        if (passwordInput) {
          passwordInput.focus();
          passwordInput.select();
        }
      });
    }
  };

  // 处理密码验证（表单验证由 PasswordVerifyView 组件处理）
  const handleVerifySubmit = async (submittedPassword?: string) => {
    try {
      // 子组件的输入与父级 props 是异步同步的；提交必须以子组件此刻的值（事件载荷）为准，
      // 否则快速输入后立刻回车可能读到父级尚未更新的空值。
      const password = (submittedPassword ?? verifyForm.value.password).trim();
      if (!password) {
        verifyError.value = t('auth.verifyPasswordPlaceholder');
        return;
      }
      verifyForm.value.password = password;

      verifyLoading.value = true;
      verifyError.value = '';
      // 从提交起就置位：期间到达的 checkAuth / 会话广播不得把 UI 拉回锁定态
      isAuthenticating = true;

      // 不再先做一次 `verifyMasterPassword` 预检：`createSession` 内部必须在租约内复验当前
      // 配置（外部 UI 的验证可能早于另一上下文换钥，这道复验不能省），预检等于让每次解锁多付
      // 一次 600k 迭代的 PBKDF2（本机约 430ms），解锁时长平白多出近一半。失败按稳定码分流。
      try {
        await StorageUtils.createSession(password, verifyForm.value.validityHours);
      } catch (authError) {
        const code = (authError as { code?: string } | undefined)?.code;
        if (code === VAULT_BUSY) {
          // 换钥进行中：不是密码错，不计数、不清输入，用户等它完成即可原地重试
          verifyError.value = t('recovery.error.busy');
          return;
        }
        if (code !== WRONG_PASSWORD) throw authError;
        verifyFailCount.value++;
        reportVerifyFailure(t('auth.wrongPassword'), true);
        return;
      }

      sessionExpiredByBroadcast.value = false;
      verifyFailCount.value = 0;
      // 有效期偏好只在认证成功之后落盘：失败的那一次不该改动库里的设置
      await StorageUtils.setMasterPasswordValidityHours(verifyForm.value.validityHours);
      await StorageUtils.migrateUnencryptedEntries(password);

      showPasswordVerify.value = false;
      showMasterPasswordSetup.value = false;

      await loadPasswords();
      isAuthenticated.value = true;
      ElMessage.success(t('auth.verifySuccess'));
    } catch (error) {
      logger.error('验证失败:', error);
      reportVerifyFailure(t('auth.verifyError'), false);
    } finally {
      verifyLoading.value = false;
      isAuthenticating = false;
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

    // 提示语的显示门槛是「本次解锁连续输错 N 次」；页面不重新挂载，所以重新进入解锁视图时
    // 必须先归零再切视图，否则上一轮的失败会累加到这一轮，让提示语早于阈值出现。
    const wasVerifyVisible = showPasswordVerify.value;
    verifyFailCount.value = 0;
    showMasterPasswordSetup.value = false;
    if (!wasVerifyVisible) verifyForm.value.password = '';
    showPasswordVerify.value = true;
    isAuthenticated.value = false;

    void Promise.all([StorageUtils.getMasterPasswordValidityHours(), StorageUtils.getMasterPasswordHint()]).then(
      ([validityHours, hint]) => {
        verifyForm.value.validityHours = validityHours;
        masterPasswordHint.value = hint;
      },
    );

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
        // 与「清除会话」「明文导出」同一档：整库不可逆清空的确认按钮必须区别于
        // 常规主操作蓝按钮，也与找回向导里那枚红色「仍然重置全部数据」保持同色，
        // 避免两步之间严重度视觉跳水。图标仍用 warning——全仓 16 处确认弹窗一律
        // `type: 'warning'`，单点换成 error 只会制造第二套口径。
        confirmButtonClass: 'el-button--danger',
      });

      // B7：统一锁定编排先销毁会话密钥材料（内存镜像 + storage.session 的 DATA_KEY /
      // SESSION_LOCK_STATE）并通知后台失效密码缓存，再清空 storage.local；
      // 否则旧数据密钥与「假解锁」镜像会在重置后仍驻留至浏览器重启。
      await lockSession();
      await StorageUtils.clearAllData();

      // 让其它上下文（sidepanel / popup）同步进入未认证态
      options.onSessionExpired?.();

      // 提示语随 storage.local 一起清空，同步抹掉本上下文的内存镜像，
      // 否则新建库前的解锁页仍会展示上一把主密码的提示语
      masterPasswordHint.value = '';
      verifyFailCount.value = 0;

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
    masterPasswordHint,
    verifyFailCount,
    // 方法
    checkAuth,
    handleSetupSubmit,
    handleVerifySubmit,
    handleSessionExpired,
    debugPassword,
    resetMasterPassword,
  };
}
