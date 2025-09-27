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
            <h1>密码管理助手</h1>
          </div>
          <p class="subtitle">欢迎使用密码管理助手，请先设置主密码</p>
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
                description="主密码用于保护您的所有账号信息，请妥善保管。密码必须至少8个字符，并同时包含字母、数字和特殊字符。"
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
                <el-select
                  v-model="setupForm.validityHours"
                  placeholder="选择验证有效期"
                  size="large"
                  :disabled="setupLoading"
                  style="width: 100%"
                >
                  <el-option
                    label="1小时"
                    :value="1"
                  />
                  <el-option
                    label="2小时"
                    :value="2"
                  />
                  <el-option
                    label="4小时"
                    :value="4"
                  />
                  <el-option
                    label="8小时"
                    :value="8"
                  />
                  <el-option
                    label="12小时"
                    :value="12"
                  />
                  <el-option
                    label="24小时（推荐）"
                    :value="24"
                  />
                </el-select>
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
            <h1>密码管理助手</h1>
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
                <el-select
                  v-model="verifyForm.validityHours"
                  placeholder="选择验证有效期"
                  size="large"
                  :disabled="verifyLoading"
                  style="width: 100%"
                >
                  <el-option
                    label="1小时"
                    :value="1"
                  />
                  <el-option
                    label="2小时"
                    :value="2"
                  />
                  <el-option
                    label="4小时"
                    :value="4"
                  />
                  <el-option
                    label="8小时"
                    :value="8"
                  />
                  <el-option
                    label="12小时"
                    :value="12"
                  />
                  <el-option
                    label="24小时（推荐）"
                    :value="24"
                  />
                </el-select>
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
              密码管理助手
            </h1>
          </div>
        </div>

        <!-- 第二行：操作按钮 -->
        <div class="header-actions-row">
          <div class="header-actions">
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
              type="primary"
              :icon="Plus"
              @click="openPasswordDialog"
            >
              添加密码
            </el-button>
            <el-button
              :icon="Setting"
              @click="openValiditySetting"
            >
              有效期设置
            </el-button>
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

      <!-- 密码列表 -->
      <div class="password-list">
        <el-table
          ref="tableRef"
          :data="filteredPasswords"
          style="width: 100%"
          row-key="id"
          @selection-change="handleSelectionChange"
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
            min-width="120"
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
          >
            <template #default="{ row }">
              <el-tag
                v-if="row.tag"
                :type="getTagType(row.tag)"
                size="small"
                class="tag-item"
              >
                {{ row.tag }}
              </el-tag>
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
            min-width="120"
          >
            <template #default="{ row }">
              {{ new Date(row.createTime).toLocaleDateString() }}
            </template>
          </el-table-column>
          <el-table-column
            label="操作"
            header-align="center"
            width="140"
            fixed="right"
          >
            <template #default="{ row }">
              <div class="operation-buttons">
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
          <el-input
            v-model="passwordForm.tag"
            placeholder="如：工作、个人等（最多50字符）"
            :disabled="passwordFormLoading"
            maxlength="50"
            show-word-limit
          />
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
    <el-dialog
      v-model="showValiditySetting"
      title="验证有效期设置"
      width="500px"
      :close-on-click-modal="false"
    >
      <el-form
        ref="validityFormRef"
        :model="validityForm"
        :rules="validityRules"
        label-width="100px"
        size="large"
      >
        <el-alert
          title="有效期设置"
          description="设置主密码验证后的会话缓存时间，在有效期内无需重新输入主密码"
          type="info"
          :closable="false"
          show-icon
          style="margin-bottom: 24px"
        />

        <el-form-item
          label="当前会话状态"
          v-if="sessionInfo.expiryTime"
        >
          <div class="session-info">
            <div class="session-status">
              <el-tag
                type="success"
                size="small"
                >会话有效</el-tag
              >
            </div>
            <div class="session-expiry">剩余时间: {{ sessionInfo.remainingTime }}</div>
            <div
              class="session-actions"
              style="margin-top: 8px"
            >
              <el-button
                type="danger"
                size="small"
                :icon="Delete"
                @click="handleClearSession"
                :loading="clearSessionLoading"
              >
                清除当前会话
              </el-button>
            </div>
          </div>
        </el-form-item>

        <el-form-item
          label="验证有效期"
          prop="validityHours"
        >
          <el-select
            v-model="validityForm.validityHours"
            placeholder="选择验证有效期"
            size="large"
            :disabled="validityLoading"
            style="width: 100%"
          >
            <el-option
              label="1小时"
              :value="1"
            />
            <el-option
              label="2小时"
              :value="2"
            />
            <el-option
              label="4小时"
              :value="4"
            />
            <el-option
              label="8小时"
              :value="8"
            />
            <el-option
              label="12小时"
              :value="12"
            />
            <el-option
              label="24小时（推荐）"
              :value="24"
            />
          </el-select>
          <div class="form-tip">当前设置将影响会话缓存时间</div>
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <el-button
            size="large"
            @click="showValiditySetting = false"
          >
            取消
          </el-button>
          <el-button
            type="primary"
            size="large"
            :loading="validityLoading"
            @click="handleValiditySave"
          >
            保存设置
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, nextTick, onUnmounted, watch } from 'vue';
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
  ArrowLeft,
  Setting
} from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { PasswordEntry } from '../../utils/types';
import { StorageUtils } from '../../utils/storage';
import { sessionManager } from '../../utils/sessionManager';
import { ExcelUtils } from '../../utils/excel';
import type { FormRules, FormInstance } from 'element-plus';
import ImportDialog from '../../components/ImportDialog.vue';

