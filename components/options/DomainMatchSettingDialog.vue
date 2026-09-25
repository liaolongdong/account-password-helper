<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.header.domainMatch')"
    width="560px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="dialog-body-scroll">
      <el-radio-group
        v-model="mode"
        class="domain-match-group"
      >
        <el-radio
          v-for="option in modeOptions"
          :key="option.value"
          :value="option.value"
          class="domain-match-option"
        >
          <span class="option-label">{{ option.label }}</span>
          <span class="option-desc">{{ option.desc }}</span>
        </el-radio>
      </el-radio-group>

      <!-- 只在最宽松档提示：该档唯一的新增风险就是测试环境账号串到一起 -->
      <el-alert
        v-if="mode === 'sameMainDomain'"
        class="domain-match-warning"
        type="warning"
        :closable="false"
        show-icon
        :title="t('options.domainMatch.warning')"
      />
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
          :loading="saveLoading"
          @click="handleSave"
        >
          {{ t('common.save') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { StorageUtils } from '@/utils/storage';
import { DEFAULT_DOMAIN_MATCH_MODE } from '@/utils/storage/configManager';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';
import type { DomainMatchMode } from '@/utils/domain';

/**
 * 跨子域匹配档位设置弹窗
 *
 * 三档为包含关系（同主域名 ⊃ 通配条目 ⊃ 仅精确匹配），缺省 `off` 即 2026-07
 * 为多测试环境隔离引入的精确 host 口径；档位只影响「哪些条目出现在本站」，
 * 不改判重、不改存储结构，落盘后由后台 storage.onChanged 镜像复位即时生效。
 */
const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const { t } = useI18n();

const mode = ref<DomainMatchMode>(DEFAULT_DOMAIN_MATCH_MODE);
const saveLoading = ref(false);

const modeOptions = computed<Array<{ value: DomainMatchMode; label: string; desc: string }>>(() => [
  { value: 'off', label: t('options.domainMatch.off'), desc: t('options.domainMatch.offDesc') },
  { value: 'wildcard', label: t('options.domainMatch.wildcard'), desc: t('options.domainMatch.wildcardDesc') },
  {
    value: 'sameMainDomain',
    label: t('options.domainMatch.sameMainDomain'),
    desc: t('options.domainMatch.sameMainDomainDesc'),
  },
]);

/**
 * 从存储加载最新配置
 */
const loadConfig = async (): Promise<void> => {
  try {
    mode.value = (await StorageUtils.getDomainMatchConfig()).mode;
  } catch (error) {
    logger.error('DomainMatchSettingDialog: 加载配置失败:', error);
    ElMessage.error(t('message.loadConfigFailed'));
  }
};

// 每次打开都重读：档位可能被侧边栏/其他 Options 标签页改动
watch(
  () => props.modelValue,
  visible => {
    if (visible) loadConfig();
  },
  { immediate: true },
);

/**
 * 保存档位
 */
const handleSave = async (): Promise<void> => {
  saveLoading.value = true;
  try {
    await StorageUtils.saveDomainMatchConfig({ mode: mode.value });
    ElMessage.success(t('options.domainMatch.saved'));
    emit('update:modelValue', false);
  } catch (error) {
    logger.error('DomainMatchSettingDialog: 保存配置失败:', error);
    ElMessage.error(t('message.saveFailed'));
  } finally {
    saveLoading.value = false;
  }
};
</script>

<style scoped>
.dialog-body-scroll {
  max-height: 60vh;
  padding-right: 4px;
  overflow-y: auto;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: center;
}

.domain-match-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

/* el-radio 默认单行等高（32px + nowrap），此处承载「标题 + 说明」两行 */
.domain-match-option {
  align-items: flex-start;
  height: auto;
  margin-right: 0;
  margin-bottom: 14px;
  white-space: normal;
}

.domain-match-option:last-child {
  margin-bottom: 0;
}

.domain-match-option :deep(.el-radio__label) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.5;
}

.option-desc {
  font-size: 12px;
  color: var(--aph-text-muted);
}

.domain-match-warning {
  margin-top: 8px;
}
</style>
