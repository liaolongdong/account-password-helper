<template>
  <div class="options-page">
    <!-- 设置主密码页面 -->
    <MasterPasswordSetupView
      v-if="showMasterPasswordSetup"
      :setup-form="setupForm"
      :setup-rules="setupRules"
      :setup-loading="setupLoading"
      :password-strength="passwordStrength"
      :password-rules="passwordRules"
      @submit="handleSetupSubmit"
      @update:setup-form="Object.assign(setupForm, $event)"
    />

    <!-- 密码验证页面 -->
    <PasswordVerifyView
      v-else-if="showPasswordVerify"
      :verify-form="verifyForm"
      :verify-rules="verifyRules"
      :verify-loading="verifyLoading"
      :verify-error="verifyError"
      :verify-shake="verifyShake"
      :is-dev="isDev"
      @submit="handleVerifySubmit"
      @debug="debugPassword"
      @reset="resetMasterPassword"
      @clear-error="verifyError = ''"
      @update:verify-form="Object.assign(verifyForm, $event)"
    />

    <!-- 主内容区域 -->
    <div
      v-if="isAuthenticated"
      class="main-content"
    >
      <!-- 头部 -->
      <HeaderBar
        :current-version="currentVersion"
        :floating-button-visible="floatingButtonVisible"
        @add-password="openPasswordDialog"
        @data-command="handleDataCommand"
        @settings-command="handleSettingsCommand"
        @toggle-floating-button="toggleFloatingButton"
      />

      <!-- 搜索和筛选（空数据时隐藏） -->
      <SearchFilterBar
        v-if="passwords.length > 0 || tableLoading"
        v-model:search-keyword="searchKeyword"
        v-model:favorite-only="favoriteOnly"
        :selected-count="selectedIds.length"
        @batch-delete="batchDelete"
      />

      <!-- 展示密码列表总数和搜索结果总数 -->
      <div
        v-if="passwords.length > 0"
        class="password-list-info"
      >
        <span>
          总共
          <el-text type="success">
            {{ passwords.length }}
          </el-text>
          条账号密码
        </span>
        <span v-if="filteredPasswords.length !== passwords.length">
          ，过滤筛选出
          <el-text type="success">{{ filteredPasswords.length }}</el-text>
          条
        </span>
      </div>

      <!-- 空数据状态引导 -->
      <EmptyGuide
        v-if="passwords.length === 0 && !tableLoading"
        @add="openPasswordDialog"
        @import="showImportDialog = true"
        @restore="showBackupImportDialog = true"
      />

      <!-- 密码列表 -->
      <PasswordTable
        v-else
        ref="passwordTableRef"
        :data="filteredPasswords"
        :loading="tableLoading"
        :row-class-name="handleRowClassName"
        @selection-change="handleSelectionChange"
        @sort-change="handleSortChange"
        @toggle-password="togglePasswordVisibility"
        @copy="copyPassword"
        @edit="editPassword"
        @toggle-favorite="toggleFavorite"
        @delete-password="deletePassword"
      />
    </div>

    <!-- 导入Excel弹窗 -->
    <ImportDialog
      v-model="showImportDialog"
      @imported="handlePasswordsImported"
    />

    <!-- 加密备份导入弹窗 -->
    <BackupImportDialog
      v-model="showBackupImportDialog"
      @imported="handlePasswordsImported"
    />

    <!-- 密码表单弹窗 -->
    <PasswordFormDialog
      ref="passwordFormDialogRef"
      v-model="showPasswordDialog"
      :is-editing="isEditingPassword"
      :form="passwordForm"
      :form-rules="passwordFormRules"
      :loading="passwordFormLoading"
      :available-tags="availableTags"
      :tag-array="tagArray"
      :password-strength="formPasswordStrength"
      :password-rules="formPasswordRules"
      @save="handleSavePasswordWithValidation"
      @closed="handleResetPasswordForm"
      @update:form="Object.assign(passwordForm, $event)"
      @update:tag-array="tagArray = $event"
    />

    <!-- 有效期设置弹窗 -->
    <ValiditySettingDialog
      v-model="showValiditySetting"
      :form="validityForm"
      :rules="validityRules"
      :loading="validityLoading"
      :clear-session-loading="clearSessionLoading"
      :session-info="sessionInfo"
      @save="handleValiditySave"
      @clear-session="handleClearSession"
    />

    <!-- 邮箱备份弹窗 -->
    <EmailBackupDialog
      v-model="showEmailBackupDialog"
      :backup-fn="backupToEmail"
    />

    <!-- 自动保存设置弹窗 -->
    <AutoSaveSettingDialog v-model="showAutoSaveDialog" />

    <!-- 闲置锁定设置弹窗 -->
    <IdleLockSetting v-model="showIdleLockDialog" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { MessageType } from '@/utils/types';
