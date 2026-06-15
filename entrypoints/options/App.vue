<template>
  <div class="options-page">
    <!-- 设置主密码页面 -->
    <div
      v-if="showMasterPasswordSetup"
      class="setup-page"
    >
      <div class="setup-container">
        <div class="setup-header">
          <div class="logo-section">
            <BrandLogo class="logo" />
            <h1>账号密码管理助手</h1>
          </div>
          <p class="subtitle">欢迎使用账号密码管理助手，请先设置主密码</p>
        </div>

        <div class="setup-form">
          <el-card class="form-card">
            <el-form
              ref="setupFormRef"
              :model="setupForm"
              :rules="setupRules"
              label-width="100px"
              label-position="top"
            >
              <el-alert
                title="设置主密码"
                description="主密码用于保护您的所有账号信息，请妥善保管，切勿遗忘。"
                type="info"
                :closable="false"
                show-icon
              />

              <el-form-item
                label="主密码"
                prop="password"
              >
                <PasswordStrengthPopover
                  v-model:visible="passwordInputFocused"
                  title="密码要求"
                  hint="请输入密码查看要求"
                  :password="setupForm.password"
                  :strength="passwordStrength"
                  :rules="passwordRules"
                >
                  <el-input
                    v-model="setupForm.password"
                    type="password"
                    placeholder="请输入主密码（至少8个字符，包含字母、数字、特殊字符）"
                    show-password
                    size="large"
                    :disabled="setupLoading"
                    autocomplete="new-password"
                    @keyup.enter="handleSetupSubmit"
                    @focus="passwordInputFocused = true"
                    @blur="passwordInputFocused = false"
                  >
                    <!-- 动作语义：密文显示睁眼（点击查看），明文显示闭眼（点击隐藏） -->
                    <template #password-icon="{ visible }">
                      <el-icon>
                        <Hide v-if="visible" />
                        <View v-else />
                      </el-icon>
                    </template>
                  </el-input>
                </PasswordStrengthPopover>
              </el-form-item>

              <el-form-item
                label="确认密码"
                prop="confirmPassword"
              >
                <el-input
                  v-model="setupForm.confirmPassword"
                  type="password"
                  placeholder="请再次输入主密码"
                  show-password
                  size="large"
                  :disabled="setupLoading"
                  autocomplete="new-password"
                  @keyup.enter="handleSetupSubmit"
                >
                  <template #password-icon="{ visible }">
                    <el-icon>
                      <Hide v-if="visible" />
                      <View v-else />
                    </el-icon>
                  </template>
                </el-input>
              </el-form-item>

              <el-form-item
                label="验证有效期"
                prop="validityHours"
              >
                <ValidityHoursSelect
                  v-model="setupForm.validityHours"
                  placeholder="选择验证有效期"
                  size="large"
                  :disabled="setupLoading"
                  style="width: 100%"
                />
                <div class="form-tip">验证有效期内无需重新输入主密码，超过有效期需重新验证</div>
              </el-form-item>

              <el-form-item>
                <el-button
                  type="primary"
                  size="large"
                  :loading="setupLoading"
                  style="width: 100%"
                  @click="handleSetupSubmit"
                >
                  设置主密码并开始使用
                </el-button>
              </el-form-item>
            </el-form>
            <!-- 免责声明 -->
            <div class="disclaimer-compact">
              <DisclaimerInfo />
            </div>
          </el-card>
        </div>
      </div>
    </div>

    <!-- 密码验证页面 -->
    <div
      v-else-if="showPasswordVerify"
      class="verify-page"
    >
      <div class="verify-container">
        <div class="verify-header">
          <div class="logo-section">
            <BrandLogo class="logo" />
            <h1>账号密码管理助手</h1>
          </div>
          <p class="subtitle">请输入主密码以继续</p>
        </div>

        <div class="verify-form">
          <el-card class="form-card">
            <el-form
              ref="verifyFormRef"
              :model="verifyForm"
              :rules="verifyRules"
              label-width="80px"
              label-position="top"
            >
              <el-form-item
                label="主密码"
                prop="password"
              >
                <el-input
                  v-model="verifyForm.password"
                  type="password"
                  placeholder="请输入主密码"
                  show-password
                  size="large"
                  :disabled="verifyLoading"
                  :class="{ shake: verifyShake }"
                  :style="{ '--shake-duration': SHAKE_DURATION_MS + 'ms' }"
                  autocomplete="current-password"
                  @keyup.enter="handleVerifySubmit"
                  @input="verifyError = ''"
                >
                  <template #password-icon="{ visible }">
                    <el-icon>
                      <Hide v-if="visible" />
                      <View v-else />
                    </el-icon>
                  </template>
                </el-input>
                <div
                  v-if="verifyError"
                  class="verify-error-inline"
                >
                  {{ verifyError }}
                </div>
              </el-form-item>

              <el-form-item
                label="验证有效期"
                prop="validityHours"
              >
                <ValidityHoursSelect
                  v-model="verifyForm.validityHours"
                  placeholder="选择验证有效期"
                  size="large"
                  :disabled="verifyLoading"
                  style="width: 100%"
                />
                <div class="form-tip">验证有效期内无需重新输入主密码，超过有效期需重新验证</div>
              </el-form-item>

              <el-form-item>
                <el-button
                  type="primary"
                  size="large"
                  :loading="verifyLoading"
                  style="width: 100%"
                  @click="handleVerifySubmit"
                >
                  验证密码
                </el-button>

                <div class="verify-actions">
                  <el-button
                    v-if="isDev"
                    size="small"
                    type="info"
                    link
                    @click="debugPassword"
                  >
                    🔍 调试信息
                  </el-button>
                  <el-button
                    size="small"
                    type="danger"
                    link
                    @click="resetMasterPassword"
                  >
                    忘记密码？重置所有数据
                  </el-button>
                </div>
              </el-form-item>
            </el-form>
            <!-- 免责声明 -->
            <div class="disclaimer-compact">
              <DisclaimerInfo />
            </div>
          </el-card>
        </div>
      </div>
    </div>

    <!-- 主内容区域 -->
    <div
      v-if="isAuthenticated"
      class="main-content"
    >
      <!-- 头部 -->
      <div class="header">
        <!-- 第一行：标题和Logo -->
        <div class="header-title-row">
          <div class="header-title">
            <h1>
              <BrandLogo class="logo" />
              账号密码管理助手
            </h1>
          </div>
        </div>

        <!-- 第二行：操作按钮 -->
        <div class="header-actions-row">
          <div class="header-actions">
            <el-button
              type="primary"
              :icon="Plus"
              @click="openPasswordDialog"
            >
              添加密码
            </el-button>
            <el-dropdown
              trigger="click"
              @command="handleDataCommand"
            >
              <el-button :icon="FolderOpened">
                数据管理<el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    command="downloadTemplate"
                    :icon="Download"
                  >
                    下载模板
                  </el-dropdown-item>
                  <el-dropdown-item
                    command="import"
                    :icon="Upload"
                  >
                    导入数据
                  </el-dropdown-item>
                  <el-dropdown-item
                    command="export"
                    :icon="Download"
                  >
                    导出Excel
                  </el-dropdown-item>
                  <el-dropdown-item
                    command="backupExport"
                    :icon="Lock"
                  >
                    加密备份导出
                  </el-dropdown-item>
                  <el-dropdown-item
                    command="backupImport"
                    :icon="Unlock"
                  >
                    加密备份导入
                  </el-dropdown-item>
                  <el-dropdown-item
                    divided
                    command="backup"
                    :icon="Message"
                  >
                    备份到邮箱
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-dropdown
              trigger="click"
              @command="handleSettingsCommand"
            >
              <el-button :icon="Setting">
                设置<el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    command="validity"
                    :icon="Timer"
                  >
                    有效期设置
                  </el-dropdown-item>
                  <el-dropdown-item
                    command="autoSave"
                    :icon="FolderChecked"
                  >
                    自动保存设置
                  </el-dropdown-item>
                  <el-dropdown-item
                    command="idleLock"
                    :icon="Clock"
                  >
                    自动锁定设置
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
          <div class="header-actions-right">
            <span class="floating-button-label">悬浮按钮</span>
            <el-switch
              v-model="floatingButtonVisible"
              active-text=""
              inactive-text=""
              @change="toggleFloatingButton"
            />
          </div>
        </div>
      </div>

      <!-- 搜索和筛选 -->
      <div class="filters">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索用户名、标签、备注或URL"
          :prefix-icon="Search"
          clearable
        />
        <el-tooltip
          :content="favoriteOnly ? '显示全部' : '只看收藏'"
          placement="top"
          :show-after="400"
        >
          <el-button
            :icon="favoriteOnly ? StarFilled : Star"
            circle
            :type="favoriteOnly ? 'warning' : 'default'"
            @click="favoriteOnly = !favoriteOnly"
          />
        </el-tooltip>
        <el-button
          v-if="selectedIds.length > 0"
          :icon="Delete"
          type="danger"
          @click="batchDelete"
        >
          批量删除 ({{ selectedIds.length }})
        </el-button>
      </div>

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

      <!-- 密码列表 -->
      <div class="password-list">
        <el-table
          ref="tableRef"
          v-loading="tableLoading"
          element-loading-text="加载数据中..."
          :data="filteredPasswords"
          style="width: 100%"
          stripe
          row-key="id"
          :row-class-name="handleRowClassName"
          :default-sort="{ prop: 'updateTime', order: 'descending' }"
          @selection-change="handleSelectionChange"
          @sort-change="handleSortChange"
        >
          <el-table-column
            type="selection"
            width="36"
            fixed="left"
          />
          <el-table-column
            prop="username"
            label="用户名"
            min-width="150"
            sortable
            :sort-method="(a: PasswordEntry, b: PasswordEntry) => a.username.localeCompare(b.username)"
          >
            <template #default="{ row }">
              <el-tooltip
                v-if="row.username && row.username.length > 20"
                :content="row.username"
                placement="top"
                :show-after="300"
                :popper-style="{ maxWidth: '500px', wordBreak: 'break-all' }"
              >
                <div class="text-ellipsis">
                  {{ row.username }}
                </div>
              </el-tooltip>
              <div
                v-else
                class="text-ellipsis"
              >
                {{ row.username }}
              </div>
            </template>
          </el-table-column>
          <el-table-column
            prop="password"
            label="密码"
            min-width="110"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <div class="password-cell">
                <span v-if="!row.showPassword">{{ '*'.repeat(8) }}</span>
                <span v-else>{{ row.password }}</span>
                <el-button
                  :icon="row.showPassword ? Hide : View"
                  link
                  @click="togglePasswordVisibility(row)"
                />
              </div>
            </template>
          </el-table-column>
          <el-table-column
            prop="url"
            label="URL"
            min-width="200"
            sortable
            :sort-method="(a: PasswordEntry, b: PasswordEntry) => a.url.localeCompare(b.url)"
          >
            <template #default="{ row }">
              <el-tooltip
                v-if="row.url && row.url.length > 30"
                :content="row.url"
                placement="top"
                :show-after="300"
                :popper-style="{ maxWidth: '500px', wordBreak: 'break-all' }"
              >
                <div class="text-ellipsis">
                  {{ row.url }}
                </div>
              </el-tooltip>
              <div
                v-else
                class="text-ellipsis"
              >
                {{ row.url || '-' }}
              </div>
            </template>
          </el-table-column>
          <el-table-column
            prop="tag"
            label="标签"
            min-width="100"
            sortable
            :sort-method="(a: PasswordEntry, b: PasswordEntry) => a.tag.localeCompare(b.tag)"
          >
            <template #default="{ row }">
              <template v-if="parseTags(row.tag).length">
                <el-tooltip
                  v-for="t in parseTags(row.tag)"
                  :key="t"
                  :content="t"
                  placement="top"
                  :show-after="300"
                  :popper-style="{ maxWidth: '500px', wordBreak: 'break-all' }"
                >
                  <el-tag
                    :type="getTagType(t)"
                    size="small"
                    class="tag-item"
                  >
                    {{ t }}
                  </el-tag>
                </el-tooltip>
              </template>
              <span
                v-else
                class="no-tag"
                >-</span
              >
            </template>
          </el-table-column>
          <el-table-column
            prop="remark"
            label="备注"
            min-width="150"
            sortable
            :sort-method="(a: PasswordEntry, b: PasswordEntry) => a.remark.localeCompare(b.remark)"
          >
            <template #default="{ row }">
              <el-tooltip
                v-if="row.remark && row.remark.length > 15"
                placement="top"
                :show-after="300"
                :popper-style="{ maxWidth: '500px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }"
              >
                <template #content>
                  <div style="max-width: 480px; word-break: break-all; white-space: pre-wrap">
                    {{ row.remark }}
                  </div>
                </template>
                <div class="text-ellipsis">
                  {{ row.remark }}
                </div>
              </el-tooltip>
              <div
                v-else
                class="text-ellipsis"
              >
                {{ row.remark || '-' }}
              </div>
            </template>
          </el-table-column>
          <el-table-column
            prop="createTime"
            label="创建时间"
            min-width="110"
            sortable
            :sort-method="(a: PasswordEntry, b: PasswordEntry) => a.createTime - b.createTime"
          >
            <template #default="{ row }">
              {{ formatDate(row.createTime) }}
            </template>
          </el-table-column>
          <el-table-column
            prop="updateTime"
            label="更新时间"
            min-width="110"
            sortable
            :sort-method="(a: PasswordEntry, b: PasswordEntry) => a.updateTime - b.updateTime"
            :sort-orders="['descending', 'ascending', null]"
          >
            <template #default="{ row }">
              {{ formatDate(row.updateTime) }}
            </template>
          </el-table-column>
          <el-table-column
            label="操作"
            header-align="center"
            width="206"
            fixed="right"
          >
            <template #default="{ row }">
              <div class="operation-buttons">
                <el-tooltip
                  content="复制条目"
                  placement="top"
                  :show-after="400"
                >
                  <el-button
                    :icon="CopyDocument"
                    circle
                    size="small"
                    @click="copyPassword(row)"
                  />
                </el-tooltip>
                <el-tooltip
                  content="编辑"
                  placement="top"
                  :show-after="400"
                >
                  <el-button
                    :icon="Edit"
                    circle
                    size="small"
                    @click="editPassword(row)"
                  />
                </el-tooltip>
                <el-tooltip
                  :content="row.favorite ? '取消收藏' : '收藏'"
                  placement="top"
                  :show-after="400"
                >
                  <el-button
                    :icon="row.favorite ? StarFilled : Star"
                    circle
                    size="small"
                    :type="row.favorite ? 'warning' : 'default'"
                    @click="toggleFavorite(row.id)"
                  />
                </el-tooltip>
                <el-tooltip
                  content="删除"
                  placement="top"
                  :show-after="400"
                >
                  <el-button
                    :icon="Delete"
                    circle
                    size="small"
                    type="danger"
                    @click="deletePassword(row.id)"
                  />
                </el-tooltip>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
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
    <el-dialog
      v-model="showPasswordDialog"
      :title="isEditingPassword ? '编辑密码' : '添加密码'"
      width="600px"
      :close-on-click-modal="false"
      @closed="resetPasswordForm"
    >
      <el-form
        ref="passwordFormRef"
        :model="passwordForm"
        :rules="passwordFormRules"
        label-width="100px"
        size="large"
      >
        <el-form-item
          label="用户名"
          prop="username"
        >
          <el-input
            v-model="passwordForm.username"
            placeholder="请输入用户名或邮箱（最多50字符）"
            :disabled="passwordFormLoading"
            maxlength="50"
            show-word-limit
          />
        </el-form-item>

        <el-form-item
          label="密码"
          prop="password"
        >
          <PasswordStrengthPopover
            v-model:visible="formPasswordInputFocused"
            title="密码强度"
            hint="请输入密码查看强度"
            :password="passwordForm.password"
            :strength="formPasswordStrength"
            :rules="formPasswordRules"
          >
            <el-input
              v-model="passwordForm.password"
              type="password"
              placeholder="选填，密码信息（最多50字符）"
              show-password
              :disabled="passwordFormLoading"
              maxlength="50"
              show-word-limit
              @focus="formPasswordInputFocused = true"
              @blur="formPasswordInputFocused = false"
            >
              <template #password-icon="{ visible }">
                <el-icon>
                  <Hide v-if="visible" />
                  <View v-else />
                </el-icon>
              </template>
            </el-input>
          </PasswordStrengthPopover>
        </el-form-item>

        <el-form-item
          label="网站URL"
          prop="url"
        >
          <el-input
            v-model="passwordForm.url"
            placeholder="选填，不填则匹配所有网站（最多100字符）"
            :disabled="passwordFormLoading"
            maxlength="100"
            show-word-limit
          />
        </el-form-item>

        <el-form-item
          label="标签"
          prop="tag"
        >
          <el-select
            v-model="tagArray"
            multiple
            filterable
            allow-create
            default-first-option
            clearable
            :disabled="passwordFormLoading"
            :multiple-limit="MAX_TAG_COUNT"
            :placeholder="`选填，最多选择${MAX_TAG_COUNT}个，可输入后回车新增`"
            style="width: 100%"
          >
            <el-option
              v-for="t in availableTags"
              :key="t"
              :label="t"
              :value="t"
            />
          </el-select>
        </el-form-item>

        <el-form-item
          label="备注"
          prop="remark"
        >
          <el-input
            v-model="passwordForm.remark"
            type="textarea"
            :rows="3"
            placeholder="选填，备注信息（最多1000字符）"
            :disabled="passwordFormLoading"
            maxlength="1000"
            show-word-limit
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <el-button
            size="large"
            @click="showPasswordDialog = false"
          >
            取消
          </el-button>
          <el-button
            type="primary"
            size="large"
            :loading="passwordFormLoading"
            @click="handlePasswordFormSave"
          >
            {{ isEditingPassword ? '更新' : '保存' }}
          </el-button>
        </div>
      </template>
    </el-dialog>

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
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  Plus,
  Download,
  Upload,
  Search,
  Delete,
  Edit,
  View,
  Hide,
  Setting,
  CopyDocument,
  Message,
  FolderChecked,
  ArrowDown,
  FolderOpened,
  Timer,
  Star,
  StarFilled,
} from '@element-plus/icons-vue';
import type { PasswordEntry } from '@/utils/types';
import { sessionManager } from '@/utils/sessionManager';
import { STORAGE_KEYS } from '@/utils/encryption';
import { SESSION_STORAGE_KEYS } from '@/utils/sessionManager-storage';
import { formatDate } from '@/utils/dateFormat';
import { logger } from '@/utils/logger';
import ImportDialog from '@/components/ImportDialog.vue';
import BackupImportDialog from '@/components/BackupImportDialog.vue';
import BrandLogo from '@/components/BrandLogo.vue';
import DisclaimerInfo from '@/components/DisclaimerInfo.vue';
import ValidityHoursSelect from '@/components/ValidityHoursSelect.vue';
import ValiditySettingDialog from '@/components/ValiditySettingDialog.vue';
import EmailBackupDialog from '@/components/EmailBackupDialog.vue';
import AutoSaveSettingDialog from '@/components/AutoSaveSettingDialog.vue';
import IdleLockSetting from '@/components/IdleLockSetting.vue';
import PasswordStrengthPopover from '@/components/PasswordStrengthPopover.vue';
import { getTagType, parseTags } from '@/utils/tagUtils';
import { Lock, Unlock, Clock } from '@element-plus/icons-vue';
import { useAuthFlow, SHAKE_DURATION_MS } from '@/composables/useAuthFlow';
import { useSessionTimer } from '@/composables/useSessionTimer';
import { usePasswordManagement, MAX_TAG_COUNT } from '@/composables/usePasswordManagement';
import { usePasswordStrength } from '@/composables/usePasswordStrength';
import { exportEncryptedBackup } from '@/utils/backupExport';
import { isDev } from '@/utils/env';

