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
      :hint="masterPasswordHint"
      :fail-count="verifyFailCount"
      @submit="handleVerifySubmit"
      @debug="debugPassword"
      @reset="resetMasterPassword"
      @recovered="checkAuth"
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
        :backup-chip="backupChip"
        :lock-loading="clearSessionLoading"
        @add-password="openAddDialogWithActiveTab"
        @open-health="openHealthDialog"
        @open-validity="openValiditySetting"
        @lock-now="handleClearSession"
        @open-identity="openIdentityVaultWithVerify()"
        @open-shortcuts="showShortcutDialog = true"
        @data-command="handleDataCommand"
        @settings-command="handleSettingsCommand"
        @open-personalization="openPersonalizationDialog"
        @open-tour="replayTour"
        @open-guide="openGuide"
        @open-command-palette="paletteOpen"
        @open-about="showAboutDrawer = true"
      />

      <!-- 部分/全部记录无法解密：列表与备份都会静默漏条，必须持续可见 -->
      <el-alert
        v-if="undecryptableCount > 0"
        type="warning"
        :closable="false"
        show-icon
        class="undecryptable-alert"
      >
        {{ t('options.undecryptableNotice', { count: undecryptableCount }) }}
      </el-alert>

      <!-- 版本更新：已有密码库的用户升级后一次性弹窗，首次安装不打扰 -->
      <WhatsNewDialog
        :model-value="whatsNewVisible"
        :version="currentVersion"
        @update:model-value="handleWhatsNewVisibility"
        @cta="handleWhatsNewCta"
      />

      <!-- 安全起步清单：已有密码后提示备份与体检，可暂不提醒 -->
      <ActivationChecklist
        v-if="showActivationChecklist"
        :has-password="passwords.length > 0"
        :has-backup="!!lastVerifiedBackupAt"
        :has-health-check="activationHealthDone"
        @add="handleActivationAdd"
        @import-data="handleActivationImport"
        @backup="handleActivationBackup"
        @health="handleActivationHealth"
        @dismiss="handleActivationDismiss"
      />

      <!-- 会话内备份轻提醒：从未备份，或本次会话刚改过数据且尚未备份时出一次，
           关闭只作用于本页；清单在场时不叠第二条横幅（判据见上方 backupNudge 计算属性） -->
      <BackupNudgeBanner
        v-if="backupNudge"
        :state="backupNudge.state"
        :days="backupNudge.days"
        :vault="backupNudge.vault"
        :other-vault="backupNudgeOtherVault"
        @backup="handleBackupNudgeAction"
        @dismiss="backupNudgeDismissed = true"
      />

      <!-- 一次性评价引导：密码多于 1 条、成功填充过且首次填充满 7 天后出现，可延后或永久关闭 -->
      <ReviewPrompt
        :model-value="showReviewPrompt"
        @update:model-value="handleReviewVisibility"
        @cta="handleReviewCta"
        @snooze="handleReviewSnooze"
        @dismiss="dismissReview"
      />

      <!-- 搜索和筛选（空数据时隐藏） -->
      <SearchFilterBar
        v-if="passwords.length > 0 || tableLoading"
        v-model:search-keyword="searchKeyword"
        v-model:favorite-only="favoriteOnly"
        v-model:filter-tags="filterTags"
        v-model:filter-sites="filterSites"
        :selected-count="selectedIds.length"
        :available-tag-options="availableTagOptions"
        :available-sites="availableSites"
        @filter-dropdown-visible-change="handleFilterDropdownVisibleChange"
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
        :has-active-filters="hasActiveFilters"
        @selection-change="handleSelectionChange"
        @clear-filters="clearFilters"
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
      :keyword="searchKeyword"
      @edit="onDetailEdit"
      @search-identity="onDetailSearchIdentity"
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

    <!-- 身份信息库复验策略弹窗 -->
    <IdentityVaultAccessSetting v-model="showIdentityAccessDialog" />

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

    <!-- 恢复与改密持有敏感草稿：仅在认证且打开时加载，锁定即卸载清理。 -->
    <RecoverySettingsDialog
      v-if="isAuthenticated && showRecoverySettingsDialog"
      v-model="showRecoverySettingsDialog"
    />
    <ChangeMasterPasswordDialog
      v-if="isAuthenticated && showChangeMasterPasswordDialog"
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
      @open-shortcuts="openShortcutsFromPalette"
    />

    <!-- 删除回执：5 秒内可撤销，复用回收站的恢复链路 -->
    <UndoDeleteToast
      :visible="undoDeleteState.visible"
      :message="undoDeleteMessage"
      :action-label="t('options.undoDelete.action')"
      :close-label="t('options.undoDelete.close')"
      :duration="UNDO_DELETE_WINDOW_MS"
      :reset-key="undoDeleteState.token"
      @undo="undoDelete"
      @close="dismissUndo"
      @expire="dismissUndo"
    />

    <!-- 聚光式新手引导：状态机由本页持有，组件只做渲染（v-if 决定异步 chunk 何时加载） -->
    <OnboardingTour
      v-if="tourActive"
      :tour="tour"
    />

    <!-- 「关于」抽屉：版本、数据存放口径与对外链接的集中落点（纯展示，不读存储也不发请求） -->
    <AboutDrawer
      v-model="showAboutDrawer"
      :version="currentVersion"
      @review="handleReviewCta"
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
const IdentityVaultAccessSetting = defineAsyncComponent(
  () => import('@/components/options/IdentityVaultAccessSetting.vue'),
);
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
const RecoverySettingsDialog = defineAsyncComponent(() => import('@/components/options/RecoverySettingsDialog.vue'));
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
// 「关于」抽屉：纯展示、低频入口，异步加载不占管理页首屏
const AboutDrawer = defineAsyncComponent(() => import('@/components/options/AboutDrawer.vue'));
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
import UndoDeleteToast from '@/components/options/UndoDeleteToast.vue';
import EmptyGuide from '@/components/options/EmptyGuide.vue';
import ActivationChecklist from '@/components/options/ActivationChecklist.vue';
import BackupNudgeBanner from '@/components/options/BackupNudgeBanner.vue';
import ReviewPrompt from '@/components/options/ReviewPrompt.vue';
import WhatsNewDialog from '@/components/options/WhatsNewDialog.vue';
import SearchFilterBar from '@/components/options/SearchFilterBar.vue';
import { usePasswordStrength } from '@/composables/usePasswordStrength';
import { useAuthFlow } from '@/composables/useAuthFlow';
import { useSessionTimer } from '@/composables/useSessionTimer';
import { usePasswordManagement, UNDO_DELETE_WINDOW_MS } from '@/composables/usePasswordManagement';
import { useStorageWatcher } from '@/composables/useStorageWatcher';
import { useBackupChip } from '@/composables/useBackupChip';
import { useRuntimeMessageHandler } from '@/composables/useRuntimeMessageHandler';
import { useVersionUpdate } from '@/composables/useVersionUpdate';
import { useIdentityVault } from '@/composables/useIdentityVault';
import { useCommandPalette } from '@/composables/useCommandPalette';
import { useOnboardingTour } from '@/composables/useOnboardingTour';
import type { IdentityEntry, IdentityPayload } from '@/utils/identity/types';
import { findDuplicateIdentity } from '@/utils/identity/dedup';
import { MAX_IDENTITIES } from '@/utils/identity/constants';
import { getIdentityCrudErrorCode } from '@/utils/storage/identityCrud';
import { exportEncryptedBackup } from '@/utils/backupExport';
import { isVerdictOwedNow } from '@/utils/backup/changeDetection';
import { promptAndVerifyMasterPassword } from '@/utils/masterPasswordVerify';
import { shouldVerifyIdentityVault } from '@/utils/identityVaultAccess';
import { buildHealthReportAsync, type HealthReport } from '@/utils/passwordHealth';
import { normalizeToHostAndPort } from '@/utils/domain';
import { clearPlaintextKeyedCaches } from '@/utils/plaintextCacheCleanup';
import { isDev, isFirefox } from '@/utils/env';
import { markOptionsFirstView, markOptionsReady, rememberOptionsFirstView } from './appReady';
import {
  ACTIVATION_SNOOZE_MS,
  dismissActivationChecklist,
  getActivationChecklistState,
} from '@/utils/storage/activationChecklist';
import { getWhatsNewState, markWhatsNewSeen, shouldShowWhatsNew } from '@/utils/storage/whatsNew';
import {
  dismissReviewPrompt,
  getReviewPromptState,
  REVIEW_PROMPT_SNOOZE_MS,
  shouldShowReviewPrompt,
  snoozeReviewPrompt,
} from '@/utils/storage/reviewPrompt';
import { GITHUB_RELEASES_PAGE_URL, REVIEW_PROMPT_URL } from '@/utils/urls';
import { readHealthHistory } from '@/utils/healthHistory';
import {
  Aim,
  Brush,
  Clock,
  Compass,
  Connection,
  CopyDocument,
  Delete,
  Document,
  DocumentCopy,
  Download,
  FolderChecked,
  InfoFilled,
  Key,
  Notebook,
  Link,
  Lock,
  Message,
  Operation,
  Plus,
  Postcard,
  Reading,
  Star,
  Timer,
  Unlock,
  Upload,
} from '@element-plus/icons-vue';
import type { CommandAction } from '@/utils/commandPalette';

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