import { sessionManager } from '@/utils/sessionManager';
import { logger } from '@/utils/logger';
import ImportDialog from '@/components/options/ImportDialog.vue';
import BackupImportDialog from '@/components/options/BackupImportDialog.vue';
import ValiditySettingDialog from '@/components/options/ValiditySettingDialog.vue';
import EmailBackupDialog from '@/components/options/EmailBackupDialog.vue';
import AutoSaveSettingDialog from '@/components/options/AutoSaveSettingDialog.vue';
import IdleLockSetting from '@/components/options/IdleLockSetting.vue';
import MasterPasswordSetupView from '@/components/options/MasterPasswordSetupView.vue';
import PasswordVerifyView from '@/components/options/PasswordVerifyView.vue';
import PasswordFormDialog from '@/components/options/PasswordFormDialog.vue';
import PasswordTable from '@/components/options/PasswordTable.vue';
import HeaderBar from '@/components/options/HeaderBar.vue';
import EmptyGuide from '@/components/options/EmptyGuide.vue';
import SearchFilterBar from '@/components/options/SearchFilterBar.vue';
import { usePasswordStrength } from '@/composables/usePasswordStrength';
import { useAuthFlow } from '@/composables/useAuthFlow';
import { useSessionTimer } from '@/composables/useSessionTimer';
import { usePasswordManagement } from '@/composables/usePasswordManagement';
import { useStorageWatcher } from '@/composables/useStorageWatcher';
import { useRuntimeMessageHandler } from '@/composables/useRuntimeMessageHandler';
import { useVersionUpdate } from '@/composables/useVersionUpdate';
import { exportEncryptedBackup } from '@/utils/backupExport';
import { promptAndVerifyMasterPassword } from '@/utils/masterPasswordVerify';
import { isDev } from '@/utils/env';
import { StorageUtils } from '@/utils/storage';

/** 密码表单弹窗组件引用（用于获取内部 form ref） */
const passwordFormDialogRef = ref();

/** 密码列表表格组件引用（用于恢复排序配置） */
const passwordTableRef = ref();

/**
 * 带表单校验的密码保存处理
 * 从 PasswordFormDialog 组件获取内部 formRef 进行校验，校验通过后调用 composable 的保存逻辑
 */
const handleSavePasswordWithValidation = () => {
  const formRef = passwordFormDialogRef.value?.formRef;
  handlePasswordFormSave(formRef);
};

/**
 * 重置密码表单并清除校验状态
 */
const handleResetPasswordForm = () => {
  const formRef = passwordFormDialogRef.value?.formRef;
  formRef?.clearValidate();
  resetPasswordForm();
};

/** 临时有效期表单占位，在 useSessionTimer 初始化前会被覆盖 */
const initialValidityForm = ref({ validityHours: 24 });

/** 自动保存设置弹窗可见性 */
const showAutoSaveDialog = ref(false);

/** 闲置锁定设置弹窗可见性 */
const showIdleLockDialog = ref(false);

/** 当前插件版本号（复用 useVersionUpdate） */
const { currentVersion } = useVersionUpdate();

/** 主密码设置页强度校验 */
const setupPasswordRef = computed(() => setupForm.value.password);
const { rules: passwordRules, strength: passwordStrength } = usePasswordStrength(setupPasswordRef);

/** 密码表单弹窗强度校验 */
const formPasswordRef = computed(() => passwordForm.value.password);
const { rules: formPasswordRules, strength: formPasswordStrength } = usePasswordStrength(formPasswordRef);

/** 加密备份导入弹窗可见性 */
const showBackupImportDialog = ref(false);

/** 加密备份导出 */
const handleEncryptedBackupExport = async () => {
  if (passwords.value.length === 0) {
    ElMessage.warning('没有密码数据可备份');
    return;
  }
  const masterPassword = await promptAndVerifyMasterPassword('加密备份导出', '加密备份需要验证主密码，请输入主密码：');
  if (!masterPassword) return;
  try {
    await exportEncryptedBackup(passwords.value, masterPassword);
    ElMessage.success('加密备份导出成功');
  } catch (error) {
    logger.error('加密备份导出失败:', error);
    ElMessage.error('加密备份导出失败');
  }
};

/**
 * 数据管理下拉菜单命令处理
 * @param command 菜单项命令标识
 */
