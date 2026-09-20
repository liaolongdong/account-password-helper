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
        :last-verified-backup-at="lastVerifiedBackupAt"
        @add-password="openAddDialogWithActiveTab"
        @open-health="showHealthDialog = true"
        @open-validity="openValiditySetting"
        @data-command="handleDataCommand"
        @settings-command="handleSettingsCommand"
        @open-personalization="openPersonalizationDialog"
      />

      <!-- 搜索和筛选（空数据时隐藏） -->
      <SearchFilterBar
        v-if="passwords.length > 0 || tableLoading"
        v-model:search-keyword="searchKeyword"
        v-model:favorite-only="favoriteOnly"
        v-model:filter-tags="filterTags"
        :selected-count="selectedIds.length"
        :available-tags="availableTags"
        @tag-filter-visible-change="handleTagFilterVisibleChange"
        @batch-delete="batchDelete"
        @batch-edit-tags="showBatchTagDialog = true"
        @batch-export-selected="batchExportSelected"
      />

      <!-- 展示密码列表总数和搜索结果总数 -->
      <div
        v-if="passwords.length > 0"
        class="password-list-info"
      >
        <span>
          {{ t('options.totalPasswords') }}
          <el-text type="success">
            {{ passwords.length }}
          </el-text>
          {{ t('options.totalUnit') }}
        </span>
        <span v-if="filteredPasswords.length !== passwords.length">
          {{ t('options.filtered') }}
          <el-text type="success">{{ filteredPasswords.length }}</el-text>
          {{ t('options.filteredUnit') }}
        </span>
      </div>

      <!-- 空数据状态引导 -->
      <EmptyGuide
        v-if="passwords.length === 0 && !tableLoading"
        @add="openAddDialogWithActiveTab"
        @import="showImportDialog = true"
        @restore="showBackupImportDialog = true"
      />

      <!-- 密码列表 -->
      <PasswordTable
        v-else
        ref="passwordTableRef"
        :data="filteredPasswords"
        :loading="tableLoading"
        :search-keyword="searchKeyword"
        :row-class-name="handleRowClassName"
        @selection-change="handleSelectionChange"
        @sort-change="handleSortChange"
        @toggle-password="togglePasswordVisibility"
        @view-detail="onViewDetail"
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
      @update:form="applyPasswordFormPatch"
      @update:tag-array="tagArray = $event"
    />

    <!-- 条目只读详情抽屉 -->
    <PasswordDetailDrawer
      v-model="showDetailDrawer"
      :entry="detailEntry"
      @edit="onDetailEdit"
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

    <!-- 身份信息库列表弹窗（共享实例注入） -->
    <IdentityVaultDialog
      v-model="showIdentityVaultDialog"
      :vault="identityVault"
      @add="openIdentityForm(null)"
      @edit="openIdentityForm"
    />

    <!-- 身份信息新增/编辑表单弹窗 -->

    <!-- 站点规则管理弹窗 -->
    <SiteRulesDialog
      v-model="showSiteRulesDialog"
      :initial-domain="siteRulePrefillDomain"
    />
    <IdentityFormDialog
      v-model="showIdentityFormDialog"
      :entry="editingIdentity"
      :loading="identityFormLoading"
      @save="handleIdentityFormSave"
    />

    <!-- 密码历史设置弹窗 -->
    <PasswordHistorySettingDialog v-model="showPasswordHistoryDialog" />

    <!-- 快捷键一览弹窗（只读，改键引导至浏览器内置管理页） -->
    <ShortcutSettingDialog v-model="showShortcutDialog" />

    <!-- 修改主密码弹窗 -->
    <ChangeMasterPasswordDialog
      v-model="showChangeMasterPasswordDialog"
      @success="loadPasswords"
    />

    <!-- 批量编辑标签弹窗 -->
    <BatchTagDialog
      v-model="showBatchTagDialog"
      :available-tags="availableTags"
      @save="handleBatchTagSave"
    />

    <!-- 主密码验证弹窗（导出/备份/有效期修改等操作前校验） -->
    <MasterPasswordVerifyDialog />

    <!-- 命令面板（Ctrl/Cmd+K）：全局快捷键由 useCommandPalette 挂载，仅在认证态可唤起 -->
    <CommandPalette
      v-model="paletteVisible"
      v-model:keyword="paletteKeyword"
      v-model:active-index="paletteActiveIndex"
      :filtered="paletteFiltered"
      @run="paletteRunAt"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch, defineAsyncComponent } from 'vue';
