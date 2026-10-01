<template>
  <div class="options-page">
    <!--
      使用指引文档中页：`#guide` 一级视图，优先级高于认证态，
      未设主密码 / 待验证阶段同样进得去（免认证可见）。
      主内容只是 `display:none`，表格的勾选、排序指示与内部滚动因此原样保留。
    -->
    <GuideView
      v-if="guideActive"
      :section="guideSection"
      @back="closeGuide"
    />

    <!-- 设置主密码页面 -->
    <MasterPasswordSetupView
      v-else-if="showMasterPasswordSetup"
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
      v-show="!guideActive"
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
        @open-tour="replayTour"
        @open-guide="openGuide"
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
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :data="pagedEntries"
        :loading="tableLoading"
        :search-keyword="debouncedSearchKeyword"
        :row-class-name="handleRowClassName"
        :page-count="pageCount"
        :total-count="totalCount"
        :selected-count="selectedIds.length"
        :off-page-selected-count="offPageSelectedCount"
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
    <!-- 跨子域匹配档位弹窗 -->
    <DomainMatchSettingDialog v-model="showDomainMatchDialog" />
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

    <!-- 聚光式新手引导：状态机由本页持有，组件只做渲染（v-if 决定异步 chunk 何时加载） -->
    <OnboardingTour
      v-if="tourActive"
      :tour="tour"
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
const DomainMatchSettingDialog = defineAsyncComponent(
  () => import('@/components/options/DomainMatchSettingDialog.vue'),
);
const CommandPalette = defineAsyncComponent(() => import('@/components/options/CommandPalette.vue'));
// 新手引导：仅首次进入认证态或用户主动重温时才需要这一块，异步加载不占管理页首屏
const OnboardingTour = defineAsyncComponent(() => import('@/components/options/OnboardingTour.vue'));
// 使用指引文档中页：只有 `#guide` 命中时才加载，四十几条正文文案随本 chunk 一同落地
const GuideView = defineAsyncComponent(() => import('@/components/options/GuideView.vue'));
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
import { useOnboardingTour } from '@/composables/useOnboardingTour';
import type { IdentityEntry, IdentityPayload } from '@/utils/identity/types';
import { findDuplicateIdentity } from '@/utils/identity/dedup';
import { getIdentityCrudErrorCode } from '@/utils/storage/identityCrud';
import { exportEncryptedBackup } from '@/utils/backupExport';
import { promptAndVerifyMasterPassword } from '@/utils/masterPasswordVerify';
import { buildHealthReportAsync, type HealthReport } from '@/utils/passwordHealth';
import { normalizeToHostAndPort } from '@/utils/domain';
import { clearPlaintextKeyedCaches } from '@/utils/plaintextCacheCleanup';
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

/** 跨子域匹配档位弹窗可见性 */
const showDomainMatchDialog = ref(false);

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

/**
 * 打开跨子域匹配档位弹窗
 * 供「安全设置」菜单项、命令面板与侧边栏/内联下拉的档位引导（runtime message）共用
 */
const openDomainMatchSetting = (): void => {
  showDomainMatchDialog.value = true;
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
    case 'domainMatch':
      openDomainMatchSetting();
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
  debouncedSearchKeyword,
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
  pagedEntries,
  currentPage,
  pageSize,
  pageCount,
  totalCount,
  offPageSelectedCount,
  currentSort,
  availableTags,
  tagArray,
  loadPasswords,
  patchMetadataOnlyFromStorage,
  handleSortChange,
  restoreSortConfig: initSortConfig,
  restorePageSizeConfig,
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
  consumeLocalOperation,
} = usePasswordManagement({
  validityForm: initialValidityForm,
});

/**
 * 回收站弹窗关闭后，让主表跟上弹窗里改过的档位
 *
 * 两处分页共用同一个存储键，但各自持有自己的响应式 `pageSize`：弹窗内的改动会立刻落盘，
 * 主表却不会凭空知道。不补这一下就会出现「刚在回收站选了 200，回到列表还是 100，
 * 刷新页面才一致」。恢复是同值赋值时 Vue 不触发更新，因此多数情况下这一步零成本。
 */
