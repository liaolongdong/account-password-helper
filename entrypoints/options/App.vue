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
        :health-score="passwords.length ? healthReport.score : undefined"
        :health-grade="passwords.length ? healthReport.grade : undefined"
        @add-password="openPasswordDialog"
        @open-health="showHealthDialog = true"
        @data-command="handleDataCommand"
        @settings-command="handleSettingsCommand"
        @open-personalization="openPersonalizationDialog"
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

    <!-- 偏好设置弹窗（复用悬浮按钮设置面板） -->
    <div
      v-if="showPersonalizationDialog"
      class="sp-settings-host"
    >
      <div
        ref="personalizationOverlayEl"
        class="settings-overlay visible"
      ></div>
      <div
        ref="personalizationPanelEl"
        class="settings-panel visible"
      ></div>
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
      :editing-id="editingPasswordId"
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

    <!-- 收藏上限设置弹窗 -->
    <FavoriteLimitSetting v-model="showFavoriteLimitDialog" />

    <!-- 剪贴板设置弹窗 -->
    <ClipboardSettingDialog v-model="showClipboardDialog" />

    <!-- 安全体检仪表盘弹窗 -->
    <PasswordHealthDialog
      v-model="showHealthDialog"
      :report="healthReport"
      @edit="onHealthEdit"
    />

    <!-- 回收站弹窗 -->
    <TrashDialog
      v-model="showTrashDialog"
      @restored="loadPasswords"
    />

    <!-- 修改主密码弹窗 -->
    <ChangeMasterPasswordDialog v-model="showChangeMasterPasswordDialog" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import type { FloatingButtonConfig } from '@/utils/types';
import { MessageType } from '@/utils/types';
import { initSessionManager } from '@/utils/sessionManager';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import {
  getSettingsPanelHTML,
  bindSettingsPanelView,
  settingsPanelViewStyles,
  type SettingsPanelViewHandle,
} from '@/entrypoints/content/floatingButtons/settingsPanelView';
// 对话框/设置类组件：用户交互触发，异步加载减少初始包体积
const ImportDialog = defineAsyncComponent(() => import('@/components/options/ImportDialog.vue'));
const BackupImportDialog = defineAsyncComponent(() => import('@/components/options/BackupImportDialog.vue'));
const ValiditySettingDialog = defineAsyncComponent(() => import('@/components/options/ValiditySettingDialog.vue'));
const EmailBackupDialog = defineAsyncComponent(() => import('@/components/options/EmailBackupDialog.vue'));
const AutoSaveSettingDialog = defineAsyncComponent(() => import('@/components/options/AutoSaveSettingDialog.vue'));
const IdleLockSetting = defineAsyncComponent(() => import('@/components/options/IdleLockSetting.vue'));
const FavoriteLimitSetting = defineAsyncComponent(() => import('@/components/options/FavoriteLimitSetting.vue'));
const ClipboardSettingDialog = defineAsyncComponent(() => import('@/components/options/ClipboardSettingDialog.vue'));
const PasswordHealthDialog = defineAsyncComponent(() => import('@/components/options/PasswordHealthDialog.vue'));
const TrashDialog = defineAsyncComponent(() => import('@/components/options/TrashDialog.vue'));
const ChangeMasterPasswordDialog = defineAsyncComponent(
  () => import('@/components/options/ChangeMasterPasswordDialog.vue'),
);
// 关键路径组件：静态导入确保首屏渲染
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
import { buildHealthReport } from '@/utils/passwordHealth';
import { isDev } from '@/utils/env';

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

/** 收藏上限设置弹窗可见性 */
const showFavoriteLimitDialog = ref(false);

/** 剪贴板设置弹窗可见性 */
const showClipboardDialog = ref(false);

/** 安全体检弹窗可见性 */
const showHealthDialog = ref(false);

/** 回收站弹窗可见性 */
const showTrashDialog = ref(false);

/** 修改主密码弹窗可见性 */
const showChangeMasterPasswordDialog = ref(false);

/** 偏好设置弹窗可见性 */
const showPersonalizationDialog = ref(false);
const personalizationPanelEl = ref<HTMLElement | null>(null);
const personalizationOverlayEl = ref<HTMLElement | null>(null);
let personalizationViewHandle: SettingsPanelViewHandle | null = null;

/**
 * 关闭偏好设置弹窗
 */
const closePersonalizationDialog = () => {
  personalizationViewHandle?.destroy();
  personalizationViewHandle = null;
  showPersonalizationDialog.value = false;
};

/**
 * 打开偏好设置弹窗
 * 加载最新悬浮按钮配置后渲染共用设置面板
 */