// 页面状态
const isAuthenticated = ref(false);
const showMasterPasswordSetup = ref(false);
const showPasswordVerify = ref(false);
const showPasswordForm = ref(false);
const showValiditySetting = ref(false); // 添加有效期设置弹窗状态

// 表单相关
const setupFormRef = ref<FormInstance>();
const verifyFormRef = ref<FormInstance>();
const passwordFormRef = ref<FormInstance>();
const validityFormRef = ref<FormInstance>(); // 添加有效期表单引用
const setupLoading = ref(false);
const verifyLoading = ref(false);
const passwordFormLoading = ref(false);
const validityLoading = ref(false); // 添加有效期表单加载状态
const clearSessionLoading = ref(false); // 添加清除会话加载状态
const verifyError = ref('');

// 设置表单
const setupForm = ref({
  password: '',
  confirmPassword: '',
  validityHours: 24
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

        // 检查是否包含字母
        const hasLetter = /[a-zA-Z]/.test(value);
        // 检查是否包含数字
        const hasNumber = /[0-9]/.test(value);
        // 检查是否包含特殊字符
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
      trigger: 'blur'
    }
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
      trigger: 'blur'
    }
  ]
};

// 验证表单
const verifyForm = ref({
  password: '',
  validityHours: 24
});

const verifyRules: FormRules = {
  password: [{ required: true, message: '请输入主密码', trigger: 'blur' }]
};

// 有效期设置表单
const validityForm = ref({
  validityHours: 24
});

// 会话信息
const sessionInfo = ref({
  expiryTime: null as number | null,
  remainingTime: ''
});

// 会话定时器
let sessionTimer: number | null = null;

// 密码表单
const passwordForm = ref({
  username: '',
  password: '',
  url: '',
  tag: '',
  remark: ''
});

const passwordFormRules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { max: 50, message: '用户名不能超过50个字符', trigger: 'blur' }
  ],
  password: [{ max: 50, message: '密码不能超过50个字符', trigger: 'blur' }],
  url: [{ max: 100, message: 'URL不能超过100个字符', trigger: 'blur' }],
  tag: [{ max: 50, message: '标签不能超过50个字符', trigger: 'blur' }],
  remark: [{ max: 1000, message: '备注不能超过1000个字符', trigger: 'blur' }]
};

// 有效期设置表单规则
const validityRules: FormRules = {
  validityHours: [{ required: true, message: '请选择有效期', trigger: 'change' }]
};

// 业务数据
const showImportDialog = ref(false);
const showPasswordDialog = ref(false);
const searchKeyword = ref('');
const selectedIds = ref<string[]>([]);
const passwords = ref<PasswordEntry[]>([]);
const isEditingPassword = ref(false);
const editingPasswordId = ref<string>('');

// 计算属性
const filteredPasswords = computed(() => {
  let result = passwords.value;

  // 按照添加时间倒序排列
  result = result.sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime());

  // 搜索过滤
  if (!searchKeyword.value) return result;
  return result.filter(
    p =>
      p.username.toLowerCase().includes(searchKeyword.value.toLowerCase()) ||
      p.tag.toLowerCase().includes(searchKeyword.value.toLowerCase()) ||
      p.remark.toLowerCase().includes(searchKeyword.value.toLowerCase()) ||
      p.url.toLowerCase().includes(searchKeyword.value.toLowerCase())
  );
});

