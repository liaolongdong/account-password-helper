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
import { View, Hide } from '@element-plus/icons-vue';
import PasswordStrengthPopover from '@/components/options/PasswordStrengthPopover.vue';
import PasswordGeneratorPopover from '@/components/options/PasswordGeneratorPopover.vue';
import TotpCode from '@/components/TotpCode.vue';
import { isValidTotpInput } from '@/utils/totp';
import { formatDateTime } from '@/utils/dateFormat';
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

// ==================== 密码修改历史 ====================

const { historyList, loadHistory, decryptHistoryPassword } = usePasswordHistory();

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

/** 弹窗打开时，编辑模式下加载历史 */
watch(
  () => props.modelValue,
  visible => {
    if (visible && props.isEditing && props.editingId) {
      loadHistory(props.editingId);
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

.totp-preview {
  display: flex;
  align-items: center;
  min-height: 24px;
  margin-top: 8px;
}

.totp-preview__hint {
  font-size: 12px;
  color: #f56c6c;
}

.totp-tip {
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
