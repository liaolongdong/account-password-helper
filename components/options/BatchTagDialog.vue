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
          :disabled="tags.length === 0"
          @click="handleSave"
        >
          {{ t('common.confirm') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from '@/utils/i18n';
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

/**
 * 确认保存：规整标签（trim / 剔除空值与超长项 / 去重）后上抛
 */
const handleSave = () => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of tags.value) {
    const tag = raw.trim();
    if (!tag || tag.length > MAX_TAG_LENGTH || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
  }
  if (normalized.length === 0) return;
  emit('save', normalized, mode.value);
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