// 初始化
onMounted(async () => {
  console.log('Options: 开始初始化');
  // 初始化会话管理器
  sessionManager.init();

  // 监听会话过期事件
  window.addEventListener('sessionExpired', handleSessionExpired);

  await checkAuth();
  console.log('Options: 初始化完成');
});

// 在 onUnmounted 中移除事件监听器
onUnmounted(() => {
  console.log('Options: 开始清理');
  window.removeEventListener('sessionExpired', handleSessionExpired);
  console.log('Options: 清理完成');
});

// 处理会话过期事件
const handleSessionExpired = () => {
  console.log('Options: 处理会话过期事件');
  // 显示验证页面
  showMasterPasswordSetup.value = false;
  showPasswordVerify.value = true;
  isAuthenticated.value = false;

  // 初始化验证表单的有效期
  StorageUtils.getMasterPasswordValidityHours().then(validityHours => {
    verifyForm.value.validityHours = validityHours;
  });

  // 聚焦到密码输入框
  nextTick(() => {
    const passwordInput = document.querySelector('.verify-form .el-input__inner') as HTMLInputElement;
    if (passwordInput) {
      passwordInput.focus();
    }
  });
  console.log('Options: 会话过期事件处理完成');
};

// 检查认证状态
const checkAuth = async () => {
  try {
    console.log('Options: 开始检查认证状态...');
    const hasMaster = await StorageUtils.hasMasterPassword();
    console.log('Options: 是否已设置主密码:', hasMaster);

    if (!hasMaster) {
      console.log('Options: 首次使用，显示设置主密码页面');
      showMasterPasswordSetup.value = true;
      showPasswordVerify.value = false;
      isAuthenticated.value = false;

      // 聚焦到密码输入框
      nextTick(() => {
        const passwordInput = document.querySelector('.setup-form .el-input__inner') as HTMLInputElement;
        if (passwordInput) {
          passwordInput.focus();
        }
      });
    } else {
      // 检查会话是否有效
      const isSessionValid = await StorageUtils.isSessionValid();
      console.log('Options: 会话是否有效:', isSessionValid);
      if (isSessionValid) {
        console.log('Options: 会话有效，直接进入主界面');
        showMasterPasswordSetup.value = false;
        showPasswordVerify.value = false;
        isAuthenticated.value = true;

        // 初始化有效期设置表单
        const validityHours = await StorageUtils.getMasterPasswordValidityHours();
        validityForm.value.validityHours = validityHours;

        await loadPasswords();
      } else {
        console.log('Options: 会话无效，显示验证页面');
        showMasterPasswordSetup.value = false;
        showPasswordVerify.value = true;
        isAuthenticated.value = false;

        // 初始化验证表单的有效期
        const validityHours = await StorageUtils.getMasterPasswordValidityHours();
        verifyForm.value.validityHours = validityHours;

        // 聚焦到密码输入框
        nextTick(() => {
          const passwordInput = document.querySelector('.verify-form .el-input__inner') as HTMLInputElement;
          if (passwordInput) {
            passwordInput.focus();
          }
        });
      }
    }
  } catch (error) {
    console.error('Options: 检查认证状态失败:', error);
    // 出错时显示验证页面
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
    console.log('设置主密码...');

    // 设置主密码
    await StorageUtils.setMasterPassword(setupForm.value.password.trim());

    // 保存有效期设置
    await StorageUtils.setMasterPasswordValidityHours(setupForm.value.validityHours);

    // 创建会话缓存
    await StorageUtils.createSession(setupForm.value.password.trim(), setupForm.value.validityHours);

    console.log('主密码设置完成');

    ElMessage.success('主密码设置成功，欢迎使用');

    // 转入主界面
    showMasterPasswordSetup.value = false;
    showPasswordVerify.value = false;
    isAuthenticated.value = true;

    await loadPasswords();
  } catch (error) {
    console.error('设置主密码失败:', error);
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
    console.log('验证主密码...');

    const isValid = await StorageUtils.verifyMasterPassword(verifyForm.value.password.trim());
    console.log('验证结果:', isValid);

    if (isValid) {
      console.log('验证成功');
      ElMessage.success('验证成功，欢迎使用');

      // 保存有效期设置
      await StorageUtils.setMasterPasswordValidityHours(verifyForm.value.validityHours);

      // 创建会话缓存
      await StorageUtils.createSession(verifyForm.value.password.trim(), verifyForm.value.validityHours);

      // 转入主界面
      showPasswordVerify.value = false;
      showMasterPasswordSetup.value = false;
      isAuthenticated.value = true;

      await loadPasswords();
    } else {
      verifyError.value = '密码错误，请重新输入';
      verifyForm.value.password = '';
      // 重新聚焦
      nextTick(() => {
        const passwordInput = document.querySelector('.verify-form .el-input__inner') as HTMLInputElement;
        if (passwordInput) {
          passwordInput.focus();
          passwordInput.select(); // 选中所有文本，提升操作效率
        }
      });
    }
  } catch (error) {
    console.error('验证失败:', error);
    verifyError.value = '验证过程出现错误，请重试';
    verifyForm.value.password = '';
  } finally {
    verifyLoading.value = false;
  }
};

