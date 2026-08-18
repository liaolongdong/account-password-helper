<template>
  <el-dialog
    :model-value="modelValue"
    :title="isEditing ? t('options.form.editTitle') : t('options.form.addTitle')"
    width="600px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
    @closed="$emit('closed')"
  >
    <div class="dialog-body-scroll">
      <el-form
        ref="localFormRef"
        :model="localForm"
        :rules="formRules"
        label-width="100px"
        size="large"
      >
        <el-form-item
          :label="t('common.username')"
          prop="username"
        >
          <el-input
            v-model="localForm.username"
            :placeholder="t('options.form.usernamePlaceholder')"
            :disabled="loading"
            maxlength="50"
            show-word-limit
          />
        </el-form-item>

        <el-form-item
          :label="t('common.password')"
          prop="password"
        >
          <PasswordStrengthPopover
            v-model:visible="formPasswordInputFocused"
            :title="t('options.form.strengthTitle')"
            :hint="t('options.form.strengthHint')"
            :password="localForm.password"
            :strength="passwordStrength"
            :rules="passwordRules"
          >
            <el-input
              v-model="localForm.password"
              type="password"
              :placeholder="t('options.form.passwordPlaceholder')"
              show-password
              :disabled="loading"
              maxlength="50"
              show-word-limit
              @focus="formPasswordInputFocused = true"
              @blur="formPasswordInputFocused = false"
            >
              <!-- 状态语义：明文显示睁眼，密文显示闭眼 -->
              <template #password-icon="{ visible }">
                <el-icon>
                  <View v-if="visible" />
                  <Hide v-else />
                </el-icon>
              </template>
            </el-input>
          </PasswordStrengthPopover>
          <PasswordGeneratorPopover
            :disabled="loading"
            @confirm="handleGeneratedPassword"
          />
        </el-form-item>

        <el-form-item
          :label="t('common.url')"
          prop="url"
        >
          <el-input
            v-model="localForm.url"
            :placeholder="t('options.form.urlPlaceholder')"
            :disabled="loading"
            maxlength="100"
            show-word-limit
          />
        </el-form-item>

        <el-form-item
          :label="t('common.tag')"
          prop="tag"
        >
          <el-select
            :model-value="tagArray"
            multiple
            filterable
            allow-create
            default-first-option
            clearable
            :disabled="loading"
            :multiple-limit="MAX_TAG_COUNT"
            :placeholder="t('options.form.tagPlaceholder', { max: MAX_TAG_COUNT })"
            style="width: 100%"
            @update:model-value="$emit('update:tagArray', $event)"
          >
            <el-option
              v-for="tagOption in availableTags"
              :key="tagOption"
              :label="tagOption"
              :value="tagOption"
            />
          </el-select>
        </el-form-item>

        <el-form-item
          :label="t('common.remark')"
          prop="remark"
        >
          <el-input
            v-model="localForm.remark"
            type="textarea"
            :rows="3"
            :placeholder="t('options.form.remarkPlaceholder')"
            :disabled="loading"
            maxlength="1000"
            show-word-limit
          />
        </el-form-item>

        <el-form-item
          :label="t('common.totp')"
          prop="totp"
        >
          <el-input
            v-model="localForm.totp"
            :placeholder="t('options.form.totpPlaceholder')"
            :disabled="loading"
            clearable
          />
          <!-- 扫码识别：截取网页 / 上传图片，本地 jsQR 解码，零网络请求 -->
          <div class="totp-scan-actions">
            <el-button
              size="small"
              :icon="Camera"
              :loading="qrScanning"
              :disabled="loading"
              :title="t('options.form.totpScanFromTabTip')"
              @click="handleScanFromTab"
            >
              {{ t('options.form.totpScanFromTab') }}
            </el-button>
            <el-button
              size="small"
              :icon="Upload"
              :disabled="loading || qrScanning"
              @click="triggerQrUpload"
            >
              {{ t('options.form.totpScanUpload') }}
            </el-button>
            <input
              ref="qrFileInputRef"
              type="file"
              accept="image/*"
              class="totp-scan-actions__file"
              @change="handleQrFileSelected"
            />
          </div>
          <div
            v-if="localForm.totp && localForm.totp.trim()"
            class="totp-preview"
          >
            <TotpCode
              v-if="totpPreviewValid"
              :secret="localForm.totp"
              diagnostic
            />
            <span
              v-else
              class="totp-preview__hint"
              >{{ t('options.form.totpInvalid') }}</span
            >
          </div>
          <div class="totp-tip">
            {{ t('options.form.totpTip') }}
          </div>
        </el-form-item>
      </el-form>

      <!-- 密码修改历史（仅编辑模式且有历史记录时展示） -->
      <div
        v-if="isEditing && historyList.length > 0"
        class="password-history-section"
      >
        <el-divider content-position="left">{{ t('options.form.historyTitle') }}</el-divider>
        <div class="history-list">
          <div
            v-for="(item, index) in historyList"
            :key="index"
            class="history-item"
          >
            <span class="history-time">{{ formatHistoryTime(item.changedAt) }}</span>
            <span class="history-password">••••••••</span>
            <div class="history-actions">
              <el-button
                type="primary"
                size="small"
                :loading="item.loading"
                @click="handleCopyHistory(item, index)"
              >
                {{ t('common.copy') }}
              </el-button>
              <el-button
                type="warning"
                size="small"
                :loading="item.loading"
                @click="handleRestoreHistory(item, index)"
              >
                {{ t('options.form.restore') }}
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button
          size="large"
          @click="$emit('update:modelValue', false)"
        >
          {{ t('common.cancel') }}
        </el-button>
        <el-button
          type="primary"
          size="large"
          :loading="loading"
          @click="$emit('save')"
        >
          {{ isEditing ? t('common.update') : t('common.save') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue';
import type { FormInstance, FormRules } from 'element-plus';
import { View, Hide, Camera, Upload } from '@element-plus/icons-vue';
import PasswordStrengthPopover from '@/components/options/PasswordStrengthPopover.vue';
import PasswordGeneratorPopover from '@/components/options/PasswordGeneratorPopover.vue';
import TotpCode from '@/components/TotpCode.vue';
import { isValidTotpInput } from '@/utils/totp';
import { formatDateTime } from '@/utils/dateFormat';
import { logger } from '@/utils/logger';
import { usePasswordHistory } from '@/composables/usePasswordHistory';
import type { PasswordRuleItem, PasswordStrengthResult } from '@/composables/usePasswordStrength';
import { MAX_TAG_COUNT } from '@/composables/usePasswordManagement';
import { useI18n } from '@/utils/i18n';

/**
 * 密码表单弹窗组件
 *
 * 提供添加和编辑密码的表单界面，包含用户名、密码（带强度检测）、
 * URL、标签多选和备注等字段。
 */
const props = defineProps<{
  /** 弹窗显隐状态 */
  modelValue: boolean;
  /** 是否为编辑模式 */
  isEditing: boolean;
  /** 当前编辑的条目 ID（编辑模式下用于加载历史） */
  editingId?: string;
  /** 表单数据 */
  form: { username: string; password: string; url: string; tag: string; remark: string; totp: string };
  /** 表单校验规则 */
  formRules: FormRules;
  /** 提交加载状态 */
  loading: boolean;
  /** 下拉候选标签列表 */
  availableTags: string[];
  /** 当前标签数组视图 */
  tagArray: string[];
  /** 密码强度计算结果 */
  passwordStrength: PasswordStrengthResult;
  /** 密码规则逐条校验结果 */
  passwordRules: PasswordRuleItem[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'update:form': [
    value: { username: string; password: string; url: string; tag: string; remark: string; totp: string },
  ];
  'update:tagArray': [value: string[]];
  save: [];
  closed: [];
}>();

const { t } = useI18n();

/** 本地表单模型，从 props 同步并通过事件回写 */
const localForm = reactive({
  username: props.form.username,
  password: props.form.password,
  url: props.form.url,
  tag: props.form.tag,
  remark: props.form.remark,
  totp: props.form.totp,
});

/** props -> local 同步（父组件重置时生效，如编辑/新增切换） */
watch(
  () => props.form,
  val => {
    localForm.username = val.username;
    localForm.password = val.password;
    localForm.url = val.url;
    localForm.tag = val.tag;
    localForm.remark = val.remark;
    localForm.totp = val.totp;
  },
);

/** local -> parent 同步 */
watch(localForm, val => {
  emit('update:form', { ...val });
});

/** 本地表单引用 */
const localFormRef = ref<FormInstance>();

/** 密码输入框焦点状态 */
const formPasswordInputFocused = ref(false);

/** TOTP 密钥预览是否有效（控制是否展示实时动态码） */
const totpPreviewValid = computed(() => isValidTotpInput((localForm.totp || '').trim()));

/**
 * 处理密码生成器确认事件
 * @param password 生成的密码
 */
const handleGeneratedPassword = (password: string) => {
  localForm.password = password;
};

// ==================== TOTP 扫码识别 ====================

/** 扫码识别进行中状态（截取网页 / 解码图片期间禁用相关按钮） */
const qrScanning = ref(false);

/** 隐藏的二维码图片选择输入框引用 */
const qrFileInputRef = ref<HTMLInputElement>();

/**
 * 校验并应用二维码识别出的文本（仅接受合法 TOTP 密钥）
 * @param text 二维码内容
 */
const applyQrText = (text: string) => {
  const trimmed = text.trim();
  if (isValidTotpInput(trimmed)) {
    localForm.totp = trimmed;
    ElMessage.success(t('options.form.totpScanSuccess'));
  } else {
    ElMessage.error(t('options.form.totpScanInvalid'));
  }
};

/**
 * 从最近浏览的网页截屏并识别二维码（扫码模块按需动态导入）
 */
const handleScanFromTab = async () => {
  qrScanning.value = true;
  try {
    const { scanQrFromRecentTab } = await import('@/utils/qrScanner');
    const result = await scanQrFromRecentTab();
    if (result.status === 'no-tab') {
      ElMessage.warning(t('options.form.totpScanNoTab'));
    } else if (result.status === 'not-found') {
      ElMessage.warning(t('options.form.totpScanNotFound'));
    } else if (result.text) {
      applyQrText(result.text);
    }
  } catch (error) {
    logger.error('网页二维码识别失败:', error);
    ElMessage.error(t('options.form.totpScanFailed'));
  } finally {
    qrScanning.value = false;
  }
};

/**
 * 触发二维码图片选择
 */
const triggerQrUpload = () => {
  qrFileInputRef.value?.click();
};

/**
 * 读取文件为 dataURL
 * @param file 图片文件
 */
const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * 处理用户上传的二维码图片并识别
 * @param event 文件选择事件
 */
const handleQrFileSelected = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // 立即清空选择，允许重复选择同一文件重试
  input.value = '';
  if (!file) return;

  qrScanning.value = true;
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const { decodeQrFromImage } = await import('@/utils/qrScanner');
    const text = await decodeQrFromImage(dataUrl);
    if (text) {
      applyQrText(text);
    } else {
      ElMessage.warning(t('options.form.totpScanNotFound'));
    }
  } catch (error) {
    logger.error('二维码图片识别失败:', error);
    ElMessage.error(t('options.form.totpScanFailed'));
  } finally {
    qrScanning.value = false;
  }
};

// ==================== 密码修改历史 ====================

const { historyList, loadHistory, decryptHistoryPassword } = usePasswordHistory();

/** 密码历史配置（控制是否展示历史区块） */
const historyConfig = ref<{ enabled: boolean; maxCount: number }>({ enabled: true, maxCount: 3 });

/** 格式化历史时间 */
const formatHistoryTime = (timestamp: number): string => formatDateTime(timestamp);

/** 复制历史密码 */
const handleCopyHistory = async (item: { password: string; loading: boolean }, index: number) => {
  historyList.value[index].loading = true;
  try {
    const plain = await decryptHistoryPassword(item.password);
    if (plain) {
      await navigator.clipboard.writeText(plain);
      ElMessage.success(t('options.form.historyCopied'));
    } else {
      ElMessage.error(t('message.decryptFailed'));
    }
  } finally {
    historyList.value[index].loading = false;
  }
};

/** 恢复历史密码到表单 */
const handleRestoreHistory = async (item: { password: string; loading: boolean }, index: number) => {
  historyList.value[index].loading = true;
  try {
    const plain = await decryptHistoryPassword(item.password);
    if (plain) {
      localForm.password = plain;
      ElMessage.success(t('options.form.historyRestored'));
    } else {
      ElMessage.error(t('message.decryptFailed'));
    }
  } finally {
    historyList.value[index].loading = false;
  }
};

/** 弹窗打开时，编辑模式下加载历史（需配置启用） */
watch(
  () => props.modelValue,
  async visible => {
    if (visible && props.isEditing && props.editingId) {
      // 读取密码历史配置：禁用时不加载历史记录
      const { getPasswordHistoryConfig } = await import('@/utils/storage/configManager');
      historyConfig.value = await getPasswordHistoryConfig();
      if (historyConfig.value.enabled) {
        loadHistory(props.editingId);
      }
    } else if (!visible) {
      historyList.value = [];
    }
  },
);

/** 暴露表单引用供父组件调用 validate / clearValidate */
defineExpose({ formRef: localFormRef });
</script>

<style scoped>
.dialog-footer {
  display: flex;
  justify-content: flex-end;
}

/* el-form-item 内容区为 flex-wrap 容器，辅助行（扫码按钮/动态码预览/提示）均需 width:100% 独占一行，避免互相挤占同行错位 */
.totp-preview {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 24px;
  margin-top: 8px;
}

.totp-scan-actions {
  display: flex;
  width: 100%;
  margin-top: 8px;
}

.totp-scan-actions__file {
  display: none;
}

.totp-preview__hint {
  font-size: 12px;
  color: #f56c6c;
}

.totp-tip {
  width: 100%;
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: #909399;
}

.password-history-section {
  margin-top: 8px;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-item {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 6px;
}

.history-time {
  flex-shrink: 0;
  font-size: 12px;
  color: #909399;
}

.history-password {
  flex: 1;
  font-size: 13px;
  color: #606266;
  letter-spacing: 2px;
}

.history-actions {
  display: flex;
  flex-shrink: 0;
}
</style>
