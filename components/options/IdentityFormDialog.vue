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
            :placeholder="t(`identity.form.placeholder.${fieldKey}`)"
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

        <!-- 备注：恒常可见的常用字段，留在核心区；分隔线只划分「扩展字段」 -->
        <el-form-item
          :label="t('identity.field.remark')"
          class="identity-form__remark"
        >
          <el-input
            v-model="localForm.remark"
            type="textarea"
            :rows="3"
            :placeholder="t('identity.form.placeholder.remark')"
            :maxlength="MAX_REMARK_LEN"
            show-word-limit
          />
        </el-form-item>

        <!-- 扩展信息组：更多字段 / 自定义字段共用一条分隔线与标题节奏 -->
        <div class="identity-form__extra">
          <!-- 更多字段折叠区：所有类别都能看到全部字段 -->
          <el-collapse
            v-model="activePanels"
            class="identity-form__more"
          >
            <el-collapse-item name="more">
              <template #title>
                <span class="identity-form__section-title">{{ t('identity.form.moreFields') }}</span>
                <span
                  v-if="filledMoreCount > 0"
                  class="identity-form__badge"
                >
                  {{ t('identity.form.filledCount', { count: filledMoreCount }) }}
                </span>
              </template>
              <el-form-item
                v-for="fieldKey in collapseFieldKeys"
                :key="fieldKey"
                :label="t(`identity.field.${fieldKey}`)"
                :prop="fieldKey"
              >
                <el-input
                  v-model="localForm[fieldKey]"
                  :placeholder="t(`identity.form.placeholder.${fieldKey}`)"
                  :maxlength="fieldMaxlength(fieldKey)"
                  clearable
                  show-word-limit
                />
              </el-form-item>
            </el-collapse-item>
          </el-collapse>
          <!-- 下分隔线：用独立元素而不是容器的 border——EP 折叠内部会溢出 1px 把容器边框盖住 -->
          <div
            class="identity-form__divider"
            aria-hidden="true"
          ></div>

          <!-- 自定义字段：所有类别恒定可见 -->
          <div class="identity-form__custom">
            <div class="identity-form__custom-header">
              <span class="identity-form__section-title">{{ t('identity.form.customFieldsTitle') }}</span>
            </div>
            <TransitionGroup
              name="identity-custom-row"
              tag="div"
              class="identity-form__custom-rows"
            >
              <div
                v-for="field in localForm.customFields"
                :key="field.id"
                class="identity-form__custom-row"
              >
                <el-input
                  :ref="el => setLabelRef(field.id, el)"
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
                <el-tooltip
                  :content="t('identity.form.secret')"
                  placement="top"
                >
                  <span class="identity-form__custom-secret">
                    <el-switch
                      v-model="field.secret"
                      size="default"
                      :aria-label="t('identity.form.secret')"
                    />
                    <span class="identity-form__custom-secret-label">{{ t('identity.form.secretShort') }}</span>
                  </span>
                </el-tooltip>
                <el-button
                  :icon="Delete"
                  :aria-label="t('common.delete')"
                  link
                  @click="removeCustomField(field.id)"
                />
              </div>
            </TransitionGroup>
            <el-button
              v-if="localForm.customFields.length < MAX_CUSTOM_FIELDS"
              class="identity-form__custom-add"
              :icon="Plus"
              @click="addCustomField"
            >
              {{ t('identity.form.addCustomField') }}
            </el-button>
            <div
              v-else
              class="identity-form__custom-limit"
            >
              {{ t('identity.form.customLimit', { max: MAX_CUSTOM_FIELDS }) }}
            </div>
            <div
              v-if="localForm.customFields.length === 0"
              class="identity-form__custom-empty"
            >
              {{ t('identity.form.customEmptyHint') }}
            </div>
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
import type { ComponentPublicInstance } from 'vue';
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

/** 折叠区已填字段数（>0 时折叠头显示徽章，避免隐藏数据不可见） */
const filledMoreCount = computed<number>(
  () => collapseFieldKeys.value.filter(key => localForm[key].trim() !== '').length,
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
  // 编辑回填时折叠区已有值则默认展开，隐藏数据不静默；新增仍收起
  const collapsedKeys = ALL_FIELDS.filter(key => !DEFAULT_FIELDS[localForm.category].includes(key));
  activePanels.value = src && collapsedKeys.some(key => (src[key] ?? '').trim() !== '') ? ['more'] : [];
  void nextTick(() => formRef.value?.clearValidate());
}