// 调试密码
const debugPassword = async () => {
  try {
    const debugInfo = await StorageUtils.debugMasterPassword();
    console.log('主密码调试信息:', debugInfo);

    let message = '主密码配置信息:\n';
    message += `配置存在: ${debugInfo.hasConfig ? '是' : '否'}\n`;
    message += `盐值存在: ${debugInfo.hasSalt ? '是' : '否'}\n`;
    message += `哈希存在: ${debugInfo.hasHashedPassword ? '是' : '否'}\n`;
    message += `盐值长度: ${debugInfo.saltLength}\n`;
    message += `哈希长度: ${debugInfo.hashLength}\n`;
    message += `盐值预览: ${debugInfo.saltPreview}\n`;
    message += `哈希预览: ${debugInfo.hashPreview}`;

    await ElMessageBox.alert(message, '调试信息', {
      confirmButtonText: '关闭'
    });
  } catch (error) {
    console.error('获取调试信息失败:', error);
    ElMessage.error('获取调试信息失败');
  }
};

// 重置主密码
const resetMasterPassword = async () => {
  try {
    await ElMessageBox.confirm('此操作将清空所有已保存的密码数据，确定继续吗？', '确认重置', {
      confirmButtonText: '确定重置',
      cancelButtonText: '取消',
      type: 'warning'
    });

    await StorageUtils.clearAllData();
    ElMessage.success('数据已清空，请重新设置主密码');

    // 重新检查认证
    await checkAuth();
  } catch (error) {
    if (error !== 'cancel') {
      console.error('重置失败:', error);
      ElMessage.error('重置失败');
    }
  }
};

// 加载密码列表
const loadPasswords = async () => {
  try {
    console.log('Options: 开始加载密码列表');
    // 获取会话主密码
    const masterPassword = StorageUtils.getSessionMasterPassword();
    console.log('Options: 获取到的会话主密码:', masterPassword ? '存在' : '不存在');

    passwords.value = await StorageUtils.getAllPasswords(masterPassword || undefined);
    // 添加显示密码状态
    passwords.value.forEach(p => {
      (p as any).showPassword = false;
    });

    // 初始化有效期设置表单
    const validityHours = await StorageUtils.getMasterPasswordValidityHours();
    validityForm.value.validityHours = validityHours;
    console.log('Options: 密码列表加载完成，数量:', passwords.value.length);
  } catch (error) {
    console.error('加载密码列表失败:', error);
    ElMessage.error('加载密码列表失败');
  }
};

// 搜索处理
const handleSearch = () => {
  // 搜索逻辑已通过计算属性实现
};

// 切换密码可见性
const togglePasswordVisibility = (row: any) => {
  row.showPassword = !row.showPassword;
};

// 选择变更处理
const handleSelectionChange = (selection: PasswordEntry[]) => {
  selectedIds.value = selection.map(item => item.id);
};

// 打开密码弹窗（新增）
const openPasswordDialog = () => {
  isEditingPassword.value = false;
  editingPasswordId.value = '';
  // 清空表单
  passwordForm.value = {
    username: '',
    password: '',
    url: '',
    tag: '',
    remark: ''
  };
  showPasswordDialog.value = true;
};

// 编辑密码
const editPassword = (password: PasswordEntry) => {
  isEditingPassword.value = true;
  editingPasswordId.value = password.id;
  // 填充表单数据
  passwordForm.value = {
    username: password.username,
    password: password.password,
    url: password.url,
    tag: password.tag,
    remark: password.remark
  };
  showPasswordDialog.value = true;
};