/** 身份信息库复验策略弹窗可见性 */
const showIdentityAccessDialog = ref(false);

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

/** 「关于」抽屉可见性 */
const showAboutDrawer = ref(false);

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

/** 离线恢复设置仅在用户主动打开时读取配置。 */
const showRecoverySettingsDialog = ref(false);

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

/**
 * 头部备份徽标（档位判据在 `utils/backup/changeDetection`，这里只装配）
 *
 * `lastVerifiedBackupAt` 由本 composable 持有：安全起步清单与徽标读的是同一个时间戳，
 * 不再各读一遍。条目数由下方 watcher 写入，避免为「有没有密码」再整包读一次 `PASSWORDS`。
 */
const {
  backupChip,
  lastVerifiedBackupAt,
  refresh: refreshBackupChip,
  setPasswordCount,
  mutatedThisSession,
} = useBackupChip();

/** 加密备份导出 */
const handleEncryptedBackupExport = async () => {
  if (passwords.value.length === 0) {
    ElMessage.warning(
      undecryptableCount.value > 0
        ? t('options.backup.noReadableData', { count: undecryptableCount.value })
        : t('message.noDataToBackup'),
    );
    return;
  }
  if (!(await confirmIncompleteBackup())) return;
  const masterPassword = await promptAndVerifyMasterPassword(
    t('options.backup.exportTitle'),
    t('options.backup.exportPrompt'),
  );
  if (!masterPassword) return;
  try {
    await exportEncryptedBackup(passwords.value, masterPassword);
    ElMessage.success(t('options.backup.exportSuccess'));
    // 导出内部已在自检通过后落库，重读以反映真实持久态（而非乐观当前时间）
    await refreshBackupChip();
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
 * 本文档生命周期内是否已为身份库成功复验过主密码（`perSession` 档的记账位）
 *
 * 刻意用模块内的普通变量而不是 `ref`：它不进模板、不参与渲染，只作为门槛的一次性凭据，
 * 并必须在会话失效时复位（见下方 `isAuthenticated` 监听）。刷新或重开管理页会回到 `false`，
 * 粒度比「浏览器会话」更严——这是安全开关可接受的偏保守方向，也避免了把复位点铺进
 * `clearSession()` 带来的跨入口改动面。
 */
let identityVaultVerifiedThisSession = false;

/**
 * 打开身份信息库前按策略决定是否复验主密码（纯门槛，刻意不使用返回的密码）
 *
 * 身份库含证件号/卡号等高敏 PII，复验门槛防「会话已解锁但用户离开座位」时
 * 旁人一次性看到全部身份信息；取消则弹窗不得打开。镜像 openTrashWithVerify。
 *
 * 三档策略（`utils/identityVaultAccess.ts`）里只有 `always` 等价于本功能引入前的行为，
 * 默认 `perSession` 省掉的是同一坐席内反复打开的重复输入，**首次打开仍然要问**。
 * 三档都不改解密链路：身份库始终用全局会话数据密钥解密。没写过这个键取默认档，
 * 显式写了个认不出的值则收敛到最严格的 `always`（fail-closed，见 `identityVaultAccess.test.ts`）。
 *
 * `presetKeyword` 供「从条目详情跳来检索」使用：它只进搜索框那一个 `ref`
 * （`useIdentityVault.keyword`），不参与任何解密，也不落盘；弹窗 `@closed → teardown()`
 * 连同视图态一起清掉，所以不会串到下一次正常打开。门槛只有这一处，两个入口共用，
 * 避免哪天新增入口绕过它直接开弹窗。
 *
 * @param presetKeyword 打开后预填的搜索词，默认空
 * @returns 复验是否通过（调用方据此决定要不要收起来源界面——取消复验不该连带弄没用户的抽屉）
 */
const openIdentityVaultWithVerify = async (presetKeyword = ''): Promise<boolean> => {
  const { verifyPolicy } = await StorageUtils.getIdentityVaultAccessConfig();
  if (shouldVerifyIdentityVault(verifyPolicy, identityVaultVerifiedThisSession)) {
    const masterPassword = await promptAndVerifyMasterPassword(t('identity.verifyTitle'), t('identity.verifyPrompt'));
    if (!masterPassword) return false;
    identityVaultVerifiedThisSession = true;
  }
  identityVault.keyword.value = presetKeyword;
  showIdentityVaultDialog.value = true;
  return true;
};

/**
 * 从页面侧身份提示打开身份库
 *
 * 进来的是一个标签（后台已按既有检索口径各收口一次，非法值即 `undefined`）：搜索词预填
 * 检索框——它是页面侧按字段角色取出的那一个标签（本人姓名，或编号族那「一格的字段名」，
 * 分派见 `IdentityHint` 的 `pickSearchKeyword`），作用是让列表直接筛到那一个人或那条字段，
 * 省掉「打开身份库再手打」。复验门槛与 palette 入口共用同一个 `openIdentityVaultWithVerify`，
 * 不新开旁路；词只在复验通过、弹窗确实要打开之后才写入，取消复验时不留检索态。
 *
 * 类别档位**刻意不由这条指令决定**：一条身份条目同时携带证件号、手机号、地址等多个值，
 * 按页面字段角色预选类别会把该命中的条目筛出视野（用户点的就是「搜不到身份证号码」），
 * 因此恒停在「全部」档，交给检索词收敛。
 *
 * @param keyword 已收口的搜索词，缺失时不预填
 */
const openIdentityVaultFromPage = (keyword?: string): void => {
  void openIdentityVaultWithVerify(keyword);
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
    case 'emailBackup':
      openEmailBackupDialog();
      break;
    case 'removeDuplicates':
      removeDuplicates();
      break;
    case 'trash':
      openTrashWithVerify();
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
    case 'recovery':
      showRecoverySettingsDialog.value = true;
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
    case 'identityAccess':
      showIdentityAccessDialog.value = true;
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
  filterSites,
  filteredPasswords,
  undecryptableCount,
  confirmIncompleteBackup,
  pagedEntries,
  currentPage,
  pageSize,
  pageCount,
  totalCount,
  offPageSelectedCount,
  currentSort,
  availableTags,
  availableTagOptions,
  availableSites,
  tagArray,
  loadPasswords,
  patchMetadataOnlyFromStorage,
  handleSortChange,
  restoreSortConfig: initSortConfig,
  restorePageSizeConfig,
  togglePasswordVisibility,
  handleRowClassName,
  handleSelectionChange,
  handleFilterDropdownVisibleChange,
  openPasswordDialog,
  editPassword,
  resetPasswordForm,
  applyPasswordFormPatch,
  handlePasswordFormSave,
  copyPassword,
  deletePassword,
  batchDelete,
  undoDeleteState,
  undoDeleteMessage,
  undoDelete,
  dismissUndo,
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

// 把已在手的条目数交给备份徽标（`immediate` 覆盖「会话有效、列表已解密」的直达场景），
// 徽标因此不需要为「有没有密码」再整包读一次 PASSWORDS
watch(() => passwords.value.length, setPasswordCount, { immediate: true });

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

/**
 * 异步更新健康报告（密码列表变化时触发）
 *
 * 「体检」按钮会等这份报告就绪后再打开弹窗：刚新增/导入条目就立刻点体检时，列表已经变了、
 * 字典校验还在异步跑，旧实现会把空库报告直接铺进弹窗。同一份列表复用已在飞的 Promise；
 * 列表在等待期间再次变化则发起新的一轮，旧结果由落地时的引用比较丢弃，避免后到的旧报告覆盖新列表。
 *
 * 这里**不做**「算过就复用」的结果缓存：新增与编辑走的是就地更新（`passwords.value.push` /
 * `Object.assign`，见 `composables/usePasswordManagement.ts`），数组引用全程不变，按引用认列表会让
 * 挂载那次算出的空库报告永久命中——实测表现为「加完条目点体检，弹窗还说还没有密码」。改按内容
 * 认（条数 + 最大 `updateTime`）又漏掉 `batchEditTags` 这类**刻意不刷新 `updateTime`** 的就地改字段。
 * 2000 条整库重算实测 warm 23ms / cold 43ms，比任何一套指纹都便宜，所以每次打开都重算。
 */
let healthReportPromise: Promise<void> | null = null;
/** 在飞那一轮开始时的列表引用：引用变了就另起一轮，避免把旧数组的结果当成新列表的结果 */
let healthReportInFlightList: PasswordEntry[] | null = null;

const syncHealthReport = (): Promise<void> => {
  const list = passwords.value;
  if (healthReportPromise && healthReportInFlightList === list) return healthReportPromise;
  healthReportInFlightList = list;
  const promise = buildHealthReportAsync(list, Date.now())
    .then(report => {
      if (list === passwords.value) healthReport.value = report;
    })
    .finally(() => {
      if (healthReportPromise === promise) {
        healthReportPromise = null;
        healthReportInFlightList = null;
      }
    });
  healthReportPromise = promise;
  return promise;
};

watch(
  passwords,
  () => {
    void syncHealthReport().catch(error => logger.error('更新健康报告失败:', error));
  },
  { immediate: true },
);

/** 打开体检弹窗前等待当前列表的报告就绪 */
const openHealthDialog = async (): Promise<void> => {
  try {
    await syncHealthReport();
  } catch (error) {
    // 报告失败仍打开弹窗（显示上一份报告），比点了没反应更可诊断
    logger.error('打开安全体检前更新报告失败:', error);
  }
  showHealthDialog.value = true;
};

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

/**
 * 从详情抽屉跳去身份信息库检索该用户名
 *
 * 回答的是「这个账号绑的是哪个手机号/邮箱」，但**不做跨库关联**：用户名只当搜索词递给
 * 身份库，由身份库自己的搜索口径（姓名/证件号/手机号/卡号，拼音与子串都算）去命中，
 * 因此这里不需要新的匹配语义、不给 `PasswordEntry` 加关联字段、也不在密码库里显示 PII 值。
 * 复验门槛通过后收起抽屉（与 `onDetailEdit` 同形：一次只留一个上层视图），
 * 用户取消复验则抽屉原地不动。
 * @param username 抽屉当前条目的用户名
 */
const onDetailSearchIdentity = async (username: string): Promise<void> => {
  if (!(await openIdentityVaultWithVerify(username))) return;
  showDetailDrawer.value = false;
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
  masterPasswordHint,
  verifyFailCount,
  checkAuth,
  handleSetupSubmit,
  handleVerifySubmit,
  handleSessionExpired,
  debugPassword,
  resetMasterPassword,
} = useAuthFlow({
  loadPasswords,
  // 列表解密要等会话判定之后：骨架据此先切到 setup / verify / vault，避免显示错状态
  onFirstViewResolved: markOptionsFirstView,
  onSessionExpired: () => {
    passwords.value = [];
  },
});

/**
 * 认证状态变化时同步刷新「上次视图」提示
 *
 * head 里的同步预判脚本靠 sessionStorage 让下一次刷新直接落到正确骨架。页面内锁定 / 解锁
 * 之后这份提示必须跟着变，否则刷新会先闪旧形态（例如会话过期后仍先画表格骨架）。
 */
watch([showMasterPasswordSetup, showPasswordVerify, isAuthenticated], ([setup, verify, authenticated]) => {
  if (setup) rememberOptionsFirstView('setup');
  else if (verify) rememberOptionsFirstView('verify');
  else if (authenticated) rememberOptionsFirstView('vault');
});

// ==================== 更新提示与一次性评价引导 ====================
// 只持久化「已读版本」「评价已关闭 / 已延后 / 首次填充时间」几项非敏感时间戳；
// 首次填充由后台在填充使用痕迹落盘时记录一次，页面只读。
const growthReady = ref(false);
const whatsNewVisible = ref(false);
/** 本次页面已展示过更新卡片时，评价引导延后到下次打开，避免连续两张卡片 */
const whatsNewShownThisSession = ref(false);
const reviewDismissedAt = ref<number | null>(null);
const reviewSnoozedUntil = ref<number | null>(null);
const reviewFirstFillAt = ref<number | null>(null);

// ==================== 安全起步清单 ====================
// 完成状态全部由已有事实派生：密码数量、最近验证备份、体检趋势是否存在。
// 唯一新增持久化是「暂不提醒」时间戳，见 utils/storage/activationChecklist.ts。

const ACTIVATION_TOTAL_STEPS = 3;
const activationStateReady = ref(false);
const activationDismissedAt = ref<number | null>(null);
const activationHealthDone = ref(false);

const activationDoneCount = computed(
  () =>
    [passwords.value.length > 0, Boolean(lastVerifiedBackupAt.value), activationHealthDone.value].filter(Boolean)
      .length,
);

const activationSnoozed = computed(
  () => activationDismissedAt.value !== null && Date.now() - activationDismissedAt.value < ACTIVATION_SNOOZE_MS,
);

const showReviewPrompt = computed(
  () =>
    growthReady.value &&
    isAuthenticated.value &&
    !isFirefox &&
    !tableLoading.value &&
    !whatsNewVisible.value &&
    !whatsNewShownThisSession.value &&
    shouldShowReviewPrompt({
      dismissedAt: reviewDismissedAt.value,
      snoozedUntil: reviewSnoozedUntil.value,
      firstFillAt: reviewFirstFillAt.value,
      passwordCount: passwords.value.length,
    }),
);

const showActivationChecklist = computed(
  () =>
    activationStateReady.value &&
    isAuthenticated.value &&
    passwords.value.length > 0 &&
    !whatsNewVisible.value &&
    !activationSnoozed.value &&
    activationDoneCount.value < ACTIVATION_TOTAL_STEPS,
);

/**
 * 会话内备份轻提醒（R1）
 *
 * 出声条件刻意收紧：徽标已到「待备份」档不代表**刚**改过数据（可能只是上月那次改动一直没备份），
 * 那种情况下头部徽标已经常驻说同一件事，再叠一条横幅就是噪音。因此只认两种情形：
 * - `critical`：一次都没通过自检导出过（换机 / 重装 / 误删时零退路），清单不在场时持续提示；
 * - `urgent` + 本次页面会话内确实发生过变更：即用户「刚添加 / 刚改完密码」这个时间点。
 *
 * 关闭只作用于本页会话（不新增持久化键、不加闹钟与桌面通知），
 * 与「安全起步清单」互斥：清单在场时它已经把备份列为待办之一。
 */
const backupNudgeDismissed = ref(false);
const backupNudge = computed<{ state: 'never' | 'stale'; days: number; vault: 'passwords' | 'identity' } | null>(() => {
  if (backupNudgeDismissed.value || showActivationChecklist.value || !isAuthenticated.value) return null;
  const chip = backupChip.value;
  if (!chip.visible) return null;
  if (chip.level === 'critical') return { state: 'never', days: 0, vault: chip.worstVault };
  if (chip.level === 'urgent' && mutatedThisSession.value) {
    return { state: 'stale', days: chip.ageDays ?? 0, vault: chip.worstVault };
  }
  return null;
});

/**
 * 另一库是否也该被点名
 *
 * 横幅一次只推一份备份（两库是 `.aph` 与 `.aphid` 两份互不覆盖的文件），但用户看不到
 * 「另一库同样欠着」这件事——它原本只藏在徽标 tooltip 里，而此刻注意力在横幅上。
 * 收紧口径与横幅自己一致：只认 `never` / `pending`（也就是横幅自己够格出现的两档）。
 * 另一库是 `stale`（备份已久但期间没改过）时不点名——没有新数据要丢，副句就成了噪音；
 * 是 `hidden`（空库）或 `ok` 时更不该提。
 * 备完第一份后徽标档位重算、`worstVault` 翻过去，横幅会自然接手第二份，不必在此并列两条。
 */
const backupNudgeOtherVault = computed<'passwords' | 'identity' | null>(() => {
  const nudge = backupNudge.value;
  if (!nudge) return null;
  const other = nudge.vault === 'identity' ? 'passwords' : 'identity';
  return isVerdictOwedNow(backupChip.value.perVault[other].verdict) ? other : null;
});

/** 轻提醒的出口与徽标同一套分派：欠哪一份备份，就把用户送到哪一份的导出入口 */
const handleBackupNudgeAction = (): void => {
  if (backupNudge.value?.vault === 'identity') {
    void openIdentityVaultWithVerify();
    return;
  }
  handleDataCommand('backupExport');
};
/** 读取清单唯一需要异步补齐的两项：暂不提醒时间与体检趋势是否存在 */
const loadActivationState = async (): Promise<void> => {
  const [state, history] = await Promise.all([getActivationChecklistState(), readHealthHistory()]);
  activationDismissedAt.value = state.dismissedAt;
  activationHealthDone.value = history.length > 0;
  activationStateReady.value = true;
};

/** 体检弹窗关闭后刷新趋势完成态；弹窗打开时写入快照，关闭时才能读到 */
const refreshActivationHealthDone = async (): Promise<void> => {
  activationHealthDone.value = (await readHealthHistory()).length > 0;
};

const handleActivationAdd = (): void => {
  void openAddDialogWithActiveTab();
};

const handleActivationImport = (): void => {
  showImportDialog.value = true;
};

const handleActivationBackup = (): void => {
  handleDataCommand('backupExport');
};

const handleActivationHealth = (): void => {
  void openHealthDialog();
};

const handleActivationDismiss = (): void => {
  const at = Date.now();
  activationDismissedAt.value = at;
  void dismissActivationChecklist(at);
};

/**
 * 初始化「本次更新」与一次性评价引导
 *
 * 首次安装（还没有主密码配置）直接把当前版本记为已读，不弹更新弹窗；
 * 已有密码库的用户在版本变化时看到一次更新要点。评价引导在「保存的密码多于 1 条、
 * 至少成功填充过一次、且首次填充已满 7 天」时询问一次，可延后 30 天或永久关闭。
 */
const initGrowthPrompts = async (): Promise<void> => {
  try {
    const [hasVault, whatsNewState, reviewState] = await Promise.all([
      StorageUtils.hasMasterPassword(),
      getWhatsNewState(),
      getReviewPromptState(),
    ]);
    if (
      shouldShowWhatsNew({
        seenVersion: whatsNewState.seenVersion,
        currentVersion: currentVersion.value,
        hasVault,
      })
    ) {
      whatsNewVisible.value = true;
      whatsNewShownThisSession.value = true;
    } else if (!hasVault) {
      await markWhatsNewSeen(currentVersion.value);
    }
    reviewDismissedAt.value = reviewState.dismissedAt;
    reviewSnoozedUntil.value = reviewState.snoozedUntil;
    reviewFirstFillAt.value = reviewState.firstFillAt;
  } catch (error) {
    logger.warn('初始化更新与评价提示失败:', error);
  } finally {
    growthReady.value = true;
  }
};

/**
 * 弹窗显隐：无论通过「知道了」、右上角关闭、Esc 还是遮罩关闭，都写回已读版本
 * 并停止本次会话中的评价引导，避免同一轮连续出现两张卡片。
 */
const handleWhatsNewVisibility = (visible: boolean): void => {
  whatsNewVisible.value = visible;
  if (!visible) void markWhatsNewSeen(currentVersion.value);
};

/**
 * 打开外部页面：失败时给出可见反馈并返回 false
 *
 * CTA 不能先写已读再点火：`chrome.tabs.create` 失败（扩展上下文失效、系统限制）时
 * 用户既没看到页面，提示又会永久消失。成功后才由调用方落盘已读/关闭状态。
 */
const openExternalPage = async (url: string, failureMessage: string): Promise<boolean> => {
  try {
    await chrome.tabs.create({ url });
    return true;
  } catch (error) {
    logger.warn('打开外部页面失败:', error);
    ElMessage.error(failureMessage);
    return false;
  }
};

const handleWhatsNewCta = async (): Promise<void> => {
  const opened = await openExternalPage(GITHUB_RELEASES_PAGE_URL, t('options.growth.whatsNew.openFailed'));
  if (!opened) return;
  whatsNewVisible.value = false;
  await markWhatsNewSeen(currentVersion.value);
};

const dismissReview = (): void => {
  const at = Date.now();
  reviewDismissedAt.value = at;
  reviewSnoozedUntil.value = null;
  void dismissReviewPrompt(at);
};

const handleReviewSnooze = (): void => {
  const at = Date.now();
  reviewSnoozedUntil.value = at + REVIEW_PROMPT_SNOOZE_MS;
  void snoozeReviewPrompt(at);
};

/**
 * 弹窗被 ESC / 点遮罩关闭时按「稍后再说」处理
 *
 * 三个动作按钮（去评价 / 稍后再说 / 不再提醒）各自写回状态后，`showReviewPrompt`
 * 计算属性随即转 false 关闭弹窗。判据因此取「父层状态还没落定」，而不是「收到一次
 * false」：`el-dialog` 在关闭动画结束时（Element Plus `useDialog.afterLeave`）**无条件**
 * 补抛一次 `update:modelValue(false)`，程序性关闭也不例外。若照单全收，「不再提醒」会在
 * 写完永久关闭之后紧跟一条 30 天静默期，把两个互斥状态同时写进存储。
 */
const handleReviewVisibility = (visible: boolean): void => {
  if (!visible && showReviewPrompt.value) handleReviewSnooze();
};

const handleReviewCta = async (): Promise<void> => {
  const opened = await openExternalPage(REVIEW_PROMPT_URL, t('options.growth.review.openFailed'));
  if (!opened) return;
  dismissReview();
};

watch(showHealthDialog, (visible, wasVisible) => {
  if (!visible && wasVisible) void refreshActivationHealthDone();
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
      ElMessage.error(t('identity.form.limitReached', { max: MAX_IDENTITIES }));
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
      showRecoverySettingsDialog.value = false;
      showChangeMasterPasswordDialog.value = false;
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
    // 锁定/过期即作废「本会话已复验」凭据：`perSession` 档下重新解锁必须再问一次，
    // 否则门槛退化成「只要曾经解锁过一次就永久免验」，威胁模型当场失效。
    identityVaultVerifiedThisSession = false;
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
 * `label` 复用既有菜单文案，`keywords` 仅为检索别名（不渲染，故不受 i18n 约束）——但别往里写
 * 属于另一条命令的词：匹配方向是「输入必须是别名的子串」，借词会把那个词的首位结果抢过来。
 * 清单会在 `useCommandPalette` 里 `watch(filtered)` 的初次求值时跑一遍，
 * 所以引用声明在本清单之后的 handler 必须包一层箭头（`run: () => foo()`），写函数名会撞 TDZ。
 *
 * **分组与组内顺序逐字镜像头部**：`entry` = 左组三颗核心动作（添加密码 → 安全体检 → 个人信息库），
 * `data` / `security` 与两个下拉同序（`security` 首位是头部的「立即锁定」，它不在下拉里），
 * `preferences` = 偏好设置按钮，`help` = 「帮助」下拉四项（新手引导 → 使用指引 → 快捷键 → 关于）。
 * 这条镜像由 `tests/architecture/headerActionInventory.test.ts` 按下拉与分组的同序同集钉住。
 * 增删条目要同轮改 14 个对外文件里的 20 处条数文案；这两条判据都在 `tests/architecture/commandPaletteCopy.test.ts`。
 */
const buildPaletteActions = (): CommandAction[] => [
  {
    id: 'add',
    group: 'entry',
    label: t('options.header.addPassword'),
    icon: Plus,
    keywords: ['add', 'new', 'create'],
    run: openAddDialogWithActiveTab,
  },
  {
    id: 'health',
    group: 'entry',
    label: t('options.header.healthCheck'),
    icon: Aim,
    keywords: ['health', 'audit', 'score'],
    run: () => void openHealthDialog(),
  },
  {
    id: 'identityVault',
    group: 'entry',
    label: t('identity.title'),
    icon: Postcard,
    keywords: ['identity', 'vault', 'pii'],
    run: () => openIdentityVaultWithVerify(),
  },
  {
    id: 'downloadTemplate',
    group: 'data',
    label: t('options.header.downloadTemplate'),
    icon: Document,
    keywords: ['template', 'csv', 'excel'],
    run: downloadTemplate,
  },
  {
    id: 'import',
    group: 'data',
    label: t('options.header.importData'),
    icon: Upload,
    keywords: ['import', 'csv', 'json', 'excel'],
    run: () => (showImportDialog.value = true),
  },
  {
    id: 'export',
    group: 'data',
    label: t('options.header.exportData'),
    icon: Download,
    keywords: ['export', 'csv'],
    run: exportPasswords,
  },
  {
    id: 'exportJson',
    group: 'data',
    label: t('options.header.exportJson'),
    icon: Download,
    keywords: ['export', 'json'],
    run: exportPasswordsJson,
  },
  {
    id: 'backupExport',
    group: 'data',
    label: t('options.header.backupExport'),
    icon: Lock,
    keywords: ['backup', 'export', 'aph'],
    run: handleEncryptedBackupExport,
  },
  {
    id: 'backupImport',
    group: 'data',
    label: t('options.header.backupImport'),
    icon: Unlock,
    keywords: ['backup', 'import', 'restore', 'aph'],
    run: () => (showBackupImportDialog.value = true),
  },
  {
    id: 'emailBackup',
    group: 'data',
    label: t('options.header.emailBackup'),
    icon: Message,
    keywords: ['email', 'mail', 'backup', 'emailBackup'],
    run: openEmailBackupDialog,
  },
  {
    id: 'removeDuplicates',
    group: 'data',
    label: t('options.header.removeDuplicates'),
    icon: CopyDocument,
    keywords: ['dedup', 'duplicate'],
    run: removeDuplicates,
  },
  {
    id: 'trash',
    group: 'data',
    label: t('options.header.trash'),
    icon: Delete,
    keywords: ['trash', 'deleted'],
    run: openTrashWithVerify,
  },
  {
    id: 'lockNow',
    group: 'security',
    label: t('options.header.lockNow'),
    icon: Lock,
    keywords: ['locknow', 'lock', 'now', 'clear'],
    run: handleClearSession,
  },
  {
    id: 'changeMasterPassword',
    group: 'security',
    label: t('options.header.changeMasterPassword'),
    icon: Key,
    keywords: ['master', 'password', 'change'],
    run: () => (showChangeMasterPasswordDialog.value = true),
  },
  {
    id: 'recovery',
    group: 'security',
    label: t('recovery.settingsTitle'),
    icon: Notebook,
    keywords: ['offline', 'recovery', 'kit', '离线', '恢复', '密钥'],
    run: () => (showRecoverySettingsDialog.value = true),
  },
  {
    id: 'validity',
    group: 'security',
    label: t('options.header.validity'),
    icon: Timer,
    keywords: ['validity', 'session', 'expire'],
    run: openValiditySetting,
  },
  {
    id: 'idleLock',
    group: 'security',
    label: t('options.header.idleLock'),
    icon: Clock,
    keywords: ['idle', 'lock', 'auto'],
    run: () => (showIdleLockDialog.value = true),
  },
  {
    id: 'identityAccess',
    group: 'security',
    label: t('options.header.identityAccess'),
    icon: Postcard,
    keywords: ['identity', 'vault', 'verify', 'master', '个人信息库', '身份信息库', '身份库', '复验'],
    run: () => (showIdentityAccessDialog.value = true),
  },
  {
    id: 'autoSave',
    group: 'security',
    label: t('options.header.autoSave'),
    icon: FolderChecked,
    keywords: ['autosave', 'auto', 'save'],
    run: () => (showAutoSaveDialog.value = true),
  },
  {
    id: 'siteRules',
    group: 'security',
    label: t('options.header.siteRules'),
    icon: Link,
    keywords: ['site', 'rule', 'selector', 'shadow'],
    run: () => openSiteRules(),
  },
  {
    id: 'domainMatch',
    group: 'security',
    label: t('options.header.domainMatch'),
    icon: Connection,
    keywords: ['domain', 'subdomain', 'wildcard', 'match'],
    run: () => openDomainMatchSetting(),
  },
  {
    id: 'clipboard',
    group: 'security',
    label: t('options.header.clipboard'),
    icon: DocumentCopy,
    keywords: ['clipboard', 'copy'],
    run: () => (showClipboardDialog.value = true),
  },
  {
    id: 'passwordHistory',
    group: 'security',
    label: t('options.historySetting.title'),
    icon: Document,
    keywords: ['history'],
    run: () => (showPasswordHistoryDialog.value = true),
  },
  {
    id: 'favoriteLimit',
    group: 'security',
    label: t('options.header.favoriteLimit'),
    icon: Star,
    keywords: ['favorite', 'limit', 'star'],
    run: () => (showFavoriteLimitDialog.value = true),
  },
  {
    id: 'personalization',
    group: 'preferences',
    label: t('options.header.personalization'),
    icon: Brush,
    keywords: ['preference', 'theme', 'language'],
    run: openPersonalizationDialog,
  },
  {
    id: 'tour',
    group: 'help',
    label: t('options.header.tour'),
    icon: Compass,
    keywords: ['tour', 'onboarding', 'walkthrough', 'replay'],
    run: () => replayTour(),
  },
  {
    id: 'guide',
    group: 'help',
    label: t('options.header.guide'),
    icon: Reading,
    keywords: ['guide', 'help', 'doc', 'manual', 'faq'],
    run: () => openGuide(),
  },
  {
    id: 'shortcuts',
    group: 'help',
    label: t('options.header.shortcuts'),
    icon: Operation,
    keywords: ['shortcuts', 'shortcut', 'hotkey', 'key'],
    run: () => (showShortcutDialog.value = true),
  },
  {
    id: 'about',
    group: 'help',
    label: t('options.header.about'),
    icon: InfoFilled,
    keywords: ['about', 'version', 'info', 'privacy', 'link'],
    run: () => (showAboutDrawer.value = true),
  },
];

/** 命令面板控制器：仅认证态可唤起，动作复用既有 handler */
const {
  visible: paletteVisible,
  keyword: paletteKeyword,
  activeIndex: paletteActiveIndex,
  filtered: paletteFiltered,
  open: paletteOpen,
  close: paletteClose,
  runAt: paletteRunAt,
} = useCommandPalette({
  getActions: buildPaletteActions,
  // 引导是 `aria-modal` 的聚光层：面板开在它下面只会得到一个看不见、还在抢焦点的浮层，
  // 因此引导期间直接不给唤起（`canOpen` 为假时快捷键仍会 preventDefault，不串给浏览器）。
  // 文档中页同理：它是整屏的一级视图，命令面板讲的都是列表页的事，
  // 开在它下面只会让用户以为按键没反应——退出文档页有自己的入口（返回按钮 / Esc）。
  // `tour` 与 `guideActive` 在下方声明：这里传的是回调，setup 同步跑完后才可能被按键触发，不存在前置引用问题。
  canOpen: () => isAuthenticated.value && !tour.isActive.value && !guideActive.value,
});

/**
 * 从面板 footer 的「快捷键」入口打开快捷键一览
 *
 * 先收面板再开弹窗，与 `runAt` 的收尾顺序一致（面板遮罩压在弹窗上面会既挡视又抢焦点）；
 * 打开的仍是清单里 `shortcuts` 那条用的同一个弹窗、同一个 flag，不另开第二份状态。
 */
const openShortcutsFromPalette = (): void => {
  paletteClose();
  showShortcutDialog.value = true;
};

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
 * 一并清掉收藏、标签与站点筛选：三者与搜索是叠加（AND）关系，残留会让「我库里到底有没有这个账号」
 * 这个入口显示成空表。筛选条件是页面态、不入存储，因此清理只影响这次深链呈现的视图。
 */
const applySearchKeyword = (keyword: string): void => {
  searchKeyword.value = keyword;
  favoriteOnly.value = false;
  filterTags.value = [];
  filterSites.value = [];
};

/**
 * 是否有生效中的筛选条件
 *
 * 供表格空态判断该给「清空筛选」出口还是纯占位文案。搜索、收藏、标签、站点四者是
 * 叠加（AND）关系，任一非空都可能把列表筛成 0 条。
 */
const hasActiveFilters = computed(
  () =>
    !!searchKeyword.value.trim() || favoriteOnly.value || filterTags.value.length > 0 || filterSites.value.length > 0,
);

/** 清空全部筛选条件，回到整库视图（表格空态里的「清空筛选」按钮） */
const clearFilters = (): void => {
  searchKeyword.value = '';
  favoriteOnly.value = false;
  filterTags.value = [];
  filterSites.value = [];
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
  openIdentityVault: openIdentityVaultFromPage,
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
  // 备份徽标与清单共用的时间戳：非敏感、单键读取，不挡首帧（徽标在数据到位后自己亮）
  void refreshBackupChip();
  // 安全起步清单的暂不提醒状态与体检趋势；两项都只读非敏感摘要，失败时降级为未完成
  void loadActivationState();
  // 更新提示与一次性评价引导；版本/关闭标记都只读非敏感数据
  void initGrowthPrompts();
  // 等待 Vue 刷新 DOM，确保 PasswordTable 组件已挂载
  await nextTick();
  // 恢复表格排序配置；等排序落定再揭开骨架，避免淡出过程中表格又重排一次
  await restoreSortConfig().catch(error => logger.error('恢复排序配置失败:', error));
  // 首屏真实视图（认证结论 + 列表 / 设置页）已经完成绘制，通知 main.ts 淡出静态骨架；
  // 双 rAF 保证淡出开始时浏览器已经画过这一帧，而不是在布局完成前就揭开覆盖层。
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => markOptionsReady());
  });
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

/*
 * 筛选候选面板滚到末行之后，继续滚动会把底下的列表推着走（面板同时飘出视口）。
 * 实测：30 个站点候选、面板 274px，滚到底再滚一格，文档 scrollTop 从 150 跳到 950。
 * 原因是这两个下拉的浮层不是模态 —— Element Plus 只给 dialog/drawer 上 body 锁滚，
 * 浮层里的虚拟列表滚到底，滚动链就顺着祖先一路交给文档。`contain` 把这条链剪断在
 * 面板自己的滚动容器上，面板内部照常滚。
 * 必须留在非 scoped 块：实测浮层由 Element Plus 挂到 body 下的裸 div 里（不在
 * `.options-page` 子树内），滚动容器 `.el-vl__window` 上也没有任何 `data-v-*`，
 * scoped 规则编译后带 `[data-v-*]`，对它永远匹配不到。
 */
.tag-filter-popper .el-vl__window,
.site-filter-popper .el-vl__window {
  overscroll-behavior: contain;
}

/*
 * 候选行的悬浮死区：Element Plus 给 `<li>` 的是 `padding: 0 32px 0 20px`，而 title 挂在这段
 * padding 内侧的 `.facet-option` 上——实测行首 6px 的落点解析到的就是这颗 `<li>` 本身，
 * 祖先链上没有 title，鼠标停在那里什么也不弹（面板本体才 200px，这 52px 是整行的四分之一）。
 * 把 padding 归零、让 `.facet-option` 自持同值内边距，title 的覆盖面即等于整行，文本落点不变。
 * 选中态那颗对勾是 `<li>::after` 的 `right: 20px` 绝对定位，不随 padding 移动，仍在原位。
 * 同样必须留在非 scoped 块：`<li>` 由 Element Plus 渲染，节点上没有 `data-v-*`。
 */
.tag-filter-popper .el-select-dropdown__item,
.site-filter-popper .el-select-dropdown__item {
  padding: 0;
}

/*
 * 复验门槛弹窗（回收站、身份信息库）开着时，滚动穿透到底下的列表。
 * 实测：滚轮打在遮罩上一格 deltaY=800，文档 scrollTop 回收站 0→800、身份信息库 87→887；
 * 同期「导入数据」（无复验）与详情抽屉都是 0 —— 差别不在弹窗本身，在那把 body 锁滚类。
 * 根因是这两个入口要先弹 `ElMessageBox` 复验主密码，复验通过后的 200ms 内才弹正式弹窗，
 * 而 Element Plus 的 `useLockscreen` 在「类已在」时不给后来者记账（`withoutHiddenClass=false`），
 * 于是 MessageBox 的延时 cleanup 把锁摘了 —— 弹窗还开着，`body` 已解锁，
 * 遮罩这层滚动容器（`.el-overlay-dialog`，EP 编译产物里是 `position:fixed;inset:0;overflow:auto`）
 * 内容不够高，滚动链就顺着它交给文档。
 * 这里不修「锁」——那是 EP 内部实现，且补锁要动 MessageBox 的关闭时序；只把滚动链剪断在
 * 遮罩自己身上，症状即消。上面那两条复验门槛路径的判据见 `e2e/dialog-scroll-isolation.spec.ts` 第 5 条。
 * 同样必须留在非 scoped 块：遮罩由 EP 挂到 `body` 下，节点不带 `data-v-*`。
 */
.el-overlay-dialog {
  overscroll-behavior: contain;
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
