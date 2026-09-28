<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="640px"
    align-center
    class="site-rules-dialog"
    @closed="handleClosed"
  >
    <div class="dialog-body-scroll">
      <!-- 列表视图 -->
      <div
        v-if="!showForm"
        class="rules-view"
      >
        <el-table
          v-if="rulesList.length"
          :data="rulesList"
          border
          max-height="360"
        >
          <el-table-column
            prop="domain"
            :label="t('options.siteRules.columnDomain')"
            min-width="160"
            show-overflow-tooltip
          />
          <el-table-column
            :label="t('options.siteRules.columnSelectors')"
            min-width="260"
          >
            <template #default="{ row }">
              <div
                v-if="row.customSelectors"
                class="selector-cell"
              >
                <div class="selector-line">
                  <span class="selector-tag">{{ t('options.siteRules.labelUsername') }}</span>
                  <code :title="row.customSelectors.username">{{ row.customSelectors.username }}</code>
                </div>
                <div class="selector-line">
                  <span class="selector-tag">{{ t('options.siteRules.labelPassword') }}</span>
                  <code :title="row.customSelectors.password">{{ row.customSelectors.password }}</code>
                </div>
              </div>
              <span
                v-else
                class="text-gray"
              >
                {{ t('options.siteRules.noSelectors') }}
              </span>
            </template>
          </el-table-column>
          <el-table-column
            :label="t('options.siteRules.columnActions')"
            width="130"
            align="center"
          >
            <template #default="{ row }">
              <el-button
                link
                type="primary"
                @click="handleEdit(row)"
              >
                {{ t('options.siteRules.edit') }}
              </el-button>
              <el-button
                link
                type="danger"
                @click="handleDelete(row)"
              >
                {{ t('options.siteRules.delete') }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-empty
          v-else
          :image-size="80"
          :description="t('options.siteRules.empty')"
        >
          <div class="empty-tip">{{ t('options.siteRules.emptyTip') }}</div>
        </el-empty>

        <div class="transfer-tip">{{ t('options.siteRules.transferHint') }}</div>
      </div>

      <!-- 表单视图（新增 / 编辑） -->
      <el-form
        v-else
        ref="formRef"
        :model="formData"
        :rules="formRules"
        label-position="top"
        class="site-rules-form"
      >
        <el-alert
          :title="t('options.siteRules.formHint')"
          type="info"
          :closable="false"
          show-icon
          class="form-hint"
        />

        <el-form-item
          :label="t('options.siteRules.formDomain')"
          :required="!isEditing"
          prop="domain"
        >
          <!-- 域名即规则主键，编辑态不可改。用 readonly 而非 disabled（disabled 会把域名
               文字压到 2.3:1 且无法选中复制），锁定外观由下方 .domain-input--locked 负责 -->
          <el-input
            v-model="formData.domain"
            :readonly="isEditing"
            :class="{ 'domain-input--locked': isEditing }"
            :placeholder="t('options.siteRules.formDomainPlaceholder')"
            :clearable="!isEditing"
          >
            <template
              v-if="isEditing"
              #suffix
            >
              <el-icon class="domain-lock"><Lock /></el-icon>
            </template>
          </el-input>
          <div class="field-tip">
            {{ isEditing ? t('options.siteRules.domainReadonlyHint') : t('options.siteRules.formDomainHint') }}
          </div>
        </el-form-item>

        <el-form-item
          :label="t('options.siteRules.formUsernameSelector')"
          prop="usernameSelector"
        >
          <el-input
            v-model="formData.usernameSelector"
            :placeholder="t('options.siteRules.formUsernamePlaceholder')"
            clearable
          />
        </el-form-item>

        <el-form-item
          :label="t('options.siteRules.formPasswordSelector')"
          prop="passwordSelector"
        >
          <el-input
            v-model="formData.passwordSelector"
            :placeholder="t('options.siteRules.formPasswordPlaceholder')"
            clearable
          />
        </el-form-item>

        <el-form-item
          :label="t('options.siteRules.formPenetrateShadow')"
          label-position="left"
        >
          <el-switch v-model="formData.penetrateShadow" />
          <div class="field-tip">{{ t('options.siteRules.penetrateShadowHint') }}</div>
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <!-- 表单态：提交/取消；列表态：导入/导出 + 「添加规则」（空态亦复用此处，避免与空状态内按钮重复） -->
      <template v-if="showForm">
        <el-button @click="cancelForm">
          {{ t('common.cancel') }}
        </el-button>
        <el-button
          type="primary"
          :loading="saving"
          @click="handleSubmit"
        >
          {{ t('common.save') }}
        </el-button>
      </template>
      <template v-else>
        <el-button
          :icon="Upload"
          :loading="importing"
          @click="pickImportFile"
        >
          {{ t('options.siteRules.importButton') }}
        </el-button>
        <el-button
          :icon="Download"
          :loading="exporting"
          :disabled="!rulesList.length"
          @click="handleExport"
        >
          {{ t('options.siteRules.exportButton') }}
        </el-button>
        <el-button
          type="primary"
          :icon="Plus"
          @click="handleAdd"
        >
          {{ t('options.siteRules.addButton') }}
        </el-button>
        <!-- 原生 file input 只做取文件，校验与合并全在 utils/siteRulesTransfer -->
        <input
          ref="fileInputRef"
          type="file"
          accept="application/json,.json"
          class="import-file-input"
          @change="handleImportFile"
        />
      </template>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox, ElForm } from 'element-plus';
