<template>
  <el-dialog
    :model-value="modelValue"
    :title="entry ? t('identity.form.editTitle') : t('identity.form.addTitle')"
    width="600px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
    @closed="handleClosed"
  >
    <div class="dialog-body-scroll">
      <el-form
        ref="formRef"
        :model="localForm"
        :rules="rules"
        label-width="100px"
        size="large"
      >
        <!-- CVV 高敏常驻警示（R13 / Q1） -->
        <el-alert
          type="warning"
          :closable="false"
          :title="t('identity.form.cvvWarning')"
          class="identity-form__alert"
        />

        <el-form-item
          :label="t('identity.form.categoryLabel')"
          prop="category"
        >
          <el-radio-group v-model="localForm.category">
            <el-radio-button value="person">{{ t('identity.category.person') }}</el-radio-button>
            <el-radio-button value="id_card">{{ t('identity.category.id_card') }}</el-radio-button>
            <el-radio-button value="bank_card">{{ t('identity.category.bank_card') }}</el-radio-button>
            <el-radio-button value="address">{{ t('identity.category.address') }}</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <!-- 默认字段集（随类别变化，切换不清空已填值） -->
        <el-form-item
          v-for="fieldKey in defaultFieldKeys"
          :key="fieldKey"
          :label="t(`identity.field.${fieldKey}`)"
          :prop="fieldKey"
        >
          <el-input
            v-model="localForm[fieldKey]"
            :maxlength="fieldMaxlength(fieldKey)"
            clearable
            show-word-limit
          />
          <div
            v-if="fieldKey === 'name'"
            class="identity-form__helper"
          >
            {{ t('identity.form.nameHelper') }}
          </div>
          <div
            v-else-if="fieldKey === 'idNumber'"
            class="identity-form__helper"
          >
            {{ t('identity.form.idNumberHelper') }}
          </div>
        </el-form-item>

        <!-- 更多字段折叠区：所有类别都能看到全部字段 -->
        <el-collapse v-model="activePanels">
          <el-collapse-item
            :title="t('identity.form.moreFields')"
            name="more"
          >
            <el-form-item
              v-for="fieldKey in collapseFieldKeys"
              :key="fieldKey"
              :label="t(`identity.field.${fieldKey}`)"
              :prop="fieldKey"
            >
              <el-input
                v-model="localForm[fieldKey]"
                :maxlength="fieldMaxlength(fieldKey)"
                clearable
                show-word-limit
              />
            </el-form-item>
          </el-collapse-item>
        </el-collapse>

        <!-- 备注：所有类别恒定可见 -->
        <el-form-item :label="t('identity.field.remark')">
          <el-input
            v-model="localForm.remark"
            type="textarea"
            :rows="3"
            :maxlength="MAX_REMARK_LEN"
            show-word-limit
          />
        </el-form-item>

        <!-- 自定义字段：所有类别恒定可见 -->
        <div class="identity-form__custom">
          <div class="identity-form__custom-header">
            <span>{{ t('identity.form.customFieldsTitle') }}</span>
            <el-button
              :icon="Plus"
              link
              type="primary"
              size="small"
              :disabled="localForm.customFields.length >= MAX_CUSTOM_FIELDS"
              @click="addCustomField"
            >
              {{ t('identity.form.addCustomField') }}
            </el-button>
          </div>
          <div
            v-for="field in localForm.customFields"
            :key="field.id"
            class="identity-form__custom-row"
          >
            <el-input
              v-model="field.label"
              :placeholder="t('identity.form.customLabelPlaceholder')"
              :maxlength="MAX_LABEL_LEN"
              clearable
              class="identity-form__custom-label"
            />
            <el-input
              v-model="field.value"
              :placeholder="t('identity.form.customValuePlaceholder')"
              :maxlength="MAX_FIELD_VALUE_LEN"
              clearable
              class="identity-form__custom-value"
            />
            <el-switch
              v-model="field.secret"
              :active-text="t('identity.form.secret')"
              class="identity-form__custom-secret"
            />
            <el-button
              :icon="Delete"
              :aria-label="t('common.delete')"
              link
              @click="removeCustomField(field.id)"
            />
          </div>
        </div>
      </el-form>

      <!-- 校验位类 warning（允许保存，仅提示） -->
      <el-alert
        v-if="warnings.length > 0"
        type="warning"
        :closable="false"
        class="identity-form__warnings"
      >
        <div
          v-for="key in warnings"
          :key="key"
          class="identity-form__warning-item"
        >
          {{ t(key) }}
        </div>
      </el-alert>
    </div>

    <template #footer>
      <div class="identity-form-footer">
        <el-button @click="$emit('update:modelValue', false)">{{ t('common.cancel') }}</el-button>
        <el-button
          type="primary"
          :loading="loading"
          @click="handleSave"
        >
          {{ t('common.save') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import type { FormInstance } from 'element-plus';
import { Delete, Plus } from '@element-plus/icons-vue';
import type { IdentityCategory, IdentityCustomField, IdentityEntry, IdentityPayload } from '@/utils/identity/types';
import { MAX_CUSTOM_FIELDS, MAX_FIELD_VALUE_LEN, MAX_LABEL_LEN, MAX_REMARK_LEN } from '@/utils/identity/constants';
import { collectIdentityWarnings, createIdentityFormRules } from '@/utils/identity/formRules';
import { generateId } from '@/utils/generateId';
import { useI18n } from '@/utils/i18n';

/**
 * 身份信息新增/编辑表单弹窗
 *
 * 自包含校验编排：error 级（格式类）走 el-form 内联错误阻止保存，warning 级
 * （校验位类）收集为常驻 el-alert 但允许保存，空表单（无任何字段）提示后拒绝。
 * 不直接落盘：校验通过后向上抛出明文 payload，由 App.vue 统一持久化。
 * `category` 是「默认字段集」而非「字段笼子」——切换类别只改变字段渲染位置，
 * 绝不清空已填值（所有字段始终存在于 localForm 中）。
 */
const props = defineProps<{
  /** 弹窗显隐 */
  modelValue: boolean;
  /** 编辑目标条目（null = 新增） */
  entry: IdentityEntry | null;
  /** 持久化进行中（父级控制保存按钮 loading） */
  loading: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 校验通过后提交明文 payload（父级持久化） */
  save: [payload: IdentityPayload];
  /** 弹窗关闭动画结束 */
  closed: [];
}>();

const { t } = useI18n();

/** 表单字段键（不含 remark / category / customFields，它们单独渲染） */
type IdentityFieldKey =
  'name' | 'idNumber' | 'phone' | 'email' | 'address' | 'cardNo' | 'cardBank' | 'cardHolder' | 'cardExpiry' | 'cardCvv';

/** 表单 model：全部字段非可选，空值以 '' 表达（简化 v-model 与动态字段渲染） */
interface IdentityFormModel {
  category: IdentityCategory;
  name: string;
  idNumber: string;
  phone: string;
  email: string;
  address: string;
  cardNo: string;
  cardBank: string;
  cardHolder: string;
  cardExpiry: string;
  cardCvv: string;
  remark: string;
  customFields: IdentityCustomField[];
}

/** 全部内置字段（默认区 + 折叠区） */
const ALL_FIELDS: IdentityFieldKey[] = [
  'name',
  'idNumber',
  'phone',
  'email',
  'address',
  'cardNo',
  'cardBank',
  'cardHolder',
  'cardExpiry',
  'cardCvv',
];

/** 各字段输入长度上限（与 validators 口径一致） */
const FIELD_MAXLENGTH: Record<IdentityFieldKey, number> = {
  name: 50,
  idNumber: 30,
  phone: 20,
  email: 100,
  address: 200,
  cardNo: 19,
  cardBank: 50,
  cardHolder: 50,
  cardExpiry: 5,
  cardCvv: 4,
};

/** 各类别的默认展开字段集（其余进「更多字段」折叠区） */
const DEFAULT_FIELDS: Record<IdentityCategory, IdentityFieldKey[]> = {
  person: ['name', 'phone', 'email', 'address'],
  id_card: ['name', 'idNumber', 'phone', 'address'],
  bank_card: ['cardHolder', 'cardNo', 'cardBank', 'cardExpiry', 'cardCvv'],
  address: ['name', 'address', 'phone'],
};

const formRef = ref<FormInstance | null>(null);

/** 校验位类 warning 文案 key（保存时收集，常驻展示） */
const warnings = ref<string[]>([]);

/** 折叠区激活面板（默认收起） */
const activePanels = ref<string[]>([]);

/** 表单校验规则（error 级；warning 级由 collectIdentityWarnings 另行收集） */
const rules = createIdentityFormRules(t);

const localForm = reactive<IdentityFormModel>({
  category: 'person',
  name: '',
  idNumber: '',
  phone: '',
  email: '',
  address: '',
  cardNo: '',
  cardBank: '',
  cardHolder: '',
  cardExpiry: '',
  cardCvv: '',
  remark: '',
  customFields: [],
});

/** 默认展开字段集（随类别切换） */
const defaultFieldKeys = computed<IdentityFieldKey[]>(() => DEFAULT_FIELDS[localForm.category]);

/** 折叠区字段集 = 全部字段 - 默认字段 */
const collapseFieldKeys = computed<IdentityFieldKey[]>(() =>
  ALL_FIELDS.filter(key => !defaultFieldKeys.value.includes(key)),
);

/** 字段长度上限查询（模板用） */
const fieldMaxlength = (key: IdentityFieldKey): number => FIELD_MAXLENGTH[key];

/** 按给定负载重置表单：传入 payload（编辑/新增带入）逐字段填充；缺省则清空（关闭时抹除已输入的明文 PII） */
function applyPayload(src?: IdentityPayload): void {
  localForm.category = src?.category ?? 'person';
  localForm.name = src?.name ?? '';
  localForm.idNumber = src?.idNumber ?? '';
  localForm.phone = src?.phone ?? '';
  localForm.email = src?.email ?? '';
  localForm.address = src?.address ?? '';
  localForm.cardNo = src?.cardNo ?? '';
  localForm.cardBank = src?.cardBank ?? '';
  localForm.cardHolder = src?.cardHolder ?? '';
  localForm.cardExpiry = src?.cardExpiry ?? '';
  localForm.cardCvv = src?.cardCvv ?? '';
  localForm.remark = src?.remark ?? '';
  localForm.customFields = (src?.customFields ?? []).map(field => ({ ...field }));
  warnings.value = [];
  activePanels.value = [];
  void nextTick(() => formRef.value?.clearValidate());
}

/** 添加自定义字段（达到上限时按钮禁用，此处不再重复判断） */
function addCustomField(): void {
  localForm.customFields.push({ id: generateId(), label: '', value: '', secret: false });
}

/** 删除自定义字段 */
function removeCustomField(id: string): void {
  localForm.customFields = localForm.customFields.filter(field => field.id !== id);
}

/** 是否至少填写了一个字段（name/各字段/自定义字段） */
function hasAnyField(): boolean {
  const textFields: IdentityFieldKey[] = ALL_FIELDS;
  if (textFields.some(key => localForm[key].trim() !== '') || localForm.remark.trim() !== '') {
    return true;
  }
  return localForm.customFields.some(field => field.label.trim() !== '' || field.value.trim() !== '');
}

/** 把表单 model 收敛为 IdentityPayload（空字符串转 undefined，剔除空标签自定义字段） */
function toPayload(): IdentityPayload {
  const pick = (value: string): string | undefined => (value.trim() ? value.trim() : undefined);
  return {
    pv: 1,
    category: localForm.category,
    name: pick(localForm.name),
    idNumber: pick(localForm.idNumber),
    phone: pick(localForm.phone),
    email: pick(localForm.email),
    address: pick(localForm.address),
    cardNo: pick(localForm.cardNo),
    cardBank: pick(localForm.cardBank),
    cardHolder: pick(localForm.cardHolder),
    cardExpiry: pick(localForm.cardExpiry),
    cardCvv: pick(localForm.cardCvv),
    remark: pick(localForm.remark),
    customFields: localForm.customFields
      .filter(field => field.label.trim() !== '')
      .map(field => ({ id: field.id, label: field.label.trim(), value: field.value.trim(), secret: field.secret })),
  };
}

/** 保存：error 级校验 → 空表单检查 → 收集 warning → 抛出 payload */
async function handleSave(): Promise<void> {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
  } catch {
    return;
  }
  if (!hasAnyField()) {
    ElMessage.error(t('identity.form.emptyRequired'));
    return;
  }
  const payload = toPayload();
  warnings.value = collectIdentityWarnings(payload);
  emit('save', payload);
}

/** 弹窗打开时按目标条目填充表单 */
watch(
  () => props.modelValue,
  visible => {
    if (visible) {
      applyPayload(props.entry?.payload);
    }
  },
);

/** 关闭动画结束：本弹窗常驻挂载，取消 / 关闭 / 会话失效均经此清空已输入的明文 PII，再向上抛出 closed */
function handleClosed(): void {
  applyPayload();
  emit('closed');
}
</script>

<style scoped>
.identity-form__alert {
  margin-bottom: 16px;
}

.identity-form__helper {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.identity-form__custom {
  margin-bottom: 16px;
}

.identity-form__custom-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

/* link 型按钮（添加字段 / 删除）：抵消 options 全局 .el-button--primary 的实心背景/边框，
   恢复透明底 + 主色文字，避免主色文字压在同色背景上默认不可见（对标 PasswordHealthDialog） */
:deep(.el-button.is-link),
:deep(.el-button.is-link:hover) {
  background-color: transparent;
  border-color: transparent;
}

.identity-form__custom-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.identity-form__custom-label {
  flex: 0 0 140px;
}

.identity-form__custom-value {
  flex: 1;
  min-width: 0;
}

.identity-form__custom-secret {
  flex-shrink: 0;
}

.identity-form__warnings {
  margin-top: 12px;
}

.identity-form__warning-item {
  line-height: 1.6;
}

.identity-form-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