const handleDataCommand = (command: string) => {
  switch (command) {
    case 'downloadTemplate':
      downloadTemplate();
      break;
    case 'import':
      showImportDialog.value = true;
      break;
    case 'export':
      exportPasswords();
      break;
    case 'exportJson':
      exportPasswordsJson();
      break;
    case 'backupExport':
      handleEncryptedBackupExport();
      break;
    case 'backupImport':
      showBackupImportDialog.value = true;
      break;
    case 'backup':
      openEmailBackupDialog();
      break;
    case 'removeDuplicates':
      removeDuplicates();
      break;
  }
};

/**
 * 设置下拉菜单命令处理
 * @param command 菜单项命令标识
 */
const handleSettingsCommand = (command: string) => {
  switch (command) {
    case 'validity':
      openValiditySetting();
      break;
    case 'autoSave':
      showAutoSaveDialog.value = true;
      break;
    case 'idleLock':
      showIdleLockDialog.value = true;
      break;
  }
};

/** 密码管理状态与操作方法 */
const {
  passwords,
  showImportDialog,
  showPasswordDialog,
  showEmailBackupDialog,
  searchKeyword,
  selectedIds,
  isEditingPassword,
  passwordForm,
  passwordFormRules,
  passwordFormLoading,
  tableLoading,
  floatingButtonVisible,
  favoriteOnly,
  filteredPasswords,
  availableTags,
  tagArray,
  loadFloatingButtonConfig,
  toggleFloatingButton,
  loadPasswords,
  handleSortChange,
  togglePasswordVisibility,
  handleRowClassName,
  handleSelectionChange,
  openPasswordDialog,
  editPassword,
  resetPasswordForm,
  handlePasswordFormSave,
  copyPassword,
  deletePassword,
  batchDelete,
  handlePasswordsImported,
  exportPasswords,
  exportPasswordsJson,
  downloadTemplate,
  openEmailBackupDialog,
  backupToEmail,
  toggleFavorite,
  removeDuplicates,
} = usePasswordManagement({
  validityForm: initialValidityForm,
});

/** 认证流程状态与操作方法 */
const {
  isAuthenticated,
  showMasterPasswordSetup,
  showPasswordVerify,
  setupLoading,
  verifyLoading,
  verifyError,
  verifyShake,
  setupForm,
  setupRules,
  verifyForm,
  verifyRules,
  checkAuth,
  handleSetupSubmit,
  handleVerifySubmit,
  handleSessionExpired,
  debugPassword,
  resetMasterPassword,
} = useAuthFlow({
  loadPasswords,
  onSessionExpired: () => {
    passwords.value = [];
  },
});

/** 会话定时器状态与操作方法 */
const {
  showValiditySetting,
  validityForm,
  validityRules,
  validityLoading,
  clearSessionLoading,
  sessionInfo,
  openValiditySetting,
  handleValiditySave,
  handleClearSession,
} = useSessionTimer({
  isAuthenticated,
  showPasswordVerify,
  showMasterPasswordSetup,
  passwords,
  verifyForm,
  broadcastSessionExpired: () => {
    chrome.runtime.sendMessage({ type: MessageType.SESSION_EXPIRED }).catch(() => {
      // 无监听者时忽略
    });
  },
});

/** Storage 与可见性变化监听 */
useStorageWatcher({
  onAuthChange: () => void checkAuth(),
  onPasswordDataChange: () => void loadPasswords(),
});

/** Runtime 消息监听 */
useRuntimeMessageHandler({
  passwords,
  isAuthenticated,
  handleSessionExpired,
  editPassword,
  openPasswordDialog,
});

/** 初始化：启动会话管理器、监听会话过期事件、加载配置并检查认证状态 */
onMounted(async () => {
  sessionManager.init();
  window.addEventListener('sessionExpired', handleSessionExpired);
  await loadFloatingButtonConfig();
  await checkAuth();
  // 等待 Vue 刷新 DOM，确保 PasswordTable 组件已挂载
  await nextTick();
  // 恢复表格排序配置
  restoreSortConfig();
});

/**
 * 从存储恢复表格排序状态
 */
const restoreSortConfig = async () => {
  try {
    const sortConfig = await StorageUtils.getSortConfig();
    if (sortConfig && passwordTableRef.value?.tableRef) {
      passwordTableRef.value.tableRef.sort(sortConfig.prop, sortConfig.order);
    }
  } catch (error) {
    logger.debug('恢复排序配置失败:', error);
  }
};

onUnmounted(() => {
  window.removeEventListener('sessionExpired', handleSessionExpired);
});
</script>

<style scoped>
@import url('./styles.css');
</style>

<style>
/* 全局重置：防止 body 默认 margin 导致纵向滚动条 */
html,
body {
  height: 100%;
  padding: 0;
  margin: 0;

  /* overflow: hidden; */
}
</style>