import type { FloatingButtonConfig, PasswordEntry } from '@/utils/types';
import { MessageType } from '@/utils/types';
import { initSessionManager } from '@/utils/sessionManager';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import { t, currentLocale } from '@/utils/i18n';
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
const PasswordHistorySettingDialog = defineAsyncComponent(
  () => import('@/components/options/PasswordHistorySettingDialog.vue'),
);
const ShortcutSettingDialog = defineAsyncComponent(() => import('@/components/options/ShortcutSettingDialog.vue'));
const ChangeMasterPasswordDialog = defineAsyncComponent(
  () => import('@/components/options/ChangeMasterPasswordDialog.vue'),
);
const BatchTagDialog = defineAsyncComponent(() => import('@/components/options/BatchTagDialog.vue'));
const MasterPasswordVerifyDialog = defineAsyncComponent(
  () => import('@/components/options/MasterPasswordVerifyDialog.vue'),
);
const PasswordDetailDrawer = defineAsyncComponent(() => import('@/components/options/PasswordDetailDrawer.vue'));
const IdentityVaultDialog = defineAsyncComponent(() => import('@/components/options/IdentityVaultDialog.vue'));
const IdentityFormDialog = defineAsyncComponent(() => import('@/components/options/IdentityFormDialog.vue'));
const SiteRulesDialog = defineAsyncComponent(() => import('@/components/options/SiteRulesDialog.vue'));
const CommandPalette = defineAsyncComponent(() => import('@/components/options/CommandPalette.vue'));
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
import { useIdentityVault } from '@/composables/useIdentityVault';
import { useCommandPalette } from '@/composables/useCommandPalette';
import type { IdentityEntry, IdentityPayload } from '@/utils/identity/types';
import { findDuplicateIdentity } from '@/utils/identity/dedup';
import { getIdentityCrudErrorCode } from '@/utils/storage/identityCrud';
import { exportEncryptedBackup } from '@/utils/backupExport';
import { promptAndVerifyMasterPassword } from '@/utils/masterPasswordVerify';
import { buildHealthReportAsync, type HealthReport } from '@/utils/passwordHealth';
import { normalizeToHostAndPort } from '@/utils/domain';
import { isDev } from '@/utils/env';

/**
 * 标签页标题跟随语言
 *
 * `index.html` 的 `<title>` 是静态中文默认值，options 是三个入口里唯一把标题展示给用户
 * 的（浏览器标签页），英文环境下会残留中文标题。i18n 初始化早于挂载，故 immediate 即生效。
 */
watch(currentLocale, () => (document.title = t('options.documentTitle')), { immediate: true });

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

/** 身份信息库列表弹窗可见性 */
const showIdentityVaultDialog = ref(false);

/** 身份信息表单弹窗可见性 */
const showIdentityFormDialog = ref(false);

/** 站点规则管理弹窗可见性 */
const showSiteRulesDialog = ref(false);

/** 站点规则弹窗预填域名（来自内容脚本填充失败就地引导，编辑已有规则时不使用） */
const siteRulePrefillDomain = ref<string | undefined>(undefined);

/** 未解锁时收到的站点规则引导域名，解锁后自动续上，避免这次点击被丢弃 */
const pendingSiteRuleDomain = ref<string | null>(null);

/**
 * 打开站点规则弹窗（可选预填域名）
 * 供「安全设置」菜单项与命令面板（无参）、内容脚本填充失败引导（携带当前域名）共用
 */
const openSiteRules = (domain?: string): void => {
  // 站点规则是明文元数据、不需要会话即可读写，但把规则弹窗压在主密码验证屏上既突兀又难以为继；
  // 未解锁时记下域名并给出可读反馈，解锁那一刻自动续上这次引导。
  if (domain && !isAuthenticated.value) {
    pendingSiteRuleDomain.value = domain;
    ElMessage.info(t('message.siteRulesNeedUnlock'));
    return;
  }
  siteRulePrefillDomain.value = domain?.trim() || undefined;
  showSiteRulesDialog.value = true;
};

