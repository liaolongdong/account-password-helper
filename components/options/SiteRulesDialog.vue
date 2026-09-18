<template>
  <el-dialog
    v-model="visible"
    :title="t('options.siteRules.title')"
    width="700px"
    class="site-rules-dialog"
    @close="handleClose"
  >
    <!-- 规则列表 -->
    <div class="rules-list">
      <el-empty
        v-if="rulesList.length === 0"
        :description="t('options.siteRules.empty')"
      />

      <el-table
        v-else
        :data="rulesList"
        stripe
        max-height="400"
      >
        <el-table-column
          prop="domain"
          :label="t('options.siteRules.columnDomain')"
          min-width="200"
        />
        <el-table-column
          :label="t('options.siteRules.columnSelectors')"
          min-width="300"
        >
          <template #default="{ row }">
            <span v-if="row.customSelectors">
              {{ row.customSelectors.username }}<br />
              {{ row.customSelectors.password }}
            </span>
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
          align="right"
          width="120"
        >
          <template #default="{ row }">
            <el-button
              size="small"
              @click="handleEdit(row)"
            >
              {{ t('options.siteRules.edit') }}
            </el-button>
            <el-button
              size="small"
              type="danger"
              @click="handleDelete(row)"
            >
              {{ t('options.siteRules.delete') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 添加/编辑表单 -->
    <el-form
      v-if="showForm"
      ref="formRef"
      :model="formData"
      :rules="formRules"
      label-width="120px"
      style="margin-top: 20px"
    >
      <el-form-item
        :label="t('options.siteRules.formDomain')"
        prop="domain"
      >
        <el-input
          v-model="formData.domain"
          :placeholder="t('options.siteRules.formDomainPlaceholder')"
          disabled
        />
      </el-form-item>

      <el-form-item
        :label="t('options.siteRules.formUsernameSelector')"
        prop="usernameSelector"
      >
        <el-input
          v-model="formData.usernameSelector"
          :placeholder="t('options.siteRules.formSelectorPlaceholder')"
        />
      </el-form-item>

      <el-form-item
        :label="t('options.siteRules.formPasswordSelector')"
        prop="passwordSelector"
      >
        <el-input
          v-model="formData.passwordSelector"
          :placeholder="t('options.siteRules.formSelectorPlaceholder')"
        />
      </el-form-item>

      <el-form-item>
        <el-checkbox v-model="formData.penetrateShadow">
          {{ t('options.siteRules.formPenetrateShadow') }}
        </el-checkbox>
      </el-form-item>

      <el-form-item>
        <el-button @click="showForm = false">
          {{ t('common.cancel') }}
        </el-button>
        <el-button
          type="primary"
          @click="handleSubmit"
        >
          {{ t('common.save') }}
        </el-button>
      </el-form-item>
    </el-form>

    <!-- 底部操作栏 -->
    <template #footer>
      <el-button
        v-if="!showForm"
        type="primary"
        @click="handleAdd"
      >
        {{ t('options.siteRules.addButton') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElForm } from 'element-plus';
import { useI18n } from '@/utils/i18n';
import { getSiteRules, setSiteRule, removeSiteRule } from '@/utils/storage/siteRules';

const props = defineProps<{
  modelValue: boolean;
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
const rulesList = ref<any[]>([]);
const showForm = ref(false);
const editingRule = ref<SiteRule | null>(null);

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

const formRules = computed(() => ({
  domain: [{ required: true, message: t('options.siteRules.validateDomain'), trigger: 'blur' }],
  usernameSelector: [{ required: true, message: t('options.siteRules.validateSelector'), trigger: 'blur' }],
  passwordSelector: [{ required: true, message: t('options.siteRules.validateSelector'), trigger: 'blur' }],
}));

/** 加载规则列表 */
const loadRules = async () => {
  const rules = await getSiteRules();
  rulesList.value = Object.values(rules);
};

/** 打开添加模式 */
const handleAdd = () => {
  editingRule.value = null;
  formData.domain = '';
  formData.usernameSelector = '';
  formData.passwordSelector = '';
  formData.penetrateShadow = true;
  showForm.value = true;
};

/** 打开编辑模式 */
const handleEdit = (rule: SiteRule) => {
  editingRule.value = rule;
  formData.domain = rule.domain;
  formData.usernameSelector = rule.customSelectors?.username ?? '';
  formData.passwordSelector = rule.customSelectors?.password ?? '';
  formData.penetrateShadow = rule.penetrateShadow ?? true;
  showForm.value = true;
};

/** 提交表单 */
const handleSubmit = async () => {
  if (!formRef.value) return;

  try {
    await formRef.value.validate();

    const rule: Omit<SiteRule, 'domain'> = {
      customSelectors: {
        username: formData.usernameSelector.trim(),
        password: formData.passwordSelector.trim(),
      },
      penetrateShadow: formData.penetrateShadow,
    };

    await setSiteRule(formData.domain, rule);
    await loadRules();
    showForm.value = false;
    ElMessage.success(t('options.siteRules.saveSuccess'));
  } catch (_error) {
    // 验证失败会触发 ElMessage（Element Plus 内置）
  }
};

/** 删除规则 */
const handleDelete = async (rule: SiteRule) => {
  try {
    await removeSiteRule(rule.domain);
    await loadRules();
    ElMessage.success(t('options.siteRules.deleteSuccess'));
  } catch (_error) {
    ElMessage.error(t('options.siteRules.deleteError'));
  }
};

/** 关闭对话框 */
const handleClose = () => {
  showForm.value = false;
  editingRule.value = null;
  loadRules();
};

onMounted(() => {
  if (visible.value) {
    loadRules();
  }
});
</script>

<style scoped>
.rules-list {
  margin-bottom: 16px;
}

.text-gray {
  font-size: 13px;
  color: #999;
}

:deep(.el-dialog__header) {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-light);
}

:deep(.el-dialog__footer) {
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-light);
}
</style>
