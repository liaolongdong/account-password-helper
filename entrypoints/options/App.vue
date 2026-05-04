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
            <el-icon class="logo"><Key /></el-icon>
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
                description="主密码用于保护您的所有账号信息，请妥善保管。密码设置必须同时包含字母、数字和特殊字符，且长度不少于8个字符。"
                type="info"
                :closable="false"
                show-icon
                style="margin-bottom: 24px"
              />

              <el-form-item
                label="主密码"
                prop="password"
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
                />
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
                />
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
                  @click="handleSetupSubmit"
                  style="width: 100%"
                >
                  设置主密码并开始使用
                </el-button>
              </el-form-item>
            </el-form>
            <!-- 免责声明 -->
            <DisclaimerInfo />
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
            <el-icon class="logo"><Key /></el-icon>
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
              <el-alert
                v-if="verifyError"
                :title="verifyError"
                type="error"
                :closable="false"
                show-icon
                style="margin-bottom: 20px"
              />

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
                  autocomplete="current-password"
                  @keyup.enter="handleVerifySubmit"
                  @input="verifyError = ''"
                />
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
                  @click="handleVerifySubmit"
                  style="width: 100%; margin-bottom: 16px"
                >
                  验证密码
                </el-button>

                <div class="verify-actions">
                  <el-button
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
            <DisclaimerInfo />
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
              <el-icon class="logo"><Key /></el-icon>
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
            <el-button
              :icon="Download"
              @click="downloadTemplate"
            >
              下载模板
            </el-button>
            <el-button
              :icon="Upload"
              @click="showImportDialog = true"
            >
              导入Excel
            </el-button>
            <el-button
              :icon="Download"
              @click="exportPasswords"
            >
              导出Excel
            </el-button>
            <el-button
              :icon="Setting"
              @click="openValiditySetting"
            >
              有效期设置
            </el-button>
          </div>
          <div class="header-actions-right">
            <span class="floating-button-label">悬浮按钮</span>
            <el-switch
              v-model="floatingButtonVisible"
              @change="toggleFloatingButton"
              active-text=""
              inactive-text=""
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
          @input="handleSearch"
        />
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
        class="password-list-info"
        v-if="passwords.length > 0"
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
          @selection-change="handleSelectionChange"
          :default-sort="{ prop: 'updateTime', order: 'descending' }"
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
                <el-tag
                  v-for="t in parseTags(row.tag)"
                  :key="t"
                  :type="getTagType(t)"
                  size="small"
                  class="tag-item"
                >
                  {{ t }}
                </el-tag>
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
                  <div style="white-space: pre-wrap; word-break: break-all; max-width: 480px">
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
              {{ new Date(row.createTime).toLocaleDateString() }}
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
              {{ new Date(row.updateTime).toLocaleDateString() }}
            </template>
          </el-table-column>
          <el-table-column
            label="操作"
            header-align="center"
            width="160"
            fixed="right"
          >
            <template #default="{ row }">
              <div class="operation-buttons">
                <el-button
                  :icon="CopyDocument"
                  link
                  size="small"
                  @click="copyPassword(row)"
                >
                  复制
                </el-button>
                <el-button
                  :icon="Edit"
                  link
                  size="small"
                  @click="editPassword(row)"
                >
                  编辑
                </el-button>
                <el-button
                  :icon="Delete"
                  link
                  size="small"
                  type="danger"
                  @click="deletePassword(row.id)"
                >
                  删除
                </el-button>
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
          <el-input
            v-model="passwordForm.password"
            type="password"
            placeholder="选填，密码信息（最多50字符）"
            show-password
            :disabled="passwordFormLoading"
            maxlength="50"
            show-word-limit
          />
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
            placeholder="选填，可多选或输入后回车新增"
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
      :form-ref="validityFormRef"
      :loading="validityLoading"
      :clear-session-loading="clearSessionLoading"
      :session-info="sessionInfo"
      @save="handleValiditySave"
      @clear-session="handleClearSession"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import {
  Key,
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
} from '@element-plus/icons-vue';
import type { PasswordEntry } from '../../utils/types';
import { sessionManager } from '../../utils/sessionManager';
import ImportDialog from '../../components/ImportDialog.vue';
import DisclaimerInfo from '@/components/DisclaimerInfo.vue';
import ValidityHoursSelect from '../../components/ValidityHoursSelect.vue';
import ValiditySettingDialog from '../../components/ValiditySettingDialog.vue';
import { getTagType, parseTags } from '../../utils/tagUtils';
import { useAuthFlow } from '../../composables/useAuthFlow';
import { useSessionTimer } from '../../composables/useSessionTimer';
import { usePasswordManagement } from '../../composables/usePasswordManagement';

/** 临时有效期表单占位，在 useSessionTimer 初始化后会被覆盖 */
const initialValidityForm = ref({ validityHours: 24 });

/** 密码管理状态与操作方法 */
const {
  passwords,
  showImportDialog,
  showPasswordDialog,
  searchKeyword,
  selectedIds,
  isEditingPassword,
  editingPasswordId,
  passwordFormRef,
  passwordForm,
  passwordFormRules,
  passwordFormLoading,
  tableLoading,
  tableRef,
  floatingButtonVisible,
  filteredPasswords,
  availableTags,
  tagArray,
  loadFloatingButtonConfig,
  toggleFloatingButton,
  loadPasswords,
  handleSearch,
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
  validityFormRef,
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

/** 初始化：启动会话管理器、监听会话过期事件、加载配置并检查认证状态 */
onMounted(async () => {
  sessionManager.init();
  window.addEventListener('sessionExpired', handleSessionExpired);
  await loadFloatingButtonConfig();
  await checkAuth();
});

onUnmounted(() => {
  window.removeEventListener('sessionExpired', handleSessionExpired);
});
</script>

<style scoped>
@import url('./styles.css');
</style>