import { Plus, Lock, Download, Upload } from '@element-plus/icons-vue';
import { useI18n } from '@/utils/i18n';
import { logger } from '@/utils/logger';
import {
  getSiteRules,
  setSiteRule,
  removeSiteRule,
  isValidCssSelector,
  normalizeSiteRuleDomain,
  type SiteRule,
} from '@/utils/storage/siteRules';
import {
  exportSiteRulesToFile,
  getSiteRulesImportErrorCode,
  importSiteRulesFromText,
  SITE_RULES_IMPORT_MAX_INPUT_BYTES,
  SITE_RULES_IMPORT_MAX_RULES,
  type SiteRulesImportErrorCode,
} from '@/utils/siteRulesTransfer';

const props = defineProps<{
  modelValue: boolean;
  /** 打开时预填的域名（来自内容脚本填充失败引导）；该域名已有规则时直接进入编辑表单 */
  initialDomain?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const { t } = useI18n();

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
});

const formRef = ref<InstanceType<typeof ElForm>>();
const fileInputRef = ref<HTMLInputElement>();
const rulesList = ref<SiteRule[]>([]);
const showForm = ref(false);
const editingRule = ref<SiteRule | null>(null);
const saving = ref(false);
const exporting = ref(false);
const importing = ref(false);

/** 导入错误码 → 可读文案；原始异常只进日志，不直接抛给用户 */
const IMPORT_ERROR_KEYS: Record<SiteRulesImportErrorCode, string> = {
  FILE_TOO_LARGE: 'options.siteRules.importErrorFileTooLarge',
  INVALID_JSON: 'options.siteRules.importErrorInvalidJson',
  UNSUPPORTED_FILE: 'options.siteRules.importErrorUnsupportedFile',
  TOO_MANY_RULES: 'options.siteRules.importErrorTooManyRules',
  NO_VALID_RULES: 'options.siteRules.importErrorNoValidRules',
};

/** 编辑态：域名是规则主键，创建后不可改 */
const isEditing = computed(() => !!editingRule.value);

/** 弹窗标题随视图切换 */
const dialogTitle = computed(() => {
  if (!showForm.value) return t('options.siteRules.title');
  return isEditing.value ? t('options.siteRules.editTitle') : t('options.siteRules.addTitle');
});

interface FormData {
  domain: string;
  usernameSelector: string;
  passwordSelector: string;
  penetrateShadow: boolean;
}

const formData = reactive<FormData>({
  domain: '',
  usernameSelector: '',
  passwordSelector: '',
  penetrateShadow: true,
});

/** 选择器规则：必填 + 语法合法（与内容脚本消费端共用同一判定） */
const selectorRules = computed(() => [
  { required: true, message: t('options.siteRules.validateSelector'), trigger: 'blur' },
  {
    validator: (_rule: unknown, value: string, callback: (err?: Error) => void) => {
      const selector = (value ?? '').trim();
      if (selector && !isValidCssSelector(selector)) {
        return callback(new Error(t('options.siteRules.validateSelectorFormat')));
      }
      callback();
    },
    trigger: 'blur',
  },
]);

/** 按域名查找已有规则：忽略大小写与空白，避免历史混存 key 造成同一站点两条规则 */
const findRuleByDomain = (domain: string): SiteRule | undefined => {
  const normalized = normalizeSiteRuleDomain(domain);
  if (!normalized) return undefined;
  return rulesList.value.find(rule => normalizeSiteRuleDomain(rule.domain) === normalized);
};