// 重置密码表单
const resetPasswordForm = () => {
  isEditingPassword.value = false;
  editingPasswordId.value = '';
  // 清空表单
  passwordForm.value = {
    username: '',
    password: '',
    url: '',
    tag: '',
    remark: ''
  };
  // 清除表单验证状态
  if (passwordFormRef.value) {
    passwordFormRef.value.clearValidate();
  }
};

// 处理密码表单保存
const handlePasswordFormSave = async () => {
  if (!passwordFormRef.value) return;

  try {
    await passwordFormRef.value.validate();
    passwordFormLoading.value = true;

    if (isEditingPassword.value) {
      // 更新密码
      await StorageUtils.updatePassword(editingPasswordId.value, {
        username: passwordForm.value.username.trim(),
        password: passwordForm.value.password,
        url: passwordForm.value.url.trim(),
        tag: passwordForm.value.tag.trim(),
        remark: passwordForm.value.remark.trim()
      });
      ElMessage.success('密码更新成功');
    } else {
      // 添加新密码
      await StorageUtils.savePassword({
        username: passwordForm.value.username.trim(),
        password: passwordForm.value.password,
        url: passwordForm.value.url.trim(),
        tag: passwordForm.value.tag.trim(),
        remark: passwordForm.value.remark.trim()
      });
      ElMessage.success('密码添加成功');
    }

    await loadPasswords();
    showPasswordDialog.value = false;
    resetPasswordForm();
  } catch (error) {
    console.error('保存密码失败:', error);
    ElMessage.error('保存失败');
  } finally {
    passwordFormLoading.value = false;
  }
};

// 处理有效期设置保存
const handleValiditySave = async () => {
  if (!validityFormRef.value) return;

  try {
    await validityFormRef.value.validate();
    validityLoading.value = true;

    console.log('Options: 开始保存有效期设置', validityForm.value.validityHours);
    // 保存有效期设置
    await StorageUtils.setMasterPasswordValidityHours(validityForm.value.validityHours);

    // 如果当前有会话，更新会话的有效期
    const currentMasterPassword = StorageUtils.getSessionMasterPassword();
    console.log('Options: 当前会话主密码:', currentMasterPassword ? '存在' : '不存在');
    if (currentMasterPassword) {
      await StorageUtils.createSession(currentMasterPassword, validityForm.value.validityHours);
    }

    ElMessage.success('有效期设置保存成功');
    showValiditySetting.value = false;
    console.log('Options: 有效期设置保存完成');
  } catch (error) {
    console.error('保存有效期设置失败:', error);
    ElMessage.error('保存失败');
  } finally {
    validityLoading.value = false;
  }
};