/** 正在编辑的身份条目（null = 新增） */
const editingIdentity = ref<IdentityEntry | null>(null);

/** 身份表单持久化进行中 */
const identityFormLoading = ref(false);

/** 密码历史设置弹窗可见性 */
const showPasswordHistoryDialog = ref(false);

/** 快捷键一览弹窗可见性 */
const showShortcutDialog = ref(false);

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
  personalizationPanelEl.value.innerHTML = getSettingsPanelHTML(config, currentLocale.value);
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
          ElMessage.error(t('message.saveSettingsFailed'));
        }
      },
      onClose: closePersonalizationDialog,
    },
    currentLocale.value,
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

/** 加密备份导入弹窗可见性 */
const showBackupImportDialog = ref(false);

/** 最近一次通过完整性自检的加密备份导出时间戳（epoch 毫秒），null 表示尚无已验证备份 */
const lastVerifiedBackupAt = ref<number | null>(null);

/** 加密备份导出 */
const handleEncryptedBackupExport = async () => {
  if (passwords.value.length === 0) {
    ElMessage.warning(t('message.noDataToBackup'));
    return;
  }
  const masterPassword = await promptAndVerifyMasterPassword(
    t('options.backup.exportTitle'),
    t('options.backup.exportPrompt'),
  );
  if (!masterPassword) return;
  try {
    await exportEncryptedBackup(passwords.value, masterPassword);
    ElMessage.success(t('options.backup.exportSuccess'));
    // 导出内部已在自检通过后落库，回读以反映真实持久态（而非乐观当前时间）
    lastVerifiedBackupAt.value = await StorageUtils.getLastVerifiedBackupAt();
  } catch (error) {
    logger.error('加密备份导出失败:', error);
    if ((error as { name?: string })?.name === 'BackupVerifyError') {
      ElMessage.error(t('backup.exportVerifyFailed'));
    } else {
      ElMessage.error(t('options.backup.exportFailed'));
    }
  }
};

/**
 * 打开回收站前先验证主密码，验证通过才弹窗
 */
const openTrashWithVerify = async (): Promise<void> => {
  const masterPassword = await promptAndVerifyMasterPassword(
    t('options.trash.verifyTitle'),
    t('options.trash.verifyPrompt'),
  );
  if (!masterPassword) return;
  showTrashDialog.value = true;
};

/**
 * 打开身份信息库前先验证主密码（纯门槛，刻意不使用返回的密码）
 *
 * 身份库含证件号/卡号等高敏 PII，复验门槛防「会话已解锁但用户离开座位」时
 * 旁人一次性看到全部身份信息；取消则弹窗不得打开。镜像 openTrashWithVerify。
 */