const formRules = computed(() => ({
  domain: [
    { required: true, message: t('options.siteRules.validateDomain'), trigger: 'blur' },
    {
      validator: (_rule: unknown, value: string, callback: (err?: Error) => void) => {
        // 编辑态域名只读且来自存储，无需再校验格式与占用
        if (isEditing.value) return callback();
        const raw = (value ?? '').trim();
        if (!raw) return callback();
        const domain = normalizeSiteRuleDomain(raw);
        if (!domain) return callback(new Error(t('options.siteRules.validateDomainFormat')));
        if (findRuleByDomain(domain)) {
          return callback(new Error(t('options.siteRules.validateDomainDuplicate')));
        }
        callback();
      },
      trigger: 'blur',
    },
  ],
  usernameSelector: selectorRules.value,
  passwordSelector: selectorRules.value,
}));

/** 加载规则列表 */
const loadRules = async () => {
  const rules = await getSiteRules();
  rulesList.value = Object.values(rules);
};

/** 重置表单字段 */
const resetForm = () => {
  formData.domain = '';
  formData.usernameSelector = '';
  formData.passwordSelector = '';
  formData.penetrateShadow = true;
  formRef.value?.clearValidate();
};

/** 打开添加模式 */
const handleAdd = () => {
  editingRule.value = null;
  resetForm();
  showForm.value = true;
};

/** 打开编辑模式 */
const handleEdit = (rule: SiteRule) => {
  editingRule.value = rule;
  formData.domain = rule.domain;
  formData.usernameSelector = rule.customSelectors?.username ?? '';
  formData.passwordSelector = rule.customSelectors?.password ?? '';
  formData.penetrateShadow = rule.penetrateShadow ?? true;
  formRef.value?.clearValidate();
  showForm.value = true;
};

/** 取消编辑，回到列表 */
const cancelForm = () => {
  showForm.value = false;
  editingRule.value = null;
  resetForm();
};

/** 提交表单 */
const handleSubmit = async () => {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
  } catch {
    return; // 校验失败由表单内联提示，无需额外弹 toast
  }

  // 编辑态必须写回原 key（历史数据可能带大小写差异），否则同一条规则会被拆成两条、
  // 旧条目再也匹配不到；新增态用规范化后的域名，与内容脚本的精确匹配形态保持一致。
  const domain = editingRule.value?.domain ?? normalizeSiteRuleDomain(formData.domain) ?? formData.domain.trim();
  saving.value = true;
  try {
    await setSiteRule(domain, {
      customSelectors: {
        username: formData.usernameSelector.trim(),
        password: formData.passwordSelector.trim(),
      },
      penetrateShadow: formData.penetrateShadow,
    });
    await loadRules();
    cancelForm();
    ElMessage.success(t('options.siteRules.saveSuccess'));
  } catch (error) {
    logger.error('保存站点规则失败:', error);
    ElMessage.error(t('options.siteRules.saveError'));
  } finally {
    saving.value = false;
  }
};

/** 删除规则（二次确认） */
const handleDelete = async (rule: SiteRule) => {
  try {
    await ElMessageBox.confirm(
      t('options.siteRules.deleteConfirm', { domain: rule.domain }),
      t('options.siteRules.deleteConfirmTitle'),
      {
        type: 'warning',
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
      },
    );
  } catch {
    return;
  }
  try {
    await removeSiteRule(rule.domain);
    await loadRules();
    ElMessage.success(t('options.siteRules.deleteSuccess'));
  } catch (error) {
    logger.error('删除站点规则失败:', error);
    ElMessage.error(t('options.siteRules.deleteError'));
  }
};

/**
 * 导出当前全部规则为明文 JSON 文件
 *
 * 模块内已带 cause 记录日志，这里只补用户可读的失败反馈，避免同一异常刷两遍。
 */
const handleExport = async () => {
  exporting.value = true;
  try {
    const count = await exportSiteRulesToFile();
    ElMessage.success(t('options.siteRules.exportSuccess', { count }));
  } catch {
    ElMessage.error(t('options.siteRules.exportError'));
  } finally {
    exporting.value = false;
  }
};

/** 转发到隐藏的 file input，避免为取一个文件再引入上传组件 */
const pickImportFile = () => fileInputRef.value?.click();

/**
 * 读取并导入所选文件
 *
 * `input.value` 必须在取文件后立即清空：改完规则后重导同一份文件是最常见的操作序列，
 * 不清空则同一个 `File` 不会再触发 change。
 */