// 处理清除会话
const handleClearSession = async () => {
  try {
    // 确认对话框
    await ElMessageBox.confirm(
      '确定要清除当前主密码会话吗？清除后需要重新输入主密码才能访问密码列表。',
      '确认清除会话',
      {
        confirmButtonText: '确定清除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      }
    );

    clearSessionLoading.value = true;
    console.log('Options: 开始清除主密码会话');

    // 清除会话
    await StorageUtils.clearSession();

    // 更新会话信息显示
    await updateSessionInfo();

    // 停止会话定时器
    stopSessionTimer();

    // 重置认证状态
    isAuthenticated.value = false;
    passwords.value = [];

    ElMessage.success('主密码会话已清除');
    console.log('Options: 主密码会话清除完成');
  } catch (error) {
    if (error !== 'cancel') {
      console.error('清除主密码会话失败:', error);
      ElMessage.error('清除主密码会话失败');
    }
  } finally {
    clearSessionLoading.value = false;
  }
};

// 更新会话信息显示
const updateSessionInfo = async () => {
  try {
    const expiryTime = await StorageUtils.getSessionExpiryTime();
    if (expiryTime) {
      sessionInfo.value.expiryTime = expiryTime;
      updateRemainingTime(expiryTime);
    } else {
      sessionInfo.value.expiryTime = null;
      sessionInfo.value.remainingTime = '无会话';
    }
  } catch (error) {
    console.error('获取会话信息失败:', error);
    sessionInfo.value.expiryTime = null;
    sessionInfo.value.remainingTime = '获取失败';
  }
};

// 更新剩余时间显示
const updateRemainingTime = (expiryTime: number) => {
  const now = Date.now();
  const remaining = expiryTime - now;

  if (remaining <= 0) {
    sessionInfo.value.remainingTime = '已过期';
    return;
  }

  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

  if (hours > 0) {
    sessionInfo.value.remainingTime = `${hours}小时${minutes}分钟`;
  } else if (minutes > 0) {
    sessionInfo.value.remainingTime = `${minutes}分钟${seconds}秒`;
  } else {
    sessionInfo.value.remainingTime = `${seconds}秒`;
  }
};

// 启动会话定时器
const startSessionTimer = () => {
  if (sessionTimer) {
    clearInterval(sessionTimer);
  }

  sessionTimer = window.setInterval(() => {
    if (sessionInfo.value.expiryTime) {
      updateRemainingTime(sessionInfo.value.expiryTime);
    }
  }, 1000); // 每秒更新一次
};

// 停止会话定时器
const stopSessionTimer = () => {
  if (sessionTimer) {
    clearInterval(sessionTimer);
    sessionTimer = null;
  }
};

// 打开有效期设置弹窗
const openValiditySetting = async () => {
  console.log('Options: 打开有效期设置弹窗');
  showValiditySetting.value = true;

  // 初始化有效期设置表单
  const validityHours = await StorageUtils.getMasterPasswordValidityHours();
  validityForm.value.validityHours = validityHours;

  // 更新会话信息
  await updateSessionInfo();

  // 启动定时器
  startSessionTimer();
  console.log('Options: 有效期设置弹窗打开完成');
};

// 监听弹窗关闭事件
watch(showValiditySetting, newVal => {
  if (!newVal) {
    // 弹窗关闭时停止定时器
    stopSessionTimer();
  }
});

// 删除密码
const deletePassword = async (id: string) => {
  try {
    await ElMessageBox.confirm('确定要删除这个密码吗？', '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    });

    await StorageUtils.deletePassword(id);
    await loadPasswords();
    ElMessage.success('删除成功');
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败');
    }
  }
};

// 批量删除
const batchDelete = async () => {
  try {
    await ElMessageBox.confirm(`确定要删除选中的 ${selectedIds.value.length} 个密码吗？`, '确认批量删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    });

    await StorageUtils.deletePasswords(selectedIds.value);
    await loadPasswords();
    selectedIds.value = [];
    ElMessage.success('批量删除成功');
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('批量删除失败');
    }
  }
};

// 密码导入处理
const handlePasswordsImported = async () => {
  await loadPasswords();
};

// 导出密码
const exportPasswords = async () => {
  try {
    if (passwords.value.length === 0) {
      ElMessage.warning('没有密码数据可导出');
      return;
    }

    ExcelUtils.exportToExcel(passwords.value);
    ElMessage.success('导出成功');
  } catch (error) {
    ElMessage.error('导出失败');
  }
};

// 下载模板
const downloadTemplate = () => {
  try {
    ExcelUtils.downloadTemplate();
    ElMessage.success('模板下载成功');
  } catch (error) {
    ElMessage.error('模板下载失败');
  }
};

// 获取标签颜色类型
const getTagType = (tag: string): string => {
  const tagLower = tag.toLowerCase();

  // 工作相关标签
  if (
    tagLower.includes('工作') ||
    tagLower.includes('work') ||
    tagLower.includes('office') ||
    tagLower.includes('公司')
  ) {
    return 'primary';
  }

  // 个人相关标签
  if (tagLower.includes('个人') || tagLower.includes('personal') || tagLower.includes('私人')) {
    return 'success';
  }

  // 学习相关标签
  if (
    tagLower.includes('学习') ||
    tagLower.includes('study') ||
    tagLower.includes('课程') ||
    tagLower.includes('教育')
  ) {
    return 'warning';
  }

  // 游戏相关标签
  if (tagLower.includes('游戏') || tagLower.includes('game') || tagLower.includes('娱乐')) {
    return 'danger';
  }

  // 购物相关标签
  if (
    tagLower.includes('购物') ||
    tagLower.includes('shop') ||
    tagLower.includes('电商') ||
    tagLower.includes('淘宝') ||
    tagLower.includes('京东')
  ) {
    return 'info';
  }

  // 社交相关标签
  if (
    tagLower.includes('社交') ||
    tagLower.includes('social') ||
    tagLower.includes('微信') ||
    tagLower.includes('qq')
  ) {
    return 'success';
  }

  // 金融相关标签
  if (
    tagLower.includes('银行') ||
    tagLower.includes('金融') ||
    tagLower.includes('支付') ||
    tagLower.includes('理财')
  ) {
    return 'warning';
  }

  // 默认标签
  return '';
};
</script>

<style scoped>
.options-page {
  min-height: 100vh;
  background: linear-gradient(135deg, #e8f4fd 0%, #f8fbff 100%);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

/* 设置页面样式 */
.setup-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.setup-container {
  width: 100%;
  max-width: 480px;
}

.setup-header {
  text-align: center;
  margin-bottom: 32px;
}

.logo-section {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}

.logo-section .logo {
  font-size: 40px;
  color: #409eff;
  margin-right: 12px;
}

.setup-header h1 {
  font-size: 28px;
  font-weight: 600;
  margin: 0;
  color: #2c3e50;
  text-shadow: none;
}

.subtitle {
  font-size: 15px;
  margin: 0;
  color: #6c757d;
  font-weight: 400;
}

.setup-form,
.verify-form {
  margin-top: 24px;
}

.form-card {
  border-radius: 12px;
  box-shadow: 0 4px 12px rgb(64 158 255 / 10%);
  border: 1px solid #e3f2fd;
  overflow: hidden;
}

:deep(.form-card .el-card__body) {
  padding: 32px;
  background: #fff;
}

/* 验证页面样式 */
.verify-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.verify-container {
  width: 100%;
  max-width: 420px;
}

.verify-header {
  text-align: center;
  margin-bottom: 32px;
}

.verify-header h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
  color: #2c3e50;
}

.verify-actions {
  display: flex;
  justify-content: space-between;
  margin-top: 16px;
}

/* 密码表单页面样式 */
.form-page {
  min-height: 100vh;
  background: #f8fbff;
  padding: 0;
}

.form-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.form-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  padding: 16px 0;
  border-bottom: 1px solid #e3f2fd;
}

.form-back {
  display: flex;
  align-items: center;
}

.form-title h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #2c3e50;
}