/** 添加自定义字段并聚焦新行的字段名输入框（达到上限时按钮已不可见，此处不再重复判断） */
function addCustomField(): void {
  const id = generateId();
  localForm.customFields.push({ id, label: '', value: '', secret: false });
  void nextTick(() => labelRefs.get(id)?.focus());
}

/** 删除自定义字段 */
function removeCustomField(id: string): void {
  localForm.customFields = localForm.customFields.filter(field => field.id !== id);
}

/** 新行字段名输入框实例表：函数 ref 在挂载/卸载时登记与清理，供新增后聚焦 */
const labelRefs = new Map<string, { focus: () => void }>();

/** 登记/注销自定义字段名输入框（TransitionGroup 卸载时回调传 null） */
function setLabelRef(id: string, el: Element | ComponentPublicInstance | null): void {
  if (el && 'focus' in el && typeof el.focus === 'function') {
    labelRefs.set(id, el as { focus: () => void });
    return;
  }
  labelRefs.delete(id);
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

/* 扩展信息组：与默认字段区一条分隔线之隔，组内标题共用同一节奏 */

/* 备注是扩展组的上一块：底部间距收紧，让分隔线贴近字段而不是悬在中间 */
.identity-form__remark {
  margin-bottom: 22px;
}

.identity-form__extra {
  margin-top: 0;
}

.identity-form__section-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.identity-form__badge {
  padding: 0 8px;
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  line-height: 20px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-radius: 10px;
}

/* 更多字段块的下分隔线：0 高 + 上边框，避免再被折叠内部溢出盖掉 */
.identity-form__divider {
  height: 0;
  margin: 0 0 12px;
}

.identity-form__more :deep(.el-collapse-item__header) {
  height: 40px;
  font-size: 14px;
  line-height: 40px;
  color: var(--el-text-color-regular);
  border-bottom: none;
}

.identity-form__more :deep(.el-collapse-item__header:hover),
.identity-form__more :deep(.el-collapse-item__header:focus-visible) {
  color: var(--el-color-primary);
}

.identity-form__more :deep(.el-collapse-item__arrow) {
  color: var(--el-text-color-secondary);
}

.identity-form__more :deep(.el-collapse-item__header:hover .el-collapse-item__arrow) {
  color: var(--el-color-primary);
}

.identity-form__more :deep(.el-collapse-item__wrap) {
  border-bottom: none;
}

.identity-form__more :deep(.el-collapse-item__content) {
  padding-bottom: 0;
}

.identity-form__custom {
  margin-bottom: 0;
}

.identity-form__custom-header {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.identity-form__custom-add {
  width: 100%;
  height: 36px;
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  background: transparent;
  border-style: dashed;
}

.identity-form__custom-add:hover,
.identity-form__custom-add:focus-visible {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary);
}

.identity-form__custom-limit,
.identity-form__custom-empty {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

/* link 型按钮（添加字段 / 删除）：透明底 + 主色文字。
   管理页全局那条 `.el-button--primary` 实心规则已排除 `link` / `text` 变体，所以这里对
   primary link 已是冗余；留着是因为它按 `.el-button.is-link` 通配，仍为其它色型的 link
   按钮兜住「同色文字压同色底」这一类问题，删它等于把兜底范围收窄。 */
:deep(.el-button.is-link),
:deep(.el-button.is-link:hover) {
  background-color: transparent;
  border-color: transparent;
}

.identity-form__custom-rows {
  position: relative;
}

.identity-form__custom-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

/* 字段名列加宽到 160px：容纳中英字段名占位符，避免截断 */
.identity-form__custom-label {
  flex: 0 0 160px;
}

.identity-form__custom-value {
  flex: 1;
  min-width: 0;
}

/* 机密列定宽：开关文案常驻展示（不再用 active-text 随开关显隐），开关切换不引起整行宽度跳变 */
.identity-form__custom-secret {
  display: inline-flex;
  flex: 0 0 88px;
  gap: 6px;
  align-items: center;
}

.identity-form__custom-secret-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.identity-custom-row-enter-active,
.identity-custom-row-leave-active {
  transition:
    opacity var(--el-transition-duration-fast) ease,
    transform var(--el-transition-duration-fast) ease;
}

.identity-custom-row-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}

.identity-custom-row-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

.identity-custom-row-leave-active {
  position: absolute;
  width: 100%;
}

.identity-custom-row-move {
  transition: transform var(--el-transition-duration) ease;
}

@media (prefers-reduced-motion: reduce) {
  .identity-custom-row-enter-active,
  .identity-custom-row-leave-active,
  .identity-custom-row-move {
    transition: none;
  }
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
