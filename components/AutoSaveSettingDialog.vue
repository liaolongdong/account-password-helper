<template>
  <el-dialog
    :model-value="modelValue"
    title="自动保存设置"
    width="600px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <el-form
      label-width="140px"
      size="large"
    >
      <el-form-item label="启用自动保存">
        <el-switch
          v-model="config.enabled"
          @change="handleEnabledChange"
        />
        <div class="form-tip">开启后，网站登录时将弹窗提示是否自动保存账号密码到密码列表</div>
      </el-form-item>

      <el-form-item label="域名匹配规则">
        <div class="domain-patterns-section">
          <div class="domain-patterns-header">
            <el-text
              type="info"
              size="small"
            >
              规则列表为空时匹配所有域名；配置后仅匹配的域名才会提醒是否需要自动保存
            </el-text>
          </div>

          <el-table
            :key="config.domainPatterns.length"
            :data="config.domainPatterns"
            style="width: 100%"
            size="small"
            stripe
            empty-text="暂无规则，匹配所有域名"
            max-height="260"
          >
            <el-table-column
              prop="pattern"
              label="域名 / 正则表达式"
              min-width="200"
            >
              <template #default="{ row }">
                <span class="pattern-text">{{ row.pattern }}</span>
              </template>
            </el-table-column>
            <el-table-column
              prop="isRegex"
              label="类型"
              width="100"
              align="center"
            >
              <template #default="{ row }">
                <el-tag
                  :type="row.isRegex ? 'warning' : 'info'"
                  size="small"
                >
                  {{ row.isRegex ? '正则' : '域名' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column
              label="操作"
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
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="add-pattern-form">
            <el-input
              v-model="newPattern.pattern"
              :placeholder="newPattern.isRegex ? '输入正则表达式，如 .*\\.example\\.com' : '输入域名，如 github.com'"
              clearable
              size="default"
              @keyup.enter="addPattern"
            />
            <el-checkbox
              v-model="newPattern.isRegex"
              size="default"
            >
              正则
            </el-checkbox>
            <el-button
              type="primary"
              size="default"
              :icon="Plus"
              :disabled="!newPattern.pattern.trim()"
              @click="addPattern"
            >
              添加
            </el-button>
          </div>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="dialog-footer">
        <el-button
          size="large"
          @click="$emit('update:modelValue', false)"
        >
          取消
        </el-button>
        <el-button
          type="primary"
          size="large"
          :loading="saveLoading"
          @click="handleSave"
        >
          保存
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

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

/** 当前配置（本地编辑副本） */
const config = reactive<AutoSaveConfig>({
  enabled: true,
  domainPatterns: [],
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
    logger.debug(
      'AutoSaveSettingDialog: 配置加载完成, enabled:',
      loaded.enabled,
      '规则数:',
      loaded.domainPatterns.length,
    );
  } catch (error) {
    logger.error('AutoSaveSettingDialog: 加载配置失败:', error);
    ElMessage.error('加载配置失败，请关闭弹窗重试');
  }
};

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
    ElMessage.success(value ? '已启用自动保存' : '已禁用自动保存');
  } catch (error) {
    logger.error('AutoSaveSettingDialog: 保存开关失败:', error);
    ElMessage.error('保存失败');
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
      ElMessage.warning('正则表达式格式不正确，请检查后重新输入');
      return;
    }
  }

  // 检查重复
  const isDuplicate = config.domainPatterns.some(p => p.pattern === trimmed && p.isRegex === newPattern.isRegex);
  if (isDuplicate) {
    ElMessage.warning('该规则已存在');
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
 * 保存配置
 */
const handleSave = async (): Promise<void> => {
  saveLoading.value = true;
  try {
    const toRawConfig = toRaw(config);
    await StorageUtils.saveAutoSaveConfig(toRawConfig);
    ElMessage.success('自动保存设置已保存');
    emit('update:modelValue', false);
  } catch (error) {
    logger.error('AutoSaveSettingDialog: 保存配置失败:', error);
    ElMessage.error('保存失败');
  } finally {
    saveLoading.value = false;
  }
};
</script>

<style scoped>
.form-tip {
  font-size: 12px;
  color: #909399;
  margin-left: 4px;
  line-height: 1.4;
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
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.add-pattern-form .el-input {
  flex: 1;
}

.dialog-footer {
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