.form-content {
  margin-top: 24px;
}

.password-form-card {
  border-radius: 12px;
  box-shadow: 0 2px 8px rgb(64 158 255 / 8%);
  border: 1px solid #e3f2fd;
}

:deep(.password-form-card .el-card__body) {
  padding: 32px;
}

.form-row {
  margin-bottom: 20px;
}

.form-row-half {
  margin-bottom: 20px;
  width: 300px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid #f0f0f0;
}

/* 主内容区域样式 */
.main-content {
  min-height: 100vh;
  background: #f8fbff;
  padding: 0;
}

.header {
  background: linear-gradient(135deg, #409eff 0%, #66b3ff 100%);
  color: white;
  padding: 24px 32px;
  margin-bottom: 24px;
  border-radius: 0;
  box-shadow: 0 2px 12px rgb(64 158 255 / 15%);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.header-title-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.header-title h1 {
  display: flex;
  align-items: center;
  margin: 0;
  font-size: 24px;
  font-weight: 500;
  color: white;
}

.header-title .logo {
  font-size: 28px;
  color: #fff;
  margin-right: 12px;
}

.header-actions-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
}

.header-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

:deep(.header-actions .el-button) {
  background: rgb(255 255 255 / 15%);
  border: 1px solid rgb(255 255 255 / 25%);
  color: white;
  backdrop-filter: blur(10px);
  transition: all 0.2s ease;
  font-weight: 400;
}

:deep(.header-actions .el-button:hover) {
  background: rgb(255 255 255 / 20%);
  border-color: rgb(255 255 255 / 40%);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgb(0 0 0 / 15%);
}

:deep(.header-actions .el-button--primary) {
  background: #fff;
  border: 1px solid #fff;
  color: #409eff;
  font-weight: 500;
}

:deep(.header-actions .el-button--primary:hover) {
  background: #f0f9ff;
  border-color: #f0f9ff;
  color: #1890ff;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgb(0 0 0 / 15%);
}

.filters {
  margin: 0 32px 20px;
  padding: 20px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgb(64 158 255 / 8%);
  border: 1px solid #e3f2fd;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.password-list {
  margin: 0 32px 32px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgb(64 158 255 / 8%);
  border: 1px solid #e3f2fd;
  overflow: hidden;
}

.password-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
:deep(.el-input--large .el-input__wrapper) {
  border-radius: 6px;
  box-shadow: none;
  border: 1px solid #d9ecff;
  transition: all 0.2s ease;
}

:deep(.el-input--large .el-input__wrapper:hover) {
  border-color: #409eff;
}

:deep(.el-input--large .el-input__wrapper.is-focus) {
  border-color: #409eff;
  box-shadow: 0 0 0 2px rgb(64 158 255 / 10%);
}

:deep(.el-input .el-input__wrapper) {
  border-radius: 6px;
  box-shadow: none;
  border: 1px solid #d9ecff;
  transition: all 0.2s ease;
}

:deep(.el-input .el-input__wrapper:hover) {
  border-color: #409eff;
}

:deep(.el-input .el-input__wrapper.is-focus) {
  border-color: #409eff;
  box-shadow: 0 0 0 2px rgb(64 158 255 / 10%);
}

/* 按钮优化 */
:deep(.el-button--large.el-button--primary) {
  background: #409eff;
  border: 1px solid #409eff;
  border-radius: 6px;
  font-weight: 500;
  font-size: 16px;
  padding: 12px 24px;
  transition: all 0.2s ease;
}

:deep(.el-button--large.el-button--primary:hover) {
  background: #66b3ff;
  border-color: #66b3ff;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgb(64 158 255 / 30%);
}

:deep(.el-button--primary) {
  background: #409eff;
  border: 1px solid #409eff;
  font-weight: 400;
}

:deep(.el-button--primary:hover) {
  background: #66b3ff;
  border-color: #66b3ff;
}

:deep(.el-button) {
  border-radius: 6px;
  font-weight: 400;
  transition: all 0.2s ease;
}

:deep(.el-button:hover) {
  transform: translateY(-1px);
}

/* alert 组件优化 */
:deep(.el-alert) {
  border-radius: 6px;
  border: none;
}

:deep(.el-alert--info) {
  background: #e8f4fd;
  color: #2c3e50;
}

:deep(.el-alert--error) {
  background: #fef0f0;
  color: #f56c6c;
}

:deep(.el-alert--warning) {
  background: #fdf6ec;
  color: #e6a23c;
}

/* 表单标签 */
:deep(.el-form-item__label) {
  font-weight: 500;
  color: #2c3e50;
  font-size: 14px;
}

/* 表格优化 */
:deep(.el-table) {
  font-size: 14px;
  border-radius: 0;
}

:deep(.el-table th) {
  background: #f8fbff;
  font-weight: 500;
  border-bottom: 1px solid #e3f2fd;
  color: #2c3e50;
}

:deep(.el-table td) {
  border-bottom: 1px solid #f0f9ff;
}

:deep(.el-table tbody tr:hover) {
  background-color: #f8fbff;
}

:deep(.el-table .el-button--text) {
  color: #409eff;
}

:deep(.el-table .el-button--text:hover) {
  color: #66b3ff;
}

:deep(.el-table .el-button--text.is-danger) {
  color: #f56c6c;
}

:deep(.el-table .el-button--text.is-danger:hover) {
  color: #f78989;
}

/* 链接按钮优化 */
:deep(.el-button--info.is-link) {
  color: #409eff;
  font-weight: 400;
}

:deep(.el-button--info.is-link:hover) {
  color: #66b3ff;
}

:deep(.el-button--danger.is-link) {
  color: #f56c6c;
  font-weight: 400;
}

:deep(.el-button--danger.is-link:hover) {
  color: #f78989;
}

/* 响应式设计 */
@media (width <= 768px) {
  .header {
    padding: 20px;
  }

  .header-title h1 {
    font-size: 20px;
  }

  .header-actions {
    justify-content: center;
    width: 100%;
  }

  .header-actions-row {
    justify-content: center;
  }

  .filters {
    margin: 0 16px 20px;
    padding: 16px;
    flex-direction: column;
    gap: 16px;
  }

  .password-list {
    margin: 0 16px 16px;
  }

  .form-container {
    padding: 16px;
  }

  .form-row-half {
    width: 100%;
  }

  .form-actions {
    flex-direction: column;
    gap: 12px;
  }

  .form-actions .el-button {
    width: 100%;
  }
}

/* 标签样式 */
.tag-item {
  font-weight: 500;
  border-radius: 4px;
  padding: 2px 8px;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.no-tag {
  color: #c0c4cc;
  font-style: italic;
  font-size: 12px;
}

/* 操作按钮样式 */
.operation-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
  white-space: nowrap;
}

.operation-buttons .el-button {
  font-size: 12px;
  height: auto;
  min-height: 28px;
}

/* 弹窗样式 */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

/* 表单提示样式 */
.form-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.4;
}

/* 文本省略样式 */
.text-ellipsis {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* 会话信息样式 */
.session-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.session-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.session-expiry {
  font-size: 14px;
  color: #606266;
}
</style>