const openIdentityVaultWithVerify = async (): Promise<void> => {
  const masterPassword = await promptAndVerifyMasterPassword(t('identity.verifyTitle'), t('identity.verifyPrompt'));
  if (!masterPassword) return;
  showIdentityVaultDialog.value = true;
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
      openTrashWithVerify();
      break;
    case 'identityVault':
      openIdentityVaultWithVerify();
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
    case 'siteRules':
      openSiteRules();
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
    case 'passwordHistory':
      showPasswordHistoryDialog.value = true;
      break;
    case 'shortcuts':
      showShortcutDialog.value = true;
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
  filterTags,
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
  handleTagFilterVisibleChange,
  openPasswordDialog,
  editPassword,
  resetPasswordForm,
  applyPasswordFormPatch,
  handlePasswordFormSave,
  copyPassword,
  deletePassword,
  batchDelete,
  batchEditTags,
  batchExportSelected,
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

/** 批量编辑标签弹窗可见性 */
const showBatchTagDialog = ref(false);

/**
 * 批量编辑标签保存：委托 composable 追加/移除落盘后关闭弹窗
 * @param tags 规整后的标签列表
 * @param mode 'append' 追加 / 'remove' 移除
 */
const handleBatchTagSave = async (tags: string[], mode: 'append' | 'remove') => {
  await batchEditTags(tags, mode);
  showBatchTagDialog.value = false;
};

/**
 * 打开新增弹窗并自动带入当前活动标签页的域名（P1-6）
 *
 * 当前活动标签页为扩展自身页面或浏览器内部页（chrome://）时无法作为站点域名，
 * 回退选取最近访问的普通网页标签页；仍无可用标签页时以空 URL 打开（行为与旧版一致）。
 */
const openAddDialogWithActiveTab = async () => {
  let prefillUrl = '';
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let candidateUrl = activeTab?.url ?? '';
    if (!candidateUrl || candidateUrl.startsWith('chrome-extension://') || candidateUrl.startsWith('chrome://')) {
      const tabs = await chrome.tabs.query({});
      const webTab = tabs
        .filter(tab => tab.url && /^https?:/.test(tab.url))
        .sort((a, b) => ((b as any).lastAccessed ?? b.id ?? 0) - ((a as any).lastAccessed ?? a.id ?? 0))[0];
      candidateUrl = webTab?.url ?? '';
    }
    prefillUrl = normalizeToHostAndPort(candidateUrl);
  } catch (error) {
    logger.error('Options: 获取活动标签页域名失败:', error);
  }
  openPasswordDialog(prefillUrl);
};

/**
 * 密码健康报告（异步计算，含字典校验，随密码列表变化自动更新）
 * 消费已解密的 passwords，无额外解密、存储或网络操作。
 */
const healthReport = ref<HealthReport>({
  total: 0,
  score: 100,
  grade: 'excellent',
  weak: [],
  breached: [],
  reuseGroups: [],
  reuseAffectedCount: 0,
  stale: [],
  noTotpCount: 0,
});

/** 异步更新健康报告（密码列表变化时触发） */
watch(
  passwords,
  async list => {
    healthReport.value = await buildHealthReportAsync(list, Date.now());
  },
  { immediate: true },
);

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

/** 条目详情抽屉可见性 */
const showDetailDrawer = ref(false);

/** 当前查看详情的条目（已解密，直接引用列表项） */
const detailEntry = ref<PasswordEntry | null>(null);

/**
 * 打开条目只读详情抽屉
 * @param entry 目标条目
 */
const onViewDetail = (entry: PasswordEntry) => {
  detailEntry.value = entry;
  showDetailDrawer.value = true;
};

/**
 * 从详情抽屉进入编辑：关闭抽屉并复用既有编辑弹窗流程
 * @param entry 目标条目
 */