/** 临时有效期表单占位，在 useSessionTimer 初始化前会被覆盖 */
const initialValidityForm = ref({ validityHours: 24 });

/** 自动保存设置弹窗可见性 */
const showAutoSaveDialog = ref(false);

/** 闲置锁定设置弹窗可见性 */
const showIdleLockDialog = ref(false);

/** 主密码输入框是否获取焦点（控制规则气泡弹窗显示） */
const passwordInputFocused = ref(false);

/** 密码表单弹窗 - 密码输入框是否获取焦点（控制强度气泡弹窗显示） */
const formPasswordInputFocused = ref(false);

/** 主密码设置页强度校验（复用 usePasswordStrength composable） */
const setupPasswordRef = computed(() => setupForm.value.password);
const { rules: passwordRules, strength: passwordStrength } = usePasswordStrength(setupPasswordRef);

/** 密码表单弹窗强度校验 */
const formPasswordRef = computed(() => passwordForm.value.password);
const { rules: formPasswordRules, strength: formPasswordStrength } = usePasswordStrength(formPasswordRef);

/** 加密备份导入弹窗可见性 */
const showBackupImportDialog = ref(false);

/** 加密备份导出 */
const handleEncryptedBackupExport = async () => {
  try {
    if (passwords.value.length === 0) {
      ElMessage.warning('没有密码数据可备份');
      return;
    }
    const { value: masterPassword } = await ElMessageBox.prompt(
      '加密备份需要验证主密码，请输入主密码：',
      '加密备份导出',
      {
        confirmButtonText: '确认导出',
        cancelButtonText: '取消',
        inputType: 'password',
        inputPlaceholder: '请输入主密码',
        inputValidator: (v: string) => (!v || !v.trim() ? '主密码不能为空' : true),
      },
    );
    const isValid = await StorageUtils.verifyMasterPassword(masterPassword.trim());
    if (!isValid) {
      ElMessage.error('主密码错误，导出失败');
      return;
    }
    await exportEncryptedBackup(passwords.value, masterPassword.trim());
    ElMessage.success('加密备份导出成功');
  } catch (error) {
    if (error !== 'cancel') {
      logger.error('加密备份导出失败:', error);
      ElMessage.error('加密备份导出失败');
    }
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
    case 'backupExport':
      handleEncryptedBackupExport();
      break;
    case 'backupImport':
      showBackupImportDialog.value = true;
      break;
    case 'backup':
      openEmailBackupDialog();
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
  editingPasswordId: _editingPasswordId,
  passwordFormRef,
  passwordForm,
  passwordFormRules,
  passwordFormLoading,
  tableLoading,
  tableRef,
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
  downloadTemplate,
  openEmailBackupDialog,
  backupToEmail,
  toggleFavorite,
} = usePasswordManagement({
  validityForm: initialValidityForm,
});

/** 认证流程状态与操作方法 */
const {
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
  checkAuth,
  handleSetupSubmit,
  handleVerifySubmit,
  handleSessionExpired,
  debugPassword,
  resetMasterPassword,
} = useAuthFlow({
  loadPasswords,
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
  loadPasswords,
});

/**
 * 需要重跑认证判定的 storage key。
 * 外部（如 DevTools）清空或变更这些 key 时，需要同步重新评估主密码/会话状态。
 */
const AUTH_RELATED_STORAGE_KEYS = new Set<string>([
  STORAGE_KEYS.MASTER_PASSWORD,
  STORAGE_KEYS.PASSWORDS,
  SESSION_STORAGE_KEYS.MASTER_PASSWORD,
  SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
  SESSION_STORAGE_KEYS.VALIDITY_HOURS,
]);

/** chrome.storage 变化监听：认证相关 key 变动时重跑 checkAuth，密码数据变化时重新加载列表 */
const handleStorageChanged = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: chrome.storage.AreaName,
) => {
  if (areaName !== 'local') return;
  const hasAuthChange = Object.keys(changes).some(key => AUTH_RELATED_STORAGE_KEYS.has(key));
  if (!hasAuthChange) return;
  logger.debug('Options: 检测到认证相关 storage 变动，重新检查认证状态');
  void checkAuth();
  // 密码数据变化时，重新加载密码列表（解决自动保存后列表不刷新的问题）
  if (STORAGE_KEYS.PASSWORDS in changes) {
    logger.debug('Options: 检测到密码数据变动，重新加载密码列表');
    void loadPasswords();
  }
};

/** 可见性变化监听：页面重新可见时重跑 checkAuth（侧边栏激活已有 options tab 场景）*/
const handleVisibilityChange = () => {
  if (document.visibilityState !== 'visible') return;
  logger.debug('Options: 页面重新可见，重新检查认证状态');
  void checkAuth();
};

/** 初始化：启动会话管理器、监听会话过期事件、加载配置并检查认证状态 */
onMounted(async () => {
  sessionManager.init();
  window.addEventListener('sessionExpired', handleSessionExpired);
  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener(handleStorageChanged);
  }
  document.addEventListener('visibilitychange', handleVisibilityChange);
  await loadFloatingButtonConfig();
  await checkAuth();
});

onUnmounted(() => {
  window.removeEventListener('sessionExpired', handleSessionExpired);
  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.removeListener(handleStorageChanged);
  }
  document.removeEventListener('visibilitychange', handleVisibilityChange);
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