const handleImportFile = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > SITE_RULES_IMPORT_MAX_INPUT_BYTES) {
    ElMessage.error(t('options.siteRules.importErrorFileTooLarge'));
    return;
  }

  importing.value = true;
  try {
    const { added, updated, dropped } = await importSiteRulesFromText(await file.text());
    await loadRules();
    // 被剔除的条数必须一起报：只报成功数会让「10 条只进了 3 条」看起来像全部导入
    const summary = t('options.siteRules.importSuccess', { added, updated });
    ElMessage.success(dropped ? `${summary}${t('options.siteRules.importSkipped', { dropped })}` : summary);
  } catch (error) {
    const code = getSiteRulesImportErrorCode(error);
    if (!code) {
      logger.error('导入站点规则失败:', error);
      ElMessage.error(t('options.siteRules.importError'));
      return;
    }
    ElMessage.error(
      code === 'TOO_MANY_RULES'
        ? t(IMPORT_ERROR_KEYS[code], { max: SITE_RULES_IMPORT_MAX_RULES })
        : t(IMPORT_ERROR_KEYS[code]),
    );
  } finally {
    importing.value = false;
  }
};

/** 弹窗关闭动画结束后复位到列表视图 */
const handleClosed = () => {
  showForm.value = false;
  editingRule.value = null;
  resetForm();
};

// 打开时刷新列表；携带预填域名（内容脚本失败引导）则直接进入该域名的新增/编辑表单。
// 同时监听 initialDomain，保证弹窗已开着时再次收到引导也能响应。
watch([() => props.modelValue, () => props.initialDomain], async ([open, domain]) => {
  if (!open) return;
  await loadRules();
  if (domain) openPrefilledRule(domain);
});

/**
 * 进入预填流程：已有规则则直接编辑，否则以该域名新增
 *
 * 「填充失败 → 就地引导」最常见的场景恰恰是规则已存在但字段选错了；若一味进新增态，
 * 会被重复域名校验挡死，用户既存不下也回不到列表。
 */
function openPrefilledRule(rawDomain: string): void {
  const domain = normalizeSiteRuleDomain(rawDomain);
  if (!domain) return;
  const existing = findRuleByDomain(domain);
  if (existing) {
    handleEdit(existing);
    return;
  }
  editingRule.value = null;
  resetForm();
  formData.domain = domain;
  showForm.value = true;
}
</script>

<style scoped>
.rules-view {
  min-height: 120px;
}

.text-gray {
  font-size: 13px;
  color: #999;
}

.selector-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.selector-line {
  display: flex;
  gap: 8px;
  align-items: center;
}

.selector-tag {
  flex-shrink: 0;
  padding: 0 6px;
  font-size: 12px;
  color: var(--aph-primary, #409eff);
  background: rgb(64 158 255 / 10%);
  border-radius: 3px;
}

.selector-line code {
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--aph-font-mono, ui-monospace, monospace);
  font-size: 12px;
  color: #606266;
  white-space: nowrap;
}

.empty-tip {
  margin-top: -4px;
  font-size: 13px;
  line-height: 1.5;
  color: #909399;
}

/* 导入/导出口径说明：合并语义与「文件不含凭据」要在点按钮之前就看到，而不是事后补救 */
.transfer-tip {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.5;
  color: #909399;
}

.import-file-input {
  display: none;
}

.form-hint {
  margin-bottom: 18px;
}

.field-tip {
  width: 100%;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: #909399;
}

/* 编辑态域名锁定字段。options 全局样式（entrypoints/options/styles.css）把所有输入框
   刷成主色边框 + 主色聚焦环，readonly 与可编辑态因此看不出任何区别；这里压成中性灰底灰边，
   聚焦只加深边框、不亮主色，域名本身仍是正常对比度、可选中复制。
   多带一层 .site-rules-form 是为压过全局那条 [data-v] .el-input .el-input__wrapper.is-focus */
.site-rules-form :deep(.domain-input--locked .el-input__wrapper),
.site-rules-form :deep(.domain-input--locked .el-input__wrapper:hover) {
  background-color: var(--el-fill-color-light);
  border-color: var(--el-border-color);
  box-shadow: none;
}

.site-rules-form :deep(.domain-input--locked .el-input__wrapper.is-focus) {
  background-color: var(--el-fill-color-light);
  border-color: var(--el-text-color-secondary);
  box-shadow: none;
}

/* 编辑态域名只读锁标：提示「不可改」而非「输入框失效」 */
.domain-lock {
  color: var(--el-text-color-secondary);
}

/* 操作列 link 按钮：抵消 options 全局 .el-button--primary 的实心背景/边框，
   否则主色文字压在同色背景上不可见（danger 型已由全局样式覆盖） */
:deep(.el-button--primary.is-link),
:deep(.el-button--primary.is-link:hover) {
  background-color: transparent;
  border-color: transparent;
}

:deep(.el-dialog__body) {
  padding-top: 12px;
}
</style>