watch(showTrashDialog, (visible, wasVisible) => {
  if (!visible && wasVisible) void restorePageSizeConfig();
});

/** 批量编辑标签弹窗可见性 */
const showBatchTagDialog = ref(false);

/**
 * 命中集合一变就清空选中
 *
 * 分页要求选择列开 `reserve-selection`（否则换页即丢选，跨页批量处理无从谈起），
 * 代价是 Element Plus 不再在 `data` 换引用时自动清选：`setData` 里保留选择集那条分支
 * 会跳过 `clearSelection()` 与 `cleanSelection()`。而分页**之前**的语义恰恰就是靠这一下
 * 隐式清空——`filteredPasswords` 任何一次重算都返回新数组，表格拿到新 `data` 就把选择归零。
 * 这里把这一下显式补回来，让「筛选/排序/增删改 → 选择集归零」与分页前逐字一致，
 * 顺带避免已删除条目的行对象滞留在 EP 内部（保留模式下没人回收它）。
 */
watch(filteredPasswords, () => {
  passwordTableRef.value?.clearSelection();
});

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
 *
 * 两次 `tabs.query` 并发发起：管理页自身即活动标签页，回退查询每次都会命中，
 * 串行等待等于把两次 IPC 延迟叠加到「点新增 → 弹窗出现」这条用户可感知路径上。
 * 决策逻辑与单次语义不变（回退结果只在需要时被取用）。
 * 回退查询单独吞掉异常：它现在是无条件发起的，若让它 reject 整个 `try`，
 * 一个本来可用的活动标签页 URL 会被连带降级成空预填（旧实现不会走到那一步）。
 */
