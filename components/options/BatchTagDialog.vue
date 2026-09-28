<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.batchTag.title')"
    width="500px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="dialog-body-scroll">
      <el-form
        label-width="auto"
        size="large"
      >
        <el-form-item :label="t('options.batchTag.mode')">
          <el-radio-group v-model="mode">
            <el-radio-button value="append">
              {{ t('options.batchTag.modeAppend') }}
            </el-radio-button>
            <el-radio-button value="remove">
              {{ t('options.batchTag.modeRemove') }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="t('common.tag')">
          <el-select
            v-model="tags"
            multiple
            filterable
            allow-create
            default-first-option
            clearable
            :multiple-limit="MAX_TAG_COUNT"
            :no-data-text="t('common.noData')"
            :no-match-text="t('common.noMatch')"
            :placeholder="t('options.form.tagPlaceholder', { max: MAX_TAG_COUNT })"
            style="width: 100%"
          >
            <el-option
              v-for="tagOption in availableTags"
              :key="tagOption"
              :label="tagOption"
              :value="tagOption"
            />
          </el-select>
          <div class="form-tip">
            {{
              mode === 'append'
                ? t('options.batchTag.appendTip', { max: MAX_TAG_COUNT })
                : t('options.batchTag.removeTip')
            }}
          </div>
        </el-form-item>
      </el-form>
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
          :disabled="confirmDisabled"
          @click="handleSave"
        >
          {{ t('common.confirm') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from '@/utils/i18n';
import { normalizeTagInput } from '@/utils/tagUtils';
import { MAX_TAG_COUNT, MAX_TAG_LENGTH } from '@/composables/usePasswordManagement';

/** 批量编辑标签模式：追加并入 / 移除剔除 */
export type BatchTagMode = 'append' | 'remove';

/**
 * 批量编辑标签弹窗
 *
 * 对选中条目统一追加或移除标签：
 * - 追加：并入已有标签（去重），超出上限的条目由调用方跳过并统一提示；
 * - 移除：从已有标签中剔除选中项。
 * 标签输入与新增表单同构（multiple + allow-create，上限 MAX_TAG_COUNT）。
 */
const props = defineProps<{
  /** 弹窗可见性 */
  modelValue: boolean;
  /** 已有标签候选（复用列表全量标签集） */
  availableTags: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 确认保存（tags 已做 trim/去超长/去重规整） */
  save: [tags: string[], mode: BatchTagMode];
}>();

const { t } = useI18n();

/** 编辑模式（默认追加） */
const mode = ref<BatchTagMode>('append');

/** 选中的标签列表 */
const tags = ref<string[]>([]);

/** 待上抛标签与超长丢弃项：确定键与提示都以它为准，避免「能点但什么都不发生」 */
const tagNormalization = computed(() => normalizeTagInput(tags.value, MAX_TAG_LENGTH));

/**
 * 确定键禁用条件：只有「什么都没选（或只选了空白标签）」才禁用。
 * 只选了超长标签时保持可点——点击必须给出超长提示，灰掉按钮等于又一次无反馈的死路。
 */
const confirmDisabled = computed(
  () => tagNormalization.value.accepted.length === 0 && tagNormalization.value.rejectedTooLong.length === 0,
);

/**
 * 确认保存：按新增表单同口径规整（trim / 去空 / 去重 / 剔除超长）后上抛
 *
 * 超长项必须显式提示：`allow-create` 允许输入任意长度的标签，静默丢弃会让用户以为
 * 已经改完，与新增表单的 `form.tagLengthLimit` 提示口径不一致。
 */
const handleSave = () => {
  const { accepted, rejectedTooLong } = tagNormalization.value;
  if (rejectedTooLong.length > 0) {
    ElMessage.warning(t('form.tagLengthLimit', { max: MAX_TAG_LENGTH }));
  }
  if (accepted.length === 0) return;
  emit('save', accepted, mode.value);
};

/** 弹窗每次打开时重置表单，避免上次选择残留 */
watch(
  () => props.modelValue,
  visible => {
    if (visible) {
      mode.value = 'append';
      tags.value = [];
    }
  },
);
</script>

<style scoped>
.form-tip {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.4;
  color: #909399;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