const openPersonalizationDialog = async () => {
  let config: FloatingButtonConfig;
  try {
    config = await StorageUtils.getFloatingButtonConfig();
  } catch (error) {
    logger.error('Options: 加载悬浮按钮配置失败:', error);
    return;
  }
  showPersonalizationDialog.value = true;
  await nextTick();
  if (!personalizationPanelEl.value) return;
  personalizationPanelEl.value.innerHTML = getSettingsPanelHTML(config);
  personalizationViewHandle = bindSettingsPanelView(
    personalizationPanelEl.value,
    personalizationOverlayEl.value,
    config,
    {
      onConfigChange: async patch => {
        try {
          await StorageUtils.saveFloatingButtonConfig(patch);
        } catch (error) {
          logger.error('Options: 保存悬浮按钮配置失败:', error);
          ElMessage.error('保存设置失败');
        }
      },
      onClose: closePersonalizationDialog,
    },
  );
};

/**
 * 将共用设置弹窗样式注入到 options 页面（仅注入一次）
 */
const injectPersonalizationStyles = () => {
  const STYLE_ID = 'floating-settings-view-styles';
  if (document.getElementById(STYLE_ID)) return;
  const styleEl = document.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.textContent = settingsPanelViewStyles;
  document.head.appendChild(styleEl);
};

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
    case 'trash':
      showTrashDialog.value = true;
      break;
  }
};

/**
 * 设置下拉菜单命令处理
 * @param command 菜单项命令标识
 */
const handleSettingsCommand = (command: string) => {
  switch (command) {
    case 'changeMasterPassword':
      showChangeMasterPasswordDialog.value = true;
      break;
    case 'validity':
      openValiditySetting();
      break;
    case 'autoSave':
      showAutoSaveDialog.value = true;
      break;
    case 'idleLock':
      showIdleLockDialog.value = true;
      break;
    case 'favoriteLimit':
      showFavoriteLimitDialog.value = true;
      break;
    case 'clipboard':
      showClipboardDialog.value = true;
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
  editingPasswordId,
  passwordForm,
  passwordFormRules,
  passwordFormLoading,
  tableLoading,
  favoriteOnly,
  filteredPasswords,
  currentSort,
  availableTags,
  tagArray,
  loadPasswords,
  handleSortChange,
  restoreSortConfig: initSortConfig,
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
  isLocalOperation,
} = usePasswordManagement({
  validityForm: initialValidityForm,
});

/**
 * 密码健康报告（纯本地内存计算，随密码列表变化自动更新）
 * 直接消费已解密的 passwords，无额外解密、存储或网络操作。
 */
const healthReport = computed(() => buildHealthReport(passwords.value, Date.now()));

/**
 * 安全体检「去处理」：关闭体检弹窗并跳转到对应条目的编辑流程
 * @param id 目标条目 ID
 */
const onHealthEdit = (id: string) => {
  showHealthDialog.value = false;
  const entry = passwords.value.find(p => p.id === id);
  if (entry) {
    editPassword(entry);
  }
};

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
  skipIf: isLocalOperation,
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
  injectPersonalizationStyles();
  initSessionManager();
  window.addEventListener('sessionExpired', handleSessionExpired);
  await checkAuth();
  // 等待 Vue 刷新 DOM，确保 PasswordTable 组件已挂载
  await nextTick();
  // 恢复表格排序配置
  restoreSortConfig();
});

/**
 * 从存储恢复表格排序状态
 * 先同步 currentSort（驱动 filteredPasswords computed），再调用 el-table.sort() 恢复视觉排序指示器
 */
const restoreSortConfig = async () => {
  await initSortConfig();
  const sortConfig = currentSort.value;
  if (sortConfig.prop && sortConfig.order && passwordTableRef.value?.tableRef) {
    passwordTableRef.value.tableRef.sort(sortConfig.prop, sortConfig.order);
  }
};

onUnmounted(() => {
  personalizationViewHandle?.destroy();
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

/* ==================== 弹窗滚动容器与滚动条全局样式 ==================== */

/**
 * 弹窗内容区滚动容器
 * 用于 align-center 弹窗中包裹可能超长的表单内容，
 * 超出 max-height 时显示垂直滚动条，底部按钮（#footer slot）固定在弹窗底部不随内容滚动。
 * 注意：el-dialog 默认 teleport 到 body，必须放在非 scoped 样式块中才能生效。
 */
.dialog-body-scroll {
  max-height: 70vh;
  padding-right: 4px;
  overflow-y: auto;
}

/* 滚动条样式（参考 HelpDialog 风格：纤细 4px，slate 色调，无轨道背景） */
.dialog-body-scroll::-webkit-scrollbar {
  width: 4px;
}

.dialog-body-scroll::-webkit-scrollbar-thumb {
  background-color: #cbd5e1;
  border-radius: 4px;
}

.dialog-body-scroll::-webkit-scrollbar-thumb:hover {
  background-color: #94a3b8;
}
</style>