const openAddDialogWithActiveTab = async () => {
  let prefillUrl = '';
  try {
    const [activeTabQuery, allTabsQuery] = await Promise.all([
      chrome.tabs.query({ active: true, lastFocusedWindow: true }),
      chrome.tabs.query({}).catch(() => []),
    ]);
    const activeTab = activeTabQuery[0];
    let candidateUrl = activeTab?.url ?? '';
    if (!candidateUrl || candidateUrl.startsWith('chrome-extension://') || candidateUrl.startsWith('chrome://')) {
      const webTab = allTabsQuery
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
  // 列表弹窗关闭会释放解密快照（见 IdentityVaultDialog 的 @closed），此时 rows 为空
  // 并不等于「库里没有条目」——按空集判重会让重复证件号静默通过，故先按存储真值补一次加载。
  // 快照非空时不重载，保持既有「对着当前列表判重」的时序与交互不变。
  if (identityVault.rows.value.length === 0) await identityVault.load();
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

/**
 * 会话失效即销毁本上下文「以明文为键」的派生记忆缓存
 *
 * 挂在 `isAuthenticated` 落 false 这条**状态边界**上，而不是只挂在 `onSessionExpired`
 * 回调里：`useAuthFlow` 有五处会把已认证态翻成未认证（广播过期、`checkAuth` 自检出会话
 * 失效、主密码未设置、异常兜底），只补其一就会留下「列表已清空、缓存里还能按明文检索」
 * 的缺口。管理页可整日常驻，这把缓存因此能活过无数次锁定。
 *
 * `flush: 'sync'` 与 `utils/plaintextCacheCleanup.ts` 的口径一致：清理同步落地，
 * 不留「状态已切到验证页、明文键仍可寻址」的微任务窗口。与下方身份库 teardown
 * 分开成两个 watcher，避免把既有 `identityVault.teardown()` 的调度时机一并改掉。
 */
watch(
  isAuthenticated,
  authenticated => {
    if (!authenticated) {
      clearPlaintextKeyedCaches();
    }
  },
  { flush: 'sync' },
);

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
    id: 'guide',
    group: 'entry',
    label: t('options.header.guide'),
    keywords: ['guide', 'help', 'doc', 'manual', 'faq'],
    run: () => openGuide(),
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
    id: 'domainMatch',
    group: 'security',
    label: t('options.header.domainMatch'),
    keywords: ['domain', 'subdomain', 'wildcard', 'match'],
    run: () => openDomainMatchSetting(),
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
  // 引导是 `aria-modal` 的聚光层：面板开在它下面只会得到一个看不见、还在抢焦点的浮层，
  // 因此引导期间直接不给唤起（`canOpen` 为假时快捷键仍会 preventDefault，不串给浏览器）。
  // 文档中页同理：它是整屏的一级视图，面板里的 24 条命令讲的都是列表页的事，
  // 开在它下面只会让用户以为按键没反应——退出文档页有自己的入口（返回按钮 / Esc）。
  // `tour` 与 `guideActive` 在下方声明：这里传的是回调，setup 同步跑完后才可能被按键触发，不存在前置引用问题。
  canOpen: () => isAuthenticated.value && !tour.isActive.value && !guideActive.value,
});

/** Storage 与可见性变化监听 */
useStorageWatcher({
  onAuthChange: () => void checkAuth(),
  onPasswordDataChange: () => void loadPasswords(),
  skipIf: isLocalOperation,
  // 守卫由「事件确实被跳过」解除：本地写入的 onChanged 在大列表重渲染后才会到达，
  // 固定时长清除会让一次保存/收藏仍触发整表全量重载（issue #89 的保存路径实测瓶颈之一）
  consumeSkip: consumeLocalOperation,
  // 外部写入（其他窗口填充、网页自动保存）只动白名单元数据时就地修补列表，
  // 省掉一次 5N 字段解密 + 整表替换；未命中或异常由 watcher 回退整表重载
  patchMetadataOnly: change => patchMetadataOnlyFromStorage(change),
});

/**
 * 应用内联下拉「到全库找」带过来的关键词
 *
 * 一并清掉收藏与标签筛选：两者与搜索是叠加（AND）关系，残留会让「我库里到底有没有这个账号」
 * 这个入口显示成空表。筛选条件是页面态、不入存储，因此清理只影响这次深链呈现的视图。
 */
const applySearchKeyword = (keyword: string): void => {
  searchKeyword.value = keyword;
  favoriteOnly.value = false;
  filterTags.value = [];
};

/** Runtime 消息监听 */
useRuntimeMessageHandler({
  passwords,
  isAuthenticated,
  handleSessionExpired,
  editPassword,
  openPasswordDialog,
  openValiditySetting,
  openSiteRules,
  openDomainMatchSetting,
  applySearchKeyword,
});

// ==================== 使用指引文档中页 ====================

/** 文档页的锚点前缀：`#guide` 开第一章，`#guide/<sectionId>` 直达章节 */
const GUIDE_HASH = '#guide';

/**
 * 从当前 hash 解析文档页路由
 *
 * 只认 `#guide` 与 `#guide/xxx` 两种形状，其余一律视为未进入文档页。章节 id 不在此处
 * 校验：未知 id 交给 GuideView 找不到元素即不滚动，省一份会漂移的白名单副本。
 */
const parseGuideHash = (): { active: boolean; section: string | null } => {
  const hash = window.location.hash;
  if (hash !== GUIDE_HASH && !hash.startsWith(`${GUIDE_HASH}/`)) return { active: false, section: null };
  return { active: true, section: hash.slice(GUIDE_HASH.length + 1) || null };
};

/** 文档页路由状态：唯一事实来源是 hash，前进 / 后退与直接深链都走同一条解析 */
const guideRoute = ref(parseGuideHash());

/** 文档页是否占据当前视图 */
const guideActive = computed(() => guideRoute.value.active);

/** 传给文档页的锚定章节（null 表示落在第一章） */
const guideSection = computed(() => guideRoute.value.section);

/** 同步 hash 变化到路由状态（hashchange 与历史遍历都会走到这里） */
const syncGuideRoute = (): void => {
  guideRoute.value = parseGuideHash();
};

/**
 * 打开文档页
 *
 * 写 hash 而不是直接改状态：浏览器因此留下一条历史记录，后退即可回到列表，
 * 章节链接也能被 Ctrl+点击 / 复制到地址栏。状态同时就地赋值一次，
 * 使「hash 已是该值、不会再触发 hashchange」的重入同样成立。
 * @param section 要直达的章节 id，省略则打开第一章
 */
const openGuide = (section?: string): void => {
  const target = section ? `${GUIDE_HASH}/${section}` : GUIDE_HASH;
  window.location.hash = target;
  guideRoute.value = { active: true, section: section ?? null };
};

/** 关闭文档页回到列表 */
const closeGuide = (): void => {
  window.location.hash = '';
  guideRoute.value = { active: false, section: null };
};

/** 进入文档页前的列表滚动位置：主内容被 `display:none` 收起时文档 scrollTop 归零，返回时原样还回 */
let listScrollTop = 0;

watch(guideActive, (active, previous) => {
  if (active && !previous) {
    listScrollTop = window.scrollY;
    // 引导幕布在 z 3200、文档页在 z 100：不收掉引导，文档页就压在幕布下面看不见。
    // 走 skip() 而非隐藏——用户是从引导卡里主动点走的，「看过」这条承诺照样兑现。
    if (tour.isActive.value) void tour.skip();
    return;
  }
  if (!active && previous) {
    void nextTick(() => window.scrollTo(0, listScrollTop));
  }
});

// ==================== 聚光式新手引导 ====================

/**
 * 引导状态机在本页持有，而非组件内部或模块级全局
 *
 * 组件是异步加载的展示层，生命周期跟着 `v-if` 走；状态放在本页，
 * 才能保证「一次安装只自动弹一次」这条承诺不受组件挂载/卸载顺序影响。
 */
const tour = useOnboardingTour();

/** 顶层解构才能在模板里自动解包 ref：`tour.isActive` 作为对象属性是 Ref 本体，恒为真值 */
const tourActive = tour.isActive;

/** 本次页面加载中是否已经判过要不要自动弹（只在首次进入认证态时读一次存储） */
let tourAutoChecked = false;

/** 手动重温：HeaderBar「新手引导」按钮的入口，走完或退出后仍可反复唤起 */
const replayTour = async () => {
  await tour.start();
};

/**
 * 首次进入认证态后自动引导一次
 *
 * 必须等 `tableLoading` 落定：搜索筛选栏与空库引导卡是互斥渲染的，
 * 加载态下两者都不存在，剧本会缺一步。判定只发生一次，
 * 会话往返（锁解后再认证）不会反复读存储、也不会在用户主动关掉后又冒出来。
 *
 * 文档中页打开时不改判定标志、直接延后：聚光层要圈的是列表页上的真实按钮，
 * 主内容此刻是 `display:none`，锚点一个都找不到。把 `guideActive` 纳入监听源，
 * 返回列表时这一轮会重新触发，承诺仍然只兑现一次。
 */
watch(
  [isAuthenticated, tableLoading, guideActive],
  async ([authenticated, loading, guide]) => {
    if (tourAutoChecked || !authenticated || loading || guide) return;
    tourAutoChecked = true;
    const state = await StorageUtils.getOnboardingTourState();
    if (state.seen) return;
    await nextTick();
    await tour.start();
  },
  { immediate: true },
);

/** 初始化：启动会话管理器、监听会话过期事件、加载配置并检查认证状态 */
onMounted(async () => {
  injectPersonalizationStyles();
  initSessionManager();
  window.addEventListener('sessionExpired', handleSessionExpired);
  // 文档页的章节导航是原生 `<a href="#guide/xxx">`，点击只改 hash 不经过 openGuide；
  // 后退/前进同样只触发本事件。没有它，点章节目录时状态不更新，视图停在原章节。
  window.addEventListener('hashchange', syncGuideRoute);
  // 每页条数决定首帧喂给表格多少行：必须在 checkAuth 拉起数据与渲染之前落定，否则换档要把
  // 整表重排付两遍（本页最贵的单项操作）。它是纯视图偏好，单键读取，不依赖会话态。
  await restorePageSizeConfig();
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
  if (sortConfig.prop && sortConfig.order) {
    passwordTableRef.value?.applySort(sortConfig.prop, sortConfig.order);
  }
};

onUnmounted(() => {
  personalizationViewHandle?.destroy();
  window.removeEventListener('sessionExpired', handleSessionExpired);
  window.removeEventListener('hashchange', syncGuideRoute);
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
