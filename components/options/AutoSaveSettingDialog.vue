<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.header.autoSave')"
    width="650px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="dialog-body-scroll">
      <el-form
        label-width="140px"
        size="large"
      >
        <el-form-item :label="t('options.autoSave.enable')">
          <el-switch
            v-model="config.enabled"
            @change="handleEnabledChange"
          />
          <div class="form-tip">{{ t('options.autoSave.enableTip') }}</div>
        </el-form-item>

        <el-form-item :label="t('options.autoSave.domainRules')">
          <div class="domain-patterns-section">
            <div class="domain-patterns-header">
              <el-text
                type="info"
                size="small"
              >
                {{ t('options.autoSave.rulesTip') }}
              </el-text>
            </div>

            <div class="add-pattern-form">
              <el-input
                v-model="newPattern.pattern"
                :placeholder="
                  newPattern.isRegex ? t('options.autoSave.regexPlaceholder') : t('options.autoSave.domainPlaceholder')
                "
                clearable
                size="default"
                @keyup.enter="addPattern"
              />
              <el-checkbox
                v-model="newPattern.isRegex"
                size="default"
              >
                {{ t('options.autoSave.regex') }}
              </el-checkbox>
              <el-button
                type="primary"
                size="default"
                :icon="Plus"
                :disabled="!newPattern.pattern.trim()"
                @click="addPattern"
              >
                {{ t('common.add') }}
              </el-button>
            </div>

            <el-table
              :key="config.domainPatterns.length"
              :data="config.domainPatterns"
              style="width: 100%"
              size="small"
              stripe
              :empty-text="t('options.autoSave.noRules')"
              max-height="260"
            >
              <el-table-column
                prop="pattern"
                :label="t('options.autoSave.patternColumn')"
                min-width="200"
              >
                <template #default="{ row }">
                  <span class="pattern-text">{{ row.pattern }}</span>
                </template>
              </el-table-column>
              <el-table-column
                prop="isRegex"
                :label="t('options.autoSave.typeColumn')"
                width="100"
                align="center"
              >
                <template #default="{ row }">
                  <el-tag
                    :type="row.isRegex ? 'warning' : 'info'"
                    size="small"
                  >
                    {{ row.isRegex ? t('options.autoSave.regex') : t('options.autoSave.domain') }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column
                :label="t('common.actions')"
                width="80"
                align="center"
              >
                <template #default="{ $index }">
                  <el-button
                    type="danger"
                    link
                    size="small"
                    @click="removePattern($index)"
                  >
                    {{ t('common.delete') }}
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-form-item>

        <el-form-item :label="t('options.autoSave.excludedDomains')">
          <div class="excluded-domains-section">
            <div class="excluded-domains-header">
              <el-text
                type="info"
                size="small"
              >
                {{ t('options.autoSave.excludedTip') }}
              </el-text>
            </div>

            <el-table
              :key="config.excludedDomains.length"
              :data="excludedDomainsTableData"
              style="width: 100%"
              size="small"
              stripe
              :empty-text="t('options.autoSave.noExcluded')"
              max-height="200"
            >
              <el-table-column
                prop="domain"
                :label="t('options.autoSave.domain')"
                min-width="200"
              >
                <template #default="{ row }">
                  <span class="pattern-text">{{ row.domain }}</span>
                </template>
              </el-table-column>
              <el-table-column
                :label="t('common.actions')"
                width="80"
                align="center"
              >
                <template #default="{ $index }">
                  <el-button
                    type="danger"
                    link
                    size="small"
                    @click="removeExcludedDomain($index)"
                  >
                    {{ t('common.delete') }}
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
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
import { ref, reactive, watch } from 'vue';
import { Plus } from '@element-plus/icons-vue';
import { StorageUtils } from '@/utils/storage';
import type { AutoSaveConfig, DomainPattern } from '@/utils/types';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const { t } = useI18n();

/** 当前配置（本地编辑副本） */
const config = reactive<AutoSaveConfig>({
  enabled: true,
  domainPatterns: [],
  excludedDomains: [],
});

/** 新增规则表单 */
const newPattern = reactive({
  pattern: '',
  isRegex: false,
});

/** 保存 loading */
const saveLoading = ref(false);

/**
 * 从存储加载最新配置
 */
const loadConfig = async (): Promise<void> => {
  try {
    const loaded = await StorageUtils.getAutoSaveConfig();
    config.enabled = loaded.enabled;
    config.domainPatterns = [...loaded.domainPatterns];
    config.excludedDomains = [...loaded.excludedDomains];
    logger.debug(
      'AutoSaveSettingDialog: 配置加载完成, enabled:',
      loaded.enabled,
      '规则数:',
      loaded.domainPatterns.length,
      '屏蔽域名数:',
      loaded.excludedDomains.length,
    );
  } catch (error) {
    logger.error('AutoSaveSettingDialog: 加载配置失败:', error);
    ElMessage.error(t('options.autoSave.loadFailed'));
  }
};

/** 已屏蔽域名表格数据（将 string[] 转换为对象数组供 el-table 使用） */
const excludedDomainsTableData = computed(() => config.excludedDomains.map(domain => ({ domain })));

// 监听弹窗打开时加载配置（immediate: true 确保首次打开也能触发）
// 注：必须在 loadConfig 定义之后注册，避免 TDZ 问题
watch(
  () => props.modelValue,
  visible => {
    if (visible) loadConfig();
  },
  { immediate: true },
);

/**
 * 开关变化时即时保存
 */
const handleEnabledChange = async (value: boolean | string | number): Promise<void> => {
  try {
    await StorageUtils.saveAutoSaveConfig({ enabled: !!value });
    ElMessage.success(value ? t('options.autoSave.enabled') : t('options.autoSave.disabled'));
  } catch (error) {
    logger.error('AutoSaveSettingDialog: 保存开关失败:', error);
    ElMessage.error(t('message.saveFailed'));
  }
};

/**
 * 新增域名匹配规则
 */
const addPattern = (): void => {
  const trimmed = newPattern.pattern.trim();
  if (!trimmed) return;

  // 校验正则表达式合法性
  if (newPattern.isRegex) {
    try {
      new RegExp(trimmed);
    } catch {
      ElMessage.warning(t('options.autoSave.invalidRegex'));
      return;
    }
  }

  // 检查重复
  const isDuplicate = config.domainPatterns.some(p => p.pattern === trimmed && p.isRegex === newPattern.isRegex);
  if (isDuplicate) {
    ElMessage.warning(t('options.autoSave.duplicateRule'));
    return;
  }

  const rule: DomainPattern = {
    id: 'rule-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
    pattern: trimmed,
    isRegex: newPattern.isRegex,
  };
  config.domainPatterns.push(rule);
  newPattern.pattern = '';
  newPattern.isRegex = false;
};

/**
 * 删除域名匹配规则
 */
const removePattern = (index: number): void => {
  config.domainPatterns.splice(index, 1);
};

/**
 * 删除已屏蔽的域名
 */
const removeExcludedDomain = (index: number): void => {
  config.excludedDomains.splice(index, 1);
};

/**
 * 保存配置
 */
const handleSave = async (): Promise<void> => {
  saveLoading.value = true;
  try {
    const toRawConfig = toRaw(config);
    await StorageUtils.saveAutoSaveConfig(toRawConfig);
    ElMessage.success(t('options.autoSave.saved'));
    emit('update:modelValue', false);
  } catch (error) {
    logger.error('AutoSaveSettingDialog: 保存配置失败:', error);
    ElMessage.error(t('message.saveFailed'));
  } finally {
    saveLoading.value = false;
  }
};
</script>

<style scoped>
.form-tip {
  margin-left: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: #909399;
}

.domain-patterns-section {
  width: 100%;
}

.domain-patterns-header {
  margin-bottom: 8px;
}

.pattern-text {
  font-family: Menlo, Monaco, 'Courier New', monospace;
  font-size: 13px;
}

.add-pattern-form {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}

.add-pattern-form .el-input {
  flex: 1;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: center;
}

.excluded-domains-section {
  width: 100%;
}

.excluded-domains-header {
  margin-bottom: 8px;
}
</style>