const onDetailEdit = (entry: PasswordEntry) => {
  showDetailDrawer.value = false;
  editPassword(entry);
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

/** 身份信息库状态与操作（单一实例注入列表弹窗，会话失效由下方 watch teardown） */
const identityVault = useIdentityVault();

/**
 * 打开身份表单弹窗（新增/编辑共用）
 * @param entry 编辑目标条目，null 表示新增
 */
const openIdentityForm = (entry: IdentityEntry | null): void => {
  editingIdentity.value = entry;
  showIdentityFormDialog.value = true;
};

/**
 * 身份表单保存：新增走 create，编辑走 update（携带并发令牌）
 *
 * 错误映射依赖 identityCrud 抛出的机器可读 `code`（getIdentityCrudErrorCode），
 * 分流到专属文案；无 code 的其余错误走通用失败提示。
 */
const handleIdentityFormSave = async (payload: IdentityPayload): Promise<void> => {
  // 保存前疑似重复检测（非阻断）：证件号 / 卡号命中既有条目时二次确认，取消则回到表单不落盘
  const dup = findDuplicateIdentity(identityVault.rows.value, payload, editingIdentity.value?.id);
  if (dup) {
    const dupEntry = identityVault.rows.value.find(row => row.id === dup.id);
    try {
      await ElMessageBox.confirm(
        t('identity.form.duplicateWarning', {
          field: t(`identity.field.${dup.field}`),
          title: dupEntry ? identityVault.displayTitle(dupEntry) : '',
        }),
        t('identity.form.duplicateTitle'),
        {
          confirmButtonText: t('common.save'),
          cancelButtonText: t('common.cancel'),
          type: 'warning',
        },
      );
    } catch {
      return;
    }
  }
  identityFormLoading.value = true;
  try {
    if (editingIdentity.value) {
      await identityVault.update(editingIdentity.value.id, payload, editingIdentity.value.updateTime);
    } else {
      await identityVault.create(payload);
    }
    ElMessage.success(t('identity.form.saveSuccess'));
    showIdentityFormDialog.value = false;
  } catch (error) {
    const code = getIdentityCrudErrorCode(error);
    if (code === 'LIMIT_REACHED') {
      ElMessage.error(t('identity.form.limitReached'));
    } else if (code === 'UPDATE_CONFLICT') {
      ElMessage.error(t('identity.form.updateConflict'));
    } else if (code === 'NOT_FOUND') {
      ElMessage.error(t('identity.form.deletedConflict'));
    } else {
      logger.error('保存身份信息失败:', error);
      ElMessage.error(t('message.saveFailed'));
    }
  } finally {
    identityFormLoading.value = false;
  }
};

/** 会话状态切换时清理身份库明文/弹窗，并续上未解锁期间收到的站点规则引导 */
watch(isAuthenticated, authenticated => {
  if (!authenticated) {
    identityVault.teardown();
    showIdentityVaultDialog.value = false;
    showIdentityFormDialog.value = false;
    editingIdentity.value = null;
    return;
  }
  const pending = pendingSiteRuleDomain.value;
  if (pending) {
    pendingSiteRuleDomain.value = null;
    openSiteRules(pending);
  }
});

/**
 * 主密码设置页 / 密码表单弹窗强度校验
 *
 * 必须声明在 useAuthFlow / usePasswordManagement 解构之后：
 * usePasswordStrength 内部的 watch 在建立监听时会立即求值 computed source
 * 以收集依赖，若此时 setupForm / passwordForm 尚未初始化（TDZ）会抛
 * ReferenceError 导致整页白屏。
 */
const setupPasswordRef = computed(() => setupForm.value.password);
const { rules: passwordRules, strength: passwordStrength } = usePasswordStrength(setupPasswordRef);

const formPasswordRef = computed(() => passwordForm.value.password);
const { rules: formPasswordRules, strength: formPasswordStrength } = usePasswordStrength(formPasswordRef);

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

/**
 * 命令面板动作清单（Ctrl/Cmd+K）
 *
 * 每项 `run` 复用 HeaderBar 菜单/按钮已有的处理函数，走完全相同的落码路径，不新增业务行为；
 * `label` 复用既有菜单文案，`keywords` 仅为检索别名（不渲染，故不受 i18n 约束）。
 * 每次面板打开时按当前语言重新求值标签，语言切换后重开即生效。
 */
const buildPaletteActions = () => [
  {
    id: 'add',
    group: 'entry',
    label: t('options.header.addPassword'),
    keywords: ['add', 'new', 'create'],
    run: openAddDialogWithActiveTab,
  },
  {
    id: 'health',
    group: 'entry',
    label: t('options.header.healthCheck'),
    keywords: ['health', 'audit', 'score'],
    run: () => (showHealthDialog.value = true),
  },
  {
    id: 'downloadTemplate',
    group: 'data',
    label: t('options.header.downloadTemplate'),
    keywords: ['template', 'csv', 'excel'],
    run: downloadTemplate,
  },
  {
    id: 'import',
    group: 'data',
    label: t('options.header.importData'),
    keywords: ['import', 'csv', 'json', 'excel'],
    run: () => (showImportDialog.value = true),
  },
  {
    id: 'export',
    group: 'data',
    label: t('options.header.exportData'),
    keywords: ['export', 'csv'],
    run: exportPasswords,
  },
  {
    id: 'exportJson',
    group: 'data',
    label: t('options.header.exportJson'),
    keywords: ['export', 'json'],
    run: exportPasswordsJson,
  },
  {
    id: 'backupExport',
    group: 'data',
    label: t('options.header.backupExport'),
    keywords: ['backup', 'export', 'aph'],
    run: handleEncryptedBackupExport,
  },
  {
    id: 'backupImport',
    group: 'data',
    label: t('options.header.backupImport'),
    keywords: ['backup', 'import', 'restore', 'aph'],
    run: () => (showBackupImportDialog.value = true),
  },
  {
    id: 'emailBackup',
    group: 'data',
    label: t('options.header.emailBackup'),
    keywords: ['email', 'mail', 'backup'],
    run: openEmailBackupDialog,
  },
  {
    id: 'removeDuplicates',
    group: 'data',
    label: t('options.header.removeDuplicates'),
    keywords: ['dedup', 'duplicate'],
    run: removeDuplicates,
  },
  {
    id: 'trash',
    group: 'data',
    label: t('options.header.trash'),
    keywords: ['trash', 'deleted'],
    run: openTrashWithVerify,
  },
  {
    id: 'identityVault',
    group: 'data',
    label: t('identity.title'),
    keywords: ['identity', 'vault', 'pii'],
    run: openIdentityVaultWithVerify,
  },
  {
    id: 'changeMasterPassword',
    group: 'security',
    label: t('options.header.changeMasterPassword'),
    keywords: ['master', 'password', 'change'],
    run: () => (showChangeMasterPasswordDialog.value = true),
  },
  {
    id: 'validity',
    group: 'security',
    label: t('options.header.validity'),
    keywords: ['validity', 'session', 'expire'],
    run: openValiditySetting,
  },
  {
    id: 'idleLock',
    group: 'security',
    label: t('options.header.idleLock'),
    keywords: ['idle', 'lock', 'auto'],
    run: () => (showIdleLockDialog.value = true),
  },
  {
    id: 'autoSave',
    group: 'security',
    label: t('options.header.autoSave'),
    keywords: ['autosave', 'auto', 'save'],
    run: () => (showAutoSaveDialog.value = true),
  },
  {
    id: 'siteRules',
    group: 'security',
    label: t('options.header.siteRules'),
    keywords: ['site', 'rule', 'selector', 'shadow'],
    run: () => openSiteRules(),
  },
  {
    id: 'clipboard',
    group: 'security',
    label: t('options.header.clipboard'),
    keywords: ['clipboard', 'copy'],
    run: () => (showClipboardDialog.value = true),
  },
  {
    id: 'favoriteLimit',
    group: 'security',
    label: t('options.header.favoriteLimit'),
    keywords: ['favorite', 'limit', 'star'],
    run: () => (showFavoriteLimitDialog.value = true),
  },
  {
    id: 'passwordHistory',
    group: 'security',
    label: t('options.historySetting.title'),
    keywords: ['history'],
    run: () => (showPasswordHistoryDialog.value = true),
  },
  {
    id: 'shortcuts',
    group: 'security',
    label: t('options.header.shortcuts'),
    keywords: ['shortcut', 'hotkey', 'key'],
    run: () => (showShortcutDialog.value = true),
  },
  {
    id: 'personalization',
    group: 'preferences',
    label: t('options.header.personalization'),
    keywords: ['preference', 'theme', 'language'],
    run: openPersonalizationDialog,
  },
];

/** 命令面板控制器：仅认证态可唤起，动作复用既有 handler */
const {
  visible: paletteVisible,
  keyword: paletteKeyword,
  activeIndex: paletteActiveIndex,
  filtered: paletteFiltered,
  runAt: paletteRunAt,
} = useCommandPalette({
  getActions: buildPaletteActions,
  canOpen: () => isAuthenticated.value,
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
  openValiditySetting,
  openSiteRules,
});

/** 初始化：启动会话管理器、监听会话过期事件、加载配置并检查认证状态 */
onMounted(async () => {
  injectPersonalizationStyles();
  initSessionManager();
  window.addEventListener('sessionExpired', handleSessionExpired);
  await checkAuth();
  // 读取「最近一次已验证备份」时间戳，供 HeaderBar 展示备份健康提示（时间戳非敏感，读取无需会话态）
  lastVerifiedBackupAt.value = await StorageUtils.getLastVerifiedBackupAt();
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
