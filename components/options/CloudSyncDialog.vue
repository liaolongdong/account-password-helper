<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('cloudSync.title')"
    width="860px"
    align-center
    :close-on-click-modal="false"
    :close-on-press-escape="!running"
    :show-close="!running"
    @update:model-value="handleDialogVisibility"
    @closed="handleClosed"
  >
    <div class="dialog-body-scroll cloud-sync">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        class="cloud-sync__intro"
      >
        <template #title>{{ t('cloudSync.introTitle') }}</template>
        <div class="cloud-sync__intro-text">
          {{ t('cloudSync.introText') }}
        </div>
      </el-alert>

      <el-tabs v-model="activeProvider">
        <el-tab-pane
          :label="t('cloudSync.provider.feishu')"
          name="feishu"
        />
        <el-tab-pane
          :label="t('cloudSync.provider.tencent')"
          name="tencent"
        />
        <el-tab-pane
          :label="t('cloudSync.provider.webdav')"
          name="webdav"
        />
      </el-tabs>

      <div class="cloud-sync__grid">
        <el-form
          label-position="top"
          :disabled="running"
        >
          <el-form-item :label="t('cloudSync.enable')">
            <el-switch
              v-model="enabled"
              :active-text="t('common.on')"
              :inactive-text="t('common.off')"
            />
            <div class="cloud-sync__hint">
              {{ t('cloudSync.enableTip') }}
            </div>
          </el-form-item>

          <el-form-item
            v-if="activeProvider !== 'webdav'"
            :label="t('cloudSync.mode')"
          >
            <el-radio-group
              :model-value="providerForm.mode"
              @change="handleModeChange"
            >
              <el-radio-button value="encrypted">
                {{ t('cloudSync.modeEncrypted') }}
              </el-radio-button>
              <el-radio-button value="plaintext">
                {{ t('cloudSync.modePlaintext') }}
              </el-radio-button>
            </el-radio-group>
            <div class="cloud-sync__hint">
              {{
                providerForm.mode === 'encrypted' ? t('cloudSync.modeEncryptedTip') : t('cloudSync.modePlaintextTip')
              }}
            </div>
          </el-form-item>

          <el-alert
            v-else
            type="info"
            :closable="false"
            show-icon
            class="cloud-sync__intro"
          >
            <template #title>{{ t('cloudSync.modeEncrypted') }}</template>
            <div class="cloud-sync__intro-text">
              {{ t('cloudSync.webdav.encryptedOnly') }}
            </div>
          </el-alert>

          <template v-if="activeProvider === 'feishu'">
            <el-form-item :label="t('cloudSync.feishu.appId')">
              <el-input
                v-model="feishuCredentials.appId"
                autocomplete="off"
                :placeholder="t('cloudSync.feishu.appIdPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="t('cloudSync.feishu.appSecret')">
              <el-input
                v-model="feishuCredentials.appSecret"
                type="password"
                show-password
                autocomplete="new-password"
                :placeholder="t('cloudSync.feishu.appSecretPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="t('cloudSync.feishu.baseUrl')">
              <el-input
                v-model="feishuBaseUrl"
                autocomplete="off"
                :placeholder="t('cloudSync.feishu.baseUrlPlaceholder')"
              />
              <div class="cloud-sync__hint">
                {{ t('cloudSync.feishu.baseUrlTip') }}
              </div>
            </el-form-item>
          </template>

          <template v-else-if="activeProvider === 'tencent'">
            <el-form-item :label="t('cloudSync.tencent.clientId')">
              <el-input
                v-model="tencentCredentials.clientId"
                autocomplete="off"
                :placeholder="t('cloudSync.tencent.clientIdPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="t('cloudSync.tencent.openId')">
              <el-input
                v-model="tencentCredentials.openId"
                autocomplete="off"
                :placeholder="t('cloudSync.tencent.openIdPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="t('cloudSync.tencent.accessToken')">
              <el-input
                v-model="tencentCredentials.accessToken"
                type="password"
                show-password
                autocomplete="new-password"
                :placeholder="t('cloudSync.tencent.accessTokenPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="t('cloudSync.tencent.baseUrl')">
              <el-input
                v-model="tencentBaseUrl"
                autocomplete="off"
                :placeholder="t('cloudSync.tencent.baseUrlPlaceholder')"
              />
              <div class="cloud-sync__hint">
                {{ t('cloudSync.tencent.baseUrlTip') }}
              </div>
            </el-form-item>
          </template>

          <template v-else>
            <el-form-item :label="t('cloudSync.webdav.username')">
              <el-input
                v-model="webdavCredentials.username"
                autocomplete="off"
                :placeholder="t('cloudSync.webdav.usernamePlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="t('cloudSync.webdav.password')">
              <el-input
                v-model="webdavCredentials.password"
                type="password"
                show-password
                autocomplete="new-password"
                :placeholder="t('cloudSync.webdav.passwordPlaceholder')"
              />
              <div class="cloud-sync__hint">
                {{ t('cloudSync.webdav.passwordTip') }}
              </div>
            </el-form-item>
            <el-collapse class="cloud-sync__advanced">
              <el-collapse-item
                :title="t('cloudSync.webdav.advanced')"
                name="advanced"
              >
                <el-form-item :label="t('cloudSync.webdav.bearerToken')">
                  <el-input
                    v-model="webdavCredentials.bearerToken"
                    type="password"
                    show-password
                    autocomplete="new-password"
                    :placeholder="t('cloudSync.webdav.bearerTokenPlaceholder')"
                  />
                  <div class="cloud-sync__hint">
                    {{ t('cloudSync.webdav.bearerTokenTip') }}
                  </div>
                </el-form-item>
              </el-collapse-item>
            </el-collapse>
          </template>

          <el-form-item :label="activeProvider === 'webdav' ? t('cloudSync.webdav.dirUrl') : t('cloudSync.targetUrl')">
            <el-input
              v-model="targetUrl"
              autocomplete="off"
              :placeholder="targetUrlPlaceholder"
            />
            <div class="cloud-sync__hint">
              {{ activeProvider === 'webdav' ? t('cloudSync.webdav.dirUrlTip') : t('cloudSync.targetUrlTip') }}
            </div>
          </el-form-item>

          <el-form-item v-if="serverNeedsInsecure">
            <el-checkbox v-model="activeAllowInsecure">
              {{ t('cloudSync.allowInsecure') }}
            </el-checkbox>
          </el-form-item>

          <el-form-item :label="t('cloudSync.keepVersions')">
            <el-select
              v-model="keepVersions"
              style="width: 100%"
            >
              <el-option
                v-for="count in KEEP_VERSIONS_OPTIONS"
                :key="count"
                :label="t('cloudSync.keepVersionsOption', { count })"
                :value="count"
              />
            </el-select>
            <div class="cloud-sync__hint">
              {{ t('cloudSync.keepVersionsTip') }}
            </div>
          </el-form-item>

          <el-form-item
            v-if="activeProvider === 'webdav' && providerForm.configured"
            :label="t('cloudSync.webdav.versionSelect')"
          >
            <el-select
              v-model="selectedVersion"
              style="width: 100%"
              :loading="versionsLoading"
            >
              <el-option
                v-for="version in webdavVersions"
                :key="version.name"
                :label="versionLabel(version)"
                :value="version.name"
              />
            </el-select>
          </el-form-item>
        </el-form>

        <div class="cloud-sync__side">
          <el-descriptions
            :column="1"
            border
            size="small"
          >
            <el-descriptions-item :label="t('cloudSync.status.mode')">
              {{ providerForm.mode === 'encrypted' ? t('cloudSync.modeEncrypted') : t('cloudSync.modePlaintext') }}
            </el-descriptions-item>
            <el-descriptions-item :label="t('cloudSync.status.target')">
              {{ targetDisplay }}
            </el-descriptions-item>
            <el-descriptions-item :label="t('cloudSync.status.lastSync')">
              {{ providerForm.lastSyncAt ? formatTime(providerForm.lastSyncAt) : t('cloudSync.status.never') }}
            </el-descriptions-item>
            <el-descriptions-item :label="t('cloudSync.status.credential')">
              {{ credentialStatusText }}
            </el-descriptions-item>
          </el-descriptions>

          <div class="cloud-sync__actions">
            <el-button
              :loading="testing"
              :disabled="running || insecureBlocked"
              @click="handleTestConnection"
            >
              {{ t('cloudSync.testConnection') }}
            </el-button>
            <el-button
              v-if="providerForm.mode === 'encrypted'"
              type="primary"
              :loading="running"
              :disabled="!providerForm.configured || insecureBlocked"
              @click="handlePrimaryAction"
            >
              {{ t('cloudSync.backupNow') }}
            </el-button>
            <template v-else>
              <el-button
                :loading="running && activePlaintextDirection === 'push'"
                :disabled="running || !providerForm.configured || insecureBlocked"
                @click="handlePlaintextSync('push')"
              >
                {{ t('cloudSync.pushToTable') }}
              </el-button>
              <el-button
                :loading="running && activePlaintextDirection === 'pull'"
                :disabled="running || !providerForm.configured || insecureBlocked"
                @click="handlePlaintextSync('pull')"
              >
                {{ t('cloudSync.pullFromTable') }}
              </el-button>
              <el-button
                type="primary"
                :loading="running && activePlaintextDirection === 'both'"
                :disabled="running || !providerForm.configured || insecureBlocked"
                @click="handlePlaintextSync('both')"
              >
                {{ t('cloudSync.syncNow') }}
              </el-button>
            </template>
            <el-button
              v-if="running"
              type="danger"
              plain
              @click="handleCancel"
            >
              {{ t('cloudSync.cancel') }}
            </el-button>
            <el-button
              v-if="providerForm.mode === 'encrypted'"
              :disabled="running || !providerForm.configured || insecureBlocked"
              @click="handleRestore"
            >
              {{ t('cloudSync.restore') }}
            </el-button>
            <el-button
              v-else
              :disabled="running || !providerForm.configured || insecureBlocked"
              @click="handleRebuildSnapshot"
            >
              {{ t('cloudSync.rebuild') }}
            </el-button>
            <el-button
              v-if="providerForm.mode === 'encrypted'"
              :disabled="running || !providerForm.configured || insecureBlocked"
              @click="handleClearVersions"
            >
              {{ t('cloudSync.clearVersions') }}
            </el-button>
            <el-button
              plain
              :disabled="running"
              @click="handleClearAuditLog"
            >
              {{ t('cloudSync.clearAuditLog') }}
            </el-button>
          </div>

          <el-progress
            v-if="running"
            :percentage="progressPercent"
            :status="progressStatus"
          />
          <div
            v-if="running && progressText"
            class="cloud-sync__hint"
          >
            {{ progressText }}
          </div>
        </div>
      </div>

      <div
        v-if="report"
        class="cloud-sync__report"
      >
        <el-divider content-position="left">
          {{ t('cloudSync.report.title') }}
        </el-divider>
        <el-descriptions
          :column="2"
          border
          size="small"
        >
          <el-descriptions-item :label="t('cloudSync.report.target')">
            {{ report.targetLabel }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('cloudSync.report.duration')">
            {{ formatDuration(report.durationMs) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('cloudSync.report.apiCalls')">
            {{ report.apiCalls }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('cloudSync.report.cancelled')">
            {{ report.cancelled ? t('common.confirm') : t('cloudSync.report.notCancelled') }}
          </el-descriptions-item>
        </el-descriptions>

        <div class="cloud-sync__stats">
          <el-tag
            v-for="stat in reportStats"
            :key="stat.key"
            size="small"
            effect="plain"
          >
            {{ t(`cloudSync.report.${stat.key}`) }}: {{ stat.value }}
          </el-tag>
        </div>

        <div
          v-if="report.restore"
          class="cloud-sync__hint"
        >
          {{ t('cloudSync.report.restoreSummary', report.restore) }}
        </div>

        <el-alert
          v-if="report.warnings.length > 0"
          type="warning"
          :closable="false"
          show-icon
          class="cloud-sync__warning"
        >
          <template #title>{{ t('cloudSync.report.warnings') }}</template>
          <ul class="cloud-sync__warning-list">
            <li
              v-for="(warning, index) in report.warnings"
              :key="`${warning.key}-${index}`"
            >
              {{ t(warning.key, warning.params) }}
            </li>
          </ul>
        </el-alert>

        <el-alert
          v-if="report.failures.length > 0"
          type="error"
          :closable="false"
          show-icon
          class="cloud-sync__warning"
        >
          <template #title>{{ t('cloudSync.report.failures') }}</template>
          <ul class="cloud-sync__warning-list">
            <li
              v-for="(failure, index) in report.failures.slice(0, 10)"
              :key="`${failure.code}-${index}`"
            >
              {{ failure.code }} — {{ failure.message }}
            </li>
          </ul>
        </el-alert>

        <el-table
          v-if="report.conflictDetails.length > 0"
          :data="report.conflictDetails"
          size="small"
          max-height="220"
        >
          <el-table-column
            :label="t('common.username')"
            prop="username"
            min-width="120"
            show-overflow-tooltip
          />
          <el-table-column
            :label="t('common.url')"
            prop="url"
            min-width="140"
            show-overflow-tooltip
          />
          <el-table-column
            :label="t('cloudSync.report.winner')"
            width="110"
          >
            <template #default="{ row }">
              {{ row.winner === 'local' ? t('cloudSync.report.winnerLocal') : t('cloudSync.report.winnerCloud') }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <template #footer>
      <div class="cloud-sync__footer">
        <el-button
          size="large"
          :disabled="running"
          @click="handleDialogVisibility(false)"
        >
          {{ t('common.close') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useI18n } from '@/utils/i18n';
import { logger } from '@/utils/logger';
import { promptAndVerifyMasterPassword } from '@/utils/masterPasswordVerify';
import {
  getCloudSyncConfig,
  KEEP_VERSIONS_OPTIONS,
  patchGlobalConfig,
  patchProviderConfig,
} from '@/utils/cloudSync/configStore';
import { clearCredentials, loadCredentials, saveCredentials } from '@/utils/cloudSync/credentialStore';
import { clearAuditLog } from '@/utils/cloudSync/auditLog';
import { toCloudSyncError } from '@/utils/cloudSync/errors';
import {
  prepareProviderTarget,
  rebuildSnapshot,
  clearOldSnapshotVersions,
  runEncryptedBackup,
  runEncryptedRestore,
  runPlaintextSync,
} from '@/utils/cloudSync/syncEngine';
import type { PlaintextSyncDirection } from '@/utils/cloudSync/syncEngine';
import {
  clearOldWebDavVersions,
  listWebDavVersions,
  prepareWebDavTarget,
  runWebDavBackup,
  runWebDavRestore,
} from '@/utils/cloudSync/webdavSync';
import type { WebDavVersion } from '@/utils/cloudSync/webdavSync';
import { normalizeFeishuBaseUrl } from '@/utils/cloudSync/adapters/feishu';
import { normalizeTencentBaseUrl } from '@/utils/cloudSync/adapters/tencent';
import { needsServerInsecureConfirm } from '@/utils/cloudSync/adapters/serverAddress';
import type {
  CloudProvider,
  CloudSyncMode,
  CloudSyncProviderConfig,
  FeishuTarget,
  ProviderCredentialMap,
  SyncProgress,
  SyncReport,
  TencentTarget,
  WebDavTarget,
} from '@/utils/cloudSync/types';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 同步/恢复完成后通知外层刷新密码列表 */
  synced: [];
}>();

const { t } = useI18n();

const activeProvider = ref<CloudProvider>('feishu');
const enabled = ref(false);
const keepVersions = ref(3);
const targetUrl = ref('');
/** 飞书私有化部署的开放平台地址；空串表示使用官方 SaaS 地址 */
const feishuBaseUrl = ref('');
/** 腾讯文档私有化部署的开放平台地址；空串表示使用官方 SaaS 地址 */
const tencentBaseUrl = ref('');
const running = ref(false);
const activePlaintextDirection = ref<PlaintextSyncDirection | null>(null);
const testing = ref(false);
const progress = ref<SyncProgress | null>(null);
const report = ref<SyncReport | null>(null);
const credentialStatus = ref<'unknown' | 'ok' | 'empty' | 'locked' | 'corrupted'>('unknown');

/** 各平台非敏感配置缓存（打开弹窗时加载，切换 Tab 直接复用） */
const providerForms = reactive<Record<CloudProvider, CloudSyncProviderConfig>>({
  feishu: {
    configured: false,
    mode: 'encrypted',
    target: { appToken: null, tableId: null, fileUrl: null, baseUrl: null, allowInsecure: false },
    chunkSize: 48000,
    lastSyncAt: null,
  },
  tencent: {
    configured: false,
    mode: 'encrypted',
    target: { fileId: null, sheetId: null, fileUrl: null, baseUrl: null, allowInsecure: false },
    chunkSize: 48000,
    lastSyncAt: null,
  },
  webdav: {
    configured: false,
    mode: 'encrypted',
    target: { dirUrl: null, backupDirUrl: null, allowInsecure: false },
    chunkSize: 48000,
    lastSyncAt: null,
  },
});

/** 凭证仅驻留内存，绝不写入非敏感配置；输入框为 password 型 */
const feishuCredentials = reactive<ProviderCredentialMap['feishu']>({ appId: '', appSecret: '' });
const tencentCredentials = reactive<ProviderCredentialMap['tencent']>({
  clientId: '',
  openId: '',
  accessToken: '',
});
const webdavCredentials = reactive<Required<ProviderCredentialMap['webdav']>>({
  username: '',
  password: '',
  bearerToken: '',
});

/** WebDAV：HTTP 明文传输确认、版本下拉数据 */
const webdavAllowInsecure = ref(false);
const feishuAllowInsecure = ref(false);
const tencentAllowInsecure = ref(false);
const webdavVersions = ref<WebDavVersion[]>([]);
const selectedVersion = ref('');
const versionsLoading = ref(false);

/** 单次操作使用独立 AbortController，取消/关闭时统一 abort */
let abortController: AbortController | null = null;

const providerForm = computed(() => providerForms[activeProvider.value]);

const credentialStatusText = computed(() => {
  switch (credentialStatus.value) {
    case 'ok':
      return t('cloudSync.status.credentialOk');
    case 'empty':
      return t('cloudSync.status.credentialEmpty');
    case 'locked':
      return t('cloudSync.status.credentialLocked');
    case 'corrupted':
      return t('cloudSync.status.credentialCorrupted');
    default:
      return t('cloudSync.status.unknown');
  }
});

const progressPercent = computed(() => {
  const current = progress.value?.current ?? 0;
  const total = progress.value?.total ?? 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.round((current / total) * 100));
});

const progressStatus = computed<'success' | 'exception' | undefined>(() =>
  progressPercent.value >= 100 ? 'success' : undefined,
);

const progressText = computed(() => (progress.value ? t(progress.value.phaseKey) : ''));

const reportStats = computed(() => {
  const stats = report.value?.stats;
  if (!stats) return [];
  return (['created', 'updated', 'deleted', 'pulled', 'trashed', 'conflicts', 'skipped', 'failed'] as const)
    .map(key => ({ key, value: stats[key] }))
    .filter(item => item.value > 0);
});

/**
 * 当前平台的 API/目录地址是否为需要显式确认的 HTTP 明文地址
 *
 * 非法 URL 返回 false：由后端各平台准备函数的安全门兜底抛错，
 * UI 侧不因输入过程中的半成品 URL 误显示确认框。
 */
const serverNeedsInsecure = computed(() => {
  const value =
    activeProvider.value === 'feishu'
      ? feishuBaseUrl.value
      : activeProvider.value === 'tencent'
        ? tencentBaseUrl.value
        : targetUrl.value;
  return needsServerInsecureConfirm(value);
});

/** 当前平台的 HTTP 明文确认状态（按平台分别保存） */
const activeAllowInsecure = computed({
  get() {
    switch (activeProvider.value) {
      case 'feishu':
        return feishuAllowInsecure.value;
      case 'tencent':
        return tencentAllowInsecure.value;
      case 'webdav':
        return webdavAllowInsecure.value;
      default: {
        const _exhaustive: never = activeProvider.value;
        return _exhaustive;
      }
    }
  },
  set(value: boolean) {
    switch (activeProvider.value) {
      case 'feishu':
        feishuAllowInsecure.value = value;
        break;
      case 'tencent':
        tencentAllowInsecure.value = value;
        break;
      case 'webdav':
        webdavAllowInsecure.value = value;
        break;
      default: {
        const _exhaustive: never = activeProvider.value;
        throw new Error(`unsupported provider: ${String(_exhaustive)}`);
      }
    }
  },
});

/** http 明文未确认时禁用所有会发起网络请求的操作 */
const insecureBlocked = computed(() => serverNeedsInsecure.value && !activeAllowInsecure.value);

const targetUrlPlaceholder = computed(() => {
  switch (activeProvider.value) {
    case 'feishu':
      return t('cloudSync.feishu.urlPlaceholder');
    case 'tencent':
      return t('cloudSync.tencent.urlPlaceholder');
    case 'webdav':
      return t('cloudSync.webdav.dirUrlPlaceholder');
    default: {
      const _exhaustive: never = activeProvider.value;
      return String(_exhaustive);
    }
  }
});

/** 状态区目标显示：webdav 显示备份目录，表格平台显示文档链接 */
const targetDisplay = computed(() => {
  if (!providerForm.value.configured) return t('cloudSync.status.notConfigured');
  if (activeProvider.value === 'webdav') {
    const target = providerForm.value.target as WebDavTarget;
    return target.backupDirUrl || t('cloudSync.status.configured');
  }
  return providerForm.value.target.fileUrl || t('cloudSync.status.configured');
});

/** 版本下拉项文案：最新项带「最新」标记 + 本地化时间 + 大小 */
function versionLabel(version: WebDavVersion): string {
  const time = version.exportedAt > 0 ? formatTime(version.exportedAt) : version.name;
  const size = version.size > 0 ? ` · ${formatSize(version.size)}` : '';
  const isLatest = webdavVersions.value[0]?.name === version.name;
  const label = isLatest ? t('cloudSync.webdav.versionLatest', { time }) : time;
  return `${label}${size}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 当前平台的凭证对象（构造后立即使用，不做持久化副本） */
function currentCredentials(): ProviderCredentialMap[CloudProvider] {
  switch (activeProvider.value) {
    case 'feishu':
      return { appId: feishuCredentials.appId.trim(), appSecret: feishuCredentials.appSecret.trim() };
    case 'tencent':
      return {
        clientId: tencentCredentials.clientId.trim(),
        openId: tencentCredentials.openId.trim(),
        accessToken: tencentCredentials.accessToken.trim(),
      };
    case 'webdav': {
      const bearerToken = webdavCredentials.bearerToken.trim();
      const value: ProviderCredentialMap['webdav'] = {
        username: webdavCredentials.username.trim(),
        password: webdavCredentials.password.trim(),
      };
      // bearerToken 可选：为空时不写入字段，避免存储空串干扰 isValidWebDav 判断
      if (bearerToken) value.bearerToken = bearerToken;
      return value;
    }
    default: {
      const _exhaustive: never = activeProvider.value;
      throw new Error(`unsupported provider: ${String(_exhaustive)}`);
    }
  }
}

/** 凭证字段完整性：不完整时提示补齐，避免把空值写入加密存储 */
function credentialsComplete(): boolean {
  switch (activeProvider.value) {
    case 'feishu':
    case 'tencent':
      return Object.values(currentCredentials()).every(field => typeof field === 'string' && field.length > 0);
    case 'webdav': {
      // webdav 规则特殊（规格 §7.4）：bearerToken 非空 或 username+password 齐全
      const value = currentCredentials() as ProviderCredentialMap['webdav'];
      if (value.bearerToken) return true;
      return value.username !== '' && value.password !== '';
    }
    default: {
      const _exhaustive: never = activeProvider.value;
      throw new Error(`unsupported provider: ${String(_exhaustive)}`);
    }
  }
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** 从存储加载全局开关、保留版本与两平台配置（切 Tab 不清另一边数据） */
async function loadConfig(): Promise<void> {
  try {
    const config = await getCloudSyncConfig();
    enabled.value = config.enabled;
    keepVersions.value = config.keepVersions;
    providerForms.feishu = config.providers.feishu;
    providerForms.tencent = config.providers.tencent;
    providerForms.webdav = config.providers.webdav;
    targetUrl.value = currentTargetUrl();
    feishuBaseUrl.value = currentFeishuBaseUrl();
    tencentBaseUrl.value = currentTencentBaseUrl();
    syncAllowInsecureFromConfig();
  } catch (error) {
    logger.error('CloudSyncDialog: 加载配置失败:', error);
    ElMessage.error(t('cloudSync.loadFailed'));
  }
}

/** 当前平台已保存的目标 URL（webdav 用 dirUrl，表格平台用 fileUrl） */
function currentTargetUrl(): string {
  const target = providerForm.value.target;
  if (activeProvider.value === 'webdav') return (target as WebDavTarget).dirUrl ?? '';
  return target.fileUrl ?? '';
}

/** 已保存的飞书私有化 API 地址（空串表示官方 SaaS；旧配置缺字段时同样回退空串） */
function currentFeishuBaseUrl(): string {
  return (providerForms.feishu.target as FeishuTarget).baseUrl ?? '';
}

/** 已保存的腾讯文档私有化 API 地址（空串表示官方 SaaS；旧配置缺字段时同样回退空串） */
function currentTencentBaseUrl(): string {
  return (providerForms.tencent.target as TencentTarget).baseUrl ?? '';
}

/** 从各平台已保存目标同步明文确认状态，避免切换平台后沿用上一个平台的勾选 */
function syncAllowInsecureFromConfig(): void {
  feishuAllowInsecure.value = (providerForms.feishu.target as FeishuTarget).allowInsecure;
  tencentAllowInsecure.value = (providerForms.tencent.target as TencentTarget).allowInsecure;
  webdavAllowInsecure.value = (providerForms.webdav.target as WebDavTarget).allowInsecure;
}

/** 读取当前平台凭证状态；已存在凭证时回填输入框便于用户确认/替换 */
async function loadCredentialState(): Promise<void> {
  try {
    const result = await loadCredentials(activeProvider.value);
    credentialStatus.value = result.status;
    if (result.status !== 'ok') return;
    switch (activeProvider.value) {
      case 'feishu': {
        const value = result.credentials as ProviderCredentialMap['feishu'];
        feishuCredentials.appId = value.appId;
        feishuCredentials.appSecret = value.appSecret;
        break;
      }
      case 'tencent': {
        const value = result.credentials as ProviderCredentialMap['tencent'];
        tencentCredentials.clientId = value.clientId;
        tencentCredentials.openId = value.openId;
        tencentCredentials.accessToken = value.accessToken;
        break;
      }
      case 'webdav': {
        const value = result.credentials as ProviderCredentialMap['webdav'];
        webdavCredentials.username = value.username;
        webdavCredentials.password = value.password;
        webdavCredentials.bearerToken = value.bearerToken ?? '';
        break;
      }
      default: {
        const _exhaustive: never = activeProvider.value;
        throw new Error(`unsupported provider: ${String(_exhaustive)}`);
      }
    }
  } catch (error) {
    logger.error('CloudSyncDialog: 读取凭证状态失败:', error);
    credentialStatus.value = 'unknown';
  }
}

/** 切换平台：加载该平台目标 URL 与凭证状态，清空上一次报告避免误读 */
async function handleProviderChange(provider: CloudProvider): Promise<void> {
  activeProvider.value = provider;
  targetUrl.value = currentTargetUrl();
  feishuBaseUrl.value = currentFeishuBaseUrl();
  tencentBaseUrl.value = currentTencentBaseUrl();
  report.value = null;
  await loadCredentialState();
}

watch(
  () => props.modelValue,
  visible => {
    if (visible) {
      report.value = null;
      progress.value = null;
      void loadConfig()
        .then(loadCredentialState)
        .then(() => {
          if (activeProvider.value === 'webdav' && providerForms.webdav.configured && credentialStatus.value === 'ok') {
            return refreshWebDavVersions();
          }
        });
    }
  },
  { immediate: true },
);

watch(activeProvider, async () => {
  targetUrl.value = currentTargetUrl();
  feishuBaseUrl.value = currentFeishuBaseUrl();
  tencentBaseUrl.value = currentTencentBaseUrl();
  report.value = null;
  webdavVersions.value = [];
  selectedVersion.value = '';
  syncAllowInsecureFromConfig();
  await loadCredentialState();
  // webdav 已配置且凭证就绪时预加载版本列表，避免下拉初始为空
  if (activeProvider.value === 'webdav' && providerForms.webdav.configured && credentialStatus.value === 'ok') {
    await refreshWebDavVersions();
  }
});

/** 关闭前先中止进行中的请求并释放锁（同步引擎 finally 会释放） */
function handleDialogVisibility(value: boolean): void {
  if (!value && running.value) {
    abortController?.abort();
    return;
  }
  if (!value) abortController?.abort();
  emit('update:modelValue', value);
}

function handleClosed(): void {
  abortController = null;
  progress.value = null;
}

function handleCancel(): void {
  abortController?.abort();
}

/** 模式切换：明文需二次风险确认，且提示需重新指定目标表（表结构不同） */
async function handleModeChange(value: string | number | boolean | undefined): Promise<void> {
  const mode = value as CloudSyncMode;
  if (mode === providerForm.value.mode) return;
  if (mode === 'plaintext') {
    try {
      await ElMessageBox.confirm(t('cloudSync.plaintextWarning'), t('cloudSync.plaintextWarningTitle'), {
        type: 'warning',
        confirmButtonText: t('cloudSync.plaintextConfirm'),
        cancelButtonText: t('common.cancel'),
      });
    } catch {
      return;
    }
  }
  providerForm.value.mode = mode;
  providerForm.value.configured = false;
  try {
    await patchProviderConfig(activeProvider.value, { mode, configured: false });
    ElMessage.success(t('cloudSync.modeChanged'));
  } catch (error) {
    logger.error('CloudSyncDialog: 保存模式失败:', error);
    ElMessage.error(t('cloudSync.saveFailed'));
  }
}

/** 测试连接：保存凭证 → 探测/建表（webdav 为探测/建目录）→ 回写目标配置 */
async function handleTestConnection(): Promise<void> {
  if (!credentialsComplete()) {
    ElMessage.warning(t('cloudSync.credentialIncomplete'));
    return;
  }
  if (!targetUrl.value.trim()) {
    ElMessage.warning(t('cloudSync.urlRequired'));
    return;
  }
  // 私有化 API 地址先本地校验：格式非法时立即提示，既不落盘凭证也不发请求
  let resolvedFeishuBaseUrl: string | null = null;
  let resolvedTencentBaseUrl: string | null = null;
  if (activeProvider.value === 'feishu') {
    try {
      resolvedFeishuBaseUrl = normalizeFeishuBaseUrl(feishuBaseUrl.value, feishuAllowInsecure.value);
    } catch {
      ElMessage.warning(t('cloudSync.feishu.baseUrlInvalid'));
      return;
    }
    // 回显归一化结果（官方地址归为空、去掉末尾斜杠），让用户看到实际生效的地址
    feishuBaseUrl.value = resolvedFeishuBaseUrl ?? '';
  } else if (activeProvider.value === 'tencent') {
    try {
      resolvedTencentBaseUrl = normalizeTencentBaseUrl(tencentBaseUrl.value, tencentAllowInsecure.value);
    } catch {
      ElMessage.warning(t('cloudSync.tencent.baseUrlInvalid'));
      return;
    }
    tencentBaseUrl.value = resolvedTencentBaseUrl ?? '';
  }
  testing.value = true;
  try {
    await saveCredentials(activeProvider.value, currentCredentials());
    credentialStatus.value = 'ok';
    if (activeProvider.value === 'webdav') {
      const result = await prepareWebDavTarget(
        currentCredentials() as ProviderCredentialMap['webdav'],
        targetUrl.value.trim(),
        {
          allowInsecure: webdavAllowInsecure.value,
        },
      );
      providerForm.value.configured = true;
      providerForm.value.target = result.target;
      targetUrl.value = result.target.dirUrl ?? targetUrl.value;
      ElMessage.success(result.created ? t('cloudSync.webdav.directoryCreated') : t('cloudSync.webdav.directoryReady'));
      await refreshWebDavVersions();
    } else {
      const result = await prepareProviderTarget(
        activeProvider.value,
        currentCredentials(),
        targetUrl.value.trim(),
        providerForm.value.mode,
        {},
        {
          feishuBaseUrl: resolvedFeishuBaseUrl,
          tencentBaseUrl: resolvedTencentBaseUrl,
          allowInsecure: activeAllowInsecure.value,
        },
      );
      providerForm.value.configured = true;
      providerForm.value.target = result.target;
      targetUrl.value = result.target.fileUrl ?? targetUrl.value;
      if (activeProvider.value === 'feishu') {
        const target = result.target as FeishuTarget;
        feishuBaseUrl.value = target.baseUrl ?? '';
        feishuAllowInsecure.value = target.allowInsecure;
      } else if (activeProvider.value === 'tencent') {
        const target = result.target as TencentTarget;
        tencentBaseUrl.value = target.baseUrl ?? '';
        tencentAllowInsecure.value = target.allowInsecure;
      }
      ElMessage.success(result.created ? t('cloudSync.tableCreated') : t('cloudSync.tableReady'));
    }
  } catch (error) {
    const normalized = toCloudSyncError(error);
    logger.error('CloudSyncDialog: 测试连接失败:', normalized);
    ElMessage.error(t(`cloudSync.error.${normalized.kind}`));
  } finally {
    testing.value = false;
  }
}

/** 拉取 WebDAV 历史版本填充下拉（默认选中最新）；失败静默降级为空列表 */
async function refreshWebDavVersions(): Promise<void> {
  versionsLoading.value = true;
  try {
    webdavVersions.value = await listWebDavVersions();
    selectedVersion.value = webdavVersions.value[0]?.name ?? '';
  } catch (error) {
    logger.error('CloudSyncDialog: 拉取 WebDAV 版本列表失败:', toCloudSyncError(error));
    webdavVersions.value = [];
    selectedVersion.value = '';
  } finally {
    versionsLoading.value = false;
  }
}

/** 执行同步/备份；明文模式每次同步前必须验证主密码 */
async function runWithMasterPassword(
  action: 'sync' | 'backup' | 'restore' | 'rebuild',
  direction: PlaintextSyncDirection = 'both',
): Promise<void> {
  if (!credentialsComplete()) {
    ElMessage.warning(t('cloudSync.credentialIncomplete'));
    return;
  }
  const masterPassword = await promptAndVerifyMasterPassword(t('cloudSync.verifyTitle'), t('cloudSync.verifyPrompt'));
  if (!masterPassword) return;

  running.value = true;
  activePlaintextDirection.value = action === 'sync' ? direction : null;
  progress.value = null;
  abortController = new AbortController();
  try {
    // 凭证可能已更新，执行前重新加密落盘，保证同步引擎读取到最新值
    await saveCredentials(activeProvider.value, currentCredentials());
    credentialStatus.value = 'ok';
    const options = {
      signal: abortController.signal,
      onProgress: (value: SyncProgress) => {
        progress.value = value;
      },
      direction,
      onEmptyLocalCloud:
        action === 'sync' && direction !== 'pull'
          ? async (): Promise<boolean> => {
              try {
                await ElMessageBox.confirm(
                  t('cloudSync.emptyLocalDeleteConfirm'),
                  t('cloudSync.emptyLocalDeleteTitle'),
                  {
                    type: 'warning',
                    confirmButtonText: t('cloudSync.emptyLocalDeleteButton'),
                    cancelButtonText: t('common.cancel'),
                  },
                );
                return true;
              } catch {
                return false;
              }
            }
          : undefined,
    };
    let result: SyncReport;
    if (activeProvider.value === 'webdav') {
      // webdav 仅密文备份/恢复；sync/rebuild 按钮已隐藏，此处兜底防误入
      if (action === 'backup') {
        result = await runWebDavBackup(masterPassword, options);
      } else if (action === 'restore') {
        result = await runWebDavRestore(masterPassword, {
          ...options,
          versionName: selectedVersion.value || undefined,
        });
      } else {
        throw new Error(`unsupported webdav action: ${action}`);
      }
    } else if (action === 'sync') {
      result = await runPlaintextSync(activeProvider.value, masterPassword, options);
    } else if (action === 'backup') {
      result = await runEncryptedBackup(activeProvider.value, masterPassword, options);
    } else if (action === 'restore') {
      result = await runEncryptedRestore(activeProvider.value, masterPassword, options);
    } else {
      result = await rebuildSnapshot(activeProvider.value, masterPassword, options);
    }
    report.value = result;
    await loadConfig();
    if (activeProvider.value === 'webdav' && !result.cancelled) await refreshWebDavVersions();
    if (result.cancelled) {
      ElMessage.warning(t('cloudSync.cancelled'));
    } else {
      ElMessage.success(t('cloudSync.completed'));
      emit('synced');
    }
  } catch (error) {
    const normalized = toCloudSyncError(error);
    if (normalized.kind === 'aborted') {
      ElMessage.warning(t('cloudSync.cancelled'));
    } else {
      logger.error('CloudSyncDialog: 同步失败:', normalized);
      ElMessage.error(t(`cloudSync.error.${normalized.kind}`));
    }
  } finally {
    running.value = false;
    activePlaintextDirection.value = null;
    abortController = null;
    progress.value = null;
  }
}

async function handlePrimaryAction(): Promise<void> {
  await runWithMasterPassword(providerForm.value.mode === 'encrypted' ? 'backup' : 'sync');
}

/** 明文模式单向/双向同步入口 */
async function handlePlaintextSync(direction: PlaintextSyncDirection): Promise<void> {
  await runWithMasterPassword('sync', direction);
}

async function handleRestore(): Promise<void> {
  // webdav：确认前确保版本下拉已填充（默认最新），用户可在表单区改选历史版本
  if (activeProvider.value === 'webdav' && webdavVersions.value.length === 0) {
    await refreshWebDavVersions();
  }
  try {
    await ElMessageBox.confirm(t('cloudSync.restoreConfirm'), t('cloudSync.restoreConfirmTitle'), {
      type: 'warning',
      confirmButtonText: t('cloudSync.restore'),
      cancelButtonText: t('common.cancel'),
    });
  } catch {
    return;
  }
  await runWithMasterPassword('restore');
}

async function handleRebuildSnapshot(): Promise<void> {
  await runWithMasterPassword('rebuild');
}

/** 清理旧版本：无需主密码（只删除云端历史快照分组，不动本地与最新版本） */
async function handleClearVersions(): Promise<void> {
  try {
    await ElMessageBox.confirm(t('cloudSync.clearVersionsConfirm'), t('cloudSync.clearVersionsConfirmTitle'), {
      type: 'warning',
      confirmButtonText: t('cloudSync.clearVersions'),
      cancelButtonText: t('common.cancel'),
    });
  } catch {
    return;
  }
  running.value = true;
  abortController = new AbortController();
  try {
    const options = {
      signal: abortController.signal,
      onProgress: (value: SyncProgress) => {
        progress.value = value;
      },
    };
    report.value =
      activeProvider.value === 'webdav'
        ? await clearOldWebDavVersions(options)
        : await clearOldSnapshotVersions(activeProvider.value, options);
    ElMessage.success(t('cloudSync.completed'));
    if (activeProvider.value === 'webdav') await refreshWebDavVersions();
  } catch (error) {
    const normalized = toCloudSyncError(error);
    logger.error('CloudSyncDialog: 清理旧版本失败:', normalized);
    ElMessage.error(t(`cloudSync.error.${normalized.kind}`));
  } finally {
    running.value = false;
    abortController = null;
    progress.value = null;
  }
}

/** 清空审计日志：仅本地可丢弃数据，不含任何可还原明文 */
async function handleClearAuditLog(): Promise<void> {
  try {
    await ElMessageBox.confirm(t('cloudSync.clearAuditConfirm'), t('cloudSync.clearAuditConfirmTitle'), {
      type: 'warning',
      confirmButtonText: t('cloudSync.clearAuditLog'),
      cancelButtonText: t('common.cancel'),
    });
  } catch {
    return;
  }
  try {
    await clearAuditLog();
    ElMessage.success(t('cloudSync.auditCleared'));
  } catch (error) {
    logger.error('CloudSyncDialog: 清空审计日志失败:', error);
    ElMessage.error(t('cloudSync.auditClearFailed'));
  }
}

/** 清除当前平台凭证（rekey/失效后重新录入的入口） */
async function handleClearCredentials(): Promise<void> {
  await clearCredentials(activeProvider.value);
  switch (activeProvider.value) {
    case 'feishu':
      feishuCredentials.appId = '';
      feishuCredentials.appSecret = '';
      break;
    case 'tencent':
      tencentCredentials.clientId = '';
      tencentCredentials.openId = '';
      tencentCredentials.accessToken = '';
      break;
    case 'webdav':
      webdavCredentials.username = '';
      webdavCredentials.password = '';
      webdavCredentials.bearerToken = '';
      break;
    default: {
      const _exhaustive: never = activeProvider.value;
      throw new Error(`unsupported provider: ${String(_exhaustive)}`);
    }
  }
  credentialStatus.value = 'empty';
}

/** 全局开关与保留版本变更即落盘（凭证不在此处，绝不写入非敏感配置） */
watch(enabled, value => {
  void patchGlobalConfig({ enabled: value }).catch(error => {
    logger.error('CloudSyncDialog: 保存开关失败:', error);
    ElMessage.error(t('cloudSync.saveFailed'));
  });
});

watch(keepVersions, value => {
  void patchGlobalConfig({ keepVersions: value }).catch(error => {
    logger.error('CloudSyncDialog: 保存保留版本失败:', error);
    ElMessage.error(t('cloudSync.saveFailed'));
  });
});

onBeforeUnmount(() => {
  abortController?.abort();
});

defineExpose({ handleProviderChange, handleClearCredentials });
</script>

<style scoped>
.cloud-sync__intro {
  margin-bottom: 16px;
}

.cloud-sync__intro-text {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
}

.cloud-sync__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.cloud-sync__side {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cloud-sync__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.cloud-sync__actions .el-button {
  margin-left: 0;
}

.cloud-sync__hint {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.cloud-sync__advanced {
  margin-bottom: 18px;
  border-top: none;
}

.cloud-sync__report {
  margin-top: 20px;
}

.cloud-sync__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.cloud-sync__warning {
  margin-top: 12px;
}

.cloud-sync__warning-list {
  padding-left: 18px;
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.6;
}

.cloud-sync__footer {
  display: flex;
  justify-content: flex-end;
}

@media (width <= 768px) {
  .cloud-sync__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
